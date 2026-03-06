/**
 * DataIndexes — singleton that lazily builds and caches lookup indexes
 * for paradas, horarios, and lineas data. Uses reference equality to detect
 * when CkanClient cache expires and data arrays change → auto-rebuild.
 */
import type { Parada } from "../types/parada.js";
import type { HorarioRow } from "../types/horario.js";
import type { LineaVariante } from "../types/linea.js";
import { buildSpatialGrid, type SpatialGrid } from "../geo/spatial-grid.js";
import { normalizeText } from "../geo/search.js";
import { fastDistMeters } from "../geo/distance.js";
import { log } from "../utils/log.js";

export const MAX_CONSECUTIVE_GAP_M = 2000;
export const MIN_STOPS_PER_VARIANT = 2;

/**
 * Remove variants with unrealistic gaps between consecutive stops.
 * Mutates the map in place. Returns count of removed variants.
 */
export function filterSuspiciousVariants(
  map: Map<number, Parada[]>,
  maxGapMeters = MAX_CONSECUTIVE_GAP_M,
  minStops = MIN_STOPS_PER_VARIANT
): number {
  let removed = 0;
  for (const [codVariante, stops] of map) {
    if (stops.length < minStops) {
      log.warn(`Variant ${codVariante}: removed (only ${stops.length} stop(s))`);
      map.delete(codVariante);
      removed++;
      continue;
    }
    let suspicious = false;
    for (let i = 1; i < stops.length; i++) {
      const gap = fastDistMeters(stops[i - 1].lat, stops[i - 1].lng, stops[i].lat, stops[i].lng);
      if (gap > maxGapMeters) {
        log.warn(`Variant ${codVariante} (${stops[0].linea}): ${Math.round(gap)}m gap between stops ${stops[i - 1].id}→${stops[i].id}, removed`);
        suspicious = true;
        break;
      }
    }
    if (suspicious) {
      map.delete(codVariante);
      removed++;
    }
  }
  return removed;
}

// --- Normalized parada fields ---
export interface NormalizedParadaFields {
  calle: string;
  esquina: string;
  linea: string;
}

// --- LookupMaps (used by como-llegar) ---
export interface LookupMaps {
  variantesByParadaId: Map<number, Set<number>>;
  paradasByVariante: Map<number, Parada[]>;
  paradaForVariante: Map<string, Parada>; // `${id}:${variante}` → Parada
  lineasMap: Map<number, LineaVariante>;
}

class DataIndexes {
  // Spatial grid for paradas
  private _paradasGrid: SpatialGrid | null = null;
  private _paradasRef: Parada[] | null = null;

  // Schedule indexes
  private _horariosByParada: Map<number, HorarioRow[]> | null = null;
  private _horariosByVariante: Map<number, HorarioRow[]> | null = null;
  private _horariosRef: HorarioRow[] | null = null;

  // Parada indexes
  private _paradasByVariante: Map<number, Parada[]> | null = null;
  private _paradasByVarianteRef: Parada[] | null = null;

  // Pre-normalized text
  private _normalizedCache: Map<Parada, NormalizedParadaFields> | null = null;
  private _normalizedRef: Parada[] | null = null;

  // como-llegar lookup maps
  private _lookupMaps: LookupMaps | null = null;
  private _lookupMapsParadasRef: Parada[] | null = null;
  private _lookupMapsLineasRef: LineaVariante[] | null = null;

  // --- Staleness check helpers ---

  private ensureHorariosIndexes(horarios: HorarioRow[]): void {
    if (this._horariosRef === horarios) return;
    this._horariosRef = horarios;

    const byParada = new Map<number, HorarioRow[]>();
    const byVariante = new Map<number, HorarioRow[]>();

    for (const h of horarios) {
      let pArr = byParada.get(h.cod_ubic_parada);
      if (!pArr) {
        pArr = [];
        byParada.set(h.cod_ubic_parada, pArr);
      }
      pArr.push(h);

      let vArr = byVariante.get(h.cod_variante);
      if (!vArr) {
        vArr = [];
        byVariante.set(h.cod_variante, vArr);
      }
      vArr.push(h);
    }

    this._horariosByParada = byParada;
    this._horariosByVariante = byVariante;
  }

  private ensureParadasByVariante(paradas: Parada[]): void {
    if (this._paradasByVarianteRef === paradas) return;
    this._paradasByVarianteRef = paradas;

    const map = new Map<number, Parada[]>();
    for (const p of paradas) {
      let arr = map.get(p.variante);
      if (!arr) {
        arr = [];
        map.set(p.variante, arr);
      }
      arr.push(p);
    }
    // Sort each variant's stops by ordinal
    for (const stops of map.values()) {
      stops.sort((a, b) => a.ordinal - b.ordinal);
    }
    filterSuspiciousVariants(map);
    this._paradasByVariante = map;
  }

  private ensureParadasGrid(paradas: Parada[]): void {
    if (this._paradasRef === paradas) return;
    this._paradasRef = paradas;
    this._paradasGrid = buildSpatialGrid(paradas);
  }

  private ensureNormalized(paradas: Parada[]): void {
    if (this._normalizedRef === paradas) return;
    this._normalizedRef = paradas;

    const cache = new Map<Parada, NormalizedParadaFields>();
    for (const p of paradas) {
      cache.set(p, {
        calle: normalizeText(p.calle),
        esquina: normalizeText(p.esquina),
        linea: normalizeText(p.linea),
      });
    }
    this._normalizedCache = cache;
  }

  private ensureLookupMaps(paradas: Parada[], lineas: LineaVariante[]): void {
    if (this._lookupMapsParadasRef === paradas && this._lookupMapsLineasRef === lineas) return;
    this._lookupMapsParadasRef = paradas;
    this._lookupMapsLineasRef = lineas;

    // Reuse paradasByVariante if already built for same data
    this.ensureParadasByVariante(paradas);

    const variantesByParadaId = new Map<number, Set<number>>();
    const paradaForVariante = new Map<string, Parada>();

    for (const p of paradas) {
      let set = variantesByParadaId.get(p.id);
      if (!set) {
        set = new Set();
        variantesByParadaId.set(p.id, set);
      }
      set.add(p.variante);
      paradaForVariante.set(`${p.id}:${p.variante}`, p);
    }

    const lineasMap = new Map<number, LineaVariante>();
    for (const lv of lineas) lineasMap.set(lv.codVariante, lv);

    this._lookupMaps = {
      variantesByParadaId,
      paradasByVariante: this._paradasByVariante!,
      paradaForVariante,
      lineasMap,
    };
  }

  // --- Public API ---

  getHorariosByParada(paradaId: number, horarios: HorarioRow[]): HorarioRow[] {
    this.ensureHorariosIndexes(horarios);
    return this._horariosByParada!.get(paradaId) ?? [];
  }

  getHorariosByVariante(codVariante: number, horarios: HorarioRow[]): HorarioRow[] {
    this.ensureHorariosIndexes(horarios);
    return this._horariosByVariante!.get(codVariante) ?? [];
  }

  getParadasByVariante(codVariante: number, paradas: Parada[]): Parada[] {
    this.ensureParadasByVariante(paradas);
    return this._paradasByVariante!.get(codVariante) ?? [];
  }

  getParadasGrid(paradas: Parada[]): SpatialGrid {
    this.ensureParadasGrid(paradas);
    return this._paradasGrid!;
  }

  getNormalized(parada: Parada, paradas: Parada[]): NormalizedParadaFields {
    this.ensureNormalized(paradas);
    return this._normalizedCache!.get(parada) ?? {
      calle: normalizeText(parada.calle),
      esquina: normalizeText(parada.esquina),
      linea: normalizeText(parada.linea),
    };
  }

  getLookupMaps(paradas: Parada[], lineas: LineaVariante[]): LookupMaps {
    this.ensureLookupMaps(paradas, lineas);
    return this._lookupMaps!;
  }
}

let _instance: DataIndexes | null = null;

export function getDataIndexes(): DataIndexes {
  if (!_instance) _instance = new DataIndexes();
  return _instance;
}

/** Reset singleton (for testing). */
export function _resetDataIndexes(): void {
  _instance = null;
}
