import { createHmac, timingSafeEqual, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { z } from "zod";

export const services = JSON.parse(
  readFileSync(new URL("../shared/services.json", import.meta.url), "utf8"),
);
export const rates = JSON.parse(
  readFileSync(new URL("../shared/rates.json", import.meta.url), "utf8"),
);
const serviceIds = services.map((s) => s.id);
export const estimateSchema = z
  .object({
    serviceId: z.enum(serviceIds),
    metal: z.enum(["steel", "stainless", "aluminum"]),
    width: z.number().min(0.01).max(100),
    height: z.number().min(0.01).max(100),
    quantity: z.number().int().min(1).max(100),
    onsite: z.boolean(),
  })
  .strict();
export const orderSchema = estimateSchema
  .extend({
    name: z.string().trim().min(2).max(80),
    contact: z
      .string()
      .trim()
      .min(5)
      .max(160)
      .refine(
        (v) =>
          /^(?:\+?[\d\s()\-]{7,30}|@[a-zA-Z0-9_]{5,32}|[^\s@]+@[^\s@]+\.[^\s@]+)$/.test(
            v,
          ),
        "Укажите телефон, email или Telegram @username",
      ),
    description: z.string().trim().min(10).max(3000),
    comment: z.string().trim().max(1000).default(""),
    consent: z.literal(true),
    website: z.literal("").default(""),
  })
  .strict();

export function estimatePrice(input, table = rates) {
  const unitRate = table.servicePerSquareMeter[input.serviceId];
  const factor = table.metalMultipliers[input.metal];
  if (
    !table.configured ||
    !Number.isFinite(unitRate) ||
    unitRate <= 0 ||
    !Number.isFinite(factor) ||
    factor <= 0 ||
    (input.onsite && (!Number.isFinite(table.visitFee) || table.visitFee < 0))
  ) {
    return {
      amount: null,
      currency: "RUB",
      message: "Стоимость рассчитывается индивидуально",
    };
  }
  const amount = Math.max(
    table.minimumOrder ?? 0,
    input.width * input.height * input.quantity * unitRate * factor +
      (input.onsite ? table.visitFee : 0),
  );
  return {
    amount: Math.round(amount),
    currency: "RUB",
    message:
      "Предварительная оценка. Окончательную стоимость мастер согласует после уточнения задачи.",
  };
}
export function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}
export function safeEqual(a, b) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
export function verifyTelegramInitData(
  raw,
  token,
  now = Math.floor(Date.now() / 1000),
) {
  if (!token || typeof raw !== "string" || raw.length > 8192) return null;
  const params = new URLSearchParams(raw);
  const keys = [...params.keys()];
  if (new Set(keys).size !== keys.length) return null;
  const hash = params.get("hash");
  if (!hash || !/^[a-f0-9]{64}$/.test(hash)) return null;
  params.delete("hash");
  const authDate = Number(params.get("auth_date"));
  if (
    !Number.isInteger(authDate) ||
    authDate > now + 30 ||
    now - authDate > 3600
  )
    return null;
  const data = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  const expected = createHmac("sha256", secret).update(data).digest("hex");
  if (!safeEqual(expected, hash)) return null;
  try {
    const user = JSON.parse(params.get("user") || "{}");
    if (!Number.isSafeInteger(user.id) || user.id <= 0) return null;
    return { id: String(user.id) };
  } catch {
    return null;
  }
}
