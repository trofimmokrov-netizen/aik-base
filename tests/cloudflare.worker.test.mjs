import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { createWorker } from "../cloudflare/worker.mjs";
import { verifyInitData } from "../cloudflare/auth.mjs";
import { flushOutbox, telegramConfig } from "../cloudflare/telegram.mjs";
import { testDatabase } from "./helpers/d1.mjs";

const token = "unit-test-credential-never-for-network";
const webhookSecret = "unit-test-webhook-secret-with-at-least-32-characters";
const input = {
  serviceId: "stairs",
  metal: "steel",
  width: 3,
  height: 2,
  quantity: 1,
  onsite: true,
  name: "Тестовый заказчик",
  contact: "client@example.test",
  description: "Нужна металлическая лестница с перилами",
  comment: "Уточнить сроки",
  consent: true,
  website: "",
};
let env, app, calls;
function signed(userId = 101, age = 0) {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000) - age),
    user: JSON.stringify({ id: userId, first_name: "Test" }),
  });
  const data = [...params]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const key = createHmac("sha256", "WebAppData").update(token).digest();
  params.set("hash", createHmac("sha256", key).update(data).digest("hex"));
  return params.toString();
}
async function callTelegram(_token, method, body) {
  calls.push({ method, body });
  return method === "getMe" ? { username: "AikBaseOrder_Bot" } : true;
}
async function request(
  path,
  { body, method = body ? "POST" : "GET", headers = {} } = {},
) {
  const request = new Request(`https://api.example.test/api${path}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const response = await app.fetch(request, env);
  return {
    status: response.status,
    headers: response.headers,
    data: response.status === 204 ? null : await response.json(),
  };
}
function order(headers = {}, body = input) {
  return request("/orders", {
    body,
    headers: { "Idempotency-Key": randomUUID(), ...headers },
  });
}
function update(id, user, text) {
  return {
    update_id: id,
    message: { chat: { id: user, type: "private" }, from: { id: user }, text },
  };
}
function webhook(body) {
  return request("/telegram/webhook", {
    body,
    headers: { "X-Telegram-Bot-Api-Secret-Token": webhookSecret },
  });
}
beforeEach(() => {
  calls = [];
  env = {
    DB: testDatabase(),
    TELEGRAM_BOT_TOKEN: token,
    TELEGRAM_WEBHOOK_SECRET: webhookSecret,
    TELEGRAM_ADMIN_CHAT_ID: "999",
    PUBLIC_API_URL: "https://api.example.test",
    MINI_APP_URL: "https://trofimmokrov-netizen.github.io/aik-base/",
  };
  app = createWorker({ callTelegram });
});
afterEach(() => env.DB.close());

test("D1 health, public contact and eight services; missing storage is not ready", async () => {
  const health = await request("/health");
  assert.equal(health.status, 200);
  assert.equal(health.data.storage, "cloudflare-d1");
  assert.equal(health.data.telegramRegistered, false);
  assert.equal((await request("/config")).data.phone, "+79349999779");
  assert.equal((await request("/services")).data.services.length, 8);
  const db = env.DB;
  env.DB = null;
  assert.equal((await request("/health")).status, 503);
  env.DB = db;
});
test("Cloudflare Web Crypto validates Telegram signatures and rejects forged, expired, future or duplicate data", async () => {
  assert.equal((await verifyInitData(signed(), token)).id, "101");
  for (const value of [
    signed(101, 3601),
    signed(101, -60),
    signed().replace("Test", "Other"),
    signed() + "&auth_date=1",
  ])
    assert.equal(await verifyInitData(value, token), null);
  assert.equal((await order({ Authorization: "tma forged" })).status, 401);
});
test("orders and notification jobs commit together; browser key restricts read access", async () => {
  const saved = await order();
  assert.equal(saved.status, 201);
  assert.equal(
    env.DB.sqlite.prepare("SELECT count(*) AS n FROM outbox").get().n,
    1,
  );
  const id = saved.data.order.id;
  assert.equal((await request(`/orders/${id}`)).status, 404);
  assert.equal(
    (
      await request(`/orders/${id}`, {
        headers: { Authorization: "Bearer wrong" },
      })
    ).status,
    404,
  );
  const own = await request(`/orders/${id}`, {
    headers: { Authorization: `Bearer ${saved.data.accessToken}` },
  });
  assert.equal(own.status, 200);
  assert.equal(own.data.order.description, input.description);
  assert.equal("contact" in own.data.order, false);
  assert.notEqual(
    env.DB.sqlite.prepare("SELECT access_hash FROM orders").get().access_hash,
    saved.data.accessToken,
  );
});
test("concurrent same-key creates yield one order and one delivery job; changed input is rejected", async () => {
  const key = randomUUID();
  const headers = { "Idempotency-Key": key };
  const [a, b] = await Promise.all([order(headers), order(headers)]);
  assert.ok([200, 201].includes(a.status));
  assert.ok([200, 201].includes(b.status));
  assert.equal(a.data.order.id, b.data.order.id);
  assert.equal(a.data.accessToken, b.data.accessToken);
  assert.equal(
    env.DB.sqlite.prepare("SELECT count(*) AS n FROM orders").get().n,
    1,
  );
  assert.equal(
    env.DB.sqlite.prepare("SELECT count(*) AS n FROM outbox").get().n,
    1,
  );
  assert.equal(
    (await order(headers, { ...input, name: "Другой заказчик" })).status,
    409,
  );
});
test("Telegram owners can list and retrieve only their own orders", async () => {
  const a = `tma ${signed(101)}`;
  const b = `tma ${signed(202)}`;
  const saved = await order({ Authorization: a });
  assert.equal(
    (
      await request(`/orders/${saved.data.order.id}`, {
        headers: { Authorization: b },
      })
    ).status,
    404,
  );
  assert.equal(
    (await request("/my/orders", { headers: { Authorization: a } })).data.orders
      .length,
    1,
  );
  assert.equal(
    (await request("/my/orders", { headers: { Authorization: b } })).data.orders
      .length,
    0,
  );
  assert.equal((await request("/my/orders")).status, 401);
});
test("validation, unknown fields, honeypot and actual payload limit reject malformed input", async () => {
  for (const patch of [
    { website: "spam.invalid" },
    { consent: false },
    { contact: "invalid" },
    { owner_telegram_id: "999" },
    { width: -1 },
  ])
    assert.equal((await order({}, { ...input, ...patch })).status, 400);
  const huge = new Request("https://api.example.test/api/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value: "a".repeat(40000) }),
  });
  assert.equal((await app.fetch(huge, env)).status, 413);
  assert.equal(
    env.DB.sqlite.prepare("SELECT count(*) AS n FROM orders").get().n,
    0,
  );
});
test("D1 rate limits persist across Worker instances and CORS allows only configured origins", async () => {
  assert.equal(
    (
      await request("/config", {
        headers: { Origin: "https://untrusted.invalid" },
      })
    ).status,
    403,
  );
  const preflight = await request("/orders", {
    method: "OPTIONS",
    headers: { Origin: "https://trofimmokrov-netizen.github.io" },
  });
  assert.equal(preflight.status, 204);
  assert.equal(
    preflight.headers.get("access-control-allow-origin"),
    "https://trofimmokrov-netizen.github.io",
  );
  for (let i = 0; i < 8; i++) assert.equal((await order()).status, 201);
  app = createWorker({ callTelegram });
  assert.equal((await order()).status, 429);
});
test("estimates share configured formula and never invent prices", async () => {
  const estimate = await request("/estimate", {
    body: {
      serviceId: "stairs",
      metal: "steel",
      width: 2,
      height: 3,
      quantity: 1,
      onsite: false,
    },
  });
  assert.equal(estimate.status, 200);
  assert.equal(estimate.data.amount, null);
});
test("webhook requires secret and duplicate updates produce one durable response", async () => {
  const body = update(42, 101, "/id");
  assert.equal((await request("/telegram/webhook", { body })).status, 403);
  assert.equal((await webhook(body)).status, 200);
  assert.equal((await webhook(body)).status, 200);
  assert.equal(
    env.DB.sqlite.prepare("SELECT count(*) AS n FROM outbox").get().n,
    1,
  );
  await app.scheduled({}, env);
  const reply = calls.find((call) => call.method === "sendMessage");
  assert.equal(reply.body.chat_id, 101);
  assert.ok(reply.body.text.includes("101"));
  assert.equal(
    env.DB.sqlite.prepare("SELECT payload FROM outbox").get().payload,
    "{}",
  );
});
test("cron configures the verified bot once and notifications follow actual delivery", async () => {
  const saved = await order();
  await app.scheduled({}, env);
  assert.equal((await request("/health")).data.telegramRegistered, true);
  assert.equal(calls.filter((call) => call.method === "setWebhook").length, 1);
  assert.equal(
    calls.find((call) => call.method === "setWebhook").body.url,
    "https://api.example.test/api/telegram/webhook",
  );
  assert.ok(
    calls
      .find((call) => call.method === "sendMessage")
      .body.text.includes(saved.data.order.id),
  );
  assert.equal(
    env.DB.sqlite.prepare("SELECT notification_status FROM orders").get()
      .notification_status,
    "sent",
  );
  await app.scheduled({}, env);
  assert.equal(calls.filter((call) => call.method === "setWebhook").length, 1);
});
test("wrong bot identity causes no webhook mutation or customer notification", async () => {
  await order();
  app = createWorker({
    callTelegram: async (_token, method) => {
      calls.push({ method });
      return { username: "OtherBot" };
    },
  });
  await app.scheduled({}, env);
  assert.deepEqual(
    calls.map((call) => call.method),
    ["getMe"],
  );
  assert.equal(
    env.DB.sqlite.prepare("SELECT notification_status FROM orders").get()
      .notification_status,
    "pending",
  );
});
test("registered bot responds through waitUntil immediately without waiting for Cron", async () => {
  await app.scheduled({}, env);
  calls = [];
  const pending = [];
  const response = await app.fetch(
    new Request("https://api.example.test/api/telegram/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Telegram-Bot-Api-Secret-Token": webhookSecret,
      },
      body: JSON.stringify(update(12, 101, "/start")),
    }),
    env,
    {
      waitUntil(promise) {
        pending.push(promise);
      },
    },
  );
  assert.equal(response.status, 200);
  await Promise.all(pending);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "sendMessage");
  assert.equal(calls[0].body.chat_id, 101);
  assert.equal(
    env.DB.sqlite
      .prepare("SELECT state FROM outbox WHERE id = 'update:12'")
      .get().state,
    "done",
  );
});
test("delivery outage preserves queued work; lease and backoff prevent immediate duplicate sends", async () => {
  await order();
  const config = telegramConfig(env);
  let attempts = 0;
  await flushOutbox(env.DB, config, async () => {
    attempts++;
    throw new Error("network unavailable");
  });
  const job = env.DB.sqlite.prepare("SELECT * FROM outbox").get();
  assert.equal(job.state, "pending");
  assert.ok(job.available_at > Date.now());
  await flushOutbox(env.DB, config, callTelegram);
  assert.equal(calls.length, 0);
  env.DB.sqlite.prepare("UPDATE outbox SET available_at = 0").run();
  await Promise.all([
    flushOutbox(env.DB, config, callTelegram),
    flushOutbox(env.DB, config, callTelegram),
  ]);
  assert.equal(calls.length, 1);
  assert.equal(attempts, 1);
  assert.equal(
    env.DB.sqlite.prepare("SELECT notification_status FROM orders").get()
      .notification_status,
    "sent",
  );
});
test("only the private-chat admin can set status; replay cannot overwrite a later status", async () => {
  const saved = await order();
  const id = saved.data.order.id;
  await webhook(update(1, 101, `/status ${id} in_progress`));
  assert.equal(
    env.DB.sqlite.prepare("SELECT status FROM orders").get().status,
    "new",
  );
  await webhook(update(2, 999, `/status ${id} in_progress`));
  assert.equal(
    env.DB.sqlite.prepare("SELECT status FROM orders").get().status,
    "in_progress",
  );
  await webhook(update(3, 999, `/status ${id} completed`));
  await webhook(update(2, 999, `/status ${id} in_progress`));
  assert.equal(
    env.DB.sqlite.prepare("SELECT status FROM orders").get().status,
    "completed",
  );
});
