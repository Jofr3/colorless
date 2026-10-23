import { describe, expect, it } from "vitest";
import { deriveAttackEffect } from "./effects";
import type { EffectOp, GameEvent, GameState, PokemonRef } from "./index";
import { applyAction } from "./index";
import { logFromEvents } from "./log";
import {
  DERIVED_LOOK_TOP_DECK,
  benchFromDeck,
  clearBench,
  driveSetup,
  attachFromDeck,
  mustApply,
  setActiveFromDeck,
  toDeckTop,
  types,
} from "./testFixtures";

interface Clause {
  readonly text: string;
  readonly program: readonly EffectOp[];
  readonly legalPrintings: number;
  readonly ids: readonly string[];
}

const BENCH_8: Clause = {
  text: "Look at the top 8 cards of your deck. You may put any number of Pokémon you find there onto your Bench. Shuffle the other cards back into your deck.",
  program: [
    { op: "lookAtTopN", n: 8, filter: { kind: "anyPokemon" }, max: "any", dest: "bench" },
    { op: "shuffleDeck" },
  ],
  legalPrintings: 2,
  ids: ["sv05-072", "sv05-171"], // Reuniclus "Summoning Gate"
};
const BENCH_10: Clause = {
  text: "Look at the top 10 cards of your deck. You may put any number of Pokémon you find there onto your Bench. Shuffle the other cards back into your deck.",
  program: [
    { op: "lookAtTopN", n: 10, filter: { kind: "anyPokemon" }, max: "any", dest: "bench" },
    { op: "shuffleDeck" },
  ],
  legalPrintings: 2,
  ids: ["sv08-142", "sv08-226"], // Tatsugiri ex "Cinnabar Lure"
};
/** `attachFromTop`, an op that has run since M5 — the arm buys a READER and
    nothing else. Its window of 20 is what forced `MAX_PRINTED_LOOK_WINDOW` to be
    its own constant rather than `MAX_PRINTED_ATTACH_COUNT`. */
const ATTACH_20: Clause = {
  text: "Look at the top 20 cards of your deck and attach any number of Energy cards you find there to your Pokémon in any way you like. Shuffle the other cards back into your deck.",
  program: [
    { op: "attachFromTop", n: 20, filter: { kind: "anyEnergy" }, max: "any" },
    { op: "shuffleDeck" },
  ],
  legalPrintings: 3,
  ids: ["svp-164", "sv07-032", "sv07-158"], // Lapras ex "Larimar Rain"
};
/** The one sentence in the family where the LOOK is the whole effect, and the
    reason the fidelity fix is not cosmetic. */
const DISCARD_TOP: Clause = {
  text: "Look at the top card of your deck. You may discard that card.",
  program: [{ op: "lookAtTopN", n: 1, filter: { kind: "anyCard" }, max: 1, dest: "discard" }],
  legalPrintings: 3,
  ids: ["sv09-084", "sv10.5w-016", "sv10.5w-101"], // Rockruff / Litwick ×2
};

const CLAUSES: readonly Clause[] = [BENCH_8, BENCH_10, ATTACH_20, DISCARD_TOP];

const UNREAD: readonly (readonly [string, number, string])[] = [] as const;

const BUILT_D534 = {
  text: "Look at the top card of your opponent's deck. You may have your opponent shuffle their deck.",
  legalPrintings: 1, // Inkay sv06.5-033
} as const;

const NEAR_MISSES: readonly (readonly [string, string])[] = [
  [
    "Look at the top 8 cards of your deck. You may put any number of Pokémon you find there onto your Bench. Shuffle the other cards back into your deck. Draw a card.",
    "a TRAILING CLAUSE — the terminal `$`, and the reason these patterns are literal to the last byte rather than a greedy `(.+)` that would backtrack past the period",
  ],
  [
    "Look at the top 0 cards of your deck. You may put any number of Pokémon you find there onto your Bench. Shuffle the other cards back into your deck.",
    "a printed 0 — the ingested-text floor every arm in this file carries, which would otherwise derive a window nobody looks at",
  ],
  [
    "Look at the top 99 cards of your deck. You may put any number of Pokémon you find there onto your Bench. Shuffle the other cards back into your deck.",
    "past `MAX_PRINTED_LOOK_WINDOW` — one malformed third-party row must not size a prompt",
  ],
  [
    "Look at the top 4e1 cards of your deck. You may put any number of Pokémon you find there onto your Bench. Shuffle the other cards back into your deck.",
    "EXPONENTIAL notation — `Number('4e1')` is 40, so a `.+` capture here would size a 40-card window off a string no card prints",
  ],
  [
    "Look at the top 4.5 cards of your deck. You may put any number of Pokémon you find there onto your Bench. Shuffle the other cards back into your deck.",
    "a FRACTIONAL window on the BENCH sentence — `Number('4.5')` is 4.5, which passes BOTH the floor and the ceiling, so this is the only case that distinguishes `\\d+` from `.+` here",
  ],
  [
    "Look at the top 0x14 cards of your deck and attach any number of Energy cards you find there to your Pokémon in any way you like. Shuffle the other cards back into your deck.",
    "HEXADECIMAL — `Number('0x14')` is 20, the exact printed window, so this is the mutant that would have looked correct",
  ],
  [
    "Look at the top 4.5 cards of your deck and attach any number of Energy cards you find there to your Pokémon in any way you like. Shuffle the other cards back into your deck.",
    "a FRACTIONAL window — `Number('4.5')` is 4.5, and `deck.slice(0, 4.5)` is a silent truncation nobody authored",
  ],
  [
    "Look at the top 20 cards of your deck and attach any number of Energy cards you find there to your Pokémon in any way you like. Shuffle the other cards back into your deck. Draw a card.",
    "a TRAILING CLAUSE on the ATTACH sentence — the terminal `$` is the ONLY thing refusing it, since the pattern is literal to its last byte and has no `[^.]` class to stop at the period",
  ],
  [
    "Look at the top card of your deck. You may discard that card. Draw a card.",
    "the same trailing clause on the DISCARD sentence, which is a `test` rather than an `exec` and therefore has no capture to backtrack — three anchors, three cases",
  ],
  [
    "Look at the top 8 cards of your deck. You may put any number of Supporter cards you find there onto your Bench. Shuffle the other cards back into your deck.",
    "a NON-POKÉMON noun at the Bench destination — nothing downstream re-checks it (`searchDeck`'s precedent), so the printed word 'Pokémon' is welded into the pattern rather than captured",
  ],
  [
    "Look at the top 20 cards of your deck and attach any number of Basic Energy cards you find there to your Pokémon in any way you like. Shuffle the other cards back into your deck.",
    "the printed word 'Basic' — a real narrowing this arm does not spell, and admitting it under `anyEnergy` would attach a Special Energy the sentence excludes",
  ],
  [
    "Look at the top card of your opponent's deck. You may discard that card.",
    "the OPPONENT's deck on the discard sentence — the op reads `ctx.seat`'s deck and nothing else, so a build that matched this would silently mill the wrong player",
  ],
];

const SUMMONING_GATE = 55;
const LARIMAR_RAIN = 56;
const DIG_IT_UP = 57;

function board(seed: number): GameState {
  const state = driveSetup(
    seed,
    { p1: DERIVED_LOOK_TOP_DECK, p2: DERIVED_LOOK_TOP_DECK },
    { first: "p2" },
  );
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** p1 attacks with `fix-trainerops`, holding one {C} for the cost, over a Bench
    built to order. p2 is a plain body so nothing on the other side of the table
    can be reached by accident. */
function ready(seed: number, bench: readonly string[] = []): GameState {
  let state = setActiveFromDeck(board(seed), "p1", "fix-trainerops");
  state = attachFromDeck(state, "p1", "fix-energy", 1);
  state = clearBench(state, "p1");
  for (const id of bench) state = benchFromDeck(state, "p1", id);
  state = setActiveFromDeck(state, "p2", "fix-bigbody");
  state = clearBench(state, "p2");
  state = benchFromDeck(state, "p2", "fix-basic-1");
  return state;
}

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

function cardsPrompt(state: GameState) {
  if (state.phase.kind !== "effect:choose") {
    throw new Error(`expected a park, got ${state.phase.kind}`);
  }
  if (state.phase.prompt.kind !== "chooseCards") {
    throw new Error(`expected chooseCards, got ${state.phase.prompt.kind}`);
  }
  return state.phase.prompt;
}

/** The card ids a prompt is offering, sorted — what the FILTER admitted, named
    rather than counted. */
function offered(state: GameState): string[] {
  return cardsPrompt(state)
    .candidates.map((uid) => state.cardIdByUid[uid] as string)
    .sort();
}

const attack = (state: GameState, index: number) =>
  mustApply(state, { type: "attack", seat: "p1", index });

const resolveCards = (state: GameState, uids: string[]) =>
  mustApply(state, { type: "resolveEffect", seat: "p1", choice: { kind: "cards", uids } });

const activeRef: PokemonRef = { seat: "p1", spot: { spot: "active" } };

// ─────────────────────────────────────────────────────────────────────────────
// 1. THE THREE ANCHORS
// ─────────────────────────────────────────────────────────────────────────────

describe("the anchors — four printed sentences, THREE arms", () => {
  it("derives each printed sentence to its program", () => {
    for (const { text, program } of CLAUSES) {
      expect(deriveAttackEffect(text), text).toEqual(program);
    }
  });

  it("adds up: 10 of the row's 15 legal printings here, 4 more at D341, the last 1 at D534", () => {
    expect(CLAUSES).toHaveLength(4);
    expect(CLAUSES.reduce((sum, c) => sum + c.legalPrintings, 0)).toBe(10);
    expect(UNREAD).toHaveLength(0);
    expect(UNREAD.reduce((sum, [, legal]) => sum + legal, 0)).toBe(0);
    for (const [text] of UNREAD) expect(deriveAttackEffect(text), text).toBeNull();
    expect(deriveAttackEffect(BUILT_D534.text)).not.toBeNull();
    const D341_PRINTINGS = 4;
    const D341_SENTENCES = 2;
    const D534_SENTENCES = 1;
    expect(
      CLAUSES.reduce((sum, c) => sum + c.legalPrintings, 0) +
        D341_PRINTINGS +
        BUILT_D534.legalPrintings +
        UNREAD.reduce((sum, [, legal]) => sum + legal, 0),
    ).toBe(15);
    expect(CLAUSES.length + D341_SENTENCES + D534_SENTENCES + UNREAD.length).toBe(7);
    for (const text of [
      "Look at the top 4 cards of your deck and put them back in any order.",
      "Look at the top 5 cards of your opponent's deck and put them back in any order.",
    ]) {
      expect(deriveAttackEffect(text), text).not.toBeNull();
    }
  });

  it("each id named above is a REAL Standard-legal printing count, not a paraphrase", () => {
    for (const clause of CLAUSES) {
      expect(clause.ids, clause.text).toHaveLength(clause.legalPrintings);
      expect(new Set(clause.ids).size).toBe(clause.ids.length);
    }
  });

  it("refuses every near miss — and each for its OWN reason", () => {
    for (const [text, why] of NEAR_MISSES) {
      expect(deriveAttackEffect(text), `${text} — ${why}`).toBeNull();
    }
  });

  it("the two window ceilings are DIFFERENT numbers, and the catalog is why", () => {
    expect(deriveAttackEffect(ATTACH_20.text)).not.toBeNull();
    expect(
      deriveAttackEffect(
        "Look at the top 30 cards of your deck and attach any number of Energy cards you find there to your Pokémon in any way you like. Shuffle the other cards back into your deck.",
      ),
    ).not.toBeNull();
    expect(
      deriveAttackEffect(
        "Look at the top 31 cards of your deck and attach any number of Energy cards you find there to your Pokémon in any way you like. Shuffle the other cards back into your deck.",
      ),
    ).toBeNull();
  });

  it("the BENCH filter is welded to the printed noun, so the benchable guard has nothing to do", () => {
    for (const clause of [BENCH_8, BENCH_10]) {
      const [look] = deriveAttackEffect(clause.text) as EffectOp[];
      expect(look).toMatchObject({ op: "lookAtTopN", filter: { kind: "anyPokemon" } });
    }
  });

  it('D333 — "any number of" is the printed WORDS, and D241 spelled it as the window', () => {
    const [look8] = deriveAttackEffect(BENCH_8.text) as EffectOp[];
    const [look10] = deriveAttackEffect(BENCH_10.text) as EffectOp[];
    expect(look8).toMatchObject({ n: 8, max: "any" });
    expect(look10).toMatchObject({ n: 10, max: "any" });
  });

  it("D333 — and it DRIVES: the prompt caps at the window's Pokémon, and says the printed words", () => {
    let state = ready(9, ["fix-basic-1"]);
    state = toDeckTop(state, "p1", "fix-energy", 5);
    state = toDeckTop(state, "p1", "fix-duskull", 3);
    const parked = attack(state, SUMMONING_GATE).state;
    expect(cardsPrompt(parked).max).toBe(3);
    expect(cardsPrompt(parked).note).toBe(
      "Look at the top 8 cards of your deck and put any number of Pokémon onto your Bench.",
    );
    expect(cardsPrompt(parked).note).not.toContain("up to");
  });

  it("the DISCARD sentence carries NO trailing shuffle, and the absence is printed", () => {
    // A one-card window has no leftovers, so there is nothing to shuffle back —
    // and on the DECLINE a shuffle would scramble a top the player deliberately
    // kept, which is the opposite of what the card offers.
    expect(deriveAttackEffect(DISCARD_TOP.text)).toHaveLength(1);
    expect(deriveAttackEffect(BENCH_8.text)?.[1]).toEqual({ op: "shuffleDeck" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. THE BOARD — the three arms driven end to end
// ─────────────────────────────────────────────────────────────────────────────

describe("Summoning Gate — the look that BENCHES", () => {
  it("offers only the Pokémon in the window and benches the picks", () => {
    let state = ready(1, ["fix-basic-1"]);
    // A mixed window: 3 Pokémon over 5 non-Pokémon, so a build that dropped the
    // filter would offer eight rows here instead of three.
    state = toDeckTop(state, "p1", "fix-energy", 5);
    state = toDeckTop(state, "p1", "fix-duskull", 3);
    const window8 = state.players.p1.deck.slice(0, 8);
    const parked = attack(state, SUMMONING_GATE).state;

    expect(offered(parked)).toEqual(["fix-duskull", "fix-duskull", "fix-duskull"]);
    expect(cardsPrompt(parked).dest).toBe("bench");
    expect(cardsPrompt(parked).min).toBe(0); // the printed "You may"
    expect(cardsPrompt(parked).note).toContain("onto your Bench");

    const picks = window8.filter((uid) => state.cardIdByUid[uid] === "fix-duskull").slice(0, 2);
    const { state: done, events } = resolveCards(parked, picks);
    expect(done.phase.kind).toBe("turn:action");
    // The picks are IN PLAY, not in hand — the whole point of the new `dest`.
    expect(done.players.p1.bench.map((p) => done.cardIdByUid[p.stack[0] as string])).toEqual([
      "fix-basic-1",
      "fix-duskull",
      "fix-duskull",
    ]);
    for (const uid of picks) expect(done.players.p1.deck).not.toContain(uid);
    expect(find(events, "DECK_TOP_REVEALED")).toMatchObject({
      seat: "p1",
      dest: "bench",
      uids: picks,
    });
    expect(types(events)).toContain("SHUFFLE"); // the printed leftovers clause
  });

  it("CLAMPS to the remaining Bench space — the set removed from the deck is the set that lands", () => {
    let state = ready(2, ["fix-basic-1", "fix-basic-1", "fix-basic-1", "fix-basic-1"]);
    state = toDeckTop(state, "p1", "fix-duskull", 4);
    const window8 = state.players.p1.deck.slice(0, 8);
    const picks = window8.filter((uid) => state.cardIdByUid[uid] === "fix-duskull");
    expect(picks).toHaveLength(4);

    const parked = attack(state, SUMMONING_GATE).state;
    expect(cardsPrompt(parked).max).toBe(1);
    expect(
      applyAction(parked, {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "cards", uids: picks },
      }).ok,
    ).toBe(false);
    const { state: done } = resolveCards(parked, picks.slice(0, 1));
    expect(done.players.p1.bench).toHaveLength(5); // §4's cap
    // Exactly ONE left the deck; the other three are still in it. Card
    // conservation, asserted card by card rather than by a total.
    const landed = picks.filter((uid) => !done.players.p1.deck.includes(uid));
    expect(landed).toEqual(picks.slice(0, 1));
    for (const uid of picks) {
      const inDeck = done.players.p1.deck.includes(uid);
      const inPlay = done.players.p1.bench.some((p) => p.stack.includes(uid));
      expect(inDeck !== inPlay, uid).toBe(true); // in exactly one zone
    }
  });

  it("a window with no Pokémon never parks — but STILL announces the look", () => {
    let state = ready(3, ["fix-basic-1"]);
    state = toDeckTop(state, "p1", "fix-energy", 8);
    const { state: after, events } = attack(state, SUMMONING_GATE);
    expect(after.phase.kind).toBe("turn:action");
    expect(find(events, "DECK_TOP_REVEALED")).toMatchObject({
      seat: "p1",
      dest: "bench",
      uids: [],
    });
    expect(types(events)).toContain("SHUFFLE");
  });
});

describe("Larimar Rain — the look that ATTACHES (attachFromTop, an op since M5)", () => {
  it("offers Basic AND Special Energy from the top 20, and attaches where told", () => {
    let state = ready(4);
    // `anyEnergy`, never `basicEnergy`: a Special sits in the window beside a
    // Basic and a non-Energy, so all three readings are distinguishable here.
    state = toDeckTop(state, "p1", "fix-basic-1", 2);
    state = toDeckTop(state, "p1", "fix-special", 1);
    state = toDeckTop(state, "p1", "fix-energy", 1);
    const basic = state.players.p1.deck[0] as string;
    const special = state.players.p1.deck[1] as string;

    const parked = attack(state, LARIMAR_RAIN).state;
    if (parked.phase.kind !== "effect:choose" || parked.phase.prompt.kind !== "attachCards") {
      throw new Error(`expected an attachCards park, got ${parked.phase.kind}`);
    }
    expect(parked.phase.prompt.candidates).toContain(basic);
    expect(parked.phase.prompt.candidates).toContain(special);

    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: {
        kind: "attachCards",
        assignments: [
          { uid: basic, to: activeRef },
          { uid: special, to: activeRef },
        ],
      },
    });
    // One {C} was attached for the cost; these two land on top of it.
    expect(done.players.p1.active?.energy).toContain(basic);
    expect(done.players.p1.active?.energy).toContain(special);
    expect(types(events)).toContain("SHUFFLE");
    expect(types(events)).not.toContain("DECK_TOP_DISCARDED");
  });
});

describe("Dig It Up — the look that DISCARDS, and the decline that used to be silent", () => {
  it("puts the top card in the discard pile when taken", () => {
    let state = ready(5);
    state = toDeckTop(state, "p1", "fix-duskull", 1);
    const top = state.players.p1.deck[0] as string;
    const pileBefore = [...state.players.p1.discard];

    const parked = attack(state, DIG_IT_UP).state;
    expect(offered(parked)).toEqual(["fix-duskull"]); // `anyCard` — the window is one
    expect(cardsPrompt(parked).dest).toBe("discard");

    const { state: done, events } = resolveCards(parked, [top]);
    expect(done.players.p1.discard).toEqual([...pileBefore, top]);
    expect(done.players.p1.deck).not.toContain(top);
    expect(find(events, "DECK_TOP_REVEALED")).toMatchObject({
      seat: "p1",
      dest: "discard",
      uids: [top],
    });
    // No trailing shuffle — the sentence prints none, and the deck order below
    // the looked-at card is exactly what it was.
    expect(types(events)).not.toContain("SHUFFLE");
  });

  it("THE DECLINE IS ANNOUNCED — the fidelity fix, at the printing that needs it", () => {
    let state = ready(6);
    state = toDeckTop(state, "p1", "fix-duskull", 1);
    const top = state.players.p1.deck[0] as string;

    const parked = attack(state, DIG_IT_UP).state;
    const { state: done, events } = resolveCards(parked, []); // the printed "you may", declined

    expect(done.players.p1.deck[0]).toBe(top);
    expect(find(events, "DECK_TOP_REVEALED")).toMatchObject({
      seat: "p1",
      dest: "discard",
      uids: [],
    });
  });

  it("`anyCard` means ANY card — an Energy on top is offered exactly as a Pokémon is", () => {
    // The printed sentence names no noun ("that card"), so a build that guessed a
    // Pokémon filter would refuse the commonest top card in any deck.
    let state = ready(7);
    state = toDeckTop(state, "p1", "fix-energy", 1);
    expect(offered(attack(state, DIG_IT_UP).state)).toEqual(["fix-energy"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. THE LOG — the channel the debt was actually about
// ─────────────────────────────────────────────────────────────────────────────

describe("log.ts — the row says WHERE, and says the empty look out loud", () => {
  const state = board(8);
  const uid = state.players.p1.deck[0] as string;
  const render = (event: GameEvent): string =>
    logFromEvents([event], { names: { p1: "P1", p2: "P2" }, state, elapsed: "+00:09" })
      .map((entry) =>
        entry.kind === "turn"
          ? `— turn ${entry.turn} —`
          : entry.segments.map((s) => s.text).join(""),
      )
      .join(" | ");

  it("distinguishes the three destinations rather than asserting 'in hand'", () => {
    expect(render({ type: "DECK_TOP_REVEALED", seat: "p1", uids: [uid] })).toContain("in hand");
    expect(render({ type: "DECK_TOP_REVEALED", seat: "p1", dest: "bench", uids: [uid] })).toContain(
      "onto their Bench",
    );
    expect(
      render({ type: "DECK_TOP_REVEALED", seat: "p1", dest: "discard", uids: [uid] }),
    ).toContain("in the discard pile");
  });

  it("renders the EMPTY look — the row that did not exist before D241", () => {
    const text = render({ type: "DECK_TOP_REVEALED", seat: "p1", uids: [] });
    expect(text).toContain("looked at the top of their deck");
    expect(text).toContain("took nothing");
    // …and it names NOTHING, on either side of the `reveal` rider: a printed
    // reveal that took nothing revealed nothing, so the two renders are the same
    // sentence and the identity of the window never crosses.
    expect(render({ type: "DECK_TOP_REVEALED", seat: "p1", uids: [], reveal: true })).toBe(text);
  });

  it("the reveal rider still names the cards, and now says where they went", () => {
    const text = render({
      type: "DECK_TOP_REVEALED",
      seat: "p1",
      dest: "bench",
      uids: [uid],
      reveal: true,
    });
    expect(text).toContain("revealed");
    expect(text).toContain("onto their Bench");
  });
});
