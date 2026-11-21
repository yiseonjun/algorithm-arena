import app from "./app";
import { logger } from "./lib/logger";
import { attachBattleSockets, publishBattleTick } from "./lib/battle-ws";
import { tickBattles } from "./lib/battle-store";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});

attachBattleSockets(server);

const battleTicker = setInterval(() => {
  for (const tick of tickBattles()) {
    publishBattleTick(tick.roomId, tick.battle, tick.finished);
  }
}, 1000);
battleTicker.unref();
