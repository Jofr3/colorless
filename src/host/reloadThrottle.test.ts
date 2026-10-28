import { describe, expect, it } from "vitest";
import { RELOAD_GAP_MS, reloadUnlessRecent } from "./reloadThrottle";

function session() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
}

describe("reloadUnlessRecent", () => {
  it("reloads once, then not again until the gap has passed", () => {
    const store = session();
    let reloads = 0;
    const reload = () => reloads++;
    const start = 1_700_000_000_000;
    expect(reloadUnlessRecent(() => store, reload, start)).toBe(true);
    expect(reloadUnlessRecent(() => store, reload, start + RELOAD_GAP_MS - 1)).toBe(false);
    expect(reloadUnlessRecent(() => store, reload, start + RELOAD_GAP_MS)).toBe(true);
    expect(reloads).toBe(2);
  });

  it("does not reload where it cannot remember having reloaded", () => {
    let reloads = 0;
    const blocked = () => {
      throw new DOMException("blocked", "SecurityError");
    };
    const full = () => ({
      getItem: () => null,
      setItem: () => {
        throw new DOMException("quota", "QuotaExceededError");
      },
    });
    expect(reloadUnlessRecent(blocked, () => reloads++)).toBe(false);
    expect(reloadUnlessRecent(full, () => reloads++)).toBe(false);
    expect(reloads).toBe(0);
  });
});
