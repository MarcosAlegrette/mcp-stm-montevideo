/**
 * Integration tests — run tools against real CKAN data.
 * Skipped unless SKIP_INTEGRATION=false explicitly.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { CkanClient } from "../../src/data/ckan-client.js";
import { buscarParadaHandler } from "../../src/tools/buscar-parada.js";
import { recorridoLineaHandler } from "../../src/tools/recorrido-linea.js";
import { proximosBusesHandler } from "../../src/tools/proximos-buses.js";
import { comoLlegarHandler } from "../../src/tools/como-llegar.js";
import { findNearestParadasIndexed } from "../../src/geo/distance.js";
import { getDataIndexes } from "../../src/data/data-indexes.js";
import { geocodeIntersection } from "../../src/geo/geocode.js";
import type { Parada } from "../../src/data/ckan-client.js";

const SKIP = process.env["SKIP_INTEGRATION"] !== "false";

describe.skipIf(SKIP)("Tools live integration", () => {
  let client: CkanClient;
  let paradas: Parada[];

  beforeAll(async () => {
    client = new CkanClient();
    // Pre-warm cache
    paradas = await client.getParadas();
  }, 120_000);

  it("buscar_parada returns results for 18 de Julio y Ejido", async () => {
    const result = await buscarParadaHandler(
      { calle1: "18 de Julio", calle2: "Ejido", radio_metros: 500 },
      client
    );
    expect(result.content[0].type).toBe("text");
    const text = result.content[0].text;
    if (text.startsWith("[")) {
      const parsed = JSON.parse(text);
      expect(parsed.length).toBeGreaterThan(0);
      // Results should be in Montevideo
      for (const p of parsed) {
        expect(p.latitud).toBeGreaterThan(-35.1);
        expect(p.latitud).toBeLessThan(-34.6);
      }
    }
  }, 60_000);

  it("buscar_parada returns results for Bv España y Libertad", async () => {
    const result = await buscarParadaHandler(
      { calle1: "Bv España", calle2: "Libertad", radio_metros: 500 },
      client
    );
    const text = result.content[0].text;
    // Either finds stops or returns a message — must not crash
    expect(text.length).toBeGreaterThan(0);
    if (text.startsWith("[")) {
      const parsed = JSON.parse(text);
      expect(parsed.length).toBeGreaterThan(0);
    }
  }, 60_000);

  it("buscar_parada returns results by coordinates near Tres Cruces", async () => {
    // Tres Cruces terminal: approx -34.893, -56.163
    const result = await buscarParadaHandler(
      { latitud: -34.893, longitud: -56.163, radio_metros: 500 },
      client
    );
    const text = result.content[0].text;
    expect(text.length).toBeGreaterThan(0);
    if (text.startsWith("[")) {
      const parsed = JSON.parse(text);
      expect(parsed.length).toBeGreaterThan(0);
    }
  }, 30_000);

  it("recorrido_linea returns paradas for line 181 in order", async () => {
    const result = await recorridoLineaHandler({ linea: "181" }, client);
    expect(result.content[0].type).toBe("text");
    if (result.content[0].text.startsWith("[")) {
      const parsed = JSON.parse(result.content[0].text) as Array<{
        linea: string;
        paradas: Array<{ orden: number }>;
      }>;
      expect(parsed.length).toBeGreaterThan(0);
      expect(parsed[0].linea).toBe("181");
      // Stops should be in order
      const paradas = parsed[0].paradas;
      for (let i = 1; i < paradas.length; i++) {
        expect(paradas[i].orden).toBeGreaterThan(paradas[i - 1].orden);
      }
    }
  }, 120_000);

  it("proximos_buses returns results for parada near Tres Cruces", async () => {
    // Find a parada first
    const buscarResult = await buscarParadaHandler(
      { latitud: -34.893, longitud: -56.163, radio_metros: 300 },
      client
    );
    if (!buscarResult.content[0].text.startsWith("[")) return; // skip if no paradas found
    const paradas = JSON.parse(buscarResult.content[0].text) as Array<{ parada_id: number }>;
    if (paradas.length === 0) return;

    const paradaId = paradas[0].parada_id;
    const result = await proximosBusesHandler({ parada_id: paradaId, cantidad: 5 }, client);
    expect(result.content[0].type).toBe("text");
    // Should return either buses or "no service" — not crash
    expect(result.content[0].text.length).toBeGreaterThan(0);
  }, 120_000);

  it("como_llegar returns at least 1 option from Tres Cruces to Ciudad Vieja", async () => {
    const result = await comoLlegarHandler(
      {
        origen_calle1: "AV ITALIA",
        origen_calle2: "COLONIA",
        destino_calle1: "18 DE JULIO",
        destino_calle2: "EJIDO",
        max_caminata_metros: 500,
        max_transbordos: 1,
      },
      client
    );
    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text.length).toBeGreaterThan(0);
    // Should find a route or return a helpful message — not crash
    if (result.content[0].text.startsWith("[")) {
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.length).toBeGreaterThan(0);
      expect(parsed[0].duracion_total_estimada_min).toBeGreaterThan(0);
    }
  }, 120_000);

  // --- New tests: routing quality ---

  it("como_llegar finds a direct route from Facultad de Ingeniería to Intendencia", async () => {
    const result = await comoLlegarHandler(
      {
        origen_calle1: "Facultad de Ingeniería",
        destino_calle1: "Intendencia de Montevideo",
      },
      client
    );
    const text = result.content[0].text;
    expect(text.length).toBeGreaterThan(0);
    if (text.startsWith("[")) {
      const routes = JSON.parse(text) as Array<{
        tramos: Array<{ tipo: string; linea?: string }>;
      }>;
      // At least 1 direct route (exactly 1 bus tramo)
      const directRoutes = routes.filter(
        (r) => r.tramos.filter((t) => t.tipo === "bus").length === 1
      );
      expect(directRoutes.length).toBeGreaterThan(0);
    }
  }, 120_000);

  it("como_llegar finds a direct route from Intendencia to Campeón del Siglo", async () => {
    const result = await comoLlegarHandler(
      {
        origen_calle1: "Intendencia de Montevideo",
        destino_calle1: "Campeón del Siglo",
        max_caminata_metros: 1500,
        max_transbordos: 1,
      },
      client
    );
    const text = result.content[0].text;
    expect(text.length).toBeGreaterThan(0);
    if (text.startsWith("[")) {
      const routes = JSON.parse(text) as Array<{
        tramos: Array<{ tipo: string; linea?: string }>;
      }>;
      expect(routes.length).toBeGreaterThan(0);
      // Check that at least one route uses line 103 or D8
      const allBusLines = routes.flatMap((r) =>
        r.tramos.filter((t) => t.tipo === "bus").map((t) => t.linea)
      );
      const hasExpectedLine = allBusLines.some(
        (l) => l === "103" || l === "D8"
      );
      expect(hasExpectedLine).toBe(true);
    }
  }, 120_000);

  // --- Dedup verification ---

  it("findNearestParadasIndexed returns unique stop IDs near 18 de Julio & Ejido", async () => {
    const indexes = getDataIndexes();
    const grid = indexes.getParadasGrid(paradas);
    const ejido = await geocodeIntersection("18 de Julio", "Ejido", paradas);
    expect(ejido).not.toBeNull();
    if (!ejido) return;

    const near = findNearestParadasIndexed(ejido.lat, ejido.lon, paradas, grid, 800, 20);
    expect(near.length).toBeGreaterThan(0);

    // All returned rows must have unique stop IDs (dedup working)
    const ids = near.map((p) => p.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(near.length);
  }, 60_000);

  // --- buscar_parada: fuzzy name search ---

  it("buscar_parada returns results for fuzzy search 'tres cruces'", async () => {
    const result = await buscarParadaHandler(
      { calle1: "tres cruces" },
      client
    );
    const text = result.content[0].text;
    expect(text.length).toBeGreaterThan(0);
    if (text.startsWith("[")) {
      const parsed = JSON.parse(text);
      expect(parsed.length).toBeGreaterThan(0);
    }
  }, 60_000);

  // --- recorrido_linea: unknown line ---

  it("recorrido_linea returns helpful message for unknown line 9999", async () => {
    const result = await recorridoLineaHandler({ linea: "9999" }, client);
    const text = result.content[0].text;
    expect(text.length).toBeGreaterThan(0);
    // Should NOT be a JSON array (no results), should be a user-friendly message
    expect(text.startsWith("[")).toBe(false);
  }, 60_000);
});
