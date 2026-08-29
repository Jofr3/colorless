import { describe, expect, it } from "vitest";
import { legalAttackCorpus } from "./censusAttackCorpus";
import {
  deriveAttackCancelRequirement,
  deriveAttackDamageSuppression,
  deriveAttackEffect,
  deriveAttackRequirement,
  splitAttackCancelClause,
  splitAttackGateClause,
  splitAttackRequirementClause,
  splitAttackTrailingClause,
} from "./effects";
import type { GameState } from "./index";
import { programFor, registryCardIds } from "./registry";
import {
  SAWK_SPLIT_DECK,
  attachFromDeck,
  clearBench,
  driveSetup,
  mustApply,
  setActiveFromDeck,
  types,
} from "./testFixtures";

// D364 — TWO LEADING-SENTENCE STRIPPERS AT ONE SITE, IN A FIXED ORDER, AND
// NOTHING SAID WHAT HAPPENS TO A PRINTING CARRYING BOTH.
//
// D282 built `splitAttackGateClause`; D363 built `splitAttackRequirementClause`
// in its shape and put it BEHIND it at the one call site (attack.ts). Each slice
// asserted its own split. Neither asserted the COMPOSITION, and the site's own
// comment makes an order claim — *"Getting that order backwards would read the
// requirement off the companion sentence and cancel nothing"* — with nothing
// behind it. This file is what is behind it.
//
// 🛑 THE MEASUREMENT, RE-QUERIED RATHER THAN INHERITED (remote D1 `luminous`,
// `$.effect`, 2026-08-18, and re-derived LIVE in §1 below off the committed
// corpus). D363's handoff quoted the census D282 priced its refusal against:
// *"613 of 1,732 legal attack units are multi-sentence, and only 16 open with
// `If ` — 13 timing gates plus 3 `You can use this attack only if…`"*.
//
//   • **THE COUNTS REPRODUCE TO THE UNIT.** 1,732 units / 640 sentences; 613
//     units / 271 sentences multi-sentence; 16 units / 8 sentences opening `If `.
//   • **THE ATTRIBUTION DOES NOT, AND IT CANNOT** — a sentence that opens
//     *"You can use this attack only if…"* does not open with `If `, so those 3
//     printings were never IN the 16. The true partition is **10 + 6**: 10 of the
//     16 are the gate family's two `If `-spellings (7 BAN + 3 GATE), and the
//     remaining 6 are sentences whose leading `If` IS the substance — of which
//     **2 are the requirement family** (Sawk), the very rows D363 shipped. The
//     `13` is the WHOLE gate family (7 BAN + 3 GATE + 3 LICENCE); adding the
//     LICENCE arm again double-counts it and drops the 6.
//
// The arithmetic lands on 16 either way, which is exactly why it survived a
// slice: **a count can reproduce exactly while its attribution is wrong.** §1
// asserts the partition so the correction is a measurement rather than a
// paragraph.
//
// 🛑 AND THE ANSWER TO "SHOULD THIS BECOME ONE GENERIC COMPOSER" IS STILL NO,
// FOR A REASON THIS FILE MEASURES INSTEAD OF INHERITING: the two splits are
// **DISJOINT ON THE WHOLE CATALOG** — 0 of 1,732 legal units are claimed by both
// (§2). A `splitHead` that strips leading sentences in a loop would be
// scaffolding for a population of zero, which is D282's own refusal and D205's
// definition of the next vacuous guard. What ships instead is the ASSERTION: the
// order is pinned where the two splits meet (§3), and the disjointness is a
// TRIPWIRE that reddens by name the day a printing carries both.

/** Sawk `sv10.5w-049`/`-130` "Rising Chop" ({F}, 90 — the cost is ONE Fighting;
    see §4's note), as PRINTED. The catalog's only both-halves compound. */
const SAWK =
  "If your opponent's Active Pokémon isn't a Pokémon ex, this attack does nothing. This attack's damage isn't affected by Weakness or Resistance.";
/** Its leading requirement sentence. */
const SAWK_HEAD =
  "If your opponent's Active Pokémon isn't a Pokémon ex, this attack does nothing.";
/** Its trailing companion — `deriveAttackDamageSuppression`'s since D192. */
const SAWK_TAIL = "This attack's damage isn't affected by Weakness or Resistance.";
/** 🆕🆕 D417 — Eternatus `sv08-141` "World Ender", as PRINTED: the TRAILING,
    ANAPHORIC cancel and the fourth stripper's whole population (1 legal unit). */
const CANCEL_PRINTING = "Discard a Stadium in play. If you can't, this attack does nothing.";
/** Its head — `deriveAttackEffect`'s since D380, and the TABLE's key. */
const CANCEL_HEAD = "Discard a Stadium in play.";
/** Its trailing clause. Byte-identical on every member of the family, which is what
    "anaphoric" means and why the table cannot be keyed on it. */
const CANCEL_CLAUSE = "If you can't, this attack does nothing.";
/** D282's BAN spelling, printed on 7 legal units. */
const GATE_BAN = "If you go second, you can't use this attack during your first turn.";
/** D282's LICENCE spelling, printed on 3 legal units — and the one that is NOT
    in the 16, because it does not open with `If `. */
const GATE_LICENCE =
  "You can use this attack only if you go second, and only during your first turn.";

/** ⚠️ CONSTRUCTED, AND LABELLED CONSTRUCTED. No printing in 978 cards / 6 sets
    carries both a gate clause and a does-nothing sentence (§2 measures it), so
    this string is a COUNTEREXAMPLE, not a fixture — it exists to show that the
    site's order is a real commitment rather than an accident, and no card, deck
    or registry row is authored for it anywhere in this repo. */
const BOTH = `${GATE_BAN} ${SAWK}`;
/** The same two clauses in the other order. Also constructed. */
const REVERSED = `${SAWK_HEAD} ${GATE_BAN} ${SAWK_TAIL}`;

/** The site's order: gate clause off the front, THEN the requirement clause. */
function siteOrder(text: string): string {
  const gated = splitAttackGateClause(text)?.body ?? text;
  return splitAttackRequirementClause(gated)?.body ?? gated;
}
/** The other order. Not what attack.ts does — the control for §3. */
function reversedOrder(text: string): string {
  const stripped = splitAttackRequirementClause(text)?.body ?? text;
  return splitAttackGateClause(stripped)?.body ?? stripped;
}

/** 🆕🆕 D417 — the site's order over all FOUR strippers: gate clause off the front,
    then the requirement clause, then the cancel clause off the BACK, then D409's
    trailing composition. What is left is the string the readers see. */
function fourSiteOrder(text: string): string {
  const gated = splitAttackGateClause(text)?.body ?? text;
  const required = splitAttackRequirementClause(gated)?.body ?? gated;
  const uncancelled = splitAttackCancelClause(required)?.head ?? required;
  return splitAttackTrailingClause(uncancelled)?.head ?? uncancelled;
}
/** The four in the exact opposite order. Not what attack.ts does — §6's control. */
function fourReversedOrder(text: string): string {
  const composed = splitAttackTrailingClause(text)?.head ?? text;
  const uncancelled = splitAttackCancelClause(composed)?.head ?? composed;
  const required = splitAttackRequirementClause(uncancelled)?.body ?? uncancelled;
  return splitAttackGateClause(required)?.body ?? required;
}

const units = (rows: readonly (readonly [number, string])[]): number =>
  rows.reduce((sum, [n]) => sum + n, 0);
const corpus = (): readonly (readonly [number, string])[] => legalAttackCorpus();

/** Setup, then open P1's turn 2 (P2 went first and passed) — `SAWK_SPLIT_DECK`'s
    harness, copied from D363's suite because the board fact §5 drives is a
    DIFFERENT claim about the same deck. */
function board(seed: number): GameState {
  const state = driveSetup(seed, { p1: SAWK_SPLIT_DECK, p2: SAWK_SPLIT_DECK }, { first: "p2" });
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}
function ready(seed: number, defender: string): GameState {
  let state = setActiveFromDeck(board(seed), "p1", "fix-sawk");
  state = attachFromDeck(state, "p1", "fix-fighting-energy", 1);
  state = attachFromDeck(state, "p1", "fix-energy", 1);
  state = setActiveFromDeck(state, "p2", defender);
  return clearBench(state, "p2");
}

describe("§1 — the census D282 priced its refusal against: counts reproduce, attribution does not", () => {
  it("re-derives 640 s / 1,732 u, 271 s / 613 u multi-sentence, 8 s / 16 u opening `If `", () => {
    const all = corpus();
    expect(all.length).toBe(640);
    expect(units(all)).toBe(1732);
    const multi = all.filter(([, s]) => s.includes(". "));
    expect(multi.length).toBe(271);
    expect(units(multi)).toBe(613);
    const opensIf = multi.filter(([, s]) => s.startsWith("If "));
    expect(opensIf.length).toBe(8);
    expect(units(opensIf)).toBe(16);
  });

  it("🛑 partitions the 16 as 10 GATE + 6 SUBSTANTIVE — not D363's `13 + 3`", () => {
    const opensIf = corpus().filter(([, s]) => s.includes(". ") && s.startsWith("If "));
    const gate = opensIf.filter(([, s]) => splitAttackGateClause(s) !== null);
    const substantive = opensIf.filter(([, s]) => splitAttackGateClause(s) === null);
    // 10 gate units on TWO spellings (7 BAN + 3 GATE), never three.
    expect(units(gate)).toBe(10);
    expect(gate.length).toBe(3);
    expect(units(gate.filter(([, s]) => s.startsWith(GATE_BAN)))).toBe(7);
    // 6 substantive units on 5 sentences, and 2 of them ARE the requirement
    // family — the `does nothing.` opener D363's handoff said appears in neither
    // of its counts. It appears in this one.
    expect(units(substantive)).toBe(6);
    expect(substantive.length).toBe(5);
    expect(units(substantive.filter(([, s]) => splitAttackRequirementClause(s) !== null))).toBe(2);
    expect(units(gate) + units(substantive)).toBe(16);
  });

  it("🛑 the 3 LICENCE printings are multi-sentence and are NOT among the 16", () => {
    // The double-count, driven. They are gate-family units, they are counted in
    // the 13, and they cannot be in a population defined as "opens with `If `".
    const licence = corpus().filter(([, s]) => s.startsWith(GATE_LICENCE));
    expect(units(licence)).toBe(3);
    expect(licence.every(([, s]) => s.includes(". "))).toBe(true);
    expect(licence.some(([, s]) => s.startsWith("If "))).toBe(false);
    // …and 13 is the WHOLE gate family, which is 10 + 3 and not 13 + 3.
    // 🆕🆕 D395 — the WHOLE gate family is now 14, and the 13 above is the
    // FIRST-TURN family alone: Miltank `sv08.5-081`'s clause is a second family
    // sharing only the `onlyIf` polarity, and it is in NEITHER of this section's
    // two populations (it is a SINGLE sentence, so not in the 271/613, and it opens
    // `You can use…`, so not in the 16). **THE PARTITION 10 + 3 IS UNMOVED AND THE
    // TOTAL IS NOT** — which is the arithmetic that says the new row joined from
    // outside both filters rather than from inside one of them.
    const gateAll = corpus().filter(([, s]) => splitAttackGateClause(s) !== null);
    expect(units(gateAll)).toBe(14);
    const firstTurn = gateAll.filter(([, s]) => splitAttackGateClause(s)?.body !== "");
    expect(units(firstTurn)).toBe(13);
    expect(units(firstTurn) - units(licence)).toBe(10);
  });

  it("S2 — 17 of 713 registry ids carry an `attackGate`, in three kinds", () => {
    // The registry side of the same 13, walked independently of the text side:
    // a count that agrees across two surfaces is a count, not a transcription.
    // 🆕🆕 D396 — 14 -> **17**, and this is the FIRST slice on which the registry
    // side and the TEXT side of §2 below DISAGREE: three ids joined the field and
    // ZERO joined `ATTACK_GATE_CLAUSES`, because Angelite's clause is TRAILING and
    // ships GATE-ONLY. The two surfaces were 13/13 and then 14/14; they are 17/14
    // now, and the gap IS the measurement that no split was authored.
    const ids = registryCardIds();
    // 🆕🆕 D396 — 710 -> **713**: THREE registry keys on ONE program object,
    // Sylveon ex `sv08-086`/`sv08.5-041`/`sv08.5-156` — a bare `attackGate` at index
    // **1** carrying `barredIf`, the SECOND gate in that field at a NON-ZERO index
    // and the first on which the gate NAMES its own attack. Real catalog ids and NOT
    // `fix-*` keys (the suite drives a LOCAL `cardPool`, D275's idiom), and the row
    // authors no `attack` program, so the ATTACK summand cannot move with them.
    // 🆕🆕 D395 — 709 -> **710**: ONE registry key, Miltank `sv08.5-081`
    // — a bare `attackGate` at index **1**, the first gate in that field at a
    // NON-ZERO index. A real catalog id and NOT a `fix-*` key (its suite drives a
    // LOCAL `cardPool`, D275's idiom), and it authors no `attack` program, so the
    // ATTACK summand cannot move with it.
    // 🆕🆕 D391 — 708 -> **709**: ONE `EnergyProgram` key, `fix-grassdouble`, the
    // FIXTURE Special providing `{G}{G}` — the first `provides` row to spell one type
    // TWICE, and the only board on which a CARD count and a UNIT count disagree under a
    // typed filter. A `fix-*` key, so no catalog printing moved with it.
    expect(ids.length).toBe(713);
    const gated = ids.filter((id) => programFor(id)?.attackGate !== undefined);
    expect(gated.length).toBe(17);
    const kinds = gated.flatMap((id) =>
      Object.values(programFor(id)?.attackGate ?? {}).map((g) => g.kind),
    );
    // 🆕🆕 D396 — 7 -> **10**: Sylveon ex's three printings are the EIGHTH, NINTH
    // and TENTH `barredIf`, and the first whose condition is not §4's turn order.
    expect(kinds.filter((k) => k === "barredIf").length).toBe(10);
    // 🆕🆕 D395 — 3 -> **4**: Miltank `sv08.5-081` is the FOURTH `onlyIf` and the
    // first whose condition is not the §4 `allOf([youGoSecond, yourFirstTurn])`.
    expect(kinds.filter((k) => k === "onlyIf").length).toBe(4);
    expect(kinds.filter((k) => k === "firstTurnExempt").length).toBe(3);
    // 🛑 AND THE INDEX, WHICH IS THE HALF THIS SECTION COULD NOT ASSERT BEFORE.
    // Thirteen gates sat at index 0 and one sits at index 1, so the KEY of this map
    // is finally load-bearing on the catalog side too — the same claim
    // `rolloutGate.test.ts` drives on a board.
    // 🆕🆕 D396 — 13 / **4**: Sylveon ex's three join Miltank at index 1, and the
    // majority at index 0 is now 13 of 17 rather than 13 of 14 — so an index-blind
    // read is wrong on FOUR printings across TWO cards and two polarities.
    const indices = gated.flatMap((id) => Object.keys(programFor(id)?.attackGate ?? {}));
    expect(indices.filter((k) => k === "0").length).toBe(13);
    expect(indices.filter((k) => k === "1").length).toBe(4);
  });
});

describe("§2 — the two splits are DISJOINT on the whole catalog", () => {
  it("gate split claims 5 s / 13 u, requirement split 1 s / 2 u, and BOTH claim 0", () => {
    const all = corpus();
    const gate = all.filter(([, s]) => splitAttackGateClause(s) !== null);
    const req = all.filter(([, s]) => splitAttackRequirementClause(s) !== null);
    const both = all.filter(
      ([, s]) => splitAttackGateClause(s) !== null && splitAttackRequirementClause(s) !== null,
    );
    // 🆕🆕 D396 — **UNMOVED at [6, 14]**, and that is the claim rather than an
    // omission: Sylveon ex's three printings gained a registry `attackGate` and NO
    // `ATTACK_GATE_CLAUSES` row, because their gate clause is TRAILING and
    // `splitAttackGateClause` is `^`-anchored by policy. All nine readers were run
    // over the stripped body at D396 and every one refuses it, so a trailing
    // stripper would have moved this pair and bought ZERO printings.
    // 🆕🆕 D395 — [5, 13] -> **[6, 14]**, and the disjointness below is UNMOVED:
    // the new row is a clause-only printing, and `splitAttackRequirementClause`'s
    // own list does not contain it.
    expect([gate.length, units(gate)]).toEqual([6, 14]);
    expect([req.length, units(req)]).toEqual([1, 2]);
    // 🛑 THE TRIPWIRE. The day a printing carries both, this reddens by name and
    // the composer question is live again — with a population above zero.
    expect([both.length, units(both)]).toEqual([0, 0]);
  });

  it("🛑 the ORDER IS UNOBSERVABLE ON THE CATALOG — both orders agree on all 640", () => {
    // The consequence of disjointness, stated as the thing that would break.
    // This is what makes a generic composer scaffolding: there is no printed
    // string it would answer differently.
    for (const [, text] of corpus()) {
      expect(reversedOrder(text), text).toBe(siteOrder(text));
    }
  });

  it("keeps the CONTROL that says both readers are really running", () => {
    // A sweep that agrees because both halves return the input is vacuous. Each
    // split must be seen to MOVE the string on its own population.
    expect(siteOrder(SAWK)).toBe(SAWK_TAIL);
    expect(siteOrder(`${GATE_BAN} ${SAWK_TAIL}`)).toBe(SAWK_TAIL);
    // 🆕🆕 D395 — 6 -> **7**: the clause-only printing is MOVED by the site (to
    // the empty string), which is the strongest form of "the reader really ran".
    expect(corpus().filter(([, s]) => siteOrder(s) !== s).length).toBe(7);
  });
});

describe("§3 — the ordering where the two splits meet", () => {
  it("🛑 the site's order accounts for BOTH clauses; the reverse accounts for neither", () => {
    // ⚠️ CONSTRUCTED STRING (see `BOTH`). No printing spells this.
    expect(siteOrder(BOTH)).toBe(SAWK_TAIL);
    expect(deriveAttackDamageSuppression(siteOrder(BOTH))).toEqual({
      weakness: true,
      resistance: true,
    });
    // The other order leaves the WHOLE compound behind the gate clause unread.
    expect(reversedOrder(BOTH)).toBe(SAWK);
    expect(deriveAttackDamageSuppression(reversedOrder(BOTH))).toBeNull();
    // So the two orders DISAGREE off the catalog. The order at the site is a
    // commitment, not an accident — which is precisely what §2 shows nothing
    // printed can currently reveal.
    expect(siteOrder(BOTH)).not.toBe(reversedOrder(BOTH));
  });

  it("🛑 the requirement split REFUSES a gate-led compound, and the LAZY clause group is why", () => {
    // `ATTACK_DOES_NOTHING` is `^If (.+?), this attack does nothing\.` — on BOTH
    // the lazy group takes "you go second, you can't use this attack during your
    // first turn. If your opponent's Active Pokémon isn't a Pokémon ex", which
    // `ATTACK_REQUIREMENT_CLAUSES` does not carry, so the accounting guard says
    // no. A GREEDY group would have matched the LAST does-nothing break instead.
    expect(splitAttackRequirementClause(BOTH)).toBeNull();
    expect(deriveAttackRequirement(BOTH)).toBeNull();
    // …and it becomes readable the moment the gate clause is off the front.
    expect(splitAttackRequirementClause(splitAttackGateClause(BOTH)?.body ?? "")).toEqual({
      clause: SAWK_HEAD,
      body: SAWK_TAIL,
    });
  });

  it("🛑 BOTH orders fail in the SAFE direction — neither drops a sentence unreported", () => {
    // The D278/D279 lesson as a property rather than a paragraph: a wrong order
    // must leave MORE text on the loud path, never less. The residue of the
    // reverse order is a SUPERSTRING of the site order's residue, both ways
    // round, so no printed sentence can be silently deleted by getting the
    // order wrong.
    for (const text of [BOTH, REVERSED, SAWK, `${GATE_BAN} ${SAWK_TAIL}`]) {
      const site = siteOrder(text);
      const other = reversedOrder(text);
      expect(text.includes(site), text).toBe(true);
      expect(text.includes(other), text).toBe(true);
      expect(site.length <= other.length || other.length <= site.length).toBe(true);
    }
    // The reversed compound: the requirement is spent, the GATE clause is what
    // stays loud. Reported, never dropped.
    expect(splitAttackRequirementClause(REVERSED)).toEqual({
      clause: SAWK_HEAD,
      body: `${GATE_BAN} ${SAWK_TAIL}`,
    });
    expect(siteOrder(REVERSED)).toBe(`${GATE_BAN} ${SAWK_TAIL}`);
  });
});

describe("§4 — the requirement table's LIVE legality (a row count is not a coverage map)", () => {
  /** The three printed keys, as literals — `ATTACK_REQUIREMENT_CLAUSES` is
      module-private, so this is a labelled COPY tied to the live reader below. */
  const KEYS: readonly (readonly [string, number])[] = [
    // 🛑 ZERO Standard-legal printings. All five printings of this sentence
    // (Palafin `sv03-062`/`-200`, `sv04.5-124`/`-225`, `svp-036`) are
    // `legal_standard = 0` — the row D125 built the family for is DEAD in
    // Standard, and the table's "three rows / five printings" doc counts ids it
    // NAMES rather than printings the pool can play.
    ["If this Pokémon didn't move from the Bench to the Active Spot this turn", 0],
    // 🛑 2 legal printings, and NOT the card the table names. `sv03-117`
    // Lycanroc is `legal_standard = 0`; the live printings are **Basculin
    // `sv10.5w-024`/`-108` "Bared Fangs" ({W}, 50)**, so the row is neither a
    // hapax nor Lycanroc's. The COUNT the row was priced at is right; the
    // ATTRIBUTION is a set rotation old.
    [
      "If your opponent's Active Pokémon has no damage counters on it before this attack does damage",
      2,
    ],
    // 2 legal printings — Sawk, and the only row whose named ids are still live.
    ["If your opponent's Active Pokémon isn't a Pokémon ex", 2],
    // 🆕🆕 D365 — 2 legal printings, Iron Boulder `sv07-071`/`sv08.5-046`.
    ["If you don't have the same number of cards in your hand as your opponent", 2],
    // 🆕🆕 D365 — 1 legal printing, Hop's Cramorant `sv09-138`. The family's
    // NARROWEST row and its only parameterised one.
    ["If your opponent doesn't have exactly 3 or 4 Prize cards remaining", 1],
    // 🆕🆕 D365 — 2 legal printings, Mesprit `sv08-079`/`sv08-204`, the row that
    // makes `allOf` a DERIVED value.
    ["If you don't have Uxie and Azelf on your Bench", 2],
    // 🆕🆕 D366 — **4 legal printings, the family's LARGEST row by printings and
    // the ONLY one that bought a `BoardCondition` member.** Victini
    // `sv10.5b-012`/`sv10.5b-171`/`sv10.5w-172`/`svp-208` "V-Force" ({R}{R}, 120).
    // ⚠️ It is also the first key in this list with NO apostrophe in it, which is
    // what `clauseApostrophe.test.ts`'s completeness guard had to learn.
    ["If you have 4 or fewer Benched Pokémon", 4],
    // 🆕🆕 D377 — Centiskorch `sv05-037` "Charring Breath" ({R}{R}, 180), 1 legal
    // printing, on `opponentActiveBurned` — a member bought by the SAME slice for a
    // BONUS row one table over. The third row in this table to spell a member the
    // bonus table already reads (D363's Sawk, D365's Iron Boulder, now this), and the
    // first whose two consequents were purchased together.
    ["If your opponent's Active Pokémon isn't Burned", 1],
    // 🆕🆕 D378 — Fan Rotom `sv07-118`/`sv08.5-085` "Assault Landing", TWO legal
    // printings, on `stadiumInPlay` — a member bought by the SAME slice for a BONUS
    // row one table over (Probopass `sv10-098` "Mountain Drop"). The FOURTH row in
    // this table to spell a member the bonus table already reads, and the FIRST whose
    // cancel half is the BIGGER half: 2 printings here against 1 there.
    ["If there is no Stadium in play", 2],
    // 🆕🆕 D379 — Alolan Dugtrio `sv08-123`/`sv08-208` "Trio-Cheehoo" (NO Energy
    // cost, 120), TWO legal printings, on `yourHandExactly` — and the FIRST row in
    // this table whose member has NO bonus twin at all. D363's Sawk, D365's Iron
    // Boulder, D377's Centiskorch and D378's Fan Rotom each spelled a member
    // `CONDITIONAL_DAMAGE_CLAUSES` also reads; both consequents were asked again here
    // and the bonus side is EMPTY, so all 2 printings arrive through this table.
    // ⚠️ It is also the LAST row this table can gain from the current pool — see the
    // rung below, where `unmapped` is now empty.
    ["If you don't have exactly 3 cards in your hand", 2],
  ];

  it("🛑 prices each mapped clause by LEGAL printings — 0, 2, 2, 2, 1, 2, 4, 1, 2, 2", () => {
    for (const [key, expected] of KEYS) {
      const sentence = `${key}, this attack does nothing.`;
      // The copy is tied to the live reader: a key that stopped being carried
      // makes this null and the row fails here rather than silently scoring 0.
      expect(deriveAttackRequirement(sentence), key).not.toBeNull();
      // ⚠️ PREFIX, not equality: since D363 the skeleton tolerates a trailing
      // companion, so the Sawk row's printed string is the COMPOUND. Matching on
      // equality scores that row 0 and would have shipped a false "dead row".
      const printed = corpus().filter(
        ([, s]) => s === sentence || s.startsWith(`${sentence} `),
      );
      expect(units(printed), key).toBe(expected);
    }
  });

  it("🛑 TEN rows, NINE of them reachable in Standard, and 18 legal printings — the table SATURATES", () => {
    // 🆕🆕 D366 — "six / five / 9" one commit ago, "three / two / 4" the commit
    // before that; every one of the three numbers has now moved twice. The rung is
    // unchanged in SHAPE, which is the point: it prices the table by
    // `legal_standard` rather than by row count, so a slice that adds rows has to
    // restate what the pool can actually play.
    // 🆕🆕 D377 — "seven / six / 13" one commit ago. The three numbers have now moved
    // four times, and this step is the first that adds a row whose member ALREADY
    // EXISTED IN THE SAME COMMIT for a different consequent.
    // 🆕🆕 D378 — "eight / seven / 14" one commit ago, the FIFTH move, and the biggest
    // step this rung has taken on the PRINTINGS column since D366's four: +1 row and
    // +2 printings, because the row's sentence is the only one in this table with two
    // legal printings behind a member the same commit bought.
    // 🆕🆕 D379 — "nine / eight / 16" one commit ago, the SIXTH move, and the LAST
    // one this pool can produce: the table now carries every does-nothing opener the
    // legal attack column prints, so the next move on this rung has to come from a
    // set rotation rather than from a slice.
    const reachable = KEYS.filter(([, n]) => n > 0);
    expect(KEYS.length).toBe(10);
    expect(reachable.length).toBe(9);
    expect(KEYS.reduce((sum, [, n]) => sum + n, 0)).toBe(18);
    // The whole does-nothing OPENER population, and how much of it is mapped:
    // 9 sentences / 18 units open with the skeleton, and 9 sentences / 18 units are
    // carried. NOTHING is left unmapped — which is what expires the accounting
    // guard's printed subject, not what makes the guard vacuous (see below).
    // 🆕🆕 D377 — 6 / 13 -> 7 / 14 and the unmapped 3 / 5 -> 2 / 4, and the sentence
    // that moved is the one this list NAMED as owed: *"…isn't Burned"*. The remaining
    // two are a Stadium-PRESENCE read (which `yourStadiumInPlay` cannot answer — it
    // reads §7.3 OWNERSHIP) and an exact hand-size read.
    // 🆕🆕 D378 — 7 / 14 -> 8 / 16 and the unmapped 2 / 4 -> 1 / 2, and the sentence
    // that moved is again the one this list NAMED as owed: the Stadium-PRESENCE read,
    // built as `stadiumInPlay` — a NEW member beside `yourStadiumInPlay` rather than a
    // widening of it, because that one has two consumers whose OWNERSHIP is
    // load-bearing (D362: a widening is free, a rename is not).
    // 🛑 🆕🆕 **D379 — `unmapped` IS EMPTY, AND THAT IS THE EXPIRY D378 WROTE DOWN
    // ARRIVING ON SCHEDULE.** 8 / 16 -> 9 / 18 and the unmapped 1 / 2 -> **0 / 0**:
    // the hand-size read was built as `yourHandExactly`, and every does-nothing
    // OPENER the legal attack column prints is now carried. `sawkRequirementSplit`'s
    // unmapped rider therefore has NO real printed subject left and has become a
    // CONSTRUCTED near-miss ("exactly 4"), which that file and `fix-sawk`'s block both
    // say in their own words. ⚠️ **SATURATION IS THE ONE STATE THIS RUNG CANNOT SEE
    // THE DIFFERENCE FROM VACUITY IN**, so the line after the partition drives a
    // sentence OUTSIDE the opener population and requires a refusal.
    const openers = corpus().filter(([, s]) => /^If .+?, this attack does nothing\./.test(s));
    expect([openers.length, units(openers)]).toEqual([9, 18]);
    const mapped = openers.filter(([, s]) => deriveAttackRequirement(s) !== null);
    expect([mapped.length, units(mapped)]).toEqual([9, 18]);
    const unmapped = openers.filter(([, s]) => deriveAttackRequirement(s) === null);
    expect([unmapped.length, units(unmapped)]).toEqual([0, 0]);
    // 🛑 THE ANTI-VACUITY HALF: a reader that answered everything would satisfy both
    // lines above. It does not — the constructed near-miss one parameter value over is
    // refused, and so is a sentence with no skeleton at all.
    expect(
      deriveAttackRequirement("If you don't have exactly 4 cards in your hand, this attack does nothing."),
    ).toBeNull();
    expect(deriveAttackRequirement("Discard your hand and draw 6 cards.")).toBeNull();
    // The parts sum, which is what makes a partition a partition.
    expect(mapped.length + unmapped.length).toBe(openers.length);
    expect(units(mapped) + units(unmapped)).toBe(units(openers));
  });
});

describe("§5 — on a board: the requirement is read BEFORE the split, and that is observable", () => {
  it("🛑 CANCELS into a non-ex — which is only true because the read precedes the split", () => {
    // attack.ts reads `deriveAttackRequirement(gated)` off the UNSPLIT string and
    // only then computes `effect = requirementSplit.body`. Reversed, the reader
    // would be handed the COMPANION sentence, `requirement` would be null, and
    // 90 damage would land on a body the printed card says is immune.
    expect(deriveAttackRequirement(SAWK_TAIL)).toBeNull();
    const after = mustApply(ready(6401, "fix-bigbody"), { type: "attack", seat: "p1", index: 0 });
    expect(after.events.find((e) => e.type === "ATTACK_FAILED")).toMatchObject({
      reason: "requirement",
    });
    expect(types(after.events)).not.toContain("DAMAGE_DEALT");
    // Both printed sentences are accounted for, so the cancel is SIMULATED.
    expect(types(after.events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("🛑 the CONTROL that names none of these ids and still reddens: the split really fired", () => {
    // `fix-sawk` index 1 prints the SAME leading requirement with a companion no
    // reader resolves. If the split had not fired, the residue reported would be
    // the WHOLE compound; if the split fired without the accounting guard, there
    // would be no residue at all. It is the BODY alone, and the requirement
    // still cancels.
    const after = mustApply(ready(6427, "fix-bigbody"), { type: "attack", seat: "p1", index: 1 });
    const skipped = after.events.find((e) => e.type === "ATTACK_EFFECT_SKIPPED");
    expect(skipped).toMatchObject({ effect: "Then, spin the wheel of fate." });
    expect(after.events.find((e) => e.type === "ATTACK_FAILED")).toMatchObject({
      reason: "requirement",
    });
  });
});

// 🆕🆕 D417 — THE FOURTH STRIPPER, AND IT OWES §2's MEASUREMENT OVER FOUR RATHER
// THAN TWO. `splitAttackCancelClause` takes the printed *"If you can't, this attack
// does nothing."* off the BACK of a compound and hands the head sentence to the
// readers, so `attack.ts` now runs FOUR head/tail strippers in a fixed order at one
// seam. §2 pinned the disjointness of the first two as a tripwire; three strippers
// have six pairs, four have SIX MORE, and none of them had a number.
//
// 🛑 THE ANSWER IS THE SAME ONE, WIDER: **ALL SIX PAIRS ARE DISJOINT OVER ALL 1,732
// LEGAL UNITS**, so the site's order among the four is unobservable on the catalog
// and a generic composer is still scaffolding for a population of zero. That is the
// measurement, and §6 is where it is a TRIPWIRE rather than a paragraph — the day a
// printing carries two, exactly one pair reddens BY NAME.
//
// ⚠️ AND EACH REFUSAL IS ATTRIBUTED, NOT COUNTED. A matrix of zeroes is what a
// suite of four dead functions also produces, so the section below states WHY each
// stripper refuses the cancel family before it states that it does:
//   • `splitAttackGateClause` matches a fixed LEADING clause list, and neither
//     anaphoric printing opens with one;
//   • `splitAttackRequirementClause` is `^If`-anchored — that is the whole gap D380
//     named and D417 closes, so its refusal here is the slice's own premise;
//   • `splitAttackTrailingClause` requires its tail to be a sentence
//     `deriveAttackEffect` CLAIMS, and a does-nothing clause is not one. **THIS IS
//     THE ONLY PAIR THAT COULD PLAUSIBLY HAVE COLLIDED** — both split at the same
//     end of the same string — and the condition that separates them is driven
//     rather than asserted.
describe("§6 — FOUR strippers at one seam, and all six pairs are DISJOINT", () => {
  /** The four, by name, in the order `attack.ts` runs them. */
  const STRIPPERS: readonly (readonly [string, (text: string) => unknown])[] = [
    ["gate", splitAttackGateClause],
    ["requirement", splitAttackRequirementClause],
    ["cancel", splitAttackCancelClause],
    ["trailing", splitAttackTrailingClause],
  ];

  it("🛑 prices each stripper live off the corpus — 6/14, 1/2, 4/5, 9/18", () => {
    const priced = STRIPPERS.map(([name, split]) => {
      const rows = corpus().filter(([, s]) => split(s) !== null);
      return [name, rows.length, units(rows)] as const;
    });
    // 🆕🆕 D417 — the fourth row is the new one; the first two are §2's figures
    // re-derived through this section's own instrument, so the two sections cannot
    // drift apart silently.
    // 🆕🆕 D420 — the CANCEL row moves 1/1 → **4/5** and NO OTHER ROW MOVES, which is
    // the shape this table exists to show: the widening is a CLOSED alternation on
    // one anchor plus three rows in one table, so the three older strippers see
    // exactly the strings they saw before. The hand-Energy cost family is 3 sentences
    // / 4 printings.
    expect(priced).toEqual([
      ["gate", 6, 14],
      ["requirement", 1, 2],
      ["cancel", 4, 5],
      ["trailing", 11, 21], // 🆕🆕 D435 10/19 → 11/21 — the delayed KNOCK-OUT anchor claims the TAIL of one more printed compound (corpus row 113, 2 printings); no stripper changed, and the other three rows stand still for a SECOND slice running. 🆕🆕 D424 9/18 → 10/19 — the two-status pair claims the HEAD of one more printed compound; no stripper changed, and the other three rows stand still.
    ]);
    // …and every one of the four MOVES a string, which is what stops the matrix
    // below being a matrix of four dead functions.
    for (const [name, sentences] of priced) expect([name, sentences > 0]).toEqual([name, true]);
  });

  it("🛑🛑 THE TRIPWIRE: 0 of 1,732 legal units are claimed by any TWO of the four", () => {
    const collisions: string[] = [];
    for (let i = 0; i < STRIPPERS.length; i += 1) {
      for (let j = i + 1; j < STRIPPERS.length; j += 1) {
        const [nameA, splitA] = STRIPPERS[i] ?? ["", () => null];
        const [nameB, splitB] = STRIPPERS[j] ?? ["", () => null];
        const both = corpus().filter(([, s]) => splitA(s) !== null && splitB(s) !== null);
        // Named rather than summed: the day this fires, the message says WHICH pair
        // and WHICH printing, which is the whole value of a tripwire.
        for (const [n, s] of both) collisions.push(`${nameA} x ${nameB} (${n}): ${s}`);
      }
    }
    expect(collisions).toEqual([]);
    // The six pairs really were walked — a loop with the bounds wrong produces an
    // empty array too.
    expect((STRIPPERS.length * (STRIPPERS.length - 1)) / 2).toBe(6);
  });

  it("🛑 the near-collision, ATTRIBUTED: the trailing splitter refuses a does-nothing tail", () => {
    // `splitAttackCancelClause` and `splitAttackTrailingClause` split at the SAME
    // end of the SAME string, so "they are disjoint" is worth nothing without the
    // reason. The reason is one condition: the trailing splitter's tail must be a
    // sentence `deriveAttackEffect` claims, and this clause is not.
    expect(deriveAttackEffect(CANCEL_CLAUSE)).toBeNull();
    for (const [, s] of corpus().filter(([, s]) => s.endsWith(CANCEL_CLAUSE))) {
      expect(splitAttackTrailingClause(s), s).toBeNull();
      // …while the gate list and the `^If` anchor refuse them from the FRONT, which
      // is a different reason and is stated as one.
      expect(splitAttackGateClause(s), s).toBeNull();
      expect(splitAttackRequirementClause(s), s).toBeNull();
      expect(s.startsWith("If "), s).toBe(false);
    }
    // 🛑 AND THE CONVERSE, so the condition above is doing the work rather than the
    // shape: change the tail to one `deriveAttackEffect` DOES claim and the trailing
    // splitter takes the very string the cancel splitter refuses.
    const composable = `${CANCEL_HEAD} Discard 3 Energy from this Pokémon.`;
    expect(splitAttackCancelClause(composable)).toBeNull();
    expect(splitAttackTrailingClause(composable)).toEqual({
      head: CANCEL_HEAD,
      tail: "Discard 3 Energy from this Pokémon.",
    });
  });

  it("🛑 the ORDER among the four is UNOBSERVABLE on the catalog — the consequence", () => {
    // §2's claim, one stripper wider: with every pair disjoint there is no printed
    // string the four answer differently in any order, which is why the fourth
    // stripper is a narrow anchored function and not a `splitHead` loop (D282's
    // standing refusal, re-derived rather than inherited).
    for (const [, text] of corpus()) {
      expect(fourSiteOrder(text), text).toBe(fourReversedOrder(text));
    }
    // The CONTROL that says both pipelines really run: each moves the strings its
    // own stripper owns, and the cancel printing is moved by both.
    expect(fourSiteOrder(SAWK)).toBe(SAWK_TAIL);
    expect(fourSiteOrder(CANCEL_PRINTING)).toBe(CANCEL_HEAD);
    expect(fourReversedOrder(CANCEL_PRINTING)).toBe(CANCEL_HEAD);
    // 🆕🆕 D417 — **17**, and it is NOT §2's 7 plus one. §2's pipeline runs two
    // strippers and moves 7 sentences; this one runs four and moves **7 + 9 + 1**:
    // D409's trailing composition moves nine on its own and had never been counted
    // through this instrument, and the cancel printing is the one. The sum is
    // asserted as its parts so a stripper that stopped moving anything is a red
    // line here rather than a smaller total nobody reads.
    // 🆕🆕 D420 — 17 → **20**, and the WHOLE step is the cancel term: 7 + 9 + **4**.
    // The other two parts are unmoved literals in the same breath, so a widening that
    // had leaked into the gate or the composition path reddens on the PART rather
    // than only on the sum.
    expect(corpus().filter(([, s]) => fourSiteOrder(s) !== s).length).toBe(22); // 🆕🆕 D435 21 → 22: the four-stripper seam rewrites one more sentence, and the WHOLE step is the trailing term — 7 + 11 + 4 — so a widening that had leaked into the gate or the cancel path reddens on the PART below rather than only on this sum. 🆕🆕 D424 20 → 21: the four-stripper seam now rewrites one more sentence, because the trailing splitter admits one more.
    expect(corpus().filter(([, s]) => siteOrder(s) !== s).length).toBe(7);
    expect(corpus().filter(([, s]) => splitAttackTrailingClause(s) !== null).length).toBe(11); // 🆕🆕 D435 10 → 11. 🆕🆕 D424 9 → 10 — an UNNAMED re-derivation of the trailing-split census; reachable by no grep of the constant.
    expect(corpus().filter(([, s]) => splitAttackCancelClause(s) !== null).length).toBe(4);
  });

  it("🛑 the reader and the splitter agree on exactly the same printings", () => {
    // The site strips a clause it has ANSWERED — that pairing is the whole safety of
    // the fourth stripper, and it holds because both functions run one guard. 🆕🆕
    // D420 widened the anchor and added three rows; the pairing is what says the
    // widening did not let the splitter run ahead of the table.
    const split = corpus().filter(([, s]) => splitAttackCancelClause(s) !== null);
    const read = corpus().filter(([, s]) => deriveAttackCancelRequirement(s) !== null);
    expect(split.map(([, s]) => s)).toEqual(read.map(([, s]) => s));
    expect([read.length, units(read)]).toEqual([4, 5]);
    // …and D417's printing is still one of them, named rather than counted.
    expect(read.map(([, s]) => s)).toContain(CANCEL_PRINTING);
  });
});
