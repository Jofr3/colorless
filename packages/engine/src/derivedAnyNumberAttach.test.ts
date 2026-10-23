import { describe, expect, it } from "vitest";
import { programPlayable } from "./cardplay";
import { ENERGY_TYPE_BY_CODE, deriveAttackEffect } from "./effects";
import type { EffectOp, GameEvent, GameState, PokemonRef } from "./index";
import { type EffectPrompt, runProgram } from "./interpreter";
import {
  ANY_NUMBER_ATTACH_DECK,
  FIXTURE_POOL,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  deepFreeze,
  driveSetup,
  expectErr,
  handFromDeck,
  handToDeck,
  mustApply,
  setActiveFromDeck,
} from "./testFixtures";

// ── The printed sentence, verbatim off the remote D1 ─────────────────────────

const TROPICAL_FRENZY =
  "You may attach any number of Basic Energy cards from your hand to your Pokémon in any way you like.";
const TYPED_FRENZY =
  "You may attach any number of Basic {M} Energy cards from your hand to your Pokémon in any way you like.";

/** The programs, stated rather than described. */
const TROPICAL_FRENZY_PROGRAM: EffectOp[] = [
  { op: "attachFromHand", filter: { kind: "basicEnergy" } },
];
const TYPED_FRENZY_PROGRAM: EffectOp[] = [
  { op: "attachFromHand", filter: { kind: "basicEnergy", energyType: "Metal" } },
];

const UNREAD: readonly (readonly [string, string])[] = [
  [
    "You may attach any number of Basic Energy cards from your hand to this Pokémon.",
    "names ONE body — an unbounded batch pinned to a single target, which no card prints and `attachEnergyFrom.count` (a number) could not express either",
  ],
  [
    "You may attach any number of Basic Energy cards from your hand to 1 of your Pokémon.",
    "the same refusal wearing the other printed singular",
  ],
  [
    "You may attach any number of Basic Energy cards from your hand to 1 of your {F} Pokémon.",
    "a brace-coded singular: an `anyWay: false` row of the shared table",
  ],
  [
    "You may attach any number of Basic Energy cards from your hand to your Benched Pokémon in any way you like.",
    "`anyWay` BUT carries `benchOnly`, a rider this op does not have — reading it would drop the zone word and offer the Active",
  ],
  [
    "You may attach any number of Basic Energy cards from your hand to each of your Benched Pokémon.",
    "a spread with no decision in it, and a phrase the table does not name at all",
  ],
  [
    "Attach any number of Basic Energy cards from your hand to your Pokémon in any way you like.",
    "the bare imperative — never printed with this quantifier, so the `You may` opener is required rather than optional",
  ],
  [
    "You may attach any number of Basic Energy cards from your discard pile to your Pokémon in any way you like.",
    "the SOURCE zone is welded: the discard side prints no unbounded count at all",
  ],
  [
    "You may attach any number of Energy cards from your hand to your Pokémon in any way you like.",
    "the printed adjective is missing — a bare noun admits SPECIAL Energy, which is a different filter and a different card",
  ],
  [
    "You may attach up to 2 Basic Energy cards from your hand to your Pokémon in any way you like.",
    "a printed COUNT: already built, as 2 separate `attachEnergyFrom` ops (D205's sequential model), and re-homing it here is the reading this arm declines",
  ],
];

const TROPICAL_FRENZY_IDX = 47;

/** Every Energy-ish line this deck carries — the hand is DRAWN rather than
    placed, so a board meaning "nothing but the cost in hand" has to say which
    cards to send back. */
const HAND_LINES = ["fix-energy", "fix-special", "fix-tool"] as const;

function board(seed: number): GameState {
  const state = driveSetup(
    seed,
    { p1: ANY_NUMBER_ATTACH_DECK, p2: ANY_NUMBER_ATTACH_DECK },
    { first: "p2" },
  );
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

function ready(
  seed: number,
  {
    bench = ["fix-basic-1", "fix-basic-1", "fix-basic-1"],
    hand = {},
  }: { bench?: readonly string[]; hand?: Partial<Record<string, number>> } = {},
): GameState {
  let state = setActiveFromDeck(board(seed), "p1", "fix-trainerops");
  state = attachFromDeck(state, "p1", "fix-energy", 1);
  state = clearBench(state, "p1");
  for (const id of bench) state = benchFromDeck(state, "p1", id);
  for (const id of HAND_LINES) state = handToDeck(state, "p1", id);
  for (const [id, count] of Object.entries(hand)) {
    state = handFromDeck(state, "p1", id, count ?? 0);
  }
  state = setActiveFromDeck(state, "p2", "fix-bigbody");
  state = clearBench(state, "p2");
  state = benchFromDeck(state, "p2", "fix-basic-1");
  return state;
}

function all<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

/** The parked COMPOUND prompt — which cards, and where each one goes. */
function promptOf(state: GameState): Extract<EffectPrompt, { kind: "attachCards" }> {
  if (state.phase.kind !== "effect:choose") {
    throw new Error(`expected a park, got ${state.phase.kind}`);
  }
  if (state.phase.prompt.kind !== "attachCards") {
    throw new Error(`expected attachCards, got ${state.phase.prompt.kind}`);
  }
  return state.phase.prompt;
}

const benchRef = (index: number): PokemonRef => ({ seat: "p1", spot: { spot: "bench", index } });
const ACTIVE_REF: PokemonRef = { seat: "p1", spot: { spot: "active" } };

function strike(state: GameState) {
  return mustApply(state, { type: "attack", seat: "p1", index: TROPICAL_FRENZY_IDX });
}

function attach(state: GameState, assignments: { uid: string; to: PokemonRef }[]) {
  return mustApply(state, {
    type: "resolveEffect",
    seat: "p1",
    choice: { kind: "attachCards", assignments },
  });
}

const idsOf = (state: GameState, uids: readonly string[]) => uids.map((u) => state.cardIdByUid[u]);

function handCount(state: GameState, cardId: string): number {
  return state.players.p1.hand.filter((uid) => state.cardIdByUid[uid] === cardId).length;
}

/** The card ids attached to a body, so "which Energy landed where" is a fact
    about the board rather than about an event count. */
function energyIdsOn(state: GameState, ref: PokemonRef): string[] {
  const side = state.players[ref.seat];
  const body = ref.spot.spot === "active" ? side.active : side.bench[ref.spot.index];
  return (body?.energy ?? []).map((uid) => state.cardIdByUid[uid] as string);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. THE ANCHOR
// ─────────────────────────────────────────────────────────────────────────────

describe("the anchor — one printed sentence, one new op", () => {
  it("derives the printed sentence to its program", () => {
    expect(deriveAttackEffect(TROPICAL_FRENZY)).toEqual(TROPICAL_FRENZY_PROGRAM);
  });

  it("the brace code is read though ZERO legal printings spell it", () => {
    expect(deriveAttackEffect(TYPED_FRENZY)).toEqual(TYPED_FRENZY_PROGRAM);
    for (const [code, type] of Object.entries(ENERGY_TYPE_BY_CODE)) {
      const text = TROPICAL_FRENZY.replace("Basic Energy", `Basic {${code}} Energy`);
      expect(deriveAttackEffect(text), code).toEqual([
        { op: "attachFromHand", filter: { kind: "basicEnergy", energyType: type } },
      ]);
    }
    // …and a code the map does NOT hold cannot reach the resolver at all.
    expect(deriveAttackEffect(TROPICAL_FRENZY.replace("Basic ", "Basic {Q} "))).toBeNull();
  });

  it("every near miss is refused, and each for its OWN reason", () => {
    for (const [text, why] of UNREAD) expect(deriveAttackEffect(text), why).toBeNull();
    expect(UNREAD).toHaveLength(9);
  });

  it("the `$` is load-bearing, and the `[^.]` class is what makes it so", () => {
    expect(deriveAttackEffect(`${TROPICAL_FRENZY} Draw a card.`)).toBeNull();
    expect(deriveAttackEffect(`Draw a card. ${TROPICAL_FRENZY}`)).toBeNull();
    // …and the bare sentence still derives, so the refusals are the anchors doing
    // work rather than the arm being broken.
    expect(deriveAttackEffect(TROPICAL_FRENZY)).not.toBeNull();
  });

  it("the printed COUNT still derives to the SEQUENTIAL model, not to this op", () => {
    expect(
      deriveAttackEffect(
        "Attach up to 2 Basic {P} Energy cards from your hand to your Pokémon in any way you like.",
      ),
    ).toEqual([
      { op: "attachEnergyFrom", source: "hand", energyType: "Psychic", declinable: true },
      { op: "attachEnergyFrom", source: "hand", energyType: "Psychic", declinable: true },
    ]);
  });

  it("the fixture ALREADY carried the sentence, at index 47, and nothing was appended", () => {
    const attacks = FIXTURE_POOL["fix-trainerops"]?.attacks ?? [];
    expect(attacks).toHaveLength(73);
    expect(attacks[TROPICAL_FRENZY_IDX]?.name).toBe("Tropical Frenzy");
    expect(attacks[TROPICAL_FRENZY_IDX]?.effect).toBe(TROPICAL_FRENZY);
    expect(attacks[TROPICAL_FRENZY_IDX]?.damage).toBeUndefined();
    expect(attacks.filter((a) => a.effect === TROPICAL_FRENZY)).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. THE CAP — the print names no number, so the candidate set IS the ceiling
// ─────────────────────────────────────────────────────────────────────────────

describe("the unbounded count", () => {
  it("offers every matching card in hand, and caps at exactly that many", () => {
    const state = ready(2, { hand: { "fix-energy": 4 } });
    deepFreeze(state);
    const prompt = promptOf(strike(state).state);
    expect(prompt.candidates).toHaveLength(4);
    expect(prompt.max).toBe(prompt.candidates.length);
    expect(prompt.maxPerTarget).toBeUndefined();
  });

  it("the cap MOVES with the hand — the one thing a constant cannot do", () => {
    for (const count of [1, 3, 5]) {
      const prompt = promptOf(strike(ready(13, { hand: { "fix-energy": count } })).state);
      expect(prompt.candidates, `hand of ${count}`).toHaveLength(count);
      expect(prompt.max, `hand of ${count}`).toBe(count);
    }
  });

  it("the prompt says 'from your hand' and 'in any way you like'", () => {
    const prompt = promptOf(strike(ready(3, { hand: { "fix-energy": 3 } })).state);
    expect(prompt.note).toBe(
      "Attach any number of Basic Energy cards from your hand to your Pokémon in any way you like.",
    );
    expect(prompt.note).not.toContain("up to");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. THE MAP — each card names its OWN destination
// ─────────────────────────────────────────────────────────────────────────────

describe("in any way you like — one answer, three bodies", () => {
  it("splits one hand across the Active and two Benched bodies", () => {
    const state = ready(4, { hand: { "fix-energy": 3 } });
    deepFreeze(state);
    const { state: parked } = strike(state);
    const [a, b, c] = promptOf(parked).candidates;
    const { state: after, events } = attach(parked, [
      { uid: a as string, to: ACTIVE_REF },
      { uid: b as string, to: benchRef(0) },
      { uid: c as string, to: benchRef(2) },
    ]);
    expect(energyIdsOn(after, ACTIVE_REF)).toEqual(["fix-energy", "fix-energy"]);
    expect(energyIdsOn(after, benchRef(0))).toEqual(["fix-energy"]);
    expect(energyIdsOn(after, benchRef(1))).toEqual([]);
    expect(energyIdsOn(after, benchRef(2))).toEqual(["fix-energy"]);
    expect(all(events, "ENERGY_ATTACHED")).toHaveLength(3);
    // …and the three cards LEFT the hand, exactly once each. Counted BY ID
    // rather than by hand size: the opening hand is drawn, so it also holds
    // bodies and Tools this op never touches.
    expect(handCount(after, "fix-energy")).toBe(0);
  });

  it("puts every card on ONE Pokémon when that is the answer", () => {
    const state = ready(5, { hand: { "fix-energy": 3 } });
    const { state: parked } = strike(state);
    const uids = promptOf(parked).candidates;
    const { state: after } = attach(
      parked,
      uids.map((uid) => ({ uid, to: benchRef(1) })),
    );
    // The other half of "in any way you like", and the misconception §15.E says
    // the dialog's shape invites: all three on one body is a legal answer.
    expect(energyIdsOn(after, benchRef(1))).toHaveLength(3);
    expect(energyIdsOn(after, ACTIVE_REF)).toEqual(["fix-energy"]);
  });

  it("an EMPTY answer is a legal decline, and nothing moves", () => {
    const state = ready(6, { hand: { "fix-energy": 2 } });
    const { state: parked } = strike(state);
    const { state: after, events } = attach(parked, []);
    expect(all(events, "ENERGY_ATTACHED")).toHaveLength(0);
    expect(handCount(after, "fix-energy")).toBe(2);
    // The printed "**You may**" — and the attack's damage still landed, because
    // the effect is the optional half and the damage is not.
    expect(after.phase.kind).not.toBe("effect:choose");
  });

  it("the wire cannot conjure a card, repeat one, or aim across the table", () => {
    const state = ready(7, { hand: { "fix-energy": 3 } });
    const { state: parked } = strike(state);
    const uids = promptOf(parked).candidates;
    const first = uids[0] as string;
    const foreign = parked.players.p2.hand[0] as string;
    const REFUSALS: readonly (readonly [string, { uid: string; to: PokemonRef }[]])[] = [
      ["a uid from the OPPONENT's hand", [{ uid: foreign, to: ACTIVE_REF }]],
      [
        "the same physical card twice",
        [
          { uid: first, to: ACTIVE_REF },
          { uid: first, to: benchRef(0) },
        ],
      ],
      ["a target across the table", [{ uid: first, to: { seat: "p2", spot: { spot: "active" } } }]],
    ];
    for (const [why, assignments] of REFUSALS) {
      expectErr(
        parked,
        { type: "resolveEffect", seat: "p1", choice: { kind: "attachCards", assignments } },
        "BAD_EFFECT_CHOICE",
      );
      expect(why).not.toBe("");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. THE FILTER — the printed adjective "Basic", made falsifiable
// ─────────────────────────────────────────────────────────────────────────────

describe("Basic Energy cards — the noun the print narrows", () => {
  it("refuses a SPECIAL Energy and a Tool sitting in the same hand", () => {
    const state = ready(8, { hand: { "fix-energy": 2, "fix-special": 2, "fix-tool": 2 } });
    deepFreeze(state);
    const prompt = promptOf(strike(state).state);
    // Six cards in hand, two offered. `fix-special` is the card an `anyEnergy`
    // filter WOULD offer, which is the only thing that tells the printed adjective
    // from its absence; `fix-tool` is the card no energy filter offers at all.
    expect(handCount(state, "fix-energy")).toBe(2);
    expect(handCount(state, "fix-special")).toBe(2);
    expect(handCount(state, "fix-tool")).toBe(2);
    expect(idsOf(state, prompt.candidates)).toEqual(["fix-energy", "fix-energy"]);
  });

  it("does not park at all when the hand holds no Basic Energy", () => {
    const state = ready(9, { hand: { "fix-special": 2, "fix-tool": 2 } });
    const { state: after, events } = strike(state);
    expect(after.phase.kind).not.toBe("effect:choose");
    expect(all(events, "ENERGY_ATTACHED")).toHaveLength(0);
    // The whiff is silent and total: nothing left the hand, and the attack's
    // damage still resolved.
    expect(handCount(after, "fix-energy")).toBe(0);
    expect(handCount(after, "fix-special")).toBe(2);
    expect(all(events, "ATTACK_DECLARED")).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. THE READ SITES NOBODY PRICES
// ─────────────────────────────────────────────────────────────────────────────

describe("the read sites, priced by driving them", () => {
  it("`programPlayable` is not asked, and the op is deliberately UNGATED", () => {
    const state = ready(10, { hand: {} });
    expect(programPlayable(state, TROPICAL_FRENZY_PROGRAM, "p1")).toBe(true);
  });

  it("an EMPTY TARGET SET is a dead end, not a park — driven by surgery", () => {
    const state = ready(3, { hand: { "fix-energy": 3 } });
    const empty: GameState = {
      ...state,
      players: {
        ...state.players,
        p1: { ...state.players.p1, active: null, bench: [] },
      },
    };
    const events: GameEvent[] = [];
    const result = runProgram(empty, TROPICAL_FRENZY_PROGRAM, { seat: "p1" }, {}, events);
    expect(result.kind).toBe("done");
    expect(all(events, "ENERGY_ATTACHED")).toHaveLength(0);
    // …and the cards are still in the hand: a dead end moves nothing.
    expect(handCount(result.kind === "done" ? result.state : empty, "fix-energy")).toBe(3);
    // The control: the SAME program on the same hand with a board to land on does
    // park, so the assertion above is the target set doing the work rather than
    // the program being unreachable.
    const live: GameEvent[] = [];
    expect(runProgram(state, TROPICAL_FRENZY_PROGRAM, { seat: "p1" }, {}, live).kind).toBe(
      "parked",
    );
  });

  it("the op is not a recorder, so no §9.2 slot is written or read", () => {
    const state = ready(11, { hand: { "fix-energy": 2 } });
    const { state: parked } = strike(state);
    const uids = promptOf(parked).candidates;
    const { state: after } = attach(parked, [{ uid: uids[0] as string, to: ACTIVE_REF }]);
    expect(after.phase.kind).not.toBe("effect:choose");
    expect(energyIdsOn(after, ACTIVE_REF)).toEqual(["fix-energy", "fix-energy"]);
  });
});
