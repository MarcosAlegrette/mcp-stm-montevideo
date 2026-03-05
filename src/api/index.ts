/**
 * Entry point for REST API mode.
 * Run with: node dist/api/index.js
 */
import { serve } from "@hono/node-server";
import { CkanClient } from "../data/ckan-client.js";
import { createRestApp } from "./rest-server.js";
import { log } from "../utils/log.js";

const client = new CkanClient();
const app = createRestApp(client);
const port = parseInt(process.env.PORT || "3000", 10);

serve({ fetch: app.fetch, port }, (info) => {
  log.info(`STM API running on http://localhost:${info.port}`);
  log.info(`Docs: http://localhost:${info.port}/api/docs`);

  // Warmup: preload all STM datasets into cache so first request is fast
  log.info("Warming up STM data...");
  Promise.all([
    client.getParadas(),
    client.getHorarios(),
    client.getLineas(),
  ])
    .then(([paradas, horarios, lineas]) => {
      log.info(`Warmup complete: ${paradas.length} paradas, ${horarios.length} horarios, ${lineas.length} lineas`);
    })
    .catch((err) => {
      log.error("Warmup failed (will retry on first request):", err instanceof Error ? err.message : err);
    });
});
