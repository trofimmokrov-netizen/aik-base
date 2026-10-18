import site from "../shared/site.json" with { type: "json" };
import { digest } from "./auth.mjs";
import { notificationText } from "../server/telegram.mjs";

export function telegramConfig(env) {
  return {
    token: env.TELEGRAM_BOT_TOKEN || "",
    adminChatId: /^[1-9]\d{0,19}$/.test(env.TELEGRAM_ADMIN_CHAT_ID || "")
      ? env.TELEGRAM_ADMIN_CHAT_ID
      : "",
    webhookSecret: /^[A-Za-z0-9_-]{32,256}$/.test(
      env.TELEGRAM_WEBHOOK_SECRET || "",
    )
      ? env.TELEGRAM_WEBHOOK_SECRET
      : "",
    miniAppUrl:
      env.MINI_APP_URL || "https://trofimmokrov-netizen.github.io/aik-base/",
    publicApiUrl: (env.PUBLIC_API_URL || "").replace(/\/$/, ""),
    phone: env.CONTACT_PHONE || site.phone,
    email: env.CONTACT_EMAIL || site.email,
  };
}
export async function setupFingerprint(config) {
  if (
    !config.token ||
    !config.webhookSecret ||
    !config.miniAppUrl.startsWith("https://") ||
    !config.publicApiUrl.startsWith("https://")
  )
    return null;
  return digest(
    JSON.stringify([
      config.token,
      config.webhookSecret,
      config.miniAppUrl,
      config.publicApiUrl,
    ]),
  );
}
export async function registered(db, config) {
  const expected = await setupFingerprint(config);
  if (!expected) return false;
  const row = await db
    .prepare("SELECT value FROM settings WHERE key = 'telegram_setup'")
    .first();
  return row?.value === expected;
}
export async function configureTelegram(db, config, call) {
  const fingerprint = await setupFingerprint(config);
  if (!fingerprint) return false;
  if (await registered(db, config)) return true;
  const identity = await call(config.token, "getMe", {});
  if (identity.username?.toLowerCase() !== site.botUsername.toLowerCase())
    throw new Error("wrong_bot_identity");
  await call(config.token, "setMyCommands", {
    commands: [
      { command: "start", description: "Открыть AIK BASE" },
      { command: "services", description: "Каталог услуг" },
      { command: "order", description: "Оформить заявку" },
      { command: "contact", description: "Контакты" },
      { command: "help", description: "Помощь" },
      { command: "id", description: "Мой Telegram ID" },
    ],
  });
  await call(config.token, "setChatMenuButton", {
    menu_button: {
      type: "web_app",
      text: "AIK BASE",
      web_app: { url: config.miniAppUrl },
    },
  });
  await call(config.token, "setWebhook", {
    url: `${config.publicApiUrl}/api/telegram/webhook`,
    secret_token: config.webhookSecret,
    allowed_updates: ["message"],
    drop_pending_updates: false,
  });
  await db
    .prepare(
      "INSERT INTO settings(key, value) VALUES('telegram_setup', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind(fingerprint)
    .run();
  return true;
}

export async function flushOutbox(
  db,
  config,
  call,
  now = Date.now(),
  { limit = 10, onlyId } = {},
) {
  const startedAt = Date.now();
  const clock = () => now + Date.now() - startedAt;
  for (let i = 0; i < limit; i++) {
    // Claim one job atomically. A lease also recovers work after a terminated invocation.
    const at = clock();
    const job = await db
      .prepare(
        `UPDATE outbox SET locked_until = ?, attempts = attempts + 1 WHERE id = (SELECT id FROM outbox WHERE state = 'pending' AND available_at <= ? AND locked_until <= ? ${onlyId ? "AND id = ?" : ""} ORDER BY created_at LIMIT 1) RETURNING *`,
      )
      .bind(at + 60000, at, at, ...(onlyId ? [onlyId] : []))
      .first();
    if (!job) break;
    try {
      let payload;
      if (job.order_id) {
        if (!config.adminChatId) throw new Error("admin_not_configured");
        const order = await db
          .prepare("SELECT * FROM orders WHERE id = ?")
          .bind(job.order_id)
          .first();
        if (!order) throw new Error("order_not_found");
        payload = {
          chat_id: config.adminChatId,
          text: notificationText(order),
        };
      } else payload = JSON.parse(job.payload);
      for (let offset = 0; offset < payload.text.length; offset += 3900) {
        await call(config.token, "sendMessage", {
          ...payload,
          text: payload.text.slice(offset, offset + 3900),
        });
      }
      const statements = [
        db
          .prepare(
            "UPDATE outbox SET state = 'done', payload = '{}', locked_until = 0 WHERE id = ?",
          )
          .bind(job.id),
      ];
      if (job.order_id)
        statements.push(
          db
            .prepare(
              "UPDATE orders SET notification_status = 'sent' WHERE id = ?",
            )
            .bind(job.order_id),
        );
      await db.batch(statements);
    } catch {
      await db
        .prepare(
          "UPDATE outbox SET locked_until = 0, available_at = ? WHERE id = ?",
        )
        .bind(
          clock() +
            Math.min(3600000, 10000 * 2 ** Math.min(job.attempts - 1, 9)),
          job.id,
        )
        .run();
    }
  }
}
