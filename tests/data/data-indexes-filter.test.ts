import { describe, it, expect, beforeEach } from "vitest";
import type { Parada } from "../../src/types/parada.js";
import {
  filterSuspiciousVariants,
  MAX_CONSECUTIVE_GAP_M,
  MIN_STOPS_PER_VARIANT,
  getDataIndexes,
  _resetDataIndexes,
} from "../../src/data/data-indexes.js";

function makeParada(overrides: Partial<Parada>): Parada {
  return {
    id: 1,
    linea: "100",
    variante: 1000,
    ordinal: 1,
    calle: "TEST",
    esquina: "",
    lat: -34.9,
    lng: -56.2,
    ...overrides,
  };
}

describe("filterSuspiciousVariants", () => {
  it("keeps normal variant with small gaps", () => {
    const map = new Map<number, Parada[]>();
    map.set(1000, [
      makeParada({ id: 1, variante: 1000, ordinal: 1, lat: -34.900, lng: -56.200 }),
      makeParada({ id: 2, variante: 1000, ordinal: 2, lat: -34.901, lng: -56.201 }),
      makeParada({ id: 3, variante: 1000, ordinal: 3, lat: -34.902, lng: -56.202 }),
    ]);
    const removed = filterSuspiciousVariants(map);
    expect(removed).toBe(0);
    expect(map.has(1000)).toBe(true);
  });

  it("removes variant with >2km consecutive gap", () => {
    const map = new Map<number, Parada[]>();
    // ~5.3km gap between stops (FING area to Gral Flores area)
    map.set(9900, [
      makeParada({ id: 900, linea: "185", variante: 9900, ordinal: 1, lat: -34.918, lng: -56.167 }),
      makeParada({ id: 901, linea: "185", variante: 9900, ordinal: 2, lat: -34.873, lng: -56.182 }),
    ]);
    const removed = filterSuspiciousVariants(map);
    expect(removed).toBe(1);
    expect(map.has(9900)).toBe(false);
  });

  it("removes variant with only 1 stop", () => {
    const map = new Map<number, Parada[]>();
    map.set(5000, [
      makeParada({ id: 50, variante: 5000, ordinal: 1 }),
    ]);
    const removed = filterSuspiciousVariants(map);
    expect(removed).toBe(1);
    expect(map.has(5000)).toBe(false);
  });

  it("keeps variant with exactly 2 stops and small gap", () => {
    const map = new Map<number, Parada[]>();
    map.set(2000, [
      makeParada({ id: 10, variante: 2000, ordinal: 1, lat: -34.900, lng: -56.200 }),
      makeParada({ id: 11, variante: 2000, ordinal: 2, lat: -34.901, lng: -56.200 }),
    ]);
    const removed = filterSuspiciousVariants(map);
    expect(removed).toBe(0);
    expect(map.has(2000)).toBe(true);
  });

  it("mixed map: removes only bad variants", () => {
    const map = new Map<number, Parada[]>();
    // Good variant
    map.set(1000, [
      makeParada({ id: 1, variante: 1000, ordinal: 1, lat: -34.900, lng: -56.200 }),
      makeParada({ id: 2, variante: 1000, ordinal: 2, lat: -34.901, lng: -56.201 }),
    ]);
    // Bad variant (huge gap)
    map.set(9900, [
      makeParada({ id: 900, linea: "185", variante: 9900, ordinal: 1, lat: -34.918, lng: -56.167 }),
      makeParada({ id: 901, linea: "185", variante: 9900, ordinal: 2, lat: -34.873, lng: -56.182 }),
    ]);
    // Bad variant (single stop)
    map.set(5000, [
      makeParada({ id: 50, variante: 5000, ordinal: 1 }),
    ]);

    const removed = filterSuspiciousVariants(map);
    expect(removed).toBe(2);
    expect(map.has(1000)).toBe(true);
    expect(map.has(9900)).toBe(false);
    expect(map.has(5000)).toBe(false);
  });

  it("returns correct removal count", () => {
    const map = new Map<number, Parada[]>();
    map.set(1000, [makeParada({ id: 1, variante: 1000 })]);
    map.set(2000, [makeParada({ id: 2, variante: 2000 })]);
    map.set(3000, [makeParada({ id: 3, variante: 3000 })]);
    expect(filterSuspiciousVariants(map)).toBe(3);
    expect(map.size).toBe(0);
  });

  it("empty map returns 0", () => {
    const map = new Map<number, Parada[]>();
    expect(filterSuspiciousVariants(map)).toBe(0);
  });

  it("custom threshold works", () => {
    const map = new Map<number, Parada[]>();
    // ~150m gap
    map.set(1000, [
      makeParada({ id: 1, variante: 1000, ordinal: 1, lat: -34.9000, lng: -56.200 }),
      makeParada({ id: 2, variante: 1000, ordinal: 2, lat: -34.9013, lng: -56.200 }),
    ]);
    // With default threshold it would pass, with 100m it should fail
    const removed = filterSuspiciousVariants(map, 100);
    expect(removed).toBe(1);
    expect(map.has(1000)).toBe(false);
  });

  it("exports expected constants", () => {
    expect(MAX_CONSECUTIVE_GAP_M).toBe(2000);
    expect(MIN_STOPS_PER_VARIANT).toBe(2);
  });
});

describe("DataIndexes.getParadasByVariante filters suspicious variants", () => {
  beforeEach(() => {
    _resetDataIndexes();
  });

  it("excludes variants with huge gaps", () => {
    const paradas: Parada[] = [
      // Good variant 1000
      makeParada({ id: 1, variante: 1000, ordinal: 1, lat: -34.900, lng: -56.200 }),
      makeParada({ id: 2, variante: 1000, ordinal: 2, lat: -34.901, lng: -56.201 }),
      // Bogus variant 9900 (~5km gap)
      makeParada({ id: 900, linea: "185", variante: 9900, ordinal: 1, lat: -34.918, lng: -56.167 }),
      makeParada({ id: 901, linea: "185", variante: 9900, ordinal: 2, lat: -34.873, lng: -56.182 }),
    ];

    const idx = getDataIndexes();
    expect(idx.getParadasByVariante(1000, paradas).length).toBe(2);
    expect(idx.getParadasByVariante(9900, paradas).length).toBe(0);
  });
});
