import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

// Catch accidental deployment of the source index or missing compiled assets.
const html = readFileSync("dist/index.html", "utf8");
const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>/g)].map(
  (match) => match[1],
);
assert.ok(scripts.length > 0, "Built page has no application entry");
assert.ok(
  !html.includes("/src/main.tsx"),
  "Source index must not be published",
);
assert.ok(
  !scripts.some((src) => src.startsWith("https://telegram.org")),
  "App startup must not wait for Telegram SDK",
);
for (const src of scripts) {
  assert.ok(
    src.startsWith("/aik-base/assets/") && src.endsWith(".js"),
    "Unexpected application asset path",
  );
  assert.ok(
    existsSync(path.join("dist", src.slice("/aik-base/".length))),
    "Application bundle missing from deployment",
  );
}
assert.match(
  html,
  /href="\/aik-base\/assets\/[^\"]+\.css"/,
  "Built stylesheet is missing",
);
console.log(
  "Pages artifact verified: compiled entry and stylesheet present; no source TSX or blocking Telegram SDK.",
);
