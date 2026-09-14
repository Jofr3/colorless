import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import * as effects from "./effects";
import type { EffectOp } from "./effects";
import { deriveAttackCancelRequirement, deriveAttackEffect } from "./effects";
import type { GameEvent } from "./events";
import { applyAction, createGame, engineVersion } from "./index";
import type { GameState, PokemonRef, Seat } from "./index";
import { runProgram, resumeProgram } from "./interpreter";
import {
  FIXTURE_POOL,
  attachFromDeck,
  basicEnergy,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  firstBasicInHand,
  itemTrainer,
  must,
  mustApply,
  setActiveFromDeck,
  typedEnergy,
} from "./testFixtures";

// 0.383.0 → 0.384.0 — 🆕🆕🆕 D489: THE HAND DISCARD WHOSE COUNT IS THE SNIPE'S MULTIPLIER.
//
//   file line 138 (2 printings)  "Discard up to 3 Energy cards from your hand. This
//                                 attack does 60 damage to 1 of your opponent's Pokémon
//                                 for each Energy card you discarded in this way.
//                                 (Don't apply Weakness and Resistance for Benched
//                                 Pokémon.)"
//
// 1 sentence / 2 legal printings over `legalAttackCorpus()`'s 640 / 1,732. The carrier
// ids are UNRESOLVED in this checkout (no local D1) and are stated as such rather than
// invented — D425's standing limitation.
//
// 🛑 **THE FIRST DELIVERABLE WAS AN AXIS DELETION, AND IT PRICED THE SLICE AT FIVE AXES
// RATHER THAN ONE.** §2 runs the whole 2⁵ lattice — the SOURCE ZONE, the CHOSEN target,
// the SCALING tail, the count NOUN and the W/R clarifier, each substituted onto its
// nearest BUILT spelling — against all 13 `deriveAttack*` exports of
// `attackReaderSurface()`. **Exactly ONE of the 32 points builds: the all-five
// substitution.** No single, pair, triple or quadruple deletion reaches a claimed
// string, so **no half of this sentence already shipped** — which is the opposite of
// what the neighbouring built rows suggest, and the opposite of the handoff's read.
//
// 🛑 **THE HEAD IS `payFromHand` AND NOT A SEVENTH `discardEnergy.from` MEMBER.** All
// six `from` members are BOARD scopes — that op's own doc block calls them *"a spot, a
// side, a body and the side MINUS the spot"* — and every machine under them takes a
// `PokemonRef`: `discardableEnergies` yields `{uid, from: PokemonRef}`, the §11 shield
// filters those refs, `interchangeableCandidates` keys on the body, and the
// `discardEnergy` PARK carries the refs across the wire. A hand card has no ref, so a
// hand member would have changed the PROMPT's candidate shape (D457's five mirrors:
// `packages/schema`, `redact.ts`, `projection.ts` and both HUDs) in order to say what
// the `chooseCards` prompt already says. What `payFromHand` lacked was the printed
// QUANTIFIER, and that is `discardEnergy.count`'s own D361 widening at the sibling op:
// *a WIDENING is free; a GENERALISATION is not.*
//
// 🛑 **`snipeAmount` COULD ALREADY REACH A §9.2 SLOT AND NOBODY HAD ASKED.** The fold
// has been a second, parallel one since Covetous Ivy (D448); `record` was in scope at
// BOTH its call sites (`stepOp` takes it as a parameter, `applyChoice` takes it as a
// parameter), so the third rider cost a fourth argument and four lines rather than a
// channel. The refusal this overturns — *"there is no state field, no `EffectSlot` and
// no `EffectContext` key that carries how many cards the previous op moved"* — was
// right about `state` and `EffectContext` and wrong about the engine (D456's rule: a
// refusal's scope is the carrier it was measured on).
//
// 🛑 **AND THE D420 STRUCTURAL GUARD GAINS A THIRD NAMED ESCAPE.** An attack-borne
// `payFromHand` owes a printed cancel (D420) or a §9.2 gate on its own slot (D473).
// This sentence prints neither and is honest because **a DECLINABLE payment cannot be
// short** AND its consequent is a MULTIPLE of what it paid. Neither fact alone is
// enough — *"Discard up to 3 cards from your hand. Knock Out your opponent's Active
// Pokémon."* is declinable and would be a free Knock Out — and
// `handEnergyCancel.test.ts` §5 drives that near-miss.
//
// ⚠️ **WHAT THIS SLICE COST, NAMED AS ZEROES SO THE CLAIM IS CHECKABLE:** ONE new
// anchor, ONE new `deriveAttackEffect` arm, ONE new UNION ARM on a shipped op and ONE
// OPTIONAL key on a shipped op. **ZERO** new `EffectOp` KINDS, `EffectSlot` members,
// `CardFilter`/`DamageCountSource`/`BoardCondition` members, prompts, prompt fields,
// choice kinds, events, error codes, `GameState`/`InPlayPokemon` fields, readers (the
// surface stands still at **13**), registry rows, `FIXTURE_POOL` ids (file-local
// `cardPool`, D414), `redact.ts` bytes, `packages/schema` bytes and
// **`MATCH_RECORD_VERSION` bytes**.
//
// SEED-FREE: neither op consumes RNG. The one seed below feeds setup's shuffle, and
// every board rebuilds the zones under test outright.

/** The printed sentence, byte for byte off `legalAttackCorpus()` (§1 asserts it, so a
    re-ingest disagrees with this line rather than with a number). Both apostrophes are
    U+0027 — measured with `codePointAt` in §1 rather than by eye (D421/D440). */
const PRINTED =
  "Discard up to 3 Energy cards from your hand. This attack does 60 damage to 1 of your opponent's Pokémon for each Energy card you discarded in this way. (Don't apply Weakness and Resistance for Benched Pokémon.)";

/** The shipped SIBLINGS this arm sits between, all three real printed rows rather than
    constructed ones — they are what §2's axis substitutions land on, and what §3's
    disjointness rungs are asserted against. */
const BOARD_DISCARD_SCALED =
  "Discard up to 3 {G} Energy cards from your Pokémon. This attack does 70 damage for each card you discarded in this way.";
const SELF_DISCARD_SNIPE =
  "Discard 2 Energy from this Pokémon. This attack does 120 damage to 2 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";
const SCALED_SNIPE_ON_SELF =
  "This attack does 20 damage to 1 of your opponent's Pokémon for each Energy attached to this Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";

/** A residue sentence no reader claims, fielded as the LOUD control: it is what makes
    "no `ATTACK_EFFECT_SKIPPED`" mean something on the boards where nothing scores. Its
    refusal is asserted live in §1 rather than assumed (D480). */
const LOUD =
  "Put this Pokémon and all attached cards into your hand.";

/** The program the anchor derives. Written once and asserted against
    `deriveAttackEffect` in §3, so every later section drives the SAME object the reader
    produces rather than a hand-copy of it. */
const PROGRAM: readonly EffectOp[] = [
  {
    op: "payFromHand",
    count: "any",
    cap: 3,
    to: "discard",
    filter: { kind: "anyEnergy" },
    recordAs: "discarded",
  },
  {
    op: "damageChosen",
    target: "opponentAny",
    amount: 60,
    count: 1,
    source: "attack",
    deals: true,
    perRecorded: "discarded",
  },
];

/** The v29 byte strings: the SAME two ops with the new bytes ABSENT — an EXACT payment
    where the new arm is declinable, and an UNSCALED snipe where the new rider names a
    slot. §7 reads them back and drives that they still mean what a v29 writer meant. */
const V29_PAYMENT: readonly EffectOp[] = [
  { op: "payFromHand", count: 2, to: "discard", filter: { kind: "anyEnergy" }, recordAs: "discarded" },
];
const V29_SNIPE: readonly EffectOp[] = [
  { op: "damageChosen", target: "opponentAny", amount: 60, count: 1, source: "attack", deals: true },
];

const SEED = 20260909;

/** The Energy ids on this board, as a set, so the fixture rungs in §5 read the same
    fact the interpreter does rather than a name prefix that could drift. */
const ENERGY_IDS = new Set(["d489-fire", "d489-water", "d489-grass", "d489-en-d", "d489-cost"]);

// ── The board (D414: a file-local `cardPool`, no `FIXTURE_POOL` id). ─────────────────
const HAND_PURGE = 0;
const PLAIN_CUFF = 1;
const LOUD_SWING = 2;

const D489_CARDS: Record<string, Card> = {
  "d489-thrower": battler("d489-thrower", {
    name: "D489 Thrower",
    types: ["Water"],
    hp: 300,
    attacks: [
      // ⚠️ **NO PRINTED BASE DAMAGE, WHICH IS THE FAMILY'S SHAPE AND NOT A
      // SIMPLIFICATION.** `damageChosen` is the whole hit here; `attack.ts`'s
      // `programDamage` drops a printed base only for `damageDefender`, so a card that
      // printed one would deal it to the DEFENDER *and* the snipe to the chosen body —
      // which is exactly what `SELF_DISCARD_THEN_ANY_TARGET`'s seven printings do, all
      // of them printing no base. The real carriers' `damage` field is UNRESOLVABLE in
      // this checkout (no local D1) and is stated as such rather than guessed; what is
      // measurable is that this arm introduces no new question, because the composition
      // is byte-identical to that shipped family's.
      { cost: ["Colorless"], name: "Hand Purge", effect: PRINTED },
      { cost: ["Colorless"], name: "Plain Cuff", damage: 10 },
      { cost: ["Colorless"], name: "Borrowed Reach", effect: LOUD },
    ],
  }),
  /** The DEFENDER, WEAK to the attacker's type. The weakness is what separates *"this
      is attack damage"* from *"these are placed counters"* — a `deals`-less build deals
      120 flat where the real one deals 240 (§6). Big enough that nothing this file's
      correct readings do Knocks it Out; a KO would end the batch before the zones could
      be read. */
  "d489-wall": battler("d489-wall", {
    name: "D489 Wall",
    types: ["Colorless"],
    hp: 340,
    weaknesses: [{ type: "Water", value: "×2" }],
  }),
  /** The BENCHED victim — no weakness, so §8.5's *"not for Benched Pokémon"* is
      observable as a flat number beside the Active's doubled one. */
  "d489-bench": battler("d489-bench", { name: "D489 Bench", types: ["Colorless"], hp: 200 }),
  /** The attack's own COST Energy, attached. §4 asserts it is STILL THERE afterwards —
      *cost is a check, not a payment* (§8 step 2, D436) — which is also the rung that
      goes red on a build that read the printed head as a BOARD discard. */
  "d489-cost": basicEnergy("d489-cost"),
  /** 🛑 **THE HAND'S ENERGY, AND THEY CARRY THREE DIFFERENT PROVISIONS FOR A REASON
      THE FIRST DRAFT OF THIS FILE GOT WRONG.** `cardIdentity` keys a BASIC Energy on
      what it PROVIDES — `basic:${energyProvidesOf(card)}` — and not on its catalog id,
      because the catalog prints one Basic Fire Energy under several ids. So five
      *unnamed* `basicEnergy` fixtures are five copies of ONE interchangeable class, and
      a `cap` of 3 offers exactly three of them: the board would have measured the
      CEILING and said nothing whatever about the collapse. Three provisions make three
      classes; `d489-water` ×3 is the class the ceiling is read on. (This is D448's
      one-print rule at a hand instead of a board, and it was found by a red rung rather
      than by reading.) */
  "d489-fire": typedEnergy("d489-fire", "Fire"),
  "d489-water": typedEnergy("d489-water", "Water"),
  "d489-grass": typedEnergy("d489-grass", "Grass"),
  /** The pile's Energy — pre-seeded so *count the RECORD* and *count the PILE* are
      different numbers (D488's rule: on an empty pile they are identical forever). */
  "d489-en-d": basicEnergy("d489-en-d"),
  /** The NON-Energy in hand. Without them the printed noun `Energy cards` is
      unfalsifiable: every candidate would match every filter. */
  "d489-item-1": itemTrainer("d489-item-1"),
  "d489-item-2": itemTrainer("d489-item-2"),
  "d489-item-3": itemTrainer("d489-item-3"),
};

const D489_POOL: Record<string, Card> = { ...FIXTURE_POOL, ...D489_CARDS };

/** Its own deck (D270/D412), 60 counted before the first run: 11 ids × 4 = 44, plus
    `d489-water` ×12 and `d489-item-1` ×12 = 60. */
const D489_DECK = deckOf({
  "d489-thrower": 4,
  "d489-wall": 4,
  "d489-bench": 4,
  "d489-cost": 4,
  "d489-fire": 4,
  "d489-water": 12,
  "d489-grass": 4,
  "d489-en-d": 4,
  "d489-item-1": 12,
  "d489-item-2": 4,
  "d489-item-3": 4,
});

/** 🛑 **THE HAND, AND EVERY CARD IN IT IS THERE FOR A MEASURED REASON (§5).** FIVE
    Energy of THREE interchangeable classes and TWO Items:

      • more than `cap` Energy, so *"up to 3"*, *"discard all Energy"* and *"discard
        your hand"* are three different moves rather than one — the algebraic identity
        a hand of exactly three Energy would have hidden (D486/D488);
      • a class of THREE identical copies, so the collapse ceiling is observable;
      • two NON-Energy, so the printed noun is falsifiable. */
const HAND = [
  "d489-fire",
  "d489-water",
  "d489-water",
  "d489-water",
  "d489-grass",
  "d489-item-1",
  "d489-item-2",
] as const;

/** The PRE-SEEDED discard pile: four cards, TWO of them Energy. On an empty pile
    *"count what the slot recorded"* and *"count the Energy in the pile afterwards"* are
    the same number for every pick; here they are 60×k against 60×(2+k). */
const PILE = ["d489-en-d", "d489-en-d", "d489-item-3", "d489-item-3"] as const;

function openTable(first: Seat): GameState {
  const created = createGame({
    seed: SEED,
    decks: { p1: D489_DECK, p2: D489_DECK },
    cardPool: D489_POOL,
  });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let table = created.state;
  if (table.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  table = must(
    applyAction(table, { type: "chooseFirstPlayer", seat: table.phase.coinWinner, first }),
  );
  while (table.phase.kind === "setup:drawExtra") {
    const drawing = table.phase;
    const owing = (["p1", "p2"] as const).find((s) => !drawing.decided[s]);
    if (owing === undefined) throw new Error("setup:drawExtra with every seat decided");
    table = must(
      applyAction(table, { type: "setupDrawExtra", seat: owing, count: drawing.owed[owing] }),
    );
  }
  for (const seat of ["p1", "p2"] as const) {
    table = must(
      applyAction(table, { type: "setupPlaceActive", seat, uid: firstBasicInHand(table, seat) }),
    );
  }
  for (const seat of ["p1", "p2"] as const) {
    table = must(applyAction(table, { type: "setupReady", seat }));
  }
  return table;
}

/** Rebuild `seat`'s HAND and DISCARD PILE outright, in the exact orders named, and park
    every card the setup shuffle dealt elsewhere in the DECK.

    ⚠️ **THE HAND IS A ZONE UNDER TEST HERE, WHICH IS WHY IT IS REBUILT RATHER THAN
    APPENDED TO.** D488's sibling helper rebuilt the deck and swept the leftovers into
    the hand; that would be exactly wrong in this file — a residual Energy would join
    the offer and move every number in §5 and §6 silently. */
function withZones(
  state: GameState,
  seat: Seat,
  handIds: readonly string[],
  discardIds: readonly string[],
): GameState {
  const side = state.players[seat];
  const pool = [...side.deck, ...side.hand, ...side.discard];
  const take = (ids: readonly string[]): string[] =>
    ids.map((id) => {
      const at = pool.findIndex((uid) => state.cardIdByUid[uid] === id);
      if (at < 0) throw new Error(`${seat} has no spare ${id}`);
      const [uid] = pool.splice(at, 1);
      if (uid === undefined) throw new Error("splice returned nothing");
      return uid;
    });
  const hand = take(handIds);
  const discard = take(discardIds);
  return {
    ...state,
    players: { ...state.players, [seat]: { ...side, hand, discard, deck: pool } },
  };
}

/** p1 owns TURN 2 with the Thrower Active, `hand` as its whole hand and `pile` as its
    whole discard pile. The opponent fields an Active AND one Benched body, because
    `opponentAny` is the printed scope and a lone Active would make the arity rung
    vacuous (D416: count the candidates your boards actually offer). */
function table(
  hand: readonly string[] = HAND,
  pile: readonly string[] = PILE,
  attacker: Seat = "p1",
): GameState {
  const defender: Seat = attacker === "p1" ? "p2" : "p1";
  let state = openTable(defender);
  state = mustApply(state, { type: "endTurn", seat: defender }).state;
  expect(state.turn).toBe(2);
  state = setActiveFromDeck(state, attacker, "d489-thrower");
  state = setActiveFromDeck(state, defender, "d489-wall");
  state = clearBench(state, attacker);
  state = clearBench(state, defender);
  state = benchFromDeck(state, defender, "d489-bench");
  state = attachFromDeck(state, attacker, "d489-cost", 2);
  return withZones(state, attacker, hand, pile);
}

const idOf = (uid: string, state: GameState): string => {
  const id = state.cardIdByUid[uid];
  if (id === undefined) throw new Error(`no card for uid ${uid}`);
  return id;
};
const idsIn = (state: GameState, seat: Seat, zone: "hand" | "deck" | "discard"): string[] =>
  state.players[seat][zone].map((uid) => idOf(uid, state));

function swing(state: GameState, index: number): { state: GameState; events: GameEvent[] } {
  return mustApply(state, { type: "attack", seat: "p1", index });
}
function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}
const types_ = (events: GameEvent[]): string[] => events.map((e) => e.type);

/** Every reader on the module surface, called by name — the D480/D482 oracle. Not
    `programFor`, which answers a REGISTRY question and would call an attack "built" for
    a card whose Ability happens to have a row (D204; `refusedPrintings.ts` has no attack
    rows at all, re-checked at this head in §1). */
function readersClaiming(text: string): string[] {
  return attackReaderSurface().filter((name) => {
    const read = (effects as unknown as Record<string, (t: string) => unknown>)[name];
    if (read === undefined) throw new Error(`no reader ${name}`);
    return read(text) !== null;
  });
}

const units = (rows: readonly (readonly [number, string])[]): number =>
  rows.reduce((sum, [n]) => sum + n, 0);

/** The chooseCards prompt a parked hand discard raises, or a throw. */
function handPrompt(state: GameState): { candidates: readonly string[]; min: number; max: number; note: string; dest: string } {
  if (state.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
  const prompt = state.phase.prompt;
  if (prompt.kind !== "chooseCards") throw new Error(`expected chooseCards, got ${prompt.kind}`);
  return { candidates: prompt.candidates, min: prompt.min, max: prompt.max, note: prompt.note, dest: String(prompt.dest) };
}
/** The choosePokemonMulti prompt the snipe raises, or a throw. */
function snipePrompt(state: GameState): { candidates: readonly PokemonRef[]; min: number; max: number; note: string } {
  if (state.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
  const prompt = state.phase.prompt;
  if (prompt.kind !== "choosePokemonMulti") throw new Error(`expected choosePokemonMulti, got ${prompt.kind}`);
  return { candidates: prompt.candidates, min: prompt.min, max: prompt.max, note: prompt.note };
}
const uidsOf = (state: GameState, cands: readonly string[], id: string, n: number): string[] =>
  cands.filter((uid) => idOf(uid, state) === id).slice(0, n);
const answerCards = (state: GameState, uids: readonly string[]) =>
  mustApply(state, { type: "resolveEffect", seat: "p1", choice: { kind: "cards", uids: [...uids] } });
const answerBody = (state: GameState, ref: PokemonRef) =>
  mustApply(state, { type: "resolveEffect", seat: "p1", choice: { kind: "pokemonMulti", refs: [ref] } });

describe("D489 §1 — the printed row, off the column rather than off this file", () => {
  it("the sentence is in `legalAttackCorpus()` at exactly 2 printings, and its apostrophes are U+0027", () => {
    const rows = legalAttackCorpus();
    const hit = rows.filter(([, s]) => s === PRINTED);
    expect(hit).toHaveLength(1);
    expect(units(hit)).toBe(2);
    // D421/D440 — the byte, measured rather than eyeballed. The anchor spells `['’]`
    // anyway (the family's rule), so this rung is what tells a re-ingest from a typo.
    const apostrophes = [...PRINTED].flatMap((ch, i) => (ch === "'" || ch === "’" ? [i] : []));
    expect(apostrophes).toHaveLength(2);
    for (const at of apostrophes) expect(PRINTED.codePointAt(at)).toBe(0x27);
    // The three real siblings this file reasons against are printed too — a refusal
    // measured against a constructed string is a claim about the reader, not the pool.
    for (const text of [BOARD_DISCARD_SCALED, SELF_DISCARD_SNIPE, SCALED_SNIPE_ON_SELF]) {
      expect(rows.some(([, s]) => s === text), text).toBe(true);
    }
  });

  it("the anchor claims THIS row and no other in the whole 640-sentence column", () => {
    const rows = legalAttackCorpus();
    const taken = rows.filter(([, s]) => /^Discard up to \d+ Energy cards from your hand\./.test(s) && readersClaiming(s).length > 0);
    expect(taken).toEqual([[2, PRINTED]]);
    // …and exactly ONE reader owns it. Two claimants on one sentence is a real state
    // (D445) and is not this one; asserting the SET rather than a boolean is what makes
    // a widened neighbour redden here (D438's polarity rule).
    expect(readersClaiming(PRINTED)).toEqual(["deriveAttackEffect"]);
    expect(resolvedByAnyReader(PRINTED)).toBe(true);
    // The LOUD control really is unread, checked live rather than assumed (D480).
    expect(readersClaiming(LOUD)).toEqual([]);
  });

  it("the reader surface stands still at THIRTEEN — no reader was added", () => {
    // The arm lands inside `deriveAttackEffect`. A fourteenth reader would move census
    // figures in 40 files and is exactly what this rung exists to make loud (D418/D444).
    expect(attackReaderSurface()).toHaveLength(13);
    expect(attackReaderSurface()).toContain("deriveAttackEffect");
  });

  it("no CANCEL clause is printed, which is what makes the D420 escape a question at all", () => {
    // §4 of `handEnergyCancel.test.ts` owns the guard; this rung owns the PREMISE it
    // rests on. If this sentence ever gained a printed cancel the escape would be
    // unnecessary, and the rung there would be green for the wrong reason.
    expect(deriveAttackCancelRequirement(PRINTED)).toBeNull();
  });
});

describe("D489 §2 — AXIS DELETION: which half of this sentence already shipped?", () => {
  // 🛑 THE WHOLE SECTION IS ONE MEASUREMENT AND IT IS THE ONE D483/D488 SHOW YOU CANNOT
  // SKIP. Each axis is substituted onto its nearest BUILT spelling — deleting a clause
  // outright would confound "this axis is the blocker" with "the remainder is not a
  // sentence" — and every point is run against ALL 13 readers, not against
  // `deriveAttackEffect` alone.
  const AXES: readonly (readonly [string, (s: string) => string])[] = [
    ["FILTER", (s) => s.replace("3 Energy cards", "3 {G} Energy cards")],
    ["ZONE", (s) => s.replace("from your hand", "from your Pokémon")],
    ["CHOSEN", (s) => s.replace(" to 1 of your opponent's Pokémon", "")],
    ["COUNT-NOUN", (s) => s.replace("for each Energy card you discarded", "for each card you discarded")],
    ["W/R", (s) => s.replace(" (Don't apply Weakness and Resistance for Benched Pokémon.)", "")],
  ];
  /** Every point of the 2⁵ lattice, as `[bitmask, axes applied, text]`. */
  const lattice = Array.from({ length: 32 }, (_, mask) => {
    let text = PRINTED;
    const names: string[] = [];
    AXES.forEach(([name, apply], i) => {
      if ((mask & (1 << i)) !== 0) {
        text = apply(text);
        names.push(name);
      }
    });
    return { mask, names, text };
  });

  it("🛑 exactly THREE of the 32 points build, and TWO of them are this slice's own anchor", () => {
    // 🛑 **THE MEASUREMENT THAT PRICED THE SLICE WAS TAKEN BEFORE THE BUILD AND CANNOT
    // BE RE-TAKEN AFTER IT.** At the base commit (`f7b44a2`) **ZERO** of the 32 points
    // built: the printed sentence was refused by all 13 readers and so was every
    // single, pair, triple and quadruple substitution, leaving exactly ONE point that
    // built — the all-five, which lands on `ENERGY_DISCARD_SCALED_DAMAGE`. That is the
    // number that says *no half of this sentence already shipped*, and it is stated as
    // HISTORY rather than smuggled into a rung that can no longer produce it.
    //
    // 🛑 **WHAT SURVIVES AS A LIVE CLAIM IS STRICTLY STRONGER THAN "one point builds",
    // AND IT IS THE ONE THAT REDDENS ON AN OVERREACH** (D438/D444): of the 32 points,
    // the ones that build are exactly the two THIS anchor owns — the printed sentence
    // and its clarifier-less twin, which is the one optional group in the pattern — plus
    // the all-five substitution, which belongs to the sibling. **Every point that
    // changes the ZONE, the CHOSEN target, the COUNT NOUN or the FILTER without changing
    // all four is still refused**, so an anchor loosened on any of those four axes
    // reddens here.
    const building = lattice.filter(({ text }) => readersClaiming(text).length > 0);
    expect(building.map(({ names }) => names.join("+") || "PRINTED")).toEqual([
      "PRINTED",
      "W/R",
      "FILTER+ZONE+CHOSEN+COUNT-NOUN+W/R",
    ]);
    const only = building[2];
    if (only === undefined) throw new Error("no all-five point");
    // …and it lands on the SHIPPED board-discard sibling's anchor, at this file's own
    // numbers. Naming what it lands on is what makes the lattice a price rather than a
    // count: five axes, and the fifth is where the family already is.
    expect(only.text).toBe(
      "Discard up to 3 {G} Energy cards from your Pokémon. This attack does 60 damage for each card you discarded in this way.",
    );
    expect(deriveAttackEffect(only.text)).toEqual([
      {
        op: "discardEnergy",
        from: "yours",
        filter: { kind: "providesEnergy", energyType: "Grass" },
        count: "any",
        cap: 3,
        recordAs: "discarded",
      },
      { op: "damageDefender", per: 60, count: "discarded" },
    ]);
  });

  it("🛑 no SINGLE, PAIR, TRIPLE or QUADRUPLE substitution reaches a claimed string", () => {
    // Stated by ARITY rather than as one blanket, because the arities are what a
    // successor will want: a slice that had believed "the head already ships" or "the
    // scaled snipe already ships" would have priced this at one axis.
    // The two points this slice's own anchor owns are excluded BY NAME rather than by
    // a `.filter(built)`, which would make the rung true under any build at all.
    const OURS = new Set(["", "W/R"]);
    for (const arity of [0, 1, 2, 3, 4]) {
      const points = lattice.filter(({ names }) => names.length === arity);
      expect(points.length, `arity ${arity}`).toBe([1, 5, 10, 10, 5][arity]);
      for (const { names, text } of points) {
        if (OURS.has(names.join("+"))) {
          // …and the excluded pair is asserted to be OURS, so the exemption cannot
          // quietly cover a point some other reader started claiming.
          expect(readersClaiming(text), names.join("+")).toEqual(["deriveAttackEffect"]);
          expect(deriveAttackEffect(text), names.join("+")).toEqual(PROGRAM);
          continue;
        }
        expect(readersClaiming(text), `${arity}: ${names.join("+")} :: ${text}`).toEqual([]);
      }
    }
  });

  it("🛑 this row is ALONE: no other residue sentence shares either of its two blockers", () => {
    // D483's cluster split 2+2 and D488's pair held; the question is not rhetorical.
    // The two blockers are (i) a HAND-source recording discard and (ii) a chosen-target
    // hit whose amount reads a §9.2 slot. Measured over the whole column at this head.
    const rows = legalAttackCorpus();
    const residue = rows.filter(([, s]) => !resolvedByAnyReader(s));
    // (i) 🛑 **ONE other unread sentence opens with a hand discard, and it does NOT
    //     share a blocker with this one — D483's rule, and the first draft of this rung
    //     asserted the set was EMPTY and was wrong.** *"Discard a card from your hand.
    //     If you do, your opponent discards a card from their hand."* is D473's shipped
    //     head shape (`payFromHand {count: 1, to: "discard", recordAs: "paid"}`) behind
    //     a §9.2 gate — the head this slice did not have to touch. Its blocker is the
    //     TAIL: `opponentDiscardsFromHand` builds STANDALONE (measured below) and the
    //     compound is claimed by no reader and by neither splitter, so what it needs is
    //     a whole-sentence anchor over a `recordGate`, not a quantifier and not a fold.
    //     **A shared printed phrase is not a shared blocker.**
    const handDiscards = residue.filter(([, s]) => /^Discard [^.]* from your hand\./.test(s));
    expect(handDiscards.map(([, s]) => s)).toEqual([
      "Discard a card from your hand. If you do, your opponent discards a card from their hand.",
    ]);
    // …and its blocker, named rather than asserted: the consequent alone DOES build.
    expect(deriveAttackEffect("Your opponent discards a card from their hand.")).toEqual([
      { op: "opponentDiscardsFromHand", count: 1 },
    ]);
    expect(effects.splitAttackGateClause(handDiscards[0]?.[1] ?? "")).toBeNull();
    expect(effects.splitAttackTrailingClause(handDiscards[0]?.[1] ?? "")).toBeNull();
    // (ii) the other unread chosen-target scaled hits, and each names a DIFFERENT
    //      blocker — so building them is not this slice and this slice does not free
    //      them. Named rather than counted (D400/D463: a grouped refusal is N refusals).
    const scaledChosen = residue.filter(
      ([, s]) => /for each/i.test(s) && /to 1 of your opponent/.test(s),
    );
    expect(scaledChosen.map(([, s]) => s)).toEqual([
      // Refused on the ARITY OF THE FOLD: "for each damage counter on THAT Pokémon"
      // counts on a body the player has not chosen yet, so `snipeAmount` would need a
      // fourth argument that does not exist until `applyChoice` — and the prompt could
      // not quote its own number. A §9.2 slot is known BEFORE the pick; this is not.
      "This attack does 20 damage to 1 of your opponent's Benched Pokémon for each damage counter on that Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
    ]);
  });
});

describe("D489 §3 — the READING: two ops in printed order, and what each byte refuses", () => {
  it("the printed sentence derives to the payment then the scaled snipe", () => {
    expect(deriveAttackEffect(PRINTED)).toEqual(PROGRAM);
  });

  it("🛑 a printed 0 in EITHER position stays LOUD, each against its own twin", () => {
    // Two printed numbers, two positivity questions, asserted separately — and each
    // refusal is ONE CHARACTER from a sentence that resolves in the same `it`, so no
    // other byte can be blamed for it (D399).
    for (const [bad, good] of [
      [PRINTED.replace("up to 3 Energy", "up to 0 Energy"), PRINTED.replace("up to 3 Energy", "up to 1 Energy")],
      [PRINTED.replace("does 60 damage", "does 0 damage"), PRINTED.replace("does 60 damage", "does 1 damage")],
    ] as const) {
      expect(deriveAttackEffect(bad), bad).toBeNull();
      expect(deriveAttackEffect(good), good).not.toBeNull();
    }
  });

  it("🛑 every GENERALISATION of this anchor claims the same 1 sentence / 2 printings", () => {
    // D472's rule, run rather than asserted: a wider anchor that claims no additional
    // row is pure risk, so none of these is taken. The measurement is kept as a RUNG
    // (D477) so the override is a decision a successor can re-run and reverse.
    const rows = legalAttackCorpus();
    const wider: readonly (readonly [string, RegExp])[] = [
      ["arity CAPTURED", /^Discard up to \d+ Energy cards from your hand\. This attack does \d+ damage to \d+ of your opponent['’]s Pokémon for each Energy card you discarded in this way\.(?: \(Don['’]t apply Weakness and Resistance for Benched Pokémon\.\))?$/],
      ["zone OPENED", /^Discard up to \d+ Energy cards from (?:your hand|this Pokémon|your Pokémon)\. This attack does \d+ damage to 1 of your opponent['’]s Pokémon for each Energy card you discarded in this way\.(?: \(Don['’]t apply Weakness and Resistance for Benched Pokémon\.\))?$/],
      ["quantifier OPENED", /^Discard (?:all|any amount of|up to \d+) Energy cards from your hand\. This attack does \d+ damage to 1 of your opponent['’]s Pokémon for each Energy card you discarded in this way\.(?: \(Don['’]t apply Weakness and Resistance for Benched Pokémon\.\))?$/],
      ["count noun CAPTURED", /^Discard up to \d+ Energy cards from your hand\. This attack does \d+ damage to 1 of your opponent['’]s Pokémon for each [^.]+ you discarded in this way\.(?: \(Don['’]t apply Weakness and Resistance for Benched Pokémon\.\))?$/],
      ["`Energy cards?` alternation", /^Discard up to \d+ Energy(?: cards)? from your hand\. This attack does \d+ damage to 1 of your opponent['’]s Pokémon for each Energy card you discarded in this way\.(?: \(Don['’]t apply Weakness and Resistance for Benched Pokémon\.\))?$/],
      ["W/R MANDATORY", /^Discard up to \d+ Energy cards from your hand\. This attack does \d+ damage to 1 of your opponent['’]s Pokémon for each Energy card you discarded in this way\. \(Don['’]t apply Weakness and Resistance for Benched Pokémon\.\)$/],
    ];
    for (const [label, re] of wider) {
      const hit = rows.filter(([, s]) => re.test(s));
      expect(hit.map(([, s]) => s), label).toEqual([PRINTED]);
      expect(units(hit), label).toBe(2);
    }
  });

  it("🛑 the W/R clarifier is OPTIONAL, which is the family's rule and not this anchor's choice", () => {
    // Every one of this file's snipe anchors spells it `(?: \(…\))?` — §8.5 makes it
    // true regardless and older printings omit it, so a mandatory copy here would refuse
    // on an ERA rather than on a mechanism. The rung above measured that the mandatory
    // form claims the SAME row, so this is a legibility call recorded rather than a
    // free win (D477).
    const bare = PRINTED.replace(" (Don't apply Weakness and Resistance for Benched Pokémon.)", "");
    expect(deriveAttackEffect(bare)).toEqual(PROGRAM);
    expect(legalAttackCorpus().some(([, s]) => s === bare)).toBe(false);
  });

  it("🛑 LEADING TEXT stays LOUD — the `^` is what refuses it, and nothing else", () => {
    // D464: a `^`-end refusal CAN be demonstrated on the loud path, where a `$`-end one
    // cannot (once a sentence derives, D409's trailing splitter composes it behind any
    // claimed tail through a path that is neither the anchor nor the arm). So this rung
    // exists on one end only, and says so.
    //
    // ⚠️ D452's one-axis rule: the prefix ENDS A SENTENCE and is itself a claimed
    // printed clause, so the ONLY thing separating this string from the printed one is
    // the leading run of bytes — not a capital, not a case, not a punctuation mark.
    // With the `^` deleted the anchor eats this compound and the leading damage clause
    // is silently dropped, which is the defect the caret prevents.
    const LEADING = `Draw a card. ${PRINTED}`;
    expect(deriveAttackEffect("Draw a card.")).not.toBeNull();
    expect(deriveAttackEffect(LEADING)).toBeNull();
    expect(readersClaiming(LEADING)).toEqual([]);
    // …and the corpus prints no such compound, so nothing is refused that a card needs.
    expect(legalAttackCorpus().some(([, t]) => t !== PRINTED && t.includes(PRINTED))).toBe(false);
  });

  it("🛑 STRUCTURALLY DISJOINT from all three neighbours, with no guard anywhere", () => {
    // D467's first preference. Each neighbour demands a run of bytes at `^` that this
    // one cannot produce, and vice versa — so nothing is placed first and there is no
    // lookahead to rot. Asserted from BOTH sides, per D467.
    expect(deriveAttackEffect(SELF_DISCARD_SNIPE)?.[0]?.op).toBe("discardEnergy");
    expect(deriveAttackEffect(BOARD_DISCARD_SCALED)?.[0]?.op).toBe("discardEnergy");
    expect(deriveAttackEffect(SCALED_SNIPE_ON_SELF)?.[0]?.op).toBe("damageChosen");
    expect(deriveAttackEffect(PRINTED)?.[0]?.op).toBe("payFromHand");
    // …and the three neighbours' programs are pairwise unequal to this one, which is
    // strictly stronger than four `toBeNull`s and cannot go green by accident when a
    // sibling anchor lands (D449).
    for (const other of [SELF_DISCARD_SNIPE, BOARD_DISCARD_SCALED, SCALED_SNIPE_ON_SELF]) {
      expect(deriveAttackEffect(PRINTED)).not.toEqual(deriveAttackEffect(other));
    }
  });
});

describe("D489 §4 — the DECLINABLE payment: the offer, the ceiling and the noun", () => {
  it("parks a chooseCards whose FLOOR is 0, whose ceiling is the printed cap, and whose note is the printed head", () => {
    const { state: parked, events } = swing(table(), HAND_PURGE);
    expect(types_(events)).toContain("EFFECT_PENDING");
    expect(types_(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    // Nothing has been paid yet — the park comes BEFORE the move.
    expect(types_(events)).not.toContain("HAND_COST_PAID");
    const prompt = handPrompt(parked);
    expect(prompt.min).toBe(0);
    expect(prompt.max).toBe(3);
    expect(prompt.dest).toBe("discard");
    // 🛑 THE CAPTION IS THE PRINTED HEAD SENTENCE, BYTE FOR BYTE, and it is built from
    // the very fields the op carries — so a park whose heading says "up to 3" while the
    // op lost its `cap` is a byte string this deploy cannot write (D457's witness rule).
    expect(prompt.note).toBe("Discard up to 3 Energy cards from your hand.");
    expect(PRINTED.startsWith(prompt.note)).toBe(true);
    // FIVE candidates: the Energy, all three copies of the interchangeable class, and
    // NEITHER Item. Read as a multiset of ids so the rung says WHICH cards, not how many
    // (D488: a candidate no board separates by quantity is separated by contents).
    expect(prompt.candidates.map((uid) => idOf(uid, parked)).sort()).toEqual(
      ["d489-fire", "d489-water", "d489-water", "d489-water", "d489-grass"].sort(),
    );
  });

  it("🛑 the interchangeable class is NOT collapsed below the cap — three copies, three rows", () => {
    // `discardEnergy`'s stated reason, verbatim: *"the COUNT is what the damage reads,
    // so three identical {W} must offer three pickable rows, not one."* A collapse to
    // one would cap this attack at 60 damage on a hand that can pay for 180, and the
    // BOARD would look identical — only the offer says so.
    const { state: parked } = swing(table(), HAND_PURGE);
    const prompt = handPrompt(parked);
    const bs = prompt.candidates.filter((uid) => idOf(uid, parked) === "d489-water");
    expect(bs).toHaveLength(3);
    expect(new Set(bs).size).toBe(3);
  });

  it("🛑 the attacker's ATTACHED cost Energy is never on offer, and is still attached afterwards", () => {
    // *Cost is a check, not a payment* (§8 step 2, D436) — and the sharper claim: this
    // is a HAND discard, so a build that read the printed head as a BOARD discard would
    // strip the attacker. Both halves are driven.
    const start = table();
    const { state: parked } = swing(start, HAND_PURGE);
    const prompt = handPrompt(parked);
    for (const uid of prompt.candidates) expect(idOf(uid, parked)).not.toBe("d489-cost");
    const { state: picked } = answerCards(parked, uidsOf(parked, prompt.candidates, "d489-fire", 1));
    const ref = snipePrompt(picked).candidates.find((r) => r.spot.spot !== "active");
    if (ref === undefined) throw new Error("no benched candidate");
    const { state: done } = answerBody(picked, ref);
    expect(done.players.p1.active?.energy.map((uid) => idOf(uid, done))).toEqual([
      "d489-cost",
      "d489-cost",
    ]);
  });

  it("REJECTS an over-cap pick, a repeat and a card that was never offered", () => {
    const { state: parked } = swing(table(), HAND_PURGE);
    const prompt = handPrompt(parked);
    const bs = uidsOf(parked, prompt.candidates, "d489-water", 3);
    const a = uidsOf(parked, prompt.candidates, "d489-fire", 1)[0] as string;
    const c = uidsOf(parked, prompt.candidates, "d489-grass", 1)[0] as string;
    for (const uids of [[...bs, a], [a, a], [a, parked.players.p1.deck[0] as string]]) {
      const rejected = applyAction(parked, {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "cards", uids },
      });
      expect(rejected.ok, JSON.stringify(uids)).toBe(false);
      if (!rejected.ok) expect(rejected.error.code).toBe("BAD_EFFECT_CHOICE");
    }
    // …and exactly `cap` IS legal, which is the control that keeps the rung above from
    // passing on a build that refuses everything (D424).
    expect(applyAction(parked, { type: "resolveEffect", seat: "p1", choice: { kind: "cards", uids: [a, c, bs[0] as string] } }).ok).toBe(true);
  });

  it("🛑 an EMPTY offer whiffs inline: no park, an empty slot, and no snipe at all", () => {
    // A hand with no Energy at all. The recording op files `[]` — the whiff every
    // recording op takes — so the fold reads an honest 0 and `damageChosen` returns
    // before it builds a prompt. **The attack asks for no target and deals nothing.**
    const { state: done, events } = swing(table(["d489-item-1", "d489-item-2"], PILE), HAND_PURGE);
    expect(types_(events)).not.toContain("EFFECT_PENDING");
    expect(types_(events)).not.toContain("HAND_COST_PAID");
    expect(types_(events)).not.toContain("DAMAGE_DEALT");
    expect(types_(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(done.players.p2.active?.damage).toBe(0);
    expect(done.players.p2.bench[0]?.damage).toBe(0);
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("🛑 a single candidate STILL PARKS — the printed `up to` is a decision at every non-empty hand", () => {
    // D297's rule and `discardEnergy.count: "any"`'s standing behaviour. The M1
    // no-choice shortcut retires a prompt whose answers are the SAME state; under an
    // *"up to"* the answers are "60 damage" and "nothing", which are two boards.
    const { state: parked } = swing(table(["d489-fire", "d489-item-1"], PILE), HAND_PURGE);
    const prompt = handPrompt(parked);
    expect(prompt.candidates).toHaveLength(1);
    expect([prompt.min, prompt.max]).toEqual([0, 1]);
  });
});

describe("D489 §5 — the board arithmetic, computed BEFORE it is asserted", () => {
  // D482/D485: name the boards on which two candidate implementations differ BEFORE
  // designing the suite, and prove the chosen board separates them. Each row is what a
  // candidate reading would answer on the main board with TWO Energy discarded, aimed
  // at the BENCHED body (flat, no W/R).
  const PER = 60;
  const PICKED = 2;
  const PILE_ENERGY_BEFORE = 2;
  const HAND_SIZE_BEFORE = 7;
  const CAP = 3;
  const READINGS: readonly (readonly [string, number])[] = [
    ["CORRECT — 60 × the slot", PER * PICKED],
    ["the rider is dropped (unscaled hit)", PER],
    ["the count is the printed CAP", PER * CAP],
    ["the count is the whole discard PILE afterwards", PER * (PILE_ENERGY_BEFORE + PICKED)],
    ["the count is the HAND SIZE before the discard", PER * HAND_SIZE_BEFORE],
    ["the rider names the WRONG slot (empty)", 0],
    ["the record is lost across the park", 0],
  ];

  it("🛑 the six candidate readings answer SIX different numbers on this board", () => {
    // The empty-pile board would make readings 1 and 4 identical (2 = 0 + 2), which is
    // the board a suite writes by default — D488's finding, re-earned. The hand of
    // exactly three Energy would make readings 1 and 3 identical. Both are pre-empted
    // by the fixture, and this rung is what says so in numbers.
    expect(READINGS.map(([, n]) => n)).toEqual([120, 60, 180, 240, 420, 0, 0]);
    const distinct = new Set(READINGS.map(([, n]) => n));
    // SIX distinct values over SEVEN readings: the two zeroes collide by construction
    // and are separated by a different axis — one has no PARK at all, the other parks
    // and then deals nothing. §6 asserts that axis rather than the number.
    expect(distinct.size).toBe(6);
  });

  it("🛑 the fixture's composition is a MEASUREMENT, not a preference", () => {
    // D485's rule: assert the near-misses, so a successor cannot quietly simplify the
    // board back into one that proves nothing.
    expect(HAND.filter((id) => ENERGY_IDS.has(id)).length).toBeGreaterThan(CAP);
    expect(HAND.filter((id) => !ENERGY_IDS.has(id)).length).toBeGreaterThan(0);
    expect(HAND.filter((id) => id === "d489-water")).toHaveLength(3);
    expect(PILE.filter((id) => ENERGY_IDS.has(id)).length).toBe(PILE_ENERGY_BEFORE);
    expect(HAND).toHaveLength(HAND_SIZE_BEFORE);
  });
});

describe("D489 §6 — the boards: two parks, one sentence", () => {
  it("🛑 discard TWO, hit the BENCH for 120 — flat, and the pile keeps its own cards", () => {
    const start = table();
    const { state: parked } = swing(start, HAND_PURGE);
    const prompt = handPrompt(parked);
    const picked = [
      uidsOf(parked, prompt.candidates, "d489-fire", 1)[0] as string,
      uidsOf(parked, prompt.candidates, "d489-water", 1)[0] as string,
    ];
    const { state: paid, events: e1 } = answerCards(parked, picked);
    expect(find(e1, "HAND_COST_PAID")).toMatchObject({ seat: "p1", to: "discard" });
    // The cards left the hand for the pile, and the PRE-SEEDED pile is still under them.
    expect(idsIn(paid, "p1", "discard")).toEqual([
      "d489-en-d",
      "d489-en-d",
      "d489-item-3",
      "d489-item-3",
      "d489-fire",
      "d489-water",
    ]);
    expect(idsIn(paid, "p1", "hand").sort()).toEqual(
      ["d489-water", "d489-water", "d489-grass", "d489-item-1", "d489-item-2"].sort(),
    );
    // …then the SECOND park, on the opponent's whole board (Active + Bench).
    const snipe = snipePrompt(paid);
    expect(snipe.candidates).toHaveLength(2);
    expect(snipe.candidates.map((r) => r.seat)).toEqual(["p2", "p2"]);
    // 🛑 THE CAPTION QUOTES THE FOLDED AMOUNT — 120, not the op's printed 60. A caption
    // that quoted `op.amount` would tell the player the wrong number on every board
    // where the fold is not 1 (D448's own rung, one rider over).
    expect(snipe.note).toContain("120");
    expect(snipe.note).not.toContain("60 damage");
    const bench = snipe.candidates.find((r) => r.spot.spot !== "active");
    if (bench === undefined) throw new Error("no benched candidate");
    const { state: done, events: e2 } = answerBody(paid, bench);
    expect(find(e2, "DAMAGE_DEALT")).toMatchObject({ seat: "p2", base: 120, weakness: null, dealt: 120 });
    expect(types_(e2)).not.toContain("COUNTERS_PLACED");
    expect(done.players.p2.bench[0]?.damage).toBe(120);
    expect(done.players.p2.active?.damage).toBe(0);
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("🛑 the same two cards aimed at the ACTIVE take WEAKNESS — 240, which is what `deals` buys", () => {
    // The pair that separates *"this is attack damage"* from *"these are placed
    // counters"*: a `deals`-less build puts 120 flat counters on a body whose Weakness
    // doubles a real hit. Same board, same pick, different target.
    const { state: parked } = swing(table(), HAND_PURGE);
    const prompt = handPrompt(parked);
    const { state: paid } = answerCards(parked, [
      uidsOf(parked, prompt.candidates, "d489-fire", 1)[0] as string,
      uidsOf(parked, prompt.candidates, "d489-water", 1)[0] as string,
    ]);
    const active = snipePrompt(paid).candidates.find((r) => r.spot.spot === "active");
    if (active === undefined) throw new Error("no Active candidate");
    const { state: done, events } = answerBody(paid, active);
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ seat: "p2", base: 120, dealt: 240 });
    expect(done.players.p2.active?.damage).toBe(240);
    expect(done.players.p2.bench[0]?.damage).toBe(0);
  });

  it("🛑 discard THREE — the cap is spent, and 180 is not the pile's number", () => {
    const { state: parked } = swing(table(), HAND_PURGE);
    const prompt = handPrompt(parked);
    const { state: paid } = answerCards(parked, uidsOf(parked, prompt.candidates, "d489-water", 3));
    const bench = snipePrompt(paid).candidates.find((r) => r.spot.spot !== "active");
    if (bench === undefined) throw new Error("no benched candidate");
    const { state: done, events } = answerBody(paid, bench);
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ base: 180, dealt: 180 });
    expect(done.players.p2.bench[0]?.damage).toBe(180);
    // …and the pile now holds 5 Energy, so a build counting the PILE would have said
    // 300. Named rather than left implicit (D400).
    expect(idsIn(done, "p1", "discard").filter((id) => ENERGY_IDS.has(id))).toHaveLength(5);
  });

  it("🛑 DECLINE the discard and the attack asks for no target at all", () => {
    // The printed *"up to"* floor of zero, driven. An empty answer files an empty slot,
    // `snipeAmount` folds to 0, and `damageChosen` returns BEFORE it builds a prompt —
    // so there is no second park, no `DAMAGE_DEALT` and no `COUNTERS_PLACED`. This is
    // the ending the D420 escape rests on: **nothing is bought when nothing is paid.**
    const { state: parked } = swing(table(), HAND_PURGE);
    const { state: done, events } = answerCards(parked, []);
    expect(types_(events)).not.toContain("HAND_COST_PAID");
    expect(types_(events)).not.toContain("EFFECT_PENDING");
    expect(types_(events)).not.toContain("DAMAGE_DEALT");
    expect(types_(events)).not.toContain("COUNTERS_PLACED");
    expect(done.players.p2.active?.damage).toBe(0);
    expect(done.players.p2.bench[0]?.damage).toBe(0);
    expect(idsIn(done, "p1", "hand")).toHaveLength(7);
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("🛑 the LOUD control still fires, so a silent board means something", () => {
    // D214's attribution control: without it, "no `ATTACK_EFFECT_SKIPPED`" above is
    // green on a build that stopped emitting the row at all.
    const { events } = swing(table(), LOUD_SWING);
    expect(types_(events)).toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("🛑 a PLAIN attack on the same board is unaffected — the control for every zero above", () => {
    const { state: done, events } = swing(table(), PLAIN_CUFF);
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ base: 10, dealt: 20 });
    expect(done.players.p2.active?.damage).toBe(20);
    expect(idsIn(done, "p1", "hand")).toHaveLength(7);
  });
});

describe("D489 §7 — `MATCH_RECORD_VERSION` stays 29, driven over v29 bytes", () => {
  // 🛑 THE ADDRESS DOES PERSIST AND THE REACHABILITY ARGUMENT IS FALSE HERE (D463's
  // rule: pick the argument SHAPE that is true). This is a TWO-PARK program: the
  // payment writes `phase.cont.pendingOp` with the snipe in `rest`, and the snipe then
  // writes its own continuation. So both new bytes genuinely reach a saved
  // `MatchRecord`. The claim is the SERIALIZED ALPHABET (D462): no v29 deploy could
  // write either byte, and ABSENT still means what the v29 writer meant.
  const ctx = { seat: "p1" as Seat, invokedBy: "attack" as const };

  it("🛑 the program really does park TWICE, and the record rides between the two", () => {
    const start = table();
    const { state: parked } = swing(start, HAND_PURGE);
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    // Park ONE: the payment is pending and the snipe is the whole of `rest`.
    expect(parked.phase.cont.pendingOp.op).toBe("payFromHand");
    expect(parked.phase.cont.rest.map((op) => op.op)).toEqual(["damageChosen"]);
    // Nothing recorded yet — the slot is filed when the pick resolves.
    expect(parked.phase.cont.record).toBeUndefined();
    const prompt = handPrompt(parked);
    const { state: paid } = answerCards(parked, uidsOf(parked, prompt.candidates, "d489-water", 2));
    if (paid.phase.kind !== "effect:choose") throw new Error("expected a SECOND effect:choose");
    // Park TWO: the snipe is pending, `rest` is empty, and **the record is carried** —
    // which is what makes the caption and the hit the same number on both sides.
    expect(paid.phase.cont.pendingOp.op).toBe("damageChosen");
    expect(paid.phase.cont.rest).toEqual([]);
    expect(paid.phase.cont.record?.discarded).toHaveLength(2);
  });

  it("🛑 a v29 PAYMENT (exact `count`, no `cap`) still means an exact payment", () => {
    // The LOSS direction: reconstruct the bytes a v29 writer could have written and
    // replay them through the real interpreter. An exact `count: 2` must still be
    // mandatory — `min === max` — because that is what those bytes meant.
    const state = table();
    const events: GameEvent[] = [];
    const run = runProgram(state, V29_PAYMENT, ctx, events);
    if (run.kind !== "parked") throw new Error("expected a park");
    if (run.prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    expect([run.prompt.min, run.prompt.max]).toEqual([2, 2]);
    expect(run.prompt.note).toBe("Discard 2 Energy cards from your hand.");
  });

  it("🛑 a v29 SNIPE (no `perRecorded`) still deals its printed amount, unscaled", () => {
    // The other half of the loss direction. A record that lost the rider must resolve
    // to the board a v29 deploy produced — 60, not 0 and not 120 — which is what makes
    // the key a WIDENING (D125/D334) rather than a re-meaning (D359).
    const state = table();
    const events: GameEvent[] = [];
    const run = runProgram(state, V29_SNIPE, ctx, events, { discarded: ["x", "y"] });
    if (run.kind !== "parked") throw new Error("expected a park");
    if (run.prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");
    expect(run.prompt.note).toContain("60");
    const bench = run.prompt.candidates.find((r) => r.spot.spot !== "active");
    if (bench === undefined) throw new Error("no benched candidate");
    const resumed = resumeProgram(run.state, run.cont, { kind: "pokemonMulti", refs: [bench] }, events);
    if (resumed.kind !== "done") throw new Error("expected done");
    expect(resumed.state.players.p2.bench[0]?.damage).toBe(60);
  });

  it("🛑 and the NEW bytes on the SAME board answer differently — the control for both", () => {
    // Both directions or neither (D441). A rung that only drives the old bytes passes
    // on a build that ignores the new ones.
    const state = table();
    const events: GameEvent[] = [];
    const run = runProgram(state, [PROGRAM[1] as EffectOp], ctx, events, { discarded: ["x", "y"] });
    if (run.kind !== "parked") throw new Error("expected a park");
    if (run.prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");
    expect(run.prompt.note).toContain("120");
    const bench = run.prompt.candidates.find((r) => r.spot.spot !== "active");
    if (bench === undefined) throw new Error("no benched candidate");
    const resumed = resumeProgram(run.state, run.cont, { kind: "pokemonMulti", refs: [bench] }, events);
    if (resumed.kind !== "done") throw new Error("expected done");
    expect(resumed.state.players.p2.bench[0]?.damage).toBe(120);
  });

  it("🛑 an EMPTY record makes the new rider deal nothing and ask nothing", () => {
    // The third v29-shaped board: the rider is present but the slot is empty, which is
    // exactly what a lost `cont.record` would produce on a resume. It must NOT degrade
    // into the unscaled hit — that would be the plausible wrong answer D421 says to
    // design against, and it is what separates "the record rides the park" from "the
    // fold defaults to 1".
    const state = table();
    const events: GameEvent[] = [];
    const run = runProgram(state, [PROGRAM[1] as EffectOp], ctx, events, {});
    expect(run.kind).toBe("done");
    if (run.kind !== "done") throw new Error("expected done");
    expect(run.state.players.p2.bench[0]?.damage).toBe(0);
    expect(run.state.players.p2.active?.damage).toBe(0);
  });
});

describe("D489 §8 — the DESCRIBER obligation, discharged rather than asserted", () => {
  it("🛑 `withConsequence` is UNREACHABLE for this program, and the reason is the CALL PATH", () => {
    // D478's rule: describer obligations follow the call path, not the op's category.
    // The handoff expected "real work here, because this op parks" — a category
    // argument. `withConsequence` returns the prompt unchanged unless the QUEUE holds a
    // `recordGate` on the slot the parking op files, and this program's queue holds one
    // op: the snipe. So `describeBranch` and `describeCondition` are never called, and
    // the note the player sees is `payFromHandNote`'s alone.
    const { state: parked } = swing(table(), HAND_PURGE);
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(parked.phase.cont.rest.map((op) => op.op)).toEqual(["damageChosen"]);
    expect(parked.phase.cont.rest.some((op) => op.op === "recordGate")).toBe(false);
    // …and the observable consequence: the note carries NO "If you do" clause.
    expect(handPrompt(parked).note).toBe("Discard up to 3 Energy cards from your hand.");
    expect(handPrompt(parked).note).not.toContain("If you do");
  });
});

describe("D489 §9 — the census this row moves, and the summands it does not", () => {
  it("the resolving corpus gains ONE sentence and TWO printings", () => {
    // ⚠️ THE TWO STEPS DISAGREE, 1 vs 2 — the one file line carries 2 legal printings,
    // so a pass that copied one number into the other kind of site would be wrong at
    // half of them (D451/D464).
    const rows = legalAttackCorpus();
    const resolved = rows.filter(([, s]) => resolvedByAnyReader(s));
    expect([resolved.length, units(resolved)]).toEqual([540, 1578]);  // (🆕🆕🆕 **D513 +1 sentence / +1 printing — THE PRINTED *“of different types”*, THE FIRST DISTINCTNESS CONSTRAINT THIS ENGINE READS** — `censusAttackCorpus.ts` **FILE LINE 473**, *"Search your deck for up to 3 Basic Energy cards of different types, reveal them, and put them into your hand. Then, shuffle your deck."*, **1 sentence / 1 legal printing** (Sylveon ex `sv06.5-050`), claimed by `deriveAttackEffect`. 🛑 **THE ANCHOR WAS NEVER THE BLOCKER** — `ATTACK_HAND_SEARCH`'s `([^,.]+?)` noun group has captured `Basic Energy cards of different types` WHOLE since D231 and the sentence died one step later in `HAND_SEARCH_PLURAL.get`, so the new optional group MOVES a phrase out of the noun rather than admitting a sentence the pattern refused (D510's rule, paid a second time). ✅ **ZERO new `CardFilter` members — and no widening of that union could EVER have reached this row**, because `matchesFilter` narrows each card INDEPENDENTLY while *“of different types”* is a predicate on the ANSWER SET. It rides D332's shipped `chooseCards.caps` instead — one cap of ONE per `energyProvidesOf` cell — so **ZERO** new prompt fields, validator branches or client mirrors. `MATCH_RECORD_VERSION` **HELD at 30**.) (🆕🆕🆕 **D512 +1 sentence / +2 printings — THE BOTH-SIDES BODY COUNT NARROWED BY TWO PRINTED NAME FRAGMENTS** — `censusAttackCorpus.ts` **FILE LINE 583**, *"This attack does 40 damage for each Pokémon in play that has \"Koffing\" or \"Weezing\" in its name (both yours and your opponent's)."*, **1 sentence / 2 legal printings**, claimed by `deriveAttackDamageMultiplier` over ONE new anchor (`IN_PLAY_BOTH_SIDES_NAME_MULTIPLY`), ONE new `CardFilter` member (`pokemonNameContaining`) and ONE new `DamageCountSource` member (`bothSidesPokemonInPlay` — the FIRST both-sides count in that union to carry a `CardFilter`; `bothSidesBenchCount` and `bothActivesEnergyCount` are both BARE, because their printed nouns carry no adjective and this one's is NARROWED in print). 🛑 **THE SHIPPED ANCHORS WERE RUN AGAINST THE ROW FIRST AND ALL FOUR REFUSE IT AT THE PATTERN** — the OPPOSITE answer to D510's one row up, and the reason this row genuinely owed a pattern: every in-play anchor requires the literal `for each of your ` and this sentence's head is SEATLESS, with the side named by a trailing parenthetical. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP DISAGREE AT 1 AND 2**, measured at this head rather than carried (D451/D461). RAW summand ALONE: no registry row, no gate split and no trailing split — re-measured unmoved at registry 10/16, gate 5/13, trailing 11/21.) (🆕🆕🆕 **D510 +1 sentence / +2 printings — THE DISCARD PILE NARROWED BY A PRINTED NAME FRAGMENT** — `censusAttackCorpus.ts` **FILE LINE 543**, *"This attack does 20 damage for each Supporter card that has \"Team Rocket\" in its name in your discard pile."*, **1 sentence / 2 legal printings**, claimed by `deriveAttackDamageMultiplier` through ONE new `CardFilter` member (`supporterNameContaining`) and ONE PARAMETERISED noun in `discardPileFilter` — **ZERO new anchors**, because D440’s shipped `DISCARD_PILE_COUNT_MULTIPLY` had matched this row since it was written and the NOUN RESOLVER was the blocker. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP DISAGREE AT 1 AND 2** — a TWO-printing sentence, the opposite of D508 one entry down, measured at this head rather than carried (D451/D461). RAW summand ALONE: registry 10/16, gate 5/13 and trailing 11/21 all re-measured unmoved.) (🆕🆕🆕 **D508 +1 sentence / +1 printing — THE DISCARD PILE NARROWED BY A PRINTED ATTACK NAME** — `censusAttackCorpus.ts` **FILE LINE 542**, *"This attack does 20 damage for each Pokémon in your discard pile that has the United Wings attack."*, **1 sentence / 1 legal printing**, claimed by `deriveAttackDamageMultiplier` over ONE new anchor (`DISCARD_PILE_ATTACK_NAME_MULTIPLY`) crossing D440's `cardsInDiscardPile` count with D446's `attackNamePokemon` filter — **ZERO new members in either union, ZERO evaluator bytes**. READER summand ALONE; registry, gate and trailing stand still at 10/16, 5/13, 11/21.) (🆕🆕🆕 **D507 +2 sentences / +2 printings — THE SPREAD THAT HITS **BOTH** BENCHES, AND THE OPTIONAL PRINTED CLAUSE THAT NARROWS IT TO THE ALREADY-DAMAGED BODIES** — `censusAttackCorpus.ts` **FILE LINES 515 and 526**, *"This attack also does 10 damage to each Benched Pokémon (both yours and your opponent's). (Don't apply Weakness and Resistance for Benched Pokémon.)"* and *"This attack also does 40 damage to each Benched Pokémon **that has any damage counters on it** (both yours and your opponent's). (Don't apply…)"*, **2 sentences / 2 legal printings**, both claimed by `deriveAttackEffect` arm **6-ii** over ONE new anchor (`SPREAD_EACH_BOTH_BENCH`) whose OPTIONAL GROUP *is* the rider. 🛑 **THE BOTH-SIDES HALF COSTS NO TYPE AT ALL: it is a TWO-OP PROGRAM OF THE SAME OP** — `spreadDamage { yourBench }` then `spreadDamage { opponentBench }` — which is D482's shipped answer to the identical question one zone over, so `spreadDamage.target` gains **NO third member** and `counterEachAll`'s `filter` + `side` shape was refused rather than copied (D448/D449/D465's thrice-refused widening, same class). The op gains ONE OPTIONAL BOOLEAN RIDER, `damagedOnly` — `counterEachAll`'s own name on its own predicate `hasAnyDamageCounters`, D505's idiom one rider later. **ZERO** new `EffectOp` members, op KINDS, readers (surface unmoved at **13**), `CardFilter`/`BoardCondition`/`DamageCountSource` members, prompts, choice kinds, parks, events, error codes, `GameState`/`InPlayPokemon` fields, registry rows, `FIXTURE_POOL` ids (file-local `cardPool`, D414), `redact.ts` bytes, `packages/schema` bytes or `MATCH_RECORD_VERSION` bytes. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 2 AND 2**, MEASURED at this head rather than carried (D451/D461/D465) — both rows are 1-printing sentences. RAW summand ALONE: no registry row, no gate split, no trailing split — all three re-measured unmoved at registry 10/16, gate 5/13, trailing 11/21.) (🆕🆕🆕 **D505 +1 sentence / +3 printings — THE PRIZE-SCALED BENCH SPREAD, THE MISSING CELL OF A SHIPPED 2×2** — `censusAttackCorpus.ts` **FILE LINE 517**, *"This attack also does 10 damage to each of your opponent's Benched Pokémon for each Prize card your opponent has taken. (Don't apply Weakness and Resistance for Benched Pokémon.)"*, **1 sentence / 3 legal printings**, claimed by `deriveAttackEffect` arm **6-i** over ONE new anchor (`SPREAD_EACH_BENCH_TAKEN_PRIZES`) and ONE OPTIONAL BOOLEAN RIDER on the SHIPPED `spreadDamage` (`perTakenPrize` — D448's own name spelled on a second op, so `snipeAmount`'s structural parameter folds it UNCHANGED). **ZERO** new `EffectOp` members, op KINDS, readers (surface unmoved at **13**), prompts, choice kinds, parks, events, `GameState`/`InPlayPokemon` fields, registry rows, `FIXTURE_POOL` ids or `MATCH_RECORD_VERSION` bytes. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP DISAGREE, 1 vs 3**, so a `.length` site takes +1 where a `units(…)` site takes +3 — the largest single printing step left in the residue's spread family, and the reason this row was worth taking before smaller ones (D451, re-paid again).) (🆕🆕🆕 **D500 +1 sentence / +1 printing — THE PRINTED CARD CATEGORY `Basic`, WHICH IS `Special`'s COMPLEMENT AND NOT A TENTH TYPE** — `censusAttackCorpus.ts` **FILE LINE 580**, *"This attack does 40 damage for each Basic Energy attached to this Pokémon."*, **1 sentence / 1 legal printing**, claimed by `deriveAttackDamageMultiplier` through **ONE ROW in `CLAUSE_ENERGY_TOKENS`** — the anchor `SELF_ENERGY_MULTIPLY` already admitted the token and the refusal lived one step later, in `attachedEnergyFilter`. **ZERO new anchors, ZERO new readers (surface unmoved at 13), ZERO new ops, ZERO new op FIELDS, ZERO new `DamageCountSource` members, ZERO new `FIXTURE_POOL` ids and ZERO `packages/schema` bytes.** ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1** — the row is 1/1 — and that was VERIFIED at both kinds of site rather than assumed from the row being singular (D451/D461).) (🆕🆕🆕 **D491 +1 sentence / +1 printing — THE ONLY DRAW IN THE COLUMN WHOSE SUBJECT IS NOT THE CONTROLLER** — corpus FILE LINE **199**, *"Each player draws 3 cards."*, claimed WHOLE by `deriveAttackEffect` through ONE new anchor over `drawCards` + ONE optional key `who?: "eachPlayer"`; reader surface still **13**. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1, measured.)   // 🆕🆕🆕 **D490 +1 sentence / +2 printings — THE MILL OF BOTH DECKS, SCALED BY THE ENERGY AMONG WHAT IT MILLED** (`censusAttackCorpus.ts` FILE LINE 130; the LAST unbuilt member of the `discarded in this way` family, claimed by `deriveAttackDiscardScaledBoost`'s new `eachDeckMill` member — the reader SURFACE stands still at 13). ⚠️ THE TWO STEPS DISAGREE, 1 AND 2.
    expect(rows).toHaveLength(640);
    expect(units(rows)).toBe(1732);
  });

  it("engineVersion is 0.400.0 and the bump is owed for BEHAVIOUR", () => {
    // 🆕🆕🆕 D489 — 0.383.0 → **0.384.0**. A card can reach it: one printed sentence
    // that derived to `null` and fell to the loud `ATTACK_EFFECT_SKIPPED` path now
    // discards from a hand and deals a number proportional to what it discarded.
    expect(engineVersion).toBe("0.400.0");
    expect(deriveAttackEffect(PRINTED)).not.toBeNull();
  });
});
