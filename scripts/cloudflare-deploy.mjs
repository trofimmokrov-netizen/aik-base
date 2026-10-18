import { writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { readWorkerConfig } from "./cloudflare-config.mjs";

const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;
async function api(route, method = "GET", body) {
  let response;
  try {
    response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${account}${route}`,
      {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(30000),
      },
    );
  } catch {
    throw new Error(
      "Cloudflare API недоступен. Проверьте доступ к api.cloudflare.com через настроенный прокси.",
    );
  }
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.success)
    throw new Error(
      `Cloudflare API отклонил запрос (HTTP ${response.status}). Проверьте аккаунт и разрешения API-токена.`,
    );
  return data.result;
}
async function wrangler(args) {
  await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "--use-system-ca",
        path.resolve("node_modules/wrangler/bin/wrangler.js"),
        ...args,
      ],
      {
        stdio: "inherit",
        env: { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "true" },
      },
    );
    child.on("error", () =>
      reject(new Error("Не удалось запустить Wrangler. Выполните npm ci.")),
    );
    child.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(
            new Error(
              "Wrangler не завершил операцию. Публикация не подтверждена.",
            ),
          ),
    );
  });
}
try {
  if (!account || !/^[a-f0-9]{32}$/i.test(account) || !token)
    throw new Error(
      "Нужны CLOUDFLARE_ACCOUNT_ID и CLOUDFLARE_API_TOKEN в защищённых настройках окружения. Не записывайте токен в команду или исходники.",
    );
  const config = readWorkerConfig();
  const subdomain = await api("/workers/subdomain");
  if (
    !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(subdomain?.subdomain || "")
  )
    throw new Error(
      "Сначала активируйте адрес workers.dev в Cloudflare Workers & Pages своего аккаунта.",
    );
  const name = config.d1_databases[0].database_name;
  const databases = await api(
    `/d1/database?name=${encodeURIComponent(name)}&per_page=100`,
  );
  const matching = databases.filter((db) => db.name === name);
  if (matching.length > 1)
    throw new Error(
      "Найдено несколько одноимённых D1-баз. Уточните выбор перед публикацией.",
    );
  const db = matching[0] || (await api("/d1/database", "POST", { name }));
  if (!/^[a-f0-9-]{36}$/i.test(db?.uuid || ""))
    throw new Error(
      "Cloudflare не вернул корректный идентификатор D1. Публикация остановлена.",
    );
  config.account_id = account;
  config.d1_databases[0].database_id = db.uuid;
  config.keep_vars = true;
  config.vars.PUBLIC_API_URL = `https://${config.name}.${subdomain.subdomain}.workers.dev`;
  // Dashboard values and secrets must survive subsequent deployments.
  if (process.env.TELEGRAM_ADMIN_CHAT_ID)
    config.vars.TELEGRAM_ADMIN_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID;
  else delete config.vars.TELEGRAM_ADMIN_CHAT_ID;
  writeFileSync(
    ".wrangler.deploy.json",
    JSON.stringify(config, null, 2) + "\n",
    { mode: 0o600 },
  );
  await wrangler([
    "d1",
    "migrations",
    "apply",
    "DB",
    "--remote",
    "--config",
    ".wrangler.deploy.json",
  ]);
  await wrangler([
    "deploy",
    "--config",
    ".wrangler.deploy.json",
    "--keep-vars",
  ]);
  console.log(`API опубликовано: ${config.vars.PUBLIC_API_URL}`);
  console.log(
    "Следующий шаг: задайте TELEGRAM_BOT_TOKEN и TELEGRAM_WEBHOOK_SECRET как Cloudflare Worker Secrets. Cron зарегистрирует бота и webhook автоматически. Команда /id покажет ваш ID для TELEGRAM_ADMIN_CHAT_ID. Сайт пока остаётся в статическом режиме.",
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
