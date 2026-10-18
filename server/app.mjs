import express from "express";
import cors from "cors";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  services,
  rates,
  estimateSchema,
  orderSchema,
  estimatePrice,
  verifyTelegramInitData,
  digest,
  safeEqual,
} from "./domain.mjs";
import { publicOrder } from "./database.mjs";

export function createApp(db, config) {
  const app = express();
  app.disable("x-powered-by");
  if (config.trustProxy) app.set("trust proxy", config.trustProxy);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "https://telegram.org"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:", "https:"],
          connectSrc: ["'self'", ...config.origins],
          frameAncestors: [
            "'self'",
            "https://web.telegram.org",
            "https://*.telegram.org",
          ],
        },
      },
      frameguard: false,
    }),
  );
  app.use(
    cors({
      origin(origin, callback) {
        callback(null, !origin || config.origins.includes(origin));
      },
      allowedHeaders: ["Content-Type", "Authorization", "Idempotency-Key"],
    }),
  );
  app.use("/api", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    const origin = req.get("Origin");
    if (origin && !config.origins.includes(origin))
      return res.status(403).json({ error: "Источник запроса не разрешён." });
    next();
  });
  app.use(express.json({ limit: "32kb", type: "application/json" }));
  const limiter = (limit, windowMs) =>
    rateLimit({
      limit,
      windowMs,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: { error: "Слишком много запросов. Попробуйте позже." },
    });
  app.use("/api/orders", limiter(80, 60000));
  app.use("/api/estimate", limiter(60, 60000));
  app.get("/api/health", (_req, res) => {
    db.prepare("SELECT 1").get();
    res.json({
      status: "ok",
      storage: "sqlite",
      notificationsReady: Boolean(config.token && config.adminChatId),
      telegramAuthReady: Boolean(config.token),
      tariffsConfigured: rates.configured,
    });
  });
  app.get("/api/config", (_req, res) =>
    res.json({
      notificationsReady: Boolean(config.token && config.adminChatId),
      telegramAuthReady: Boolean(config.token),
      phone: config.phone,
      email: config.email,
      botUsername: "AikBaseOrder_Bot",
    }),
  );
  app.get("/api/services", (_req, res) => res.json({ services }));
  app.get("/api/my/orders", limiter(30, 60000), (req, res) => {
    const auth = req.get("Authorization") || "";
    const owner = auth.startsWith("tma ")
      ? verifyTelegramInitData(auth.slice(4), config.token)
      : null;
    if (!owner)
      return res
        .status(401)
        .json({
          error: "Откройте Mini App в Telegram для просмотра ваших заявок.",
        });
    const rows = db
      .prepare(
        "SELECT * FROM orders WHERE owner_telegram_id = ? ORDER BY created_at DESC LIMIT 50",
      )
      .all(owner.id);
    res.json({ orders: rows.map(publicOrder) });
  });
  app.post("/api/estimate", (req, res) => {
    const parsed = estimateSchema.safeParse(req.body);
    if (!parsed.success)
      return res
        .status(400)
        .json({
          error:
            "Проверьте услугу, материал и размеры: от 0,01 до 100 м, количество — от 1 до 100.",
        });
    res.json(estimatePrice(parsed.data));
  });
  app.post("/api/orders", limiter(8, 15 * 60000), (req, res) => {
    const parsed = orderSchema.safeParse(req.body);
    if (!parsed.success)
      return res
        .status(400)
        .json({
          error:
            "Проверьте поля заявки. Нужны имя, контакт, описание от 10 символов и согласие на обработку данных.",
          fields: [
            ...new Set(parsed.error.issues.map((x) => String(x.path[0]))),
          ],
        });
    const auth = req.get("Authorization") || "";
    let owner = null;
    if (auth) {
      if (!auth.startsWith("tma "))
        return res
          .status(401)
          .json({ error: "Откройте приложение заново для авторизации." });
      owner = verifyTelegramInitData(auth.slice(4), config.token);
      if (!owner)
        return res
          .status(401)
          .json({
            error:
              "Сессия Telegram истекла или недействительна. Откройте Mini App заново.",
          });
    }
    const key = req.get("Idempotency-Key");
    if (!key || !/^[a-f0-9-]{36}$/.test(key))
      return res
        .status(400)
        .json({ error: "Для заявки необходим корректный Idempotency-Key." });
    const bodyHash = digest(
      JSON.stringify({ data: parsed.data, owner: owner?.id || null }),
    );
    const idempotencyHash = digest(key);
    const existing = db
      .prepare("SELECT * FROM orders WHERE idempotency_hash = ?")
      .get(idempotencyHash);
    if (existing) {
      if (existing.body_hash !== bodyHash)
        return res
          .status(409)
          .json({
            error: "Эта попытка отправки уже использована. Обновите форму.",
          });
      // The unguessable request key also allows recovery after a lost response, without storing plaintext access tokens.
      const recoveryToken = digest(`aik-order:${key}`);
      return res.json({
        order: publicOrder(existing),
        accessToken: recoveryToken,
        message: "Заявка уже сохранена. Повторная заявка не создана.",
      });
    }
    const id = randomUUID();
    const accessToken = digest(`aik-order:${key}`);
    db.prepare(
      "INSERT INTO orders (id, owner_telegram_id, access_hash, payload, created_at, idempotency_hash, body_hash) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(
      id,
      owner?.id || null,
      digest(accessToken),
      JSON.stringify(parsed.data),
      new Date().toISOString(),
      idempotencyHash,
      bodyHash,
    );
    const row = db.prepare("SELECT * FROM orders WHERE id = ?").get(id);
    res
      .status(201)
      .json({
        order: publicOrder(row),
        accessToken,
        message:
          config.token && config.adminChatId
            ? "Заявка сохранена. Уведомление мастеру поставлено в очередь."
            : "Заявка сохранена на сервере. Уведомления мастеру ещё не подключены; свяжитесь с ним в Telegram.",
      });
  });
  app.get("/api/orders/:id", (req, res) => {
    const auth = req.get("Authorization") || "";
    const row = db
      .prepare("SELECT * FROM orders WHERE id = ?")
      .get(req.params.id);
    let allowed = false;
    if (auth.startsWith("Bearer ") && row)
      allowed = safeEqual(row.access_hash, digest(auth.slice(7)));
    if (auth.startsWith("tma ")) {
      const owner = verifyTelegramInitData(auth.slice(4), config.token);
      allowed = Boolean(owner && row && row.owner_telegram_id === owner.id);
    }
    if (!allowed)
      return res
        .status(404)
        .json({ error: "Заявка не найдена или у вас нет доступа." });
    res.json({ order: publicOrder(row) });
  });
  app.post("/api/telegram/webhook", (req, res) => {
    if (!config.token || !config.webhookSecret)
      return res.status(503).json({ error: "Telegram webhook не настроен." });
    if (
      !safeEqual(
        req.get("X-Telegram-Bot-Api-Secret-Token") || "",
        config.webhookSecret,
      )
    )
      return res.status(403).json({ error: "Доступ запрещён." });
    const update = req.body;
    if (!Number.isSafeInteger(update?.update_id) || update.update_id < 0)
      return res.status(400).json({ error: "Некорректное обновление." });
    db.prepare(
      "INSERT OR IGNORE INTO telegram_updates (update_id, payload, created_at) VALUES (?, ?, ?)",
    ).run(update.update_id, JSON.stringify(update), Date.now());
    res.json({ ok: true });
  });
  app.use("/api", (_req, res) =>
    res.status(404).json({ error: "Метод API не найден." }),
  );
  const dist = fileURLToPath(new URL("../dist", import.meta.url));
  if (existsSync(dist)) {
    app.use("/aik-base", express.static(dist, { index: "index.html" }));
    app.get("/", (_req, res) => res.redirect("/aik-base/"));
  }
  app.use((err, _req, res, _next) => {
    if (err.type === "entity.too.large")
      return res.status(413).json({ error: "Слишком большой запрос." });
    if (err instanceof SyntaxError && "body" in err)
      return res.status(400).json({ error: "Некорректный JSON." });
    // Do not log request bodies, credentials, contacts or Telegram URLs.
    console.error("API operation failed:", err.code || "internal_error");
    res
      .status(500)
      .json({ error: "Внутренняя ошибка сервера. Попробуйте позже." });
  });
  return app;
}
