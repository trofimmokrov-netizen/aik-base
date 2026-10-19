export const projectKinds = {
  canopy: "Навес",
  stairs: "Лестница",
  fence: "Ограждение",
  frame: "Каркас",
  gate: "Ворота",
};
export type WeldingProject = {
  v: 1;
  name: string;
  kind: keyof typeof projectKinds;
  width: number;
  depth: number;
  height: number;
  profile: number;
  sections: number;
  roof: "flat" | "gable";
  infill: "vertical" | "horizontal";
  color: string;
  finish: "Матовая окраска" | "Грунт под покраску" | "Обсудить покрытие";
};
export const defaultProject: WeldingProject = {
  v: 1,
  name: "Мой проект AIK BASE",
  kind: "canopy",
  width: 4,
  depth: 3,
  height: 2.5,
  profile: 60,
  sections: 4,
  roof: "gable",
  infill: "vertical",
  color: "#ff6b2d",
  finish: "Матовая окраска",
};
export function normalizeProject(raw: unknown): WeldingProject {
  if (!raw || typeof raw !== "object") throw Error("Неверный формат проекта");
  const p = raw as Record<string, unknown>;
  const out = { ...defaultProject };
  if (p.v !== 1) throw Error("Версия проекта не поддерживается");
  if (typeof p.name === "string")
    out.name = p.name.trim().slice(0, 70) || defaultProject.name;
  if (typeof p.kind === "string" && Object.hasOwn(projectKinds, p.kind))
    out.kind = p.kind as WeldingProject["kind"];
  for (const [key, min, max] of [
    ["width", 0.5, 12],
    ["depth", 0.3, 10],
    ["height", 0.4, 6],
    ["profile", 20, 150],
    ["sections", 2, 12],
  ] as const) {
    const value = Number(p[key]);
    if (!Number.isFinite(value) || value < min || value > max)
      throw Error("Проверьте размеры проекта");
    out[key] = key === "sections" ? Math.round(value) : value;
  }
  if (p.roof === "flat") out.roof = "flat";
  if (p.infill === "horizontal") out.infill = "horizontal";
  if (typeof p.color === "string" && /^#[\da-f]{6}$/i.test(p.color))
    out.color = p.color;
  if (
    ["Матовая окраска", "Грунт под покраску", "Обсудить покрытие"].includes(
      String(p.finish),
    )
  )
    out.finish = p.finish as WeldingProject["finish"];
  return out;
}
// UTF-8 handles Russian names; fragment stays out of ordinary server request logs.
export function encodeProject(p: WeldingProject) {
  const bytes = new TextEncoder().encode(JSON.stringify(normalizeProject(p)));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
export function decodeProject(raw: string) {
  if (raw.length > 4000) throw Error("Слишком длинная ссылка");
  return normalizeProject(
    JSON.parse(
      new TextDecoder().decode(
        Uint8Array.from(atob(raw.replace(/-/g, "+").replace(/_/g, "/")), (c) =>
          c.charCodeAt(0),
        ),
      ),
    ),
  );
}
export function projectLink(p: WeldingProject) {
  const url = new URL(location.href);
  url.hash = "studio=" + encodeProject(p);
  return url.href;
}
export function projectBrief(p: WeldingProject) {
  return [
    "AIK BASE · " + p.name,
    projectKinds[p.kind] +
      " · " +
      p.width +
      " × " +
      p.depth +
      " × " +
      p.height +
      " м",
    "Профиль в концепции: " +
      p.profile +
      " мм; секций / ступеней: " +
      p.sections,
    p.kind === "canopy"
      ? "Крыша: " + (p.roof === "gable" ? "двускатная" : "плоская")
      : null,
    ["fence", "gate"].includes(p.kind)
      ? "Заполнение: " +
        (p.infill === "vertical" ? "вертикальное" : "горизонтальное")
      : null,
    "Цвет: " + p.color + "; " + p.finish,
    "Размеры, профиль и количество элементов — пожелания. Требуются расчёт нагрузок, проверка мастера и согласование стоимости.",
  ]
    .filter(Boolean)
    .join("\n");
}
