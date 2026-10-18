import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

test("navigation, services, portfolio filters and accessible gallery", async ({
  page,
  isMobile,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("./");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "которая",
  );
  await expect(page.locator(".service-card")).toHaveCount(8);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  if (isMobile)
    await page.getByRole("button", { name: "Открыть меню" }).click();
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Проекты", exact: true })
    .click();
  await page.getByRole("button", { name: "Навесы", exact: true }).click();
  await expect(page.locator(".project-card")).toHaveCount(1);
  await page.locator(".project-card").click();
  const gallery = page.getByRole("dialog", { name: "Просмотр иллюстрации" });
  await expect(gallery).toBeVisible();
  await expect(gallery).toContainText("НЕ ВЫПОЛНЕННЫЙ ЗАКАЗ");
  await page.keyboard.press("Escape");
  await expect(gallery).not.toBeVisible();
  await page.getByRole("button", { name: "Все направления" }).click();
  await expect(page.locator(".project-card")).toHaveCount(3);
  expect(errors).toEqual([]);
});
test("calculator uses API, browser creates an order and retrieves its actual status", async ({
  page,
}) => {
  await page.goto("./");
  await page.getByRole("button", { name: "Проверить расчёт" }).click();
  await expect(page.locator(".estimate-result")).toContainText(
    "Рассчитывается индивидуально",
  );
  await page
    .getByRole("button", { name: "Оставить заявку", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Оформить заявку" });
  await dialog.getByLabel("Ваше имя").fill("Тестовый заказчик");
  await dialog.getByLabel("Телефон, email или Telegram").fill("@aik_test_user");
  await dialog
    .getByLabel("Что нужно сделать?")
    .fill("Нужен металлический каркас для навеса, размеры уточним.");
  await dialog.locator('input[name="consent"]').check();
  await dialog.getByRole("button", { name: "Отправить заявку" }).click();
  await expect(
    dialog.getByRole("heading", { name: "Начало положено." }),
  ).toBeVisible();
  await expect(dialog).toContainText("Уведомления мастеру ещё не подключены");
  const receiptDownload = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Сохранить файл доступа" }).click();
  const receipt = JSON.parse(
    readFileSync((await (await receiptDownload).path())!, "utf8"),
  );
  expect(receipt.accessToken).toHaveLength(64);
  await dialog.getByRole("button", { name: "Посмотреть статус" }).click();
  const tracking = page.getByRole("dialog", { name: "Мои заявки" });
  await tracking.getByRole("button", { name: "Проверить статус" }).click();
  await expect(tracking.locator(".status-badge")).toHaveText("Принята");
  await expect(tracking).toContainText("Нужен металлический каркас");
  const recovery = await page.context().newPage();
  await recovery.goto("./");
  await recovery
    .locator("footer")
    .getByRole("button", { name: "Мои заявки" })
    .click();
  const recovered = recovery.getByRole("dialog", { name: "Мои заявки" });
  await recovered
    .getByLabel("Номер заявки", { exact: true })
    .fill(receipt.orderId);
  await recovered.getByRole("button", { name: "Проверить статус" }).click();
  await expect(recovered.getByRole("alert")).toContainText("нет доступа");
  await recovered.getByLabel("Личный ключ доступа").fill(receipt.accessToken);
  await recovered.getByRole("button", { name: "Проверить статус" }).click();
  await expect(recovered.locator(".status-badge")).toHaveText("Принята");
  await recovery.close();
});
test("failed API never displays a successful order and form remains retryable", async ({
  page,
}) => {
  await page.goto("./");
  await page.route("**/api/orders", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Сервер временно недоступен" }),
    }),
  );
  await page
    .getByRole("button", { name: "Заказать сварку", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Оформить заявку" });
  await dialog.getByLabel("Ваше имя").fill("Проверка ошибок");
  await dialog
    .getByLabel("Телефон, email или Telegram")
    .fill("test@example.com");
  await dialog
    .getByLabel("Что нужно сделать?")
    .fill("Проверяем, что сбой сервера не теряет введённые данные.");
  await dialog.locator('input[name="consent"]').check();
  await dialog.getByRole("button", { name: "Отправить заявку" }).click();
  await expect(dialog.getByRole("alert")).toHaveText(
    "Сервер временно недоступен",
  );
  await expect(dialog.getByLabel("Ваше имя")).toHaveValue("Проверка ошибок");
  await expect(
    dialog.getByRole("button", { name: "Отправить заявку" }),
  ).toBeEnabled();
  await expect(dialog.getByText("ЗАЯВКА СОХРАНЕНА")).not.toBeVisible();
});
