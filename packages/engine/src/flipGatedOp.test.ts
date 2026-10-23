import { describe, expect, it } from "vitest";
import { deriveAttackCoinFlip, deriveAttackEffect, programFor } from "./index";
import { deriveAttackCopy } from "./effects";
import type { CoinFace, GameEvent, GameState, Seat } from "./index";
import {
  FIXTURE_POOL,
  FLIP_GATED_OP_DECK,
  attachFromDeck,
  clearBench,
  deepFreeze,
  driveSetup,
  mustApply,
  setActiveFromDeck,
  setDamage,
  types,
  findEvent,
} from "./testFixtures";

const CLAUSES = [
  {
    text: "Flip a coin. If heads, heal 30 damage from this Pokémon.",
    // Fuecoco sv02-035 / -201 ("Spacing Out", no printed damage).
    printings: 2,
    inner: { op: "heal", target: "self", amount: 30 },
    bare: "Heal 30 damage from this Pokémon.",
  },
  {
    text: "Flip a coin. If heads, discard the top card of your opponent's deck.",
    // Wiglett sv01-056 ("Dig a Little", no printed damage).
    printings: 1,
    inner: { op: "discardDeckTop", whose: "opponent", count: 1 },
    bare: "Discard the top card of your opponent's deck.",
  },
] as const;

const REAL_NEAR_MISSES = [
  "Flip a coin. If heads, search your deck for a Pokémon and switch it with this Pokémon. Any attached cards, damage counters, Special Conditions, turns in play, and any other effects remain on the new Pokémon. If you switched a Pokémon in this way, put this card into your deck. Then, shuffle your deck.",
  "Flip a coin. If heads, choose 1 of your opponent's Active Pokémon's attacks and use it as this attack.",
  "Flip a coin. If heads, search your deck for up to 5 Grass Energy cards and attach them to your Pokémon in any way you like. Then, shuffle your deck.",
  "Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed.",
  "Flip a coin. If heads, discard an Energy from your opponent's Active Pokémon.",
  "Flip a coin. If heads, switch in 1 of your opponent's Benched Pokémon to the Active Spot.",
  "Flip a coin. If heads, this attack does 20 more damage.",
] as const;

const UNMAPPED_NEAR_MISSES = REAL_NEAR_MISSES.filter((_, i) => i === 2);

const NBSP = "\u00a0";

const RSQUO = "\u2019";

function all<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

/** The face the declaration's single flip came up. `undefined` would mean no flip was
    taken at all, which is a distinct failure from either face and is asserted as
    such wherever it matters. */
function face(events: GameEvent[]): CoinFace | undefined {
  return findEvent(events, "ATTACK_EFFECT_COIN_FLIP")?.result;
}

/** Both fixtures print the gated sentence FIRST and an effect-less control second.
    Named rather than inlined, so a re-ingest that reordered an attack fails on the
    fixture guards below rather than silently moving every case onto the wrong one. */
const SPACING_OUT_INDEX = 0;
const FLARE_INDEX = 1;
const DIG_A_LITTLE_INDEX = 0;
const RAM_INDEX = 1;

/** The gated amounts, and the two controls' printed damage. */
const SPACING_OUT_HEAL = 30;
const FLARE_DAMAGE = 30;
const DIG_A_LITTLE_MILL = 1;
const RAM_DAMAGE = 20;

const ATTACKER_HURT = 50;
/** LESS than the printed 30 — the clamped board, where heads lands at 0 and must not
    go negative. */
const ATTACKER_BARELY_HURT = 10;

const TURN_START_DRAW = 1;

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8] as const;

function board(seed: number): GameState {
  let state = driveSetup(seed, { p1: FLIP_GATED_OP_DECK, p2: FLIP_GATED_OP_DECK }, { first: "p2" });
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", "fix-titan");
  state = setActiveFromDeck(state, "p2", "fix-titan");
  return clearBench(clearBench(state, "p1"), "p2");
}

function fuecocoActive(state: GameState, seat: Seat, damage: number): GameState {
  const fielded = attachFromDeck(
    clearBench(setActiveFromDeck(state, seat, "sv02-035"), seat),
    seat,
    "fix-energy",
    1,
  );
  return setDamage(fielded, seat, damage);
}

function wiglettActive(state: GameState, seat: Seat): GameState {
  return attachFromDeck(
    clearBench(setActiveFromDeck(state, seat, "sv01-056"), seat),
    seat,
    "fix-energy",
    1,
  );
}

/** The uids named by the mill rows, in order — read off the EVENTS rather than
    recomputed from the deck, because an op that moved the right NUMBER of wrong cards
    is the failure this catches. */
function milledUids(events: GameEvent[]): string[] {
  return all(events, "DECK_TOP_DISCARDED").flatMap((e) => e.uids);
}

describe("the anchors — 3 printings, 2 clauses, two literal arms", () => {
  it("derives both clauses to a coinFlipGate over the BARE anchor's own program", () => {
    for (const { text, inner, bare } of CLAUSES) {
      const ops = deriveAttackEffect(text);
      expect(ops).toEqual([{ op: "coinFlipGate", then: [inner] }]);
      expect(deriveAttackEffect(text)?.[0]).toMatchObject({ then: deriveAttackEffect(bare) });
    }
    expect(CLAUSES).toHaveLength(2);
    expect(CLAUSES.reduce((n, c) => n + c.printings, 0)).toBe(3);
    // No two rows share a sentence — a duplicated `text` would make the loop above
    // pass while covering one clause.
    expect(new Set(CLAUSES.map((c) => c.text)).size).toBe(CLAUSES.length);
    for (const { text } of CLAUSES) {
      const ops = deriveAttackEffect(text);
      expect(ops).toHaveLength(1);
      expect(ops?.[0]).toMatchObject({ op: "coinFlipGate" });
    }
  });

  it("keeps the TWO ARMS genuinely separate — the consequents share no vocabulary", () => {
    const [heal, mill] = CLAUSES;
    const tailOf = (text: string) => text.slice("Flip a coin. If heads, ".length);
    expect(tailOf(heal.text)).not.toBe(tailOf(mill.text));
    const words = (text: string) => new Set(tailOf(text).replace(/[.,]/g, "").split(" "));
    const shared = [...words(heal.text)].filter((w) => words(mill.text).has(w));
    expect(shared).toEqual([]);
    // And the two gates wrap different ops, so no downstream code can treat them as
    // one shape either.
    expect(deriveAttackEffect(heal.text)).not.toEqual(deriveAttackEffect(mill.text));
  });

  it("refuses a printed ZERO heal — the guard every arm of this reader carries", () => {
    expect(
      deriveAttackEffect("Flip a coin. If heads, heal 0 damage from this Pokémon."),
    ).toBeNull();
    // No CEILING, by contrast: the interpreter clamps the heal to the damage present,
    // so a malformed large amount heals to full and stops — a legal board state.
    expect(deriveAttackEffect("Flip a coin. If heads, heal 999 damage from this Pokémon.")).toEqual(
      [{ op: "coinFlipGate", then: [{ op: "heal", target: "self", amount: 999 }] }],
    );
  });

  it("refuses the THREE unmapped catalog rows that share its prefix", () => {
    for (const text of UNMAPPED_NEAR_MISSES) {
      expect(deriveAttackEffect(text)).toBeNull();
    }
    expect(UNMAPPED_NEAR_MISSES).toHaveLength(REAL_NEAR_MISSES.length - 6);
    for (const text of UNMAPPED_NEAR_MISSES) {
      expect(deriveAttackCoinFlip(text)).toBeNull();
    }
    expect(deriveAttackEffect(REAL_NEAR_MISSES[1])).toBeNull();
    expect(deriveAttackCoinFlip(REAL_NEAR_MISSES[1])).toBeNull();
    expect(deriveAttackCopy(REAL_NEAR_MISSES[1])).toEqual({ from: "opponentActive", flip: true });
    expect(deriveAttackEffect(REAL_NEAR_MISSES[0])).toEqual([
      {
        op: "coinFlipGate",
        then: [{ op: "switchWithDeckChosen", filter: { kind: "anyPokemon" } }],
      },
    ]);
  });

  it("leaves the family's THREE OTHER members to their own arms", () => {
    expect(deriveAttackEffect(REAL_NEAR_MISSES[3])).toEqual([
      {
        op: "coinFlipGate",
        then: [{ op: "applyStatus", target: "defender", status: "paralyzed" }],
      },
    ]);
    expect(deriveAttackEffect(REAL_NEAR_MISSES[4])).toEqual([
      {
        op: "coinFlipGate",
        then: [{ op: "discardEnergy", from: "opponentActive", filter: { kind: "anyEnergy" } }],
      },
    ]);
    expect(deriveAttackEffect(REAL_NEAR_MISSES[5])).toEqual([
      {
        op: "coinFlipGate",
        then: [{ op: "gust" }],
      },
    ]);
  });

  it("leaves D126's pre-damage flip to the OTHER reader entirely", () => {
    expect(deriveAttackEffect(REAL_NEAR_MISSES[6])).toBeNull();
    expect(deriveAttackCoinFlip(REAL_NEAR_MISSES[6])).not.toBeNull();
    // And the converse, on both of ours: the coin reader does not claim either gated
    // sentence. A build where both fired would flip twice for one printed coin.
    for (const { text } of CLAUSES) {
      expect(deriveAttackCoinFlip(text)).toBeNull();
    }
  });

  it("is DISJOINT from the two BARE anchors — neither can claim the other's string", () => {
    for (const { text, bare, inner } of CLAUSES) {
      expect(deriveAttackEffect(bare)).toEqual([inner]);
      expect(deriveAttackEffect(text)).not.toEqual(deriveAttackEffect(bare));
      expect(bare.startsWith("Flip")).toBe(false);
      expect(text.startsWith("Flip a coin. If heads, ")).toBe(true);
    }
  });

  it("refuses the anchor, punctuation and case rewrites — but trims outer space", () => {
    for (const text of [
      // NO TRAILING PERIOD — the `$` sits after it.
      "Flip a coin. If heads, heal 30 damage from this Pokémon",
      "Flip a coin. If heads, discard the top card of your opponent's deck",
      // A CAPITALISED consequent. The printed text lowercases it (it is mid-sentence),
      // and a capital here is the bare anchor's spelling pasted behind a gate.
      "Flip a coin. If heads, Heal 30 damage from this Pokémon.",
      "Flip a coin. If heads, Discard the top card of your opponent's deck.",
      // A LOWERCASE "Flip". Half of what keeps a mid-sentence gate clause off this
      // path, and the reason no /i flag is on either regex.
      "flip a coin. If heads, heal 30 damage from this Pokémon.",
      // "if" for "If" — the other half of the same guard.
      "Flip a coin. if heads, heal 30 damage from this Pokémon.",
      "Flip a coin. If tails, heal 30 damage from this Pokémon.",
      // A NON-BREAKING SPACE where an ASCII one is printed.
      `Flip a coin. If heads,${NBSP}heal 30 damage from this Pokémon.`,
      // An INTERIOR double space is not trimmable.
      "Flip a coin.  If heads, heal 30 damage from this Pokémon.",
      // MISSING the comma after "If heads".
      "Flip a coin. If heads heal 30 damage from this Pokémon.",
      "Flip 2 coins. If heads, heal 30 damage from this Pokémon.",
      "Flip a coin until you get tails. If heads, heal 30 damage from this Pokémon.",
      "Flip a coin. For each heads, discard the top card of your opponent's deck.",
      // THE MILL'S WIDENINGS, none of which the pool prints behind a gate. Accepting
      // any of them would be inventing a reading, which is the guess this family
      // refuses everywhere else.
      "Flip a coin. If heads, discard the top 2 cards of your opponent's deck.",
      "Flip a coin. If heads, discard the top card of your deck.",
      "Flip a coin. If heads, discard the top card of each player's deck.",
      // THE HEAL'S NEIGHBOURING TARGETS, likewise unprinted behind a gate.
      "Flip a coin. If heads, heal 30 damage from each of your Pokémon.",
      "Flip a coin. If heads, heal 30 damage from 1 of your Pokémon.",
      "Flip a coin. If heads, heal all damage from this Pokémon.",
      "Flip a coin. If heads, heal 30 damage from this Pokémon. If tails, this attack does nothing.",
      "Flip a coin. If heads, discard the top card of your opponent's deck. Then, shuffle your deck.",
      // A LEADING RIDER pins `^` from the other side.
      "This attack does 20 damage. Flip a coin. If heads, heal 30 damage from this Pokémon.",
      // Empty.
      "",
    ]) {
      expect(deriveAttackEffect(text)).toBeNull();
    }
    // Outer whitespace SURVIVES by design (the deriver trims), so this pair states
    // which drift is tolerated and which is not.
    expect(
      deriveAttackEffect("  Flip a coin. If heads, heal 30 damage from this Pokémon.\n"),
    ).toEqual([{ op: "coinFlipGate", then: [{ op: "heal", target: "self", amount: 30 }] }]);
    expect(
      deriveAttackEffect("\tFlip a coin. If heads, discard the top card of your opponent's deck. "),
    ).toEqual([
      { op: "coinFlipGate", then: [{ op: "discardDeckTop", whose: "opponent", count: 1 }] },
    ]);
  });

  it("accepts BOTH apostrophes in the mill clause — deliberately, not accidentally", () => {
    const printed = CLAUSES[1].text;
    expect(printed).not.toContain(RSQUO);
    expect(deriveAttackEffect(printed.replace("'", RSQUO))).toEqual(deriveAttackEffect(printed));
  });
});

describe("the fixtures' printed text — the sentence is load-bearing", () => {
  it("matches FIXTURE_POOL char-for-char for Fuecoco sv02-035", () => {
    // On the deriver path a one-character drift un-simulates the card with no other
    // failure anywhere, so the bytes get pinned here.
    const spacingOut = FIXTURE_POOL["sv02-035"]?.attacks?.[SPACING_OUT_INDEX];
    expect(spacingOut).toEqual({
      cost: ["Colorless"],
      name: "Spacing Out",
      effect: CLAUSES[0].text,
    });
    // NO `damage` field at all (not a zero, not an empty string), so the gated heal is
    // the entire visible result of the declaration — and a tails moves nothing.
    expect(spacingOut?.damage).toBeUndefined();
    expect(deriveAttackEffect(spacingOut?.effect ?? "")).toEqual([
      { op: "coinFlipGate", then: [{ op: "heal", target: "self", amount: SPACING_OUT_HEAL }] },
    ]);
    expect(FIXTURE_POOL["sv02-035"]?.name).toBe("Fuecoco");
    expect(FIXTURE_POOL["sv02-035"]?.stage).toBe("Basic");
    expect(FIXTURE_POOL["sv02-035"]?.hp).toBe(90);
    // The index-1 control: real printed damage, no effect text at all.
    const flare = FIXTURE_POOL["sv02-035"]?.attacks?.[FLARE_INDEX];
    expect(flare).toEqual({ cost: ["Fire", "Colorless"], name: "Flare", damage: FLARE_DAMAGE });
    expect(flare?.effect).toBeUndefined();
  });

  it("matches FIXTURE_POOL char-for-char for Wiglett sv01-056", () => {
    const digALittle = FIXTURE_POOL["sv01-056"]?.attacks?.[DIG_A_LITTLE_INDEX];
    expect(digALittle).toEqual({
      cost: ["Colorless"],
      name: "Dig a Little",
      effect: CLAUSES[1].text,
    });
    expect(digALittle?.damage).toBeUndefined();
    expect(deriveAttackEffect(digALittle?.effect ?? "")).toEqual([
      {
        op: "coinFlipGate",
        then: [{ op: "discardDeckTop", whose: "opponent", count: DIG_A_LITTLE_MILL }],
      },
    ]);
    expect(FIXTURE_POOL["sv01-056"]?.name).toBe("Wiglett");
    expect(FIXTURE_POOL["sv01-056"]?.stage).toBe("Basic");
    expect(FIXTURE_POOL["sv01-056"]?.hp).toBe(60);
    // The index-1 control shares the Colorless line with the gated attack, so nothing
    // but the INDEX tells the two apart on the same board.
    const ram = FIXTURE_POOL["sv01-056"]?.attacks?.[RAM_INDEX];
    expect(ram).toEqual({
      cost: ["Colorless", "Colorless"],
      name: "Ram",
      damage: RAM_DAMAGE,
    });
    expect(ram?.effect).toBeUndefined();
  });
});

describe("end to end — Fuecoco 'Spacing Out' (gated heal 30, NO printed damage)", () => {
  it("heals 30 on HEADS and nothing at all on TAILS", () => {
    const faces = new Map<CoinFace, { damage: number | undefined; healed: number }>();
    for (const seed of SEEDS) {
      const state = fuecocoActive(board(seed), "p1", ATTACKER_HURT);
      const { state: done, events } = mustApply(state, {
        type: "attack",
        seat: "p1",
        index: SPACING_OUT_INDEX,
      });
      const result = face(events);
      expect(result).toBeDefined();
      faces.set(result as CoinFace, {
        damage: done.players.p1.active?.damage,
        healed: all(events, "HEALED").length,
      });
    }
    // BOTH FACES WERE SEEN — otherwise the pair below would pass vacuously on one.
    expect([...faces.keys()].sort()).toEqual(["heads", "tails"]);
    expect(faces.get("heads")).toEqual({ damage: ATTACKER_HURT - SPACING_OUT_HEAL, healed: 1 });
    expect(faces.get("tails")).toEqual({ damage: ATTACKER_HURT, healed: 0 });
  });

  it("takes the coin on BOTH faces — a tails is a flip, not a no-op", () => {
    for (const seed of SEEDS) {
      const state = fuecocoActive(board(seed), "p1", ATTACKER_HURT);
      deepFreeze(state);
      const { state: done, events } = mustApply(state, {
        type: "attack",
        seat: "p1",
        index: SPACING_OUT_INDEX,
      });
      expect(done.rngState).not.toBe(state.rngState);
      expect(all(events, "ATTACK_EFFECT_COIN_FLIP")).toHaveLength(1);
      expect(findEvent(events, "ATTACK_EFFECT_COIN_FLIP")?.seat).toBe("p1");
      expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
      // No printed damage on either face — the heal is the whole declaration.
      expect(types(events)).not.toContain("DAMAGE_DEALT");
      expect(done.players.p2.active?.damage).toBe(0);
    }
  });

  it("CLAMPS on heads and stays silent on tails — the same board, both faces", () => {
    // 10 damage against a printed 30 heals 10 and lands at 0 on heads; on tails the
    // 10 is still there. A clamp that went negative and a gate that always fired
    // would BOTH show up here, and nowhere else in the file.
    const faces = new Map<CoinFace, { damage: number | undefined; amounts: number[] }>();
    for (const seed of SEEDS) {
      const state = fuecocoActive(board(seed), "p1", ATTACKER_BARELY_HURT);
      const { state: done, events } = mustApply(state, {
        type: "attack",
        seat: "p1",
        index: SPACING_OUT_INDEX,
      });
      faces.set(face(events) as CoinFace, {
        damage: done.players.p1.active?.damage,
        amounts: all(events, "HEALED").map((e) => e.amount),
      });
    }
    expect(faces.get("heads")).toEqual({ damage: 0, amounts: [ATTACKER_BARELY_HURT] });
    expect(faces.get("tails")).toEqual({ damage: ATTACKER_BARELY_HURT, amounts: [] });
  });

  it("WHIFFS SILENTLY on an undamaged attacker — even on HEADS, and still SIMULATED", () => {
    let sawHeads = false;
    for (const seed of SEEDS) {
      const state = fuecocoActive(board(seed), "p1", 0);
      const { state: done, events } = mustApply(state, {
        type: "attack",
        seat: "p1",
        index: SPACING_OUT_INDEX,
      });
      if (face(events) === "heads") sawHeads = true;
      expect(all(events, "HEALED")).toHaveLength(0);
      expect(done.players.p1.active?.damage).toBe(0);
      expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    }
    expect(sawHeads).toBe(true);
  });

  it("runs on the OTHER seat too, healing THAT seat's attacker", () => {
    const faces = new Map<CoinFace, { damage: number | undefined; seat: string | undefined }>();
    for (const seed of SEEDS) {
      let state = board(seed);
      state = mustApply(state, { type: "endTurn", seat: "p1" }).state;
      state = fuecocoActive(state, "p2", ATTACKER_HURT);
      const { state: done, events } = mustApply(state, {
        type: "attack",
        seat: "p2",
        index: SPACING_OUT_INDEX,
      });
      faces.set(face(events) as CoinFace, {
        damage: done.players.p2.active?.damage,
        seat: findEvent(events, "ATTACK_EFFECT_COIN_FLIP")?.seat,
      });
    }
    expect(faces.get("heads")).toEqual({ damage: ATTACKER_HURT - SPACING_OUT_HEAL, seat: "p2" });
    expect(faces.get("tails")).toEqual({ damage: ATTACKER_HURT, seat: "p2" });
  });

  it("the index-1 control takes NO coin — the reader is keyed to the declared text", () => {
    // "Flare" prints a flat 30 with no effect text on the SAME card. It must flip
    // nothing, heal nothing and leave `rngState` alone — the sharpest form of "the
    // gate belongs to the sentence, not to the Pokémon".
    let state = fuecocoActive(board(3), "p1", ATTACKER_HURT);
    state = attachFromDeck(state, "p1", "fix-fire-energy", 1);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: FLARE_INDEX,
    });
    expect(all(events, "ATTACK_EFFECT_COIN_FLIP")).toHaveLength(0);
    expect(done.rngState).toBe(state.rngState);
    expect(all(events, "HEALED")).toHaveLength(0);
    expect(done.players.p1.active?.damage).toBe(ATTACKER_HURT);
    expect(done.players.p2.active?.damage).toBe(FLARE_DAMAGE);
    // An effect-less attack is not a SKIPPED one: there was nothing to skip.
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });
});

describe("end to end — Wiglett 'Dig a Little' (gated mill 1, NO printed damage)", () => {
  it("mills ONE off the opponent's deck on HEADS and nothing on TAILS", () => {
    const faces = new Map<
      CoinFace,
      { milled: string[]; deck: string[]; discard: string[]; rows: number }
    >();
    for (const seed of SEEDS) {
      const state = wiglettActive(board(seed), "p1");
      const victimDeck = state.players.p2.deck;
      const victimDiscard = state.players.p2.discard;
      deepFreeze(state);
      const { state: done, events } = mustApply(state, {
        type: "attack",
        seat: "p1",
        index: DIG_A_LITTLE_INDEX,
      });
      const result = face(events) as CoinFace;
      // The deltas are stated against THIS seed's deck, so the map below can hold
      // booleans-in-disguise rather than uids that differ per seed.
      faces.set(result, {
        milled: milledUids(events),
        // On heads the mill takes the top card and P2's turn-start draw takes the
        // next; on tails the draw is the only thing that moved. Naming both terms is
        // what keeps this an assertion about the OP rather than about a length.
        deck: victimDeck.slice(
          result === "heads" ? DIG_A_LITTLE_MILL + TURN_START_DRAW : TURN_START_DRAW,
        ),
        discard: [
          ...victimDiscard,
          ...victimDeck.slice(0, result === "heads" ? DIG_A_LITTLE_MILL : 0),
        ],
        rows: all(events, "DECK_TOP_DISCARDED").length,
      });
      expect(done.players.p2.deck).toEqual(faces.get(result)?.deck);
      expect(done.players.p2.discard).toEqual(faces.get(result)?.discard);
      expect(milledUids(events)).toEqual(
        victimDeck.slice(0, result === "heads" ? DIG_A_LITTLE_MILL : 0),
      );
    }
    expect([...faces.keys()].sort()).toEqual(["heads", "tails"]);
    expect(faces.get("heads")?.rows).toBe(1);
    expect(faces.get("heads")?.milled).toHaveLength(DIG_A_LITTLE_MILL);
    expect(faces.get("tails")?.rows).toBe(0);
    expect(faces.get("tails")?.milled).toEqual([]);
  });

  it("never touches the ATTACKER's own deck — the direction, on both faces", () => {
    // `whose: "opponent"` read the wrong way round passes every count assertion above
    // and fails exactly here. Both faces, because a gate that fired on tails would
    // show up as an own-deck delta on the seeds where it should not have run.
    for (const seed of SEEDS) {
      const state = wiglettActive(board(seed), "p1");
      const ownDeckBefore = state.players.p1.deck;
      const ownDiscardBefore = state.players.p1.discard;
      const { state: done, events } = mustApply(state, {
        type: "attack",
        seat: "p1",
        index: DIG_A_LITTLE_INDEX,
      });
      expect(done.players.p1.deck).toEqual(ownDeckBefore);
      expect(done.players.p1.discard).toEqual(ownDiscardBefore);
      if (face(events) === "heads") {
        expect(findEvent(events, "DECK_TOP_DISCARDED")?.seat).toBe("p2");
      }
      expect(findEvent(events, "ATTACK_EFFECT_COIN_FLIP")?.seat).toBe("p1");
      expect(types(events)).not.toContain("DAMAGE_DEALT");
      expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
      expect(done.players.p2.active?.damage).toBe(0);
    }
  });

  it("runs on the OTHER seat too, aimed back the other way", () => {
    const faces = new Map<CoinFace, { rows: number; victimSeat: string | undefined }>();
    for (const seed of SEEDS) {
      let state = board(seed);
      state = mustApply(state, { type: "endTurn", seat: "p1" }).state;
      state = wiglettActive(state, "p2");
      const ownDeckBefore = state.players.p2.deck;
      const { state: done, events } = mustApply(state, {
        type: "attack",
        seat: "p2",
        index: DIG_A_LITTLE_INDEX,
      });
      faces.set(face(events) as CoinFace, {
        rows: all(events, "DECK_TOP_DISCARDED").length,
        victimSeat: findEvent(events, "DECK_TOP_DISCARDED")?.seat,
      });
      expect(done.players.p2.deck).toEqual(ownDeckBefore);
    }
    expect(faces.get("heads")).toEqual({ rows: 1, victimSeat: "p1" });
    expect(faces.get("tails")).toEqual({ rows: 0, victimSeat: undefined });
  });

  it("the index-1 control takes NO coin — off the SAME Colorless line", () => {
    let state = wiglettActive(board(4), "p1");
    state = attachFromDeck(state, "p1", "fix-energy", 1);
    const victimDeck = state.players.p2.deck;
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: RAM_INDEX,
    });
    expect(all(events, "ATTACK_EFFECT_COIN_FLIP")).toHaveLength(0);
    expect(done.rngState).toBe(state.rngState);
    expect(all(events, "DECK_TOP_DISCARDED")).toHaveLength(0);
    // P2's deck is shorter by their turn-start DRAW and by nothing else — sharper
    // than "unchanged", which would be false here for a reason unrelated to the mill.
    expect(done.players.p2.deck).toEqual(victimDeck.slice(TURN_START_DRAW));
    expect(done.players.p2.discard).toEqual(state.players.p2.discard);
    expect(done.players.p2.active?.damage).toBe(RAM_DAMAGE);
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });
});

describe("what the flip-gated family costs the rest of the engine — nothing", () => {
  it("never PARKS on either face — the attack resolves to an ordinary action phase", () => {
    for (const seed of SEEDS) {
      const heal = mustApply(fuecocoActive(board(seed), "p1", ATTACKER_HURT), {
        type: "attack",
        seat: "p1",
        index: SPACING_OUT_INDEX,
      });
      expect(heal.state.phase).toEqual({ kind: "turn:action", seat: "p2" });
      expect(heal.state.pending).toEqual([]);
      const mill = mustApply(wiglettActive(board(seed), "p1"), {
        type: "attack",
        seat: "p1",
        index: DIG_A_LITTLE_INDEX,
      });
      expect(mill.state.phase).toEqual({ kind: "turn:action", seat: "p2" });
      expect(mill.state.pending).toEqual([]);
    }
  });

  it("costs ZERO registry rows — both cards simulate off their printed text", () => {
    for (const id of ["sv02-035", "sv01-056"]) {
      expect(programFor(id)).toBeUndefined();
    }
  });

  it("emits the SAME ops the bare anchors do — one action, two printings, no mechanism", () => {
    expect(deriveAttackEffect(CLAUSES[0].text)).toEqual([
      { op: "coinFlipGate", then: deriveAttackEffect("Heal 30 damage from this Pokémon.") },
    ]);
    expect(deriveAttackEffect(CLAUSES[1].text)).toEqual([
      {
        op: "coinFlipGate",
        then: deriveAttackEffect("Discard the top card of your opponent's deck."),
      },
    ]);
  });
});
