import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { log } from "../utils/log.js";

interface DiskCacheMeta {
  savedAt: number;
}

/**
 * Returns the disk cache directory, creating it if needed.
 * Respects XDG_CACHE_HOME on Linux.
 */
export function getCacheDir(): string {
  const base = process.env.XDG_CACHE_HOME || join(homedir(), ".cache");
  const dir = join(base, "mcp-stm-montevideo");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Write data to the disk cache with a metadata sidecar file.
 * If minLength is set and data is an array shorter than that, the write is
 * skipped to prevent poisoning the cache with partial/test data.
 * Silently fails on any I/O error.
 */
export function writeDiskCache(filename: string, data: unknown, minLength?: number): void {
  try {
    if (minLength != null && Array.isArray(data) && data.length < minLength) {
      log.warn(`Disk cache: refusing to write ${filename} — only ${data.length} rows (min ${minLength})`);
      return;
    }
    const dir = getCacheDir();
    const dataPath = join(dir, filename);
    const metaPath = join(dir, filename.replace(/\.json$/, ".meta.json"));
    writeFileSync(dataPath, JSON.stringify(data), "utf-8");
    const meta: DiskCacheMeta = { savedAt: Date.now() };
    writeFileSync(metaPath, JSON.stringify(meta), "utf-8");
  } catch {
    // Silently fall through — disk cache is best-effort
  }
}

/**
 * Read data from the disk cache if it exists and hasn't expired.
 * If minLength is set and the parsed data is an array shorter than that,
 * the cache entry is treated as poisoned and discarded.
 * Returns null if missing, expired, poisoned, or unreadable.
 */
export function readDiskCache<T>(filename: string, ttlMs: number, minLength?: number): T | null {
  try {
    const dir = getCacheDir();
    const dataPath = join(dir, filename);
    const metaPath = join(dir, filename.replace(/\.json$/, ".meta.json"));

    if (!existsSync(dataPath) || !existsSync(metaPath)) return null;

    const metaRaw = readFileSync(metaPath, "utf-8");
    const meta = JSON.parse(metaRaw) as DiskCacheMeta;

    if (meta.savedAt + ttlMs < Date.now()) return null;

    const dataRaw = readFileSync(dataPath, "utf-8");
    const parsed = JSON.parse(dataRaw) as T;

    if (minLength != null && Array.isArray(parsed) && parsed.length < minLength) {
      log.warn(`Disk cache: discarding ${filename} — only ${parsed.length} rows (min ${minLength})`);
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}
