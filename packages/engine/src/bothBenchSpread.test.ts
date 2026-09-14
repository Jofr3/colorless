import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import manifest from "../package.json" with { type: "json" };
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import { deriveAttackEffect, splitAttackGateClause, splitAttackTrailingClause } from "./effects";
import { applyAction, createGame, engineVersion } from "./index";
import type { EffectOp, GameEvent, GameState, Seat } from "./index";
import { runProgram } from "./interpreter";
import {
  FIXTURE_POOL,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  firstBasicInHand,
  must,
  mustApply,
  setActiveFromDeck,
  setBenchDamage,
} from "./testFixtures";

// 🆕🆕🆕 D507 — THE SPREAD THAT HITS **BOTH** BENCHES, AND THE OPTIONAL PRINTED CLAUSE
// THAT NARROWS IT TO THE ALREADY-DAMAGED BODIES.
//
//   "This attack also does 10 damage to each Benched Pokémon (both yours and your
//    opponent's). (Don't apply Weakness and Resistance for Benched Pokémon.)"   (1 legal)
//   "This attack also does 40 damage to each Benched Pokémon that has any damage
//    counters on it (both yours and your opponent's). (Don't apply …)"          (1 legal)
//
// `censusAttackCorpus.ts` **FILE LINES 515 and 526**, **2 sentences / 2 legal printings**
// over the committed `legal_standard = 1` attack column (640 sentences / 1,732
// printings). Both steps AGREE at 2 and 2 — each row is a 1-printing sentence — and that
// is MEASURED in §9 rather than inferred from the rows being singular (D451/D461/D465).
//
// ─────────────────────────────────────────────────────────────────────────────
// 🛑 **THE DESIGN QUESTION, ANSWERED EXPLICITLY RATHER THAN SILENTLY: `spreadDamage`
// GAINS NEITHER A THIRD `target` MEMBER NOR THE SIBLING'S `filter` + `side` SHAPE.**
//
// The printed *"(both yours and your opponent's)"* names TWO ZONES, and this engine has
// had one op per zone since D189/D425. **D482 answered the identical question one zone
// over** — *"the sentence is a two-op PROGRAM rather than a third `target` member"*,
// `damageDefender` + `spreadDamage` for *"each of your opponent's Pokémon"* — and here
// BOTH zones are the SAME op, so the both-sides half costs **ZERO** type bytes:
//
//     [ { op: "spreadDamage", target: "yourBench",     amount },
//       { op: "spreadDamage", target: "opponentBench", amount } ]
//
// 🛑 **AND THE RESTRUCTURE TOWARD `counterEachAll { filter, side }` IS REFUSED, PRICED
// AGAINST THE THREE REFUSALS IT WOULD HAVE TO OVERTURN.** `scale?: DamageCountSource` —
// replacing a printed distinction that shipped values already spell with a general
// vocabulary — was refused at D448 (measured: **24 sites across 10 files plus a
// `MATCH_RECORD_VERSION` bump**), at D449 and again at D465. A `filter` + `side` pair on
// this op is the same class of move, and it differs in exactly one way that points the
// SAME direction rather than the other: `counterEachAll` walks `board.active` as well as
// `board.bench`, so a `side` on this op invites a `filter` that reaches the ACTIVE — and
// index.ts 0.327.0's *"`spreadDamage` only ever touches `side.bench`, so it cannot move
// the actor off the Active Spot"* is leaned on in three files (continuous.ts's
// `installedReductionOf`, its `EffectContext` note, and D425's own-side argument). D425
// measured what breaking that costs: **five mechanisms across 94 sites in 34 files**.
// **Composition keeps the invariant intact and the vocabulary closed.**
//
// 🛑 **WHAT THE SECOND ROW GENUINELY COSTS IS ONE OPTIONAL BOOLEAN RIDER, AND IT IS
// D505's IDIOM ON THE SAME OP ONE RIDER LATER.** *"that has any damage counters on it"*
// is `counterEachAll.damagedOnly` (D450, itself D437's rider reused verbatim) — the same
// eight printed words, the same board fact, and literally the same predicate function
// `hasAnyDamageCounters`. So the whole engine diff is: ONE anchor, ONE arm, ONE optional
// rider, ONE parameter on one interpreter helper and ONE per-body `continue`.
//
// ⚠️ **WHAT THIS SLICE DOES NOT MOVE, NAMED AS ZEROES SO THE CLAIM IS CHECKABLE (§9):**
// **ZERO** new `EffectOp` KINDS or MEMBERS, `EffectSlot` members,
// `CardFilter`/`DamageCountSource`/`BoardCondition` members, readers (the surface stands
// still at **13**), prompts, choice kinds, parks, deciders, events, error codes,
// `GameState`/`InPlayPokemon` fields, registry rows, `FIXTURE_POOL` ids (file-local
// `cardPool`, D414/D452), `log.ts` bytes, `redact.ts` bytes, `packages/schema` bytes and
// **`MATCH_RECORD_VERSION` bytes**.
//
// ─────────────────────────────────────────────────────────────────────────────
// 🛑 **THE LATTICE — AN EIGHTH SHAPE: A CONJUNCTIVE PAIR OF BLOCKING AXES × A FREE 2³.**
//
// Five axes counted FROM the FILE-LINE-526 print, each substituted onto its nearest BUILT
// spelling, all 2⁵ = 32 points, evaluated TWICE — over the thirteen readers alone, and
// over the four-arm residue predicate (readers + registry + both splitters, D444/D503):
//
//   READERS-ONLY        0/1 · 0/5 · 1/10 · 3/10 · 3/5 · 1/1
//   SPLITTER-INCLUSIVE  0/1 · 0/5 · 1/10 · 3/10 · 3/5 · 1/1
//
// **They AGREE at every weight, 0 divergent points of 32**, and structurally as well:
// both splitters return `null` at **32 of 32** points. D503's method rule is therefore
// SATISFIED rather than merely applied, and D505's refinement says why it was cheap to
// check: neither print has a leading `If …,` clause, and the only second depth-0 segment
// is the `(Don't apply …)` parenthetical, which belongs to the spread anchor rather than
// being a second claimable sentence.
//
// 🛑 **THE FACTORISATION, AND IT IS NOT D505's.** D505's lattice had ONE blocking axis
// flipping the verdict at 16/16 cells and four inert ones at 0/16. **Here TWO axes flip
// at 8 of 16 cells each and the other three at 0 of 16** — the signature of a
// CONJUNCTION rather than a single blocker: a pre-slice point builds iff the SCOPE is
// substituted to `of your` AND the damage-counter clause is deleted, so neither
// substitution alone reaches a built string and each flips the verdict only on the half
// of its cells where the other is already substituted. Eight of the 32 points build.
// That is an eighth shape on record, distinct from the seven before it: full-weight-only
// (D489/D490/D494/D501), every-segment (D495), prerequisite-half (D499), single-axis 2¹
// (D500), empty-at-every-weight (D502), D503's opposite-conclusions and D505's one
// blocking axis × a free 2⁴.
// ⚠️ **The three inert axes are INERT ON THE VERDICT, NOT DEGENERATE in D491's identity
// sense** — all 32 points are DISTINCT strings, which §3 asserts (D505's correction).

/** File line 515, byte for byte. §1 asserts it is a ROW OF THE COMMITTED CORPUS and
    reads its printing count off that corpus rather than typing it (D452/D490). */
const PRINTED_BOTH =
  "This attack also does 10 damage to each Benched Pokémon (both yours and your opponent's). (Don't apply Weakness and Resistance for Benched Pokémon.)";
/** File line 526 — the same reading NARROWED by the printed board predicate. */
const PRINTED_DAMAGED =
  "This attack also does 40 damage to each Benched Pokémon that has any damage counters on it (both yours and your opponent's). (Don't apply Weakness and Resistance for Benched Pokémon.)";
/** The built ONE-SIDED siblings (D189/D425), both printed corpus rows. **The controls
    every rung here leans on**: without them, "the two-op program is read" is green under
    a build that emits two ops for every spread. */
const FLAT_OPP =
  "This attack also does 10 damage to each of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";
const FLAT_OWN =
  "This attack also does 10 damage to each of your Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";
/** The both-sides reading at a SECOND amount, fielded as a synthetic probe — D505's
    `SCALED_40` move verbatim, and the only thing that pins the arm reads the CAPTURED
    number rather than a hard-coded one (D121's template warrant on a population of one).
    ⚠️ NOT a corpus row, and §1 says so. */
const BOTH_40 =
  "This attack also does 40 damage to each Benched Pokémon (both yours and your opponent's). (Don't apply Weakness and Resistance for Benched Pokémon.)";
/** File line 601 — the row this slice PRICED AND REFUSED. §8 is the refusal. */
const FOUR_ZONE =
  "This attack does 50 damage to each Pokémon that has any damage counters on it (both yours and your opponent's), except for this Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";

/** The program arm 6-ii emits, spelled WHOLE so every rung names every field and every
    ORDER (D438: a boolean is true under the real build and under the near-misses alike).
    ⚠️ The SEAT ORDER is part of the value: `yourBench` first. */
const program = (amount: number, damagedOnly = false): readonly EffectOp[] =>
  damagedOnly
    ? [
        { op: "spreadDamage", target: "yourBench", amount, damagedOnly: true },
        { op: "spreadDamage", target: "opponentBench", amount, damagedOnly: true },
      ]
    : [
        { op: "spreadDamage", target: "yourBench", amount },
        { op: "spreadDamage", target: "opponentBench", amount },
      ];

const SEED = 11;

/** Attack indices, keyed by name so no case addresses a fold by number. */
const AT = {
  both: 0,
  damaged: 1,
  flatOpp: 2,
  flatOwn: 3,
  plain: 4,
  both40: 5,
} as const;

/** 🛑 **THE PRINTED BASE IS 50 AND THE TWO SPREADS LAND 10 AND 40, WHICH IS A BOARD
    DECISION RATHER THAN A NUMBER (D488).** The word *also* means the printed base still
    lands — `attack.ts`'s `programDamage` reads `damageDefender`, which this program does
    not emit — so every board reads the Active's row beside the bench rows and the three
    numbers must be pairwise distinct or half the discriminations are coincidences. */
const BASE = 50;

const BOTH_BENCH_CARDS: Record<string, Card> = {
  /** `d507-*` keys with no catalog row behind them, kept out of `FIXTURE_POOL` entirely
      by the file-local `cardPool` below (D414/D452), so every id ladder in the repo takes
      a ZERO term from this slice. */
  "d507-quaker": battler("d507-quaker", {
    name: "D507 Quaker",
    types: ["Colorless"],
    hp: 330,
    retreat: 1,
    attacks: [
      { cost: ["Colorless"], name: "Table Quake", effect: PRINTED_BOTH, damage: BASE },
      { cost: ["Colorless"], name: "Bruise Quake", effect: PRINTED_DAMAGED, damage: BASE },
      { cost: ["Colorless"], name: "Far Quake", effect: FLAT_OPP, damage: BASE },
      { cost: ["Colorless"], name: "Home Quake", effect: FLAT_OWN, damage: BASE },
      // No effect text at all: the control that separates "the program ran and found
      // nothing to do" from "no program ran" on the undamaged board of §5.
      { cost: ["Colorless"], name: "Plain Cuff", damage: BASE },
      { cost: ["Colorless"], name: "Big Table Quake", effect: BOTH_40, damage: BASE },
    ],
  }),
  /** The defender. **NO Weakness**, deliberately: §8.5 applies W/R on the Active and not
      on the Bench, and a ×2 here would make the Active's row a multiple of the base
      rather than the base — a second arithmetic every bench row would be read against. */
  "d507-wall": battler("d507-wall", { name: "D507 Wall", types: ["Colorless"], hp: 400 }),
  /** The opponent's Bench: THREE bodies, so *"each"* against *"1 of"* is visible and a
      build that hit one body is killed (a bench of one makes the two agree). Distinct HP
      so no reading Knocks anything out — a KO stops answering a number. */
  "d507-foe-a": battler("d507-foe-a", { name: "D507 Foe A", types: ["Colorless"], hp: 300 }),
  "d507-foe-b": battler("d507-foe-b", { name: "D507 Foe B", types: ["Colorless"], hp: 310 }),
  "d507-foe-c": battler("d507-foe-c", { name: "D507 Foe C", types: ["Colorless"], hp: 320 }),
  /** The ATTACKER's own Bench — TWO bodies, and a board that fields it is the whole
      point: every one-sided build passes every opponent-only board (D425's rule). */
  "d507-ally-a": battler("d507-ally-a", { name: "D507 Ally A", types: ["Colorless"], hp: 300 }),
  "d507-ally-b": battler("d507-ally-b", { name: "D507 Ally B", types: ["Colorless"], hp: 310 }),
};

const BOTH_BENCH_POOL: Record<string, Card> = { ...FIXTURE_POOL, ...BOTH_BENCH_CARDS };

/** Its own deck (D270), 60 counted before the first run: 7×8 + 4. */
const BOTH_BENCH_DECK = deckOf({
  "d507-quaker": 8,
  "d507-wall": 8,
  "d507-foe-a": 8,
  "d507-foe-b": 8,
  "d507-foe-c": 8,
  "d507-ally-a": 8,
  "d507-ally-b": 8,
  "fix-energy": 4,
});

function openTable(first: Seat): GameState {
  const created = createGame({
    seed: SEED,
    decks: { p1: BOTH_BENCH_DECK, p2: BOTH_BENCH_DECK },
    cardPool: BOTH_BENCH_POOL,
  });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let table = created.state;
  if (table.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  table = must(applyAction(table, { type: "chooseFirstPlayer", seat: table.phase.coinWinner, first }));
  while (table.phase.kind === "setup:drawExtra") {
    const drawing = table.phase;
    const owing = (["p1", "p2"] as const).find((s) => !drawing.decided[s]);
    if (owing === undefined) throw new Error("setup:drawExtra with every seat decided");
    table = must(applyAction(table, { type: "setupDrawExtra", seat: owing, count: drawing.owed[owing] }));
  }
  for (const seat of ["p1", "p2"] as const) {
    table = must(applyAction(table, { type: "setupPlaceActive", seat, uid: firstBasicInHand(table, seat) }));
  }
  for (const seat of ["p1", "p2"] as const) {
    table = must(applyAction(table, { type: "setupReady", seat }));
  }
  return table;
}

/** p1 owns TURN 2 with the Quaker Active. **BOTH benches are cleared before anything is
    placed**: every figure here is a POPULATION over a board, so a body the setup shuffle
    happened to place would move an answer silently (`OWN_BENCH_SPREAD_DECK`'s rule).
    `damaged` seeds EXISTING damage so the printed predicate has something to discriminate
    — index 0 of the opponent's bench and index 1 of the attacker's own, deliberately
    DIFFERENT indices so a build that walked one bench's index positions onto the other is
    killed. */
function table(damaged = false): GameState {
  let state = openTable("p2");
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  expect(state.turn).toBe(2);
  state = setActiveFromDeck(state, "p1", "d507-quaker");
  state = setActiveFromDeck(state, "p2", "d507-wall");
  state = clearBench(state, "p1");
  state = clearBench(state, "p2");
  state = attachFromDeck(state, "p1", "fix-energy", 2);
  for (const id of ["d507-foe-a", "d507-foe-b", "d507-foe-c"]) state = benchFromDeck(state, "p2", id);
  for (const id of ["d507-ally-a", "d507-ally-b"]) state = benchFromDeck(state, "p1", id);
  if (damaged) {
    state = setBenchDamage(state, "p2", 0, 10);
    state = setBenchDamage(state, "p1", 1, 20);
  }
  return state;
}

function swing(state: GameState, index: number) {
  return mustApply(state, { type: "attack", seat: "p1", index });
}

/** `[active, ...bench]` damage — the whole discrimination of §4 to §6. */
function damageVector(state: GameState, seat: Seat): number[] {
  const side = state.players[seat];
  return [side.active?.damage ?? -1, ...side.bench.map((b) => b.damage)];
}

function damageRows(events: GameEvent[]): { seat: Seat; dealt: number }[] {
  return events.flatMap((e) => (e.type === "DAMAGE_DEALT" ? [{ seat: e.seat, dealt: e.dealt }] : []));
}

function units(rows: readonly (readonly [number, string])[]): number {
  return rows.reduce((sum, [n]) => sum + n, 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// §1 — THE PRINTED DATA, AND EVERY ANCHOR VARIANT MEASURED OVER THE WHOLE COLUMN.
// ─────────────────────────────────────────────────────────────────────────────

describe("D507 §1 — the two corpus rows, the apostrophe bytes, and every anchor variant", () => {
  it("🛑 both specimens ARE rows of `legalAttackCorpus()`, at the counts the corpus states", () => {
    // D452/D490's standing rule: assert MEMBERSHIP and read the counts off the corpus
    // instead of typing them. The FILE LINES are cited because this checkout has no
    // catalog (D425) and the corpus is grouped by sentence rather than by id.
    const rows = new Map(legalAttackCorpus().map(([n, s]) => [s, n]));
    expect(rows.get(PRINTED_BOTH)).toBe(1);
    expect(rows.get(PRINTED_DAMAGED)).toBe(1);
    // …and the third both-sides row of the same family, which this slice REFUSES (§8).
    expect(rows.get(FOUR_ZONE)).toBe(1);
    // ⚠️ The 40-damage probe is NOT printed, and it is labelled as constructed (D440):
    // it exists to pin that the amount is a capture, not to claim a printing.
    expect(rows.get(BOTH_40)).toBeUndefined();
    // The two one-sided controls ARE printed, which is what makes them controls.
    expect(rows.get(FLAT_OPP)).toBe(1);
    expect(rows.get(FLAT_OWN)).toBe(3);
  });

  it("🛑 every apostrophe in both prints is U+0027, measured with `codePointAt` and not by eye", () => {
    // D421 got this wrong from memory and D425/D440 measured it; the `['’]` class in the
    // anchor is kept for the family's standing reason (a re-ingest could curl them), and
    // THIS is the rung that says what the bytes are today.
    for (const text of [PRINTED_BOTH, PRINTED_DAMAGED]) {
      const marks = [...text].filter((ch) => ch === "'" || ch === "’");
      expect(marks.length).toBeGreaterThanOrEqual(2);
      for (let i = 0; i < text.length; i += 1) {
        const code = text.codePointAt(i);
        expect(code, `U+2019 at ${i} of ${text}`).not.toBe(0x2019);
      }
    }
    // …and the CURLY spelling still derives, which is what the character class buys.
    expect(deriveAttackEffect(PRINTED_BOTH.replace(/'/g, "’"))).toEqual(program(10));
  });

  it("🛑 the anchor's FOUR variants, measured over all 640 rows — and only one of them is right", () => {
    // D472/D477: before generalising or narrowing an anchor, MEASURE what each form
    // claims over the column; the measurement is the argument, and it is recorded as a
    // rung rather than asserted in a comment.
    const corpus = legalAttackCorpus();
    const claims = (re: RegExp) => {
      const rows = corpus.filter(([, s]) => re.test(s));
      return [rows.length, units(rows)];
    };
    const SHIPPED =
      /^This attack (?:also )?does (\d+) damage to each Benched Pokémon( that has any damage counters on it)? \(both yours and your opponent['’]s\)\.(?: \(Don['’]t apply Weakness and Resistance for Benched Pokémon\.\))?$/;
    const CLAUSE_MANDATORY =
      /^This attack (?:also )?does (\d+) damage to each Benched Pokémon that has any damage counters on it \(both yours and your opponent['’]s\)\.(?: \(Don['’]t apply Weakness and Resistance for Benched Pokémon\.\))?$/;
    const CLAUSE_FREE =
      /^This attack (?:also )?does (\d+) damage to each Benched Pokémon \(both yours and your opponent['’]s\)\.(?: \(Don['’]t apply Weakness and Resistance for Benched Pokémon\.\))?$/;
    const NO_ALSO =
      /^This attack does (\d+) damage to each Benched Pokémon( that has any damage counters on it)? \(both yours and your opponent['’]s\)\.(?: \(Don['’]t apply Weakness and Resistance for Benched Pokémon\.\))?$/;
    // 🛑 **THE SHIPPED FORM IS THE ONLY ONE THAT REACHES BOTH ROWS**, and the two narrow
    // forms partition it exactly — which is the whole argument for ONE anchor with an
    // optional group where D505 needed TWO anchors one screen up. There the optional
    // group would have handed 4 printings a `perTakenPrize` they do not print; here the
    // group's PRESENCE *is* the rider's presence, so no point can be mis-ridden.
    expect(claims(SHIPPED)).toEqual([2, 2]);
    expect(claims(CLAUSE_MANDATORY)).toEqual([1, 1]);
    expect(claims(CLAUSE_FREE)).toEqual([1, 1]);
    // ⚠️ **AND REFUSING THE `also` WOULD COST THE SLICE OUTRIGHT** — both printed rows
    // carry the word, so the `also`-less form claims NOTHING. D505's discriminator says
    // admitting it is free here: this arm emits `spreadDamage` ALONE, so `programDamage`
    // (`some(step => step.op === "damageDefender")`) is false either way and the printed
    // base rides the attack's own `damage` field.
    expect(claims(NO_ALSO)).toEqual([0, 0]);
  });

  it("🛑 the W/R parenthetical is OPTIONAL and the optionality claims the same rows", () => {
    // The family's standing shape: §8.5 makes the clarifier true whether or not it is
    // printed. Measured rather than assumed — the mandatory form claims the same 2 / 2.
    const corpus = legalAttackCorpus();
    const MANDATORY =
      /^This attack (?:also )?does (\d+) damage to each Benched Pokémon( that has any damage counters on it)? \(both yours and your opponent['’]s\)\. \(Don['’]t apply Weakness and Resistance for Benched Pokémon\.\)$/;
    const rows = corpus.filter(([, s]) => MANDATORY.test(s));
    expect([rows.length, units(rows)]).toEqual([2, 2]);
    // …and the tail-less spellings derive, which is what the optional group buys.
    expect(
      deriveAttackEffect("This attack also does 10 damage to each Benched Pokémon (both yours and your opponent's)."),
    ).toEqual(program(10));
    expect(
      deriveAttackEffect(
        "This attack also does 40 damage to each Benched Pokémon that has any damage counters on it (both yours and your opponent's).",
      ),
    ).toEqual(program(40, true));
  });

  it("🛑 the two anchors of this family are DISJOINT, so their ORDER is free (D502's question)", () => {
    // Arm 6 (`SPREAD_EACH_BENCH`) is keyed on the literal `each of ` plus a possessive;
    // arm 6-ii is keyed on `each Benched` plus the printed parenthetical. Neither claims
    // a row of the other, measured over all 640 — which is what makes the placement a
    // non-decision rather than a coincidence that could rot.
    const corpus = legalAttackCorpus();
    const mine = corpus.filter(([, s]) => (deriveAttackEffect(s) ?? []).filter((o) => o.op === "spreadDamage").length === 2);
    expect(mine.map(([, s]) => s).sort()).toEqual([PRINTED_BOTH, PRINTED_DAMAGED].sort());
    const theirs = corpus.filter(([, s]) => {
      const ops = deriveAttackEffect(s) ?? [];
      return ops.length === 1 && ops[0]?.op === "spreadDamage";
    });
    expect(theirs.map(([, s]) => s)).not.toContain(PRINTED_BOTH);
    expect(theirs.map(([, s]) => s)).not.toContain(PRINTED_DAMAGED);
    expect(theirs.length).toBeGreaterThanOrEqual(4);
  });

  it("AUTHORS nothing — the two legal printings are read off the TEXT, not from a registry row", () => {
    // D414/D452: the demonstrator is file-local, so `FIXTURE_POOL` and every id ladder in
    // the repo take a ZERO term from this slice.
    expect(Object.keys(BOTH_BENCH_CARDS).every((id) => FIXTURE_POOL[id] === undefined)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — THE TWO READINGS, AND EVERY NEAR-MISS WITH AN ADMISSION BESIDE IT.
// ─────────────────────────────────────────────────────────────────────────────

describe("D507 §2 — both prints derive, the rider is read, and every neighbour is read WITHOUT it", () => {
  it("🛑 file line 515 derives to TWO `spreadDamage` ops, spelled whole and in seat order", () => {
    expect(deriveAttackEffect(PRINTED_BOTH)).toEqual(program(10));
  });

  it("🛑 file line 526 derives to the SAME pair carrying `damagedOnly` on BOTH ops", () => {
    // 🛑 BOTH ops, not one. A build that rode the rider on the opponent's leg alone
    // passes every board whose own bench is empty or entirely damaged, which is most of
    // them — `D507-damagedonly-rides-one-leg-only` is the row.
    expect(deriveAttackEffect(PRINTED_DAMAGED)).toEqual(program(40, true));
  });

  it("🛑 …and the ONE-SIDED siblings are UNMOVED — the control without which the two above are tautologies", () => {
    expect(deriveAttackEffect(FLAT_OPP)).toEqual([
      { op: "spreadDamage", target: "opponentBench", amount: 10 },
    ]);
    expect(deriveAttackEffect(FLAT_OWN)).toEqual([
      { op: "spreadDamage", target: "yourBench", amount: 10 },
    ]);
    // Neither carries the rider, and neither became a two-op program.
    for (const text of [FLAT_OPP, FLAT_OWN]) {
      const ops = deriveAttackEffect(text) as EffectOp[];
      expect(ops).toHaveLength(1);
      expect(JSON.stringify(ops)).not.toContain("damagedOnly");
    }
  });

  it("🛑 the AMOUNT is the capture, not a constant — the 40 probe on the unfiltered spelling", () => {
    expect(deriveAttackEffect(BOTH_40)).toEqual(program(40));
  });

  it("refuses the near-misses — and ADMITS one on the same axis beside each (D424)", () => {
    // ⚠️ **EVERY REFUSAL RUNG OWES A NEIGHBOURING ADMISSION ON THE SAME AXIS**, or it
    // passes under a reader that refuses everything. Each pair moves ONE token and states
    // what the anchor is actually keyed on.
    const pairs: readonly (readonly [string, string, string])[] = [
      // the seat scope: drop the parenthetical and no reader owns an ownerless bench noun
      [
        "the parenthetical deleted (an ownerless bench noun)",
        "This attack also does 10 damage to each Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
        PRINTED_BOTH,
      ],
      // the parenthetical's WORDING: a spelling the column does not print
      [
        "`(both yours and your opponent's)` reworded",
        "This attack also does 10 damage to each Benched Pokémon (yours and your opponent's). (Don't apply Weakness and Resistance for Benched Pokémon.)",
        PRINTED_BOTH,
      ],
      // the quantifier: "1 of" is a CHOICE and a different op
      [
        "`1 of` (a choice, and a different op)",
        "This attack also does 10 damage to 1 Benched Pokémon (both yours and your opponent's). (Don't apply Weakness and Resistance for Benched Pokémon.)",
        PRINTED_BOTH,
      ],
      // the ZONE: "each Pokémon" reaches the Actives, and that is §8's refusal
      [
        "`each Pokémon` (four zones, not two)",
        "This attack also does 10 damage to each Pokémon (both yours and your opponent's). (Don't apply Weakness and Resistance for Benched Pokémon.)",
        PRINTED_BOTH,
      ],
      // the PREDICATE's wording: a board fact this engine's rider does not spell
      [
        "`that has no damage counters on it` (the complement)",
        "This attack also does 40 damage to each Benched Pokémon that has no damage counters on it (both yours and your opponent's). (Don't apply Weakness and Resistance for Benched Pokémon.)",
        PRINTED_DAMAGED,
      ],
      // the lookalike é falls off the path silently, which is the family's reason
      ["a lookalike `Pokemon`", PRINTED_BOTH.replace(/Pokémon/g, "Pokemon"), PRINTED_BOTH],
      // no leading `This attack`: a mid-sentence clause must not reach this path
      ["a mid-sentence clause", `Flip a coin. ${PRINTED_BOTH}`, PRINTED_BOTH],
    ];
    for (const [why, refused, admitted] of pairs) {
      expect(deriveAttackEffect(refused), `REFUSED: ${why}`).toBeNull();
      expect(deriveAttackEffect(admitted), `ADMITTED beside ${why}`).not.toBeNull();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — THE LATTICE, IN THE EXECUTABLE FORM (D491), RUN OVER BOTH PREDICATES (D503).
// ─────────────────────────────────────────────────────────────────────────────

/** The five axes counted FROM THE PRINT at file line 526, index 0 = the PRINTED value,
    index 1 = its nearest BUILT spelling. ⚠️ **A1's built spelling is a CHANGE OF NOUN
    PHRASE and A2's is the ABSENCE of a clause**, and neither is a cheat: `each of your
    Benched Pokémon` is a printed corpus row at 3 printings, and the clause-free wording
    is the OTHER row this slice builds (file line 515) — so every lattice point is a
    sentence some reader could in principle claim, which is D489's requirement. */
const AXES = {
  damaged: [" that has any damage counters on it", ""],
  amount: ["40", "10"],
  wr: [" (Don't apply Weakness and Resistance for Benched Pokémon.)", ""],
  also: ["also ", ""],
} as const;

type Bit = 0 | 1;
const BITS: readonly Bit[] = [0, 1];

function latticePoint(b: Bit, d: Bit, n: Bit, w: Bit, o: Bit): string {
  const noun =
    b === 0
      ? `each Benched Pokémon${AXES.damaged[d]} (both yours and your opponent's)`
      : `each of your Benched Pokémon${AXES.damaged[d]}`;
  return `This attack ${AXES.also[o]}does ${AXES.amount[n]} damage to ${noun}.${AXES.wr[w]}`;
}

/** The FOUR-ARM residue predicate's readable half — readers, plus BOTH splitters composed
    the way `censusAtHead.test.ts`'s `residueSentences` filter composes them (D444:
    `!resolvedByAnyReader` is not the unbuilt set). The registry arm is keyed on card ids
    and cannot claim a constructed string, so it is stated rather than run. */
function buildsHere(text: string): boolean {
  if (resolvedByAnyReader(text)) return true;
  const gate = splitAttackGateClause(text);
  if (gate !== null && gate.body !== "" && resolvedByAnyReader(gate.body)) return true;
  return splitAttackTrailingClause(text) !== null;
}

/** 🛑 **A LATTICE RUN AFTER THE BUILD IS NOT THE LATTICE (D491, sharpened at D505), AND
    THIS FUNCTION IS WHY THE TABLES BELOW ARE THE PRE-STATE.** The vector the slice
    reports is the one that justified the build, so it has to be the verdict as it stood
    BEFORE arm 6-ii existed — and quoting it as prose is the unfalsifiable claim D465
    forbids. So the old verdict is DERIVED from the current one by subtracting exactly the
    points the new arm claims.
    ⚠️ **KEYED ON THE PROGRAM'S SHAPE, NOT ON THE MODULE-PRIVATE ANCHOR.** What arm 6-ii
    is responsible for is *a program of TWO `spreadDamage` ops, one per bench* — a fact
    about the emitted value that no other arm in this engine produces. A successor that
    widened the anchor across a point this lattice records as refused reddens the second
    half of §3 rather than slipping past a name. */
function claimedByTheNewArm(text: string): boolean {
  const spreads = (deriveAttackEffect(text) ?? []).filter((op) => op.op === "spreadDamage");
  return (
    spreads.length === 2 &&
    spreads.some((op) => op.op === "spreadDamage" && op.target === "yourBench") &&
    spreads.some((op) => op.op === "spreadDamage" && op.target === "opponentBench")
  );
}

function vector(pred: (t: string) => boolean): { built: number[]; total: number[] } {
  const built = [0, 0, 0, 0, 0, 0];
  const total = [0, 0, 0, 0, 0, 0];
  for (const b of BITS)
    for (const d of BITS)
      for (const n of BITS)
        for (const w of BITS)
          for (const o of BITS) {
            const point = latticePoint(b, d, n, w, o);
            const weight = b + d + n + w + o;
            total[weight] = (total[weight] ?? 0) + 1;
            // The PRE-SLICE verdict: built now, minus what arm 6-ii is responsible for.
            if (pred(point) && !claimedByTheNewArm(point)) built[weight] = (built[weight] ?? 0) + 1;
          }
  return { built, total };
}

/** The same subtraction applied to a single point, so the flip table below is the
    pre-state too and not a table about this slice's own anchor. */
function builtBefore(point: string): boolean {
  return buildsHere(point) && !claimedByTheNewArm(point);
}

describe("D507 §3 — the 2⁵ axis-substitution lattice, over BOTH predicates", () => {
  it("🛑 the print is weight 0 and every one of the 32 points is a DISTINCT string", () => {
    expect(latticePoint(0, 0, 0, 0, 0)).toBe(PRINTED_DAMAGED);
    // …and the OTHER printed row is a lattice point too, at weight 2 — which is what
    // makes this ONE lattice for TWO sentences rather than two lattices sharing axes.
    expect(latticePoint(0, 1, 1, 0, 0)).toBe(PRINTED_BOTH);
    // ⚠️ D502's artefact, checked rather than inherited (D505's correction): a DEGENERATE
    // axis (two identical values) makes the point set smaller than the bit set, and
    // reporting a 2⁵ table that is really a 2⁴ one twice over is how a lattice lies.
    const points = new Set(
      BITS.flatMap((b) =>
        BITS.flatMap((d) =>
          BITS.flatMap((n) => BITS.flatMap((w) => BITS.map((o) => latticePoint(b, d, n, w, o)))),
        ),
      ),
    );
    expect(points.size).toBe(32);
    for (const axis of Object.values(AXES)) expect(axis[0]).not.toBe(axis[1]);
    expect(latticePoint(0, 0, 0, 0, 0)).not.toBe(latticePoint(1, 0, 0, 0, 0));
  });

  it("🛑 READERS-ONLY reads `0/1 · 0/5 · 1/10 · 3/10 · 3/5 · 1/1`", () => {
    const { built, total } = vector(resolvedByAnyReader);
    expect(total).toEqual([1, 5, 10, 10, 5, 1]);
    expect(built).toEqual([0, 0, 1, 3, 3, 1]);
    // A quarter of the lattice builds, which is the arithmetic signature of TWO blocking
    // axes in CONJUNCTION over an otherwise free 2³ — see the rung two down.
    expect(built.reduce((x, y) => x + y)).toBe(8);
  });

  it("🛑 SPLITTER-INCLUSIVE reads the SAME vector, and the splitters are null at 32 of 32", () => {
    // 🛑 **D503's METHOD RULE, SATISFIED RATHER THAN MERELY APPLIED, AND D505's
    // REFINEMENT IS WHY IT WAS CHEAP.** The splitter dimension can only diverge on a
    // sentence with a leading `If …,` clause or ≥2 depth-0 segments whose tail a reader
    // can claim. Neither print has the first, and the only second segment is the
    // `(Don't apply …)` parenthetical, which belongs to the spread anchor. Both splitters
    // are checked at EVERY point rather than at the print alone, because a deletion can
    // manufacture a segment boundary that the print did not have.
    const { built, total } = vector(buildsHere);
    expect(total).toEqual([1, 5, 10, 10, 5, 1]);
    expect(built).toEqual([0, 0, 1, 3, 3, 1]);
    let divergent = 0;
    let bothNull = 0;
    for (const b of BITS)
      for (const d of BITS)
        for (const n of BITS)
          for (const w of BITS)
            for (const o of BITS) {
              const point = latticePoint(b, d, n, w, o);
              const readersOnly = resolvedByAnyReader(point) && !claimedByTheNewArm(point);
              if (readersOnly !== builtBefore(point)) divergent++;
              if (splitAttackGateClause(point) === null && splitAttackTrailingClause(point) === null) bothNull++;
            }
    expect(divergent).toBe(0);
    expect(bothNull).toBe(32);
  });

  it("🛑 THE FACTORISATION — AN EIGHTH SHAPE: two axes flip at 8/16 each, three at 0/16", () => {
    // 🛑 **A CONJUNCTIVE PAIR OF BLOCKING AXES × A FREE 2³, WRITTEN AS AN ASSERTION
    // RATHER THAN AS PROSE (D500's lesson).** A pre-slice point builds iff the SCOPE is
    // substituted AND the damage-counter clause is deleted. Neither alone reaches a built
    // string, so each flips the verdict on exactly the half of its cells where the other
    // is already substituted — 8 of 16 — while amount, the W/R rider and the word *also*
    // flip nothing. That is arithmetically distinct from D505's `16/16 + four zeroes`.
    const names = ["scope", "damaged", "amount", "wr", "also"] as const;
    const flips: Record<string, [number, number]> = {};
    for (let axis = 0; axis < 5; axis++) {
      let moved = 0;
      let cells = 0;
      for (const b of BITS)
        for (const d of BITS)
          for (const n of BITS)
            for (const w of BITS)
              for (const o of BITS) {
                const bits: Bit[] = [b, d, n, w, o];
                if (bits[axis] === 1) continue;
                cells++;
                const on: Bit[] = [...bits];
                on[axis] = 1;
                const here = builtBefore(latticePoint(...(bits as [Bit, Bit, Bit, Bit, Bit])));
                const there = builtBefore(latticePoint(...(on as [Bit, Bit, Bit, Bit, Bit])));
                if (here !== there) moved++;
              }
      flips[names[axis] as string] = [moved, cells];
    }
    expect(flips).toEqual({
      scope: [8, 16],
      damaged: [8, 16],
      amount: [0, 16],
      wr: [0, 16],
      also: [0, 16],
    });
    // …and the THREE separating boards, spelled out so the conjunction is readable from
    // the strings and not only from the counts: either axis alone is refused, and only
    // the pair together builds.
    expect(builtBefore(latticePoint(1, 0, 1, 1, 1))).toBe(false);
    expect(builtBefore(latticePoint(0, 1, 1, 1, 1))).toBe(false);
    expect(builtBefore(latticePoint(1, 1, 0, 0, 0))).toBe(true);
    // 🛑 **AND THE SECOND HALF OF D491's RUNG: THE POINTS THE NEW ARM CLAIMS ARE EXACTLY
    // THE 16 THIS LATTICE RECORDS AS REFUSED WITH THE PRINTED SCOPE** — the whole `b = 0`
    // half, free in the other four bits. A successor that widened the anchor across any
    // other point reddens here, which is what makes the subtraction above honest rather
    // than circular.
    const claimed = new Set<string>();
    for (const b of BITS)
      for (const d of BITS)
        for (const n of BITS)
          for (const w of BITS)
            for (const o of BITS) {
              const point = latticePoint(b, d, n, w, o);
              if (claimedByTheNewArm(point)) claimed.add(point);
            }
    const expected = new Set<string>();
    for (const d of BITS) for (const n of BITS) for (const w of BITS) for (const o of BITS) expected.add(latticePoint(0, d, n, w, o));
    expect(claimed.size).toBe(16);
    expect([...claimed].sort()).toEqual([...expected].sort());
    expect(claimed.has(PRINTED_DAMAGED)).toBe(true);
    expect(claimed.has(PRINTED_BOTH)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — THE BOARD: ONE NUMBER, TWO BENCHES, AND NEITHER ACTIVE SPLASHED.
// ─────────────────────────────────────────────────────────────────────────────

describe("D507 §4 — the same printed number lands on both benches, and on nothing else", () => {
  it("🛑 five benched bodies across TWO seats each take 10, and the defender takes the printed base", () => {
    const { state: done } = swing(table(), AT.both);
    expect(damageVector(done, "p2")).toEqual([BASE, 10, 10, 10]);
    // 🛑 **THE ATTACKER'S OWN BENCH TAKES THE SAME 10** — the half no one-sided build can
    // reach, and the reason this board fields both benches (D425).
    expect(damageVector(done, "p1")).toEqual([0, 10, 10]);
  });

  it("🛑 …and the ONE-SIDED siblings on the SAME board hit ONE bench each — the attribution control (D214)", () => {
    const far = swing(table(), AT.flatOpp).state;
    expect(damageVector(far, "p2")).toEqual([BASE, 10, 10, 10]);
    expect(damageVector(far, "p1")).toEqual([0, 0, 0]);
    const home = swing(table(), AT.flatOwn).state;
    expect(damageVector(home, "p2")).toEqual([BASE, 0, 0, 0]);
    expect(damageVector(home, "p1")).toEqual([0, 10, 10]);
  });

  it("🛑 the AMOUNT is the capture: the 40-probe deals 40 on every benched body of both seats", () => {
    const { state: done } = swing(table(), AT.both40);
    expect(damageVector(done, "p2")).toEqual([BASE, 40, 40, 40]);
    expect(damageVector(done, "p1")).toEqual([0, 40, 40]);
  });

  it("🛑 the printed base STILL LANDS, which is what the word `also` buys", () => {
    // The control that separates "the program ran" from "the program replaced the hit":
    // the effect-less attack deals the base and nothing else on the same board.
    const plain = swing(table(), AT.plain).state;
    expect(damageVector(plain, "p2")).toEqual([BASE, 0, 0, 0]);
    expect(damageVector(plain, "p1")).toEqual([0, 0, 0]);
  });

  it("🛑 an EMPTY own bench is a silent whiff on that leg and the other leg still lands", () => {
    // Neither op guards the other's empty case and neither has to — `spreadDamage`
    // returns the state untouched on an empty Bench (its own early return), so a lone
    // attacker splashes only the opponent and files no row for its own side.
    let state = table();
    state = clearBench(state, "p1");
    const { state: done, events } = swing(state, AT.both);
    expect(damageVector(done, "p2")).toEqual([BASE, 10, 10, 10]);
    expect(damageVector(done, "p1")).toEqual([0]);
    expect(damageRows(events).filter((r) => r.seat === "p1")).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — THE RIDER: THE UNDAMAGED BODIES ARE NOT HIT, AND FILE NO ROW.
// ─────────────────────────────────────────────────────────────────────────────

describe("D507 §5 — `damagedOnly` narrows both benches, and the flat sibling does not", () => {
  it("🛑 only the two bodies that already carried counters take the 40 — one per seat", () => {
    const { state: done } = swing(table(true), AT.damaged);
    // p2 bench index 0 started at 10; indexes 1 and 2 were clean and stay clean.
    expect(damageVector(done, "p2")).toEqual([BASE, 50, 0, 0]);
    // p1 bench index 1 started at 20; index 0 was clean and stays clean. ⚠️ The two
    // seats' damaged INDEXES differ deliberately, so a build that walked one bench's
    // positions onto the other is killed here rather than passing by symmetry.
    expect(damageVector(done, "p1")).toEqual([0, 0, 60]);
  });

  it("🛑 the UNFILTERED reading on the SAME board hits everybody — the rung above is about the RIDER", () => {
    // Without this control, "the rider narrows" is green under a build whose spread is
    // simply broken (D214's attribution rule).
    const { state: done } = swing(table(true), AT.both);
    expect(damageVector(done, "p2")).toEqual([BASE, 20, 10, 10]);
    expect(damageVector(done, "p1")).toEqual([0, 10, 30]);
  });

  it("🛑 an UNDAMAGED body files NO `DAMAGE_DEALT` row at all — not a row of zero", () => {
    // The difference between "skipped" and "hit for nothing" is invisible in the damage
    // vector and loud in the log, which is where a prevention would have shown up. Four
    // rows: the printed base plus exactly two benched bodies.
    const { events } = swing(table(true), AT.damaged);
    expect(damageRows(events)).toEqual([
      { seat: "p2", dealt: BASE },
      { seat: "p1", dealt: 40 },
      { seat: "p2", dealt: 40 },
    ]);
  });

  it("🛑 a board where NOTHING is damaged is a total whiff on both benches, and the base still lands", () => {
    // The zero-candidate board, which is where a build that ignored the rider is loudest.
    const { state: done, events } = swing(table(), AT.damaged);
    expect(damageVector(done, "p2")).toEqual([BASE, 0, 0, 0]);
    expect(damageVector(done, "p1")).toEqual([0, 0, 0]);
    expect(damageRows(events)).toEqual([{ seat: "p2", dealt: BASE }]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — THE SEAT ORDER, WHICH IS OBSERVABLE RATHER THAN COSMETIC.
// ─────────────────────────────────────────────────────────────────────────────

describe("D507 §6 — the attacker's own bench is walked FIRST", () => {
  it("🛑 the log reads base, then BOTH own-bench rows, then all three opponent-bench rows", () => {
    // 🛑 **THE ORDER IS PRINTED ORDER *AND* CONTROLLER-FIRST, AND THE TWO AGREE.** The
    // card prints *"both **yours** and your opponent's"* (D132 — ops in printed order),
    // and the house's controller-first walk (`handRefresh`'s `[ctx.seat,
    // otherSeat(ctx.seat)]`, settled by D490's distinguishing test) puts the attacker's
    // own board first. ⚠️ `counterEachAll`'s `side: "both"` walks the ABSOLUTE `SEATS`
    // instead and the two shipped precedents genuinely disagree (D433); the tie-breaker
    // D490 named is *what the walk EMITS*, and this program files one `DAMAGE_DEALT` per
    // BODY on each side in turn, so the seat order IS the log's order here.
    // ⚠️ AND IT IS NOT ONLY THE LOG: `spreadDamage` is a FOLD that carries `rngState`
    // (D258 — a spread into three holders is three coin-flip-shield flips, not one), so
    // swapping the two ops re-draws every shield coin on both benches as well.
    const { events } = swing(table(), AT.both);
    expect(damageRows(events)).toEqual([
      { seat: "p2", dealt: BASE },
      { seat: "p1", dealt: 10 },
      { seat: "p1", dealt: 10 },
      { seat: "p2", dealt: 10 },
      { seat: "p2", dealt: 10 },
      { seat: "p2", dealt: 10 },
    ]);
  });

  it("🛑 the ORDER survives into the derived program, where a mutant can be seen without a board", () => {
    const ops = deriveAttackEffect(PRINTED_BOTH) as EffectOp[];
    expect(ops.map((o) => (o.op === "spreadDamage" ? o.target : o.op))).toEqual([
      "yourBench",
      "opponentBench",
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7 — THE RECORD CONSTANT, ARGUED AT THE ADDRESS AND DRIVEN OVER v30 BYTES.
// ─────────────────────────────────────────────────────────────────────────────

describe("D507 §7 — `MATCH_RECORD_VERSION` holds at 30, and D505's argument is RE-DERIVED", () => {
  // 🛑 **THE ADDRESS, NAMED FIRST (D456).** An `EffectOp` reaches persisted storage at
  // exactly one place: `MatchRecord.state.phase.cont`, an `EffectContinuation`
  // (interpreter.ts) whose `pendingOp` is the op awaiting a choice and whose `rest` is the
  // ops behind it. Both are written only on a PARK.
  //
  // 🛑 **HALF ONE — REACHABILITY IS EMPTY, AND D505's VERSION OF THIS ARGUMENT HAD A
  // PRECONDITION THIS SLICE REMOVES (D456's rule: the reachability argument has one).**
  // D505 shut the `rest` door by writing *"the arm below returns a program of **length
  // one**"*. **Arm 6-ii returns a program of length TWO**, so that sentence is simply not
  // available here. The door is still shut and the reason is now a property of the OP
  // rather than of the ARM: `rest` holds what sits BEHIND a park, and the op in front of
  // it here is itself a `spreadDamage`, whose `stepOp` arm returns `{ done }`
  // unconditionally. **Both ops in this program are the never-parking op.** A successor
  // that puts a PARKING op in front of one of these reopens `rest` and owes the question
  // again — which is why the rung below drives the WHOLE program and not just one op.
  //
  // ⚠️ **HALF TWO — THE ARGUMENT THAT DOES NOT DEPEND ON TODAY'S PRODUCERS.**
  // `damagedOnly` is an ADDED OPTIONAL key, which is D125/D334's WIDENING: every record a
  // v30 deploy has written stays valid and means exactly what it meant, because ABSENT is
  // the unconditional spread — which is what all three older producers emit. D441's
  // discriminator (*does the absent key still say what the old writer meant*) answers YES.
  // The LOSS direction is named rather than left implicit: a dropped rider splashes the
  // UNDAMAGED benched bodies too, a plausible wrong board rather than a throw. It is
  // unreachable by half one, and it is driven below anyway.
  //
  // ⚠️ The constant itself lives in `apps/api/src/lobby/match.ts` and is not exported from
  // this package, so it is not imported here; what IS driven is the claim it protects.
  const ctx = { seat: "p1" as Seat, invokedBy: "attack" as const };

  /** The v30 spelling of the same PROGRAM, reconstructed BY HAND and LABELLED as
      constructed (D440) — bytes a v30 deploy really could have written, differing from
      this slice's output in exactly ONE key per op. */
  const V30_PROGRAM = [
    { op: "spreadDamage", target: "yourBench", amount: 40 },
    { op: "spreadDamage", target: "opponentBench", amount: 40 },
  ] as unknown as EffectOp[];

  it("🛑 each op differs in exactly ONE key, and the v30 bytes survive a JSON round trip", () => {
    const derived = deriveAttackEffect(PRINTED_DAMAGED) as EffectOp[];
    expect(derived).toHaveLength(2);
    derived.forEach((op, i) => {
      const old = V30_PROGRAM[i] as unknown as Record<string, unknown>;
      const differing = Object.keys(op).filter(
        (k) => JSON.stringify((op as unknown as Record<string, unknown>)[k]) !== JSON.stringify(old[k]),
      );
      expect(differing).toEqual(["damagedOnly"]);
    });
    expect(JSON.parse(JSON.stringify(V30_PROGRAM))).toEqual(V30_PROGRAM);
    // The UNFILTERED row's program is byte-identical to a v30 one, which is the other
    // half of "absent means what it always meant".
    expect(JSON.parse(JSON.stringify(deriveAttackEffect(PRINTED_BOTH)))).toEqual(V30_PROGRAM.map((o) => ({ ...o, amount: 10 })));
  });

  it("🛑 NEITHER op parks — `runProgram` answers `done` over the WHOLE length-two program", () => {
    // The `pendingOp` door closed, driven rather than argued — and driven over the pair,
    // because the length-one premise D505 used is exactly what is gone here. Five benched
    // bodies is a board on which the CHOSEN sibling one cell over genuinely parks, so
    // this is not vacuous on an empty bench.
    const state = table(true);
    const events: GameEvent[] = [];
    const run = runProgram(state, deriveAttackEffect(PRINTED_DAMAGED) as EffectOp[], ctx, events);
    expect(run.kind).toBe("done");
    expect(swing(state, AT.damaged).state.phase.kind).not.toBe("effect:choose");
  });

  it("🛑 a v30 program WITHOUT the rider splashes the UNDAMAGED bodies too — the LOSS direction", () => {
    const state = table(true);
    const events: GameEvent[] = [];
    const run = runProgram(state, V30_PROGRAM, ctx, events);
    if (run.kind !== "done") throw new Error("expected done");
    expect(damageVector(run.state, "p2")).toEqual([0, 50, 40, 40]);
    expect(damageVector(run.state, "p1")).toEqual([0, 40, 60]);
  });

  it("🛑 …and the NEW bytes on the SAME board answer differently — both directions or neither (D441)", () => {
    const state = table(true);
    const events: GameEvent[] = [];
    const run = runProgram(state, deriveAttackEffect(PRINTED_DAMAGED) as EffectOp[], ctx, events);
    if (run.kind !== "done") throw new Error("expected done");
    expect(damageVector(run.state, "p2")).toEqual([0, 50, 0, 0]);
    expect(damageVector(run.state, "p1")).toEqual([0, 0, 60]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §8 — THE REFUSAL: FILE LINE 601, PRICED WITH THE MEASUREMENT (D503's model).
// ─────────────────────────────────────────────────────────────────────────────

describe("D507 §8 — the FOUR-ZONE sibling is REFUSED, and the condition that reverses it is named", () => {
  // 🛑 **THE ROW, AND WHY IT IS NOT THIS SLICE'S SHAPE.** *"This attack does 50 damage to
  // each Pokémon that has any damage counters on it (both yours and your opponent's),
  // except for this Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)"*
  // — corpus FILE LINE 601, **1 sentence / 1 legal printing**, and `OPAQUE` even at
  // `SUBMAX=12` (no deletion and no substitution of up to twelve tokens reaches a built
  // string).
  //
  // 🛑 **TWO THINGS THAT LOOK LIKE THE REASON AND ARE NOT, STATED FIRST SO A SUCCESSOR
  // DOES NOT RE-DERIVE THEM (D466: a refusal's REASON can be false for years).**
  //   (a) *"`counterEachAll.exceptNamed` is a NAME exception and this prints a SELF
  //       exception, so it cannot be expressed."* TRUE about that field and IRRELEVANT
  //       here: under a zone decomposition the self-exclusion is STRUCTURAL. *"This
  //       Pokémon"* is the attacker, an attack is declared by the Active, and no op in a
  //       three-op decomposition would name the attacker's own Active Spot at all. No
  //       `exceptSelf` is required.
  //   (b) *"`spreadDamage` is bench-only, so the row is not a `spreadDamage` shape."*
  //       TRUE, and it is D482's situation rather than a blocker: the Actives are
  //       `damageDefender`'s business and the benches are this op's, exactly as the
  //       whole-side spread at arm 6a-bis divides them.
  //
  // 🛑 **THE MEASURED REASON.** Composing it needs a `damagedOnly` rider on
  // `damageDefender`'s FLAT arm — a per-body board predicate on the engine's
  // most-produced damage op (ELEVEN producers across `effects.ts` and `registry.ts`,
  // counted at this head), whose whole population is unconditional single-target hits.
  // That is one optional key on a heavily-shared union arm, plus a `damagedOnly?: never`
  // on its `{ per, count }` sibling to keep the union honest, plus a third anchor, plus a
  // three-op program whose §8.5 asymmetry (W/R on the Active, flat on the Bench) needs
  // its own boards — **for ONE printing**. This slice's two rows cost ONE rider on an op
  // with three producers and ZERO new arms on anything else. **The marginal site cost is
  // not near zero (D424's test), so the row is left and NAMED rather than swept in.**
  //
  // ⚠️ **THE FALSIFIER, EXECUTABLE (D428).** The refusal reverses the day
  // `damageDefender`'s flat arm carries a per-body board predicate for a reason of its
  // own — or the day a SECOND sentence prints the four-zone shape, which would make the
  // rider's marginal cost the thing D424 actually measures. The rung below is what goes
  // red on the first of those.

  it("🛑 it IS a corpus row, it is STILL refused, and neither splitter reaches it", () => {
    const rows = new Map(legalAttackCorpus().map(([n, s]) => [s, n]));
    expect(rows.get(FOUR_ZONE)).toBe(1);
    expect(resolvedByAnyReader(FOUR_ZONE)).toBe(false);
    expect(deriveAttackEffect(FOUR_ZONE)).toBeNull();
    expect(splitAttackGateClause(FOUR_ZONE)).toBeNull();
    expect(splitAttackTrailingClause(FOUR_ZONE)).toBeNull();
  });

  it("🛑 the ZONE is the difference, and it is ONE printed token — `each Pokémon`, not `each Benched Pokémon`", () => {
    // ⚠️ **AN ABSENCE PINNED ON AN AXIS, WITH ITS ADMISSION BESIDE IT (D423/D424).**
    // Substituting the zone noun alone turns the refused row into a string this slice
    // BUILDS, which is what makes "the zone is the blocker" a measurement rather than a
    // reading of the sentence.
    const benched = FOUR_ZONE.replace("to each Pokémon", "to each Benched Pokémon")
      .replace(", except for this Pokémon", "")
      .replace("This attack does", "This attack also does");
    expect(deriveAttackEffect(benched)).toEqual(program(50, true));
    // …and putting EITHER half back refuses again: the Actives and the self-exclusion are
    // two independent reasons and either is fatal alone.
    expect(deriveAttackEffect(benched.replace("to each Benched Pokémon", "to each Pokémon"))).toBeNull();
    expect(
      deriveAttackEffect(
        benched.replace(
          " (both yours and your opponent's).",
          " (both yours and your opponent's), except for this Pokémon.",
        ),
      ),
    ).toBeNull();
  });

  it("🛑 the price is a rider on `damageDefender`, and the UNION ARITY is what makes it dear", () => {
    // 🛑 **THE FIGURE IS RE-DERIVED FROM THE SOURCE RATHER THAN QUOTED (D465/D466: an
    // instrument that produces a committed figure needs a killer, and a doc figure
    // rots).** A glob rather than `node:fs`, because this package sets `"types": []`.
    const src: Record<string, string> = (
      import.meta as unknown as {
        glob(
          pattern: string,
          options: { query: "?raw"; import: "default"; eager: true },
        ): Record<string, string>;
      }
    ).glob("./{effects,registry}.ts", { query: "?raw", import: "default", eager: true });
    const text = Object.values(src).join("\n");
    expect(Object.keys(src)).toHaveLength(2);
    const declarations = (name: string) => (text.match(new RegExp(`op: "${name}";`, "g")) ?? []).length;
    const producers = (name: string) => (text.match(new RegExp(`op: "${name}",`, "g")) ?? []).length;
    // 🛑 **THE DECIDING NUMBER IS THE UNION ARITY, NOT THE PRODUCER COUNT.**
    // `spreadDamage` is ONE union member, so `damagedOnly?: true` was one line on one
    // shape. `damageDefender` is **TWO** members — `{ per, count, countFilter, base? }`
    // and the flat `{ per?: never; count?: never; countFilter?: never; amount }` — and
    // that union exists precisely to keep those keys apart (*"`amount` STAYS
    // UNREPRESENTABLE BESIDE `per`/`count`, which is the thing the union is actually
    // protecting"*, the op's own block). So a rider on the FLAT arm owes a
    // `damagedOnly?: never` on the other arm in the same edit, or the union stops saying
    // what it was built to say. **That is a change to the union's meaning, not an added
    // key** — a different kind of edit from the one this slice made.
    expect(declarations("spreadDamage")).toBe(1);
    expect(declarations("damageDefender")).toBe(2);
    // ⚠️ **AND THE PRODUCER COUNT IS REPORTED WITH ITS CONFOUND NAMED, BECAUSE THIS
    // SLICE MOVED IT (D427: every note counts the sites it INHERITED and never the ones
    // it is about to AUTHOR).** `damageDefender` has 9 producer sites and `spreadDamage`
    // now has 7 — but 4 of those 7 are arm 6-ii's own two ternary branches, so the
    // pre-slice figure was 3. Quoting "7 against 9" as the argument would be quoting a
    // number this slice manufactured, which is why the ARITY above is the rung that
    // decides and this one is asserted as a RELATION that survives either reading.
    expect(producers("damageDefender")).toBe(9);
    expect(producers("spreadDamage")).toBe(7);
    expect(producers("damageDefender")).toBeGreaterThan(producers("spreadDamage") - 4);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §9 — THE CENSUS THIS SLICE MOVED, AND EVERYTHING IT DID NOT (D496).
// ─────────────────────────────────────────────────────────────────────────────

describe("D507 §9 — the residue, the surface, the version, and what stands still", () => {
  it("🛑 the RAW reader-only residue fell by exactly 2 sentences / 2 printings, and both rows left it", () => {
    const unbuilt = legalAttackCorpus().filter(([, s]) => !resolvedByAnyReader(s));
    expect([unbuilt.length, units(unbuilt)]).toEqual([100, 154]);  // (🆕🆕🆕 **D513 −1 sentence / −1 printing — THE PRINTED *“of different types”*, THE FIRST DISTINCTNESS CONSTRAINT THIS ENGINE READS** — `censusAttackCorpus.ts` **FILE LINE 473**, *"Search your deck for up to 3 Basic Energy cards of different types, reveal them, and put them into your hand. Then, shuffle your deck."*, **1 sentence / 1 legal printing** (Sylveon ex `sv06.5-050`), claimed by `deriveAttackEffect`. 🛑 **THE ANCHOR WAS NEVER THE BLOCKER** — `ATTACK_HAND_SEARCH`'s `([^,.]+?)` noun group has captured `Basic Energy cards of different types` WHOLE since D231 and the sentence died one step later in `HAND_SEARCH_PLURAL.get`, so the new optional group MOVES a phrase out of the noun rather than admitting a sentence the pattern refused (D510's rule, paid a second time). ✅ **ZERO new `CardFilter` members — and no widening of that union could EVER have reached this row**, because `matchesFilter` narrows each card INDEPENDENTLY while *“of different types”* is a predicate on the ANSWER SET. It rides D332's shipped `chooseCards.caps` instead — one cap of ONE per `energyProvidesOf` cell — so **ZERO** new prompt fields, validator branches or client mirrors. `MATCH_RECORD_VERSION` **HELD at 30**.) (🆕🆕🆕 **D512 — THE BOTH-SIDES BODY COUNT NARROWED BY TWO PRINTED NAME FRAGMENTS** — `censusAttackCorpus.ts` **FILE LINE 583**, *"This attack does 40 damage for each Pokémon in play that has \"Koffing\" or \"Weezing\" in its name (both yours and your opponent's)."*, **1 sentence / 2 legal printings**, claimed by `deriveAttackDamageMultiplier` over ONE new anchor, ONE new `CardFilter` member (`pokemonNameContaining`) and ONE new `DamageCountSource` member (`bothSidesPokemonInPlay`). 🛑 **ALL FOUR SHIPPED IN-PLAY ANCHORS WERE RUN AGAINST THE ROW FIRST AND ALL FOUR REFUSE IT AT THE PATTERN** — the opposite answer to D510's, because every one of them requires the literal `for each of your ` and this sentence's head is SEATLESS. −**1 sentence / −2 printings**, so this RAW mirror falls with it.) (🆕🆕🆕 **D510 −1 sentence / −2 printings — THE DISCARD PILE NARROWED BY A PRINTED NAME FRAGMENT** — `censusAttackCorpus.ts` **FILE LINE 543**, *"This attack does 20 damage for each Supporter card that has \"Team Rocket\" in its name in your discard pile."*, **1 sentence / 2 legal printings**, claimed by `deriveAttackDamageMultiplier` through ONE new `CardFilter` member (`supporterNameContaining`) and ONE PARAMETERISED noun in `discardPileFilter` — **ZERO new anchors**, because D440’s shipped `DISCARD_PILE_COUNT_MULTIPLY` had matched this row since it was written and the NOUN RESOLVER was the blocker. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP DISAGREE AT 1 AND 2** — a TWO-printing sentence, the opposite of D508 one entry down, measured at this head rather than carried (D451/D461). RAW summand ALONE: registry 10/16, gate 5/13 and trailing 11/21 all re-measured unmoved.) (🆕🆕🆕 **D508 −1 sentence / −1 printing — THE DISCARD PILE NARROWED BY A PRINTED ATTACK NAME** — `censusAttackCorpus.ts` **FILE LINE 542**, *"This attack does 20 damage for each Pokémon in your discard pile that has the United Wings attack."*, **1 sentence / 1 legal printing**, claimed by `deriveAttackDamageMultiplier` over ONE new anchor (`DISCARD_PILE_ATTACK_NAME_MULTIPLY`) crossing D440's `cardsInDiscardPile` count with D446's `attackNamePokemon` filter — **ZERO new members in either union, ZERO evaluator bytes**. READER summand ALONE; registry, gate and trailing stand still at 10/16, 5/13, 11/21. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1**, measured per site rather than copied between the two kinds of site (D451/D461).) 
    // …and this slice's rows are not in it any more, which is the only way the pair above
    // reads as a measurement of THIS head rather than of a number (D483's move).
    expect(unbuilt.map(([, s]) => s)).not.toContain(PRINTED_BOTH);
    expect(unbuilt.map(([, s]) => s)).not.toContain(PRINTED_DAMAGED);
    // ⚠️ …and the refused sibling IS still in it, which is what makes §8 a refusal rather
    // than a description.
    expect(unbuilt.map(([, s]) => s)).toContain(FOUR_ZONE);
    // ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 2 AND 2** — verified at both
    // kinds of site rather than assumed from the rows being singular (D451/D461).
    const rows = new Map(legalAttackCorpus().map(([n, s]) => [s, n]));
    expect([rows.get(PRINTED_BOTH), rows.get(PRINTED_DAMAGED)]).toEqual([1, 1]);
  });

  it("🛑 the reader surface is still THIRTEEN, derived from the module", () => {
    // D444: `deriveAttack…` is a RESERVED NAMESPACE with nothing but a naming convention
    // behind it, so a new export would enrol itself as a reader and move every figure in
    // the repo at once. This slice added none — the claim is one anchor and one arm
    // inside `deriveAttackEffect`.
    expect(attackReaderSurface()).toHaveLength(13);
    expect(attackReaderSurface()).toContain("deriveAttackEffect");
  });

  it("🛑 NEITHER SPLITTER claims either print — the reader arm is the only claimant", () => {
    for (const text of [PRINTED_BOTH, PRINTED_DAMAGED]) {
      expect(splitAttackGateClause(text)).toBeNull();
      expect(splitAttackTrailingClause(text)).toBeNull();
    }
  });

  it("engineVersion and `manifest.version` agree, and the bump is owed for BEHAVIOUR", () => {
    // Two sentences that derived to `null` derive to programs: `packages/engine` behaviour
    // moved, so the version steps. ⚠️ **THE VERSION IS NOT SPELLED IN THIS `it(…)` TITLE,
    // DELIBERATELY** — index.ts records that 17-to-23 of the ~100 occurrences of the
    // version literal at any head are `it(…)` TITLES, and a suite that spells it in its
    // title adds a site to the tax it is measuring (D460's fourth class).
    expect(engineVersion).toBe(manifest.version);
  });

  it("🛑 what this slice does NOT move, stated as zeroes (D496)", () => {
    // `clauseApostrophe.test.ts` sweeps every derivable `FIXTURE_POOL` sentence CONTAINING
    // an apostrophe. This slice's demonstrator is file-local, so that census must be
    // UNMOVED — and both printed sentences do carry apostrophes, which is why the
    // prediction is about the POOL and not about the string (D425/D460).
    expect(Object.keys(BOTH_BENCH_CARDS).every((id) => FIXTURE_POOL[id] === undefined)).toBe(true);
    // 🛑 **NO `EffectOp` KIND WAS ADDED AND `target` DID NOT GROW**: the only op this
    // slice emits already had its own `stepOp` case, and the census of kinds is what
    // `opcoverage.ts` keys on.
    for (const text of [PRINTED_BOTH, PRINTED_DAMAGED]) {
      const ops = deriveAttackEffect(text) as EffectOp[];
      expect(ops.map((o) => o.op)).toEqual(["spreadDamage", "spreadDamage"]);
      expect(ops.map((o) => (o.op === "spreadDamage" ? o.target : ""))).toEqual([
        "yourBench",
        "opponentBench",
      ]);
    }
  });
});
