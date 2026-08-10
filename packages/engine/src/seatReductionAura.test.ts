import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { seatDamageReduction } from "./continuous";
import { applyAction, createGame, programFor } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import {
  FIXTURE_POOL,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  setActiveFromDeck,
} from "./testFixtures";

// D321 — THE AFTER-W/R SEAT AURA'S SECOND AND THIRD SENTENCES, AND THE FIELD
// THAT STOPPED BEING A BARE NUMBER.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHAT THIS SESSION WAS ORDERED TO BUILD, AND WHY IT IS NOT WHAT IT BUILT.
// ─────────────────────────────────────────────────────────────────────────────
//
// The handoff ordered Meowscarada `sv09-018` "Showtime" — *"Once during your
// turn, if this Pokémon is on your Bench, you may switch it with your Active
// Pokémon."* — priced at ONE printing and framed as *"`activeOnly`'s exact
// inverse with a live control"*, with an explicit instruction to open
// `programPlayable` and the `playableIf` block before believing the price.
//
// 🛑 **OPENED. THE ROW IS WORTH ZERO: IT SHIPPED AT D244.** `registry.ts` keys
// `sv09-018` to `SHOWTIME`, an activated Ability with `activeOnly: false` and a
// one-op program. The printed *"if this Pokémon is on your Bench"* is neither a
// flag nor a `playableIf`: `programPlayable`'s `switchActive` arm passes the
// source uid to `switchActiveTargets`, and an ACTIVE Meowscarada has no bench ref
// to switch with, so the candidate set is EMPTY and the Ability is refused there.
// `benchSwitchTrigger.test.ts` §4 drives all of it, attribution control included.
// **The price was a claim about a FIELD; the code had made it a claim about a
// CANDIDATE SET, and one grep for the id settled it.** That is D320's own lesson
// — *"a handoff can name the wrong FUNCTION, not just the wrong count"* — landing
// on the very next slice, and the general form is one line long: **a backlog row
// that names an unbuilt card is a claim about the REGISTRY, so grep the registry
// before pricing it.**
//
// ─────────────────────────────────────────────────────────────────────────────
// THE SENTENCES, transcribed off the remote D1 `luminous`
// (`735f0fb5-cdc3-494d-8b97-74a8ade0124a`) on 2026-08-10 rather than copied out
// of a census bullet (D306).
// ─────────────────────────────────────────────────────────────────────────────
//
//   "As long as this Pokémon is on your Bench, all of your Steven's Pokémon take
//    30 less damage from attacks from your opponent's Pokémon (after applying
//    Weakness and Resistance). The effect of Stone Palace doesn't stack."
//        — Steven's Carbink `sv10-086`, 1 legal printing, Basic, {P}, 80 HP.
//
//   "As long as you have at least 1 other Bouffalant in play, all of your Basic
//    {C} Pokémon take 60 less damage from attacks from your opponent's Pokémon
//    (after applying Weakness and Resistance). The effect of Curly Wall doesn't
//    stack."
//        — Bouffalant `sv07-119` / `svp-136`, 2 legal printings, Basic, {C},
//          100 HP.
//
// ── THE CENSUS, RE-RUN AT MULTIPLE WIDTHS AND WORD ORDERS ───────────────────
//
// All 3,786 rows, one query per column (D283's compound-SELECT limit), legal
// count in parentheses:
//
//     predicate                                  attacks  abilities  effect
//     instr(col, "oesn't stack")                    0      10 (8)       0
//     instr(col, "other Bouffalant in play")        0       2 (2)       0
//     instr(col, "As long as") + "on your Bench, "  0       8 (6)       0
//     instr(col, "take 30 less damage")             0       3 (1)       0
//
// 🛑 **THE STACKING CLAUSE IS 8 LEGAL PRINTINGS ON SIX ABILITIES, AND D320's "6
// on 4" WAS THE AURA SUBSET RATHER THAN THE WHOLE — BOTH FIGURES RE-DERIVE.** The
// six are Curly Wall (2), Stone Palace (1), Vibrant Dance (1), Extra Helpings (2),
// Darkest Impulse (1) and Wonder Kiss (1); the last two are not auras at all (a
// trigger, built at D320, and a PRIZE modifier on the §8.1 KO sweep, still
// unbuilt). Of the six AURA printings, two are Hop's Snorlax and have carried
// `noStack` since D243 — **so there was never an idempotence slice here**, which
// is what D320 measured and this slice inherits rather than re-derives.
//
// 🛑 **AND THE BENCH-SOURCE CLAUSE IS ITS OWN FAMILY: 6 legal printings on FIVE
// sentences**, of which Poltchageist `sv06-020`/`-171` + Misty's Magikarp
// `sv10-048` were built at D253 (the HOLDER-zone form, folded by `passivesOf`),
// this slice takes the fifth, and TWO are consequents this engine does not have —
// Gastrodon `sv08-107` (*"Benched Stage 2 Pokémon … have no Abilities"*) and
// Toedscruel `sv09-089` (*"your Active Pokémon's Retreat Cost is {C}{C} less"*).
// **Same printed antecedent, five different consequents, five rows.**
//
// ── WHAT THE WIDENING COST, MEASURED BY GREPPING THE READ SITES ─────────────
//
// `seatDamageReduction` is called at FOUR sites (`attack.ts` main hit ×1,
// `interpreter.ts` ×3 — the two `ignoreWR` snipe arms and the spread arm) and
// **not one of them takes a diff**, because every rider is answerable from what
// the scan already holds:
//   1. BENEFICIARY — matched against the DAMAGED body, which is the function's
//      own first argument. ⚠️ It narrows the TARGET, where `seatPreWRDamageBonus`'s
//      identically-named rider narrows the ATTACKER: two fields, opposite ends of
//      the damage step, one word.
//   2. SOURCE ZONE — `isOnBench(state, holder)`, D253's predicate, ALREADY IN
//      THIS FILE'S MODULE and seat-blind by construction. **This is D319's rule
//      run forwards: grep the module for the reader that already answers it.**
//   3. "1 OTHER <name> IN PLAY" — a top-uid comparison over the holders this loop
//      already walks. `BoardCondition.yourNamedPokemonInPlay` cannot express it:
//      it would be satisfied by the Bouffalant printing the sentence.
//   4. `noStack` — `seatPreWRDamageBonus`'s `capped` ledger, copied whole.
// `MATCH_RECORD_VERSION` does not move: this is a catalog fact re-derived from the
// board on every read and persisted nowhere.

const CARBINK = "sv10-086";
const BOUFFALANT = "sv07-119";
const BOUFFALANT_REPRINT = "svp-136";
/** Hariyama `sv02-113` "Arm Thrust Practice" — the field's UNMARKED print and
    this suite's control at every rider: no zone gate, no beneficiary, no partner
    clause, no cap. `legal_standard = 0` (rotated), which is why it moves no
    census row and is still the only way to see what a bare amount does. */
const HARIYAMA = "sv02-113";

/** A Steven's-prefixed teammate that prints NO Ability — so every "the aura paid
    it" line below is about the Carbink's sentence and not about its own. */
const STEVEN_ALLY = "fix-steven-ally";
/** The beneficiary CONTROL: identical in every field the scan reads EXCEPT the
    owner prefix. Without it, a build that dropped `beneficiary` entirely would be
    green on every board in this file. */
const PLAIN_ALLY = "fix-plain-ally";
/** A Basic {C} body — Curly Wall's beneficiary — and its STAGE control, a
    Stage 1 that is {C} and therefore outside the printed noun. */
const C_BASIC = "fix-c-basic";
const C_EVO = "fix-c-evo";
/** A Basic body that is NOT {C}: the TYPE control, the other half of
    `typedPokemon`'s two conjuncts. */
const M_BASIC = "fix-m-basic";
/** A body that is BOTH a Steven's Pokémon AND a Basic {C} Pokémon — the only way
    to put one defender inside BOTH beneficiary sets at once, which is what the
    two-different-caps board in §4 needs. */
const STEVEN_C_BASIC = "fix-steven-c-basic";
/** A Basic {C} body with a ×2 FIGHTING weakness, and the {F} attacker that
    exploits it — together they are the *"after applying Weakness and
    Resistance"* clause, which no amount of arithmetic on an unweakened board can
    separate from "before". */
const WEAK_BASIC = "fix-weak-basic";
const HITTER = "fix-hitter";
/** Klefki `sv01-096` "Mischievous Lock" — *"As long as this Pokémon is in the
    Active Spot, each Basic Pokémon in play (both yours and your opponent's) has
    no Abilities."* The §9 lock this family is suppressed by, and a real printing
    rather than a fixture, so the silence is the catalog's and not this file's.
    Both new sources are BASICS, which is the only reason Klefki can reach them. */
const KLEFKI = "sv01-096";
const F_HITTER = "fix-f-hitter";

const FLAT = { name: "Flat Hit", cost: ["Colorless"], damage: 100 };

/** ⚠️ **EVERY LOCAL BODY OMITS WEAKNESS AND RESISTANCE EXCEPT `fix-weak-basic`,
    AND THE THREE REAL IDS ARE DECLARED WITHOUT THEIRS.** The printed rows carry
    them (Steven's Carbink ×2 {M}, Bouffalant ×2 {F}), and the omission is stated
    rather than silent for `aquaWash.test.ts`'s reason: `catalogManifest.test.ts`
    diffs `FIXTURE_POOL` alone and reaches none of `sv07`/`sv10`/`svp`, so a
    fixture that quietly diverges from a print has no guard behind it. What is
    load-bearing here is that a reduction lands AFTER W/R, and `fix-weak-basic`
    is where that is driven; everywhere else a weakness would only make the
    arithmetic ambiguous. */
const LOCAL_CARDS: Record<string, Card> = {
  [CARBINK]: battler(CARBINK, {
    name: "Steven's Carbink",
    hp: 80,
    retreat: 2,
    types: ["Psychic"],
    abilities: [
      {
        type: "Ability",
        name: "Stone Palace",
        effect:
          "As long as this Pokémon is on your Bench, all of your Steven's Pokémon take 30 less damage from attacks from your opponent's Pokémon (after applying Weakness and Resistance). The effect of Stone Palace doesn't stack.",
      },
    ],
  }),
  [BOUFFALANT]: bouffalant(BOUFFALANT),
  [BOUFFALANT_REPRINT]: bouffalant(BOUFFALANT_REPRINT),
  [HARIYAMA]: battler(HARIYAMA, {
    name: "Hariyama",
    hp: 140,
    retreat: 3,
    types: ["Fighting"],
    stage: "Stage1",
    evolveFrom: "Makuhita",
    abilities: [
      {
        type: "Ability",
        name: "Arm Thrust Practice",
        effect:
          "All of your Pokémon take 10 less damage from attacks from your opponent's Pokémon (after applying Weakness and Resistance).",
      },
    ],
  }),
  [STEVEN_ALLY]: battler(STEVEN_ALLY, { name: "Steven's Beldum", hp: 200, types: ["Metal"] }),
  [PLAIN_ALLY]: battler(PLAIN_ALLY, { name: "Beldum", hp: 200, types: ["Metal"] }),
  [C_BASIC]: battler(C_BASIC, { name: "Plain Bull", hp: 200, types: ["Colorless"] }),
  [C_EVO]: battler(C_EVO, {
    name: "Plain Bull Evolved",
    hp: 200,
    types: ["Colorless"],
    stage: "Stage1",
    evolveFrom: "Plain Bull",
  }),
  [M_BASIC]: battler(M_BASIC, { name: "Plain Steel", hp: 200, types: ["Metal"] }),
  [STEVEN_C_BASIC]: battler(STEVEN_C_BASIC, {
    name: "Steven's Bull",
    hp: 200,
    types: ["Colorless"],
  }),
  [WEAK_BASIC]: battler(WEAK_BASIC, {
    name: "Brittle Bull",
    hp: 300,
    types: ["Colorless"],
    weaknesses: [{ type: "Fighting", value: "×2" }],
  }),
  [HITTER]: battler(HITTER, { name: "Flat Hitter", hp: 200, attacks: [FLAT] }),
  [F_HITTER]: battler(F_HITTER, {
    name: "Fighting Hitter",
    hp: 200,
    types: ["Fighting"],
    attacks: [{ ...FLAT }],
  }),
};

function bouffalant(id: string): Card {
  return battler(id, {
    name: "Bouffalant",
    hp: 100,
    retreat: 2,
    types: ["Colorless"],
    abilities: [
      {
        type: "Ability",
        name: "Curly Wall",
        effect:
          "As long as you have at least 1 other Bouffalant in play, all of your Basic {C} Pokémon take 60 less damage from attacks from your opponent's Pokémon (after applying Weakness and Resistance). The effect of Curly Wall doesn't stack.",
      },
    ],
  });
}

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

/** This suite's own seeded deck (D270's rule). */
const AURA_DECK = deckOf({
  [CARBINK]: 4,
  [BOUFFALANT]: 3,
  [BOUFFALANT_REPRINT]: 4,
  [HARIYAMA]: 3,
  [STEVEN_ALLY]: 3,
  [PLAIN_ALLY]: 3,
  [C_BASIC]: 3,
  [C_EVO]: 3,
  [M_BASIC]: 3,
  [STEVEN_C_BASIC]: 3,
  [WEAK_BASIC]: 3,
  [KLEFKI]: 3,
  [HITTER]: 3,
  [F_HITTER]: 4,
  "fix-basic-1": 5,
  "fix-energy": 10,
});

/** Three seeds, so nothing below rests on one shuffle (D270). */
const SEEDS = [7101, 7103, 7109] as const;

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

function firstBasicInHand(state: GameState, seat: Seat): string {
  const uid = state.players[seat].hand.find((h) => {
    const card = POOL[state.cardIdByUid[h] ?? ""];
    return card?.category === "Pokemon" && card.stage === "Basic";
  });
  if (uid === undefined) throw new Error(`no Basic in ${seat}'s hand`);
  return uid;
}

function localSetup(seed: number): GameState {
  const created = createGame({ seed, decks: { p1: AURA_DECK, p2: AURA_DECK }, cardPool: POOL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(
    applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first: "p2" }),
  );
  while (state.phase.kind === "setup:drawExtra") {
    const phase = state.phase;
    const seat = (["p1", "p2"] as const).find((s) => !phase.decided[s]);
    if (seat === undefined) throw new Error("setup:drawExtra with every seat decided");
    state = must(applyAction(state, { type: "setupDrawExtra", seat, count: phase.owed[seat] }));
  }
  for (const seat of ["p1", "p2"] as const) {
    state = must(
      applyAction(state, { type: "setupPlaceActive", seat, uid: firstBasicInHand(state, seat) }),
    );
  }
  for (const seat of ["p1", "p2"] as const) {
    state = must(applyAction(state, { type: "setupReady", seat }));
  }
  return state;
}

/** P2 attacks P1. `defender` is P1's Active, `p1Bench` are P1's benched bodies
    (the aura SOURCES live there on every board but the promotion cases), and P2's
    Active is `attacker` holding one {C} Energy for the flat 100.

    Walked to turn 3 so no §4 first-turn bar applies to anything. */
function board(
  seed: number,
  defender: string,
  p1Bench: readonly string[],
  attacker: string = HITTER,
  p1Active: string = defender,
): GameState {
  let state = localSetup(seed);
  state = clearBench(setActiveFromDeck(state, "p1", p1Active), "p1");
  for (const id of p1Bench) state = benchFromDeck(state, "p1", id);
  if (p1Bench.length === 0) state = benchFromDeck(state, "p1", "fix-basic-1");
  state = clearBench(setActiveFromDeck(state, "p2", attacker), "p2");
  state = benchFromDeck(state, "p2", "fix-basic-1");
  for (let i = 0; i < 12; i += 1) {
    if (state.phase.kind !== "turn:action") throw new Error(`stuck in ${state.phase.kind}`);
    if (state.phase.seat === "p2" && state.turn >= 3) break;
    state = must(applyAction(state, { type: "endTurn", seat: state.phase.seat }));
  }
  return attachFromDeck(state, "p2", "fix-energy", 1);
}

/** The damage P1's Active actually TAKES, off a real declaration. Every attacker
    in this cast prints a flat 100, so the delta from 100 (or from 200 on the
    weakness board) IS the aura. */
function dealt(state: GameState): number {
  const hit = must(applyAction(state, { type: "attack", seat: "p2", index: 0 }));
  const damage = hit.players.p1.active?.damage;
  if (damage === undefined) throw new Error("p1 has no Active after the attack");
  return damage;
}

function events(state: GameState): GameEvent[] {
  const result = applyAction(state, { type: "attack", seat: "p2", index: 0 });
  if (!result.ok) throw new Error(`attack failed: ${result.error.code}`);
  return result.events;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. THE THREE REGISTRY ROWS — and what each one is NOT.
// ─────────────────────────────────────────────────────────────────────────────

describe("D321 §1 — the three registry rows", () => {
  it("Stone Palace authors THREE riders and deliberately not the fourth", () => {
    expect(programFor(CARBINK)?.passive).toEqual({
      seatDamageReductionAfterWR: {
        amount: 30,
        beneficiary: { kind: "ownerPokemon", owner: "Steven" },
        sourceOnBench: true,
        noStack: "Stone Palace",
      },
    });
    // 🛑 NOT the field one screen up in `PassiveEffects`. `damageReductionAfterWR`
    // is a `passivesOf` FOLD and modifies its HOLDER alone, so a build that
    // reached for it would shield the Carbink and nothing else — green on a board
    // where the Carbink is the one being hit, which is the board this card is
    // never played for. The negative is asserted, not assumed.
    expect(programFor(CARBINK)?.passive?.damageReductionAfterWR).toBeUndefined();
    expect(programFor(CARBINK)?.abilities).toBeUndefined();
    expect(programFor(CARBINK)?.attack).toBeUndefined();
  });

  it("Curly Wall authors the OTHER three, and both printings share ONE object", () => {
    for (const id of [BOUFFALANT, BOUFFALANT_REPRINT]) {
      expect(programFor(id)?.passive?.seatDamageReductionAfterWR).toEqual({
        amount: 60,
        beneficiary: { kind: "typedPokemon", pokemonType: "Colorless", stage: "basic" },
        otherNamedInPlay: "Bouffalant",
        noStack: "Curly Wall",
      });
    }
    // The reprint is the SAME program object, not a copy — D190b's exact-map rule.
    expect(programFor(BOUFFALANT)).toBe(programFor(BOUFFALANT_REPRINT));
  });

  it("Hariyama is STILL the bare amount, which is what makes it a control", () => {
    expect(programFor(HARIYAMA)?.passive).toEqual({
      seatDamageReductionAfterWR: { amount: 10 },
    });
    const bare = programFor(HARIYAMA)?.passive?.seatDamageReductionAfterWR;
    expect(bare?.beneficiary).toBeUndefined();
    expect(bare?.sourceOnBench).toBeUndefined();
    expect(bare?.otherNamedInPlay).toBeUndefined();
    expect(bare?.noStack).toBeUndefined();
  });

  it("🛑 the OTHER four bench-source printings are still unbuilt HERE, and three are BUILT elsewhere", () => {
    // Paired with the positives above so the pair can only both pass if this
    // slice built exactly the one sentence of the five whose consequent exists
    // (conventions: a bare "these ids are unbuilt" is nearly always true).
    // Gastrodon's is a benched-Stage-2 Ability LOCK and has no field at all.
    expect(programFor("sv08-107")).toBeUndefined();
    // 🆕 D322 — **AND TOEDSCRUEL `sv09-089` STOPPED BEING UNBUILT.** This line
    // read `programFor("sv09-089")` is `undefined` for exactly one session, and
    // D322 built its retreat reduction on `ownActiveRetreatDiscount`. The repair
    // is a NARROWING and not a deletion: the id stays in this suite, because what
    // this row is actually for is that D321's slice did not reach a SECOND
    // consequent under the same printed antecedent — so the claim becomes "it
    // carries no `seatDamageReductionAfterWR`", which is the sentence this file
    // owns, and it now also pins the field it DID get. Deleting the id would
    // have thrown away the control; asserting the weaker `toBeUndefined` on the
    // program would have been a relaxation.
    expect(programFor("sv09-089")?.passive?.seatDamageReductionAfterWR).toBeUndefined();
    expect(programFor("sv09-089")?.passive?.ownActiveRetreatDiscount).toEqual({
      amount: 2,
      sourceOnBench: true,
    });
    // 🛑 AND THE RIDER IS THE SAME ONE, WHICH IS WHY THIS ROW STILL EARNS ITS
    // PLACE: `sourceOnBench` is D321's field-level rider reused verbatim on a
    // different consequent one session later. Same printed antecedent, same
    // predicate (`isOnBench`), two fields.
    expect(programFor(CARBINK)?.passive?.seatDamageReductionAfterWR?.sourceOnBench).toBe(true);
    // …and the two that ARE built are built on a DIFFERENT field — D253's
    // holder-zone form, folded by `passivesOf`, not scanned seat-wide.
    for (const id of ["sv06-020", "sv06-171", "sv10-048"]) {
      expect(programFor(id)?.passive?.preventDamageAndEffectsFromSpecialEnergy).toBeUndefined();
      expect(programFor(id)?.passive?.seatDamageReductionAfterWR).toBeUndefined();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. STONE PALACE — the source zone, the beneficiary, and the cap.
// ─────────────────────────────────────────────────────────────────────────────

describe("D321 §2 — Stone Palace", () => {
  it.each(SEEDS)("a BENCHED Carbink shields a Steven's Active: 100 → 70 (seed %i)", (seed) => {
    expect(dealt(board(seed, STEVEN_ALLY, [CARBINK]))).toBe(70);
  });

  it.each(SEEDS)("…and the SAME board with no Carbink takes the full 100 (seed %i)", (seed) => {
    // The attribution control (D214): identical board, identical attack, the one
    // benched body swapped for one that prints nothing.
    expect(dealt(board(seed, STEVEN_ALLY, ["fix-basic-1"]))).toBe(100);
  });

  it.each(SEEDS)("🛑 an ACTIVE Carbink shields NOBODY — the source-zone gate (seed %i)", (seed) => {
    // The printed *"As long as this Pokémon is on your Bench"*, and the mutant it
    // kills is `sourceOnBench` being dropped: a promoted Carbink would keep
    // paying its team, which is exactly the board the sentence refuses.
    //
    // ⚠️ READ AT THE SCAN RATHER THAN THROUGH AN ATTACK, AND THE REASON IS THE
    // PRINT: Steven's Carbink has 80 HP and every attacker in this cast deals a
    // flat 100, so putting the source in the Active Spot puts it in the KO sweep
    // and the board after the attack is a promotion rather than a reduction. The
    // two boards below are the SAME two bodies with their spots exchanged.
    const benchedSource = board(seed, STEVEN_ALLY, [CARBINK]);
    const shielded = benchedSource.players.p1.active;
    if (shielded === null) throw new Error("expected a p1 Active");
    expect(seatDamageReduction(benchedSource, shielded, "all")).toBe(30);

    const activeSource = board(seed, STEVEN_ALLY, [STEVEN_ALLY], HITTER, CARBINK);
    const ally = activeSource.players.p1.bench[0];
    if (ally === undefined) throw new Error("expected a benched Steven's ally");
    expect(seatDamageReduction(activeSource, ally, "all")).toBe(0);
  });

  it.each(SEEDS)("a NON-Steven's ally is not shielded — the beneficiary clause (seed %i)", (seed) => {
    // `fix-plain-ally` differs from `fix-steven-ally` in the NAME PREFIX and in
    // nothing else the scan reads. Without this line a build that dropped
    // `beneficiary` would be green on every other board in this section.
    expect(dealt(board(seed, PLAIN_ALLY, [CARBINK]))).toBe(100);
  });

  it.each(SEEDS)("TWO benched Carbink still shield 30, not 60 — the cap (seed %i)", (seed) => {
    // "The effect of Stone Palace doesn't stack." A summing scan pays 60 here and
    // this is the only board in the file that can see the difference.
    expect(dealt(board(seed, STEVEN_ALLY, [CARBINK, CARBINK]))).toBe(70);
  });

  it("a benched Carbink shields ITSELF — self-inclusive, and `scope` is what splits it", () => {
    // The source set CONTAINS the beneficiary set (a Steven's Carbink is a
    // Steven's Pokémon), which is the condition `seatDamageReduction`'s `scope`
    // argument exists for. Read at the function rather than through an attack:
    // §8's main hit always names an ACTIVE, so a benched beneficiary is only
    // reachable from the spread/snipe arms.
    const state = board(SEEDS[0], STEVEN_ALLY, [CARBINK]);
    const benched = state.players.p1.bench[0];
    if (benched === undefined) throw new Error("expected a benched Carbink");
    expect(seatDamageReduction(state, benched, "all")).toBe(30);
    // Feint Attack's reading (D151): the damaged body's OWN contribution is an
    // effect on that Pokémon and is nulled; there is no second source, so 0.
    expect(seatDamageReduction(state, benched, "othersOnly")).toBe(0);
    // …and a TEAMMATE keeps the shield under the same `ignoreWR` declaration,
    // which is the half that makes `scope` a per-BOARD answer and not a per-site
    // one.
    const active = state.players.p1.active;
    if (active === null) throw new Error("expected a p1 Active");
    expect(seatDamageReduction(state, active, "othersOnly")).toBe(30);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. CURLY WALL — the self-excluding partner clause, and its cap.
// ─────────────────────────────────────────────────────────────────────────────

describe("D321 §3 — Curly Wall", () => {
  it.each(SEEDS)("🛑 ONE Bouffalant in play pays NOTHING (seed %i)", (seed) => {
    // The printed "at least 1 OTHER Bouffalant in play", and the whole reason
    // this rider is not `BoardCondition.yourNamedPokemonInPlay`: that member is
    // satisfied by the Bouffalant printing the sentence, so it would pay 60 here.
    expect(dealt(board(seed, C_BASIC, [BOUFFALANT]))).toBe(100);
  });

  it.each(SEEDS)("TWO Bouffalant pay 60, not 120 — both riders at once (seed %i)", (seed) => {
    // 🛑 THE BOARD THE WHOLE ROW IS FOR. A second Bouffalant makes the antecedent
    // true for BOTH bodies at once, so a summing scan pays 120 and the printed
    // "doesn't stack" caps the pair at 60. Neither rider is observable without
    // the other, and this is the only board a real game ever puts them on.
    expect(dealt(board(seed, C_BASIC, [BOUFFALANT, BOUFFALANT_REPRINT]))).toBe(40);
  });

  it.each(SEEDS)("…and the two printings are interchangeable in the pair (seed %i)", (seed) => {
    // Both ids print the same NAME, so the partner clause is satisfied by either
    // combination — a build that compared card IDS rather than printed names
    // would be green on the reprint pair above and red here.
    expect(dealt(board(seed, C_BASIC, [BOUFFALANT_REPRINT, BOUFFALANT_REPRINT]))).toBe(40);
  });

  it.each(SEEDS)("an EVOLUTION {C} body is not shielded — the `stage` conjunct (seed %i)", (seed) => {
    expect(dealt(board(seed, C_EVO, [BOUFFALANT, BOUFFALANT_REPRINT]))).toBe(100);
  });

  it.each(SEEDS)("a Basic that is NOT {C} is not shielded — the type conjunct (seed %i)", (seed) => {
    expect(dealt(board(seed, M_BASIC, [BOUFFALANT, BOUFFALANT_REPRINT]))).toBe(100);
  });

  it("a Bouffalant shields ITSELF once the partner is there — and neither one twice", () => {
    // Bouffalant is a Basic {C} Pokémon, so each is inside the set it pays. Both
    // sources see each other, so `scope: "all"` is the capped 60 and NOT 120;
    // `othersOnly` drops the damaged body's own contribution and the OTHER
    // Bouffalant still caps the same key at 60.
    const state = board(SEEDS[0], C_BASIC, [BOUFFALANT, BOUFFALANT_REPRINT]);
    const first = state.players.p1.bench[0];
    if (first === undefined) throw new Error("expected a benched Bouffalant");
    expect(seatDamageReduction(state, first, "all")).toBe(60);
    expect(seatDamageReduction(state, first, "othersOnly")).toBe(60);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. THE FIELD ITSELF — the order against W/R, the seat boundary, the §9 lock,
//    and two DIFFERENT non-stacking auras on one board.
// ─────────────────────────────────────────────────────────────────────────────

describe("D321 §4 — the field", () => {
  it.each(SEEDS)("the reduction lands AFTER Weakness: 100 ×2 − 60 = 140 (seed %i)", (seed) => {
    // The printed "(after applying Weakness and Resistance)", and the only board
    // in this file where "before" and "after" give different answers: before
    // would be (100 − 60) × 2 = 80.
    expect(dealt(board(seed, WEAK_BASIC, [BOUFFALANT, BOUFFALANT_REPRINT], F_HITTER))).toBe(140);
  });

  it.each(SEEDS)("the aura never crosses the seat boundary (seed %i)", (seed) => {
    // The Carbink is on the ATTACKER's bench and the defender is a Steven's
    // Pokémon on the other side. The scan returns for the side that HOLDS the
    // damaged body, so the far bench is not consulted at all.
    let state = board(seed, STEVEN_ALLY, ["fix-basic-1"]);
    state = benchFromDeck(state, "p2", CARBINK);
    expect(dealt(state)).toBe(100);
  });

  it("two DIFFERENT non-stacking auras on one board each pay once — 30 + 60 = 90", () => {
    // `noStack` is keyed on the printed ABILITY NAME and not on a boolean, which
    // is what makes this board 90 rather than 60: two different printed effects
    // still stack with each other. A boolean would silently merge them, and this
    // is the only assertion in the engine that can tell the two spellings apart.
    // The defender is a Steven's Pokémon AND a Basic {C} body, so it is inside
    // both beneficiary sets at once.
    const state = board(
      SEEDS[0],
      STEVEN_ALLY,
      [CARBINK, BOUFFALANT, BOUFFALANT_REPRINT],
      HITTER,
      STEVEN_C_BASIC,
    );
    expect(dealt(state)).toBe(10);
  });

  it.each(SEEDS)("a §9 Ability-lock silences the SOURCE and the aura stops (seed %i)", (seed) => {
    // The aura is a printed Pokémon Ability, so `disabledAbilityUids` reaches it —
    // per SOURCE, inside the scan, exactly as every other member of this family.
    // Klefki's lock is Active-only and Basic-only, and both new sources are
    // Basics, which is the only reason it can reach either.
    //
    // ⚠️ READ AT THE SCAN AGAIN, and for a different reason than the zone gate:
    // Klefki has to STAND IN P2's ACTIVE SPOT for its own clause to hold, which
    // makes it the attacker — so an attack-driven version of this test would be
    // measuring Klefki's attack rather than the Carbink's silence.
    const state = board(seed, STEVEN_ALLY, [CARBINK]);
    const shielded = state.players.p1.active;
    if (shielded === null) throw new Error("expected a p1 Active");
    expect(seatDamageReduction(state, shielded, "all")).toBe(30);
    const locked = setActiveFromDeck(state, "p2", KLEFKI);
    const stillShielded = locked.players.p1.active;
    if (stillShielded === null) throw new Error("expected a p1 Active");
    expect(seatDamageReduction(locked, stillShielded, "all")).toBe(0);
  });

  it.each(SEEDS)("the damage EVENT reports the reduced number, not the printed one (seed %i)", (seed) => {
    const dealtEvent = events(board(seed, STEVEN_ALLY, [CARBINK])).find(
      (e) => e.type === "DAMAGE_DEALT",
    );
    expect(dealtEvent?.type).toBe("DAMAGE_DEALT");
    if (dealtEvent?.type !== "DAMAGE_DEALT") throw new Error("expected DAMAGE_DEALT");
    expect(dealtEvent.base).toBe(100);
    expect(dealtEvent.dealt).toBe(70);
  });
});
