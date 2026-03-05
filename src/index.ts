import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
import { log } from "./utils/log.js";

async function main() {
  const { server, client } = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Non-blocking warmup: preload all STM datasets so first tool call is fast
  log.error("Warming up STM data...");
  Promise.all([
    client.getParadas(),
    client.getHorarios(),
    client.getLineas(),
  ])
    .then(([p, h, l]) =>
      log.error(`Warmup complete: ${p.length} paradas, ${h.length} horarios, ${l.length} lineas`),
    )
    .catch((err) =>
      log.error("Warmup failed (will retry on first request):", err instanceof Error ? err.message : err),
    );
}

main().catch((err) => {
  log.error("Fatal error:", err);
  process.exit(1);
});
