import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { energyProvidesOf } from "./cards";
import { legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import {
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
  deriveAttackRequirement,
  splitAttackGateClause,
  splitAttackTrailingClause,
} from "./effects";
import type { EffectOp } from "./effectTypes";
import type { GameState } from "./index";
import type { EffectContinuation, EffectPrompt } from "./effectPrompt";
import { runProgram } from "./interpreter";
import {
  FIXTURE_POOL,
  attachFromDeck,
  battler,
  clearBench,
  deckOf,
  expectErr,
  mustApply,
  setActiveFromDeck,
  typedEnergy,
  driveSetup,
} from "./testFixtures";

const PRINTED =
  "Search your deck for up to 3 Basic Energy cards of different types, reveal them, and put them into your hand. Then, shuffle your deck.";

const SIBLING =
  "Search your deck for up to 3 Basic Energy cards, reveal them, and put them into your hand. Then, shuffle your deck.";

const TERA_TWIN =
  "Search your deck for up to 3 Basic Energy cards of different types and attach them to your Tera Pokémon in any way you like. Then, shuffle your deck.";

/** The printed noun carrying the phrase on a head the partition cannot key — the
    LOUD refusal, and a sentence the column prints ZERO times (§1 measures it). */
const WRONG_NOUN =
  "Search your deck for up to 3 Pokémon of different types, reveal them, and put them into your hand. Then, shuffle your deck.";

const OTHERS = [
  deriveAttackDamageBonus,
  deriveAttackDamagePenalty,
  deriveAttackDamageSuppression,
  deriveAttackDamageMultiplier,
  deriveAttackCoinFlip,
  deriveAttackRequirement,
  deriveAttackCancelRequirement,
  deriveAttackPreDamage,
  deriveAttackBonusConsequent,
  deriveAttackOptionalBoost,
  deriveAttackOptionalCostBoost,
  deriveAttackDiscardScaledBoost,
] as const;

const PROGRAM: readonly EffectOp[] = [
  {
    op: "searchDeck",
    filter: { kind: "basicEnergy" },
    dest: "hand",
    max: 3,
    reveal: true,
    distinctEnergyTypes: true,
  },
  { op: "shuffleDeck" },
];

const CRYSTAL = 0;
const PLAIN = 1;
const ODD = 2;

const D513_CARDS: Record<string, Card> = {
  "d513-grass-energy": typedEnergy("d513-grass-energy", "Grass"),
  "d513-sylveon": battler("d513-sylveon", {
    name: "D513 Sylveon",
    types: ["Colorless"],
    hp: 300,
    attacks: [
      { cost: ["Colorless"], name: "Crystal Wing", effect: PRINTED },
      // The built sibling — the control that separates "the phrase was read" from
      // "a search was parked" on every rung in §3.
      { cost: ["Colorless"], name: "Plain Wing", effect: SIBLING },
      { cost: ["Colorless"], name: "Odd Wing", effect: WRONG_NOUN },
    ],
  }),
};

const D513_POOL: Record<string, Card> = { ...FIXTURE_POOL, ...D513_CARDS };

const D513_DECK = deckOf({
  "d513-sylveon": 8,
  "fix-basic-1": 8,
  "fix-fire-energy": 9,
  "fix-water-energy": 9,
  "d513-grass-energy": 9,
  "fix-energy": 9,
  "fix-item": 8,
});

function openTable(seed: number): GameState {
  const state = driveSetup(
    seed,
    { p1: D513_DECK, p2: D513_DECK },
    { pool: D513_POOL, first: "p2" },
  );
  // `p2` opens and passes, so `p1` attacks on a turn that carries no first-turn lock.
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** p1 fields the attacker with one Energy attached to pay a {C} cost, and an EMPTY
    Bench — the search puts cards into the HAND, so a Bench body would only add noise
    to the zone assertions in §3. */
function canonical(seed = 31): GameState {
  let state = setActiveFromDeck(openTable(seed), "p1", "d513-sylveon");
  state = attachFromDeck(state, "p1", "fix-energy", 1);
  state = clearBench(state, "p1");
  state = setActiveFromDeck(state, "p2", "fix-basic-1");
  return state;
}

const attack = (state: GameState, index: number) =>
  mustApply(state, { type: "attack", seat: "p1", index }).state;

function cardsPrompt(state: GameState): Extract<EffectPrompt, { kind: "chooseCards" }> {
  if (state.phase.kind !== "effect:choose")
    throw new Error(`expected a park, got ${state.phase.kind}`);
  if (state.phase.prompt.kind !== "chooseCards") {
    throw new Error(`expected chooseCards, got ${state.phase.prompt.kind}`);
  }
  return state.phase.prompt;
}

function continuation(state: GameState): EffectContinuation {
  if (state.phase.kind !== "effect:choose") throw new Error("expected a park");
  return state.phase.cont;
}

/** The provided type of a uid — the same function the park partitions by and the same
    one `matchesFilter`'s `basicEnergy` arm reads for `filter.energyType`. */
const typeOf = (state: GameState, uid: string): string =>
  energyProvidesOf(D513_POOL[state.cardIdByUid[uid] as string] as Card);

/** N uids off the prompt, all of DIFFERENT provided types. */
function distinctPick(state: GameState, n: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const uid of cardsPrompt(state).candidates) {
    const t = typeOf(state, uid);
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(uid);
    if (out.length === n) break;
  }
  if (out.length < n) throw new Error(`board offers only ${out.length} distinct types`);
  return out;
}

/** TWO uids off the prompt sharing one provided type — the answer the print refuses,
    and the whole reason the deck carries duplicates. */
function sameTypePair(state: GameState): string[] {
  const byType = new Map<string, string[]>();
  for (const uid of cardsPrompt(state).candidates) {
    const t = typeOf(state, uid);
    byType.set(t, [...(byType.get(t) ?? []), uid]);
  }
  const pair = [...byType.values()].find((uids) => uids.length >= 2);
  if (pair === undefined) throw new Error("board offers no same-type pair");
  return pair.slice(0, 2);
}

const resolve = (state: GameState, uids: string[]) =>
  mustApply(state, { type: "resolveEffect", seat: "p1", choice: { kind: "cards", uids } }).state;

// ─────────────────────────────────────────────────────────────────────────────
// §1 — the printed sentence, its population, and the absences the axes owe.
// ─────────────────────────────────────────────────────────────────────────────

describe("§1 — the printed sentence, the population, and the absences", () => {
  it("ONE corpus row, ONE legal printing, and the byte delta from the sibling is the PHRASE", () => {
    const printed = new Map(legalAttackCorpus().map(([n, s]) => [s, n]));
    expect(printed.get(PRINTED)).toBe(1);
    expect(printed.get(SIBLING)).toBe(1);
    expect(printed.get(TERA_TWIN)).toBe(1);
    expect(SIBLING.replace(" cards,", " cards of different types,")).toBe(PRINTED);
    expect(PRINTED.replace(" of different types", "")).toBe(SIBLING);
  });

  it("the two measurements §4's flip table says this slice OWES", () => {
    const rows = legalAttackCorpus();
    // ⓐ THE PHRASE prints on exactly TWO rows, and BOTH are `Basic Energy cards` — so
    // the rider being defined over one noun refuses nothing the column carries.
    const phrase = rows.filter(([, s]) => s.includes("of different types"));
    expect(phrase.map(([, s]) => s).sort()).toEqual([PRINTED, TERA_TWIN].sort());
    expect(phrase.every(([, s]) => s.includes("Basic Energy cards of different types"))).toBe(true);
    expect(rows.filter(([, s]) => s.includes("different"))).toHaveLength(2);
    expect(printedCount(rows, WRONG_NOUN)).toBe(0);
  });

  it("the fixture pool is FILE-LOCAL, so no id ladder in the repo moves", () => {
    for (const id of Object.keys(D513_CARDS)) expect(FIXTURE_POOL[id]).toBeUndefined();
    expect(D513_DECK).toHaveLength(60);
  });
});

function printedCount(rows: readonly (readonly [number, string])[], text: string): number {
  return rows.filter(([, s]) => s === text).reduce((sum, [n]) => sum + n, 0);
}

describe("§2 — the resolver, the anchor that was never the blocker, and the refusal", () => {
  it("exactly ONE of thirteen readers claims it, at the VALUE", () => {
    expect(deriveAttackEffect(PRINTED)).toEqual(PROGRAM);
    for (const reader of OTHERS)
      expect([reader.name, reader(PRINTED)]).toEqual([reader.name, null]);
    expect(splitAttackGateClause(PRINTED)).toBeNull();
    expect(splitAttackTrailingClause(PRINTED)).toBeNull();
  });

  it("THE PRE-SLICE ANCHOR *MATCHED* — the blocker was the NOUN TABLE (D510), DRIVEN", () => {
    const BEFORE = new RegExp(
      "^(?:You may search|Search) your deck for (?:(an? [^,.]+?)(, reveal it,)? and put it" +
        "|up to (\\d+) ([^,.]+?)(, reveal them,)? and put them)" +
        " into your hand\\. Then, shuffle your deck\\.$",
    );
    const before = BEFORE.exec(PRINTED);
    // It MATCHES, and the noun group swallowed the phrase whole — because `[^,.]`
    // excludes a comma and a period and the printed phrase contains neither.
    expect(before).not.toBeNull();
    expect(before?.[4]).toBe("Basic Energy cards of different types");
    // …so the sentence reached the reader and died at the closed TABLE, one step
    // later. The proof that the table is what refused it: the captured phrase is not
    // a key the sibling's own noun is, and the sibling's noun IS.
    expect(before?.[4]).not.toBe("Basic Energy cards");
    expect(BEFORE.exec(SIBLING)?.[4]).toBe("Basic Energy cards");
    const AFTER = new RegExp(
      "^(?:You may search|Search) your deck for (?:(an? [^,.]+?)(, reveal it,)? and put it" +
        "|up to (\\d+) ([^,.]+?)( of different types)?(, reveal them,)? and put them)" +
        " into your hand\\. Then, shuffle your deck\\.$",
    );
    const corpus = legalAttackCorpus().map(([, s]) => s);
    const oldMatches = corpus.filter((s) => BEFORE.test(s));
    expect(oldMatches.length).toBeGreaterThan(0);
    expect(corpus.filter((s) => AFTER.test(s))).toEqual(oldMatches);
    const stillRefused = oldMatches.filter((s) => deriveAttackEffect(s) === null);
    expect(stillRefused.length).toBeGreaterThan(0);
    expect(stillRefused).not.toContain(PRINTED);
  });

  it("the GROUP SHIFT is driven: `reveal` still rides the plural clause", () => {
    const revealed = (text: string) =>
      (deriveAttackEffect(text)?.[0] as { reveal?: true } | undefined)?.reveal;
    expect(revealed(PRINTED)).toBe(true);
    expect(revealed(SIBLING)).toBe(true);
    expect(
      revealed(
        "Search your deck for up to 3 Basic Energy cards of different types and put them into your hand. Then, shuffle your deck.",
      ),
    ).toBeUndefined();
    expect(
      revealed(
        "Search your deck for up to 3 cards and put them into your hand. Then, shuffle your deck.",
      ),
    ).toBeUndefined();
    expect(
      revealed(
        "Search your deck for a Basic Energy card, reveal it, and put it into your hand. Then, shuffle your deck.",
      ),
    ).toBe(true);
  });

  it("a NON-ENERGY noun carrying the phrase is a LOUD refusal, not an approximation", () => {
    expect(deriveAttackEffect(WRONG_NOUN)).toBeNull();
    expect(
      deriveAttackEffect(
        "Search your deck for up to 3 Pokémon, reveal them, and put them into your hand. Then, shuffle your deck.",
      ),
    ).toEqual([
      { op: "searchDeck", filter: { kind: "anyPokemon" }, dest: "hand", max: 3, reveal: true },
      { op: "shuffleDeck" },
    ]);
    // …and a TYPED Energy noun still resolves, because its filter is `basicEnergy`
    // however narrow: the guard is on the KIND, not on the exact filter value.
    expect(
      deriveAttackEffect(
        "Search your deck for up to 3 Basic {G} Energy cards of different types, reveal them, and put them into your hand. Then, shuffle your deck.",
      ),
    ).toEqual([
      {
        op: "searchDeck",
        filter: { kind: "basicEnergy", energyType: "Grass" },
        dest: "hand",
        max: 3,
        reveal: true,
        distinctEnergyTypes: true,
      },
      { op: "shuffleDeck" },
    ]);
  });

  it("the TERA TWIN stays unbuilt, and its blocker is a DIFFERENT LAYER", () => {
    expect(deriveAttackEffect(TERA_TWIN)).toBeNull();
    expect(resolvedByAnyReader(TERA_TWIN)).toBe(false);
    // …and the minimal pair that isolates the anchor half from the banner half:
    // dropping ONLY the banner still derives to null, so the phrase really is a second
    // blocker there rather than the banner being the whole story.
    expect(deriveAttackEffect(TERA_TWIN.replace(" Tera", ""))).toBeNull();
    expect(
      deriveAttackEffect(TERA_TWIN.replace(" of different types", "").replace(" Tera", "")),
    ).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — the board: the partition, the caps, and the four separated answers.
// ─────────────────────────────────────────────────────────────────────────────

describe("§3 — the partition, the caps, and the four answers the print separates", () => {
  it("the park carries ONE cap of ONE per provided type, and the cells PARTITION the offer", () => {
    const state = attack(canonical(), CRYSTAL);
    const prompt = cardsPrompt(state);
    const caps = prompt.caps ?? [];
    // FOUR cells, because the deck holds four provided types among Basic Energy —
    // Fire, Water, Grass and the Colorless fallback.
    expect(caps).toHaveLength(4);
    expect(caps.map((c) => c.max)).toEqual([1, 1, 1, 1]);
    const inCells = caps.flatMap((c) => [...c.uids]);
    expect([...inCells].sort()).toEqual([...prompt.candidates].sort());
    expect(new Set(inCells).size).toBe(inCells.length);
    // …and each cell is exactly one provided type, which is the property the caps
    // MEAN. A cell holding two types would cap a legal answer.
    for (const cell of caps) {
      expect(new Set(cell.uids.map((uid) => typeOf(state, uid))).size).toBe(1);
    }
    expect(new Set(caps.map((c) => typeOf(state, c.uids[0] as string))).size).toBe(4);
    expect(caps.some((c) => typeOf(state, c.uids[0] as string) === "Colorless")).toBe(true);
    expect([prompt.min, prompt.max]).toEqual([0, 3]);
    expect(caps.reduce((sum, c) => sum + c.max, 0)).toBe(4);
    expect(prompt.max).not.toBe(caps.reduce((sum, c) => sum + c.max, 0));
  });

  it("the SIBLING parks with NO caps at all — the control that makes the rung above about the PHRASE", () => {
    const prompt = cardsPrompt(attack(canonical(), PLAIN));
    expect("caps" in prompt).toBe(false);
    expect([prompt.min, prompt.max]).toEqual([0, 3]);
    // …and the candidate sets are IDENTICAL, so the two prompts differ in the caps and
    // in nothing else. The filter did not move; only the relation among the picks did.
    const distinct = cardsPrompt(attack(canonical(), CRYSTAL));
    expect([...prompt.candidates].sort()).toEqual([...distinct.candidates].sort());
  });

  it("the FOUR answers, separated by a real board rather than by argument", () => {
    const state = attack(canonical(), CRYSTAL);
    const three = distinctPick(state, 3);
    const one = distinctPick(state, 1);
    const same = sameTypePair(state);

    // ⓐ three of different types — the full printed take.
    expect(new Set(three.map((uid) => typeOf(state, uid))).size).toBe(3);
    const took = resolve(state, three);
    for (const uid of three) expect(took.players.p1.hand).toContain(uid);
    for (const uid of three) expect(took.players.p1.deck).not.toContain(uid);
    expect(new Set(same.map((uid) => typeOf(state, uid))).size).toBe(1);
    expectErr(
      state,
      { type: "resolveEffect", seat: "p1", choice: { kind: "cards", uids: same } },
      "BAD_EFFECT_CHOICE",
    );
    // ⓒ FEWER — legal, because the print says *"up to"*.
    expect(resolve(state, one).players.p1.hand).toContain(one[0]);
    // ⓓ NONE — legal too, and the floor is what says so.
    const declined = resolve(state, []);
    expect(declined.phase.kind).not.toBe("effect:choose");
    expect(declined.players.p1.hand).toHaveLength(state.players.p1.hand.length);
  });

  it("the SAME pair is ACCEPTED without the phrase — the caps are what refuse it", () => {
    const plain = attack(canonical(), PLAIN);
    const same = sameTypePair(plain);
    expect(new Set(same.map((uid) => typeOf(plain, uid))).size).toBe(1);
    const took = resolve(plain, same);
    for (const uid of same) expect(took.players.p1.hand).toContain(uid);
  });

  it("the CAPTION carries the printed phrase, and it ROUND-TRIPS off the printed bytes", () => {
    const noteFromPrint = (text: string) =>
      text
        .replace(/^You may search/, "Search")
        .replace(/, reveal (?:it|them),/, "")
        .replace(
          / and put (?:it|them) into your hand\. Then, shuffle your deck\.$/,
          " into your hand.",
        );
    expect(cardsPrompt(attack(canonical(), CRYSTAL)).note).toBe(noteFromPrint(PRINTED));
    expect(cardsPrompt(attack(canonical(), PLAIN)).note).toBe(noteFromPrint(SIBLING));
    // …and the reconstruction is not a tautology: it really does delete two clauses
    // and keep the phrase.
    expect(noteFromPrint(PRINTED)).toBe(
      "Search your deck for up to 3 Basic Energy cards of different types into your hand.",
    );
    expect(noteFromPrint(SIBLING)).toBe(
      "Search your deck for up to 3 Basic Energy cards into your hand.",
    );
  });

  it("the ODD noun never parks at all — the loud path, on a real board", () => {
    // The refusal §2 drives at the reader, driven again at the TABLE, because a
    // sentence no reader claims must leave through `ATTACK_EFFECT_SKIPPED` rather than
    // parking something. This is the rung that makes the guard reachable.
    const state = attack(canonical(), ODD);
    expect(state.phase.kind).not.toBe("effect:choose");
  });
});

describe("§4 — the census step this slice is", () => {
  it("the row moved from the residue to the built set, and it is the ONLY one that did", () => {
    const claimed = legalAttackCorpus().filter(([, s]) =>
      JSON.stringify(deriveAttackEffect(s) ?? []).includes("distinctEnergyTypes"),
    );
    expect(claimed.map(([, s]) => s)).toEqual([PRINTED]);
    expect(claimed.reduce((sum, [n]) => sum + n, 0)).toBe(1);
    expect(resolvedByAnyReader(TERA_TWIN)).toBe(false);
  });

  it("the lattice, run BOTH WAYS and keyed on the DERIVED VALUE (D491/D503/D505)", () => {
    const NOUNS = ["Basic Energy cards", "Pokémon"];
    const DISTINCTS = [" of different types", ""];
    const REVEALS = [", reveal them,", ""];
    const OPENERS = ["Search", "You may search"];
    const COUNTS = ["3", "2"];
    const point = (m: number) =>
      `${OPENERS[(m >> 3) & 1]} your deck for up to ${COUNTS[(m >> 4) & 1]} ${NOUNS[m & 1]}${DISTINCTS[(m >> 1) & 1]}${REVEALS[(m >> 2) & 1]} and put them into your hand. Then, shuffle your deck.`;
    const points = Array.from({ length: 32 }, (_, i) => point(i));
    expect(new Set(points).size).toBe(32);
    expect(points[0]).toBe(PRINTED);
    expect(points[2]).toBe(SIBLING);

    // ⓐ the READERS-ONLY reading.
    const built = points.filter((s) => resolvedByAnyReader(s));
    expect(built).toHaveLength(24);
    for (const s of points) {
      expect([s, splitAttackGateClause(s)]).toEqual([s, null]);
      expect([s, splitAttackTrailingClause(s)]).toEqual([s, null]);
    }
    const claims = (s: string) =>
      JSON.stringify(deriveAttackEffect(s) ?? []).includes("distinctEnergyTypes");
    const before = points.filter((s) => resolvedByAnyReader(s) && !claims(s));
    expect(before).toHaveLength(16);
    const moved = points.filter((s) => claims(s));
    expect(moved).toHaveLength(8);
    expect(moved.every((s) => s.includes("Basic Energy cards of different types"))).toBe(true);
    expect(built.length - before.length).toBe(moved.length);

    const flips = (claimed: (s: string) => boolean) =>
      [0, 1, 2, 3, 4].map((ax) => {
        let n = 0;
        for (let m = 0; m < 32; m++) {
          if ((m >> ax) & 1) continue;
          if (claimed(point(m)) !== claimed(point(m | (1 << ax)))) n++;
        }
        return n;
      });
    const wasBuilt = (s: string) => resolvedByAnyReader(s) && !claims(s);
    expect(flips(wasBuilt)).toEqual([0, 16, 0, 0, 0]);
    expect(flips(resolvedByAnyReader)).toEqual([8, 8, 0, 0, 0]);
    expect(new Set(points.map((s) => s.length)).size).toBeGreaterThan(1);
  });

  it("`MATCH_RECORD_VERSION` HOLDS at 30, and the LOSS DIRECTION is DRIVEN", () => {
    const parked = attack(canonical(), CRYSTAL);
    const cont = continuation(parked);
    expect((cont.pendingOp as { op: string }).op).toBe("searchDeck");
    expect((cont.pendingOp as { distinctEnergyTypes?: true }).distinctEnergyTypes).toBe(true);

    const { distinctEnergyTypes: _dropped, ...v30Op } = cont.pendingOp as EffectOp & {
      distinctEnergyTypes?: true;
    };
    const resumed = runProgram(parked, [v30Op as EffectOp], cont.ctx, {}, []);
    if (resumed.kind !== "parked" || resumed.prompt.kind !== "chooseCards") {
      throw new Error("expected the v30 op to park a chooseCards");
    }
    const v30Prompt = resumed.prompt;
    expect("caps" in v30Prompt).toBe(false);
    expect([v30Prompt.min, v30Prompt.max]).toEqual([0, 3]);
    const sibling = cardsPrompt(attack(canonical(), PLAIN));
    expect([...v30Prompt.candidates].sort()).toEqual([...sibling.candidates].sort());
    expect(v30Prompt.note).toBe(sibling.note);
    expect(cardsPrompt(parked).caps).toHaveLength(4);
  });
});
