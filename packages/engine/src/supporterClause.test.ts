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

const BUDDY_BOLT =
  "If you played a Supporter card from your hand during this turn, this attack does 30 more damage.";

const SHADOWY_ENVOY =
  "Once during your turn, if you played Janine's Secret Art from your hand this turn, you may draw cards until you have 8 cards in your hand.";

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

function supporterClause(per = 80): string {
  return `If you played a Supporter card from your hand during this turn, this attack does ${per} more damage.`;
}

function board(seed: number): GameState {
  const state = driveSetup(
    seed,
    { p1: SUPPORTER_CLAUSE_DECK, p2: SUPPORTER_CLAUSE_DECK },
    { first: "p2", active: { p1: "fix-bigbody", p2: "fix-bigbody" } },
  );
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

function boardP2(seed: number): GameState {
  return mustApply(board(seed), { type: "endTurn", seat: "p1" }).state;
}

function pikachu(state: GameState, seat: Seat): GameState {
  const placed = setActiveFromDeck(state, seat, "swsh10.5-027");
  return attachFromDeck(
    attachFromDeck(placed, seat, "fix-lightning-energy", 1),
    seat,
    "fix-energy",
    2,
  );
}

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
    expect(BUDDY_BOLT).not.toContain("'"); // U+0027
    expect(BUDDY_BOLT).not.toContain("’");
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
    const armed = playNemona(pikachu(board(11), "p1"), "p1");
    expect(armed.allowances.supporterPlayed).toBe(true);
    expect(armed.phase).toEqual({ kind: "turn:action", seat: "p1" });
    expect(conditionHolds(armed, "p1", COND)).toBe(true);
    expect(conditionHolds(armed, "p2", COND)).toBe(false);
  });

  it("is FALSE for BOTH seats on a checkup-origin ko:* park (activeSeat null)", () => {
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
