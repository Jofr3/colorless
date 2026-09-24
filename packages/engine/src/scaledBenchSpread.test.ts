import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import manifest from "../package.json" with { type: "json" };
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import {
  deriveAttackEffect,
  splitAttackGateClause,
  splitAttackTrailingClause,
} from "./effects";
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
  setPrizes,
} from "./testFixtures";

// 0.394.0 → 0.395.0 — 🆕🆕🆕 D505: THE PRIZE-SCALED BENCH SPREAD, AND THE MISSING CELL
// OF A SHIPPED 2×2.
//
//   "This attack also does 10 damage to each of your opponent's Benched Pokémon for
//    each Prize card your opponent has taken. (Don't apply Weakness and Resistance
//    for Benched Pokémon.)"                                             (3 legal)
//
// `censusAttackCorpus.ts` **FILE LINE 517**, **1 sentence / 3 legal printings** over the
// committed `legal_standard = 1` attack column (640 sentences / 1,732 printings) — the
// largest single printing count left in the residue's spread family, and the row whose
// SENTENCE step (1) and PRINTING step (3) DISAGREE, so a `.length` chain takes `- 1`
// where a `units(…)` chain takes `- 3` (D451, measured in §8 rather than assumed).
//
// 🛑 **THE 2×2, AND WHY THIS IS THE CHEAPEST ROW IN THE RESIDUE RATHER THAN THE
// SMALLEST.** The bench-damage family crosses the printed QUANTIFIER with the printed
// SCALING, and three of the four cells have shipped for a long time:
//
//                       flat                        scaled by taken Prizes
//   `1 of` … Benched    `damageChosen` (D399, 6c)    `damageChosen {perTakenPrize}` (D448, 6b)
//   `each of` … Benched `spreadDamage` (D189/D425, 6) **THIS ROW — arm 6-i**
//
// ⚠️ **AND ONE CELL OF THAT TABLE HAS NO LEGAL PRINTING AT THIS HEAD, WHICH THE PRICE
// BEHIND THIS SLICE DID NOT CARRY.** Wo-Chien ex `sv02-027` "Covetous Ivy" — the sentence
// D448 built arm 6b for — is **not a row of the `legal_standard = 1` column any more**:
// the clause *"for each Prize card your opponent has taken"* appears on FIVE corpus rows
// and not one of them is the `1 of … Benched` spelling (§1 asserts both halves). So the
// scaled `1 of` cell is BUILT, GREEN and census-complete while being executable by
// nothing in the legal pool (D495's shape), and the cell this slice fills is the only
// scaled one with printings behind it. An arm transfers across sets where a registry row
// does not (D180/D187), so 6b is not dead — but *"the scaled snipe already ships at 3
// printings"* would be counting a rotation ago.
//
// So the blocker was never a mechanism. It was **the NAME `perTakenPrize` spelled on a
// second op**: `snipeAmount` (interpreter.ts) takes a STRUCTURAL parameter
// (`{ amount; perTakenPrize?; perEnergyOnSelf?; perRecorded? }`), so the fold it has
// performed since Wo-Chien accepts the widened op UNCHANGED. ⚠️ **AND THE AMOUNT IS
// FOLDED AT THE DISPATCH, NOT INSIDE `spreadDamage`** — `damageSelf`/`recoilAmount`'s
// line two cases down, verbatim: the helper stays *"place this many HP on each benched
// body of that side"* and every scaling rider is visible where the op is read.
//
// ⚠️ **WHAT THIS SLICE COST, NAMED AS ZEROES SO THE CLAIM IS CHECKABLE (§8):** ONE new
// anchor (`SPREAD_EACH_BENCH_TAKEN_PRIZES`), ONE new `deriveAttackEffect` arm (**6-i**),
// ONE OPTIONAL BOOLEAN RIDER on a shipped op (`spreadDamage.perTakenPrize`) and ONE
// widened argument list at the interpreter's dispatch. **ZERO** new `EffectOp` KINDS,
// `EffectSlot` members, `CardFilter`/`DamageCountSource`/`BoardCondition` members,
// readers (the surface stands still at **13**), prompts, prompt fields, choice kinds,
// parks, deciders, events, error codes, `GameState`/`InPlayPokemon` fields, registry
// rows, `FIXTURE_POOL` ids (file-local `cardPool`, D414/D452), `log.ts` bytes,
// `redact.ts` bytes, `packages/schema` bytes and **`MATCH_RECORD_VERSION` bytes**.
//
// 🛑 **`scale?: DamageCountSource` IS REFUSED FOR THE THIRD TIME AND THE REFUSAL GOT
// CHEAPER TO KEEP, NOT DEARER.** D448 measured the collapse at **24 sites across 10
// files plus a `MATCH_RECORD_VERSION` bump** (the rider is a persisted key on a PARKING
// op, so dropping its name is D359's RENAME and not D125's widening); D449 re-applied
// that and D465 re-applied it for exactly this shape. The general form would now have to
// be spelled on TWO ops rather than one — so this slice moves the price in the direction
// that keeps the refusal true, and §2 pins the two riders' spellings side by side so a
// successor can see what the collapse would have to reach.
//
// ─────────────────────────────────────────────────────────────────────────────
// 🛑 **THE LATTICE — A SEVENTH SHAPE, AND §3 IS THE EXECUTABLE FORM (D491/D503).**
//
// Five axes counted FROM THE PRINT, each substituted onto its nearest BUILT spelling,
// all 2⁵ = 32 points, evaluated TWICE — over the thirteen readers alone, and over the
// four-arm residue predicate (readers + registry + both splitters, D444/D503):
//
//   READERS-ONLY        0/1 · 1/5 · 4/10 · 6/10 · 4/5 · 1/1
//   SPLITTER-INCLUSIVE  0/1 · 1/5 · 4/10 · 6/10 · 4/5 · 1/1
//
// **They AGREE at every weight, 0 divergent points of 32**, and structurally as well:
// both splitters return `null` at **32 of 32** points. D503's method rule is therefore
// SATISFIED rather than merely applied — this sentence has no leading `If …,` clause and
// its only second segment is the `(Don't apply …)` parenthetical, which belongs to the
// spread anchor rather than being a second claimable sentence.
//
// 🛑 **AND THE LATTICE FACTORISES: ONE BLOCKING AXIS × A FREE 2⁴.** Axis A1 (the scaling
// clause) flips the verdict at **16 of 16** cells; the other four — seat, amount, the
// W/R rider and the word *also* — flip it at **0 of 16 each**. So all 16 A1-substituted
// points build and NONE of the 16 A1-printed points does, the bit set is 32 and the
// MEANINGFUL point set is **2**. That is a seventh shape on record, distinct from the six
// before it: full-weight-only (D489/D490/D494/D501), every-segment (D495),
// prerequisite-half (D499), single-axis 2¹ (D500), empty-at-every-weight (D502) and
// D503's opposite-conclusions. ⚠️ **It is a claim about the PRICE, not about the axes**:
// a one-axis blocker on an otherwise free lattice is exactly the shape of a row whose
// mechanism already ships, which is why this one cost a name and not a machine.
// ⚠️ **The four inert axes are NOT degenerate in D491's identity sense** — every one of
// the 32 points is a DISTINCT string (§3 asserts it) — they are inert on the VERDICT,
// which is a weaker and more informative statement than D500's byte-twin head axis.

/** The printed sentence, byte for byte. §1 asserts it is a ROW OF THE COMMITTED CORPUS
    and reads its printing count off that corpus rather than typing it (D452/D490: a byte
    pin measures an invention as faithfully as it measures the truth). */
const PRINTED =
  "This attack also does 10 damage to each of your opponent's Benched Pokémon for each Prize card your opponent has taken. (Don't apply Weakness and Resistance for Benched Pokémon.)";

/** The FLAT opponent-side sibling — a printed corpus row at 1 printing, built since the
    op existed. **The control every rung in this file leans on**: without it, "the rider
    is read" is green under a build that puts `perTakenPrize` on every spread. */
const FLAT_OPP =
  "This attack also does 10 damage to each of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";
/** …and its 50-damage twin, a printed corpus row at THREE printings. The two together
    are the 4 printings `D505-anchor-scaling-clause-goes-optional` steals. */
const FLAT_OPP_50 =
  "This attack does 50 damage to each of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";
/** The OWN-side flat spread (D425), a printed corpus row at 3 printings — the seat
    control, and the reason this anchor spells its possessive instead of capturing it. */
const OWN_FLAT =
  "This attack also does 10 damage to each of your Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";
/** The OWN-side SCALED spelling. **Not printed in this column, and it must STAY
    refused** — the falsifier for `D505-anchor-captures-the-possessive`. */
const OWN_SCALED =
  "This attack also does 10 damage to each of your Benched Pokémon for each Prize card your opponent has taken. (Don't apply Weakness and Resistance for Benched Pokémon.)";
/** Wo-Chien ex "Covetous Ivy" (D448), the `1 of` cell of the 2×2 — built, and built to a
    DIFFERENT op. The quantifier and the amount are the only tokens that differ from
    `PRINTED`. ⚠️ **NOT A ROW OF THE LEGAL COLUMN AT THIS HEAD** — §1 asserts that, and it
    is the finding the price behind this slice did not carry. */
const CHOSEN_SCALED =
  "This attack does 60 damage to 1 of your opponent's Benched Pokémon for each Prize card your opponent has taken. (Don't apply Weakness and Resistance for Benched Pokémon.)";
/** The print at a SECOND amount, fielded as a synthetic probe — `covetousIvy.test.ts`'s
    `fix-bramble` move verbatim, and the only thing that pins the interpreter multiplies
    the CAPTURED amount rather than a hard-coded 10 (D121's template warrant, met on a
    population of one by a probe rather than by the pool). */
const SCALED_40 =
  "This attack also does 40 damage to each of your opponent's Benched Pokémon for each Prize card your opponent has taken. (Don't apply Weakness and Resistance for Benched Pokémon.)";

/** The program arm 6-i emits, spelled WHOLE so every rung names every field (D438: a
    boolean is true under the real build and under the near-misses alike). */
const program = (amount: number): readonly EffectOp[] => [
  { op: "spreadDamage", target: "opponentBench", amount, perTakenPrize: true },
];

const SEED = 11;

/** The attack indices, keyed by name so no case addresses a fold by number. */
const AT = {
  scaled: 0,
  flat: 1,
  own: 2,
  scaled40: 3,
  plain: 4,
} as const;

/** 🛑 **THE PRINTED BASE IS 50 AND THE SPREAD LANDS 30 ON THE CRUX BOARD, AND THAT IS A
    BOARD DECISION RATHER THAN A NUMBER (D488).** The word *also* means the printed base
    still lands — `attack.ts`'s `programDamage` reads `damageDefender`, which this program
    does not emit — so every board here reads FOUR `DAMAGE_DEALT` rows and the Active's
    must be distinguishable from the Bench's. At a base of 30 and three taken Prizes the
    two would both be 30 and half the discriminations below would be arithmetic
    coincidences. */
const BASE = 50;

const SPREAD_CARDS: Record<string, Card> = {
  /** `d505-*` keys with no catalog row behind them, kept out of `FIXTURE_POOL` entirely
      by the file-local `cardPool` below (D414/D452), so every id ladder in the repo takes
      a ZERO term from this slice. */
  "d505-drainer": battler("d505-drainer", {
    name: "D505 Drainer",
    types: ["Colorless"],
    hp: 330,
    retreat: 1,
    attacks: [
      { cost: ["Colorless"], name: "Prize Quake", effect: PRINTED, damage: BASE },
      { cost: ["Colorless"], name: "Flat Quake", effect: FLAT_OPP, damage: BASE },
      { cost: ["Colorless"], name: "Home Quake", effect: OWN_FLAT, damage: BASE },
      { cost: ["Colorless"], name: "Big Prize Quake", effect: SCALED_40, damage: BASE },
      // No effect text at all: the control that separates "the program ran and found
      // nothing to do" from "no program ran" on the ZERO-taken board of §5.
      { cost: ["Colorless"], name: "Plain Cuff", damage: BASE },
    ],
  }),
  /** The defender. **NO Weakness**, deliberately: §8.5 applies W/R on the Active and not
      on the Bench, and a ×2 here would make the Active's row a multiple of the base
      rather than the base — a second arithmetic the bench rows would have to be read
      against. Its HP clears the worst case (50 + nothing). */
  "d505-wall": battler("d505-wall", { name: "D505 Wall", types: ["Colorless"], hp: 400 }),
  /** The opponent's Bench: THREE bodies, because *"each of"* against *"1 of"* is the
      whole quantifier axis and a bench of one makes the two agree (D448's
      one-print-fixture rule, applied to a board). Distinct HP so no reading Knocks
      anything out — a KO stops answering a number and starts answering a promotion. */
  "d505-foe-a": battler("d505-foe-a", { name: "D505 Foe A", types: ["Colorless"], hp: 300 }),
  "d505-foe-b": battler("d505-foe-b", { name: "D505 Foe B", types: ["Colorless"], hp: 310 }),
  "d505-foe-c": battler("d505-foe-c", { name: "D505 Foe C", types: ["Colorless"], hp: 320 }),
  /** The ATTACKER's own Bench. Two bodies, and every scaled rung asserts they take ZERO:
      `D505-anchor-captures-the-possessive` and the interpreter's own victim switch are
      both invisible without a board that fields BOTH benches (D425's rule). */
  "d505-ally-a": battler("d505-ally-a", { name: "D505 Ally A", types: ["Colorless"], hp: 300 }),
  "d505-ally-b": battler("d505-ally-b", { name: "D505 Ally B", types: ["Colorless"], hp: 310 }),
};

const SPREAD_POOL: Record<string, Card> = { ...FIXTURE_POOL, ...SPREAD_CARDS };

/** Its own deck (D270), 60 counted before the first run: 7×8 + 4. */
const SPREAD_DECK = deckOf({
  "d505-drainer": 8,
  "d505-wall": 8,
  "d505-foe-a": 8,
  "d505-foe-b": 8,
  "d505-foe-c": 8,
  "d505-ally-a": 8,
  "d505-ally-b": 8,
  "fix-energy": 4,
});

function openTable(first: Seat): GameState {
  const created = createGame({ seed: SEED, decks: { p1: SPREAD_DECK, p2: SPREAD_DECK }, cardPool: SPREAD_POOL });
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

/** p1 owns TURN 2 with the Drainer Active. **BOTH benches are cleared before anything is
    placed** and both Prize piles are set explicitly: every figure here is a POPULATION
    over a board, so a body the setup shuffle happened to place, or a Prize pile left at
    its default, would move an answer silently (`OWN_BENCH_SPREAD_DECK`'s rule).
    `oppRemaining` / `ownRemaining` are the Prize CARDS LEFT, so the printed *"has
    taken"* is `6 − remaining`. */
function table(oppRemaining = 3, ownRemaining = 6): GameState {
  let state = openTable("p2");
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  expect(state.turn).toBe(2);
  state = setActiveFromDeck(state, "p1", "d505-drainer");
  state = setActiveFromDeck(state, "p2", "d505-wall");
  state = clearBench(state, "p1");
  state = clearBench(state, "p2");
  state = attachFromDeck(state, "p1", "fix-energy", 2);
  for (const id of ["d505-foe-a", "d505-foe-b", "d505-foe-c"]) state = benchFromDeck(state, "p2", id);
  for (const id of ["d505-ally-a", "d505-ally-b"]) state = benchFromDeck(state, "p1", id);
  state = setPrizes(state, "p2", oppRemaining);
  return setPrizes(state, "p1", ownRemaining);
}

function swing(state: GameState, index: number) {
  return mustApply(state, { type: "attack", seat: "p1", index });
}

/** `[active, ...bench]` damage — the whole discrimination of §4 to §6. */
function damageVector(state: GameState, seat: Seat): number[] {
  const side = state.players[seat];
  return [side.active?.damage ?? -1, ...side.bench.map((b) => b.damage)];
}

function damageRows(events: GameEvent[]): { seat: Seat; by: Seat; base: number; dealt: number }[] {
  return events.flatMap((e) =>
    e.type === "DAMAGE_DEALT" ? [{ seat: e.seat, by: e.by, base: e.base, dealt: e.dealt }] : [],
  );
}

function units(rows: readonly (readonly [number, string])[]): number {
  return rows.reduce((sum, [n]) => sum + n, 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// §1 — THE PRINTED DATA, AND ALL FIVE ANCHOR VARIANTS MEASURED OVER THE COLUMN.
// ─────────────────────────────────────────────────────────────────────────────

describe("D505 §1 — the corpus row, the apostrophe bytes, and every anchor variant", () => {
  it("🛑 the specimen IS a row of `legalAttackCorpus()`, at the printing count the corpus states", () => {
    // D452/D490's standing rule: assert MEMBERSHIP and read the count off the corpus
    // instead of typing it. The FILE LINE is cited because this checkout has no catalog.
    const rows = new Map(legalAttackCorpus().map(([n, s]) => [s, n]));
    expect(rows.get(PRINTED)).toBe(3);
    // …and so are all four printed neighbours the rungs below lean on.
    expect(rows.get(FLAT_OPP)).toBe(1);
    expect(rows.get(FLAT_OPP_50)).toBe(3);
    expect(rows.get(OWN_FLAT)).toBe(3);
    // 🛑 **AND A FINDING THE BRIEF DID NOT CARRY: THE `1 of` SCALED CELL OF THE 2×2 HAS
    // ZERO LEGAL PRINTINGS AT THIS HEAD.** Wo-Chien ex `sv02-027` "Covetous Ivy" is what
    // D448 built arm 6b for, and its sentence is **not a row of the `legal_standard = 1`
    // column any more** — the whole clause appears on five corpus rows and not one of them
    // is the `1 of … Benched` spelling. So the shipped half of this 2×2 is a family that is
    // BUILT, GREEN and census-complete while being **executable by nothing in the legal
    // pool** (D495's shape), and the cell this slice fills is the only one of the two scaled
    // cells with a printing behind it. ⚠️ An arm transfers across sets where a registry row
    // does not (D180/D187), so 6b is not dead code — but a price that read *"the scaled
    // snipe already ships at 3 printings"* would have been counting a rotation ago.
    expect(rows.has(CHOSEN_SCALED)).toBe(false);
    expect(legalAttackCorpus().filter(([, s]) => s.includes("Prize card your opponent has taken"))).toHaveLength(5);
    // ⚠️ The two SYNTHETIC strings are NOT corpus rows and are asserted not to be, so a
    // reader of this file cannot mistake a probe for a printing (D440/D452).
    expect(rows.has(OWN_SCALED)).toBe(false);
    expect(rows.has(SCALED_40)).toBe(false);
  });

  it("🛑 both apostrophes are U+0027, measured with `codePointAt` and not by eye", () => {
    // D421 asserted this family's byte from memory and was wrong; D425/D440 measured it.
    // TWO slots here — the possessive and the contraction — where the own-side sibling
    // has only the contraction, which is exactly the token D425 turned into a capture.
    const slots = [...PRINTED].flatMap((c, i) => (c === "'" || c === "\u2019" ? [[i, c.codePointAt(0)]] : []));
    expect(slots).toEqual([
      [56, 0x27],
      [124, 0x27],
    ]);
    expect(PRINTED).not.toContain("\u2019");
    expect(PRINTED).toContain("Pok\u00e9mon");
  });

  it("🛑 the four anchor variants claim the IDENTICAL 1 sentence / 3 printings — so three of them are pure risk", () => {
    // D472's rule, run as a measurement and not as an argument: before generalising an
    // anchor, measure what the generalisation would claim. Here the narrow form and all
    // three generalisations return the SAME row set over all 640 corpus rows, so every
    // generality buys nothing — and two of them have named risks (`D425-spread-side-flips`
    // for the possessive; nothing for the mandatory-W/R direction, which is why the tail
    // stays optional to match the sibling rather than to gain a row).
    const WR = "(?: \\(Don['\u2019]t apply Weakness and Resistance for Benched Pokémon\\.\\))?";
    const WR_MANDATORY = " \\(Don['\u2019]t apply Weakness and Resistance for Benched Pokémon\\.\\)";
    const SCALE = " for each Prize card your opponent has taken";
    const claims = (re: RegExp) => {
      const hit = legalAttackCorpus().filter(([, s]) => re.test(s));
      return [hit.length, units(hit)];
    };
    const narrow = new RegExp(`^This attack (?:also )?does (\\d+) damage to each of your opponent['\u2019]s Benched Pokémon${SCALE}\\.${WR}$`);
    const widePossessive = new RegExp(`^This attack (?:also )?does (\\d+) damage to each of (your opponent['\u2019]s|your) Benched Pokémon${SCALE}\\.${WR}$`);
    const alsoMandatory = new RegExp(`^This attack also does (\\d+) damage to each of your opponent['\u2019]s Benched Pokémon${SCALE}\\.${WR}$`);
    const wrMandatory = new RegExp(`^This attack (?:also )?does (\\d+) damage to each of your opponent['\u2019]s Benched Pokémon${SCALE}\\.${WR_MANDATORY}$`);
    expect(claims(narrow)).toEqual([1, 3]);
    expect(claims(widePossessive)).toEqual([1, 3]);
    expect(claims(alsoMandatory)).toEqual([1, 3]);
    expect(claims(wrMandatory)).toEqual([1, 3]);
    // 🛑 **AND THE ONE VARIANT THAT IS NOT FREE IN EITHER DIRECTION.** Refusing the word
    // *also* costs the row OUTRIGHT — the single printed sentence carries it — so this is
    // the axis on which D482's decision for `SPREAD_EACH_OPPONENT_POKEMON` had to be
    // INVERTED rather than copied. The discriminator is which op the arm emits: D482's
    // emits a `damageDefender`, which `programDamage` reads to DROP the printed base;
    // this one emits `spreadDamage` alone, so the base rides the `damage` field either
    // way and the word claims nothing (§4 drives that).
    const alsoRefused = new RegExp(`^This attack does (\\d+) damage to each of your opponent['\u2019]s Benched Pokémon${SCALE}\\.${WR}$`);
    expect(claims(alsoRefused)).toEqual([0, 0]);
    // 🛑 **AND THE OPTIONAL-SCALE FORM — THE MUTANT — CLAIMS 3 SENTENCES / 7 PRINTINGS.**
    // Written as an optional group on the sibling anchor it steals the two FLAT
    // opponent-side rows and hands all FOUR of their printings a `perTakenPrize` they do
    // not print: a wrong program, not a widening. This is the measurement behind
    // `D505-anchor-scaling-clause-goes-optional` and behind the arm's placement.
    const scaleOptional = new RegExp(`^This attack (?:also )?does (\\d+) damage to each of your opponent['\u2019]s Benched Pokémon(?:${SCALE})?\\.${WR}$`);
    expect(claims(scaleOptional)).toEqual([3, 7]);
  });

  it("AUTHORS nothing — the three legal printings are read off the TEXT, not from a registry row", () => {
    // A registry-authored program wins over the reader (D8), so this is the claim that
    // says the derived path is the one every rung below drives. The demonstrator is
    // file-local and therefore cannot have a registry row at all; what is asserted is
    // that the printed SENTENCE is claimed by the reader surface.
    expect(resolvedByAnyReader(PRINTED)).toBe(true);
    expect(deriveAttackEffect(PRINTED)).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — THE READER: ONE RIDER, AND THE FOUR NEIGHBOURS THAT MUST NOT GAIN IT.
// ─────────────────────────────────────────────────────────────────────────────

describe("D505 §2 — the rider is read, and every neighbour is read WITHOUT it", () => {
  it("🛑 the print derives to ONE `spreadDamage` carrying `perTakenPrize`, spelled whole", () => {
    expect(deriveAttackEffect(PRINTED)).toEqual(program(10));
    // The amount is a CAPTURE and not a literal 10 — the probe amount is the witness.
    expect(deriveAttackEffect(SCALED_40)).toEqual(program(40));
  });

  it("🛑 …and the FLAT siblings are UNMOVED — the control without which the rung above is a tautology", () => {
    // D424: every rung that reads a rider owes a neighbouring rung that reads its
    // absence, or it passes under a build that puts the rider on everything. All three
    // printed flat rows, at three amounts and both seats.
    expect(deriveAttackEffect(FLAT_OPP)).toEqual([
      { op: "spreadDamage", target: "opponentBench", amount: 10 },
    ]);
    expect(deriveAttackEffect(FLAT_OPP_50)).toEqual([
      { op: "spreadDamage", target: "opponentBench", amount: 50 },
    ]);
    expect(deriveAttackEffect(OWN_FLAT)).toEqual([
      { op: "spreadDamage", target: "yourBench", amount: 10 },
    ]);
    // None of the three carries the key AT ALL — an explicit `perTakenPrize: undefined`
    // would be a different byte string in a persisted record (D135's absent-not-false).
    for (const flat of [FLAT_OPP, FLAT_OPP_50, OWN_FLAT]) {
      const ops = deriveAttackEffect(flat) as EffectOp[];
      expect(Object.hasOwn(ops[0] ?? {}, "perTakenPrize")).toBe(false);
    }
  });

  it("🛑 the OWN-SIDE scaled spelling is REFUSED, and that is this anchor's spelled possessive", () => {
    // ⚠️ **THE FALSIFIER FOR `D505-anchor-captures-the-possessive`, AND THE ONLY THING
    // THAT REFUSES IT.** The wide form claims the same corpus rows (§1), so no positive
    // case can reveal it: the own-side scaled wording is not printed in this column, and
    // if it ever is it earns a capture and a ternary rather than this arm (D472/D482).
    expect(deriveAttackEffect(OWN_SCALED)).toBeNull();
    // …with its ADMITTED neighbour on the SAME axis (D424) one token away.
    expect(deriveAttackEffect(PRINTED)).not.toBeNull();
  });

  it("🛑 the `1 of` cell of the 2×2 still derives to the OTHER op — the quantifier is the only difference", () => {
    // The two scaled cells share a rider NAME and nothing else: `damageChosen` PARKS and
    // asks for a target; `spreadDamage` asks nothing and hits every benched body. A build
    // that routed one sentence to the other op is caught here and nowhere else.
    expect(deriveAttackEffect(CHOSEN_SCALED)).toEqual([
      {
        op: "damageChosen",
        target: "opponentBench",
        amount: 60,
        count: 1,
        source: "attack",
        deals: true,
        perTakenPrize: true,
      },
    ]);
  });

  it("refuses the near-misses — and ADMITS one on the same axis beside each (D424)", () => {
    const pairs: readonly (readonly [string, string])[] = [
      // the quantifier: a word neither anchor spells
      ["`all of` (a quantifier neither anchor is keyed on)", PRINTED.replace("each of", "all of")],
      // the scaling NOUN: the sibling rider's source, which this anchor does not admit
      ["the ENERGY scale (`perEnergyOnSelf`'s clause)", PRINTED.replace("for each Prize card your opponent has taken", "for each Energy attached to this Pokémon")],
      // the lookalike é falls off the path silently, which is the family's standing reason
      ["a lookalike `Pokemon`", PRINTED.replace(/Pokémon/g, "Pokemon")],
      // no leading `This attack`: a mid-sentence clause must not reach this path
      ["a mid-sentence clause", `Flip a coin. ${PRINTED}`],
      // the lower-case leading word: this family carries no `/i`
      ["a lower-case leading `this`", PRINTED.replace("This attack", "this attack")],
      // a missing terminator, and TRAILING text past the `$`
      ["no sentence terminator", PRINTED.replace(". (Don't", " (Don't")],
      ["trailing text past the `$`", `${PRINTED} Draw a card.`],
    ];
    for (const [why, refused] of pairs) {
      expect(deriveAttackEffect(refused), `REFUSED: ${why}`).toBeNull();
      expect(deriveAttackEffect(PRINTED), `ADMITTED beside ${why}`).not.toBeNull();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — THE LATTICE, IN THE EXECUTABLE FORM (D491), RUN OVER BOTH PREDICATES (D503).
// ─────────────────────────────────────────────────────────────────────────────

/** The five axes counted FROM THE PRINT, index 0 = the PRINTED value, index 1 = its
    nearest BUILT spelling. ⚠️ **A1's built spelling is the ABSENCE of the clause** and
    that is not a cheat: the flat spread is a printed corpus row (§1), so the substituted
    point is a sentence a reader really could claim — which is exactly D489's requirement
    that every lattice point be a sentence some reader could in principle claim. */
const AXES = {
  scale: [" for each Prize card your opponent has taken", ""],
  seat: ["your opponent's", "your"],
  amount: ["10", "30"],
  wr: [" (Don't apply Weakness and Resistance for Benched Pokémon.)", ""],
  also: ["also ", ""],
} as const;

type Bit = 0 | 1;
const BITS: readonly Bit[] = [0, 1];

function latticePoint(a: Bit, s: Bit, n: Bit, w: Bit, o: Bit): string {
  return `This attack ${AXES.also[o]}does ${AXES.amount[n]} damage to each of ${AXES.seat[s]} Benched Pokémon${AXES.scale[a]}.${AXES.wr[w]}`;
}

/** The FOUR-ARM residue predicate's readable half — readers, plus BOTH splitters
    composed the way `censusAtHead.test.ts`'s `residueSentences` filter composes them
    (D444: `!resolvedByAnyReader` is not the unbuilt set). The registry arm is keyed on
    card ids and cannot claim a constructed string, so it is stated rather than run. */
function buildsHere(text: string): boolean {
  if (resolvedByAnyReader(text)) return true;
  const gate = splitAttackGateClause(text);
  // 🆕 D529 — widened with the census: a clause-only split (`body: ""`) is credited to the
  // gate arm. No lattice point here is a gate clause, so no table below can move (run to prove).
  if (gate !== null && (gate.body === "" || resolvedByAnyReader(gate.body))) return true;
  return splitAttackTrailingClause(text) !== null;
}

/** 🛑 **A LATTICE RUN AFTER THE BUILD IS NOT THE LATTICE (D491), AND THIS FUNCTION IS
    WHY THE TABLES BELOW ARE THE PRE-STATE.** The vector the slice reports is the one that
    justified the build, so it has to be the verdict as it stood BEFORE arm 6-i existed —
    and quoting it as prose is the unfalsifiable claim D465 forbids. So the old verdict is
    DERIVED from the current one by subtracting exactly the points the new arm claims, and
    a point is one of those iff its program is a `spreadDamage` carrying `perTakenPrize`.
    ⚠️ **KEYED ON THE RIDER AND NOT ON THE ANCHOR**, which is the stronger form: the anchor
    is module-private, and a successor that widened it across a point this lattice records
    as refused reddens the second half of §3 rather than slipping past a name. */
function claimedByTheNewArm(text: string): boolean {
  return (deriveAttackEffect(text) ?? []).some(
    (op) => op.op === "spreadDamage" && op.perTakenPrize === true,
  );
}

function vector(pred: (t: string) => boolean): { built: number[]; total: number[] } {
  const built = [0, 0, 0, 0, 0, 0];
  const total = [0, 0, 0, 0, 0, 0];
  for (const a of BITS)
    for (const s of BITS)
      for (const n of BITS)
        for (const w of BITS)
          for (const o of BITS) {
            const point = latticePoint(a, s, n, w, o);
            const weight = a + s + n + w + o;
            total[weight] = (total[weight] ?? 0) + 1;
            // The PRE-SLICE verdict: built now, minus what arm 6-i is responsible for.
            if (pred(point) && !claimedByTheNewArm(point)) built[weight] = (built[weight] ?? 0) + 1;
          }
  return { built, total };
}

/** The same subtraction applied to a single point, so the flip table below is the
    pre-state too and not a table about this slice's own anchor. */
function builtBefore(point: string): boolean {
  return buildsHere(point) && !claimedByTheNewArm(point);
}

describe("D505 §3 — the 2⁵ axis-substitution lattice, over BOTH predicates", () => {
  it("🛑 the print is weight 0 and every one of the 32 points is a DISTINCT string", () => {
    expect(latticePoint(0, 0, 0, 0, 0)).toBe(PRINTED);
    // ⚠️ D502's artefact, checked rather than inherited: a DEGENERATE axis (two identical
    // values) makes the point set smaller than the bit set, and reporting a 2⁵ table that
    // is really a 2⁴ one twice over is how a lattice lies. Not the case here.
    const points = new Set(
      BITS.flatMap((a) =>
        BITS.flatMap((s) => BITS.flatMap((n) => BITS.flatMap((w) => BITS.map((o) => latticePoint(a, s, n, w, o))))),
      ),
    );
    expect(points.size).toBe(32);
    for (const axis of Object.values(AXES)) expect(axis[0]).not.toBe(axis[1]);
  });

  it("🛑 READERS-ONLY reads `0/1 · 1/5 · 4/10 · 6/10 · 4/5 · 1/1`", () => {
    const { built, total } = vector(resolvedByAnyReader);
    expect(total).toEqual([1, 5, 10, 10, 5, 1]);
    expect(built).toEqual([0, 1, 4, 6, 4, 1]);
    // Exactly half the lattice builds, which is the arithmetic signature of one blocking
    // axis on an otherwise free 2⁴ — see the rung two down.
    expect(built.reduce((x, y) => x + y)).toBe(16);
  });

  it("🛑 SPLITTER-INCLUSIVE reads the SAME vector, and the splitters are null at 32 of 32", () => {
    // 🛑 **D503's METHOD RULE, SATISFIED RATHER THAN MERELY APPLIED.** D503 ran both
    // lattices and they reached OPPOSITE conclusions; here they agree at every weight and
    // at every point, and the structural reason is asserted beside the count: this
    // sentence has no leading `If …,` clause and its only second segment is the W/R
    // parenthetical, which belongs to the spread anchor rather than being a second
    // claimable sentence.
    const { built, total } = vector(buildsHere);
    expect(total).toEqual([1, 5, 10, 10, 5, 1]);
    expect(built).toEqual([0, 1, 4, 6, 4, 1]);
    let divergent = 0;
    let bothNull = 0;
    for (const a of BITS)
      for (const s of BITS)
        for (const n of BITS)
          for (const w of BITS)
            for (const o of BITS) {
              const point = latticePoint(a, s, n, w, o);
              const readersOnly = resolvedByAnyReader(point) && !claimedByTheNewArm(point);
              if (readersOnly !== builtBefore(point)) divergent++;
              if (splitAttackGateClause(point) === null && splitAttackTrailingClause(point) === null) bothNull++;
            }
    expect(divergent).toBe(0);
    expect(bothNull).toBe(32);
  });

  it("🛑 THE FACTORISATION: A1 flips the verdict at 16/16 cells and the other four at 0/16 each", () => {
    // 🛑 **THE SEVENTH LATTICE SHAPE, WRITTEN AS AN ASSERTION RATHER THAN AS PROSE
    // (D500's lesson — a builder that dies must leave its reasoning recoverable).** One
    // blocking axis × a free 2⁴: all 16 A1-substituted points build, none of the 16
    // A1-printed points does, the bit set is 32 and the meaningful point set is 2.
    const names = ["scale", "seat", "amount", "wr", "also"] as const;
    const flips: Record<string, [number, number]> = {};
    for (let axis = 0; axis < 5; axis++) {
      let moved = 0;
      let cells = 0;
      for (const a of BITS)
        for (const s of BITS)
          for (const n of BITS)
            for (const w of BITS)
              for (const o of BITS) {
                const bits: Bit[] = [a, s, n, w, o];
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
      scale: [16, 16],
      seat: [0, 16],
      amount: [0, 16],
      wr: [0, 16],
      also: [0, 16],
    });
    // …and the two SEPARATING BOARDS, spelled out so the factorisation is readable from
    // the strings and not only from the counts: A1 printed ⇒ refused at full substitution
    // of the other four; A1 substituted ⇒ built at ZERO substitution of the other four.
    expect(builtBefore(latticePoint(0, 1, 1, 1, 1))).toBe(false);
    expect(builtBefore(latticePoint(1, 0, 0, 0, 0))).toBe(true);
    // 🛑 **AND THE SECOND HALF OF D491's RUNG: THE POINTS THE NEW ARM CLAIMS ARE EXACTLY
    // THE 8 THIS LATTICE RECORDS AS REFUSED** — A1 printed × the opponent seat × the free
    // 2³. A successor that widened the anchor across any other point reddens here, which
    // is what makes the subtraction above honest rather than circular.
    const claimed = new Set<string>();
    for (const a of BITS)
      for (const s of BITS)
        for (const n of BITS)
          for (const w of BITS)
            for (const o of BITS) {
              const point = latticePoint(a, s, n, w, o);
              if (claimedByTheNewArm(point)) claimed.add(point);
            }
    const expected = new Set<string>();
    for (const n of BITS) for (const w of BITS) for (const o of BITS) expected.add(latticePoint(0, 0, n, w, o));
    expect(claimed.size).toBe(8);
    expect([...claimed].sort()).toEqual([...expected].sort());
    expect(claimed.has(PRINTED)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — THE BOARD: THE SPREAD SCALES, THE BASE STILL LANDS, THE OWN BENCH DOES NOT.
// ─────────────────────────────────────────────────────────────────────────────

describe("D505 §4 — three taken Prizes, three benched bodies, one printed base", () => {
  it("🛑 each of the three benched bodies takes `10 × 3`, and the Active takes the printed base", () => {
    const { state: done, events } = swing(table(3), AT.scaled);
    expect(damageVector(done, "p2")).toEqual([BASE, 30, 30, 30]);
    // 🛑 **THE FLAT READING IS A DIFFERENT VECTOR ON THIS BOARD**, which is what makes
    // this a measurement of the rider rather than of the op: a build that dropped
    // `perTakenPrize` deals 10 to each and every other number here is identical.
    expect(damageVector(done, "p2")).not.toEqual([BASE, 10, 10, 10]);
    // FOUR rows, the Active's first (§8.5 resolves the Active Spot before anything
    // splashes), each naming the DAMAGED body's owner and the ATTACKER as the dealer.
    expect(damageRows(events)).toEqual([
      { seat: "p2", by: "p1", base: BASE, dealt: BASE },
      { seat: "p2", by: "p1", base: 30, dealt: 30 },
      { seat: "p2", by: "p1", base: 30, dealt: 30 },
      { seat: "p2", by: "p1", base: 30, dealt: 30 },
    ]);
  });

  it("🛑 the ATTACKER's own Bench takes NOTHING — the seat rung, which needs both benches fielded", () => {
    const { state: done } = swing(table(3), AT.scaled);
    expect(damageVector(done, "p1")).toEqual([0, 0, 0]);
    // …and the own-side FLAT sibling on the identical board hits the other way, which is
    // the control that stops the rung above from passing on a build that spreads nowhere.
    const { state: home } = swing(table(3), AT.own);
    expect(damageVector(home, "p1")).toEqual([0, 10, 10]);
    expect(damageVector(home, "p2")).toEqual([BASE, 0, 0, 0]);
  });

  it("🛑 the printed base STILL LANDS, which is what the word `also` buys and what D482 could not have", () => {
    // `attack.ts`'s `programDamage` is `program?.some((step) => step.op === "damageDefender")`.
    // This program emits none, so the printed 50 rides the attack's own `damage` field —
    // the reason `(?:also )?` is admitted here and refused by `SPREAD_EACH_OPPONENT_POKEMON`.
    // The control is the effect-free attack on the same board: same base, no splash.
    const { state: plain } = swing(table(3), AT.plain);
    expect(damageVector(plain, "p2")).toEqual([BASE, 0, 0, 0]);
    const { state: scaled } = swing(table(3), AT.scaled);
    expect(damageVector(scaled, "p2")[0]).toBe(damageVector(plain, "p2")[0]);
  });

  it("🛑 the AMOUNT is the capture: the 40-probe deals `40 × 3` on the same board", () => {
    const { state: done } = swing(table(3), AT.scaled40);
    expect(damageVector(done, "p2")).toEqual([BASE, 120, 120, 120]);
  });

  it("…and the FLAT opponent-side sibling on the same board deals a flat 10 — the pair is the finding", () => {
    const { state: done } = swing(table(3), AT.flat);
    expect(damageVector(done, "p2")).toEqual([BASE, 10, 10, 10]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — THE ZERO-TAKEN BOARD: THE SILENT WHIFF, THROUGH A SHIPPED EARLY RETURN.
// ─────────────────────────────────────────────────────────────────────────────

describe("D505 §5 — nothing taken, nothing dealt, and no row filed", () => {
  it("🛑 an opponent who has taken NO Prizes takes no spread at all", () => {
    // The fold returns `10 × 0`, and `spreadDamage`'s own first line refuses `amount <= 0`
    // — which is why arm 6-i carries no `per >= 1` guard where the `1 of` sibling does
    // (that one would otherwise build a PROMPT over a 0-damage pick).
    const { state: done, events } = swing(table(6), AT.scaled);
    expect(damageVector(done, "p2")).toEqual([BASE, 0, 0, 0]);
    // ONE row, the main hit. No benched row is filed at all — the whiff is silent in the
    // log as well as on the board.
    expect(damageRows(events)).toEqual([{ seat: "p2", by: "p1", base: BASE, dealt: BASE }]);
  });

  it("…and the FLAT sibling on the SAME board still deals 10 — the attribution control (D214)", () => {
    // Without this, "no benched damage" above is green on a build where `spreadDamage`
    // stopped working entirely.
    const { state: done } = swing(table(6), AT.flat);
    expect(damageVector(done, "p2")).toEqual([BASE, 10, 10, 10]);
  });

  it("🛑 one taken Prize is the ARITHMETIC COINCIDENCE board, and it is named rather than used", () => {
    // ⚠️ **AT EXACTLY ONE TAKEN PRIZE THE SCALED AND FLAT READINGS ARE THE SAME VECTOR**
    // (10 × 1 = 10), so a suite whose only board had `remaining = 5` would be green under
    // `D505-arm-drops-the-scaling-rider` (D488's rule: where two programs agree by
    // arithmetic identity, the finding is WHICH BOARD to write). Asserted, so the
    // coincidence is on the record instead of being avoided by luck.
    const { state: scaled } = swing(table(5), AT.scaled);
    const { state: flat } = swing(table(5), AT.flat);
    expect(damageVector(scaled, "p2")).toEqual(damageVector(flat, "p2"));
    expect(damageVector(scaled, "p2")).toEqual([BASE, 10, 10, 10]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — THE SEAT THE FOLD READS, AND THE SEAT THE SPREAD HITS.
// ─────────────────────────────────────────────────────────────────────────────

describe("D505 §6 — two seats, two Prize counts, and the coincidence that hides a defect", () => {
  it("🛑 the fold counts the OPPONENT's taken Prizes, on a board where the two seats differ", () => {
    // 🛑 **THE DEFECT THIS BOARD EXISTS FOR.** `snipeAmount` folds
    // `takenPrizes(state, otherSeat(ctx.seat))` and `spreadDamage`'s victim is ALSO
    // `otherSeat(ctx.seat)`, so on every board where the two seats have taken the same
    // number of Prizes the two reads are indistinguishable. Here p1 has taken 5 and p2
    // has taken 3: correct is 10 × 3 = 30, and a fold that asked `ctx.seat` would deal
    // 10 × 5 = 50. The killer for `D505-fold-counts-your-own-taken-prizes`.
    const board = table(3, 1);
    expect(board.players.p1.prizes).toHaveLength(1);
    expect(board.players.p2.prizes).toHaveLength(3);
    const { state: done } = swing(board, AT.scaled);
    expect(damageVector(done, "p2")).toEqual([BASE, 30, 30, 30]);
    expect(damageVector(done, "p2")).not.toEqual([BASE, 50, 50, 50]);
  });

  it("🛑 the spread's VICTIM is the opponent's Bench, and the switch's opponent arm had no row for 80 decisions", () => {
    // ⚠️ **D497's PAIR RULE, PAID ON A SHIPPED SWITCH.** D425 wrote a mutant for the
    // `yourBench` arm of `spreadDamage`'s victim switch and none for the `opponentBench`
    // arm — the one EVERY producer in the engine takes. `D505-spread-victim-opponent-arm-
    // flips` is that half, and this is its killer: both benches are fielded and both are
    // read, so an inverted arm moves the WRONG board while every event stays truthful.
    const { state: done } = swing(table(3, 1), AT.scaled);
    expect(damageVector(done, "p1")).toEqual([0, 0, 0]);
    expect(damageVector(done, "p2")).toEqual([BASE, 30, 30, 30]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7 — `MATCH_RECORD_VERSION` STAYS 30, ADDRESS FIRST AND BOTH HALVES DRIVEN.
// ─────────────────────────────────────────────────────────────────────────────

describe("D505 §7 — the record constant, argued at the address and driven over v30 bytes", () => {
  // 🛑 **THE ADDRESS, NAMED FIRST (D456).** An `EffectOp` reaches persisted storage at
  // exactly one place: `MatchRecord.state.phase.cont`, an `EffectContinuation`
  // (interpreter.ts) whose `pendingOp` is the op awaiting a choice and whose `rest` is
  // the ops behind it. Both are written only on a PARK.
  //
  // ⚠️ **HALF ONE — REACHABILITY IS EMPTY, AND IT IS DRIVEN AT BOTH DOORS (D450/D452).**
  // `spreadDamage`'s `stepOp` arm returns `{ done }` unconditionally, so it can never be
  // a `pendingOp`; and `rest` holds only what sits BEHIND a park, which needs an earlier
  // op in the same program, where arm 6-i returns a program of LENGTH ONE. Both facts are
  // asserted below rather than read off this paragraph.
  //
  // ⚠️ **HALF TWO — AND IT IS THE ARGUMENT THAT DOES NOT DEPEND ON TODAY'S PRODUCERS.**
  // `perTakenPrize` is an ADDED OPTIONAL key, which is D125/D334's WIDENING: every record
  // a v30 deploy has already written stays valid and means exactly what it meant, because
  // ABSENT is the flat spread — which is what both older `spreadDamage` producers emit.
  // D441's discriminator (*does the absent key still say what the old writer meant*)
  // answers YES. The LOSS direction is named rather than left implicit: a dropped rider
  // deals `amount` where the card prints `amount × N`, a plausible wrong answer rather
  // than a throw. It is unreachable by half one, and it is driven below anyway.
  //
  // ⚠️ The constant itself lives in `apps/api/src/lobby/match.ts` and is not exported
  // from this package, so it is not imported here; what IS driven is the claim it
  // protects.
  const ctx = { seat: "p1" as Seat, invokedBy: "attack" as const };

  /** The v30 spelling of the same op, reconstructed BY HAND and LABELLED as constructed
      (D440) — a byte string a v30 deploy really could have written, differing from this
      slice's output in exactly ONE key. */
  const V30_SPREAD = {
    op: "spreadDamage",
    target: "opponentBench",
    amount: 10,
  } as unknown as EffectOp;

  it("🛑 the two ops differ in exactly ONE key, and the v30 bytes survive a JSON round trip", () => {
    const derived = (deriveAttackEffect(PRINTED) as EffectOp[])[0];
    if (derived === undefined) throw new Error("expected a program");
    const differing = Object.keys(derived).filter(
      (k) =>
        JSON.stringify((derived as unknown as Record<string, unknown>)[k]) !==
        JSON.stringify((V30_SPREAD as unknown as Record<string, unknown>)[k]),
    );
    expect(differing).toEqual(["perTakenPrize"]);
    expect(JSON.parse(JSON.stringify(V30_SPREAD))).toEqual(V30_SPREAD);
    // The program is LENGTH ONE, which is the `rest` door closed (D465's first-position
    // form). A `- 1`-length claim would be a fact about the arm; this is the arm.
    expect(deriveAttackEffect(PRINTED)).toHaveLength(1);
  });

  it("🛑 the op NEVER PARKS — `runProgram` answers `done` on a board with three candidates", () => {
    // The `pendingOp` door closed, driven rather than argued. Three benched bodies is a
    // board on which the CHOSEN sibling one cell over genuinely parks, so this is not
    // vacuous on an empty bench.
    const state = table(3);
    const events: GameEvent[] = [];
    const run = runProgram(state, deriveAttackEffect(PRINTED) as EffectOp[], ctx, events);
    expect(run.kind).toBe("done");
    // …and the whole attack resolves without an `effect:choose` phase either.
    expect(swing(state, AT.scaled).state.phase.kind).not.toBe("effect:choose");
  });

  it("🛑 a v30 `spreadDamage` WITHOUT the rider still means the flat spread on the same board", () => {
    // The LOSS direction. Three taken Prizes, so the two readings differ by 20 HP per
    // body and the rung cannot pass by accident.
    const state = table(3);
    const events: GameEvent[] = [];
    const run = runProgram(state, [V30_SPREAD], ctx, events);
    if (run.kind !== "done") throw new Error("expected done");
    expect(damageVector(run.state, "p2")).toEqual([0, 10, 10, 10]);
  });

  it("🛑 …and the NEW bytes on the SAME board answer differently — both directions or neither (D441)", () => {
    const state = table(3);
    const events: GameEvent[] = [];
    const run = runProgram(state, deriveAttackEffect(PRINTED) as EffectOp[], ctx, events);
    if (run.kind !== "done") throw new Error("expected done");
    expect(damageVector(run.state, "p2")).toEqual([0, 30, 30, 30]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §8 — THE CENSUS THIS SLICE MOVED, AND EVERYTHING IT DID NOT (D496).
// ─────────────────────────────────────────────────────────────────────────────

describe("D505 §8 — the residue, the surface, the version, and what stands still", () => {
  it("🛑 the RAW reader-only residue fell by exactly 1 sentence / 3 printings, and this row left it", () => {
    const unbuilt = legalAttackCorpus().filter(([, s]) => !resolvedByAnyReader(s));
    expect([unbuilt.length, units(unbuilt)]).toEqual([62, 100]);  // (🆕🆕🆕 **D550 +1 sentence / +1 printing — THE OPPONENT-FLIPPED PER-TAILS SNIPE ON THE OPPONENT'S BENCH COUNT** — `censusAttackCorpus.ts` **file line 669** (leading count column `1`; card id UNRESOLVED on this checkout — measured, never invented, D425), claimed WHOLE by `deriveAttackCoinFlip` (a NINTH member `opponentPerTails` over a NULLARY `AttackFlipCount.opponentBench`) AND by `deriveAttackDamageSuppression`'s THIRD compound arm off ONE anchor, `ATTACK_OPPONENT_BENCH_TAILS` — a READER move: reader arm 577/1631 → 578/1632, raw residue 63/101 → 62/100, `BUILT.attack` 1687 → 1688, PHRASE-24 1/1 → 0/0; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.434.0 → 0.435.0, `MATCH_RECORD_VERSION` HOLDS at 33. ⚠️ THE SENTENCE STEP (1) AND THE PRINTING STEP (1) AGREE this slice — the case where a copied number is right BY ACCIDENT, so every site was classified by the quantity its D549 note names (D426/D451). THIS SITE: raw reader-only residue 63/101 → 62/100.)  // (🆕🆕🆕 **D549 +4 sentences / +4 printings — THE DEFENDER'S NEXT-TURN MARKS AND THE SIDE-WIDE ATTACK LOCK** — `censusAttackCorpus.ts` **file lines 171, 149, 169 and 170** (leading count column `1` each; card ids UNRESOLVED on this checkout — measured, never invented, D425), claimed WHOLE by `deriveAttackEffect` alone through FOUR new anchors as THREE new ops (`taxDefender`, `bountyDefender`, `lockSideAttacks`) — a READER move: reader arm 573/1627 → 577/1631, raw residue 67/105 → 63/101, `BUILT.attack` 1683 → 1687; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.433.0 → 0.434.0, `MATCH_RECORD_VERSION` 32 → 33. ⚠️ THE SENTENCE STEP (4) AND THE PRINTING STEP (4) AGREE this slice — the case where a copied number is right BY ACCIDENT, so every site was classified by the quantity its D548 note names (D426/D451). THIS SITE: raw reader-only residue 67/105 → 63/101.)  // (🆕🆕🆕 **D548 +1 sentence / +2 printings — CRESCENT PURGE, THE FACE-UP PRIZE** — `censusAttackCorpus.ts` **file line 664**, Cresselia `sv06.5-021` "Crescent Purge", claimed WHOLE by `deriveAttackOptionalCostBoost`'s FIFTH cost row (`turnPrizeFaceUp` behind `yourFaceDownPrizeRemains`); engine 0.432.0 → 0.433.0, `MATCH_RECORD_VERSION` 31 → 32. ⚠️ THE SENTENCE STEP (1) AND THE PRINTING STEP (2) DIFFER. THIS SITE: raw reader-only residue 68/107 → 67/105.)  // (🆕🆕🆕 **D547 +2 sentences / +4 printings — THE FLIP-TO-ATTACK LOCK AND THE NEXT-TURN VULNERABILITY** — `censusAttackCorpus.ts` **file lines 176 and 150** (leading count column `2` each), *“During your opponent's next turn, if the Defending Pokémon tries to use an attack, your opponent flips a coin. If tails, that attack doesn't happen.”* (TWO sentences in ONE row) and *“During your next turn, the Defending Pokémon takes 50 more damage from attacks (after applying Weakness and Resistance).”*, **2 rows / 4 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so both suites ride file-local declared `d547-*` demonstrators), claimed WHOLE by `deriveAttackEffect` through TWO new anchors (`DEFENDER_FLIP_ATTACK_LOCK`, `DEFENDER_VULNERABLE_NEXT_TURN`) as TWO new ops (`flipLockAttack`, `exposeDefender`) on TWO new REQUIRED `InPlayPokemon` fields — a READER move: reader arm 570/1621 → 572/1625, raw residue 70/111 → 68/107, `BUILT.attack` 1677 → 1681; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.431.0 → 0.432.0, `MATCH_RECORD_VERSION` 30 → 31. ⚠️ **THE SENTENCE STEP (2) AND THE PRINTING STEP (4) DIFFER**, so no copied number is right by accident; every site was classified by the quantity its D546 note names (D426/D451). THIS SITE: raw reader-only residue 70/111 → 68/107.)  // (🆕🆕🆕 **D546 +2 sentences / +2 printings — THE ALL-ATTACKS NEXT-TURN BUFF** — `censusAttackCorpus.ts` **file lines 76 and 148** (leading count column `1` each), *“During your next turn, attacks used by this Pokémon do 120 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance).”* and the same sentence at 100 behind *“Both Active Pokémon are now Asleep.”*, **2 sentences / 2 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so the suite rides file-local declared `d546-*` demonstrators), claimed WHOLE by `deriveAttackEffect` through ONE new whole-sentence anchor (`SELF_EVERY_ATTACK_BOOST`, ONE `['’]` slot, an optional Sleep prefix) as `attack: null` on the SHIPPED `boostAttack` op — no new `EffectOp` member, no new `InPlayPokemon` field — a READER move: reader arm 568/1619 → 570/1621, raw residue 72/113 → 70/111, `BUILT.attack` 1675 → 1677; registry 10/16, gate 9/19, trailing 11/21, `SPLIT_ATTACK_UNITS` 19 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED (19 READ at `censusAtHead.test.ts:8169`); engine 0.430.0 → 0.431.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP ARE BOTH 2 — THE ONE SHAPE WHERE A COPIED NUMBER IS RIGHT BY ACCIDENT**, so every site was measured by the quantity it pins, not copied (D426/D451). THIS SITE: raw reader-only residue 72/113 → 70/111.)  // (🆕🆕🆕 **D544 +1 sentence / +2 printings — THE NAMED ATTACK'S BASE DAMAGE, OVERRIDDEN FOR ONE WINDOW** — `censusAttackCorpus.ts` **file line 166** (leading count column `2`), *“During your next turn, this Pokémon's Hyper Fang attack's base damage is 240.”*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so the suite rides the file-local declared demonstrator `d544-fang`), claimed WHOLE by `deriveAttackEffect` through ONE new whole-sentence anchor (`SELF_ATTACK_BASE_SET`, TWO `['’]` slots, name and number CAPTURED) as a `base: true` RIDER on the SHIPPED `boostAttack` op — no new `EffectOp` member, no new `InPlayPokemon` field — a READER move: reader arm 567/1617 → 568/1619, raw residue 73/115 → 72/113, `BUILT.attack` 1671 → 1673; registry 10/16, gate 7/17, trailing 11/21, `SPLIT_ATTACK_UNITS` 17 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED (17 READ at `censusAtHead.test.ts:8159` — the “14” in D543's annotation beside this one has been stale since D541 moved the constant); engine 0.428.0 → 0.429.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — THEY DISAGREE**, so no number may be copied from one kind of site into another (D426/D451). THIS SITE: raw reader-only residue 73/115 → 72/113.)  // (🆕🆕🆕 **D543 +1 sentence / +2 printings — THE CHOSEN POKÉMON TOOL DISCARD AT THE PROGRAM TAIL** — `censusAttackCorpus.ts` **file line 136** (leading count column `2`), *“Discard up to 2 Pokémon Tools from your opponent's Pokémon.”*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrator `d543-stripper`), claimed WHOLE by `deriveAttackEffect` through ONE new whole-sentence anchor (`ATTACK_DISCARD_TOOLS_UP_TO`, ONE `['’]` slot at index 48, count CAPTURED) as ONE new `EffectOp` member `discardTools{count}` parking on ONE new `EffectPrompt` kind — a READER move: reader arm 566/1615 → 567/1617, raw residue 74/117 → 73/115, `BUILT.attack` 1669 → 1671; registry 10/16, gate 7/17, trailing 11/21, `SPLIT_ATTACK_UNITS` 14 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED; engine 0.427.0 → 0.428.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — THEY DISAGREE**, so no number may be copied from one kind of site into another (D426/D451). THIS SITE: raw reader-only residue 74/117 → 73/115.)  // (🆕🆕🆕 **D542 +1 sentence / +1 printing — THE OPPONENT-CHOSEN HAND SHUFFLE** — `censusAttackCorpus.ts` **file line 665** (`legalAttackCorpus()` index 612, leading count column `1`), *“Your opponent chooses 3 cards from their hand and shuffles those cards into their deck.”*, **1 sentence / 1 legal printing**, claimed WHOLE by `deriveAttackEffect` through ONE new anchor and ONE new arm returning a COMPOSITION of two shipped ops — so it leaves through the RAW READER summand and the registry / gate-split / trailing-split summands all stand still. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1, WHICH IS THE ONE CASE WHERE A COPIED NUMBER IS RIGHT BY ACCIDENT — so THIS SITE WAS MEASURED rather than inherited from its neighbour** (D426/D451).)  (🆕🆕🆕 **D540 +1 sentence / +1 printing — THE DEVOLUTION WITH A PICK IN IT, AND THE `/[Dd]evolv/` FAMILY CLOSES** — `censusAttackCorpus.ts` **row 87** (`legalAttackCorpus()` index 34, leading count column `1`), *"Devolve 1 of your opponent's evolved Pokémon by putting the highest Stage Evolution card on it into your opponent's hand."*, **1 sentence / 1 legal printing** (no card id resolves on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrators `d540-*`), claimed by `deriveAttackEffect` through ONE new anchor `DEVOLVE_CHOSEN_TO_HAND` and arm 41-ter into ONE new FIELD-FREE `EffectOp` member `devolveChosen` — a READER move: reader arm 564/1613 → 565/1614, raw residue 76/119 → 75/118, `BUILT.attack` 1664 → 1665, residue 49/68 → 48/67; registry 10/16, gate 6/14, trailing 11/21, `SPLIT_ATTACK_UNITS` 14, `COMPOUND_ATTACK_UNITS` 21 and `attackReaderSurface()` 13 UNMOVED; engine 0.424.0 → 0.425.0, `MATCH_RECORD_VERSION` HELD at 30 (D125's widening at a persisted address — and this op DOES park, so a record really can hold it, which is why the version claim rests on the widening and not on parking). ⚠️ THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 1 — they AGREE for the first time in six slices, which is the one case where a copied number would be right by accident, so every site was measured.)  // (🆕🆕🆕 **D539 +1 sentence / +2 printings — THE NAMED-BODY MULTIPLIER WITH A NAMED-BODY OWN-SIDE SPREAD BEHIND IT** — `censusAttackCorpus.ts` **FILE LINE 595** (`legalAttackCorpus()` index 542), *"This attack does 50 damage for each of your Drifloon and Drifblim in play. This attack also does 30 damage to each of your Drifloon and Drifblim. (Don't apply Weakness and Resistance for Benched Pokémon.)"*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrators `d539-*`), claimed by TWO readers off ONE `effect` string through ONE new whole-compound anchor carrying a `\2` BACKREFERENCE (`NAMED_BODIES_MULTIPLY_SPREAD`) — `deriveAttackDamageMultiplier` for the × fold and `deriveAttackEffect` for `damageChosen` with the FOURTH `target` member `yourAny` and `count: "all"`, plus the NINTH `IN_PLAY_BODY_NOUNS` exact key — a READER move: reader arm 563/1611 → 564/1613, raw residue 77/121 → 76/119, `BUILT.attack` 1662 → 1664; registry 10/16, gate 6/14, trailing 11/21, `SPLIT_ATTACK_UNITS` 14, `COMPOUND_ATTACK_UNITS` 21 and `attackReaderSurface()` 13 UNMOVED; engine 0.423.0 → 0.424.0, `MATCH_RECORD_VERSION` HELD at 30 (a WIDENING at a persisted address, D125's free case — and `count: "all"` NEVER PARKS, so no record that can exist holds the new value). ⚠️ THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — they disagree for the FIFTH slice running (D535 1-vs-2, D536 1-vs-3, D537 1-vs-2, D538 1-vs-3), so a pass that copied one number into the other kind of site would be wrong in half of them. THIS SITE: 77/121 → 76/119.)  // (🆕🆕🆕 **D538 −1 sentence / −3 printings — THE COUNTER PLACEMENT WHOSE AMOUNT IS A PAYLOAD AND WHOSE TAIL SHUFFLES THE VERY CARDS IT COUNTED** — `censusAttackCorpus.ts` **FILE LINE 412** (`legalAttackCorpus()` index 359), *"Put 2 damage counters on 1 of your opponent's Pokémon for each Basic {G} Energy card in your discard pile. Then, shuffle those Energy cards into your deck."*, **1 sentence / 3 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrator `d538-pile-sniper`), claimed by `deriveAttackEffect` through ONE new whole-sentence TWO-capture anchor (`COUNTER_PUT_SCALED_BY_PILE`, declared with the counter-put family, ONE `['’]` slot) as arm **23b-bis** emitting THREE ops — `damageChosen{perDiscardPileCard}` + `discardPileRetrieval{max:"all"}` + `shuffleDeck`, with ONE `CardFilter` object shared by the first two — a READER move: reader arm 562/1608 → 563/1611, raw residue 78/124 → 77/121, `BUILT.attack` 1659 → 1662; registry 10/16, gate 6/14, trailing 11/21, `SPLIT_ATTACK_UNITS` 14 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED; engine 0.422.0 → 0.423.0, `MATCH_RECORD_VERSION` HELD at 30 (a NEW OPTIONAL KEY is D125's WIDENING and `max: "all"` is a PURE ADDITION to a value domain — and BOTH bytes are written into the record, through `phase.cont.pendingOp` and `phase.cont.rest` respectively). ⚠️ THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 3 — they disagree for the FOURTH slice running (D535 1-vs-2, D536 1-vs-3, D537 1-vs-2), so a pass that copied one number into the other kind of site would be wrong in half of them. THIS SITE: 78/124 → 77/121.)  // (🆕🆕🆕 **D537 −1 sentence / −2 printings — KEEP THREE, SHUFFLE THE REST: THE ONLY SENTENCE IN THIS CORPUS WHOSE PICK NAMES THE BODIES THAT *STAY* — ONE NEW `EffectOp` MEMBER `returnBenchedRest` AND ONE INTERPRETER WRITER** — `censusAttackCorpus.ts` **FILE LINE 84** (`legalAttackCorpus()` index 31), *"Choose 3 of your opponent's Benched Pokémon. If you do, shuffle all of your opponent's Benched Pokémon that you didn't choose, and all cards attached to those Pokémon, into their deck."*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrator `d537-bencher`), claimed by `deriveAttackEffect` through ONE new ONE-capture whole-sentence anchor (`CHOOSE_KEEP_SHUFFLE_REST`, beside `RETURN_BENCHED`, THREE `['’]` slots — two possessives AND the contraction in "didn't") as arm **42-bis** emitting ONE `returnBenchedRest{keep:3}` — a READER move: reader arm 561/1606 → 562/1608, raw residue 79/126 → 78/124, `BUILT.attack` 1657 → 1659; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.421.0 → 0.422.0, `MATCH_RECORD_VERSION` HELD at 30 (a new op MEMBER is D125's WIDENING — and this op PARKS, so the byte IS written into `phase.cont.pendingOp`). ⚠️ THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — they disagree for the third slice running (D535 1-vs-2, D536 1-vs-3), so a pass that copied one number into the other kind of site would be wrong in half of them. THIS SITE: 79/126 → 78/124.)  // (🆕🆕🆕 **D536 −1 sentence / −3 printings — THE BODY THAT LEAVES PLAY WITHOUT BEING KNOCKED OUT — ONE NEW FIELD-FREE `EffectOp` MEMBER `discardDefender` AND ONE INTERPRETER WRITER** — `censusAttackCorpus.ts` **FILE LINE 100** (`legalAttackCorpus()` index 47), *"Discard a Team Rocket's Energy from this Pokémon. If you do, discard your opponent's Active Pokémon and all attached cards."*, **1 sentence / 3 legal printings** (Moltres ex `sv10-031`/`-208`/`-229` — the ids ARE resolved on this checkout and are used as ids; the printed BASE DAMAGE is NOT, so it is driven on the file-local declared demonstrator `d536-moltres`, D425), claimed by `deriveAttackEffect` through ONE new ZERO-capture anchor (`TR_ENERGY_COST_THEN_DISCARD_DEFENDER`, beside `HAND_COST_THEN_OPPONENT_DISCARD`) as `discardEnergy{from:"yourActive", filter:{byName "Team Rocket's Energy"}, recordAs:"discarded"}` gated through the FIRST shipped `recordGate{slot:"discarded"}` into the new `discardDefender` — a READER move: reader arm 560/1603 → 561/1606, raw residue 80/129 → 79/126, `BUILT.attack` 1654 → 1657; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.420.0 → 0.421.0, `MATCH_RECORD_VERSION` HELD at 30 (a new op MEMBER is D125's WIDENING; the op never parks and is FIELD-FREE). ⚠️ THE SENTENCE STEP AND THE PRINTING STEP DISAGREE AT 1 AND 3 — harder than D535's 1-and-2, so a pass that copied one number into the other kind of site would be wrong in half of them. THIS SITE: 80/129 → 79/126.)  // (🆕🆕🆕 **D535 −1 sentence / −2 printings — THE PICK-WITH-REPLACEMENT SNIPE — ZERO NEW VOCABULARY: SIX `damageChosen` OPS AT `count: 1`, THE LITERAL `CHOSEN_ANY_TARGET` ALREADY AUTHORS** — `censusAttackCorpus.ts` **FILE LINE 81** (`legalAttackCorpus()` index 28), *"Choose 1 of your opponent's Pokémon 6 times. (You can choose the same Pokémon more than once.) For each time you chose a Pokémon, do 20 damage to it. This damage isn't affected by Weakness or Resistance."*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — no D1, no catalog sqlite — stated unresolved, never invented, D425), claimed by `deriveAttackEffect` through ONE new TWO-capture anchor (`ATTACK_PICK_WITH_REPLACEMENT_SNIPE`, beside `CHOSEN_ANY_TARGET`) as SIX `damageChosen{target:"opponentAny", amount:20, count:1, source:"attack", deals, ignoreWR}` parks — a READER move: reader arm 559/1601 → 560/1603, raw residue 81/131 → 80/129; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.419.0 → 0.420.0, `MATCH_RECORD_VERSION` HELD at 30 (D237's POPULATION change — the op literal already ships, so the serialized alphabet does not grow). ⚠️ THE SENTENCE STEP AND THE PRINTING STEP DISAGREE AT 1 AND 2 — the legal column prints this sentence TWICE.)  // (🆕🆕🆕 **D534 −1 sentence / −1 printing — THE ONE-CARD LOOK AT THE OPPONENT's DECK WITH A PRINTED SHUFFLE — `shuffleDeck` GAINS THE OPTIONAL KEY `whose: "opponent"` and `reorderTop` PARKS A ONE-CARD WINDOW WHEN ITS TWO ARMS DIFFER** — `censusAttackCorpus.ts` **FILE LINE 401**, *"Look at the top card of your opponent's deck. You may have your opponent shuffle their deck."*, **1 sentence / 1 legal printing** (Inkay `sv06.5-033`; no id on this checkout, D425), claimed by `deriveAttackEffect` through ONE new zero-capture anchor (`ATTACK_OPPONENT_TOP_LOOK_SHUFFLE`, beside `ATTACK_REORDER_TOP`) as `reorderTop{n:1, side:"opponent", otherwise:[shuffleDeck{whose:"opponent"}]}` — a READER move: reader arm 558/1600 → 559/1601, raw residue 82/132 → 81/131; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.418.0 → 0.419.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1.)  // (🆕🆕🆕 **D532 −1 sentence / −1 printing — THE CROSS-SEAT DISCARD-PILE ATTACH — `attachEnergyFrom` GAINS THE OPTIONAL KEY `whose: "opponent"` (on the op AND on `AttachTargetRiders`, read through ONE resolver)** — `censusAttackCorpus.ts` **FILE LINE 70** (`legalAttackCorpus()` index 17), *"Attach up to 3 Energy cards from your opponent's discard pile to their Pokémon in any way you like."*, **1 sentence / 1 legal printing** (Grafaiai `sv08-121`; no id on this checkout, D425), claimed by `deriveAttackEffect` through ONE new zero-capture anchor (`ATTACK_OPPONENT_DISCARD_ATTACH`, beside the factory-built `DISCARD_ATTACH`) as D360's spread ONE KEY OVER — a READER move: reader arm 557/1599 → 558/1600, raw residue 83/133 → 82/132; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.417.0 → 0.418.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1.)  // (🆕🆕🆕 **D531 −1 sentence / −1 printing — THE BOARD-TYPED HAND SEARCH — `searchDeck` GAINS THE PARK-TIME RIDER `typedAsAttachedBasicEnergy`** — `censusAttackCorpus.ts` **FILE LINE 483** (`legalAttackCorpus()` index 430), *"Search your deck for up to 5 Pokémon that are the same type as any Basic Energy attached to this Pokémon, reveal them, and put them into your hand. Then, shuffle your deck."*, **1 sentence / 1 legal printing** (sv07-065 per the retired D231 deferral; no id on this checkout, D425), claimed by `deriveAttackEffect` through ONE new zero-capture anchor (`ATTACK_HAND_SEARCH_TYPED_AS_ATTACHED`, beside `ATTACK_HAND_SEARCH_BENCH_COUNT`) whose rider the park resolves against the SOURCE body's attached Basic Energy — a READER move: reader arm 556/1598 → 557/1599, raw residue 84/134 → 83/133; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.416.0 → 0.417.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1.)  // (🆕🆕🆕 **D530 −1 sentence / −1 printing — THE TARGET-COUNTER-SCALED BENCH SNIPE — A FOURTH `damageChosen` RIDER, `perDamageCounterOnTarget`, READ PER REF AT THE ANSWER** — `censusAttackCorpus.ts` **FILE LINE 551** (`legalAttackCorpus()` index 498), *"This attack does 20 damage to 1 of your opponent's Benched Pokémon for each damage counter on that Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)"*, **1 sentence / 1 legal printing** (no id on this checkout, D425), claimed by `deriveAttackEffect` through ONE new anchor (`BENCHED_SNIPE_TARGET_COUNTERS`, beside `BENCHED_SNIPE_TAKEN_PRIZES`, disjoint by TAIL) as arm 6b′ — a READER move: reader arm 555/1597 → 556/1598, raw residue 85/135 → 84/134; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.415.0 → 0.416.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1.) (🆕🆕🆕 **D528 −1 sentence / −1 printing — THE HEADS-CEILINGED DISCARD-TO-BENCH ENERGY ATTACH — THE ATTACH TWIN OF D525, ZERO VOCABULARY, NO NEW `AttackCoinFlip` MEMBER** — `censusAttackCorpus.ts` **FILE LINE 215**, *"Flip 3 coins. Attach a number of Basic {L} Energy cards up to the number of heads from your discard pile to your Benched Pokémon in any way you like."*, **1 sentence / 1 legal printing** (no id on this checkout, D425), claimed by `deriveAttackCoinFlip` through ONE new anchor (`ATTACK_COIN_ATTACH_UP_TO_HEADS`, beside D525's, disjoint by VERB) as the SHIPPED member `programPerHeads` over ONE copy of D358's discard-spread op `attachEnergyFrom { source: "discard", energyType: "Lightning", benchOnly: true, declinable: true }` — H independent DECLINABLE parks over the Bench at `attack.ts`'s EXISTING fold (the distribution reading D358/D360 give "up to N … in any way you like", with N = heads); ZERO new op/filter/prompt/event/member vocabulary, NO fold or interpreter bytes, `MATCH_RECORD_VERSION` HELD at 30 (what parks is D358's op bytes). ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1 (measured off the corpus row at THIS head, D451/D461), so every chain moves by ONE.) (🆕🆕🆕 **D527 −1 sentence / −1 printing — THE DYNAMIC-max HAND SEARCH — `searchDeck.max` GAINS THE LITERAL `"yourBenchCount"`, A SECOND WIDENING AT D514's PERSISTED ADDRESS** — `censusAttackCorpus.ts` **FILE LINE 454**, *"Search your deck for a number of cards up to the number of your Benched Pokémon and put them into your hand. Then, shuffle your deck."*, **1 sentence / 1 legal printing** (svp-188 — no id on this checkout, D425), claimed by `deriveAttackEffect` through ONE new anchor (`ATTACK_HAND_SEARCH_BENCH_COUNT`, a SEPARATE literal beside `ATTACK_HAND_SEARCH`, zero captures) as EXACTLY the sibling's two-op shape with the literal in `max` — `[{op:"searchDeck", filter:{kind:"anyCard"}, dest:"hand", max:"yourBenchCount"}, {op:"shuffleDeck"}]` — resolved at the park's `sized` map (`interpreter.ts`, where D514's `"any"` resolves) against the ATTACKER's Bench length at STEP time, captioned with the PRINTED phrase; ZERO new op/filter/prompt/event vocabulary, ONE persisted-field WIDENING with `MATCH_RECORD_VERSION` HELD at 30 (driven over a reconstructed v30 numeric op). ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 (measured off the corpus row at THIS head, D451/D461), so every chain moves by ONE in both units. READER summand ALONE — registry 10/16, gate 5/13 and trailing 11/21 all re-measured unmoved — and the reader arm steps 553/1595 → 554/1596.) (🆕🆕🆕 **D526 −1 sentence / −1 printing — THE THREE-TIER HEADS LADDER — ZERO VOCABULARY, AN EIGHTH `AttackCoinFlip` MEMBER** — `censusAttackCorpus.ts` **FILE LINE 218**, *"Flip 3 coins. If 1 of them is heads, this attack does 20 more damage. If 2 of them are heads, this attack does 50 more damage. If all of them are heads, this attack does 80 more damage."*, **1 sentence / 1 legal printing** (no id on this checkout — D425), claimed by `deriveAttackCoinFlip` through ONE new anchor (`ATTACK_COIN_BONUS_LADDER`, beside D525's) as the EIGHTH member `bonusLadder {flips: printed 3, ladder: [20, 50, 80]}`, spent at `attack.ts`'s EXISTING damage fold as ONE table lookup (exclusive tiers: 1 head → +20, 2 → +50, 3 → +80, 0 → nothing — NOT cumulative, NOT per-heads), ZERO new op/filter/prompt/event vocabulary. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 (measured off the corpus row at THIS head, D451/D461) — the first single-unit sweep since D521, so every chain moves by ONE in both units. READER summand ALONE — registry 10/16, gate 5/13 and trailing 11/21 all re-measured unmoved — and the reader arm steps 552/1594 → 553/1595. `MATCH_RECORD_VERSION` HELD at 30: the member is never serialized.) (🆕🆕🆕 **D525 −1 sentence / −2 printings — THE HEADS COUNT READ AS AN "UP TO" CEILING BY ONE OP — ZERO VOCABULARY, A SEVENTH `AttackCoinFlip` MEMBER** — `censusAttackCorpus.ts` **FILE LINE 219**, *"Flip 3 coins. Put a number of cards up to the number of heads from your discard pile into your hand."*, **1 sentence / 2 legal printings** (Oinkologne; neither printing's id is on this checkout — D425), claimed by `deriveAttackCoinFlip` through ONE new anchor (`ATTACK_COIN_RETRIEVAL_UP_TO_HEADS`, beside D476's) as the SEVENTH member `retrievalUpToHeads {flips: printed 3, filter: anyCard, dest: hand}`, spent at `attack.ts`'s fold as ONE shipped `discardPileRetrieval {anyCard, hand, max: heads}` appended to the program when heads > 0 — the interpreter's own "up to" park (`chooseCards {min 0, max H}`), ZERO new op/filter/prompt/event vocabulary. ⚠️ **THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2** (measured off the corpus row at THIS head, D451/D461), so every SENTENCE chain moves by ONE and every PRINTING chain by TWO — a pass that copied one number into the other kind of site would be wrong in half of them (D431/D419). READER summand ALONE — registry 10/16, gate 5/13 and trailing 11/21 all re-measured unmoved — and the reader arm steps 551/1592 → 552/1594. `MATCH_RECORD_VERSION` HELD at 30: the member is never serialized.) (🆕🆕🆕 **D524 −1 sentence / −1 printing — THE PURPOSE-CONNECTIVE OPTIONAL-COST BOOST WITH THE ALL-SELF-ENERGY-TO-HAND COST — ZERO VOCABULARY** — `censusAttackCorpus.ts` **FILE LINE 652**, *"You may put all Energy attached to this Pokémon into your hand to have this attack do 80 more damage."*, **1 sentence / 1 legal printing** (the printing's card is unresolvable on this checkout — D425), claimed by `deriveAttackOptionalCostBoost` through a SECOND SKELETON (`OPTIONAL_COST_PURPOSE_BOOST`, the purpose connective *"to have this attack do N more damage"* beside D381's `. If you do, `) over ONE new cost-table row (`OPTIONAL_COST_PUT_ALL_SELF_ENERGY_TO_HAND` → gate `yourActiveEnergyAtLeast 1`, op `discardEnergy yourActive anyEnergy all → hand`), assembled by the UNCHANGED `optionalCostBoostProgram`: D405's op at `all`, D383's gate at 1, D381's payoff and ZERO new vocabulary. ✅ **THE SENTENCE STEP AND THE PRINTING STEP AGREE, 1 and 1** (measured off the corpus row at THIS head, D451/D461), so every chain moves by ONE in BOTH units. READER summand ALONE — registry 10/16, gate 5/13 and trailing 11/21 all re-measured unmoved — and the reader arm steps 550/1591 → 551/1592. `MATCH_RECORD_VERSION` HELD at 30: zero new serialized bytes.) (🆕🆕🆕 **D523 −1 sentence / −1 printing — THE DECK-DESTINATION DISCARD-PILE RETRIEVAL ("Shuffle … from your discard pile into your deck") — ZERO VOCABULARY, AND A REFUSAL WHOSE PREMISE WAS FALSE OF THE LEGAL ATTACK COLUMN** — `censusAttackCorpus.ts` **FILE LINE 485**, *"Shuffle up to 3 Basic {W} Energy cards from your discard pile into your deck."*, **1 sentence / 1 legal printing**, claimed by `deriveAttackEffect` through the new `ATTACK_DISCARD_SHUFFLE_BACK` anchor and the arm after the D237 arm — Pal Pad's registry shape with the hand twin's filter, ZERO new vocabulary. The sentence step and the printing step AGREE, 1 and 1, so the residue falls by ONE in BOTH units: the row LEFT the raw reader-only residue (91/142 → 90/141) and the split-aware residue (65/92 → 64/91).) (🆕🆕🆕 **D522 −1 sentence / −1 printing — THE STADIUM-GATED BENCH SPREAD WITH THE STADIUM DISCARD — ZERO VOCABULARY, AND A REFUSAL RIGHT ABOUT THE OP AND WRONG ABOUT THE READER** — `censusAttackCorpus.ts` **FILE LINE 293**, *"If a Stadium is in play, this attack also does 30 damage to each of your opponent's Benched Pokémon, and discard that Stadium. (Don't apply Weakness and Resistance for Benched Pokémon.)"*, **1 sentence / 1 legal printing** (Ting-Lu `sv06-110`, whose base and cost are unresolvable on this checkout — D425), claimed by `deriveAttackEffect` through the new `STADIUM_GATED_BENCH_SPREAD` anchor (directly under D380's `MAY_DISCARD_STADIUM`) and arm 43-bis, deriving `[{op:"conditionGate",cond:{kind:"stadiumInPlay"},then:[{op:"spreadDamage",target:"opponentBench",amount:30},{op:"discardStadium"}]}]` — arm 43's exact shape minus the `optional`: THREE shipped ops and ZERO new vocabulary; the refusal that kept the row unbuilt was right about the OP (`discardStadium`, D380) and wrong about the READER (the middle clause is a SECOND HIT — the shipped body-set `spreadDamage` — never a bonus, so no `AttackBonusConsequent` join could read it; D521 (2)'s premise rule). ✅ **THE SENTENCE STEP AND THE PRINTING STEP AGREE, 1 and 1** (measured off the corpus row at THIS head, D451/D461), so every chain moves by ONE in BOTH units. READER summand ALONE — registry 10/16, gate 5/13 and trailing 11/21 all re-measured unmoved — and the reader arm steps 548/1589 → 549/1590. `MATCH_RECORD_VERSION` HELD at 30: zero new serialized bytes.) (🆕🆕🆕 **D521 −1 sentence / −2 printings — THE TWO-COIN BOTH-TAILS RECOIL — ZERO VOCABULARY, AND A REFUSAL WRONG IN ITS CARRIER** — `censusAttackCorpus.ts` **FILE LINE 202**, *"Flip 2 coins. If both of them are tails, this Pokémon also does 90 damage to itself."*, **1 sentence / 2 legal printings**, claimed by `deriveAttackEffect` through the new `FLIP_TWO_BOTH_TAILS_SELF_DAMAGE` anchor (beside D145's one-coin `FLIP_TAILS_SELF_DAMAGE`) and the arm directly after D145's, deriving `[{op:"coinFlipGate",coins:2,onTails:true,then:[{op:"damageSelf",amount:90}]}]` — ONE shipped op behind D355's shipped `coins` field and ZERO new vocabulary; the refusal that kept the row unbuilt named the wrong carrier (`AttackFlipCount` is `deriveAttackCoinFlip`'s damage-count type; a one-body recoil behind a coin is a GATE, not a count — D520 (2)'s premise rule). ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP DISAGREE, 1 vs 2** — one sentence, two legal printings (measured off the corpus row at THIS head, D451/D461) — so a pass that copied one number into the other kind of site would be wrong in half of them. READER summand ALONE — registry 10/16, gate 5/13 and trailing 11/21 all re-measured unmoved — and the reader arm steps 547/1587 → 548/1589. `MATCH_RECORD_VERSION` HELD at 30: zero new serialized bytes.) (🆕🆕🆕 **D520 −1 sentence / −1 printing — THE FOUR-ZONE DAMAGED-BODY SPREAD, AND D507's REFUSAL OVERTURNED IN VERDICT AND CARRIER** — `censusAttackCorpus.ts` **FILE LINE 601**, *"This attack does 50 damage to each Pokémon that has any damage counters on it (both yours and your opponent's), except for this Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)"*, **1 sentence / 1 legal printing**, claimed by `deriveAttackEffect` through the new `SPREAD_EACH_DAMAGED_FOUR_ZONE` anchor and arm 6-iii, deriving `[{op:"conditionGate",cond:{kind:"opponentActiveDamaged"},then:[{op:"damageDefender",amount:50}]},{op:"spreadDamage",target:"yourBench",amount:50,damagedOnly:true},{op:"spreadDamage",target:"opponentBench",amount:50,damagedOnly:true}]` — THREE shipped ops and ZERO new vocabulary: the Active predicate is the shipped ONE-BODY `BoardCondition` `opponentActiveDamaged` inside the shipped `conditionGate`, NOT a per-body rider on `damageDefender`'s flat arm (D507 priced it on that rider; the verdict AND the carrier were wrong — D479's third mode), the Benches are D507's two `damagedOnly` spreads, and *"except for this Pokémon"* is STRUCTURAL. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1** — measured off the corpus row at THIS head rather than assumed (D451/D461). READER summand ALONE — registry 10/16, gate 5/13 and trailing 11/21 all re-measured unmoved — and the reader arm steps 546/1586 → 547/1587. `MATCH_RECORD_VERSION` HELD at 30: zero new serialized bytes.) (🆕🆕🆕 **D519 −1 sentence / −1 printing — THE BODIES IN PLAY THAT ARE ALREADY HURT, A COUNT NARROWED BY A BOARD FACT** — `censusAttackCorpus.ts` **FILE LINE 596**, *"This attack does 50 damage for each of your Pokémon that has any damage counters on it."*, **1 sentence / 1 legal printing**, claimed by `deriveAttackDamageMultiplier` through the new `IN_PLAY_DAMAGED_BODY_MULTIPLY` anchor and a `damagedOnly` rider on `DamageCountSource.pokemonInPlay`, deriving `{per:50,count:{kind:"pokemonInPlay",seat:"you",filter:{kind:"anyPokemon"},damagedOnly:true}}`. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1 HERE** — measured off the corpus row at THIS head rather than carried from D518, whose two steps were 1 vs 2 (D451/D461). READER summand ALONE — registry 10/16, gate 5/13 and trailing 11/21 all re-measured unmoved — and the reader arm steps 545/1585 → 546/1586. 🛑 **ZERO NEW UNION MEMBERS**: `DamageCountSource` stands still at 20, and the price is ONE anchor, ONE reader arm, ONE optional boolean and ONE argument. The count takes `hasAnyDamageCounters` — the SAME call behind the three shipped op riders — so predicate ⟺ count ≥ 1 holds by construction.**) (🆕🆕🆕 **D518 −1 sentence / −2 printings — THE §12 SPECIAL-CONDITION TALLY ON THE DEFENDING ACTIVE** — `censusAttackCorpus.ts` **FILE LINE 537**, *"This attack does 100 damage for each Special Condition affecting your opponent's Active Pokémon."*, **1 sentence / 2 legal printings**, claimed by `deriveAttackDamageMultiplier` through ONE new anchor (`OPPONENT_CONDITION_COUNT_MULTIPLY`) and ONE new `DamageCountSource` member (`specialConditionsOnOpponentActive`, the **20th**), whose walk is `presentStatuses` — the SAME projection the shipped `opponentActiveHasSpecialCondition` predicate folds, so *predicate ⟺ count ≥ 1* holds BY CONSTRUCTION rather than by two readers agreeing. 🛑 **THE SHIPPED PREDICATE COULD NOT PAY THIS ROW**: `DamageCountSource.boardCondition` is the 0-or-1 INDICATOR (D115), whose ceiling is `per` at every `per`, while this sentence pays `per` per CONDITION and a body can carry THREE. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP DISAGREE, 1 vs 2**, so a `.length` site takes −1 where a `units(…)` site takes −2 — measured off the corpus row rather than copied between the two kinds of site (D451/D461). READER summand ALONE — registry 10/16, gate 5/13 and trailing 11/21 all re-measured unmoved — and the reader surface stands still at **13**.) (🆕🆕🆕 **D517 −1 sentence / −1 printing — THE PRIZE-GATED PARALYSIS** — `censusAttackCorpus.ts` **FILE LINE 342**, *"If you have exactly 1 Prize card remaining, your opponent's Active Pokémon is now Paralyzed."*, **1 sentence / 1 legal printing**, claimed WHOLE by `deriveAttackEffect` arm 6a-iii through ONE new anchor (`SELF_PRIZE_GATE_PARALYZE`) and ONE new `BoardCondition` member (`yourPrizesRemaining`, the **61st**) — the seat mirror of `opponentPrizesRemaining`, whose `counts` shape it copies byte for byte. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1**, measured off the corpus row at this head rather than assumed from the row being singular (D451/D461). 🛑 **THE CONSEQUENT WAS ALREADY BUILT AND THE GATE WAS THE WHOLE BLOCKER** — the bare *"Your opponent's Active Pokémon is now Paralyzed."* resolved through this very reader to this very `applyStatus` op before the slice. RAW summand ALONE — no registry row, no gate split, no trailing split (registry 10/16, gate 5/13, trailing 11/21 all re-measured unmoved) — and the reader surface stands still at **13**.) (🆕🆕🆕 **D516 +1 sentence / +1 printing — THE DRAW COUNT THAT READS THE OPPONENT'S HAND** — `censusAttackCorpus.ts` **FILE LINE 487**, *"Shuffle your hand into your deck. Then, draw a card for each card in your opponent's hand."*, **1 sentence / 1 legal printing**, claimed WHOLE by `deriveAttackEffect` through the new `SHUFFLE_HAND_DRAW_PER_OPPONENT_HAND` anchor and arm 44c, deriving `[{op:"handRefresh",who:"you",draw:{kind:"opponentHandSize"}}]`. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1** — measured off the corpus row, not assumed (D451/D461/D466). ONE anchor, ONE arm, ONE `HandRefreshDraw` member (the FIFTH) and ONE evaluator arm in `handRefreshDrawCount`, which is the SOLE consumer that switches on the draw kind — established by DELETING the arm and reading `tsc` (D512's census-by-compile-error), not by grep. 🛑 **THE REFUSAL THAT ORDERED THIS WAS 37 DECISIONS OLD AND RIGHT IN EVERY CLAUSE**: `SHUFFLE_HAND_DRAW`'s block (D479) said this row *"needs a fifth member"* and drove the refusal as its own falsifier — D515's rule that a refusal naming WHAT IS MISSING ages well, paid at a second address one slice later. ⚠️ **THE COUNT IS A MEMBER OF `HandRefreshDraw` AND NOT A `DamageCountSource`** even though `cardsInOpponentHand` spells the identical printed phrase at corpus file line 564: that union's only evaluator is `attack.ts`'s `scaledAttackDamage`, FOUR of whose six parameters are attack-declaration facts that do not exist on the Trainer and Ability paths authoring every other `handRefresh`. `AttackFlipCount` (*"Deliberately not a `DamageCountSource` arm"*) and `MaxHpScale` already made the same call in writing — four count vocabularies, zero embeddings. ✅ **ZERO new ops, op fields, op VALUES on shipped fields, prompts, choice kinds, events, error codes, `CardFilter`/`BoardCondition` members, registry rows, `FIXTURE_POOL` ids, `redact.ts` bytes or `packages/schema` bytes**; RAW summand ALONE — no registry row, no gate split, no trailing split — and the reader surface stands still at **13**. **`MATCH_RECORD_VERSION` STAYS 30, ARGUED AT THE HARD ADDRESS**: the serialized alphabet DOES grow (a fifth `draw.kind` no v30 deploy can write), so D452's *"this byte already ships"* out does NOT apply and the claim rests on REACHABILITY alone (D450) — re-measured over ALL TEN `handRefresh` producers, every one of which places the op, or the gate holding it, as the SOLE top-level op, so no `phase.cont.pendingOp` or `rest` can ever hold it. Driven in the LOSS direction in `handRefreshOpponentHand.test.ts` §8.)  // (🆕🆕🆕 **D515 −1 sentence / −1 printing — THE THIRD MEMBER OF D473’s PRINTED *“Discard a card from your hand. If you do, …”* FAMILY, AND THE BLOCKER WAS THE DESCRIBER RATHER THAN THE ANCHOR** — `censusAttackCorpus.ts` **FILE LINE 103**, *"Discard a card from your hand. If you do, your opponent discards a card from their hand."*, **1 sentence / 1 legal printing**, claimed by `deriveAttackEffect`. 🛑 **D473 MEASURED THIS ROW AND NAMED ITS BLOCKER IN WRITING, AND THE NAMED ONE WAS THE RIGHT ONE.** `HAND_COST_THEN_DRAW`’s block records D472’s whole-corpus measurement — widening that anchor’s consequent to `(.+)` claims this row and NO OTHER — and refuses it because `interpreter.ts`’s `describeBranch` had no phrase for `opponentDiscardsFromHand`: with none, `withConsequence` returns the prompt unchanged and the parking payment’s caption degrades to the bare *"Discard a card from your hand."*, **BYTE-IDENTICAL to an UNGATED payment’s**, while a census would record the row built. DRIVEN on both sides of the new case in `handCostOpponentDiscard.test.ts` §5 rather than quoted. The whole price is ONE anchor, ONE arm and ONE `describeBranch` case. ✅ **ZERO new ops, op fields, op values, prompts, prompt fields, choice kinds, events, error codes, `CardFilter`/`BoardCondition` members, registry rows, `FIXTURE_POOL` ids or `packages/schema` bytes** — `payFromHand` + `recordGate` + `opponentDiscardsFromHand` is three shipped ops in the shipped order. 🆕 **THE LATTICE CHANGES SHAPE IN BOTH DIRECTIONS AT ONCE** (D513/D514): OPENER × GATE × CONSEQUENT × COUNT reads **6 of 16 → 7 of 16** over the residue predicate with flips `6·6·2·0` → `7·7·1·1`, so CONSEQ moves ONTO zero as the widening retires a cell while COUNT moves OFF it as the narrowing creates one — and the owed *"printed zero times"* measurement (the 640-sentence column prints NO gated plural) is paid in that suite’s §1. `MATCH_RECORD_VERSION` **HELD at 30** on the SERIALIZED-ALPHABET argument (D452/D462/D463); reachability is FALSE here because the payment parks, and the loss direction is driven.) (🆕🆕🆕 **D514 −1 sentence / −2 printings — THE PRINTED *“any number of”* AND A PROPER NAME AS THE DECK-SEARCH NOUN** — `censusAttackCorpus.ts` **FILE LINE 657**, *"You may search your deck for any number of Fennel cards, reveal them, and put them into your hand. Then, shuffle your deck."*, **1 sentence / 2 legal printings**, claimed by `deriveAttackEffect`. 🛑 **TWO BLOCKERS AND THEY ARE A CONJUNCTION, MEASURED**: the 2⁴ lattice reads `0/1 · 0/4 · 1/6 · 2/4 · 1/1` (**4 of 16**) with COUNT and NOUN each flipping the verdict at **4 of 8** cells and OPENER and REVEAL at **0 of 8** — D507's eighth shape — and **16 of 16 with every axis at 0 of 8 after**. **The `You may` wrapper the standing pricing named as a THIRD mechanism was already FREE and had been since D231.** ✅ **ZERO new `CardFilter` members**: `byName { cardNoun }` has spelled *"⟨Name⟩ cards"* since D264 and `ATTACK_BENCH_SEARCH` has captured a proper name into `byName` since D230 — the NAMED deck search shipped as a reader arm 284 decisions before this row, one destination over. ONE op-field WIDENING (`searchDeck.max: number | "any"`, `lookAtTopN.max`'s D333 member at a third op) and ONE new resolver (`namedCardNounFilter`, ordered LAST behind the closed noun table and REFUSING the three printed BANNERS, which is the one axis D440 refused `^(.+) card$` on). ✅ ZERO new ops, prompt kinds, choice kinds, events, error codes, registry rows or `packages/schema` bytes. `MATCH_RECORD_VERSION` **HELD at 30**.) (🆕🆕🆕 **D513 −1 sentence / −1 printing — THE PRINTED *“of different types”*, THE FIRST DISTINCTNESS CONSTRAINT THIS ENGINE READS** — `censusAttackCorpus.ts` **FILE LINE 473**, *"Search your deck for up to 3 Basic Energy cards of different types, reveal them, and put them into your hand. Then, shuffle your deck."*, **1 sentence / 1 legal printing** (Sylveon ex `sv06.5-050`), claimed by `deriveAttackEffect`. 🛑 **THE ANCHOR WAS NEVER THE BLOCKER** — `ATTACK_HAND_SEARCH`'s `([^,.]+?)` noun group has captured `Basic Energy cards of different types` WHOLE since D231 and the sentence died one step later in `HAND_SEARCH_PLURAL.get`, so the new optional group MOVES a phrase out of the noun rather than admitting a sentence the pattern refused (D510's rule, paid a second time). ✅ **ZERO new `CardFilter` members — and no widening of that union could EVER have reached this row**, because `matchesFilter` narrows each card INDEPENDENTLY while *“of different types”* is a predicate on the ANSWER SET. It rides D332's shipped `chooseCards.caps` instead — one cap of ONE per `energyProvidesOf` cell — so **ZERO** new prompt fields, validator branches or client mirrors. `MATCH_RECORD_VERSION` **HELD at 30**.) (🆕🆕🆕 **D512 — THE BOTH-SIDES BODY COUNT NARROWED BY TWO PRINTED NAME FRAGMENTS** — `censusAttackCorpus.ts` **FILE LINE 583**, *"This attack does 40 damage for each Pokémon in play that has \"Koffing\" or \"Weezing\" in its name (both yours and your opponent's)."*, **1 sentence / 2 legal printings**, claimed by `deriveAttackDamageMultiplier` over ONE new anchor, ONE new `CardFilter` member (`pokemonNameContaining`) and ONE new `DamageCountSource` member (`bothSidesPokemonInPlay`). 🛑 **ALL FOUR SHIPPED IN-PLAY ANCHORS WERE RUN AGAINST THE ROW FIRST AND ALL FOUR REFUSE IT AT THE PATTERN** — the opposite answer to D510's, because every one of them requires the literal `for each of your ` and this sentence's head is SEATLESS. −**1 sentence / −2 printings**, so this RAW mirror falls with it.) (🆕🆕🆕 **D510 −1 sentence / −2 printings — THE DISCARD PILE NARROWED BY A PRINTED NAME FRAGMENT** — `censusAttackCorpus.ts` **FILE LINE 543**, *"This attack does 20 damage for each Supporter card that has \"Team Rocket\" in its name in your discard pile."*, **1 sentence / 2 legal printings**, claimed by `deriveAttackDamageMultiplier` through ONE new `CardFilter` member (`supporterNameContaining`) and ONE PARAMETERISED noun in `discardPileFilter` — **ZERO new anchors**, because D440’s shipped `DISCARD_PILE_COUNT_MULTIPLY` had matched this row since it was written and the NOUN RESOLVER was the blocker. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP DISAGREE AT 1 AND 2** — a TWO-printing sentence, the opposite of D508 one entry down, measured at this head rather than carried (D451/D461). RAW summand ALONE: registry 10/16, gate 5/13 and trailing 11/21 all re-measured unmoved.) (🆕🆕🆕 **D508 −1 sentence / −1 printing — THE DISCARD PILE NARROWED BY A PRINTED ATTACK NAME** — `censusAttackCorpus.ts` **FILE LINE 542**, *"This attack does 20 damage for each Pokémon in your discard pile that has the United Wings attack."*, **1 sentence / 1 legal printing**, claimed by `deriveAttackDamageMultiplier` over ONE new anchor (`DISCARD_PILE_ATTACK_NAME_MULTIPLY`) crossing D440's `cardsInDiscardPile` count with D446's `attackNamePokemon` filter — **ZERO new members in either union, ZERO evaluator bytes**. READER summand ALONE; registry, gate and trailing stand still at 10/16, 5/13, 11/21. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1**, measured per site rather than copied between the two kinds of site (D451/D461).) (🆕🆕🆕 **D507 +2 sentences / +2 printings — THE SPREAD THAT HITS **BOTH** BENCHES, AND THE OPTIONAL PRINTED CLAUSE THAT NARROWS IT TO THE ALREADY-DAMAGED BODIES** — `censusAttackCorpus.ts` **FILE LINES 515 and 526**, *"This attack also does 10 damage to each Benched Pokémon (both yours and your opponent's). (Don't apply Weakness and Resistance for Benched Pokémon.)"* and *"This attack also does 40 damage to each Benched Pokémon **that has any damage counters on it** (both yours and your opponent's). (Don't apply…)"*, **2 sentences / 2 legal printings**, both claimed by `deriveAttackEffect` arm **6-ii** over ONE new anchor (`SPREAD_EACH_BOTH_BENCH`) whose OPTIONAL GROUP *is* the rider. 🛑 **THE BOTH-SIDES HALF COSTS NO TYPE AT ALL: it is a TWO-OP PROGRAM OF THE SAME OP** — `spreadDamage { yourBench }` then `spreadDamage { opponentBench }` — which is D482's shipped answer to the identical question one zone over, so `spreadDamage.target` gains **NO third member** and `counterEachAll`'s `filter` + `side` shape was refused rather than copied (D448/D449/D465's thrice-refused widening, same class). The op gains ONE OPTIONAL BOOLEAN RIDER, `damagedOnly` — `counterEachAll`'s own name on its own predicate `hasAnyDamageCounters`, D505's idiom one rider later. **ZERO** new `EffectOp` members, op KINDS, readers (surface unmoved at **13**), `CardFilter`/`BoardCondition`/`DamageCountSource` members, prompts, choice kinds, parks, events, error codes, `GameState`/`InPlayPokemon` fields, registry rows, `FIXTURE_POOL` ids (file-local `cardPool`, D414), `redact.ts` bytes, `packages/schema` bytes or `MATCH_RECORD_VERSION` bytes. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 2 AND 2**, MEASURED at this head rather than carried (D451/D461/D465) — both rows are 1-printing sentences. RAW summand ALONE: no registry row, no gate split, no trailing split — all three re-measured unmoved at registry 10/16, gate 5/13, trailing 11/21.)
    // …and this slice's row is not in it any more, which is the only way the pair above
    // reads as a measurement of THIS head rather than of a number (D483's move).
    expect(unbuilt.map(([, s]) => s)).not.toContain(PRINTED);
    // ⚠️ **AND THE SENTENCE STEP AND THE PRINTING STEP DISAGREE, 1 vs 3** — verified at
    // both kinds of site rather than assumed from the row being singular (D451/D461).
    const row = legalAttackCorpus().find(([, s]) => s === PRINTED);
    expect(row?.[0]).toBe(3);
  });

  it("🛑 the reader surface is still THIRTEEN, derived from the module", () => {
    // D444: `deriveAttack…` is a RESERVED NAMESPACE with nothing but a naming convention
    // behind it, so a new export would enrol itself as a reader and move every figure in
    // the repo at once. This slice added none — the claim is one anchor and one arm
    // inside `deriveAttackEffect`.
    expect(attackReaderSurface()).toHaveLength(13);
    expect(attackReaderSurface()).toContain("deriveAttackEffect");
  });

  it("🛑 NEITHER SPLITTER claims the print — the reader arm is the only claimant", () => {
    // The other three arms of the residue predicate, asserted empty on this sentence, so
    // "the reader built it" is a statement about WHICH arm moved (D444/D503).
    expect(splitAttackGateClause(PRINTED)).toBeNull();
    expect(splitAttackTrailingClause(PRINTED)).toBeNull();
  });

  it("engineVersion and `manifest.version` agree, and the bump is owed for BEHAVIOUR", () => {
    // A sentence that derived to `null` derives to a program: `packages/engine` behaviour
    // moved, so the version steps. ⚠️ **THE VERSION IS NOT SPELLED IN THIS `it(…)` TITLE,
    // DELIBERATELY.** index.ts records that 17-to-23 of the ~100 occurrences of the
    // version literal at any head are `it(…)` TITLES; a suite that spells it in its title
    // adds a site to the tax it is measuring, and this rung loses nothing by tying the
    // two sources to each other instead.
    expect(engineVersion).toBe(manifest.version);
  });

  it("🛑 what this slice does NOT move, stated as zeroes (D496)", () => {
    // `clauseApostrophe.test.ts` sweeps every derivable `FIXTURE_POOL` sentence CONTAINING
    // an apostrophe. This slice's demonstrator is file-local, so that census must be
    // UNMOVED — and the printed sentence does carry apostrophes, which is why the
    // prediction is about the POOL and not about the string (D425/D460).
    expect(Object.keys(SPREAD_CARDS).every((id) => FIXTURE_POOL[id] === undefined)).toBe(true);
    // No `EffectOp` KIND was added: the op this slice widened already had its own
    // `stepOp` case, and the census of kinds is what `opcoverage.ts` keys on.
    const ops = deriveAttackEffect(PRINTED) as EffectOp[];
    expect(ops.map((o) => o.op)).toEqual(["spreadDamage"]);
  });
});
