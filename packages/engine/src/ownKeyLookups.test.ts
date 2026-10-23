import { describe, expect, it } from "vitest";
import { bannerOfId } from "./banners";
import { cardOfUid } from "./cards";
import { programFor } from "./registry";
import type { GameState } from "./types";

describe("lookups keyed by outside strings", () => {
  const inherited = ["toString", "constructor", "__proto__", "hasOwnProperty"];

  it("programFor ignores inherited keys", () => {
    for (const key of inherited) expect(programFor(key)).toBeUndefined();
  });

  it("bannerOfId ignores inherited keys", () => {
    for (const key of inherited) expect(bannerOfId(key)).toBeUndefined();
  });

  it("cardOfUid ignores inherited keys", () => {
    const state = { cardIdByUid: {}, cardPool: {} } as unknown as GameState;
    for (const key of inherited) expect(cardOfUid(state, key)).toBeUndefined();
  });
});
