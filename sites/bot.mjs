import { commandReply } from "../server/telegram.mjs";
import site from "../shared/site.json" with { type: "json" };

const maxBodyBytes = 32768;
const miniAppUrl = "https://trofimmokrov-netizen.github.io/aik-base/";
function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...extra },
  });
}

async function secretMatches(actual, expected) {
  if (!actual || actual.length > 256) return false;
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all(
    [actual, expected].map((text) => crypto.subtle.digest("SHA-256", encoder.encode(text))),
  );
  const left = new Uint8Array(a), right = new Uint8Array(b);
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left[i] ^ right[i];
  return difference === 0;
}

async function readUpdate(request) {
  if (!request.body) throw new Error("invalid_body");
  const reader = request.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBodyBytes) {
        await reader.cancel();
        throw new Error("body_too_large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

// Fetch handler for a separate Sites service. No account, token or project ID is bundled.
export default {
  async fetch(request, env = {}) {
    const pathname = new URL(request.url).pathname;
    const secret = env.TELEGRAM_WEBHOOK_SECRET;
    const ready = typeof secret === "string" && /^[A-Za-z0-9_-]{32,256}$/.test(secret);
    if (pathname === "/health") {
      if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405, { Allow: "GET" });
      return json({ ok: true, service: "aik-base-telegram-bot", webhookConfigured: ready, ordersMode: "manual" });
    }
    if (!["/telegram/webhook", "/api/telegram/webhook"].includes(pathname))
      return json({ error: "not_found" }, 404);
    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405, { Allow: "POST" });
    if (!ready) return json({ error: "not_configured" }, 503);
    if (!(await secretMatches(request.headers.get("X-Telegram-Bot-Api-Secret-Token"), secret)))
      return json({ error: "forbidden" }, 403);
    if (request.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() !== "application/json")
      return json({ error: "json_required" }, 415);
    const advertisedSize = Number(request.headers.get("Content-Length"));
    if (advertisedSize > maxBodyBytes) return json({ error: "body_too_large" }, 413);
    let update;
    try { update = await readUpdate(request); }
    catch (error) { return json({ error: "invalid_body" }, error.message === "body_too_large" ? 413 : 400); }
    if (!Number.isSafeInteger(update?.update_id) || update.update_id < 0)
      return json({ error: "invalid_update" }, 400);
    const message = update.message;
    if (!message || message.chat?.type !== "private" ||
        !Number.isSafeInteger(message.chat.id) || message.chat.id <= 0 ||
        message.from?.id !== message.chat.id || message.from?.is_bot ||
        typeof message.text !== "string") return json({ ok: true });
    const reply = commandReply(update, {
      phone: site.phoneDisplay,
      email: site.email,
      miniAppUrl,
      manualOrders: true,
      adminChatId: "",
    });
    // Telegram supports sendMessage in the webhook response. No outbound token is needed.
    // Delivery cannot be confirmed through this mechanism; health does not claim it.
    return json({ method: "sendMessage", ...reply });
  },
};
