import services from "../shared/services.json" with { type: "json" };
import rates from "../shared/rates.json" with { type: "json" };
import site from "../shared/site.json" with { type: "json" };
import { estimateSchema, orderSchema } from "../shared/validation.mjs";
import { calculateEstimate } from "../shared/estimate.mjs";
import { telegramCall, commandReply } from "../server/telegram.mjs";
import { digest, safeEqual, verifyInitData } from "./auth.mjs";
import {
  telegramConfig,
  registered,
  configureTelegram,
  flushOutbox,
} from "./telegram.mjs";

class HttpError extends Error {
  constructor(status, message, retryAfter) {
    super(message);
    this.status = status;
    this.retryAfter = retryAfter;
  }
}
function publicOrder(row) {
  const data = JSON.parse(row.payload);
  return {
    id: row.id,
    serviceId: data.serviceId,
    description: data.description,
    status: row.status,
    createdAt: row.created_at,
    notificationStatus: row.notification_status,
  };
}
async function readJson(request) {
  if (
    !/^application\/json(?:;|$)/i.test(
      request.headers.get("Content-Type") || "",
    )
  )
    throw new HttpError(415, "Используйте Content-Type: application/json.");
  if (Number(request.headers.get("Content-Length")) > 32768)
    throw new HttpError(413, "Слишком большой запрос.");
  if (!request.body) throw new HttpError(400, "Нужен JSON запроса.");
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 32768) {
      await reader.cancel();
      throw new HttpError(413, "Слишком большой запрос.");
    }
    chunks.push(value);
  }
  const buffer = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(buffer));
  } catch {
    throw new HttpError(400, "Некорректный JSON.");
  }
}
async function throttle(db, request, route, limit, seconds) {
  const now = Date.now();
  const start = Math.floor(now / (seconds * 1000)) * seconds * 1000;
  const ipHash = await digest(
    request.headers.get("CF-Connecting-IP") || "local",
  );
  const bucket = `${route}:${start}:${ipHash}`;
  const result = await db
    .prepare(
      "INSERT INTO rate_limits(bucket, hits, expires_at) VALUES(?, 1, ?) ON CONFLICT(bucket) DO UPDATE SET hits = hits + 1 WHERE hits < ? RETURNING hits",
    )
    .bind(bucket, start + seconds * 1000, limit)
    .first();
  if (!result)
    throw new HttpError(
      429,
      "Слишком много запросов. Попробуйте позже.",
      Math.max(1, Math.ceil((start + seconds * 1000 - now) / 1000)),
    );
}
async function telegramOwner(request, config, required = false) {
  const header = request.headers.get("Authorization") || "";
  if (!header && !required) return null;
  const owner = header.startsWith("tma ")
    ? await verifyInitData(header.slice(4), config.token)
    : null;
  if (!owner)
    throw new HttpError(
      401,
      "Сессия Telegram недействительна или истекла. Откройте Mini App заново.",
    );
  return owner;
}

async function enqueueUpdate(db, update, config) {
  if (!Number.isSafeInteger(update?.update_id) || update.update_id < 0)
    throw new HttpError(400, "Некорректное обновление.");
  const key = crypto.randomUUID();
  const now = Date.now();
  let reply = commandReply(update, config);
  let statusChange;
  const message = update.message;
  const isAdmin =
    message?.chat?.type === "private" &&
    String(message.chat.id) === config.adminChatId &&
    String(message.from?.id) === config.adminChatId;
  if (isAdmin && /^\/status(?:@\w+)?(?:\s|$)/i.test(message.text || "")) {
    const [, id, status] = message.text.trim().split(/\s+/);
    const valid =
      /^[a-f0-9-]{36}$/.test(id || "") &&
      [
        "new",
        "reviewing",
        "agreed",
        "in_progress",
        "completed",
        "cancelled",
      ].includes(status);
    const order = valid
      ? await db.prepare("SELECT id FROM orders WHERE id = ?").bind(id).first()
      : null;
    if (order) statusChange = { id, status };
    reply = {
      chat_id: message.chat.id,
      text: !valid
        ? "Формат: /status <полный UUID> <new|reviewing|agreed|in_progress|completed|cancelled>"
        : order
          ? `Статус заявки ${id}: ${status}`
          : "Заявка не найдена.",
    };
  }
  const statements = [
    db
      .prepare(
        "INSERT OR IGNORE INTO telegram_updates(update_id, processing_key, created_at) VALUES(?, ?, ?)",
      )
      .bind(update.update_id, key, now),
  ];
  // All effects are gated by the newly inserted key and committed in the same D1 transaction.
  if (statusChange)
    statements.push(
      db
        .prepare(
          "UPDATE orders SET status = ? WHERE id = ? AND EXISTS(SELECT 1 FROM telegram_updates WHERE update_id = ? AND processing_key = ?)",
        )
        .bind(statusChange.status, statusChange.id, update.update_id, key),
    );
  if (reply)
    statements.push(
      db
        .prepare(
          "INSERT OR IGNORE INTO outbox(id, payload, created_at) SELECT ?, ?, ? WHERE EXISTS(SELECT 1 FROM telegram_updates WHERE update_id = ? AND processing_key = ?)",
        )
        .bind(
          `update:${update.update_id}`,
          JSON.stringify(reply),
          now,
          update.update_id,
          key,
        ),
    );
  await db.batch(statements);
  return reply ? `update:${update.update_id}` : null;
}

export function createWorker({ callTelegram = telegramCall } = {}) {
  return {
    async fetch(request, env, context) {
      const origin = request.headers.get("Origin");
      const allowed = (
        env.ALLOWED_ORIGINS || "https://trofimmokrov-netizen.github.io"
      )
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
      const headers = {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        Vary: "Origin",
      };
      if (origin && allowed.includes(origin))
        headers["Access-Control-Allow-Origin"] = origin;
      function respond(data, status = 200, retryAfter) {
        const extra =
          status === 429 ? { "Retry-After": String(retryAfter || 60) } : {};
        return new Response(
          request.method === "HEAD" ? null : JSON.stringify(data),
          { status, headers: { ...headers, ...extra } },
        );
      }
      try {
        if (origin && !allowed.includes(origin))
          throw new HttpError(403, "Источник запроса не разрешён.");
        if (request.method === "OPTIONS")
          return new Response(null, {
            status: 204,
            headers: {
              ...headers,
              "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
              "Access-Control-Allow-Headers":
                "Content-Type, Authorization, Idempotency-Key",
              "Access-Control-Max-Age": "600",
            },
          });
        const path = new URL(request.url).pathname;
        const config = telegramConfig(env);
        const db = env.DB;
        if (!db) throw new HttpError(503, "Хранилище API ещё не подключено.");
        function deliverSoon(jobId) {
          if (!jobId || !context?.waitUntil) return;
          context.waitUntil(
            (async () => {
              if (await registered(db, config))
                await flushOutbox(db, config, callTelegram, Date.now(), {
                  limit: 1,
                  onlyId: jobId,
                });
            })().catch(() => {}),
          ); // Durable queue and Cron remain the fallback.
        }
        if (
          (request.method === "GET" || request.method === "HEAD") &&
          path === "/api/health"
        ) {
          try {
            await db.prepare("SELECT id FROM orders LIMIT 1").first();
          } catch {
            throw new HttpError(503, "Хранилище API ещё не подготовлено.");
          }
          const ready = await registered(db, config);
          return respond({
            status: "ok",
            storage: "cloudflare-d1",
            telegramRegistered: ready,
            telegramAuthReady: Boolean(config.token),
            notificationsReady: Boolean(ready && config.adminChatId),
            tariffsConfigured: rates.configured,
          });
        }
        if (request.method === "GET" && path === "/api/config")
          return respond({
            phone: config.phone,
            email: config.email,
            botUsername: site.botUsername,
            telegramAuthReady: Boolean(config.token),
            notificationsReady: Boolean(
              config.adminChatId && (await registered(db, config)),
            ),
          });
        if (request.method === "GET" && path === "/api/services")
          return respond({ services });
        if (request.method === "POST" && path === "/api/estimate") {
          await throttle(db, request, "estimate", 60, 60);
          const parsed = estimateSchema.safeParse(await readJson(request));
          if (!parsed.success)
            throw new HttpError(
              400,
              "Проверьте услугу, материал, размеры и количество.",
            );
          return respond(calculateEstimate(parsed.data, rates));
        }
        if (request.method === "POST" && path === "/api/orders") {
          const owner = await telegramOwner(request, config);
          const parsed = orderSchema.safeParse(await readJson(request));
          if (!parsed.success)
            throw new HttpError(
              400,
              "Проверьте поля заявки: имя, контакт, описание, размеры и согласие.",
            );
          const key = request.headers.get("Idempotency-Key");
          if (!/^[a-f0-9-]{36}$/.test(key || ""))
            throw new HttpError(400, "Нужен корректный Idempotency-Key.");
          const bodyHash = await digest(
            JSON.stringify({ data: parsed.data, owner: owner?.id || null }),
          );
          const idempotencyHash = await digest(key);
          const existing = await db
            .prepare("SELECT * FROM orders WHERE idempotency_hash = ?")
            .bind(idempotencyHash)
            .first();
          const accessToken = await digest(`aik-order:${key}`);
          if (existing) {
            if (!safeEqual(existing.body_hash, bodyHash))
              throw new HttpError(
                409,
                "Эта попытка отправки уже использована с другими данными.",
              );
            deliverSoon(`order:${existing.id}`);
            return respond({
              order: publicOrder(existing),
              accessToken,
              message: "Заявка уже сохранена. Дубликат не создан.",
            });
          }
          await throttle(db, request, "orders", 8, 900);
          const id = crypto.randomUUID();
          const created = new Date().toISOString();
          await db.batch([
            db
              .prepare(
                "INSERT OR IGNORE INTO orders(id, owner_telegram_id, access_hash, payload, created_at, idempotency_hash, body_hash) VALUES(?, ?, ?, ?, ?, ?, ?)",
              )
              .bind(
                id,
                owner?.id || null,
                await digest(accessToken),
                JSON.stringify(parsed.data),
                created,
                idempotencyHash,
                bodyHash,
              ),
            db
              .prepare(
                "INSERT OR IGNORE INTO outbox(id, order_id, payload, created_at) SELECT ?, id, '{}', ? FROM orders WHERE id = ?",
              )
              .bind(`order:${id}`, Date.now(), id),
          ]);
          const row = await db
            .prepare("SELECT * FROM orders WHERE idempotency_hash = ?")
            .bind(idempotencyHash)
            .first();
          if (!row || !safeEqual(row.body_hash, bodyHash))
            throw new HttpError(
              409,
              "Параметры повторного запроса не совпадают.",
            );
          deliverSoon(`order:${row.id}`);
          return respond(
            {
              order: publicOrder(row),
              accessToken,
              message:
                "Заявка сохранена. Уведомление мастеру поставлено в очередь.",
            },
            row.id === id ? 201 : 200,
          );
        }
        if (request.method === "GET" && path === "/api/my/orders") {
          await throttle(db, request, "my-orders", 60, 60);
          const owner = await telegramOwner(request, config, true);
          const result = await db
            .prepare(
              "SELECT * FROM orders WHERE owner_telegram_id = ? ORDER BY created_at DESC LIMIT 50",
            )
            .bind(owner.id)
            .all();
          return respond({ orders: result.results.map(publicOrder) });
        }
        if (
          request.method === "GET" &&
          /^\/api\/orders\/[a-f0-9-]{36}$/.test(path)
        ) {
          await throttle(db, request, "order-read", 80, 60);
          const row = await db
            .prepare("SELECT * FROM orders WHERE id = ?")
            .bind(path.split("/").pop())
            .first();
          const auth = request.headers.get("Authorization") || "";
          let allowed = false;
          if (auth.startsWith("Bearer ") && row)
            allowed = safeEqual(row.access_hash, await digest(auth.slice(7)));
          if (auth.startsWith("tma ")) {
            const owner = await verifyInitData(auth.slice(4), config.token);
            allowed = Boolean(
              owner && row && row.owner_telegram_id === owner.id,
            );
          }
          if (!allowed)
            throw new HttpError(
              404,
              "Заявка не найдена или у вас нет доступа.",
            );
          return respond({ order: publicOrder(row) });
        }
        if (request.method === "POST" && path === "/api/telegram/webhook") {
          if (!config.token || !config.webhookSecret)
            throw new HttpError(503, "Telegram webhook ещё не настроен.");
          if (
            !safeEqual(
              request.headers.get("X-Telegram-Bot-Api-Secret-Token") || "",
              config.webhookSecret,
            )
          )
            throw new HttpError(403, "Доступ запрещён.");
          const jobId = await enqueueUpdate(
            db,
            await readJson(request),
            config,
          );
          deliverSoon(jobId);
          return respond({ ok: true });
        }
        throw new HttpError(404, "Метод API не найден.");
      } catch (error) {
        return respond(
          {
            error:
              error instanceof HttpError
                ? error.message
                : "Ошибка API. Попробуйте позже.",
          },
          error instanceof HttpError ? error.status : 500,
          error.retryAfter,
        );
      }
    },
    async scheduled(_event, env) {
      if (!env.DB) return;
      const config = telegramConfig(env);
      try {
        if (await configureTelegram(env.DB, config, callTelegram))
          await flushOutbox(env.DB, config, callTelegram);
      } catch {
        // Keep all queued work durable; never log tokens, URLs or customer details.
        await env.DB.prepare(
          "INSERT INTO settings(key, value) VALUES('telegram_setup_error', 'configuration_or_network_error') ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        ).run();
      }
      const now = Date.now();
      await env.DB.batch([
        env.DB.prepare("DELETE FROM rate_limits WHERE expires_at < ?").bind(
          now,
        ),
        env.DB.prepare(
          "DELETE FROM telegram_updates WHERE created_at < ?",
        ).bind(now - 7 * 86400000),
        env.DB.prepare(
          "DELETE FROM outbox WHERE state = 'done' AND created_at < ?",
        ).bind(now - 7 * 86400000),
      ]);
    },
  };
}
export default createWorker();
