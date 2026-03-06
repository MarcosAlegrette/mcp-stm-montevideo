import { describe, it, expect, beforeEach } from "vitest";
import type { Parada } from "../../src/types/parada.js";
import {
  filterSuspiciousVariants,
  MAX_CONSECUTIVE_GAP_M,
  MIN_STOPS_PER_VARIANT,
  GHOST_STOP_IDS,
  BLOCKED_LINE_PREFIXES,
  BLOCKED_LINE_NAMES,
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

  it("removes variant with >2.5km consecutive gap", () => {
    const map = new Map<number, Parada[]>();
    // ~5.3km gap between stops
    map.set(9900, [
      makeParada({ id: 900, linea: "185", variante: 9900, ordinal: 1, lat: -34.918, lng: -56.167 }),
      makeParada({ id: 901, linea: "185", variante: 9900, ordinal: 2, lat: -34.873, lng: -56.182 }),
    ]);
    const removed = filterSuspiciousVariants(map);
    expect(removed).toBe(1);
    expect(map.has(9900)).toBe(false);
  });

  it("keeps variant with 2076m gap (under 2500m threshold)", () => {
    const map = new Map<number, Parada[]>();
    // Two stops ~2076m apart (within 2500m threshold)
    // 2076m ≈ 0.0187° latitude
    map.set(2379, [
      makeParada({ id: 10, linea: "L1", variante: 2379, ordinal: 1, lat: -34.900, lng: -56.200 }),
      makeParada({ id: 11, linea: "L1", variante: 2379, ordinal: 2, lat: -34.8813, lng: -56.200 }),
    ]);
    const removed = filterSuspiciousVariants(map);
    expect(removed).toBe(0);
    expect(map.has(2379)).toBe(true);
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
    expect(MAX_CONSECUTIVE_GAP_M).toBe(2500);
    expect(MIN_STOPS_PER_VARIANT).toBe(2);
  });

  // --- Ghost stop tests ---

  it("removes ghost stop from variant mid-route (variant kept, stop gone)", () => {
    const map = new Map<number, Parada[]>();
    map.set(1000, [
      makeParada({ id: 100, variante: 1000, ordinal: 1, lat: -34.900, lng: -56.200 }),
      makeParada({ id: 6806, variante: 1000, ordinal: 2, lat: -34.901, lng: -56.201 }),
      makeParada({ id: 200, variante: 1000, ordinal: 3, lat: -34.902, lng: -56.202 }),
    ]);
    const removed = filterSuspiciousVariants(map);
    expect(removed).toBe(0);
    expect(map.has(1000)).toBe(true);
    const stops = map.get(1000)!;
    expect(stops.length).toBe(2);
    expect(stops.every((s) => s.id !== 6806)).toBe(true);
  });

  it("removes entire variant when ghost stop is ordinal 1 (origin)", () => {
    const map = new Map<number, Parada[]>();
    map.set(3804, [
      makeParada({ id: 6806, linea: "185", variante: 3804, ordinal: 1, lat: -34.900, lng: -56.200 }),
      makeParada({ id: 200, linea: "185", variante: 3804, ordinal: 2, lat: -34.901, lng: -56.201 }),
      makeParada({ id: 300, linea: "185", variante: 3804, ordinal: 3, lat: -34.902, lng: -56.202 }),
    ]);
    const removed = filterSuspiciousVariants(map);
    expect(removed).toBe(1);
    expect(map.has(3804)).toBe(false);
  });

  // --- Line name blocklist tests ---

  it("removes BT line by prefix", () => {
    const map = new Map<number, Parada[]>();
    map.set(7000, [
      makeParada({ id: 1, linea: "BT1", variante: 7000, ordinal: 1, lat: -34.900, lng: -56.200 }),
      makeParada({ id: 2, linea: "BT1", variante: 7000, ordinal: 2, lat: -34.901, lng: -56.201 }),
    ]);
    map.set(7001, [
      makeParada({ id: 3, linea: "BT4", variante: 7001, ordinal: 1, lat: -34.900, lng: -56.200 }),
      makeParada({ id: 4, linea: "BT4", variante: 7001, ordinal: 2, lat: -34.901, lng: -56.201 }),
    ]);
    const removed = filterSuspiciousVariants(map);
    expect(removed).toBe(2);
    expect(map.size).toBe(0);
  });

  it("removes M-A line by exact name", () => {
    const map = new Map<number, Parada[]>();
    map.set(8000, [
      makeParada({ id: 1, linea: "M-A", variante: 8000, ordinal: 1, lat: -34.900, lng: -56.200 }),
      makeParada({ id: 2, linea: "M-A", variante: 8000, ordinal: 2, lat: -34.901, lng: -56.201 }),
    ]);
    const removed = filterSuspiciousVariants(map);
    expect(removed).toBe(1);
    expect(map.has(8000)).toBe(false);
  });

  // --- SD exemption tests ---

  it("exempts SD lines from gap filter", () => {
    const map = new Map<number, Parada[]>();
    // SD line with a 4km gap — should be kept (semidirecto)
    map.set(6000, [
      makeParada({ id: 1, linea: "124 SD", variante: 6000, ordinal: 1, lat: -34.900, lng: -56.200 }),
      makeParada({ id: 2, linea: "124 SD", variante: 6000, ordinal: 2, lat: -34.864, lng: -56.200 }),
    ]);
    const removed = filterSuspiciousVariants(map);
    expect(removed).toBe(0);
    expect(map.has(6000)).toBe(true);
  });

  it("does not exempt non-SD lines from gap filter", () => {
    const map = new Map<number, Parada[]>();
    // Regular line with same 4km gap — should be removed
    map.set(6001, [
      makeParada({ id: 1, linea: "124", variante: 6001, ordinal: 1, lat: -34.900, lng: -56.200 }),
      makeParada({ id: 2, linea: "124", variante: 6001, ordinal: 2, lat: -34.864, lng: -56.200 }),
    ]);
    const removed = filterSuspiciousVariants(map);
    expect(removed).toBe(1);
    expect(map.has(6001)).toBe(false);
  });

  // --- Exports ---

  it("exports ghost stop and blocklist constants", () => {
    expect(GHOST_STOP_IDS).toBeInstanceOf(Set);
    expect(GHOST_STOP_IDS.has(6806)).toBe(true);
    expect(BLOCKED_LINE_PREFIXES).toContain("BT");
    expect(BLOCKED_LINE_NAMES).toContain("M-A");
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

  it("excludes ghost-stop-origin variants via DataIndexes", () => {
    const paradas: Parada[] = [
      makeParada({ id: 6806, linea: "185", variante: 3804, ordinal: 1, lat: -34.900, lng: -56.200 }),
      makeParada({ id: 200, linea: "185", variante: 3804, ordinal: 2, lat: -34.901, lng: -56.201 }),
      // Good variant
      makeParada({ id: 1, variante: 1000, ordinal: 1, lat: -34.900, lng: -56.200 }),
      makeParada({ id: 2, variante: 1000, ordinal: 2, lat: -34.901, lng: -56.201 }),
    ];

    const idx = getDataIndexes();
    expect(idx.getParadasByVariante(3804, paradas).length).toBe(0);
    expect(idx.getParadasByVariante(1000, paradas).length).toBe(2);
  });
});

describe("integration: real CKAN data filtering", () => {
  const shouldRun = process.env.SKIP_INTEGRATION === "false";

  it.skipIf(!shouldRun)("validates ghost stops, blocked lines, and SD exemptions in real data", async () => {
    const { createCkanClient } = await import("../../src/data/ckan-client.js");
    const client = createCkanClient();
    const paradas = await client.getParadas();

    // Build paradasByVariante map
    const map = new Map<number, Parada[]>();
    for (const p of paradas) {
      let arr = map.get(p.variante);
      if (!arr) {
        arr = [];
        map.set(p.variante, arr);
      }
      arr.push(p);
    }
    for (const stops of map.values()) {
      stops.sort((a, b) => a.ordinal - b.ordinal);
    }
    filterSuspiciousVariants(map);

    // Ghost stop 6806 should not appear in any variant's stops
    for (const [, stops] of map) {
      for (const s of stops) {
        expect(s.id, `Ghost stop 6806 found in variant`).not.toBe(6806);
      }
    }

    // Teatro variants should be gone
    expect(map.has(3804)).toBe(false); // 185 teatro
    expect(map.has(3733)).toBe(false); // G teatro

    // 124 SD variants should be present
    let has124SD = false;
    for (const [, stops] of map) {
      if (stops[0]?.linea === "124 SD") {
        has124SD = true;
        break;
      }
    }
    expect(has124SD, "124 SD should not be filtered").toBe(true);

    // L1 variant 2379 should be present
    expect(map.has(2379), "L1 variant 2379 should not be filtered").toBe(true);

    // No BT* or M-A variants
    for (const [codVariante, stops] of map) {
      const linea = stops[0]?.linea ?? "";
      expect(linea.startsWith("BT"), `BT variant ${codVariante} should be filtered`).toBe(false);
      expect(linea, `M-A variant ${codVariante} should be filtered`).not.toBe("M-A");
    }
  });
});
