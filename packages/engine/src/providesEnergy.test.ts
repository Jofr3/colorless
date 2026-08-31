import { describe, expect, it } from "vitest";
import { BASIC_ENERGY_TYPES } from "@luminous/schema";
import { ENERGY_TYPE_BY_CODE, deriveAttackEffect } from "./effects";
import { applyAction } from "./index";
import type { GameState, PokemonRef } from "./index";
import {
  PROVIDES_ENERGY_DECK,
  attachBenchFromDeck,
  attachFromDeck,
  benchFromDeck,
  deepFreeze,
  driveSetup,
  expectErr,
  handFromDeck,
  mustApply,
  setActiveFromDeck,
  types,
} from "./testFixtures";

// M5 op-slice: the `providesEnergy` CardFilter — "an Energy that PROVIDES {X}".
//
// The last missing piece of the energy-discard family, and the first filter a
// CARD alone cannot answer. Two claims carry the whole slice:
//
//   1. PROVISION, NOT PRINT. "{L} Energy" is not "a Basic Lightning Energy card".
//      A Special Energy that provides {L} IS one; a Special that provides only
//      {C} is not. The predicate therefore reads the same units §8.2's cost
//      matcher reads (continuous.ts) — pay a {L} cost with a card and the very
//      same attack must be able to discard it.
//   2. HOST, NOT CARD. Provision is a while-ATTACHED property, and for Luminous
//      Energy it depends on the holder's OTHER attachments. The identical card is
//      a {L} Energy alone and NOT one beside another Special Energy, so the
//      filter is answered per Energy on its host (`matchesAttached`) and the
//      card-only pile scanner (`matchesFilter`) answers false for it.
//
// TWO consumers, one vocabulary (the D40 shape): the DERIVED typed self-discard
// (Kilowattrel, Arcanine ex, Charmeleon, Charizard — no registry rows) and
// `moveEnergy`'s new benchToActive route (Armarouge's "Fire Off").

/** Setup, then open P1's turn 2 (P2 went first and passed) — P1's first
    unrestricted turn, so attacking and Abilities are both legal (§4). */
function board(seed: number): GameState {
  const state = driveSetup(
    seed,
    { p1: PROVIDES_ENERGY_DECK, p2: PROVIDES_ENERGY_DECK },
    { first: "p2" },
  );
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

function activeEnergy(state: GameState, seat: "p1" | "p2"): string[] {
  return [...(state.players[seat].active?.energy ?? [])];
}

function benchEnergy(state: GameState, seat: "p1" | "p2", index: number): string[] {
  return [...(state.players[seat].bench[index]?.energy ?? [])];
}

/** P1 fields `attackerId` with `attached` Energy, against a defender that
    survives everything printed in this deck (so no KO tail interferes). */
function fielded(
  seed: number,
  attackerId: string,
  attached: readonly { id: string; count: number }[],
): GameState {
  let state = board(seed);
  state = setActiveFromDeck(state, "p1", attackerId);
  state = setActiveFromDeck(state, "p2", "fix-titan");
  for (const { id, count } of attached) state = attachFromDeck(state, "p1", id, count);
  return state;
}

/** The card ids of the Energy the parked discard prompt is offering. */
function offered(state: GameState): string[] {
  if (state.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
  if (state.phase.prompt.kind !== "discardEnergy") throw new Error("expected discardEnergy");
  return state.phase.prompt.discardable.map((d) => state.cardIdByUid[d.uid] as string);
}

describe("M5 op-slice — the providesEnergy filter: the deriver", () => {
  it("derives all four printed shapes, in BOTH notations", () => {
    // The modern brace code and the swsh-era spelled-out name are the same rule,
    // and the count rides on top of it exactly as it does untyped.
    expect(deriveAttackEffect("Discard a {L} Energy from this Pokémon.")).toEqual([
      {
        op: "discardEnergy",
        from: "yourActive",
        filter: { kind: "providesEnergy", energyType: "Lightning" },
      },
    ]);
    expect(deriveAttackEffect("Discard 2 {R} Energy from this Pokémon.")).toEqual([
      {
        op: "discardEnergy",
        from: "yourActive",
        filter: { kind: "providesEnergy", energyType: "Fire" },
        count: 2,
      },
    ]);
    expect(deriveAttackEffect("Discard a Fire Energy from this Pokémon.")).toEqual([
      {
        op: "discardEnergy",
        from: "yourActive",
        filter: { kind: "providesEnergy", energyType: "Fire" },
      },
    ]);
    expect(deriveAttackEffect("Discard all Fire Energy from this Pokémon.")).toEqual([
      {
        op: "discardEnergy",
        from: "yourActive",
        filter: { kind: "providesEnergy", energyType: "Fire" },
        count: "all",
      },
    ]);
  });

  it("every code in the map resolves, and its own type name resolves identically", () => {
    // The two notations are two spellings of ONE vocabulary — a code that derived
    // to a type its spelled-out twin did not would be a silent split.
    for (const [code, type] of Object.entries(ENERGY_TYPE_BY_CODE)) {
      const filter = { kind: "providesEnergy", energyType: type };
      expect(deriveAttackEffect(`Discard a {${code}} Energy from this Pokémon.`)).toEqual([
        { op: "discardEnergy", from: "yourActive", filter },
      ]);
      expect(deriveAttackEffect(`Discard a ${type} Energy from this Pokémon.`)).toEqual([
        { op: "discardEnergy", from: "yourActive", filter },
      ]);
    }
  });

  it("the map's vocabulary IS BASIC_ENERGY_TYPES — no more, no less", () => {
    // The engine has ONE basic-energy vocabulary (@luminous/schema §6.1) and the
    // deriver must not grow a second. Colorless and Dragon are absent there on
    // purpose, and their absence here is load-bearing rather than incidental:
    // Colorless is the conservative provision FALLBACK for every unauthored
    // Special Energy, so a "{C} Energy" filter would quietly match cards nobody
    // meant. A re-ingest that adds a printed type fails this line first.
    expect(Object.values(ENERGY_TYPE_BY_CODE).sort()).toEqual([...BASIC_ENERGY_TYPES].sort());
    expect(deriveAttackEffect("Discard a {C} Energy from this Pokémon.")).toBeNull();
    expect(deriveAttackEffect("Discard a Colorless Energy from this Pokémon.")).toBeNull();
    expect(deriveAttackEffect("Discard a {N} Energy from this Pokémon.")).toBeNull();
    expect(deriveAttackEffect("Discard a Dragon Energy from this Pokémon.")).toBeNull();
  });

  it("refuses the near-misses — every one of them a REAL catalog row", () => {
    for (const text of [
      // Pawmot ex (sv03-073): the typed discard is right, the rider is not.
      "Discard 2 {L} Energy from this Pokémon. This attack does 220 damage to 1 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      // Bellibolt ex (sv02-079): "You may" — OPTIONAL, where this op is mandatory,
      // and the discard buys an effect rather than paying a cost.
      "You may discard 2 {L} Energy from this Pokémon to make your opponent's Active Pokémon Paralyzed.",
      // 🆕🛑 **D402 MOVED TWO STRINGS OUT OF THIS LIST, AND THIS COMMENT IS THE
      //     RECORD OF WHY — D361's move at this same site, made a second time.**
      //     Mewtwo VSTAR `swsh10.5-031` *"Discard up to 3 Psychic Energy from your
      //     Pokémon. This attack does 90 damage for each card you discarded in this
      //     way."* and Chien-Pao ex `sv02-061` *"You may discard any amount of {W}
      //     Energy from your Pokémon. …"* stood here from D191 to D401 as REFUSALS.
      //     They derive now: D402's `ENERGY_DISCARD_SCALED_DAMAGE` reads the whole
      //     COMPOUND — the discard AND the scaling clause — into the two-op program
      //     their registry rows already spell, and both are asserted POSITIVELY in
      //     `psyPurge.test.ts` and `hailBlade.test.ts` instead.
      //     ⚠️ **WHAT THEY WERE PINNING HERE IS NOT ABANDONED, IT IS RE-POINTED:**
      //     the claim was always that `TYPED_SELF_DISCARD` refuses a sentence that
      //     does not END at "this Pokémon.", and the rung below now makes it with
      //     the one string that no other anchor claims — the SAME whole-board "up
      //     to" discard with NO scaling clause behind it, which is a sentence the
      //     column does not print and which therefore still derives to null.
      "Discard up to 3 Psychic Energy from your Pokémon.",
      // Decidueye (sv06.5-005): a Basic {G} Energy CARD FROM YOUR HAND — the one
      // row in the family that really is about a PRINT and not about provision,
      // and the reason `basicEnergy` still exists alongside this filter.
      "Discard a Basic {G} Energy card from your hand. If you can't, this attack does nothing.",
      // Not a printed card; a silent no-op is the worst possible derivation.
      "Discard 0 {R} Energy from this Pokémon.",
      // ANCHORS, pinned directly: each keeps the pattern's own capitalised first
      // word, so it is the `^`/`$` and nothing else that refuses it. Drop either
      // and these derive to a program implementing HALF a card.
      "This attack does 30 damage. Discard a {L} Energy from this Pokémon.",
      "Discard a {L} Energy from this Pokémon. Then, flip a coin.",
      "Discard all Fire Energy from this Pokémon. Your opponent's Active Pokémon is now Paralyzed.",
      // The type must sit where the pattern puts it, not merely appear.
      // 🆕🛑 **D361 MOVED ONE STRING OUT OF THIS LIST, AND THIS COMMENT IS THE
      //     RECORD OF WHY.** `"Discard a {L} Energy from your opponent's Active
      //     Pokémon."` stood here from D191 to D360 as a REFUSAL. It derives now:
      //     the catalog prints that shape (Ducklett `sv10.5w-025`/`-109`,
      //     `{R}`, 2 Standard-legal; Growlithe `sv03.5-058`, `{W}`, rotated), so
      //     `OPPONENT_ACTIVE_DISCARD` widened its noun phrase into a capture and
      //     the sentence is asserted POSITIVELY in `crossSeatEnergyDiscard.test.ts`
      //     §1 instead. `{L}` itself has ZERO printings on this shape and derives
      //     anyway — the same convention the loop above pins for the SELF form
      //     ("every code in the map resolves"): a type is a PARAMETER and the
      //     alternation is built FROM `ENERGY_TYPE_BY_CODE`, never from the
      //     printed subset.
      //     ⚠️ **THE CLAIM THIS LINE MADE IS NOT ABANDONED, IT IS RE-POINTED** —
      //     the two strings below still pin "the type must sit where the pattern
      //     puts it", one on a DESTINATION the family does not print and one on
      //     word order, and both are real refusals rather than a softened list.
      "Discard a {L} Energy from 1 of your opponent's Pokémon.",
      "Discard an Energy of type {L} from this Pokémon.",
    ]) {
      expect(deriveAttackEffect(text)).toBeNull();
    }
  });

  it("the UNTYPED siblings are untouched — the two rules do not overlap", () => {
    // Adding a typed arm must not widen the untyped one (or vice versa): an
    // untyped sentence still gets `anyEnergy`, which takes Energy of every type.
    expect(deriveAttackEffect("Discard an Energy from this Pokémon.")).toEqual([
      { op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" } },
    ]);
    expect(deriveAttackEffect("Discard 2 Energy from this Pokémon.")).toEqual([
      { op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" }, count: 2 },
    ]);
  });
});

describe("M5 op-slice — the providesEnergy filter: provision on a board", () => {
  it("takes the {L} Energy and never offers the Fire one — no prompt at all", () => {
    // The base case, and it auto-resolves: only ONE attached Energy provides {L},
    // so there is no question to ask (the M1 no-choice doctrine). The Fire Energy
    // is not merely unpicked — it was never a candidate.
    const state = fielded(3, "sv01-079", [
      { id: "fix-lightning-energy", count: 1 },
      { id: "fix-fire-energy", count: 1 },
      { id: "fix-energy", count: 1 },
    ]);
    const [lightning, fire, colorless] = activeEnergy(state, "p1");

    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(activeEnergy(done, "p1")).toEqual([fire, colorless]);
    expect(done.players.p1.discard).toEqual([lightning]);
  });

  it("a LUMINOUS Energy IS a {L} Energy — the wildcard provides every type", () => {
    // Luminous "provides every type of Energy but only 1 at a time" (ANY_ENERGY),
    // so it is a {L} Energy for a card that asks for one. With a Basic Lightning
    // beside it the pick becomes a genuine question — which is itself the proof
    // that the wildcard entered the offer.
    const state = fielded(4, "sv01-079", [
      { id: "fix-lightning-energy", count: 1 },
      { id: "sv02-191", count: 1 },
      { id: "fix-energy", count: 1 }, // the third Energy Thunder Blast's [L][C][C] needs
    ]);

    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    expect(offered(parked)).toEqual(["fix-lightning-energy", "sv02-191"]);
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    if (parked.phase.prompt.kind !== "discardEnergy") throw new Error("expected discardEnergy");
    // The note names the TYPE, not the printed brace code — the rows the player
    // clicks are card names, so heading and offer speak one vocabulary.
    expect(parked.phase.prompt.note).toBe("Discard a Lightning Energy from this Pokémon.");

    const luminous = parked.phase.prompt.discardable[1]?.uid as string;
    const { state: done } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardEnergy", uids: [luminous] },
    });
    expect(done.players.p1.discard).toEqual([luminous]);
  });

  it("…and STOPS being one when another Special Energy demotes it to {C}", () => {
    // THE host-dependence test. Same Luminous card, same attacker, same attack —
    // but a Jet Energy attached beside it fires Luminous's own clause ("if the
    // Pokémon this card is attached to has any other Special Energy attached,
    // this card provides {C} Energy instead"), so it provides only {C} and is no
    // longer a {L} Energy. The offer collapses to the Basic Lightning and the
    // whole decision disappears. A card-only filter CANNOT produce this.
    const state = fielded(5, "sv01-079", [
      { id: "fix-lightning-energy", count: 1 },
      { id: "sv02-191", count: 1 },
      { id: "sv02-190", count: 1 },
    ]);
    const [lightning, luminous, jet] = activeEnergy(state, "p1");

    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(activeEnergy(done, "p1")).toEqual([luminous, jet]);
    expect(done.players.p1.discard).toEqual([lightning]);
  });

  it("an UNAUTHORED Special Energy is never typed — the Colorless fallback", () => {
    // fix-special has no EnergyProgram, so it conservatively provides {C}
    // (cards.ts energyProvidesOf). {C} is not a filterable type, so it can never
    // match — the reason admitting a "{C} Energy" filter would have been wrong.
    const state = fielded(6, "sv01-079", [
      { id: "fix-lightning-energy", count: 1 },
      { id: "fix-special", count: 1 },
      { id: "fix-energy", count: 1 },
    ]);
    const [lightning, special, colorless] = activeEnergy(state, "p1");

    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(activeEnergy(done, "p1")).toEqual([special, colorless]);
    expect(done.players.p1.discard).toEqual([lightning]);
  });

  it("what PAID the cost is what can be discarded — one provision rule, two readers", () => {
    // The agreement the design rests on. Kilowattrel's [L][C][C] is paid here
    // with a Luminous covering the {L} slot and two Colorless basics; the attack
    // is therefore legal ONLY because Luminous provides {L}. The same attack then
    // discards "a {L} Energy" — and since exactly one attached Energy provides
    // {L}, it is forced onto that same Luminous. If the cost matcher and the
    // filter ever disagreed, this board would either be unattackable or would
    // discard nothing at all.
    const state = fielded(7, "sv01-079", [
      { id: "sv02-191", count: 1 },
      { id: "fix-energy", count: 2 },
    ]);
    const [luminous, c1, c2] = activeEnergy(state, "p1");

    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    expect(types(events)).toContain("DAMAGE_DEALT"); // the cost was met
    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(done.players.p1.discard).toEqual([luminous]);
    expect(activeEnergy(done, "p1")).toEqual([c1, c2]);
  });

  it("the exact-N typed discard takes N of the matching type, ignoring the rest", () => {
    // Arcanine ex "Discard 2 {R} Energy". The Water is never a candidate, so the
    // count and the type constrain one pick from two directions.
    //
    // The Luminous is what makes this a QUESTION rather than a forced pick, and
    // for a reason worth stating: two different Basic Fire PRINTS are one class
    // (a Basic keys on what it PROVIDES — the catalog prints Basic Fire under
    // several ids), so no number of Fire basics is ever more than one
    // distinguishable answer. A wildcard Special is a genuinely different card,
    // hence a second class — "both basics" and "a basic + the Luminous" are
    // different boards afterwards.
    const state = fielded(8, "sv01-032", [
      { id: "fix-fire-energy", count: 2 },
      { id: "sv02-191", count: 1 },
      { id: "fix-water-energy", count: 1 },
    ]);
    const [fire, fire2, luminous, water] = activeEnergy(state, "p1");

    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    expect(offered(parked)).toEqual(["fix-fire-energy", "fix-fire-energy", "sv02-191"]);
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    if (parked.phase.prompt.kind !== "discardEnergy") throw new Error("expected discardEnergy");
    expect(parked.phase.prompt.scope).toEqual({ kind: "total", count: 2 });
    expect(parked.phase.prompt.note).toBe("Discard 2 Fire Energy from this Pokémon.");

    const { state: done } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardEnergy", uids: [fire as string, luminous as string] },
    });
    expect(activeEnergy(done, "p1")).toEqual([fire2, water]);
  });

  it("three interchangeable Fire and a count of 2 ask nothing — the collapse, capped", () => {
    // D43's cap, now under a filter: the offer keeps `count` copies per class, so
    // three IDENTICAL Fire prints collapse to two — an offer no bigger than the
    // count, which is forced. The Water is not a candidate at all, so it cannot
    // be dragged in to make up a number either.
    //
    // A genuinely SHORT typed board (fewer matches than the count) is unreachable
    // through a printed attack in this family: paying Bright Flame's [R][R][R]
    // takes three Energy that provide {R}, which is already more than the two it
    // discards — every typed card costs at least what it discards. The
    // do-as-much-as-you-can path is exercised untyped, on the fix-discard4
    // fixture built for exactly that (attackDiscards.test.ts).
    const state = fielded(9, "sv01-032", [
      { id: "fix-fire-energy", count: 3 },
      { id: "fix-water-energy", count: 1 },
    ]);
    const attached = activeEnergy(state, "p1");

    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(done.players.p1.discard).toEqual([attached[0], attached[1]]);
    expect(activeEnergy(done, "p1")).toEqual([attached[2], attached[3]]);
  });

  it('the typed "all" strips its type ONLY — where the untyped "all" strips the lot', () => {
    // Charizard's "Discard all Fire Energy": every Fire goes, and the Water and
    // Colorless stay attached. This is the case that proves the filter is doing
    // work in the APPLY and not only in the prompt — `count: "all"` never asks a
    // question, so the filter is the only thing standing between this and a
    // board stripped bare.
    const state = fielded(10, "swsh10.5-010", [
      { id: "fix-fire-energy", count: 2 },
      { id: "fix-fire-energy-alt", count: 1 },
      { id: "fix-water-energy", count: 1 },
      { id: "fix-energy", count: 1 },
    ]);
    const attached = activeEnergy(state, "p1");

    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(activeEnergy(done, "p1")).toEqual([attached[3], attached[4]]);
    expect(done.players.p1.discard).toEqual([attached[0], attached[1], attached[2]]);
  });

  it("the spelled-out notation runs the same op — Charmeleon and Kilowattrel agree", () => {
    // Charmeleon's "a Fire Energy" is the swsh wording of Arcanine ex's "{R}".
    // Same filter, same behaviour: the Water attached is not a candidate.
    const state = fielded(11, "swsh10.5-009", [
      { id: "fix-fire-energy", count: 2 }, // Flamethrower's [R][R]…
      { id: "fix-water-energy", count: 1 },
      { id: "fix-energy", count: 1 }, // …[C][C]
    ]);
    const attached = activeEnergy(state, "p1");

    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    // Two identical Fire prints are ONE class and the count is 1, so the collapse
    // leaves a single candidate: forced, and the Water is never in the running.
    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(done.players.p1.discard).toEqual([attached[0]]);
    expect(activeEnergy(done, "p1")).toEqual([attached[1], attached[2], attached[3]]);
  });

  it("nothing of the type attached is a clean no-op — the attack still resolves", () => {
    // A typed discard that matches nothing must not park, not throw, and not
    // reach for a different type. The attack itself is unaffected (§8 declares it
    // legally; the cost is met by other Energy).
    //
    // On a FIXTURE, because no printed card can reach this: every one of them
    // discards a type its own cost already required, so a real attack always has
    // at least one match. fix-typeddiscard costs [C] and discards a {W}.
    const state = fielded(12, "fix-typeddiscard", [
      { id: "fix-energy", count: 2 },
      { id: "fix-fire-energy", count: 1 },
    ]);
    const attached = activeEnergy(state, "p1");

    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(types(events)).not.toContain("ENERGY_DISCARDED");
    expect(types(events)).toContain("DAMAGE_DEALT");
    expect(activeEnergy(done, "p1")).toEqual(attached);
    expect(done.players.p1.discard).toEqual([]);
  });

  it("only the ACTIVE is reached — a benched Fire Energy is never taken", () => {
    // "this Pokémon" is the attacker, which is the Active by §8. The typed arm
    // inherits `yourActive`'s scope unchanged.
    let state = fielded(13, "swsh10.5-009", [
      { id: "fix-fire-energy", count: 2 },
      { id: "fix-energy", count: 2 },
    ]);
    state = benchFromDeck(state, "p1", "fix-basic-1");
    const benchIndex = state.players.p1.bench.length - 1;
    state = attachBenchFromDeck(state, "p1", benchIndex, "fix-fire-energy", 2);
    const benched = benchEnergy(state, "p1", benchIndex);

    const { state: done } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    expect(benchEnergy(done, "p1", benchIndex)).toEqual(benched);
    expect(done.players.p1.discard).toHaveLength(1);
  });

  it("rejects a wire choice that names an Energy of the wrong type", () => {
    // The prompt is the contract: an Energy the filter excluded was never
    // offered, so naming it is a BAD_EFFECT_CHOICE — not a discard of a card the
    // card never asked for.
    // Two DISTINGUISHABLE {L} providers are what make it park at all; the deck
    // holds a single Lightning print, so the Luminous wildcard is the second.
    const state = fielded(14, "sv01-079", [
      { id: "fix-lightning-energy", count: 1 },
      { id: "sv02-191", count: 1 },
      { id: "fix-fire-energy", count: 1 },
    ]);
    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    const fire = activeEnergy(parked, "p1").find(
      (uid) => parked.cardIdByUid[uid] === "fix-fire-energy",
    ) as string;

    expectErr(
      parked,
      { type: "resolveEffect", seat: "p1", choice: { kind: "discardEnergy", uids: [fire] } },
      "BAD_EFFECT_CHOICE",
    );
  });

  it("a Special providing TWO distinct types answers to BOTH of them", () => {
    // `EnergyProgram.provides` has always been a LIST, and the predicate asks
    // whether the type is AMONG the units — not whether it is the first one. No
    // authored card could tell those apart (Jet provides ["Colorless"], Luminous
    // [ANY_ENERGY]), so a fixture carries the multi-unit shape: fix-blend provides
    // {R} and {W}, and must be a candidate for a Fire discard and a Water one
    // alike. Without this the "which unit" question is decided by an untested
    // accident, and the first Blend/Reversal-style print would find it.
    const fire = fielded(17, "swsh10.5-009", [
      { id: "fix-blend", count: 1 }, // provides {R} AND {W}
      { id: "fix-fire-energy", count: 1 },
      { id: "fix-energy", count: 2 },
    ]);
    // A Fire discard sees BOTH the Basic Fire and the blend → a real question.
    const { state: parkedFire } = mustApply(fire, { type: "attack", seat: "p1", index: 1 });
    expect(offered(parkedFire)).toEqual(["fix-blend", "fix-fire-energy"]);

    // The SAME card answers a {W} discard, on a fixture whose type its cost does
    // not require — so the blend is the only match and the pick is forced.
    const water = fielded(18, "fix-typeddiscard", [
      { id: "fix-blend", count: 1 },
      { id: "fix-fire-energy", count: 1 },
    ]);
    const blendUid = activeEnergy(water, "p1")[0];
    const { state: done, events } = mustApply(water, { type: "attack", seat: "p1", index: 0 });
    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(done.players.p1.discard).toEqual([blendUid]);
  });

  it("finds NOTHING in a deck — a card in a pile is attached to nothing", () => {
    // The filter's other half, and the authoring mistake it is designed to make
    // harmless: `providesEnergy` handed to a DECK search matches no card at all,
    // because provision is a while-ATTACHED property ("As long as this card is
    // attached to a Pokémon, it provides…"). The deck here is FULL of Fire
    // Energy, so a card-shaped guess ("a Basic Fire Energy card") would have
    // grabbed one — the loud no-op is the whole point.
    let state = board(16);
    state = setActiveFromDeck(state, "p1", "fix-basic-1");
    state = setActiveFromDeck(state, "p2", "fix-titan");
    state = handFromDeck(state, "p1", "fix-pilescan", 1);
    const fireInDeck = state.players.p1.deck.filter(
      (uid) => state.cardIdByUid[uid] === "fix-fire-energy",
    );
    expect(fireInDeck.length).toBeGreaterThan(0);

    const hand = state.players.p1.hand.find((uid) => state.cardIdByUid[uid] === "fix-pilescan");
    const { state: done, events } = mustApply(state, {
      type: "playTrainer",
      seat: "p1",
      uid: hand as string,
    });
    // No prompt, no DECK_SEARCHED, and the hand gained nothing but lost the Item.
    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(types(events)).not.toContain("DECK_SEARCHED");
    expect(done.players.p1.hand).not.toContain(hand);
    expect(
      done.players.p1.hand.filter((uid) => done.cardIdByUid[uid] === "fix-fire-energy"),
    ).toEqual(state.players.p1.hand.filter((uid) => state.cardIdByUid[uid] === "fix-fire-energy"));
  });

  it("is PURE across the park and the resolve", () => {
    const state = fielded(15, "sv01-079", [
      { id: "fix-lightning-energy", count: 1 },
      { id: "sv02-191", count: 1 },
      { id: "fix-energy", count: 1 },
    ]);
    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    if (parked.phase.prompt.kind !== "discardEnergy") throw new Error("expected discardEnergy");
    const pick = parked.phase.prompt.discardable[0]?.uid as string;
    deepFreeze(parked);
    const result = applyAction(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardEnergy", uids: [pick] },
    });
    expect(result.ok).toBe(true);
  });
});

describe("M5 op-slice — the providesEnergy filter: Armarouge, the second consumer", () => {
  /** Armarouge Active, a plain benched body, and P2 fielded — the board "Fire
      Off" was written for. */
  function fireOffBoard(seed: number): GameState {
    let state = board(seed);
    state = setActiveFromDeck(state, "p1", "sv01-041");
    state = setActiveFromDeck(state, "p2", "fix-titan");
    state = benchFromDeck(state, "p1", "fix-basic-1");
    return state;
  }

  const fireOff = (seat: "p1" = "p1") =>
    ({
      type: "useAbility",
      seat,
      target: { spot: "active" },
      abilityName: "Fire Off",
    }) as const;

  it("moves a {R} Energy from the Bench to the Active — the destination is forced", () => {
    let state = fireOffBoard(20);
    state = attachBenchFromDeck(state, "p1", 0, "fix-fire-energy", 1);
    const [benched] = benchEnergy(state, "p1", 0);

    const { state: parked } = mustApply(state, fireOff());
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    if (parked.phase.prompt.kind !== "moveEnergy") throw new Error("expected moveEnergy");
    // ONE destination — the route fixes it, so the only live decision is which
    // Energy. The prompt still carries it, because the dialog and the wire
    // validator read the prompt and neither knows a route exists.
    expect(parked.phase.prompt.destinations).toEqual([{ seat: "p1", spot: { spot: "active" } }]);
    expect(parked.phase.prompt.note).toBe(
      "Move a Fire Energy from 1 of your Benched Pokémon to your Active Pokémon.",
    );

    const { state: done } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: {
        kind: "moveEnergy",
        picks: [
          { uid: benched as string, dest: { seat: "p1", spot: { spot: "active" } } },
        ],
      },
    });
    expect(activeEnergy(done, "p1")).toEqual([benched]);
    expect(benchEnergy(done, "p1", 0)).toEqual([]);
    // The turn resumes — an Ability is not an attack (§9).
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p1" });
  });

  it("offers only the {R} Energy on the bench — not the other types, not the Active's", () => {
    let state = fireOffBoard(21);
    state = attachFromDeck(state, "p1", "fix-fire-energy", 1); // the ACTIVE's own
    state = attachBenchFromDeck(state, "p1", 0, "fix-fire-energy", 1);
    state = attachBenchFromDeck(state, "p1", 0, "fix-water-energy", 1);
    const bench = benchEnergy(state, "p1", 0);

    const { state: parked } = mustApply(state, fireOff());
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    if (parked.phase.prompt.kind !== "moveEnergy") throw new Error("expected moveEnergy");
    // The route's source scope AND the filter, both at once: the Active's Fire is
    // excluded by the route (a benchToActive move cannot start on the Active) and
    // the bench's Water by the filter.
    expect(parked.phase.prompt.movable.map((m) => m.uid)).toEqual([bench[0]]);
  });

  it("a LUMINOUS on the Bench is movable as a {R} — and is not once demoted", () => {
    // The same host-dependence, read by the OTHER consumer. One vocabulary means
    // one answer: whatever counts as a {R} Energy for Arcanine ex's discard
    // counts as one for Armarouge's move.
    let wild = fireOffBoard(22);
    wild = attachBenchFromDeck(wild, "p1", 0, "sv02-191", 1);
    const { state: parked } = mustApply(wild, fireOff());
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    if (parked.phase.prompt.kind !== "moveEnergy") throw new Error("expected moveEnergy");
    expect(parked.phase.prompt.movable).toHaveLength(1);

    // Add a Jet beside it: Luminous now provides {C} alone, so nothing on the
    // bench is a {R} Energy and the Ability has no legal target at all.
    let demoted = fireOffBoard(22);
    demoted = attachBenchFromDeck(demoted, "p1", 0, "sv02-191", 1);
    demoted = attachBenchFromDeck(demoted, "p1", 0, "sv02-190", 1);
    expectErr(demoted, fireOff(), "NO_LEGAL_TARGET");
  });

  it("is usable AS OFTEN AS YOU LIKE — twice in one turn", () => {
    // "As often as you like" is `oncePerTurn: false`, so no allowance is stamped
    // and the second use is as legal as the first.
    let state = fireOffBoard(23);
    state = attachBenchFromDeck(state, "p1", 0, "fix-fire-energy", 1);
    state = attachBenchFromDeck(state, "p1", 0, "fix-fire-energy-alt", 1);
    const bench = benchEnergy(state, "p1", 0);
    const dest = { seat: "p1", spot: { spot: "active" } } as const;

    let next = mustApply(state, fireOff()).state;
    next = mustApply(next, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "moveEnergy", picks: [{ uid: bench[0] as string, dest }] },
    }).state;
    next = mustApply(next, fireOff()).state;
    next = mustApply(next, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "moveEnergy", picks: [{ uid: bench[1] as string, dest }] },
    }).state;

    expect(activeEnergy(next, "p1")).toEqual([bench[0], bench[1]]);
    expect(benchEnergy(next, "p1", 0)).toEqual([]);
  });

  it("works from the BENCH — the card never says 'this Pokémon'", () => {
    // §9: an Ability works wherever the Pokémon is unless the card says
    // otherwise, and "Fire Off" names its endpoints outright rather than saying
    // "this Pokémon". So a BENCHED Armarouge may move its OWN {R} to whatever is
    // Active — a use the Active-only flag would have wrongly refused.
    let state = board(24);
    state = setActiveFromDeck(state, "p1", "fix-basic-1");
    state = setActiveFromDeck(state, "p2", "fix-titan");
    state = benchFromDeck(state, "p1", "sv01-041");
    // Setting the Active displaces the previous one onto the Bench, so Armarouge
    // is the LAST benched Pokémon rather than bench[0].
    const index = state.players.p1.bench.length - 1;
    state = attachBenchFromDeck(state, "p1", index, "fix-fire-energy", 1);
    const [own] = benchEnergy(state, "p1", index);

    const { state: done } = mustApply(
      mustApply(state, {
        type: "useAbility",
        seat: "p1",
        target: { spot: "bench", index },
        abilityName: "Fire Off",
      }).state,
      {
        type: "resolveEffect",
        seat: "p1",
        choice: {
          kind: "moveEnergy",
          picks: [
            { uid: own as string, dest: { seat: "p1", spot: { spot: "active" } } },
          ],
        },
      },
    );
    expect(activeEnergy(done, "p1")).toEqual([own]);
  });

  it("cannot be used when the only {R} is on the ACTIVE — the route is bench-only", () => {
    // The playability gate mirrors the op's own no-op test, endpoint rule
    // included: an Active-only Fire board would move nothing, so the Ability is
    // refused rather than opening a dialog with an empty offer.
    let state = fireOffBoard(25);
    state = attachFromDeck(state, "p1", "fix-fire-energy", 2);
    expectErr(state, fireOff(), "NO_LEGAL_TARGET");
  });

  it("cannot be used with no bench at all", () => {
    let state = board(26);
    state = setActiveFromDeck(state, "p1", "sv01-041");
    state = setActiveFromDeck(state, "p2", "fix-titan");
    expectErr(state, fireOff(), "NO_LEGAL_TARGET");
  });

  it("the ENERGY_MOVED destination is the engine's own value, not the client's object", () => {
    // The event payload is the §2 copy contract, and `dest` arrives over the WIRE.
    // validateChoice proves it refEquals an offered ref — but refEquals compares
    // seat/spot/index only, so any extra key a client hangs on it would ride a
    // spread straight into an event handed to the animator, the log, and (P4) the
    // opponent. The state was never at risk; the EVENT is, and a copy of
    // attacker-controlled data is not a copy of the engine's own value.
    let state = fireOffBoard(28);
    state = attachBenchFromDeck(state, "p1", 0, "fix-fire-energy", 1);
    const [benched] = benchEnergy(state, "p1", 0);
    const { state: parked } = mustApply(state, fireOff());

    const { events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: {
        kind: "moveEnergy",
        picks: [
          {
            uid: benched as string,
            // A legal destination by every rule validateChoice applies — plus junk.
            dest: {
              seat: "p1",
              spot: { spot: "active", index: 99, evil: "payload" },
            } as unknown as PokemonRef,
          },
        ],
      },
    });
    const moved = events.find((e) => e.type === "ENERGY_MOVED");
    if (moved?.type !== "ENERGY_MOVED") throw new Error("expected ENERGY_MOVED");
    expect(moved.to).toEqual({ spot: "active" }); // exactly the engine's own shape
    expect(Object.keys(moved.to)).toEqual(["spot"]);
  });

  it("rejects a wire choice that names the Active's own Energy as the source", () => {
    let state = fireOffBoard(27);
    state = attachFromDeck(state, "p1", "fix-fire-energy", 1);
    state = attachBenchFromDeck(state, "p1", 0, "fix-fire-energy", 1);
    const [onActive] = activeEnergy(state, "p1");

    const { state: parked } = mustApply(state, fireOff());
    expectErr(
      parked,
      {
        type: "resolveEffect",
        seat: "p1",
        choice: {
          kind: "moveEnergy",
          picks: [
            { uid: onActive as string, dest: { seat: "p1", spot: { spot: "active" } } },
          ],
        },
      },
      "BAD_EFFECT_CHOICE",
    );
  });
});
