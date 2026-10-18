const encoder = new TextEncoder();

export async function digest(value) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", encoder.encode(value)),
    ),
  ]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
export function safeEqual(left, right) {
  if (
    typeof left !== "string" ||
    typeof right !== "string" ||
    left.length !== right.length
  )
    return false;
  let difference = 0;
  for (let i = 0; i < left.length; i++)
    difference |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return difference === 0;
}
export async function verifyInitData(
  raw,
  token,
  now = Math.floor(Date.now() / 1000),
) {
  if (!token || typeof raw !== "string" || raw.length > 8192) return null;
  const params = new URLSearchParams(raw);
  if (new Set(params.keys()).size !== [...params.keys()].length) return null;
  const hash = params.get("hash");
  if (!hash || !/^[a-f0-9]{64}$/.test(hash)) return null;
  params.delete("hash");
  const date = Number(params.get("auth_date"));
  if (!Number.isInteger(date) || date > now + 30 || now - date > 3600)
    return null;
  const data = [...params]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const rootKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode("WebAppData"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const secret = await crypto.subtle.sign(
    "HMAC",
    rootKey,
    encoder.encode(token),
  );
  const signingKey = await crypto.subtle.importKey(
    "raw",
    secret,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const signature = new Uint8Array(
    hash.match(/../g).map((byte) => parseInt(byte, 16)),
  );
  if (
    !(await crypto.subtle.verify(
      "HMAC",
      signingKey,
      signature,
      encoder.encode(data),
    ))
  )
    return null;
  try {
    const user = JSON.parse(params.get("user") || "{}");
    return Number.isSafeInteger(user.id) && user.id > 0
      ? { id: String(user.id) }
      : null;
  } catch {
    return null;
  }
}
