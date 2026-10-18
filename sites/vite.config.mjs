import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  build: {
    outDir: "dist/sites-bot",
    emptyOutDir: true,
    lib: {
      entry: fileURLToPath(new URL("./bot.mjs", import.meta.url)),
      formats: ["es"],
      fileName: () => "worker.mjs",
    },
    minify: false,
  },
});
