import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:net";
import { randomUUID, createHmac } from "node:crypto";
import { readWorkerConfig } from "../scripts/cloudflare-config.mjs";

const exec = promisify(execFile);
const root = path.resolve(import.meta.dirname, "..");
const cli = path.join(root, "node_modules/wrangler/bin/wrangler.js");
const testToken = "unit-test-credential-never-for-network";
function signed(userId) {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id: userId }),
  });
  const data = [...params]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const key = createHmac("sha256", "WebAppData").update(testToken).digest();
  params.set("hash", createHmac("sha256", key).update(data).digest("hex"));
  return `tma ${params.toString()}`;
}
let dir, configPath, port, base, processHandle;
let logs = "";
const cliEnv = {
  ...process.env,
  CI: "true",
  WRANGLER_SEND_METRICS: "false",
  XDG_CONFIG_HOME:
    process.env.XDG_CONFIG_HOME || path.join(root, ".wrangler/test-config"),
};

async function stop() {
  if (!processHandle || processHandle.exitCode !== null) return;
  const child = processHandle;
  await new Promise((resolve) => {
    child.once("exit", resolve);
    if (process.platform === "win32") child.kill("SIGTERM");
    else process.kill(-child.pid, "SIGTERM");
    const timer = setTimeout(() => {
      try {
        if (process.platform === "win32") child.kill("SIGKILL");
        else process.kill(-child.pid, "SIGKILL");
      } catch {
        /* Already gone. */
      }
    }, 5000);
    timer.unref();
    child.once("exit", () => clearTimeout(timer));
  });
  processHandle = null;
}
async function start() {
  logs = "";
  processHandle = spawn(
    process.execPath,
    [
      cli,
      "dev",
      "--local",
      "--config",
      configPath,
      "--persist-to",
      path.join(dir, "state"),
      "--ip",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    {
      cwd: root,
      env: cliEnv,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  for (const stream of [processHandle.stdout, processHandle.stderr])
    stream.on("data", (chunk) => {
      logs = (logs + chunk).slice(-6000);
    });
  for (let i = 0; i < 120; i++) {
    if (processHandle.exitCode !== null)
      throw new Error(`Local Worker exited: ${logs}`);
    try {
      const response = await fetch(`${base}/api/health`, {
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok) return;
    } catch {
      /* Starting. */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Local Worker did not become ready: ${logs}`);
}
before(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "aik-cloudflare-runtime-"));
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  base = `http://127.0.0.1:${port}`;
  const config = readWorkerConfig(path.join(root, "wrangler.jsonc"));
  config.main = path.join(root, "cloudflare/worker.mjs");
  config.d1_databases[0].migrations_dir = path.join(
    root,
    "cloudflare/migrations",
  );
  config.vars.ALLOWED_ORIGINS = base;
  // PUBLIC_API_URL remains empty: local tests never register or contact a live bot.
  configPath = path.join(dir, "wrangler.jsonc");
  writeFileSync(configPath, JSON.stringify(config));
  writeFileSync(
    path.join(dir, ".dev.vars"),
    `TELEGRAM_BOT_TOKEN=${testToken}\n`,
    { mode: 0o600 },
  );
  await exec(
    process.execPath,
    [
      cli,
      "d1",
      "migrations",
      "apply",
      "DB",
      "--local",
      "--config",
      configPath,
      "--persist-to",
      path.join(dir, "state"),
    ],
    { cwd: root, env: cliEnv, timeout: 30000 },
  );
  await start();
});
after(async () => {
  await stop();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

test("real local workerd and D1 run the public API and preserve orders after restart", async () => {
  const health = await (await fetch(`${base}/api/health`)).json();
  assert.equal(health.storage, "cloudflare-d1");
  assert.equal(health.telegramRegistered, false);
  assert.equal(
    (await (await fetch(`${base}/api/services`)).json()).services.length,
    8,
  );
  const payload = {
    serviceId: "stairs",
    metal: "steel",
    width: 3,
    height: 2,
    quantity: 1,
    onsite: false,
    name: "Проверка D1",
    contact: "runtime@example.test",
    description: "Проверка настоящего локального Cloudflare runtime",
    comment: "",
    consent: true,
    website: "",
  };
  const headers = {
    "Content-Type": "application/json",
    Origin: base,
    "Idempotency-Key": randomUUID(),
  };
  const created = await fetch(`${base}/api/orders`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  assert.equal(created.status, 201);
  const data = await created.json();
  const duplicate = await fetch(`${base}/api/orders`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  assert.equal(duplicate.status, 200);
  assert.equal((await duplicate.json()).order.id, data.order.id);
  await stop();
  await start();
  const own = await fetch(`${base}/api/orders/${data.order.id}`, {
    headers: { Authorization: `Bearer ${data.accessToken}` },
  });
  assert.equal(own.status, 200);
  assert.equal((await own.json()).order.description, payload.description);
  assert.equal(
    (await fetch(`${base}/api/orders/${data.order.id}`)).status,
    404,
  );
  const preflight = await fetch(`${base}/api/orders`, {
    method: "OPTIONS",
    headers: { Origin: base },
  });
  assert.equal(preflight.status, 204);
  const authorization = signed(101);
  const telegramOrder = await fetch(`${base}/api/orders`, {
    method: "POST",
    headers: {
      ...headers,
      "Idempotency-Key": randomUUID(),
      Authorization: authorization,
    },
    body: JSON.stringify(payload),
  });
  assert.equal(telegramOrder.status, 201);
  const telegramData = await telegramOrder.json();
  assert.equal(
    (
      await fetch(`${base}/api/orders/${telegramData.order.id}`, {
        headers: { Authorization: authorization },
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await fetch(`${base}/api/orders/${telegramData.order.id}`, {
        headers: { Authorization: signed(202) },
      })
    ).status,
    404,
  );
});
