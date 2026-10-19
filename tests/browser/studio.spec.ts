import { test, expect } from "@playwright/test";
test.use({
  launchOptions: {
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    args: [
      "--no-sandbox",
      "--enable-unsafe-swiftshader",
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  },
});
test("3D geometry, named project save, deduplication and shared link restore", async ({
  page,
  browser,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("./#constructor");
  const studio = page.locator("#constructor");
  await studio.scrollIntoViewIfNeeded();
  await expect(studio.locator("canvas")).toBeVisible();
  for (const kind of ["Навес", "Лестница", "Ограждение", "Каркас", "Ворота"]) {
    await studio.getByRole("button", { name: kind, exact: true }).click();
    await expect(studio.locator("canvas")).toBeVisible();
  }
  await studio.getByRole("button", { name: "Навес", exact: true }).click();
  await studio.getByLabel("Название проекта").fill("Навес для машины");
  await studio.locator("#studio-width").fill("6");
  await studio.getByLabel("Крыша", { exact: true }).selectOption("flat");
  await studio
    .getByRole("button", { name: "Сохранить проект", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Проект сохранён" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Навес для машины");
  await expect(dialog).toContainText("6 × 3 × 2.5");
  await dialog
    .getByRole("button", { name: "Закрыть сохранённый проект" })
    .click();
  await studio
    .getByRole("button", { name: "Сохранить проект", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Закрыть сохранённый проект" })
    .click();
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("aik-welding-projects-v1")!).length,
    ),
  ).toBe(1);
  const link = await studio.getByLabel("Ссылка на 3D-проект").inputValue();
  expect(link).toContain("#studio=");
  const master = studio.getByRole("link", {
    name: "Отправить мастеру в Telegram",
  });
  const url = new URL((await master.getAttribute("href"))!);
  expect(url.pathname).toBe("/+79349999779");
  expect(url.searchParams.get("text")).toContain(link);
  const context = await browser.newContext();
  const recipient = await context.newPage();
  await recipient.goto(link);
  await expect(recipient.getByLabel("Название проекта")).toHaveValue(
    "Навес для машины",
  );
  await expect(recipient.locator("#studio-width")).toHaveValue("6");
  await expect(recipient.getByLabel("Крыша", { exact: true })).toHaveValue(
    "flat",
  );
  await context.close();
  const shot = page.waitForEvent("download");
  await studio.getByRole("button", { name: "Сохранить примерку PNG" }).click();
  expect((await shot).suggestedFilename()).toBe("aik-base-preview.png");
  await studio
    .locator('input[accept="image/jpeg,image/png,image/webp"]')
    .setInputFiles("public/media/arched-canopy.webp");
  await expect(studio.locator(".studio-photo")).toBeVisible();
  await studio.getByRole("button", { name: "Примерить через камеру" }).click();
  await expect(
    studio.getByRole("button", { name: "Выключить камеру" }),
  ).toBeVisible();
  await expect
    .poll(() =>
      studio.locator("video").evaluate((e: HTMLVideoElement) => e.readyState),
    )
    .toBeGreaterThanOrEqual(2);
  await studio.getByRole("button", { name: "Выключить камеру" }).click();
  expect(
    await studio
      .locator("video")
      .evaluate((e: HTMLVideoElement) => e.srcObject),
  ).toBeNull();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  expect(errors).toEqual([]);
  await page.screenshot({
    path: `/tmp/aik-studio-${test.info().project.name}.png`,
    fullPage: false,
  });
});
test("camera rejection and unavailable storage preserve sharing", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      value: async () => {
        throw Error("denied");
      },
    });
    Storage.prototype.setItem = () => {
      throw Error("blocked");
    };
  });
  await page.goto("./#constructor");
  const studio = page.locator("#constructor");
  await studio.getByRole("button", { name: "Примерить через камеру" }).click();
  await expect(studio.locator(".studio-status")).toContainText(
    "Разрешите доступ",
  );
  await studio
    .getByRole("button", { name: "Сохранить проект", exact: true })
    .click();
  await expect(studio.locator(".studio-status")).toContainText(
    "Не удалось сохранить",
  );
  await expect(
    studio.getByRole("link", { name: "Отправить мастеру в Telegram" }),
  ).toHaveAttribute("href", /https:\/\/t.me\/\+79349999779/);
});
