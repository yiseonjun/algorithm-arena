import { Router, type IRouter } from "express";
import {
  CreateBattleBody,
  CreateBattleResponse,
  GetBattleParams,
  GetBattleResponse,
  GetChallengeParams,
  GetChallengeResponse,
  JoinBattleBody,
  JoinBattleParams,
  JoinBattleResponse,
  ListChallengesResponse,
  SubmitCodeBody,
  SubmitCodeParams,
  SubmitCodeResponse,
} from "@workspace/api-zod";
import {
  applySubmission,
  claimSubmission,
  createBattle,
  getBattle,
  getBattleSession,
  getPlayer,
  joinBattle,
  releaseSubmission,
} from "../lib/battle-store";
import { broadcastBattleEvent } from "../lib/battle-ws";
import { judgePython } from "../lib/judge";
import { findChallenge, listChallenges } from "../lib/problems";

const router: IRouter = Router();

router.get("/challenges", (_req, res): void => {
  res.json(ListChallengesResponse.parse(listChallenges()));
});

router.get("/challenges/:challengeId", (req, res): void => {
  const params = GetChallengeParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "문제 정보가 올바르지 않습니다." });
    return;
  }
  const challenge = findChallenge(params.data.challengeId);
  if (!challenge) {
    res.status(404).json({ error: "문제를 찾을 수 없습니다." });
    return;
  }
  res.json(GetChallengeResponse.parse(challenge));
});

router.post("/battles", (req, res): void => {
  const parsed = CreateBattleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "대결방 생성 정보가 올바르지 않습니다." });
    return;
  }
  if (!parsed.data.playerName.trim()) {
    res.status(400).json({
      error: "플레이어 이름을 입력해 주세요.",
    });
    return;
  }
  const session = createBattle(parsed.data.difficulty, parsed.data.playerName);
  if (!session) {
    res.status(404).json({ error: "선택한 단계에서 대결을 만들 수 없습니다." });
    return;
  }
  res.status(201).json(CreateBattleResponse.parse(session));
});

router.post("/battles/:roomId/join", (req, res): void => {
  const params = JoinBattleParams.safeParse(req.params);
  const parsed = JoinBattleBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: "방 코드가 올바르지 않습니다." });
    return;
  }
  if (!parsed.success) {
    res.status(400).json({ error: "참가 정보가 올바르지 않습니다." });
    return;
  }
  if (!parsed.data.playerName.trim()) {
    res.status(400).json({
      error: "플레이어 이름을 입력해 주세요.",
    });
    return;
  }
  const session = joinBattle(params.data.roomId, parsed.data.playerName);
  if (!session) {
    res.status(409).json({ error: "방이 가득 찼거나 더 이상 참가할 수 없습니다." });
    return;
  }
  broadcastBattleEvent(params.data.roomId, {
    type: "PLAYER_JOIN",
    playerId: session.playerId,
    battle: session.battle,
  });
  res.json(JoinBattleResponse.parse(session));
});

router.get("/battles/:roomId/players/:playerId", (req, res): void => {
  const params = GetBattleParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "대결 또는 참가자 정보가 올바르지 않습니다." });
    return;
  }
  const session = getBattleSession(params.data.roomId, params.data.playerId);
  if (!session) {
    res.status(404).json({ error: "대결방 또는 참가자를 찾을 수 없습니다." });
    return;
  }
  res.json(GetBattleResponse.parse(session));
});

router.post("/battles/:roomId/submissions", async (req, res): Promise<void> => {
  const params = SubmitCodeParams.safeParse(req.params);
  const parsed = SubmitCodeBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: "대결방 정보가 올바르지 않습니다." });
    return;
  }
  if (!parsed.success) {
    res.status(400).json({ error: "코드 제출 정보가 올바르지 않습니다." });
    return;
  }

  const { roomId } = params.data;
  const { playerId, challengeId, code, mode } = parsed.data;
  const battle = getBattle(roomId);
  if (!battle) {
    res.status(404).json({ error: "대결방을 찾을 수 없습니다." });
    return;
  }
  const player = getPlayer(roomId, playerId);
  if (!player) {
    res.status(404).json({ error: "이 대결방에서 참가자를 찾을 수 없습니다." });
    return;
  }
  if (player.currentChallengeIndex >= battle.challengeIds.length) {
    res.status(409).json({ error: "선택한 단계의 문제를 모두 풀었습니다." });
    return;
  }
  if (battle.challengeIds[player.currentChallengeIndex] !== challengeId) {
    res.status(409).json({ error: "현재 풀어야 하는 문제와 제출한 문제가 다릅니다." });
    return;
  }
  if (battle.status !== "ACTIVE") {
    res.status(409).json({ error: "현재 진행 중인 대결이 아닙니다." });
    return;
  }
  if (!claimSubmission(roomId, playerId)) {
    res.status(409).json({ error: "이전 코드를 채점하고 있습니다. 잠시 기다려 주세요." });
    return;
  }

  try {
    const challenge = findChallenge(challengeId);
    if (!challenge) {
      res.status(404).json({ error: "문제를 찾을 수 없습니다." });
      return;
    }

    broadcastBattleEvent(roomId, {
      type: "CODE_SUBMITTED",
      playerId,
      challengeId,
      mode,
    });

    const judged = await judgePython(challenge, code, mode === "SUBMIT");
    const applied = applySubmission({
      roomId,
      playerId,
      challengeId,
      verdict: judged.verdict,
      mode,
    });
    if (!applied) {
      res.status(409).json({ error: "채점 중 대결이 종료되었습니다." });
      return;
    }

    const result = SubmitCodeResponse.parse({
      ...judged,
      damageDealt: applied.damageDealt,
      pointsAwarded: applied.pointsAwarded,
      battle: applied.battle,
    });
    broadcastBattleEvent(roomId, {
      type: "SUBMISSION_RESULT",
      playerId,
      challengeId,
      mode,
      result,
      battle: applied.battle,
    });
    if (applied.damageDealt > 0) {
      broadcastBattleEvent(roomId, {
        type: "ATTACK_EVENT",
        attackerId: playerId,
        defenderId: applied.battle.players.find((player) => player.id !== playerId)?.id,
        challengeId,
        damageDealt: applied.damageDealt,
        pointsAwarded: applied.pointsAwarded,
        battle: applied.battle,
      });
    }
    if (applied.gameOver) {
      broadcastBattleEvent(roomId, {
        type: "GAME_OVER",
        battle: applied.battle,
      });
    }
    res.json(result);
  } finally {
    releaseSubmission(roomId, playerId);
  }
});

export default router;
