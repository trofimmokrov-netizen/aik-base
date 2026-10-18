import path from "node:path";

export function loadConfig(env = process.env) {
  const production = env.NODE_ENV === "production";
  const token = env.TELEGRAM_BOT_TOKEN || "";
  const webhookSecret = env.TELEGRAM_WEBHOOK_SECRET || "";
  const adminChatId = env.TELEGRAM_ADMIN_CHAT_ID || "";
  if (webhookSecret && !/^[A-Za-z0-9_-]{32,256}$/.test(webhookSecret))
    throw new Error(
      "TELEGRAM_WEBHOOK_SECRET must contain 32–256 characters: A-Z, a-z, 0-9, _ or -",
    );
  const port = Number(env.PORT || 3001);
  const origins = (
    env.ALLOWED_ORIGINS ||
    `http://localhost:5173,http://127.0.0.1:5173,http://localhost:${port},http://127.0.0.1:${port}`
  )
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  if (origins.includes("*"))
    throw new Error("Configure explicit ALLOWED_ORIGINS instead of *");
  const miniAppUrl =
    env.MINI_APP_URL || "https://trofimmokrov-netizen.github.io/aik-base/";
  if (!miniAppUrl.startsWith("https://"))
    throw new Error("MINI_APP_URL requires HTTPS");
  const trustProxy = Number(env.TRUST_PROXY_HOPS || 0);
  if (!Number.isInteger(trustProxy) || trustProxy < 0 || trustProxy > 3)
    throw new Error("Invalid TRUST_PROXY_HOPS");
  return {
    port,
    host: env.HOST || "0.0.0.0",
    production,
    databasePath:
      env.DATABASE_PATH === ":memory:"
        ? ":memory:"
        : path.resolve(env.DATABASE_PATH || "./data/aik-base.db"),
    origins,
    trustProxy,
    token,
    webhookSecret,
    adminChatId,
    miniAppUrl,
    publicApiUrl: env.PUBLIC_API_URL || "",
    phone: env.CONTACT_PHONE || "",
    email: env.CONTACT_EMAIL || "",
  };
}
