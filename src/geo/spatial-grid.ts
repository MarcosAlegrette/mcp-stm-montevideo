/**
 * Simple grid-based spatial index for fast nearest-neighbor lookups.
 * Groups lat/lng points into cells of ~550m, queries a 3×3 neighborhood (~1.6km radius).
 */

export interface GridPoint {
  lat: number;
  lng: number;
  index: number;
}

export interface SpatialGrid {
  cells: Map<string, GridPoint[]>;
  cellSize: number;
}

function cellKey(lat: number, lng: number, cellSize: number): string {
  const row = Math.floor(lat / cellSize);
  const col = Math.floor(lng / cellSize);
  return `${row}:${col}`;
}

/**
 * Build a spatial grid from an array of points with lat/lng.
 * Each point is stored with its original array index for fast lookup.
 *
 * @param points - Array of objects with lat and lng properties
 * @param cellSizeDeg - Cell size in degrees (~0.005° ≈ 550m at Montevideo's latitude)
 */
export function buildSpatialGrid(
  points: ReadonlyArray<{ lat: number; lng: number }>,
  cellSizeDeg = 0.005
): SpatialGrid {
  const cells = new Map<string, GridPoint[]>();
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const key = cellKey(p.lat, p.lng, cellSizeDeg);
    let arr = cells.get(key);
    if (!arr) {
      arr = [];
      cells.set(key, arr);
    }
    arr.push({ lat: p.lat, lng: p.lng, index: i });
  }
  return { cells, cellSize: cellSizeDeg };
}

/**
 * Get candidate points from the 3×3 cell neighborhood around a position.
 * Returns empty array if no points are nearby.
 */
export function getCandidates(
  grid: SpatialGrid,
  lat: number,
  lng: number
): GridPoint[] {
  const row = Math.floor(lat / grid.cellSize);
  const col = Math.floor(lng / grid.cellSize);
  const results: GridPoint[] = [];

  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const key = `${row + dr}:${col + dc}`;
      const cell = grid.cells.get(key);
      if (cell) {
        for (const p of cell) {
          results.push(p);
        }
      }
    }
  }

  return results;
}
