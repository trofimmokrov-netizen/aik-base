import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");
const scriptUrl = pathToFileURL(
  path.join(root, "scripts/cloudflare-enable.mjs"),
).href;

for (const ready of [false, true]) {
  test(`frontend activation ${ready ? "records a verified API and switches deployment" : "preserves the working site when bot notifications are not ready"}`, () => {
    const dir = mkdtempSync(path.join(tmpdir(), "aik-enable-"));
    try {
      mkdirSync(path.join(dir, "shared"));
      mkdirSync(path.join(dir, ".github/workflows"), { recursive: true });
      const sitePath = path.join(dir, "shared/site.json");
      const workflowPath = path.join(dir, ".github/workflows/pages.yml");
      const originalSite = JSON.stringify({
        phone: "+79349999779",
        apiUrl: "",
      });
      const originalWorkflow = readFileSync(
        path.join(root, ".github/workflows/pages.yml"),
        "utf8",
      );
      writeFileSync(sitePath, originalSite);
      writeFileSync(workflowPath, originalWorkflow);
      const health = {
        status: "ok",
        storage: "cloudflare-d1",
        telegramRegistered: true,
        notificationsReady: ready,
      };
      const code = `globalThis.fetch = async () => new Response(JSON.stringify(${JSON.stringify(health)})); process.argv[2] = 'https://api.example.test'; await import(${JSON.stringify(scriptUrl)});`;
      const result = spawnSync(
        process.execPath,
        ["--input-type=module", "-e", code],
        { cwd: dir, encoding: "utf8" },
      );
      assert.equal(result.status, ready ? 0 : 1, result.stderr);
      if (ready) {
        const site = JSON.parse(readFileSync(sitePath, "utf8"));
        assert.equal(site.apiUrl, "https://api.example.test");
        assert.equal(site.phone, "+79349999779");
        const workflow = readFileSync(workflowPath, "utf8");
        assert.ok(workflow.includes("VITE_APP_MODE: server"));
        assert.ok(!workflow.includes("vars.VITE_API_URL"));
      } else {
        assert.equal(readFileSync(sitePath, "utf8"), originalSite);
        assert.equal(readFileSync(workflowPath, "utf8"), originalWorkflow);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
