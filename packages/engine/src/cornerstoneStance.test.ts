import { describe, expect, it } from "vitest";
import { hasPrintedAbility } from "./cards";
import { passivesOf } from "./continuous";
import { programFor } from "./index";
import type { Card } from "@luminous/schema";
import type { GameEvent, GameState, PokemonRef } from "./index";
import {
  CORNERSTONE_DECK,
  FIXTURE_POOL,
  attachFromDeck,
  benchFromDeck,
  deepFreeze,
  driveSetup,
  mustApply,
  setActiveFromDeck,
} from "./testFixtures";

// 0.166.0 → 0.167.0 — Cornerstone Mask Ogerpon ex (P3-M5 long tail, D251):
// "Prevent all damage from attacks done to this Pokémon by your opponent's
// Pokémon that have an Ability."
//
// THE THIRD MEMBER OF THE ATTACKER-PROPERTY PREVENT FAMILY, and the biggest cheap
// unbuilt ability group in the legal pool at D251. `preventDamageFromExV` (Mimikyu
// "Safeguard", D107) gates on the attacker's RULE BOX; `preventDamageFromTypes`
// (Dachsbun/Bellibolt, D159) on the attacker's printed TYPES; this one on whether
// the attacker's card carries an ABILITY. All three ride `passivesOf`, all three
// are resolved at the SAME FOUR read sites — attack.ts's main hit, and
// interpreter.ts's spread, `deals` and snipe arms — and all three sit inside the
// `ignoreWR` / `suppressTargetEffects` guard, because each is an effect ON the
// damaged Pokémon.
//
// ⚠️ THE CENSUS, TRANSCRIBED SO THE COUNT IS RE-DERIVABLE RATHER THAN INHERITED.
// Run against the remote D1 `luminous` on 2026-08-07:
//
//   SELECT lower(j.value ->> 'effect') AS sentence, COUNT(*) AS n,
//          group_concat(c.id) AS ids
//   FROM cards c, json_each(c.abilities_json) j
//   WHERE c.legal_standard = 1
//     AND lower(j.value ->> 'effect') LIKE '%prevent all damage%'
//   GROUP BY sentence ORDER BY n DESC;
//
// returns NINE sentences, of which this one is the largest at 5:
//
//   5  …by your opponent's Pokémon that have an Ability.          ← THIS ROW
//   3  …from and effects of attacks from your opponent's Tera Pokémon…
//   3  …by attacks from your opponent's Pokémon ex.
//   3  As long as this Pokémon is on your Bench, prevent all damage from and
//      effects of attacks from your opponent's Pokémon…
//   2  …from and effects of attacks … that have any Special Energy attached.
//   2  …to your Benched Pokémon that don't have a Rule Box…
//   2  …by attacks from your opponent's Basic Pokémon ex.
//   1  …from and effects of attacks from your opponent's Pokémon done to your
//      Benched Pokémon.
//   1  …if that damage is 200 or more.
//
// ⚠️ **THE WIDENING LADDER, BOTH RUNGS, BECAUSE D250 FOUND THE ANSWER DEPENDS ON
// WHICH ONE YOU STOP AT.** Widened from the row's five ids to the printed KEY
// PHRASE (`%have an ability%`, all three text columns — `abilities_json`,
// `attacks_json` and the Trainer `effect`) the sweep returns EXACTLY THIS SENTENCE
// and nothing else: zero false positives, five printings, one sentence. Widened
// further to the bare printed OPENING (`%prevent all damage%`, same three columns)
// it returns 19 sentences — the 9 above, 9 attack sentences and 1 Trainer. The
// attack column is a control and stays a control: all nine of its sentences are
// "during your opponent's next turn" INSTALLATIONS (`attackBlockOf`), a different
// mechanism with no reader on this field.
//
// 🛑 **AND THE NEAREST NEIGHBOUR ON THIS AXIS IS NOT A WRITER OF THIS FIELD, WHICH
// IS THE ONE THING THE HANDOFF GOT WRONG.** `sv10.5b-023`/`-107` print "…by your
// opponent's Pokémon that have any Special Energy attached" — the same shape one
// attribute over — but their sentence opens "prevent all damage FROM AND EFFECTS
// OF attacks", and the effects half is a rule this pipeline does not have. FIVE of
// the nine ability sentences above carry it. A field shaped as an attacker-
// predicate KIND would have made that twin look one enum member away when it is a
// whole second rule away; the field is a BOOLEAN and the twin is unpriced.

const bite = { type: "attack", seat: "p1", index: 0 } as const;
const spread = { type: "attack", seat: "p1", index: 1 } as const;
/** fix-attacker-ex's own Spread Shot sits at index 1 too — the negative twin. */
const exSpread = { type: "attack", seat: "p1", index: 1 } as const;
const joust = { type: "attack", seat: "p1", index: 0 } as const; // Klefki — {C}, 10

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

/** Setup, then field the holder in P2's ACTIVE spot and hand the turn to P1, who
    fields `attackerId` with one {C} attached (the main-hit path). */
function fightMain(attackerId: string): GameState {
  let state = driveSetup(1, { p1: CORNERSTONE_DECK, p2: CORNERSTONE_DECK }, { first: "p2" });
  state = setActiveFromDeck(state, "p2", "fix-cornerstone");
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", attackerId);
  return attachFromDeck(state, "p1", "fix-energy", 1);
}

/** The BENCH path: P2's Active is a plain 200 HP body and the holder sits on the
    Bench, where the aura still protects it — the sentence has no Active-Spot
    clause. Setup also auto-benches the dominant fix-bigbody, so the holder is not
    necessarily bench[0]: find it by card id. */
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

/** Declare a chosen-target attack and resolve the prompt onto the ref at `spot`.
    An `opponentAny` snipe with more than one candidate PARKS in `effect:choose`
    (setup auto-benches the dominant fix-bigbody, so there always is more than
    one) — the two-step is the shape, not an accident of this board. */
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

  // ⚠️ ONE OBJECT SHARED BY ALL FIVE, which is the claim the coverage count is
  // actually making: five printings of ONE card, so a second object (or a
  // duplicated id) would inflate what this slice bought.
  it("shares ONE program object across the five ids and the demonstrator", () => {
    const program = programFor("sv06-112");
    for (const id of ["sv06-199", "sv06-215", "sv08.5-058", "sv08.5-160", "fix-cornerstone"]) {
      expect(programFor(id), id).toBe(program);
    }
  });

  // The field it is NOT. `preventDamageFromExV` is the neighbour a careless author
  // would have widened instead, and the assertion is on the FIELD rather than on
  // the whole passive object — D250's rule about the narrowest carrier of a claim.
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

  // 🛑 THE SEPARATION THE WHOLE SLICE RESTS ON: an ex with no Ability is FALSE
  // here and TRUE for `isExOrV`, and a plain body with an Ability is the reverse.
  // Without this pair the new field is indistinguishable from `preventDamageFromExV`.
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

    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ seat: "p2", dealt: 0, prevented: true });
  });

  // 🛑 THE NEGATIVE THAT SEPARATES THIS GATE FROM `preventDamageFromExV`: an ex
  // attacker with NO Ability is NOT prevented. On a Mimikyu this board is a 0.
  it("an ex attacker with NO Ability deals full damage — the gate is not ex/V", () => {
    const state = fightMain("fix-attacker-ex");
    deepFreeze(state);

    const { events } = mustApply(state, bite);

    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ dealt: 30 });
    expect(find(events, "DAMAGE_DEALT")?.prevented).toBeUndefined();
  });

  it("a plain attacker with neither an Ability nor a rule box deals full damage", () => {
    const state = fightMain("fix-attacker");
    deepFreeze(state);

    const { events } = mustApply(state, bite);

    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ dealt: 30 });
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

    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ dealt: 0, prevented: true });
    expect(done.players.p2.active?.damage).toBe(0);
  });

  // ⚠️ `ignoreWR` NULLS IT, and that is the family's shape rather than this
  // printing's: the aura is an effect ON the damaged Pokémon, so "isn't affected
  // by … any effects on that Pokémon" reaches it exactly as it reaches
  // `preventDamageFromExV` and `preventDamageFromTypes` beside it.
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

    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ dealt: 10 });
    expect(done.players.p2.active?.damage).toBe(10);
  });

  it("…and `passivesOf` is where that answer is made", () => {
    const state = fightMain("sv01-096");
    const holder = state.players.p2.active;
    if (holder === null || holder === undefined) throw new Error("no active");

    expect(passivesOf(state, holder).preventDamageFromHasAbility).toBe(false);
  });

  // 🛑 THE OTHER DIRECTION, AND IT POINTS THE OPPOSITE WAY ON PURPOSE. A lock over
  // the ATTACKER suppresses its Ability's EFFECT; it does not take the Ability off
  // the card, and a Pokémon whose Ability is switched off still HAS one. Spiritomb
  // locks Basic Pokémon V from the Bench, which is the only board in the registry
  // where a locked body can still be the one attacking.
  it("a lock over the ATTACKER does not stop it counting as an Ability-haver", () => {
    let state = driveSetup(1, { p1: CORNERSTONE_DECK, p2: CORNERSTONE_DECK }, { first: "p2" });
    state = setActiveFromDeck(state, "p2", "fix-cornerstone");
    state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
    state = setActiveFromDeck(state, "p1", "fix-abilityv");
    state = benchFromDeck(state, "p1", "sv02-089");
    state = attachFromDeck(state, "p1", "fix-energy", 1);
    deepFreeze(state);

    const { state: done, events } = mustApply(state, bite);

    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ dealt: 0, prevented: true });
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

  // A boolean and not a list, and the reason is in the field's doc: the gate names
  // no VALUE, so an OR over N sources is lossless. The assertion that keeps that
  // honest is that the fold's OTHER two prevention fields are untouched by it —
  // three prevention gates, three independent answers on one body.
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
