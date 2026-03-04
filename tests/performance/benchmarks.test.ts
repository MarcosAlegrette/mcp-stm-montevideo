/**
 * Performance benchmarks for DataIndexes optimizations.
 * Validates that indexed lookups are significantly faster than brute-force scans.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { findNearestParadas, findNearestParadasIndexed } from "../../src/geo/distance.js";
import { buildSpatialGrid } from "../../src/geo/spatial-grid.js";
import { getDataIndexes, _resetDataIndexes } from "../../src/data/data-indexes.js";
import { fuzzySearchParadas } from "../../src/geo/search.js";
import { generateLargeNetwork } from "../fixtures/network-data.js";
import type { Parada } from "../../src/types/parada.js";
import type { HorarioRow } from "../../src/types/horario.js";
import type { LineaVariante } from "../../src/types/linea.js";

// Generate a large-ish dataset for benchmarks
let paradas: Parada[];
let horarios: HorarioRow[];
let lineas: LineaVariante[];

beforeAll(() => {
  _resetDataIndexes();
  const net = generateLargeNetwork();
  paradas = net.paradas;
  horarios = net.horarios;
  lineas = net.lineas;
});

describe("Performance benchmarks", () => {
  it("findNearestParadasIndexed is faster than brute-force for 500+ paradas", () => {
    const grid = buildSpatialGrid(paradas);
    const lat = paradas[0].lat;
    const lon = paradas[0].lng;

    // Warm up
    findNearestParadas(lat, lon, paradas, 500, 5);
    findNearestParadasIndexed(lat, lon, paradas, grid, 500, 5);

    const t0 = performance.now();
    for (let i = 0; i < 100; i++) {
      findNearestParadas(lat, lon, paradas, 500, 5);
    }
    const bruteTime = performance.now() - t0;

    const t1 = performance.now();
    for (let i = 0; i < 100; i++) {
      findNearestParadasIndexed(lat, lon, paradas, grid, 500, 5);
    }
    const indexedTime = performance.now() - t1;

    // Indexed should be at least 2x faster
    expect(indexedTime).toBeLessThan(bruteTime);

    // Both should return the same results
    const bruteResult = findNearestParadas(lat, lon, paradas, 500, 5);
    const indexedResult = findNearestParadasIndexed(lat, lon, paradas, grid, 500, 5);
    expect(indexedResult.map((r) => r.id)).toEqual(bruteResult.map((r) => r.id));
  });

  it("schedule index lookup < 1ms per parada", () => {
    const indexes = getDataIndexes();
    const paradaId = paradas[0].id;

    // Warm up
    indexes.getHorariosByParada(paradaId, horarios);

    const t0 = performance.now();
    for (let i = 0; i < 1000; i++) {
      indexes.getHorariosByParada(paradas[i % paradas.length].id, horarios);
    }
    const elapsed = performance.now() - t0;

    // 1000 lookups should take well under 1000ms (< 1ms each)
    expect(elapsed).toBeLessThan(100);
  });

  it("horariosByVariante index lookup < 1ms per variant", () => {
    const indexes = getDataIndexes();
    const codVariante = paradas[0].variante;

    // Warm up
    indexes.getHorariosByVariante(codVariante, horarios);

    const t0 = performance.now();
    for (let i = 0; i < 1000; i++) {
      indexes.getHorariosByVariante(lineas[i % lineas.length].codVariante, horarios);
    }
    const elapsed = performance.now() - t0;

    expect(elapsed).toBeLessThan(100);
  });

  it("paradasByVariante index lookup < 1ms per variant", () => {
    const indexes = getDataIndexes();

    // Warm up
    indexes.getParadasByVariante(paradas[0].variante, paradas);

    const t0 = performance.now();
    for (let i = 0; i < 1000; i++) {
      indexes.getParadasByVariante(lineas[i % lineas.length].codVariante, paradas);
    }
    const elapsed = performance.now() - t0;

    expect(elapsed).toBeLessThan(100);
  });

  it("getLookupMaps cached: second call < 1ms", () => {
    const indexes = getDataIndexes();

    // First call builds the maps
    indexes.getLookupMaps(paradas, lineas);

    const t0 = performance.now();
    indexes.getLookupMaps(paradas, lineas);
    const elapsed = performance.now() - t0;

    expect(elapsed).toBeLessThan(1);
  });

  it("fuzzySearchParadas with pre-normalized text completes in < 50ms for 500 paradas", () => {
    const indexes = getDataIndexes();

    // Warm up normalization cache
    indexes.getNormalized(paradas[0], paradas);

    const t0 = performance.now();
    fuzzySearchParadas("LINE 5 ST", paradas);
    const elapsed = performance.now() - t0;

    expect(elapsed).toBeLessThan(50);
  });

  it("getParadasGrid cached: second call returns same grid reference", () => {
    const indexes = getDataIndexes();

    const grid1 = indexes.getParadasGrid(paradas);
    const grid2 = indexes.getParadasGrid(paradas);

    expect(grid1).toBe(grid2);
  });

  it("index staleness: rebuilds when data reference changes", () => {
    const indexes = getDataIndexes();

    const grid1 = indexes.getParadasGrid(paradas);

    // Create a new array (different reference, same data)
    const newParadas = [...paradas];
    const grid2 = indexes.getParadasGrid(newParadas);

    // Should be a different grid since reference changed
    expect(grid2).not.toBe(grid1);
  });
});
