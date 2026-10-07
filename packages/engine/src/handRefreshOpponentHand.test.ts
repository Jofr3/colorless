import { describe, expect, it } from "vitest";
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import {
  deriveAttackBonusConsequent,
  deriveAttackCancelRequirement,
  deriveAttackCoinFlip,
  deriveAttackCopy,
  deriveAttackDamageBonus,
  deriveAttackDamageMultiplier,
  deriveAttackDamagePenalty,
  deriveAttackDamageSuppression,
  deriveAttackDiscardScaledBoost,
  deriveAttackEffect,
  deriveAttackOptionalBoost,
  deriveAttackOptionalCostBoost,
  deriveAttackPreDamage,
  deriveAttackRequirement,
} from "./effects";
import { engineVersion } from "./index";
import type { EffectOp, GameEvent, GameState, Seat } from "./index";
import { programFor, registryCardIds } from "./registry";
import {
  FIXTURE_POOL,
  HAND_DRAW_DECK,
  attachFromDeck,
  clearBench,
  driveSetup,
  handFromDeck,
  mustApply,
  setActiveFromDeck,
  types,
} from "./testFixtures";

// 0.402.0 → 0.403.0 — 🆕🆕 D516: THE DRAW COUNT THAT READS THE OPPONENT'S HAND.
//
// *"Shuffle your hand into your deck. Then, draw a card for each card in your
// opponent's hand."* — `censusAttackCorpus.ts` **FILE LINE 487**, **1 sentence / 1
// legal printing**, claimed WHOLE by `deriveAttackEffect` arm 44c through ONE new
// anchor (`SHUFFLE_HAND_DRAW_PER_OPPONENT_HAND`) and ONE new `HandRefreshDraw` member
// (`opponentHandSize`, the FIFTH), deriving
// `[{ op: "handRefresh", who: "you", draw: { kind: "opponentHandSize" } }]`.
//
// 🛑 **THE REFUSAL THAT ORDERED THIS SLICE WAS WRITTEN AT D479 AND WAS RIGHT IN EVERY
// CLAUSE.** `SHUFFLE_HAND_DRAW`'s own block named this row, named the axis (*"the
// identical head, a DERIVED count"*), enumerated the four members, and concluded *"that
// row needs a fifth member"* — and it DROVE the refusal as its own falsifier rather
// than asserting it in prose. Thirty-seven decisions later every word of it held.
// That is D515's rule (*"a refusal that names a FUNCTION ages well; one that names a
// SPELLING rots"*) paid at a second address one slice after it was written: this block
// named a MEMBER OF A UNION, which is a thing that cannot be re-spelled away.
//
// 🛑 **A MEMBER OF `HandRefreshDraw` AND NOT A `DamageCountSource`, AND THE REASON IS
// THE EVALUATOR RATHER THAN THE NOUN.** `DamageCountSource.cardsInOpponentHand` spells
// the identical printed phrase at corpus file line 564. Its ONLY evaluator is
// `attack.ts`'s `scaledAttackDamage(attacker, bonus, state, defenderSeat, attackerSeat,
// cost)`, and FOUR of those six parameters are ATTACK-DECLARATION facts — there is no
// attacker, no defender seat and no effective cost on the Trainer and Ability paths that
// author every OTHER `handRefresh` in the engine (Youngster, Judge, Brassius, Katy, Iono,
// Skwovet, Gothitelle, Lacey, Drasna, Harlequin, Unfair Stamp and Team Rocket's Archer —
// **30 registry card ids**, counted off `registryCardIds()` in §7 rather than listed from
// memory — 🆕🆕🆕 D555: **31**, Meddling Memo `sv08-181` joins them, a Trainer with
// `who: "opponent"` + `toBottom` + `handPlus 0`; the "30" is the D516 count, kept). Embedding that
// union here would therefore buy a SECOND evaluator for it — D159's own failure mode —
// or plumb an `InPlayPokemon` through a Supporter. ⚠️ **THE HOUSE HAS MADE THIS CALL
// TWICE IN WRITING**: `AttackFlipCount` re-spells three of that union's concepts under
// *"Deliberately not a `DamageCountSource` arm"*, and `MaxHpScale` re-spells two under
// *"naming this member after the existing one is what keeps them from drifting"*. Four
// count vocabularies, zero embeddings — what D159 makes single is the WALK, never the
// union, and §7 asserts that relation rather than quoting it.
//
// ⚠️ **AND `prizeCount` IS NOT THE PRECEDENT IT LOOKS LIKE.** A pre-slice brief offered
// it as evidence that the codebase had already chosen duplication (*"`HandRefreshDraw`
// has `prizeCount` and the damage union has `opponentPrizesTaken`"*). They are OPPOSITE
// ENDS OF ONE PILE: `prizeCount` is the affected player's REMAINING Prizes and
// `opponentPrizesTaken` is `6 − remaining` for the other seat, which `registry.ts`'s
// D207 block states outright (*"TWO SPELLINGS EXIST AND THEY ARE NOT THE SAME NUMBER"*).
// §7 drives the difference at the value where it shows.
//
// 🛑 **WHAT THIS FILE IS ACTUALLY ABOUT IS *WHOSE ZONE THE COUNT READS*, AND ONE BOARD
// CANNOT SEE IT.** Every board here fixes the controller's hand at FIVE, the controller's
// remaining Prizes at SIX and the opponent's hand at FOUR, so the four shipped members
// and the new one answer 6, 5, 6, <a literal> and 4 — five different numbers, and only
// the last matches the print. A board where any two of those coincide is green under the
// wrong member (D416/D488's arithmetic-coincidence class).
//
// ⚠️ **THE DEMONSTRATOR IS NOT A NEW FIXTURE (D414/D425).** `fix-handdraw` is D404's
// body and already prints D479's sibling sentence as its whole attack; the boards below
// re-text attack 0 on a per-board `cardPool` CLONE, so `FIXTURE_POOL` is byte-unchanged
// and every `ids.length` ladder takes a ZERO term.

const attack = { type: "attack", seat: "p1", index: 0 } as const;

/** Every reader `censusAtHead.test.ts` sweeps with, in `shuffleHandDraw.test.ts`'s
    order and guarded against the MODULE in §7 (D419 — a hand-kept copy that nothing
    compares to the module can sit short of it indefinitely). */
const READERS: readonly ((t: string) => unknown)[] = [
  deriveAttackEffect,
  deriveAttackDamageBonus,
  deriveAttackDamagePenalty,
  deriveAttackDamageMultiplier,
  deriveAttackCoinFlip,
  deriveAttackRequirement,
  deriveAttackDamageSuppression,
  deriveAttackOptionalBoost,
  deriveAttackBonusConsequent,
  deriveAttackOptionalCostBoost,
  deriveAttackCancelRequirement,
  deriveAttackPreDamage,
  // 🆕🆕🆕 D573 — THE FOURTEENTH, the copy-attack reader. Spliced before the last entry (D419).
  deriveAttackCopy,
  deriveAttackDiscardScaledBoost,
];

/** THE SENTENCE THIS SLICE BUYS, byte for byte from `legalAttackCorpus()`. */
const PRINTED =
  "Shuffle your hand into your deck. Then, draw a card for each card in your opponent's hand.";

/** D479's sentence — the SIBLING one corpus line up, and the control every board here
    runs beside: the identical head, the identical op, the identical seat, and a `fixed`
    count where this one has a derived one. */
const SIBLING = "Shuffle your hand into your deck. Then, draw 6 cards.";

/** THE PROGRAM, spelled once and reused, so a case cannot pass against a hand-copied
    literal that has drifted from what the file means by it. */
const PROGRAM: EffectOp[] = [
  { op: "handRefresh", who: "you", draw: { kind: "opponentHandSize" } },
];

const units = (rows: readonly (readonly [number, string])[]) => rows.reduce((s, [n]) => s + n, 0);

/** 🛑 **THE CONTROLLER'S EFFECT DRAW, AND NEVER "the first `CARDS_DRAWN` row".** An attack
    ENDS THE TURN [🆕🆕🆕 D570 (D539): except a FIRST attack under Festival Lead with Festival Grounds in play, which no board here builds], so the DEFENDER's turn-start draw lands inside the same action (D491) —
    on a board where this op draws nothing, a bare `find(events, "CARDS_DRAWN")` returns
    P2's turn-start row and reports one card drawn. Every count here is filtered by SEAT
    and by `reason`, so a rung cannot pass on the other player's card. */
function effectDraw(events: GameEvent[], seat: Seat = "p1"): string[] {
  return events.flatMap((e) =>
    e.type === "CARDS_DRAWN" && e.seat === seat && e.reason === "effect" ? e.uids : [],
  );
}

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// §1 — the printed data, measured live over the legal column.
// ─────────────────────────────────────────────────────────────────────────────

describe("D516 §1 — the printed data, measured live over the legal column", () => {
  it("🛑 the sentence is the CORPUS's bytes at ONE printing, and so is its sibling", () => {
    const rows = new Map(legalAttackCorpus().map(([n, s]) => [s, n] as const));
    expect(rows.get(PRINTED)).toBe(1);
    expect(rows.get(SIBLING)).toBe(1);
  });

  it("the APOSTROPHE is ASCII, and the anchor would silently miss a typographic one", () => {
    // D440's rule at a regex rather than at a Map key: the byte is load-bearing and a
    // paraphrase typed from a rendered card carries U+2019.
    expect(PRINTED.includes("opponent's")).toBe(true);
    expect(PRINTED.includes("opponent’s")).toBe(false);
    expect(PRINTED.codePointAt(PRINTED.indexOf("'"))).toBe(0x0027);
  });

  it("🛑 the column prints this DERIVED count on this skeleton exactly ONCE", () => {
    // The whole `Shuffle your hand into your deck.` family over all 640 rows: the two
    // sentences above and nothing else. A third spelling would need its own reading, and
    // this rung is what says the family is closed at today's head (D435 — not
    // incrementing is also a measurement).
    const family = legalAttackCorpus().filter(([, s]) =>
      s.startsWith("Shuffle your hand into your deck."),
    );
    expect(family.map(([, s]) => s).sort()).toEqual([PRINTED, SIBLING].sort());
    expect(units(family)).toBe(2);
  });

  it("🆕🆕 D516 — the sentence is now RESOLVED, and by exactly one reader", () => {
    expect(resolvedByAnyReader(PRINTED)).toBe(true);
    expect(deriveAttackEffect(PRINTED)).toEqual(PROGRAM);
    for (const read of READERS) {
      if (read === deriveAttackEffect) continue;
      expect(read(PRINTED), read.name).toBeNull();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — the reading, against the SIBLING rather than against a re-typed shape.
// ─────────────────────────────────────────────────────────────────────────────

describe("D516 §2 — the program, read against D479's sibling", () => {
  it("🛑 the two programs differ in `draw` and in NOTHING else", () => {
    // D514's rule — read the sibling's PROGRAM, not its verdict. The op, the seat and
    // the absence of both riders are D479's, byte for byte; the only new vocabulary in
    // the whole slice is the fifth `draw.kind`.
    const mine = deriveAttackEffect(PRINTED);
    const theirs = deriveAttackEffect(SIBLING);
    expect(mine).toHaveLength(1);
    expect(theirs).toHaveLength(1);
    expect({ ...mine?.[0], draw: null }).toEqual({ ...theirs?.[0], draw: null });
    expect(mine?.[0]).toMatchObject({ op: "handRefresh", who: "you" });
    expect(theirs?.[0]).toMatchObject({ draw: { kind: "fixed", count: 6 } });
    expect(mine).not.toEqual(theirs);
  });

  it("neither rider is set, and that is the printed difference from Iono", () => {
    // `toBottom` is Iono's placement (the deck's ORDER survives) and `onlyIfAnyMoved` is
    // Iono's gate. This sentence prints neither, so the keys must be ABSENT and not
    // `undefined`-valued — a JSON record is the shape a successor diffs.
    expect(Object.keys(deriveAttackEffect(PRINTED)?.[0] ?? {}).sort()).toEqual([
      "draw",
      "op",
      "who",
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — the refusals, each pinned on ONE printed byte.
// ─────────────────────────────────────────────────────────────────────────────

describe("D516 §3 — the refusals, each pinned on ONE printed byte", () => {
  it("🛑 the COUNT'S SOURCE ZONE, the SEAT, the RATE and the JOIN refuse INDEPENDENTLY", () => {
    // …the ZONE alone: your own hand is empty by the time the draw runs, and no member
    // of this union reads it. `cardsInDiscardPile` spells the pile for the damage
    // vocabulary and nothing spells it here.
    expect(
      deriveAttackEffect(
        "Shuffle your hand into your deck. Then, draw a card for each card in your hand.",
      ),
    ).toBeNull();
    expect(
      deriveAttackEffect(
        "Shuffle your hand into your deck. Then, draw a card for each card in your opponent's discard pile.",
      ),
    ).toBeNull();
    // …the SEAT of the refresh alone: `who: "opponent"` and `who: "both"` are the op's
    // other two values and either would empty a hand this sentence never names.
    expect(
      deriveAttackEffect(
        "Shuffle your opponent's hand into their deck. Then, draw a card for each card in your opponent's hand.",
      ),
    ).toBeNull();
    expect(
      deriveAttackEffect(
        "Each player shuffles their hand into their deck. Then, draw a card for each card in your opponent's hand.",
      ),
    ).toBeNull();
    // …the RATE alone: this member is NULLARY because the printed rate is one card per
    // card. A printed multiple is a different member (`per`), not this one with a field.
    expect(
      deriveAttackEffect(
        "Shuffle your hand into your deck. Then, draw 2 cards for each card in your opponent's hand.",
      ),
    ).toBeNull();
    // …the JOIN alone: the printed two-sentence form with ". Then, " is what this anchor
    // reads, exactly as the sibling's is.
    expect(
      deriveAttackEffect(
        "Shuffle your hand into your deck and draw a card for each card in your opponent's hand.",
      ),
    ).toBeNull();
    // …and the DESTINATION alone: Iono's `toBottom` is a different program.
    expect(
      deriveAttackEffect(
        "Shuffle your hand and put it on the bottom of your deck. Then, draw a card for each card in your opponent's hand.",
      ),
    ).toBeNull();
  });

  it("the anchor is WHOLE-SENTENCE — a leading or trailing clause is refused", () => {
    for (const text of [
      `Draw a card. ${PRINTED}`,
      `${PRINTED} Your turn ends.`,
      `${PRINTED} If you do, this attack does 60 more damage.`,
      // Case is load-bearing: no reader in `effects.ts` carries an `/i`.
      PRINTED.toLowerCase(),
      PRINTED.toUpperCase(),
      // The trailing period is required — a regex written from a paraphrase matches no
      // real card.
      PRINTED.slice(0, -1),
    ]) {
      expect(deriveAttackEffect(text), text).toBeNull();
    }
  });

  it("🛑 the two anchors are STRUCTURALLY DISJOINT, so their order is legibility", () => {
    // D467's first preference: a string cannot begin two ways, and here they cannot END
    // two ways either — both are `^…$` and disagree on a mandatory run of bytes. So no
    // guard keeps them apart and there is nothing to rot.
    expect(deriveAttackEffect(PRINTED)).not.toEqual(deriveAttackEffect(SIBLING));
    expect(PRINTED.startsWith("Shuffle your hand into your deck. Then, draw ")).toBe(true);
    expect(SIBLING.startsWith("Shuffle your hand into your deck. Then, draw ")).toBe(true);
    expect(PRINTED.endsWith("in your opponent's hand.")).toBe(true);
    expect(SIBLING.endsWith("draw 6 cards.")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE BOARD. One fixture, re-texted on a per-board `cardPool` clone (D414).
// ─────────────────────────────────────────────────────────────────────────────

/** THE CONTROLLER'S HAND, and it is FIVE so that `handPlus { delta: 0 }` would answer a
    number no other member does. */
const OWN_HAND = ["fix-item", "fix-item", "fix-item", "fix-energy", "fix-energy"] as const;

/** THE OPPONENT'S HAND, and it is FOUR — the only number the print admits, and distinct
    from the controller's five, from `fixed`'s six and from `prizeCount`'s six. */
const FOE_HAND = ["fix-item", "fix-item", "fix-energy", "fix-bigbody"] as const;

/** Re-text `fix-handdraw`'s ONE printed attack on a board's OWN `cardPool` copy.
    ⚠️ **NOT A FIXTURE EDIT** — `FIXTURE_POOL` is shared by every suite in this package
    and D412 reddened three boards by widening a shared one. */
function withEffect(state: GameState, effect: string): GameState {
  const card = state.cardPool["fix-handdraw"];
  if (card === undefined) throw new Error("no fix-handdraw in pool");
  const attacks = card.attacks ?? [];
  const first = attacks[0];
  if (first === undefined) throw new Error("fix-handdraw has no attack 0");
  return {
    ...state,
    cardPool: {
      ...state.cardPool,
      "fix-handdraw": { ...card, attacks: [{ ...first, effect }, ...attacks.slice(1)] },
    },
  };
}

/** Rebuild `seat`'s HAND outright — every dealt card back into the deck, then exactly
    `ids` dealt off it (`opponentHandScaling.test.ts`'s helper, needed here for the same
    reason: the hand is the zone under test at BOTH seats). */
function withHand(state: GameState, seat: Seat, ids: readonly string[]): GameState {
  const side = state.players[seat];
  let next: GameState = {
    ...state,
    players: {
      ...state.players,
      [seat]: { ...side, hand: [], deck: [...side.deck, ...side.hand] },
    },
  };
  for (const id of ids) next = handFromDeck(next, seat, id, 1);
  return next;
}

/** P2 opens and passes, so P1 carries no §4 first-turn restriction. P1 fields
    `fix-handdraw` holding one `fix-energy` (the printed {C} cost); P2's Active is a 200
    HP body the flat 30 never Knocks Out, so no §8.1 KO tail lands between the shuffle and
    the draw and no Prize moves. BOTH Benches are cleared — every number here is a
    population, and a body the setup shuffle happened to place would be noise. */
function fielded(
  seed: number,
  effect: string = PRINTED,
  foeHand: readonly string[] = FOE_HAND,
): GameState {
  const opened = mustApply(
    driveSetup(seed, { p1: HAND_DRAW_DECK, p2: HAND_DRAW_DECK }, { first: "p2" }),
    { type: "endTurn", seat: "p2" },
  ).state;
  let state = setActiveFromDeck(opened, "p1", "fix-handdraw");
  state = attachFromDeck(state, "p1", "fix-energy", 1);
  state = clearBench(state, "p1");
  state = setActiveFromDeck(state, "p2", "fix-bigbody");
  state = clearBench(state, "p2");
  state = withHand(state, "p1", OWN_HAND);
  state = withHand(state, "p2", foeHand);
  return withEffect(state, effect);
}

const sorted = (uids: readonly string[]) => [...uids].sort();

// ─────────────────────────────────────────────────────────────────────────────
// §4 — the COUNT, on a board where five candidate members give five numbers.
// ─────────────────────────────────────────────────────────────────────────────

describe("D516 §4 — the count is the OPPONENT'S hand size, and four rivals say otherwise", () => {
  it("🛑 the controller draws exactly the opponent's hand size, and the rivals are all wrong", () => {
    const state = fielded(1);
    const before = state.players.p1;
    // THE FIVE NUMBERS, ASSERTED BEFORE THE SWING so the discrimination is a property of
    // the BOARD and not of the outcome (D488: an arithmetic coincidence is invisible
    // afterwards).
    expect(before.hand).toHaveLength(5); //   handPlus { delta: 0 }
    expect(before.prizes).toHaveLength(6); // prizeCount
    expect(state.players.p2.hand).toHaveLength(4); // opponentHandSize — the print
    //                                        fixed would be 6 (the sibling's constant)
    const { state: done, events } = mustApply(state, attack);
    expect(effectDraw(events)).toHaveLength(4);
    expect(done.players.p1.hand).toHaveLength(4);
  });

  it("🛑 it TRACKS the zone rather than hitting a constant — two more sizes, same board", () => {
    // A single board cannot tell a read from a lucky literal. Three sizes, three draws.
    for (const [size, ids] of [
      [1, ["fix-item"]],
      [3, ["fix-item", "fix-energy", "fix-bigbody"]],
      [6, ["fix-item", "fix-item", "fix-item", "fix-energy", "fix-energy", "fix-bigbody"]],
    ] as const) {
      const state = fielded(2, PRINTED, ids);
      expect(state.players.p2.hand, `${size}`).toHaveLength(size);
      const { state: done } = mustApply(state, attack);
      expect(done.players.p1.hand, `${size}`).toHaveLength(size);
    }
  });

  it("🛑 the SIBLING on the SAME board draws SIX, which is the member's whole content", () => {
    // The control that separates "this member works" from "this board draws four".
    const { state: done } = mustApply(fielded(1, SIBLING), attack);
    expect(done.players.p1.hand).toHaveLength(6);
  });

  it("the OLD hand ends in the DECK and not in the discard, and the OPPONENT is untouched", () => {
    const state = fielded(3);
    const oldHand = [...state.players.p1.hand];
    const oldDiscard = [...state.players.p1.discard];
    const foeHand = [...state.players.p2.hand];
    const foeDeck = [...state.players.p2.deck];
    const { state: done, events } = mustApply(state, attack);
    // Every old card is in the deck; none of them reached the pile.
    for (const uid of oldHand) expect(done.players.p1.deck).toContain(uid);
    expect(done.players.p1.discard).toEqual(oldDiscard);
    expect(types(events)).toContain("HAND_SHUFFLED_INTO_DECK");
    expect(types(events)).not.toContain("HAND_DISCARDED");
    expect(types(events)).not.toContain("HAND_TO_BOTTOM_OF_DECK");
    // 🛑 THE OPPONENT'S ZONES ARE UNTOUCHED BY THE OP — `who: "you"` is the printed
    // subject, and the count READS the other seat without moving a card of theirs.
    // ⚠️ **NOT "BYTE-UNCHANGED", AND THE DIFFERENCE IS D491's**: an attack ENDS THE TURN [🆕🆕🆕 D570 (D539): except a FIRST attack under Festival Lead with Festival Grounds in play, which no board here builds],
    // so P2's turn-start draw lands inside this same action. The assertion is therefore
    // *"every card they held they still hold, plus exactly one off the top of their own
    // deck"* — which is a STRICTER statement than a length check and the only one that is
    // true. A rung that asserted equality here would have been re-pointed by the clock.
    for (const uid of foeHand) expect(done.players.p2.hand).toContain(uid);
    expect(done.players.p2.hand).toHaveLength(foeHand.length + 1);
    expect(done.players.p2.deck).toEqual(foeDeck.slice(1));
    expect(done.players.p2.hand).toContain(foeDeck[0]);
    expect(done.players.p2.discard).toEqual([]);
    // The shuffled hand and the freshly drawn one are disjoint from the discard pile.
    expect(sorted(done.players.p1.hand).some((uid) => oldDiscard.includes(uid))).toBe(false);
  });

  it("🛑 the EVENT is COUNT-ONLY at the other seat, so nothing leaks", () => {
    // The zone this member reads is HIDDEN, and the number it produces is public. What
    // keeps that honest is that a hand SIZE is already public — the count shows — and
    // this member reads `hand.length` and never a card. No event names an opponent uid.
    const { events } = mustApply(fielded(4), attack);
    const shuffled = find(events, "HAND_SHUFFLED_INTO_DECK");
    expect(shuffled?.seat).toBe("p1");
    expect(shuffled?.count).toBe(5);
    expect(events.filter((e) => e.type === "HAND_SHUFFLED_INTO_DECK")).toHaveLength(1);
    expect(effectDraw(events)).toHaveLength(4);
    expect(effectDraw(events, "p2")).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — the falsifiers, driven rather than argued.
// ─────────────────────────────────────────────────────────────────────────────

describe("D516 §5 — the falsifiers, driven rather than argued", () => {
  it("🛑 FALSIFIER 1 — an EMPTY opponent hand still reshuffles and draws ZERO", () => {
    // The arm has no `>= 1` guard and must not grow one: an opponent holding nothing is
    // a legal board, not an unread sentence. The shuffle still happens (the op's step 1
    // is unconditional without `onlyIfAnyMoved`), so the deck is reordered and the hand
    // is emptied — a state no "draw nothing" shortcut would produce.
    const state = fielded(5, PRINTED, []);
    const oldHand = [...state.players.p1.hand];
    expect(state.players.p2.hand).toHaveLength(0);
    const { state: done, events } = mustApply(state, attack);
    expect(done.players.p1.hand).toEqual([]);
    for (const uid of oldHand) expect(done.players.p1.deck).toContain(uid);
    expect(types(events)).toContain("HAND_SHUFFLED_INTO_DECK");
    expect(find(events, "HAND_SHUFFLED_INTO_DECK")?.count).toBe(5);
    // A zero-card draw moves no card of the controller's. ⚠️ FILTERED BY SEAT AND
    // REASON, because the DEFENDER's turn-start draw lands in this same action (D491) —
    // a bare `find(events, "CARDS_DRAWN")` here returns P2's row and reports ONE.
    expect(effectDraw(events)).toEqual([]);
    expect(events.some((e) => e.type === "CARDS_DRAWN")).toBe(true);
    // …and the attack still RESOLVED: the effect is not skipped.
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(30);
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("🛑 FALSIFIER 2 — the controller's OWN hand is emptied BEFORE the count is taken", () => {
    // The printed *"Then,"* is a sequencing word with no arithmetic in it HERE, because
    // `who: "you"` never touches the zone the count reads. That is the one clause a
    // successor widening `who` would silently break, so it is asserted on a board: the
    // draw is the opponent's FOUR and not the controller's post-shuffle ZERO.
    const state = fielded(6);
    expect(state.players.p1.hand).toHaveLength(5);
    const { state: done } = mustApply(state, attack);
    expect(done.players.p1.hand).toHaveLength(4);
    expect(done.players.p1.hand).not.toHaveLength(0);
  });

  it("🛑 ZERO-MATCH BOARD — a near-miss on the SAME body is SILENT, and loudly so", () => {
    // THE CONTROL THAT SEPARATES THIS ARM FROM SILENCE-FOR-ANOTHER-REASON: the board, the
    // fixture, the cost, the seat and the damage are identical to §4's, and only the
    // printed STRING differs — on the count's SOURCE ZONE alone. ⚠️ CONSTRUCTED, and it
    // says so (D452): the printed near-miss this family had was corpus line 487 itself,
    // which this slice spent.
    const state = fielded(
      7,
      "Shuffle your hand into your deck. Then, draw a card for each card in your hand.",
    );
    const oldHand = [...state.players.p1.hand];
    const oldDeck = [...state.players.p1.deck];
    const { state: done, events } = mustApply(state, attack);
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(30);
    expect(types(events)).toContain("ATTACK_EFFECT_SKIPPED");
    expect(types(events)).not.toContain("HAND_SHUFFLED_INTO_DECK");
    expect(done.players.p1.hand).toEqual(oldHand);
    expect(done.players.p1.deck).toEqual(oldDeck);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — the describer surfaces, checked rather than assumed (D515).
// ─────────────────────────────────────────────────────────────────────────────

describe("D516 §6 — the describer surfaces, checked rather than assumed", () => {
  it("🛑 the op NEVER PARKS, so no caption is owed and `describeBranch` never sees it", () => {
    // D515's slice shipped a reader whose DESCRIBER was missing and failed SILENTLY, so
    // "the ops all ship" is not a licence to skip this. `handRefresh` raises no prompt on
    // any board here: the phase after the attack is the ordinary turn phase, never an
    // `effect` park, so there is no caption for a new draw kind to go missing from.
    for (const foe of [[], FOE_HAND] as const) {
      const { state: done } = mustApply(fielded(8, PRINTED, foe), attack);
      expect(done.phase.kind).not.toBe("effect");
      expect(done.phase.kind).not.toBe("gameOver");
    }
  });

  it("🛑 the LOG renders the draw from the EVENT's count, so the new kind needs no arm", () => {
    // The other half of D515's warning: a GENERIC event can render a number without ever
    // naming the op, which is exactly the shape that failed silently there. Here it is
    // benign and that is a measurement rather than an argument — `log.ts` has no
    // `handRefresh` arm at all, and both rows it prints for this program read a COUNT the
    // evaluator has already produced, so a fifth `draw.kind` renders correctly by
    // construction and the number on screen is the number on the board.
    const events = mustApply(fielded(9), attack).events;
    expect(effectDraw(events)).toHaveLength(4);
    expect(find(events, "HAND_SHUFFLED_INTO_DECK")?.count).toBe(5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7 — what this slice did NOT buy, measured.
// ─────────────────────────────────────────────────────────────────────────────

describe("D516 §7 — what this slice did NOT buy, measured", () => {
  it("the hand-kept READERS list IS the module's reader surface, still THIRTEEN", () => {
    expect(READERS.map((read) => read.name).sort()).toEqual(attackReaderSurface());
    expect(attackReaderSurface()).toHaveLength(14 /* 🆕🆕🆕 D573: 13 → 14, + deriveAttackCopy */);
  });

  it("`FIXTURE_POOL` is BYTE-UNCHANGED — the demonstrator is a per-board clone", () => {
    expect(FIXTURE_POOL["fix-handdraw"]?.attacks).toEqual([
      {
        cost: ["Colorless"],
        name: "Hand Refresh",
        damage: "30",
        // D404's sentence, which is what the SHARED pool prints — NOT D479's and not
        // this slice's. Both of those are per-board re-textings, which is the point.
        effect: "Discard your hand and draw 6 cards.",
      },
    ]);
  });

  it("🛑 `prizeCount` and the damage union's prize count are OPPOSITE ENDS OF ONE PILE", () => {
    // The brief that ordered this slice offered them as one concept spelled twice, which
    // would have been an argument for duplicating a noun. They are not the same number:
    // `HandRefreshDraw.prizeCount` reads `prizes.length` (REMAINING) and
    // `DamageCountSource.opponentPrizesTaken` reads `6 − remaining`. On a board with six
    // Prizes left the two answer 6 and 0, which is where the difference shows.
    const state = fielded(10);
    expect(state.players.p1.prizes).toHaveLength(6);
    const PRIZE_COUNT = state.players.p1.prizes.length;
    const PRIZES_TAKEN = 6 - state.players.p2.prizes.length;
    expect([PRIZE_COUNT, PRIZES_TAKEN]).toEqual([6, 0]);
    expect(PRIZE_COUNT).not.toBe(PRIZES_TAKEN);
  });

  it("🛑 the ENGINE version moved and `MATCH_RECORD_VERSION` did not, and both are argued", () => {
    // The engine bump is behaviour: a printed sentence that resolved to nothing now
    // resolves to a program.
    //
    // 🛑 **`MATCH_RECORD_VERSION` IS ARGUED AT THE HARD ADDRESS, BECAUSE THE EASY ONE IS
    // NOT AVAILABLE.** D452's *"this byte already ships"* does NOT apply: the SERIALIZED
    // ALPHABET GROWS — `{"kind":"opponentHandSize"}` is a byte string no v30 deploy can
    // write. The claim therefore rests on REACHABILITY (D450) ALONE, and reachability is
    // a measurement over the PRODUCERS rather than a property of the op — which is what
    // the rung below drives.
    expect(engineVersion).toBe("0.466.0");
  });

  it("🛑 REACHABILITY IS EMPTY, MEASURED OVER EVERY PRODUCER RATHER THAN ASSERTED", () => {
    // D450's question is not *"does this op park?"* but *"can any producer put this op
    // into a written continuation?"* — `EffectContinuation` carries `{pendingOp, rest}`,
    // and `rest` holds every op AFTER the parking one. So a `handRefresh` is persisted
    // the moment any authored list places it, or a gate containing it, behind another op.
    //
    // This walks BOTH producer sets — `registryCardIds()`'s whole program objects and
    // every program `deriveAttackEffect` returns over the legal column — and asserts the
    // invariant that makes the argument true: **anything containing a `handRefresh` sits
    // at index 0 of the list it belongs to.** A successor that appends one after another
    // op reddens this rung and owes a version bump; nothing else in the repo would notice.
    const offenders: string[] = [];
    let opLists = 0;
    let multiOpLists = 0;
    const holdsRefresh = (v: unknown): boolean => {
      if (Array.isArray(v)) return v.some(holdsRefresh);
      if (v === null || typeof v !== "object") return false;
      const rec = v as Record<string, unknown>;
      if (rec.op === "handRefresh") return true;
      return Object.values(rec).some(holdsRefresh);
    };
    const walk = (v: unknown, where: string): void => {
      if (Array.isArray(v)) {
        const ops = v.filter((e) => e !== null && typeof e === "object" && "op" in (e as object));
        if (ops.length === v.length && v.length > 0) {
          opLists += 1;
          if (v.length > 1) multiOpLists += 1;
          v.forEach((el, i) => {
            if (i > 0 && holdsRefresh(el)) offenders.push(`${where}[${i}]`);
          });
        }
        v.forEach((el, i) => walk(el, `${where}[${i}]`));
        return;
      }
      if (v === null || typeof v !== "object") return;
      for (const [k, el] of Object.entries(v as Record<string, unknown>)) walk(el, `${where}.${k}`);
    };
    for (const id of registryCardIds()) walk(programFor(id), id);
    let derived = 0;
    for (const [, text] of legalAttackCorpus()) {
      const program = deriveAttackEffect(text);
      if (program === null) continue;
      derived += 1;
      walk(program, `derived:${text.slice(0, 40)}`);
    }
    expect(offenders).toEqual([]);
    // …and the walk actually SAW something, so an empty `offenders` is a finding rather
    // than an empty sweep (D200 — a guard must be able to go red).
    expect(derived).toBeGreaterThan(100);
    expect(registryCardIds().length).toBeGreaterThan(100);
    const producers = registryCardIds().filter((id) => holdsRefresh(programFor(id)));
    expect(producers).toHaveLength(35); // 🆕🆕🆕 D582 — 33 -> 35, two `me` reprint-alias keys on EXISTING objects: Team Rocket's Archer `me02.5-201` and Judge `me03-076` (`offenders` stays empty — the objects are the `sv` ones). // 🆕🆕🆕 D557 — 31 -> 33, Lucian `sv06-157`/`-208` (index 0 of a one-op `trainer` list, so `offenders` stays empty). // 🆕🆕🆕 D555 — 30 -> 31, Meddling Memo `sv08-181` (index 0 of a one-op `trainer` list, so `offenders` stays empty)
    // 🛑 …AND THE INVARIANT IS NOT TRIVIALLY TRUE, WHICH IS THE PART A GREEN `offenders`
    // CANNOT SAY (D200). Of the op lists this walk visits, **337 hold more than one op**
    // (🆕🆕🆕 D555, MEASURED rather than carried: **376 of 1,013** at this head, **368 of
    // 985** at the D554 base — the 337 is an older head's count, kept, and both floors
    // below still hold) and the longest holds six — so index > 0 is somewhere a `handRefresh` genuinely
    // COULD be placed, and the emptiness is a fact about the authors rather than about
    // the shape of the data. A slice that made every program a singleton would turn this
    // rung vacuous, and these two numbers are what would notice.
    expect(opLists).toBeGreaterThan(800);
    expect(multiOpLists).toBeGreaterThan(300);
  });
});
