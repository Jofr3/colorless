import { describe, expect, it } from "vitest";
import { legalAttackCorpus } from "./censusAttackCorpus";
import * as effects from "./effects";
import { deriveAttackEffect, splitAttackTrailingClause } from "./effects";
import type { EffectOp } from "./effects";
import { applyAction, engineVersion } from "./index";
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

// 0.313.0 → 0.314.0 — 🆕🆕 D409: THE TRAILING-CLAUSE COMPOSITION PATH, AND THE
// FIRST TIME THIS ENGINE READS ONE PRINTED STRING AS TWO CLAUSES.
//
// 🛑 THE SHAPE QUESTION CAME FIRST (D368) AND IT DECIDED EVERYTHING ELSE. The
// residue held FIVE sentences / ELEVEN printings whose every clause is already
// read independently and which no reader claims as a whole. Two answers were
// available: five more hand-written whole-sentence anchors, or ONE splitter plus
// ONE composition site. The splitter won, and it won on a MEASUREMENT rather than
// on taste — §2 below runs the predicate over the whole committed
// `legal_standard = 1` attack column (640 sentences / 1,732 printings) and it
// admits exactly those five and NOTHING ELSE. A per-sentence anchor buys its own
// printing; this buys the five and every future compound whose clauses this file
// already reads.
//
// ⚠️ THE HAND-ANCHOR ROUTE ALSO LOST ON PRICE, AND THE PRICE IS NOT FIVE REGEXES.
// Two of the five put a `deriveAttackDamageBonus` clause in FRONT of a
// `deriveAttackEffect` one (8 of the 11 printings), and the two readers return
// DIFFERENT KINDS — a bonus that `attack.ts` folds into §8.5 and an `EffectOp[]`
// that runs after it. As whole-sentence anchors those two sentences need an arm in
// BOTH readers, each tolerating the other's clause: four arms for two sentences,
// and two readers made mutually aware of each other's grammar forever.
//
// 🛑 AND THE FALSIFIER THAT DID NOT FIRE, RE-DERIVED RATHER THAN INHERITED. The
// handoff warned that a composition path which only concatenates `EffectOp[]`
// could not take the two Prize compounds at all. `attack.ts` was OPENED instead of
// reasoned about (D406's rule): the bonus reader and the effect reader are read off
// the SAME string into TWO INDEPENDENT locals there, and nothing has ever stopped
// both from being non-null. So the composition is not "concatenate two op lists" —
// it is "give the HEAD to the readers that were already reading, and append the
// TAIL's ops" — and the cross-reader pair is the easy case rather than the
// impossible one.
//
// SEED-FREE: not one of the five compounds carries a coin, so a seed table would
// describe a shuffle rather than a rule.

/** The five printed compounds, byte for byte off `legalAttackCorpus()`. */
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
const COMPOUNDS = [
  PRIZE_THEN_DISCARD,
  PRIZE_THEN_RECOIL,
  DISCARD_TWO_THEN_REDUCTION,
  DISCARD_ALL_THEN_PARALYZE,
  POISON_THEN_NO_RETREAT,
] as const;

/** The two SHIPPED whole-sentence anchors that are one token away from a member of
    the five — `DEFENDER_POISON_CANT_RETREAT` (arm 5c, the other noun phrase) and
    `SELF_DISCARD_ALL_THEN_REDUCTION` (the other count). They are what makes §5 a
    comparison of two ROUTES rather than a snapshot of one. */
const POISON_THEN_NO_RETREAT_ANCHORED =
  "Your opponent's Active Pokémon is now Poisoned. During your opponent's next turn, that Pokémon can't retreat.";
const DISCARD_ALL_THEN_REDUCTION_ANCHORED =
  "Discard all Energy from this Pokémon. During your opponent's next turn, this Pokémon takes 100 less damage from attacks (after applying Weakness and Resistance).";

/** The printed sentence break this slice reads: a period, then whitespace, then a
    capital or an opening parenthesis. A COPY of `effects.ts`'s
    `COMPOUND_CLAUSE_BREAK`, deliberately — the census rungs below have to be able
    to disagree with the implementation, which a shared import would prevent. */
const BREAK = /(?<=\.)\s+(?=[A-Z(])/;

const units = (rows: readonly (readonly [number, string])[]): number =>
  rows.reduce((sum, [n]) => sum + n, 0);

/** The `deriveAttack`-prefixed reader surface, taken from the MODULE rather than
    from a list (`precociousEvolution.test.ts`'s idiom). */
const EXPORTED_ATTACK_READERS = Object.entries(effects)
  .filter(([name, value]) => name.startsWith("deriveAttack") && typeof value === "function")
  .map(([name]) => name)
  .sort();

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

/** `fix-compound`'s attack indices — the five compounds in census order, then the
    SHIPPED twin of index 4, then the refusal control. */
const PRIZE_DISCARD_INDEX = 0;
const PRIZE_RECOIL_INDEX = 1;
const REDUCTION_INDEX = 2;
const PARALYZE_INDEX = 3;
const POISON_INDEX = 4;
const POISON_ANCHORED_INDEX = 5;
const UNREAD_TAIL_INDEX = 6;

const SEED = 31;

/** P2 opens and passes, so P1's turn 2 carries no §4 attack restriction. */
function board(seed: number, opts: { energy: number; defender?: string }): GameState {
  let state = must(
    applyAction(
      driveSetup(
        seed,
        { p1: COMPOUND_COMPOSE_DECK, p2: COMPOUND_COMPOSE_DECK },
        { first: "p2" },
      ),
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
    // ⚠️ THE TRIPWIRE, and it has fired three times before (D316, D317, D381) and
    // been RE-POINTED rather than relaxed each time. `splitAttackTrailingClause`'s
    // refusal is "no reader claims this whole string" and its admission is "some
    // reader claims the head"; both quantify over `ATTACK_WHOLE_SENTENCE_READERS`
    // in `effects.ts`, and a TWELFTH reader added there and forgotten in that array
    // would make the splitter re-answer a compound that reader already reads whole.
    // Adding one reddens this line by name, and the fix is the array.
    expect(EXPORTED_ATTACK_READERS).toEqual([
      "deriveAttackBonusConsequent",
      "deriveAttackCoinFlip",
      "deriveAttackDamageBonus",
      "deriveAttackDamageMultiplier",
      "deriveAttackDamagePenalty",
      "deriveAttackDamageSuppression",
      "deriveAttackDiscardScaledBoost",
      "deriveAttackEffect",
      "deriveAttackOptionalBoost",
      "deriveAttackOptionalCostBoost",
      "deriveAttackRequirement",
    ]);
  });

  it("🛑 every reader's OWN printed sentence works as a head — the array, driven", () => {
    // 🛑 A COUNT IS A TRIPWIRE; THIS IS THE GUARD. For each of the eleven readers,
    // take the first sentence in the committed column that READER claims and append
    // a tail `deriveAttackEffect` claims. If the reader is in `effects.ts`'s array
    // the splitter admits the pair and hands back that exact head; if it were
    // dropped from the array the head would be claimed by nobody and the splitter
    // would REFUSE — so this goes red by reader name on a dropped entry, which the
    // count above cannot do.
    const tail = "Discard an Energy from this Pokémon.";
    const admitted: string[] = [];
    const shadowed: string[] = [];
    for (const name of EXPORTED_ATTACK_READERS) {
      const read = readerNamed(name);
      const row = legalAttackCorpus().find(([, s]) => s !== tail && read(s) !== null);
      expect(row, `${name} claims no corpus sentence`).toBeDefined();
      const head = (row as readonly [number, string])[1];
      const compound = `${head} ${tail}`;
      const split = splitAttackTrailingClause(compound);
      if (split === null) {
        // ⚠️ NAMED AS EMPTY RATHER THAN SKIPPED (D400). One reader lands here and
        // it is not a hole: `deriveAttackRequirement`'s own anchor tolerates a
        // trailing companion (D363), so it claims the synthetic compound WHOLE and
        // the shadow refusal fires — the anchor winning, which is the design. Drop
        // it from the array and this compound stops being claimed whole, the
        // splitter ADMITS it, and this branch goes red from the other side.
        expect(claimedByAny(compound), `${name}: refused but not shadowed`).toBe(true);
        shadowed.push(name);
        continue;
      }
      expect(split.head, name).toBe(head);
      expect(split.tail, name).toBe(tail);
      admitted.push(name);
    }
    expect(admitted).toHaveLength(10);
    expect(shadowed).toEqual(["deriveAttackRequirement"]);
  });
});

describe("§2 — the census: the predicate admits FIVE sentences / ELEVEN printings", () => {
  it("🛑 exactly the five, over the whole 640-sentence legal column", () => {
    // The measurement that decided the shape. It is the WHOLE column and not the
    // residue, so a sentence some reader already claims cannot hide inside it.
    const corpus = legalAttackCorpus();
    expect(corpus).toHaveLength(640);
    expect(units(corpus)).toBe(1732);
    const admitted = corpus.filter(([, s]) => splitAttackTrailingClause(s) !== null);
    expect([...admitted].map(([, s]) => s).sort()).toEqual([...COMPOUNDS].sort());
    expect(admitted).toHaveLength(5);
    expect(units(admitted)).toBe(11);
  });

  it("the eleven split 8 / 3 across the two SHAPES, which is why the seam had to move", () => {
    // 8 of the 11 are the CROSS-READER pair (a `deriveAttackDamageBonus` head), 3
    // are SAME-READER (a `deriveAttackEffect` head). Named because the price
    // argument in the header rests on it: a concatenate-only composition path would
    // have taken the 3 and left the 8, turning a 5/11 slice into a 3/3 one.
    const corpus = legalAttackCorpus();
    const admitted = corpus.filter(([, s]) => splitAttackTrailingClause(s) !== null);
    const cross = admitted.filter(([, s]) => {
      const head = (splitAttackTrailingClause(s) as { head: string }).head;
      return deriveAttackEffect(head) === null;
    });
    expect(cross).toHaveLength(2);
    expect(units(cross)).toBe(8);
    expect(units(admitted) - units(cross)).toBe(3);
    // …and every one of the eleven has EXACTLY TWO clauses, which is why the
    // splitter is not recursive: a three-clause compound whose parts are all
    // readable is a family of ZERO today and stays LOUD until it is not.
    for (const [, s] of admitted) expect(s.split(BREAK), s).toHaveLength(2);
  });

  it("every clause of every one of the five is claimed INDEPENDENTLY", () => {
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
  it("🛑 ZERO of the 640 sentences are split inside parentheses", () => {
    // ⚠️ THE NAMED FALSIFIER THAT DID NOT FIRE, WITH ITS NUMBER WRITTEN DOWN. The
    // handoff's second field was that the catalog prints periods inside
    // parentheticals, so the split would need a parenthesis-aware SCANNER rather
    // than a regex. It does print them — 54 sentences / 114 printings carry a `.`
    // inside parentheses — and the regex splits NONE of them, because
    // `(?<=\.)\s+(?=[A-Z(])` needs whitespace and a capital after the period and
    // the parenthetical periods are all sentence-final ("…(Discard all cards
    // attached to this Pokémon.)"). A scanner would be a function written for a
    // population of zero. THE DAY THAT STOPS BEING TRUE THIS RUNG GOES RED.
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
    // The single near-miss, named: "(Pokémon ex, Pokémon V, etc. have Rule Boxes.)"
    // — the word after that period is LOWERCASE, so `(?=[A-Z(])` is what keeps it
    // whole. Widen the lookahead to `.` and this sentence starts splitting mid
    // parenthetical, which is the mistake this rung exists to catch.
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
  it("🛑 145 sentences / 415 printings are multi-clause AND claimed whole — all refused", () => {
    // 🛑 THE GUARD THAT MAKES THIS SAFE TO SHIP. Without `claimedByAnyReader(text)`
    // in front of the split, every one of these would be re-answered by composition
    // instead of by the whole-sentence anchor its author wrote — the same program
    // in the lucky cases and a different one in the rest, with nothing able to tell
    // which. `SELF_DISCARD_ONE_THEN_DEFENDER_LOCK`, `DEFENDER_POISON_CANT_RETREAT`,
    // `COUNTER_PUT_ANY_THEN_SELF_LOCK` and `SELF_DISCARD_ALL_THEN_REDUCTION` are
    // four of the 145. Delete the refusal and this rung goes red 145 times.
    const corpus = legalAttackCorpus();
    const multiClause = corpus.filter(([, s]) => s.split(BREAK).length >= 2);
    expect(multiClause).toHaveLength(271);
    expect(units(multiClause)).toBe(613);
    const claimedWhole = multiClause.filter(([, s]) => claimedByAny(s));
    expect(claimedWhole).toHaveLength(145);
    expect(units(claimedWhole)).toBe(415);
    for (const [, s] of claimedWhole) expect(splitAttackTrailingClause(s), s).toBeNull();
  });

  it("an UNREADABLE tail refuses the whole compound — the cost never ships alone", () => {
    // The family's safety property, spelled per clause. The head here is a sentence
    // `deriveAttackDamageBonus` claims and the tail is an old-era phrasing NO
    // reader claims, so the compound stays LOUD in full. A prefix match would fold
    // the +50 and silently drop the rider.
    const head = "This attack does 50 more damage for each Prize card your opponent has taken.";
    const unreadable = "The Defending Pokémon is now Asleep.";
    expect(claimedByAny(unreadable)).toBe(false);
    expect(claimedByAny(head)).toBe(true);
    expect(splitAttackTrailingClause(`${head} ${unreadable}`)).toBeNull();
  });

  it("🛑 a tail claimed only by a DAMAGE reader refuses — the fold has nowhere to go", () => {
    // 🛑 THE MIRROR OF THE RUNG ABOVE, AND IT IS A RULE RATHER THAN A CATALOG FACT.
    // The tail guard names `deriveAttackEffect` SPECIFICALLY, not "any reader", and
    // the reason is structural: the five damage readers are all given the HEAD, so
    // a trailing clause only THEY claim would be accounted for by the splitter and
    // then applied by nobody — the cost-without-the-payoff failure, arriving
    // through the guard meant to prevent it.
    //
    // ⚠️ WRITTEN BECAUSE THE MUTANT SURVIVED WITHOUT IT. Widening that guard to
    // `claimedByAnyReader(tail)` changes NOTHING on the committed column — the
    // printed compounds all put the damage clause FIRST — so every census rung in
    // this file stayed green on a splitter that would silently swallow a trailing
    // fold. The catalog cannot discriminate this; a synthetic compound built from
    // two PRINTED sentences in the other order can, and does.
    const head = "Discard an Energy from this Pokémon.";
    const tail = "This attack does 50 more damage for each Prize card your opponent has taken.";
    // Both halves are real printed clauses of the column, in the order the catalog
    // does not currently print them. ⚠️ NAMED PRECISELY (D400): the HEAD is a
    // standalone printing, and the TAIL is not — it is the LEADING clause of the
    // two Prize compounds this slice takes, which is exactly why the order matters
    // and why the catalog cannot tell these two guards apart on its own.
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
    expect(splitAttackTrailingClause(`The Defending Pokémon is now Asleep. ${readableTail}`)).toBeNull();
    expect(splitAttackTrailingClause(readableTail)).toBeNull();
    expect(splitAttackTrailingClause("")).toBeNull();
  });
});

describe("§5 — the two SHIPPED twins: composition and anchor must agree byte for byte", () => {
  it("🛑 the poison compound composes into `DEFENDER_POISON_CANT_RETREAT`'s program", () => {
    // 🛑 THE STRONGEST RUNG IN THIS FILE, AND IT ANSWERS THE HANDOFF'S THIRD
    // QUESTION. The column prints this rule with TWO noun phrases — "that Pokémon"
    // (arm 5c, shipped since D120) and "the Defending Pokémon" (this slice). The
    // question was whether to take the second by widening 5c's character class or
    // by the splitter, and the answer is the splitter BECAUSE THIS EQUALITY IS
    // CHECKABLE: widening 5c would have produced one program from one regex and
    // proved nothing, while composing the halves and comparing against the shipped
    // anchor is a claim that can go RED from either side. Change either arm and the
    // two programs diverge.
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

  it("🛑 the 2-Energy reduction composes into `SELF_DISCARD_ALL_THEN_REDUCTION`'s shape", () => {
    // The SECOND twin, one token over on the other axis: the shipped anchor reads
    // the "all" count and this slice's compound reads "2". Everything but `count`
    // must be identical, which is a sharper claim than "both are two ops" — it says
    // the composition reuses the SAME two producers rather than resembling them.
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
    // The two Prize compounds have a head `deriveAttackEffect` REFUSES (it is a
    // damage-bonus clause), so the composed op list is the TAIL alone — the fold
    // lives in `attack.ts`'s `damageBonus` local, and §6 is where the two halves
    // are seen together.
    expect(compose(PRIZE_THEN_DISCARD)).toEqual([
      { op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" } },
    ]);
    expect(compose(PRIZE_THEN_RECOIL)).toEqual([{ op: "damageSelf", amount: 30 }]);
  });
});

describe("§6 — the BOARDS: a fold and an op off ONE printed string", () => {
  it("🛑 the Prize compound folds the +50/Prize AND discards the Energy", () => {
    // 🛑 THE CASE THE WHOLE SLICE IS FOR. One printed string, two readers, two
    // effects on one board: p2 has taken 2 Prizes → 50 × 2 = 100 folded onto the
    // printed base 40 → 140, and the trailing clause then discards one of the
    // attacker's Energy. Before this slice NEITHER happened — the compound was
    // refused whole and the attack was reported ATTACK_EFFECT_SKIPPED with its "+"
    // unexplained. Revert the rebind at `attack.ts`'s `compoundSplit` and the fold
    // disappears; revert the `derivedTail` concatenation and the discard does.
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
    // ⚠️ D214's ATTRIBUTION CONTROL. "Bounty" prints the LEADING clause of the two
    // Prize compounds ALONE, so it is claimed WHOLE by `deriveAttackDamageBonus`
    // and the splitter never sees it. If the rebind had changed what the damage
    // readers are given on an ordinary single-sentence printing, this case is where
    // it would show — 629 of the 640 sentences take that path.
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

  it("🛑 the UNREADABLE tail keeps the whole compound LOUD, fold and all", () => {
    // The refusal, on a board. `fix-compound` index 6 prints the same +50/Prize head
    // with an old-era trailing sentence no reader claims, so nothing is folded and
    // nothing is applied — the printed "+" is reported unexplained beside the whole
    // string. This is the direction a "too loose" split fails in, and the case that
    // makes §4's unit refusal a fact about the engine rather than about a function.
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
  it("🛑 the TAIL rides `EffectContinuation.rest` across a park", () => {
    // 🛑 THE ONE PLACE THIS SLICE REACHES A SAVED RECORD, AND IT IS DRIVEN RATHER
    // THAN ARGUED. `discardEnergy` PARKS when the choice is real, so on the
    // 2-Energy compound the trailing `reduceDamage` is still unrun when the state is
    // handed back — it rides `phase.cont.rest`, which is persisted. That is a fact
    // about the field, so the question is whether `rest` can already carry it, and
    // it can: `SELF_DISCARD_ALL_THEN_REDUCTION` has shipped the SAME two ops in the
    // same order since 0.x, so a v25 record could already hold exactly this
    // continuation. Composition put nothing new into one.
    // ⚠️ TWO {C} AND ONE {R}, NOT THREE {C}. `interchangeableCandidates` collapses
    // identical Energy and `forcedDiscards` then takes the set inline, so three
    // identical {C} produce NO continuation at all — the park this rung inspects
    // only exists when the pick is a real decision. Measured, not assumed: the
    // three-identical board resolves to `turn:action` with both ops already run.
    let state = attachFromDeck(board(SEED + 6, { energy: 2 }), "p1", "fix-fire-energy", 1);
    const { state: parked } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: REDUCTION_INDEX,
    });
    expect(parked.phase.kind).toBe("effect:choose");
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(parked.phase.prompt.kind).toBe("discardEnergy");
    // THE ASSERTION THE SLICE OWES: the trailing clause's op is in `rest`.
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
    // ⚠️ NOT AN EXPORTED CONSTANT (D406), so the claim is DRIVEN. The composition
    // introduces no `EffectOp` inhabitant and no field: every op the five compounds
    // produce is already produced today by the SAME clause read alone, and the only
    // one that parks (`discardEnergy`) already rides a continuation whose `rest` a
    // shipped anchor fills with the very same `reduceDamage`.
    for (const text of COMPOUNDS) {
      const split = splitAttackTrailingClause(text);
      expect(split, text).not.toBeNull();
      const parts = text.split(BREAK);
      expect(ops((split as { tail: string }).tail)).toEqual(ops(parts[1] as string));
      const headOps = ops((split as { head: string }).head);
      expect(headOps).toEqual(ops(parts[0] as string));
    }
  });

  it("the engine version moved with the behaviour", () => {
    expect(engineVersion).toBe("0.314.0");
  });
});

describe("§8 — the fixture IS the deck, and the deck is 60", () => {
  it("`fix-compound` prints the five compounds at the indices this suite names", () => {
    const card = FIXTURE_POOL["fix-compound"];
    expect(card).toBeDefined();
    expect(card?.stage).toBe("Basic");
    expect(card?.hp).toBe(340);
    expect(card?.attacks).toHaveLength(7);
    const effectAt = (i: number): string => card?.attacks?.[i]?.effect ?? "";
    expect(effectAt(PRIZE_DISCARD_INDEX)).toBe(PRIZE_THEN_DISCARD);
    expect(effectAt(PRIZE_RECOIL_INDEX)).toBe(PRIZE_THEN_RECOIL);
    expect(effectAt(REDUCTION_INDEX)).toBe(DISCARD_TWO_THEN_REDUCTION);
    expect(effectAt(PARALYZE_INDEX)).toBe(DISCARD_ALL_THEN_PARALYZE);
    expect(effectAt(POISON_INDEX)).toBe(POISON_THEN_NO_RETREAT);
    expect(effectAt(POISON_ANCHORED_INDEX)).toBe(POISON_THEN_NO_RETREAT_ANCHORED);
    // …and every one of the five is a sentence the COLUMN prints, byte for byte.
    const printed = new Set(legalAttackCorpus().map(([, s]) => s));
    for (const s of COMPOUNDS) expect(printed.has(s), s).toBe(true);
    expect(printed.has(POISON_THEN_NO_RETREAT_ANCHORED)).toBe(true);
    // 🛑 AND THE OTHER TWIN IS *NOT* IN THIS COLUMN, WHICH IS A RESULT RATHER THAN
    // AN OVERSIGHT — NAMED AS EMPTY (D400). `SELF_DISCARD_ALL_THEN_REDUCTION` was
    // measured against the SIX-SET local D1 (978 cards / 6 sets) and its printing is
    // not `legal_standard = 1` today, while its "Discard 2" twin — the one this
    // slice composes — IS. Two populations, two answers, and the anchor is still
    // right about its own. §5 compares the two ROUTES rather than their legality.
    expect(printed.has(DISCARD_ALL_THEN_REDUCTION_ANCHORED)).toBe(false);
    expect(deriveAttackEffect(DISCARD_ALL_THEN_REDUCTION_ANCHORED)).not.toBeNull();
  });

  it("the deck is 60 cards and the pool holds every id in it", () => {
    expect(COMPOUND_COMPOSE_DECK).toHaveLength(60);
    for (const id of new Set(COMPOUND_COMPOSE_DECK)) expect(FIXTURE_POOL[id]).toBeDefined();
  });
});
