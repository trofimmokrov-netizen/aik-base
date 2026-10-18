import { loadConfig } from "../server/config.mjs";
import { telegramCall } from "../server/telegram.mjs";

const config = loadConfig();
try {
  if (
    !config.token ||
    !config.webhookSecret ||
    !config.publicApiUrl.startsWith("https://")
  )
    throw new Error(
      "Configure TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET and HTTPS PUBLIC_API_URL securely before running this script.",
    );
  const identity = await telegramCall(config.token, "getMe", {});
  if (identity.username?.toLowerCase() !== "aikbaseorder_bot")
    throw new Error(
      "The supplied credential belongs to a different bot. No settings changed.",
    );
  await telegramCall(config.token, "setMyCommands", {
    commands: [
      { command: "start", description: "Открыть AIK BASE" },
      { command: "services", description: "Каталог услуг" },
      { command: "order", description: "Оформить заявку" },
      { command: "contact", description: "Контакты" },
      { command: "help", description: "Помощь" },
    ],
  });
  await telegramCall(config.token, "setChatMenuButton", {
    menu_button: {
      type: "web_app",
      text: "AIK BASE",
      web_app: { url: config.miniAppUrl },
    },
  });
  await telegramCall(config.token, "setWebhook", {
    url: `${config.publicApiUrl.replace(/\/$/, "")}/api/telegram/webhook`,
    secret_token: config.webhookSecret,
    allowed_updates: ["message"],
    drop_pending_updates: false,
  });
  console.log("Bot commands, Mini App menu and webhook configured.");
} catch (error) {
  console.error(
    error.message.startsWith("telegram_")
      ? "Telegram request failed. Check network access and the securely configured token; no credentials were logged."
      : error.message,
  );
  process.exitCode = 1;
}
