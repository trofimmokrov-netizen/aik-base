import { createHmac, timingSafeEqual, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { calculateEstimate } from "../shared/estimate.mjs";

export const services = JSON.parse(
  readFileSync(new URL("../shared/services.json", import.meta.url), "utf8"),
);
export const rates = JSON.parse(
  readFileSync(new URL("../shared/rates.json", import.meta.url), "utf8"),
);
export { estimateSchema, orderSchema } from "../shared/validation.mjs";

export function estimatePrice(input, table = rates) {
  return calculateEstimate(input, table);
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
