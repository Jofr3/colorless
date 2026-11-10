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
  splitAttackCancelClause,
  splitAttackGateClause,
  splitAttackRequirementClause,
  splitAttackTrailingClause,
} from "./effects";
import type { CardFilter, DamageCountSource } from "./effectTypes";
import { applyAction } from "./index";
import type { EffectOp, GameState, Seat } from "./index";
import { countPokemonInPlay } from "./boardCondition";
import { programFor, registryCardIds } from "./registry";
import {
  FIXTURE_POOL,
  IN_PLAY_BODIES_DECK,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  driveSetup,
  must,
  mustApply,
  setActiveFromDeck,
  setBenchDamage,
  setDamage,
  findEvent,
} from "./testFixtures";

const PRINTED =
  "This attack does 50 damage for each of your Pokémon that has any damage counters on it.";

const SPREAD =
  "This attack also does 40 damage to each Benched Pokémon that has any damage counters on it (both yours and your opponent's). (Don't apply Weakness and Resistance for Benched Pokémon.)";

const EACH_ALL =
  "Put 2 damage counters on each of your opponent's Pokémon that has any damage counters on it.";

const CHOSEN =
  "This attack also does 60 damage to 1 of your opponent's Benched Pokémon that has any damage counters on it. (Don't apply Weakness and Resistance for Benched Pokémon.)";

const INDICATOR =
  "If your opponent's Active Pokémon already has any damage counters on it, this attack does 60 more damage.";

const IN_PLAY_MULTIPLY = "This attack does 30 damage for each of your {G} Pokémon in play.";
const IN_PLAY_SCALE = "This attack does 40 more damage for each of your Evolution Pokémon in play.";
const IN_PLAY_FOE = "This attack does 60 damage for each of your opponent's Pokémon ex in play.";

const UNPRINTED_ADDITIVE =
  "This attack does 50 more damage for each of your Pokémon that has any damage counters on it.";

/** The OPPONENT-seat spelling — printed ZERO times, which is why the `(?!opponent)`
    lookahead stays exactly as `IN_PLAY_BODY_MULTIPLY` spells it. Constructed. */
const UNPRINTED_FOE =
  "This attack does 50 damage for each of your opponent's Pokémon that has any damage counters on it.";

/** A NARROWED noun on the same clause — printed ZERO times, and it derives anyway, which is
    what says the filter axis is free rather than spelled. Constructed. */
const UNPRINTED_BASIC =
  "This attack does 50 damage for each of your Basic Pokémon that has any damage counters on it.";

/** THE DERIVED VALUE, spelled once so no case can pass against a hand-copied literal that
    has drifted from what this file means by it. */
const READING = {
  per: 50,
  count: { kind: "pokemonInPlay", seat: "you", filter: { kind: "anyPokemon" }, damagedOnly: true },
} as const;

const READERS = [
  deriveAttackBonusConsequent,
  deriveAttackCancelRequirement,
  deriveAttackCoinFlip,
  deriveAttackDamageBonus,
  deriveAttackDamageMultiplier,
  deriveAttackDamagePenalty,
  deriveAttackDamageSuppression,
  deriveAttackDiscardScaledBoost,
  deriveAttackEffect,
  deriveAttackOptionalBoost,
  deriveAttackOptionalCostBoost,
  deriveAttackPreDamage,
  deriveAttackCopy,
  deriveAttackRequirement,
];

const SPLITTERS = [
  splitAttackCancelClause,
  splitAttackGateClause,
  splitAttackRequirementClause,
  splitAttackTrailingClause,
];

const SEED = 1;
const units = (rows: readonly (readonly [number, string])[]) => rows.reduce((s, [n]) => s + n, 0);

function bare(by: Seat = "p1"): GameState {
  const foe: Seat = by === "p1" ? "p2" : "p1";
  let state = must(
    applyAction(
      driveSetup(SEED, { p1: IN_PLAY_BODIES_DECK, p2: IN_PLAY_BODIES_DECK }, { first: foe }),
      { type: "endTurn", seat: foe },
    ),
  );
  state = setActiveFromDeck(state, by, "fix-inplaybodies");
  state = clearBench(state, by);
  state = attachFromDeck(state, by, "fix-energy", 1);
  state = setActiveFromDeck(state, foe, "fix-titan");
  return clearBench(state, foe);
}

function benched(state: GameState, seat: Seat, ids: readonly string[]): GameState {
  let next = state;
  for (const id of ids) next = benchFromDeck(next, seat, id);
  return next;
}

function withEffect(state: GameState, effect: string, index = INDEX): GameState {
  const card = state.cardPool["fix-inplaybodies"];
  if (card === undefined) throw new Error("no fix-inplaybodies in pool");
  const attacks = [...(card.attacks ?? [])];
  const at = attacks[index];
  if (at === undefined) throw new Error(`fix-inplaybodies has no attack ${index}`);
  attacks[index] = { ...at, effect };
  return { ...state, cardPool: { ...state.cardPool, "fix-inplaybodies": { ...card, attacks } } };
}

/** Index 0 is "Full House" — {C}, `damage: "20×"`, so the `×` fold DROPS the printed base
    and every HP observed here is the count's. */
const INDEX = 0;

const swing = (state: GameState) => mustApply(state, { type: "attack", seat: "p1", index: INDEX });

function canonical(): GameState {
  let state = benched(bare(), "p1", [
    "fix-grass-stage1",
    "fix-grass-basic",
    "fix-benchfiller",
    "fix-stage1",
    "fix-grass-basic",
  ]);
  state = benched(state, "p2", ["fix-benchfiller", "fix-benchfiller"]);
  state = setDamage(state, "p1", 20);
  state = setBenchDamage(state, "p1", 0, 30);
  state = setBenchDamage(state, "p1", 1, 10);
  state = setBenchDamage(state, "p1", 4, 10);
  return setBenchDamage(state, "p2", 0, 10);
}

const dealt = (state: GameState, effect: string): number | undefined =>
  findEvent(swing(withEffect(state, effect)).events, "DAMAGE_DEALT")?.dealt;

describe("D519 §1 — the printed data, measured live over the legal column", () => {
  it("the sentence is the CORPUS's bytes at ONE printing, and so is its whole family", () => {
    const rows = new Map(legalAttackCorpus().map(([n, s]) => [s, n] as const));
    expect(rows.get(PRINTED)).toBe(1);
    expect(rows.get(SPREAD)).toBe(1);
    expect(rows.get(EACH_ALL)).toBe(1);
    expect(rows.get(CHOSEN)).toBe(3);
    expect(rows.get(INDICATOR)).toBe(3);
  });

  it("the `damage counters on it` family is TWELVE rows / 20 printings, enumerated not summarised", () => {
    const family = legalAttackCorpus().filter(([, s]) => s.includes("damage counters on it"));
    expect(family).toHaveLength(12);
    expect(units(family)).toBe(20);
    const censusBuilt = (s: string): boolean => {
      if (resolvedByAnyReader(s)) return true;
      const g = splitAttackGateClause(s);
      if (g !== null && (g.body === "" || resolvedByAnyReader(g.body))) return true;
      return splitAttackTrailingClause(s) !== null;
    };
    expect(family.filter(([, s]) => !censusBuilt(s))).toEqual([]);
    const unbuilt = family.filter(([, s]) => !resolvedByAnyReader(s)).map(([, s]) => s);
    expect(unbuilt).toEqual([
      "If this Pokémon has any damage counters on it, this attack can be used for {F}.",
    ]);
    expect(
      resolvedByAnyReader(
        "This attack does 50 damage to each Pokémon that has any damage counters on it (both yours and your opponent's), except for this Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      ),
    ).toBe(true);
    expect(family.filter(([, s]) => resolvedByAnyReader(s))).toHaveLength(11);
  });

  it("BOTH zeros are MEASURED — no additive twin and no opponent-seat twin", () => {
    const additive = legalAttackCorpus().filter(([, s]) =>
      /more damage for each of your [^.]+ that has any damage counters on it\./.test(s),
    );
    expect(additive).toEqual([]);
    const foe = legalAttackCorpus().filter(([, s]) =>
      /for each of your opponent['’]s [^.]+ that has any damage counters on it\./.test(s),
    );
    expect(foe).toEqual([]);
    // The two constructed near-misses are therefore constructed, and both are refused — by
    // the ANCHOR, which is the only thing between them and this member.
    expect(resolvedByAnyReader(UNPRINTED_ADDITIVE)).toBe(false);
    expect(resolvedByAnyReader(UNPRINTED_FOE)).toBe(false);
    expect(deriveAttackDamageMultiplier(PRINTED)?.count).toMatchObject({ seat: "you" });
  });

  it("the NOUN is a CAPTURE, so an UNPRINTED narrowing derives with no second anchor", () => {
    expect(deriveAttackDamageMultiplier(UNPRINTED_BASIC)).toEqual({
      per: 50,
      count: {
        kind: "pokemonInPlay",
        seat: "you",
        filter: { kind: "basicPokemon" },
        damagedOnly: true,
      },
    });
    expect(
      deriveAttackDamageMultiplier(
        "This attack does 50 damage for each of your Future Pokémon that has any damage counters on it.",
      ),
    ).toBeNull();
  });

  it("a printed ZERO is left LOUD, and the amount is CAPTURED rather than pinned at 50", () => {
    expect(
      deriveAttackDamageMultiplier(PRINTED.replace("does 50 damage", "does 0 damage")),
    ).toBeNull();
    expect(deriveAttackDamageMultiplier(PRINTED.replace("50", "20"))).toEqual({
      ...READING,
      per: 20,
    });
  });

  it("the anchor is load-bearing at BOTH ends, and the capital `This` is half of it", () => {
    for (const text of [
      PRINTED.replace("This attack", "this attack"),
      PRINTED.slice(0, -1),
      `Draw a card. ${PRINTED}`,
      `${PRINTED} Then, draw a card.`,
      // The clause is spelled into the pattern, not captured — so no near-miss of it
      // reaches the member.
      PRINTED.replace("any damage counters", "no damage counters"),
      PRINTED.replace("that has any damage counters on it", "in play"),
    ]) {
      const claimed = deriveAttackDamageMultiplier(text);
      expect(
        claimed === null || (claimed.count as { damagedOnly?: true }).damagedOnly !== true,
        text,
      ).toBe(true);
    }
  });
});

describe("D519 §2 — the reading, the arm, and the anchors it sits against", () => {
  it("the sentence is RESOLVED, and by exactly ONE of the thirteen readers", () => {
    expect(resolvedByAnyReader(PRINTED)).toBe(true);
    expect(deriveAttackDamageMultiplier(PRINTED)).toEqual(READING);
    for (const read of READERS) {
      if (read === deriveAttackDamageMultiplier) continue;
      expect(read(PRINTED), read.name).toBeNull();
    }
    // …and no splitter is live on it, at either end. Six-for-six, run at every layer.
    for (const split of SPLITTERS) expect(split(PRINTED), split.name).toBeNull();
  });

  it("the three `in play` anchors derive BYTE FOR BYTE what they derived before", () => {
    expect(deriveAttackDamageMultiplier(IN_PLAY_MULTIPLY)).toEqual({
      per: 30,
      count: {
        kind: "pokemonInPlay",
        seat: "you",
        filter: { kind: "typedPokemon", pokemonType: "Grass" },
      },
    });
    expect(deriveAttackDamageBonus(IN_PLAY_SCALE)).toEqual({
      per: 40,
      count: { kind: "pokemonInPlay", seat: "you", filter: { kind: "evolutionPokemon" } },
    });
    expect(deriveAttackDamageMultiplier(IN_PLAY_FOE)).toEqual({
      per: 60,
      count: {
        kind: "pokemonInPlay",
        seat: "opponent",
        filter: { kind: "suffixPokemon", suffix: "ex" },
      },
    });
    for (const sentence of [IN_PLAY_MULTIPLY, IN_PLAY_FOE]) {
      expect(Object.keys(deriveAttackDamageMultiplier(sentence)?.count ?? {}).sort()).toEqual([
        "filter",
        "kind",
        "seat",
      ]);
    }
  });

  it("the ANCHORS ARE DISJOINT OVER THE WHOLE COLUMN, so the order between them is FREE", () => {
    const inPlay: string[] = [];
    const damaged: string[] = [];
    for (const [, s] of legalAttackCorpus()) {
      const v = deriveAttackDamageMultiplier(s);
      if (v === null || v.count.kind !== "pokemonInPlay") continue;
      if ((v.count as { damagedOnly?: true }).damagedOnly === true) damaged.push(s);
      else inPlay.push(s);
    }
    expect(damaged).toEqual([PRINTED]);
    expect(inPlay.length).toBeGreaterThan(0);
    expect(inPlay).not.toContain(PRINTED);
  });

  it("EVERY built row of this family lands on the READER arm ( D545: every row but `:316`, which lands on the GATE arm) — the four-way split, per sentence", () => {
    const armOf = (text: string): string => {
      if (resolvedByAnyReader(text)) return "reader";
      const g = splitAttackGateClause(text);
      if (g !== null && (g.body === "" || resolvedByAnyReader(g.body))) return "gate";
      return splitAttackTrailingClause(text) !== null ? "trailing" : "none";
    };
    expect(armOf(PRINTED)).toBe("reader");
    expect(armOf(SPREAD)).toBe("reader");
    expect(armOf(EACH_ALL)).toBe("reader");
    expect(armOf(CHOSEN)).toBe("reader");
    expect(armOf(INDICATOR)).toBe("reader");
    expect(
      armOf("If this Pokémon has any damage counters on it, this attack can be used for {F}."),
    ).toBe("gate");
  });

  it("the INDICATOR's ceiling is `per`, which is why this row could not be spelled on it", () => {
    const indicator = deriveAttackDamageBonus(INDICATOR);
    expect(indicator?.count.kind).toBe("boardCondition");
    expect(Object.keys(indicator?.count ?? {}).sort()).toEqual(["cond", "kind"]);
    expect(deriveAttackDamageMultiplier(INDICATOR)).toBeNull();
  });

  it("the three SHIPPED op riders still derive, and this is the FOURTH spelling", () => {
    expect(deriveAttackEffect(SPREAD)).toEqual([
      { op: "spreadDamage", target: "yourBench", amount: 40, damagedOnly: true },
      { op: "spreadDamage", target: "opponentBench", amount: 40, damagedOnly: true },
    ]);
    expect(deriveAttackEffect(EACH_ALL)).toEqual([
      {
        op: "counterEachAll",
        amount: 20,
        filter: { kind: "anyPokemon" },
        side: "opponent",
        source: "attack",
        damagedOnly: true,
      },
    ]);
    const chosen = deriveAttackEffect(CHOSEN)?.[0] as
      | { op: string; damagedOnly?: true }
      | undefined;
    expect(chosen?.op).toBe("damageChosen");
    expect(chosen?.damagedOnly).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — the count on a real board.
// ─────────────────────────────────────────────────────────────────────────────

describe("D519 §3 — the fold on a board: the rider, the zone, the seat and the filter", () => {
  it("the printed row deals 50 × the DAMAGED bodies in play, and the unnarrowed twin 50 × all", () => {
    const state = canonical();
    expect(dealt(state, PRINTED)).toBe(200);
    // The same board, the same fold, the rider dropped: 6 bodies rather than 4. A build that
    // ignored `damagedOnly` reads this number, and it is 100 HP away.
    expect(dealt(state, "This attack does 50 damage for each of your Pokémon in play.")).toBe(300);
    // …and a build that INVERTED the predicate — counting the CLEAN bodies — reads 100 on
    // this board, which is why it is four-and-two rather than three-and-three.
    expect(countPokemonInPlay(state, "p1", { kind: "anyPokemon" }, true)).toBe(4);
    expect(countPokemonInPlay(state, "p1", { kind: "anyPokemon" }, false)).toBe(6);
  });

  it("the ACTIVE SPOT participates — a Bench-only walk reads 100 where this reads 150", () => {
    // §4 defines "in play" as the Active PLUS the Bench, and `benchBodies` (three cases up
    // in the evaluator, serving `yourBenchCount`) deliberately skips the Active. The
    // canonical board's damaged three include the Active, so the two nouns differ.
    const state = canonical();
    expect(state.players.p1.active?.damage).toBe(20);
    expect(dealt(state, PRINTED)).toBe(200);
    // Clear the Active's damage and nothing else: the count drops by exactly one body, to the
    // number a Bench-only walk would have read all along.
    expect(dealt(setDamage(state, "p1", 0), PRINTED)).toBe(150);
  });

  it("the SEAT is real — the opponent's damaged body is NOT counted", () => {
    // A p1-only rung cannot tell "reads the attacker's board" from "reads p2's". The
    // opponent has exactly ONE damaged body here, so a seat inversion deals 50.
    const state = canonical();
    expect(countPokemonInPlay(state, "p1", { kind: "anyPokemon" }, true)).toBe(4);
    expect(countPokemonInPlay(state, "p2", { kind: "anyPokemon" }, true)).toBe(1);
    expect(dealt(state, PRINTED)).toBe(200);
    let loaded = state;
    for (let i = 0; i < loaded.players.p2.bench.length; i++) {
      loaded = setBenchDamage(loaded, "p2", i, 10);
    }
    loaded = setDamage(loaded, "p2", 10);
    expect(countPokemonInPlay(loaded, "p2", { kind: "anyPokemon" }, true)).toBe(3);
    expect(dealt(loaded, PRINTED)).toBe(200);
  });

  it("the FILTER axis and the RIDER axis are INDEPENDENT — the 2×4 table, on one board", () => {
    // The whole architectural claim as a measurement: the narrowing is orthogonal to the
    // noun, so every cell of filter × rider is a different population on ONE setup. A build
    // that folded the rider INTO the filter could not produce this table at all.
    const state = canonical();
    const TABLE: readonly (readonly [string, CardFilter, number, number])[] = [
      ["Pokémon", { kind: "anyPokemon" }, 4, 6],
      ["Basic Pokémon", { kind: "basicPokemon" }, 2, 3],
      ["Evolution Pokémon", { kind: "evolutionPokemon" }, 2, 3],
      ["{G} Pokémon", { kind: "typedPokemon", pokemonType: "Grass" }, 3, 3],
    ];
    for (const [noun, filter, damagedCount, allCount] of TABLE) {
      expect(countPokemonInPlay(state, "p1", filter, true), `${noun} damaged`).toBe(damagedCount);
      expect(countPokemonInPlay(state, "p1", filter, false), `${noun} all`).toBe(allCount);
      // …and the printed-shape sentence for each noun deals exactly `50 ×` its cell.
      expect(
        dealt(
          state,
          `This attack does 50 damage for each of your ${noun} that has any damage counters on it.`,
        ),
        `${noun} dealt`,
      ).toBe(damagedCount * 50);
    }
    // ANTI-VACUITY: the table spans three distinct damaged counts and two distinct totals,
    // so it cannot be satisfied by a walk stuck on any one of them.
    expect([...new Set(TABLE.map(([, , d]) => d))].sort()).toEqual([2, 3, 4]);
    expect([...new Set(TABLE.map(([, , , a]) => a))].sort()).toEqual([3, 6]);
    for (const [noun, , damagedCount, allCount] of TABLE) {
      expect(allCount - damagedCount, `${noun}: inverted`).not.toBe(damagedCount);
    }
  });

  it("a board with NO damaged body deals NOTHING — no `DAMAGE_DEALT` row at all", () => {
    let state = setDamage(canonical(), "p1", 0);
    state = setBenchDamage(state, "p1", 0, 0);
    state = setBenchDamage(state, "p1", 1, 0);
    state = setBenchDamage(state, "p1", 4, 0);
    expect(countPokemonInPlay(state, "p1", { kind: "anyPokemon" }, true)).toBe(0);
    const { events } = swing(withEffect(state, PRINTED));
    expect(findEvent(events, "DAMAGE_DEALT")).toBeUndefined();
    // …and the attack RESOLVED: it is not on the loud unread path.
    expect(events.map((e) => e.type)).not.toContain("ATTACK_EFFECT_SKIPPED");
    // …while the unnarrowed twin on that very board still reads six bodies.
    expect(dealt(state, "This attack does 50 damage for each of your Pokémon in play.")).toBe(300);
  });

  it("the INDICATOR sibling on the same board is a CEILING, not a tally", () => {
    // `:358`'s 0-or-1 reading of the same printed clause, driven against this one. The
    // indicator reads the DEFENDING Active and pays `per` once; damaging the defender turns
    // it on and nothing about the attacker's six bodies changes it.
    const state = setBenchDamage(canonical(), "p2", 1, 10);
    const armed = setDamage(state, "p2", 10);
    expect(dealt(armed, INDICATOR)).toBe(60 + 20);
    expect(dealt(armed, PRINTED)).toBe(200);
  });
});

describe("D519 §4 — NARROWING × SEAT × NOUN × FOLD, 16 points, and the flip table", () => {
  const OWNER = ["your", "your opponent's"] as const;
  const NOUN = ["Pokémon", "Basic Pokémon"] as const;
  const TAIL = ["in play", "that has any damage counters on it"] as const;
  const text = (n: number, s: number, o: number, f: number): string =>
    `This attack does 50 ${f === 1 ? "more " : ""}damage for each of ${OWNER[s]} ${NOUN[o]} ${TAIL[n]}.`;
  const POINTS = [0, 1].flatMap((n) =>
    [0, 1].flatMap((s) =>
      [0, 1].flatMap((o) => [0, 1].map((f) => ({ key: [n, s, o, f], t: text(n, s, o, f) }))),
    ),
  );
  const lit = (t: string) => resolvedByAnyReader(t);
  const claimedHere = (t: string): boolean => {
    const v = deriveAttackDamageMultiplier(t);
    return v !== null && (v.count as { damagedOnly?: true }).damagedOnly === true;
  };
  const before = (t: string) => lit(t) && !claimedHere(t);

  it("all 16 points are DISTINCT strings — the anti-degeneracy check (D491)", () => {
    expect(new Set(POINTS.map((p) => p.t)).size).toBe(16);
  });

  it("the BUILT set is 6/16 → 8/16, and the two new points are EXACTLY this arm's", () => {
    expect(
      POINTS.filter((p) => before(p.t))
        .map((p) => p.key.join(""))
        .sort(),
    ).toEqual(["0000", "0001", "0010", "0011", "0100", "0110"]);
    expect(
      POINTS.filter((p) => lit(p.t))
        .map((p) => p.key.join(""))
        .sort(),
    ).toEqual(["0000", "0001", "0010", "0011", "0100", "0110", "1000", "1010"]);
    expect(
      POINTS.filter((p) => claimedHere(p.t))
        .map((p) => p.key.join(""))
        .sort(),
    ).toEqual(["1000", "1010"]);
    expect(text(1, 0, 0, 0)).toBe(PRINTED);
    expect(text(1, 0, 1, 0)).toBe(UNPRINTED_BASIC);
  });

  it("the two predicates AGREE at every point, and both splitters are null at 16/16", () => {
    let gate = 0;
    let trailing = 0;
    for (const p of POINTS) {
      if (splitAttackGateClause(p.t) !== null) gate += 1;
      if (splitAttackTrailingClause(p.t) !== null) trailing += 1;
    }
    expect(gate).toBe(0);
    expect(trailing).toBe(0);
  });

  it("the flip table goes `6·2·0·2` → `4·4·0·4`, and the NOUN axis is INERT at both heads", () => {
    const flips = (pred: (t: string) => boolean) =>
      [0, 1, 2, 3].map((axis) => {
        let n = 0;
        for (const p of POINTS) {
          if (p.key[axis] === 1) continue;
          const q = POINTS.find((x) =>
            x.key.every((v, i) => (i === axis ? v === 1 : v === p.key[i])),
          );
          if (q !== undefined && pred(p.t) !== pred(q.t)) n += 1;
        }
        return n;
      });
    // NARROWING · SEAT · NOUN · FOLD, out of 8 pairs each.
    expect(flips(before)).toEqual([6, 2, 0, 2]);
    expect(flips(lit)).toEqual([4, 4, 0, 4]);
    for (const p of POINTS) {
      const live = (p.key[0] ?? 0) + (p.key[1] ?? 0) + (p.key[3] ?? 0);
      expect(lit(p.t), p.t).toBe(live <= 1);
    }
    expect(new Set(POINTS.map((p) => p.t)).size).toBe(16);
  });

  it("the BUILT set CONTAINS the PRINTED set — no literal refuses a printed row", () => {
    const corpus = legalAttackCorpus();
    const printed = POINTS.filter((p) => {
      const re = new RegExp(
        `^${p.t
          .split("50")
          .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
          .join("\\d+")}$`,
      );
      return corpus.some(([, s]) => re.test(s));
    });
    expect(printed.map((p) => p.key.join("")).sort()).toEqual(["0000", "0010", "1000"]);
    for (const p of printed) expect(lit(p.t), p.t).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — the INVARIANT: one walk, two folds.
// ─────────────────────────────────────────────────────────────────────────────

describe("D519 §5 — counted ⟺ a candidate of the SHIPPED op, by construction", () => {
  function spreadHits(state: GameState): boolean[] {
    const before = state.players.p1.bench.map((b) => b.damage);
    const after = swing(withEffect(state, SPREAD)).state.players.p1.bench.map((b) => b.damage);
    expect(after).toHaveLength(before.length);
    return after.map((d, i) => d > (before[i] ?? 0));
  }

  it("the biconditional holds body-by-body, on every damage pattern of a six-body board", () => {
    let bothOn = 0;
    let bothOff = 0;
    const PATTERNS: readonly (readonly [string, number, readonly number[]])[] = [
      ["clean", 0, [0, 0, 0, 0, 0]],
      ["active only", 20, [0, 0, 0, 0, 0]],
      ["bench only", 0, [30, 10, 0, 0, 10]],
      ["canonical", 20, [30, 10, 0, 0, 10]],
      ["alternating", 0, [10, 0, 10, 0, 10]],
      ["every body", 10, [10, 10, 10, 10, 10]],
    ];
    for (const [label, active, bench] of PATTERNS) {
      let state = setDamage(canonical(), "p1", active);
      for (let i = 0; i < bench.length; i++) state = setBenchDamage(state, "p1", i, bench[i] ?? 0);
      const hits = spreadHits(state);
      // Body by body: the shipped op's candidate set and the count's are the SAME set.
      for (let i = 0; i < hits.length; i++) {
        const counted = state.players.p1.bench[i]?.damage ?? 0;
        expect(hits[i], `${label} bench ${i}`).toBe(counted > 0);
        if (hits[i] === true) bothOn += 1;
        else bothOff += 1;
      }
      // …and the COUNT is exactly the hits plus the Active, which is the only body the
      // Bench-scoped op cannot see.
      const expected = hits.filter(Boolean).length + (active > 0 ? 1 : 0);
      expect(countPokemonInPlay(state, "p1", { kind: "anyPokemon" }, true), label).toBe(expected);
      // …and `count >= 1` is exactly "some body satisfies the predicate".
      expect(
        countPokemonInPlay(state, "p1", { kind: "anyPokemon" }, true) >= 1,
        `${label}: count >= 1`,
      ).toBe(hits.some(Boolean) || active > 0);
      // …and the HP the printed sentence deals follows the count on every pattern.
      expect(dealt(state, PRINTED) ?? 0, `${label}: HP`).toBe(expected * 50);
    }
    // ANTI-VACUITY: the sweep visits BOTH sides of the biconditional many times over.
    expect(bothOn).toBeGreaterThan(0);
    expect(bothOff).toBeGreaterThan(0);
  });

  it("the rider narrows the WALK and not the FILTER — an undamaged body of the right class is dropped", () => {
    const state = canonical();
    expect(state.players.p1.bench[1]?.damage).toBe(10);
    expect(state.players.p1.bench[2]?.damage).toBe(0);
    expect(countPokemonInPlay(state, "p1", { kind: "basicPokemon" }, false)).toBe(3);
    expect(countPokemonInPlay(state, "p1", { kind: "basicPokemon" }, true)).toBe(2);
    // Damage the clean one and the narrowed count rises to meet the unnarrowed one; the
    // filter never moved.
    const both = setBenchDamage(state, "p1", 2, 10);
    expect(countPokemonInPlay(both, "p1", { kind: "basicPokemon" }, true)).toBe(3);
    expect(countPokemonInPlay(both, "p1", { kind: "basicPokemon" }, false)).toBe(3);
  });

  it("an EMPTY Active Spot is counted as zero bodies rather than throwing", () => {
    // `countPokemonInPlay`'s own guarantee, and the rider must not change it: the walk's
    // `body === null` guard runs BEFORE the board test, so a seat whose Active Spot is empty
    // answers with its Bench at either value of the flag.
    const base = canonical();
    const empty: GameState = {
      ...base,
      players: { ...base.players, p1: { ...base.players.p1, active: null } },
    };
    expect(countPokemonInPlay(empty, "p1", { kind: "anyPokemon" }, true)).toBe(3);
    expect(countPokemonInPlay(empty, "p1", { kind: "anyPokemon" }, false)).toBe(5);
  });
});

const COUNT_KINDS: Record<DamageCountSource["kind"], true> = {
  damageCountersOnSelf: true,
  opponentPrizesTaken: true,
  opponentActiveRetreatCost: true,
  boardCondition: true,
  damageCountersOnOpponentActive: true,
  specialConditionsOnOpponentActive: true,
  damageCountersOnYourBench: true,
  damageCountersOnOpponentBoard: true,
  bothSidesBenchCount: true,
  opponentBenchCount: true,
  yourBenchCount: true,
  energyOnOpponent: true,
  energyOnSelf: true,
  bothActivesEnergyCount: true,
  toolsOnYourBoard: true,
  extraEnergyUnitsBeyondCost: true,
  pokemonInPlay: true,
  bothSidesPokemonInPlay: true,
  cardsInDiscardPile: true,
  cardsInOpponentHand: true,
  cardsInYourHand: true,
  energyInPlayBothSides: true,
  toolsInPlayBothSides: true,
  basicEnergyTypesOnYourBoard: true,
  yourPrizesTaken: true,
  damagedBenchedPokemon: true,
  benchedPokemonWithEnergy: true,
  benchedPokemonWithMaxHp: true,
  opponentPrizesTakenLastTurn: true,
  attackDamageTakenLastTurnOnSelf: true,
};

describe("D519 §6 — `MATCH_RECORD_VERSION` HOLDS at 30: there is still no carrier", () => {
  it("the union is UNMOVED at TWENTY members — this slice bought a FIELD, not a member", () => {
    expect(Object.keys(COUNT_KINDS)).toHaveLength(30);
    expect(COUNT_KINDS.pokemonInPlay).toBe(true);
  });

  it("NO op any producer in this repo emits carries a `DamageCountSource` — walked, not cited", () => {
    const programs: EffectOp[][] = [];
    for (const id of registryCardIds()) {
      const p = programFor(id);
      if (p?.attack !== undefined) programs.push(...Object.values(p.attack));
    }
    for (const [, text] of legalAttackCorpus()) {
      const derived = deriveAttackEffect(text);
      if (derived !== null) programs.push(derived as EffectOp[]);
    }
    expect(programs.length).toBeGreaterThan(100);
    const carriers: string[] = [];
    const visit = (node: unknown, path: string): void => {
      if (Array.isArray(node)) {
        node.forEach((v, i) => {
          visit(v, `${path}[${i}]`);
        });
        return;
      }
      if (node === null || typeof node !== "object") return;
      const rec = node as Record<string, unknown>;
      const kind = rec.kind;
      if (typeof kind === "string" && kind in COUNT_KINDS && rec.op === undefined) {
        carriers.push(`${path}.kind = ${kind}`);
      }
      for (const [k, v] of Object.entries(rec)) visit(v, `${path}.${k}`);
    };
    programs.forEach((p, i) => {
      visit(p, `program[${i}]`);
    });
    expect(carriers).toEqual([]);
  });

  it("the `damagedOnly` RIDER reaches no PROMPT, which is why it owes no caption arm", () => {
    const { events, state } = swing(withEffect(canonical(), PRINTED));
    expect(events.map((e) => e.type)).toEqual(
      events.map((e) => e.type).filter((t) => !t.startsWith("CHOICE")),
    );
    expect(state.phase.kind).not.toBe("effect:choose");
    let chosenBoard = benched(bare(), "p2", ["fix-tr-stage1", "fix-tr-stage1"]);
    chosenBoard = setBenchDamage(chosenBoard, "p2", 0, 10);
    chosenBoard = setBenchDamage(chosenBoard, "p2", 1, 10);
    const parked = mustApply(withEffect(chosenBoard, CHOSEN), {
      type: "attack",
      seat: "p1",
      index: INDEX,
    }).state;
    expect(parked.phase.kind).toBe("effect:choose");
    const prompt = parked.phase.kind === "effect:choose" ? parked.phase.prompt : undefined;
    expect(JSON.stringify(prompt)).toContain("that has any damage counters on it");
  });

  it("the reader SURFACE is unmoved at THIRTEEN, and the hand-kept list IS the module's", () => {
    expect(READERS.map((read) => read.name).sort()).toEqual(attackReaderSurface());
    expect(attackReaderSurface()).toHaveLength(14);
  });

  it("`FIXTURE_POOL` is BYTE-UNCHANGED — the demonstrator is a per-board clone", () => {
    expect(FIXTURE_POOL["fix-inplaybodies"]?.attacks?.map((a) => a.effect)).toEqual([
      "This attack does 20 damage for each of your Pokémon in play.",
      "This attack does 20 damage for each of your Basic Pokémon in play.",
      "This attack does 30 damage for each of your Team Rocket's Pokémon in play.",
      "This attack does 30 damage for each of your {G} Pokémon in play.",
      "This attack does 40 more damage for each of your Evolution Pokémon in play.",
      "This attack does 20 damage for each of your Pokémon in play that has the Round attack.",
      "This attack does 60 damage for each of your opponent's Pokémon ex in play.",
      "This attack does 60 damage for each of your opponent's Pokémon ex and Pokémon V in play.",
      "This attack does 40 damage for each of your Stage 1 Pokémon in play.",
    ]);
  });
});
