import { describe, expect, it } from "vitest";
import {
  conditionHolds,
  conditionNote,
  deriveAttackDamageBonus,
  deriveAttackDamageMultiplier,
  deriveAttackEffect,
  programFor,
} from "./index";
import type { BoardCondition, GameState, Seat } from "./index";
import {
  FIXTURE_POOL,
  PUBLIC_COUNT_DECK,
  attachFromDeck,
  benchFromDeck,
  deepFreeze,
  driveSetup,
  mustApply,
  setActiveFromDeck,
  setDamage,
  types,
  findEvent,
} from "./testFixtures";

const CURSED_SLUG =
  "If your opponent has 3 or fewer cards in their hand, this attack does 120 more damage.";
const EXTRASENSORY =
  "If you have the same number of cards in your hand as your opponent, this attack does 90 more damage.";
const PAYBACK =
  "If your opponent has exactly 1 Prize card remaining, this attack does 90 more damage.";
const TWO_FOUROCIOUS =
  "If your opponent has exactly 2 or 4 Prize cards remaining, this attack does 120 more damage.";

const FUTURE_SIGHT =
  "Look at the top 3 cards of either player's deck and put them back in any order.";
const ORACLE_PRESS =
  "During your opponent's next turn, prevent all effects of attacks used by your opponent's Pokémon done to this Pokémon. (Damage is not an effect.)";

const CLAUSES = [CURSED_SLUG, EXTRASENSORY, PAYBACK, TWO_FOUROCIOUS];

const CARD_IDS = ["sv03-135", "sv03-214", "sv03-145", "sv01-116", "sv03-101"] as const;

function utf8Bytes(text: string): number {
  let bytes = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    bytes += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return bytes;
}

function board(seed: number): GameState {
  let state = driveSetup(
    seed,
    { p1: PUBLIC_COUNT_DECK, p2: PUBLIC_COUNT_DECK },
    { first: "p2", extraDraw: { p1: 0, p2: 0 } },
  );
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", "fix-bigbody");
  state = setActiveFromDeck(state, "p2", "fix-bigbody");
  return state;
}

function boardP2(seed: number): GameState {
  return mustApply(board(seed), { type: "endTurn", seat: "p1" }).state;
}

function pay(state: GameState, seat: Seat, spec: [string, number][]): GameState {
  let next = state;
  for (const [id, count] of spec) next = attachFromDeck(next, seat, id, count);
  return next;
}

function setHandSize(state: GameState, seat: Seat, size: number): GameState {
  const side = state.players[seat];
  if (size > side.hand.length) throw new Error(`${seat} hand is ${side.hand.length}, cannot grow`);
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: {
        ...side,
        hand: side.hand.slice(0, size),
        discard: [...side.discard, ...side.hand.slice(size)],
      },
    },
  };
}

function setPrizesRemaining(state: GameState, seat: Seat, count: number): GameState {
  const side = state.players[seat];
  if (count > side.prizes.length) throw new Error(`${seat} has ${side.prizes.length} Prizes`);
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: {
        ...side,
        prizes: side.prizes.slice(0, count),
        discard: [...side.discard, ...side.prizes.slice(count)],
      },
    },
  };
}

// ── The four casts, each fielded + paid symbol-for-symbol ────────────────────

/** Absol ex — {D}{D}{C} buys Cursed Slug at index 1; Future Sight's bare {D} at
    index 0 comes free with it. A Basic, and a 2-PRIZE body (the "… ex" suffix),
    which the organic Prize case below leans on. */
function absol(state: GameState, seat: Seat): GameState {
  return pay(setActiveFromDeck(state, seat, "sv03-135"), seat, [["fix-dark-energy", 3]]);
}

/** Bronzong — {M}{M} buys Extrasensory at index 1 and covers Oracle Press's {M}
    at index 0. A Stage 1 (from Bronzor), always force-placed. */
function bronzong(state: GameState, seat: Seat): GameState {
  return pay(setActiveFromDeck(state, seat, "sv03-145"), seat, [["fix-metal-energy", 2]]);
}

/** Krokorok — {F}{F} buys BOTH its attacks: Payback (the clause) at index 0 and
    Corkscrew Punch (a flat 60, no effect key) at index 1, which is the swing that
    drives the organic Prize case. A Stage 1 from Sandile. */
function krokorok(state: GameState, seat: Seat): GameState {
  return pay(setActiveFromDeck(state, seat, "sv01-116"), seat, [["fix-fighting-energy", 2]]);
}

/** Houndstone — {P}{C}{C} buys Two Four-ocious at index 1; Rear Kick's {C}{C} at
    index 0 comes free with it. A Stage 1 from Greavard, and the §8.5 fold-order
    attacker (Psychic into fix-psychic-weak). */
function houndstone(state: GameState, seat: Seat): GameState {
  return pay(setActiveFromDeck(state, seat, "sv03-101"), seat, [["fix-psychic-energy", 3]]);
}

describe("the printed sentences — the fixture-text-verbatim guard", () => {
  it("matches FIXTURE_POOL char-for-char on all four printings", () => {
    expect(FIXTURE_POOL["sv03-135"]?.attacks?.[1]?.effect).toBe(CURSED_SLUG);
    expect(FIXTURE_POOL["sv03-145"]?.attacks?.[1]?.effect).toBe(EXTRASENSORY);
    expect(FIXTURE_POOL["sv01-116"]?.attacks?.[0]?.effect).toBe(PAYBACK);
    expect(FIXTURE_POOL["sv03-101"]?.attacks?.[1]?.effect).toBe(TWO_FOUROCIOUS);
    // The printed "+" markers — what tells the pipeline a scaling clause is
    // expected at all — and the printed BASE the fold starts from.
    expect(FIXTURE_POOL["sv03-135"]?.attacks?.[1]?.damage).toBe("100+");
    expect(FIXTURE_POOL["sv03-145"]?.attacks?.[1]?.damage).toBe("70+");
    expect(FIXTURE_POOL["sv01-116"]?.attacks?.[0]?.damage).toBe("30+");
    expect(FIXTURE_POOL["sv03-101"]?.attacks?.[1]?.damage).toBe("80+");
    expect(FIXTURE_POOL["sv03-135"]?.attacks?.[1]?.name).toBe("Cursed Slug");
    expect(FIXTURE_POOL["sv03-145"]?.attacks?.[1]?.name).toBe("Extrasensory");
    expect(FIXTURE_POOL["sv01-116"]?.attacks?.[0]?.name).toBe("Payback");
    expect(FIXTURE_POOL["sv03-101"]?.attacks?.[1]?.name).toBe("Two Four-ocious");
  });

  it("matches the companion rows too — two loud sentences and two empty ones", () => {
    expect(FIXTURE_POOL["sv03-135"]?.attacks?.[0]?.effect).toBe(FUTURE_SIGHT);
    expect(FIXTURE_POOL["sv03-145"]?.attacks?.[0]?.effect).toBe(ORACLE_PRESS);
    expect(FIXTURE_POOL["sv01-116"]?.attacks?.[1]?.effect).toBeUndefined();
    expect(FIXTURE_POOL["sv03-101"]?.attacks?.[0]?.effect).toBeUndefined();
    expect(FIXTURE_POOL["sv01-116"]?.attacks?.[1]?.name).toBe("Corkscrew Punch");
    expect(FIXTURE_POOL["sv03-101"]?.attacks?.[0]?.name).toBe("Rear Kick");
    // Flat printed damage, no "+": none of these is in this family at all. Future
    // Sight has no `damage` key either — a 0-damage deck peek.
    expect(FIXTURE_POOL["sv03-135"]?.attacks?.[0]?.damage).toBeUndefined();
    expect(FIXTURE_POOL["sv03-145"]?.attacks?.[0]?.damage).toBe(20);
    expect(FIXTURE_POOL["sv01-116"]?.attacks?.[1]?.damage).toBe(60);
    expect(FIXTURE_POOL["sv03-101"]?.attacks?.[0]?.damage).toBe(30);
  });

  it("keeps the fixture facts the damage arithmetic below is measured against", () => {
    // Every number in the board layer is (HP, type, Weakness) arithmetic off these
    // rows. Pinned here so a fixture edit that moves 400 to 280 fails with a
    // sentence about Weakness rather than with a bare numeric mismatch.
    expect(FIXTURE_POOL["sv03-135"]?.name).toBe("Absol ex"); // the suffix = 2 Prizes
    expect(FIXTURE_POOL["sv03-135"]?.hp).toBe(210);
    expect(FIXTURE_POOL["sv03-135"]?.stage).toBe("Basic"); // the cast's only Basic
    expect(FIXTURE_POOL["sv03-101"]?.types).toEqual(["Psychic"]); // the fold-order attacker
    expect(FIXTURE_POOL["sv03-145"]?.resistances).toEqual([{ type: "Grass", value: "-30" }]);
    expect(FIXTURE_POOL["sv01-116"]?.hp).toBe(100);
    // The §8.5 defender and the clean control, the two bodies every damage number
    // lands on.
    expect(FIXTURE_POOL["fix-psychic-weak"]?.weaknesses).toEqual([
      { type: "Psychic", value: "×2" },
    ]);
    expect(FIXTURE_POOL["fix-psychic-weak"]?.hp).toBe(200);
    expect(FIXTURE_POOL["fix-bigbody"]?.hp).toBe(200);
    expect(FIXTURE_POOL["fix-bigbody"]?.weaknesses).toBeNull();
    expect(FIXTURE_POOL["fix-bigbody"]?.attacks).toBeNull(); // why P2 swings a Krokorok
  });

  it("is PURE ASCII — the cluster's own byte invariant, checked programmatically", () => {
    const CURLY_APOSTROPHE = "’";
    for (const text of CLAUSES) {
      expect(text.normalize("NFC")).toBe(text);
      expect(text).not.toContain("'");
      expect(text).not.toContain(CURLY_APOSTROPHE);
      expect(text).not.toContain("Pok");
      expect(utf8Bytes(text)).toBe(text.length);
    }
    // …and the two COMPANION sentences prove the fixture file is not simply
    // ASCII-only by accident: Future Sight carries an ASCII apostrophe, Oracle
    // Press carries two precomposed U+00E9 and is two bytes over its length.
    expect(FUTURE_SIGHT).toContain("player's");
    expect(utf8Bytes(FUTURE_SIGHT)).toBe(FUTURE_SIGHT.length);
    expect(ORACLE_PRESS.split("Pokémon").length - 1).toBe(2);
    expect(utf8Bytes(ORACLE_PRESS)).toBe(ORACLE_PRESS.length + 2);
  });

  it("pins each clause's length", () => {
    expect(CURSED_SLUG.length).toBe(86);
    expect(EXTRASENSORY.length).toBe(100);
    expect(PAYBACK.length).toBe(85);
    expect(TWO_FOUROCIOUS.length).toBe(92);
    // The pair that shares a member differs by exactly the printed list, its
    // plural "s" and the amount — the seven characters that are the whole
    // argument for a parameter.
    expect(TWO_FOUROCIOUS.length - PAYBACK.length).toBe(7);
  });
});

describe("deriveAttackDamageBonus — the PUBLIC-COUNT clauses", () => {
  it("reads the two PRIZE printings as ONE member at two values", () => {
    expect(deriveAttackDamageBonus(PAYBACK)).toEqual({
      per: 90,
      count: { kind: "boardCondition", cond: { kind: "opponentPrizesRemaining", counts: [1] } },
    });
    expect(deriveAttackDamageBonus(TWO_FOUROCIOUS)).toEqual({
      per: 120,
      count: { kind: "boardCondition", cond: { kind: "opponentPrizesRemaining", counts: [2, 4] } },
    });
  });

  it("reads the two HAND printings as two DIFFERENT members", () => {
    expect(deriveAttackDamageBonus(CURSED_SLUG)).toEqual({
      per: 120,
      count: { kind: "boardCondition", cond: { kind: "opponentHandAtMost", count: 3 } },
    });
    expect(deriveAttackDamageBonus(EXTRASENSORY)).toEqual({
      per: 90,
      count: { kind: "boardCondition", cond: { kind: "handSizesEqual" } },
    });
  });

  it("takes N from the SENTENCE, and the counts from the clause", () => {
    const payback = deriveAttackDamageBonus(PAYBACK);
    const twoFour = deriveAttackDamageBonus(TWO_FOUROCIOUS);
    expect(payback?.per).toBe(90);
    expect(twoFour?.per).toBe(120);
    const paybackCond = payback?.count.kind === "boardCondition" ? payback.count.cond : null;
    const twoFourCond = twoFour?.count.kind === "boardCondition" ? twoFour.count.cond : null;
    expect(paybackCond?.kind).toBe(twoFourCond?.kind);
    // A LIST, in printed order, not a range and not a bound.
    expect(paybackCond).toMatchObject({ counts: [1] });
    expect(twoFourCond).toMatchObject({ counts: [2, 4] });
  });
});

describe("the near-misses that stay UNMAPPED (and therefore LOUD)", () => {
  it("refuses Bronzor sv03-144's 'Mirror Draw' — this card's clause, verbatim, inside a DRAW", () => {
    const mirrorDraw =
      "Draw cards until you have the same number of cards in your hand as your opponent.";
    expect(mirrorDraw).toContain("the same number of cards in your hand as your opponent");
    expect(deriveAttackDamageBonus(mirrorDraw)).toBeNull();
    expect(deriveAttackDamageMultiplier(mirrorDraw)).toBeNull();
    expect(deriveAttackEffect(mirrorDraw)).toBeNull();
  });

  it("refuses Slowbro swsh10.5-020 — Payback's clause in a USABILITY frame", () => {
    const twilight =
      "You can use this attack only if your opponent has exactly 1 Prize card remaining.";
    expect(twilight).toContain("your opponent has exactly 1 Prize card remaining");
    expect(deriveAttackDamageBonus(twilight)).toBeNull();
    expect(deriveAttackDamageMultiplier(twilight)).toBeNull();
  });

  it("refuses Slaking V swsh10.5-058/-077 — an OWN-seat, three-value list on an ABILITY", () => {
    const kindaLazy =
      "If you have exactly 2, 4, or 6 Prize cards remaining, this Pokémon can't attack.";
    expect(deriveAttackDamageBonus(kindaLazy)).toBeNull();
    expect(deriveAttackEffect(kindaLazy)).toBeNull();
    expect(conditionNote({ kind: "yourPrizesRemaining", counts: [2, 4, 6] })).toBe(
      "you have exactly 2, 4, or 6 Prize cards remaining",
    );
    expect(kindaLazy).toContain(
      `If ${conditionNote({ kind: "yourPrizesRemaining", counts: [2, 4, 6] })},`,
    );
  });

  it("refuses count VALUES the pool does not print — the literal table's whole point", () => {
    for (const clause of [
      "your opponent has exactly 3 Prize cards remaining",
      "your opponent has exactly 2, 4, or 6 Prize cards remaining",
      "your opponent has exactly 1 or 3 Prize cards remaining",
      "your opponent has 2 or fewer cards in their hand",
      "your opponent has 4 or fewer cards in their hand",
      "you have more cards in your hand than your opponent",
    ]) {
      expect(deriveAttackDamageBonus(`If ${clause}, this attack does 90 more damage.`)).toBeNull();
    }
  });

  it("refuses a plural that does not agree — the row carries the printed grammar", () => {
    expect(
      deriveAttackDamageBonus(
        "If your opponent has exactly 1 Prize cards remaining, this attack does 90 more damage.",
      ),
    ).toBeNull();
    expect(
      deriveAttackDamageBonus(
        "If your opponent has exactly 2 or 4 Prize card remaining, this attack does 120 more damage.",
      ),
    ).toBeNull();
  });

  it("holds the whole-sentence ANCHOR — case, period, both margins", () => {
    expect(deriveAttackDamageBonus(PAYBACK.replace("If", "if"))).toBeNull();
    expect(deriveAttackDamageBonus(PAYBACK.replace(/\.$/, ""))).toBeNull();
    expect(deriveAttackDamageBonus(`${PAYBACK} Then, discard an Energy.`)).toBeNull();
    expect(deriveAttackDamageBonus(`Flip a coin. ${PAYBACK}`)).toBeNull();
    // A printed 0 is refused by the `per >= 1` floor, as everywhere in the family.
    expect(
      deriveAttackDamageBonus(
        "If your opponent has 3 or fewer cards in their hand, this attack does 0 more damage.",
      ),
    ).toBeNull();
  });

  it("refuses the pool's other hand-count vocabulary — Xerosic's and the draw-to-N crowd", () => {
    // 20-odd rows print "cards in your hand" as a DRAW target and one prints it as
    // a discard target. None is a condition, and none may reach this path.
    for (const text of [
      "Your opponent discards cards from their hand until they have 3 cards in their hand.",
      "Draw cards until you have 7 cards in your hand.",
      "If you have no cards in your hand, this attack can be used for {W}.",
      "This attack does 30 damage for each card in your hand.",
    ]) {
      expect(deriveAttackDamageBonus(text)).toBeNull();
    }
  });
});

describe("the derivers stay disjoint, and stay INDEX-KEYED", () => {
  it("deriveAttackEffect and deriveAttackDamageMultiplier match none of the four", () => {
    for (const clause of CLAUSES) {
      expect(deriveAttackEffect(clause)).toBeNull();
      expect(deriveAttackDamageMultiplier(clause)).toBeNull();
    }
  });

  it("leaves both companion attacks unbuilt on EVERY path — the loud halves", () => {
    for (const text of [FUTURE_SIGHT, ORACLE_PRESS]) {
      expect(deriveAttackEffect(text)).toBeNull();
      expect(deriveAttackDamageBonus(text)).toBeNull();
      expect(deriveAttackDamageMultiplier(text)).toBeNull();
    }
  });
});

describe("ZERO registry rows — every damage number below is text", () => {
  it("gives none of the five ids an authored program at all", () => {
    for (const id of CARD_IDS) {
      expect(programFor(id)).toBeUndefined();
      expect(programFor(id)?.attack).toBeUndefined();
    }
    expect(CARD_IDS).toContain("sv03-214");
    expect(FIXTURE_POOL["sv03-214"]).toBeUndefined();
  });
});

describe("Absol ex 'Cursed Slug' — their hand, 3 or fewer", () => {
  it("with the opening seven in hand the printed 100 stands — and nothing is flagged", () => {
    const state = absol(board(1), "p1");
    expect(state.players.p2.hand.length).toBe(7);
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    const dealt = findEvent(events, "DAMAGE_DEALT");
    expect(dealt).toMatchObject({ base: 100, dealt: 100 });
    expect(dealt?.scaled).toBeUndefined(); // `scaled` is omitted at 0
  });

  it("is a threshold, not an equality: 4 → 100, 3 → 220, 0 → 220", () => {
    for (const [size, dealt] of [
      [4, 100],
      [3, 220],
      [0, 220],
    ] as const) {
      const state = absol(setHandSize(board(2 + size), "p2", size), "p1");
      const { events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
      expect(findEvent(events, "DAMAGE_DEALT")?.dealt).toBe(dealt);
    }
  });

  it("reads THEIR hand — the attacker's own hand at 0 scores nothing", () => {
    // The case that catches a member wired to `seat` instead of `otherSeat`. P1
    // empties its own hand and P2 keeps the opening seven.
    const state = absol(setHandSize(board(9), "p1", 0), "p1");
    expect(state.players.p1.hand.length).toBe(0);
    expect(state.players.p2.hand.length).toBe(7);
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    expect(findEvent(events, "DAMAGE_DEALT")?.dealt).toBe(100);
  });

  it("runs identically from the OTHER seat", () => {
    const state = absol(setHandSize(boardP2(10), "p1", 3), "p2");
    const { events } = mustApply(state, { type: "attack", seat: "p2", index: 1 });
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ base: 100, scaled: 120, dealt: 220 });
  });

  it("ARMED BY THE GAME: P2 plays its hand down to 3 and Cursed Slug reads it", () => {
    let state = driveSetup(
      2,
      { p1: PUBLIC_COUNT_DECK, p2: PUBLIC_COUNT_DECK },
      {
        first: "p2",
        extraDraw: { p1: 0, p2: 0 },
        active: { p1: "fix-bigbody", p2: "fix-bigbody" },
      },
    );
    // 7 dealt, 1 placed as the Active, 1 drawn opening the turn.
    expect(state.players.p2.hand.length).toBe(7);
    // Benched one at a time, by uid, from whatever the deal actually gave.
    while (state.players.p2.hand.length > 4 && state.players.p2.bench.length < 5) {
      const uid = state.players.p2.hand.find(
        (u) => FIXTURE_POOL[state.cardIdByUid[u] ?? ""]?.stage === "Basic",
      );
      if (uid === undefined) break;
      state = mustApply(state, { type: "playBasicToBench", seat: "p2", uid }).state;
    }
    expect(state.players.p2.hand.length).toBe(4);
    // …and the last card goes as the turn's one Energy attachment.
    const energyUid = state.players.p2.hand.find(
      (u) => FIXTURE_POOL[state.cardIdByUid[u] ?? ""]?.category === "Energy",
    );
    expect(energyUid).toBeDefined();
    state = mustApply(state, {
      type: "attachEnergy",
      seat: "p2",
      uid: energyUid ?? "",
      target: { spot: "active" },
    }).state;
    expect(state.players.p2.hand.length).toBe(3);
    state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
    // P1's turn 2 — its own draw does not touch the count the clause reads.
    const attacker = absol(state, "p1");
    expect(attacker.players.p2.hand.length).toBe(3);
    const { events } = mustApply(attacker, { type: "attack", seat: "p1", index: 1 });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ base: 100, scaled: 120, dealt: 220 });
  });
});

describe("Bronzong 'Extrasensory' — the two hands, equal", () => {
  it("is TRUE on the untouched board: the real setup deals both hands to seven", () => {
    // The cluster's one clause that needs no surgery to arm — both players drew
    // the same cards' worth, so the equality is the game's own doing.
    const state = bronzong(board(12), "p1");
    expect(state.players.p1.hand.length).toBe(7);
    expect(state.players.p2.hand.length).toBe(7);
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ base: 70, scaled: 90, dealt: 160 });
  });

  it("one card of difference turns it off — in EITHER direction", () => {
    for (const seat of ["p1", "p2"] as const) {
      const state = bronzong(setHandSize(board(13), seat, 6), "p1");
      const { events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
      const dealt = findEvent(events, "DAMAGE_DEALT");
      expect(dealt?.dealt).toBe(70);
      expect(dealt?.scaled).toBeUndefined();
    }
  });

  it("is an EQUALITY, not a number: 3 and 3 arm it just as 7 and 7 do", () => {
    let state = setHandSize(board(14), "p1", 3);
    state = bronzong(setHandSize(state, "p2", 3), "p1");
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    expect(findEvent(events, "DAMAGE_DEALT")?.dealt).toBe(160);
  });

  it("D372 — is the vocabulary's FIRST seat-symmetric member, and no longer its only one", () => {
    const equal = board(15);
    const uneven = setHandSize(equal, "p2", 5);
    for (const seat of ["p1", "p2"] as const) {
      expect(conditionHolds(equal, seat, { kind: "handSizesEqual" })).toBe(true);
      expect(conditionHolds(uneven, seat, { kind: "handSizesEqual" })).toBe(false);
    }
    // …and through a real attack from the far seat. P2's own draw opening turn 3
    // has already made the hands 8 and 7, so the equal board has to be restored —
    // which is itself the point: the clause reads a live count, not a setup fact.
    const state = bronzong(setHandSize(boardP2(15), "p2", 7), "p2");
    const { events } = mustApply(state, { type: "attack", seat: "p2", index: 1 });
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ base: 70, scaled: 90, dealt: 160 });
  });
});

describe("Krokorok 'Payback' — their Prizes, exactly 1", () => {
  it("at the dealt six the printed 30 stands", () => {
    const state = krokorok(board(16), "p1");
    expect(state.players.p2.prizes.length).toBe(6);
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    const dealt = findEvent(events, "DAMAGE_DEALT");
    expect(dealt).toMatchObject({ base: 30, dealt: 30 });
    expect(dealt?.scaled).toBeUndefined();
  });

  it("EXACTLY 1 — and 0 is just as false as 2", () => {
    // The single-valued list is still set membership. A "1 or fewer" reading would
    // pass the 1 case and quietly pay out at 0 as well; this is the case that
    // separates them.
    for (const [prizes, dealt] of [
      [2, 30],
      [1, 120],
      [0, 30],
    ] as const) {
      const state = krokorok(setPrizesRemaining(board(17 + prizes), "p2", prizes), "p1");
      const { events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
      expect(findEvent(events, "DAMAGE_DEALT")?.dealt).toBe(dealt);
    }
  });

  it("reads THEIR Prize row — the attacker's own at 1 scores nothing", () => {
    const state = krokorok(setPrizesRemaining(board(21), "p1", 1), "p1");
    expect(state.players.p1.prizes.length).toBe(1);
    expect(state.players.p2.prizes.length).toBe(6);
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(findEvent(events, "DAMAGE_DEALT")?.dealt).toBe(30);
  });

  it("runs identically from the OTHER seat", () => {
    const state = krokorok(setPrizesRemaining(boardP2(22), "p1", 1), "p2");
    const { events } = mustApply(state, { type: "attack", seat: "p2", index: 0 });
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ base: 30, scaled: 90, dealt: 120 });
  });
});

describe("Houndstone 'Two Four-ocious' — their Prizes, exactly 2 or 4", () => {
  it("pays at BOTH printed values and at neither neighbour — 3 is FALSE between them", () => {
    // "exactly 2 or 4" is set MEMBERSHIP, not the range 2..4. The 3 case is the one
    // that catches the confusion, and it sits between two paying values so a range
    // reading cannot pass it by accident.
    for (const [prizes, dealt] of [
      [6, 80],
      [5, 80],
      [4, 200],
      [3, 80],
      [2, 200],
      [1, 80],
    ] as const) {
      const state = houndstone(setPrizesRemaining(board(23 + prizes), "p2", prizes), "p1");
      const { events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
      expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
      expect(findEvent(events, "DAMAGE_DEALT")?.dealt).toBe(dealt);
    }
  });

  it("ARMED BY THE GAME: a two-Prize knockout moves their row from 6 to 4", () => {
    let state = board(30);
    state = setDamage(absol(state, "p1"), "p1", 160); // 210 HP, 50 left
    state = benchFromDeck(state, "p1", "sv03-101");
    state = mustApply(state, { type: "endTurn", seat: "p1" }).state;
    // P2 swings a Krokorok: Corkscrew Punch is a flat 60 into a body with no
    // Weakness and no Resistance to Fighting.
    state = krokorok(state, "p2");
    const ko = mustApply(state, { type: "attack", seat: "p2", index: 1 });
    expect(types(ko.events)).toContain("KNOCKED_OUT");
    state = ko.state;
    expect(state.phase).toMatchObject({ kind: "ko:takePrizes", seat: "p2", count: 2 });
    state = mustApply(state, { type: "takePrizes", seat: "p2", prizeIndices: [0, 1] }).state;
    expect(state.players.p2.prizes.length).toBe(4);
    // P1 promotes the benched Houndstone into the empty Active Spot.
    const benchIndex = state.players.p1.bench.findIndex(
      (p) => state.cardIdByUid[p.stack[0] ?? ""] === "sv03-101",
    );
    expect(benchIndex).toBeGreaterThanOrEqual(0);
    // Promoting closes the knockout, and P2's turn ended with its attack — so the
    // board hands straight back to P1 with the new Prize count already standing.
    state = mustApply(state, { type: "promote", seat: "p1", benchIndex }).state;
    expect(state.phase).toMatchObject({ kind: "turn:action", seat: "p1" });
    state = pay(state, "p1", [["fix-psychic-energy", 3]]);
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ base: 80, scaled: 120, dealt: 200 });
  });
});

describe("the fold order — the bonus lands BEFORE §8.5 Weakness", () => {
  it("doubles (base + scaled), not base alone: (80 + 120) × 2 = 400", () => {
    let state = setActiveFromDeck(board(40), "p2", "fix-psychic-weak");
    state = houndstone(setPrizesRemaining(state, "p2", 2), "p1");
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({
      base: 80,
      scaled: 120,
      weakness: { op: "multiply", amount: 2 },
      resistance: null,
      dealt: 400,
    });
  });

  it("and the un-bonused control on the same matchup: 80 × 2 = 160", () => {
    const state = houndstone(setActiveFromDeck(board(41), "p2", "fix-psychic-weak"), "p1");
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    const dealt = findEvent(events, "DAMAGE_DEALT");
    expect(dealt).toMatchObject({ base: 80, weakness: { op: "multiply", amount: 2 }, dealt: 160 });
    expect(dealt?.scaled).toBeUndefined();
    // 160 through a 200 HP body leaves it alive, which the armed 400 does not.
    expect(types(events)).not.toContain("KNOCKED_OUT");
  });
});

describe("ATTACK_EFFECT_SKIPPED — never on the clause, ALWAYS on the unbuilt sibling", () => {
  it("simulates the sentence whether or not the clause holds, on all four cards", () => {
    const cases: { build: (seed: number) => GameState; index: number; arm: boolean }[] = [
      { build: (s) => absol(board(s), "p1"), index: 1, arm: false },
      { build: (s) => absol(setHandSize(board(s), "p2", 2), "p1"), index: 1, arm: true },
      { build: (s) => bronzong(setHandSize(board(s), "p2", 6), "p1"), index: 1, arm: false },
      { build: (s) => bronzong(board(s), "p1"), index: 1, arm: true },
      { build: (s) => krokorok(board(s), "p1"), index: 0, arm: false },
      { build: (s) => krokorok(setPrizesRemaining(board(s), "p2", 1), "p1"), index: 0, arm: true },
      { build: (s) => houndstone(board(s), "p1"), index: 1, arm: false },
      {
        build: (s) => houndstone(setPrizesRemaining(board(s), "p2", 4), "p1"),
        index: 1,
        arm: true,
      },
    ];
    for (const [i, { build, index, arm }] of cases.entries()) {
      const { events } = mustApply(build(50 + i), { type: "attack", seat: "p1", index });
      expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
      // And the two boards really are different boards — `scaled` present exactly
      // when the clause held, which is what makes the shared flag meaningful.
      expect(findEvent(events, "DAMAGE_DEALT")?.scaled !== undefined).toBe(arm);
    }
  });

  it("still fires on Absol ex's OTHER attack — one card, one loud index and one silent", () => {
    const state = absol(board(60), "p1");
    const loud = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(types(loud.events)).toContain("ATTACK_EFFECT_SKIPPED");
    const quiet = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    expect(types(quiet.events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });
});

describe("conditionHolds / conditionNote — the three members, directly", () => {
  it("reads the OPPONENT's counts, per seat, on both Prize shapes", () => {
    const state = setPrizesRemaining(setPrizesRemaining(board(61), "p1", 4), "p2", 1);
    const one: BoardCondition = { kind: "opponentPrizesRemaining", counts: [1] };
    const twoFour: BoardCondition = { kind: "opponentPrizesRemaining", counts: [2, 4] };
    expect(conditionHolds(state, "p1", one)).toBe(true); // p2 has 1
    expect(conditionHolds(state, "p2", one)).toBe(false); // p1 has 4
    expect(conditionHolds(state, "p1", twoFour)).toBe(false);
    expect(conditionHolds(state, "p2", twoFour)).toBe(true);
    // Membership over the whole range, from one seat, in one sweep.
    for (let n = 0; n <= 6; n++) {
      const shrunk = setPrizesRemaining(board(62), "p2", n);
      expect(conditionHolds(shrunk, "p1", twoFour)).toBe(n === 2 || n === 4);
      expect(conditionHolds(shrunk, "p1", one)).toBe(n === 1);
    }
  });

  it("reads hand SIZES — the threshold cross-board, the equality both ways", () => {
    const atMost: BoardCondition = { kind: "opponentHandAtMost", count: 3 };
    for (let n = 0; n <= 7; n++) {
      const state = setHandSize(board(63), "p2", n);
      expect(conditionHolds(state, "p1", atMost)).toBe(n <= 3);
      // p1's own hand is untouched at 7, so the far seat reads false throughout —
      // the asymmetry, swept rather than sampled.
      expect(conditionHolds(state, "p2", atMost)).toBe(false);
      expect(conditionHolds(state, "p1", { kind: "handSizesEqual" })).toBe(n === 7);
    }
  });

  it("needs no Pokémon at all — the first members that read no Active", () => {
    const state = board(64);
    const bare: GameState = {
      ...state,
      players: {
        p1: { ...state.players.p1, active: null, bench: [] },
        p2: { ...state.players.p2, active: null, bench: [] },
      },
    };
    expect(conditionHolds(bare, "p1", { kind: "handSizesEqual" })).toBe(true);
    expect(conditionHolds(bare, "p1", { kind: "opponentHandAtMost", count: 3 })).toBe(false);
    expect(conditionHolds(bare, "p1", { kind: "opponentPrizesRemaining", counts: [6] })).toBe(true);
  });

  it("ROUND-TRIPS to the printed clause — these four notes need nothing dropped", () => {
    expect(conditionNote({ kind: "opponentPrizesRemaining", counts: [1] })).toBe(
      "your opponent has exactly 1 Prize card remaining",
    );
    expect(conditionNote({ kind: "opponentPrizesRemaining", counts: [2, 4] })).toBe(
      "your opponent has exactly 2 or 4 Prize cards remaining",
    );
    expect(conditionNote({ kind: "opponentHandAtMost", count: 3 })).toBe(
      "your opponent has 3 or fewer cards in their hand",
    );
    expect(conditionNote({ kind: "handSizesEqual" })).toBe(
      "you have the same number of cards in your hand as your opponent",
    );
    // …and each of those is exactly the text the clause table is keyed on.
    for (const clause of CLAUSES) {
      const bonus = deriveAttackDamageBonus(clause);
      const cond = bonus?.count.kind === "boardCondition" ? bonus.count.cond : null;
      expect(cond).not.toBeNull();
      expect(clause).toContain(`If ${conditionNote(cond ?? { kind: "handSizesEqual" })},`);
    }
  });

  it("spells a three-value list the way the pool prints one", () => {
    expect(conditionNote({ kind: "yourPrizesRemaining", counts: [2, 4, 6] })).toBe(
      "you have exactly 2, 4, or 6 Prize cards remaining",
    );
    expect(conditionNote({ kind: "yourPrizesRemaining", counts: [3] })).toBe(
      "you have exactly 3 Prize cards remaining",
    );
    expect(conditionNote({ kind: "opponentPrizesRemaining", counts: [2, 4, 6] })).toBe(
      "your opponent has exactly 2, 4, or 6 Prize cards remaining",
    );
    // The singular is tied to the VALUE, not to the arity: a one-element list at
    // any other count still reads "cards".
    expect(conditionNote({ kind: "opponentPrizesRemaining", counts: [3] })).toBe(
      "your opponent has exactly 3 Prize cards remaining",
    );
    expect(conditionNote({ kind: "opponentHandAtMost", count: 1 })).toBe(
      "your opponent has 1 or fewer cards in their hand",
    );
  });
});

describe("the cluster is PURE — a frozen board is never mutated", () => {
  it("resolves all four clauses, TRUE and FALSE, off a deep-frozen state", () => {
    const frozen = deepFreeze(setPrizesRemaining(setHandSize(board(70), "p2", 3), "p2", 4));
    const conds: BoardCondition[] = [
      { kind: "opponentHandAtMost", count: 3 },
      { kind: "handSizesEqual" },
      { kind: "opponentPrizesRemaining", counts: [1] },
      { kind: "opponentPrizesRemaining", counts: [2, 4] },
    ];
    expect(conds.map((c) => conditionHolds(frozen, "p1", c))).toEqual([true, false, false, true]);
    // The same reads a second time, unchanged — nothing was memoised into state.
    expect(conds.map((c) => conditionHolds(frozen, "p1", c))).toEqual([true, false, false, true]);
    expect(frozen.players.p2.prizes.length).toBe(4);
    expect(frozen.players.p2.hand.length).toBe(3);
  });

  it("runs a whole armed attack off a frozen board", () => {
    const frozen = deepFreeze(houndstone(setPrizesRemaining(board(71), "p2", 2), "p1"));
    const { events } = mustApply(frozen, { type: "attack", seat: "p1", index: 1 });
    expect(findEvent(events, "DAMAGE_DEALT")?.dealt).toBe(200);
    expect(frozen.players.p2.active?.damage).toBe(0);
  });
});
