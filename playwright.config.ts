import { defineConfig, devices } from "@playwright/test";

export function makeConfig(connected = false) {
  return defineConfig({
    testMatch: connected ? "app.spec.ts" : "static.spec.ts",
    testDir: "./tests/browser",
    fullyParallel: false,
    workers: 1,
    use: {
      baseURL: "http://127.0.0.1:3002/aik-base/",
      trace: "retain-on-failure",
      screenshot: "only-on-failure",
      launchOptions: process.env.CHROMIUM_PATH
        ? { executablePath: process.env.CHROMIUM_PATH, args: ["--no-sandbox"] }
        : {},
    },
    projects: [
      { name: "desktop", use: { ...devices["Desktop Chrome"] } },
      {
        name: "mobile",
        use: { ...devices["Pixel 7"], defaultBrowserType: "chromium" },
      },
    ],
    webServer: connected
      ? {
          command: "node server/index.mjs",
          url: "http://127.0.0.1:3002/api/health",
          reuseExistingServer: false,
          env: {
            PORT: "3002",
            HOST: "127.0.0.1",
            DATABASE_PATH: `/tmp/aik-e2e-${process.pid}.db`,
            ALLOWED_ORIGINS: "http://127.0.0.1:3002",
            TELEGRAM_BOT_TOKEN: "",
            TELEGRAM_ADMIN_CHAT_ID: "",
            TELEGRAM_WEBHOOK_SECRET: "",
          },
        }
      : {
          command:
            "node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 3002 --strictPort",
          url: "http://127.0.0.1:3002/aik-base/",
          reuseExistingServer: false,
        },
  });
}

export default makeConfig();
