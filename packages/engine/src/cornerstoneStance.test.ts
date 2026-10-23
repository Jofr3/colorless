import { describe, expect, it } from "vitest";
import { hasPrintedAbility } from "./cards";
import { passivesOf } from "./continuous";
import { programFor } from "./index";
import type { Card } from "@colorless/schema";
import type { GameState, PokemonRef } from "./index";
import {
  CORNERSTONE_DECK,
  FIXTURE_POOL,
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
/** fix-attacker-ex's own Spread Shot sits at index 1 too — the negative twin. */
const exSpread = { type: "attack", seat: "p1", index: 1 } as const;
const joust = { type: "attack", seat: "p1", index: 0 } as const;

/** Setup, then field the holder in P2's ACTIVE spot and hand the turn to P1, who
    fields `attackerId` with one {C} attached (the main-hit path). */
function fightMain(attackerId: string): GameState {
  let state = driveSetup(1, { p1: CORNERSTONE_DECK, p2: CORNERSTONE_DECK }, { first: "p2" });
  state = setActiveFromDeck(state, "p2", "fix-cornerstone");
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", attackerId);
  return attachFromDeck(state, "p1", "fix-energy", 1);
}

function fightBench(attackerId: string): GameState {
  let state = driveSetup(1, { p1: CORNERSTONE_DECK, p2: CORNERSTONE_DECK }, { first: "p2" });
  state = setActiveFromDeck(state, "p2", "fix-bigbody");
  state = benchFromDeck(state, "p2", "fix-cornerstone");
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", attackerId);
  return attachFromDeck(state, "p1", "fix-energy", 1);
}

function benchedHolder(state: GameState) {
  return state.players.p2.bench.find(
    (p) => state.cardIdByUid[p.stack.at(-1) ?? ""] === "fix-cornerstone",
  );
}

function snipeAt(state: GameState, index: number, spot: "active" | "holderBench") {
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
              "fix-cornerstone",
        );
  if (wanted === undefined) throw new Error(`no ${spot} candidate`);
  return mustApply(parked, {
    type: "resolveEffect",
    seat: "p1",
    choice: { kind: "pokemonMulti", refs: [wanted as PokemonRef] },
  });
}

describe("Cornerstone Stance — the registry data row (preventDamageFromHasAbility)", () => {
  it("authors all five printings as a bare preventDamageFromHasAbility passive", () => {
    for (const id of ["sv06-112", "sv06-199", "sv06-215", "sv08.5-058", "sv08.5-160"]) {
      expect(programFor(id)?.passive, id).toEqual({ preventDamageFromHasAbility: true });
    }
  });

  it("shares ONE program object across the five ids and the demonstrator", () => {
    const program = programFor("sv06-112");
    for (const id of ["sv06-199", "sv06-215", "sv08.5-058", "sv08.5-160", "fix-cornerstone"]) {
      expect(programFor(id), id).toBe(program);
    }
  });

  it("writes neither of the two sibling prevention fields", () => {
    const passive = programFor("sv06-112")?.passive;
    expect(passive?.preventDamageFromExV).toBeUndefined();
    expect(passive?.preventDamageFromType).toBeUndefined();
  });
});

describe("hasPrintedAbility — the attacker-side predicate (cards.ts)", () => {
  const pool = FIXTURE_POOL as Record<string, Card | undefined>;

  it("is TRUE for a body that prints an Ability and FALSE for one that does not", () => {
    expect(hasPrintedAbility(pool["fix-abilitybody"])).toBe(true);
    expect(hasPrintedAbility(pool["fix-cornerstone"])).toBe(true);
    expect(hasPrintedAbility(pool["fix-attacker"])).toBe(false);
  });

  it("is FALSE for an ex that prints no Ability — this is not the rule-box gate", () => {
    expect(hasPrintedAbility(pool["fix-attacker-ex"])).toBe(false);
    expect(hasPrintedAbility(pool["fix-abilityv"])).toBe(true);
  });

  // The conservative direction, `preventsAttackerType`'s verbatim: two of the four
  // read sites hold the attacker as `Card | undefined`.
  it("is FALSE for an unresolvable attacker and for a non-Pokémon", () => {
    expect(hasPrintedAbility(undefined)).toBe(false);
    expect(hasPrintedAbility(pool["fix-energy"])).toBe(false);
  });
});

describe("Cornerstone Stance — the main hit (attack.ts, read site 1 of 4)", () => {
  it("an Ability-carrying attacker's Bite is fully prevented — 0 damage, flagged", () => {
    const state = fightMain("fix-abilitybody");
    deepFreeze(state);

    const { events } = mustApply(state, bite);

    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({
      seat: "p2",
      dealt: 0,
      prevented: true,
    });
  });

  it("an ex attacker with NO Ability deals full damage — the gate is not ex/V", () => {
    const state = fightMain("fix-attacker-ex");
    deepFreeze(state);

    const { events } = mustApply(state, bite);

    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ dealt: 30 });
    expect(findEvent(events, "DAMAGE_DEALT")?.prevented).toBeUndefined();
  });

  it("a plain attacker with neither an Ability nor a rule box deals full damage", () => {
    const state = fightMain("fix-attacker");
    deepFreeze(state);

    const { events } = mustApply(state, bite);

    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ dealt: 30 });
  });
});

describe("Cornerstone Stance — the spread arm (interpreter.ts, read site 2 of 4)", () => {
  // No Active-Spot clause on the sentence, so a BENCHED holder is protected too.
  it("prevents the benched holder's share of a spread from an Ability attacker", () => {
    const state = fightBench("fix-abilitybody");
    const uid = benchedHolder(state)?.stack.at(-1);
    deepFreeze(state);

    const { state: done, events } = mustApply(state, spread);

    expect(events.some((e) => e.type === "DAMAGE_DEALT" && e.uid === uid && e.dealt === 0)).toBe(
      true,
    );
    expect(benchedHolder(done)?.damage).toBe(0);
  });

  it("does NOT prevent the spread from an ex attacker with no Ability", () => {
    const state = fightBench("fix-attacker-ex");
    deepFreeze(state);

    const { state: done } = mustApply(state, exSpread);

    expect(benchedHolder(done)?.damage).toBe(20);
  });
});

describe("Cornerstone Stance — the snipe arms (interpreter.ts, read sites 3 and 4)", () => {
  it("prevents a chosen-target snipe onto the benched holder", () => {
    const state = fightBench("fix-abilitybody");
    deepFreeze(state);

    const { state: done } = snipeAt(state, 2, "holderBench");

    expect(benchedHolder(done)?.damage).toBe(0);
  });

  it("prevents a chosen-target snipe onto the holder in the ACTIVE spot", () => {
    const state = fightMain("fix-abilitybody");
    deepFreeze(state);

    const { state: done, events } = snipeAt(state, 2, "active");

    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ dealt: 0, prevented: true });
    expect(done.players.p2.active?.damage).toBe(0);
  });

  it("Feint Attack's ignoreWR nulls the prevention — 50 lands on the holder", () => {
    const state = fightMain("fix-abilitybody");
    deepFreeze(state);

    const { state: done } = snipeAt(state, 3, "active");

    expect(done.players.p2.active?.damage).toBe(50);
  });
});

describe("Cornerstone Stance — §9, in both directions on one gate", () => {
  // The HOLDER's aura IS an Ability, so a lock over it must switch the prevention
  // off. Klefki is Active-gated, so the locking body has to be the attacking body
  // — and Klefki also HAS an Ability, so without the lock this board is a 0.
  it("a lock over the HOLDER switches the prevention off and the damage lands", () => {
    const state = fightMain("sv01-096");
    deepFreeze(state);

    const { state: done, events } = mustApply(state, joust);

    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ dealt: 10 });
    expect(done.players.p2.active?.damage).toBe(10);
  });

  it("…and `passivesOf` is where that answer is made", () => {
    const state = fightMain("sv01-096");
    const holder = state.players.p2.active;
    if (holder === null || holder === undefined) throw new Error("no active");

    expect(passivesOf(state, holder).preventDamageFromHasAbility).toBe(false);
  });

  it("a lock over the ATTACKER does not stop it counting as an Ability-haver", () => {
    let state = driveSetup(1, { p1: CORNERSTONE_DECK, p2: CORNERSTONE_DECK }, { first: "p2" });
    state = setActiveFromDeck(state, "p2", "fix-cornerstone");
    state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
    state = setActiveFromDeck(state, "p1", "fix-abilityv");
    state = benchFromDeck(state, "p1", "sv02-089");
    state = attachFromDeck(state, "p1", "fix-energy", 1);
    deepFreeze(state);

    const { state: done, events } = mustApply(state, bite);

    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ dealt: 0, prevented: true });
    expect(done.players.p2.active?.damage).toBe(0);
  });
});

describe("Cornerstone Stance — the fold (continuous.ts passivesOf)", () => {
  it("reports the flag on the holder and FALSE on every other body", () => {
    const state = fightBench("fix-abilitybody");
    const holder = benchedHolder(state);
    const active = state.players.p2.active;
    if (holder === undefined || active === null || active === undefined)
      throw new Error("board not set up");

    expect(passivesOf(state, holder).preventDamageFromHasAbility).toBe(true);
    expect(passivesOf(state, active).preventDamageFromHasAbility).toBe(false);
  });

  it("leaves the two sibling prevention fields alone", () => {
    const state = fightBench("fix-abilitybody");
    const holder = benchedHolder(state);
    if (holder === undefined) throw new Error("no benched holder");
    const fold = passivesOf(state, holder);

    expect(fold.preventDamageFromHasAbility).toBe(true);
    expect(fold.preventDamageFromExV).toBe(false);
    expect(fold.preventDamageFromTypes).toEqual([]);
  });
});
