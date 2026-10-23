import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { legalAttackCorpus } from "./censusAttackCorpus";
import {
  attackCancelHeadRows,
  deriveAttackCancelRequirement,
  deriveAttackEffect,
  deriveAttackRequirement,
  splitAttackCancelClause,
  splitAttackGateClause,
  splitAttackRequirementClause,
  splitAttackTrailingClause,
} from "./effects";
import type { BoardCondition, EffectOp } from "./effects";
import { applyAction, createGame } from "./index";
import type { GameState, Seat } from "./index";
import { conditionHolds, conditionNote } from "./interpreter";
import {
  FIXTURE_POOL,
  attachFromDeck,
  battler,
  clearBench,
  deckOf,
  deepFreeze,
  firstBasicInHand,
  handFromDeck,
  handToDeck,
  must,
  mustApply,
  setActiveFromDeck,
  types,
  findEvent,
} from "./testFixtures";

const units = (rows: readonly (readonly [number, string])[]): number =>
  rows.reduce((sum, [n]) => sum + n, 0);
const corpus = (): readonly (readonly [number, string])[] => legalAttackCorpus();

const KO6 =
  "Discard 6 Basic {G} Energy cards from your hand, and Knock Out your opponent's Active Pokémon. If you can't discard 6 cards in this way, this attack does nothing.";
const COST2 =
  "Discard 2 Basic {G} Energy cards from your hand. If you can't discard 2 cards in this way, this attack does nothing.";
const COST1 =
  "Discard a Basic {G} Energy card from your hand. If you can't, this attack does nothing.";

const KO6_HEAD =
  "Discard 6 Basic {G} Energy cards from your hand, and Knock Out your opponent's Active Pokémon.";
const COST2_HEAD = "Discard 2 Basic {G} Energy cards from your hand.";
const HAND_SCALED =
  "Discard up to 3 Energy cards from your hand. This attack does 60 damage to 1 of your opponent's Pokémon for each Energy card you discarded in this way. (Don't apply Weakness and Resistance for Benched Pokémon.)";
const COST1_HEAD = "Discard a Basic {G} Energy card from your hand.";

const NAMED_CLAUSE_6 = "If you can't discard 6 cards in this way, this attack does nothing.";
const NAMED_CLAUSE_2 = "If you can't discard 2 cards in this way, this attack does nothing.";
const BARE_CLAUSE = "If you can't, this attack does nothing.";

const ETERNATUS = "Discard a Stadium in play. If you can't, this attack does nothing.";

const DRAW2 = "Discard a card from your hand. If you do, draw 2 cards.";
const DRAW3 = "Discard a card from your hand. If you do, draw 3 cards.";
const GATED_OPPONENT_DISCARD =
  "Discard a card from your hand. If you do, your opponent discards a card from their hand.";

/** The `payFromHand` the three heads derive, spelled once. */
const pay = (count: number): EffectOp => ({
  op: "payFromHand",
  count,
  to: "discard",
  filter: { kind: "basicEnergy", energyType: "Grass" },
});
/** The `BoardCondition` the three cancels read, spelled once. */
const need = (count: number): BoardCondition => ({
  kind: "yourBasicEnergyInHandAtLeast",
  energy: "Grass",
  count,
});

const KO6_ID = "fix-d420-ko6";
const COST2_ID = "fix-d420-cost2";
const COST1_ID = "fix-d420-cost1";
const UNMAPPED_ID = "fix-d420-unmapped";
const UNMAPPED_TEXT =
  "Discard 3 Basic {G} Energy cards from your hand. If you can't discard 3 cards in this way, this attack does nothing.";

const attacker = (id: string, name: string, effect: string): Card =>
  battler(id, {
    name,
    hp: 300,
    retreat: 2,
    types: ["Grass"],
    attacks: [{ cost: ["Grass"], name, damage: 30, effect }],
  });

const LOCAL_CARDS: Record<string, Card> = {
  [KO6_ID]: attacker(KO6_ID, "Sixfold Sacrifice", KO6),
  [COST2_ID]: attacker(COST2_ID, "Twofold Cost", COST2),
  [COST1_ID]: attacker(COST1_ID, "Onefold Cost", COST1),
  [UNMAPPED_ID]: attacker(UNMAPPED_ID, "Unmapped Count", UNMAPPED_TEXT),
};

const POOL: Record<string, Card> = deepFreeze({ ...FIXTURE_POOL, ...LOCAL_CARDS });

const DECK = deckOf({
  [KO6_ID]: 4,
  [COST2_ID]: 4,
  [COST1_ID]: 4,
  [UNMAPPED_ID]: 4,
  "fix-titan": 4,
  "fix-grass-energy": 16,
  "fix-bigbody": 24,
});

const SEEDS = [5231, 5233, 5237] as const;

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

function board(seed: number, id: string, grass: number): GameState {
  let state = localSetup(seed);
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", id);
  state = setActiveFromDeck(state, "p2", "fix-titan");
  state = clearBench(state, "p1");
  state = clearBench(state, "p2");
  state = attachFromDeck(state, "p1", "fix-grass-energy", 1);
  state = handToDeck(state, "p1", "fix-grass-energy");
  if (grass > 0) state = handFromDeck(state, "p1", "fix-grass-energy", grass);
  return state;
}

const attack = (state: GameState) => mustApply(state, { type: "attack", seat: "p1", index: 0 });
const grassIn = (state: GameState, seat: Seat, zone: "hand" | "discard"): number =>
  state.players[seat][zone].filter((uid) => state.cardIdByUid[uid] === "fix-grass-energy").length;

const CASES = [
  { name: "KO6", text: KO6, head: KO6_HEAD, id: KO6_ID, count: 6, kos: true },
  { name: "COST2", text: COST2, head: COST2_HEAD, id: COST2_ID, count: 2, kos: false },
  { name: "COST1", text: COST1, head: COST1_HEAD, id: COST1_ID, count: 1, kos: false },
] as const;

describe("§1 — the reader: three sentences, one member, and the anchors that bound it", () => {
  it("splits each printing and reads it to `yourBasicEnergyInHandAtLeast`", () => {
    expect(deriveAttackCancelRequirement(KO6)).toEqual(need(6));
    expect(deriveAttackCancelRequirement(COST2)).toEqual(need(2));
    expect(deriveAttackCancelRequirement(COST1)).toEqual(need(1));
    expect(splitAttackCancelClause(KO6)).toEqual({ head: KO6_HEAD, clause: NAMED_CLAUSE_6 });
    expect(splitAttackCancelClause(COST2)).toEqual({ head: COST2_HEAD, clause: NAMED_CLAUSE_2 });
    expect(splitAttackCancelClause(COST1)).toEqual({ head: COST1_HEAD, clause: BARE_CLAUSE });
    // The clause is a CAPTURE, not a reconstruction: the halves rejoin byte for byte.
    for (const { text, head } of CASES) {
      const split = splitAttackCancelClause(text);
      expect(`${head} ${split?.clause}`).toBe(text);
    }
  });

  it("derives each HEAD to a `payFromHand`, and the compound to TWO ops in printed order", () => {
    expect(deriveAttackEffect(COST1_HEAD)).toEqual([pay(1)]);
    expect(deriveAttackEffect(COST2_HEAD)).toEqual([pay(2)]);
    expect(deriveAttackEffect(KO6_HEAD)).toEqual([pay(6), { op: "knockOutDefender" }]);
    expect(deriveAttackEffect(KO6_HEAD)?.[0]).toEqual(pay(6));
  });

  it("the ENERGY comes from `ENERGY_TYPE_BY_CODE`, not from a bare string", () => {
    const derived = deriveAttackEffect(COST2_HEAD)?.[0];
    expect(derived).toMatchObject({ filter: { kind: "basicEnergy", energyType: "Grass" } });
    expect(deriveAttackEffect("Discard 2 Basic {Q} Energy cards from your hand.")).toBeNull();
    expect(deriveAttackEffect("Discard 2 Basic Grass Energy cards from your hand.")).toBeNull();
  });

  it("the ANCHORS: leading text, a missing period, lower case and a plural slip", () => {
    for (const { text, head } of CASES) {
      expect(splitAttackCancelClause(`${text} Then, draw a card.`)).toBeNull();
      expect(splitAttackCancelClause(text.slice(0, -1))).toBeNull();
      expect(splitAttackCancelClause(text.toLowerCase())).toBeNull();
      expect(splitAttackCancelClause(`Flip a coin. ${text}`)).toBeNull();
      expect(deriveAttackEffect(`Flip a coin. ${head}`)).toBeNull();
      expect(deriveAttackEffect(head.slice(0, -1))).toBeNull();
      expect(deriveAttackEffect(head.toLowerCase())).toBeNull();
      // Whitespace is trimmed, which is the one thing that is NOT an anchor.
      expect(splitAttackCancelClause(`  ${text}  `)).not.toBeNull();
    }
    expect(deriveAttackEffect("Discard 2 Basic {G} Energy card from your hand.")).toBeNull();
    expect(deriveAttackEffect("Discard a Basic {G} Energy cards from your hand.")).toBeNull();
  });

  it("the APOSTROPHE CLASS is live on BOTH the clause and the compound head", () => {
    const curly = KO6.replaceAll("can't", "can’t").replaceAll("opponent's", "opponent’s");
    expect(curly).not.toBe(KO6);
    // The CLAUSE folds through the anchor's own `['’]` class…
    expect(deriveAttackCancelRequirement(curly)).toEqual(need(6));
    expect(splitAttackCancelClause(curly)?.head).toBe(KO6_HEAD.replace("opponent's", "opponent’s"));
    expect(deriveAttackEffect(KO6_HEAD.replace("opponent's", "opponent’s"))).toEqual([
      pay(6),
      { op: "knockOutDefender" },
    ]);
  });

  it("the TABLE still refuses an unmapped head — the guard the widening leans on", () => {
    expect(deriveAttackEffect("Discard 3 Basic {G} Energy cards from your hand.")).toEqual([
      pay(3),
    ]);
    expect(splitAttackCancelClause(UNMAPPED_TEXT)).toBeNull();
    expect(deriveAttackCancelRequirement(UNMAPPED_TEXT)).toBeNull();
    expect(deriveAttackEffect(UNMAPPED_TEXT)).toBeNull();
    // …and a head no reader claims at all, behind a named-referent clause.
    expect(splitAttackCancelClause(`Discard your hand. ${NAMED_CLAUSE_6}`)).toBeNull();
  });

  it("the EXCLUSIONS are the anchor's shape, not a comment", () => {
    expect(
      splitAttackCancelClause(`${COST2_HEAD} If you can't discard any, this attack does nothing.`),
    ).toBeNull();
    // A non-numeric quantity, and the plural noun the alternation fixes.
    expect(
      splitAttackCancelClause(
        `${COST2_HEAD} If you can't discard two cards in this way, this attack does nothing.`,
      ),
    ).toBeNull();
    expect(
      splitAttackCancelClause(
        `${COST2_HEAD} If you can't discard 2 card in this way, this attack does nothing.`,
      ),
    ).toBeNull();
  });

  it("D417's printing is untouched, and the two requirement readers stay disjoint", () => {
    expect(deriveAttackCancelRequirement(ETERNATUS)).toEqual({ kind: "stadiumInPlay" });
    expect(splitAttackCancelClause(ETERNATUS)).toEqual({
      head: "Discard a Stadium in play.",
      clause: BARE_CLAUSE,
    });
    // The `^If`-leading reader refuses all three, which is what keeps `attack.ts`'s
    // `leadingRequirement ?? cancelRequirement` a JOIN rather than a precedence.
    for (const { text } of CASES) {
      expect(deriveAttackRequirement(text), text).toBeNull();
      expect(splitAttackRequirementClause(text), text).toBeNull();
      expect(splitAttackGateClause(text), text).toBeNull();
      expect(splitAttackTrailingClause(text), text).toBeNull();
    }
  });

  it('the `", and "` JOIN is unreachable by the trailing splitter — the reason 6g is ONE arm', () => {
    expect(splitAttackTrailingClause(KO6_HEAD)).toBeNull();
    expect(deriveAttackEffect("Knock Out your opponent's Active Pokémon.")).toBeNull();
    // …and the CONVERSE, so the boundary is doing the work rather than the shape:
    // spell the same two halves as two SENTENCES and the splitter takes it.
    const twoSentences = `${COST2_HEAD} Discard 3 Energy from this Pokémon.`;
    expect(splitAttackTrailingClause(twoSentences)).toEqual({
      head: COST2_HEAD,
      tail: "Discard 3 Energy from this Pokémon.",
    });
  });

  it("the MEMBER: `matchesFilter`'s predicate over the OWN hand, and its note", () => {
    expect(conditionNote(need(6))).toBe(
      "you have at least 6 Basic Grass Energy cards in your hand",
    );
    expect(conditionNote(need(1))).toBe("you have a Basic Grass Energy card in your hand");
    // …so it does NOT round-trip to the printed head, which is asserted rather than
    // left to be "fixed" by a successor: the table is keyed on an IMPERATIVE
    // sentence, this is a CONDITION clause, and the two are different sentences.
    expect(conditionNote(need(1))).not.toBe(COST1_HEAD);
  });
});

describe("§2 — the guard the widening owes: the row's DIGIT is the row's COUNT", () => {
  it("over EVERY row of `ATTACK_CANCEL_HEADS`, the printed count and the value agree", () => {
    const rows = attackCancelHeadRows();
    expect(rows.length).toBe(5);
    const counted = rows.filter(([, cond]) => "count" in cond);
    expect(counted.length).toBe(4);
    for (const [key, cond] of counted) {
      const printed = /^Discard (\d+|a) /.exec(key)?.[1];
      const value = printed === "a" ? 1 : Number(printed);
      expect([key, value]).toEqual([key, (cond as { count: number }).count]);
    }
    // CONVERSE — every key carrying a DIGIT has a value with a `count`, and every
    // digit in that key is that count. (A key that named two different numbers would
    // pass the forward leg on its first one.)
    for (const [key, cond] of rows) {
      const digits = key.match(/\d+/g) ?? [];
      if (digits.length === 0) continue;
      expect(["count" in cond, key]).toEqual([true, key]);
      expect([key, [...new Set(digits)]]).toEqual([
        key,
        [String((cond as { count: number }).count)],
      ]);
    }
    expect(rows.filter(([, cond]) => !("count" in cond)).map(([key]) => key)).toEqual([
      "Discard a Stadium in play.",
    ]);
  });

  it("the CLAUSE's restated digit equals the requirement it produces, over the corpus", () => {
    const claimed = corpus().filter(([, s]) => deriveAttackCancelRequirement(s) !== null);
    let restated = 0;
    for (const [, s] of claimed) {
      const clause = splitAttackCancelClause(s)?.clause ?? "";
      const digit = /discard (\d+) cards in this way/.exec(clause)?.[1];
      if (digit === undefined) continue;
      restated += 1;
      const cond = deriveAttackCancelRequirement(s);
      expect([s, Number(digit)]).toEqual([s, (cond as { count: number }).count]);
    }
    expect(restated).toBe(2);
  });
});

describe("§3 — REAL BOARDS: the cancel fires, the payable case pays, and 30 is the proof", () => {
  it.each(SEEDS.flatMap((seed) => CASES.map((c) => [seed, c.name, c.id, c.count] as const)))(
    "seed %i — %s SHORT BY ONE: the attack does NOTHING and the cost is NOT paid",
    (seed, _name, id, count) => {
      const before = board(seed, id, count - 1);
      expect(grassIn(before, "p1", "hand")).toBe(count - 1);
      const uid = before.players.p1.active?.stack[0];
      if (uid === undefined) throw new Error("expected P1's Active");
      const discardBefore = before.players.p1.discard.length;

      const result = attack(before);
      const state = result.state;

      expect(findEvent(result.events, "ATTACK_FAILED")).toEqual({
        type: "ATTACK_FAILED",
        seat: "p1",
        uid,
        reason: "requirement",
      });
      expect(types(result.events)).not.toContain("DAMAGE_DEALT");
      expect(types(result.events)).not.toContain("COUNTERS_PLACED");
      expect(types(result.events)).not.toContain("KNOCKED_OUT");
      expect(state.players.p2.active?.damage).toBe(0);
      // …and NOTHING WAS PAID: the short hand is intact, the discard did not grow.
      expect(types(result.events)).not.toContain("HAND_COST_PAID");
      expect(grassIn(state, "p1", "hand")).toBe(count - 1);
      expect(grassIn(state, "p1", "discard")).toBe(0);
      expect(state.players.p1.discard).toHaveLength(discardBefore);
      expect(state.phase.kind).not.toBe("effect:choose");
      // The sentence was SIMULATED — a cancelled attack is not a skipped effect.
      expect(types(result.events)).not.toContain("ATTACK_EFFECT_SKIPPED");
      expect(types(result.events)).toContain("TURN_ENDED");
      expect(state.phase).toEqual({ kind: "turn:action", seat: "p2" });
    },
  );

  it.each(SEEDS.flatMap((seed) => CASES.map((c) => [seed, c.name, c.id, c.count, c.kos] as const)))(
    "seed %i — %s EXACTLY PAYABLE: the cost is paid out of the HAND and the head resolves",
    (seed, _name, id, count, kos) => {
      const before = board(seed, id, count);
      expect(grassIn(before, "p1", "hand")).toBe(count);
      // The attacker's printed {G} is paid by an ATTACHED copy — a different zone.
      expect(before.players.p1.active?.energy).toHaveLength(1);

      const result = attack(before);
      const state = result.state;

      expect(types(result.events)).not.toContain("ATTACK_FAILED");
      expect(findEvent(result.events, "DAMAGE_DEALT")?.dealt).toBe(30);
      expect(findEvent(result.events, "HAND_COST_PAID")?.uids).toHaveLength(count);
      expect(findEvent(result.events, "HAND_COST_PAID")?.to).toBe("discard");
      expect(grassIn(state, "p1", "hand")).toBe(0);
      expect(grassIn(state, "p1", "discard")).toBe(count);
      expect(state.players.p1.active?.energy).toHaveLength(1);
      // The payment resolves INLINE — `count` interchangeable cards is no decision.
      expect(state.phase.kind).not.toBe("effect:choose");
      expect(types(result.events)).not.toContain("ATTACK_EFFECT_SKIPPED");
      expect(types(result.events).includes("KNOCKED_OUT")).toBe(kos);
      if (!kos) expect(state.players.p2.active?.damage).toBe(30);
      // …and the ORDER is the printed one: pay, then hit, then Knock Out.
      const order = types(result.events);
      expect(order.indexOf("HAND_COST_PAID")).toBeGreaterThan(order.indexOf("DAMAGE_DEALT"));
      if (kos) expect(order.indexOf("HAND_COST_PAID")).toBeLessThan(order.indexOf("KNOCKED_OUT"));
    },
  );

  it.each(SEEDS)(
    "seed %i — a SURPLUS hand pays exactly the printed count and asks nothing",
    (seed) => {
      // 8 in hand against a printed 6: `handCostCandidates` collapses interchangeable
      // copies to `count`, so there is no decision and the park is never reached.
      const result = attack(board(seed, KO6_ID, 8));
      expect(findEvent(result.events, "HAND_COST_PAID")?.uids).toHaveLength(6);
      expect(grassIn(result.state, "p1", "hand")).toBe(2);
      expect(grassIn(result.state, "p1", "discard")).toBe(6);
      expect(result.state.phase.kind).not.toBe("effect:choose");
      expect(types(result.events)).toContain("KNOCKED_OUT");
    },
  );

  it.each(SEEDS)("seed %i — the CONTROL: an UNMAPPED count stays LOUD and is NOT gated", (seed) => {
    const result = attack(board(seed, UNMAPPED_ID, 0));
    expect(types(result.events)).not.toContain("ATTACK_FAILED");
    expect(types(result.events)).not.toContain("HAND_COST_PAID");
    expect(findEvent(result.events, "ATTACK_EFFECT_SKIPPED")).toMatchObject({
      effect: UNMAPPED_TEXT,
    });
    expect(findEvent(result.events, "DAMAGE_DEALT")?.dealt).toBe(30);
  });

  it.each(SEEDS)("seed %i — the MEMBER, read off the same board it gates", (seed) => {
    // `conditionHolds` on the real hand, both sides of the threshold — so the gate's
    // answer is a board fact rather than an inference from the events above.
    const short = board(seed, KO6_ID, 5);
    const exact = board(seed, KO6_ID, 6);
    expect(conditionHolds(short, "p1", need(6))).toBe(false);
    expect(conditionHolds(exact, "p1", need(6))).toBe(true);
    expect(short.players.p1.active?.energy).toHaveLength(1);
    expect(conditionHolds(short, "p2", need(6))).toBe(false);
    // The wrong TYPE does not pay either — the printed noun is a card CLASS plus a
    // printed type, and `matchesFilter` is what enforces both.
    expect(
      conditionHolds(exact, "p1", {
        kind: "yourBasicEnergyInHandAtLeast",
        energy: "Fire",
        count: 1,
      }),
    ).toBe(false);
  });
});

describe("§4 — THE STRUCTURAL GUARD: a hand cost in an attack program owes a cancel", () => {
  /** `attack.ts`'s stripper chain, in the site's order, followed by the same
      composition it does — so this is the program the SEAM derives and not the
      program a single reader would. */
  function programOf(text: string): readonly EffectOp[] | null {
    const gated = splitAttackGateClause(text)?.body ?? text;
    const required = splitAttackRequirementClause(gated)?.body ?? gated;
    const uncancelled = splitAttackCancelClause(required)?.head ?? required;
    const compound = splitAttackTrailingClause(uncancelled);
    const head = compound === null ? uncancelled : compound.head;
    const derivedHead = head === "" ? null : deriveAttackEffect(head);
    const derivedTail = compound === null ? null : deriveAttackEffect(compound.tail);
    if (derivedTail === null) return derivedHead;
    return [...(derivedHead ?? []), ...derivedTail];
  }

  function carriesHandCost(value: unknown): boolean {
    if (Array.isArray(value)) return value.some(carriesHandCost);
    if (typeof value !== "object" || value === null) return false;
    const record = value as Record<string, unknown>;
    if (record.op === "payFromHand") return true;
    return Object.values(record).some(carriesHandCost);
  }

  function handCostIsSlotGated(program: readonly EffectOp[] | null): boolean {
    if (program === null || program.length !== 2) return false;
    const [cost, gate] = program;
    if (cost === undefined || gate === undefined) return false;
    if (cost.op !== "payFromHand" || cost.recordAs === undefined) return false;
    if (gate.op !== "recordGate" || gate.slot !== cost.recordAs) return false;
    // A payment nested inside the branch is a SECOND cost, and the gate says nothing
    // about it — `handCostUnmet`'s own "not compositional" scope note, one seam over.
    return !carriesHandCost(gate);
  }

  function handCostIsSlotScaled(program: readonly EffectOp[] | null): boolean {
    if (program === null || program.length !== 2) return false;
    const [cost, scale] = program;
    if (cost === undefined || scale === undefined) return false;
    if (cost.op !== "payFromHand" || cost.count !== "any" || cost.recordAs === undefined) {
      return false;
    }
    // The two shipped ops that read a §9.2 slot as a MULTIPLIER. Listed by op rather
    // than probed structurally, so a third scale-by-slot op has to be classified here
    // instead of inheriting an exemption written before it existed.
    const readsSlot =
      (scale.op === "damageChosen" && scale.perRecorded === cost.recordAs) ||
      (scale.op === "damageDefender" && scale.count === cost.recordAs);
    if (!readsSlot) return false;
    return !carriesHandCost(scale);
  }

  it("NO derived attack program carries a `payFromHand` without a CANCEL or a SLOT GATE", () => {
    const offenders: string[] = [];
    for (const [n, text] of corpus()) {
      const program = programOf(text);
      if (!carriesHandCost(program)) continue;
      if (deriveAttackCancelRequirement(text) !== null) continue;
      if (handCostIsSlotGated(program)) continue;
      if (handCostIsSlotScaled(program)) continue;
      offenders.push(`(${n}) ${text}`);
    }
    // Named rather than summed: the day this fires the message is the sentence.
    expect(offenders).toEqual([]);
  });

  it("the guard is NOT VACUOUS — it is measured over 6 sentences / 7 printings, split by WHICH escape", () => {
    const paying = corpus().filter(([, text]) => carriesHandCost(programOf(text)));
    expect([paying.length, units(paying)]).toEqual([7, 9]);
    expect(paying.map(([, s]) => s).sort()).toEqual(
      [KO6, COST2, COST1, DRAW2, DRAW3, HAND_SCALED, GATED_OPPONENT_DISCARD].sort(),
    );
    const cancelled = paying.filter(([, s]) => deriveAttackCancelRequirement(s) !== null);
    const gated = paying.filter(([, s]) => handCostIsSlotGated(programOf(s)));
    const scaled = paying.filter(([, s]) => handCostIsSlotScaled(programOf(s)));
    expect(cancelled.map(([, s]) => s).sort()).toEqual([KO6, COST2, COST1].sort());
    expect(gated.map(([, s]) => s).sort()).toEqual([DRAW2, DRAW3, GATED_OPPONENT_DISCARD].sort());
    expect(scaled.map(([, s]) => s)).toEqual([HAND_SCALED]);
    expect(cancelled.length + gated.length + scaled.length).toBe(paying.length);
    for (const [, s] of cancelled) {
      expect(handCostIsSlotGated(programOf(s)), s).toBe(false);
      expect(handCostIsSlotScaled(programOf(s)), s).toBe(false);
    }
    for (const [, s] of gated) {
      expect(deriveAttackCancelRequirement(s), s).toBeNull();
      expect(handCostIsSlotScaled(programOf(s)), s).toBe(false);
    }
    for (const [, s] of scaled) {
      expect(deriveAttackCancelRequirement(s), s).toBeNull();
      expect(handCostIsSlotGated(programOf(s)), s).toBe(false);
    }
  });

  it("the SLOT SCALE exemption is not a hole — five near-misses on one axis each are still offenders", () => {
    const admitted = deriveAttackEffect(HAND_SCALED);
    expect(handCostIsSlotScaled(admitted)).toBe(true);
    const pay = (over: Record<string, unknown>): EffectOp =>
      ({
        op: "payFromHand",
        count: "any",
        cap: 3,
        to: "discard",
        filter: { kind: "anyEnergy" },
        recordAs: "discarded",
        ...over,
      }) as EffectOp;
    const hit = (over: Record<string, unknown>): EffectOp =>
      ({
        op: "damageChosen",
        target: "opponentAny",
        amount: 60,
        count: 1,
        source: "attack",
        deals: true,
        perRecorded: "discarded",
        ...over,
      }) as EffectOp;
    expect(handCostIsSlotScaled([pay({}), { op: "knockOutDefender" }])).toBe(false);
    // (b) the payment files NOTHING, so the scale can only ever read a stale or empty
    //     slot — the same axis §4's (a) drives on the gate.
    expect(handCostIsSlotScaled([pay({ recordAs: undefined }), hit({})])).toBe(false);
    // (c) the scale reads a DIFFERENT slot, so it is not this payment it multiplies.
    expect(handCostIsSlotScaled([pay({}), hit({ perRecorded: "paid" })])).toBe(false);
    // (d) an UNSCALED op after the pair — bought free, whatever the pair does.
    expect(handCostIsSlotScaled([pay({}), hit({}), { op: "knockOutDefender" }])).toBe(false);
    expect(handCostIsSlotScaled([pay({ count: 2, cap: undefined }), hit({})])).toBe(false);
  });

  it("the SLOT GATE exemption is not a hole — four near-misses on one axis each are still offenders", () => {
    const admitted = deriveAttackEffect(DRAW2);
    expect(handCostIsSlotGated(admitted)).toBe(true);
    // (a) the payment files nothing, so the gate can never hold — a silent whiff
    //     wearing a gated sentence's shape.
    expect(
      handCostIsSlotGated([
        { op: "payFromHand", count: 1, to: "discard" },
        { op: "recordGate", slot: "paid", then: [{ op: "drawCards", count: 2 }] },
      ]),
    ).toBe(false);
    // (b) the gate reads a DIFFERENT slot — it fires off some other op's filing, so
    //     the draw is not gated on this payment at all.
    expect(
      handCostIsSlotGated([
        { op: "payFromHand", count: 1, to: "discard", recordAs: "paid" },
        { op: "recordGate", slot: "moved", then: [{ op: "drawCards", count: 2 }] },
      ]),
    ).toBe(false);
    expect(
      handCostIsSlotGated([
        { op: "payFromHand", count: 1, to: "discard", recordAs: "paid" },
        { op: "recordGate", slot: "paid", then: [{ op: "drawCards", count: 2 }] },
        { op: "knockOutDefender" },
      ]),
    ).toBe(false);
    // (d) a SECOND payment nested in the branch — the gate answers for the first
    //     cost and says nothing whatever about the second.
    expect(
      handCostIsSlotGated([
        { op: "payFromHand", count: 1, to: "discard", recordAs: "paid" },
        {
          op: "recordGate",
          slot: "paid",
          then: [pay(6), { op: "knockOutDefender" }],
        },
      ]),
    ).toBe(false);
  });

  it("the DEEP walk really is deep — a wrapped payment is still found", () => {
    // The negative control for `carriesHandCost`. A top-level scan (the shape
    // `handCostUnmet` itself uses, and for its own stated reason) answers FALSE here,
    // so the guard would sail past the exact build it forbids.
    const wrapped: EffectOp[] = [
      {
        op: "conditionGate",
        cond: need(2),
        then: [pay(2)],
      },
    ];
    expect(carriesHandCost(wrapped)).toBe(true);
    expect(wrapped.some((op) => op.op === "payFromHand")).toBe(false);
    // …and it does not answer TRUE for everything, which is the other half.
    expect(carriesHandCost([{ op: "knockOutDefender" }])).toBe(false);
    expect(carriesHandCost(null)).toBe(false);
  });
});

describe("§5 — the whole legal column: what this slice claims, and what it does not", () => {
  it("the cancel reader claims 4 sentences / 5 printings, and names all four", () => {
    const claimed = corpus().filter(([, s]) => deriveAttackCancelRequirement(s) !== null);
    expect([claimed.length, units(claimed)]).toEqual([4, 5]);
    expect(claimed.map(([, s]) => s).sort()).toEqual([ETERNATUS, KO6, COST2, COST1].sort());
  });

  it("the ANAPHORIC family is now claimed WHOLE, and the anti-saturation rung", () => {
    const anaphoric = corpus().filter(([, s]) => s.endsWith(BARE_CLAUSE));
    expect([anaphoric.length, units(anaphoric)]).toEqual([2, 2]);
    for (const [, s] of anaphoric) expect(deriveAttackCancelRequirement(s), s).not.toBeNull();
    expect(deriveAttackCancelRequirement(UNMAPPED_TEXT)).toBeNull();
    const claimed = corpus().filter(([, s]) => deriveAttackCancelRequirement(s) !== null).length;
    expect(claimed).toBeLessThan(corpus().length);
  });

  it("the two requirement readers are STILL mutually exclusive over all 1,732 units", () => {
    const all = corpus();
    expect(all.length).toBe(640);
    expect(units(all)).toBe(1732);
    const both = all.filter(
      ([, s]) => deriveAttackRequirement(s) !== null && deriveAttackCancelRequirement(s) !== null,
    );
    expect([both.length, units(both)]).toEqual([0, 0]);
    // …and the leading reader is unmoved by the widening, which is the control that
    // says the two anchors did not start overlapping.
    const leading = all.filter(([, s]) => deriveAttackRequirement(s) !== null);
    expect([leading.length, units(leading)]).toEqual([9, 18]);
  });
});
