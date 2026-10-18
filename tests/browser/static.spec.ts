import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

test("complete static site starts with unavailable API and Telegram SDK", async ({
  page,
}) => {
  const apiCalls: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/"))
      apiCalls.push(request.url());
  });
  await page.route("**/api/**", (route) => route.abort());
  // Leave the optional SDK request pending to reproduce an unreachable Telegram host.
  await page.route("https://telegram.org/**", () => {});
  await page.goto("./#tgWebAppData=untrusted-test-data", {
    waitUntil: "domcontentloaded",
  });
  await expect(page.locator(".service-card")).toHaveCount(8);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "которая",
  );
  await expect(
    page.getByRole("button", { name: "Мои заявки", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Проверить расчёт" }).click();
  await expect(page.locator(".estimate-result")).toContainText(
    "Рассчитывается индивидуально",
  );
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(apiCalls).toEqual([]);
});

test("manual request contains project data and is never reported as sent", async ({
  page,
}) => {
  const apiCalls: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/"))
      apiCalls.push(request.url());
  });
  await page.goto("./");
  await page
    .getByRole("button", { name: "Заказать сварку", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Оформить заявку" });
  await dialog.getByLabel("Вид работ").selectOption("stairs");
  await dialog.getByLabel("Длина, м").fill("3");
  await dialog.getByLabel("Ваше имя").fill("Тестовый заказчик");
  await dialog
    .getByLabel("Телефон, email или Telegram")
    .fill("@aik_static_test");
  await dialog
    .getByLabel("Что нужно сделать?")
    .fill("Лестница и перила по индивидуальному эскизу");
  await dialog.locator('input[name="consent"]').check();
  await dialog
    .getByRole("button", { name: "Подготовить текст заявки" })
    .click();
  await expect(
    dialog.getByRole("heading", { name: "Осталось передать мастеру." }),
  ).toBeVisible();
  await expect.poll(() => dialog.evaluate(el => el.scrollTop)).toBe(0);
  await expect(dialog).toContainText("Заявка ещё не отправлена");
  await expect(dialog.getByLabel("Текст заявки")).toHaveValue(
    /Лестницы и перила/,
  );
  const sms = dialog.getByRole("link", { name: "Открыть SMS" });
  expect(decodeURIComponent((await sms.getAttribute("href"))!)).toContain(
    "sms:+79349999779?body=AIK BASE",
  );
  const download = page.waitForEvent("download");
  await dialog
    .getByRole("button", { name: "Сохранить текст", exact: true })
    .click();
  const file = await download;
  const text = readFileSync((await file.path())!, "utf8");
  expect(text).toContain("@aik_static_test");
  expect(text).toContain("Размеры: 3 × 1 м");
  expect(text).toContain("Лестница и перила по индивидуальному эскизу");
  await dialog.getByRole("button", { name: "Вернуться к форме" }).click();
  await expect(dialog.getByLabel("Ваше имя")).toHaveValue("Тестовый заказчик");
  await expect(dialog.getByLabel("Что нужно сделать?")).toHaveValue(
    "Лестница и перила по индивидуальному эскизу",
  );
  expect(apiCalls).toEqual([]);
});

test("invalid contact cannot produce a prepared request", async ({ page }) => {
  await page.goto("./");
  await page
    .getByRole("button", { name: "Заказать сварку", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Оформить заявку" });
  await dialog.getByLabel("Ваше имя").fill("Тестовый заказчик");
  await dialog
    .getByLabel("Телефон, email или Telegram")
    .fill("invalid_contact");
  await dialog
    .getByLabel("Что нужно сделать?")
    .fill("Нужна лестница с металлическими перилами");
  await dialog.locator('input[name="consent"]').check();
  await dialog
    .getByRole("button", { name: "Подготовить текст заявки" })
    .click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Проверьте имя, контакт",
  );
  await expect(
    dialog.getByRole("heading", { name: "Осталось передать мастеру." }),
  ).toHaveCount(0);
});

test("static navigation, portfolio video and phone work on desktop and mobile", async ({
  page,
  isMobile,
}) => {
  await page.goto("./");
  if (isMobile)
    await page.getByRole("button", { name: "Открыть меню" }).click();
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Проекты", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Лестницы и перила", exact: true })
    .click();
  await page.locator(".project-card").click();
  const gallery = page.getByRole("dialog", { name: "Просмотр проекта" });
  await expect(gallery.locator("video")).toBeVisible();
  await expect
    .poll(() =>
      gallery
        .locator("video")
        .evaluate((el) => (el as HTMLVideoElement).readyState),
    )
    .toBeGreaterThanOrEqual(1);
  await page.keyboard.press("Escape");
  await expect(gallery).not.toBeVisible();
  await expect(page.locator('footer a[href="tel:+79349999779"]')).toHaveText(
    "+7 934 999-97-79",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
