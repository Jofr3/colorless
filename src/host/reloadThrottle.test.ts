import { describe, expect, it } from "vitest";
import { RELOAD_GAP_MS, reloadUnlessRecent } from "./reloadThrottle";
import { fullStorage, memoryStorage } from "../test/storageStub";

describe("reloadUnlessRecent", () => {
  it("reloads once, then not again until the gap has passed", () => {
    const store = memoryStorage();
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
    expect(reloadUnlessRecent(blocked, () => reloads++)).toBe(false);
    expect(reloadUnlessRecent(fullStorage, () => reloads++)).toBe(false);
    expect(reloads).toBe(0);
  });
});
