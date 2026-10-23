import { describe, expect, it, vi } from "vitest";
import { FIXTURE_REGISTRY } from "./fixtures/registry";
import { programFor, registryCardIds } from "./registry";

const fixtureIds = Object.keys(FIXTURE_REGISTRY);

/** A registry module the setup file has not touched, as production loads it. */
async function freshRegistry(): Promise<typeof import("./registry")> {
  vi.resetModules();
  return import("./registry");
}

describe("the fixture programs stay out of the production registry", () => {
  it("an unregistered registry module programs no fix-* id", async () => {
    const fresh = await freshRegistry();
    expect(fresh.registryCardIds().filter((id) => id.startsWith("fix-"))).toEqual([]);
    for (const id of fixtureIds) expect(fresh.programFor(id), id).toBeUndefined();
    expect(fresh.registryCardIds()).toHaveLength(registryCardIds().length - fixtureIds.length);
  });

  it("every fixture program is keyed fix-* and the setup file installed each one", () => {
    expect(fixtureIds.length).toBeGreaterThan(0);
    expect(fixtureIds.filter((id) => !id.startsWith("fix-"))).toEqual([]);
    expect(registryCardIds().slice(-fixtureIds.length)).toEqual(fixtureIds);
    for (const id of fixtureIds) expect(programFor(id), id).toBe(FIXTURE_REGISTRY[id]);
  });

  it("refuses a test program under an id the production registry programs", async () => {
    const fresh = await freshRegistry();
    expect(() => fresh.registerTestPrograms({ "sv01-189": {} })).toThrow(/sv01-189/);
  });

  it("the package index does not export registerTestPrograms", async () => {
    expect(Object.keys(await import("./index"))).not.toContain("registerTestPrograms");
  });
});
