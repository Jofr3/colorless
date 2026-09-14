import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import manifest from "../package.json" with { type: "json" };
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import * as effects from "./effects";
import {
  deriveAttackEffect,
  splitAttackGateClause,
  splitAttackTrailingClause,
} from "./effects";
import { applyAction, createGame, engineVersion } from "./index";
import type { EffectOp, GameEvent, GameState, PokemonRef, Seat } from "./index";
import { logFromEvents } from "./log";
import type { LogContext } from "./log";
import { redactGame } from "./redact";
import { programFor, registryCardIds } from "./registry";
import {
  FIXTURE_POOL,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  discardFromDeck,
  expectErr,
  firstBasicInHand,
  must,
  mustApply,
  setActiveFromDeck,
} from "./testFixtures";

// 0.393.0 → 0.394.0 — 🆕🆕🆕 D502, THE DECK SEARCH THAT ENERGISES WHAT IT BENCHED.
//
//   "Search your deck for a Basic Pokémon and put it onto your Bench. Then,
//    shuffle your deck. If you put any Pokémon onto your Bench in this way, move
//    an Energy from this Pokémon to the new Benched Pokémon."      (1 legal)
//
// Jynx `sv06-046` "Inviting Kiss" — `censusAttackCorpus.ts` **FILE LINE 440**,
// **1 sentence / 1 legal printing**, and the LAST of D230's five leftovers this
// reader's column can reach. The two remaining are `sv06-009` (the §4 going-first
// licence) and three that are registry rows or a disjunctive noun.
//
// 🛑 **D230 REFUSED IT AND NAMED BOTH BLOCKERS, AND BOTH WERE STILL TRUE.** Its
// bullet reads *"`searchDeck` files no record, and no `moveEnergy` destination says
// 'wherever the last op put it'"*. Re-derived at this head rather than inherited
// (D490): `searchDeck` carried NO `recordAs` (twelve declarations across ELEVEN op
// kinds, and this was not one of them — `payFromHand` declares it on two arms of
// its own union), and `moveEnergy.route`'s four values carried no recorded-uid
// destination. **A refusal that names TWO things and has BOTH of them true is the
// unusual half of D451**, and it is what made the quoted price real. Paid with ONE
// optional key on each op.
//
// ⚠️ **WHAT THIS FILE IS FOR, AND IT IS NOT "did a card reach the Bench" OR "did
// an Energy move".** `searchMove` has five suites behind it, `moveEnergyApply` has
// six, and `derivedBenchSearch.test.ts` owns the head sentence's NOUN. What is new
// is the JOIN: a §9.2 record filed by a SEARCH, read as a `moveEnergy`
// DESTINATION. So every rung below is about the record, the destination it pins,
// the arity of the park that pins it, or the caption that announces it.
//
// 🛑 **THE LATTICE SAYS THE BLOCKER IS THE JOIN, AND §3 IS THE EXECUTABLE FORM.**
// Measured over all 2⁴ axis substitutions (head / §9.2 gate clause / consequent
// case / destination noun), the built-by-weight vector of the WHOLE sentence is
// `0/1 · 0/4 · 0/6 · 0/4 · 0/1` — **not one built point at any weight, including
// FULL** — and all four axes are INERT on the verdict. That is a fifth lattice
// shape on record and it is a statement about the FAMILY rather than about the
// axes: the §9.2 compound family has exactly ONE built member in the whole 640-row
// column (D235's, 3 printings), claimed by a whole-sentence anchor that welds its
// own head, and there is NO composition path for a §9.2 gate at all. The TAIL's own
// 2³ sub-lattice is the informative one and it has no degenerate axis:
// `0/1 · 0/3 · 0/3 · 1/1` — D489/D490/D494's shape, no proper subset builds.

/** The printed sentence, and it is asserted to be a ROW OF THE COMMITTED CORPUS
    with its printing count read off that corpus rather than typed (D452/D490: a
    byte pin measures an invention as faithfully as it measures the truth). */
const SENTENCE =
  "Search your deck for a Basic Pokémon and put it onto your Bench. Then, shuffle your deck. If you put any Pokémon onto your Bench in this way, move an Energy from this Pokémon to the new Benched Pokémon.";

/** The HEAD, which is itself a printed corpus row at SEVEN printings and has built
    since D230 — the attribution control this whole file leans on. */
const HEAD =
  "Search your deck for a Basic Pokémon and put it onto your Bench. Then, shuffle your deck.";

/** The §9.2 tail alone. Refused by all thirteen readers and by all four splitters,
    and it must STAY refused — see §2. */
const TAIL =
  "If you put any Pokémon onto your Bench in this way, move an Energy from this Pokémon to the new Benched Pokémon.";

/** The program the anchor emits, spelled whole so a rung names every field (D438:
    a boolean is true under the real build and under the near-misses alike). */
const PROGRAM: readonly EffectOp[] = [
  { op: "searchDeck", filter: { kind: "basicPokemon" }, dest: "bench", max: 1, recordAs: "moved" },
  { op: "shuffleDeck" },
  {
    op: "recordGate",
    slot: "moved",
    // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable.
    then: [
      {
        op: "moveEnergy",
        filter: { kind: "anyEnergy" },
        max: 1,
        route: "selfToBench",
        destRecorded: "moved",
      },
    ],
  },
];

function units(rows: readonly (readonly [number, string])[]): number {
  return rows.reduce((sum, [n]) => sum + n, 0);
}

function events<T extends GameEvent["type"]>(all: GameEvent[], type: T) {
  return all.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

describe("§1 — the sentence, the corpus row, and D230's refusal paid", () => {
  it("🛑 the specimen IS a row of `legalAttackCorpus()`, at the printing count the corpus states", () => {
    // D452/D490's standing rule: assert membership, and read the count off the
    // corpus instead of typing it. The FILE LINE is cited because this checkout has
    // no D1 and a card id cannot be resolved here (D425) — `sv06-046` is quoted from
    // D230's own decision row, which measured it against the remote database.
    const rows = legalAttackCorpus().filter(([, s]) => s === SENTENCE);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.[0]).toBe(1);
    // …and the HEAD is a row too, at seven, which is what makes the control real
    // rather than constructed.
    const head = legalAttackCorpus().filter(([, s]) => s === HEAD);
    expect(head).toHaveLength(1);
    expect(head[0]?.[0]).toBe(7);
  });

  it("🛑 D230's TWO blockers, re-derived rather than inherited — and both were true", () => {
    // D490's rule: before pricing any residue row from a recorded refusal, re-derive
    // the refusal itself. Five consecutive slices had found an inherited price naming
    // something already built. This one named two things and both held.
    //
    // (a) `searchDeck` had no `recordAs`. Executable form: the field exists NOW, and
    // the HEAD sentence — the same op, the same filter, the same destination — still
    // emits a program WITHOUT it, so the key is authored from the printed §9.2 clause
    // and not from the op.
    const headProgram = deriveAttackEffect(HEAD) ?? [];
    expect(headProgram).toEqual([
      { op: "searchDeck", filter: { kind: "basicPokemon" }, dest: "bench", max: 1 },
      { op: "shuffleDeck" },
    ]);
    expect(Object.hasOwn(headProgram[0] ?? {}, "recordAs")).toBe(false);
    // (b) no `moveEnergy` destination named a recorded uid. Executable form: the four
    // shipped `route` values are unchanged and NONE of them carries the pin; the pin
    // is a rider, so a route-only build could not have spelled it. The two uid-pinned
    // routes resolve from `ctx.sourceUid`, which is a different provenance.
    const move = (PROGRAM[2] as Extract<EffectOp, { op: "recordGate" }>).then[0];
    expect(move).toMatchObject({ op: "moveEnergy", route: "selfToBench", destRecorded: "moved" });
    // The shipped sibling with the SAME route and the SAME filter and NO pin — one
    // axis apart (D427), and a real printing at eight (D230's own family neighbour).
    const sibling =
      deriveAttackEffect("Move an Energy from this Pokémon to 1 of your Benched Pokémon.") ?? [];
    expect(sibling).toEqual([
      { op: "moveEnergy", filter: { kind: "anyEnergy" }, max: 1, route: "selfToBench" },
    ]);
    expect(Object.hasOwn(sibling[0] ?? {}, "destRecorded")).toBe(false);
  });

  it("the reader SURFACE stands still at 13 — no new `deriveAttack*` export", () => {
    // D444: `deriveAttack` is a RESERVED NAMESPACE with nothing but a string behind
    // it, so a slice that adds a reader moves every census figure in the repo.
    expect(attackReaderSurface().length).toBe(13);
  });

  it("engineVersion stepped for a behaviour a card can reach, and `manifest.version` agrees", () => {
    expect(engineVersion).toBe("0.400.0");
    expect(manifest.version).toBe(engineVersion);
  });
});

describe("§2 — the reader: ONE claimant, the whole sentence, and the order", () => {
  it("🛑 derives to the PROGRAM, field for field", () => {
    expect(deriveAttackEffect(SENTENCE)).toEqual(PROGRAM);
  });

  it("exactly ONE reader claims it, and the other twelve still refuse — by name", () => {
    // D438's polarity rule: name the owner AND keep the refusals, so this rung arms
    // rows a boolean never could. A `resolvedByAnyReader(s) === true` re-point would
    // be true under a mistaken widening of any of the other twelve.
    const mod = effects as unknown as Record<string, (t: string) => unknown>;
    const claimants = attackReaderSurface().filter((name) => mod[name]?.(SENTENCE) !== null);
    expect(claimants).toEqual(["deriveAttackEffect"]);
  });

  it("🛑 and NO splitter serves it — the JOIN has no seam, which is why the anchor is whole", () => {
    // The measurement that warrants a whole-sentence anchor over a composition, and
    // it is the reason the 2⁴ lattice in §3 has no built point anywhere.
    expect(splitAttackTrailingClause(SENTENCE)).toBeNull();
    expect(splitAttackGateClause(SENTENCE)).toBeNull();
    // …and the shipped splitter's ONLY unmet condition on this string is the tail,
    // which is exactly D485's trap: claim the tail and the row comes free.
    expect(deriveAttackEffect(TAIL)).toBeNull();
    expect(resolvedByAnyReader(HEAD)).toBe(true);
  });

  it("🛑 THE TAIL STAYS REFUSED, and the reason is TWO anaphors pointing OUT of the clause", () => {
    // D485's rule: before taking a splitter composition, ask what the tail refers to.
    // *"in this way"* points at a search two sentences up and *"the NEW Benched
    // Pokémon"* at the body that search benched — so a tail-only arm would let the
    // trailing splitter compose it behind ANY claimed head. Driven rather than
    // argued: the compound below would derive under such a build, and its
    // `recordGate` would read a slot nothing filed.
    const wrongHead = `Draw 3 cards. ${TAIL}`;
    expect(deriveAttackEffect(wrongHead)).toBeNull();
    expect(splitAttackTrailingClause(wrongHead)).toBeNull();
    // …and the head of THAT compound really is claimed, so the rung is about the
    // TAIL and not about the head (the splitter's other guard).
    expect(resolvedByAnyReader("Draw 3 cards.")).toBe(true);
    // ⚠️ AND THE DEGRADATION IS SILENT RATHER THAN LOUD, which is what makes this
    // worse than D485's case: the gate reads an unfiled slot as FALSE, so the
    // composed program would simply do nothing and no channel would report it.
    expect(TAIL.includes("in this way")).toBe(true);
    expect(TAIL.includes("the new Benched Pokémon")).toBe(true);
  });

  it("refuses the anchor, punctuation, case and destination rewrites", () => {
    for (const text of [
      // A leading clause — the `$`-only build's hole.
      `Draw a card. ${SENTENCE}`,
      // A trailing clause — the `^`-only build's hole. ⚠️ CONSTRUCTED, and said so
      // (D440): no printed sentence carries a tail behind this one, so the witness
      // for the terminator is a built string and is a claim about the READER.
      `${SENTENCE} Your opponent draws a card.`,
      // The DESTINATION, which is the whole content of `destRecorded` and the one
      // token that separates this sentence from D229's shipped eight-printing
      // sibling. One axis (D427).
      SENTENCE.replace("the new Benched Pokémon", "1 of your Benched Pokémon"),
      // The consequent's CASE. The shipped `^Move ` anchor is sentence-initial, so
      // this is the axis that cannot be varied independently of the gate in print.
      SENTENCE.replace(", move an Energy", ", Move an Energy"),
      // The §9.2 CONNECTIVE — a period where the card prints a comma, which would
      // make the tail a sentence and hand it to the splitter.
      SENTENCE.replace("in this way, move", "in this way. Move"),
      // The gate's own quantifier, which is what *"any"* is doing in print.
      SENTENCE.replace("put any Pokémon", "put a Pokémon"),
      // The PLURAL head, which the anchor refuses BY CONSTRUCTION rather than by a
      // guard: N uids under one slot has no reading for a singular definite *"the
      // new Benched Pokémon"*.
      SENTENCE.replace(
        "for a Basic Pokémon and put it",
        "for up to 2 Basic Pokémon and put them",
      ),
      // The TYPED and NAMED nouns the shared `BENCH_SEARCH_NOUN` group spells, and
      // which this anchor deliberately does not reuse (D472: the wider form claims
      // the same 1 sentence / 1 printing over all 640 rows, so the generality is
      // pure risk).
      SENTENCE.replace("a Basic Pokémon", "a Basic {G} Pokémon"),
      SENTENCE.replace("a Basic Pokémon", "a Pikachu"),
      // The trailing period.
      SENTENCE.slice(0, -1),
    ]) {
      expect(deriveAttackEffect(text), text).toBeNull();
    }
  });

  it("🛑 the wider noun group would have claimed NOTHING extra — measured over all 640 rows", () => {
    // D472's rule as a rung rather than a paragraph: if a generalisation claims the
    // same rows, the generality is pure risk. The wider form is the shipped
    // `BENCH_SEARCH_NOUN` alternation (the literal, the brace code, a capitalised
    // NAME) welded to this sentence's §9.2 tail.
    const wide = new RegExp(
      "^Search your deck for a (?:Basic Pokémon|Basic \\{[A-Z]\\} Pokémon|[A-Z][a-zé]+)" +
        " and put it onto your Bench\\. Then, shuffle your deck\\." +
        " If you put any Pokémon onto your Bench in this way, move an Energy from this Pokémon" +
        " to the new Benched Pokémon\\.$",
    );
    const claimed = legalAttackCorpus().filter(([, s]) => wide.test(s));
    expect([claimed.length, units(claimed)]).toEqual([1, 1]);
    expect(claimed[0]?.[1]).toBe(SENTENCE);
  });

  it("🛑 the ORDER against `ATTACK_BENCH_SEARCH` is LOAD-BEARING for D230's `$` row", () => {
    // The two anchors are STRUCTURALLY DISJOINT while both keep their terminators
    // (D468): the head anchor demands the string END after *"shuffle your deck."*
    // where this one demands more text, so no string can match both and the order
    // is legibility. **Until the `$` goes.**
    //
    // 🛑 `D230-anchor-drops-the-tail`'s own `what` names THIS printing as its
    // witness. Reading the head anchor FIRST is what keeps that true: under that
    // mutation it claims this sentence and answers the BARE two-op program, which
    // the rung below reddens on. Place this arm ahead of it and the mutation goes
    // INERT on the one card the row cites (D467: killability is a property of the
    // dispatch order, not of the predicate).
    const program = deriveAttackEffect(SENTENCE) ?? [];
    expect(program).toHaveLength(3);
    expect(program).not.toEqual(deriveAttackEffect(HEAD));
    expect(program.map((o) => o.op)).toEqual(["searchDeck", "shuffleDeck", "recordGate"]);
    // …and the head anchor's own sentence is UNTOUCHED by the new arm, which is the
    // admission that keeps the rung above from passing on a build that broke both.
    expect(deriveAttackEffect(HEAD)).toHaveLength(2);
  });

  it("hands nothing to the four splitters or to the coin reader, and carries no apostrophe", () => {
    expect(effects.splitAttackRequirementClause(SENTENCE)).toBeNull();
    expect(effects.splitAttackCancelClause(SENTENCE)).toBeNull();
    expect(effects.deriveAttackCoinFlip(SENTENCE)).toBeNull();
    // ⚠️ A PREDICTION ABOUT A SIBLING CENSUS (D425/D460): `clauseApostrophe.test.ts`
    // sweeps every derivable FIXTURE_POOL sentence CONTAINING an apostrophe. This one
    // carries none, so that census must be UNMOVED by this slice.
    expect(SENTENCE.includes("'")).toBe(false);
    expect(SENTENCE.includes("’")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — THE LATTICE, in the executable form (D491).
// ─────────────────────────────────────────────────────────────────────────────

/** The four axes counted FROM THE PRINT, each with its nearest BUILT spelling.
    Axis 0's nearest built spelling IS its printed value (the 7-printing corpus
    row), which is D491's definition of a DEGENERATE axis — and §3 asserts that,
    rather than reporting a 2⁴ table that is really a 2³ one twice over. */
const AXES = {
  head: [HEAD, HEAD],
  gate: [
    "If you put any Pokémon onto your Bench in this way,",
    // The ONE built §9.2 gate clause in the whole 640-row column — D235's, from
    // *"…If you attached Energy to a Pokémon in this way, this Pokémon is now
    // Poisoned."* (3 legal printings).
    "If you attached Energy to a Pokémon in this way,",
  ],
  verb: ["move", "Move"],
  dest: ["the new Benched Pokémon", "1 of your Benched Pokémon"],
} as const;

function latticePoint(h: 0 | 1, g: 0 | 1, v: 0 | 1, d: 0 | 1): string {
  return `${AXES.head[h]} ${AXES.gate[g]} ${AXES.verb[v]} an Energy from this Pokémon to ${AXES.dest[d]}.`;
}

const BITS = [0, 1] as const;

describe("§3 — the axis-substitution lattice, both directions", () => {
  it("🛑 the WHOLE-SENTENCE 2⁴ table is EMPTY at every weight, including FULL", () => {
    // D489's method with D491's executable form. `before = now && !NEW_ANCHOR
    // .test(point)` is spelled as `now` minus the one point the new anchor claims,
    // so the pre-state is DERIVED from the current one rather than quoted as prose
    // that nothing rechecks.
    const built: number[] = [0, 0, 0, 0, 0];
    const total: number[] = [0, 0, 0, 0, 0];
    for (const h of BITS)
      for (const g of BITS)
        for (const v of BITS)
          for (const d of BITS) {
            const point = latticePoint(h, g, v, d);
            const weight = h + g + v + d;
            total[weight] = (total[weight] ?? 0) + 1;
            // The new anchor claims the print — weight 0 — and nothing else, so
            // subtracting it recovers the PRE-SLICE verdict at every point.
            const nowBuilt = resolvedByAnyReader(point) || splitAttackTrailingClause(point) !== null;
            const mine = point === SENTENCE;
            if (nowBuilt && !mine) built[weight] = (built[weight] ?? 0) + 1;
          }
    expect(total).toEqual([1, 4, 6, 4, 1]);
    // 🛑 THE VECTOR. Read left to right it is print → built; read right to left it is
    // built → print. Both are ZERO everywhere, which is a statement about the FAMILY:
    // no proper subset of this sentence builds and NEITHER DOES THE FULL SUBSTITUTION,
    // because every point keeps a bench-search head and the §9.2 compound family has
    // no composition path at all.
    expect(built).toEqual([0, 0, 0, 0, 0]);
    // …and the second half of D491's rung: the point the new anchor claims is
    // EXACTLY the print, so a later slice that widened this anchor across a point
    // the lattice says is refused reddens here.
    const claimedNow = new Set<string>();
    for (const h of BITS)
      for (const g of BITS)
        for (const v of BITS)
          for (const d of BITS) {
            const point = latticePoint(h, g, v, d);
            if (resolvedByAnyReader(point)) claimedNow.add(point);
          }
    // ⚠️ A **SET**, AND THE REASON IS THE DEGENERATE AXIS: the head axis's two values
    // are the SAME STRING, so the 16 points are only EIGHT distinct sentences and the
    // print appears twice. That is the 2⁴-is-really-2³ artefact D491 names, showing
    // up in the instrument rather than in the table.
    expect([...claimedNow]).toEqual([SENTENCE]);
    expect(
      new Set(
        [...BITS].flatMap((h) =>
          [...BITS].flatMap((g) =>
            [...BITS].flatMap((v) => [...BITS].map((d) => latticePoint(h, g, v, d))),
          ),
        ),
      ).size,
    ).toBe(8);
  });

  it("🛑 ALL FOUR axes are INERT on the whole-sentence verdict, and the head one is DEGENERATE", () => {
    // D491/D494/D500: before listing an axis, check that its nearest BUILT spelling
    // DIFFERS from the print, and that flipping it can move the verdict. Here the
    // head axis fails the first test outright (its printed value already builds) and
    // ALL FOUR fail the second — so the honest whole-sentence table is 2⁰, one point,
    // and saying so is the finding.
    expect(AXES.head[0]).toBe(AXES.head[1]);
    let flips = 0;
    for (const h of BITS)
      for (const g of BITS)
        for (const v of BITS)
          for (const d of BITS) {
            const here = latticePoint(h, g, v, d) === SENTENCE ? false : resolvedByAnyReader(latticePoint(h, g, v, d));
            for (const [a, b] of [
              [latticePoint(1, g, v, d), h],
              [latticePoint(h, 1, v, d), g],
              [latticePoint(h, g, 1, d), v],
              [latticePoint(h, g, v, 1), d],
            ] as const) {
              if (b === 1) continue;
              const there = a === SENTENCE ? false : resolvedByAnyReader(a);
              if (here !== there) flips++;
            }
          }
    expect(flips).toBe(0);
  });

  it("🛑 the TAIL's own 2³ sub-lattice is the informative one: `0/1 · 0/3 · 0/3 · 1/1`", () => {
    // D495/D499/D500's rule: report the built-by-weight VECTOR, not the verdict.
    // Three axes, NONE degenerate, and exactly one built point at FULL weight —
    // D489/D490/D494's shape. *No proper subset builds*, which is what warrants a
    // whole-CLAUSE reading; the whole-SENTENCE anchor is then warranted by the
    // absent seam in the rung above, and the two are different arguments.
    const gate = ["If you put any Pokémon onto your Bench in this way, ", ""] as const;
    const built: number[] = [0, 0, 0, 0];
    const total: number[] = [0, 0, 0, 0];
    for (const g of BITS)
      for (const v of BITS)
        for (const d of BITS) {
          const point = `${gate[g]}${AXES.verb[v]} an Energy from this Pokémon to ${AXES.dest[d]}.`;
          const weight = g + v + d;
          total[weight] = (total[weight] ?? 0) + 1;
          if (resolvedByAnyReader(point)) built[weight] = (built[weight] ?? 0) + 1;
        }
    expect(total).toEqual([1, 3, 3, 1]);
    expect(built).toEqual([0, 0, 0, 1]);
  });

  it("🛑 each printed SEGMENT, on its own — and the JOIN is the only refusal left", () => {
    // D495's question asked directly: the HEAD builds at zero substitutions (7
    // printings) and the CONSEQUENT builds at two (8 printings, D229's sibling).
    // Neither is a prerequisite the other needs; what has no reader is the JOIN.
    expect(resolvedByAnyReader(HEAD)).toBe(true);
    expect(resolvedByAnyReader("Move an Energy from this Pokémon to 1 of your Benched Pokémon.")).toBe(
      true,
    );
    expect(resolvedByAnyReader("move an Energy from this Pokémon to 1 of your Benched Pokémon.")).toBe(
      false,
    );
    expect(resolvedByAnyReader("Move an Energy from this Pokémon to the new Benched Pokémon.")).toBe(
      false,
    );
    expect(resolvedByAnyReader(AXES.gate[0])).toBe(false);
  });

  it("🛑 the §9.2 GATE FAMILY is SEVEN sentences / NINE printings, and this is the seventh", () => {
    // The measurement the 2⁴ table's emptiness rests on, pinned on the POPULATION
    // rather than on a specimen (D423), and defined STRUCTURALLY — a program that
    // contains a `recordGate` — rather than by a printed token, because the token is
    // not the family (see the second half of this rung).
    //
    // Before this slice the family was SIX sentences / EIGHT printings and exactly
    // ONE of them was a deck SEARCH (D235's attach). A successor who ships a §9.2
    // gate SPLITTER, or who makes a second compound readable, reddens here.
    const gated = legalAttackCorpus().filter(([, s]) =>
      JSON.stringify(deriveAttackEffect(s) ?? []).includes('"recordGate"'),
    );
    expect([gated.length, units(gated)]).toEqual([7, 9]);
    expect(gated.map(([, s]) => s)).toContain(SENTENCE);
    const searches = gated.filter(([, s]) => s.startsWith("Search your deck"));
    expect([searches.length, units(searches)]).toEqual([2, 4]);
    // …and every one of the seven is claimed WHOLE, by an anchor that welds its own
    // head. That is the absent seam stated as a property of the column.
    for (const [, s] of gated) {
      expect(resolvedByAnyReader(s), s).toBe(true);
      expect(splitAttackTrailingClause(s), s).toBeNull();
    }
  });

  it("🛑 the ' in this way' MARKER IS NOT THE BLOCKER — counted on BOTH sides (D447)", () => {
    // D447's decisive test, and it needs no experiment: count the marker on both
    // sides of the predicate before counting it on one. It sits on 20 corpus
    // sentences / 39 printings and 18 / 36 of them RESOLVE — a token that is on the
    // built side in the majority of its printings cannot be what refuses the rest.
    // The marker appears on the residue *because* those sentences are unbuilt, not
    // the other way round.
    const marker = legalAttackCorpus().filter(([, s]) => s.includes(" in this way"));
    const builtMarker = marker.filter(([, s]) => resolvedByAnyReader(s));
    expect([marker.length, units(marker)]).toEqual([20, 39]);
    expect([builtMarker.length, units(builtMarker)]).toEqual([18, 36]);
    // …and the COMMA form — a gate clause with a consequent behind it — is 6 / 9 and
    // now entirely built, which is the same fact one literal narrower.
    const comma = legalAttackCorpus().filter(([, s]) => / in this way, /.test(s));
    expect([comma.length, units(comma)]).toEqual([6, 9]);
    expect(comma.every(([, s]) => resolvedByAnyReader(s))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The board.
// ─────────────────────────────────────────────────────────────────────────────

/** ⚠️ **A FILE-LOCAL `cardPool`, SO NO `FIXTURE_POOL` ID IS ADDED (D452/D465).**
    That keeps `opponentResistanceBonus.test.ts`'s pool-size pin and its ELEVEN-deep
    `ids.length` ladder at a ZERO term — twelve assertions in a file with nothing to
    do with this subject. The census still steps by the full sentence and printing
    counts, because those are keyed on the CORPUS and the READERS, not on the pool.

    ⚠️ **INDEX 1 IS THE ATTRIBUTION CONTROL AND IT IS A REAL PRINTING (D214).** The
    bare head is the 7-printing sentence D230 built, identical in every token except
    the §9.2 tail — so every claim below about "the record was filed and the gate
    fired" is paired with a board on which the identical action files nothing and
    nothing happens. Without it, a suite asserting "one Energy moved" is green on a
    build that moves an Energy after every bench search. */
const KISSER: Card = battler("fix-invitingkiss", {
  hp: 90,
  attacks: [
    { name: "Inviting Kiss", cost: ["Colorless"], effect: SENTENCE },
    { name: "Bench Call", cost: ["Colorless"], effect: HEAD },
  ],
});

/** The body the search finds. A distinct id rather than a reused fixture so the
    record's contents are nameable, and 60 HP so nothing here is lethal. */
const FOUND: Card = battler("fix-kissfound", { hp: 60 });

const LOCAL_CARDS: Record<string, Card> = {
  "fix-invitingkiss": KISSER,
  "fix-kissfound": FOUND,
};
const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

/** ⚠️ **EVERY LINE IS A DISCRIMINATOR (D448: a one-print fixture makes a filter
    unfalsifiable).**
      • `fix-kissfound` — the Basic the search is meant to find;
      • `fix-charjabug` — a **STAGE 1**, so a build whose filter widened past
        `basicPokemon` would offer it and the candidate count would move;
      • `fix-special` beside `fix-energy` — a SPECIAL Energy on the attacker is what
        tells `anyEnergy` from `basicEnergy`, and the printed noun is *"an Energy"*.
        On an all-basic board the two readings offer the same rows and the filter
        mutant survives against a suite that looks thorough. */
const KISS_DECK = deckOf({
  "fix-invitingkiss": 8,
  "fix-kissfound": 6,
  "fix-charjabug": 6,
  "fix-bigbody": 10,
  "fix-energy": 22,
  "fix-special": 8,
});

const KISS = 0;
const BENCH_CALL = 1;
const SEED = 11;

function localSetup(seed: number, first: Seat): GameState {
  const created = createGame({ seed, decks: { p1: KISS_DECK, p2: KISS_DECK }, cardPool: POOL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(
    applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first }),
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

/** P1 on turn 3 with the kisser Active, `ownBench` pre-existing Bench bodies, one
    Basic Energy and one SPECIAL Energy attached, and `fix-bigbody` opposite.

    🛑 **`ownBench` DEFAULTS TO 1 AND THAT IS THE SEPARATING BOARD, NAMED BEFORE IT
    WAS WRITTEN (D485/D486).** With an EMPTY Bench the pinned and un-pinned readings
    both offer exactly ONE destination after the search, so the mutant that drops
    `destRecorded` is byte-identical on the first board anyone would build — D485's
    "the collision board is usually the SMALLEST one" at a destination set. One
    pre-existing body is the whole difference between a green table and a
    meaningless one. */
function table({ ownBench = 1, basics = 6 }: { ownBench?: number; basics?: number } = {}): GameState {
  let state = localSetup(SEED, "p1");
  while (state.turn < 3) {
    if (state.phase.kind !== "turn:action") throw new Error(`stuck in ${state.phase.kind}`);
    state = must(applyAction(state, { type: "endTurn", seat: state.turn % 2 === 1 ? "p1" : "p2" }));
  }
  state = clearBench(setActiveFromDeck(state, "p1", "fix-invitingkiss"), "p1");
  state = setActiveFromDeck(state, "p2", "fix-bigbody");
  state = attachFromDeck(state, "p1", "fix-energy", 1);
  state = attachFromDeck(state, "p1", "fix-special", 1);
  for (let i = 0; i < ownBench; i++) state = benchFromDeck(state, "p1", "fix-bigbody");
  // The candidate set is trimmed rather than grown, so the deck's ORDER (and the
  // shuffle's seed) is untouched by the knob.
  const inDeck = state.players.p1.deck.filter((uid) => state.cardIdByUid[uid] === "fix-kissfound");
  if (inDeck.length > basics) {
    state = discardFromDeck(state, "p1", "fix-kissfound", inDeck.length - basics);
  }
  return state;
}

function swing(state: GameState, index = KISS) {
  return mustApply(state, { type: "attack", seat: "p1", index });
}

function searchPark(state: GameState) {
  if (state.phase.kind !== "effect:choose" || state.phase.prompt.kind !== "chooseCards") {
    throw new Error(`expected a chooseCards park, got ${state.phase.kind}`);
  }
  return state.phase.prompt;
}

function movePark(state: GameState) {
  if (state.phase.kind !== "effect:choose" || state.phase.prompt.kind !== "moveEnergy") {
    throw new Error(`expected a moveEnergy park, got ${state.phase.kind}`);
  }
  return state.phase.prompt;
}

/** Answer the search with one `fix-kissfound`, and hand back the state plus every
    event the whole attack has emitted so far. */
function findOne(state: GameState): { state: GameState; events: GameEvent[]; uid: string } {
  const swung = swing(state);
  const prompt = searchPark(swung.state);
  const uid = prompt.candidates.find((u) => swung.state.cardIdByUid[u] === "fix-kissfound");
  if (uid === undefined) throw new Error("no fix-kissfound among the candidates");
  const answered = mustApply(swung.state, {
    type: "resolveEffect",
    seat: "p1",
    choice: { kind: "cards", uids: [uid] },
  });
  return { state: answered.state, events: [...swung.events, ...answered.events], uid };
}

describe("§4 — the two parks: the search, then the pinned move", () => {
  it("the search parks on `chooseCards`, and the candidate set is BASICS only", () => {
    const prompt = searchPark(swing(table()).state);
    expect(prompt.min).toBe(0);
    expect(prompt.max).toBe(1);
    expect(prompt.dest).toBe("bench");
    // The filter, driven: `fix-charjabug` is a Stage 1 sitting in the same deck and
    // it is NOT offered. A build whose filter widened past `basicPokemon` moves this
    // count (D448: the board has to contain the thing the narrowing excludes).
    const ids = prompt.candidates.map((u) => swing(table()).state.cardIdByUid[u]);
    expect(ids).not.toContain("fix-charjabug");
    expect(ids).toContain("fix-kissfound");
  });

  it("🛑 the SECOND park is the move, and its DESTINATION SET IS ONE — the pinned body", () => {
    // The whole slice at one field. The attacker's Bench holds a pre-existing body,
    // so `selfToBench`'s un-pinned offer would be TWO destinations; the print says
    // *"the NEW Benched Pokémon"*, and the pin is what makes the offer one.
    const found = findOne(table({ ownBench: 1 }));
    const prompt = movePark(found.state);
    expect(found.state.players.p1.bench).toHaveLength(2);
    expect(prompt.destinations).toHaveLength(1);
    // …and it is the body the search benched, named by its SPOT rather than by
    // position in the list.
    const benched = found.state.players.p1.bench.findIndex((b) => b.stack.includes(found.uid));
    expect(benched).toBe(1);
    expect(prompt.destinations[0]).toEqual({ seat: "p1", spot: { spot: "bench", index: benched } });
  });

  it("🛑 THE PARK'S ARITY DOES NOT COLLAPSE, and the FLOOR is why", () => {
    // The design question this slice was commissioned on, answered by measurement.
    // Pinning the destination removes ONE of `moveEnergy`'s two coupled decisions —
    // the prompt now asks *which Energy* and nothing else. It does **not** remove the
    // park: `parkOrForce`'s forced arm is gated on `floor > 0 && destinations.length
    // === 1`, and `moveFloor` answers 0 for every quantifier but `"all"`. The printed
    // determiner here is *"an Energy"*, so the DECLINE is still an answer and a
    // one-destination one-Energy board still offers TWO.
    //
    // 🛑 D441's gate is the reason, and it is the reason its own `what` states: the
    // force is gated on the FLOOR and not on the destination count alone, because
    // Armarouge and Exp. Share both offer one destination and both must still ask.
    // This printing is the FIRST to reach that gate with a pinned destination, and it
    // parks — so D441's `no-force-at-one-destination` row gains a second, stronger
    // witness rather than losing one (D459's converse).
    const found = findOne(table({ ownBench: 1 }));
    const prompt = movePark(found.state);
    expect(prompt.destinations).toHaveLength(1);
    expect("min" in prompt).toBe(false);
    expect(prompt.max).toBe(1);
    // TWO movable Energy, so "which Energy" is a live question and not a formality —
    // and they are DISTINCT classes (a Basic and a Special), which is what keeps the
    // offer from collapsing (D489's `cardIdentity` note).
    expect(prompt.movable).toHaveLength(2);
    const kinds = prompt.movable.map((m) => found.state.cardIdByUid[m.uid]);
    expect([...kinds].sort()).toEqual(["fix-energy", "fix-special"]);
    // …and the DECLINE really is accepted, which is what "the arity did not collapse"
    // means as a board fact rather than as a reading of the code.
    const declined = mustApply(found.state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "moveEnergy", picks: [] },
    });
    expect(declined.state.phase.kind).not.toBe("effect:choose");
    expect(events(declined.events, "ENERGY_MOVED")).toHaveLength(0);
    expect(declined.state.players.p1.bench[1]?.energy).toEqual([]);
  });

  it("ACCEPTS the pick, and the Energy lands on the body the search benched", () => {
    const found = findOne(table({ ownBench: 1 }));
    const prompt = movePark(found.state);
    const dest = prompt.destinations[0] as PokemonRef;
    const uid = prompt.movable[0]?.uid as string;
    const done = mustApply(found.state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "moveEnergy", picks: [{ uid, dest }] },
    });
    expect(done.state.phase.kind).not.toBe("effect:choose");
    expect(done.state.players.p1.bench[1]?.energy).toEqual([uid]);
    // 🛑 THE PRE-EXISTING BENCH BODY IS THE CONTROL — the pin's whole content. Under
    // a build that dropped it the player could have answered with this body, and
    // under one that INVERTED it this is the only body they could have answered with.
    expect(done.state.players.p1.bench[0]?.energy).toEqual([]);
    expect(done.state.players.p1.active?.energy).toHaveLength(1);
    const rows = events(done.events, "ENERGY_MOVED");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      seat: "p1",
      actor: "p1",
      uids: [uid],
      from: { spot: "active" },
      to: { spot: "bench", index: 1 },
    });
  });

  it("🛑 A WIRE ANSWER AIMED AT THE OTHER BENCH BODY IS REFUSED", () => {
    // The pin as an executable refusal rather than a narrowed list. `validateChoice`
    // matches the answer against the PROMPT, and the prompt's `destinations` is
    // already the narrowed one — which is why this rider rides the OP alone and costs
    // zero `packages/schema`, `redact.ts`, `projection.ts` or HUD bytes (D443's
    // argument, not `anySource`'s).
    const found = findOne(table({ ownBench: 1 }));
    const uid = movePark(found.state).movable[0]?.uid as string;
    expectErr(
      found.state,
      {
        type: "resolveEffect",
        seat: "p1",
        choice: {
          kind: "moveEnergy",
          picks: [{ uid, dest: { seat: "p1", spot: { spot: "bench", index: 0 } } }],
        },
      },
      "BAD_EFFECT_CHOICE",
    );
    // …and the ACTIVE is refused too, which the bench case alone does not prove.
    expectErr(
      found.state,
      {
        type: "resolveEffect",
        seat: "p1",
        choice: {
          kind: "moveEnergy",
          picks: [{ uid, dest: { seat: "p1", spot: { spot: "active" } } }],
        },
      },
      "BAD_EFFECT_CHOICE",
    );
  });

  it("🛑 THE ATTRIBUTION CONTROL: the BARE HEAD benches and moves NOTHING", () => {
    // D214, and it is a REAL printing (7 legal) rather than a construction: the same
    // op, the same filter, the same destination, no §9.2 tail. A build that moved an
    // Energy after every bench search — or that filed a record unconditionally — is
    // green on every rung above and RED here.
    const swung = swing(table({ ownBench: 1 }), BENCH_CALL);
    const prompt = searchPark(swung.state);
    const uid = prompt.candidates.find((u) => swung.state.cardIdByUid[u] === "fix-kissfound");
    const done = mustApply(swung.state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [uid as string] },
    });
    expect(done.state.phase.kind).not.toBe("effect:choose");
    expect(done.state.players.p1.bench).toHaveLength(2);
    expect(done.state.players.p1.bench[1]?.energy).toEqual([]);
    expect(done.state.players.p1.active?.energy).toHaveLength(2);
    expect(events(done.events, "ENERGY_MOVED")).toHaveLength(0);
  });

  it("🛑 the SEAT control — the opponent's board is never a destination", () => {
    // `moveBoardSeat` answers the CONTROLLER's board for an absent `side`, and the
    // record is filed by the controller's own op, so the narrowing cannot reach
    // across. Both halves matter: the offer AND the wire.
    const found = findOne(table({ ownBench: 1 }));
    const prompt = movePark(found.state);
    expect(prompt.destinations.every((d) => d.seat === "p1")).toBe(true);
    expect(prompt.movable.every((m) => m.from.seat === "p1")).toBe(true);
    const before = found.state.players.p2;
    const uid = prompt.movable[0]?.uid as string;
    const done = mustApply(found.state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "moveEnergy", picks: [{ uid, dest: prompt.destinations[0] as PokemonRef }] },
    });
    expect(done.state.players.p2.active).toEqual(before.active);
    expect(done.state.players.p2.bench).toEqual(before.bench);
  });
});

describe("§5 — the EMPTY-RECORD case: the printed *any* answers NO by itself", () => {
  it("🛑 the DECLINED search files `[]`, the gate is false, and nothing else happens", () => {
    // The case the printed *"if you put ANY Pokémon onto your Bench in this way"* is
    // about, and it needs no guard anywhere in the program: `searchDeck`'s park is
    // `min: 0`, so an empty answer is legal; `searchMove` moves nothing; the record is
    // filed as `[]`; and `recordGateHolds` asks `filed.length === 0` rather than
    // whether the KEY is there. **Silent, not a park with no candidates.**
    const swung = swing(table({ ownBench: 1 }));
    const declined = mustApply(swung.state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [] },
    });
    expect(declined.state.phase.kind).not.toBe("effect:choose");
    expect(declined.state.players.p1.bench).toHaveLength(1);
    expect(declined.state.players.p1.active?.energy).toHaveLength(2);
    expect(events(declined.events, "ENERGY_MOVED")).toHaveLength(0);
    // …and the printed shuffle STILL fires, which is the Nest Ball pattern and the
    // half a "the gate swallowed the program" build would break.
    expect(events(declined.events, "SHUFFLE")).toHaveLength(1);
  });

  it("🛑 a search that can find NOTHING is the same silence, one seam earlier", () => {
    // The WHIFF path, reached by emptying the candidate set rather than by a full
    // Bench — so the op returns `{done}` from `stepOp` and never parks at all. The
    // record is filed `[]` there too, and the gate reads it the same way.
    const bare = table({ ownBench: 1, basics: 0 });
    // Every Basic must be gone, not just the intended one — the deck also holds
    // `fix-invitingkiss` and `fix-bigbody`, which ARE Basics, so the honest whiff
    // board removes all of them.
    let state = bare;
    for (const id of ["fix-invitingkiss", "fix-bigbody"]) {
      const n = state.players.p1.deck.filter((u) => state.cardIdByUid[u] === id).length;
      if (n > 0) state = discardFromDeck(state, "p1", id, n);
    }
    const basics = state.players.p1.deck.filter((u) => {
      const card = POOL[state.cardIdByUid[u] ?? ""];
      return card?.category === "Pokemon" && card?.stage === "Basic";
    });
    expect(basics).toHaveLength(0);
    const done = swing(state);
    // No park at all — neither the search's nor the move's.
    expect(done.state.phase.kind).not.toBe("effect:choose");
    expect(done.state.players.p1.bench).toHaveLength(1);
    expect(done.state.players.p1.active?.energy).toHaveLength(2);
    expect(events(done.events, "ENERGY_MOVED")).toHaveLength(0);
    expect(events(done.events, "DECK_SEARCHED")).toHaveLength(0);
    // …and the shuffle still fires on the whiff, exactly as it does on the decline.
    expect(events(done.events, "SHUFFLE")).toHaveLength(1);
  });

  it("🛑 and the ADMISSION on the same axis: the gate DOES fire when a body arrives", () => {
    // D424's rule — every "X is refused" owes a neighbouring "Y is admitted" on the
    // same axis, or the two silences above pass on a build that never fires the gate
    // at all.
    const found = findOne(table({ ownBench: 1 }));
    expect(found.state.phase.kind).toBe("effect:choose");
    expect(movePark(found.state).destinations).toHaveLength(1);
  });

  it("🛑 an EMPTY BENCH still parks the move — the pin is not a bench-count test", () => {
    // The one-destination board is reached two ways and only one of them is the pin.
    // With no pre-existing body, `selfToBench` would offer exactly ONE destination
    // anyway — which is precisely the collision board D485 warns about, and it is
    // driven here as the CONTROL for §4's separating board rather than as the main
    // case. The answer must be the same body and the park must still exist.
    const found = findOne(table({ ownBench: 0 }));
    const prompt = movePark(found.state);
    expect(found.state.players.p1.bench).toHaveLength(1);
    expect(prompt.destinations).toEqual([{ seat: "p1", spot: { spot: "bench", index: 0 } }]);
    // 🛑 AND THIS IS WHY §4's BOARD FIELDS A SECOND BODY: on THIS board the pinned and
    // un-pinned offers are byte-identical, so every rung here is green under a build
    // that ignores `destRecorded` entirely.
    expect(prompt.destinations).toHaveLength(1);
  });
});

describe("§6 — the describer and the log rows, RENDERED", () => {
  it("🛑 `withConsequence` FIRES, and the caption is the card's printed second half", () => {
    // D478/D489: describer obligations follow the CALL PATH, not the op's category —
    // and two consecutive slices predicted this work from "the op parks" and found
    // the obligation empty. Here it is LIVE, and it took three edits to make it so:
    // `recordSlotOf` had to learn `searchDeck` (eighth recorder), `describeCondition`
    // had to learn its printed long-form condition, and `describeBranch` had to learn
    // `moveEnergy`. Drop any one and the caption silently loses the clause while the
    // census, the residue and every board rung above stay green (D473).
    const prompt = searchPark(swing(table({ ownBench: 1 })).state);
    expect(prompt.note).toBe(
      "Search your deck for a Basic Pokémon onto your Bench." +
        " If you put any Pokémon onto your Bench in this way," +
        " move an Energy from this Pokémon to the new Benched Pokémon.",
    );
    // 🛑 THE CONDITION IS THE PRINTED LONG FORM AND NOT "If you do", which is
    // `bottomFromOpponentHand`'s precedent one op over and for its stated reason:
    // the note is the printed text, and this is the text printed.
    expect(prompt.note).toContain("If you put any Pokémon onto your Bench in this way,");
    expect(prompt.note).not.toContain("If you do");
    // …and the BARE HEAD's caption is byte-identical to what it was before this
    // slice, which is what makes the rung above about the TAIL.
    expect(searchPark(swing(table({ ownBench: 1 }), BENCH_CALL).state).note).toBe(
      "Search your deck for a Basic Pokémon onto your Bench.",
    );
  });

  it("🛑 the MOVE park's own heading names the PINNED destination, not `1 of your Benched Pokémon`", () => {
    // D421/D456: a caption is a claim with the same standing as a predicate, and the
    // test is never "is it stilted" but "does it assert something this path makes
    // untrue". The inherited `selfToBench` phrase promises a choice among the Bench;
    // the park carries exactly one destination, and on §4's board the attacker has
    // another Benched body the player may NOT pick.
    const found = findOne(table({ ownBench: 1 }));
    expect(movePark(found.state).note).toBe(
      "Move an Energy from this Pokémon to the new Benched Pokémon.",
    );
    // …and the shipped sibling's caption is untouched — the override is below the
    // chain, so no own-board caption's bytes moved (D443's shape).
    expect(movePark(found.state).note).not.toContain("1 of your Benched Pokémon");
  });

  it("🛑 the LOG ROWS, RENDERED rather than reasoned about (D456/D499/D501)", () => {
    const found = findOne(table({ ownBench: 1 }));
    const prompt = movePark(found.state);
    const uid = prompt.movable[0]?.uid as string;
    const done = mustApply(found.state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "moveEnergy", picks: [{ uid, dest: prompt.destinations[0] as PokemonRef }] },
    });
    const ctx: LogContext = {
      state: done.state,
      names: { p1: "Ash", p2: "Gary" },
      elapsed: "+00:00",
    };
    const text = logFromEvents([...found.events, ...done.events], ctx)
      .map((row) => (row.kind === "action" ? row.segments.map((seg) => seg.text).join("") : ""))
      .filter((line) => /searched|shuffled|moved/.test(line));
    // 🛑 THE HONEST LIMIT AT THE RUNG (D465): both rows are SHIPPED arms and this
    // slice adds none. `DECK_SEARCHED { dest: "bench" }` is count-only by D225's
    // information argument (a benched card is public a moment later), and
    // `ENERGY_MOVED` names both endpoints. What this rung proves is that the pair
    // reads correctly TOGETHER for a program that emits them in this order — which no
    // other suite drives, because no other program does.
    expect(text).toEqual([
      "searched their deck — benched 1 Pokémon",
      "shuffled their deck",
      // 🛑 AND THE DESTINATION SEGMENT NAMES THE BODY THE SEARCH BENCHED, not the
      // spot and not the pre-existing Bench body sitting beside it. That is the pin
      // reaching the one surface a player actually reads, and it is `targetName`'s
      // shipped resolution rather than anything this slice wrote.
      "moved 1 energy from fix-invitingkiss to fix-kissfound",
    ]);
  });

  it("🛑 the DECLARED SURVIVOR's POPULATION, made executable (D465/D477)", () => {
    // `D502-describe-condition-ignores-the-destination` is declared
    // `unreachable-population`, and D477's rule is that a `--decision` probe CANNOT
    // sample a reason of that shape: the probe shows the row surviving against one
    // suite, where the claim quantifies over the whole corpus and the whole registry.
    // So the population half is asserted here instead of left in the row's prose.
    //
    // Walked: every op the derived attack column produces over all 640 corpus rows,
    // plus every program-bearing slot of every `registryCardIds()` entry, descending
    // into `recordGate.then`, `coinFlipGate.otherwise` and `perHeads.ops`.
    const walk = (ops: readonly unknown[]): Record<string, unknown>[] => {
      const out: Record<string, unknown>[] = [];
      for (const o of ops as Record<string, unknown>[]) {
        out.push(o);
        for (const key of ["then", "otherwise", "ops"]) {
          const nested = o[key];
          if (Array.isArray(nested)) out.push(...walk(nested));
        }
      }
      return out;
    };
    const all: Record<string, unknown>[] = [];
    for (const [, text] of legalAttackCorpus()) all.push(...walk(deriveAttackEffect(text) ?? []));
    for (const id of registryCardIds()) {
      const program = programFor(id);
      if (program === undefined) continue;
      for (const value of Object.values(program as Record<string, unknown>)) {
        if (Array.isArray(value)) all.push(...walk(value));
        else if (value !== null && typeof value === "object") {
          for (const inner of Object.values(value as Record<string, unknown>)) {
            if (Array.isArray(inner)) all.push(...walk(inner));
          }
        }
      }
    }
    const searches = all.filter((o) => o.op === "searchDeck");
    const recording = searches.filter((o) => o.recordAs !== undefined);
    expect(searches.length).toBe(77); // 🆕 D513 — `searchDeck` producer sites over the corpus + registry. +1: the new `of different types` arm emits one more `searchDeck` literal (corpus FILE LINE 473). The `recording` figure below is UNMOVED at 1 — the new op carries no `recordAs` — which is what keeps the declared survivor's population claim about `recordAs` and not about searches.
    expect(recording).toHaveLength(1);
    expect(recording[0]?.dest).toBe("bench");
    // …and the OTHER two destinations really are printed, so the guard's refused arms
    // are reachable in principle and unreachable only because no non-Bench search
    // records. That is what makes the declaration a measurement rather than a shape
    // claim — and what makes the row go KILLED (and the run STALE-SURVIVOR) the day a
    // hand or deck-top search gains a `recordAs`.
    expect([...new Set(searches.map((o) => o.dest))].sort()).toEqual([
      "bench",
      "deckTop",
      "hand",
    ]);
  });

  it("the wire prompt carries no new key — the rider rides the OP alone", () => {
    // D457's five mirrors, priced at ZERO and DRIVEN. `anySource` and `anyDest` ride
    // the PROMPT because they are COUPLINGS invisible in the candidate lists; a
    // destination NARROWING is spelled by every candidate, so `packages/schema`,
    // `redact.ts`, `projection.ts` and both HUDs are untouched.
    const found = findOne(table({ ownBench: 1 }));
    const wire = redactGame(found.state, "p1");
    if (wire.phase.kind !== "effect:choose") throw new Error("expected a wire park");
    const prompt = wire.phase.prompt;
    if (prompt === null || prompt.kind !== "moveEnergy") {
      throw new Error("expected a wire moveEnergy prompt");
    }
    expect(Object.keys(prompt).sort()).toEqual([
      "destinations",
      "kind",
      "max",
      "movable",
      "note",
    ]);
    expect("destRecorded" in prompt).toBe(false);
    expect(prompt.destinations).toHaveLength(1);
  });
});

describe("§7 — the persisted shape: `MATCH_RECORD_VERSION` stays 30", () => {
  it("🛑 THE ADDRESS, NAMED FIRST — and there are TWO doors, not one", () => {
    // D456/D499/D501's rule: name the ADDRESS before the argument. A `MatchRecord`
    // is `{version, seed, startedAt, state, log, names}`; `state` is a `GameState`
    // whose `effect:choose` phase holds a PROMPT and an `EffectContinuation`
    // (`{pendingOp, rest, ctx, record?}`). This slice's two new keys land at BOTH of
    // that continuation's doors:
    //
    //   · `searchDeck.recordAs` — the PARKING op, so it rides `pendingOp`;
    //   · `moveEnergy.destRecorded` — the op BEHIND the parking one, inside a
    //     `recordGate.then` inside `rest`. **D450's second door, and the one that
    //     gets forgotten.**
    //
    // Neither the REACHABILITY argument (D450/D461) nor the SERIALIZED-ALPHABET one
    // (D462/D473) is available: this op parks and both keys are new bytes. The only
    // discriminator left is `match.ts`'s own — *does the OLD byte string still mean
    // what it meant* — and it is asked over real serialized bytes below.
    const live = swing(table({ ownBench: 1 })).state;
    if (live.phase.kind !== "effect:choose") throw new Error("expected a park");
    const bytes = JSON.parse(JSON.stringify(live.phase.cont)) as {
      pendingOp: Record<string, unknown>;
      rest: Record<string, unknown>[];
      record?: unknown;
    };
    expect(bytes.pendingOp.op).toBe("searchDeck");
    expect(bytes.pendingOp.recordAs).toBe("moved"); // door one, IN the bytes
    expect(bytes.rest.map((o) => o.op)).toEqual(["shuffleDeck", "recordGate"]);
    const gate = bytes.rest[1] as { then: Record<string, unknown>[] };
    expect(gate.then[0]?.destRecorded).toBe("moved"); // door two, ALSO in the bytes
    // 🛑 AND THE KEY-SET RUNG THE OPTIONAL SHAPE WOULD HAVE DISARMED (D501's
    // question). `derivedBenchSearch.test.ts` already pins
    // `Object.keys(search).sort() === ["dest","filter","max","op"]` — over the BARE
    // HEAD's program, which has no `recordAs`. An optional key SATISFIES that rung
    // while reaching nothing it protects, so it would have gone on passing whether or
    // not this arm emitted the field. This is the rung that covers the new key.
    expect(Object.keys(bytes.pendingOp).sort()).toEqual([
      "dest",
      "filter",
      "max",
      "op",
      "recordAs",
    ]);
    expect(Object.keys(gate.then[0] ?? {}).sort()).toEqual([
      "destRecorded",
      "filter",
      "max",
      "op",
      "route",
    ]);
    // ⚠️ NO `satisfies` GUARD EXISTS ON EITHER OP LITERAL — grepped, and stated as a
    // measurement rather than a hope: the only `satisfies Extract<EffectOp, …>` sites
    // in the repo are `knockOutChosen.test.ts`'s two. So unlike D501, there was no
    // compile-time instrument for an optional key to silently satisfy; the key-set
    // rungs above are the whole of the cover, which is why they are here and not
    // implied.
  });

  it("🛑 A v30 `searchDeck` PARK — no `recordAs` — RESUMES EXACTLY AS IT DID", () => {
    // The compatibility claim, driven over bytes a v30 deploy really wrote: the BARE
    // HEAD's park is the v30 shape, and this build reads its absent `recordAs` as
    // "file nothing". D125's test answered NO, which is D333's widened `max` and
    // D334's added optional `exact` on the sibling op.
    const swung = swing(table({ ownBench: 1 }), BENCH_CALL);
    const v30: GameState = JSON.parse(JSON.stringify(swung.state)) as GameState;
    if (v30.phase.kind !== "effect:choose") throw new Error("expected a park");
    expect(Object.keys(v30.phase.cont.pendingOp).sort()).toEqual(["dest", "filter", "max", "op"]);
    expect("record" in v30.phase.cont).toBe(false);
    const uid = searchPark(v30).candidates.find((u) => v30.cardIdByUid[u] === "fix-kissfound");
    const done = mustApply(v30, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [uid as string] },
    });
    expect(done.state.players.p1.bench).toHaveLength(2);
    expect(done.state.phase.kind).not.toBe("effect:choose");
  });

  it("🛑 AND THE OTHER DIRECTION: the keys DELETED by hand answer a DIFFERENT NUMBER", () => {
    // D441/D501: the question is never "is the key optional" but "does the ABSENT key
    // still say what the old writer meant" — and the honest way to ask it is to
    // delete the keys from real bytes and replay through the real action API.
    //
    // A v30 record could not hold THIS program at all (the sentence was refused, so
    // no v30 writer could author the sequence), which is the strongest form of the
    // condition. What the rung shows is the DEGRADATION, measured rather than
    // classified from the shape (D435): the search still benches, the gate reads an
    // unfiled slot as FALSE, and no Energy moves. **Silent — D124's benign soft
    // landing — and the numbers differ: ONE Energy against ZERO, and a second park
    // against none.**
    const live = swing(table({ ownBench: 1 })).state;
    const bytes: GameState = JSON.parse(JSON.stringify(live)) as GameState;
    if (bytes.phase.kind !== "effect:choose") throw new Error("expected a park");
    // ⚠️ REST-DESTRUCTURING RATHER THAN `delete`, which is the sibling suites' idiom
    // (`derivedSpreadEnergyMove.test.ts` §7) and also what Biome's `noDelete` leaves
    // standing — the two agree here, so the shape is the shipped one either way.
    const { recordAs: _filed, ...v30Search } = bytes.phase.cont.pendingOp as unknown as Record<
      string,
      unknown
    >;
    const gate = bytes.phase.cont.rest[1] as unknown as { then: Record<string, unknown>[] };
    const { destRecorded: _pin, ...v30Move } = (gate.then[0] ?? {}) as Record<string, unknown>;
    const stripped: GameState = {
      ...bytes,
      phase: {
        ...bytes.phase,
        cont: {
          ...bytes.phase.cont,
          pendingOp: v30Search as unknown as EffectOp,
          rest: [
            bytes.phase.cont.rest[0] as EffectOp,
            // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable.
            { ...gate, then: [v30Move] } as unknown as EffectOp,
          ],
        },
      },
    };
    const uid = searchPark(stripped).candidates.find(
      (u) => stripped.cardIdByUid[u] === "fix-kissfound",
    );
    const old = mustApply(stripped, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [uid as string] },
    });
    // The old answer is still ACCEPTED — nothing throws, nothing corrupts.
    expect(old.state.players.p1.bench).toHaveLength(2);
    // …and it answers a different number.
    expect(old.state.phase.kind).not.toBe("effect:choose");
    expect(old.state.players.p1.bench[1]?.energy).toEqual([]);
    expect(old.state.players.p1.active?.energy).toHaveLength(2);
    expect(events(old.events, "ENERGY_MOVED")).toHaveLength(0);
    // THE POSITIVE CONTROL on the same board: with the keys, the second park exists
    // and one Energy moves.
    const found = findOne(table({ ownBench: 1 }));
    expect(movePark(found.state).destinations).toHaveLength(1);
    expect(found.state.players.p1.bench[1]?.energy).toEqual([]);
  });

  it("the running §9.2 record reaches the bytes as an EXISTING optional field", () => {
    // `EffectContinuation.record?` has shipped since §9.2 and `carriedRecord` spreads
    // it rather than assigning, so a program that never touches the record parks into
    // the exact phase shape it always did. This one DOES touch it, at the second park.
    const found = findOne(table({ ownBench: 1 }));
    if (found.state.phase.kind !== "effect:choose") throw new Error("expected a park");
    const cont = found.state.phase.cont;
    expect(Object.keys(cont).sort()).toEqual(["ctx", "pendingOp", "record", "rest"]);
    expect(cont.record).toEqual({ moved: [found.uid] });
    // …and the bare head's continuation carries NO `record` key at all, which is the
    // control that makes the line above about this slice.
    const bare = swing(table({ ownBench: 1 }), BENCH_CALL).state;
    if (bare.phase.kind !== "effect:choose") throw new Error("expected a park");
    expect(Object.keys(bare.phase.cont).sort()).toEqual(["ctx", "pendingOp", "rest"]);
  });
});

describe("§8 — the census this row moves, and the summands it does not", () => {
  it("🛑 the resolving corpus gains ONE sentence and ONE printing", () => {
    // ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1, and that was
    // VERIFIED at the corpus rather than assumed from the row being singular
    // (D451/D461/D464): the file line reads `1 <sentence>`.
    const resolved = legalAttackCorpus().filter(([, s]) => resolvedByAnyReader(s));
    expect([resolved.length, units(resolved)]).toEqual([540, 1578]);  // (🆕🆕🆕 **D513 +1 sentence / +1 printing — THE PRINTED *“of different types”*, THE FIRST DISTINCTNESS CONSTRAINT THIS ENGINE READS** — `censusAttackCorpus.ts` **FILE LINE 473**, *"Search your deck for up to 3 Basic Energy cards of different types, reveal them, and put them into your hand. Then, shuffle your deck."*, **1 sentence / 1 legal printing** (Sylveon ex `sv06.5-050`), claimed by `deriveAttackEffect` on THIS FILE'S OWN OP: `searchDeck` gains its FIFTH optional key, `distinctEnergyTypes`. 🛑 **THE ANCHOR WAS NEVER THE BLOCKER** — `ATTACK_HAND_SEARCH`'s `([^,.]+?)` noun group has captured `Basic Energy cards of different types` WHOLE since D231 and the sentence died one step later in `HAND_SEARCH_PLURAL.get`, so the new group MOVES a phrase out of the noun rather than admitting a sentence the pattern refused (D510's rule, paid a second time). ✅ **ZERO new `CardFilter` members, and no widening of that union could ever reach this row** — `matchesFilter` narrows each card INDEPENDENTLY while *“of different types”* is a predicate on the ANSWER SET. It is carried by D332's shipped `chooseCards.caps` instead, one cap of ONE per `energyProvidesOf` cell, so there is **ZERO** new prompt field, validator branch or client mirror. `MATCH_RECORD_VERSION` **HELD at 30** at the door this file's §7 already drives, `EffectContinuation.pendingOp`.) (🆕🆕🆕 **D512 +1 sentence / +2 printings — THE BOTH-SIDES BODY COUNT NARROWED BY TWO PRINTED NAME FRAGMENTS** — `censusAttackCorpus.ts` **FILE LINE 583**, *"This attack does 40 damage for each Pokémon in play that has \"Koffing\" or \"Weezing\" in its name (both yours and your opponent's)."*, **1 sentence / 2 legal printings**, claimed by `deriveAttackDamageMultiplier` over ONE new anchor (`IN_PLAY_BOTH_SIDES_NAME_MULTIPLY`), ONE new `CardFilter` member (`pokemonNameContaining`) and ONE new `DamageCountSource` member (`bothSidesPokemonInPlay` — the FIRST both-sides count in that union to carry a `CardFilter`; `bothSidesBenchCount` and `bothActivesEnergyCount` are both BARE, because their printed nouns carry no adjective and this one's is NARROWED in print). 🛑 **THE SHIPPED ANCHORS WERE RUN AGAINST THE ROW FIRST AND ALL FOUR REFUSE IT AT THE PATTERN** — the OPPOSITE answer to D510's one row up, and the reason this row genuinely owed a pattern: every in-play anchor requires the literal `for each of your ` and this sentence's head is SEATLESS, with the side named by a trailing parenthetical. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP DISAGREE AT 1 AND 2**, measured at this head rather than carried (D451/D461). RAW summand ALONE: no registry row, no gate split and no trailing split — re-measured unmoved at registry 10/16, gate 5/13, trailing 11/21.) (🆕🆕🆕 **D510 +1 sentence / +2 printings — THE DISCARD PILE NARROWED BY A PRINTED NAME FRAGMENT** — `censusAttackCorpus.ts` **FILE LINE 543**, *"This attack does 20 damage for each Supporter card that has \"Team Rocket\" in its name in your discard pile."*, **1 sentence / 2 legal printings**, claimed by `deriveAttackDamageMultiplier` through ONE new `CardFilter` member (`supporterNameContaining`) and ONE PARAMETERISED noun in `discardPileFilter` — **ZERO new anchors**, because D440’s shipped `DISCARD_PILE_COUNT_MULTIPLY` had matched this row since it was written and the NOUN RESOLVER was the blocker. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP DISAGREE AT 1 AND 2** — a TWO-printing sentence, the opposite of D508 one entry down, measured at this head rather than carried (D451/D461). RAW summand ALONE: registry 10/16, gate 5/13 and trailing 11/21 all re-measured unmoved.) (🆕🆕🆕 **D508 +1 sentence / +1 printing — THE DISCARD PILE NARROWED BY A PRINTED ATTACK NAME** — `censusAttackCorpus.ts` **FILE LINE 542**, *"This attack does 20 damage for each Pokémon in your discard pile that has the United Wings attack."*, **1 sentence / 1 legal printing**, claimed by `deriveAttackDamageMultiplier` over ONE new anchor (`DISCARD_PILE_ATTACK_NAME_MULTIPLY`) crossing D440's `cardsInDiscardPile` count with D446's `attackNamePokemon` filter — **ZERO new members in either union, ZERO evaluator bytes**. READER summand ALONE; registry, gate and trailing stand still at 10/16, 5/13, 11/21.) (🆕🆕🆕 **D507 +2 sentences / +2 printings — THE SPREAD THAT HITS **BOTH** BENCHES, AND THE OPTIONAL PRINTED CLAUSE THAT NARROWS IT TO THE ALREADY-DAMAGED BODIES** — `censusAttackCorpus.ts` **FILE LINES 515 and 526**, *"This attack also does 10 damage to each Benched Pokémon (both yours and your opponent's). (Don't apply Weakness and Resistance for Benched Pokémon.)"* and *"This attack also does 40 damage to each Benched Pokémon **that has any damage counters on it** (both yours and your opponent's). (Don't apply…)"*, **2 sentences / 2 legal printings**, both claimed by `deriveAttackEffect` arm **6-ii** over ONE new anchor (`SPREAD_EACH_BOTH_BENCH`) whose OPTIONAL GROUP *is* the rider. 🛑 **THE BOTH-SIDES HALF COSTS NO TYPE AT ALL: it is a TWO-OP PROGRAM OF THE SAME OP** — `spreadDamage { yourBench }` then `spreadDamage { opponentBench }` — which is D482's shipped answer to the identical question one zone over, so `spreadDamage.target` gains **NO third member** and `counterEachAll`'s `filter` + `side` shape was refused rather than copied (D448/D449/D465's thrice-refused widening, same class). The op gains ONE OPTIONAL BOOLEAN RIDER, `damagedOnly` — `counterEachAll`'s own name on its own predicate `hasAnyDamageCounters`, D505's idiom one rider later. **ZERO** new `EffectOp` members, op KINDS, readers (surface unmoved at **13**), `CardFilter`/`BoardCondition`/`DamageCountSource` members, prompts, choice kinds, parks, events, error codes, `GameState`/`InPlayPokemon` fields, registry rows, `FIXTURE_POOL` ids (file-local `cardPool`, D414), `redact.ts` bytes, `packages/schema` bytes or `MATCH_RECORD_VERSION` bytes. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 2 AND 2**, MEASURED at this head rather than carried (D451/D461/D465) — both rows are 1-printing sentences. RAW summand ALONE: no registry row, no gate split, no trailing split — all three re-measured unmoved at registry 10/16, gate 5/13, trailing 11/21.) (🆕🆕🆕 **D505 +1 sentence / +3 printings — THE PRIZE-SCALED BENCH SPREAD, THE MISSING CELL OF A SHIPPED 2×2** — `censusAttackCorpus.ts` **FILE LINE 517**, *"This attack also does 10 damage to each of your opponent's Benched Pokémon for each Prize card your opponent has taken. (Don't apply Weakness and Resistance for Benched Pokémon.)"*, **1 sentence / 3 legal printings**, claimed by `deriveAttackEffect` arm **6-i** over ONE new anchor (`SPREAD_EACH_BENCH_TAKEN_PRIZES`) and ONE OPTIONAL BOOLEAN RIDER on the SHIPPED `spreadDamage` (`perTakenPrize` — D448's own name spelled on a second op, so `snipeAmount`'s structural parameter folds it UNCHANGED). **ZERO** new `EffectOp` members, op KINDS, readers (surface unmoved at **13**), prompts, choice kinds, parks, events, `GameState`/`InPlayPokemon` fields, registry rows, `FIXTURE_POOL` ids or `MATCH_RECORD_VERSION` bytes. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP DISAGREE, 1 vs 3**, so a `.length` site takes +1 where a `units(…)` site takes +3 — the largest single printing step left in the residue's spread family, and the reason this row was worth taking before smaller ones (D451, re-paid again).)
    const without = resolved.filter(([, s]) => s !== SENTENCE);
    expect([without.length, units(without)]).toEqual([539, 1577]);  // (🆕🆕🆕 **D513 +1 sentence / +1 printing, inherited by this BEFORE-figure because it is the live sum minus this file's own row — THE PRINTED *“of different types”*, THE FIRST DISTINCTNESS CONSTRAINT THIS ENGINE READS** — `censusAttackCorpus.ts` **FILE LINE 473**, *"Search your deck for up to 3 Basic Energy cards of different types, reveal them, and put them into your hand. Then, shuffle your deck."*, **1 sentence / 1 legal printing** (Sylveon ex `sv06.5-050`), claimed by `deriveAttackEffect` on THIS FILE'S OWN OP: `searchDeck` gains its FIFTH optional key, `distinctEnergyTypes`. 🛑 **THE ANCHOR WAS NEVER THE BLOCKER** — `ATTACK_HAND_SEARCH`'s `([^,.]+?)` noun group has captured `Basic Energy cards of different types` WHOLE since D231 and the sentence died one step later in `HAND_SEARCH_PLURAL.get`, so the new group MOVES a phrase out of the noun rather than admitting a sentence the pattern refused (D510's rule, paid a second time). ✅ **ZERO new `CardFilter` members, and no widening of that union could ever reach this row** — `matchesFilter` narrows each card INDEPENDENTLY while *“of different types”* is a predicate on the ANSWER SET. It is carried by D332's shipped `chooseCards.caps` instead, one cap of ONE per `energyProvidesOf` cell, so there is **ZERO** new prompt field, validator branch or client mirror. `MATCH_RECORD_VERSION` **HELD at 30** at the door this file's §7 already drives, `EffectContinuation.pendingOp`.) (🆕🆕🆕 **D512 — THE BOTH-SIDES BODY COUNT NARROWED BY TWO PRINTED NAME FRAGMENTS** — `censusAttackCorpus.ts` **FILE LINE 583**, **1 sentence / 2 legal printings**, claimed by `deriveAttackDamageMultiplier` over ONE new anchor, ONE new `CardFilter` member (`pokemonNameContaining`) and ONE new `DamageCountSource` member (`bothSidesPokemonInPlay`). **+1 sentence / +2 printings**, which this BEFORE-figure inherits because it is the live sum minus this slice's own row.) (🆕🆕🆕 **D510 +1 sentence / +2 printings — THE DISCARD PILE NARROWED BY A PRINTED NAME FRAGMENT** — `censusAttackCorpus.ts` **FILE LINE 543**, **1 sentence / 2 legal printings**, claimed by `deriveAttackDamageMultiplier` through ONE `CardFilter` member and ONE parameterised noun, **ZERO new anchors**. ⚠️ The SENTENCE step and the PRINTING step DISAGREE at 1 and 2.) (🆕🆕🆕 **D508 +1 sentence / +1 printing — THE DISCARD PILE NARROWED BY A PRINTED ATTACK NAME** — `censusAttackCorpus.ts` **FILE LINE 542**, *"This attack does 20 damage for each Pokémon in your discard pile that has the United Wings attack."*, **1 sentence / 1 legal printing**, claimed by `deriveAttackDamageMultiplier` over ONE new anchor (`DISCARD_PILE_ATTACK_NAME_MULTIPLY`) crossing D440's `cardsInDiscardPile` count with D446's `attackNamePokemon` filter — **ZERO new members in either union, ZERO evaluator bytes**. READER summand ALONE; registry, gate and trailing stand still at 10/16, 5/13, 11/21. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1**, measured per site rather than copied between the two kinds of site (D451/D461).) 🆕🆕🆕 **D505 +1 sentence / +3 printings — THE PRIZE-SCALED BENCH SPREAD (corpus FILE LINE 517).** This pair is the resolving set MINUS this file's own sentence, so it steps by exactly what the line above it steps by — which is the point of measuring both: a slice that moved only one of the two would be visible here (D451/D465).
  });

  it("🛑 the move is READER-keyed — no registry row, no splitter, no gate clause", () => {
    // The RAW summand alone, which is what makes the delta a single number in every
    // chain in the repo. `censusAtHead.test.ts` requires the registry summand to be
    // DISJOINT from the raw one, so a sentence served both ways reddens it (D457).
    expect(splitAttackGateClause(SENTENCE)).toBeNull();
    expect(splitAttackTrailingClause(SENTENCE)).toBeNull();
    expect(effects.splitAttackRequirementClause(SENTENCE)).toBeNull();
    expect(effects.splitAttackCancelClause(SENTENCE)).toBeNull();
  });

  it("🛑 A CENSUS STAYING GREEN UNDER A WRONG BUILD IS THE FINDING, NOT A GAP", () => {
    // D469/D489/D491's layer map, stated where a later slice will read it. Under the
    // nearest wrong build — the destination pin dropped, so the Energy may land on
    // ANY of the attacker's Benched Pokémon — this sentence still READS, this file's
    // §8 rungs are still green, `resolvedByAnyReader` is still true and the residue
    // still falls by one. **Only §4's board discriminates it**, and only because the
    // board fields a second Benched body.
    //
    // The map, measured at both layers by the D502 mutant rows:
    //   · census + loud controls — BLIND to a reader mutation AND to an executor one;
    //   · a value re-point onto the reader's answer (§2) — covers the READER only;
    //   · a behavioural board (§4–§6) — the only thing that covers the EXECUTOR.
    expect(resolvedByAnyReader(SENTENCE)).toBe(true);
    const program = deriveAttackEffect(SENTENCE) ?? [];
    const copy = JSON.parse(JSON.stringify(program)) as Record<string, unknown>[];
    const gate = copy[2] as { then: Record<string, unknown>[] };
    const { destRecorded: _pin, ...unpinnedMove } = (gate.then[0] ?? {}) as Record<string, unknown>;
    // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable.
    const unpinned = [copy[0], copy[1], { ...gate, then: [unpinnedMove] }];
    // The wrong build is a DIFFERENT program — which the census cannot see, because
    // the census asks whether a sentence is CLAIMED and never what it is claimed AS.
    expect(unpinned).not.toEqual(program);
    expect(JSON.stringify(unpinned)).not.toContain("destRecorded");
  });
});
