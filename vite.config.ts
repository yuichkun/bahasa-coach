import { defineConfig, loadEnv, type Plugin } from "vite-plus";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { createApp } from "./server/app.ts";

function localApi(): Plugin {
  return {
    name: "bahasa-local-api",
    apply: "serve",
    async configureServer(server) {
      if (process.env.VITEST || server.config.mode === "test") return;
      const registry = globalThis as typeof globalThis & {
        bahasaApi?: { close(): Promise<void> };
        bahasaRestart?: Promise<void>;
      };
      const previous = registry.bahasaRestart;
      let release!: () => void;
      registry.bahasaRestart = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      try {
        await registry.bahasaApi?.close();
        const env = loadEnv(server.config.mode, process.cwd(), "");
        const { app } = await createApp({
          dataDir: resolve(".local"),
          origin: "http://localhost:43187",
          voiceKey: env.OPENAI_API_KEY,
        });
        registry.bahasaApi = app;
        await app.listen({ host: "127.0.0.1", port: 43188 });
        let closed = false;
        const close = () => {
          if (!closed) {
            closed = true;
            process.off("SIGINT", close);
            process.off("SIGTERM", close);
            void app.close();
          }
        };
        server.httpServer?.once("close", close);
        process.once("SIGINT", close);
        process.once("SIGTERM", close);
      } finally {
        release();
      }
    },
  };
}
export default defineConfig({
  plugins: [react(), localApi()],
  server: {
    host: "localhost",
    port: 43187,
    strictPort: true,
    watch: { ignored: ["**/.local/**"] },
    fs: { deny: [".env", ".env.*", "**/.git/**", "**/.local/**", "**/*.{crt,pem}"] },
    proxy: { "/api": { target: "http://127.0.0.1:43188", ws: true, changeOrigin: false } },
  },
  test: { include: ["server/**/*.test.ts", "src/**/*.test.tsx"], environment: "node" },
  lint: { options: { typeAware: true, typeCheck: true }, ignorePatterns: ["dist/**", ".local/**"] },
  fmt: { ignorePatterns: ["dist/**", ".local/**", "package-lock.json"] },
});
