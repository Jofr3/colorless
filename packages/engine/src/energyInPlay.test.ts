import { describe, expect, it } from "vitest";
import {
  conditionHolds,
  conditionNote,
  countEnergyInPlay,
  deriveAttackDamageBonus,
  deriveAttackDamageMultiplier,
  deriveAttackEffect,
  programFor,
} from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import {
  ENERGY_IN_PLAY_DECK,
  FIXTURE_POOL,
  attachBenchFromDeck,
  attachFromDeck,
  benchFromDeck,
  deepFreeze,
  driveSetup,
  mustApply,
  setActiveFromDeck,
  types,
} from "./testFixtures";

// 0.71.0 → 0.72.0 — the BOARD-WIDE Energy count (D121). One card, one clause,
// and no new arithmetic: Absol sv06.5-030 "Darkfall", "If you have at least 3
// {D} Energy in play, this attack does 50 more damage." It rides D115's 0-or-1
// indicator through the existing additive fold, so this slice adds no op, no
// event, no registry row and no change to attack.ts.
//
//   `yourEnergyInPlayAtLeast { energy, count }` — a LITERAL table row, matched
//   before either template runs.
//
// THE ONE WORD THIS SUITE EXISTS TO PIN:
//
//   "IN PLAY" IS NOT "ATTACHED".
//
// D118 built "If this Pokémon has any <energy> Energy attached" — nine printings
// across four cards, every one of them scoped to a single Pokémon. This sentence
// changes one word and means the whole side of the table. The predicate underneath
// is deliberately the SAME (provision, not the printed name, computed on the
// holder); only the fold over it is new. So the headline case here is 3 Darkness
// Energy on the BENCH with nothing countable on Absol at all — armed, though the
// attacker carries none of it — and its mirror, an opponent's three scoring
// nothing.
//
// THE SECOND CALL, and the reason this is a row rather than a pattern:
//
//   TWO TOKENS VARY, SO D118'S TEMPLATE RULE DOES NOT APPLY (D119's corollary).
//
// The threshold and the energy could both move, and there is nothing to
// generalise FROM: "at least" and "Energy in play" are each a HAPAX in the
// ingested 978 cards / 6 sets — this sentence and nowhere else. A template would be
// parameterising over a pool of one on both axes at once. The member is still
// parameterised, because `conditionHolds` genuinely compares a count against a
// threshold; what is literal is the TABLE KEY. Both halves are asserted below:
// the parameters carry real values, and a spelled-out or re-thresholded rewrite
// of the same sentence does NOT resolve.

/** The printed sentence, pinned here and asserted char-for-char against
    FIXTURE_POOL below. Absol carries no authored attack (see the ZERO-rows
    block), so the sentence IS the wiring: a drifted character does not throw, it
    drops the card back onto the loud ATTACK_EFFECT_SKIPPED path and silently
    stops paying the bonus at the exact moment it would have mattered. */
const DARKFALL = "If you have at least 3 {D} Energy in play, this attack does 50 more damage.";

/** Two REAL sentences from the same pool that this clause must not be confused
    with, quoted verbatim as the near-miss witnesses.

    Orthworm is the sharper of the two: it prints a threshold, a brace code and
    the word "Energy" — everything but the scope — and means ONE Pokémon. Slither
    Wing prints "in play" on the very same skeleton and means Pokémon rather than
    Energy; it is also the clause `energyClause.test.ts`'s loud witness was
    re-pointed at when this slice mapped Absol. */
const ORTHWORM = "If this Pokémon has 3 or more {M} Energy attached, it gets +100 HP.";
const SLITHER_WING =
  "If your opponent has any Future Pokémon in play, this attack does 120 more damage.";

/** UTF-8 byte length, counted off code points. Deliberately NOT
    `new TextEncoder().encode(s).length`: the engine package compiles with
    `lib: ["ES2022"]` and `types: []` (packages/engine/tsconfig.json), so no
    platform global is in scope and `tsc -b` — which CI runs — would reject it. */
function utf8Bytes(text: string): number {
  let bytes = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    bytes += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return bytes;
}

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

/** The clause sentence at an arbitrary threshold, energy token and bonus — the
    constructor behind every CONSTRUCTED case below. The defaults deliberately do
    NOT match the printing on any axis (30 rather than 50), so a fold that
    hard-coded the printed amount would survive a same-amount probe. */
function inPlayClause(count: number, token: string, per = 30): string {
  return `If you have at least ${count} ${token} Energy in play, this attack does ${per} more damage.`;
}

/** Setup then open P1's turn 2 (P2 went first and passed) — P1's first
    unrestricted turn, so the attack step is legal (§4) — with BOTH Active spots
    pinned to a neutral 200 HP fix-bigbody.

    The pin is BY NAME (`active:`) rather than by whatever Basic the deal put
    first in hand, and it does two jobs here. It makes the defender arithmetically
    clean (200 HP, Colorless, no Weakness, no Resistance), and it makes the BENCH
    known: `setActiveFromDeck` displaces the sitting Active onto the bench, so
    under every attacker below the bench is exactly `[fix-bigbody]` — one body,
    carrying no Energy until a case attaches some.

    Critically, the deal itself puts NO Energy in play. Setup only fields Basics,
    so at this point `countEnergyInPlay` is 0 on both sides regardless of seed,
    and that is asserted rather than assumed in the first board case. */
function board(seed: number): GameState {
  const state = driveSetup(
    seed,
    { p1: ENERGY_IN_PLAY_DECK, p2: ENERGY_IN_PLAY_DECK },
    { first: "p2", active: { p1: "fix-bigbody", p2: "fix-bigbody" } },
  );
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** `board`, then handed over to P2 — P1 passes into P2's turn 3, which is equally
    unrestricted. The clause is seat-relative (it reads YOUR side), and a P1-only
    suite cannot tell "reads your own side" apart from "reads p1's side". */
function boardP2(seed: number): GameState {
  return mustApply(board(seed), { type: "endTurn", seat: "p1" }).state;
}

/** Absol in the Active Spot, its {C} cost paid with a plain COLORLESS Energy.

    That choice is the suite's load-bearing default, not a convenience: Darkfall
    costs a bare {C}, so paying it with a Darkness Energy would put a COUNTED card
    on the attacker in every single case and quietly confound "in play" with
    "attached" in the direction this clause is most likely to be wrong. fix-energy
    provides Colorless and only Colorless, so it pays the cost and counts zero,
    which is what lets a case put all three countable cards on the Bench. The
    other reading — the attacker's own cost Energy is in play too, and when it is
    Darkness it counts — gets its own case rather than being the default. */
function absol(state: GameState, seat: Seat): GameState {
  return attachFromDeck(setActiveFromDeck(state, seat, "sv06.5-030"), seat, "fix-energy", 1);
}

/** Put `count` Darkness Energy on the seat's bench[0] — a body that is in play,
    holds Energy and can never attack with it, which is the whole point.

    It seeds a holder first when the seat has none. `board` leaves both benches
    EMPTY (the pinned starter is what the deal opened with, so nothing is
    displaced); a bench body appears only where a surgery fielded an attacker over
    the top of it. The seats this suite arms and the seats it fields an attacker
    on are deliberately not always the same — that is what the asymmetry cases
    are — so the holder cannot be assumed. */
function benchDark(state: GameState, seat: Seat, count: number): GameState {
  const seeded =
    state.players[seat].bench.length > 0 ? state : benchFromDeck(state, seat, "fix-bigbody");
  return attachBenchFromDeck(seeded, seat, 0, "fix-darkness-energy", count);
}

/** The seat's opposite. Spelled once here rather than imported, because the
    member is seat-relative and every board case names a side. */
function other(seat: Seat): Seat {
  return seat === "p1" ? "p2" : "p1";
}

describe("the printed sentence — the fixture-text-verbatim guard", () => {
  it("matches FIXTURE_POOL char-for-char", () => {
    expect(FIXTURE_POOL["sv06.5-030"]?.attacks?.[0]?.effect).toBe(DARKFALL);
    // The printed "+" marker — what tells the pipeline a scaling clause is
    // expected at all — and the base the fold starts from.
    expect(FIXTURE_POOL["sv06.5-030"]?.attacks?.[0]?.damage).toBe("20+");
    expect(FIXTURE_POOL["sv06.5-030"]?.attacks?.[0]?.name).toBe("Darkfall");
    expect(FIXTURE_POOL["sv06.5-030"]?.attacks?.[0]?.cost).toEqual(["Colorless"]);
  });

  it("keeps the card to ONE attack — so the index below cannot be right by accident", () => {
    // Absol's whole cast is this attack. Every sibling suite in the family has an
    // index-keyed negative to run; here there is no second index to run it on, so
    // the honest assertion is that the array has length 1 and the clause is at 0.
    expect(FIXTURE_POOL["sv06.5-030"]?.attacks).toHaveLength(1);
    // The catalog row has `abilities_json` NULL — not an empty array — so nothing
    // on this card reaches a passive or a §9 gate.
    expect(FIXTURE_POOL["sv06.5-030"]?.abilities).toBeNull();
  });

  it("keeps the card facts the damage arithmetic is measured against", () => {
    expect(FIXTURE_POOL["sv06.5-030"]?.name).toBe("Absol");
    expect(FIXTURE_POOL["sv06.5-030"]?.types).toEqual(["Darkness"]); // the fold-order attacker
    expect(FIXTURE_POOL["sv06.5-030"]?.stage).toBe("Basic"); // fields in one surgery
    expect(FIXTURE_POOL["sv06.5-030"]?.hp).toBe(110);
    expect(FIXTURE_POOL["sv06.5-030"]?.retreat).toBe(1);
    expect(FIXTURE_POOL["sv06.5-030"]?.weaknesses).toEqual([{ type: "Grass", value: "×2" }]);
    expect(FIXTURE_POOL["sv06.5-030"]?.resistances).toBeNull();
  });

  it("keeps the fixture facts the ENERGY cases ride on", () => {
    // The three Energy lines are the entire experiment. If any of them stopped
    // providing what it provides, every number below would move for a reason that
    // has nothing to do with the clause.
    // The elemental type of a Basic Energy is read off its NAME, not off
    // `energyType` — that field carries tcgdex's Basic/Special axis ("Normal"),
    // which is a different question. Both are pinned so the distinction is on the
    // page: these two cards differ in exactly one word of one string.
    expect(FIXTURE_POOL["fix-darkness-energy"]?.name).toBe("Darkness Energy");
    expect(FIXTURE_POOL["fix-darkness-energy"]?.category).toBe("Energy");
    expect(FIXTURE_POOL["fix-darkness-energy"]?.energyType).toBe("Normal");
    // fix-energy's name is its ID, which is the point: it names no element, so
    // provision falls back to Colorless and it counts zero for every type. That
    // is the property the cost-paying default rests on, and the first board case
    // asserts it as a count rather than trusting this row.
    expect(FIXTURE_POOL["fix-energy"]?.name).toBe("fix-energy");
    expect(FIXTURE_POOL["fix-energy"]?.category).toBe("Energy");
    expect(FIXTURE_POOL["sv02-191"]?.name).toBe("Luminous Energy"); // the wildcard
    expect(FIXTURE_POOL["sv02-191"]?.energyType).toBe("Special");
    // The §8.5 defender and the clean neutral control.
    expect(FIXTURE_POOL["fix-darkness-weak"]?.weaknesses).toEqual([
      { type: "Darkness", value: "×2" },
    ]);
    expect(FIXTURE_POOL["fix-darkness-weak"]?.hp).toBe(200);
    expect(FIXTURE_POOL["fix-darkness-weak"]?.attacks).toBeNull();
    expect(FIXTURE_POOL["fix-bigbody"]?.hp).toBe(200);
    expect(FIXTURE_POOL["fix-bigbody"]?.weaknesses).toBeNull();
  });

  it("pins the sentence's BYTES — this clause is PURE ASCII, 75 and 75", () => {
    // The family's simplest byte claim, and the strongest for it: this sentence
    // names no Pokémon, so there is no "Pokémon" to carry a precomposed é, and it
    // has no possessive, so there is no apostrophe of either kind to drift into
    // its typographic twin. Code points and bytes are therefore EQUAL, which is a
    // single assertion that no non-ASCII character crept in anywhere.
    expect(DARKFALL.length).toBe(75);
    expect(utf8Bytes(DARKFALL)).toBe(75);
    expect(DARKFALL).not.toContain("Pokémon");
    expect(DARKFALL).not.toContain("'");
    expect(DARKFALL).not.toContain("’");
    // The energy token is the brace CODE, in literal ASCII braces — the sv-era
    // notation (D118). The name form does not appear.
    expect(DARKFALL).toContain("{D}");
    expect(DARKFALL).not.toContain("Darkness");
  });

  it("proves the fixture file is not ASCII-only by accident", () => {
    // A companion sentence from the same file that DOES carry non-ASCII, so the
    // claim above is about this string rather than about the encoding of the
    // whole module. Orthworm's near-miss carries a precomposed é.
    expect(ORTHWORM).toContain("Pokémon");
    expect(utf8Bytes(ORTHWORM)).toBe(ORTHWORM.length + 1);
    // And Absol's own Weakness value is a real U+00D7, not an ASCII "x".
    expect(FIXTURE_POOL["sv06.5-030"]?.weaknesses?.[0]?.value).toBe("×2");
  });
});

describe("derivation — the clause resolves to a parameterised member", () => {
  it("derives Darkfall's bonus with BOTH parameters", () => {
    expect(deriveAttackDamageBonus(DARKFALL)).toEqual({
      per: 50,
      count: {
        kind: "boardCondition",
        cond: { kind: "yourEnergyInPlayAtLeast", energy: "Darkness", count: 3 },
      },
    });
  });

  it("takes the bonus N from the SENTENCE, not from the card", () => {
    // The row maps a clause; the amount comes from the outer skeleton's second
    // capture, which is what lets one row serve a second printing at a different
    // bonus the day one lands.
    const rewritten = DARKFALL.replace("does 50 more", "does 10 more");
    expect(deriveAttackDamageBonus(rewritten)).toMatchObject({ per: 10 });
  });

  it("is a LITERAL row, so a re-thresholded rewrite does NOT resolve", () => {
    // The assertion that this slice's central design call is real. If the clause
    // had been built as a template, all three of these would resolve; because it
    // is a row keyed on the whole printed clause, only the printed threshold does.
    // The day a second threshold prints, a template can be added OVER this row
    // without re-interpreting it (rows are matched first) — that is the point of
    // the two-pass resolver, and this test is what would then have to change.
    expect(deriveAttackDamageBonus(inPlayClause(1, "{D}"))).toBeNull();
    expect(deriveAttackDamageBonus(inPlayClause(2, "{D}"))).toBeNull();
    expect(deriveAttackDamageBonus(inPlayClause(4, "{D}"))).toBeNull();
    // The printed 3 is the ONE threshold that resolves, and it resolves at any
    // bonus — the row keys the CLAUSE, and the amount comes from the outer
    // skeleton's second capture (the case two tests up). So the boundary between
    // "mapped" and "loud" runs through the threshold token alone.
    expect(deriveAttackDamageBonus(inPlayClause(3, "{D}"))).toMatchObject({
      per: 30,
      count: {
        kind: "boardCondition",
        cond: { kind: "yourEnergyInPlayAtLeast", energy: "Darkness", count: 3 },
      },
    });
  });

  it("is a LITERAL row, so the OTHER energy tokens do not resolve either", () => {
    // The second axis. D118's template accepts all nine brace codes and all nine
    // names because exactly one token varies there; here two do, so none of these
    // has a row and every one falls through to the loud path.
    for (const token of ["{G}", "{R}", "{W}", "{L}", "{P}", "{F}", "{M}", "{Y}", "Special"]) {
      expect(deriveAttackDamageBonus(inPlayClause(3, token, 50))).toBeNull();
    }
    // Including the SPELLED-OUT form of the very energy this clause names. The
    // swsh10.5 sets spell names out (D118) and would print it this way; that
    // printing does not exist today and is not silently accepted in advance.
    expect(deriveAttackDamageBonus(inPlayClause(3, "Darkness", 50))).toBeNull();
  });

  it("refuses the one-word rewrite that turns it into D118's clause", () => {
    // "in play" → "attached" is the whole difference between this member and its
    // sibling, and neither string may be read as the other. The attached form is
    // scoped to one Pokémon and has its own (differently shaped) sentence, so this
    // constructed hybrid belongs to nobody.
    const attached = DARKFALL.replace("in play", "attached");
    expect(deriveAttackDamageBonus(attached)).toBeNull();
    // While the sentence D118 actually owns still derives — so the anchor is not
    // what refused the hybrid.
    expect(
      deriveAttackDamageBonus(
        "If this Pokémon has any {D} Energy attached, this attack does 50 more damage.",
      ),
    ).toEqual({
      per: 50,
      count: {
        kind: "boardCondition",
        cond: { kind: "yourActiveHasEnergyAttached", energy: "Darkness" },
      },
    });
  });

  it("holds the whole-sentence anchor", () => {
    expect(deriveAttackDamageBonus(DARKFALL.toLowerCase())).toBeNull();
    expect(deriveAttackDamageBonus(DARKFALL.slice(0, -1))).toBeNull(); // no period
    expect(deriveAttackDamageBonus(`${DARKFALL} Then, shuffle your deck.`)).toBeNull();
    expect(deriveAttackDamageBonus(`Flip a coin. ${DARKFALL}`)).toBeNull();
    expect(deriveAttackDamageBonus(DARKFALL.replace("If you", "if you"))).toBeNull();
  });

  it("leaves the REAL near-misses LOUD", () => {
    // Orthworm sv02-151/-224: a threshold, a brace code and the word "Energy" —
    // everything but the scope — on an ABILITY that changes HP, not damage. A
    // substring or a keyword matcher would take it.
    expect(deriveAttackDamageBonus(ORTHWORM)).toBeNull();
    expect(deriveAttackEffect(ORTHWORM)).toBeNull();
    // Slither Wing sv06.5-026: "in play" on the SAME skeleton, counting Pokémon
    // rather than Energy, and blocked on an ingest change besides (the catalog
    // drops the Ancient/Future tag). This is the clause energyClause.test.ts's
    // loud witness now points at, so it is asserted unmapped in two suites.
    expect(deriveAttackDamageBonus(SLITHER_WING)).toBeNull();
    // Kingambit sv03-150: "4 or more", a threshold over damage counters, on a
    // knockout consequent rather than a damage one.
    expect(
      deriveAttackDamageBonus(
        "If your opponent's Active Pokémon has 4 or more damage counters on it, that Pokémon is Knocked Out.",
      ),
    ).toBeNull();
  });

  it("is disjoint from the other two derivers", () => {
    expect(deriveAttackEffect(DARKFALL)).toBeNull();
    expect(deriveAttackDamageMultiplier(DARKFALL)).toBeNull();
  });
});

describe("ZERO registry rows — every damage number below is text", () => {
  it("gives the id no authored attack program", () => {
    // attack.ts resolves an attack as `programFor(id)?.attack?.[index] ?? derive`,
    // so a single authored ATTACK row would WIN and every damage number below
    // would keep passing while testing nothing about the printed sentence. The
    // load-bearing assertion is on `?.attack` (D118's correction: a card can carry
    // an abilities-only row and still derive all of its attacks); today the whole
    // entry is absent, and only the first has to stay that way.
    expect(programFor("sv06.5-030")?.attack).toBeUndefined();
    expect(programFor("sv06.5-030")).toBeUndefined();
  });
});

describe("Darkfall — the threshold on a real board", () => {
  it("with no countable Energy the printed 20 stands — and nothing is flagged", () => {
    const state = absol(board(1), "p1");
    // The Colorless that paid the cost is genuinely in play and genuinely does
    // not count. Asserted directly, because every control below depends on it.
    expect(state.players.p1.active?.energy).toHaveLength(1);
    expect(countEnergyInPlay(state, "p1", "Darkness")).toBe(0);
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    const dealt = find(events, "DAMAGE_DEALT");
    expect(dealt).toMatchObject({ base: 20, dealt: 20 });
    expect(dealt?.scaled).toBeUndefined(); // `scaled` is omitted at 0
  });

  it("at TWO it is still 20 — the boundary that fails", () => {
    const state = benchDark(absol(board(2), "p1"), "p1", 2);
    expect(countEnergyInPlay(state, "p1", "Darkness")).toBe(2);
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(20);
  });

  it("at THREE it pays — 20 + 50 = 70, from a Bench the attacker never touched", () => {
    // THE HEADLINE CASE. Absol carries one Colorless and nothing else; all three
    // Darkness Energy sit on a benched fix-bigbody that cannot attack with them.
    // A member that read "attached to your Active" — one word away in the printed
    // text and the shape D118 built — would score 20 here.
    const state = benchDark(absol(board(3), "p1"), "p1", 3);
    expect(state.players.p1.active?.energy).toHaveLength(1);
    expect(countEnergyInPlay(state, "p1", "Darkness")).toBe(3);
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({
      base: 20,
      scaled: 50,
      weakness: null,
      resistance: null,
      dealt: 70,
    });
  });

  it("at FOUR it still pays — a THRESHOLD, not an exact count", () => {
    // The D119 contrast, and the case that catches `=== cond.count`. Its sibling
    // `opponentPrizesRemaining` reads set MEMBERSHIP because the printed word is
    // "exactly"; the printed word here is "at least", so above the line is true.
    const state = benchDark(absol(board(4), "p1"), "p1", 4);
    expect(countEnergyInPlay(state, "p1", "Darkness")).toBe(4);
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(70);
  });

  it("folds ACROSS zones — one on the Active and two on the Bench is three", () => {
    // Neither zone alone reaches the threshold, so this fails on any read that
    // scopes to one of them. The Active's Darkness is attached ON TOP of the
    // Colorless that paid the cost, so the cost is not what changed.
    const state = attachFromDeck(
      benchDark(absol(board(5), "p1"), "p1", 2),
      "p1",
      "fix-darkness-energy",
      1,
    );
    expect(state.players.p1.active?.energy).toHaveLength(2);
    expect(countEnergyInPlay(state, "p1", "Darkness")).toBe(3);
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(70);
  });

  it("counts the attacker's OWN Energy too — three on Absol and an empty Bench", () => {
    // The other half of "in play": the attacker is in play, so what is attached to
    // it counts, and a read that excluded the Active would score 20 here. The
    // {C} cost is over-paid three times over, which is legal (§8.2).
    const state = attachFromDeck(
      setActiveFromDeck(board(6), "p1", "sv06.5-030"),
      "p1",
      "fix-darkness-energy",
      3,
    );
    expect(state.players.p1.bench[0]?.energy).toHaveLength(0);
    expect(countEnergyInPlay(state, "p1", "Darkness")).toBe(3);
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(70);
  });

  it("reads YOUR side — the opponent's three Darkness score nothing", () => {
    // The case that catches a member wired to `otherSeat`. P2's bench carries the
    // full threshold and P1's carries none.
    const state = benchDark(absol(board(7), "p1"), "p2", 3);
    expect(countEnergyInPlay(state, "p2", "Darkness")).toBe(3);
    expect(countEnergyInPlay(state, "p1", "Darkness")).toBe(0);
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(20);
  });

  it("runs identically from the OTHER seat", () => {
    const state = benchDark(absol(boardP2(8), "p2"), "p2", 3);
    const { events } = mustApply(state, { type: "attack", seat: "p2", index: 0 });
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ base: 20, scaled: 50, dealt: 70 });
  });

  it("and the seat asymmetry mirrors too", () => {
    const state = benchDark(absol(boardP2(9), "p2"), "p1", 3);
    const { events } = mustApply(state, { type: "attack", seat: "p2", index: 0 });
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(20);
  });

  it("folds BEFORE Weakness — (20 + 50) × 2 = 140, against the control's 40", () => {
    // The §8.5 order. Absol is a Darkness Pokémon and its clause is
    // DEFENDER-INDEPENDENT, which is what makes it the right attacker here: the
    // Bench arms the bonus while the Weakness doubles it, and the two layers
    // cannot be confused for each other. A fold that applied the bonus after the
    // multiplier would read 20 × 2 + 50 = 90.
    const armed = benchDark(absol(setActiveFromDeck(board(10), "p2", "fix-darkness-weak"), "p1"), "p1", 3);
    const { events } = mustApply(armed, { type: "attack", seat: "p1", index: 0 });
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({
      base: 20,
      scaled: 50,
      weakness: { op: "multiply", amount: 2 },
      dealt: 140,
    });

    const control = absol(setActiveFromDeck(board(11), "p2", "fix-darkness-weak"), "p1");
    const { events: controlEvents } = mustApply(control, { type: "attack", seat: "p1", index: 0 });
    expect(find(controlEvents, "DAMAGE_DEALT")).toMatchObject({
      base: 20,
      weakness: { op: "multiply", amount: 2 },
      dealt: 40,
    });
  });

  it("flags no ATTACK_EFFECT_SKIPPED in EITHER direction", () => {
    // The D110 payoff: `effectSimulated` flips purely because the clause RESOLVED,
    // so the printed "+" stops being flagged whether or not the condition holds.
    // Scoring 20 is a correct answer here, not an unsimulated one.
    const armed = mustApply(benchDark(absol(board(12), "p1"), "p1", 3), {
      type: "attack",
      seat: "p1",
      index: 0,
    });
    expect(types(armed.events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    const unarmed = mustApply(absol(board(13), "p1"), { type: "attack", seat: "p1", index: 0 });
    expect(types(unarmed.events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });
});

describe("PROVISION, not the printed name — D118's predicate folded over the board", () => {
  it("a wildcard Luminous counts as a {D} Energy", () => {
    // Two Basic Darkness plus one Luminous alone on the same body. Luminous
    // provides every type while it is the only Special attached, so it is a {D}
    // Energy for this clause exactly as it is a {D} Energy for a cost — the D118
    // rule, and the reason the predicate lives beside the provision code.
    const state = attachBenchFromDeck(benchDark(absol(board(20), "p1"), "p1", 2), "p1", 0, "sv02-191", 1);
    expect(countEnergyInPlay(state, "p1", "Darkness")).toBe(3);
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(70);
  });

  it("a SECOND Luminous on the same body DISARMS it — one more card, less damage", () => {
    // The suite's sharpest case, and one a name-matching read cannot produce.
    // Nothing is removed and nothing moves: a card is ADDED, the two Specials
    // demote each other to {C}, neither counts any more, and the same attacker on
    // the same board scores 20 instead of 70. Provision is a board fact, so the
    // count is too.
    const state = attachBenchFromDeck(benchDark(absol(board(21), "p1"), "p1", 2), "p1", 0, "sv02-191", 2);
    expect(state.players.p1.bench[0]?.energy).toHaveLength(4); // MORE Energy than the case above
    expect(countEnergyInPlay(state, "p1", "Darkness")).toBe(2);
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    // The attack still resolves — the demotion is about what COUNTS, not about
    // whether the cost is payable, and Darkfall's {C} was paid by fix-energy.
    expect(types(events)).toContain("DAMAGE_DEALT");
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(20);
  });

  it("demotion is PER POKÉMON — two Luminous on two bodies both count", () => {
    // The control for the case above. Provision is computed on the HOLDER, so a
    // Luminous on the Active and a Luminous on the Bench are each the only
    // Special on their own Pokémon and each stays a wildcard. Plus one Basic
    // Darkness makes three.
    const state = attachBenchFromDeck(
      attachFromDeck(setActiveFromDeck(board(22), "p1", "sv06.5-030"), "p1", "sv02-191", 1),
      "p1",
      0,
      "sv02-191",
      1,
    );
    const withBasic = benchDark(state, "p1", 1);
    expect(countEnergyInPlay(withBasic, "p1", "Darkness")).toBe(3);
    const { events } = mustApply(withBasic, { type: "attack", seat: "p1", index: 0 });
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(70);
  });

  it("counts CARDS, not units of provision", () => {
    // A wildcard provides every one of the nine types, and it is still ONE Energy
    // card. Three Luminous spread one per body would be three; one Luminous is
    // one, however many units it offers. Below the threshold on its own.
    const state = attachBenchFromDeck(absol(board(23), "p1"), "p1", 0, "sv02-191", 1);
    expect(countEnergyInPlay(state, "p1", "Darkness")).toBe(1);
    expect(countEnergyInPlay(state, "p1", "Fire")).toBe(1); // the same one card, another type
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(20);
  });
});

describe("countEnergyInPlay — the helper, directly", () => {
  it("is 0 on a board the deal alone produced", () => {
    // Setup fields Basics and nothing else, so no seed can arm this clause by
    // accident — which is what makes every control above a real control.
    const state = board(30);
    expect(countEnergyInPlay(state, "p1", "Darkness")).toBe(0);
    expect(countEnergyInPlay(state, "p2", "Darkness")).toBe(0);
  });

  it("sums the Active and the whole Bench", () => {
    const state = attachFromDeck(benchDark(absol(board(31), "p1"), "p1", 2), "p1", "fix-darkness-energy", 2);
    expect(countEnergyInPlay(state, "p1", "Darkness")).toBe(4);
  });

  it("survives an EMPTY Active Spot", () => {
    // The holders idiom drops a null Active rather than iterating it, so a side
    // mid-promotion counts its Bench and does not throw. Not reachable through a
    // legal action at this point in the turn, so it is constructed.
    const state = benchDark(absol(board(32), "p1"), "p1", 3);
    const empty: GameState = {
      ...state,
      players: { ...state.players, p1: { ...state.players.p1, active: null } },
    };
    expect(countEnergyInPlay(empty, "p1", "Darkness")).toBe(3);
  });

  it("counts the SPECIAL class as well as a type", () => {
    // The arm the pool prints no sentence for today. It costs nothing (the class
    // predicate is `isSpecialEnergy`, the same list Luminous's own condition is
    // evaluated against) and it answers correctly if a printing lands, so it is
    // asserted rather than left untested.
    const state = attachBenchFromDeck(benchDark(absol(board(33), "p1"), "p1", 2), "p1", 0, "sv02-191", 1);
    expect(countEnergyInPlay(state, "p1", "special")).toBe(1);
    expect(countEnergyInPlay(state, "p1", "Darkness")).toBe(3); // the Luminous, both ways
    // Basic Energy are not Special, however many of them there are.
    expect(countEnergyInPlay(board(34), "p1", "special")).toBe(0);
  });
});

describe("conditionHolds / conditionNote — the member on its own", () => {
  it("sweeps the threshold from 0 to 5 with no gaps", () => {
    // A THRESHOLD is monotone: once true it stays true. Swept rather than
    // sampled, because the failure this catches (`===` for `>=`) shows up as a
    // single false value ABOVE the line and would survive a two-point check.
    const cond = { kind: "yourEnergyInPlayAtLeast", energy: "Darkness", count: 3 } as const;
    const expected = [false, false, false, true, true, true];
    for (let n = 0; n <= 5; n++) {
      const state = n === 0 ? absol(board(40), "p1") : benchDark(absol(board(40), "p1"), "p1", n);
      expect(conditionHolds(state, "p1", cond)).toBe(expected[n]);
    }
  });

  it("answers per SEAT on one board", () => {
    const cond = { kind: "yourEnergyInPlayAtLeast", energy: "Darkness", count: 3 } as const;
    const state = benchDark(absol(board(41), "p1"), "p1", 3);
    expect(conditionHolds(state, "p1", cond)).toBe(true);
    expect(conditionHolds(state, other("p1"), cond)).toBe(false);
  });

  it("is trivially true at a count of 0, and false for another type", () => {
    const state = benchDark(absol(board(42), "p1"), "p1", 3);
    // An empty board satisfies "at least 0" — degenerate, and worth pinning
    // because the printed sentence's 3 is the only thing keeping it off.
    expect(
      conditionHolds(board(43), "p1", {
        kind: "yourEnergyInPlayAtLeast",
        energy: "Darkness",
        count: 0,
      }),
    ).toBe(true);
    // Three Darkness are not three Fire. Provision, not a wildcard read.
    expect(
      conditionHolds(state, "p1", { kind: "yourEnergyInPlayAtLeast", energy: "Fire", count: 3 }),
    ).toBe(false);
  });

  it("renders a note from BOTH parameters", () => {
    expect(
      conditionNote({ kind: "yourEnergyInPlayAtLeast", energy: "Darkness", count: 3 }),
    ).toBe("you have at least 3 Darkness Energy in play");
    expect(conditionNote({ kind: "yourEnergyInPlayAtLeast", energy: "Metal", count: 1 })).toBe(
      "you have at least 1 Metal Energy in play",
    );
    expect(conditionNote({ kind: "yourEnergyInPlayAtLeast", energy: "special", count: 2 })).toBe(
      "you have at least 2 Special Energy in play",
    );
  });

  it("does NOT byte-round-trip to the printed clause — and that is deliberate", () => {
    // D119's cluster round-tripped because its clauses print no glyphs. This one
    // prints "{D}", a card-face symbol, and the note renders the NAME (D118's
    // rule) because a reject message and a HUD tooltip are read by a person off
    // the board. So the note differs from the printed clause in exactly one token
    // and in no other way — asserted both ways rather than left to a reader.
    const note = conditionNote({ kind: "yourEnergyInPlayAtLeast", energy: "Darkness", count: 3 });
    const printed = DARKFALL.slice("If ".length, DARKFALL.indexOf(", this attack"));
    expect(printed).toBe("you have at least 3 {D} Energy in play");
    expect(note).not.toBe(printed);
    expect(note).toBe(printed.replace("{D}", "Darkness"));
  });
});

describe("purity", () => {
  it("mutates nothing on a frozen board, armed or not", () => {
    const armed = deepFreeze(benchDark(absol(board(50), "p1"), "p1", 3));
    expect(() => mustApply(armed, { type: "attack", seat: "p1", index: 0 })).not.toThrow();
    const unarmed = deepFreeze(absol(board(51), "p1"));
    expect(() => mustApply(unarmed, { type: "attack", seat: "p1", index: 0 })).not.toThrow();
  });
});
