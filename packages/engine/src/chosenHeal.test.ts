import { describe, expect, it } from "vitest";
import { deriveAttackEffect, programFor } from "./index";
// `applyAction` is imported as a TYPE only: the illegal-choice case builds a
// deliberately malformed action and casts it through `Parameters<typeof applyAction>[1]`
// so the cast is anchored on the real signature rather than on `any`.
import type { GameEvent, GameState, PokemonRef, Seat, applyAction } from "./index";
import {
  CHOSEN_HEAL_DECK,
  FIXTURE_POOL,
  activeUid,
  attachFromDeck,
  benchFromDeck,
  benchTopUid,
  clearBench,
  deepFreeze,
  driveSetup,
  expectErr,
  mustApply,
  setActiveFromDeck,
  setBenchDamage,
  setDamage,
  types,
} from "./testFixtures";

// 0.85.0 → 0.86.0 — the CHOSEN HEAL (D135). "Heal {N|all} damage from 1 of your
// [Benched] Pokémon." — 10 printings / 7 distinct clauses on ONE anchored regex with
// TWO captures, ONE deriver arm, and ONE new FIELD on an op that has shipped since
// 0.x (`healChosen.zone`).
//
// THE THIRD AND LAST SHAPE THE HEAL FAMILY PRINTS. The bare self-heal (D132, "this
// Pokémon") names its target; the own-board heal (D133, "each of your Pokémon")
// names all of them; this one names NONE of them and asks. That is the whole
// difference, and it is why this file looks less like its two neighbours than they
// look like each other: nearly every assertion here is about a PROMPT.
//
// D132'S INVENTORY RULE, one more time and at its cheapest yet. `healChosen` has
// existed since 0.x behind Potion's authored `{ op: "healChosen", amount: 30 }`, and
// its "all" spelling since Arboliva's "Enriching Oil" Ability. What was missing was
// a reader for the same action printed as an ATTACK, plus one optional field for the
// printed word "Benched". The op identity is asserted against Potion's own row below,
// because that equality IS the claim that no mechanism was added.
//
// WHAT IS ACTUALLY NEW HERE, and why this is not a copy of boardHeal.test.ts:
//   • THE PARK, FROM AN ATTACK TAIL. `settleProgram(..., { resumeTail: true })`
//     leaves `attackEpilogue` on `state.pending`, so the turn has NOT ended, no KO
//     sweep has run, and the answer arrives in a second action. Every step of that
//     is asserted, including the ORDER of HEALED before TURN_ENDED.
//   • THE THREE-CANDIDATE-COUNT SPLIT (`parkOrForce`): 0 candidates is a SILENT
//     no-op, exactly 1 is applied INLINE with no prompt at all, ≥2 parks. All three
//     are reachable on this family's boards and all three are driven.
//   • THE ZONE FIELD, which is the only new vocabulary in the slice. It must drop
//     the Active from `prompt.candidates` AND change the prompt's heading, and
//     nothing else. The bench-only board keeps its ACTIVE DAMAGED throughout so
//     that a build which honoured the zone in one of those two places and not the
//     other is visible rather than merely wrong.
//   • THE ATTACKER IS A LEGAL PICK on the any-zone reading (§1.1 — the Active is
//     one of your Pokémon). It has never mattered before, because `healChosen` had
//     only ever been reached from a Trainer or an Ability, where the Active is not
//     the source of the effect.
//   • "all" IS A SPELLING OF THE AMOUNT, not a separate sentence — one alternation
//     branch, driven end to end on a body carrying 300 damage.
//   • NO RNG, NO REGISTRY ROW, and no printed `damage` on ANY of the ten printings:
//     the heal is the entire visible result of every one of these declarations.

/** The seven distinct clauses of the pool, verbatim, and the op each derives to.
    Censused against the local D1 (2026-08-01) over the WHOLE effect string (978
    cards / 6 sets): 10 printings in all, and this is the whole mapped set. Every printing is
    a STANDALONE single sentence, and NOT ONE of the ten carries a printed `damage`
    field — the compound check D131 established was run and came back clean.

    The two readings are split by the one optional capture, and the row order below
    is the census order: 5 printings / 3 clauses any-zone, then 5 / 4 bench-only. */
const CLAUSES = [
  {
    text: "Heal 20 damage from 1 of your Pokémon.",
    op: { op: "healChosen", amount: 20 },
    // Nacli sv02-121 / -220 "Salt Coating" — one attack in two rarities, and the
    // fixture this suite drives for the any-zone reading.
    printings: 2,
  },
  {
    text: "Heal 30 damage from 1 of your Pokémon.",
    op: { op: "healChosen", amount: 30 },
    // Smoliv sv01-021 "Nutrients". Also, byte for byte, Potion's authored program —
    // see the op-identity case below.
    printings: 1,
  },
  {
    text: "Heal 60 damage from 1 of your Pokémon.",
    op: { op: "healChosen", amount: 60 },
    // Vespiquen ex sv03-096 / -212 "Healing Pheromone".
    printings: 2,
  },
  {
    text: "Heal 20 damage from 1 of your Benched Pokémon.",
    op: { op: "healChosen", amount: 20, zone: "bench" },
    // Combee sv03-008 "Share".
    printings: 1,
  },
  {
    text: "Heal 30 damage from 1 of your Benched Pokémon.",
    op: { op: "healChosen", amount: 30, zone: "bench" },
    // Chansey swsh10.5-051 "Delicious Egg".
    printings: 1,
  },
  {
    text: "Heal 60 damage from 1 of your Benched Pokémon.",
    op: { op: "healChosen", amount: 60, zone: "bench" },
    // Tropius sv01-007 "Fresh-Picked Fruit" — the fixture this suite drives for the
    // bench-only reading.
    printings: 1,
  },
  {
    text: "Heal all damage from 1 of your Benched Pokémon.",
    op: { op: "healChosen", amount: "all", zone: "bench" },
    // Blissey swsh10.5-052 "Enriching Egg" + Arboliva sv03-021 "Healing Fruit" —
    // the only clause whose amount is not a number, and the reason fix-allheal
    // exists (both printings are EVOLUTIONS).
    printings: 2,
  },
] as const;

/** Every card id in the census, in the order the clause table walks them. Named
    rather than inlined because the zero-registry-row sweep and the "the fixtures are
    only 3 of the 10" count both quote it. */
const CENSUS_IDS = [
  "sv02-121", // Nacli
  "sv02-220", // Nacli (Illustration rare)
  "sv01-021", // Smoliv
  "sv03-096", // Vespiquen ex
  "sv03-212", // Vespiquen ex (Ultra Rare)
  "sv03-008", // Combee
  "swsh10.5-051", // Chansey
  "sv01-007", // Tropius
  "swsh10.5-052", // Blissey
  "sv03-021", // Arboliva
] as const;

/** The real catalog rows this anchor must refuse, verbatim off the local D1. Every
    one contains the mapped words; not one is the mapped sentence:
      • 🆕🆕 **BUILT AT D427.** This bullet named Iron Moth sv06.5-009 "Suction" — *"a
        self-heal whose AMOUNT is read off the damage just dealt. Unmapped everywhere:
        no op expresses it."* An op expresses it now: `heal` took `amount: number |
        "dealt"` and `EffectContext` took the figure. The slot is RE-POINTED (see the
        comment on the list entry) rather than emptied.
      • Saguaro sv02-187 / -255 / -270 — THE DANGEROUS ONE, and dangerous in a way
        it is not for D133. It prints "Choose up to 2 of your Pokémon and heal 50
        damage from each of them.", which is the SAME OP this arm emits (`healChosen`,
        with `upTo: 2`) reached through an authored registry row. So a reader without
        `^` would not merely mis-map it — it would map it to a plausible-looking
        single-target heal and the registry row would then silently disagree with the
        derived one. It is a Supporter and never reaches this deriver in production,
        which is exactly why the guard is asserted here rather than left to routing.
      • Picnic Basket sv01-184 — "each Pokémon (both yours and your opponent's)", the
        `healEachAll` sentence. The SEAT boundary in text form, and the widest blast
        radius in the family.
      • Floette sv01-092 "Magical Leaf" — the mapped words mid-sentence behind a coin
        gate AND a damage rider: "Flip a coin. If heads, this attack does 30 more
        damage, and heal 30 damage from this Pokémon." Two things at once that this
        arm cannot express, and the reason no /i flag is on the regex.

    STANDING NOTE: when a later slice maps one of these, RE-POINT the case at another
    still-unmapped clause — never delete it. The suite's claim is that an unread
    sentence stays LOUD, and that claim needs a live witness to keep being about
    anything. (D134 is the precedent: Fuecoco's gated self-heal was a near-miss
    witness in two files until the flip-gated family mapped it, and both files
    re-pointed rather than dropped the case.) */
const REAL_NEAR_MISSES = [
  // 🆕🆕 RE-POINTED AT D427 (0.328.0 → 0.329.0). This slot held *"Heal from this
  // Pokémon the same amount of damage you did to your opponent's Active Pokémon."* — the
  // row the doc block below calls *"a self-heal whose AMOUNT is read off the damage just
  // dealt. Unmapped everywhere: no op expresses it."* — until D427 BUILT it (6 legal
  // printings; `deriveAttackEffect` arm 45 over `heal.amount: number | "dealt"`, the
  // figure carried on `EffectContext.dealt`). Re-pointed rather than deleted, per the
  // STANDING NOTE above, onto a row refused by every one of the twelve readers TODAY
  // (measured, not assumed) and a NEARER miss for this anchor than the old one: it
  // prints this anchor's exact verb, its exact `(\d+)` slot and its exact `from 1 of
  // your` — and then NARROWS the target with two adjectives the anchor does not carry.
  // ⚠️ WHAT THE OLD CLAIM COULD CATCH AND THIS ONE CANNOT (D418): it was one of three
  // rungs asserting that the damage-echo shape reached no reader at all. That claim is
  // now FALSE and cannot be preserved anywhere; its DISCRIMINATION — that a heal anchor
  // must refuse an amount slot that is not a numeral — is pinned directly in
  // `selfHealDealt.test.ts` §2, which drives both anchors against both strings.
  // 1 legal printing, corpus line 272.
  "Heal 100 damage from 1 of your Benched Ancient Pokémon.",
  "Choose up to 2 of your Pokémon and heal 50 damage from each of them.",
  "Heal 30 damage from each Pokémon (both yours and your opponent's).",
  "Flip a coin. If heads, this attack does 30 more damage, and heal 30 damage from this Pokémon.",
] as const;

/** U+00A0, spelled as an ESCAPE rather than typed. Byte-different from an ASCII
    space and INVISIBLE in a diff, which is exactly why the case names it instead of
    carrying it — a re-ingest that swapped one in would un-simulate ten printings with
    nothing on screen to see. */
const NBSP = "\u00a0";

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

function all<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

/** The parked `choosePokemon` prompt, narrowed — every end-to-end case below reads
    `candidates` and `note` off it, and a state that did NOT park fails here with the
    reason rather than three lines later on an undefined. */
function choosePrompt(state: GameState): { candidates: PokemonRef[]; note: string } {
  if (state.phase.kind !== "effect:choose") {
    throw new Error(`expected effect:choose, got ${state.phase.kind}`);
  }
  if (state.phase.prompt.kind !== "choosePokemon") {
    throw new Error(`expected choosePokemon, got ${state.phase.prompt.kind}`);
  }
  return { candidates: state.phase.prompt.candidates, note: state.phase.prompt.note };
}

/** All three fixtures print the chosen heal FIRST and an effect-less damaging attack
    second. Named rather than inlined, so a re-ingest that reordered an attack fails
    on the fixture guards below rather than silently moving every case onto the wrong
    sentence. */
const SALT_COATING_INDEX = 0;
const TACKLE_INDEX = 1;
const FRESH_PICKED_INDEX = 0;
const RAZOR_LEAF_INDEX = 1;
const WHOLE_HEAL_INDEX = 0;

/** The three printed heals and the two controls' damage. The heals are three
    different values on purpose: a hardcoded amount anywhere downstream of the deriver
    cannot satisfy more than one of them. */
const SALT_COATING_HEAL = 20;
const TACKLE_DAMAGE = 30;
const FRESH_PICKED_HEAL = 60;
const RAZOR_LEAF_DAMAGE = 50;

/** The attacker's own damage on the boards that measure a pick. WELL UNDER Nacli's
    70 HP and Tropius's 100, which is not a detail: the attacker carries its damage
    before it declares, so a figure at or above its HP is a body the attack epilogue
    sweeps off the board mid-case, and every assertion would then be about a promoted
    stranger rather than about the heal. */
const ATTACKER_HURT = 50;

/** The benched candidate's damage. GREATER than either printed heal so a resolved
    pick leaves a NON-ZERO remainder — a body healed exactly to zero cannot tell
    "healed 20" from "healed everything", which is the very distinction the "all"
    case turns on. */
const BENCH_HURT = 80;

/** LESS than Salt Coating's printed 20 — the clamped body, where the heal lands at 0
    and must not go negative or spend the difference elsewhere. */
const BENCH_BARELY_HURT = 10;

/** The "all" case's figure, and it is deliberately ENORMOUS: no printed N in this
    family comes near 300, so a build that treated "all" as some large number would
    have to have picked one at least this big. fix-titan's 340 HP carries it without
    the epilogue's KO sweep removing the candidate from under the assertion. */
const BENCH_WRECKED = 300;

const ACTIVE_REF = { seat: "p1", spot: { spot: "active" } } as const;
const BENCH_0 = { seat: "p1", spot: { spot: "bench", index: 0 } } as const;
const BENCH_1 = { seat: "p1", spot: { spot: "bench", index: 1 } } as const;

/** ONE BOARD, NO SWEEP. Nothing in this slice takes a coin, so there is no seed to
    vary and a single deterministic board is the whole account.

    Setup then open P1's turn 2 (P2 went first and passed), so the attack step is
    legal (§4). Both Active spots are pinned to fix-titan (340 HP, no Weakness, no
    Resistance, NO ATTACKS) by surgery: NEITHER heal attack prints damage at all, so
    the defender cannot be KO'd and no promotion can park mid-flight to compete with
    the heal's own park — which is the one interference this suite genuinely could
    not survive, since both would write `state.phase`.

    ⚠️ AND BOTH BENCHES ARE EMPTIED (D133's trap). `setActiveFromDeck` DISPLACES the
    Active it replaces onto the bench, so each surgery leaves a benched body behind;
    a file that only asserts the Active never notices, and a file whose every claim is
    about a CANDIDATE LIST would offer strangers. Every benched body below is put
    there by a case, on purpose, with a damage figure that case chose. */
function board(): GameState {
  let state = driveSetup(7, { p1: CHOSEN_HEAL_DECK, p2: CHOSEN_HEAL_DECK }, { first: "p2" });
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", "fix-titan");
  state = setActiveFromDeck(state, "p2", "fix-titan");
  return clearBench(clearBench(state, "p1"), "p2");
}

/** Field `cardId` as `seat`'s Active with one `energyId` paid and `damage` on it,
    on a freshly EMPTIED bench. All three fixtures are Basics, so the surgery is a
    convenience rather than a necessity — but the bench clear is not: without it the
    displaced titan is a candidate the case never asked for. */
function attacker(
  state: GameState,
  seat: Seat,
  cardId: string,
  energyId: string,
  damage: number,
): GameState {
  const fielded = attachFromDeck(
    clearBench(setActiveFromDeck(state, seat, cardId), seat),
    seat,
    energyId,
    1,
  );
  return setDamage(fielded, seat, damage);
}

function nacliActive(state: GameState, seat: Seat, damage: number): GameState {
  return attacker(state, seat, "sv02-121", "fix-fighting-energy", damage);
}

function tropiusActive(state: GameState, seat: Seat, damage: number): GameState {
  return attacker(state, seat, "sv01-007", "fix-grass-energy", damage);
}

function allHealActive(state: GameState, seat: Seat, damage: number): GameState {
  return attacker(state, seat, "fix-allheal", "fix-energy", damage);
}

/** Bench `damages.length` titans on `seat` and set each one's damage. fix-titan is
    the body for the reason the deck comment gives: 340 HP carries any figure a case
    wants — up to and including BENCH_WRECKED — without the attack epilogue's KO
    sweep removing a candidate from under the assertion. */
function benchTitans(state: GameState, seat: Seat, damages: number[]): GameState {
  let next = state;
  for (const damage of damages) {
    next = benchFromDeck(next, seat, "fix-titan");
    next = setBenchDamage(next, seat, next.players[seat].bench.length - 1, damage);
  }
  return next;
}

/** Declare `index` on P1, freezing the prior state first — the purity check every
    neighbouring suite runs, hoisted here because this file drives twenty of them. */
function declare(state: GameState, index: number): { state: GameState; events: GameEvent[] } {
  deepFreeze(state);
  return mustApply(state, { type: "attack", seat: "p1", index });
}

describe("the anchor — 10 printings, 7 clauses, one regex with two captures", () => {
  it("derives all SEVEN distinct clauses the pool prints, to the same single op", () => {
    for (const { text, op } of CLAUSES) {
      expect(deriveAttackEffect(text)).toEqual([op]);
    }
    // THE CENSUS, ASSERTED AS A SHAPE. 7 distinct clauses / 10 printings — the
    // numbers the slice claims and the numbers a re-census has to reproduce.
    expect(CLAUSES).toHaveLength(7);
    expect(CLAUSES.reduce((n, c) => n + c.printings, 0)).toBe(10);
    expect(CENSUS_IDS).toHaveLength(10);
    // No two rows share a sentence — a duplicated `text` would make the loop above
    // pass while covering one clause.
    expect(new Set(CLAUSES.map((c) => c.text)).size).toBe(CLAUSES.length);
    // Every row is ONE op, and it is the SAME op with two fields varying. That is
    // the whole slice: the clause set differs in an amount and a one-bit zone, which
    // is why it cost one regex and no new member (D131's shape, not D119's table).
    for (const { text } of CLAUSES) {
      const ops = deriveAttackEffect(text);
      expect(ops).toHaveLength(1);
      expect(ops?.[0]).toMatchObject({ op: "healChosen" });
    }
    // THE SPLIT: 3 clauses / 5 printings any-zone, 4 clauses / 5 printings bench.
    const bench = CLAUSES.filter((c) => c.text.includes("Benched"));
    expect(bench).toHaveLength(4);
    expect(bench.reduce((n, c) => n + c.printings, 0)).toBe(5);
    expect(CLAUSES.length - bench.length).toBe(3);
  });

  it("OMITS the zone key entirely on the any-zone reading — absent, not undefined", () => {
    // The derived op is compared BY VALUE against hand-authored registry rows
    // (Potion's `{ op: "healChosen", amount: 30 }`), and an explicit
    // `zone: undefined` key is not `toEqual`-identical to an absent one under the
    // suite's stricter comparisons. So the deriver branches on the capture rather
    // than spreading a possibly-undefined field, and this is the assertion that
    // says the distinction is deliberate.
    for (const { text } of CLAUSES.filter((c) => !c.text.includes("Benched"))) {
      const op = deriveAttackEffect(text)?.[0] as object;
      expect(Object.hasOwn(op, "zone")).toBe(false);
    }
    // …and it IS present, with the one legal value, on the other reading.
    for (const { text } of CLAUSES.filter((c) => c.text.includes("Benched"))) {
      const op = deriveAttackEffect(text)?.[0] as object;
      expect(Object.hasOwn(op, "zone")).toBe(true);
      expect(op).toMatchObject({ zone: "bench" });
    }
  });

  it("emits the SAME op POTION's authored row carries — one action, two readers", () => {
    // THE INVENTORY RULE STATED AS AN EQUALITY. `healChosen` has shipped since 0.x
    // behind Potion (registry.ts `POTION`, keyed sv01-188); this slice added a
    // reader for the same action printed on an ATTACK and one optional field, and
    // nothing else. Smoliv's "Nutrients" is byte-identical to the Item.
    expect(deriveAttackEffect("Heal 30 damage from 1 of your Pokémon.")).toEqual(
      programFor("sv01-188")?.trainer,
    );
    // And the "all" spelling likewise predates the slice: Arboliva sv01-023's
    // "Enriching Oil" Ability carries `amount: "all"` with NO zone, which is the
    // any-zone cross product this reader also accepts (see the next case).
    expect(deriveAttackEffect("Heal all damage from 1 of your Pokémon.")).toEqual(
      programFor("sv01-023")?.triggered?.[0]?.program,
    );
  });

  it("accepts the UNPRINTED cross product — 'all' with no zone — on purpose", () => {
    // "Heal all damage from 1 of your Pokémon." is printed by NOTHING in the pool
    // today: the two "all" printings are both Benched, and the three any-zone
    // clauses all carry a number. This anchor accepts it anyway, and that is the
    // D131 call rather than an oversight — the sentence is unambiguous and the op
    // expresses it EXACTLY (`amount` has taken `number | "all"` since 0.x), which
    // is the same test `DECK_TOP_MILL` applied to the unprinted "the top 1 cards".
    // A refusal would be a claim about what the INGEST has shipped, not a claim
    // about the game, and the reader has no business making the first one.
    expect(deriveAttackEffect("Heal all damage from 1 of your Pokémon.")).toEqual([
      { op: "healChosen", amount: "all" },
    ]);
    expect(
      Object.hasOwn(
        deriveAttackEffect("Heal all damage from 1 of your Pokémon.")?.[0] as object,
        "zone",
      ),
    ).toBe(false);
    // The other three unprinted numeric cross products come free from the same
    // alternation, and are worth one line for the same reason: they are the regex's
    // shape, not a list of cards.
    expect(deriveAttackEffect("Heal 20 damage from 1 of your Benched Pokémon.")).toEqual([
      { op: "healChosen", amount: 20, zone: "bench" },
    ]);
    expect(deriveAttackEffect("Heal 90 damage from 1 of your Pokémon.")).toEqual([
      { op: "healChosen", amount: 90 },
    ]);
  });

  it("refuses a printed ZERO — the guard every arm of this reader carries", () => {
    // A "Heal 0 damage" printing is not a real card, and on THIS arm it is worse
    // than on its neighbours: it would derive to a PROMPT — the game would stop and
    // park a player on a decision with no possible outcome, which is a lie the loud
    // skipped path never tells. The guard sits on the numeric branch only.
    expect(deriveAttackEffect("Heal 0 damage from 1 of your Pokémon.")).toBeNull();
    expect(deriveAttackEffect("Heal 0 damage from 1 of your Benched Pokémon.")).toBeNull();
    // "all" is EXEMPT BY CONSTRUCTION rather than by an extra test: it is not a
    // number and cannot be zero. It whiffs only on an undamaged pick, silently.
    expect(deriveAttackEffect("Heal all damage from 1 of your Benched Pokémon.")).toEqual([
      { op: "healChosen", amount: "all", zone: "bench" },
    ]);
    // No CEILING, by contrast, and deliberately so: the interpreter CLAMPS to the
    // damage actually present, so a malformed large amount heals the pick to full
    // and stops. That is a legal board state, not a runaway.
    expect(deriveAttackEffect("Heal 999 damage from 1 of your Pokémon.")).toEqual([
      { op: "healChosen", amount: 999 },
    ]);
  });

  it("refuses the FOUR real catalog rows that share its words — one of them re-pointed at D427", () => {
    for (const text of REAL_NEAR_MISSES) {
      expect(deriveAttackEffect(text)).toBeNull();
    }
    // SAGUARO IS THE ONE THAT MATTERS, and it is a sharper trap here than in
    // boardHeal.test.ts: its printed clause maps to THIS VERY OP with `upTo: 2`,
    // through an authored registry row. A reader without `^` would take its tail and
    // emit a single-target `healChosen` that quietly disagrees with the row the
    // engine actually runs for that card. Stated on its own line for that reason.
    expect(deriveAttackEffect(REAL_NEAR_MISSES[1])).toBeNull();
    expect(programFor("sv02-187")?.trainer).toEqual([{ op: "healChosen", amount: 50, upTo: 2 }]);
    // PICNIC BASKET is the SEAT boundary in text form, and the widest radius in the
    // family — `healEachAll` heals BOTH boards. Nothing about "1 of your" may reach
    // it, and nothing about it may reach here.
    expect(deriveAttackEffect(REAL_NEAR_MISSES[2])).toBeNull();
  });

  it("leaves the two NEIGHBOURING heal anchors their own strings — a SHAPE claim", () => {
    // These two ARE simulated, by other arms of this same reader (D132, D133), so
    // "derives to nothing" is the wrong claim for them and `toBeNull` would be a
    // false statement about the engine. The right claim — the one this file always
    // meant — is that neither derives a `healChosen`: all three anchors are
    // `^…$`-anchored on a differing middle, so no ordering of the arms can matter
    // and the family keeps costing one regex per sentence with no dispatch table.
    expect(deriveAttackEffect("Heal 20 damage from each of your Pokémon.")).toEqual([
      { op: "healEach", amount: 20 },
    ]);
    expect(deriveAttackEffect("Heal 30 damage from this Pokémon.")).toEqual([
      { op: "heal", target: "self", amount: 30 },
    ]);
    for (const text of [
      "Heal 20 damage from each of your Pokémon.",
      "Heal 30 damage from this Pokémon.",
    ]) {
      expect(deriveAttackEffect(text)).not.toContainEqual(
        expect.objectContaining({ op: "healChosen" }),
      );
    }
    // And in the other direction: this arm's own clause is not a board heal.
    expect(deriveAttackEffect("Heal 20 damage from 1 of your Pokémon.")).not.toEqual(
      deriveAttackEffect("Heal 20 damage from each of your Pokémon."),
    );
  });

  it("refuses the anchor, punctuation and case rewrites — but trims outer space", () => {
    for (const text of [
      // NO TRAILING PERIOD — the `$` sits after it.
      "Heal 20 damage from 1 of your Pokémon",
      "Heal 60 damage from 1 of your Benched Pokémon",
      // "!" for "." — the same one-character difference from the other side.
      "Heal 20 damage from 1 of your Pokémon!",
      // A LOWERCASE first word. Half of what keeps a mid-sentence clause off this
      // path (Saguaro's and Floette's tails are exactly that clause), and the reason
      // no /i flag is on this regex.
      "heal 20 damage from 1 of your Pokémon.",
      "heal 60 damage from 1 of your Benched Pokémon.",
      // A NON-BREAKING SPACE where an ASCII one is printed. Spelled as an ESCAPE, not
      // typed: it is byte-different from a space and INVISIBLE in a diff, so a case
      // that carried one would be untrustworthy exactly where it needs to be trusted.
      // A re-ingest that normalized punctuation this way would un-simulate all ten
      // printings with nothing on screen to see.
      `Heal${NBSP}20 damage from 1 of your Pokémon.`,
      `Heal 60 damage from 1 of your${NBSP}Benched Pokémon.`,
      // An INTERIOR double space is not trimmable.
      "Heal  20 damage from 1 of your Pokémon.",
      // THE COUNT. "1" is the printed quantifier and the reason the op is the
      // single-pick arm; "2 of your Pokémon" is Saguaro's shape (`upTo`), which this
      // arm cannot express and must not silently narrow to one.
      "Heal 20 damage from 2 of your Pokémon.",
      "Heal 20 damage from 1 of your opponent's Pokémon.",
      "Heal 20 damage from 1 of your opponent's Benched Pokémon.",
      // THE OTHER ZONE WORD. "Active" is a real printed word elsewhere in the pool
      // and would be a THIRD reading; nothing prints it in this family, and a reader
      // that guessed would be inventing a candidate set.
      "Heal 20 damage from 1 of your Active Pokémon.",
      // ARTICLE DRIFT. "1 of" is the printed form; "one of" and a bare "your" are
      // text the ingest has never produced.
      "Heal 20 damage from one of your Pokémon.",
      "Heal 20 damage from your Pokémon.",
      // A LEADING RIDER sentence pins `^`, and this is not hypothetical: it is how a
      // gated or conditional printing arrives (D134 reads the first of these for
      // OTHER consequents, and must not be handed this one).
      "Flip a coin. If heads, heal 20 damage from 1 of your Pokémon.",
      "If this Pokémon is Burned, heal 20 damage from 1 of your Pokémon.",
      // A SECOND SENTENCE riding the same action — the shape the `$` exists for. No
      // pool printing extends these clauses today, which is precisely why the guard
      // is pinned now: the first one that does must land LOUDLY rather than
      // half-resolve, dropping a rider the engine never saw.
      "Heal 20 damage from 1 of your Pokémon. This Pokémon is now Asleep.",
      "Heal all damage from 1 of your Benched Pokémon. Then, shuffle your deck.",
      // COUNTERS, not HP. "Remove N damage counters" is the older wording for the
      // same idea and a different arithmetic (§12: one counter = 10 HP); nothing in
      // this pool prints it, and a reader that guessed would be off by a factor of 10.
      "Remove 2 damage counters from 1 of your Pokémon.",
      // Empty.
      "",
    ]) {
      expect(deriveAttackEffect(text)).toBeNull();
    }
    // Outer whitespace SURVIVES by design (the deriver trims), so this pair states
    // which drift is tolerated and which is not — and it is stated on BOTH readings,
    // because the trim happens before the one regex either of them runs through.
    expect(deriveAttackEffect("\t  Heal 20 damage from 1 of your Pokémon.\n")).toEqual([
      { op: "healChosen", amount: 20 },
    ]);
    expect(deriveAttackEffect("\nHeal all damage from 1 of your Benched Pokémon. \t")).toEqual([
      { op: "healChosen", amount: "all", zone: "bench" },
    ]);
  });
});

describe("the fixtures' printed text — the sentence is load-bearing", () => {
  it("matches FIXTURE_POOL char-for-char for Nacli sv02-121 (any zone, 20)", () => {
    // On the deriver path a one-character drift un-simulates the card with no other
    // failure anywhere, so the bytes get pinned here.
    const saltCoating = FIXTURE_POOL["sv02-121"]?.attacks?.[SALT_COATING_INDEX];
    expect(saltCoating).toEqual({
      cost: ["Fighting"],
      name: "Salt Coating",
      effect: "Heal 20 damage from 1 of your Pokémon.",
    });
    // NO `damage` field at all (not a zero, not an empty string) — true of ALL TEN
    // printings, so the heal (and the park in front of it) is the entire visible
    // result of every declaration in this family. There is no number for a
    // half-simulation to hide behind.
    expect(saltCoating?.damage).toBeUndefined();
    expect(deriveAttackEffect(saltCoating?.effect ?? "")).toEqual([
      { op: "healChosen", amount: SALT_COATING_HEAL },
    ]);
    expect(FIXTURE_POOL["sv02-121"]?.name).toBe("Nacli");
    expect(FIXTURE_POOL["sv02-121"]?.stage).toBe("Basic");
    expect(FIXTURE_POOL["sv02-121"]?.hp).toBe(70);
    expect(FIXTURE_POOL["sv02-121"]?.abilities).toBeNull();
    // The index-1 control: real printed damage, no effect text at all.
    const tackle = FIXTURE_POOL["sv02-121"]?.attacks?.[TACKLE_INDEX];
    expect(tackle).toEqual({
      cost: ["Fighting", "Fighting"],
      name: "Tackle",
      damage: TACKLE_DAMAGE,
    });
    expect(tackle?.effect).toBeUndefined();
  });

  it("matches FIXTURE_POOL char-for-char for Tropius sv01-007 (BENCH only, 60)", () => {
    const freshPicked = FIXTURE_POOL["sv01-007"]?.attacks?.[FRESH_PICKED_INDEX];
    expect(freshPicked).toEqual({
      cost: ["Grass"],
      name: "Fresh-Picked Fruit",
      effect: "Heal 60 damage from 1 of your Benched Pokémon.",
    });
    expect(freshPicked?.damage).toBeUndefined();
    // The ONE printed word that separates the two readings, and it lands in a field.
    expect(deriveAttackEffect(freshPicked?.effect ?? "")).toEqual([
      { op: "healChosen", amount: FRESH_PICKED_HEAL, zone: "bench" },
    ]);
    expect(FIXTURE_POOL["sv01-007"]?.name).toBe("Tropius");
    expect(FIXTURE_POOL["sv01-007"]?.stage).toBe("Basic");
    expect(FIXTURE_POOL["sv01-007"]?.hp).toBe(100);
    expect(FIXTURE_POOL["sv01-007"]?.abilities).toBeNull();
    const razorLeaf = FIXTURE_POOL["sv01-007"]?.attacks?.[RAZOR_LEAF_INDEX];
    expect(razorLeaf).toEqual({
      cost: ["Grass", "Colorless"],
      name: "Razor Leaf",
      damage: RAZOR_LEAF_DAMAGE,
    });
    expect(razorLeaf?.effect).toBeUndefined();
    // A DIFFERENT N from Nacli's, which is the point of fielding two: a hardcoded 20
    // anywhere downstream of the deriver would satisfy every Salt Coating case in
    // this file and fail on the bench-only board.
    expect(FRESH_PICKED_HEAL).not.toBe(SALT_COATING_HEAL);
  });

  it("carries the REAL 'all' sentence on an INVENTED body — and says which is which", () => {
    // fix-allheal is the file's standing convention (fix-titan, fix-condgate,
    // fix-flip-filter) applied to a printing that cannot otherwise be driven: BOTH
    // "all" printings are evolutions (Blissey swsh10.5-052 off Chansey, Arboliva
    // sv03-021 off Dolliv), and the amount is a property of the SENTENCE, not of the
    // evolution line. So the STRING is verbatim and the BODY is invented.
    const wholeHeal = FIXTURE_POOL["fix-allheal"]?.attacks?.[WHOLE_HEAL_INDEX];
    expect(wholeHeal?.effect).toBe("Heal all damage from 1 of your Benched Pokémon.");
    // THE STRING IS REAL — asserted against the clause table rather than restated,
    // so the two cannot drift apart.
    expect(CLAUSES[6].text).toBe(wholeHeal?.effect);
    expect(CLAUSES[6].printings).toBe(2);
    expect(deriveAttackEffect(wholeHeal?.effect ?? "")).toEqual([
      { op: "healChosen", amount: "all", zone: "bench" },
    ]);
    // THE BODY IS INVENTED, and a Basic, which is the whole reason it exists.
    expect(FIXTURE_POOL["fix-allheal"]?.stage).toBe("Basic");
    expect(FIXTURE_POOL["fix-allheal"]?.evolveFrom).toBeNull();
    expect(wholeHeal?.damage).toBeUndefined();
    // …while the real printings it stands in for are NOT Basics, which is the fact
    // that made the invention necessary. Pinned here so a future re-ingest that
    // changed either one makes this file explain itself rather than quietly lie.
    expect(CENSUS_IDS).toContain("swsh10.5-052");
    expect(CENSUS_IDS).toContain("sv03-021");
  });

  it("costs ZERO registry rows — all TEN printings simulate off their printed text", () => {
    // If any of them grew a row the registry would win
    // (`programFor(id)?.attack?.[index] ?? derive`) and every assertion above would
    // keep passing while testing nothing about the text.
    for (const id of CENSUS_IDS) {
      expect(programFor(id)?.attack).toBeUndefined();
    }
    // ⚠️ NOTE FOR THE READER, because the slice's own notes get this one wrong.
    // The `ARBOLIVA` registry row is keyed sv01-023, which is a DIFFERENT Arboliva
    // printing from the sv03-021 in this census — sv01-023 has 150 HP, the
    // "Enriching Oil" Ability and a single "Solar Beam" attack, while sv03-021 has
    // 140 HP, NO Ability at all, and prints "Healing Fruit". So sv03-021 has no
    // registry row of any kind…
    expect(programFor("sv03-021")).toBeUndefined();
    // …and sv01-023 keeps its `triggered` row, untouched by this slice, with the
    // ANY-ZONE "all" program (no `zone` key) that the cross-product case above shows
    // this reader now also derives.
    expect(programFor("sv01-023")?.attack).toBeUndefined();
    expect(programFor("sv01-023")?.triggered?.[0]?.program).toEqual([
      { op: "healChosen", amount: "all" },
    ]);
  });
});

describe("end to end — Nacli 'Salt Coating' (heal 20, ANY zone, NO printed damage)", () => {
  it("PARKS on a damaged board — and the attack epilogue WAITS behind the question", () => {
    // THE CLAIM OF THE WHOLE SLICE. Two or more candidates is a real decision, so
    // the attack stops in the middle of its own resolution and hands the turn's
    // owner a prompt — from an ATTACK TAIL, through
    // `settleProgram(..., { resumeTail: true })`.
    let state = nacliActive(board(), "p1", ATTACKER_HURT);
    state = benchTitans(state, "p1", [BENCH_HURT, BENCH_BARELY_HURT]);
    const { state: parked, events } = declare(state, SALT_COATING_INDEX);

    expect(types(events)).toContain("EFFECT_PENDING");
    expect(find(events, "EFFECT_PENDING")?.seat).toBe("p1");
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(parked.phase.seat).toBe("p1"); // the ATTACKER decides
    expect(parked.phase.resumeTail).toBe(true);
    // The attacker is the program's "this Pokémon" — the context names it by uid,
    // even though nothing in this op reads it. (It would matter to a rider.)
    expect(parked.phase.cont.ctx.sourceUid).toBe(find(events, "ATTACK_DECLARED")?.uid);

    // THE CANDIDATE SET IS THE ACTIVE FIRST, THEN THE BENCH IN INDEX ORDER (§1.1 —
    // "1 of your Pokémon" is the whole board; only the printed word "Benched" would
    // exclude the Active, and this printing does not carry it).
    const prompt = choosePrompt(parked);
    expect(prompt.candidates).toEqual([ACTIVE_REF, BENCH_0, BENCH_1]);
    expect(prompt.note).toBe("Heal which of your Pokémon?");

    // NOTHING HAS MOVED YET, on either half. No heal, and — the regression the
    // `resumeTail` machinery exists to prevent — no turn end either: the epilogue is
    // QUEUED, so the §8.1 KO sweep and §5.3's turn end are still ahead of the answer.
    expect(all(events, "HEALED")).toHaveLength(0);
    expect(types(events)).not.toContain("TURN_ENDED");
    // D189 — the stage names the ATTACKER by uid (the ATTACK_DECLARED row's).
    expect(parked.pending).toEqual([
      {
        kind: "attackEpilogue",
        seat: "p1",
        uid: find(events, "ATTACK_DECLARED")?.uid,
        // 🆕 D394 — the stage also names the ATTACK, off the same row, for the same
        // reason: `finishAttack` stamps `usedAttack` and cannot re-derive the name.
        attack: find(events, "ATTACK_DECLARED")?.attack,
      },
    ]);
    expect(parked.players.p1.active?.damage).toBe(ATTACKER_HURT);
    expect(parked.players.p1.bench[0]?.damage).toBe(BENCH_HURT);
    // And no printed damage anywhere: the heal is the whole declaration.
    expect(types(events)).not.toContain("DAMAGE_DEALT");
    expect(parked.players.p2.active?.damage).toBe(0);
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("resolving a BENCH pick heals it, and ONLY THEN ends the turn — the ORDER", () => {
    let state = nacliActive(board(), "p1", ATTACKER_HURT);
    state = benchTitans(state, "p1", [BENCH_HURT, BENCH_BARELY_HURT]);
    const target = benchTopUid(state, "p1", 0);
    const attackerUid = activeUid(state, "p1");
    const { state: parked } = declare(state, SALT_COATING_INDEX);
    deepFreeze(parked);

    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon", ref: BENCH_0 },
    });

    expect(all(events, "HEALED")).toEqual([
      { type: "HEALED", seat: "p1", uid: target, amount: SALT_COATING_HEAL },
    ]);
    expect(done.players.p1.bench[0]?.damage).toBe(BENCH_HURT - SALT_COATING_HEAL);
    // ONE pick, so the OTHER two bodies are untouched — including the attacker,
    // which was offered and not taken.
    expect(done.players.p1.active?.damage).toBe(ATTACKER_HURT);
    expect(done.players.p1.bench[1]?.damage).toBe(BENCH_BARELY_HURT);
    expect(all(events, "HEALED").map((e) => e.uid)).not.toContain(attackerUid);

    // …and only THEN the §5.3 tail ran, in one batch. The ORDER is the assertion:
    // a build that ended the turn at the park and applied the heal afterwards would
    // produce both rows and the wrong game.
    expect(types(events)).toEqual(["HEALED", "TURN_ENDED", "TURN_STARTED", "CARDS_DRAWN"]);
    expect(types(events).indexOf("HEALED")).toBeLessThan(types(events).indexOf("TURN_ENDED"));
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
    expect(done.pending).toEqual([]);
  });

  it("offers the ATTACKER ITSELF — and picking it heals the body that just declared", () => {
    // §1.1's reading, from the one place it has never been reached before: every
    // previous `healChosen` producer is a Trainer or an Ability, where the Active is
    // not the source of the effect. A build that quietly excluded "this Pokémon" —
    // a plausible-looking reading of a heal printed on an attacker — passes every
    // bench assertion in this file and fails only here.
    let state = nacliActive(board(), "p1", ATTACKER_HURT);
    state = benchTitans(state, "p1", [BENCH_HURT]);
    const attackerUid = activeUid(state, "p1");
    const { state: parked } = declare(state, SALT_COATING_INDEX);
    expect(choosePrompt(parked).candidates).toContainEqual(ACTIVE_REF);

    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon", ref: ACTIVE_REF },
    });
    expect(all(events, "HEALED")).toEqual([
      { type: "HEALED", seat: "p1", uid: attackerUid, amount: SALT_COATING_HEAL },
    ]);
    expect(done.players.p1.active?.damage).toBe(ATTACKER_HURT - SALT_COATING_HEAL);
    // The bench body was offered and declined — it keeps every point of its damage.
    expect(done.players.p1.bench[0]?.damage).toBe(BENCH_HURT);
  });

  it("FORCES the lone Active with an empty bench — one action, no prompt at all", () => {
    // `parkOrForce`'s middle case: exactly one candidate is not a decision, so it is
    // applied INLINE and the whole declaration resolves in a single action. A build
    // that parked here would stop the game to ask a question with one answer.
    const state = nacliActive(board(), "p1", ATTACKER_HURT);
    expect(state.players.p1.bench).toHaveLength(0);
    const attackerUid = activeUid(state, "p1");
    const { state: done, events } = declare(state, SALT_COATING_INDEX);

    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
    expect(done.pending).toEqual([]);
    // HEALED and TURN_ENDED in the SAME batch — the park's absence, stated as the
    // shape of one event log rather than as a missing phase.
    expect(types(events)).toEqual([
      "ATTACK_DECLARED",
      "HEALED",
      "TURN_ENDED",
      "TURN_STARTED",
      "CARDS_DRAWN",
    ]);
    expect(find(events, "HEALED")).toEqual({
      type: "HEALED",
      seat: "p1",
      uid: attackerUid,
      amount: SALT_COATING_HEAL,
    });
    expect(done.players.p1.active?.damage).toBe(ATTACKER_HURT - SALT_COATING_HEAL);
  });

  it("CLAMPS to the damage present — 10 damage takes 10 of a printed 20", () => {
    // The heal is bounded by the pick's OWN damage, so it lands at 0 and does not go
    // negative. The ROW reports what actually moved (10), not what was printed (20),
    // which is the half a log-only implementation gets wrong.
    let state = nacliActive(board(), "p1", ATTACKER_HURT);
    state = benchTitans(state, "p1", [BENCH_BARELY_HURT]);
    const target = benchTopUid(state, "p1", 0);
    const { state: parked } = declare(state, SALT_COATING_INDEX);
    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon", ref: BENCH_0 },
    });
    expect(all(events, "HEALED")).toEqual([
      { type: "HEALED", seat: "p1", uid: target, amount: BENCH_BARELY_HURT },
    ]);
    expect(done.players.p1.bench[0]?.damage).toBe(0);
    expect(BENCH_BARELY_HURT).toBeLessThan(SALT_COATING_HEAL);
  });

  it("WHIFFS SILENTLY on an UNDAMAGED pick — no row, and still not SKIPPED", () => {
    // Three states are distinguishable here and all three are real: never read
    // (ATTACK_EFFECT_SKIPPED), read-and-parked-and-whiffed (this), and healed. Only
    // the first deserves a loud row, and an undamaged pick deserves no HEALED at
    // all — a log must not announce that nothing happened. The prompt still OFFERS
    // the undamaged body: the printed sentence carries no damaged restriction, and
    // hiding it would be a rule the card does not print (the Potion doctrine).
    let state = nacliActive(board(), "p1", ATTACKER_HURT);
    state = benchTitans(state, "p1", [0]);
    const { state: parked, events: attackEvents } = declare(state, SALT_COATING_INDEX);
    expect(choosePrompt(parked).candidates).toEqual([ACTIVE_REF, BENCH_0]);
    expect(types(attackEvents)).not.toContain("ATTACK_EFFECT_SKIPPED");

    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon", ref: BENCH_0 },
    });
    expect(all(events, "HEALED")).toHaveLength(0);
    expect(done.players.p1.bench[0]?.damage).toBe(0);
    // The damaged Active it declined is still damaged — the whiff took the pick, not
    // "whatever was healable".
    expect(done.players.p1.active?.damage).toBe(ATTACKER_HURT);
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(types(events)).toEqual(["TURN_ENDED", "TURN_STARTED", "CARDS_DRAWN"]);
  });

  it("REJECTS an illegal pick — the opponent's board, and a bench index out of range", () => {
    // "your Pokémon" is a seat scope and `candidates` is the whole legality rule, so
    // both refusals come from the same membership test. Neither is hypothetical on a
    // wire: an index is a number a client computes, and a seat is a field it fills in.
    let state = nacliActive(board(), "p1", ATTACKER_HURT);
    state = benchTitans(state, "p1", [BENCH_HURT]);
    state = setDamage(state, "p2", BENCH_HURT);
    const { state: parked } = declare(state, SALT_COATING_INDEX);
    const resolve = (choice: unknown) =>
      ({ type: "resolveEffect", seat: "p1", choice }) as Parameters<typeof applyAction>[1];

    // THE OPPONENT'S ACTIVE — damaged, so a build that dropped the seat check would
    // heal it and look like it worked.
    expectErr(
      parked,
      resolve({ kind: "pokemon", ref: { seat: "p2", spot: { spot: "active" } } }),
      "BAD_EFFECT_CHOICE",
    );
    // A BENCH INDEX PAST THE END. p1 has exactly one benched body, so index 1 names
    // nothing at all.
    expectErr(parked, resolve({ kind: "pokemon", ref: BENCH_1 }), "BAD_EFFECT_CHOICE");
    // And the multi-pick shape does not answer a single prompt (the `upTo` arm's
    // choice kind, which the SAME op emits for Saguaro).
    expectErr(parked, resolve({ kind: "pokemonMulti", refs: [BENCH_0] }), "BAD_EFFECT_CHOICE");
    // A rejection leaves the park exactly where it was — the question is still open.
    expect(parked.phase.kind).toBe("effect:choose");
  });

  it("consumes NO rng across the WHOLE resolution — park and resolve alike", () => {
    // No coin, no shuffle, no random pick: the amount is printed and the target is
    // CHOSEN by a player, which is the opposite of random. That determinism is what
    // lets this whole suite run on one board with no seed sweep, so it is worth an
    // assertion rather than a comment — and it is taken across BOTH actions, since a
    // park is the one place a second `apply` could quietly draw.
    let state = nacliActive(board(), "p1", ATTACKER_HURT);
    state = benchTitans(state, "p1", [BENCH_HURT]);
    const { state: parked } = declare(state, SALT_COATING_INDEX);
    expect(parked.rngState).toBe(state.rngState);
    const { state: done } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon", ref: BENCH_0 },
    });
    expect(done.rngState).toBe(state.rngState);
  });

  it("the parked state survives a JSON round-trip and resolves identically (D14)", () => {
    // The park is a wire object: `phase.prompt`, `phase.cont` and the `pending` queue
    // all cross the network between the question and the answer. A `cont` holding
    // anything JSON cannot carry — a closure, a Map, an undefined-valued key — works
    // perfectly in-process and desynchronises an online match.
    let state = nacliActive(board(), "p1", ATTACKER_HURT);
    state = benchTitans(state, "p1", [BENCH_HURT, BENCH_BARELY_HURT]);
    const { state: parked } = declare(state, SALT_COATING_INDEX);
    const rehydrated = JSON.parse(JSON.stringify(parked)) as GameState;
    expect(rehydrated).toEqual(parked);
    const answer = {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon", ref: BENCH_1 },
    } as const;
    const a = mustApply(parked, answer);
    const b = mustApply(rehydrated, answer);
    expect(b.state).toEqual(a.state);
    expect(b.events).toEqual(a.events);
  });
});

describe("end to end — Tropius 'Fresh-Picked Fruit' (heal 60, BENCH only)", () => {
  it("EXCLUDES the damaged Active from the candidates AND says so in the heading", () => {
    // THE SHARPEST CLAIM OF THE SLICE, and the reason the Active is DAMAGED here: on
    // an undamaged Active the exclusion is invisible, because a build that offered it
    // would produce the same board for any pick a test happened to make. The zone
    // field has to do BOTH of these things — drop the ref and change the word — and a
    // prompt that did one without the other would be lying about what it offers.
    let state = tropiusActive(board(), "p1", ATTACKER_HURT);
    state = benchTitans(state, "p1", [BENCH_HURT, BENCH_BARELY_HURT]);
    const target = benchTopUid(state, "p1", 0);
    const { state: parked } = declare(state, FRESH_PICKED_INDEX);

    const prompt = choosePrompt(parked);
    expect(prompt.candidates).toEqual([BENCH_0, BENCH_1]);
    expect(prompt.candidates).not.toContainEqual(ACTIVE_REF);
    for (const ref of prompt.candidates) {
      expect(ref.spot.spot).toBe("bench");
    }
    expect(prompt.note).toBe("Heal which of your Benched Pokémon?");
    // The Active is not merely UNLISTED, it is UNREACHABLE: `candidates` is the whole
    // legality rule, so a client that offered it anyway (or a hand-built wire message)
    // is refused rather than obeyed. Displaying the exclusion and enforcing it are two
    // different properties and this file wants both.
    expectErr(
      parked,
      { type: "resolveEffect", seat: "p1", choice: { kind: "pokemon", ref: ACTIVE_REF } },
      "BAD_EFFECT_CHOICE",
    );

    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon", ref: BENCH_0 },
    });
    expect(all(events, "HEALED")).toEqual([
      { type: "HEALED", seat: "p1", uid: target, amount: FRESH_PICKED_HEAL },
    ]);
    expect(done.players.p1.bench[0]?.damage).toBe(BENCH_HURT - FRESH_PICKED_HEAL);
    // AND THE ACTIVE'S DAMAGE IS UNCHANGED — the other half of the exclusion, taken
    // from the board rather than from the prompt.
    expect(done.players.p1.active?.damage).toBe(ATTACKER_HURT);
    expect(types(events)).toEqual(["HEALED", "TURN_ENDED", "TURN_STARTED", "CARDS_DRAWN"]);
  });

  it("WHIFFS SILENTLY on an EMPTY bench — no park, no row, and still SIMULATED", () => {
    // `parkOrForce`'s zero case, and the only board in the family that reaches it:
    // the any-zone reading always has at least the Active, so a candidate set can
    // only be empty when the printed word "Benched" has emptied it. The result is
    // the D134 three-state distinction, one slice on: SKIPPED (never read) ≠
    // ran-and-whiffed (this) ≠ healed. The attack is declared, resolves completely
    // and moves nothing, in ONE action with no question asked.
    const state = tropiusActive(board(), "p1", ATTACKER_HURT);
    expect(state.players.p1.bench).toHaveLength(0);
    const { state: done, events } = declare(state, FRESH_PICKED_INDEX);

    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(all(events, "HEALED")).toHaveLength(0);
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
    expect(done.pending).toEqual([]);
    // The DAMAGED Active is still damaged: an empty bench is not a licence to fall
    // back on the any-zone reading.
    expect(done.players.p1.active?.damage).toBe(ATTACKER_HURT);
    // AND NOT SKIPPED. The sentence WAS read — `deriveAttackEffect` returned a
    // program, so `effectSimulated` is true — and the loud row would be a lie about
    // the one thing the loud row exists to say.
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(types(events)).toEqual(["ATTACK_DECLARED", "TURN_ENDED", "TURN_STARTED", "CARDS_DRAWN"]);
  });

  it("FORCES a single benched body — no prompt, even with a damaged Active in play", () => {
    // The middle case again, but reached the other way: TWO Pokémon are in play and
    // only ONE is a candidate, so the zone filter is what turns a decision into a
    // forced application. A build that counted the BOARD rather than the CANDIDATES
    // would park here and offer a list of one.
    let state = tropiusActive(board(), "p1", ATTACKER_HURT);
    state = benchTitans(state, "p1", [BENCH_HURT]);
    const target = benchTopUid(state, "p1", 0);
    const { state: done, events } = declare(state, FRESH_PICKED_INDEX);

    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
    expect(find(events, "HEALED")).toEqual({
      type: "HEALED",
      seat: "p1",
      uid: target,
      amount: FRESH_PICKED_HEAL,
    });
    expect(done.players.p1.bench[0]?.damage).toBe(BENCH_HURT - FRESH_PICKED_HEAL);
    expect(done.players.p1.active?.damage).toBe(ATTACKER_HURT);
  });
});

describe("end to end — the 'all' amount (fix-allheal, Blissey/Arboliva's sentence)", () => {
  it("clears the pick's ENTIRE damage while the Active's is untouched", () => {
    // "all" is a spelling of the AMOUNT, not a second sentence — one alternation
    // branch in one regex — and this is the board that shows it means what it says:
    // 300 damage is larger than every printed N in the family put together, so a
    // build that resolved "all" to some generous constant would leave a remainder.
    // The zone is asserted at the same time (the printing is a Benched one), which
    // is why the Active carries damage it must keep.
    let state = allHealActive(board(), "p1", ATTACKER_HURT);
    state = benchTitans(state, "p1", [BENCH_WRECKED, BENCH_BARELY_HURT]);
    const target = benchTopUid(state, "p1", 0);
    const { state: parked } = declare(state, WHOLE_HEAL_INDEX);

    const prompt = choosePrompt(parked);
    expect(prompt.candidates).toEqual([BENCH_0, BENCH_1]);
    expect(prompt.note).toBe("Heal which of your Benched Pokémon?");

    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon", ref: BENCH_0 },
    });
    // The ROW carries what actually moved — all 300 of it, in one HEALED.
    expect(all(events, "HEALED")).toEqual([
      { type: "HEALED", seat: "p1", uid: target, amount: BENCH_WRECKED },
    ]);
    expect(done.players.p1.bench[0]?.damage).toBe(0);
    // ONE pick: the other benched body and the Active both keep every point.
    expect(done.players.p1.bench[1]?.damage).toBe(BENCH_BARELY_HURT);
    expect(done.players.p1.active?.damage).toBe(ATTACKER_HURT);
    expect(types(events)).toEqual(["HEALED", "TURN_ENDED", "TURN_STARTED", "CARDS_DRAWN"]);
  });
});
