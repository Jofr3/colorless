import { describe, expect, it } from "vitest";
import {
  conditionHolds,
  conditionNote,
  deriveAttackDamageBonus,
  deriveAttackDamageMultiplier,
  deriveAttackEffect,
  programFor,
} from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import {
  FIXTURE_POOL,
  SUPPORTER_CLAUSE_DECK,
  attachFromDeck,
  deepFreeze,
  driveSetup,
  handFromDeck,
  handUid,
  mustApply,
  setActiveFromDeck,
  types,
} from "./testFixtures";

// 0.73.0 → 0.74.0 — the SUPPORTER-PLAYED clause (D123). Pikachu swsh10.5-027
// "Buddy Bolt", "If you played a Supporter card from your hand during this turn,
// this attack does 30 more damage." One card, one clause, one printing, no
// reprint. It rides D115's 0-or-1 indicator through the existing additive fold,
// so this slice adds no op, no event, no registry row, no continuous.ts helper
// and no change to attack.ts.
//
//   `youPlayedSupporterThisTurn` — a BARE TAG on a LITERAL table row.
//
// WHY IT COSTS ZERO NEW STATE, which is the thing that could most easily have
// gone the other way:
//
//   §7.2's ONE-SUPPORTER-PER-TURN CAP IS ALREADY TRACKED, as
//   `state.allowances.supporterPlayed` — set by `playTrainer` (cardplay.ts) and
//   cleared by `freshAllowances()` on every `startTurn`.
//
// So the printed "during this turn" is not a new clock to build; it is precisely
// the lifetime the allowances bag already has. No field is added to
// `TurnAllowances`, none to `PlayerSide`, no serializer changes and
// `MATCH_RECORD_VERSION` does not move. The three exhaustive `toEqual` pins over
// the whole allowances bag (turn.test.ts, attack.test.ts, setup.test.ts) are
// untouched by this slice, which is the mechanical proof of that claim.
//
// D116's PRONOUN RULE DOES NOT APPLY, for the first time in this family: the
// printed subject is "you", and a seat-relative predicate reads that as printed.
// The clause table translates nothing here, and `conditionNote` round-trips to
// the printed clause byte for byte — the first note in the family that drops
// nothing at all.
//
// THE ONE REAL DESIGN CALL — THE SEAT GUARD, which is why this suite exists:
//
//   `GameState.allowances` is a SINGLE BAG, not a per-seat record. It describes
//   whoever owns the CURRENT turn.
//
// `conditionHolds(state, seat, cond)` is seat-relative, and it has consumers
// where `seat` is NOT the turn owner — a `conditionGate` op running under a
// koTrigger / damagedTrigger stage evaluates during the OPPONENT's turn (the
// `resumeTail` case on the `effect:choose` phase). Read unguarded, the bag would
// answer "your OPPONENT played a Supporter" as "you played a Supporter". So the
// arm proves ownership FIRST, through `phaseViewOf(state, seat).activeSeat`, THE
// one exhaustive switch over `Phase` — never a turn-parity re-derivation, which
// phaseView.ts's own module header forbids for exactly the case that breaks it.
// A checkup-origin `ko:*` park has `activeSeat` null, so the predicate reads
// FALSE for BOTH seats: "during this turn" is vacuous between turns, and that is
// the intended reading.
//
// THE NEAR-MISS IS REAL AND IT IS AN ABILITY: Crobat sv06.5-029's "Shadowy
// Envoy" is the pool's ONLY other "you played" sentence, and it differs twice
// over — it names a SPECIFIC card, and it says "this turn" without the "during".
// The whole-sentence anchor refuses it on either difference alone.

/** The printed sentence, pinned here and asserted char-for-char against
    FIXTURE_POOL below. Pikachu carries no authored program at all (see the
    ZERO-rows block), so the sentence IS the wiring: a drifted character does not
    throw, it drops the card back onto the loud ATTACK_EFFECT_SKIPPED path and
    silently stops paying the bonus. */
const BUDDY_BOLT =
  "If you played a Supporter card from your hand during this turn, this attack does 30 more damage.";

/** The REAL near-miss from the same pool — Crobat sv06.5-029's "Shadowy Envoy",
    the only other card in 978 that prints "you played". It is an ABILITY, it
    names a SPECIFIC Supporter rather than the card class, and it writes "this
    turn" WITHOUT the "during" that Buddy Bolt carries. Any one of the three
    would be enough; the whole-sentence anchor never has to choose. */
const SHADOWY_ENVOY =
  "Once during your turn, if you played Janine's Secret Art from your hand this turn, you may draw cards until you have 8 cards in your hand.";

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

/** The clause sentence at an arbitrary bonus — the constructor behind the
    CONSTRUCTED cases below. The default deliberately does NOT match the printing
    (80 rather than 30), so a fold that hard-coded the printed amount would
    survive a same-amount probe. */
function supporterClause(per = 80): string {
  return `If you played a Supporter card from your hand during this turn, this attack does ${per} more damage.`;
}

/** Setup then open P1's turn 2 (P2 went first and passed) — P1's first
    unrestricted turn, so the attack step is legal (§4) AND the §4 first-turn
    Supporter ban is behind us, which matters more here than usual: `playTrainer`
    rejects a Supporter on turn 1 with FIRST_TURN_SUPPORTER, so a turn-1 board
    could not arm this clause at all.

    Both Active spots are pinned to a neutral 200 HP fix-bigbody. Pikachu is a
    BASIC and could open, but pinning keeps every case off the deal, and pinning
    both sides keeps the defender's Weakness out of every case that is not about
    Weakness. */
function board(seed: number): GameState {
  const state = driveSetup(
    seed,
    { p1: SUPPORTER_CLAUSE_DECK, p2: SUPPORTER_CLAUSE_DECK },
    { first: "p2", active: { p1: "fix-bigbody", p2: "fix-bigbody" } },
  );
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** `board`, then handed over to P2 — P1 passes into P2's turn 3, which is equally
    unrestricted. The clause is seat-relative (it reads whether YOU played a
    Supporter), and a P1-only suite cannot tell "reads your own turn" apart from
    "reads p1's". */
function boardP2(seed: number): GameState {
  return mustApply(board(seed), { type: "endTurn", seat: "p1" }).state;
}

/** Pikachu in the seat's Active Spot with Buddy Bolt's {L}{C}{C} paid — the
    typed symbol from a Lightning Basic, the two generic ones from the plain
    Colorless Basic. Surgery for the BODY only; the clause itself is never armed
    by surgery anywhere in this suite (see `playNemona`). The displaced
    fix-bigbody lands on the Bench. */
function pikachu(state: GameState, seat: Seat): GameState {
  const placed = setActiveFromDeck(state, seat, "swsh10.5-027");
  return attachFromDeck(
    attachFromDeck(placed, seat, "fix-lightning-energy", 1),
    seat,
    "fix-energy",
    2,
  );
}

/** Arm the clause THE ONLY WAY IT CAN BE ARMED: a real `playTrainer` action on a
    real Supporter. `allowances.supporterPlayed` is written by `playTrainer` and
    by nothing else, so there is no surgical shortcut here of the kind the Tool
    and Energy clauses had — which is exactly what makes these board cases
    end-to-end. Nemona draws 3, touching nothing any predicate in this slice
    reads. */
function playNemona(state: GameState, seat: Seat): GameState {
  const withCard = handFromDeck(state, seat, "sv01-180", 1);
  const played = mustApply(withCard, {
    type: "playTrainer",
    seat,
    uid: handUid(withCard, seat, "sv01-180"),
  });
  if (!played.state.allowances.supporterPlayed) throw new Error("Nemona did not set the flag");
  return played.state;
}

/** The seat's opposite. Spelled once here rather than imported, because the
    member is seat-relative and every board case names a side. */
function other(seat: Seat): Seat {
  return seat === "p1" ? "p2" : "p1";
}

/** Buddy Bolt is Pikachu's only attack. */
const BUDDY_BOLT_INDEX = 0;

const COND = { kind: "youPlayedSupporterThisTurn" } as const;

describe("the printed sentence — the fixture-text-verbatim guard", () => {
  it("matches FIXTURE_POOL char-for-char", () => {
    const attack = FIXTURE_POOL["swsh10.5-027"]?.attacks?.[BUDDY_BOLT_INDEX];
    expect(attack?.effect).toBe(BUDDY_BOLT);
    // The printed "+" marker — what tells the pipeline a scaling clause is
    // expected at all — and the base the fold starts from.
    expect(attack?.damage).toBe("30+");
    expect(attack?.name).toBe("Buddy Bolt");
    expect(attack?.cost).toEqual(["Lightning", "Colorless", "Colorless"]);
    // ONE attack, so the index above cannot be right by accident.
    expect(FIXTURE_POOL["swsh10.5-027"]?.attacks).toHaveLength(1);
    expect(FIXTURE_POOL["swsh10.5-027"]?.abilities).toBeNull();
  });

  it("keeps the card facts the damage arithmetic is measured against", () => {
    expect(FIXTURE_POOL["swsh10.5-027"]?.name).toBe("Pikachu");
    expect(FIXTURE_POOL["swsh10.5-027"]?.types).toEqual(["Lightning"]); // the Weakness the fold doubles into
    expect(FIXTURE_POOL["swsh10.5-027"]?.stage).toBe("Basic");
    expect(FIXTURE_POOL["swsh10.5-027"]?.evolveFrom).toBeNull();
    expect(FIXTURE_POOL["swsh10.5-027"]?.hp).toBe(60);
    expect(FIXTURE_POOL["swsh10.5-027"]?.retreat).toBe(1);
    expect(FIXTURE_POOL["swsh10.5-027"]?.weaknesses).toEqual([{ type: "Fighting", value: "×2" }]);
    expect(FIXTURE_POOL["swsh10.5-027"]?.resistances).toBeNull();
  });

  it("pins the BYTES — and this row is PURE ASCII, unlike every clause before it", () => {
    // 96 code points, 96 UTF-8 bytes. The invariant the predecessor suites carry
    // is `bytes = codePoints + count("Pokémon")`; this sentence never says
    // "Pokémon", so for the first time in the family the two numbers are EQUAL.
    expect(BUDDY_BOLT.length).toBe(96);
    expect(utf8Bytes(BUDDY_BOLT)).toBe(96);
    expect(BUDDY_BOLT).not.toContain("Pokémon");
    // Every code point below 128 — asserted directly rather than inferred from
    // the byte count, so the claim is about the characters and not the total.
    for (const ch of BUDDY_BOLT) expect(ch.codePointAt(0)).toBeLessThan(128);
    expect(BUDDY_BOLT).not.toContain("é");
    // No apostrophe of EITHER kind, so the anchor never has to pick — the pool's
    // "your opponent's" clauses carry the ASCII one and this row carries neither.
    expect(BUDDY_BOLT).not.toContain("'"); // U+0027
    expect(BUDDY_BOLT).not.toContain("’"); // U+2019
    // The near-miss COMPANION proves the ASCII claim is about THIS string rather
    // than the module being clean by accident: Crobat's sentence carries a real
    // ASCII apostrophe in "Janine's".
    expect(SHADOWY_ENVOY).toContain("Janine's");
    expect(utf8Bytes(SHADOWY_ENVOY)).toBe(SHADOWY_ENVOY.length);
  });
});

describe("deriveAttackDamageBonus — the clause resolves to the new member", () => {
  it("maps Buddy Bolt onto youPlayedSupporterThisTurn at the printed 30", () => {
    expect(deriveAttackDamageBonus(BUDDY_BOLT)).toEqual({
      per: 30,
      count: { kind: "boardCondition", cond: { kind: "youPlayedSupporterThisTurn" } },
    });
  });

  it("takes N FROM THE SENTENCE, not from the card", () => {
    for (const per of [10, 50, 120]) {
      expect(deriveAttackDamageBonus(supporterClause(per))).toEqual({
        per,
        count: { kind: "boardCondition", cond: { kind: "youPlayedSupporterThisTurn" } },
      });
    }
    // A printed 0 adds nothing — the guard every arm in this family carries, so
    // it stays LOUD rather than deriving a no-op bonus.
    expect(deriveAttackDamageBonus(supporterClause(0))).toBeNull();
  });

  it("is a BARE TAG — the member carries no parameter to get wrong", () => {
    const bonus = deriveAttackDamageBonus(BUDDY_BOLT);
    expect(bonus?.count.kind).toBe("boardCondition");
    if (bonus?.count.kind !== "boardCondition") throw new Error("unreachable");
    expect(Object.keys(bonus.count.cond)).toEqual(["kind"]);
  });
});

describe("the near-misses stay LOUD", () => {
  it("refuses the REAL Ability that is the pool's only other `you played`", () => {
    expect(SHADOWY_ENVOY).toContain("you played");
    expect(BUDDY_BOLT).toContain("you played");
    // …and the three things that separate them, each named.
    expect(SHADOWY_ENVOY).toContain("Janine's Secret Art"); // a NAMED card, not the class
    expect(SHADOWY_ENVOY).toContain("from your hand this turn"); // no "during"
    expect(SHADOWY_ENVOY.startsWith("Once during your turn,")).toBe(true); // an ABILITY
    expect(deriveAttackDamageBonus(SHADOWY_ENVOY)).toBeNull();
    expect(deriveAttackDamageMultiplier(SHADOWY_ENVOY)).toBeNull();
    expect(deriveAttackEffect(SHADOWY_ENVOY)).toBeNull();
  });

  it("refuses CONSTRUCTED rewrites of the clause — the Map key is char-for-char", () => {
    for (const clause of [
      // The other two Trainer classes. Both are real card classes the game
      // prints, and neither is what §7.2's cap tracks.
      "you played an Item card from your hand during this turn",
      "you played a Stadium card from your hand during this turn",
      // The CROSS-BOARD rewrite. The pool does not print it, and if it ever does
      // it is a different member reading the other seat's turn — not this row.
      "your opponent played a Supporter card from your hand during this turn",
      "your opponent played a Supporter card from their hand during this turn",
      // The possessive moved — "their hand" is the cross-board half.
      "you played a Supporter card from their hand during this turn",
      // Crobat's timing wording: "this turn" WITHOUT the "during".
      "you played a Supporter card from your hand this turn",
      // Plural, which would be a different question entirely (§7.2 caps it at 1,
      // so the plural can only ever be false).
      "you played Supporter cards from your hand during this turn",
      // A Supporter by NAME — `yourBenchHasNamed`'s open-vocabulary trap on a
      // different noun, and the shape Crobat's real sentence takes.
      "you played Nemona from your hand during this turn",
      // Tense: "play" is a permission, "played" is a fact about the past.
      "you play a Supporter card from your hand during this turn",
      // The zone dropped — a Supporter can only be played from hand, but the
      // key is the printed sentence and the printed sentence says so.
      "you played a Supporter card during this turn",
    ]) {
      expect(deriveAttackDamageBonus(`If ${clause}, this attack does 30 more damage.`)).toBeNull();
    }
  });

  it("keeps the outer anchor guards on this sentence too", () => {
    for (const text of [
      // Lowercase leading "if" — the matcher has no /i.
      "if you played a Supporter card from your hand during this turn, this attack does 30 more damage.",
      // No trailing period is not the whole sentence.
      "If you played a Supporter card from your hand during this turn, this attack does 30 more damage",
      // A real trailing clause pins `$`.
      "If you played a Supporter card from your hand during this turn, this attack does 30 more damage. Then, draw a card.",
      // Leading text pins `^`.
      "Flip a coin. If you played a Supporter card from your hand during this turn, this attack does 30 more damage.",
      // The "×"/multiply twin, which `deriveAttackDamageMultiplier` owns.
      "If you played a Supporter card from your hand during this turn, this attack does 30 damage.",
    ]) {
      expect(deriveAttackDamageBonus(text)).toBeNull();
    }
  });
});

describe("deriver disjointness", () => {
  it("keeps Buddy Bolt off the other two derivers", () => {
    expect(deriveAttackEffect(BUDDY_BOLT)).toBeNull();
    expect(deriveAttackDamageMultiplier(BUDDY_BOLT)).toBeNull();
  });
});

describe("ZERO registry rows — the card derives straight off its printed text", () => {
  it("has no program of any kind for swsh10.5-027", () => {
    expect(programFor("swsh10.5-027")).toBeUndefined();
    expect(programFor("swsh10.5-027")?.attack).toBeUndefined();
    expect(programFor("swsh10.5-027")?.passive).toBeUndefined();
  });

  it("keeps NEMONA authored, which is what makes the board cases real", () => {
    // The clause is unauthored; the Supporter that arms it is not — and it has
    // to be, because `playTrainer` refuses an unauthored Trainer outright
    // (TRAINER_NOT_SIMULATED) and the flag is written by that path alone.
    expect(programFor("sv01-180")?.trainer).toEqual([{ op: "drawCards", count: 3 }]);
    expect(FIXTURE_POOL["sv01-180"]?.trainerType).toBe("Supporter");
  });
});

describe("the board — Buddy Bolt through a real attack", () => {
  it("scores the printed 30 with NO Supporter played (the control)", () => {
    const state = pikachu(board(11), "p1");
    expect(state.allowances.supporterPlayed).toBe(false);
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: BUDDY_BOLT_INDEX });
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(30);
    // The clause RESOLVED — a false condition is not a skipped effect.
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("scores 60 once a REAL playTrainer has landed the Supporter", () => {
    // Played through the real §7.2 path, not surgery — the TRAINER_PLAYED row is
    // the proof, and `playTrainer` is the only writer of the flag the clause
    // then reads.
    const withCard = handFromDeck(pikachu(board(11), "p1"), "p1", "sv01-180", 1);
    const played = mustApply(withCard, {
      type: "playTrainer",
      seat: "p1",
      uid: handUid(withCard, "p1", "sv01-180"),
    });
    expect(types(played.events)).toContain("TRAINER_PLAYED");
    expect(played.state.allowances.supporterPlayed).toBe(true);
    const { events } = mustApply(played.state, {
      type: "attack",
      seat: "p1",
      index: BUDDY_BOLT_INDEX,
    });
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(60);
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("is TURN-SCOPED — a Supporter played LAST turn arms nothing this turn", () => {
    // The assertion that matters: the flag's lifetime is the turn, and nothing
    // in this slice had to build that lifetime — `freshAllowances()` on
    // startTurn already owns it.
    const armed = playNemona(pikachu(board(11), "p1"), "p1");
    expect(armed.allowances.supporterPlayed).toBe(true);
    const backAround = mustApply(mustApply(armed, { type: "endTurn", seat: "p1" }).state, {
      type: "endTurn",
      seat: "p2",
    }).state;
    expect(backAround.allowances.supporterPlayed).toBe(false);
    expect(backAround.players.p1.active?.energy).toHaveLength(3); // the body survived the round trip
    const { events } = mustApply(backAround, {
      type: "attack",
      seat: "p1",
      index: BUDDY_BOLT_INDEX,
    });
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(30);
  });

  it("reads YOUR turn — the OPPONENT's Supporter on THEIR turn arms nothing", () => {
    // P2 plays Nemona on P2's turn, then passes. The allowances bag is a single
    // record, so a fold that read it without the seat/turn guard — or a reset
    // that did not happen — would score P1's attack at 60.
    let state = pikachu(boardP2(11), "p1");
    state = playNemona(state, "p2");
    expect(state.allowances.supporterPlayed).toBe(true);
    state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: BUDDY_BOLT_INDEX });
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(30);
  });

  it("arms from EITHER seat — the member is seat-relative, not p1-relative", () => {
    for (const seat of ["p1", "p2"] as const) {
      const opened = seat === "p1" ? board(11) : boardP2(11);
      const bare = pikachu(opened, seat);
      expect(
        find(
          mustApply(bare, { type: "attack", seat, index: BUDDY_BOLT_INDEX }).events,
          "DAMAGE_DEALT",
        )?.dealt,
      ).toBe(30);
      const armed = playNemona(bare, seat);
      expect(
        find(
          mustApply(armed, { type: "attack", seat, index: BUDDY_BOLT_INDEX }).events,
          "DAMAGE_DEALT",
        )?.dealt,
      ).toBe(60);
    }
  });

  it("folds BEFORE Weakness (§8.5) — (30 + 30) × 2 = 120", () => {
    // fix-lightning-weak is 130 HP and ×2 Lightning, so BOTH numbers land
    // without a KO — which matters here more than in the predecessor suites,
    // because a ko:* park is exactly where this member's seat guard flips.
    const opened = setActiveFromDeck(board(11), "p2", "fix-lightning-weak");
    const control = pikachu(opened, "p1");
    expect(
      find(
        mustApply(control, { type: "attack", seat: "p1", index: BUDDY_BOLT_INDEX }).events,
        "DAMAGE_DEALT",
      )?.dealt,
    ).toBe(60);
    const armed = playNemona(control, "p1");
    expect(
      find(
        mustApply(armed, { type: "attack", seat: "p1", index: BUDDY_BOLT_INDEX }).events,
        "DAMAGE_DEALT",
      )?.dealt,
    ).toBe(120);
  });
});

describe("conditionHolds / conditionNote — the member read directly", () => {
  it("is false before the Supporter and true after, on both seats", () => {
    for (const seat of ["p1", "p2"] as const) {
      const bare = pikachu(seat === "p1" ? board(11) : boardP2(11), seat);
      expect(conditionHolds(bare, seat, COND)).toBe(false);
      expect(conditionHolds(bare, other(seat), COND)).toBe(false);
      const armed = playNemona(bare, seat);
      expect(conditionHolds(armed, seat, COND)).toBe(true);
    }
  });

  it("GUARDS THE SEAT — the non-owner reads FALSE off the very same bag", () => {
    // THE POINT OF THE SLICE. `state.allowances` is one bag describing the TURN
    // OWNER, and `conditionHolds` is asked for a seat. On this state the flag is
    // true and the turn is p1's, so an unguarded read would answer TRUE for p2 —
    // "your opponent played a Supporter" reported as "you played a Supporter".
    const armed = playNemona(pikachu(board(11), "p1"), "p1");
    expect(armed.allowances.supporterPlayed).toBe(true);
    expect(armed.phase).toEqual({ kind: "turn:action", seat: "p1" });
    expect(conditionHolds(armed, "p1", COND)).toBe(true);
    expect(conditionHolds(armed, "p2", COND)).toBe(false);
  });

  it("is FALSE for BOTH seats on a checkup-origin ko:* park (activeSeat null)", () => {
    // Between turns nobody owns one, so "during this turn" has no turn to be
    // during. A checkup-origin park is the case phaseView.ts's header calls out:
    // the tail has already drained (only startTurn is left queued), so turn
    // PARITY would name the just-ended seat and answer TRUE for them.
    const armed = playNemona(pikachu(board(11), "p1"), "p1");
    const parked: GameState = {
      ...armed,
      phase: { kind: "ko:takePrizes", seat: "p1", count: 1 },
      pending: [{ kind: "startTurn", seat: "p2" }],
    };
    expect(parked.allowances.supporterPlayed).toBe(true);
    expect(conditionHolds(parked, "p1", COND)).toBe(false);
    expect(conditionHolds(parked, "p2", COND)).toBe(false);
    // …and the ATTACK-origin park, where a turn IS in progress, still answers
    // for its owner — so the guard is reading ownership, not merely refusing
    // every ko:* phase.
    const midAttack: GameState = {
      ...parked,
      pending: [
        { kind: "endTurn", seat: "p1" },
        { kind: "startTurn", seat: "p2" },
      ],
    };
    expect(conditionHolds(midAttack, "p1", COND)).toBe(true);
    expect(conditionHolds(midAttack, "p2", COND)).toBe(false);
  });

  it("is FALSE in every setup phase and after gameOver — no turn to be during", () => {
    const armed = playNemona(pikachu(board(11), "p1"), "p1");
    for (const phase of [
      { kind: "setup:place", ready: { p1: false, p2: false } },
      { kind: "gameOver", outcome: { result: "win", winner: "p1", reason: "prizesTaken" } },
    ] as const) {
      const state: GameState = { ...armed, phase };
      expect(conditionHolds(state, "p1", COND)).toBe(false);
      expect(conditionHolds(state, "p2", COND)).toBe(false);
    }
  });

  it("prints the clause VERBATIM — the family's first full round-trip", () => {
    expect(conditionNote(COND)).toBe("you played a Supporter card from your hand during this turn");
    // Nothing dropped and nothing swapped: no pronoun to resolve (the printed
    // subject is already "you"), no timing word to strip, no card-face glyph.
    expect(BUDDY_BOLT).toContain(conditionNote(COND));
  });
});

describe("purity", () => {
  it("mutates nothing when the condition is read on a frozen board", () => {
    const bare = deepFreeze(pikachu(board(11), "p1"));
    expect(conditionHolds(bare, "p1", COND)).toBe(false);
    expect(conditionHolds(bare, "p2", COND)).toBe(false);
    const armed = deepFreeze(playNemona(pikachu(board(11), "p1"), "p1"));
    expect(conditionHolds(armed, "p1", COND)).toBe(true);
    expect(conditionHolds(armed, "p2", COND)).toBe(false);
  });
});
