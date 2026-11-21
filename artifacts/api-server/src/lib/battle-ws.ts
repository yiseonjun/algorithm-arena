import type { IncomingMessage, Server } from "node:http";
import { URL } from "node:url";
import { WebSocket, WebSocketServer } from "ws";
import { getBattle, setPlayerConnected } from "./battle-store";
import { logger } from "./logger";

interface BattleSocket extends WebSocket {
  roomId?: string;
  playerId?: string;
}

const clients = new Map<string, Set<BattleSocket>>();

function send(socket: WebSocket, payload: unknown): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

export function broadcastBattleEvent(roomId: string, payload: unknown): void {
  for (const socket of clients.get(roomId.toUpperCase()) ?? []) {
    send(socket, payload);
  }
}

function addClient(roomId: string, socket: BattleSocket): void {
  const room = clients.get(roomId) ?? new Set<BattleSocket>();
  room.add(socket);
  clients.set(roomId, room);
}

function removeClient(roomId: string, socket: BattleSocket): void {
  const room = clients.get(roomId);
  if (!room) return;
  room.delete(socket);
  if (room.size === 0) clients.delete(roomId);
}

function parseConnection(
  request: IncomingMessage,
): { roomId: string; playerId: string } | null {
  const url = new URL(request.url ?? "/", "http://localhost");
  const match = url.pathname.match(/^\/ws\/battle\/([A-Z0-9]+)\/([a-f0-9-]+)$/i);
  if (!match) return null;
  return { roomId: match[1].toUpperCase(), playerId: match[2] };
}

export function attachBattleSockets(server: Server): void {
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 2048 });

  server.on("upgrade", (request, socket, head) => {
    const identity = parseConnection(request);
    const battle = identity ? getBattle(identity.roomId) : null;
    const playerExists =
      identity &&
      battle?.players.some((player) => player.id === identity.playerId);
    if (!identity || !playerExists) {
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
      socket.destroy();
      return;
    }
    sockets.handleUpgrade(request, socket, head, (webSocket) => {
      sockets.emit("connection", webSocket, request);
    });
  });

  sockets.on("connection", (rawSocket, request) => {
    const identity = parseConnection(request);
    if (!identity) {
      rawSocket.close(1008, "Invalid battle room.");
      return;
    }

    const socket = rawSocket as BattleSocket;
    socket.roomId = identity.roomId;
    socket.playerId = identity.playerId;
    addClient(identity.roomId, socket);

    const battle = setPlayerConnected(identity.roomId, identity.playerId, true);
    if (battle) {
      broadcastBattleEvent(identity.roomId, {
        type: "PLAYER_JOIN",
        playerId: identity.playerId,
        battle,
      });
      send(socket, { type: "STATE_SYNC", battle });
    }

    socket.on("message", (rawMessage) => {
      if (rawMessage.toString().length > 1000) {
        socket.close(1009, "Message too large.");
      }
    });

    socket.on("error", (error) => {
      logger.warn(
        { roomId: identity.roomId, error: error.message },
        "Battle WebSocket error",
      );
    });

    socket.on("close", () => {
      removeClient(identity.roomId, socket);
      const anotherSessionOpen = [...(clients.get(identity.roomId) ?? [])].some(
        (client) => client.playerId === identity.playerId,
      );
      if (!anotherSessionOpen) {
        const latestBattle = setPlayerConnected(
          identity.roomId,
          identity.playerId,
          false,
        );
        if (latestBattle) {
          broadcastBattleEvent(identity.roomId, {
            type: "PLAYER_DISCONNECT",
            playerId: identity.playerId,
            battle: latestBattle,
          });
        }
      }
    });
  });
}

export function publishBattleTick(
  roomId: string,
  battle: unknown,
  finished: boolean,
): void {
  broadcastBattleEvent(roomId, {
    type: finished ? "GAME_OVER" : "TIMER_TICK",
    battle,
  });
}
