import { describe, expect, it } from "vitest";
import { applyAction, programFor } from "./index";
import { applyChoice } from "./interpreter";
import type { GameEvent, GameState, PokemonRef, Seat } from "./index";
import {
  ATTACH_FROM_TOP_DECK,
  attachFromDeck,
  benchFromDeck,
  deepFreeze,
  discardFromDeck,
  driveSetup,
  expectErr,
  handFromDeck,
  handUid,
  mustApply,
  setActiveFromDeck,
  toDeckTop,
  types,
} from "./testFixtures";

// M5 op-slice: attachFromTop — the from-the-top ATTACH the lookAtTopN slice
// deferred. Look at the top N of your own deck and attach the Energy you find
// there straight onto your Pokémon, "in any way you like" (so each card names
// its OWN destination — the first prompt whose answer is a map). Two real cards,
// differing in every rider the op has:
//   • Electric Generator (sv01-170, Item) — top 5, up to 2 Basic {L} Energy
//     CARDS, onto your BENCHED {L} Pokémon; the other cards shuffle back (the
//     trailing shuffleDeck op);
//   • Hydreigon (sv02-140) "Tri Howl" (Ability, once per turn) — top 3, ANY
//     number of Energy cards (Basic or Special), onto ANY of your Pokémon, and
//     the other cards are DISCARDED (the op's own `discardRest`).
// The discard is what makes the leftovers clause load-bearing: it fires on the
// whiff and the decline too, where a shuffle is invisible either way.

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

function findAll<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

/** The uid of the deck card at `index` (0 = top). */
function deckAt(state: GameState, seat: Seat, index: number): string {
  const uid = state.players[seat].deck[index];
  if (uid === undefined) throw new Error(`${seat} deck has no card at index ${index}`);
  return uid;
}

const cardIdOf = (state: GameState, uid: string): string | undefined => state.cardIdByUid[uid];

/** Every uid the seat holds anywhere, sorted — the card-conservation census. A
    play may move cards between zones but must never create or destroy one. */
function census(state: GameState, seat: Seat): string[] {
  const side = state.players[seat];
  const inPlay = [side.active, ...side.bench].flatMap((p) =>
    p === null ? [] : [...p.stack, ...p.energy, ...p.tools],
  );
  return [...side.deck, ...side.hand, ...side.discard, ...side.prizes, ...inPlay].sort();
}

/** Setup then open P1's turn 2 (P2 went first and passed) — P1's first
    unrestricted turn (the coverage-suite board shape). */
function board(seed: number): GameState {
  const state = driveSetup(
    seed,
    { p1: ATTACH_FROM_TOP_DECK, p2: ATTACH_FROM_TOP_DECK },
    { first: "p2" },
  );
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** Rebuild p1's board outright: `activeId` Active, `benchIds` benched in order.
    Every prompt here hands back bench INDICES, so a suite that let the setup deal
    whatever Basic it drew would be asserting a different board per seed. */
function withBoard(state: GameState, activeId: string, benchIds: readonly string[]): GameState {
  let next = setActiveFromDeck(state, "p1", activeId);
  next = { ...next, players: { ...next.players, p1: { ...next.players.p1, bench: [] } } };
  for (const id of benchIds) next = benchFromDeck(next, "p1", id);
  return next;
}

const activeRef: PokemonRef = { seat: "p1", spot: { spot: "active" } };
const benchRef = (index: number): PokemonRef => ({ seat: "p1", spot: { spot: "bench", index } });

/** Electric Generator parked: two benched {L} bodies + one Colorless one, the
    Item in hand, and a seeded top 5 — two Basic {L} Energy on top, then a Fire
    Energy, a SPECIAL Energy and an Item (three near-misses the filter refuses). */
function parkedGenerator(seed: number): GameState {
  let state = board(seed);
  state = withBoard(state, "fix-lightning-1", [
    "fix-lightning-1",
    "fix-lightning-1",
    "fix-basic-1",
  ]);
  state = handFromDeck(state, "p1", "sv01-170", 1);
  // Prepending composes, so seed the DEEPEST layer first.
  state = toDeckTop(state, "p1", "fix-item", 1);
  state = toDeckTop(state, "p1", "fix-special", 1);
  state = toDeckTop(state, "p1", "fix-fire-energy", 1);
  state = toDeckTop(state, "p1", "fix-lightning-energy", 2);
  return state;
}

/** Hydreigon parked: it sits on the BENCH (the Ability is not Active-only), a
    plain Colorless Active, and a seeded top 3 — one Basic {L} Energy, one SPECIAL
    Energy (which `anyEnergy` takes and Electric Generator's filter would not) and
    one Item (a non-candidate, so the leftovers are never empty). */
function parkedTriHowl(seed: number): GameState {
  let state = board(seed);
  state = withBoard(state, "fix-basic-1", ["sv02-140"]);
  state = toDeckTop(state, "p1", "fix-item", 1);
  state = toDeckTop(state, "p1", "fix-special", 1);
  state = toDeckTop(state, "p1", "fix-lightning-energy", 1);
  return state;
}

const triHowl = {
  type: "useAbility",
  seat: "p1",
  target: { spot: "bench", index: 0 },
  abilityName: "Tri Howl",
} as const;

describe("M5 op-slice — attachFromTop (Electric Generator / Hydreigon)", () => {
  it("registry resolves a program for each authored id", () => {
    for (const id of ["sv01-170", "sv02-140"]) {
      expect(programFor(id)).toBeDefined();
    }
  });

  it("Electric Generator offers only the top-5 Basic {L}, and only BENCHED {L} targets", () => {
    const state = parkedGenerator(1);
    const topA = deckAt(state, "p1", 0);
    const topB = deckAt(state, "p1", 1);
    // Basic {L} Energy DEEPER than the window — the boundary this op inherits
    // from lookAtTopN. The deck holds 10 copies; two are on top.
    const deeper = state.players.p1.deck
      .slice(5)
      .filter((uid) => cardIdOf(state, uid) === "fix-lightning-energy");
    expect(deeper.length).toBeGreaterThan(0);

    const uid = handUid(state, "p1", "sv01-170");
    const { state: parked } = mustApply(state, { type: "playTrainer", seat: "p1", uid });
    expect(parked.phase.kind).toBe("effect:choose");
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "attachCards") throw new Error("expected attachCards");

    expect(prompt.note).toBe(
      "Look at the top 5 cards of your deck and attach up to 2 Basic Lightning Energy cards you find there to your Benched Lightning Pokémon in any way you like.",
    );
    expect(prompt.max).toBe(2);
    // The candidates are the two Basic {L} in the window — not the Fire Energy,
    // not the SPECIAL Energy, not the Item, and not a {L} deeper in the deck.
    expect(prompt.candidates).toEqual([topA, topB]);
    for (const uid of deeper) expect(prompt.candidates).not.toContain(uid);
    // The targets are the two BENCHED Lightning Pokémon: not the Active (which is
    // itself Lightning — `benchOnly` alone excludes it) and not the Colorless
    // bench body at index 2 (`targetType` alone excludes it).
    expect(prompt.targets).toEqual([benchRef(0), benchRef(1)]);
  });

  it("Electric Generator attaches each pick to the Pokémon it was assigned to, then shuffles", () => {
    const state = parkedGenerator(2);
    const topA = deckAt(state, "p1", 0);
    const topB = deckAt(state, "p1", 1);
    const window = state.players.p1.deck.slice(0, 5);
    const uid = handUid(state, "p1", "sv01-170");
    const { state: parked } = mustApply(state, { type: "playTrainer", seat: "p1", uid });
    const before = census(parked, "p1");

    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: {
        kind: "attachCards",
        // "In any way you like" — two cards, two DIFFERENT destinations.
        assignments: [
          { uid: topA, to: benchRef(1) },
          { uid: topB, to: benchRef(0) },
        ],
      },
    });

    expect(done.phase.kind).toBe("turn:action");
    expect(done.players.p1.bench[1]?.energy).toEqual([topA]);
    expect(done.players.p1.bench[0]?.energy).toEqual([topB]);
    expect(done.players.p1.deck).not.toContain(topA);
    expect(done.players.p1.deck).not.toContain(topB);
    // The three unattached looked-at cards stayed in the deck…
    for (const rest of window.slice(2)) expect(done.players.p1.deck).toContain(rest);
    // …and the trailing shuffleDeck op hid them again. Nothing was discarded:
    // "shuffle the other cards back" is not this op's business.
    expect(types(events)).toContain("SHUFFLE");
    expect(find(events, "DECK_TOP_DISCARDED")).toBeUndefined();
    const attached = findAll(events, "ENERGY_ATTACHED");
    expect(attached).toHaveLength(2);
    expect(attached[0]).toMatchObject({
      seat: "p1",
      uid: topA,
      target: { spot: "bench", index: 1 },
    });
    expect(attached[1]).toMatchObject({
      seat: "p1",
      uid: topB,
      target: { spot: "bench", index: 0 },
    });
    expect(census(done, "p1")).toEqual(before);
  });

  it("Electric Generator can attach both cards to the SAME Pokémon", () => {
    // "In any way you like" is not "one each": the destinations are independent,
    // so a single benched {L} may take both — the shape a per-card map allows and
    // a shared destination (moveEnergy's) would too, but a one-per-target rule
    // would not.
    const state = parkedGenerator(3);
    const topA = deckAt(state, "p1", 0);
    const topB = deckAt(state, "p1", 1);
    const uid = handUid(state, "p1", "sv01-170");
    const { state: parked } = mustApply(state, { type: "playTrainer", seat: "p1", uid });
    const { state: done } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: {
        kind: "attachCards",
        assignments: [
          { uid: topA, to: benchRef(0) },
          { uid: topB, to: benchRef(0) },
        ],
      },
    });
    expect(done.players.p1.bench[0]?.energy).toEqual([topA, topB]);
    expect(done.players.p1.bench[1]?.energy).toEqual([]);
  });

  it("Electric Generator may attach NONE — and still shuffles", () => {
    const state = parkedGenerator(4);
    const window = state.players.p1.deck.slice(0, 5);
    const uid = handUid(state, "p1", "sv01-170");
    const { state: parked } = mustApply(state, { type: "playTrainer", seat: "p1", uid });
    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "attachCards", assignments: [] },
    });
    expect(done.phase.kind).toBe("turn:action");
    expect(done.players.p1.bench.every((p) => p.energy.length === 0)).toBe(true);
    for (const rest of window) expect(done.players.p1.deck).toContain(rest);
    expect(types(events)).toContain("SHUFFLE");
    expect(find(events, "ENERGY_ATTACHED")).toBeUndefined();
  });

  it("Electric Generator with no Benched {L} Pokémon is STILL playable — it shuffles", () => {
    // The card has NO `programPlayable` gate, deliberately (see effects.ts): a
    // per-op veto would refuse the whole card, including its second printed
    // sentence — "Shuffle the other cards back into your deck" — which always
    // resolves. So this board attaches nothing and shuffles, exactly like a
    // whiffed Great Ball. The Active here is itself a Lightning Pokémon, so the
    // board has no eligible target at all (`benchOnly`), which is the path
    // stepOp's empty-targets branch exists for.
    let state = board(5);
    state = withBoard(state, "fix-lightning-1", ["fix-basic-1"]);
    state = handFromDeck(state, "p1", "sv01-170", 1);
    state = toDeckTop(state, "p1", "fix-lightning-energy", 2);
    const top = state.players.p1.deck.slice(0, 5);
    const { state: after, events } = mustApply(state, {
      type: "playTrainer",
      seat: "p1",
      uid: handUid(state, "p1", "sv01-170"),
    });
    expect(after.phase.kind).toBe("turn:action");
    expect(find(events, "ENERGY_ATTACHED")).toBeUndefined();
    expect(find(events, "DECK_TOP_DISCARDED")).toBeUndefined();
    expect(types(events)).toContain("SHUFFLE");
    // Nothing left the deck — every looked-at card is still in there.
    for (const uid of top) expect(after.players.p1.deck).toContain(uid);
  });

  it("Electric Generator IS playable with a benched {L} and nothing to find", () => {
    // The other side of that gate: what the top 5 hold is HIDDEN, so a look is
    // always playable enough (the searchDeck rule). Here the window is all Items,
    // so the play parks on nothing and resolves to a bare shuffle.
    let state = board(6);
    state = withBoard(state, "fix-basic-1", ["fix-lightning-1"]);
    state = handFromDeck(state, "p1", "sv01-170", 1);
    state = toDeckTop(state, "p1", "fix-item", 3);
    state = toDeckTop(state, "p1", "fix-fire-energy", 2);
    const { state: after, events } = mustApply(state, {
      type: "playTrainer",
      seat: "p1",
      uid: handUid(state, "p1", "sv01-170"),
    });
    expect(after.phase.kind).toBe("turn:action");
    expect(types(events)).toContain("SHUFFLE");
    expect(find(events, "ENERGY_ATTACHED")).toBeUndefined();
  });

  it("Electric Generator's cap follows the SHORTER of the print and the window", () => {
    // "Up to 2" with one Basic {L} up there is a pick of ONE. A prompt reporting
    // the printed 2 would have the dialog count "0/2" over a single row and
    // invite a pick that does not exist.
    let state = board(18);
    state = withBoard(state, "fix-basic-1", ["fix-lightning-1"]);
    state = handFromDeck(state, "p1", "sv01-170", 1);
    state = toDeckTop(state, "p1", "fix-item", 4);
    state = toDeckTop(state, "p1", "fix-lightning-energy", 1);
    const { state: parked } = mustApply(state, {
      type: "playTrainer",
      seat: "p1",
      uid: handUid(state, "p1", "sv01-170"),
    });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "attachCards") throw new Error("expected attachCards");
    expect(prompt.candidates).toHaveLength(1);
    expect(prompt.max).toBe(1);
    // The NOTE still reads as printed ("up to 2") — it reproduces the card's own
    // sentence, the discardNote doctrine. `max` is what you can actually do.
    expect(prompt.note).toContain("attach up to 2 Basic Lightning Energy cards");
  });

  it("Tri Howl offers any Energy in the top 3, and EVERY own Pokémon as a target", () => {
    const state = parkedTriHowl(7);
    const energy = deckAt(state, "p1", 0);
    const special = deckAt(state, "p1", 1);
    const { state: parked } = mustApply(state, triHowl);
    expect(parked.phase.kind).toBe("effect:choose");
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "attachCards") throw new Error("expected attachCards");

    expect(prompt.note).toBe(
      "Look at the top 3 cards of your deck and attach any number of Energy cards you find there to your Pokémon in any way you like.",
    );
    // A SPECIAL Energy is an "Energy card" — the whole difference from Electric
    // Generator's printed "Basic {L} Energy cards".
    expect(prompt.candidates).toEqual([energy, special]);
    // "Any number" resolves to the candidate set: a card cannot be attached twice.
    expect(prompt.max).toBe(2);
    // No target rider at all — the ACTIVE is a target here, where Electric
    // Generator's benchOnly excludes it, and so is Hydreigon itself.
    expect(prompt.targets).toEqual([activeRef, benchRef(0)]);
  });

  it("Tri Howl attaches what it took and DISCARDS the rest of what it looked at", () => {
    const state = parkedTriHowl(8);
    const energy = deckAt(state, "p1", 0);
    const special = deckAt(state, "p1", 1);
    const item = deckAt(state, "p1", 2);
    const fourth = deckAt(state, "p1", 3);
    const { state: parked } = mustApply(state, triHowl);
    const before = census(parked, "p1");
    const discardBefore = parked.players.p1.discard.length;

    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "attachCards", assignments: [{ uid: energy, to: activeRef }] },
    });

    expect(done.phase.kind).toBe("turn:action");
    expect(done.players.p1.active?.energy).toEqual([energy]);
    // The two it did NOT attach left the deck for the discard pile, in window
    // (deck) order — and the 4th card is now the top, untouched.
    const discarded = find(events, "DECK_TOP_DISCARDED");
    expect(discarded).toMatchObject({ seat: "p1" });
    expect(discarded?.uids).toEqual([special, item]);
    expect(done.players.p1.discard.slice(discardBefore)).toEqual([special, item]);
    expect(deckAt(done, "p1", 0)).toBe(fourth);
    // No shuffle: "Discard the other cards" is the whole leftovers clause here.
    expect(types(events)).not.toContain("SHUFFLE");
    // The attach announces itself before the discard row.
    expect(types(events).indexOf("ENERGY_ATTACHED")).toBeLessThan(
      types(events).indexOf("DECK_TOP_DISCARDED"),
    );
    expect(census(done, "p1")).toEqual(before);
  });

  it("Tri Howl attaches ALONGSIDE Energy already on the target, and appends to a non-empty discard", () => {
    // Two invariants nothing else in the suite can see, because the fixtures'
    // Active is bare and the discard pile is empty at every seed used here: an
    // attach must not CLOBBER what is already attached, and the leftovers must be
    // APPENDED to the pile (§2 pile order), not prepended.
    let state = parkedTriHowl(19);
    state = attachFromDeck(state, "p1", "fix-fire-energy", 1); // already on the Active
    state = discardFromDeck(state, "p1", "fix-item", 2); // a non-empty pile
    const already = state.players.p1.active?.energy[0];
    const pileBefore = [...state.players.p1.discard];
    expect(already).toBeDefined();
    expect(pileBefore).toHaveLength(2);

    const energy = deckAt(state, "p1", 0);
    const special = deckAt(state, "p1", 1);
    const item = deckAt(state, "p1", 2);
    const { state: parked } = mustApply(state, triHowl);
    const { state: done } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "attachCards", assignments: [{ uid: energy, to: activeRef }] },
    });
    expect(done.players.p1.active?.energy).toEqual([already, energy]);
    expect(done.players.p1.discard).toEqual([...pileBefore, special, item]);
  });

  it("Tri Howl finding NO Energy never asks — and discards all 3 anyway", () => {
    // The path the leftovers clause exists for: no candidates means no park, and
    // a naive `return state` there would make the whiff free. The printed card
    // charges three cards for the look either way.
    let state = board(9);
    state = withBoard(state, "fix-basic-1", ["sv02-140"]);
    state = toDeckTop(state, "p1", "fix-item", 3);
    const window = state.players.p1.deck.slice(0, 3);
    const fourth = deckAt(state, "p1", 3);
    const { state: after, events } = mustApply(state, triHowl);

    expect(after.phase.kind).toBe("turn:action");
    expect(find(events, "ENERGY_ATTACHED")).toBeUndefined();
    expect(find(events, "DECK_TOP_DISCARDED")?.uids).toEqual(window);
    expect(after.players.p1.discard.slice(-3)).toEqual(window);
    expect(deckAt(after, "p1", 0)).toBe(fourth);
  });

  it("Tri Howl declined still discards all 3", () => {
    const state = parkedTriHowl(10);
    const window = state.players.p1.deck.slice(0, 3);
    const { state: parked } = mustApply(state, triHowl);
    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "attachCards", assignments: [] },
    });
    expect(find(events, "ENERGY_ATTACHED")).toBeUndefined();
    expect(find(events, "DECK_TOP_DISCARDED")?.uids).toEqual(window);
    expect(done.players.p1.discard.slice(-3)).toEqual(window);
  });

  it("Tri Howl is once per turn", () => {
    const state = parkedTriHowl(11);
    const { state: parked } = mustApply(state, triHowl);
    const { state: done } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "attachCards", assignments: [] },
    });
    expectErr(done, triHowl, "ABILITY_ALREADY_USED");
  });

  describe("the wire validator", () => {
    const reject = (state: GameState, assignments: { uid: string; to: PokemonRef }[]): void => {
      expectErr(
        state,
        { type: "resolveEffect", seat: "p1", choice: { kind: "attachCards", assignments } },
        "BAD_EFFECT_CHOICE",
      );
    };

    it("refuses a card the look never reached", () => {
      const state = parkedGenerator(12);
      // A Basic {L} Energy sitting DEEPER than the top 5 — a legal card of the
      // right kind, in the right zone, that this play simply cannot see.
      const deeper = state.players.p1.deck
        .slice(5)
        .find((uid) => cardIdOf(state, uid) === "fix-lightning-energy");
      if (deeper === undefined) throw new Error("expected a deeper Basic {L} Energy");
      const uid = handUid(state, "p1", "sv01-170");
      const { state: parked } = mustApply(state, { type: "playTrainer", seat: "p1", uid });
      reject(parked, [{ uid: deeper, to: benchRef(0) }]);
    });

    it("refuses a target the card does not print (the Active, an opponent's Pokémon)", () => {
      const state = parkedGenerator(13);
      const topA = deckAt(state, "p1", 0);
      const uid = handUid(state, "p1", "sv01-170");
      const { state: parked } = mustApply(state, { type: "playTrainer", seat: "p1", uid });
      reject(parked, [{ uid: topA, to: activeRef }]);
      reject(parked, [{ uid: topA, to: { seat: "p2", spot: { spot: "active" } } }]);
      reject(parked, [{ uid: topA, to: benchRef(2) }]); // the Colorless bench body
    });

    it("refuses the same card twice", () => {
      const state = parkedGenerator(14);
      const topA = deckAt(state, "p1", 0);
      const uid = handUid(state, "p1", "sv01-170");
      const { state: parked } = mustApply(state, { type: "playTrainer", seat: "p1", uid });
      // One physical card cannot land on two Pokémon.
      reject(parked, [
        { uid: topA, to: benchRef(0) },
        { uid: topA, to: benchRef(1) },
      ]);
    });

    it("refuses more than the printed cap", () => {
      // THREE distinct candidates against Electric Generator's "up to 2" — the
      // only board on which the cap is the rule that rejects. Everywhere else in
      // this suite `max === candidates.length`, so an over-cap answer is caught by
      // the was-it-offered check first and the cap itself goes unexercised. It is
      // also the ONLY enforcement of "up to 2" anywhere: the apply takes the
      // validated answer as given.
      let state = board(20);
      state = withBoard(state, "fix-basic-1", ["fix-lightning-1", "fix-lightning-1"]);
      state = handFromDeck(state, "p1", "sv01-170", 1);
      state = toDeckTop(state, "p1", "fix-item", 2);
      state = toDeckTop(state, "p1", "fix-lightning-energy", 3);
      const [a, b, c] = state.players.p1.deck;
      const { state: parked } = mustApply(state, {
        type: "playTrainer",
        seat: "p1",
        uid: handUid(state, "p1", "sv01-170"),
      });
      if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
      const prompt = parked.phase.prompt;
      if (prompt.kind !== "attachCards") throw new Error("expected attachCards");
      expect(prompt.candidates).toHaveLength(3);
      expect(prompt.max).toBe(2); // the print binds, not the window
      reject(parked, [
        { uid: a as string, to: benchRef(0) },
        { uid: b as string, to: benchRef(1) },
        { uid: c as string, to: benchRef(0) },
      ]);
    });

    it("refuses a malformed assignment", () => {
      const state = parkedGenerator(15);
      const topA = deckAt(state, "p1", 0);
      const uid = handUid(state, "p1", "sv01-170");
      const { state: parked } = mustApply(state, { type: "playTrainer", seat: "p1", uid });
      const hostile = [
        [null],
        ["not-an-object"],
        [{ uid: topA }],
        [{ to: benchRef(0) }],
        [{ uid: 7, to: benchRef(0) }],
        [{ uid: topA, to: { seat: "p1" } }],
        [{ uid: topA, to: { seat: "p1", spot: { spot: "bench", index: 99 } } }],
      ];
      for (const assignments of hostile) {
        reject(parked, assignments as unknown as { uid: string; to: PokemonRef }[]);
      }
    });

    it("never spreads the client's ref into the event", () => {
      // The D44 lesson: refEquals compares only seat/spot/index, so any extra key
      // hung on the ref would ride a spread into an event handed to the animator,
      // the log and (P4) the opponent.
      const state = parkedGenerator(16);
      const topA = deckAt(state, "p1", 0);
      const uid = handUid(state, "p1", "sv01-170");
      const { state: parked } = mustApply(state, { type: "playTrainer", seat: "p1", uid });
      const { events } = mustApply(parked, {
        type: "resolveEffect",
        seat: "p1",
        choice: {
          kind: "attachCards",
          assignments: [
            { uid: topA, to: { seat: "p1", spot: { spot: "bench", index: 0, evil: "x" } } },
          ],
        } as never,
      });
      expect(find(events, "ENERGY_ATTACHED")?.target).toEqual({ spot: "bench", index: 0 });
    });
  });

  it("the apply SKIPS an assignment the validator would never have passed", () => {
    // `applyChoice` directly, because these guards are unreachable through the
    // action API — validateChoice rejects each of these first. They exist because
    // the apply is the last place a card can be duplicated or destroyed, and the
    // docstring promises them: a uid outside the window, a repeat, an opponent's
    // Pokémon, and an out-of-range bench index (the dangerous one — without the
    // check `bench.map` silently no-ops while the uid still leaves the deck, so
    // the card lands in NO zone).
    const state = parkedTriHowl(21);
    const energy = deckAt(state, "p1", 0);
    const deeper = deckAt(state, "p1", 5); // outside the top 3
    const { state: parked } = mustApply(state, triHowl);
    const before = census(parked, "p1");
    const events: GameEvent[] = [];
    const after = applyChoice(
      parked,
      { op: "attachFromTop", n: 3, filter: { kind: "anyEnergy" }, max: "any", restTo: "discard" },
      {
        kind: "attachCards",
        assignments: [
          { uid: deeper, to: activeRef }, // not in the window
          { uid: energy, to: activeRef }, // legal — the one that lands
          { uid: energy, to: benchRef(0) }, // the same card again
          { uid: deckAt(parked, "p1", 1), to: { seat: "p2", spot: { spot: "active" } } },
          { uid: deckAt(parked, "p1", 2), to: benchRef(99) }, // no such bench slot
        ],
      },
      { seat: "p1" },
      events,
    );
    expect(after.players.p1.active?.energy).toEqual([energy]);
    expect(events.filter((e) => e.type === "ENERGY_ATTACHED")).toHaveLength(1);
    // Every skipped card is still accounted for — two of them as leftovers in the
    // discard, the deeper one still in the deck. Nothing was created or lost.
    expect(census(after, "p1")).toEqual(before);
    expect(after.players.p1.deck).toContain(deeper);
  });

  it("is pure — the parked state is never mutated", () => {
    const state = parkedTriHowl(17);
    const { state: parked } = mustApply(state, triHowl);
    deepFreeze(parked);
    const energy = deckAt(parked, "p1", 0);
    const result = applyAction(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "attachCards", assignments: [{ uid: energy, to: activeRef }] },
    });
    expect(result.ok).toBe(true);
  });
});
