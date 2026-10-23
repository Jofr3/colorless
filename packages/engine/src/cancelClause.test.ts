import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { legalAttackCorpus } from "./censusAttackCorpus";
import {
  deriveAttackCancelRequirement,
  deriveAttackEffect,
  deriveAttackRequirement,
  splitAttackCancelClause,
  splitAttackGateClause,
  splitAttackRequirementClause,
  splitAttackTrailingClause,
} from "./effects";
import type { GameEvent, GameState, Seat } from "./index";
import { applyAction, createGame } from "./index";
import {
  FIXTURE_POOL,
  attachFromDeck,
  battler,
  clearBench,
  deckOf,
  handUid,
  handFromDeck,
  mustApply,
  setActiveFromDeck,
  types,
  must,
  firstBasicInHand,
} from "./testFixtures";

const units = (rows: readonly (readonly [number, string])[]): number =>
  rows.reduce((sum, [n]) => sum + n, 0);
const corpus = (): readonly (readonly [number, string])[] => legalAttackCorpus();

const ETERNATUS = "Discard a Stadium in play. If you can't, this attack does nothing.";
const HEAD = "Discard a Stadium in play.";
/** Its trailing clause, which is the SAME bytes on every member of the family. */
const CLAUSE = "If you can't, this attack does nothing.";
const OGERPON =
  "Discard a Basic {G} Energy card from your hand. If you can't, this attack does nothing.";

const UNMAPPED_HEAD = "Discard 3 Energy from this Pokémon.";
const UNMAPPED_PRINTING = `${UNMAPPED_HEAD} If you can't, this attack does nothing.`;

const NAMED_REFERENT =
  "Discard 6 Basic {G} Energy cards from your hand, and Knock Out your opponent's Active Pokémon. If you can't discard 6 cards in this way, this attack does nothing.";
const TWO_CARD_COST =
  "Discard 2 Basic {G} Energy cards from your hand. If you can't discard 2 cards in this way, this attack does nothing.";

const LEADING_STADIUM = "If there is no Stadium in play, this attack does nothing.";

const WORLD_ENDER = "fix-d417-worldender";

const UNMAPPED_CANCEL = "fix-d417-unmapped";

const LOCAL_CARDS: Record<string, Card> = {
  [WORLD_ENDER]: battler(WORLD_ENDER, {
    name: "Fixnatus",
    hp: 300,
    retreat: 2,
    types: ["Darkness"],
    attacks: [
      {
        cost: ["Fire", "Darkness", "Darkness"],
        name: "World Ender",
        damage: 230,
        effect: ETERNATUS,
      },
    ],
  }),
  [UNMAPPED_CANCEL]: battler(UNMAPPED_CANCEL, {
    name: "Fixgerpon",
    hp: 300,
    retreat: 2,
    types: ["Grass"],
    attacks: [
      {
        cost: ["Fire", "Darkness", "Darkness"],
        name: "Unmapped Cancel",
        damage: 230,
        effect: UNMAPPED_PRINTING,
      },
    ],
  }),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const BEACH_COURT = "sv01-167";

const DECK = deckOf({
  [WORLD_ENDER]: 4,
  [UNMAPPED_CANCEL]: 4,
  [BEACH_COURT]: 6,
  "fix-titan": 4,
  "fix-fire-energy": 6,
  "fix-dark-energy": 8,
  "fix-bigbody": 28,
});

const SEEDS = [4171, 4187, 4201] as const;

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

function localSetup(seed: number): GameState {
  const created = createGame({ seed, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(
    applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first: "p2" }),
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

function playStadium(state: GameState, seat: Seat): GameState {
  const withCard = handFromDeck(state, seat, BEACH_COURT, 1);
  const uid = handUid(withCard, seat, BEACH_COURT);
  return mustApply(withCard, { type: "playTrainer", seat, uid }).state;
}

function board(seed: number, stadium: boolean, attacker: string = WORLD_ENDER): GameState {
  let state = localSetup(seed);
  if (stadium) state = playStadium(state, "p2");
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", attacker);
  state = setActiveFromDeck(state, "p2", "fix-titan");
  state = clearBench(state, "p1");
  state = clearBench(state, "p2");
  state = attachFromDeck(state, "p1", "fix-fire-energy", 1);
  state = attachFromDeck(state, "p1", "fix-dark-energy", 2);
  return state;
}

const attack = (state: GameState) => mustApply(state, { type: "attack", seat: "p1", index: 0 });

describe("§1 — the reader: an exact value, four anchors, and a table that refuses", () => {
  it("reads Eternatus's printed sentence to `stadiumInPlay`, and splits it in two", () => {
    expect(deriveAttackCancelRequirement(ETERNATUS)).toEqual({ kind: "stadiumInPlay" });
    expect(splitAttackCancelClause(ETERNATUS)).toEqual({ head: HEAD, clause: CLAUSE });
    expect(deriveAttackEffect(HEAD)).toEqual([{ op: "discardStadium" }]);
    // The clause is a CAPTURE, not a reconstruction: the two halves rejoin to the
    // printed string byte for byte, so nothing can be lost in the split.
    expect(`${HEAD} ${CLAUSE}`).toBe(ETERNATUS);
  });

  it("the ANCHORS: leading text, a missing period, and lower case are each refused", () => {
    // Trailing text after the clause — the `$`. A cancel is the LAST sentence or it
    // is not this reader's.
    expect(splitAttackCancelClause(`${ETERNATUS} Then, draw a card.`)).toBeNull();
    expect(deriveAttackCancelRequirement(`${ETERNATUS} Then, draw a card.`)).toBeNull();
    // The required trailing period — the same anchor every reader in this file
    // carries, and the one a hand-typed sentence loses first.
    expect(splitAttackCancelClause(ETERNATUS.slice(0, -1))).toBeNull();
    expect(deriveAttackCancelRequirement(ETERNATUS.slice(0, -1))).toBeNull();
    // No /i anywhere: the printed sentence is capitalised and so is the key.
    expect(splitAttackCancelClause(ETERNATUS.toLowerCase())).toBeNull();
    expect(deriveAttackCancelRequirement(ETERNATUS.toLowerCase())).toBeNull();
    // LEADING TEXT in front of the head. The head group is greedy, so the head
    // becomes the WHOLE two-sentence prefix, which the table does not carry — the
    // accounting guard refuses it rather than silently reading past a sentence.
    expect(splitAttackCancelClause(`Flip a coin. ${ETERNATUS}`)).toBeNull();
    expect(deriveAttackCancelRequirement(`Flip a coin. ${ETERNATUS}`)).toBeNull();
    // Whitespace is trimmed, which is the one thing that is NOT an anchor.
    expect(splitAttackCancelClause(`  ${ETERNATUS}  `)).toEqual({ head: HEAD, clause: CLAUSE });
  });

  it("the `^If`-LEADING form still goes to D125's reader and never to this one", () => {
    expect(deriveAttackRequirement(LEADING_STADIUM)).toEqual({ kind: "stadiumInPlay" });
    expect(deriveAttackCancelRequirement(LEADING_STADIUM)).toBeNull();
    expect(splitAttackCancelClause(LEADING_STADIUM)).toBeNull();
    expect(deriveAttackRequirement(ETERNATUS)).toBeNull();
    expect(splitAttackRequirementClause(ETERNATUS)).toBeNull();
  });

  it("the TABLE refuses an unmapped head — the accounting guard, after the widening", () => {
    expect(OGERPON.endsWith(CLAUSE)).toBe(true);
    expect(deriveAttackCancelRequirement(OGERPON)).toEqual({
      kind: "yourBasicEnergyInHandAtLeast",
      energy: "Grass",
      count: 1,
    });
    expect(deriveAttackCancelRequirement(OGERPON)).not.toEqual(
      deriveAttackCancelRequirement(ETERNATUS),
    );
    expect(deriveAttackEffect(UNMAPPED_HEAD)).not.toBeNull();
    expect(splitAttackCancelClause(UNMAPPED_PRINTING)).toBeNull();
    expect(deriveAttackCancelRequirement(UNMAPPED_PRINTING)).toBeNull();
    expect(deriveAttackRequirement(UNMAPPED_PRINTING)).toBeNull();
    expect(deriveAttackEffect(UNMAPPED_PRINTING)).toBeNull();
  });

  it("the NAMED-REFERENT cancel is ADMITTED by a CLOSED alternation, and only that", () => {
    expect(NAMED_REFERENT.includes("If you can't discard 6 cards in this way,")).toBe(true);
    expect(splitAttackCancelClause(NAMED_REFERENT)?.head).toBe(
      "Discard 6 Basic {G} Energy cards from your hand, and Knock Out your opponent's Active Pokémon.",
    );
    expect(deriveAttackCancelRequirement(NAMED_REFERENT)).toEqual({
      kind: "yourBasicEnergyInHandAtLeast",
      energy: "Grass",
      count: 6,
    });
    // …and it is really in the pool, so this is a claim and not a straw man.
    expect(units(corpus().filter(([, s]) => s === NAMED_REFERENT))).toBe(2);
    for (const bad of [
      "If you can't discard any, this attack does nothing.",
      "If you can't discard six cards in this way, this attack does nothing.",
      "If you can't discard 6 cards, this attack does nothing.",
    ]) {
      expect(splitAttackCancelClause(`${HEAD} ${bad}`), bad).toBeNull();
    }
  });

  it("the APOSTROPHE CLASS is live: a U+2019 reprint of the clause still reads", () => {
    const curly = ETERNATUS.replace("can't", "can’t");
    expect(curly).not.toBe(ETERNATUS);
    expect(deriveAttackCancelRequirement(curly)).toEqual({ kind: "stadiumInPlay" });
    // …and the clause handed back is the PRINTED bytes, not a reconstruction, so a
    // caller asserting WHICH clause it accounted for sees what the card says.
    expect(splitAttackCancelClause(curly)?.clause).toBe(CLAUSE.replace("can't", "can’t"));
    expect(HEAD.includes("'")).toBe(false);
  });

  it("GENERAL OVER ITS BODY: a second member costs a ROW and nothing else", () => {
    const rows = new Map<string, string>([
      [HEAD, "stadiumInPlay"],
      ["Discard a Basic {G} Energy card from your hand.", "yourHandHasBasicGrass"],
    ]);
    const split = (text: string): { head: string; kind: string } | null => {
      const m = /^(.+\.) (If you can['’]t, this attack does nothing\.)$/.exec(text.trim());
      if (m === null) return null;
      const kind = rows.get(m[1] ?? "");
      return kind === undefined ? null : { head: m[1] ?? "", kind };
    };
    expect(split(ETERNATUS)?.kind).toBe("stadiumInPlay");
    expect(split(OGERPON)?.kind).toBe("yourHandHasBasicGrass");
    expect(split(`Discard your hand. ${CLAUSE}`)).toBeNull();
    expect(split(ETERNATUS)?.kind).not.toBe(split(OGERPON)?.kind);
  });
});

describe("§2 — the whole legal column: what this reader claims, and what it cannot", () => {
  it("claims 4 sentences / 5 legal printings, and names every one of them", () => {
    const claimed = corpus().filter(([, s]) => deriveAttackCancelRequirement(s) !== null);
    expect([claimed.length, units(claimed)]).toEqual([4, 5]);
    expect(claimed.map(([, s]) => s).sort()).toEqual(
      [ETERNATUS, OGERPON, NAMED_REFERENT, TWO_CARD_COST].sort(),
    );
    const anaphoric = corpus().filter(([, s]) => s.endsWith(CLAUSE));
    expect([anaphoric.length, units(anaphoric)]).toEqual([2, 2]);
    expect(anaphoric.map(([, s]) => s).sort()).toEqual([OGERPON, ETERNATUS].sort());
    for (const [, s] of anaphoric) expect(deriveAttackCancelRequirement(s), s).not.toBeNull();
    expect(deriveAttackCancelRequirement(UNMAPPED_PRINTING)).toBeNull();
    expect(claimed.length).toBeLessThan(corpus().length);
  });

  it("the two requirement readers are MUTUALLY EXCLUSIVE over all 1,732 units", () => {
    // This is what makes `attack.ts`'s `leadingRequirement ?? cancelRequirement` a
    // JOIN rather than a precedence: no printed string can make both non-null, so
    // the `??` never chooses and the order of its two operands is not a commitment.
    const all = corpus();
    expect(all.length).toBe(640);
    expect(units(all)).toBe(1732);
    const both = all.filter(
      ([, s]) => deriveAttackRequirement(s) !== null && deriveAttackCancelRequirement(s) !== null,
    );
    expect([both.length, units(both)]).toEqual([0, 0]);
    // …and both are really running over this column, which is what stops the line
    // above being vacuous.
    const leading = all.filter(([, s]) => deriveAttackRequirement(s) !== null);
    expect([leading.length, units(leading)]).toEqual([9, 18]);
  });

  it("it claims nothing the three OLDER strippers claim, and takes nothing off them", () => {
    expect(splitAttackGateClause(ETERNATUS)).toBeNull();
    expect(splitAttackRequirementClause(ETERNATUS)).toBeNull();
    expect(deriveAttackEffect(CLAUSE)).toBeNull();
    expect(splitAttackTrailingClause(ETERNATUS)).toBeNull();
  });
});

describe("§3 — a REAL BOARD, driven BOTH WAYS off the one printed sentence", () => {
  it.each(SEEDS)(
    "seed %i — a Stadium in play: the attack RESOLVES and the zone is vacated",
    (seed) => {
      const before = board(seed, true);
      const stadium = before.stadium;
      if (stadium === null) throw new Error("expected P2's Beach Court in the zone");
      expect(stadium.owner).toBe("p2");
      const p1Discard = before.players.p1.discard.length;

      const result = attack(before);
      const state = result.state;

      // The gate HOLDS, so §8.5 runs: a flat printed 230 on a 340 HP body with no
      // Weakness and no Resistance, which survives so the number can be read.
      expect(types(result.events)).not.toContain("ATTACK_FAILED");
      expect(find(result.events, "DAMAGE_DEALT")?.dealt).toBe(230);
      expect(state.players.p2.active?.damage).toBe(230);
      expect(types(result.events)).not.toContain("KNOCKED_OUT");
      expect(state.stadium).toBeNull();
      expect(state.players.p2.discard).toContain(stadium.uid);
      expect(state.players.p1.discard).toHaveLength(p1Discard);
      expect(find(result.events, "STADIUM_DISCARDED")?.seat).toBe("p2");
      const order = types(result.events);
      expect(order.indexOf("DAMAGE_DEALT")).toBeLessThan(order.indexOf("STADIUM_DISCARDED"));
      // BOTH printed sentences are accounted for, so nothing is reported as skipped.
      expect(types(result.events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    },
  );

  it.each(SEEDS)("seed %i — NO Stadium: the attack does NOTHING, and 230 is the proof", (seed) => {
    const before = board(seed, false);
    expect(before.stadium).toBeNull();
    const uid = before.players.p1.active?.stack[0];
    if (uid === undefined) throw new Error("expected P1's Active");
    const p1Discard = before.players.p1.discard.length;
    const p2Discard = before.players.p2.discard.length;

    const result = attack(before);
    const state = result.state;

    expect(find(result.events, "ATTACK_FAILED")).toEqual({
      type: "ATTACK_FAILED",
      seat: "p1",
      uid,
      reason: "requirement",
    });
    expect(types(result.events)).not.toContain("DAMAGE_DEALT");
    expect(types(result.events)).not.toContain("COUNTERS_PLACED");
    expect(types(result.events)).not.toContain("KNOCKED_OUT");
    expect(state.players.p2.active?.damage).toBe(0);
    expect(types(result.events)).not.toContain("STADIUM_DISCARDED");
    expect(state.players.p1.discard).toHaveLength(p1Discard);
    expect(state.players.p2.discard).toHaveLength(p2Discard);
    expect(state.phase.kind).not.toBe("effect:choose");
    // The sentence was SIMULATED — a cancelled attack is not a skipped effect, and
    // the HEAD is simulated by `deriveAttackEffect` rather than by the requirement.
    expect(types(result.events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(types(result.events)).toContain("TURN_ENDED");
    expect(state.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it.each(SEEDS)(
    "seed %i — the CONTROL: an UNMAPPED cancel stays LOUD and is not gated",
    (seed) => {
      const result = attack(board(seed, false, UNMAPPED_CANCEL));
      expect(types(result.events)).not.toContain("ATTACK_FAILED");
      expect(find(result.events, "ATTACK_EFFECT_SKIPPED")).toMatchObject({
        effect: UNMAPPED_PRINTING,
      });
      expect(find(result.events, "DAMAGE_DEALT")?.dealt).toBe(230);
    },
  );
});
