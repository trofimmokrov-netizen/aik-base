# Развёртывание

## Вариант 1: весь проект на VPS

Нужны Docker Compose, домен, HTTPS reverse proxy (например Caddy) и постоянное хранилище. Один экземпляр Node обслуживает API и статическую сборку.

1. Скопируйте проект на сервер, создайте `.env` по примеру. Не переносите локальную тестовую базу в production.
2. Укажите `MINI_APP_URL=https://ваш-домен/aik-base/`, `PUBLIC_API_URL=https://ваш-домен`, `ALLOWED_ORIGINS=https://ваш-домен`, `TRUST_PROXY_HOPS=1` для одного доверенного Caddy. Заполните секреты средствами хостинга.
3. Выполните `docker compose up -d --build`. Порт 3001 доступен только на loopback хоста; постоянная база хранится в named volume `orders`.
4. На хосте настройте Caddy:

```caddyfile
ваш-домен {
    reverse_proxy 127.0.0.1:3001
}
```

5. Проверьте HTTPS `/api/health`, сайт `/aik-base/`, реальную отправку тестовой заявки и получение её статуса.
6. Выполните настройку Telegram из [telegram.md](telegram.md), затем проверьте доставку живого тестового заказа.

Если reverse proxy сам в Docker, используйте внутреннюю сеть и имя сервиса `aik-base:3001`; loopback из отдельного контейнера не ведёт в контейнер API. Не открывайте API в обход доверенного proxy при `TRUST_PROXY_HOPS=1`.

Обновление: `docker compose up -d --build`. Не используйте `down -v` для обычного обновления: флаг `-v` удаляет хранилище заказов. Перед изменениями делайте проверенную резервную копию. Docker-конфигурация подготовлена; её запуск требует Docker на целевом сервере.

В среде с корпоративным HTTPS-прокси передайте стандартные proxy-переменные и доверенный CA bundle через необязательный BuildKit secret. Сертификат не включается в образ, проверка TLS сохраняется:

```sh
docker build --build-arg HTTP_PROXY --build-arg HTTPS_PROXY --build-arg NO_PROXY \
  --secret id=build_ca,src=/путь/к/доверенному-ca.pem -t aik-base:local .
```

## Вариант 2: GitHub Pages + отдельный API

Frontend предназначен для `https://trofimmokrov-netizen.github.io/aik-base/`; `base` Vite уже равен `/aik-base/`.

1. Разместите backend на VPS либо Node-хостинге с **постоянным диском**, поддерживающем Node 24 и `node:sqlite`. Для сборки: `npm ci && npm run build`, запуска: `npm start`, health: `/api/health`.
2. Примонтируйте постоянный диск, укажите `DATABASE_PATH=/путь-постоянного-диска/aik-base.db`. Бесплатный эфемерный filesystem не подходит для заказов.
3. Укажите `ALLOWED_ORIGINS=https://trofimmokrov-netizen.github.io`, `MINI_APP_URL=https://trofimmokrov-netizen.github.io/aik-base/`, `PUBLIC_API_URL=https://ваш-api-домен`. Настройте секреты и HTTPS.
4. В GitHub Settings → Secrets and variables → Actions → Variables добавьте **публичную** переменную `VITE_API_URL=https://ваш-api-домен`. Не добавляйте токен в frontend variables.
5. В GitHub Settings → Pages выберите Source: GitHub Actions. Workflow `.github/workflows/pages.yml` собирает frontend, запускает серверные тесты и публикует `dist` после push в `main` или ручного запуска.
6. Убедитесь, что сайт обращается к нужному API. При пустом `VITE_API_URL` на Pages будет показано сообщение о недоступном API; заявки не имитируются.
7. Подключите бота через `npm run telegram:configure` из окружения backend.

Коммит и push выполняются отдельно владельцем или после явного поручения на публикацию. Workflow в репозитории не включает Pages автоматически и не создаёт внешний backend-хостинг.

## Эксплуатация

- Следите за health API, свободным диском и количеством ожидающих Telegram-уведомлений. Логи не содержат тел заявок и токенов.
- Резервируйте SQLite средствами online backup с учётом WAL и проверяйте восстановление.
- Настройте права и шифрование диска/резервных копий, сроки хранения и удаление персональных данных.
- Ограничители запросов хранятся в памяти одного процесса. Для нескольких реплик нужны общая БД, общая очередь и общий rate-limit store.
- Набор зависимостей фиксируется `package-lock.json`; обновляйте его осознанно и запускайте проверки.
- До коммерческого запуска внесите контакты и реквизиты исполнителя, правила обработки данных, реальные условия и тарифы.

Внешний хостинг, домен и секреты не создаются автоматически. Публикация GitHub Pages и проверка настоящей доставки Telegram — отдельные действия после настройки этих ресурсов.
