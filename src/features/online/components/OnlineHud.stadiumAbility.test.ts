import { redactedPhaseSchema } from "@luminous/schema";
import { describe, expect, it } from "vitest";

// D209 — the SECOND link of the `useStadiumAbility` refusal, asserted on the web
// because only the web can see it.
//
// The engine has driven a target-less Stadium activation since D102
// (`useStadiumAbility` — "once during each player's turn"), and the api withholds
// it from the DO allowlist (`MATCH_ACTION_DISPOSITION`). The reason recorded there
// is NOT "no card drives it" — Levincia sv09-150/sv10-244 and Spikemuth Gym
// sv10-169 are Standard-legal, in the registry, and reach a real match because
// deck load applies no format gate, so a player really can put one in play and
// really is denied its printed effect. The reason is "no client sends it", and
// that splits in two: the api asserts allowlist ⟺ a wire offer (a shared Stadium's
// playability is server state — `allowances.stadiumAbilityUsed`, `programPlayable`
// — so the offer must come down like `abilities`/`trainers` do), and THIS asserts
// wire offer ⟺ a control here.
//
// Chained, the two make the surface come first: the day the offer lands, this
// file demands the button; the day the button lands, this file demands the offer,
// and `match.test.ts` demands the allowlist entry behind it. That ordering is the
// whole lesson of D157 → D201, where an action went onto the allowlist ahead of
// its surface and soft-locked online matches for forty-four decisions.
//
// A SOURCE SCAN rather than a render, deliberately: the failure being guarded is
// "a control exists that dispatches this", and a rendered probe would have to
// guess which panel, which label and which enablement — a scan sees the dispatch
// wherever someone puts it. The tests themselves are excluded (naming an action
// in a spec is not an affordance a player can press), and the positive controls
// below fail loudly if the glob ever stops matching, because a scan that reads
// nothing agrees with everything (the vacuous guard of D200/D204/D205).

/** Every PRODUCTION source under `src/features/online`, as text. */
const ONLINE_SOURCES = import.meta.glob<string>(["../**/*.ts", "../**/*.tsx", "!../**/*.test.*"], {
  query: "?raw",
  import: "default",
  eager: true,
});

/** Does any of them dispatch the given engine action type? */
function onlineDispatches(actionType: string): boolean {
  return Object.values(ONLINE_SOURCES).some((source) => source.includes(`"${actionType}"`));
}

/** The `turn:action` arm's keys, read off the wire union rather than restated. */
function turnActionWireShape(): Record<string, unknown> {
  const arm = redactedPhaseSchema.options.find((option) => option.shape.kind.value === "turn:action");
  if (arm === undefined) throw new Error("the wire phase union has no turn:action arm");
  return arm.shape;
}

describe("the online client's Stadium-ability surface (D209)", () => {
  it("scans a real online surface — the controls it KNOWS are there", () => {
    // If the glob breaks or the feature dir moves, these go red rather than the
    // biconditional below quietly going true.
    expect(Object.keys(ONLINE_SOURCES).length).toBeGreaterThan(8);
    for (const surfaced of ["useAbility", "playTrainer", "rareCandy", "retreat", "concede"]) {
      expect(onlineDispatches(surfaced)).toBe(true);
    }
    // And a control that genuinely does not exist reads false, so the scan
    // discriminates rather than matching everything.
    expect(onlineDispatches("noSuchActionType")).toBe(false);
  });

  it("offers a Stadium activation EXACTLY when the wire carries one", () => {
    expect(onlineDispatches("useStadiumAbility")).toBe("stadiumAbility" in turnActionWireShape());
  });
});
