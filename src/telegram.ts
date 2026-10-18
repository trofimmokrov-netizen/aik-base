let loading: Promise<void> | undefined;

function launchParameters() {
  return new URLSearchParams(window.location.hash.slice(1));
}
export function telegramInitData() {
  // This is untrusted transport data. Only the backend may authenticate it via HMAC.
  return (
    window.Telegram?.WebApp?.initData ||
    launchParameters().get("tgWebAppData") ||
    ""
  );
}
export function initializeTelegram() {
  if (loading) return loading;
  loading = (async () => {
    if (!window.Telegram?.WebApp && launchParameters().has("tgWebAppData")) {
      await new Promise<void>((resolve) => {
        const script = document.createElement("script");
        const timer = setTimeout(resolve, 4000);
        script.src = "https://telegram.org/js/telegram-web-app.js";
        script.async = true;
        script.onload = script.onerror = () => {
          clearTimeout(timer);
          resolve();
        };
        document.head.append(script);
      });
    }
    const app = window.Telegram?.WebApp;
    if (app?.initData) {
      app.ready();
      app.expand();
      app.setHeaderColor?.("#141616");
      app.setBackgroundColor?.("#141616");
    }
  })();
  return loading;
}
