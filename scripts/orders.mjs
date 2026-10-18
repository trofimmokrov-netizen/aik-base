import { loadConfig } from "../server/config.mjs";
import { openDatabase } from "../server/database.mjs";

// Run only on the trusted backend host. This script never prints customer data.
const [command, id] = process.argv.slice(2);
if (command !== "delete" || !/^[a-f0-9-]{36}$/.test(id || "")) {
  console.error(
    "Usage: node --env-file-if-exists=.env scripts/orders.mjs delete <order UUID>",
  );
  process.exit(1);
}
const db = openDatabase(loadConfig().databasePath);
const result = db.prepare("DELETE FROM orders WHERE id = ?").run(id);
db.close();
console.log(
  result.changes
    ? "Order removed from the database. Handle Telegram copies and backups separately."
    : "Order not found.",
);
