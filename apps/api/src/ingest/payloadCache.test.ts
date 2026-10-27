import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPayloadCache } from "./payloadCache";

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "payload-cache-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("createPayloadCache", () => {
  it("reads back what it wrote, per kind and id", () => {
    const cache = createPayloadCache({ dir: tempDir(), maxAgeMs: 1000 });
    cache.write("card", "sv01-001", { id: "sv01-001", hp: 70 });
    cache.write("set", "sv01-001", { id: "set" });
    expect(cache.read("card", "sv01-001")).toEqual({ id: "sv01-001", hp: 70 });
    expect(cache.read("set", "sv01-001")).toEqual({ id: "set" });
    expect(cache.read("card", "sv01-002")).toBeUndefined();
  });

  it("drops entries older than the allowed age", () => {
    let now = 10_000;
    const cache = createPayloadCache({ dir: tempDir(), maxAgeMs: 1000, now: () => now });
    cache.write("card", "a", { id: "a" });
    now += 1000;
    expect(cache.read("card", "a")).toEqual({ id: "a" });
    now += 1;
    expect(cache.read("card", "a")).toBeUndefined();
  });

  it("treats an unreadable entry as absent", () => {
    const dir = tempDir();
    const cache = createPayloadCache({ dir, maxAgeMs: 1000 });
    cache.write("card", "a", { id: "a" });
    const [file] = readdirSync(join(dir, "card"));
    writeFileSync(join(dir, "card", file ?? ""), "{not json");
    expect(cache.read("card", "a")).toBeUndefined();
  });

  it("keeps hostile ids inside their kind's directory", () => {
    const dir = tempDir();
    const cache = createPayloadCache({ dir, maxAgeMs: 1000 });
    cache.write("card", "../../escape", { id: "x" });
    expect(readdirSync(dir)).toEqual(["card"]);
    expect(cache.read("card", "../../escape")).toEqual({ id: "x" });
  });
});
