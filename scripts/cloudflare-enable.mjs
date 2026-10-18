import { readFileSync, writeFileSync } from "node:fs";

try {
  const url = new URL(process.argv[2]);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error(
      "Укажите корневой HTTPS-адрес API, например https://имя.workers.dev",
    );
  let response;
  try {
    response = await fetch(`${url.origin}/api/health`, {
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new Error("API недоступно по HTTPS. Сайт не изменён.");
  }
  const health = await response.json().catch(() => null);
  if (
    !response.ok ||
    health?.status !== "ok" ||
    health.storage !== "cloudflare-d1"
  )
    throw new Error("Хранилище API не готово. Сайт не изменён.");
  if (!health.telegramRegistered || !health.notificationsReady)
    throw new Error(
      "API работает, но бот или уведомления не настроены. Задайте Worker Secrets, PUBLIC_API_URL и TELEGRAM_ADMIN_CHAT_ID; дождитесь Cron. Сайт не изменён.",
    );
  const site = JSON.parse(readFileSync("shared/site.json", "utf8"));
  const workflow = readFileSync(".github/workflows/pages.yml", "utf8");
  if (
    !workflow.includes("VITE_APP_MODE: static") &&
    !workflow.includes("VITE_APP_MODE: server")
  )
    throw new Error(
      "Не найден известный переключатель режима Pages. Сайт не изменён.",
    );
  site.apiUrl = url.origin;
  writeFileSync("shared/site.json", JSON.stringify(site, null, 2) + "\n");
  const connectedWorkflow = workflow
    .replace("VITE_APP_MODE: static", "VITE_APP_MODE: server")
    .replace(/^[ \t]*VITE_API_URL: \$\{\{ vars\.VITE_API_URL \}\}\r?\n/m, "");
  writeFileSync(".github/workflows/pages.yml", connectedWorkflow);
  console.log(
    "API и регистрация Telegram проверены. Адрес записан в shared/site.json, сборка Pages переключена на API. Изменения готовы к проверке, коммиту и публикации; они ещё не отправлены в GitHub.",
  );
} catch (error) {
  console.error(
    error instanceof TypeError
      ? "Использование: npm run cf:enable -- https://имя.workers.dev"
      : error.message,
  );
  process.exitCode = 1;
}
