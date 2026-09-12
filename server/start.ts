import { resolve } from "node:path";
import { existsSync } from "node:fs";
import staticFiles from "@fastify/static";
import { createApp } from "./app.ts";
if (existsSync(".env")) process.loadEnvFile(".env");
const { app } = await createApp({
  dataDir: resolve(".local"),
  origin: "http://localhost:43187",
  voiceKey: process.env.OPENAI_API_KEY,
});
await app.register(staticFiles, { root: resolve("dist") });
await app.listen({ host: "127.0.0.1", port: 43187 });
console.log("Bahasa Coach: http://localhost:43187");
process.once("SIGINT", () => {
  void app.close();
});
process.once("SIGTERM", () => {
  void app.close();
});
