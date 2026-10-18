import { readFileSync } from "node:fs";
import { parse } from "jsonc-parser";

export function readWorkerConfig(filename = "wrangler.jsonc") {
  const errors = [];
  const config = parse(readFileSync(filename, "utf8"), errors, {
    allowTrailingComma: true,
  });
  if (errors.length || !config || typeof config !== "object")
    throw new Error(
      "Некорректный Wrangler JSONC. Исправьте конфигурацию перед публикацией.",
    );
  return config;
}
