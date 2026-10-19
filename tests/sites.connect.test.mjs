import { test } from "node:test";
import assert from "node:assert/strict";
import { connectSitesBot } from "../server/sites-connect.mjs";

const config = {
  token: "fake-token-for-unit-tests-only",
  webhookSecret: "unit-test-webhook-secret-not-a-real-credential",
  publicApiUrl: "https://aik-bot.example/",
  miniAppUrl: "https://trofimmokrov-netizen.github.io/aik-base/",
};
const webhookUrl = "https://aik-bot.example/api/telegram/webhook";
const changes = new Set(["setMyCommands", "setChatMenuButton", "setWebhook"]);
const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { "Content-Type": "application/json" },
});

function fixture(options = {}) {
  const fetches = [];
  const calls = [];
  const deps = {
    async fetch(url, init = {}) {
      fetches.push({ url: String(url), init });
      if (url === "https://aik-bot.example/health") {
        return options.health?.() ?? json({
          ok: true,
          service: "aik-base-telegram-bot",
          webhookConfigured: true,
          ordersMode: "manual",
        });
      }
      if (url === webhookUrl) return options.probe?.() ?? json({ ok: true });
      if (url === config.miniAppUrl) {
        return options.site?.() ?? new Response(
          "<!doctype html><html><head><title>AIK BASE — Сварка, которая держит.</title></head><body></body></html>",
          { headers: { "Content-Type": "text/html; charset=utf-8" } },
        );
      }
      throw new Error("Unexpected URL in unit test");
    },
    async call(token, method, body) {
      assert.equal(token, config.token);
      calls.push({ method, body });
      if (method === "getMe") return options.identity ?? { id: 123, username: "AikBaseOrder_Bot", is_bot: true };
      if (changes.has(method)) return true;
      if (method === "getWebhookInfo") return options.webhookInfo ?? {
        url: webhookUrl,
        allowed_updates: ["message"],
        pending_update_count: 0,
      };
      if (method === "getChatMenuButton") return options.menu ?? {
        type: "web_app", text: "AIK BASE", web_app: { url: config.miniAppUrl },
      };
      throw new Error("Unexpected Telegram method in unit test");
    },
  };
  return { deps, fetches, calls };
}

function assertNoChanges(calls) {
  assert.deepEqual(calls.filter(({ method }) => changes.has(method)), []);
}

test("Sites connection validates deployed handler and registers the intended bot", async () => {
  const { deps, fetches, calls } = fixture();
  await connectSitesBot(config, deps);
  assert.deepEqual(fetches.map(({ url }) => url), [
    "https://aik-bot.example/health", webhookUrl, config.miniAppUrl,
  ]);
  const probe = fetches.find(({ url }) => url === webhookUrl);
  assert.equal(probe.init.method, "POST");
  assert.equal(new Headers(probe.init.headers).get("Content-Type"), "application/json");
  assert.equal(new Headers(probe.init.headers).get("X-Telegram-Bot-Api-Secret-Token"), config.webhookSecret);
  assert.deepEqual(JSON.parse(probe.init.body), { update_id: 0 });
  assert.equal(probe.init.redirect, "error");
  assert.deepEqual(calls.map(({ method }) => method), [
    "getMe", "setMyCommands", "setChatMenuButton", "setWebhook", "getWebhookInfo", "getChatMenuButton",
  ]);
  const commands = calls.find(({ method }) => method === "setMyCommands").body.commands;
  assert.deepEqual(commands.map(({ command }) => command), ["start", "services", "order", "contact", "help", "id"]);
  assert.deepEqual(calls.find(({ method }) => method === "setChatMenuButton").body.menu_button, {
    type: "web_app", text: "AIK BASE", web_app: { url: config.miniAppUrl },
  });
  assert.deepEqual(calls.find(({ method }) => method === "setWebhook").body, {
    url: webhookUrl,
    secret_token: config.webhookSecret,
    allowed_updates: ["message"],
    drop_pending_updates: false,
  });
});

test("Sites connection does not change Telegram settings if deployed health is wrong", async () => {
  for (const health of [
    () => json({ ok: true, service: "another-service", webhookConfigured: true, ordersMode: "manual" }),
    () => json({ ok: true, service: "aik-base-telegram-bot", webhookConfigured: false, ordersMode: "manual" }),
    () => json({ ok: true, service: "aik-base-telegram-bot", webhookConfigured: true, ordersMode: "automatic" }),
    () => json({ error: "unavailable" }, 503),
  ]) {
    const { deps, calls } = fixture({ health });
    await assert.rejects(connectSitesBot(config, deps));
    assertNoChanges(calls);
  }
});

test("Sites connection verifies exact deployed webhook secret before changing settings", async () => {
  for (const probe of [
    () => json({ error: "forbidden" }, 403),
    () => json({ ok: false }),
    () => json({ method: "sendMessage", chat_id: 123, text: "unexpected" }),
  ]) {
    const { deps, calls } = fixture({ probe });
    await assert.rejects(connectSitesBot(config, deps));
    assertNoChanges(calls);
  }
});

test("Sites connection rejects a missing or unrelated Mini App before changing settings", async () => {
  for (const site of [
    () => new Response("Not Found", { status: 404 }),
    () => new Response("<html><title>Another project</title></html>", { headers: { "Content-Type": "text/html" } }),
    () => new Response("{\"title\":\"AIK BASE\"}", { headers: { "Content-Type": "application/json" } }),
  ]) {
    const { deps, calls } = fixture({ site });
    await assert.rejects(connectSitesBot(config, deps));
    assertNoChanges(calls);
  }
});

test("Sites connection stops at a different bot identity without mutating it", async () => {
  const { deps, calls } = fixture({ identity: { id: 456, username: "AnotherProjectBot", is_bot: true } });
  await assert.rejects(connectSitesBot(config, deps));
  assert.deepEqual(calls.map(({ method }) => method), ["getMe"]);
});

test("Sites connection validates URLs and configuration before any network request", async () => {
  const invalid = [
    { publicApiUrl: "http://aik-bot.example/" },
    { publicApiUrl: "https://aik-bot.example/nested" },
    { publicApiUrl: "https://name:password@aik-bot.example/" },
    { publicApiUrl: "https://aik-bot.example/?query=1" },
    { publicApiUrl: "https://aik-bot.example/#fragment" },
    { publicApiUrl: "not-a-url" },
    { miniAppUrl: "http://site.example/aik-base/" },
    { miniAppUrl: "https://name:password@site.example/aik-base/" },
    { miniAppUrl: "https://site.example/aik-base/?query=1" },
    { miniAppUrl: "https://site.example/aik-base/#fragment" },
    { token: "" },
    { webhookSecret: "too-short" },
  ];
  for (const override of invalid) {
    const { deps, calls, fetches } = fixture();
    await assert.rejects(connectSitesBot({ ...config, ...override }, deps));
    assert.deepEqual(calls, []);
    assert.deepEqual(fetches, []);
  }
});

test("Sites connection rejects a different webhook URL or missing message subscription on readback", async () => {
  for (const webhookInfo of [
    { url: "https://other-project.example/api/telegram/webhook", allowed_updates: ["message"] },
    { url: webhookUrl, allowed_updates: ["callback_query"] },
  ]) {
    const { deps } = fixture({ webhookInfo });
    await assert.rejects(connectSitesBot(config, deps));
  }
});

test("Sites connection rejects fresh webhook errors and accepts historical errors", async () => {
  const recent = fixture({ webhookInfo: {
    url: webhookUrl, allowed_updates: ["message"],
    last_error_date: Math.floor(Date.now() / 1000) + 60,
    last_error_message: "upstream unavailable",
  } });
  await assert.rejects(connectSitesBot(config, recent.deps));
  const old = fixture({ webhookInfo: {
    url: webhookUrl, allowed_updates: ["message"],
    last_error_date: 1, last_error_message: "historical error",
  } });
  await connectSitesBot(config, old.deps);
});

test("Sites connection detects a menu that did not retain the intended Mini App URL", async () => {
  for (const menu of [
    { type: "commands" },
    { type: "web_app", text: "AIK BASE", web_app: { url: "https://another-project.example/" } },
  ]) {
    const { deps } = fixture({ menu });
    await assert.rejects(connectSitesBot(config, deps));
  }
});
