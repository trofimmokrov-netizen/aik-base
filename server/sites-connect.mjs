import { telegramCall } from "./telegram.mjs";

export const sitesBotCommands = [
  { command: "start", description: "Открыть AIK BASE" },
  { command: "services", description: "Каталог услуг" },
  { command: "order", description: "Подготовить заявку" },
  { command: "contact", description: "Контакты" },
  { command: "help", description: "Помощь" },
  { command: "id", description: "Мой Telegram ID" },
];

function checkedUrl(value, rootOnly) {
  let url;
  try { url = new URL(value); } catch { throw new Error("Configure valid HTTPS addresses before connecting."); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
      (rootOnly && url.pathname !== "/"))
    throw new Error("Use HTTPS addresses without credentials, query or fragment; the API address must have no path.");
  return url;
}

export async function connectSitesBot(config, deps = {}) {
  const fetcher = deps.fetch || fetch;
  const call = deps.call || telegramCall;
  if (!config.token || !/^[A-Za-z0-9_-]{32,256}$/.test(config.webhookSecret || ""))
    throw new Error("Configure TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET securely before connecting.");
  const api = checkedUrl(config.publicApiUrl, true);
  const miniApp = checkedUrl(config.miniAppUrl, false).href;
  const webhookUrl = new URL("/api/telegram/webhook", api).href;
  const startedAt = Math.floor(Date.now() / 1000);
  async function request(url, options = {}) {
    try {
      const response = await fetcher(url, {
        ...options, redirect: "error", signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error();
      return response;
    } catch { throw new Error("Service preflight failed. Check publication, networking and securely configured webhook secret."); }
  }
  async function json(url, options) {
    const response = await request(url, options);
    try { return await response.json(); }
    catch { throw new Error("Service preflight returned invalid JSON. No Telegram settings changed."); }
  }

  const health = await json(new URL("/health", api).href);
  if (health.ok !== true || health.service !== "aik-base-telegram-bot" ||
      health.webhookConfigured !== true || health.ordersMode !== "manual")
    throw new Error("The deployed AIK BASE Sites service is not ready. No Telegram settings changed.");
  const probe = await json(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Telegram-Bot-Api-Secret-Token": config.webhookSecret },
    body: JSON.stringify({ update_id: 0 }),
  });
  // No message is attached, so the deployed Sites handler sends nothing to Telegram.
  if (probe.ok !== true || probe.method)
    throw new Error("Webhook preflight failed. No Telegram settings changed.");
  const page = await request(miniApp);
  const html = await page.text();
  if (!/<title[^>]*>[^<]*AIK BASE/i.test(html))
    throw new Error("The published AIK BASE website did not pass preflight. No Telegram settings changed.");
  const identity = await call(config.token, "getMe", {});
  if (identity?.username?.toLowerCase() !== "aikbaseorder_bot")
    throw new Error("The supplied credential belongs to a different bot. No Telegram settings changed.");

  await call(config.token, "setMyCommands", { commands: sitesBotCommands });
  await call(config.token, "setChatMenuButton", {
    menu_button: { type: "web_app", text: "AIK BASE", web_app: { url: miniApp } },
  });
  await call(config.token, "setWebhook", {
    url: webhookUrl, secret_token: config.webhookSecret,
    allowed_updates: ["message"], drop_pending_updates: false,
  });
  const info = await call(config.token, "getWebhookInfo", {});
  if (info?.url !== webhookUrl || !info.allowed_updates?.includes("message"))
    throw new Error("Telegram webhook readback differs from the requested settings. Connection is not verified.");
  if (info.last_error_date >= startedAt)
    throw new Error("Telegram reports a new webhook error. Check the published service before claiming readiness.");
  const menu = await call(config.token, "getChatMenuButton", {});
  if (menu?.type !== "web_app" || menu.web_app?.url !== miniApp)
    throw new Error("Telegram menu readback differs from the requested website. Connection is not verified.");
  return { botUsername: identity.username, webhookUrl, miniAppUrl: miniApp, ordersMode: "manual" };
}
