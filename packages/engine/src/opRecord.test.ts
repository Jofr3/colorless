import { describe, expect, it } from "vitest";
import type { EffectOp } from "./effects";
import { applyAction } from "./index";
import type { GameAction, GameEvent, GameState, Seat } from "./index";
import type { EffectPrompt } from "./interpreter";
import { resumeProgram, runProgram } from "./interpreter";
import { programFor } from "./registry";
import {
  OP_RECORD_DECK,
  discardFromDeck,
  driveSetup,
  expectErr,
  handFromDeck,
  handUid,
  mustApply,
  types,
} from "./testFixtures";

// M5 op-slice: §9.2 — a printed clause that refers back to what an EARLIER
// clause of the same card actually did. Three wordings, one running record
// (`EffectContinuation.record`), which is the engine's first op→op data flow:
//
//   • MIRIAM (sv01-179/-238/-251, Supporter) — "Shuffle up to 5 Pokémon from
//     your discard pile into your deck. If you shuffled any cards into your deck
//     IN THIS WAY, draw 3 cards." The GATE arm: the retrieval files what it
//     moved, and a `recordGate` two ops later reads it.
//   • SUPERIOR ENERGY RETRIEVAL (sv02-189/-277, Item) — "You can use this card
//     only if you discard 2 other cards from your hand. / Put up to 4 Basic
//     Energy cards from your discard pile into your hand. (You can't choose a
//     card you discarded WITH THE EFFECT OF THIS CARD.)" The EXCLUSION arm: the
//     cost pays INTO the pile the next op reads, so without the record the cost
//     refunds itself.
//   • DENDRA (sv02-179 — pinned in deckBottom.test.ts) — "IF YOU DO, draw cards
//     until you have 5." The same gate as Miriam's, on the payment.
//
// What the record is NOT: "the previous op's result". Miriam shuffles the deck
// between the retrieval and the sentence about it, so the op being referred to
// is two upstream — hence a named `EffectSlot`.

const SEED = 20260722;

const MIRIAM = "sv01-179";
const SER = "sv02-189";

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

/** Every uid the seat holds anywhere, sorted. Both cards move cards BETWEEN
    hidden and public zones twice in one play, which is where a duplicate or a
    vanished card would hide. */
function census(state: GameState, seat: Seat): string[] {
  const side = state.players[seat];
  const inPlay = [side.active, ...side.bench].flatMap((p) =>
    p === null ? [] : [...p.stack, ...p.energy, ...p.tools],
  );
  return [...side.deck, ...side.hand, ...side.discard, ...side.prizes, ...inPlay].sort();
}

/** Setup then open P1's turn 2 (P2 went first and passed) — P1's first
    unrestricted turn, the shape every Trainer suite here uses. */
function board(seed: number): GameState {
  const state = driveSetup(seed, { p1: OP_RECORD_DECK, p2: OP_RECORD_DECK }, { first: "p2" });
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** Rebuild p1's HAND outright: everything dealt back into the deck, then exactly
    `ids` dealt off it. Both cards turn on hand CONTENTS (the cost's candidates,
    the play gate's count), so a suite keeping whatever setup dealt would ask a
    different question per seed. */
function withHand(state: GameState, ids: readonly string[]): GameState {
  const side = state.players.p1;
  let next: GameState = {
    ...state,
    players: { ...state.players, p1: { ...side, hand: [], deck: [...side.deck, ...side.hand] } },
  };
  for (const id of ids) next = handFromDeck(next, "p1", id, 1);
  return next;
}

/** Seed p1's discard pile from the deck — the zone BOTH cards read. */
function withDiscard(state: GameState, ids: Record<string, number>): GameState {
  let next = state;
  for (const [id, count] of Object.entries(ids)) next = discardFromDeck(next, "p1", id, count);
  return next;
}

function play(state: GameState, cardId: string): { state: GameState; events: GameEvent[] } {
  return mustApply(state, { type: "playTrainer", seat: "p1", uid: handUid(state, "p1", cardId) });
}

function resolve(state: GameState, uids: readonly string[]) {
  return mustApply(state, {
    type: "resolveEffect",
    seat: "p1",
    choice: { kind: "cards", uids: [...uids] },
  });
}

function chooseCardsPrompt(state: GameState) {
  if (state.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
  return chooseCardsPromptOf(state.phase.prompt);
}

/** The same narrowing off a bare prompt — the parked RunResult carries one
    directly, which the interpreter-level tests below drive. */
function chooseCardsPromptOf(prompt: { kind: string }) {
  if (prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
  return prompt as Extract<EffectPrompt, { kind: "chooseCards" }>;
}

/** A host that persists state between actions round-trips it through JSON. */
function roundTrip(state: GameState): GameState {
  return JSON.parse(JSON.stringify(state)) as GameState;
}

describe("Superior Energy Retrieval — the cost that must not refund itself", () => {
  it("BARS the cards it just paid from the retrieval, and nothing else", () => {
    // The headline. The hand pays two Fire Energy INTO the discard pile that the
    // very next op reads, and a third identical Fire Energy is already sitting
    // there. Without the record all three would be offered and the player could
    // take back exactly what they paid — a 2-card cost refunded, so the card
    // becomes a strict +2 and its parenthetical means nothing.
    let state = board(SEED);
    state = withHand(state, [SER, "fix-fire-energy", "fix-fire-energy", "fix-item"]);
    state = withDiscard(state, { "fix-fire-energy": 1 });
    const alreadyThere = state.players.p1.discard.filter(
      (uid) => state.cardIdByUid[uid] === "fix-fire-energy",
    );
    expect(alreadyThere).toHaveLength(1);

    const cost = chooseCardsPrompt(play(state, SER).state);
    const paid = cost.candidates.filter((uid) => state.cardIdByUid[uid] === "fix-fire-energy");
    expect(paid).toHaveLength(2);
    const retrieval = chooseCardsPrompt(resolve(play(state, SER).state, paid).state);

    // Barred: the two just paid. Offered: the identical PRINT that was already
    // in the pile — the record is keyed by uid, not by card id, so a second copy
    // of the same Energy is a different card and stays takeable, which is what
    // the printed sentence says ("a card you discarded with the effect of this
    // card", not "a card of that kind").
    for (const uid of paid) expect(retrieval.candidates).not.toContain(uid);
    expect(retrieval.candidates).toEqual(alreadyThere);
  });

  it("REJECTS a barred uid arriving on the wire, not merely in the dialog", () => {
    // The exclusion is applied to the CANDIDATES, which is the set resolveEffect
    // validates a pick against — so a client that kept a stale offer, or made one
    // up, cannot reach a card the card says it cannot choose.
    let state = board(SEED);
    state = withHand(state, [SER, "fix-fire-energy", "fix-fire-energy", "fix-item"]);
    state = withDiscard(state, { "fix-fire-energy": 1 });
    const { state: costParked } = play(state, SER);
    const paid = chooseCardsPrompt(costParked).candidates.filter(
      (uid) => state.cardIdByUid[uid] === "fix-fire-energy",
    );
    const { state: parked } = resolve(costParked, paid);
    expectErr(
      parked,
      { type: "resolveEffect", seat: "p1", choice: { kind: "cards", uids: [paid[0] as string] } },
      "BAD_EFFECT_CHOICE",
    );
  });

  it("carries the record ACROSS the park — the cost parks, then the retrieval does", () => {
    // Every recording this engine can make happens on the resume path, because
    // both recording ops park. The continuation is the only thing joining them:
    // the cost's park stores NO record (nothing has run), the retrieval's stores
    // the paid uids.
    let state = board(SEED);
    state = withHand(state, [SER, "fix-fire-energy", "fix-fire-energy", "fix-item"]);
    state = withDiscard(state, { "fix-water-energy": 2 });
    const before = census(state, "p1");

    const { state: costParked } = play(state, SER);
    if (costParked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(costParked.phase.cont.record).toBeUndefined();

    const paid = chooseCardsPrompt(costParked).candidates.filter(
      (uid) => costParked.cardIdByUid[uid] === "fix-fire-energy",
    );
    const { state: parked } = resolve(costParked, paid);
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(parked.phase.cont.record).toEqual({ paid });

    const taken = chooseCardsPrompt(parked).candidates;
    const { state: done, events } = resolve(parked, taken);
    expect(done.phase.kind).toBe("turn:action");
    // The two Water Energy came back to hand; the two Fire Energy stayed paid.
    expect(find(events, "DISCARD_RETRIEVED")?.uids).toEqual(taken);
    for (const uid of taken) expect(done.players.p1.hand).toContain(uid);
    for (const uid of paid) expect(done.players.p1.discard).toContain(uid);
    expect(census(done, "p1")).toEqual(before);
  });

  it("records on the AUTO-RESOLVE path too — a hand with exactly the cost in it", () => {
    // A cost whose offer is no bigger than `count` resolves inline in stepOp
    // rather than parking, which is a SECOND place the recording has to happen.
    // A record written only on the resume path would leave this hand — the
    // ordinary late-game one, where the player has nothing to spare — refunding
    // its own payment.
    let state = board(SEED);
    state = withHand(state, [SER, "fix-fire-energy", "fix-fire-energy"]);
    state = withDiscard(state, { "fix-fire-energy": 1 });
    const paid = state.players.p1.hand.filter(
      (uid) => state.cardIdByUid[uid] === "fix-fire-energy",
    );
    const { state: parked, events } = play(state, SER);
    // One reduction: the cost paid without a prompt, the retrieval parked.
    expect(find(events, "HAND_COST_PAID")?.uids).toEqual(paid);
    const prompt = chooseCardsPrompt(parked);
    for (const uid of paid) expect(prompt.candidates).not.toContain(uid);
    expect(prompt.candidates).toHaveLength(1);
  });

  it("bars only what the filter could have offered — paying non-Energy costs nothing", () => {
    // The record holds every paid uid, but the exclusion only bites where the
    // two sets meet. Paying two plain Items leaves the Energy retrieval whole.
    let state = board(SEED);
    state = withHand(state, [SER, "fix-item", "fix-item", "fix-fire-energy"]);
    state = withDiscard(state, { "fix-water-energy": 2 });
    const { state: costParked } = play(state, SER);
    const items = chooseCardsPrompt(costParked).candidates.filter(
      (uid) => costParked.cardIdByUid[uid] === "fix-item",
    );
    expect(items).toHaveLength(2);
    const { state: parked } = resolve(costParked, items);
    const prompt = chooseCardsPrompt(parked);
    expect(prompt.candidates).toHaveLength(2);
    expect(prompt.max).toBe(4);
  });
});

describe("Miriam — the gate two ops downstream", () => {
  it("shuffles the chosen Pokémon back, shuffles the DECK, then draws 3", () => {
    let state = board(SEED);
    state = withHand(state, [MIRIAM, "fix-item"]);
    state = withDiscard(state, { "fix-basic-1": 2, "fix-basic-2": 1, "fix-fire-energy": 2 });
    const before = census(state, "p1");
    const deckTop = state.players.p1.deck.slice(0, 3);

    const { state: parked } = play(state, MIRIAM);
    const prompt = chooseCardsPrompt(parked);
    expect(prompt.dest).toBe("deck");
    expect(prompt.max).toBe(5);
    expect(prompt.min).toBe(0); // "up to 5"
    // Pokémon only — the Energy in the same pile is not a candidate.
    expect(prompt.candidates).toHaveLength(3);

    const taken = prompt.candidates.slice(0, 2);
    const { state: done, events } = resolve(parked, taken);
    expect(types(events)).toEqual(["DISCARD_RETRIEVED", "SHUFFLE", "CARDS_DRAWN"]);
    expect(done.players.p1.hand).toHaveLength(4); // fix-item + 3 drawn
    for (const uid of taken) expect(done.players.p1.deck).toContain(uid);
    expect(census(done, "p1")).toEqual(before);

    // ORDER IS OBSERVABLE, and it is why the gate cannot read "the previous
    // op": the shuffle sits between the retrieval and the draw. A program that
    // drew first would deal the UNSHUFFLED top — these three, in this order —
    // while the cards it just put back sat at the bottom in pick order, which is
    // exactly what the printed word "shuffle" denies. (The retrieval appends to
    // the deck's END, so drawing first does not draw them back; the tell is the
    // deck top, not the returned cards.)
    expect(done.players.p1.hand.slice(1)).not.toEqual(deckTop);
  });

  it("DECLINING the retrieval draws NOTHING — the gate's false arm", () => {
    // "Up to 5" allows taking none, and then "if you shuffled any cards into
    // your deck in this way" is false. A player who wants only the deck shuffle
    // cannot also have the 3 cards.
    let state = board(SEED);
    state = withHand(state, [MIRIAM, "fix-item"]);
    state = withDiscard(state, { "fix-basic-1": 2 });
    const { state: parked } = play(state, MIRIAM);
    const { state: done, events } = resolve(parked, []);
    expect(types(events)).toEqual(["SHUFFLE"]);
    expect(done.players.p1.hand).toHaveLength(1);
    expect(done.phase.kind).toBe("turn:action");
  });

  it("with NO Pokémon in the discard: no prompt, no draw, but still a shuffle", () => {
    // The whiff resolves in one reduction. It stays PLAYABLE — the trailing
    // shuffle always happens, so "nothing to shuffle back" is never "no effect"
    // (the attachFromTop ruling, and the shipped Pal Pad / Super Rod call).
    let state = board(SEED);
    state = withHand(state, [MIRIAM, "fix-item"]);
    state = withDiscard(state, { "fix-fire-energy": 3 });
    const { state: done, events } = play(state, MIRIAM);
    expect(done.phase.kind).toBe("turn:action");
    expect(types(events)).toEqual(["TRAINER_PLAYED", "SHUFFLE"]);
    expect(done.players.p1.hand).toHaveLength(1);
  });

  it("parks with NO record stored — nothing has been recorded yet", () => {
    // The continuation carries `record` only once something is in it, so every
    // program that predates §9.2 parks into a byte-identical phase.
    let state = board(SEED);
    state = withHand(state, [MIRIAM, "fix-item"]);
    state = withDiscard(state, { "fix-basic-1": 2 });
    const { state: parked } = play(state, MIRIAM);
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(parked.phase.cont.record).toBeUndefined();
    expect(Object.hasOwn(parked.phase.cont, "record")).toBe(false);
  });
});

describe("the record itself", () => {
  it("Dendra's 'if you do' gates the draw on the payment", () => {
    // Unreachable through the action path — `handCostUnmet` refuses the play
    // with nothing to pay — so the program is run directly, which is the only
    // way to ask whether the conditional is expressed in the card or only in the
    // gate that guards it.
    const state = board(SEED);
    const empty: GameState = {
      ...state,
      players: {
        ...state.players,
        p1: { ...state.players.p1, hand: [], deck: [...state.players.p1.deck] },
      },
    };
    const program = programFor("sv02-179")?.trainer as EffectOp[];
    const events: GameEvent[] = [];
    const result = runProgram(empty, program, { seat: "p1" }, events);
    expect(result.kind).toBe("done");
    expect(types(events)).toEqual([]);
    if (result.kind !== "done") throw new Error("expected done");
    expect(result.state.players.p1.hand).toHaveLength(0);
  });

  it("runs the `otherwise` arm when nothing was recorded", () => {
    // No printed card in scope uses the else arm (Miriam and Dendra are both
    // one-armed), so the branch is pinned directly — the `conditionGate`
    // precedent, where Grusha's printed "instead" is what gave it a reader.
    const state = board(SEED);
    const program: EffectOp[] = [
      {
        op: "recordGate",
        slot: "moved",
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: [{ op: "drawCards", count: 3 }],
        otherwise: [{ op: "drawCards", count: 1 }],
      },
    ];
    const events: GameEvent[] = [];
    const result = runProgram(state, program, { seat: "p1" }, events);
    if (result.kind !== "done") throw new Error("expected done");
    expect(find(events, "CARDS_DRAWN")?.uids).toHaveLength(1);
  });

  it("a gate reads its OWN slot, not any recording", () => {
    // Two slots exist so two clauses on one card cannot be confused for each
    // other. A gate on "moved" must ignore a payment filed under "paid" — the
    // failure mode a single unnamed "last result" would have built in.
    let state = board(SEED);
    state = withHand(state, ["fix-item"]); // exactly one payer → the cost resolves inline
    const program: EffectOp[] = [
      { op: "payFromHand", count: 1, to: "discard", recordAs: "paid" },
      {
        op: "recordGate",
        slot: "moved",
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: [{ op: "drawCards", count: 3 }],
      },
      {
        op: "recordGate",
        slot: "paid",
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: [{ op: "drawCards", count: 1 }],
      },
    ];
    const events: GameEvent[] = [];
    const result = runProgram(state, program, { seat: "p1" }, events);
    expect(result.kind).toBe("done");
    expect(types(events)).toEqual(["HAND_COST_PAID", "CARDS_DRAWN"]);
    expect(find(events, "CARDS_DRAWN")?.uids).toHaveLength(1);
  });
});

// ── Review additions (adversarial pass). Every test below was written to KILL a
//    mutation that the suite above leaves alive. ──

describe("the registry rows", () => {
  it("resolves the SAME program for every authored id, reprints included", () => {
    // The slice's headline is "Miriam ×3, Superior Energy Retrieval ×2" and only
    // ONE id of each is ever exercised above — the reprints are pure data, so
    // this is the only thing standing between a dropped row and a card that
    // silently cannot be played (`TRAINER_NOT_SIMULATED`) at exactly one rarity.
    // The deckBottom suite pins Dendra ×3 the same way.
    const miriam = programFor(MIRIAM)?.trainer;
    expect(miriam).toBeDefined();
    for (const id of ["sv01-179", "sv01-238", "sv01-251"]) {
      expect(programFor(id)?.trainer).toEqual(miriam);
    }
    const ser = programFor(SER)?.trainer;
    expect(ser).toBeDefined();
    for (const id of ["sv02-189", "sv02-277"]) {
      expect(programFor(id)?.trainer).toEqual(ser);
    }
    // And they are DIFFERENT programs, so a row pointing at the wrong constant
    // is caught rather than passing on shape alone.
    expect(miriam).not.toEqual(ser);
  });

  it("each program is the printed sentence, in printed order", () => {
    // Miriam: retrieve (recording) → SHUFFLE → the "in this way" gate.
    expect(programFor(MIRIAM)?.trainer).toEqual([
      {
        op: "discardPileRetrieval",
        filter: { kind: "anyPokemon" },
        dest: "deck",
        max: 5,
        recordAs: "moved",
      },
      { op: "shuffleDeck" },
      {
        op: "recordGate",
        slot: "moved",
        // biome-ignore lint/suspicious/noThenProperty: effect-contract step list, not a thenable.
        then: [{ op: "drawCards", count: 3 }],
      },
    ]);
    // SER: the cost that records → the retrieval that bars what it recorded.
    expect(programFor(SER)?.trainer).toEqual([
      { op: "payFromHand", count: 2, to: "discard", recordAs: "paid" },
      {
        op: "discardPileRetrieval",
        filter: { kind: "basicEnergy" },
        dest: "hand",
        max: 4,
        exclude: "paid",
      },
    ]);
  });
});

/** Recursively freeze, so any in-place write to something reachable from a
    STORED state throws (modules are strict mode). */
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.keys(value as object)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

describe("the record ACROSS a park — the claim the shipped cards never exercise", () => {
  // Both shipped cards write and read the record inside ONE resume: SER's cost
  // records in `applyChoice` and its retrieval reads it in the same
  // `runProgram`; Miriam's retrieval records and its gate reads it likewise. So
  // `cont.record` is STORED and asserted by the suite above, but nothing there
  // ever reads it back — `resumeProgram`'s `{ ...cont.record }` seeding can be
  // deleted outright and every other test still passes. These pin it.

  /** pay (parks, records "paid") → retrieve (parks, records nothing) → gate on
      "paid". The gate's answer was recorded BEFORE the second park, so it can
      only arrive through `cont.record`. */
  function carryProgram(): EffectOp[] {
    return [
      { op: "payFromHand", count: 1, to: "discard", recordAs: "paid" },
      { op: "discardPileRetrieval", filter: { kind: "basicEnergy" }, dest: "hand", max: 1 },
      {
        op: "recordGate",
        slot: "paid",
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: [{ op: "drawCards", count: 1 }],
      },
    ];
  }

  function carryBoard(): GameState {
    let state = board(SEED);
    // Two DISTINCT identities in hand, so the cost offers 2 > count 1 and PARKS
    // (handCostCandidates keeps at most `count` of each printed card).
    state = withHand(state, ["fix-item", "fix-water-energy"]);
    return withDiscard(state, { "fix-fire-energy": 2 });
  }

  it("a slot recorded BEFORE a park is still readable by a gate AFTER it", () => {
    const events: GameEvent[] = [];
    const r0 = runProgram(carryBoard(), carryProgram(), { seat: "p1" }, events);
    if (r0.kind !== "parked") throw new Error("expected the cost to park");
    expect(r0.cont.record).toBeUndefined();

    const payUid = chooseCardsPromptOf(r0.prompt).candidates[0] as string;
    const r1 = resumeProgram(r0.state, r0.cont, { kind: "cards", uids: [payUid] }, events);
    if (r1.kind !== "parked") throw new Error("expected the retrieval to park");
    // The payment is now IN the continuation — the only place it can live.
    expect(r1.cont.record).toEqual({ paid: [payUid] });

    const take = chooseCardsPromptOf(r1.prompt).candidates.slice(0, 1);
    const r2 = resumeProgram(r1.state, r1.cont, { kind: "cards", uids: take }, events);
    if (r2.kind !== "done") throw new Error("expected done");
    // The gate fired off a record made two ops and one park earlier.
    expect(find(events, "CARDS_DRAWN")?.uids).toHaveLength(1);
  });

  it("seeding from the continuation COPIES it — a resume never writes into stored state", () => {
    // D14: `applyAction` is a pure replayable reducer, so the record inside the
    // parked GameState must be unreachable from the resumed run's accumulator.
    let state = board(SEED);
    state = withHand(state, ["fix-item", "fix-water-energy"]);
    state = withDiscard(state, { "fix-fire-energy": 2, "fix-basic-1": 2 });
    const program: EffectOp[] = [
      { op: "payFromHand", count: 1, to: "discard", recordAs: "paid" },
      // Records under a SECOND slot on resume, which is what would mutate the
      // stored object if the accumulator aliased it.
      {
        op: "discardPileRetrieval",
        filter: { kind: "anyPokemon" },
        dest: "hand",
        max: 1,
        recordAs: "moved",
      },
    ];
    const events: GameEvent[] = [];
    const r0 = runProgram(state, program, { seat: "p1" }, events);
    if (r0.kind !== "parked") throw new Error("expected the cost to park");
    const payUid = chooseCardsPromptOf(r0.prompt).candidates[0] as string;
    const r1 = resumeProgram(r0.state, r0.cont, { kind: "cards", uids: [payUid] }, events);
    if (r1.kind !== "parked") throw new Error("expected the retrieval to park");

    // Freeze the continuation exactly as a stored phase holds it.
    deepFreeze(r1.cont);
    const take = chooseCardsPromptOf(r1.prompt).candidates.slice(0, 1);
    const r2 = resumeProgram(r1.state, r1.cont, { kind: "cards", uids: take }, events);
    if (r2.kind !== "done") throw new Error("expected done");
    // The stored record still says only what it said when it was stored.
    expect(r1.cont.record).toEqual({ paid: [payUid] });
  });

  it("resolving a DEEP-FROZEN parked state is pure (the real action path)", () => {
    let state = board(SEED);
    state = withHand(state, [SER, "fix-fire-energy", "fix-fire-energy", "fix-item"]);
    state = withDiscard(state, { "fix-fire-energy": 1 });
    const costParked = play(state, SER).state;
    const paid = chooseCardsPrompt(costParked).candidates.filter(
      (uid) => costParked.cardIdByUid[uid] === "fix-fire-energy",
    );
    const parked = resolve(costParked, paid).state;

    deepFreeze(parked);
    const done = resolve(parked, chooseCardsPrompt(parked).candidates).state;
    expect(done.phase.kind).toBe("turn:action");
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(parked.phase.cont.record).toEqual({ paid });
  });
});

describe("D14 replay — the record round-trips through JSON", () => {
  it("SER: round-tripping the state at EACH park gives a byte-identical outcome", () => {
    let state = board(SEED);
    state = withHand(state, [SER, "fix-fire-energy", "fix-fire-energy", "fix-item"]);
    state = withDiscard(state, { "fix-fire-energy": 1, "fix-water-energy": 2 });

    // Straight through.
    const a0 = play(state, SER).state;
    const paidA = chooseCardsPrompt(a0).candidates.filter(
      (u) => a0.cardIdByUid[u] === "fix-fire-energy",
    );
    const a1 = resolve(a0, paidA).state;
    const a2 = resolve(a1, chooseCardsPrompt(a1).candidates).state;

    // Through a JSON round-trip at every park — a host that persists the phase
    // between actions (the LobbyDO does) must resume from the same continuation.
    const b0 = roundTrip(play(state, SER).state);
    const paidB = chooseCardsPrompt(b0).candidates.filter(
      (u) => b0.cardIdByUid[u] === "fix-fire-energy",
    );
    expect(paidB).toEqual(paidA);
    const b1 = roundTrip(resolve(b0, paidB).state);
    expect(b1.phase).toEqual(a1.phase); // the continuation, `record` included
    const b2 = resolve(b1, chooseCardsPrompt(b1).candidates).state;

    expect(b2).toEqual(a2);
  });

  it("Miriam: the parked phase survives stringify unchanged", () => {
    let state = board(SEED);
    state = withHand(state, [MIRIAM, "fix-item"]);
    state = withDiscard(state, { "fix-basic-1": 2, "fix-basic-2": 1 });
    const parked = play(state, MIRIAM).state;
    expect(roundTrip(parked)).toEqual(parked);
    const take = chooseCardsPrompt(parked).candidates.slice(0, 2);
    expect(resolve(roundTrip(parked), take).state).toEqual(resolve(parked, take).state);
  });
});

describe("hostile wire input at the SER retrieval park", () => {
  function parkedSER(): { parked: GameState; paid: string[] } {
    let state = board(SEED);
    state = withHand(state, [SER, "fix-fire-energy", "fix-fire-energy", "fix-item"]);
    state = withDiscard(state, { "fix-fire-energy": 1 });
    state = discardFromDeck(state, "p2", "fix-fire-energy", 2); // a cross-seat uid
    const costParked = play(state, SER).state;
    const paid = chooseCardsPrompt(costParked).candidates.filter(
      (uid) => costParked.cardIdByUid[uid] === "fix-fire-energy",
    );
    return { parked: resolve(costParked, paid).state, paid };
  }

  // D14: never throws, never moves a card it shouldn't.
  const garbage: { name: string; uids: unknown }[] = [
    { name: "an unknown string", uids: ["not-a-uid"] },
    { name: "an empty string", uids: [""] },
    { name: "a number", uids: [42] },
    { name: "null", uids: [null] },
    { name: "an object", uids: [{ uid: "x" }] },
    { name: "a nested array", uids: [["a"]] },
    { name: "__proto__", uids: ["__proto__"] },
    { name: "a non-array", uids: "abc" },
  ];

  for (const { name, uids } of garbage) {
    it(`rejects ${name} without throwing and without moving a card`, () => {
      const { parked } = parkedSER();
      const before = census(parked, "p1");
      const result = applyAction(parked, {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "cards", uids },
      } as unknown as GameAction);
      expect(result.ok).toBe(false);
      expect(census(parked, "p1")).toEqual(before);
    });
  }

  it("rejects a uid from the OPPONENT's discard pile", () => {
    const { parked } = parkedSER();
    const theirs = parked.players.p2.discard.find(
      (u) => parked.cardIdByUid[u] === "fix-fire-energy",
    );
    expectErr(
      parked,
      { type: "resolveEffect", seat: "p1", choice: { kind: "cards", uids: [theirs as string] } },
      "BAD_EFFECT_CHOICE",
    );
  });

  it("rejects p1's own uid from the WRONG zone (hand, deck)", () => {
    const { parked } = parkedSER();
    for (const uid of [parked.players.p1.hand[0], parked.players.p1.deck[0]]) {
      if (uid === undefined) continue;
      expectErr(
        parked,
        { type: "resolveEffect", seat: "p1", choice: { kind: "cards", uids: [uid] } },
        "BAD_EFFECT_CHOICE",
      );
    }
  });

  it("rejects a legal uid REPEATED, so no card is duplicated", () => {
    const { parked } = parkedSER();
    const legal = chooseCardsPrompt(parked).candidates[0] as string;
    expectErr(
      parked,
      { type: "resolveEffect", seat: "p1", choice: { kind: "cards", uids: [legal, legal] } },
      "BAD_EFFECT_CHOICE",
    );
  });

  it("rejects a legal uid mixed WITH a barred one — all or nothing", () => {
    const { parked, paid } = parkedSER();
    const legal = chooseCardsPrompt(parked).candidates[0] as string;
    const before = census(parked, "p1");
    expectErr(
      parked,
      {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "cards", uids: [legal, paid[0] as string] },
      },
      "BAD_EFFECT_CHOICE",
    );
    expect(census(parked, "p1")).toEqual(before);
  });
});

describe("card conservation through the two-zone round trips", () => {
  it("SER hand → discard → hand duplicates and loses nothing", () => {
    let state = board(SEED);
    state = withHand(state, [SER, "fix-fire-energy", "fix-fire-energy", "fix-item"]);
    state = withDiscard(state, { "fix-fire-energy": 3 });
    const before = census(state, "p1");
    const costParked = play(state, SER).state;
    const paid = chooseCardsPrompt(costParked).candidates.filter(
      (u) => costParked.cardIdByUid[u] === "fix-fire-energy",
    );
    const parked = resolve(costParked, paid).state;
    const done = resolve(parked, chooseCardsPrompt(parked).candidates).state;
    const after = census(done, "p1");
    expect(after).toEqual(before);
    expect(new Set(after).size).toBe(after.length);
  });

  it("Miriam into an EMPTY deck: the 3 drawn come off the 5 just shuffled back", () => {
    let state = board(SEED);
    state = withHand(state, [MIRIAM, "fix-item"]);
    state = withDiscard(state, { "fix-basic-1": 5 });
    const side = state.players.p1;
    state = {
      ...state,
      players: {
        ...state.players,
        p1: { ...side, deck: [], discard: [...side.discard, ...side.deck] },
      },
    };
    const before = census(state, "p1");
    const parked = play(state, MIRIAM).state;
    const done = resolve(parked, chooseCardsPrompt(parked).candidates.slice(0, 5)).state;
    const after = census(done, "p1");
    expect(after).toEqual(before);
    expect(new Set(after).size).toBe(after.length);
    expect(done.players.p1.deck).toHaveLength(2);
    expect(done.players.p1.hand).toHaveLength(4); // fix-item + 3 drawn
  });

  it("Miriam shuffling back 1 into an EMPTY deck draws only that 1", () => {
    let state = board(SEED);
    state = withHand(state, [MIRIAM, "fix-item"]);
    state = withDiscard(state, { "fix-basic-1": 1 });
    const side = state.players.p1;
    state = {
      ...state,
      players: {
        ...state.players,
        p1: { ...side, deck: [], discard: [...side.discard, ...side.deck] },
      },
    };
    const before = census(state, "p1");
    const parked = play(state, MIRIAM).state;
    const done = resolve(parked, chooseCardsPrompt(parked).candidates.slice(0, 1)).state;
    expect(census(done, "p1")).toEqual(before);
    expect(done.players.p1.deck).toHaveLength(0);
    expect(done.players.p1.hand).toHaveLength(2); // fix-item + the 1 drawn
  });

  it("SER whose discard holds ONLY the cards it just paid retrieves nothing", () => {
    let state = board(SEED);
    state = withHand(state, [SER, "fix-fire-energy", "fix-fire-energy"]);
    const side = state.players.p1;
    state = { ...state, players: { ...state.players, p1: { ...side, discard: [] } } };
    const before = census(state, "p1");
    const { state: done } = play(state, SER);
    expect(done.phase.kind).toBe("turn:action"); // cost inline, retrieval whiffed
    expect(census(done, "p1")).toEqual(before);
    expect(done.players.p1.hand).toHaveLength(0);
    expect(done.players.p1.discard).toHaveLength(3); // SER + the 2 paid
  });
});

describe("the prompt states what the ANSWER buys", () => {
  it("Miriam's note carries the printed 'if you do' clause", () => {
    // The decision surface is the whole point of the fix: the op describes a
    // deck shuffle, but the answer decides three cards AND the turn's only
    // Supporter. "Take none" is not a minor decline.
    let state = board(SEED);
    state = withHand(state, [MIRIAM, "fix-item"]);
    state = withDiscard(state, { "fix-basic-1": 2 });
    const parked = play(state, MIRIAM).state;
    expect(chooseCardsPrompt(parked).note).toBe(
      "Shuffle up to 5 Pokémon from your discard pile into your deck. If you do, draw 3 cards.",
    );
  });

  it("SER's COST note gains no clause — it records, but nothing gates on it", () => {
    // The scan is for a gate on THIS op's slot, not for the fact of recording.
    // SER files "paid" so the retrieval can exclude it; no branch turns on it,
    // so the payment prompt says exactly what it did before §9.2.
    let state = board(SEED);
    state = withHand(state, [SER, "fix-fire-energy", "fix-fire-energy", "fix-item"]);
    state = withDiscard(state, { "fix-water-energy": 1 });
    const parked = play(state, SER).state;
    expect(chooseCardsPrompt(parked).note).toBe("Discard 2 cards from your hand.");
  });

  it("SER's RETRIEVAL note carries the printed exclusion parenthetical", () => {
    let state = board(SEED);
    state = withHand(state, [SER, "fix-fire-energy", "fix-fire-energy"]);
    state = withDiscard(state, { "fix-water-energy": 1 });
    const parked = play(state, SER).state; // cost auto-resolves, retrieval parks
    expect(chooseCardsPrompt(parked).note).toBe(
      "Put up to 4 Basic Energy cards from your discard pile into your hand. (You can't choose a card you discarded with the effect of this card.)",
    );
  });

  it("SAYS NOTHING rather than half a consequence when a branch has no phrase", () => {
    // Silence beats a guess. A gate branching into an op the describer has no
    // words for must leave the note as it was — a partial clause would announce
    // the draw and hide the discard beside it.
    let state = board(SEED);
    state = withHand(state, ["fix-item", "fix-fire-energy", "fix-water-energy"]);
    const describable: EffectOp[] = [
      { op: "payFromHand", count: 1, to: "discard", recordAs: "paid" },
      {
        op: "recordGate",
        slot: "paid",
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: [{ op: "drawCards", count: 2 }],
      },
    ];
    const opaque: EffectOp[] = [
      { op: "payFromHand", count: 1, to: "discard", recordAs: "paid" },
      {
        op: "recordGate",
        slot: "paid",
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: [{ op: "drawCards", count: 2 }, { op: "shuffleDeck" }],
      },
    ];
    const noteOf = (program: EffectOp[]): string => {
      const result = runProgram(state, program, { seat: "p1" }, []);
      if (result.kind !== "parked") throw new Error("expected a park");
      return result.prompt.note;
    };
    expect(noteOf(describable)).toBe("Discard a card from your hand. If you do, draw 2 cards.");
    // One unrecognised op in the branch drops the WHOLE clause, not just its part.
    expect(noteOf(opaque)).toBe("Discard a card from your hand.");
  });
});

describe("a whiff overwrites the slot it would have written", () => {
  it("does not leave a stale recording behind", () => {
    // Both recording ops must agree that "ran and moved nothing" is an ANSWER,
    // not a silence — otherwise a slot written earlier survives an op that
    // should have replaced it. Unreachable while each slot has one writer; the
    // closed EffectSlot union makes reuse easy rather than hard.
    let state = board(SEED);
    state = withHand(state, ["fix-item"]);
    state = withDiscard(state, { "fix-basic-1": 1 });
    const program: EffectOp[] = [
      // Files "moved" with one real card...
      {
        op: "discardPileRetrieval",
        filter: { kind: "anyPokemon" },
        dest: "deck",
        max: 1,
        recordAs: "moved",
      },
      // ...then an op on the SAME slot that can only whiff (the discard now
      // holds no Energy at all), which must clear it.
      {
        op: "discardPileRetrieval",
        filter: { kind: "basicEnergy" },
        dest: "hand",
        max: 1,
        recordAs: "moved",
      },
      {
        op: "recordGate",
        slot: "moved",
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: [{ op: "drawCards", count: 3 }],
      },
    ];
    const events: GameEvent[] = [];
    const first = runProgram(state, program, { seat: "p1" }, events);
    if (first.kind !== "parked") throw new Error("expected the first retrieval to park");
    if (first.prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    const done = resumeProgram(
      first.state,
      first.cont,
      { kind: "cards", uids: [...first.prompt.candidates] },
      events,
    );
    expect(done.kind).toBe("done");
    // The second retrieval whiffed, so the gate is FALSE despite the first
    // having filed a card under the very same slot.
    expect(types(events)).toEqual(["DISCARD_RETRIEVED"]);
  });
});
