import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
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
import type { EffectOp } from "./effects";
import { applyAction, createGame } from "./index";
import type { GameState } from "./index";
import type { EffectContinuation, EffectPrompt } from "./interpreter";
import { runProgram } from "./interpreter";
import {
  FIXTURE_POOL,
  attachFromDeck,
  battler,
  clearBench,
  deckOf,
  firstBasicInHand,
  must,
  mustApply,
  setActiveFromDeck,
  trainerCard,
} from "./testFixtures";

const PRINTED =
  "You may search your deck for any number of Fennel cards, reveal them, and put them into your hand. Then, shuffle your deck.";

const SIBLING =
  "You may search your deck for up to 2 cards and put them into your hand. Then, shuffle your deck.";

const BENCH_TWIN =
  "You may search your deck for any number of Basic Lillie's Pokémon and put them onto your Bench. Then, shuffle your deck.";

const COUNT_REPAIRED =
  "You may search your deck for up to 2 Fennel cards, reveal them, and put them into your hand. Then, shuffle your deck.";

const BANNER =
  "You may search your deck for any number of Ancient cards, reveal them, and put them into your hand. Then, shuffle your deck.";

/** The CATEGORY noun under the new quantifier — the point that proves the closed table
    is still consulted FIRST. If the name resolver ran before the table this would derive
    a search for a card literally called "Energy", which matches nothing. */
const CATEGORY_UNDER_ANY =
  "You may search your deck for any number of Energy cards, reveal them, and put them into your hand. Then, shuffle your deck.";

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
    filter: { kind: "byName", name: "Fennel", cardNoun: true },
    dest: "hand",
    max: "any",
    reveal: true,
  },
  { op: "shuffleDeck" },
];

const PRE_SLICE_HAND_SEARCH = new RegExp(
  "^(?:You may search|Search) your deck for (?:(an? [^,.]+?)(, reveal it,)? and put it" +
    "|up to (\\d+) ([^,.]+?)( of different types)?(, reveal them,)? and put them)" +
    " into your hand\\. Then, shuffle your deck\\.$",
);

const ANY_NUMBER = 0;
const UP_TO_TWO = 1;
const BANNER_ATTACK = 2;

const D514_CARDS: Record<string, Card> = {
  "d514-fennel-a": {
    ...trainerCard("d514-fennel-a", "Supporter", "Draw 3 cards."),
    name: "Fennel",
  },
  "d514-fennel-b": {
    ...trainerCard("d514-fennel-b", "Supporter", "Draw 2 cards."),
    name: "Fennel",
  },
  "d514-fennell": {
    ...trainerCard("d514-fennell", "Supporter", "Draw 1 card."),
    name: "Fennell",
  },
  "d514-cinccino": battler("d514-cinccino", {
    name: "D514 Cinccino",
    types: ["Colorless"],
    hp: 300,
    attacks: [
      { cost: ["Colorless"], name: "Call For Family", effect: PRINTED },
      // The built sibling — the attribution control that separates "the printed
      // quantifier was read" from "a search was parked" on every rung in §3.
      { cost: ["Colorless"], name: "Plain Call", effect: SIBLING },
      { cost: ["Colorless"], name: "Old Call", effect: BANNER },
    ],
  }),
};

const D514_POOL: Record<string, Card> = { ...FIXTURE_POOL, ...D514_CARDS };

const D514_DECK = deckOf({
  "d514-cinccino": 8,
  "fix-basic-1": 8,
  "d514-fennel-a": 7,
  "d514-fennel-b": 7,
  "d514-fennell": 6,
  "fix-energy": 16,
  "fix-item": 8,
});

function openTable(seed: number): GameState {
  const created = createGame({
    seed,
    decks: { p1: D514_DECK, p2: D514_DECK },
    cardPool: D514_POOL,
  });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let table = created.state;
  if (table.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  table = must(
    applyAction(table, { type: "chooseFirstPlayer", seat: table.phase.coinWinner, first: "p2" }),
  );
  while (table.phase.kind === "setup:drawExtra") {
    const drawing = table.phase;
    const owing = (["p1", "p2"] as const).find((s) => !drawing.decided[s]);
    if (owing === undefined) throw new Error("setup:drawExtra with every seat decided");
    table = must(
      applyAction(table, { type: "setupDrawExtra", seat: owing, count: drawing.owed[owing] }),
    );
  }
  for (const seat of ["p1", "p2"] as const) {
    table = must(
      applyAction(table, { type: "setupPlaceActive", seat, uid: firstBasicInHand(table, seat) }),
    );
  }
  for (const seat of ["p1", "p2"] as const) {
    table = must(applyAction(table, { type: "setupReady", seat }));
  }
  // `p2` opens and passes, so `p1` attacks on a turn that carries no first-turn lock.
  return mustApply(table, { type: "endTurn", seat: "p2" }).state;
}

/** p1 fields the attacker with one Energy attached to pay a {C} cost, and an EMPTY
    Bench — the search puts cards into the HAND, so a Bench body would only add noise. */
function canonical(seed = 31): GameState {
  let state = setActiveFromDeck(openTable(seed), "p1", "d514-cinccino");
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

const nameOf = (state: GameState, uid: string): string =>
  (D514_POOL[state.cardIdByUid[uid] as string] as Card).name;

const resolve = (state: GameState, uids: string[]) =>
  mustApply(state, { type: "resolveEffect", seat: "p1", choice: { kind: "cards", uids } }).state;

function printedCount(rows: readonly (readonly [number, string])[], text: string): number {
  return rows.filter(([, s]) => s === text).reduce((sum, [n]) => sum + n, 0);
}

function claimsThisSlice(text: string): boolean {
  const first = (deriveAttackEffect(text) ?? [])[0] as
    | { op?: string; dest?: string; max?: unknown; filter?: { kind?: string } }
    | undefined;
  if (first?.op !== "searchDeck" || first.dest !== "hand") return false;
  return first.max === "any" || first.filter?.kind === "byName";
}

// ─────────────────────────────────────────────────────────────────────────────
// §1 — the printed sentence, its population, and the absences the axes owe.
// ─────────────────────────────────────────────────────────────────────────────

describe("§1 — the printed sentence, the population, and the absences", () => {
  it("ONE corpus row, TWO legal printings, and the delta from the sibling is TWO spans", () => {
    const printed = new Map(legalAttackCorpus().map(([n, s]) => [s, n]));
    expect(printed.get(PRINTED)).toBe(2);
    expect(printed.get(SIBLING)).toBe(1);
    expect(printed.get(BENCH_TWIN)).toBe(1);
    expect(
      SIBLING.replace("up to 2 cards and", "any number of Fennel cards, reveal them, and"),
    ).toBe(PRINTED);
    expect(PRINTED.startsWith("You may search")).toBe(true);
    expect(SIBLING.startsWith("You may search")).toBe(true);
  });

  it("the measurements the BANNER guard owes, and the one the arm's TRANSFER owes", () => {
    const rows = legalAttackCorpus();
    expect(rows).toHaveLength(640);
    for (const word of ["Ancient", "Future", "Tera"]) {
      const searches = rows.filter(
        ([, s]) => /^(?:You may search|Search) your deck/.test(s) && s.includes(`${word} card`),
      );
      expect([word, searches]).toEqual([word, []]);
    }
    // …and the banner words really are in the column, so the guard refuses something
    // the ingest can produce rather than a word this catalog has never seen.
    expect(rows.filter(([, s]) => /\b(?:Ancient|Future) cards?\b/.test(s)).length).toBeGreaterThan(
      0,
    );
    expect(printedCount(rows, COUNT_REPAIRED)).toBe(0);
    expect(printedCount(rows, CATEGORY_UNDER_ANY)).toBe(0);
    expect(printedCount(rows, BANNER)).toBe(0);
    const anyNumberSearches = rows.filter(
      ([, s]) => /^(?:You may search|Search) your deck/.test(s) && s.includes("any number of"),
    );
    expect(anyNumberSearches.map(([, s]) => s).sort()).toEqual([PRINTED, BENCH_TWIN].sort());
    expect(anyNumberSearches.reduce((sum, [n]) => sum + n, 0)).toBe(3);
  });

  it("the fixture pool is FILE-LOCAL, so no id ladder in the repo moves", () => {
    for (const id of Object.keys(D514_CARDS)) expect(FIXTURE_POOL[id]).toBeUndefined();
    expect(D514_DECK).toHaveLength(60);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — the resolver: the anchor that WAS the blocker, the second layer, the guards.
// ─────────────────────────────────────────────────────────────────────────────

describe("§2 — the anchor, the second layer, and the two refusals", () => {
  it("exactly ONE of thirteen readers claims it, at the VALUE", () => {
    expect(deriveAttackEffect(PRINTED)).toEqual(PROGRAM);
    for (const reader of OTHERS)
      expect([reader.name, reader(PRINTED)]).toEqual([reader.name, null]);
  });

  it("D510's HABIT, FOUR-FOR-FOUR: the PRE-slice anchor is DRIVEN, and here it says NULL", () => {
    expect(PRE_SLICE_HAND_SEARCH.exec(PRINTED)).toBeNull();
    expect(PRE_SLICE_HAND_SEARCH.exec(SIBLING)).not.toBeNull();
  });

  it("…AND THE COUNT WAS ONLY THE FIRST LAYER — the blockers are a CONJUNCTION", () => {
    const repaired = PRE_SLICE_HAND_SEARCH.exec(COUNT_REPAIRED);
    expect(repaired?.[4]).toBe("Fennel cards");
    expect(deriveAttackEffect(COUNT_REPAIRED)).toEqual([
      {
        op: "searchDeck",
        filter: { kind: "byName", name: "Fennel", cardNoun: true },
        dest: "hand",
        max: 2,
        reveal: true,
      },
      { op: "shuffleDeck" },
    ]);
    // …and the converse: the printed quantifier under a CATEGORY noun is claimed too,
    // with the table's filter. Both axes free, both read.
    expect(deriveAttackEffect(CATEGORY_UNDER_ANY)).toEqual([
      { op: "searchDeck", filter: { kind: "anyEnergy" }, dest: "hand", max: "any", reveal: true },
      { op: "shuffleDeck" },
    ]);
  });

  it("the BANNER is refused LOUDLY — D440's axis, and the one guard the siblings lack", () => {
    expect(deriveAttackEffect(BANNER)).toBeNull();
    for (const word of ["Ancient", "Future", "Tera"]) {
      const text = PRINTED.replace("Fennel cards", `${word} cards`);
      expect([word, deriveAttackEffect(text)]).toEqual([word, null]);
    }
    expect(deriveAttackEffect(PRINTED.replace("Fennel cards", "Ancients cards"))).not.toBeNull();
  });

  it("the ORDERING: the closed table is asked FIRST, so no category becomes a NAME", () => {
    const byCategory: readonly (readonly [string, string])[] = [
      ["Energy cards", "anyEnergy"],
      ["Item cards", "item"],
      ["Supporter cards", "supporter"],
      ["Stadium cards", "stadium"],
      ["Trainer cards", "trainerCard"],
      ["Basic Energy cards", "basicEnergy"],
      ["Pokémon Tool cards", "toolCard"],
    ];
    for (const [noun, kind] of byCategory) {
      const program = deriveAttackEffect(PRINTED.replace("Fennel cards", noun));
      const first = (program ?? [])[0] as { filter?: { kind?: string } } | undefined;
      expect([noun, first?.filter?.kind]).toEqual([noun, kind]);
    }
    // …and the brace pattern still runs BEFORE the name resolver too, so a typed noun
    // does not become a card called "Basic".
    const typed = deriveAttackEffect(PRINTED.replace("Fennel cards", "Basic {R} Energy cards"));
    expect((typed ?? [])[0]).toEqual({
      op: "searchDeck",
      filter: { kind: "basicEnergy", energyType: "Fire" },
      dest: "hand",
      max: "any",
      reveal: true,
    });
  });

  it("the NAME CLASS is `ATTACK_BENCH_SEARCH`'s, so an unspellable name stays LOUD", () => {
    for (const name of ["Iono's Bellibolt", "Ho-Oh", "Miraidon ex", "fennel"]) {
      const text = PRINTED.replace("Fennel cards", `${name} cards`);
      expect([name, deriveAttackEffect(text)]).toEqual([name, null]);
    }
    expect(
      deriveAttackEffect(
        "You may search your deck for a Fennel card, reveal it, and put it into your hand. Then, shuffle your deck.",
      ),
    ).toBeNull();
  });

  it("the BENCH TWIN does NOT come along — two printings, one phrase, two anchors", () => {
    expect(resolvedByAnyReader(BENCH_TWIN)).toBe(false);
    const registrySentences = legalAttackCorpus()
      .map(([, s]) => s)
      .filter((s) => /^(?:You may search|Search) your deck/.test(s) && !resolvedByAnyReader(s));
    expect(registrySentences).toContain(BENCH_TWIN);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — the board: the offer, the unbounded ceiling, and the caption.
// ─────────────────────────────────────────────────────────────────────────────

describe("§3 — the offer, the ceiling, and the caption that prints no number", () => {
  it("the candidates are EXACTLY the cards NAMED Fennel — equality, not a prefix", () => {
    const prompt = cardsPrompt(attack(canonical(), ANY_NUMBER));
    expect(prompt.candidates.length).toBeGreaterThan(0);
    const names = new Set(prompt.candidates.map((uid) => nameOf(canonical(), uid)));
    const state = attack(canonical(), ANY_NUMBER);
    const live = new Set(cardsPrompt(state).candidates.map((uid) => nameOf(state, uid)));
    expect([...live]).toEqual(["Fennel"]);
    expect(names.size).toBeGreaterThan(0);
    const deckNames = state.players.p1.deck.map((uid) => nameOf(state, uid));
    expect(deckNames).toContain("Fennell");
    expect(cardsPrompt(state).candidates.map((uid) => nameOf(state, uid))).not.toContain("Fennell");
  });

  it('*"any number"* IS THE WHOLE MATCHING SET — the ceiling is the offer, not a constant', () => {
    const state = attack(canonical(), ANY_NUMBER);
    const prompt = cardsPrompt(state);
    // The printed sentence names no ceiling, so the park's ceiling is the candidate
    // count itself. A build that resolved `"any"` to a sentinel, to a deck size, or to
    // any printed `up to N` in the family (the largest is 4) fails here.
    expect(prompt.max).toBe(prompt.candidates.length);
    expect(prompt.max).toBeGreaterThan(4);
    // …and it is still "up to": `min` is 0, so declining is a legal answer exactly as
    // it is for every other search in this vocabulary. The printed *"You may"* asks for
    // nothing the op did not already offer, which is why the OPENER axis is free.
    expect(prompt.min).toBe(0);
    // …and no caps ride this park: the two cap producers are `also` and
    // `distinctEnergyTypes`, and this program spells neither.
    expect("caps" in prompt).toBe(false);
  });

  it("taking ALL of them is a legal answer, and the hand actually gains them", () => {
    const state = attack(canonical(), ANY_NUMBER);
    const prompt = cardsPrompt(state);
    const all = [...prompt.candidates];
    const before = state.players.p1.hand.length;
    const after = resolve(state, all);
    expect(after.players.p1.hand.length).toBe(before + all.length);
    for (const uid of all) expect(after.players.p1.hand).toContain(uid);
    // …the deck lost exactly those cards and the trailing `shuffleDeck` still ran, so
    // the park is not left open.
    expect(after.players.p1.deck.length).toBe(state.players.p1.deck.length - all.length);
    expect(after.phase.kind).not.toBe("effect:choose");
  });

  it("the CAPTION reproduces the printed words and invents no number", () => {
    const note = cardsPrompt(attack(canonical(), ANY_NUMBER)).note;
    expect(note).toBe("Search your deck for any number of Fennel cards into your hand.");
    const sibling = cardsPrompt(attack(canonical(), UP_TO_TWO));
    expect(sibling.note).toBe("Search your deck for up to 2 cards into your hand.");
    expect(sibling.max).toBe(2);
    expect(note).not.toMatch(/\d/);
  });

  it("the BANNER attack never parks at all — the loud path, on a real board", () => {
    // The refusal §2 drives at the reader, driven again at the table: a sentence no
    // reader claims must leave through `ATTACK_EFFECT_SKIPPED` rather than parking
    // something. This is the rung that makes the guard reachable.
    const state = attack(canonical(), BANNER_ATTACK);
    expect(state.phase.kind).not.toBe("effect:choose");
  });
});

describe("§4 — the census step this slice is", () => {
  it("the row moved from the residue to the built set, and it is the ONLY one that did", () => {
    const claimed = legalAttackCorpus().filter(([, s]) => claimsThisSlice(s));
    expect(claimed.map(([, s]) => s)).toEqual([PRINTED]);
    expect(claimed.reduce((sum, [n]) => sum + n, 0)).toBe(2);
  });

  it("the NAMED deck search was ALREADY BUILT one destination over — measured, not argued", () => {
    const named = legalAttackCorpus().filter(([, text]) => {
      const first = (deriveAttackEffect(text) ?? [])[0] as
        | { op?: string; filter?: { kind?: string } }
        | undefined;
      return first?.op === "searchDeck" && first.filter?.kind === "byName";
    });
    const byDest = new Map<string, number>();
    for (const [, text] of named) {
      const first = (deriveAttackEffect(text) ?? [])[0] as { dest?: string };
      byDest.set(first.dest ?? "?", (byDest.get(first.dest ?? "?") ?? 0) + 1);
    }
    expect([...byDest.entries()].sort()).toEqual([
      ["bench", 4],
      ["hand", 1],
    ]);
    for (const [, text] of named) {
      const first = (deriveAttackEffect(text) ?? [])[0] as { dest?: string };
      expect([text, first.dest === "hand"]).toEqual([text, claimsThisSlice(text)]);
    }
  });

  it("the lattice, run BOTH WAYS and keyed on the DERIVED VALUE (D491/D503/D505)", () => {
    const OPENERS = ["You may search", "Search"];
    const COUNTS = ["any number of ", "up to 2 "];
    const NOUNS = ["Fennel cards", "cards"];
    const REVEALS = [", reveal them,", ""];
    const point = (m: number) =>
      `${OPENERS[m & 1]} your deck for ${COUNTS[(m >> 1) & 1]}${NOUNS[(m >> 2) & 1]}${REVEALS[(m >> 3) & 1]} and put them into your hand. Then, shuffle your deck.`;
    const points = Array.from({ length: 16 }, (_, i) => point(i));
    expect(new Set(points).size).toBe(16);
    expect(points[0]).toBe(PRINTED);
    expect(points[14]).toBe(SIBLING);

    expect(points.filter((s) => resolvedByAnyReader(s))).toHaveLength(16);
    for (const s of points) {
      expect([s, splitAttackGateClause(s)]).toEqual([s, null]);
      expect([s, splitAttackTrailingClause(s)]).toEqual([s, null]);
    }
    const wasBuilt = (s: string) => resolvedByAnyReader(s) && !claimsThisSlice(s);
    expect(points.filter(wasBuilt)).toHaveLength(4);
    const moved = points.filter(claimsThisSlice);
    expect(moved).toHaveLength(12);
    expect(moved.every((s) => s.includes("any number of") || s.includes("Fennel cards"))).toBe(
      true,
    );
    expect(16 - 4).toBe(moved.length);

    const flips = (claimed: (s: string) => boolean) =>
      [0, 1, 2, 3].map((ax) => {
        let n = 0;
        for (let m = 0; m < 16; m++) {
          if ((m >> ax) & 1) continue;
          if (claimed(point(m)) !== claimed(point(m | (1 << ax)))) n++;
        }
        return n;
      });
    expect(flips(wasBuilt)).toEqual([0, 4, 4, 0]);
    // POST — every axis is free and every point builds. **A pure widening leaves no
    // axis off zero**, so the lattice owes no new *"printed zero times"* measurement…
    expect(flips(resolvedByAnyReader)).toEqual([0, 0, 0, 0]);
    expect(new Set(points.map((s) => s.length)).size).toBeGreaterThan(1);
  });

  it("`MATCH_RECORD_VERSION` HOLDS at 30, and the argument is a WIDENING", () => {
    const parked = attack(canonical(), ANY_NUMBER);
    const cont = continuation(parked);
    expect((cont.pendingOp as { op: string }).op).toBe("searchDeck");
    expect((cont.pendingOp as { max?: unknown }).max).toBe("any");

    const v30 = continuation(attack(canonical(), UP_TO_TWO));
    expect((v30.pendingOp as { max?: unknown }).max).toBe(2);
    const resumed = runProgram(parked, [v30.pendingOp as EffectOp], v30.ctx, []);
    if (resumed.kind !== "parked" || resumed.prompt.kind !== "chooseCards") {
      throw new Error("expected the v30 op to park a chooseCards");
    }
    expect([resumed.prompt.min, resumed.prompt.max]).toEqual([0, 2]);
    expect(resumed.prompt.note).toBe("Search your deck for up to 2 cards into your hand.");
    expect(cardsPrompt(parked).note).not.toBe(resumed.prompt.note);
    expect(cardsPrompt(parked).max).not.toBe(2);
  });

  it('the multi-group caption carries `"any"` too — spelled, and DRIVEN', () => {
    const state = canonical();
    const op: EffectOp = {
      op: "searchDeck",
      filter: { kind: "byName", name: "Fennel", cardNoun: true },
      dest: "hand",
      max: "any",
      also: [{ filter: { kind: "item" }, max: 1 }],
    };
    const cont = continuation(attack(state, ANY_NUMBER));
    const out = runProgram(state, [op], cont.ctx, []);
    if (out.kind !== "parked" || out.prompt.kind !== "chooseCards") {
      throw new Error("expected a chooseCards park");
    }
    expect(out.prompt.note).toBe(
      "Search your deck for any number of Fennel cards and an Item card into your hand.",
    );
    // …and the TOTAL is the resolved first group plus the printed second, so the
    // caption's words and the validator's ceiling come off the same two numbers.
    expect(out.prompt.max).toBe(
      out.prompt.candidates.filter((uid) => nameOf(state, uid) === "Fennel").length + 1,
    );
  });
});
