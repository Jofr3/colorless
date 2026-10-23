import { describe, expect, it } from "vitest";
import { isExOrV, preventsAttackerClass } from "./cards";
import { passivesOf } from "./continuous";
import { programFor } from "./index";
import type { Card } from "@colorless/schema";
import type { GameState, PokemonRef } from "./index";
import {
  FIXTURE_POOL,
  PREVENTED_CLASS_DECK,
  attachFromDeck,
  benchFromDeck,
  deepFreeze,
  driveSetup,
  mustApply,
  setActiveFromDeck,
  findEvent,
} from "./testFixtures";

const bite = { type: "attack", seat: "p1", index: 0 } as const;
const spread = { type: "attack", seat: "p1", index: 1 } as const;
const joust = { type: "attack", seat: "p1", index: 0 } as const; // Klefki — {C}, 10

const EX_SENTENCE =
  "Prevent all damage done to this Pokémon by attacks from your opponent's Pokémon ex.";
const BASIC_EX_SENTENCE =
  "Prevent all damage done to this Pokémon by attacks from your opponent's Basic Pokémon ex.";

/** Setup, then field `holderId` in P2's ACTIVE spot and hand the turn to P1, who
    fields `attackerId` with one {C} attached (the main-hit path). */
function fightMain(holderId: string, attackerId: string): GameState {
  let state = driveSetup(
    1,
    { p1: PREVENTED_CLASS_DECK, p2: PREVENTED_CLASS_DECK },
    { first: "p2" },
  );
  state = setActiveFromDeck(state, "p2", holderId);
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", attackerId);
  return attachFromDeck(state, "p1", "fix-energy", 1);
}

function fightBench(holderId: string, attackerId: string): GameState {
  let state = driveSetup(
    1,
    { p1: PREVENTED_CLASS_DECK, p2: PREVENTED_CLASS_DECK },
    { first: "p2" },
  );
  state = setActiveFromDeck(state, "p2", "fix-bigbody");
  state = benchFromDeck(state, "p2", holderId);
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", attackerId);
  return attachFromDeck(state, "p1", "fix-energy", 1);
}

function benchedHolder(state: GameState, holderId: string) {
  return state.players.p2.bench.find((p) => state.cardIdByUid[p.stack.at(-1) ?? ""] === holderId);
}

function snipeAt(
  state: GameState,
  index: number,
  spot: "active" | "holderBench",
  holderId: string,
) {
  const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index });
  if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
  const prompt = parked.phase.prompt;
  if (prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");
  const wanted =
    spot === "active"
      ? prompt.candidates.find((c) => c.spot.spot === "active")
      : prompt.candidates.find(
          (c) =>
            c.spot.spot === "bench" &&
            parked.cardIdByUid[parked.players.p2.bench[c.spot.index]?.stack.at(-1) ?? ""] ===
              holderId,
        );
  if (wanted === undefined) throw new Error(`no ${spot} candidate`);
  return mustApply(parked, {
    type: "resolveEffect",
    seat: "p1",
    choice: { kind: "pokemonMulti", refs: [wanted as PokemonRef] },
  });
}

describe("the registry data rows (preventDamageFromAttackerClass)", () => {
  it("authors the three ex-only printings as a bare { suffix: 'ex' } passive", () => {
    for (const id of ["sv08.5-040", "sv10-012", "sv10-186"]) {
      expect(programFor(id)?.passive, id).toEqual({
        preventDamageFromAttackerClass: { suffix: "ex" },
      });
    }
  });

  it("authors the two Basic-ex printings with the printed STAGE conjunct", () => {
    for (const id of ["sv05-108", "sv05-194"]) {
      expect(programFor(id)?.passive, id).toEqual({
        preventDamageFromAttackerClass: { suffix: "ex", stage: "basic" },
      });
    }
  });

  it("shares ONE program object per sentence, demonstrator included", () => {
    for (const id of ["sv10-012", "sv10-186", "fix-safeguardex"]) {
      expect(programFor(id), id).toBe(programFor("sv08.5-040"));
    }
    for (const id of ["sv05-194", "fix-armortail"]) {
      expect(programFor(id), id).toBe(programFor("sv05-108"));
    }
  });

  it("does NOT share one object across the two sentences", () => {
    expect(programFor("sv08.5-040")).not.toBe(programFor("sv05-108"));
  });

  it("writes none of the five sibling prevention fields", () => {
    for (const id of ["sv08.5-040", "sv05-108"]) {
      const passive = programFor(id)?.passive;
      expect(passive?.preventDamageFromExV, id).toBeUndefined();
      expect(passive?.preventDamageFromType, id).toBeUndefined();
      expect(passive?.preventDamageFromHasAbility, id).toBeUndefined();
      expect(passive?.preventDamageAndEffectsFromSpecialEnergy, id).toBeUndefined();
      expect(passive?.preventDamageAndEffectsWhileBenched, id).toBeUndefined();
    }
  });

  it("omits the stage KEY on the sentence that prints no stage word", () => {
    const cls = programFor("sv08.5-040")?.passive?.preventDamageFromAttackerClass;
    expect(cls).toBeDefined();
    expect(Object.keys(cls ?? {})).toEqual(["suffix"]);
  });
});

describe("preventsAttackerClass — the attacker-side predicate (cards.ts)", () => {
  const pool = FIXTURE_POOL as Record<string, Card | undefined>;
  const anyEx = [{ suffix: "ex" }] as const;
  const basicEx = [{ suffix: "ex", stage: "basic" }] as const;

  it("matches a Basic ex under BOTH printed classes", () => {
    expect(preventsAttackerClass(anyEx, pool["fix-exbasic"])).toBe(true);
    expect(preventsAttackerClass(basicEx, pool["fix-exbasic"])).toBe(true);
  });

  it("matches a Stage 1 ex under the ex-only class and NOT under Basic-ex", () => {
    expect(preventsAttackerClass(anyEx, pool["fix-exstage1"])).toBe(true);
    expect(preventsAttackerClass(basicEx, pool["fix-exstage1"])).toBe(false);
  });

  it("is FALSE for a Pokémon V, which `isExOrV` calls TRUE", () => {
    const v = pool["fix-abilityv"];
    expect(v).toBeDefined();
    expect(isExOrV(v as Card)).toBe(true);
    expect(preventsAttackerClass(anyEx, v)).toBe(false);
    expect(preventsAttackerClass(basicEx, v)).toBe(false);
  });

  it("is FALSE for a body with no rule box at all", () => {
    expect(preventsAttackerClass(anyEx, pool["fix-attacker"])).toBe(false);
    expect(preventsAttackerClass(anyEx, pool["fix-bigbody"])).toBe(false);
  });

  // The conservative direction, `preventsAttackerType`'s verbatim: two of the four
  // read sites hold the attacker as `Card | undefined`, and an unreadable attacker
  // must protect LESS rather than more.
  it("is FALSE for an unresolvable attacker, an empty list, and a non-Pokémon", () => {
    expect(preventsAttackerClass(anyEx, undefined)).toBe(false);
    expect(preventsAttackerClass([], pool["fix-exbasic"])).toBe(false);
    expect(preventsAttackerClass(anyEx, pool["fix-energy"])).toBe(false);
  });

  it("is FALSE for a VMAX — the suffix is compared, not the Rule Box", () => {
    expect(preventsAttackerClass(anyEx, pool["fix-attacker-vmax"])).toBe(false);
  });

  it("is a disjunction over the list — either class matching is enough", () => {
    const both = [{ suffix: "ex", stage: "basic" }, { suffix: "ex" }] as const;
    expect(preventsAttackerClass(both, pool["fix-exstage1"])).toBe(true);
    expect(preventsAttackerClass(both, pool["fix-abilityv"])).toBe(false);
  });
});

describe("the main hit (attack.ts, read site 1 of 4)", () => {
  it("a Basic ex's Bite is fully prevented by the ex-only holder — 0, flagged", () => {
    const state = fightMain("fix-safeguardex", "fix-exbasic");
    deepFreeze(state);

    const { state: done, events } = mustApply(state, bite);

    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ dealt: 0, prevented: true });
    expect(done.players.p2.active?.damage).toBe(0);
  });

  it("…and by the Basic-ex holder too", () => {
    const state = fightMain("fix-armortail", "fix-exbasic");
    deepFreeze(state);

    const { state: done, events } = mustApply(state, bite);

    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ dealt: 0, prevented: true });
    expect(done.players.p2.active?.damage).toBe(0);
  });

  it("a STAGE 1 ex is prevented by the ex-only holder and NOT by the Basic-ex one", () => {
    const through = mustApply(fightMain("fix-armortail", "fix-exstage1"), bite);
    const stopped = mustApply(fightMain("fix-safeguardex", "fix-exstage1"), bite);

    expect(findEvent(through.events, "DAMAGE_DEALT")).toMatchObject({ dealt: 30 });
    expect(through.state.players.p2.active?.damage).toBe(30);
    expect(findEvent(stopped.events, "DAMAGE_DEALT")).toMatchObject({ dealt: 0, prevented: true });
    expect(stopped.state.players.p2.active?.damage).toBe(0);
  });

  it("a Pokémon V gets through BOTH holders — this is not the ex/V gate", () => {
    for (const holder of ["fix-safeguardex", "fix-armortail"]) {
      const { state: done } = mustApply(fightMain(holder, "fix-abilityv"), bite);
      expect(done.players.p2.active?.damage, holder).toBe(30);
    }
  });

  it("a body with no rule box gets through both — the flat control", () => {
    for (const holder of ["fix-safeguardex", "fix-armortail"]) {
      const { state: done } = mustApply(fightMain(holder, "fix-attacker"), bite);
      expect(done.players.p2.active?.damage, holder).toBe(30);
    }
  });

  it("the gate reads the ATTACKER and not the defender — a mirror prevents", () => {
    const state = fightMain("fix-armortail", "fix-armortail");
    deepFreeze(state);

    // fix-armortail prints no attacks, so the mirror is driven through the fold
    // rather than through a hit: the point is the DIRECTION of the read.
    const holder = state.players.p2.active;
    const attacker = state.players.p1.active;
    if (holder === null || attacker === null) throw new Error("board not set up");
    const card = state.cardIdByUid[attacker.stack.at(-1) ?? ""];
    expect(card).toBe("fix-armortail");
    expect(
      preventsAttackerClass(
        passivesOf(state, holder).preventDamageFromAttackerClasses,
        FIXTURE_POOL["fix-armortail"],
      ),
    ).toBe(true);
  });
});

describe("the spread arm (interpreter.ts, read site 2 of 4)", () => {
  // Neither sentence carries an Active-Spot clause, so a BENCHED holder is
  // protected from a spread exactly as an Active is.
  it("protects a BENCHED holder from a Basic ex's spread", () => {
    const state = fightBench("fix-safeguardex", "fix-exbasic");
    deepFreeze(state);

    const { state: done } = mustApply(state, spread);

    expect(benchedHolder(done, "fix-safeguardex")?.damage).toBe(0);
  });

  it("…and the Basic-ex holder lets a STAGE 1 ex's spread through", () => {
    const state = fightBench("fix-armortail", "fix-exstage1");
    deepFreeze(state);

    const { state: done } = mustApply(state, spread);

    expect(benchedHolder(done, "fix-armortail")?.damage).toBe(20);
  });

  it("…while the ex-only holder stops the same spread", () => {
    const state = fightBench("fix-safeguardex", "fix-exstage1");
    deepFreeze(state);

    const { state: done } = mustApply(state, spread);

    expect(benchedHolder(done, "fix-safeguardex")?.damage).toBe(0);
  });
});

describe("the snipe arms (interpreter.ts, read sites 3 and 4 of 4)", () => {
  it("prevents a chosen-target snipe onto the holder on the BENCH (placeSnipe)", () => {
    const state = fightBench("fix-safeguardex", "fix-exbasic");
    deepFreeze(state);

    const { state: done } = snipeAt(state, 2, "holderBench", "fix-safeguardex");

    expect(benchedHolder(done, "fix-safeguardex")?.damage).toBe(0);
  });

  it("prevents a chosen-target snipe onto the holder in the ACTIVE spot", () => {
    const state = fightMain("fix-armortail", "fix-exbasic");
    deepFreeze(state);

    const { state: done, events } = snipeAt(state, 2, "active", "fix-armortail");

    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ dealt: 0, prevented: true });
    expect(done.players.p2.active?.damage).toBe(0);
  });

  it("lets a Stage 1 ex's snipe through the Basic-ex holder", () => {
    const state = fightMain("fix-armortail", "fix-exstage1");
    deepFreeze(state);

    const { state: done } = snipeAt(state, 2, "active", "fix-armortail");

    expect(done.players.p2.active?.damage).toBe(40);
  });

  it("Feint Attack's ignoreWR nulls the prevention — 50 lands on the holder", () => {
    const state = fightMain("fix-safeguardex", "fix-exbasic");
    deepFreeze(state);

    const { state: done } = snipeAt(state, 3, "active", "fix-safeguardex");

    expect(done.players.p2.active?.damage).toBe(50);
  });
});

describe("§9 — the holder's aura is an Ability and a lock must silence it", () => {
  // Klefki is Active-gated, so the locking body has to be the attacking body — and
  // Klefki has NO rule box, so this board's damage lands for TWO reasons at once.
  // The narrow claim is therefore made on the FOLD below rather than on the hit.
  it("a lock over the HOLDER switches the prevention off in `passivesOf`", () => {
    const state = fightMain("fix-safeguardex", "sv01-096");
    const holder = state.players.p2.active;
    if (holder === null || holder === undefined) throw new Error("no active");

    expect(passivesOf(state, holder).preventDamageFromAttackerClasses).toEqual([]);
  });

  it("…and Klefki's own Joust lands, since it is also no ex", () => {
    const state = fightMain("fix-safeguardex", "sv01-096");
    deepFreeze(state);

    const { state: done, events } = mustApply(state, joust);

    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ dealt: 10 });
    expect(done.players.p2.active?.damage).toBe(10);
  });
});

describe("the fold (continuous.ts passivesOf)", () => {
  it("reports the printed class on the holder and NOTHING on every other body", () => {
    const state = fightBench("fix-safeguardex", "fix-exbasic");
    const holder = benchedHolder(state, "fix-safeguardex");
    const active = state.players.p2.active;
    if (holder === undefined || active === null || active === undefined)
      throw new Error("board not set up");

    expect(passivesOf(state, holder).preventDamageFromAttackerClasses).toEqual([{ suffix: "ex" }]);
    expect(passivesOf(state, active).preventDamageFromAttackerClasses).toEqual([]);
  });

  it("reports the STAGE conjunct verbatim for the other sentence", () => {
    const state = fightBench("fix-armortail", "fix-exbasic");
    const holder = benchedHolder(state, "fix-armortail");
    if (holder === undefined) throw new Error("no benched holder");

    expect(passivesOf(state, holder).preventDamageFromAttackerClasses).toEqual([
      { suffix: "ex", stage: "basic" },
    ]);
  });

  it("leaves the five sibling prevention fields alone", () => {
    const state = fightBench("fix-safeguardex", "fix-exbasic");
    const holder = benchedHolder(state, "fix-safeguardex");
    if (holder === undefined) throw new Error("no benched holder");
    const fold = passivesOf(state, holder);

    expect(fold.preventDamageFromAttackerClasses).toEqual([{ suffix: "ex" }]);
    expect(fold.preventDamageFromExV).toBe(false);
    expect(fold.preventDamageFromTypes).toEqual([]);
    expect(fold.preventDamageFromHasAbility).toBe(false);
    expect(fold.preventDamageAndEffectsFromSpecialEnergy).toBe(false);
    expect(fold.preventDamageAndEffectsWhileBenched).toBe(false);
  });
});

describe("the two printed sentences, as the fixtures carry them", () => {
  it("the demonstrators print the census sentences byte for byte", () => {
    expect(FIXTURE_POOL["fix-safeguardex"]?.abilities?.[0]?.effect).toBe(EX_SENTENCE);
    expect(FIXTURE_POOL["fix-armortail"]?.abilities?.[0]?.effect).toBe(BASIC_EX_SENTENCE);
  });

  it("differ by exactly the word 'Basic '", () => {
    expect(BASIC_EX_SENTENCE.replace("Basic ", "")).toBe(EX_SENTENCE);
  });
});
