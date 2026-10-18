import services from "../shared/services.json" with { type: "json" };
import type { EstimateInput } from "./types";

export type DraftInput = EstimateInput & {
  name: string;
  contact: string;
  description: string;
  comment: string;
};
export function formatDraft(input: DraftInput) {
  const metals: Record<string, string> = {
    steel: "Сталь",
    stainless: "Нержавеющая сталь",
    aluminum: "Алюминий",
  };
  const metal = metals[input.metal];
  return [
    "AIK BASE — заявка на обсуждение",
    `Услуга: ${services.find((service) => service.id === input.serviceId)?.title || input.serviceId}`,
    `Имя: ${input.name}`,
    `Контакт: ${input.contact}`,
    `Металл: ${metal || input.metal}`,
    `Размеры: ${input.width} × ${input.height} м`,
    `Количество: ${input.quantity}`,
    `Выезд: ${input.onsite ? "Нужен" : "Не нужен"}`,
    `Задача: ${input.description}`,
    ...(input.comment ? [`Пожелания: ${input.comment}`] : []),
    "Стоимость и сроки прошу согласовать отдельно.",
  ].join("\n\n");
}
export function downloadText(text: string) {
  const href = URL.createObjectURL(
    new Blob([text], { type: "text/plain;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = href;
  link.download = "aik-base-zayavka.txt";
  link.click();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}
