import { z } from "zod";
import services from "./services.json" with { type: "json" };

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
