import type { EstimateInput, Estimate, PublicConfig, Order } from "./types";

const base = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body) headers.set("Content-Type", "application/json");
  const initData = window.Telegram?.WebApp?.initData;
  if (initData && !headers.has("Authorization"))
    headers.set("Authorization", `tma ${initData}`);
  let response: Response;
  try {
    response = await fetch(`${base}/api${path}`, {
      ...options,
      headers,
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new ApiError(
      "Сервер недоступен. Заявка не отправлена. Попробуйте позже или напишите в Telegram.",
      0,
    );
  }
  const data = await response.json().catch(() => null);
  if (!response.ok)
    throw new ApiError(
      data?.error || "Не удалось выполнить запрос. Попробуйте ещё раз.",
      response.status,
    );
  if (!data)
    throw new ApiError(
      "API не подключено. Заявка не отправлена. Свяжитесь с мастером в Telegram.",
      0,
    );
  return data;
}
export const api = {
  config: () => request<PublicConfig>("/config"),
  myOrders: () => request<{ orders: Order[] }>("/my/orders"),
  estimate: (input: EstimateInput) =>
    request<Estimate>("/estimate", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  createOrder: (
    input: EstimateInput & {
      name: string;
      contact: string;
      description: string;
      comment: string;
      consent: boolean;
      website: string;
    },
    key: string,
  ) =>
    request<{ order: Order; accessToken: string; message: string }>("/orders", {
      method: "POST",
      body: JSON.stringify(input),
      headers: { "Idempotency-Key": key },
    }),
  order: (id: string, token?: string) =>
    request<{ order: Order }>(
      `/orders/${encodeURIComponent(id)}`,
      token ? { headers: { Authorization: `Bearer ${token}` } } : {},
    ),
};
