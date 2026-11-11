import { afterEach, describe, expect, it, vi } from "vitest";
import { readPersisted, removePersisted, writePersisted } from "./persistedState";
import { memoryStorage, throwingStorage } from "../test/storageStub";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("readPersisted", () => {
  it("returns the parsed value when the key is present and valid", () => {
    vi.stubGlobal("localStorage", memoryStorage({ k: "1" }));
    expect(readPersisted("k", (raw) => raw === "1", false)).toBe(true);
  });

  it("falls back when the key is absent", () => {
    vi.stubGlobal("localStorage", memoryStorage());
    expect(readPersisted("missing", (raw) => raw, "default")).toBe("default");
  });

  it("falls back when parse rejects the stored value (undefined)", () => {
    vi.stubGlobal("localStorage", memoryStorage({ k: "bogus" }));
    const parse = (raw: string) => (raw === "ok" ? raw : undefined);
    expect(readPersisted("k", parse, "default")).toBe("default");
  });

  it("falls back when storage throws", () => {
    vi.stubGlobal("localStorage", throwingStorage());
    expect(readPersisted("k", (raw) => raw, "default")).toBe("default");
  });
});

describe("writePersisted", () => {
  it("stores the value", () => {
    const storage = memoryStorage();
    vi.stubGlobal("localStorage", storage);
    expect(writePersisted("k", "v")).toBe(true);
    expect(storage.getItem("k")).toBe("v");
  });

  it("swallows a throwing setItem and reports it", () => {
    vi.stubGlobal("localStorage", throwingStorage());
    expect(writePersisted("k", "v")).toBe(false);
  });
});

describe("removePersisted", () => {
  it("removes the value", () => {
    const storage = memoryStorage({ k: "v" });
    vi.stubGlobal("localStorage", storage);
    removePersisted("k");
    expect(storage.getItem("k")).toBeNull();
  });

  it("swallows a throwing removeItem", () => {
    vi.stubGlobal("localStorage", {
      ...throwingStorage(),
      removeItem: () => {
        throw new Error("storage blocked");
      },
    });
    expect(() => removePersisted("k")).not.toThrow();
  });
});
