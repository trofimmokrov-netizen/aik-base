import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

// Runs Worker SQL against real SQLite; runtime tests separately use local Cloudflare D1.
export function testDatabase() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  sqlite.exec(
    readFileSync(
      new URL("../../cloudflare/migrations/0001_initial.sql", import.meta.url),
      "utf8",
    ),
  );
  function statement(sql, parameters = []) {
    return {
      sql,
      parameters,
      bind(...values) {
        return statement(sql, values);
      },
      async first() {
        return sqlite.prepare(sql).get(...parameters) || null;
      },
      async all() {
        return {
          results: sqlite.prepare(sql).all(...parameters),
          success: true,
        };
      },
      async run() {
        return {
          success: true,
          meta: { changes: sqlite.prepare(sql).run(...parameters).changes },
        };
      },
    };
  }
  return {
    sqlite,
    prepare(sql) {
      return statement(sql);
    },
    close() {
      sqlite.close();
    },
    async batch(statements) {
      sqlite.exec("BEGIN");
      try {
        const results = statements.map((item) => ({
          success: true,
          meta: {
            changes: sqlite.prepare(item.sql).run(...item.parameters).changes,
          },
        }));
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
}
