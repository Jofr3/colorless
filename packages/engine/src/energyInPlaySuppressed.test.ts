import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import { countEnergyInPlay } from "./continuous";
import * as effectsModule from "./effects";
import {
  deriveAttackDamageBonus,
  deriveAttackDamageSuppression,
  deriveAttackEffect,
  splitAttackCancelClause,
  splitAttackGateClause,
  splitAttackRequirementClause,
  splitAttackTrailingClause,
} from "./effects";
import { applyAction, createGame, logFromEvents } from "./index";
import type { BoardCondition, GameState } from "./index";
import { conditionHolds, conditionNote } from "./interpreter";
import {
  completeSetup,
  attachBenchFromDeck,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  setActiveFromDeck,
  typedEnergy,
  must,
  findEvent,
} from "./testFixtures";

const PRINTED =
  "If you have 3 or more Energy in play, this attack does 70 more damage. This attack's damage isn't affected by Weakness.";
const HEAD = "If you have 3 or more Energy in play, this attack does 70 more damage.";
const TAIL = "This attack's damage isn't affected by Weakness.";
const BUILT_SIBLING = "If you have at least 3 {D} Energy in play, this attack does 50 more damage.";
const CLAUSE = "you have 3 or more Energy in play";

const RSQUO = "’";
const curly = (text: string): string => text.replaceAll("'", RSQUO);

const ATTACKER = "d494-attacker";
const RESERVE = "d494-reserve";
const WALL = "d494-wall";
const WATER = "d494-water";
const DARK = "d494-dark";

const LOCAL_CARDS: Record<string, Card> = {
  [ATTACKER]: battler(ATTACKER, {
    name: "D494 Threshold Drake",
    hp: 200,
    types: ["Water"],
    attacks: [{ cost: ["Colorless"], name: "Surging Reserve", damage: "100+", effect: PRINTED }],
  }),
  [RESERVE]: battler(RESERVE, { name: "D494 Reserve", hp: 90 }),
  [WALL]: battler(WALL, {
    name: "D494 Wall",
    hp: 400,
    weaknesses: [{ type: "Water", value: "×2" }],
    resistances: [{ type: "Water", value: "-30" }],
  }),
  [WATER]: typedEnergy(WATER, "Water"),
  [DARK]: typedEnergy(DARK, "Darkness"),
};

const POOL: Record<string, Card> = { ...LOCAL_CARDS };

const DECK = deckOf({
  [ATTACKER]: 4,
  [RESERVE]: 8,
  [WALL]: 4,
  [WATER]: 32,
  [DARK]: 12,
});

const SEEDS = [4940, 4941, 4943] as const;

/** `benchCounterSuppressed.test.ts`'s `localSetup`, verbatim in shape: `driveSetup`
    builds its game through `mustCreate`, which reads `FIXTURE_POOL`, so a local pool
    needs its own drive. p2 opens and passes, so p1 carries no §4 first-turn bar. */
function localSetup(seed: number): GameState {
  const created = createGame({ seed, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(
    applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first: "p2" }),
  );
  state = completeSetup(state);
  return must(applyAction(state, { type: "endTurn", seat: "p2" }));
}

function board(
  seed: number,
  opts: { benchDark?: boolean; opponentEnergy?: number } = {},
): GameState {
  const benchDark = opts.benchDark ?? true;
  const opponentEnergy = opts.opponentEnergy ?? 0;
  // The shared surgery helpers in `testFixtures.ts` are ZONE MOVERS that consult no
  // pool at all — they read `state.cardIdByUid` — so a locally-created game uses them
  // unchanged. Only the SETUP drive had to be local.
  let state = setActiveFromDeck(localSetup(seed), "p1", ATTACKER);
  state = clearBench(state, "p1");
  state = attachFromDeck(state, "p1", WATER, 1);
  state = benchFromDeck(state, "p1", RESERVE);
  state = attachBenchFromDeck(state, "p1", 0, WATER, 1);
  if (benchDark) state = attachBenchFromDeck(state, "p1", 0, DARK, 1);
  state = setActiveFromDeck(state, "p2", WALL);
  state = clearBench(state, "p2");
  if (opponentEnergy > 0) state = attachFromDeck(state, "p2", WATER, opponentEnergy);
  return state;
}

function swing(state: GameState) {
  const result = applyAction(state, { type: "attack", seat: "p1", index: 0 });
  if (!result.ok) throw new Error(`attack failed: ${result.error.code} ${result.error.message}`);
  return result;
}

const readerByName = effectsModule as unknown as Record<string, (t: string) => unknown>;
const claimedByAny = (s: string): boolean =>
  attackReaderSurface().some((n) => (readerByName[n]?.(s) ?? null) !== null);
const units = (rows: readonly (readonly [number, string])[]): number =>
  rows.reduce((sum, [n]) => sum + n, 0);

// ─────────────────────────────────────────────────────────────────────────────
describe("§1 — the specimens ARE corpus rows, at their committed printing counts", () => {
  it("the printed sentence is `legalAttackCorpus()` FILE LINE 337, 1 legal printing", () => {
    const rows = legalAttackCorpus().filter(([, s]) => s === PRINTED);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.[0]).toBe(1);
    const sibling = legalAttackCorpus().filter(([, s]) => s === BUILT_SIBLING);
    expect(sibling).toHaveLength(1);
    expect(sibling[0]?.[0]).toBe(1);
    expect(legalAttackCorpus().filter(([, s]) => s === HEAD)).toEqual([]);
    expect(legalAttackCorpus().filter(([, s]) => s === TAIL)).toEqual([]);
    expect(POOL[ATTACKER]?.attacks?.[0]?.effect).toBe(PRINTED);
    expect(POOL[ATTACKER]?.attacks?.[0]?.damage).toBe("100+");
    expect(PRINTED.startsWith(`If ${CLAUSE}, `)).toBe(true);
  });

  it("`Energy in play` is exactly these TWO rows in the whole column", () => {
    const inPlay = legalAttackCorpus().filter(([, s]) => s.includes("Energy in play"));
    expect(inPlay.map(([, s]) => s).sort()).toEqual([PRINTED, BUILT_SIBLING].sort());
    expect(units(inPlay)).toBe(2);
  });
});

describe("§2 — TWO readers own it, and the other eleven still refuse", () => {
  it("the fold and the suppression, by VALUE, with the refusals kept beside them", () => {
    expect(deriveAttackDamageBonus(PRINTED)).toEqual({
      per: 70,
      count: {
        kind: "boardCondition",
        cond: { kind: "yourEnergyInPlayAtLeast", energy: null, count: 3 },
      },
    });
    expect(deriveAttackDamageSuppression(PRINTED)).toEqual({ weakness: true });
    expect(resolvedByAnyReader(PRINTED)).toBe(true);
    const owners = ["deriveAttackDamageBonus", "deriveAttackDamageSuppression"];
    for (const name of attackReaderSurface()) {
      if (owners.includes(name)) continue;
      expect(readerByName[name]?.(PRINTED) ?? null, name).toBeNull();
    }
    expect(attackReaderSurface()).toHaveLength(14);
    // …and no splitter serves it either, so the claim is genuinely WHOLE-SENTENCE.
    expect(splitAttackRequirementClause(PRINTED)).toBeNull();
    expect(splitAttackCancelClause(PRINTED)).toBeNull();
    expect(splitAttackGateClause(PRINTED)).toBeNull();
    expect(splitAttackTrailingClause(PRINTED)).toBeNull();
  });

  it("the COMPOUND's fold is the HEAD's fold — two anchors that cannot drift apart", () => {
    // One arm, two anchors, the sibling's capture order: the clause lookup, the printed
    // zero guard and the returned member are literally the same code.
    expect(deriveAttackDamageBonus(PRINTED)).toEqual(deriveAttackDamageBonus(HEAD));
  });

  it("this is a dual-claimed sentence, and the population is FIVE ( D550; FOUR since D539) — all on purpose", () => {
    const dual = legalAttackCorpus().filter(
      ([, s]) =>
        attackReaderSurface().filter((n) => (readerByName[n]?.(s) ?? null) !== null).length > 1,
    );
    expect(dual.map(([, s]) => s)).toContain(PRINTED);
    expect(dual).toHaveLength(5);
  });
});

describe("§3 — the axis lattice and the fork, measured over all 640 rows", () => {
  const QUANT = ["3 or more", "at least 3"] as const;
  const TYPE = ["Energy", "{D} Energy"] as const;
  const TAILS = [
    ` ${TAIL}`,
    " This attack's damage isn't affected by Weakness or Resistance.",
    "",
  ] as const;
  const point = (q: number, t: number, tl: number): string =>
    `If you have ${QUANT[q]} ${TYPE[t]} in play, this attack does 70 more damage.${TAILS[tl]}`;

  it("EXACTLY ONE of the twelve points builds, and it is the all-three substitution", () => {
    const NEW_ANCHOR =
      /^If (.+), this attack does (\d+) more damage\. This attack['’]s damage isn['’]t affected by Weakness\.$/;
    const NEW_CLAUSE = `If ${CLAUSE}, `;
    const beforeSlice = (s: string): boolean =>
      claimedByAny(s) && !NEW_ANCHOR.test(s) && !s.startsWith(NEW_CLAUSE);
    const built: string[] = [];
    const moved: string[] = [];
    for (let q = 0; q < 2; q++)
      for (let t = 0; t < 2; t++)
        for (let tl = 0; tl < 3; tl++) {
          const s = point(q, t, tl);
          if (beforeSlice(s)) built.push(`${q}${t}${tl}`);
          if (!beforeSlice(s) && claimedByAny(s)) moved.push(`${q}${t}${tl}`);
        }
    expect(moved.sort()).toEqual(["000", "002", "110"]);
    expect(built).toEqual(["112"]);
    expect(point(1, 1, 2)).toBe(
      "If you have at least 3 {D} Energy in play, this attack does 70 more damage.",
    );
    expect(deriveAttackDamageBonus(BUILT_SIBLING.replace("50 more", "70 more"))).not.toBeNull();
  });

  it("(QUANTIFIER) ALONE frees NOTHING — no column row prints `N or more ⟨typed⟩ Energy in play`", () => {
    const hits = legalAttackCorpus().filter(([, s]) =>
      /\d+ or more \{[A-Z]\} Energy in play/.test(s),
    );
    expect(hits).toEqual([]);
  });

  it("(TYPE) ALONE frees NOTHING — no column row prints `at least N Energy in play` untyped", () => {
    const hits = legalAttackCorpus().filter(([, s]) => /at least \d+ Energy in play/.test(s));
    expect(hits).toEqual([]);
  });

  it("(QUANTIFIER + TYPE) ALONE frees NOTHING — the HEAD is printed standalone ZERO times", () => {
    expect(legalAttackCorpus().filter(([, s]) => s === HEAD)).toEqual([]);
    const asHead = legalAttackCorpus().filter(([, s]) => s !== HEAD && s.startsWith(`${HEAD} `));
    expect(asHead.map(([, s]) => s)).toEqual([PRINTED]);
    expect(units(asHead)).toBe(1);
  });

  it("(TAIL) ALONE frees NOTHING — the bare clause is printed standalone ZERO times", () => {
    expect(legalAttackCorpus().filter(([, s]) => s === TAIL)).toEqual([]);
    const asTail = legalAttackCorpus().filter(([, s]) => s !== TAIL && s.endsWith(` ${TAIL}`));
    expect(asTail).toHaveLength(2);
    expect(asTail.map(([, s]) => s)).toContain(PRINTED);
    for (const [, s] of asTail) expect(claimedByAny(s), s).toBe(true);
  });

  it("(COMPOSITION) ALONE frees NOTHING — no residue compound has a claimed head + suppression tail", () => {
    const BREAK = /(?<=\.)\s+(?=[A-Z(])/;
    const wouldCompose = legalAttackCorpus().filter(([, s]) => {
      if (claimedByAny(s)) return false;
      if (splitAttackTrailingClause(s) !== null) return false;
      const parts = s.split(BREAK);
      if (parts.length < 2) return false;
      const tail = parts[parts.length - 1] ?? "";
      const head = parts.slice(0, -1).join(" ");
      return claimedByAny(head) && claimedByAny(tail) && deriveAttackEffect(tail) === null;
    });
    expect(wouldCompose).toEqual([]);
  });

  it("ALL OF THEM TOGETHER free exactly the ONE row this anchor frees", () => {
    const pairWouldFree = legalAttackCorpus().filter(
      ([, s]) => s.startsWith(`If ${CLAUSE}, `) && s.endsWith(` ${TAIL}`),
    );
    expect(pairWouldFree.map(([, s]) => s)).toEqual([PRINTED]);
    expect(units(pairWouldFree)).toBe(1);
  });
});

describe("§4 — the anchor's TIGHT tail buys what a LOOSE one would, and looser is a DEFECT", () => {
  it("three spellings of the tail, measured over all 640 rows (D472)", () => {
    const HEAD_SRC = "If (.+), this attack does (\\d+) more damage\\.";
    const tight = new RegExp(
      `^${HEAD_SRC} This attack['’]s damage isn['’]t affected by Weakness\\.$`,
    );
    const alternation = new RegExp(
      `^${HEAD_SRC} This attack['’]s damage isn['’]t affected by (?:Weakness or Resistance|Resistance|Weakness)\\.$`,
    );
    for (const re of [tight, alternation]) {
      const hits = legalAttackCorpus().filter(([, s]) => re.test(s));
      expect(
        hits.map(([, s]) => s),
        re.source,
      ).toEqual([PRINTED]);
      expect(units(hits), re.source).toBe(1);
    }
    const loose = new RegExp(`^${HEAD_SRC} (.+)$`);
    const looseHits = legalAttackCorpus().filter(([, s]) => loose.test(s));
    expect(looseHits).toHaveLength(2);
    const extra = looseHits.map(([, s]) => s).filter((s) => s !== PRINTED);
    expect(extra).toEqual([
      "If a Stadium is in play, this attack does 60 more damage. Then, discard that Stadium.",
    ]);
    // …and that sentence is BUILT today, by a different reader, which is what makes the
    // loose anchor a collision rather than a widening.
    expect(claimedByAny(extra[0] ?? "")).toBe(true);
  });

  it("the two anchors are STRUCTURALLY disjoint, so the order is legibility (D467/D468)", () => {
    const bare = /^If (.+), this attack does (\d+) more damage\.$/;
    const compound =
      /^If (.+), this attack does (\d+) more damage\. This attack['’]s damage isn['’]t affected by Weakness\.$/;
    for (const [, s] of legalAttackCorpus()) {
      expect(bare.test(s) && compound.test(s), s).toBe(false);
    }
  });
});

describe("§5 — the board, and every wrong reading answers a different number", () => {
  it.each(SEEDS)("the printed answer is 140 on seed %i", (seed) => {
    const result = swing(board(seed));
    const dealt = findEvent(result.events, "DAMAGE_DEALT");
    // 100 printed + 70 scaled = 170, Weakness SUPPRESSED, Resistance −30 applied.
    expect(dealt?.dealt).toBe(140);
    expect(dealt?.scaled).toBe(70);
    expect(dealt?.weakness).toBeNull();
    expect(dealt?.resistance).not.toBeNull();
    expect(result.state.players.p2.active?.damage).toBe(140);
  });

  it("the condition is a FLOOR over the whole SIDE, counting CARDS", () => {
    const state = board(SEEDS[0]);
    const cond: BoardCondition = { kind: "yourEnergyInPlayAtLeast", energy: null, count: 3 };
    // The printed reading: Active + Bench, no type asked.
    expect(countEnergyInPlay(state, "p1", null)).toBe(3);
    expect(conditionHolds(state, "p1", cond)).toBe(true);
    expect(countEnergyInPlay(state, "p1", "Water")).toBe(2);
    expect(countEnergyInPlay(state, "p1", "Darkness")).toBe(1);
    expect(conditionHolds(state, "p1", { ...cond, energy: "Water" })).toBe(false);
    expect(conditionHolds(state, "p1", { ...cond, energy: "Darkness" })).toBe(false);
    expect(state.players.p1.active?.energy).toHaveLength(1);
    expect(countEnergyInPlay(state, "p2", null)).toBe(0);
    expect(conditionHolds(state, "p2", cond)).toBe(false);
    // The FLOOR, driven at the boundary: `>=` holds at exactly 3 and `>` would not.
    expect(conditionHolds(state, "p1", { ...cond, count: 4 })).toBe(false);
  });

  it("the bonus WITHHELD is 70 damage, and 0 is a value in the signature (D472)", () => {
    // Two Energy in play: the clause is false, the fold contributes nothing, and the
    // suppression still fires — 100 − 30. Without this board the suite could not tell
    // "the bonus applied" from "the reader answered a constant".
    const result = swing(board(SEEDS[0], { benchDark: false }));
    const dealt = findEvent(result.events, "DAMAGE_DEALT");
    expect(dealt?.dealt).toBe(70);
    expect(dealt?.scaled).toBeUndefined();
    expect(dealt?.weakness).toBeNull();
  });

  it("the SEAT is the attacker's, and the inversion is visible on ONE board", () => {
    const state = board(SEEDS[0], { benchDark: false, opponentEnergy: 5 });
    expect(countEnergyInPlay(state, "p1", null)).toBe(2);
    expect(countEnergyInPlay(state, "p2", null)).toBe(5);
    const dealt = findEvent(swing(state).events, "DAMAGE_DEALT");
    expect(dealt?.dealt).toBe(70);
  });
});

describe("§6 — the LOG row, rendered rather than reasoned about (D456)", () => {
  it("\u26a0\ufe0f the row prints the scaled bonus and the Resistance, and NO Weakness crumb", () => {
    const result = swing(board(SEEDS[0]));
    const rows = logFromEvents(result.events, {
      names: { p1: "Ash", p2: "Gary" },
      state: result.state,
      elapsed: "+00:00",
    })
      .filter((e) => e.kind === "action")
      .map((e) => (e.kind === "action" ? e.segments.map((seg) => seg.text).join("") : ""));
    expect(rows).toContain(
      "dealt 140 damage to D494 Wall \u00b7 scaled +70 \u00b7 resistance \u221230",
    );
    const withoutWall = rows.find((r) => r.includes("dealt"));
    expect(withoutWall?.includes("weakness")).toBe(false);
  });
});

describe("§7 — the clause vocabulary, and the caption arm that nothing can render", () => {
  it("`conditionNote` answers the untyped branch, and it round-trips to the print", () => {
    // A wrong branch here is SILENT — `${null} Energy` interpolates to "null Energy" and
    // `tsc` says nothing — so it is driven directly rather than left to a board.
    const cond: BoardCondition = { kind: "yourEnergyInPlayAtLeast", energy: null, count: 3 };
    expect(conditionNote(cond)).toBe("you have at least 3 Energy in play");
    expect(conditionNote(cond)).not.toBe(CLAUSE);
    expect(CLAUSE).toBe("you have 3 or more Energy in play");
    expect(conditionNote(cond).includes("null")).toBe(false);
    expect(conditionNote({ ...cond, energy: "Darkness" })).toBe(
      "you have at least 3 Darkness Energy in play",
    );
    expect(conditionNote({ ...cond, energy: "special" })).toBe(
      "you have at least 3 Special Energy in play",
    );
  });

  it("the caption is OWED and UNRENDERABLE, and that is asserted rather than claimed (D446)", () => {
    const emitted: string[] = [];
    for (const [, text] of legalAttackCorpus()) {
      const program = deriveAttackEffect(text);
      if (program !== null) emitted.push(JSON.stringify(program));
    }
    expect(emitted.some((s) => s.includes("yourEnergyInPlayAtLeast"))).toBe(false);
  });
});

describe("§8 — the standalone tail is STILL refused, and three shipped rungs rest on that", () => {
  it("`DAMAGE_SUPPRESSION` is byte-unchanged: the bare clause alone derives to null", () => {
    expect(deriveAttackDamageSuppression(TAIL)).toBeNull();
    expect(claimedByAny(TAIL)).toBe(false);
    const unread =
      "If you have 3 or more Rainbow Badges in play, this attack does 70 more damage. This attack's damage isn't affected by Weakness.";
    expect(deriveAttackDamageBonus(unread)).toBeNull();
    expect(deriveAttackDamageSuppression(unread)).toBeNull();
    expect(claimedByAny(unread)).toBe(false);
    // …and a printed ZERO is refused by the same shared guard, on both anchors.
    expect(deriveAttackDamageBonus(PRINTED.replace("70 more", "0 more"))).toBeNull();
    expect(deriveAttackDamageSuppression(PRINTED.replace("70 more", "0 more"))).toBeNull();
  });

  it("the `^` end and the `$` end fail DIFFERENTLY, and only one is loud (D464)", () => {
    expect(
      deriveAttackDamageSuppression(PRINTED.replace(". This attack's", ". this attack's")),
    ).toBeNull();
    expect(deriveAttackDamageSuppression(PRINTED.replace(/\.$/, ""))).toBeNull();
    // \u2460 THE `^` END IS LOUD. Leading text is claimed by nobody, so
    // `ATTACK_EFFECT_SKIPPED` fires and a `toBeNull` can say so — on BOTH readers,
    // because they share the anchor and therefore share its ends.
    expect(deriveAttackDamageSuppression(`Draw a card. ${PRINTED}`)).toBeNull();
    expect(deriveAttackDamageBonus(`Draw a card. ${PRINTED}`)).toBeNull();
    expect(claimedByAny(`Draw a card. ${PRINTED}`)).toBe(false);
    expect(deriveAttackDamageBonus(`${PRINTED} Draw a card.`)).toBeNull();
    expect(splitAttackTrailingClause(`${PRINTED} Draw a card.`)).toEqual({
      head: PRINTED,
      tail: "Draw a card.",
    });
  });
});

describe("§9 — the U+2019 fold, on BOTH readers", () => {
  it("reads the curly spelling IDENTICALLY, and not merely non-null", () => {
    expect(deriveAttackDamageSuppression(curly(PRINTED))).toEqual(
      deriveAttackDamageSuppression(PRINTED),
    );
    expect(deriveAttackDamageBonus(curly(PRINTED))).toEqual(deriveAttackDamageBonus(PRINTED));
    expect(deriveAttackDamageBonus(curly(PRINTED))).not.toBeNull();
    expect(curly(PRINTED).split(RSQUO)).toHaveLength(3);
    expect(HEAD.includes("'")).toBe(false);
  });
});

describe("§10 — `MATCH_RECORD_VERSION` stays 29, and the slice has TWO addresses", () => {
  it("the READING has no carrier; the widened FIELD has one and is a WIDENING", () => {
    const after = swing(board(SEEDS[0])).state;
    const bytes = JSON.stringify(after);
    for (const needle of ["boardCondition", "yourEnergyInPlayAtLeast"]) {
      expect(bytes.includes(needle), needle).toBe(false);
    }
    // What a saved record DOES hold is the printed SENTENCE, re-derived at every
    // declaration — so a v29 record's bytes are byte-identical before and after.
    expect(bytes.includes(PRINTED)).toBe(true);
    expect(after.players.p2.active?.damage).toBe(140);
    // …and no continuation was written at all: this program parks nowhere.
    expect(after.phase.kind).not.toBe("effect:choose");
    const v29 = { kind: "yourEnergyInPlayAtLeast", energy: "Darkness", count: 3 } as const;
    const rebuilt = JSON.parse(JSON.stringify(v29)) as BoardCondition;
    expect(conditionHolds(after, "p1", rebuilt)).toBe(false); // 2 {W} + 1 {D} in play
    expect(conditionHolds(after, "p1", { ...v29, energy: null })).toBe(true);
    // …and the two answers DIFFER on this board, which is what makes the widening a real
    // inhabitant rather than a synonym for the old one.
    expect(conditionHolds(after, "p1", rebuilt)).not.toBe(
      conditionHolds(after, "p1", { ...v29, energy: null }),
    );
  });
});
