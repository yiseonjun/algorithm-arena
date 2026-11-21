import { randomInt, randomUUID } from "node:crypto";
import type {
  Battle,
  BattleLogEntry,
  BattlePlayer,
  BattleSession,
  Challenge,
} from "@workspace/api-zod";
import { findChallenge, listChallengesByDifficulty } from "./problems";

const MATCH_DURATION_SECONDS = 5 * 60;
const CHALLENGES_PER_MATCH = 3;
const rooms = new Map<string, BattleRoom>();

interface BattleRoom {
  battle: Battle;
  createdAt: number;
  endsAt: number | null;
  pendingPlayers: Set<string>;
}

export interface TickResult {
  roomId: string;
  battle: Battle;
  finished: boolean;
}

function newRoomCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  do {
    code = Array.from(randomUUID().replaceAll("-", "").slice(0, 6))
      .map((char) => alphabet[parseInt(char, 16) % alphabet.length])
      .join("");
  } while (rooms.has(code));
  return code;
}

function getRoom(roomId: string): BattleRoom | undefined {
  return rooms.get(roomId.toUpperCase());
}

function remaining(room: BattleRoom, now = Date.now()): number {
  if (!room.endsAt) return MATCH_DURATION_SECONDS;
  return Math.max(0, Math.ceil((room.endsAt - now) / 1000));
}

function finishRoom(room: BattleRoom, winnerPlayerId: string | null): void {
  if (room.battle.status === "FINISHED") return;
  room.battle.elapsedSeconds = Math.min(
    MATCH_DURATION_SECONDS,
    Math.max(room.battle.elapsedSeconds, MATCH_DURATION_SECONDS - remaining(room)),
  );
  room.battle.status = "FINISHED";
  room.battle.winnerPlayerId = winnerPlayerId;
  room.battle.secondsRemaining = 0;
}

function decideWinner(room: BattleRoom): string | null {
  const [first, second] = room.battle.players;
  if (!first || !second) return null;
  if (first.hearts !== second.hearts) {
    return first.hearts > second.hearts ? first.id : second.id;
  }
  if (first.points !== second.points) {
    return first.points > second.points ? first.id : second.id;
  }
  return null;
}

function chooseChallenges(
  difficulty: Challenge["difficulty"],
): Challenge[] {
  const candidates = listChallengesByDifficulty(difficulty);
  for (let index = candidates.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    [candidates[index], candidates[swapIndex]] = [
      candidates[swapIndex]!,
      candidates[index]!,
    ];
  }
  return candidates.slice(0, CHALLENGES_PER_MATCH);
}

function getPlayerChallenge(room: BattleRoom, playerId: string): Challenge | null {
  const player = room.battle.players.find((entry) => entry.id === playerId);
  if (!player || room.battle.challengeIds.length === 0) return null;
  const index = Math.min(
    player.currentChallengeIndex,
    room.battle.challengeIds.length - 1,
  );
  return findChallenge(room.battle.challengeIds[index] ?? "") ?? null;
}

export function createBattle(
  difficulty: Challenge["difficulty"],
  playerName: string,
): BattleSession | null {
  const selectedChallenges = chooseChallenges(difficulty);
  if (selectedChallenges.length !== CHALLENGES_PER_MATCH) return null;
  const challengeIds = selectedChallenges.map((challenge) => challenge.id);
  const challenge = findChallenge(challengeIds[0] ?? "");
  if (!challenge) return null;
  const roomId = newRoomCode();
  const player: BattlePlayer = {
    id: randomUUID(),
    name: playerName.trim().slice(0, 24),
    hearts: 3,
    points: 0,
    submissions: 0,
    currentChallengeIndex: 0,
    connected: false,
  };
  const battle: Battle = {
    roomId,
    challengeIds,
    status: "WAITING",
    players: [player],
    secondsRemaining: MATCH_DURATION_SECONDS,
    elapsedSeconds: 0,
    winnerPlayerId: null,
    submissions: [],
  };
  rooms.set(roomId, {
    battle,
    createdAt: Date.now(),
    endsAt: null,
    pendingPlayers: new Set(),
  });
  return { playerId: player.id, battle: structuredClone(battle), challenge };
}

export function joinBattle(
  roomId: string,
  playerName: string,
): BattleSession | null {
  const room = getRoom(roomId);
  if (!room || room.battle.status !== "WAITING" || room.battle.players.length >= 2) {
    return null;
  }
  const challenge = findChallenge(room.battle.challengeIds[0] ?? "");
  if (!challenge) return null;
  const player: BattlePlayer = {
    id: randomUUID(),
    name: playerName.trim().slice(0, 24),
    hearts: 3,
    points: 0,
    submissions: 0,
    currentChallengeIndex: 0,
    connected: false,
  };
  room.battle.players.push(player);
  room.battle.status = "ACTIVE";
  room.endsAt = Date.now() + MATCH_DURATION_SECONDS * 1000;
  room.battle.elapsedSeconds = 0;
  return { playerId: player.id, battle: structuredClone(room.battle), challenge };
}

export function getBattleSession(
  roomId: string,
  playerId: string,
): BattleSession | null {
  const room = getRoom(roomId);
  if (!room || !room.battle.players.some((player) => player.id === playerId)) {
    return null;
  }
  refreshTimer(room);
  const challenge = getPlayerChallenge(room, playerId);
  if (!challenge) return null;
  return {
    playerId,
    battle: structuredClone(room.battle),
    challenge,
  };
}

export function getBattle(roomId: string): Battle | null {
  const room = getRoom(roomId);
  if (!room) return null;
  refreshTimer(room);
  return structuredClone(room.battle);
}

export function getPlayer(roomId: string, playerId: string): BattlePlayer | null {
  const room = getRoom(roomId);
  const player = room?.battle.players.find((entry) => entry.id === playerId);
  return player ? structuredClone(player) : null;
}

export function setPlayerConnected(
  roomId: string,
  playerId: string,
  connected: boolean,
): Battle | null {
  const room = getRoom(roomId);
  const player = room?.battle.players.find((entry) => entry.id === playerId);
  if (!room || !player) return null;
  player.connected = connected;
  return structuredClone(room.battle);
}

export function claimSubmission(roomId: string, playerId: string): boolean {
  const room = getRoom(roomId);
  if (
    !room ||
    room.battle.status !== "ACTIVE" ||
    !room.battle.players.some((player) => player.id === playerId) ||
    room.pendingPlayers.has(playerId)
  ) {
    return false;
  }
  room.pendingPlayers.add(playerId);
  return true;
}

export function releaseSubmission(roomId: string, playerId: string): void {
  getRoom(roomId)?.pendingPlayers.delete(playerId);
}

export interface AppliedSubmission {
  battle: Battle;
  playerName: string;
  damageDealt: number;
  pointsAwarded: number;
  gameOver: boolean;
}

export function applySubmission(input: {
  roomId: string;
  playerId: string;
  challengeId: string;
  verdict: BattleLogEntry["verdict"];
  mode: BattleLogEntry["mode"];
}): AppliedSubmission | null {
  const room = getRoom(input.roomId);
  if (!room) return null;
  refreshTimer(room);
  if (room.battle.status !== "ACTIVE") return null;
  const player = room.battle.players.find((entry) => entry.id === input.playerId);
  if (!player) return null;
  const expectedChallengeId =
    room.battle.challengeIds[player.currentChallengeIndex];
  if (
    player.currentChallengeIndex >= room.battle.challengeIds.length ||
    expectedChallengeId !== input.challengeId
  ) {
    return null;
  }

  player.submissions += 1;
  let pointsAwarded = 0;
  let damageDealt = 0;
  let gameOver = false;
  const opponent = room.battle.players.find((entry) => entry.id !== input.playerId);

  if (input.mode === "SUBMIT" && input.verdict === "AC" && opponent) {
    pointsAwarded = findChallenge(input.challengeId)?.points ?? 0;
    player.points += pointsAwarded;
    opponent.hearts = Math.max(0, opponent.hearts - 1);
    damageDealt = 1;
    player.currentChallengeIndex += 1;
    if (opponent.hearts === 0) {
      finishRoom(room, player.id);
      gameOver = true;
    } else if (
      room.battle.players.every(
        (entry) => entry.currentChallengeIndex >= room.battle.challengeIds.length,
      )
    ) {
      finishRoom(room, decideWinner(room));
      gameOver = true;
    }
  }

  const logEntry: BattleLogEntry = {
    id: randomUUID(),
    challengeId: input.challengeId,
    playerId: input.playerId,
    playerName: player.name,
    mode: input.mode,
    verdict: input.verdict,
    pointsAwarded,
    createdAt: new Date(),
  };
  room.battle.submissions.unshift(logEntry);
  room.battle.submissions = room.battle.submissions.slice(0, 30);
  room.battle.secondsRemaining = remaining(room);
  return {
    battle: structuredClone(room.battle),
    playerName: player.name,
    damageDealt,
    pointsAwarded,
    gameOver,
  };
}

function refreshTimer(room: BattleRoom, now = Date.now()): void {
  if (room.battle.status !== "ACTIVE" || !room.endsAt) return;
  room.battle.secondsRemaining = remaining(room, now);
  room.battle.elapsedSeconds = Math.min(
    MATCH_DURATION_SECONDS,
    MATCH_DURATION_SECONDS - room.battle.secondsRemaining,
  );
  if (room.battle.secondsRemaining === 0) {
    finishRoom(room, decideWinner(room));
  }
}

export function tickBattles(now = Date.now()): TickResult[] {
  const changed: TickResult[] = [];
  for (const [roomId, room] of rooms) {
    if (room.battle.status !== "ACTIVE" || !room.endsAt) continue;
    const oldRemaining = room.battle.secondsRemaining;
    refreshTimer(room, now);
    const finished = room.battle.secondsRemaining === 0;
    if (oldRemaining !== room.battle.secondsRemaining) {
      changed.push({
        roomId,
        battle: structuredClone(room.battle),
        finished,
      });
    }
    if (
      finished &&
      now - room.createdAt > 2 * 60 * 60 * 1000
    ) {
      rooms.delete(roomId);
    }
  }
  return changed;
}
