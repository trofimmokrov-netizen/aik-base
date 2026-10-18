import { loadConfig } from "./config.mjs";
import { openDatabase } from "./database.mjs";
import { createApp } from "./app.mjs";
import { createWorker } from "./telegram.mjs";

process.umask(0o077);
const config = loadConfig();
const db = openDatabase(config.databasePath);
const app = createApp(db, config);
const server = app.listen(config.port, config.host, () =>
  console.log(
    `AIK BASE API listening on port ${config.port}; notifications ${config.token && config.adminChatId ? "enabled" : "not configured"}`,
  ),
);
const tick = createWorker(db, config);
const timer = setInterval(
  () =>
    tick().catch(() =>
      console.error("Background delivery failed; will retry."),
    ),
  3000,
);
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  clearInterval(timer);
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 15000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
