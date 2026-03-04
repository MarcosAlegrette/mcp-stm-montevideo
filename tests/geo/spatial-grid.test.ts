import { describe, it, expect } from "vitest";
import { buildSpatialGrid, getCandidates } from "../../src/geo/spatial-grid.js";

describe("buildSpatialGrid", () => {
  it("groups points into cells", () => {
    // floor(-34.898/0.005) = floor(-6979.6) = -6980
    // floor(-34.899/0.005) = floor(-6979.8) = -6980 → same row
    // floor(-56.148/0.005) = floor(-11229.6) = -11230
    // floor(-56.149/0.005) = floor(-11229.8) = -11230 → same col
    const points = [
      { lat: -34.898, lng: -56.148 },
      { lat: -34.899, lng: -56.149 }, // same cell as above
      { lat: -34.950, lng: -56.200 }, // different cell
    ];
    const grid = buildSpatialGrid(points);

    // First two in same cell, third in a different cell
    expect(grid.cells.size).toBe(2);
    expect(grid.cellSize).toBe(0.005);
  });

  it("preserves original indices", () => {
    const points = [
      { lat: -34.900, lng: -56.150 },
      { lat: -34.950, lng: -56.200 },
    ];
    const grid = buildSpatialGrid(points);

    const allPoints = Array.from(grid.cells.values()).flat();
    const indices = allPoints.map((p) => p.index).sort();
    expect(indices).toEqual([0, 1]);
  });

  it("handles empty input", () => {
    const grid = buildSpatialGrid([]);
    expect(grid.cells.size).toBe(0);
  });

  it("respects custom cell size", () => {
    const points = [
      { lat: -34.900, lng: -56.150 },
      { lat: -34.901, lng: -56.151 },
    ];
    // With a very small cell size, these should be in different cells
    const grid = buildSpatialGrid(points, 0.0005);
    expect(grid.cells.size).toBe(2);
  });
});

describe("getCandidates", () => {
  it("returns points in the same cell", () => {
    const points = [
      { lat: -34.900, lng: -56.150 },
      { lat: -34.901, lng: -56.151 },
    ];
    const grid = buildSpatialGrid(points);
    const candidates = getCandidates(grid, -34.900, -56.150);

    expect(candidates.length).toBe(2);
  });

  it("returns points from neighboring cells", () => {
    const points = [
      { lat: -34.900, lng: -56.150 },
      { lat: -34.905, lng: -56.155 }, // adjacent cell
    ];
    const grid = buildSpatialGrid(points);
    const candidates = getCandidates(grid, -34.902, -56.152);

    expect(candidates.length).toBe(2);
  });

  it("returns empty for far-away queries", () => {
    const points = [
      { lat: -34.900, lng: -56.150 },
    ];
    const grid = buildSpatialGrid(points);
    // Query point ~5km away
    const candidates = getCandidates(grid, -34.950, -56.200);

    expect(candidates.length).toBe(0);
  });

  it("returns empty for empty grid", () => {
    const grid = buildSpatialGrid([]);
    const candidates = getCandidates(grid, -34.900, -56.150);

    expect(candidates.length).toBe(0);
  });

  it("candidate indices map back to original array", () => {
    const points = [
      { lat: -34.900, lng: -56.150 },
      { lat: -34.901, lng: -56.151 },
      { lat: -34.950, lng: -56.200 }, // far away
    ];
    const grid = buildSpatialGrid(points);
    const candidates = getCandidates(grid, -34.900, -56.150);

    // Should only return indices 0 and 1, not 2
    const indices = candidates.map((c) => c.index).sort();
    expect(indices).toEqual([0, 1]);

    // Verify coordinates match original
    for (const c of candidates) {
      expect(c.lat).toBe(points[c.index].lat);
      expect(c.lng).toBe(points[c.index].lng);
    }
  });
});
