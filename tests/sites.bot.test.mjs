import { test } from "node:test";
import assert from "node:assert/strict";
import source from "../sites/bot.mjs";
import bundled from "../dist/sites-bot/worker.mjs";

const secret = "unit-test-webhook-secret-not-a-real-credential";
const env = { TELEGRAM_WEBHOOK_SECRET: secret };
const update = (text = "/start") => ({ update_id: 101, message: {
  chat: { id: 456, type: "private" }, from: { id: 456, is_bot: false }, text,
} });
const request = (body, headers = {}) => new Request("https://bot.example/telegram/webhook", {
  method: "POST", headers: { "Content-Type": "application/json", "X-Telegram-Bot-Api-Secret-Token": secret, ...headers },
  body: typeof body === "string" ? body : JSON.stringify(body),
});

for (const [name, worker] of [["source", source], ["bundle", bundled]]) {
  test(`${name}: start opens the actual Mini App and describes manual orders`, async () => {
    const r = await worker.fetch(request(update()), env);
    const body = await r.json();
    assert.equal(r.status, 200);
    assert.equal(body.method, "sendMessage");
    assert.equal(body.chat_id, 456);
    assert.match(body.text, /ручной отправки/);
    assert.equal(body.reply_markup.inline_keyboard[0][0].web_app.url, "https://trofimmokrov-netizen.github.io/aik-base/");
    assert.equal(body.parse_mode, undefined);
  });
  test(`${name}: commands do not promise delivery or statuses`, async () => {
    for (const text of ["/order", "/help", "Нужен навес"]) {
      const body = await (await worker.fetch(request(update(text)), env)).json();
      assert.match(body.text, /не пересылаются/);
    }
    const contact = await (await worker.fetch(request(update("/contact")), env)).json();
    assert.match(contact.text, /934/);
    const id = await (await worker.fetch(request(update("/id")), env)).json();
    assert.match(id.text, /456/);
  });
  test(`${name}: webhook rejects missing configuration and wrong secret`, async () => {
    assert.equal((await worker.fetch(request(update()), {})).status, 503);
    assert.equal((await worker.fetch(request(update(), { "X-Telegram-Bot-Api-Secret-Token": "wrong" }), env)).status, 403);
    assert.equal((await worker.fetch(new Request("https://bot.example/telegram/webhook"), env)).status, 405);
  });
  test(`${name}: invalid and unbounded bodies are rejected`, async () => {
    assert.equal((await worker.fetch(request("{"), env)).status, 400);
    assert.equal((await worker.fetch(request({ update_id: -1 }), env)).status, 400);
    assert.equal((await worker.fetch(request(" ".repeat(32769)), env)).status, 413);
    assert.equal((await worker.fetch(request(update(), { "Content-Type": "text/plain" }), env)).status, 415);
  });
  test(`${name}: groups and forged private sender are ignored`, async () => {
    for (const mutate of [u => u.message.chat.type = "group", u => u.message.from.id = 789]) {
      const u = update(); mutate(u);
      assert.deepEqual(await (await worker.fetch(request(u), env)).json(), { ok: true });
    }
  });
  test(`${name}: health reports configuration rather than claiming delivery`, async () => {
    const r = await worker.fetch(new Request("https://bot.example/health"), env);
    assert.deepEqual(await r.json(), { ok: true, service: "aik-base-telegram-bot", webhookConfigured: true, ordersMode: "manual" });
    assert.equal(r.headers.get("Cache-Control"), "no-store");
  });
}
