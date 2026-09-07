import { describe, expect, it } from "vitest";
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import { deriveAttackEffect, splitAttackGateClause, splitAttackTrailingClause } from "./effects";
import { applyAction, engineVersion } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import {
  FIXTURE_POOL,
  FLIP_STATUS_ENERGY_DISCARD_DECK,
  attachFromDeck,
  clearBench,
  deepFreeze,
  driveSetup,
  must,
  mustApply,
  setActiveFromDeck,
} from "./testFixtures";

// 0.362.0 → 0.363.0 — 🆕🆕 D464, THE FLIP-GATED STATUS THAT ALSO STRIPS AN ENERGY.
// *"Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed, and discard an
// Energy from that Pokémon."* — `censusAttackCorpus.ts` FILE LINE 264, **1 sentence / 2
// legal printings** — ONE `coinFlipGate` whose `then` is arm 2's `applyStatus` followed by
// `FLIP_OPPONENT_ACTIVE_DISCARD`'s `discardEnergy`.
//
// 🛑 **WHAT THIS SLICE IS ACTUALLY ABOUT IS A NEGATIVE CONTROL THAT NAMED THE WRONG BYTE.**
// D462 left this row LOUD on purpose and wrote why: *"It is refused by the SECOND capture
// group and by nothing else: drop `(${STATUS_WORDS})` to `(.+)` and this anchor eats a
// sentence whose Energy discard it would silently throw away."* MEASURED over all 640 rows,
// `DEFENDER_STATUS_TRIPLE` claims ONE row / 2 printings under EVERY single-axis loosening it
// has — any slot widened, the `^` dropped, the `\.$` dropped — and this sentence is in NONE
// of them. It cannot be: after *"is now Paralyzed"* that anchor demands a SECOND comma this
// row never prints, and its `^Your opponent` prefix refuses the flip clause besides. The
// anchor that really refused it is `FLIP_DEFENDER_NOW`, by its `\.$` — 2 rows / 29 printings
// strict, **6 / 35** with that one byte gone. §2 keeps both measurements executable.
//
// ⚠️ **THE NEGATIVE-CONTROL COST WAS MEASURED BEFORE IT WAS PAID (D463's rule).** The engine
// change ALONE reddened **22 assertions across 16 files**; FIVE of them in THREE files are
// the control (`defenderStatusTriple.test.ts` §2 and §5, `defenderStatusPair.test.ts` §2 and
// §7, `checkup.test.ts`'s refusal list) and the other seventeen are the census tax. All five
// were RE-POINTED and none deleted (D418) — onto the set the same probe NAMES: the three
// real printings `DEFENDER_NOW`'s own `\.$` measurably refuses (corpus FILE LINES 685, 686,
// 690). D418's question, answered: the OLD claim caught an anchor drift that would have
// claimed this sentence and silently dropped its discard; the NEW claim catches the same
// drift AND a drift that lands the two ops out of printed order, which `toBeNull` could not.
//
// ⚠️ **ZERO NEW MECHANISM, MEASURED RATHER THAN BOASTED.** No new `EffectOp` member, no new
// op FIELD, no new op VALUE, no new reader (the surface stands still at 13, asserted in §6),
// no prompt, no event, no error code, no registry row, no `FIXTURE_POOL` id, no
// `packages/schema` byte and no `redact.ts` byte. Both ops already ship inside this exact
// gate on two sibling arms — which is also the whole `MATCH_RECORD_VERSION` argument (§7).
//
// ⚠️ **THE CARRIERS ARE UNRESOLVED AND SAID SO (D425).** The row has 2 legal printings and
// this checkout has no D1, so `fix-oxford` is SYNTHETIC. The STRING is the corpus row byte
// for byte (§1); nothing else about the body is transcription.

/** Corpus FILE LINE 264, byte for byte. ⚠️ THE APOSTROPHE IS ASCII U+0027 and the `é` is
    U+00E9 — asserted in §1 off the corpus rather than eyeballed. */
const PRINTED =
  "Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed, and discard an Energy from that Pokémon.";

/** The bare flip twin (corpus FILE LINE 265, 27 printings) and the bare discard (FILE LINE
    247, 12 printings) — the two shipped arms whose `then` lists this slice concatenates.
    They are here so §2 can assert the JOIN rather than describe it. */
const BARE_FLIP_STATUS = "Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed.";
const BARE_FLIP_DISCARD =
  "Flip a coin. If heads, discard an Energy from your opponent's Active Pokémon.";

/** 🛑 CONSTRUCTED, AND SAID OUT LOUD (D462's standing for its collision list). §2 measures
    that this anchor has NO printed near miss — every single-axis loosening of it still
    claims exactly one row — so its `^…$` discipline can only ever be driven synthetically.
    An assertion with no printing behind it is a deliberate choice; an undeclared one reads
    as an accident. */
const CONSTRUCTED_MISSES = [
  // the status slot holds something that is not a status word
  "Flip a coin. If heads, your opponent's Active Pokémon is now Tired, and discard an Energy from that Pokémon.",
  // no leading flip — the bare form, which no card prints
  "Your opponent's Active Pokémon is now Paralyzed, and discard an Energy from that Pokémon.",
  // leading text before the flip: the `^` is what refuses it
  "This attack does nothing. Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed, and discard an Energy from that Pokémon.",
  // the printed ", and" replaced by a bare " and " — the comma is load-bearing
  "Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed and discard an Energy from that Pokémon.",
  // the anaphor changed to a body this op cannot mean
  "Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed, and discard an Energy from this Pokémon.",
] as const;

/** The three real printings `DEFENDER_NOW`'s `\.$` measurably refuses — corpus FILE LINES
    685, 686 and 690, one printing each. They carry this family's attribution control now
    that FILE LINE 264 derives, in this suite and in the two it was re-pointed out of. */
const STILL_LOUD = [
  "Your opponent's Active Pokémon is now Confused. Put 8 damage counters instead of 3 on that Pokémon for this Special Condition.",
  "Your opponent's Active Pokémon is now Confused. You may move any number of damage counters from your opponent's Pokémon to their other Pokémon in any way you like.",
  "Your opponent's Active Pokémon is now Poisoned. During your opponent's next turn, Energy cards can't be attached from your opponent's hand to that Pokémon.",
] as const;

/** 🛑 THE SEVENTH CONSTRUCTED STRING, AND IT IS HELD SEPARATELY BECAUSE THE ANSWER IS
    DIFFERENT — a finding this slice did not expect. `deriveAttackEffect` refuses it (the
    anchor's `$`), and `resolvedByAnyReader` is false, and it is STILL NOT LOUD: D409's
    trailing splitter now sees a claimed HEAD (this slice's sentence) and a claimed TAIL
    (*"Draw a card."*) and composes the two.

    **BUILDING A SENTENCE BUILDS EVERY `<it>. <claimed tail>` COMPOUND WITH IT**, through a
    path that is not this anchor and not this arm. That is D409's splitter working as
    designed, but it means the `$` cannot be demonstrated by a trailing-text near miss the
    way the `^` can be demonstrated by a leading-text one — the two ends of the same anchor
    have different observable consequences, and only one of them ends at the loud path. */
const COMPOSED_BY_THE_SPLITTER =
  "Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed, and discard an Energy from that Pokémon. Draw a card.";

const W = "(?:Asleep|Burned|Confused|Paralyzed|Poisoned)";
const SEEDS = 400;

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}
const types = (events: GameEvent[]) => events.map((e) => e.type);
const units = (rows: readonly (readonly [number, string])[]) => rows.reduce((s, [n]) => s + n, 0);
const hit = (re: RegExp) => legalAttackCorpus().filter(([, s]) => re.test(s));

/** `fix-oxford` Active for `by`, `fix-titan` Active for the other seat, benches cleared on
    both sides so no stray body can absorb anything. `mixed` decides whether the defender's
    Energy is DISTINGUISHABLE, which is what decides whether the discard parks. */
function board(seed: number, mixed: boolean, by: Seat = "p1"): GameState {
  const opener: Seat = by === "p1" ? "p2" : "p1";
  let state = must(
    applyAction(
      driveSetup(
        seed,
        { p1: FLIP_STATUS_ENERGY_DISCARD_DECK, p2: FLIP_STATUS_ENERGY_DISCARD_DECK },
        { first: opener },
      ),
      { type: "endTurn", seat: opener },
    ),
  );
  state = setActiveFromDeck(state, by, "fix-oxford");
  state = clearBench(state, by);
  state = attachFromDeck(state, by, "fix-energy", 2);
  state = setActiveFromDeck(state, opener, "fix-titan");
  state = clearBench(state, opener);
  state = attachFromDeck(state, opener, "fix-energy", mixed ? 1 : 3);
  if (mixed) state = attachFromDeck(state, opener, "fix-water-energy", 1);
  return state;
}
function swing(state: GameState, index = 2, seat: Seat = "p1") {
  return mustApply(state, { type: "attack", seat, index });
}
function flipOf(events: GameEvent[]): "heads" | "tails" {
  const flip = find(events, "ATTACK_EFFECT_COIN_FLIP");
  if (flip === undefined) throw new Error("no coin flip");
  return flip.result;
}
/** The first seed whose ONE flip lands the wanted face — the family's own idiom, so the
    faces are reached by seeding the board rather than by stubbing the RNG. */
function firstSeed(face: "heads" | "tails", mixed: boolean): number {
  for (let seed = 0; seed < SEEDS; seed++) {
    if (flipOf(swing(board(seed, mixed)).events) === face) return seed;
  }
  throw new Error(`no seed below ${SEEDS} lands ${face}`);
}
function discardPrompt(state: GameState) {
  if (state.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
  if (state.phase.prompt.kind !== "discardEnergy") throw new Error("expected discardEnergy");
  return state.phase.prompt;
}
const activeEnergy = (state: GameState, seat: Seat) => [...(state.players[seat].active?.energy ?? [])];
/** Re-text ONE attack on a board's OWN `cardPool` copy. ⚠️ NOT a fixture edit —
    `FIXTURE_POOL` is shared by every suite in this package and D412 reddened three boards by
    widening a shared fixture. */
function withEffect(state: GameState, effect: string, index = 0): GameState {
  const card = state.cardPool["fix-oxford"];
  const printed = card?.attacks ?? null;
  if (card === undefined || printed === null) throw new Error("fix-oxford has no attacks");
  const attacks = printed.map((a, i) => (i === index ? { ...a, effect } : a));
  return { ...state, cardPool: { ...state.cardPool, "fix-oxford": { ...card, attacks } } };
}

// ─────────────────────────────────────────────────────────────────────────────
// §1 — the printed data, transcribed rather than recognised.
// ─────────────────────────────────────────────────────────────────────────────

describe("§1 — the printed data, transcribed rather than recognised", () => {
  it("🛑 the sentence is the CORPUS's bytes at TWO printings, apostrophe ASCII U+0027", () => {
    // D183's rule: author and assert against the printed bytes, never a paraphrase.
    const rows = new Map(legalAttackCorpus().map(([n, text]) => [text, n]));
    expect(rows.get(PRINTED)).toBe(2);
    expect(rows.get(BARE_FLIP_STATUS)).toBe(27);
    expect(rows.get(BARE_FLIP_DISCARD)).toBe(12);
    // ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP DISAGREE, 1 vs 2** — one file line, two
    // legal printings. D463's agreed at 2 and 2, which is the same trap from the other side.
    for (const s of [PRINTED, BARE_FLIP_STATUS, BARE_FLIP_DISCARD]) {
      expect(s.includes("opponent's")).toBe(true);
      expect(s.includes("opponent’s")).toBe(false);
      expect(s.includes("Pokémon")).toBe(true);
    }
    // …and the three still-loud rows are corpus bytes too, at one printing each.
    for (const s of STILL_LOUD) expect(rows.get(s)).toBe(1);
  });

  it("the fixture carries the corpus string at the index the suite drives — and it is NOT new", () => {
    // ⚠️ SYNTHETIC BY NECESSITY AND SAID SO (D425). ⚠️ AND THE ID IS D462's: `fix-oxford`
    // index 2 has printed this sentence since D462 put it there as a LOUD control, so this
    // slice adds no `FIXTURE_POOL` id and moves none of D460's four fixture census sites.
    expect(FIXTURE_POOL["fix-oxford"]?.attacks?.[2]).toEqual({
      cost: ["Colorless"],
      name: "Comma Bloom",
      effect: PRINTED,
      damage: 10,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — the derivation, the JOIN it is, and the POPULATION behind both.
// ─────────────────────────────────────────────────────────────────────────────

describe("§2 — the derivation, and the population it was measured on", () => {
  it("derives to ONE coinFlipGate holding applyStatus THEN discardEnergy, in printed order", () => {
    expect(deriveAttackEffect(PRINTED)).toEqual([
      {
        op: "coinFlipGate",
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: [
          { op: "applyStatus", target: "defender", status: "paralyzed" },
          { op: "discardEnergy", from: "opponentActive", filter: { kind: "anyEnergy" } },
        ],
      },
    ]);
  });

  it("🛑 the program is the two shipped arms' `then` lists CONCATENATED — asserted, not described", () => {
    // The zero-new-mechanism claim as an EQUALITY rather than as an inventory (D452's rule
    // for the record-version argument, applied one layer down). If either sibling arm's
    // program moves, this rung reddens and the version argument in §7 is owed a re-read.
    const gate = (ops: unknown) => (ops as { then: unknown[] }[])[0]?.then ?? [];
    expect(gate(deriveAttackEffect(PRINTED))).toEqual([
      ...gate(deriveAttackEffect(BARE_FLIP_STATUS)),
      ...gate(deriveAttackEffect(BARE_FLIP_DISCARD)),
    ]);
  });

  it("🛑 the U+2019 fold — the typographic apostrophe derives to the SAME program", () => {
    // D136/D137's hardening, driven rather than assumed. The catalog prints BOTH `'` and
    // `’`, so an anchor spelling only one silently un-derives every printing of the sentence
    // the day a punctuation-normalising re-ingest runs — and it fails SILENTLY, because the
    // sentence simply stops resolving and falls to the loud skip path.
    // ⚠️ **THIS RUNG EXISTS BECAUSE THE MUTANT SURVIVED WITHOUT IT.**
    // `D464-anchor-loses-its-apostrophe-class` was a GAP on its first probe: the suite drove
    // the ASCII spelling everywhere and the typographic one nowhere, and
    // `clauseApostrophe.test.ts` counts derivable rows without driving THIS one's fold.
    const curly = PRINTED.replace("opponent's", "opponent’s");
    expect(curly).not.toBe(PRINTED);
    expect(deriveAttackEffect(curly)).toEqual(deriveAttackEffect(PRINTED));
    expect(resolvedByAnyReader(curly)).toBe(true);
    // …and the corpus really does print the ASCII form, so the fold is the DEFENSIVE
    // direction rather than the one in use today.
    const rows = new Set(legalAttackCorpus().map(([, s]) => s));
    expect(rows.has(PRINTED)).toBe(true);
    expect(rows.has(curly)).toBe(false);
  });

  it("the status slot is a TEMPLATE, and all five words reach it", () => {
    // ⚠️ D121 prices a NEW parameter and this anchor adds none — `STATUS_WORDS` is this
    // family's own vocabulary at a fifth position. ⚠️ AND THE WARRANT IS WEAKER THAN D462's,
    // said out loud: an Oxford list can COLLIDE on `SpecialConditions`, so opening its slots
    // kept `defenderStatusOps`' refusal reachable; ONE status word collides with nothing, so
    // there is no refusal here for the slot to keep alive. The template rests on "no new
    // parameter" alone.
    for (const [word, status] of [
      ["Asleep", "asleep"],
      ["Burned", "burned"],
      ["Confused", "confused"],
      ["Paralyzed", "paralyzed"],
      ["Poisoned", "poisoned"],
    ] as const) {
      expect(deriveAttackEffect(PRINTED.replace("Paralyzed", word))).toEqual([
        {
          op: "coinFlipGate",
          // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
          then: [
            { op: "applyStatus", target: "defender", status },
            { op: "discardEnergy", from: "opponentActive", filter: { kind: "anyEnergy" } },
          ],
        },
      ]);
    }
  });

  it("🛑 ZERO false positives over the WHOLE 640-sentence column — one row, two printings", () => {
    // ⚠️ THE SWEEP IS OVER THE POPULATION, not over the rows this slice went looking for
    // (D423). An anchor that had drifted into a floating match shows up here and nowhere else.
    const hits = legalAttackCorpus().filter(([, s]) => {
      const ops = deriveAttackEffect(s);
      const then = ops?.[0]?.op === "coinFlipGate" ? ops[0].then : [];
      return (
        ops?.length === 1 &&
        then.length === 2 &&
        then[0]?.op === "applyStatus" &&
        then[1]?.op === "discardEnergy"
      );
    });
    expect(hits.map(([, s]) => s)).toEqual([PRINTED]);
    expect(units(hits)).toBe(2);
  });

  it("🛑 this anchor has NO printed near miss — every single-axis loosening still claims ONE row", () => {
    // **AN EMPTY RESULT IS A FINDING** (D462), and it is what licenses §3's synthetic
    // refusals: there is no printing to drive them with.
    const base = `Flip a coin\\. If heads, your opponent['’]s Active Pokémon is now`;
    const strict = new RegExp(`^${base} (${W}), and discard an Energy from that Pokémon\\.$`);
    for (const re of [
      strict,
      new RegExp(`${base} (${W}), and discard an Energy from that Pokémon\\.$`), // no `^`
      new RegExp(`^${base} (${W}), and discard an Energy from that Pokémon`), // no `\.$`
      new RegExp(`^${base} (.+), and discard an Energy from that Pokémon\\.$`), // open slot
      new RegExp(`^${base} (${W}), and (.+)\\.$`), // open consequent
    ]) {
      expect(hit(re).map(([, s]) => s)).toEqual([PRINTED]);
      expect(units(hit(re))).toBe(2);
    }
    // ⚠️ THE ONE LOOSENING THAT DOES OVER-CLAIM IS A TWO-AXIS ONE, and it is
    // `FLIP_DEFENDER_NOW`'s failure seen from this side of the family, not this anchor's.
    const twoAxis = new RegExp(`^${base} (${W})(.*)\\.$`);
    expect([hit(twoAxis).length, units(hit(twoAxis))]).toEqual([6, 35]);
  });

  it("🛑 D462's stated reason for leaving this row LOUD was wrong, and this is the regex", () => {
    // 🛑 *"It is refused by the SECOND capture group and by nothing else."* MEASURED over
    // the population: the triple anchor claims ONE row under every loosening it has, and
    // this sentence is in none of them — it demands a SECOND comma this row never prints.
    const OXFORD = "Your opponent's Active Pokémon is now Burned, Confused, and Poisoned.";
    for (const re of [
      new RegExp(`^Your opponent['’]s Active Pokémon is now (${W}), (${W}), and (${W})\\.$`),
      new RegExp(`^Your opponent['’]s Active Pokémon is now (${W}), (.+), and (${W})\\.$`),
      new RegExp(`^Your opponent['’]s Active Pokémon is now (${W}), (${W}), and (.+)\\.$`),
      new RegExp(`Your opponent['’]s Active Pokémon is now (${W}), (${W}), and (${W})\\.$`),
    ]) {
      expect(hit(re).map(([, s]) => s)).toEqual([OXFORD]);
      expect(re.test(PRINTED)).toBe(false);
    }
    // The pair anchor is wrong in the same place: loosening it reaches line 263, not this row.
    const HEADS_TAILS =
      "Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed and Poisoned. If tails, your opponent's Active Pokémon is now Confused.";
    const pairLoose = new RegExp(
      `^Flip a coin\\. If heads, your opponent['’]s Active Pokémon is now (${W}) and (.+)\\.$`,
    );
    expect(pairLoose.test(PRINTED)).toBe(false);
    expect(pairLoose.test(HEADS_TAILS)).toBe(true);
    // The HALF THAT WAS TRUE: `FLIP_DEFENDER_NOW`'s `\.$`, with the size of the drift.
    const flipStrict = new RegExp(
      `^Flip a coin\\. If heads, your opponent['’]s Active Pokémon is now (${W})\\.$`,
    );
    const flipDrift = new RegExp(
      `^Flip a coin\\. If heads, your opponent['’]s Active Pokémon is now (${W})`,
    );
    expect([hit(flipStrict).length, units(hit(flipStrict))]).toEqual([2, 29]);
    expect([hit(flipDrift).length, units(hit(flipDrift))]).toEqual([6, 35]);
    expect(flipStrict.test(PRINTED)).toBe(false);
    expect(flipDrift.test(PRINTED)).toBe(true);
  });

  it("the five older `is now` anchors are untouched — the six are disjoint", () => {
    // ORDER against arms 1, 2, 2b and 2c is a REFACTOR and not behaviour: every older anchor
    // demands a `.`, a ` and ` or a `, ` immediately after its LAST status word, and this one
    // demands `, and discard`.
    expect(deriveAttackEffect(BARE_FLIP_STATUS)).toEqual([
      {
        op: "coinFlipGate",
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: [{ op: "applyStatus", target: "defender", status: "paralyzed" }],
      },
    ]);
    expect(deriveAttackEffect("Your opponent's Active Pokémon is now Burned.")).toEqual([
      { op: "applyStatus", target: "defender", status: "burned" },
    ]);
    expect(
      deriveAttackEffect("Your opponent's Active Pokémon is now Burned, Confused, and Poisoned."),
    ).toHaveLength(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — the refusals, and they are CONSTRUCTED because nothing prints them.
// ─────────────────────────────────────────────────────────────────────────────

describe("§3 — the `^…$` discipline, driven synthetically", () => {
  it("🛑 five constructed near misses all stay on the loud path", () => {
    for (const text of CONSTRUCTED_MISSES) {
      expect(deriveAttackEffect(text), text).toBeNull();
      expect(resolvedByAnyReader(text), text).toBe(false);
    }
  });

  it("🛑 the `$` end behaves DIFFERENTLY from the `^` end, and the splitter is why", () => {
    // The anchor refuses a trailing clause exactly as it refuses a leading one…
    expect(deriveAttackEffect(COMPOSED_BY_THE_SPLITTER)).toBeNull();
    expect(resolvedByAnyReader(COMPOSED_BY_THE_SPLITTER)).toBe(false);
    // …but the sentence does not end up LOUD, because D409's trailing splitter composes a
    // claimed head with a claimed tail, and this slice just made the head claimable.
    expect(splitAttackTrailingClause(COMPOSED_BY_THE_SPLITTER)).toEqual({
      head: PRINTED,
      tail: "Draw a card.",
    });
    // The leading-text twin has no such path: nothing claims its head, so it stays loud.
    const leading = `This attack does nothing. ${PRINTED}`;
    expect(splitAttackTrailingClause(leading)).toBeNull();
    // And it is CONSTRUCTED — no card prints either shape.
    const rows = new Set(legalAttackCorpus().map(([, s]) => s));
    expect(rows.has(COMPOSED_BY_THE_SPLITTER)).toBe(false);
    expect(rows.has(leading)).toBe(false);
  });

  it("…and none of the five is a real printing — the synthetic standing, asserted", () => {
    // D452's rule: a byte pin on an INVENTED string is green by construction, so say which
    // strings are invented and prove they are. If one of these ever starts printing, this
    // rung reddens and the refusal above becomes a claim about a card.
    const rows = new Set(legalAttackCorpus().map(([, s]) => s));
    for (const text of CONSTRUCTED_MISSES) expect(rows.has(text)).toBe(false);
  });

  it("no splitter reaches the sentence either — the DERIVER is what answers", () => {
    expect(splitAttackTrailingClause(PRINTED)).toBeNull();
    expect(splitAttackGateClause(PRINTED)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — the board: both faces, and both of the discard's two code paths.
// ─────────────────────────────────────────────────────────────────────────────

describe("§4 — heads and tails, inline and parked", () => {
  it("TAILS lands neither consequent, and the turn ends", () => {
    const { state, events } = swing(board(firstSeed("tails", true), true));
    expect(flipOf(events)).toBe("tails");
    expect(types(events)).not.toContain("STATUS_APPLIED");
    expect(types(events)).not.toContain("ENERGY_DISCARDED");
    expect(types(events)).toContain("TURN_ENDED");
    expect(state.players.p2.active?.conditions).toEqual({
      rotation: "none",
      poisonDamage: 0,
      burned: false,
    });
    expect(activeEnergy(state, "p2")).toHaveLength(2);
    // …and the printed damage landed anyway: the gate is over the EFFECT, not the attack.
    expect(find(events, "DAMAGE_DEALT")).toBeDefined();
  });

  it("🛑 HEADS on a UNIFORM defender board resolves INLINE — no prompt, both consequents land", () => {
    // Three identical {C} collapse to ONE candidate, so `forcedDiscards` answers and the op
    // never parks. This is the path a reader that only ever tested the mixed board misses.
    const { state, events } = swing(board(firstSeed("heads", false), false));
    expect(flipOf(events)).toBe("heads");
    expect(types(events)).toEqual([
      "ATTACK_DECLARED",
      "DAMAGE_DEALT",
      "ATTACK_EFFECT_COIN_FLIP",
      "STATUS_APPLIED",
      "ENERGY_DISCARDED",
      "TURN_ENDED",
      "TURN_STARTED",
      "CARDS_DRAWN",
    ]);
    expect(state.players.p2.active?.conditions.rotation).toBe("paralyzed");
    expect(activeEnergy(state, "p2")).toHaveLength(2);
  });

  it("🛑 HEADS on a MIXED defender board PARKS — and the paralysis is already on the board", () => {
    // The printed order, made observable: `applyStatus` runs to completion BEFORE the
    // discard asks anything, so the pending choice is taken against a board that is already
    // Paralyzed. A reading that ordered the two ops the other way would park FIRST.
    const parked = swing(board(firstSeed("heads", true), true));
    expect(flipOf(parked.events)).toBe("heads");
    expect(types(parked.events)).toEqual([
      "ATTACK_DECLARED",
      "DAMAGE_DEALT",
      "ATTACK_EFFECT_COIN_FLIP",
      "STATUS_APPLIED",
      "EFFECT_PENDING",
    ]);
    expect(parked.state.phase.kind).toBe("effect:choose");
    expect(parked.state.players.p2.active?.conditions.rotation).toBe("paralyzed");
    expect(activeEnergy(parked.state, "p2")).toHaveLength(2);

    const prompt = discardPrompt(parked.state);
    expect(prompt.scope).toEqual({ kind: "total", count: 1 });
    expect(prompt.discardable).toHaveLength(2);
    // ⚠️ THE CAPTION IS THE SIBLING ARM's, unchanged — this slice adds no prompt and no note.
    expect(prompt.note).toBe("Discard an Energy from your opponent's Active Pokémon.");
    // 🛑 `rest` IS EMPTY BY POSITION: the discard is the LAST op of the only program this
    // reader returns, so nothing is queued behind it. That is the fact §7's version argument
    // leans on, asserted here rather than assumed there.
    if (parked.state.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(parked.state.phase.cont.rest).toEqual([]);

    const pick = prompt.discardable[0]?.uid as string;
    const done = mustApply(parked.state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardEnergy", uids: [pick] },
    });
    expect(done.state.phase.kind).not.toBe("effect:choose");
    expect(types(done.events)).toContain("ENERGY_DISCARDED");
    expect(types(done.events)).toContain("TURN_ENDED");
    expect(activeEnergy(done.state, "p2")).toHaveLength(1);
    expect(activeEnergy(done.state, "p2")).not.toContain(pick);
    // …and the paralysis survived the resume, which is the half a log could not show.
    expect(done.state.players.p2.active?.conditions.rotation).toBe("paralyzed");
    // The ATTACKER's own body took neither consequent.
    expect(done.state.players.p1.active?.conditions).toEqual({
      rotation: "none",
      poisonDamage: 0,
      burned: false,
    });
    expect(activeEnergy(done.state, "p1")).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — the loud path, with its attribution control.
// ─────────────────────────────────────────────────────────────────────────────

describe("§5 — the printed text stops being flagged, and the loud path still works", () => {
  it("the printed index reports no skipped effect any more, on either face", () => {
    for (const face of ["heads", "tails"] as const) {
      expect(
        find(swing(board(firstSeed(face, true), true)).events, "ATTACK_EFFECT_SKIPPED"),
      ).toBeUndefined();
    }
  });

  it("🛑 three REAL printings are still flagged — the attribution control (D214)", () => {
    // Without this, "no skip marker" could be true because the marker stopped being emitted
    // at all. These are corpus FILE LINES 685, 686 and 690 — the set `DEFENDER_NOW`'s `\.$`
    // measurably refuses, which is what D462's control was believed to be and was not.
    const b = board(firstSeed("heads", true), true);
    for (const text of STILL_LOUD) {
      const doctored = withEffect(b, text);
      expect(find(swing(doctored, 0).events, "ATTACK_EFFECT_SKIPPED")?.effect).toBe(text);
    }
  });

  it("…and the five CONSTRUCTED near misses are announced too — the refusal is loud", () => {
    const b = board(firstSeed("heads", true), true);
    for (const text of CONSTRUCTED_MISSES) {
      const doctored = withEffect(b, text);
      expect(find(swing(doctored, 0).events, "ATTACK_EFFECT_SKIPPED")?.effect).toBe(text);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — the census moves in exactly ONE summand, and the step is 1 and 2.
// ─────────────────────────────────────────────────────────────────────────────

describe("§6 — the census moves in exactly ONE summand", () => {
  it("🛑 the resolving corpus gains ONE sentence and TWO printings", () => {
    const rows = legalAttackCorpus();
    const resolved = rows.filter(([, s]) => resolvedByAnyReader(s));
    expect([resolved.length, units(resolved)]).toEqual([516, 1545]);  // (🆕🆕🆕 D483 +2 sentences / +2 printings — THE PRINTED CANDIDATE **CLASS** ON THE BENCHED SNIPE, `censusAttackCorpus.ts` FILE LINES **111** and **615**, **2 sentences / 2 legal printings**, both claimed WHOLE by `deriveAttackEffect` (arms 9b-bis and 6c) through ONE new group on the SHARED fragment `ALSO_BENCHED_SNIPE_BODY` and ONE new OPTIONAL op field `damageChosen.filter?: CardFilter`. RAW summand ALONE; reader surface still 13. ⚠️ SENTENCE STEP AND PRINTING STEP AGREE AT 2 AND 2, MEASURED at this head.) // (🆕🆕 D482 +1 sentence / +1 printing — THE WHOLE-SIDE SPREAD, `censusAttackCorpus.ts` FILE LINE **572**, *"This attack does 30 damage to each of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)"*, **1 sentence / 1 legal printing**, claimed WHOLE by `deriveAttackEffect` arm 6a-bis through ONE new anchor `SPREAD_EACH_OPPONENT_POKEMON` over a TWO-OP PROGRAM OF SHIPPED OPS (`damageDefender` flat + `spreadDamage { target: "opponentBench" }`) — **ZERO new op members, fields, values or `interpreter.ts` bytes**, reader surface still 13. RAW summand ALONE: no registry row, no gate split, no trailing split. ⚠️ SENTENCE STEP AND PRINTING STEP AGREE AT 1 AND 1.)// (🆕🆕 D479 +1 sentence / +1 printing — THE ATTACK-SIDE HAND REFRESH, `censusAttackCorpus.ts` FILE LINE 486, *"Shuffle your hand into your deck. Then, draw {N} cards."*, 1 sentence / 1 legal printing, claimed WHOLE by `deriveAttackEffect` arm 44b through ONE new anchor `SHUFFLE_HAND_DRAW` over `handRefresh { who: "you", draw: { kind: "fixed", count } }` — Youngster `sv01-198`'s hand-authored trainer program at a second address, so ZERO new `EffectOp` members, op FIELDS, op VALUES, readers (surface still 13), prompts, events, `interpreter.ts` or `redact.ts` bytes. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1, unlike D478's 1-vs-2 — derived here, not carried.) // (D478 +1 sentence / +2 printings — THE OTHER BRANCH OF A GATE THAT ALREADY SHIPS, `censusAttackCorpus.ts` FILE LINE 263, *"Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed and Poisoned. If tails, your opponent's Active Pokémon is now Confused."*, 1 sentence / 2 legal printings, claimed WHOLE by `deriveAttackEffect` arm 2b-bis through ONE new anchor `FLIP_DEFENDER_PAIR_OR_TAILS_STATUS` over a `coinFlipGate` with BOTH arms filled. `coinFlipGate.otherwise` shipped at D269 and arm 6d has emitted a two-armed gate since D416, so the mechanism the old refusal called absent was 209 decisions old. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP DISAGREE, 1 vs 2 — one file line, two legal printings; D476's and D475's agreed at 1 and 1, so this term was DERIVED here and not carried. RAW summand ALONE: no registry row, no gate split, no trailing split, reader surface still 13, ZERO new `FIXTURE_POOL` ids (file-local `cardPool`, D414), ZERO new `EffectOp` members, op FIELDS, op VALUES, prompts, events or `interpreter.ts` bytes.) // (🆕🆕 D476 +1 sentence / +1 printing — THE FACE AXIS, THE LAST OPEN AXIS OF THE PRINTED PER-FACE FAMILY — `censusAttackCorpus.ts` **FILE LINE 217**, *"Flip 3 coins. For each tails, discard an Energy from this Pokémon."*, **1 sentence / 1 legal printing**, claimed WHOLE by `deriveAttackCoinFlip` through ONE new anchor (`ATTACK_COIN_SELF_ENERGY_PER_TAILS`) and ONE **REQUIRED** `face: CoinFace` FIELD on the shipped `programPerHeads` member. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1** — D472's disagreed at 1 and 2, D473's agreed at 2 and 2, D474's disagreed at 1 and 2, D475's agreed at 1 and 1 — so this term was DERIVED at this head and not carried from the previous slice (D451/D461/D464). RAW summand ALONE: no registry row, no gate split, no trailing split, reader surface still 13, and **ZERO new `FIXTURE_POOL` ids** (file-local `cardPool`, D414), so every id ladder takes a ZERO term. ZERO new `EffectOp` members, op FIELDS, op VALUES, prompts, events, error codes or `AttackCoinFlip` MEMBERS — the op is `SELF_DISCARD_ONE`'s output byte for byte, and the FACE rides the member that already shipped.) // (🆕🆕 D475 +1 sentence / +1 printing — THE COIN FLIP COUNTED OVER BOTH ACTIVES — `censusAttackCorpus.ts` **FILE LINE 231**, *"Flip a coin for each Energy attached to both Active Pokémon. This attack does 60 damage for each heads."*, **1 sentence / 1 legal printing**, claimed WHOLE by `deriveAttackCoinFlip` through ONE new anchor and a FIFTH, NULLARY `AttackFlipCount` member `bothActivesEnergy`. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1** — D472's disagreed at 1 and 2, D473's agreed at 2 and 2, D474's disagreed at 1 and 2, so this term was DERIVED at this head and not carried from the previous slice (D451/D461/D464). RAW summand ALONE: no registry row, no gate split, no trailing split, D464's compound route measured EMPTY, reader surface still 13, and **NO new `FIXTURE_POOL` id** — the printed sentence has sat on `fix-bothactives` index 2 as a refusal witness since D196, so every id ladder takes a ZERO term.) // 🆕🆕 D474 +1 sentence / +2 printings (THE BOARD-COUNTED COIN FLIP OVER BODIES — `censusAttackCorpus.ts` **FILE LINE 233**, *"Flip a coin for each {D} Pokémon you have in play. This attack does 60 damage for each heads."*, **1 sentence / 2 legal printings**, claimed WHOLE by `deriveAttackCoinFlip` through ONE new anchor and ONE new `AttackFlipCount` member `pokemonInPlay`. ⚠️ **THIS IS A LIVE HEAD, NOT A FROZEN TAIL** (D461/D462): the literal moves and there is no front term to add. ⚠️ **AND THE TWO UNITS DISAGREE, 1 AND 2** — the opposite of D473's 2-and-2 — so the number here was read off THIS assertion's head rather than copied from a sibling site. RAW summand ALONE: no registry row, no gate split, no trailing split, D464's compound route measured EMPTY, reader surface still 13.) // 🆕🆕 D470 +1 sentence / +1 printing (THE BOARD-WIDE OWN-SIDE ENERGY COUNT, NARROWED BY A PRINTED SUBGROUP NOUN — `censusAttackCorpus.ts` **FILE LINE 558**, *"This attack does 20 more damage for each {L} Energy attached to all of your Iono's Pokémon."*, **1 legal printing**, claimed WHOLE by `deriveAttackDamageBonus` through the new `SELF_ENERGY_FILTERED_SCALE` anchor. ONE anchor, ONE reader arm, ONE **OPTIONAL FIELD ON THE SHIPPED** `energyOnSelf` member (`filter?: CardFilter`), ONE evaluator branch and ONE **OPTIONAL PARAMETER ON THE SHARED** `countEnergyInPlay` — whose THREE call sites (`energyOnOpponent`'s board arm, `energyOnSelf`'s, and `interpreter.ts`'s `yourEnergyInPlayAtLeast`, the third of which is NOT an op) are byte-identical, because `undefined` is every body. D454's blast radius, ENUMERATED before a byte was written. DISJOINT FROM `SELF_ENERGY_SCALE` BY STRUCTURE and not by the lookahead, which D467/D468 require saying: both are `^…$` and this one demands a run of bytes ending in a SPACE that the shipped literal cannot spend; the `(?!opponent)` lookahead is a DIFFERENT guard doing a DIFFERENT job (it refuses a SEAT, not a subgroup) and it IS killable. RAW summand ALONE: no registry row, no gate split and no trailing split is involved, and the reader surface stands still at 13. ZERO new `EffectOp` members, op fields, op values, prompts, events, error codes, registry rows, `CardFilter` MEMBERS, `packages/schema` bytes or `redact.ts` bytes; ZERO new `FIXTURE_POOL` ids (file-local `cardPool`, D414). **`MATCH_RECORD_VERSION` STAYS 29** — an `AttackDamageBonus` is a parse-time LOCAL inside `attack()`, and `CardFilter` IS persisted but gains no MEMBER here (`ownerPokemon` has been an inhabitant since D242), driven over the SERIALIZED BYTES in `ownerBoardEnergyScaling.test.ts` §8.)
    // 🆕🆕 D469 +1 sentence / +1 printing (THE OPPONENT'S WHOLE BOARD OF DAMAGE COUNTERS — `censusAttackCorpus.ts` **FILE LINE 534**, *"This attack does 10 more damage for each damage counter on all of your opponent's Pokémon."*, **1 legal printing**, claimed WHOLE by `deriveAttackDamageBonus` through the new `OPPONENT_BOARD_COUNTER_SCALE` anchor. ONE anchor, ONE reader arm, ONE NULLARY `DamageCountSource` member (`damageCountersOnOpponentBoard`), ONE evaluator arm and ONE shared board counter (`countDamageCountersInPlay`, continuous.ts, beside `countEnergyInPlay`/`countToolsInPlay`) — D406's cost table verbatim, at a second address. DISJOINT FROM `OPPONENT_COUNTER_SCALE` BY STRUCTURE and not by a lookahead, which D467/D468 require saying: both are `^…$` and disagree on a mandatory run of bytes at the same position. RAW summand ALONE: no registry row, no gate split and no trailing split is involved, and the reader surface stands still at 13. ZERO new `EffectOp` members, op fields, op values, prompts, events, error codes, registry rows, `packages/schema` bytes or `redact.ts` bytes; ZERO new `FIXTURE_POOL` ids (file-local `cardPool`, D414). **`MATCH_RECORD_VERSION` STAYS 29** — an `AttackDamageBonus` is a parse-time LOCAL inside `attack()` and there is no carrier at all, driven over the SERIALIZED BYTES in `opponentBoardCounterScaling.test.ts` §8 rather than reasoned from the type's name (D427).) // 🆕🆕 D468 +1 sentence / +1 printing (THE TYPED SELF-SWITCH — `censusAttackCorpus.ts` **FILE LINE 499**, *"Switch this Pokémon with 1 of your Benched {L} Pokémon."*, **1 legal printing**. ⚠️ **A LIVE HEAD, NOT A CHAIN — SO THE LITERAL MOVES AND NOTHING IS ADDED AT THE FRONT** (D461's table: the tell is the left-hand side of the assertion). ⚠️ **AND THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 HERE**, which is the easy case and is not a shape that carries — D467's was 2 vs 3.) // 🆕🆕 D467 +2 sentences / +3 printings (THE ATTACKER'S OWN BENCH NARROWED BY A PRINTED NOUN, ON BOTH OF ITS COUNTING AXES — `censusAttackCorpus.ts` **file lines 544 and 622**, *"This attack does 20 damage for each damage counter on all of your Benched {F} Pokémon."* (2 legal, the `×` fold) and *"This attack does 80 more damage for each of your Benched Charjabug."* (1 legal, the `+` fold), **2 sentences / 3 legal printings**. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP DISAGREE, 2 vs 3** — two file lines carrying 2 and 1 printings, so MEASURE each site rather than copying one number into the other kind (D451/D461/D466). RAW summand ALONE: no registry row, no gate split, no trailing split, and the reader surface stands still at 13. TWO new anchors, ONE new OPTIONAL field on the shipped `damageCountersOnYourBench` member, ONE new `IN_PLAY_BODY_NOUNS` row and ZERO new `CardFilter` members — so `MATCH_RECORD_VERSION` STAYS 29 on the SERIALIZED-ALPHABET shape (D462) at ONE address, not two.)
    // 🆕🆕 D466 +2 sentences / +3 printings (THE PRINTED EVOLUTION-STAGE ORDINAL AS A BODY FILTER — `censusAttackCorpus.ts` **file lines 586 and 589**, *"This attack does 40 damage for each of your Stage 1 Pokémon in play."* (1 legal, the `×` fold) and *"This attack does 40 more damage for each Stage 2 Pokémon on your Bench."* (2 legal, the `+` fold), **2 sentences / 3 legal printings**, claimed by `deriveAttackDamageMultiplier` and `deriveAttackDamageBonus` respectively. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP DISAGREE, 2 vs 3** — two file lines carrying 1 and 2 printings, so a pass that copied one number into the other kind of site would be wrong at every site of the other kind (D451/D461); MEASURE each site. ONE new `CardFilter` member (`stagePokemon`, delegating to cards.ts `isStage1Pokemon`/`isStage2Pokemon`, which D387/D262 had already written for the `boardCondition` antecedents) and TWO new `IN_PLAY_BODY_NOUNS` rows — which is the WHOLE of file line 586, with **ZERO new anchors**, because D439's two shipped `in play` anchors already reached it and only the VOCABULARY refused. File line 589 costs ONE new anchor (`YOUR_BENCH_FILTERED_SCALE`) and ONE new OPTIONAL FIELD on the SHIPPED `yourBenchCount` member (`filter?: CardFilter`, D407's `energyOnSelf.zone` shape) — `undefined` is every body, so all ten shipped printings of that member emit a filter-less object byte for byte as before. RAW summand ALONE: no registry row, no gate split and no trailing split is involved, and the reader surface stands still at 13. ZERO new `EffectOp` members, op fields, op values, prompts, events, error codes, registry rows, `packages/schema` bytes or `redact.ts` bytes; ONE new FIXTURE id (`fix-stage2body`) and ONE new attack on `fix-inplaybodies`. **`MATCH_RECORD_VERSION` STAYS 29 AT TWO ADDRESSES** — `CardFilter` IS persisted (D446 measured it: nine `EffectOp` fields carry one and an op rides `state.phase.cont.pendingOp`) and a WIDENING is free; `DamageCountSource` is PARSE-TIME and is not at a persisted address at all. 🛑 **`OPAQUE` MOVES, 81/116 → 80/114, AND `PHRASE-2` EMPTIES, 1/1 → 0/0 — AND THE INSTRUMENT STOOD STILL THIS SLICE** (`residue-census.ts` is untouched by D466), so unlike D465 this class-table delta really is a statement about the WORK.) 🆕🆕 D465 +1 sentence / +1 printing (THE RECOIL THAT SCALES OFF ITS OWN COUNTERS — `censusAttackCorpus.ts` **file line 500**, *"This Pokémon also does 10 damage to itself for each damage counter on it."*, **1 sentence / 1 legal printing**, claimed WHOLE by `deriveAttackEffect` arm 14 through ONE new anchor (`SELF_DAMAGE_PER_COUNTER`) and ONE new OPTIONAL FIELD on the SHIPPED `damageSelf` op (`perDamageCounterOnSelf`), folded by `recoilAmount` in `interpreter.ts` — `snipeAmount`'s `(op, state, ctx)` shape, the third rider of that kind. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE, 1 AND 1** — the OPPOSITE of D464's 1-vs-2 one slice ago, so a pass that inferred either from the other would have been right here and wrong then: MEASURE each site. RAW summand ALONE: no registry row, no gate split and no trailing split is involved, and the reader surface stands still at 13. ZERO new `EffectOp` MEMBERS, `DamageCountSource` kinds (`damageCountersOnSelf` already ships and is deliberately NOT used — it is a PARSE-TIME type no `EffectOp` carries), prompts, events, error codes, registry rows, FIXTURE ids, `packages/schema` bytes or `redact.ts` bytes; **`MATCH_RECORD_VERSION` STAYS 29 on D461's REACHABILITY shape** — `damageSelf` never parks and the only producer of the rider returns a program of LENGTH ONE, so the field can never sit in `phase.cont.rest` behind an earlier park. 🛑 **`OPAQUE` DOES NOT MOVE — 81/116 BEFORE AND AFTER** — because D465 FIXED `residue-census.ts`'s span probe FIRST, which reclassified this row out of `OPAQUE` into `PHRASE-6` before anything was built. The class it left is `PHRASE-6`.) 
    // …and the step is attributable: remove THIS sentence and the pair falls by 1 and 2,
    // re-derived rather than remembered.
    const without = resolved.filter(([, s]) => s !== PRINTED);
    expect([without.length, units(without)]).toEqual([515, 1543]); // (🆕🆕🆕 D483 +2 sentences / +2 printings — THE PRINTED CANDIDATE **CLASS** ON THE BENCHED SNIPE, `censusAttackCorpus.ts` FILE LINES **111** and **615**, **2 sentences / 2 legal printings**, both claimed WHOLE by `deriveAttackEffect` (arms 9b-bis and 6c) through ONE new group on the SHARED fragment `ALSO_BENCHED_SNIPE_BODY` and ONE new OPTIONAL op field `damageChosen.filter?: CardFilter`. ⚠️ SENTENCE STEP AND PRINTING STEP AGREE AT 2 AND 2, MEASURED. ⚠️ FOUND ON A SECOND `check` ROUND, BEHIND A SITE IN THE SAME `it` THAT THREW FIRST — D462's rule: vitest stops an `it` at its first throw, so a spelling-keyed pass is always short and the ROUND COUNT is the measurement.) // (🆕🆕 D479 +1 sentence / +1 printing — THE ATTACK-SIDE HAND REFRESH, `censusAttackCorpus.ts` FILE LINE 486, *"Shuffle your hand into your deck. Then, draw {N} cards."*, claimed WHOLE by `deriveAttackEffect` arm 44b through ONE new anchor `SHUFFLE_HAND_DRAW` over `handRefresh { who: "you", draw: { kind: "fixed", count } }` — Youngster `sv01-198`'s hand-authored program at a second address. ZERO new op members/fields/values, reader surface still 13. ⚠️ SENTENCE STEP AND PRINTING STEP AGREE AT 1 AND 1.) // (D478 +1 sentence / +2 printings — THE OTHER BRANCH OF A GATE THAT ALREADY SHIPS, `censusAttackCorpus.ts` FILE LINE 263, *"Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed and Poisoned. If tails, your opponent's Active Pokémon is now Confused."*, 1 sentence / 2 legal printings, claimed WHOLE by `deriveAttackEffect` arm 2b-bis through ONE new anchor `FLIP_DEFENDER_PAIR_OR_TAILS_STATUS` over a `coinFlipGate` with BOTH arms filled. `coinFlipGate.otherwise` shipped at D269 and arm 6d has emitted a two-armed gate since D416, so the mechanism the old refusal called absent was 209 decisions old. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP DISAGREE, 1 vs 2 — one file line, two legal printings; D476's and D475's agreed at 1 and 1, so this term was DERIVED here and not carried. RAW summand ALONE: no registry row, no gate split, no trailing split, reader surface still 13, ZERO new `FIXTURE_POOL` ids (file-local `cardPool`, D414), ZERO new `EffectOp` members, op FIELDS, op VALUES, prompts, events or `interpreter.ts` bytes.) // (🆕🆕 D476 +1 sentence / +1 printing — THE FACE AXIS, THE LAST OPEN AXIS OF THE PRINTED PER-FACE FAMILY — `censusAttackCorpus.ts` **FILE LINE 217**, *"Flip 3 coins. For each tails, discard an Energy from this Pokémon."*, **1 sentence / 1 legal printing**, claimed WHOLE by `deriveAttackCoinFlip` through ONE new anchor (`ATTACK_COIN_SELF_ENERGY_PER_TAILS`) and ONE **REQUIRED** `face: CoinFace` FIELD on the shipped `programPerHeads` member. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1** — D472's disagreed at 1 and 2, D473's agreed at 2 and 2, D474's disagreed at 1 and 2, D475's agreed at 1 and 1 — so this term was DERIVED at this head and not carried from the previous slice (D451/D461/D464). RAW summand ALONE: no registry row, no gate split, no trailing split, reader surface still 13, and **ZERO new `FIXTURE_POOL` ids** (file-local `cardPool`, D414), so every id ladder takes a ZERO term. ZERO new `EffectOp` members, op FIELDS, op VALUES, prompts, events, error codes or `AttackCoinFlip` MEMBERS — the op is `SELF_DISCARD_ONE`'s output byte for byte, and the FACE rides the member that already shipped.) // (🆕🆕 D475 +1 sentence / +1 printing — THE COIN FLIP COUNTED OVER BOTH ACTIVES, `censusAttackCorpus.ts` **FILE LINE 231**, claimed WHOLE by `deriveAttackCoinFlip`. ⚠️ FOUND ON THE SECOND `check` ROUND, BEHIND A SITE IN THE SAME `it` THAT THREW FIRST — D462's rule: vitest stops an `it` at its first throw, so a spelling-keyed pass is always short and the round count is the measurement.) // 🆕🆕 D474 +1 sentence / +2 printings (THE BOARD-COUNTED COIN FLIP OVER BODIES — `censusAttackCorpus.ts` **FILE LINE 233**, **1 sentence / 2 legal printings**, claimed WHOLE by `deriveAttackCoinFlip`. ⚠️ **FOUND ON THE SECOND `check` ROUND, BEHIND A SITE THAT THREW FIRST** — D462's rule: vitest stops an `it` at its first throw, so a spelling-keyed pass is always short. The head name was read at THIS site rather than copied from the sibling above it.) // 🆕🆕 D470 +1 sentence / +1 printing (THE BOARD-WIDE OWN-SIDE ENERGY COUNT, NARROWED BY A PRINTED SUBGROUP NOUN — `censusAttackCorpus.ts` **FILE LINE 558**, *"This attack does 20 more damage for each {L} Energy attached to all of your Iono's Pokémon."*, **1 legal printing**, claimed WHOLE by `deriveAttackDamageBonus` through the new `SELF_ENERGY_FILTERED_SCALE` anchor — ONE anchor, ONE arm, ONE OPTIONAL field on the SHIPPED `energyOnSelf` member, ONE evaluator branch, ONE OPTIONAL parameter on the SHARED `countEnergyInPlay`. RAW summand ALONE; the reader surface stands still at 13.) // (🆕🆕🆕 D482 — the WHOLE-SIDE SPREAD raises the head by 1 sentence / 1 printing (`censusAttackCorpus.ts` FILE LINE 572, arm 6a-bis, `SPREAD_EACH_OPPONENT_POKEMON` over `damageDefender` + `spreadDamage`), so this DERIVED figure moves with it. This slice's own sentence is NOT in this file's subtracted set, which is why the figure steps by exactly the head's step.)
    // 🆕🆕 D469 +1 sentence / +1 printing (THE OPPONENT'S WHOLE BOARD OF DAMAGE COUNTERS — `censusAttackCorpus.ts` **FILE LINE 534**, *"This attack does 10 more damage for each damage counter on all of your opponent's Pokémon."*, **1 legal printing**, claimed WHOLE by `deriveAttackDamageBonus` through the new `OPPONENT_BOARD_COUNTER_SCALE` anchor. ONE anchor, ONE reader arm, ONE NULLARY `DamageCountSource` member (`damageCountersOnOpponentBoard`), ONE evaluator arm and ONE shared board counter (`countDamageCountersInPlay`, continuous.ts, beside `countEnergyInPlay`/`countToolsInPlay`) — D406's cost table verbatim, at a second address. DISJOINT FROM `OPPONENT_COUNTER_SCALE` BY STRUCTURE and not by a lookahead, which D467/D468 require saying: both are `^…$` and disagree on a mandatory run of bytes at the same position. RAW summand ALONE: no registry row, no gate split and no trailing split is involved, and the reader surface stands still at 13. ZERO new `EffectOp` members, op fields, op values, prompts, events, error codes, registry rows, `packages/schema` bytes or `redact.ts` bytes; ZERO new `FIXTURE_POOL` ids (file-local `cardPool`, D414). **`MATCH_RECORD_VERSION` STAYS 29** — an `AttackDamageBonus` is a parse-time LOCAL inside `attack()` and there is no carrier at all, driven over the SERIALIZED BYTES in `opponentBoardCounterScaling.test.ts` §8 rather than reasoned from the type's name (D427).) // 🆕🆕 D468 +1 sentence / +1 printing (THE TYPED SELF-SWITCH — `censusAttackCorpus.ts` **FILE LINE 499**, *"Switch this Pokémon with 1 of your Benched {L} Pokémon."*, **1 legal printing**. ⚠️ **A LIVE HEAD, NOT A CHAIN** — the literal moves and nothing is added at the front (D461). ⚠️ **THIS SITE WAS MASKED BEHIND ANOTHER IN THE SAME `it` AND ONLY SURFACED ON THE THIRD `check` ROUND** — vitest stops an `it` at its first throw, so the runner's list is never the population (D462/D465).) // 🆕🆕 D467 +2 sentences / +3 printings (THE ATTACKER'S OWN BENCH NARROWED BY A PRINTED NOUN, ON BOTH OF ITS COUNTING AXES — `censusAttackCorpus.ts` **file lines 544 and 622**, **2 sentences / 3 legal printings**, RAW summand ALONE. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP DISAGREE, 2 vs 3** — MEASURE each site (D451/D461/D466).)
    // 🆕🆕 D466 +2 sentences / +3 printings (THE PRINTED EVOLUTION-STAGE ORDINAL AS A BODY FILTER — `censusAttackCorpus.ts` **file lines 586 and 589**, *"This attack does 40 damage for each of your Stage 1 Pokémon in play."* (1 legal, the `×` fold) and *"This attack does 40 more damage for each Stage 2 Pokémon on your Bench."* (2 legal, the `+` fold), **2 sentences / 3 legal printings**, claimed by `deriveAttackDamageMultiplier` and `deriveAttackDamageBonus` respectively. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP DISAGREE, 2 vs 3** — two file lines carrying 1 and 2 printings, so a pass that copied one number into the other kind of site would be wrong at every site of the other kind (D451/D461); MEASURE each site. ONE new `CardFilter` member (`stagePokemon`, delegating to cards.ts `isStage1Pokemon`/`isStage2Pokemon`, which D387/D262 had already written for the `boardCondition` antecedents) and TWO new `IN_PLAY_BODY_NOUNS` rows — which is the WHOLE of file line 586, with **ZERO new anchors**, because D439's two shipped `in play` anchors already reached it and only the VOCABULARY refused. File line 589 costs ONE new anchor (`YOUR_BENCH_FILTERED_SCALE`) and ONE new OPTIONAL FIELD on the SHIPPED `yourBenchCount` member (`filter?: CardFilter`, D407's `energyOnSelf.zone` shape) — `undefined` is every body, so all ten shipped printings of that member emit a filter-less object byte for byte as before. RAW summand ALONE: no registry row, no gate split and no trailing split is involved, and the reader surface stands still at 13. ZERO new `EffectOp` members, op fields, op values, prompts, events, error codes, registry rows, `packages/schema` bytes or `redact.ts` bytes; ONE new FIXTURE id (`fix-stage2body`) and ONE new attack on `fix-inplaybodies`. **`MATCH_RECORD_VERSION` STAYS 29 AT TWO ADDRESSES** — `CardFilter` IS persisted (D446 measured it: nine `EffectOp` fields carry one and an op rides `state.phase.cont.pendingOp`) and a WIDENING is free; `DamageCountSource` is PARSE-TIME and is not at a persisted address at all. 🛑 **`OPAQUE` MOVES, 81/116 → 80/114, AND `PHRASE-2` EMPTIES, 1/1 → 0/0 — AND THE INSTRUMENT STOOD STILL THIS SLICE** (`residue-census.ts` is untouched by D466), so unlike D465 this class-table delta really is a statement about the WORK.) 🆕🆕 D465 +1 sentence / +1 printing (THE RECOIL THAT SCALES OFF ITS OWN COUNTERS — `censusAttackCorpus.ts` **file line 500**, *"This Pokémon also does 10 damage to itself for each damage counter on it."*, **1 sentence / 1 legal printing**, claimed WHOLE by `deriveAttackEffect` arm 14 through ONE new anchor (`SELF_DAMAGE_PER_COUNTER`) and ONE new OPTIONAL FIELD on the SHIPPED `damageSelf` op (`perDamageCounterOnSelf`), folded by `recoilAmount` in `interpreter.ts` — `snipeAmount`'s `(op, state, ctx)` shape, the third rider of that kind. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE, 1 AND 1** — the OPPOSITE of D464's 1-vs-2 one slice ago, so a pass that inferred either from the other would have been right here and wrong then: MEASURE each site. RAW summand ALONE: no registry row, no gate split and no trailing split is involved, and the reader surface stands still at 13. ZERO new `EffectOp` MEMBERS, `DamageCountSource` kinds (`damageCountersOnSelf` already ships and is deliberately NOT used — it is a PARSE-TIME type no `EffectOp` carries), prompts, events, error codes, registry rows, FIXTURE ids, `packages/schema` bytes or `redact.ts` bytes; **`MATCH_RECORD_VERSION` STAYS 29 on D461's REACHABILITY shape** — `damageSelf` never parks and the only producer of the rider returns a program of LENGTH ONE, so the field can never sit in `phase.cont.rest` behind an earlier park. 🛑 **`OPAQUE` DOES NOT MOVE — 81/116 BEFORE AND AFTER** — because D465 FIXED `residue-census.ts`'s span probe FIRST, which reclassified this row out of `OPAQUE` into `PHRASE-6` before anything was built. The class it left is `PHRASE-6`.) 
  });

  it("the READER SURFACE stands still at 13 — this is an ARM, not a reader", () => {
    expect(attackReaderSurface()).toHaveLength(13);
  });

  it("no registry row shadows the sentence — the deriver is what answers", () => {
    // The census counts a registry-authored sentence in a DIFFERENT summand, so a row here
    // would move the wrong one and `censusAtHead`'s `registryUnits` rung would redden.
    expect(resolvedByAnyReader(PRINTED)).toBe(true);
    expect(deriveAttackEffect(PRINTED)).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7 — purity, and the persisted bytes.
// ─────────────────────────────────────────────────────────────────────────────

describe("§7 — purity and the structural answers", () => {
  it("never mutates the board it is handed", () => {
    const frozen = deepFreeze(board(firstSeed("heads", true), true));
    const snapshot = JSON.stringify(frozen);
    expect(swing(frozen).state).not.toBe(frozen);
    expect(JSON.stringify(frozen)).toBe(snapshot);
  });

  it("replays identically for one seed and diverges across faces", () => {
    const seed = firstSeed("heads", true);
    const a = swing(board(seed, true));
    const b = swing(board(seed, true));
    expect(b.state).toEqual(a.state);
    expect(b.events).toEqual(a.events);
    expect(types(swing(board(firstSeed("tails", true), true)).events)).not.toContain(
      "STATUS_APPLIED",
    );
  });

  it("🛑 `MATCH_RECORD_VERSION` STAYS 29 — DRIVEN, in three directions including LOSS", () => {
    // ⚠️ `MATCH_RECORD_VERSION` is not exported from this package (it lives in
    // `apps/api/src/lobby/match.ts`), so the claim is DRIVEN the way D421–D424 and D461–D463
    // drove theirs. The bump trigger is a PERSISTED structure gaining, renaming or losing a
    // required field.
    //
    // 🛑 **THE ARGUMENT IS THE SERIALIZED ALPHABET — D462/D463's shape, and NOT D461's
    // REACHABILITY, because reachability is FALSE here.** `discardEnergy` parks on a genuine
    // choice, so `phase.cont` really is written and really is persisted; saying "this op can
    // never reach the continuation" would be the easy mistake. What is true is narrower:
    // every op, op FIELD and op VALUE in this program already ships, and both already ship
    // INSIDE THIS EXACT GATE on two sibling arms (arm 2 authors the `applyStatus`, the
    // `FLIP_OPPONENT_ACTIVE_DISCARD` arm authors the `discardEnergy`). **No byte a v29 record
    // can hold after this slice that it could not hold before it.** The ORDER of two ops
    // inside an array that already accepts both is not a byte in the alphabet, any more than
    // D463's COUNT of copies was.
    const parked = swing(board(firstSeed("heads", true), true)).state;
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const pick = discardPrompt(parked).discardable[0]?.uid as string;

    // DIRECTION 1 — FORWARD. Round-trip the PARKED board through JSON, which is what
    // persistence actually does to it, and resume from the bytes.
    const persisted = JSON.parse(JSON.stringify(parked)) as GameState;
    const live = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardEnergy", uids: [pick] },
    });
    const replayed = mustApply(persisted, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardEnergy", uids: [pick] },
    });
    expect(replayed.events).toEqual(live.events);
    expect(replayed.state).toEqual(live.state);

    // DIRECTION 2 — WIDENING / ABSENT. The continuation's key set as a LITERAL rather than
    // as a diff between two boards of one build: a diff is blind to a key that grew on both
    // (D279). The pending op is checked by its FULL JSON, so a new field would lengthen it,
    // and it is asserted EQUAL to the string the sibling arm's reader emits — the alphabet
    // argument as an equality rather than as an inventory.
    expect(Object.keys(parked.phase.cont).sort()).toEqual(["ctx", "pendingOp", "rest"]);
    const shipped = '{"op":"discardEnergy","from":"opponentActive","filter":{"kind":"anyEnergy"}}';
    expect(JSON.stringify(parked.phase.cont.pendingOp)).toBe(shipped);
    expect(parked.phase.cont.rest).toEqual([]);
    const sibling = deriveAttackEffect(BARE_FLIP_DISCARD)?.[0];
    expect(sibling?.op).toBe("coinFlipGate");
    expect(JSON.stringify(sibling?.op === "coinFlipGate" ? sibling.then[0] : null)).toBe(shipped);
    // …and the SpecialConditions block is the shipped three-key shape, not a widened one.
    expect(Object.keys(persisted.players.p2.active?.conditions ?? {}).sort()).toEqual([
      "burned",
      "poisonDamage",
      "rotation",
    ]);

    // DIRECTION 3 — LOSS. `rest` is empty here, so the subject that CAN be lost is the
    // half of the program that already ran: the paralysis. Clear it from the PERSISTED bytes
    // and resume. If the status lived only in the event log, the two resumes would agree —
    // and the printed sentence's first consequent would be a claim about a log rather than
    // about a board that survives a save.
    const lossy = JSON.parse(JSON.stringify(parked)) as GameState;
    const victim = lossy.players.p2.active;
    if (victim === undefined || victim === null) throw new Error("expected a defender");
    (victim as unknown as { conditions: { rotation: string } }).conditions.rotation = "none";
    const truncated = mustApply(lossy, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardEnergy", uids: [pick] },
    });
    expect(live.state.players.p2.active?.conditions.rotation).toBe("paralyzed");
    expect(truncated.state.players.p2.active?.conditions.rotation).toBe("none");
    // The discard is unaffected by the loss, which is what makes it a ONE-axis probe.
    expect(activeEnergy(truncated.state, "p2")).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §8 — the version pin.
// ─────────────────────────────────────────────────────────────────────────────

describe("§8 — the version", () => {
  it("engineVersion is 0.379.0 and the bump is owed for BEHAVIOUR", () => {
    // 🆕🆕 D464 — 0.362.0 → **0.363.0**. A printed sentence that derived to `null` now
    // derives to a program, on two legal printings: an OBSERVABLE change to what the engine
    // does with real catalog rows, which is the bump's whole trigger.
    expect(engineVersion).toBe("0.379.0");
  });
});
