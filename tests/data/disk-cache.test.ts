import { describe, it, expect, afterAll } from "vitest";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getCacheDir, readDiskCache, writeDiskCache } from "../../src/data/disk-cache.js";

// Use a temp directory for all tests to avoid polluting the real cache
const TEST_CACHE_DIR = join(tmpdir(), `mcp-stm-disk-test-${process.pid}`);
const origXdg = process.env.XDG_CACHE_HOME;

// Set XDG_CACHE_HOME for the entire test file
process.env.XDG_CACHE_HOME = TEST_CACHE_DIR;

afterAll(() => {
  if (origXdg === undefined) {
    delete process.env.XDG_CACHE_HOME;
  } else {
    process.env.XDG_CACHE_HOME = origXdg;
  }
  if (existsSync(TEST_CACHE_DIR)) {
    rmSync(TEST_CACHE_DIR, { recursive: true, force: true });
  }
});

describe("getCacheDir", () => {
  it("creates cache directory if it doesn't exist", () => {
    const dir = getCacheDir();
    expect(existsSync(dir)).toBe(true);
    expect(dir).toContain("mcp-stm-montevideo");
  });

  it("respects XDG_CACHE_HOME", () => {
    const dir = getCacheDir();
    expect(dir.startsWith(TEST_CACHE_DIR)).toBe(true);
  });

  it("returns same path on repeated calls", () => {
    const dir1 = getCacheDir();
    const dir2 = getCacheDir();
    expect(dir1).toBe(dir2);
  });
});

describe("writeDiskCache + readDiskCache", () => {
  it("writes and reads back data correctly", () => {
    const data = [{ id: 1, name: "test" }];
    writeDiskCache("test-data.json", data);
    const result = readDiskCache<typeof data>("test-data.json", 60_000);
    expect(result).toEqual(data);
  });

  it("returns null when file doesn't exist", () => {
    const result = readDiskCache("nonexistent.json", 60_000);
    expect(result).toBeNull();
  });

  it("returns null when data is expired", () => {
    const data = { value: 42 };
    writeDiskCache("expired.json", data);

    const dir = getCacheDir();
    const metaPath = join(dir, "expired.meta.json");
    writeFileSync(metaPath, JSON.stringify({ savedAt: Date.now() - 120_000 }), "utf-8");

    const result = readDiskCache("expired.json", 60_000);
    expect(result).toBeNull();
  });

  it("returns data when not yet expired", () => {
    const data = { value: 42 };
    writeDiskCache("fresh.json", data);
    const result = readDiskCache("fresh.json", 60_000);
    expect(result).toEqual(data);
  });

  it("creates both data and meta files", () => {
    writeDiskCache("check-files.json", { a: 1 });
    const dir = getCacheDir();
    expect(existsSync(join(dir, "check-files.json"))).toBe(true);
    expect(existsSync(join(dir, "check-files.meta.json"))).toBe(true);
  });

  it("meta file contains savedAt timestamp", () => {
    const before = Date.now();
    writeDiskCache("meta-check.json", {});
    const after = Date.now();

    const dir = getCacheDir();
    const meta = JSON.parse(readFileSync(join(dir, "meta-check.meta.json"), "utf-8"));
    expect(meta.savedAt).toBeGreaterThanOrEqual(before);
    expect(meta.savedAt).toBeLessThanOrEqual(after);
  });

  it("handles large arrays (horarios-like)", () => {
    const rows = Array.from({ length: 1_000 }, (_, i) => [1, i, 5000, i + 100, 1, 500, "N"]);
    writeDiskCache("large.json", rows);
    const result = readDiskCache<unknown[][]>("large.json", 60_000);
    expect(result).toHaveLength(1_000);
    expect(result![0]).toEqual([1, 0, 5000, 100, 1, 500, "N"]);
  });
});

describe("minLength validation", () => {
  it("writeDiskCache skips write when array is too short", () => {
    const data = [{ id: 1 }, { id: 2 }];
    writeDiskCache("too-small.json", data, 100);
    const result = readDiskCache("too-small.json", 60_000);
    expect(result).toBeNull();
  });

  it("writeDiskCache writes when array meets minimum", () => {
    const data = Array.from({ length: 100 }, (_, i) => ({ id: i }));
    writeDiskCache("big-enough.json", data, 100);
    const result = readDiskCache<typeof data>("big-enough.json", 60_000);
    expect(result).toHaveLength(100);
  });

  it("readDiskCache discards poisoned cache below minLength", () => {
    // Write without minLength (simulating old code or direct poisoning)
    writeDiskCache("poisoned.json", [{ id: 1 }]);
    // Read with minLength — should discard
    const result = readDiskCache("poisoned.json", 60_000, 100);
    expect(result).toBeNull();
  });

  it("readDiskCache returns data when above minLength", () => {
    const data = Array.from({ length: 50 }, (_, i) => ({ id: i }));
    writeDiskCache("ok-size.json", data);
    const result = readDiskCache<typeof data>("ok-size.json", 60_000, 10);
    expect(result).toHaveLength(50);
  });

  it("minLength is ignored for non-array data", () => {
    writeDiskCache("object.json", { key: "value" }, 100);
    const result = readDiskCache("object.json", 60_000, 100);
    expect(result).toEqual({ key: "value" });
  });
});

describe("error handling", () => {
  it("writeDiskCache silently fails on invalid dir", () => {
    const saved = process.env.XDG_CACHE_HOME;
    // /dev/null is a file, not a dir — mkdirSync will fail
    process.env.XDG_CACHE_HOME = "/dev/null";
    expect(() => writeDiskCache("test.json", {})).not.toThrow();
    process.env.XDG_CACHE_HOME = saved;
  });

  it("readDiskCache returns null on corrupted data file", () => {
    const dir = getCacheDir();
    writeFileSync(join(dir, "corrupt.json"), "not valid json{{{", "utf-8");
    writeFileSync(join(dir, "corrupt.meta.json"), JSON.stringify({ savedAt: Date.now() }), "utf-8");
    const result = readDiskCache("corrupt.json", 60_000);
    expect(result).toBeNull();
  });

  it("readDiskCache returns null on corrupted meta file", () => {
    const dir = getCacheDir();
    writeFileSync(join(dir, "bad-meta.json"), JSON.stringify({ ok: true }), "utf-8");
    writeFileSync(join(dir, "bad-meta.meta.json"), "broken", "utf-8");
    const result = readDiskCache("bad-meta.json", 60_000);
    expect(result).toBeNull();
  });

  it("readDiskCache returns null when only data file exists (no meta)", () => {
    const dir = getCacheDir();
    writeFileSync(join(dir, "no-meta.json"), JSON.stringify({ x: 1 }), "utf-8");
    const result = readDiskCache("no-meta.json", 60_000);
    expect(result).toBeNull();
  });
});
