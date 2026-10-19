import services from "../shared/services.json" with { type: "json" };

export async function telegramCall(token, method, body) {
  if (!token) throw new Error("telegram_not_configured");
  // Never log the request URL: Telegram URLs contain the token.
  let response;
  try {
    const url = new URL(`https://api.telegram.org/bot${token}/${method}`);
    if (method.startsWith("get")) url.searchParams.set("readback", crypto.randomUUID());
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new Error("telegram_unreachable");
  }
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.ok) throw new Error("telegram_request_failed");
  return result.result;
}

export function commandReply(update, config, db) {
  const message = update.message;
  if (
    !message ||
    message.chat?.type !== "private" ||
    typeof message.text !== "string"
  )
    return null;
  const command = message.text.split(/\s/)[0].split("@")[0].toLowerCase();
  const isAdmin =
    String(message.chat.id) === config.adminChatId &&
    String(message.from?.id) === config.adminChatId;
  if (command === "/status" && isAdmin && db) {
    const [, id, status] = message.text.trim().split(/\s+/);
    const statuses = [
      "new",
      "reviewing",
      "agreed",
      "in_progress",
      "completed",
      "cancelled",
    ];
    if (!id || !statuses.includes(status))
      return {
        chat_id: message.chat.id,
        text: "Формат: /status <полный UUID заявки> <статус>\nСтатусы: new, reviewing, agreed, in_progress, completed, cancelled",
      };
    const result = db
      .prepare("UPDATE orders SET status = ? WHERE id = ?")
      .run(status, id);
    return {
      chat_id: message.chat.id,
      text: result.changes
        ? `Статус заявки ${id}: ${status}`
        : "Заявка не найдена.",
    };
  }
  const route = (hash) => config.miniAppUrl.replace(/#.*$/, "") + hash;
  const extra = {
    "/constructor": "AIK BASE / 3D-конструктор\n\nВыберите навес, лестницу, ограждение, ворота или каркас. Настройте размеры, профиль и цвет. Сохраните проект и передайте мастеру ссылку для расчёта. Модель — концепция, не расчёт несущей способности.",
    "/camera": "Примерка на месте\n\nОткройте 3D-конструктор и нажмите «Примерить через камеру». Разрешите доступ или загрузите фото. Масштаб и ракурс подбираются вручную; это визуальный ориентир, не AR-замер. Фото и камера остаются на вашем устройстве.",
    "/portfolio": "Работы AIK BASE: лестницы, площадки, ограждения и навесы. Фото и видео с объектов — в приложении.",
    "/about": "AIK BASE — сварка, которая держит.\n\nСварочные работы и металлоконструкции по индивидуальным размерам. Обсудим задачу, материалы, изготовление и монтаж. Итоговую стоимость и возможность исполнения подтверждает мастер.\nТелефон / Telegram: +7 934 999-97-79.",
    "/menu": "AIK BASE / Главное меню\n\nУслуги, 3D-проект, примерка и связь с мастером — выберите действие ниже.",
  }[command];
  const contacts = [config.phone, config.email].filter(Boolean).join("\n");
  const text =
    {
      "/start":
        "AIK BASE — Сварка, которая держит.\n\nСварочные работы, металлоконструкции и индивидуальные проекты. Откройте приложение, выберите услугу и отправьте заявку.",
      "/services": `Наши услуги:\n${services.map((s) => `• ${s.title}`).join("\n")}\n\nСтоимость рассчитывается после уточнения задачи.`,
      "/order":
        "Опишите вашу задачу в приложении: укажите услугу, размеры и контакт. После отправки вы получите номер заявки.",
      "/contact":
        contacts ||
        "Контакт мастера пока не настроен. Оформите заявку в приложении и укажите способ обратной связи.",
      "/help":
        "/start — главное меню\n/services — услуги\n/order — оформить заявку\n/contact — контакты\n/help — помощь\n\nСтатус заявки доступен в приложении. Данные других клиентов недоступны.",
      "/id": `Ваш Telegram ID: ${message.from?.id || message.chat.id}`,
    }[command] ||
    "Откройте AIK BASE, чтобы оформить заявку. Список команд: /help";
  const manualText = config.manualOrders
    ? {
        "/start": "AIK BASE — Сварка, которая держит.\n\nСварочные работы и металлоконструкции. Откройте приложение: там услуги, 3D-конструктор, примерка через камеру и подготовка заявки для ручной отправки мастеру в Telegram. Автоматический приём заявок пока не подключён.",
        "/order": "Откройте приложение, выберите услугу и подготовьте заявку. Скопируйте её текст и отправьте мастеру выбранным в приложении способом либо позвоните. Сообщения этому боту мастеру автоматически не пересылаются.",
        "/help": "/start — главное меню\n/services — услуги\n/order — подготовить заявку\n/contact — контакты\n/id — ваш Telegram ID\n/constructor — 3D-конструктор\n/camera — примерка\n/portfolio — работы\n/about — о мастерской\n/menu — меню\n/help — помощь\n\nПриложение подготавливает заявку для ручной отправки. Автоматическая отправка и отслеживание статуса пока не подключены. Сообщения этому боту мастеру не пересылаются.",
      }[command] || (command.startsWith("/") ? null : "Откройте приложение, чтобы подготовить заявку, или выберите /contact для связи с мастером. Сообщения этому боту мастеру не пересылаются.")
    : null;
  return {
    chat_id: message.chat.id,
    text: extra || manualText || text,
    reply_markup: {
      inline_keyboard: [
        [{ text: "Открыть AIK BASE", web_app: { url: config.miniAppUrl } }],
        [{text:"Услуги",web_app:{url:route('#services')}},{text:"Наши работы",web_app:{url:route('#portfolio')}}],
        [{text:"Собрать 3D-проект",web_app:{url:route('#constructor')}}],
        [{text:"Камера / примерка",web_app:{url:route('#constructor')}},{text:"Расчёт / заявка",web_app:{url:route('#calculator')}}],
        [{text:"Написать мастеру",url:'https://t.me/+79349999779'},{text:"О мастерской",url:route('#telegram-bot')}],
      ],
    },
  };
}
export function notificationText(row) {
  const p = JSON.parse(row.payload);
  const title =
    services.find((s) => s.id === p.serviceId)?.title || p.serviceId;
  return [
    `Новая заявка AIK BASE\n№ ${row.id}`,
    `Услуга: ${title}`,
    `Клиент: ${p.name}`,
    `Контакт: ${p.contact}`,
    `Описание: ${p.description}`,
    `Металл: ${p.metal}`,
    `Размеры: ${p.width} × ${p.height} м; количество: ${p.quantity}`,
    `Выезд: ${p.onsite ? "да" : "нет"}`,
    `Комментарий: ${p.comment || "—"}`,
    `Дата: ${row.created_at}`,
  ].join("\n\n");
}

export function createWorker(db, config, call = telegramCall) {
  let running = false;
  return async function tick() {
    if (running || !config.token) return;
    running = true;
    try {
      const now = Date.now();
      if (config.adminChatId) {
        const orders = db
          .prepare(
            "SELECT * FROM orders WHERE notification_status = 'pending' AND next_notification_at <= ? LIMIT 5",
          )
          .all(now);
        for (const row of orders) {
          try {
            // Plain text prevents user input from becoming Telegram markup.
            const text = notificationText(row);
            for (let offset = 0; offset < text.length; offset += 3900)
              await call(config.token, "sendMessage", {
                chat_id: config.adminChatId,
                text: text.slice(offset, offset + 3900),
              });
            db.prepare(
              "UPDATE orders SET notification_status = 'sent' WHERE id = ?",
            ).run(row.id);
          } catch {
            db.prepare(
              "UPDATE orders SET notification_attempts = notification_attempts + 1, next_notification_at = ? WHERE id = ?",
            ).run(
              now +
                Math.min(
                  3600000,
                  10000 * 2 ** Math.min(row.notification_attempts, 9),
                ),
              row.id,
            );
          }
        }
      }
      const updates = db
        .prepare(
          "SELECT * FROM telegram_updates WHERE state = 'pending' AND retry_at <= ? LIMIT 5",
        )
        .all(now);
      for (const row of updates) {
        try {
          const reply = commandReply(JSON.parse(row.payload), config, db);
          if (reply) await call(config.token, "sendMessage", reply);
          db.prepare(
            "UPDATE telegram_updates SET state = 'done', payload = '{}' WHERE update_id = ?",
          ).run(row.update_id);
        } catch {
          db.prepare(
            "UPDATE telegram_updates SET attempts = attempts + 1, retry_at = ? WHERE update_id = ?",
          ).run(
            now + Math.min(3600000, 10000 * 2 ** Math.min(row.attempts, 9)),
            row.update_id,
          );
        }
      }
      db.prepare(
        "DELETE FROM telegram_updates WHERE state = 'done' AND created_at < ?",
      ).run(now - 7 * 86400000);
    } finally {
      running = false;
    }
  };
}
