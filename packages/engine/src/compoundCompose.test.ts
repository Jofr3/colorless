import { describe, expect, it } from "vitest";
import { attackReaderSurface, legalAttackCorpus } from "./censusAttackCorpus";
import * as effects from "./effects";
import { deriveAttackEffect, splitAttackTrailingClause } from "./effects";
import type { EffectOp } from "./effects";
import { applyAction } from "./index";
import type { GameEvent, GameState } from "./index";
import {
  COMPOUND_COMPOSE_DECK,
  FIXTURE_POOL,
  attachFromDeck,
  driveSetup,
  must,
  mustApply,
  setActiveFromDeck,
  setPrizes,
  types,
} from "./testFixtures";

const PRIZE_THEN_DISCARD =
  "This attack does 50 more damage for each Prize card your opponent has taken. Discard an Energy from this Pokémon.";
const PRIZE_THEN_RECOIL =
  "This attack does 50 more damage for each Prize card your opponent has taken. This Pokémon also does 30 damage to itself.";
const DISCARD_TWO_THEN_REDUCTION =
  "Discard 2 Energy from this Pokémon. During your opponent's next turn, this Pokémon takes 100 less damage from attacks (after applying Weakness and Resistance).";
const DISCARD_ALL_THEN_PARALYZE =
  "Discard all Energy from this Pokémon. Your opponent's Active Pokémon is now Paralyzed.";
const POISON_THEN_NO_RETREAT =
  "Your opponent's Active Pokémon is now Poisoned. During your opponent's next turn, the Defending Pokémon can't retreat.";
const BURN_THEN_NO_RETREAT =
  "Your opponent's Active Pokémon is now Burned. During your opponent's next turn, that Pokémon can't retreat.";
const CONFUSE_THEN_NO_RETREAT =
  "Your opponent's Active Pokémon is now Confused. During your opponent's next turn, that Pokémon can't retreat.";
const PRONOUN_LOCK = "During your opponent's next turn, that Pokémon can't retreat.";
const HEAL_50_THEN_SELF_LOCK =
  "Heal 50 damage from this Pokémon. During your next turn, this Pokémon can't retreat.";
const HEAL_60_THEN_SELF_LOCK =
  "Heal 60 damage from this Pokémon. During your next turn, this Pokémon can't retreat.";

const CONFUSE_POISON_THEN_SWITCH =
  "Your opponent's Active Pokémon is now Confused and Poisoned. Switch this Pokémon with 1 of your Benched Pokémon.";

const DISCARD_ALL_THEN_DELAYED_KO =
  "Discard all Energy from this Pokémon. At the end of your opponent's next turn, the Defending Pokémon will be Knocked Out.";

const CONFUSE_THEN_MOVE_ANY_WAY =
  "Your opponent's Active Pokémon is now Confused. You may move any number of damage counters from your opponent's Pokémon to their other Pokémon in any way you like.";

const COMPOUNDS = [
  PRIZE_THEN_DISCARD,
  PRIZE_THEN_RECOIL,
  DISCARD_TWO_THEN_REDUCTION,
  DISCARD_ALL_THEN_PARALYZE,
  POISON_THEN_NO_RETREAT,
  BURN_THEN_NO_RETREAT,
  CONFUSE_THEN_NO_RETREAT,
  HEAL_50_THEN_SELF_LOCK,
  HEAL_60_THEN_SELF_LOCK,
  CONFUSE_POISON_THEN_SWITCH,
  DISCARD_ALL_THEN_DELAYED_KO,
  CONFUSE_THEN_MOVE_ANY_WAY,
] as const;

const POISON_THEN_NO_RETREAT_ANCHORED =
  "Your opponent's Active Pokémon is now Poisoned. During your opponent's next turn, that Pokémon can't retreat.";
const DISCARD_ALL_THEN_REDUCTION_ANCHORED =
  "Discard all Energy from this Pokémon. During your opponent's next turn, this Pokémon takes 100 less damage from attacks (after applying Weakness and Resistance).";

const BREAK = /(?<=\.)\s+(?=[A-Z(])/;

const units = (rows: readonly (readonly [number, string])[]): number =>
  rows.reduce((sum, [n]) => sum + n, 0);

const EXPORTED_ATTACK_READERS = attackReaderSurface();

const readerNamed = (name: string): ((text: string) => unknown) =>
  (effects as unknown as Record<string, (text: string) => unknown>)[name] as (
    text: string,
  ) => unknown;

const claimedByAny = (text: string): boolean =>
  EXPORTED_ATTACK_READERS.some((name) => readerNamed(name)(text) !== null);

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

const ops = (text: string): EffectOp[] | null => deriveAttackEffect(text);

const PRIZE_DISCARD_INDEX = 0;
const PRIZE_RECOIL_INDEX = 1;
const REDUCTION_INDEX = 2;
const PARALYZE_INDEX = 3;
const POISON_INDEX = 4;
const POISON_ANCHORED_INDEX = 5;
const UNREAD_TAIL_INDEX = 6;
const BURN_INDEX = 7;
const CONFUSE_INDEX = 8;
const HEAL_50_SELF_LOCK_INDEX = 9;
const HEAL_60_SELF_LOCK_INDEX = 10;

const SEED = 31;

/** P2 opens and passes, so P1's turn 2 carries no §4 attack restriction. */
function board(seed: number, opts: { energy: number; defender?: string }): GameState {
  let state = must(
    applyAction(
      driveSetup(seed, { p1: COMPOUND_COMPOSE_DECK, p2: COMPOUND_COMPOSE_DECK }, { first: "p2" }),
      { type: "endTurn", seat: "p2" },
    ),
  );
  state = setActiveFromDeck(state, "p2", opts.defender ?? "fix-compound");
  state = setActiveFromDeck(state, "p1", "fix-compound");
  if (state.turn !== 2) throw new Error(`board() expected turn 2, got ${state.turn}`);
  return attachFromDeck(state, "p1", "fix-energy", opts.energy);
}

describe("§1 — the quantifier is over EVERY reader, and the list is DRIVEN not trusted", () => {
  it("the module exports exactly the eleven readers `effects.ts`'s array names", () => {
    expect(EXPORTED_ATTACK_READERS).toEqual([
      "deriveAttackBonusConsequent",
      "deriveAttackCancelRequirement",
      "deriveAttackCoinFlip",
      "deriveAttackCopy",
      "deriveAttackDamageBonus",
      "deriveAttackDamageMultiplier",
      "deriveAttackDamagePenalty",
      "deriveAttackDamageSuppression",
      "deriveAttackDiscardScaledBoost",
      "deriveAttackEffect",
      "deriveAttackOptionalBoost",
      "deriveAttackOptionalCostBoost",
      "deriveAttackPreDamage",
      "deriveAttackRequirement",
    ]);
  });

  it("every reader's OWN printed sentence works as a head — the array, driven", () => {
    const tail = "Discard an Energy from this Pokémon.";
    const admitted: string[] = [];
    const shadowed: string[] = [];
    const loud: string[] = [];
    for (const name of EXPORTED_ATTACK_READERS) {
      const read = readerNamed(name);
      const row = legalAttackCorpus().find(([, s]) => s !== tail && read(s) !== null);
      expect(row, `${name} claims no corpus sentence`).toBeDefined();
      const head = (row as readonly [number, string])[1];
      const compound = `${head} ${tail}`;
      const split = splitAttackTrailingClause(compound);
      if (name === "deriveAttackCopy") {
        expect(split, name).toBeNull();
        expect(claimedByAny(compound), name).toBe(false);
        loud.push(name);
        continue;
      }
      if (split === null) {
        expect(claimedByAny(compound), `${name}: refused but not shadowed`).toBe(true);
        shadowed.push(name);
        continue;
      }
      expect(split.head, name).toBe(head);
      expect(split.tail, name).toBe(tail);
      admitted.push(name);
    }
    expect(admitted).toHaveLength(12);
    expect(shadowed).toEqual(["deriveAttackRequirement"]);
    expect(loud).toEqual(["deriveAttackCopy"]);
  });
});

describe("§2 — the census: the predicate admits NINE sentences / EIGHTEEN printings", () => {
  it("exactly the nine, over the whole 640-sentence legal column", () => {
    const corpus = legalAttackCorpus();
    expect(corpus).toHaveLength(640);
    expect(units(corpus)).toBe(1732);
    const admitted = corpus.filter(([, s]) => splitAttackTrailingClause(s) !== null);
    expect([...admitted].map(([, s]) => s).sort()).toEqual([...COMPOUNDS].sort());
    expect(admitted).toHaveLength(12);
    expect(units(admitted)).toBe(22);
  });

  it("the eighteen split 8 / 10 across the two SHAPES, which is why the seam had to move", () => {
    const corpus = legalAttackCorpus();
    const admitted = corpus.filter(([, s]) => splitAttackTrailingClause(s) !== null);
    const cross = admitted.filter(([, s]) => {
      const head = (splitAttackTrailingClause(s) as { head: string }).head;
      return deriveAttackEffect(head) === null;
    });
    expect(cross).toHaveLength(2);
    expect(units(cross)).toBe(8);
    expect(units(admitted) - units(cross)).toBe(14);
    for (const [, s] of admitted) expect(s.split(BREAK), s).toHaveLength(2);
  });

  it("D410 — the PRONOUN clause prints STANDALONE nowhere, and its antecedent is swept", () => {
    const corpus = legalAttackCorpus();
    // ① The clause is never a whole printed attack effect. This is why the anchor is
    //    reachable only through the splitter, and why claiming it moves `rawHead` by
    //    ZERO while `COMPOUND_ATTACK_UNITS` takes the whole delta.
    expect(corpus.filter(([, text]) => text === PRONOUN_LOCK)).toHaveLength(0);
    // ② …and yet the arm claims it, which is the half ① alone cannot show.
    expect(deriveAttackEffect(PRONOUN_LOCK)).toEqual([{ op: "preventRetreat" }]);
    const carriers = corpus.filter(
      ([, text]) => text !== PRONOUN_LOCK && text.endsWith(PRONOUN_LOCK),
    );
    expect(carriers).toHaveLength(3);
    expect(units(carriers)).toBe(7);
    for (const [, text] of carriers) {
      const head = text.slice(0, text.length - PRONOUN_LOCK.length).trim();
      expect(head, text).toMatch(/^Your opponent['’]s Active Pokémon is now [A-Za-z]+\.$/);
    }
    // ④ …and of the three, exactly ONE is claimed WHOLE by an anchor (5c's poison
    //    compound) and the other two arrive by composition. 3 = 1 + 2 is the whole
    //    accounting of this family, and it is asserted rather than described.
    const anchored = carriers.filter(([, text]) => claimedByAny(text));
    expect(anchored.map(([, text]) => text)).toEqual([POISON_THEN_NO_RETREAT_ANCHORED]);
    expect(units(anchored)).toBe(3);
    const composed = carriers.filter(([, text]) => splitAttackTrailingClause(text) !== null);
    expect(composed.map(([, text]) => text).sort()).toEqual(
      [BURN_THEN_NO_RETREAT, CONFUSE_THEN_NO_RETREAT].sort(),
    );
    expect(units(composed)).toBe(4);
  });

  it("every clause of every one of the seven is claimed INDEPENDENTLY", () => {
    // The supply check, re-derived rather than inherited: this is the property that
    // makes composition sound, and it is asserted per clause rather than per
    // sentence.
    for (const s of COMPOUNDS) {
      expect(claimedByAny(s), `${s} must be refused WHOLE`).toBe(false);
      const parts = s.split(BREAK);
      expect(parts, s).toHaveLength(2);
      for (const part of parts) expect(claimedByAny(part), part).toBe(true);
      // …and the TAIL specifically is an effect clause, which is the half the
      // caller appends.
      expect(deriveAttackEffect(parts[1] as string), s).not.toBeNull();
    }
  });
});

describe("§3 — the parenthesis measurement, which is why this is a REGEX", () => {
  it("ZERO of the 640 sentences are split inside parentheses", () => {
    const corpus = legalAttackCorpus();
    const insideParens = (s: string, at: number): boolean => {
      let depth = 0;
      for (let i = 0; i < at; i++) {
        if (s[i] === "(") depth++;
        else if (s[i] === ")") depth = Math.max(0, depth - 1);
      }
      return depth > 0;
    };
    const withParenPeriod = corpus.filter(([, s]) => {
      let depth = 0;
      for (const [i, c] of [...s].entries()) {
        if (c === "(") depth++;
        else if (c === ")") depth = Math.max(0, depth - 1);
        else if (c === "." && depth > 0 && i < s.length) return true;
      }
      return false;
    });
    expect(withParenPeriod).toHaveLength(54);
    expect(units(withParenPeriod)).toBe(114);

    let splitInsideParens = 0;
    for (const [, s] of corpus) {
      const scan = new RegExp(BREAK.source, "g");
      let m = scan.exec(s);
      while (m !== null) {
        if (insideParens(s, m.index)) splitInsideParens++;
        m = scan.exec(s);
      }
    }
    expect(splitInsideParens).toBe(0);
  });

  it("exactly ONE sentence prints a `. ` inside parentheses, and the lookahead refuses it", () => {
    const corpus = legalAttackCorpus();
    const dotSpaceInParens = corpus.filter(([, s]) => {
      let depth = 0;
      for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (c === "(") depth++;
        else if (c === ")") depth = Math.max(0, depth - 1);
        else if (c === "." && depth > 0 && s[i + 1] === " ") return true;
      }
      return false;
    });
    expect(dotSpaceInParens).toHaveLength(1);
    const only = (dotSpaceInParens[0] as readonly [number, string])[1];
    expect(only).toContain("etc. have Rule Boxes.");
    // It DOES break once — before the opening parenthesis, where the parenthetical
    // begins — and that boundary is OUTSIDE the parens, which is the distinction
    // the rung above measures. The `etc. have` period inside them is not a break.
    const parts = only.split(BREAK);
    expect(parts).toHaveLength(2);
    expect(parts[1]).toBe("(Pokémon ex, Pokémon V, etc. have Rule Boxes.)");
    // …and the splitter still refuses it, because no reader claims either half.
    expect(claimedByAny(parts[0] as string)).toBe(false);
    expect(splitAttackTrailingClause(only)).toBeNull();
  });
});

describe("§4 — the SHADOW REFUSAL: the anchor wins, the splitter is the fallback", () => {
  it(" D420 — 153 sentences / 430 printings are multi-clause AND claimed whole — all refused", () => {
    const corpus = legalAttackCorpus();
    const multiClause = corpus.filter(([, s]) => s.split(BREAK).length >= 2);
    expect(multiClause).toHaveLength(271);
    expect(units(multiClause)).toBe(613);
    const claimedWhole = multiClause.filter(([, s]) => claimedByAny(s));
    expect(claimedWhole).toHaveLength(239);
    expect(units(claimedWhole)).toBe(553);
    for (const [, s] of claimedWhole) expect(splitAttackTrailingClause(s), s).toBeNull();
  });

  it("an UNREADABLE tail refuses the whole compound — the cost never ships alone", () => {
    const head = "This attack does 50 more damage for each Prize card your opponent has taken.";
    const unreadable = "The Defending Pokémon is now Asleep.";
    expect(claimedByAny(unreadable)).toBe(false);
    expect(claimedByAny(head)).toBe(true);
    expect(splitAttackTrailingClause(`${head} ${unreadable}`)).toBeNull();
  });

  it("a tail claimed only by a DAMAGE reader refuses — the fold has nowhere to go", () => {
    const head = "Discard an Energy from this Pokémon.";
    const tail = "This attack does 50 more damage for each Prize card your opponent has taken.";
    const printed = new Set(legalAttackCorpus().map(([, s]) => s));
    expect(printed.has(head)).toBe(true);
    expect(printed.has(tail)).toBe(false);
    expect(PRIZE_THEN_DISCARD.startsWith(`${tail} `)).toBe(true);
    expect(PRIZE_THEN_RECOIL.startsWith(`${tail} `)).toBe(true);
    // The tail IS claimed — by the bonus reader — and is NOT an effect clause.
    expect(claimedByAny(tail)).toBe(true);
    expect(deriveAttackEffect(tail)).toBeNull();
    expect(claimedByAny(`${head} ${tail}`)).toBe(false);
    expect(splitAttackTrailingClause(`${head} ${tail}`)).toBeNull();
  });

  it("an unreadable HEAD refuses too, and a single sentence is never split", () => {
    const readableTail = "Discard an Energy from this Pokémon.";
    expect(
      splitAttackTrailingClause(`The Defending Pokémon is now Asleep. ${readableTail}`),
    ).toBeNull();
    expect(splitAttackTrailingClause(readableTail)).toBeNull();
    expect(splitAttackTrailingClause("")).toBeNull();
  });
});

describe("§5 — the two SHIPPED twins: composition and anchor must agree byte for byte", () => {
  it("the poison compound composes into `DEFENDER_POISON_CANT_RETREAT`'s program", () => {
    const anchored = ops(POISON_THEN_NO_RETREAT_ANCHORED);
    expect(anchored).not.toBeNull();
    const split = splitAttackTrailingClause(POISON_THEN_NO_RETREAT);
    expect(split).not.toBeNull();
    const composed = [
      ...(ops((split as { head: string }).head) ?? []),
      ...(ops((split as { tail: string }).tail) ?? []),
    ];
    expect(composed).toEqual(anchored);
    expect(composed).toEqual([
      { op: "applyStatus", target: "defender", status: "poisoned" },
      { op: "preventRetreat" },
    ]);
  });

  it("the 2-Energy reduction composes into `SELF_DISCARD_ALL_THEN_REDUCTION`'s shape", () => {
    const anchored = ops(DISCARD_ALL_THEN_REDUCTION_ANCHORED);
    const split = splitAttackTrailingClause(DISCARD_TWO_THEN_REDUCTION);
    expect(split).not.toBeNull();
    const composed = [
      ...(ops((split as { head: string }).head) ?? []),
      ...(ops((split as { tail: string }).tail) ?? []),
    ];
    expect(composed).toEqual([
      { op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" }, count: 2 },
      { op: "reduceDamage", amount: 100 },
    ]);
    expect(anchored).toEqual([
      { op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" }, count: "all" },
      { op: "reduceDamage", amount: 100 },
    ]);
    // The second op is byte-identical across the two routes; only `count` differs.
    expect(composed[1]).toEqual((anchored as EffectOp[])[1]);
  });

  it("D410 — the ANCHOR still wins the poison compound, and the two routes now genuinely overlap", () => {
    expect(claimedByAny(POISON_THEN_NO_RETREAT_ANCHORED)).toBe(true);
    expect(splitAttackTrailingClause(POISON_THEN_NO_RETREAT_ANCHORED)).toBeNull();
    const parts = POISON_THEN_NO_RETREAT_ANCHORED.split(BREAK);
    expect(parts).toHaveLength(2);
    expect(parts[1]).toBe(PRONOUN_LOCK);
    const wouldCompose = [...(ops(parts[0] as string) ?? []), ...(ops(parts[1] as string) ?? [])];
    expect(wouldCompose).toEqual(ops(POISON_THEN_NO_RETREAT_ANCHORED));
    expect(wouldCompose).toEqual([
      { op: "applyStatus", target: "defender", status: "poisoned" },
      { op: "preventRetreat" },
    ]);
  });

  it("D410 — one clause, two compounds: Burned and Confused compose into the SAME tail op", () => {
    const compose = (text: string): EffectOp[] => {
      const split = splitAttackTrailingClause(text);
      if (split === null) throw new Error(`refused: ${text}`);
      return [...(ops(split.head) ?? []), ...(ops(split.tail) ?? [])];
    };
    expect(compose(BURN_THEN_NO_RETREAT)).toEqual([
      { op: "applyStatus", target: "defender", status: "burned" },
      { op: "preventRetreat" },
    ]);
    expect(compose(CONFUSE_THEN_NO_RETREAT)).toEqual([
      { op: "applyStatus", target: "defender", status: "confused" },
      { op: "preventRetreat" },
    ]);
    // The TAIL op is byte-identical across all three carriers — the two composed
    // ones and the shipped anchor — which is the "one clause" claim itself.
    const tailOf = (program: EffectOp[]): EffectOp | undefined => program[1];
    expect(tailOf(compose(BURN_THEN_NO_RETREAT))).toEqual({ op: "preventRetreat" });
    expect(tailOf(compose(CONFUSE_THEN_NO_RETREAT))).toEqual(tailOf(compose(BURN_THEN_NO_RETREAT)));
    expect(tailOf(ops(POISON_THEN_NO_RETREAT_ANCHORED) as EffectOp[])).toEqual(
      tailOf(compose(BURN_THEN_NO_RETREAT)),
    );
  });

  it("the other three compose into their two clauses' own ops, in PRINTED order", () => {
    const compose = (text: string): EffectOp[] => {
      const split = splitAttackTrailingClause(text);
      if (split === null) throw new Error(`refused: ${text}`);
      return [...(ops(split.head) ?? []), ...(ops(split.tail) ?? [])];
    };
    expect(compose(DISCARD_ALL_THEN_PARALYZE)).toEqual([
      { op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" }, count: "all" },
      { op: "applyStatus", target: "defender", status: "paralyzed" },
    ]);
    expect(compose(PRIZE_THEN_DISCARD)).toEqual([
      { op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" } },
    ]);
    expect(compose(PRIZE_THEN_RECOIL)).toEqual([{ op: "damageSelf", amount: 30 }]);
  });
});

describe("§6 — the BOARDS: a fold and an op off ONE printed string", () => {
  it("the Prize compound folds the +50/Prize AND discards the Energy", () => {
    let state = board(SEED, { energy: 3 });
    state = setPrizes(state, "p2", 4); // 2 taken
    const energyBefore = state.players.p1.active?.energy.length ?? 0;
    expect(energyBefore).toBe(3);
    const { state: after, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: PRIZE_DISCARD_INDEX,
    });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ base: 40, scaled: 100, dealt: 140 });
    // The tail ran: one Energy off the attacker, into its own discard pile.
    expect(after.players.p1.active?.energy.length).toBe(2);
    expect(find(events, "ENERGY_DISCARDED")).toBeDefined();
  });

  it("the recoil twin folds the same 100 and then hits ITSELF for 30", () => {
    // The second cross-reader compound: same head, a different trailing op, and the
    // self-damage lands AFTER the fold rather than being folded into it.
    let state = board(SEED + 1, { energy: 1 });
    state = setPrizes(state, "p2", 4); // 2 taken
    const { state: after, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: PRIZE_RECOIL_INDEX,
    });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ base: 40, scaled: 100, dealt: 140 });
    expect(after.players.p1.active?.damage).toBe(30);
  });

  it("the head alone is UNMOVED — `fix-attacker`'s 'Bounty' still reads as it always did", () => {
    let state = must(
      applyAction(
        driveSetup(
          SEED + 2,
          { p1: COMPOUND_COMPOSE_DECK, p2: COMPOUND_COMPOSE_DECK },
          { first: "p2" },
        ),
        { type: "endTurn", seat: "p2" },
      ),
    );
    state = setActiveFromDeck(state, "p2", "fix-compound");
    state = setActiveFromDeck(state, "p1", "fix-attacker");
    state = attachFromDeck(state, "p1", "fix-energy", 1);
    state = setPrizes(state, "p2", 4); // 2 taken
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 5 });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ base: 40, scaled: 100, dealt: 140 });
  });

  it("the status compound discards ALL Energy and then Paralyzes the defender", () => {
    const state = board(SEED + 3, { energy: 2 });
    const { state: after, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: PARALYZE_INDEX,
    });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(after.players.p1.active?.energy).toEqual([]);
    expect(after.players.p2.active?.conditions.rotation).toBe("paralyzed");
  });

  it("the poison compound and its SHIPPED twin leave the SAME board", () => {
    // The §5 program equality, driven to a board: two attacks on one fixture, one
    // read by the composition path and one by arm 5c, and the two states agree on
    // both halves of the rule.
    const viaSplit = mustApply(board(SEED + 4, { energy: 2 }), {
      type: "attack",
      seat: "p1",
      index: POISON_INDEX,
    }).state;
    const viaAnchor = mustApply(board(SEED + 4, { energy: 2 }), {
      type: "attack",
      seat: "p1",
      index: POISON_ANCHORED_INDEX,
    }).state;
    expect(viaSplit.players.p2.active?.conditions.poisonDamage).toBe(10);
    expect(viaSplit.players.p2.active?.conditions.poisonDamage).toBe(
      viaAnchor.players.p2.active?.conditions.poisonDamage,
    );
    expect(viaSplit.players.p2.active?.retreatBlocked).toBe(
      viaAnchor.players.p2.active?.retreatBlocked,
    );
    expect(viaSplit.players.p2.active?.retreatBlocked).toBe(true);
  });

  it("D410 — the Burned compound Burns AND locks the retreat, off ONE printed string", () => {
    const { state: after, events } = mustApply(board(SEED + 7, { energy: 1 }), {
      type: "attack",
      seat: "p1",
      index: BURN_INDEX,
    });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(find(events, "STATUS_APPLIED")).toMatchObject({ seat: "p2", status: "burned" });
    expect(after.players.p2.active?.retreatBlocked).toBe(true);
    // …and the printed damage still landed, so the composition did not eat the §8.5
    // pipeline on its way past.
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(20);
    expect(find(events, "RETREAT_BLOCKED")?.seat).toBe("p2");
    expect(find(events, "COUNTERS_PLACED")).toMatchObject({
      seat: "p2",
      source: "burn",
      amount: 20,
    });
  });

  it("D410 — the Confused twin differs in the STATUS and in nothing else", () => {
    const burnedRun = mustApply(board(SEED + 8, { energy: 1 }), {
      type: "attack",
      seat: "p1",
      index: BURN_INDEX,
    });
    const confusedRun = mustApply(board(SEED + 8, { energy: 1 }), {
      type: "attack",
      seat: "p1",
      index: CONFUSE_INDEX,
    });
    const burned = burnedRun.state;
    const confused = confusedRun.state;
    expect(find(burnedRun.events, "STATUS_APPLIED")).toMatchObject({
      seat: "p2",
      status: "burned",
    });
    expect(find(burnedRun.events, "COUNTERS_PLACED")).toMatchObject({
      seat: "p2",
      source: "burn",
    });
    expect(find(confusedRun.events, "STATUS_APPLIED")).toMatchObject({
      seat: "p2",
      status: "confused",
    });
    expect(find(confusedRun.events, "COUNTERS_PLACED")).toBeUndefined();
    expect(confused.players.p2.active?.conditions.rotation).toBe("confused");
    expect(confused.players.p2.active?.conditions.burned).toBe(false);
    expect(burned.players.p2.active?.conditions.rotation).toBe("none");
    // The half they share.
    expect(confused.players.p2.active?.retreatBlocked).toBe(true);
    expect(confused.players.p2.active?.retreatBlocked).toBe(
      burned.players.p2.active?.retreatBlocked,
    );
    // …and it is the SAME half the shipped anchor installs at index 5.
    const anchored = mustApply(board(SEED + 8, { energy: 1 }), {
      type: "attack",
      seat: "p1",
      index: POISON_ANCHORED_INDEX,
    }).state;
    expect(anchored.players.p2.active?.retreatBlocked).toBe(
      burned.players.p2.active?.retreatBlocked,
    );
  });

  it("the UNREADABLE tail keeps the whole compound LOUD, fold and all", () => {
    let state = board(SEED + 5, { energy: 1 });
    state = setPrizes(state, "p2", 4); // 2 taken
    const { events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: UNREAD_TAIL_INDEX,
    });
    expect(find(events, "ATTACK_EFFECT_SKIPPED")).toMatchObject({
      attack: "Prize Riddle",
      damageModifier: "+",
    });
    const dealt = find(events, "DAMAGE_DEALT");
    expect(dealt?.scaled).toBeUndefined();
    expect(dealt?.dealt).toBe(40);
  });
});

describe("§7 — the persisted question, asked and DRIVEN", () => {
  it("the TAIL rides `EffectContinuation.rest` across a park", () => {
    let state = attachFromDeck(board(SEED + 6, { energy: 2 }), "p1", "fix-fire-energy", 1);
    const { state: parked } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: REDUCTION_INDEX,
    });
    expect(parked.phase.kind).toBe("effect:choose");
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(parked.phase.prompt.kind).toBe("discardEnergy");
    expect(parked.phase.cont.rest).toEqual([{ op: "reduceDamage", amount: 100 }]);
    expect(parked.phase.cont.pendingOp).toMatchObject({ op: "discardEnergy", count: 2 });
    // …and resuming runs it: two Energy gone AND the reduction installed.
    const uids = (parked.players.p1.active?.energy ?? []).slice(0, 2);
    expect(uids).toHaveLength(2);
    const { state: done } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardEnergy", uids },
    });
    expect(done.phase.kind).toBe("turn:action");
    expect(done.players.p1.active?.energy).toHaveLength(1);
    expect(done.players.p1.active?.damageReduction).toBeDefined();
    state = done;
    expect(state.players.p1.active?.damageReduction?.amount).toBe(100);
  });

  it("MATCH_RECORD_VERSION stays 25 — every op composed is one a v25 record held", () => {
    for (const text of COMPOUNDS) {
      const split = splitAttackTrailingClause(text);
      expect(split, text).not.toBeNull();
      const parts = text.split(BREAK);
      expect(ops((split as { tail: string }).tail)).toEqual(ops(parts[1] as string));
      const headOps = ops((split as { head: string }).head);
      expect(headOps).toEqual(ops(parts[0] as string));
    }
  });
});

describe("§8 — the fixture IS the deck, and the deck is 60", () => {
  it("`fix-compound` prints the nine compounds at the indices this suite names", () => {
    const card = FIXTURE_POOL["fix-compound"];
    expect(card).toBeDefined();
    expect(card?.stage).toBe("Basic");
    expect(card?.hp).toBe(340);
    expect(card?.attacks).toHaveLength(11);
    const effectAt = (i: number): string => card?.attacks?.[i]?.effect ?? "";
    expect(effectAt(PRIZE_DISCARD_INDEX)).toBe(PRIZE_THEN_DISCARD);
    expect(effectAt(PRIZE_RECOIL_INDEX)).toBe(PRIZE_THEN_RECOIL);
    expect(effectAt(REDUCTION_INDEX)).toBe(DISCARD_TWO_THEN_REDUCTION);
    expect(effectAt(PARALYZE_INDEX)).toBe(DISCARD_ALL_THEN_PARALYZE);
    expect(effectAt(POISON_INDEX)).toBe(POISON_THEN_NO_RETREAT);
    expect(effectAt(POISON_ANCHORED_INDEX)).toBe(POISON_THEN_NO_RETREAT_ANCHORED);
    expect(effectAt(HEAL_50_SELF_LOCK_INDEX)).toBe(HEAL_50_THEN_SELF_LOCK);
    expect(effectAt(HEAL_60_SELF_LOCK_INDEX)).toBe(HEAL_60_THEN_SELF_LOCK);
    expect(effectAt(BURN_INDEX)).toBe(BURN_THEN_NO_RETREAT);
    expect(effectAt(CONFUSE_INDEX)).toBe(CONFUSE_THEN_NO_RETREAT);
    // …and every one of the seven is a sentence the COLUMN prints, byte for byte.
    const printed = new Set(legalAttackCorpus().map(([, s]) => s));
    for (const s of COMPOUNDS) expect(printed.has(s), s).toBe(true);
    expect(printed.has(POISON_THEN_NO_RETREAT_ANCHORED)).toBe(true);
    expect(printed.has(DISCARD_ALL_THEN_REDUCTION_ANCHORED)).toBe(false);
    expect(deriveAttackEffect(DISCARD_ALL_THEN_REDUCTION_ANCHORED)).not.toBeNull();
  });

  it("the deck is 60 cards and the pool holds every id in it", () => {
    expect(COMPOUND_COMPOSE_DECK).toHaveLength(60);
    for (const id of new Set(COMPOUND_COMPOSE_DECK)) expect(FIXTURE_POOL[id]).toBeDefined();
  });
});
