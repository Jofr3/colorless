import { redactedPhaseSchema } from "@luminous/schema";
import { describe, expect, it } from "vitest";

// D209 — the SECOND link of the `useStadiumAbility` coupling, asserted on the web
// because only the web can see it. **D210 CLOSED THE GAP; THIS FILE DID NOT
// CHANGE DIRECTION, IT CHANGED VALUE.**
//
// The engine has driven a target-less Stadium activation since D102
// (`useStadiumAbility` — "once during each player's turn"). D209 established that
// the api withheld it from the DO allowlist (`MATCH_ACTION_DISPOSITION`) for the
// only defensible reason — "no client sends it" — and NOT the reason on record,
// which had rotted: Levincia sv09-150/sv10-244 and Spikemuth Gym sv10-169 are
// Standard-legal (regulation I), in the registry, and reach a real match because
// deck load applies no format gate, so a player really could put one in play and
// really was denied its printed effect. That refusal split in two links: the api
// asserts allowlist ⟺ a wire offer (a shared Stadium's playability is server
// state — `allowances.stadiumAbilityUsed`, `programPlayable` — so the offer must
// come down like `abilities`/`trainers` do), and THIS asserts wire offer ⟺ a
// control here.
//
// D210 landed all four steps in D209's order — the redactor's fold, the wire
// member, the control below, then the allowlist flip — so both links now read
// TRUE ⟺ TRUE where they read false ⟺ false. The assertion is untouched on
// purpose: a biconditional that has to be rewritten when the answer changes was
// never a biconditional. Ship the wire field and delete the button and this is
// RED; delete the wire field and keep the button and it is RED the other way.
// That ordering is the whole lesson of D157 → D201, where an action went onto the
// allowlist ahead of its surface and soft-locked online matches for forty-four
// decisions.
//
// A SOURCE SCAN rather than a render, deliberately: the failure being guarded is
// "a control exists that dispatches this", and a rendered probe would have to
// guess which panel, which label and which enablement — a scan sees the dispatch
// wherever someone puts it. (What that control DOES — greys off the server's
// `disabled`, dispatches the seat and nothing else — is a render, and lives in
// `OnlineHud.stadiumAbility.dom.test.tsx` beside it.) The tests themselves are
// excluded (naming an action in a spec is not an affordance a player can press),
// and the positive controls below fail loudly if the glob ever stops matching,
// because a scan that reads nothing agrees with everything (the vacuous guard of
// D200/D204/D205).

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

describe("the online client's Stadium-ability surface (D209, closed by D210)", () => {
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
