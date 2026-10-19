import { loadConfig } from "../server/config.mjs";
import { connectSitesBot } from "../server/sites-connect.mjs";

try {
  await connectSitesBot(loadConfig());
  console.log("Sites preflight and Telegram webhook/menu readback passed. Send /start in Telegram to verify actual delivery. Orders remain manual.");
} catch (error) {
  // Custom validation messages contain no request bodies, URLs or credentials.
  // Native transport exceptions may embed request details; never print them.
  const safe = error instanceof Error && !error.cause &&
    /^(Configure |Use HTTPS |Service preflight |The deployed AIK |Webhook preflight |The published AIK |The supplied credential |Telegram webhook readback |Telegram reports a new |Telegram menu readback )/.test(error.message);
  console.error(safe ? error.message : "Connection failed. Check secure configuration, network access and Telegram availability; credentials were not logged.");
  process.exitCode = 1;
}
