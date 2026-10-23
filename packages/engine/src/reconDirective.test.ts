import { describe, expect, it } from "vitest";
import type { GameEvent, GameState } from "./index";
import { programFor } from "./registry";
import {
  LEFTOVERS_DESTINATION_DECK,
  benchFromDeck,
  driveSetup,
  expectErr,
  handFromDeck,
  handUid,
  mustApply,
  setActiveFromDeck,
  toDeckTop,
  trimDeckTo,
} from "./testFixtures";

function types(events: readonly GameEvent[]): string[] {
  return events.map((e) => e.type);
}

function find<T extends GameEvent["type"]>(
  events: readonly GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

const deckAt = (state: GameState, index: number): string => {
  const uid = state.players.p1.deck[index];
  if (uid === undefined) throw new Error(`no card at deck index ${index}`);
  return uid;
};

const cardIdOf = (state: GameState, uid: string): string | undefined => state.cardIdByUid[uid];

function census(state: GameState): string[] {
  const side = state.players.p1;
  const inPlay = [side.active, ...side.bench].flatMap((p) =>
    p === null ? [] : [...p.stack, ...p.energy, ...p.tools],
  );
  return [...side.deck, ...side.hand, ...side.discard, ...side.prizes, ...inPlay].sort();
}

function cardsPrompt(state: GameState) {
  if (state.phase.kind !== "effect:choose")
    throw new Error(`expected effect:choose, got ${state.phase.kind}`);
  if (state.phase.prompt.kind !== "chooseCards")
    throw new Error(`expected chooseCards, got ${state.phase.prompt.kind}`);
  return state.phase.prompt;
}

/** Setup, then open P1's turn 2 (P2 went first and passed) — P1's first
    unrestricted turn, so an Ability and a Supporter are both playable. */
function board(seed: number): GameState {
  const state = driveSetup(
    seed,
    { p1: LEFTOVERS_DESTINATION_DECK, p2: LEFTOVERS_DESTINATION_DECK },
    { first: "p2" },
  );
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

function reconBoard(seed: number): GameState {
  let state = board(seed);
  state = setActiveFromDeck(state, "p1", "fix-basic-1");
  // Rebuild the bench outright: `useAbility` names a bench INDEX, so a suite that
  // let the setup deal whatever Basic it drew would target a different Pokémon per
  // seed (`attachFromTop.test.ts`'s `withBoard` states this rule).
  state = { ...state, players: { ...state.players, p1: { ...state.players.p1, bench: [] } } };
  state = benchFromDeck(state, "p1", "fix-drakloak");
  // Prepending composes, so seed the DEEPER card first.
  state = toDeckTop(state, "p1", "fix-energy", 1);
  state = toDeckTop(state, "p1", "fix-item", 1);
  return state;
}

const reconDirective = {
  type: "useAbility",
  seat: "p1",
  target: { spot: "bench", index: 0 },
  abilityName: "Recon Directive",
} as const;

/** Rika in hand, and a seeded top 4 of FOUR card classes — an Item, a Supporter,
    a Pokémon and an Energy, in that order from the top. `anyCard` admits all
    four, so a narrowed filter loses rows on three of them. */
function rikaBoard(seed: number): GameState {
  let state = board(seed);
  state = handFromDeck(state, "p1", "fix-rika", 1);
  state = toDeckTop(state, "p1", "fix-energy", 1);
  state = toDeckTop(state, "p1", "fix-basic-1", 1);
  state = toDeckTop(state, "p1", "sv01-189", 1);
  state = toDeckTop(state, "p1", "fix-item", 1);
  return state;
}

// ─────────────────────────────────────────────────────────────────────────────
// §1 — THE REGISTRY ROWS, READ BEFORE ANY BOARD RUNS
// ─────────────────────────────────────────────────────────────────────────────

describe("D335 §1 — the two programs, and the axis they consume", () => {
  it("every printing resolves, reprints share ONE object, and the two cards do NOT", () => {
    for (const id of [
      "sv06-129",
      "sv08.5-072",
      "sv04-172",
      "sv04-241",
      "sv04-258",
      "fix-drakloak",
      "fix-rika",
    ]) {
      expect(programFor(id), id).toBeDefined();
    }
    expect(programFor("sv08.5-072")).toBe(programFor("sv06-129"));
    expect(programFor("fix-drakloak")).toBe(programFor("sv06-129"));
    expect(programFor("sv04-241")).toBe(programFor("sv04-172"));
    expect(programFor("sv04-258")).toBe(programFor("sv04-172"));
    expect(programFor("fix-rika")).toBe(programFor("sv04-172"));
    expect(programFor("sv04-172")).not.toBe(programFor("sv06-129"));
    expect(programFor("sv06-129")).not.toBe(programFor("sv05-147"));
    expect(programFor("sv04-172")).not.toBe(programFor("sv05-147"));
  });

  it("both are Explorer's Guidance's op with the DESTINATION moved — read off the registry", () => {
    const drakloak = programFor("sv06-129")?.abilities?.[0];
    const rika = programFor("sv04-172")?.trainer?.[0];
    const eg = programFor("sv05-147")?.trainer?.[0];
    if (drakloak === undefined) throw new Error("expected an ability program");
    const recon = drakloak.program[0];
    if (recon?.op !== "lookAtTopN") throw new Error("expected a lookAtTopN op");
    if (rika?.op !== "lookAtTopN") throw new Error("expected a lookAtTopN op");
    if (eg?.op !== "lookAtTopN") throw new Error("expected a lookAtTopN op");

    // Drakloak — the printed first clause is the ABILITY's, not the op's.
    expect(drakloak.name).toBe("Recon Directive");
    expect(drakloak.oncePerTurn).toBe(true);
    expect(drakloak.activeOnly).toBe(false);
    expect(recon.n).toBe(2);
    expect(recon.filter).toEqual({ kind: "anyCard" });
    expect(recon.max).toBe(1);
    expect(recon.exact).toBe(true);
    expect(recon.restTo).toBe("bottom");
    expect(recon.reveal).toBeUndefined();
    expect(recon.also).toBeUndefined();
    expect(recon.dest).toBeUndefined();

    // Rika — the same op, a wider window, a bigger take, the third destination.
    expect(rika.n).toBe(4);
    expect(rika.filter).toEqual({ kind: "anyCard" });
    expect(rika.max).toBe(2);
    expect(rika.exact).toBe(true);
    expect(rika.restTo).toBe("shuffledBottom");
    expect(rika.reveal).toBeUndefined();
    expect(rika.also).toBeUndefined();
    expect(rika.dest).toBeUndefined();

    expect(eg.exact).toBe(true);
    expect(eg.restTo).toBe("discard");
    expect(eg.n).toBe(6);
  });

  it("NEITHER carries a trailing `shuffleDeck`, and the absence is PRINTED on both", () => {
    expect(programFor("sv06-129")?.abilities?.[0]?.program).toHaveLength(1);
    expect(programFor("sv04-172")?.trainer).toHaveLength(1);
    // The control: the op with the sibling clause DOES carry it.
    expect(programFor("sv02-183")?.trainer?.map((op) => op.op)).toEqual([
      "lookAtTopN",
      "shuffleDeck",
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — DRAKLOAK: `restTo: "bottom"`, THE DETERMINISTIC DESTINATION
// ─────────────────────────────────────────────────────────────────────────────

describe("D335 §2 — Recon Directive puts the other card UNDER the deck", () => {
  it("parks on the top 2 with a floor of ONE — the printed take, not a ceiling", () => {
    const state = reconBoard(1);
    const top = [deckAt(state, 0), deckAt(state, 1)];
    const { state: parked } = mustApply(state, reconDirective);
    const prompt = cardsPrompt(parked);
    expect(prompt.candidates).toEqual(top);
    expect(prompt.dest).toBe("hand");
    // `exact` — the printed "put 1 of them", with no "up to" and no second "you may".
    expect(prompt.min).toBe(1);
    expect(prompt.max).toBe(1);
  });

  it("`exact` is INVISIBLE in this caption and visible ONLY in `min`", () => {
    const { state: parked } = mustApply(reconBoard(2), reconDirective);
    const prompt = cardsPrompt(parked);
    expect(prompt.note).toBe("Look at the top 2 cards of your deck and put a card into your hand.");
    expect(prompt.note).not.toContain("up to");
    expect(prompt.min).toBe(1);
  });

  it("the printed 'you may' is the ABILITY's decline — the TAKE inside it is not", () => {
    // The `exact` + optional interaction nothing in the suite had exercised. A
    // player may leave Recon Directive unused all turn; a player who USES it does
    // not get to look at two cards and take neither.
    const { state: parked } = mustApply(reconBoard(3), reconDirective);
    expectErr(
      parked,
      { type: "resolveEffect", seat: "p1", choice: { kind: "cards", uids: [] } },
      "BAD_EFFECT_CHOICE",
    );
  });

  it("the taken card reaches the hand and the OTHER one is at the very bottom", () => {
    const state = reconBoard(4);
    const taken = deckAt(state, 0);
    const leftover = deckAt(state, 1);
    const tail = state.players.p1.deck.slice(2);
    const before = census(state);

    const { state: done } = mustApply(mustApply(state, reconDirective).state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [taken] },
    });
    expect(done.players.p1.hand).toContain(taken);
    // THE WHOLE POINT: the leftover is under EVERYTHING, and everything else kept
    // its order. Read as `at(-1)` and as the full sequence, because "the leftover
    // is somewhere in the deck" would pass on a shuffle.
    expect(done.players.p1.deck.at(-1)).toBe(leftover);
    expect(done.players.p1.deck).toEqual([...tail, leftover]);
    // It did NOT leave the deck: the pile is untouched (an Ability discards
    // nothing of its own, unlike the Supporter in §3).
    expect(done.players.p1.discard).toEqual(state.players.p1.discard);
    expect(census(done)).toEqual(before);
  });

  it("NO event says so — not DECK_TOP_DISCARDED, not CARD_TO_BOTTOM_OF_DECK, not SHUFFLE", () => {
    // The whole event finding, driven. The look IS announced (`DECK_TOP_REVEALED`
    // names only the TAKEN card, since the leftover was never public); the bottoming
    // is not, because nothing changed zone and nothing was randomized.
    const state = reconBoard(5);
    const taken = deckAt(state, 0);
    const { state: parked, events: parkEvents } = mustApply(state, reconDirective);
    const { events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [taken] },
    });
    const all = [...parkEvents, ...events];
    expect(find(all, "DECK_TOP_REVEALED")?.uids).toEqual([taken]);
    expect(types(all)).not.toContain("DECK_TOP_DISCARDED");
    expect(types(all)).not.toContain("CARD_TO_BOTTOM_OF_DECK");
    expect(types(all)).not.toContain("SHUFFLE");
  });

  it("and `rngState` is UNTOUCHED — the difference from Rika is not cosmetic", () => {
    const state = reconBoard(6);
    const taken = deckAt(state, 0);
    const { state: done } = mustApply(mustApply(state, reconDirective).state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [taken] },
    });
    expect(done.rngState).toBe(state.rngState);
  });

  it("is once per turn, and works from the BENCH (activeOnly: false)", () => {
    const state = reconBoard(7);
    const taken = deckAt(state, 0);
    const { state: done } = mustApply(mustApply(state, reconDirective).state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [taken] },
    });
    // It ran at all, from bench index 0 — the `activeOnly: false` half.
    expect(done.players.p1.hand).toContain(taken);
    expectErr(done, reconDirective, "ABILITY_ALREADY_USED");
  });

  it("a ONE-card deck takes the card and has no leftover to bottom", () => {
    let state = reconBoard(8);
    state = trimDeckTo(state, "p1", 1);
    const only = deckAt(state, 0);
    const { state: parked } = mustApply(state, reconDirective);
    const prompt = cardsPrompt(parked);
    expect(prompt.candidates).toEqual([only]);
    expect(prompt.min).toBe(1);
    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [only] },
    });
    expect(done.players.p1.deck).toEqual([]);
    expect(done.players.p1.hand).toContain(only);
    expect(types(events)).not.toContain("DECK_TOP_DISCARDED");
  });

  it("an EMPTY deck announces nothing at all — nobody looked", () => {
    let state = reconBoard(9);
    state = trimDeckTo(state, "p1", 0);
    const { state: done, events } = mustApply(state, reconDirective);
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(types(events)).not.toContain("DECK_TOP_REVEALED");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — RIKA: `restTo: "shuffledBottom"`, THE SECOND PRINTED DECISION
// ─────────────────────────────────────────────────────────────────────────────

describe("D335 §3 — Rika shuffles the other cards and puts them under the deck", () => {
  it("parks on the top 4 with a floor of TWO, and the caption drops the 'up to'", () => {
    const state = rikaBoard(11);
    const top = state.players.p1.deck.slice(0, 4);
    const uid = handUid(state, "p1", "fix-rika");
    const { state: parked } = mustApply(state, { type: "playTrainer", seat: "p1", uid });
    const prompt = cardsPrompt(parked);
    expect(prompt.candidates).toEqual(top);
    expect(prompt.min).toBe(2);
    expect(prompt.max).toBe(2);
    expect(prompt.note).toBe(
      "Look at the top 4 cards of your deck and put 2 cards into your hand.",
    );
    // The window really did hold four different card classes, so `anyCard` is
    // attributable — a narrowed filter would lose three of these rows.
    expect(top.map((u) => cardIdOf(parked, u))).toEqual([
      "fix-item",
      "sv01-189",
      "fix-basic-1",
      "fix-energy",
    ]);
  });

  it("the two taken cards reach the hand and the other two sit UNDER the deck", () => {
    const state = rikaBoard(12);
    const window = state.players.p1.deck.slice(0, 4);
    const [takenA, , , takenD] = window as [string, string, string, string];
    const leftovers = [window[1], window[2]] as string[];
    const tail = state.players.p1.deck.slice(4);
    const uid = handUid(state, "p1", "fix-rika");
    const before = census(state);

    const { state: parked } = mustApply(state, { type: "playTrainer", seat: "p1", uid });
    const { state: done } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [takenA, takenD] },
    });
    expect(done.players.p1.hand).toContain(takenA);
    expect(done.players.p1.hand).toContain(takenD);
    // The leftovers are UNDER everything, as a SET — their order among themselves
    // is the shuffle's business and is asserted separately below.
    expect(done.players.p1.deck.slice(-2).sort()).toEqual([...leftovers].sort());
    expect(done.players.p1.deck.slice(0, tail.length)).toEqual(tail);
    expect(census(done)).toEqual(before);
  });

  it("`rngState` ADVANCES — the printed 'Shuffle' is spent, not decorative", () => {
    const state = rikaBoard(13);
    const window = state.players.p1.deck.slice(0, 4);
    const uid = handUid(state, "p1", "fix-rika");
    const { state: parked } = mustApply(state, { type: "playTrainer", seat: "p1", uid });
    const { state: done } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [window[0] as string, window[1] as string] },
    });
    expect(done.rngState).not.toBe(parked.rngState);
  });

  it("and the shuffle REORDERS: across seeds the bottom pair comes out both ways", () => {
    const orders = new Set<string>();
    for (let seed = 20; seed < 40; seed++) {
      const state = rikaBoard(seed);
      const window = state.players.p1.deck.slice(0, 4);
      const uid = handUid(state, "p1", "fix-rika");
      const { state: parked } = mustApply(state, { type: "playTrainer", seat: "p1", uid });
      const { state: done } = mustApply(parked, {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "cards", uids: [window[0] as string, window[1] as string] },
      });
      const bottom = done.players.p1.deck.slice(-2);
      orders.add(bottom[0] === window[2] ? "window" : "swapped");
    }
    expect([...orders].sort()).toEqual(["swapped", "window"]);
  });

  it("NO event says so either — and the ONLY discard is Rika paying for itself", () => {
    const state = rikaBoard(14);
    const window = state.players.p1.deck.slice(0, 4);
    const uid = handUid(state, "p1", "fix-rika");
    const { state: parked, events: parkEvents } = mustApply(state, {
      type: "playTrainer",
      seat: "p1",
      uid,
    });
    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [window[0] as string, window[1] as string] },
    });
    const all = [...parkEvents, ...events];
    expect(types(all)).not.toContain("DECK_TOP_DISCARDED");
    expect(types(all)).not.toContain("CARD_TO_BOTTOM_OF_DECK");
    expect(types(all)).not.toContain("SHUFFLE");
    expect(done.players.p1.discard).toEqual(parked.players.p1.discard);
    expect(done.players.p1.discard).toContain(uid);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — THE THIRD VALUE, ON THE SAME BOARD (the attribution controls)
// ─────────────────────────────────────────────────────────────────────────────

describe("D335 §4 — the three destinations are three different games", () => {
  it("Explorer's Guidance on this very deck DISCARDS its leftovers instead", () => {
    let state = board(15);
    state = handFromDeck(state, "p1", "fix-explorersguidance", 1);
    const window = state.players.p1.deck.slice(0, 6);
    const uid = handUid(state, "p1", "fix-explorersguidance");
    const { state: parked } = mustApply(state, { type: "playTrainer", seat: "p1", uid });
    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [window[0] as string, window[1] as string] },
    });
    const rest = window.slice(2);
    expect(find(events, "DECK_TOP_DISCARDED")?.uids).toEqual(rest);
    for (const leftover of rest) {
      expect(done.players.p1.discard).toContain(leftover);
      expect(done.players.p1.deck).not.toContain(leftover);
    }
  });

  it("Great Ball on this very deck SHUFFLES — the other way a tail can move", () => {
    let state = board(16);
    state = handFromDeck(state, "p1", "fix-basic-1", 1);
    state = handFromDeck(state, "p1", "sv02-183", 1);
    const uid = handUid(state, "p1", "sv02-183");
    const { state: parked, events: parkEvents } = mustApply(state, {
      type: "playTrainer",
      seat: "p1",
      uid,
    });
    // Great Ball's `max: 1` over `anyPokemon` PARKS (the deck is full of them), so
    // the trailing shuffle only fires on the resolve — the shuffle is the second
    // op of the program and not part of the look.
    const pick = cardsPrompt(parked).candidates[0] as string;
    const { events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [pick] },
    });
    expect(types(parkEvents)).not.toContain("SHUFFLE");
    expect(types(events)).toContain("SHUFFLE");
  });
});
