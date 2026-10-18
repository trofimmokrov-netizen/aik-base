import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadConfig } from "../server/config.mjs";
import { openDatabase } from "../server/database.mjs";
import { createApp } from "../server/app.mjs";
import { estimatePrice, verifyTelegramInitData } from "../server/domain.mjs";
import { createWorker, commandReply } from "../server/telegram.mjs";

const testToken = "unit-test-credential-never-for-network";
const secret = "test-webhook-secret-with-at-least-32-characters";
const orderInput = {
  serviceId: "welding",
  metal: "steel",
  width: 2,
  height: 1.5,
  quantity: 2,
  onsite: true,
  name: "Тестовый клиент",
  contact: "@test_client",
  description: "Нужен каркас по индивидуальным размерам",
  comment: "",
  consent: true,
  website: "",
};
let db, server, url, config;

function initData(userId = 101, age = 0) {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000) - age),
    user: JSON.stringify({ id: userId, first_name: "Test" }),
    query_id: "test-query",
  });
  const data = [...params]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const key = createHmac("sha256", "WebAppData").update(testToken).digest();
  params.set("hash", createHmac("sha256", key).update(data).digest("hex"));
  return params.toString();
}
async function request(
  route,
  { body, method = body ? "POST" : "GET", headers = {} } = {},
) {
  const response = await fetch(`${url}/api${route}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return {
    status: response.status,
    headers: response.headers,
    data: await response.json(),
  };
}
function createOrder(headers = {}, input = orderInput) {
  return request("/orders", {
    body: input,
    headers: { "Idempotency-Key": randomUUID(), ...headers },
  });
}
beforeEach(async () => {
  config = loadConfig({
    DATABASE_PATH: ":memory:",
    TELEGRAM_BOT_TOKEN: testToken,
    TELEGRAM_ADMIN_CHAT_ID: "999",
    TELEGRAM_WEBHOOK_SECRET: secret,
  });
  db = openDatabase(":memory:");
  server = createApp(db, config).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  url = `http://127.0.0.1:${server.address().port}`;
});
afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  db.close();
});

test("health checks database and services expose eight configured directions", async () => {
  const health = await request("/health");
  assert.equal(health.status, 200);
  assert.equal(health.data.storage, "sqlite");
  const catalogue = await request("/services");
  assert.equal(catalogue.data.services.length, 8);
  assert.equal(health.headers.get("cache-control"), "no-store");
});
test("estimates never fabricate rates; configured calculation uses dimensions, multiplier and visit", async () => {
  const result = await request("/estimate", {
    body: {
      serviceId: "welding",
      metal: "steel",
      width: 2,
      height: 1,
      quantity: 3,
      onsite: false,
    },
  });
  assert.equal(result.status, 200);
  assert.equal(result.data.amount, null);
  const table = {
    configured: true,
    servicePerSquareMeter: { welding: 100 },
    metalMultipliers: { steel: 2 },
    visitFee: 500,
    minimumOrder: 1000,
  };
  assert.equal(estimatePrice(orderInput, table).amount, 1700);
  assert.equal(
    estimatePrice({ ...orderInput, metal: "aluminum" }, table).amount,
    null,
  );
  assert.equal(
    (await request("/estimate", { body: { ...orderInput, width: -2 } })).status,
    400,
  );
});
test("browser order is persistent and only its access key can retrieve it", async () => {
  const result = await createOrder();
  assert.equal(result.status, 201);
  const { order, accessToken } = result.data;
  assert.equal((await request(`/orders/${order.id}`)).status, 404);
  assert.equal(
    (
      await request(`/orders/${order.id}`, {
        headers: { Authorization: "Bearer wrong-key" },
      })
    ).status,
    404,
  );
  const own = await request(`/orders/${order.id}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  assert.equal(own.status, 200);
  assert.equal(own.data.order.description, orderInput.description);
  assert.equal("contact" in own.data.order, false);
  const row = db.prepare("SELECT * FROM orders WHERE id = ?").get(order.id);
  assert.notEqual(row.access_hash, accessToken);
  assert.equal(row.owner_telegram_id, null);
});
test("retries after lost responses are idempotent and modified retries are rejected", async () => {
  const key = randomUUID();
  const first = await createOrder({ "Idempotency-Key": key });
  const second = await createOrder({ "Idempotency-Key": key });
  assert.equal(second.status, 200);
  assert.equal(second.data.order.id, first.data.order.id);
  assert.equal(second.data.accessToken, first.data.accessToken);
  assert.equal(db.prepare("SELECT count(*) AS n FROM orders").get().n, 1);
  assert.equal(
    (
      await createOrder(
        { "Idempotency-Key": key },
        { ...orderInput, name: "Другой клиент" },
      )
    ).status,
    409,
  );
});
test("Telegram authorization binds ownership; another valid Telegram user is rejected", async () => {
  const ownAuth = `tma ${initData(101)}`;
  const otherAuth = `tma ${initData(202)}`;
  const result = await createOrder({ Authorization: ownAuth });
  assert.equal(result.status, 201);
  assert.equal(
    (
      await request(`/orders/${result.data.order.id}`, {
        headers: { Authorization: ownAuth },
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await request(`/orders/${result.data.order.id}`, {
        headers: { Authorization: otherAuth },
      })
    ).status,
    404,
  );
  assert.equal(
    (await request("/my/orders", { headers: { Authorization: ownAuth } })).data
      .orders.length,
    1,
  );
  assert.equal(
    (await request("/my/orders", { headers: { Authorization: otherAuth } }))
      .data.orders.length,
    0,
  );
  assert.equal((await request("/my/orders")).status, 401);
});
test("Telegram HMAC rejects tampering, expired sessions, future dates and duplicate fields", async () => {
  assert.equal(verifyTelegramInitData(initData(101), testToken).id, "101");
  assert.equal(verifyTelegramInitData(initData(101, 3601), testToken), null);
  assert.equal(verifyTelegramInitData(initData(101, -60), testToken), null);
  assert.equal(
    verifyTelegramInitData(`${initData(101)}&auth_date=1`, testToken),
    null,
  );
  assert.equal(
    verifyTelegramInitData(initData(101).replace("Test", "Other"), testToken),
    null,
  );
  const result = await createOrder({
    Authorization: `tma ${initData(101, 4000)}`,
  });
  assert.equal(result.status, 401);
});
test("validation rejects honeypot, no consent, invalid contacts and unknown fields", async () => {
  for (const patch of [
    { website: "spam.invalid" },
    { consent: false },
    { contact: "invalid" },
    { quantity: 1.5 },
    { owner_telegram_id: "999" },
    { description: "<short>" },
  ]) {
    assert.equal(
      (await createOrder({}, { ...orderInput, ...patch })).status,
      400,
    );
  }
  assert.equal(db.prepare("SELECT count(*) AS n FROM orders").get().n, 0);
});
test("origin restrictions and request throttling actually reject requests", async () => {
  assert.equal(
    (await createOrder({ Origin: "https://untrusted.invalid" })).status,
    403,
  );
  for (let i = 0; i < 8; i++) assert.equal((await createOrder()).status, 201);
  const limited = await createOrder();
  assert.equal(limited.status, 429);
  assert.ok(limited.headers.get("retry-after"));
});
test("webhook authenticates secret, deduplicates updates and worker handles commands", async () => {
  const update = {
    update_id: 42,
    message: {
      chat: { id: 101, type: "private" },
      from: { id: 101 },
      text: "/start",
    },
  };
  assert.equal(
    (await request("/telegram/webhook", { body: update })).status,
    403,
  );
  const options = {
    body: update,
    headers: { "X-Telegram-Bot-Api-Secret-Token": secret },
  };
  assert.equal((await request("/telegram/webhook", options)).status, 200);
  assert.equal((await request("/telegram/webhook", options)).status, 200);
  assert.equal(
    db.prepare("SELECT count(*) AS n FROM telegram_updates").get().n,
    1,
  );
  const calls = [];
  await createWorker(db, config, async (_token, method, body) => {
    calls.push({ method, body });
  })();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.chat_id, 101);
  assert.equal(
    calls[0].body.reply_markup.inline_keyboard[0][0].web_app.url,
    config.miniAppUrl,
  );
  assert.equal(
    db.prepare("SELECT payload FROM telegram_updates").get().payload,
    "{}",
  );
});
test("notification failures preserve order and retry; successful delivery changes notification state", async () => {
  const result = await createOrder();
  await createWorker(db, config, async () => {
    throw new Error("offline");
  })();
  let row = db.prepare("SELECT * FROM orders").get();
  assert.equal(row.notification_status, "pending");
  assert.equal(row.notification_attempts, 1);
  assert.ok(row.next_notification_at > Date.now());
  db.prepare("UPDATE orders SET next_notification_at = 0").run();
  const calls = [];
  await createWorker(db, config, async (_token, _method, body) => {
    calls.push(body);
  })();
  row = db.prepare("SELECT * FROM orders").get();
  assert.equal(row.notification_status, "sent");
  assert.ok(calls[0].text.includes(result.data.order.id));
  assert.ok(calls[0].text.includes(orderInput.contact));
  assert.equal(calls[0].parse_mode, undefined);
});
test("only configured private-chat admin can update order status", async () => {
  const result = await createOrder();
  const id = result.data.order.id;
  const update = (user) => ({
    message: {
      chat: { id: user, type: "private" },
      from: { id: user },
      text: `/status ${id} in_progress`,
    },
  });
  commandReply(update(101), config, db);
  assert.equal(db.prepare("SELECT status FROM orders").get().status, "new");
  commandReply(update(999), config, db);
  assert.equal(
    db.prepare("SELECT status FROM orders").get().status,
    "in_progress",
  );
});
test("orders survive a database close and reopen", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "aik-persistence-"));
  try {
    const file = path.join(dir, "orders.db");
    const first = openDatabase(file);
    first
      .prepare(
        "INSERT INTO orders (id, access_hash, payload, created_at, idempotency_hash, body_hash) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        "persisted",
        "hash",
        JSON.stringify(orderInput),
        new Date().toISOString(),
        randomUUID(),
        "body",
      );
    first.close();
    const second = openDatabase(file);
    assert.equal(
      JSON.parse(second.prepare("SELECT payload FROM orders").get().payload)
        .description,
      orderInput.description,
    );
    second.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
