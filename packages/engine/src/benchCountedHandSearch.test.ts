import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import {
  deriveAttackCoinFlip,
  deriveAttackEffect,
  splitAttackCancelClause,
  splitAttackGateClause,
  splitAttackRequirementClause,
  splitAttackTrailingClause,
  ATTACK_READERS,
} from "./effects";
import type { EffectOp } from "./effectTypes";
import { applyAction } from "./index";
import type { GameEvent, GameState } from "./index";
import type { EffectContinuation, EffectPrompt } from "./effectPrompt";
import { resumeProgram, runProgram } from "./interpreter";
import { logFromEvents } from "./log";
import { redactGame } from "./redact";
import {
  FIXTURE_POOL,
  activeUid,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  mustApply,
  setActiveFromDeck,
  trimDeckTo,
  types,
  driveSetup,
  roundTrip,
} from "./testFixtures";

const PRINTED =
  "Search your deck for a number of cards up to the number of your Benched Pokémon and put them into your hand. Then, shuffle your deck.";
const UP_TO_THREE =
  "Search your deck for up to 3 cards and put them into your hand. Then, shuffle your deck.";
const ANY_NUMBER =
  "Search your deck for any number of cards and put them into your hand. Then, shuffle your deck.";
const D525_ROW =
  "Flip 3 coins. Put a number of cards up to the number of heads from your discard pile into your hand.";

/** THE PROGRAM, spelled once. */
const PROGRAM: readonly EffectOp[] = [
  { op: "searchDeck", filter: { kind: "anyCard" }, dest: "hand", max: "yourBenchCount" },
  { op: "shuffleDeck" },
];

const READERS = ATTACK_READERS.map(({ read }) => read);
const SPLITTERS = [
  splitAttackCancelClause,
  splitAttackGateClause,
  splitAttackRequirementClause,
  splitAttackTrailingClause,
];

const units = (rows: readonly (readonly [number, string])[]) => rows.reduce((s, [n]) => s + n, 0);
const claims = (re: RegExp): readonly [number, number, readonly string[]] => {
  const rows = legalAttackCorpus().filter(([, s]) => re.test(s));
  return [rows.length, units(rows), rows.map(([, s]) => s)];
};

const BASE = 30;
const PLAIN = "fix-energy";
const WALL = "d527-wall";
/** The Bench filler — a 60 HP Colorless Basic, benched by surgery in the count each rung names. */
const PAL = "d527-pal";

const SEARCH_CARDS: Record<string, Card> = {
  "d527-scout": battler("d527-scout", {
    name: "D527 Scout",
    types: ["Colorless"],
    hp: 130,
    retreat: 2,
    attacks: [
      /** index 0 — PRINTED verbatim, with a DECLARED base and cost. */
      { cost: ["Colorless"], name: "Bench Call", damage: BASE, effect: PRINTED },
      /** index 1 — the CONTROL: the printed-digit sibling, `max: 3` on every board. */
      { cost: ["Colorless"], name: "Plain Call", damage: BASE, effect: UP_TO_THREE },
      /** index 2 — no effect, no program. */
      { cost: ["Colorless"], name: "Jab", damage: BASE },
    ],
  }),
  /** The defender — 400 HP, no W/R. */
  [WALL]: battler(WALL, { name: "D527 Wall", types: ["Colorless"], hp: 400 }),
  [PAL]: battler(PAL, { name: "D527 Pal", types: ["Colorless"], hp: 60 }),
};

const SEARCH_POOL: Record<string, Card> = { ...FIXTURE_POOL, ...SEARCH_CARDS };

const SEARCH_DECK = deckOf({
  "d527-scout": 8,
  [WALL]: 8,
  [PAL]: 16,
  [PLAIN]: 20,
  "fix-item": 8,
});

const SEED = 7;

function openTable(seed: number): GameState {
  const state = driveSetup(
    seed,
    { p1: SEARCH_DECK, p2: SEARCH_DECK },
    { pool: SEARCH_POOL, first: "p2" },
  );
  // `p2` opens and passes, so `p1` attacks on a turn that carries no first-turn lock.
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

type Board = {
  /** P1's Bench count — the number the literal resolves to. */
  readonly bench: number;
  /** P2's Bench count — the number it must NOT resolve to. Default 0. */
  readonly opponentBench?: number;
  /** P1's deck trimmed to this many cards (the rest to the discard pile). Default: untrimmed. */
  readonly deck?: number;
};

/** p1 owns turn 2 with the attacker Active holding ONE Colorless Basic (the {C} cost); P2 went first.
    Both Benches are CLEARED after the Active surgeries (`setActiveFromDeck` displaces onto the
    Bench) and then filled by count. */
function table(board: Board): GameState {
  let state = setActiveFromDeck(openTable(SEED), "p1", "d527-scout");
  state = attachFromDeck(state, "p1", PLAIN, 1);
  state = clearBench(state, "p1");
  state = setActiveFromDeck(state, "p2", WALL);
  state = clearBench(state, "p2");
  for (let i = 0; i < board.bench; i += 1) state = benchFromDeck(state, "p1", PAL);
  for (let i = 0; i < (board.opponentBench ?? 0); i += 1) state = benchFromDeck(state, "p2", PAL);
  if (board.deck !== undefined) state = trimDeckTo(state, "p1", board.deck);
  return state;
}

type Swing = { before: GameState; after: GameState; events: GameEvent[] };

function swing(board: Board, index = 0): Swing {
  const before = table(board);
  const { state: after, events } = mustApply(before, { type: "attack", seat: "p1", index });
  return { before, after, events };
}

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

/** `opRecord.test.ts`'s idiom: answer the parked chooseCards. */
const pick = (state: GameState, uids: readonly string[]) =>
  mustApply(state, {
    type: "resolveEffect",
    seat: "p1",
    choice: { kind: "cards", uids: [...uids] },
  });

const NAMES = { p1: "P1", p2: "P2" } as const;
const rows = (events: readonly GameEvent[], state: GameState): string[] =>
  logFromEvents(events, { names: NAMES, state, elapsed: "+00:09" }).map((entry) =>
    entry.kind === "turn" ? `— turn ${entry.turn} —` : entry.segments.map((s) => s.text).join(""),
  );

function searchedRows(events: readonly GameEvent[]) {
  return events.filter(
    (e): e is Extract<GameEvent, { type: "DECK_SEARCHED" }> => e.type === "DECK_SEARCHED",
  );
}
function shuffleRows(events: readonly GameEvent[]) {
  return events.filter((e): e is Extract<GameEvent, { type: "SHUFFLE" }> => e.type === "SHUFFLE");
}
function dealtRows(events: readonly GameEvent[]) {
  return events.filter(
    (e): e is Extract<GameEvent, { type: "DAMAGE_DEALT" }> => e.type === "DAMAGE_DEALT",
  );
}

const CAPTION =
  "Search your deck for a number of cards up to the number of your Benched Pokémon into your hand.";

describe('D527 §1 — file line 454 derives to EXACTLY the sibling\'s two-op shape with `max: "yourBenchCount"`', () => {
  it('the row derives to the program — `searchDeck { anyCard, hand, max: "yourBenchCount" }` then `shuffleDeck`, no `reveal`, no `exact`, no `also` (`D527-arm-adds-reveal` / `-arm-copies-the-any-neighbour` / `-arm-max-is-the-article` / `-arm-filter-copies-any-pokemon`)', () => {
    expect(deriveAttackEffect(PRINTED)).toEqual(PROGRAM);
    const got = deriveAttackEffect(PRINTED);
    if (got === null) throw new Error("the row derived null");
    expect(got).toHaveLength(2);
    const [search, shuffle] = got;
    expect(shuffle).toEqual({ op: "shuffleDeck" });
    if (search?.op !== "searchDeck") throw new Error("the first op is not a searchDeck");
    expect(Object.keys(search).sort()).toEqual(["dest", "filter", "max", "op"]);
    expect(search.max).toBe("yourBenchCount");
    expect(typeof search.max).toBe("string");
    expect(search.filter).toEqual({ kind: "anyCard" });
    expect("reveal" in search).toBe(false);
    expect("exact" in search).toBe(false);
    expect("also" in search).toBe(false);
  });

  it("`deriveAttackEffect` is the ONLY claimant — twelve readers and four splitters are null on the row — and the reader surface is still THIRTEEN", () => {
    for (const reader of READERS) {
      if (reader === deriveAttackEffect) continue;
      expect(reader(PRINTED), reader.name).toBeNull();
    }
    for (const splitter of SPLITTERS) expect(splitter(PRINTED), splitter.name).toBeNull();
    expect(deriveAttackEffect(PRINTED)).not.toBeNull();
    expect(resolvedByAnyReader(PRINTED)).toBe(true);
    expect(attackReaderSurface()).toContain("deriveAttackEffect");
  });

  it("the anchor is WHOLE-SENTENCE at the HEAD: a PREFIXED print is null on every reader and every splitter (D520 (3); `D527-anchor-loses-the-head`)", () => {
    const prefixed = `Draw a card. ${PRINTED}`;
    expect(legalAttackCorpus().some(([, s]) => s === prefixed)).toBe(false);
    for (const reader of READERS) expect(reader(prefixed), reader.name).toBeNull();
    for (const splitter of SPLITTERS) expect(splitter(prefixed), splitter.name).toBeNull();
    expect(resolvedByAnyReader(prefixed)).toBe(false);
  });

  it('…and at the TAIL: a SUFFIXED print is null on every reader, and the TRAILING splitter COMPOSES `{head: row, tail: "Draw a card."}` because the head is now claimed (D426/D526 (5) — asserted, not asserted away; `D527-anchor-loses-the-tail`)', () => {
    const suffixed = `${PRINTED} Draw a card.`;
    expect(legalAttackCorpus().some(([, s]) => s === suffixed)).toBe(false);
    for (const reader of READERS) expect(reader(suffixed), reader.name).toBeNull();
    expect(resolvedByAnyReader(suffixed)).toBe(false);
    expect(splitAttackCancelClause(suffixed)).toBeNull();
    expect(splitAttackGateClause(suffixed)).toBeNull();
    expect(splitAttackRequirementClause(suffixed)).toBeNull();
    expect(splitAttackTrailingClause(suffixed)).toEqual({ head: PRINTED, tail: "Draw a card." });
  });

  it("one-token near-misses, all null on EVERY reader — the opponent's Bench, `in play`, `Pokémon` for `cards`, the reveal clause, the `You may` opener, the Bench destination", () => {
    const controls: Record<string, string> = {
      "`your opponent's Benched Pokémon` for `your Benched Pokémon` — the owner is a literal (the literal names the ATTACKER's Bench)":
        "Search your deck for a number of cards up to the number of your opponent's Benched Pokémon and put them into your hand. Then, shuffle your deck.",
      "`Pokémon in play` for `Benched Pokémon` — the zone is a literal (`bench` excludes the Active)":
        "Search your deck for a number of cards up to the number of your Pokémon in play and put them into your hand. Then, shuffle your deck.",
      "`a number of Pokémon` for `a number of cards` — the noun is FIXED in the anchor (`anyCard`), not captured":
        "Search your deck for a number of Pokémon up to the number of your Benched Pokémon and put them into your hand. Then, shuffle your deck.",
      "the reveal clause inserted — the anchor has no reveal group, and the hand is NOT revealed":
        "Search your deck for a number of cards up to the number of your Benched Pokémon, reveal them, and put them into your hand. Then, shuffle your deck.",
      "`You may search` for `Search` — the sibling admits the opener; this anchor spells the printed verb only":
        "You may search your deck for a number of cards up to the number of your Benched Pokémon and put them into your hand. Then, shuffle your deck.",
      "`onto your Bench` for `into your hand` — the destination is a literal":
        "Search your deck for a number of cards up to the number of your Benched Pokémon and put them onto your Bench. Then, shuffle your deck.",
    };
    for (const [why, s] of Object.entries(controls)) {
      expect(s, why).not.toBe(PRINTED);
      for (const reader of READERS) expect(reader(s), `${why} — ${reader.name}`).toBeNull();
      expect(resolvedByAnyReader(s), why).toBe(false);
      expect(
        legalAttackCorpus().some(([, t]) => t === s),
        why,
      ).toBe(false);
    }
  });

  it('THE CONTROLS: the printed-digit sibling still derives `max: 3` (`ATTACK_HAND_SEARCH` byte-unchanged), `any number of cards` still derives `max: "any"`, and corpus line 219 (D525) still derives its coin flip', () => {
    expect(deriveAttackEffect(UP_TO_THREE)).toEqual([
      { op: "searchDeck", filter: { kind: "anyCard" }, dest: "hand", max: 3 },
      { op: "shuffleDeck" },
    ]);
    expect(deriveAttackEffect(ANY_NUMBER)).toEqual([
      { op: "searchDeck", filter: { kind: "anyCard" }, dest: "hand", max: "any" },
      { op: "shuffleDeck" },
    ]);
    expect(deriveAttackEffect(D525_ROW)).toBeNull();
    expect(deriveAttackCoinFlip(D525_ROW)?.kind).toBe("retrievalUpToHeads");
    expect(resolvedByAnyReader(D525_ROW)).toBe(true);
    // The three quantifiers are three DIFFERENT values on the same op, which is what makes the
    // bench-2 rung below discriminate the literal from its two neighbours.
    const maxOf = (s: string) => (deriveAttackEffect(s)?.[0] as { max?: unknown } | undefined)?.max;
    expect(new Set([maxOf(PRINTED), maxOf(UP_TO_THREE), maxOf(ANY_NUMBER)]).size).toBe(3);
    // …and the `any number of cards` spelling is printed ZERO times, so it is a construction.
    expect(legalAttackCorpus().some(([, s]) => s === ANY_NUMBER)).toBe(false);
  });

  it("the anchor's claimed set over every corpus row is EXACTLY {file line 454} — 1 sentence / 1 printing — and the literal appears on exactly that row; `up to the number of` is printed on THREE rows and `a number of cards` on TWO", () => {
    const [n, u, claimed] = claims(
      /^Search your deck for a number of cards up to the number of your Benched Pokémon and put them into your hand\. Then, shuffle your deck\.$/,
    );
    expect([n, u]).toEqual([1, 1]);
    expect(claimed).toEqual([PRINTED]);
    const all = legalAttackCorpus();
    const literal = all.filter(([, s]) =>
      (deriveAttackEffect(s) ?? []).some(
        (op) => (op as { max?: unknown }).max === "yourBenchCount",
      ),
    );
    expect(literal).toEqual([[1, PRINTED]]);
    expect(
      all.filter(([, s]) => s.includes("up to the number of")).map(([, s]) => s.length),
    ).toHaveLength(3);
    const nounPhrase = all.filter(([, s]) => s.includes("a number of cards"));
    expect(nounPhrase.map(([, s]) => s).sort()).toEqual([D525_ROW, PRINTED].sort());
  });

  it("the fixture pool is FILE-LOCAL — zero `FIXTURE_POOL` ids, the deck is 60, and svp-188 is unresolvable here", () => {
    expect(Object.keys(SEARCH_CARDS).every((id) => FIXTURE_POOL[id] === undefined)).toBe(true);
    expect(SEARCH_DECK).toHaveLength(60);
    expect(FIXTURE_POOL[PLAIN]?.name).toBe(PLAIN);
    expect(FIXTURE_POOL["svp-188"]).toBeUndefined();
    expect(SEARCH_CARDS["d527-scout"]?.attacks?.[0]?.effect).toBe(PRINTED);
    expect(SEARCH_CARDS["d527-scout"]?.attacks?.[1]?.effect).toBe(UP_TO_THREE);
    expect(SEARCH_CARDS["d527-scout"]?.attacks?.[2]?.effect).toBeUndefined();
  });
});

describe("D527 §2 — the literal resolves to the ATTACKER's Bench length at STEP time and parks ONE `chooseCards { min 0, max: bench, dest hand }`", () => {
  it("the board is what it says: P1's attacker is Active with one Colorless Basic, P2's wall is Active, the Benches are the counts named, turn 2", () => {
    const before = table({ bench: 2, opponentBench: 3 });
    expect(before.players.p1.active?.energy).toHaveLength(1);
    expect(before.cardIdByUid[activeUid(before, "p1")]).toBe("d527-scout");
    expect(before.cardIdByUid[activeUid(before, "p2")]).toBe(WALL);
    expect(before.players.p1.bench).toHaveLength(2);
    expect(before.players.p2.bench).toHaveLength(3);
    expect(before.turn).toBe(2);
    expect(table({ bench: 0 }).players.p1.bench).toHaveLength(0);
    expect(table({ bench: 5 }).players.p1.bench).toHaveLength(5);
  });

  it('(i) Bench 2 → ONE park: `effect:choose` / `chooseCards { min 0, max 2, dest "hand" }` over the WHOLE deck in deck order, the note the PRINTED caption byte for byte, the base 30 ALREADY dealt, the turn NOT ended (`D527-arm-copies-the-any-neighbour` sees the deck size here, `-arm-max-is-the-article` sees 1, `-caption-prints-the-digit` sees "up to 2")', () => {
    const { before, after, events } = swing({ bench: 2 });
    expect(after.phase.kind).toBe("effect:choose");
    expect(after.phase.kind === "effect:choose" && after.phase.seat).toBe("p1");
    const prompt = cardsPrompt(after);
    expect(prompt.min).toBe(0);
    expect(prompt.max).toBe(2);
    expect(typeof prompt.max).toBe("number");
    expect(prompt.dest).toBe("hand");
    expect(prompt.candidates).toEqual(before.players.p1.deck);
    expect(prompt.candidates.length).toBeGreaterThan(2);
    expect(prompt.note).toBe(CAPTION);
    expect(prompt.note).not.toContain("up to 2");
    expect(prompt.note).not.toContain("any number");
    expect("caps" in prompt).toBe(false);
    // The base is dealt in FULL beside the park: DAMAGE_DEALT lands BEFORE the park opens.
    expect(dealtRows(events)).toHaveLength(1);
    expect(dealtRows(events)[0]).toMatchObject({
      seat: "p2",
      by: "p1",
      uid: activeUid(before, "p2"),
      dealt: BASE,
    });
    expect(types(events)).toEqual(["ATTACK_DECLARED", "DAMAGE_DEALT", "EFFECT_PENDING"]);
    expect(searchedRows(events)).toHaveLength(0);
    expect(shuffleRows(events)).toHaveLength(0);
    // Nothing moved at the park.
    expect(after.players.p1.hand).toEqual(before.players.p1.hand);
    expect(after.players.p1.deck).toEqual(before.players.p1.deck);
    // The continuation holds the LITERAL — resolved at the park, persisted as the printed word.
    expect(continuation(after).pendingOp).toEqual(PROGRAM[0]);
    expect(continuation(after).rest).toEqual([{ op: "shuffleDeck" }]);
  });

  it('(ii) pick 2 of the 2 → both uids to P1\'s HAND, the deck −2, `DECK_SEARCHED { dest: "hand" }` with exactly those uids and NO `reveal`, the SHUFFLE after it under the attacker, the count-only log row MEASURED, the turn ends (`D527-arm-adds-reveal`)', () => {
    const { after: parked } = swing({ bench: 2 });
    const offered = cardsPrompt(parked).candidates;
    const chosen = [offered[0], offered[5]].filter((u): u is string => u !== undefined);
    expect(chosen).toHaveLength(2);
    const { state, events } = pick(parked, chosen);
    expect(state.players.p1.hand).toHaveLength(parked.players.p1.hand.length + 2);
    for (const uid of chosen) expect(state.players.p1.hand).toContain(uid);
    expect(state.players.p1.deck).toHaveLength(parked.players.p1.deck.length - 2);
    for (const uid of chosen) expect(state.players.p1.deck).not.toContain(uid);
    const searched = searchedRows(events);
    expect(searched).toHaveLength(1);
    expect(searched[0]).toEqual({ type: "DECK_SEARCHED", seat: "p1", dest: "hand", uids: chosen });
    expect("reveal" in (searched[0] ?? {})).toBe(false);
    expect(shuffleRows(events)).toEqual([{ type: "SHUFFLE", seat: "p1" }]);
    expect(types(events)).toEqual([
      "DECK_SEARCHED",
      "SHUFFLE",
      "TURN_ENDED",
      "TURN_STARTED",
      "CARDS_DRAWN",
    ]);
    expect(dealtRows(events)).toHaveLength(0); // the base was dealt BEFORE the park, not again
    expect(state.players.p2.active?.damage).toBe(BASE);
    expect(state.phase).toEqual({ kind: "turn:action", seat: "p2" });
    expect(state.turn).toBe(3);
    const lines = rows(events, state);
    expect(lines).toContain("searched their deck — put 2 cards in hand");
    expect(lines).toContain("shuffled their deck");
    expect(lines).toContain("ended their turn");
    for (const line of lines)
      for (const uid of chosen) expect(line).not.toContain(state.cardIdByUid[uid] ?? " ");
  });

  it("(iii) the OPPONENT's redacted view of the park: the prompt is NOT theirs (`prompt: null`) and their view of P1's hand after the pick is a COUNT — the hand is not revealed", () => {
    const { after: parked } = swing({ bench: 2 });
    const theirs = redactGame(parked, "p2");
    expect(theirs.phase).toEqual({ kind: "effect:choose", prompt: null });
    const mine = redactGame(parked, "p1");
    if (mine.phase.kind !== "effect:choose" || mine.phase.prompt?.kind !== "chooseCards") {
      throw new Error("P1's view does not carry the chooseCards prompt");
    }
    expect(mine.phase.prompt.max).toBe(2);
    expect(mine.phase.prompt.note).toBe(CAPTION);
    const [a, b] = cardsPrompt(parked).candidates;
    if (a === undefined || b === undefined) throw new Error("no candidates");
    const { state } = pick(parked, [a, b]);
    const hand = redactGame(state, "p2").board.opponent.hand;
    expect(hand).toHaveLength(parked.players.p1.hand.length + 2);
    expect(hand.every((c) => c.cardId === "hidden" && c.name === "Face-down card")).toBe(true);
  });

  it("(iv) Bench 0 → NO park: the literal resolves to 0 and takes the `max <= 0` no-op — no `EFFECT_PENDING`, no `DECK_SEARCHED`, the deck SHUFFLED under the attacker (the trailing op still runs), the base dealt, the turn ends (`D527-sized-reads-bench-plus-one` sees 1 here)", () => {
    const { before, after, events } = swing({ bench: 0 });
    expect(after.phase).toEqual({ kind: "turn:action", seat: "p2" });
    expect(types(events)).toEqual([
      "ATTACK_DECLARED",
      "DAMAGE_DEALT",
      "SHUFFLE",
      "TURN_ENDED",
      "TURN_STARTED",
      "CARDS_DRAWN",
    ]);
    expect(searchedRows(events)).toHaveLength(0);
    expect(shuffleRows(events)).toEqual([{ type: "SHUFFLE", seat: "p1" }]);
    expect(after.players.p2.active?.damage).toBe(BASE);
    // The deck was shuffled (same multiset, different order — the seed decides the order) and the
    // hand grew by exactly the turn-start draw of the NEXT turn (P2's), i.e. P1's hand is unmoved.
    expect([...after.players.p1.deck].sort()).toEqual([...before.players.p1.deck].sort());
    expect(after.players.p1.deck).not.toEqual(before.players.p1.deck);
    expect(after.players.p1.hand).toEqual(before.players.p1.hand);
    // …and the CONTROL parks at 3 on the same empty Bench: the sibling reads its digit, not the board.
    expect(cardsPrompt(swing({ bench: 0 }, 1).after).max).toBe(3);
  });

  it("(v) Bench 5 → `max 5`; the CONTROL still parks at 3 on the same board (`D527-sized-reads-bench-max` cannot be told apart HERE — (i)'s 2 is its killer)", () => {
    const { after } = swing({ bench: 5 });
    expect(cardsPrompt(after).max).toBe(5);
    expect(cardsPrompt(after).note).toBe(CAPTION);
    expect(cardsPrompt(swing({ bench: 5 }, 1).after).max).toBe(3);
    // One, three and four as well — the ceiling IS the count, on every count.
    for (const bench of [1, 3, 4])
      expect(cardsPrompt(swing({ bench }).after).max, String(bench)).toBe(bench);
  });

  it("(vi) the OPPONENT's Bench is IRRELEVANT: P1 Bench 2 against P2 Bench 0, 3 and 5 parks `max 2` every time (`D527-sized-reads-the-opponents-bench`)", () => {
    for (const opponentBench of [0, 3, 5]) {
      const { before, after } = swing({ bench: 2, opponentBench });
      expect(before.players.p2.bench, String(opponentBench)).toHaveLength(opponentBench);
      expect(cardsPrompt(after).max, String(opponentBench)).toBe(2);
    }
    // …and the mirror: P1 Bench 4 against P2 Bench 1 is 4, not 1.
    expect(cardsPrompt(swing({ bench: 4, opponentBench: 1 }).after).max).toBe(4);
  });

  it("(vii) a deck SMALLER than the Bench: Bench 5 over a 3-card deck offers the 3 candidates under `max 5` — the ceiling is the BENCH COUNT (measured: the park does NOT clamp `max` to the candidates for a hand search), taking all 3 is legal, and a uid outside the deck is refused", () => {
    const { before, after } = swing({ bench: 5, deck: 3 });
    expect(before.players.p1.deck).toHaveLength(3);
    const prompt = cardsPrompt(after);
    expect(prompt.candidates).toEqual(before.players.p1.deck);
    expect(prompt.candidates).toHaveLength(3);
    expect(prompt.max).toBe(5);
    expect(prompt.min).toBe(0);
    const { state, events } = pick(after, prompt.candidates);
    expect(state.players.p1.deck).toHaveLength(0);
    expect(state.players.p1.hand).toHaveLength(after.players.p1.hand.length + 3);
    expect(searchedRows(events)[0]?.uids).toHaveLength(3);
    expect(rows(events, state)).toContain("searched their deck — put 3 cards in hand");
    // A uid that is not a candidate (the Active's own uid) is refused, whatever the ceiling.
    const refused = applyAction(after, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [activeUid(after, "p1")] },
    });
    expect(refused.ok).toBe(false);
    if (refused.ok) throw new Error("a non-candidate uid was accepted");
    expect(refused.error.code).toBe("BAD_EFFECT_CHOICE");
  });

  it("(viii) a pick ABOVE the ceiling is refused — 3 uids under `max 2` is `BAD_EFFECT_CHOICE`; 2 is accepted (the resolved number is the validator's, not only the caption's)", () => {
    const { after } = swing({ bench: 2 });
    const [a, b, c] = cardsPrompt(after).candidates;
    if (a === undefined || b === undefined || c === undefined) throw new Error("no candidates");
    const over = applyAction(after, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [a, b, c] },
    });
    expect(over.ok).toBe(false);
    if (over.ok) throw new Error("a pick above the ceiling was accepted");
    expect(over.error.code).toBe("BAD_EFFECT_CHOICE");
    expect(pick(after, [a, b]).state.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("(ix) DECLINE (choose []) → nothing moves, no `DECK_SEARCHED`, the deck STILL shuffles, the base stands at 30, the turn ends", () => {
    const { after: parked } = swing({ bench: 3 });
    const { state, events } = pick(parked, []);
    expect(state.players.p1.hand).toEqual(parked.players.p1.hand);
    expect([...state.players.p1.deck].sort()).toEqual([...parked.players.p1.deck].sort());
    expect(searchedRows(events)).toHaveLength(0);
    expect(shuffleRows(events)).toEqual([{ type: "SHUFFLE", seat: "p1" }]);
    expect(dealtRows(events)).toHaveLength(0);
    expect(state.players.p2.active?.damage).toBe(BASE);
    expect(types(events)).toEqual(["SHUFFLE", "TURN_ENDED", "TURN_STARTED", "CARDS_DRAWN"]);
    expect(state.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("(x) the count is read at STEP time, not when the program starts: a hand-authored program that BENCHES one body and THEN searches parks `max 2` on a board that held Bench 1 when the program began (`runProgram` → `resumeProgram`, the same continuation the attack parks)", () => {
    const before = table({ bench: 1 });
    const ctx = continuation(mustApply(before, { type: "attack", seat: "p1", index: 0 }).state).ctx;
    const program: readonly EffectOp[] = [
      { op: "searchDeck", filter: { kind: "basicPokemon" }, dest: "bench", max: 1, exact: true },
      ...PROGRAM,
    ];
    const events: GameEvent[] = [];
    const first = runProgram(before, program, ctx, {}, events);
    if (first.kind !== "parked" || first.prompt.kind !== "chooseCards")
      throw new Error("expected the bench park");
    expect(first.prompt.dest).toBe("bench");
    expect(first.state.players.p1.bench).toHaveLength(1);
    const [body] = first.prompt.candidates;
    if (body === undefined) throw new Error("no Basic to bench");
    const second = resumeProgram(first.state, first.cont, { kind: "cards", uids: [body] }, events);
    if (second.kind !== "parked" || second.prompt.kind !== "chooseCards")
      throw new Error("expected the hand park");
    expect(second.state.players.p1.bench).toHaveLength(2);
    expect(second.prompt.dest).toBe("hand");
    expect(second.prompt.max).toBe(2);
    expect(second.prompt.note).toBe(CAPTION);
    expect(second.cont.pendingOp).toEqual(PROGRAM[0]);
    // …and the same literal on the ORIGINAL board reads 1: the number is the board's at the step.
    const direct = runProgram(before, PROGRAM, ctx, {}, []);
    if (direct.kind !== "parked" || direct.prompt.kind !== "chooseCards")
      throw new Error("expected a park");
    expect(direct.prompt.max).toBe(1);
  });

  it('(xi) the multi-group caption carries the literal too — spelled, and DRIVEN off a hand-authored op (D514\'s call for `"any"`, one branch over): `caps` are the resolved bench count and the printed second number', () => {
    const state = table({ bench: 2 });
    const ctx = continuation(mustApply(state, { type: "attack", seat: "p1", index: 0 }).state).ctx;
    const op: EffectOp = {
      op: "searchDeck",
      filter: { kind: "anyCard" },
      dest: "hand",
      max: "yourBenchCount",
      also: [{ filter: { kind: "item" }, max: 1 }],
    };
    const out = runProgram(state, [op], ctx, {}, []);
    if (out.kind !== "parked" || out.prompt.kind !== "chooseCards")
      throw new Error("expected a chooseCards park");
    expect(out.prompt.note).toBe(
      "Search your deck for a number of cards up to the number of your Benched Pokémon and an Item card into your hand.",
    );
    expect(out.prompt.max).toBe(3);
    expect(out.prompt.caps?.map((cap) => cap.max)).toEqual([2, 1]);
    expect(out.prompt.caps?.[0]?.uids).toEqual(state.players.p1.deck);
  });

  it("(xii) replays identically from one seed — the same parked board and the same events twice; and the parked state JSON round-trips BYTE-EQUAL and resumes from its bytes", () => {
    const a = swing({ bench: 3 });
    const b = swing({ bench: 3 });
    expect(b.before).toEqual(a.before);
    expect(b.after).toEqual(a.after);
    expect(b.events).toEqual(a.events);
    const persisted = roundTrip(a.after);
    expect(persisted).toEqual(a.after);
    expect(JSON.stringify(persisted)).toBe(JSON.stringify(a.after));
    const [x, y] = cardsPrompt(a.after).candidates;
    if (x === undefined || y === undefined) throw new Error("no candidates");
    const live = pick(a.after, [x, y]);
    const replayed = pick(persisted, [x, y]);
    expect(replayed.events).toEqual(live.events);
    expect(replayed.state).toEqual(live.state);
  });

  it("(xiii) the index-2 control: no program, no park, no shuffle, 30 dealt, the deck UNMOVED, the turn ends", () => {
    const { before, after, events } = swing({ bench: 2 }, 2);
    expect(after.phase).toEqual({ kind: "turn:action", seat: "p2" });
    expect(types(events)).toEqual([
      "ATTACK_DECLARED",
      "DAMAGE_DEALT",
      "TURN_ENDED",
      "TURN_STARTED",
      "CARDS_DRAWN",
    ]);
    expect(after.players.p1.deck).toEqual(before.players.p1.deck);
    expect(after.players.p2.active?.damage).toBe(BASE);
  });
});

describe("D527 §3 — `MATCH_RECORD_VERSION` HOLDS at 30 ( held at THIS slice; 31 since D547; 32 since D548; 33 since D549; 34 since D552; 35 since D556; 36 since D564; 37 since D570; 38 since D575; 39 since D576; 40 since D577; 41 since D579; 42 since D583; 43 since D621; 44 since D630; 45 since D636; 46 since D637; 47 since D640; 48 since D643; 49 since D646), and the argument is a WIDENING driven over v30 bytes", () => {
  it('the parked `pendingOp.max` is the LITERAL `"yourBenchCount"` — the persisted word, resolved only when the op steps', () => {
    const parked = swing({ bench: 2 }).after;
    const cont = continuation(parked);
    expect((cont.pendingOp as { op: string }).op).toBe("searchDeck");
    expect((cont.pendingOp as { max?: unknown }).max).toBe("yourBenchCount");
    expect(JSON.stringify(cont.pendingOp)).toBe(
      '{"op":"searchDeck","filter":{"kind":"anyCard"},"dest":"hand","max":"yourBenchCount"}',
    );
    expect(Object.keys(cont).sort()).toEqual(
      ["ctx", "pendingOp", "record", "rest"].filter((k) => k in cont).sort(),
    );
  });

  it('a reconstructed v30 NUMERIC `pendingOp` resumes under THIS build to the prompt v30 meant — `max 3`, the digit caption — and D514\'s `"any"` still resolves to the deck: no v30 inhabitant changed meaning', () => {
    // The SIBLING's parked op is v30 bytes exactly — a numeric `max`, authorable by the previous
    // deploy — so resuming it under this build is the loss direction, and it parks what v30 parked.
    const board = table({ bench: 2 });
    const literal = mustApply(board, { type: "attack", seat: "p1", index: 0 }).state;
    const v30 = continuation(mustApply(board, { type: "attack", seat: "p1", index: 1 }).state);
    expect((v30.pendingOp as { max?: unknown }).max).toBe(3);
    const resumed = runProgram(literal, [v30.pendingOp as EffectOp], v30.ctx, {}, []);
    if (resumed.kind !== "parked" || resumed.prompt.kind !== "chooseCards") {
      throw new Error("expected the v30 op to park a chooseCards");
    }
    expect([resumed.prompt.min, resumed.prompt.max]).toEqual([0, 3]);
    expect(resumed.prompt.note).toBe("Search your deck for up to 3 cards into your hand.");
    const anyOp = deriveAttackEffect(ANY_NUMBER)?.[0];
    if (anyOp === undefined) throw new Error("the any-number control derived null");
    const any = runProgram(literal, [anyOp], v30.ctx, {}, []);
    if (any.kind !== "parked" || any.prompt.kind !== "chooseCards")
      throw new Error("expected a park");
    expect(any.prompt.max).toBe(literal.players.p1.deck.length);
    expect(any.prompt.note).toBe("Search your deck for any number of cards into your hand.");
    expect(cardsPrompt(literal).max).toBe(2);
    expect(cardsPrompt(literal).note).not.toBe(resumed.prompt.note);
    expect(cardsPrompt(literal).note).not.toBe(any.prompt.note);
  });
});

describe("D527 §4 — the census moved in exactly ONE summand, by 1 sentence / 1 printing; the version steps", () => {
  it("the reader arm reads 554 sentences / 1,596 printings, and the row is IN it", () => {
    const resolved = legalAttackCorpus().filter(([, s]) => resolvedByAnyReader(s));
    expect(resolved.map(([, s]) => s)).toContain(PRINTED);
    const without = resolved.filter(([, s]) => s !== PRINTED);
    expect([resolved.length - without.length, units(resolved) - units(without)]).toEqual([1, 1]);
  });

  it("the RAW reader-only residue fell by exactly 1 sentence / 1 printing — 86 / 136 — and the row left it", () => {
    const unbuilt = legalAttackCorpus().filter(([, s]) => !resolvedByAnyReader(s));
    expect(unbuilt.map(([, s]) => s)).not.toContain(PRINTED);
  });

  it("the move is READER-keyed: no gate clause, no trailing split, no cancel split, no requirement split claims the row itself", () => {
    expect(splitAttackGateClause(PRINTED)).toBeNull();
    expect(splitAttackTrailingClause(PRINTED)).toBeNull();
    expect(splitAttackCancelClause(PRINTED)).toBeNull();
    expect(splitAttackRequirementClause(PRINTED)).toBeNull();
  });
});
