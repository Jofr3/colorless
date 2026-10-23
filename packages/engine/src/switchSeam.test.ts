import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { matchesFilter } from "./cards";
import { deriveAttackCopy } from "./effects";
import { applyAction, createGame, deriveAttackEffect, programFor, topCardOf } from "./index";
import { resumeProgram, runProgram } from "./interpreter";
import type { GameEvent, GameState, PokemonRef, Seat } from "./index";
import {
  FIXTURE_POOL,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  firstBasicInHand,
  handFromDeck,
  handToDeck,
  must,
  mustApply,
  setActiveFromDeck,
  setBenchDamage,
  setConditions,
  trainerCard,
  findEvent,
} from "./testFixtures";

// ── The printed sentences, as bytes ──────────────────────────────────────────

/** Team Rocket's Giovanni `sv10-174/-225/-238`, verbatim off `effect`. */
const GIOVANNI =
  "Switch your Active Team Rocket's Pokémon with 1 of your Benched Team Rocket's Pokémon. If you do, switch in 1 of your opponent's Benched Pokémon to the Active Spot.";
/** Surfer `sv08-187/-235`, verbatim off `effect`. */
const SURFER =
  "Switch your Active Pokémon with 1 of your Benched Pokémon. If you do, draw cards until you have 5 cards in your hand.";
const PLAIN_SWITCH = "Switch your Active Pokémon with 1 of your Benched Pokémon.";
/** Boss's Orders `sv02-172` — Giovanni's consequent, verbatim and separately. */
const BOSSS_ORDERS = "Switch in 1 of your opponent's Benched Pokémon to the Active Spot.";
/** Prime Catcher `sv05-157`/`sv08.5-119`, verbatim off `effect`. */
const PRIME_CATCHER =
  "Switch in 1 of your opponent's Benched Pokémon to the Active Spot. If you do, switch your Active Pokémon with 1 of your Benched Pokémon.";
const LISIAS_APPEAL =
  "Switch in 1 of your opponent's Benched Basic Pokémon to the Active Spot. If you do, the new Active Pokémon is now Confused.";
const SCRAMBLE_SWITCH =
  "Switch your Active Pokémon with 1 of your Benched Pokémon. If you do, you may move any amount of Energy from the Pokémon you moved to your Bench to the new Active Pokémon.";
const SELF_SWITCH = "Switch this Pokémon with 1 of your Benched Pokémon.";
/** ⏹️ Kilowattrel ex `sv08-068` "Return Charge" — the seam on the ATTACK surface. */
const RETURN_CHARGE =
  "Switch this Pokémon with 1 of your Benched Pokémon. If you do, attach up to 2 Basic {L} Energy cards from your hand to this Pokémon.";
const INTERJET =
  "Switch this Pokémon with 1 of your Benched Pokémon. If you do, switch out your opponent's Active Pokémon to the Bench. (Your opponent chooses the new Active Pokémon.)";
const GOAD_N_GRAB =
  "Switch out your opponent's Active Pokémon to the Bench. (Your opponent chooses the new Active Pokémon.) If you do, this attack does 160 damage to the new Active Pokémon.";
const VOLT_SWITCH = "Switch this Pokémon with 1 of your Benched {L} Pokémon.";
const EXTENDED_DAMAGRIIIGUS =
  "Move all damage counters from 1 of your Benched Pokémon to 1 of your opponent's Pokémon.";
const ADRENA_BRAIN =
  "Once during your turn, if this Pokémon has any {D} Energy attached, you may move up to 3 damage counters from 1 of your Pokémon to 1 of your opponent's Pokémon.";
const ROCKET_BRAIN =
  "As often as you like during your turn, you may move 1 damage counter from 1 of your Team Rocket's Pokémon to another of your Pokémon.";
const NIGHT_JOKER = "Choose 1 of your Benched N's Pokémon's attacks and use it as this attack.";
const TAIL_SWAP =
  "Move all damage counters from 1 of your Benched Pokémon to your opponent's Active Pokémon.";

const LANDED = [
  {
    card: "Team Rocket's Giovanni",
    sentence: GIOVANNI,
    ids: ["sv10-174", "sv10-225", "sv10-238"],
    legal: 3,
  },
  { card: "Surfer", sentence: SURFER, ids: ["sv08-187", "sv08-235"], legal: 2 },
  { card: "Prime Catcher", sentence: PRIME_CATCHER, ids: ["sv05-157", "sv08.5-119"], legal: 2 },
] as const;

function subgroupBasic(id: string, name: string): Card {
  return battler(id, { name, hp: 90, types: ["Psychic"] });
}

const LOCAL_CARDS: Record<string, Card> = {
  "sv10-174": trainerCard("sv10-174", "Supporter", GIOVANNI),
  "sv08-187": trainerCard("sv08-187", "Supporter", SURFER),
  "sv05-157": trainerCard("sv05-157", "Item", PRIME_CATCHER),
  // ── Bodies the subgroup rider must KEEP.
  "fix-tr-nidorino": subgroupBasic("fix-tr-nidorino", "Team Rocket's Nidorino"),
  "fix-tr-meowth": subgroupBasic("fix-tr-meowth", "Team Rocket's Meowth"),
  "fix-tr-mewtwo": subgroupBasic("fix-tr-mewtwo", "Team Rocket's Mewtwo ex"),
  // ── Bodies it must DROP. Every one is a real near-miss.
  /** No prefix at all — the ordinary body every real board also holds. */
  "fix-plain": subgroupBasic("fix-plain", "Pikachu"),
  "fix-rocketeer": subgroupBasic("fix-rocketeer", "Team Rocketeer"),
  "fix-lowercase": subgroupBasic("fix-lowercase", "team rocket's Meowth"),
  /** A DIFFERENT owner's prefixed body — so a rider that matched any possessive
      at all would keep it. */
  "fix-iono-body": subgroupBasic("fix-iono-body", "Iono's Bellibolt"),
  "fix-lightning-body": battler("fix-lightning-body", {
    name: "Wattrel",
    hp: 70,
    types: ["Lightning"],
  }),
  /** An EVOLUTION body for the opponent's Bench — Lisia's Appeal's refused
      "Benched **Basic** Pokémon" filter needs a non-Basic to be about anything. */
  "fix-stage1": battler("fix-stage1", {
    name: "Beartic",
    hp: 130,
    stage: "Stage1",
    evolveFrom: "Cubchoo",
    types: ["Water"],
  }),
  /** A 340 HP neutral body for the opponent's side. */
  "fix-bigtitan": battler("fix-bigtitan", { name: "Titan", hp: 340, types: ["Colorless"] }),
  "fix-tailswap": battler("fix-tailswap", {
    name: "Dedenne ex",
    hp: 200,
    types: ["Psychic"],
    attacks: [{ name: "Tail Swap", cost: ["Psychic", "Colorless"], effect: TAIL_SWAP }],
  }),
} as const;

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const DECK = deckOf({
  "sv10-174": 4,
  "sv08-187": 4,
  "sv05-157": 3,
  "sv01-194": 3,
  "fix-tr-nidorino": 5,
  "fix-tr-meowth": 4,
  "fix-tr-mewtwo": 3,
  "fix-plain": 5,
  "fix-rocketeer": 4,
  "fix-lowercase": 3,
  "fix-iono-body": 3,
  "fix-lightning-body": 3,
  "fix-bigtitan": 4,
  "fix-stage1": 3,
  "fix-tailswap": 3,
  "fix-psychic-energy": 6,
});

function localSetup(seed: number, first: Seat): GameState {
  const created = createGame({ seed, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(
    applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first }),
  );
  while (state.phase.kind === "setup:drawExtra") {
    const phase = state.phase;
    const seat = (["p1", "p2"] as const).find((s) => !phase.decided[s]);
    if (seat === undefined) throw new Error("setup:drawExtra with every seat decided");
    state = must(applyAction(state, { type: "setupDrawExtra", seat, count: phase.owed[seat] }));
  }
  for (const seat of ["p1", "p2"] as const) {
    state = must(
      applyAction(state, { type: "setupPlaceActive", seat, uid: firstBasicInHand(state, seat) }),
    );
  }
  for (const seat of ["p1", "p2"] as const)
    state = must(applyAction(state, { type: "setupReady", seat }));
  return state;
}

function board(seed: number): GameState {
  let state = localSetup(seed, "p1");
  while (state.turn < 3) {
    if (state.phase.kind !== "turn:action") throw new Error(`stuck in ${state.phase.kind}`);
    state = must(applyAction(state, { type: "endTurn", seat: state.turn % 2 === 1 ? "p1" : "p2" }));
  }
  return state;
}

function withActive(seed: number, bodyId: string): GameState {
  let state = board(seed);
  state = handToDeck(state, "p1", bodyId);
  const base = clearBench(setActiveFromDeck(state, "p1", bodyId), "p1");
  return clearBench(setActiveFromDeck(base, "p2", "fix-bigtitan"), "p2");
}

/** `bodyId` Active for P1, `bench` behind it, `oppBench` behind P2's Titan. */
function stage(seed: number, bodyId: string, bench: string[], oppBench: string[] = []): GameState {
  let state = withActive(seed, bodyId);
  for (const id of bench) state = benchFromDeck(state, "p1", id);
  for (const id of oppBench) state = benchFromDeck(state, "p2", id);
  return state;
}

/** Put `cardId` in P1's hand and return its uid — the Supporter about to be played. */
function inHand(state: GameState, cardId: string): { state: GameState; uid: string } {
  const next = handFromDeck(handToDeck(state, "p1", cardId), "p1", cardId, 1);
  const uid = next.players.p1.hand.find((u) => next.cardIdByUid[u] === cardId);
  if (uid === undefined) throw new Error(`${cardId} not in hand`);
  return { state: next, uid };
}

function play(state: GameState, uid: string) {
  return applyAction(state, { type: "playTrainer", seat: "p1", uid });
}

/** The parked `choosePokemon` prompt, narrowed. */
function choosePrompt(state: GameState): { candidates: PokemonRef[]; note: string } {
  if (state.phase.kind !== "effect:choose")
    throw new Error(`expected effect:choose, got ${state.phase.kind}`);
  if (state.phase.prompt.kind !== "choosePokemon") {
    throw new Error(`expected choosePokemon, got ${state.phase.prompt.kind}`);
  }
  return { candidates: state.phase.prompt.candidates, note: state.phase.prompt.note };
}

/** The §9.2 record a parked continuation is carrying — the slot `recordAs` fills. */
function parkedRecord(state: GameState): Record<string, string[]> {
  if (state.phase.kind !== "effect:choose")
    throw new Error(`expected effect:choose, got ${state.phase.kind}`);
  return (state.phase.cont.record ?? {}) as Record<string, string[]>;
}

/** The printed NAME of a seat's Active — narrowed, so an empty spot fails here
    with the reason rather than three lines later on an undefined. */
function activeName(state: GameState, seat: Seat): string {
  const active = state.players[seat].active;
  if (active === null) throw new Error(`${seat} has no Active`);
  return topCardOf(state, active)?.name ?? "?";
}

/** The printed NAME of every body a ref list points at. */
function refNames(state: GameState, refs: readonly PokemonRef[]): string[] {
  return refs.map((ref) => {
    const side = state.players[ref.seat];
    const body = ref.spot.spot === "active" ? side.active : (side.bench[ref.spot.index] ?? null);
    return body === null ? "?" : (topCardOf(state, body)?.name ?? "?");
  });
}

function pick(seat: Seat, ref: PokemonRef) {
  return { type: "resolveEffect", seat, choice: { kind: "pokemon", ref } } as const;
}

const P1_BENCH = (index: number): PokemonRef => ({ seat: "p1", spot: { spot: "bench", index } });
const P2_BENCH = (index: number): PokemonRef => ({ seat: "p2", spot: { spot: "bench", index } });

describe("Surfer sv08-187/-235 — `switchActive.recordAs` + §9.2, and nothing else", () => {
  it("switches, and THEN draws to 5 — both printed clauses, in order", () => {
    // Hand is emptied to exactly the Supporter, so "drew to 5" is a measurement
    // and not an accident of the opening seven.
    let state = stage(11, "fix-plain", ["fix-tr-nidorino", "fix-tr-meowth"]);
    const staged = inHand(
      { ...state, players: { ...state.players, p1: { ...state.players.p1, hand: [] } } },
      "sv08-187",
    );
    state = staged.state;
    expect(state.players.p1.hand).toHaveLength(1);
    const { state: parked } = mustApply(state, {
      type: "playTrainer",
      seat: "p1",
      uid: staged.uid,
    });
    const { state: done, events } = mustApply(parked, pick("p1", P1_BENCH(0)));
    const switched = findEvent(events, "POKEMON_SWITCHED");
    expect(switched?.seat).toBe("p1");
    expect(activeName(done, "p1")).toBe("Team Rocket's Nidorino");
    expect(done.players.p1.hand).toHaveLength(5);
    expect(done.phase.kind).toBe("turn:action");
  });

  it("files the PROMOTED body's uid under `moved` — read off the live continuation", () => {
    // The seam made visible rather than inferred: the parked continuation carries
    // the §9.2 record, and this is what `recordGateHolds` will ask about.
    const state = stage(12, "fix-plain", ["fix-tr-nidorino", "fix-tr-meowth"]);
    const staged = inHand(state, "sv08-187");
    const { state: parked } = mustApply(staged.state, {
      type: "playTrainer",
      seat: "p1",
      uid: staged.uid,
    });
    // Nothing is filed BEFORE the answer — the op has not run yet.
    expect(parkedRecord(parked).moved).toBeUndefined();
    const incoming = parked.players.p1.bench[0]?.stack[0];
    const { state: done } = mustApply(parked, pick("p1", P1_BENCH(0)));
    expect(done.players.p1.active?.stack[0]).toBe(incoming);
  });

  it("the PROMPT says what the answer buys — §9.2's `withConsequence`, at a sixth op", () => {
    const state = stage(13, "fix-plain", ["fix-tr-nidorino", "fix-tr-meowth"]);
    const staged = inHand(state, "sv08-187");
    const { state: parked } = mustApply(staged.state, {
      type: "playTrainer",
      seat: "p1",
      uid: staged.uid,
    });
    expect(choosePrompt(parked).note).toBe(
      "Switch to which Benched Pokémon? If you do, draw cards until you have 5 cards in your hand.",
    );
  });

  it("a hand ALREADY at 5+ draws nothing — and the card is still playable", () => {
    // `drawUntilHandSize` NEVER TRIMS, so the consequent is a no-op here. The
    // would-whiff gate belongs to `switchActive` alone: the switch is a printed
    // effect that happens, so refusing the play would refuse a working board.
    let state = stage(14, "fix-plain", ["fix-tr-nidorino", "fix-tr-meowth"]);
    const staged = inHand(state, "sv08-187");
    state = handFromDeck(staged.state, "p1", "fix-psychic-energy", 4);
    const uid = state.players.p1.hand.find((u) => state.cardIdByUid[u] === "sv08-187");
    if (uid === undefined) throw new Error("Surfer left the hand");
    const before = state.players.p1.hand.length - 1;
    // The premise, asserted: this hand is genuinely at or above the target, so a
    // green here is "nothing was drawn" and not "the draw happened to be zero".
    expect(before).toBeGreaterThanOrEqual(5);
    const { state: parked } = mustApply(state, { type: "playTrainer", seat: "p1", uid });
    const { state: done } = mustApply(parked, pick("p1", P1_BENCH(0)));
    expect(done.players.p1.hand).toHaveLength(before);
    expect(activeName(done, "p1")).toBe("Team Rocket's Nidorino");
  });

  it("an EMPTY Bench refuses the play — so the whole card, draw included, cannot whiff", () => {
    const state = stage(15, "fix-plain", []);
    const staged = inHand(state, "sv08-187");
    const result = play(staged.state, staged.uid);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NO_LEGAL_TARGET");
  });

  it("carries the printed sentence and the exact program it maps to", () => {
    for (const id of ["sv08-187", "sv08-235"]) {
      expect(programFor(id)?.trainer, `${id}`).toEqual([
        { op: "switchActive", recordAs: "moved" },
        { op: "recordGate", slot: "moved", then: [{ op: "drawUntilHandSize", size: 5 }] },
      ]);
    }
    expect(SURFER).toContain("If you do");
    expect(SURFER).toContain("until you have 5 cards");
  });
});

// ── 2. Team Rocket's Giovanni — the subgroup rider on TOP of the seam ────────

describe("Team Rocket's Giovanni sv10-174/-225/-238 — both printed nouns, one field", () => {
  /** A mixed Bench: two Team Rocket's bodies and three near-misses. */
  const MIXED = ["fix-tr-nidorino", "fix-plain", "fix-rocketeer", "fix-tr-meowth", "fix-lowercase"];

  it("offers ONLY the Team Rocket's bodies — `Team Rocketeer` and the lowercase are DROPPED", () => {
    const state = stage(21, "fix-tr-mewtwo", MIXED, ["fix-plain"]);
    const staged = inHand(state, "sv10-174");
    const { state: parked } = mustApply(staged.state, {
      type: "playTrainer",
      seat: "p1",
      uid: staged.uid,
    });
    expect(refNames(parked, choosePrompt(parked).candidates).sort()).toEqual([
      "Team Rocket's Meowth",
      "Team Rocket's Nidorino",
    ]);
    expect(choosePrompt(parked).note).toBe(
      "Switch to which Benched Team Rocket's Pokémon? If you do, switch in 1 of your opponent's Benched Pokémon to the Active Spot.",
    );
  });

  it("switches own, THEN gusts the opponent — two boards moved by one card", () => {
    const state = stage(22, "fix-tr-mewtwo", MIXED, ["fix-plain", "fix-iono-body"]);
    const staged = inHand(state, "sv10-174");
    const { state: parked } = mustApply(staged.state, {
      type: "playTrainer",
      seat: "p1",
      uid: staged.uid,
    });
    const { state: gustParked, events: first } = mustApply(parked, pick("p1", P1_BENCH(0)));
    expect(findEvent(first, "POKEMON_SWITCHED")?.seat).toBe("p1");
    expect(activeName(gustParked, "p1")).toBe("Team Rocket's Nidorino");
    expect(gustParked.phase.kind).toBe("effect:choose");
    expect(parkedRecord(gustParked).moved).toEqual([gustParked.players.p1.active?.stack[0]]);
    expect(refNames(gustParked, choosePrompt(gustParked).candidates).sort()).toEqual([
      "Iono's Bellibolt",
      "Pikachu",
    ]);
    const { state: done, events: second } = mustApply(gustParked, pick("p1", P2_BENCH(0)));
    expect(findEvent(second, "POKEMON_SWITCHED")?.seat).toBe("p2");
    expect(activeName(done, "p2")).toBe("Pikachu");
    expect(done.phase.kind).toBe("turn:action");
  });

  it("a POISONED+BURNED outgoing Active files ONE uid, not one per EVENT", () => {
    let state = stage(
      28,
      "fix-tr-mewtwo",
      ["fix-tr-nidorino", "fix-tr-meowth"],
      ["fix-plain", "fix-iono-body"],
    );
    state = setConditions(state, "p1", { poisonDamage: 10, burned: true });
    const staged = inHand(state, "sv10-174");
    const { state: parked } = mustApply(staged.state, {
      type: "playTrainer",
      seat: "p1",
      uid: staged.uid,
    });
    const { state: gustParked, events } = mustApply(parked, pick("p1", P1_BENCH(0)));
    // BOTH rows really are emitted — otherwise this asserts nothing.
    expect(findEvent(events, "POKEMON_SWITCHED")).toBeDefined();
    expect(findEvent(events, "STATUS_CLEARED")).toBeDefined();
    expect(parkedRecord(gustParked).moved).toEqual([gustParked.players.p1.active?.stack[0]]);
    // …and §12's own rule still holds through the new helper: the body that left
    // the Active Spot lost its conditions.
    expect(gustParked.players.p1.active?.conditions.poisonDamage).toBe(0);
    expect(gustParked.players.p1.active?.conditions.burned).toBe(false);
  });

  it("an Active OUTSIDE the subgroup refuses the play — the FIRST printed noun", () => {
    const state = stage(23, "fix-plain", MIXED, ["fix-plain"]);
    const staged = inHand(state, "sv10-174");
    const result = play(staged.state, staged.uid);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NO_LEGAL_TARGET");
  });

  it("`Team Rocketeer` ACTIVE is also refused — the possessive, on the second read site", () => {
    // The negative fixture fielded at the OTHER end. `startsWith("Team Rocket")`
    // on the Active precondition passes the test above (Pikachu fails it either
    // way) and fails only here.
    const state = stage(24, "fix-rocketeer", ["fix-tr-nidorino", "fix-tr-meowth"], ["fix-plain"]);
    const staged = inHand(state, "sv10-174");
    const result = play(staged.state, staged.uid);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NO_LEGAL_TARGET");
  });

  it("a Bench with no Team Rocket's body refuses the play — the SECOND printed noun", () => {
    const state = stage(
      25,
      "fix-tr-mewtwo",
      ["fix-plain", "fix-rocketeer", "fix-iono-body"],
      ["fix-plain"],
    );
    const staged = inHand(state, "sv10-174");
    const result = play(staged.state, staged.uid);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NO_LEGAL_TARGET");
  });

  it("an EMPTY OPPONENT Bench is still playable — the consequent is not the card", () => {
    // The division `programPlayable` already draws for `coinFlipGate`: a gate's
    // branch is refused only when it is the WHOLE card. Giovanni's first sentence
    // resolves here, so the card works and the gust does as much as it can.
    const state = stage(26, "fix-tr-mewtwo", MIXED, []);
    const staged = inHand(state, "sv10-174");
    const { state: parked } = mustApply(staged.state, {
      type: "playTrainer",
      seat: "p1",
      uid: staged.uid,
    });
    const { state: done } = mustApply(parked, pick("p1", P1_BENCH(0)));
    expect(activeName(done, "p1")).toBe("Team Rocket's Nidorino");
    expect(activeName(done, "p2")).toBe("Titan");
    expect(done.phase.kind).toBe("turn:action");
  });

  it("ONE Team Rocket's benched body is FORCED, not asked — `parkOrForce`, unchanged", () => {
    const state = stage(
      27,
      "fix-tr-mewtwo",
      ["fix-tr-nidorino", "fix-plain", "fix-rocketeer"],
      ["fix-plain", "fix-iono-body"],
    );
    const staged = inHand(state, "sv10-174");
    const { state: gustParked, events } = mustApply(staged.state, {
      type: "playTrainer",
      seat: "p1",
      uid: staged.uid,
    });
    // The own switch auto-resolved (one candidate) and the program ran straight
    // on into the gate and the gust — so the FIRST park a player sees is the
    // opponent's Bench, which is the narrowing doing real work on the dialog.
    expect(findEvent(events, "POKEMON_SWITCHED")?.seat).toBe("p1");
    expect(activeName(gustParked, "p1")).toBe("Team Rocket's Nidorino");
    expect(refNames(gustParked, choosePrompt(gustParked).candidates).sort()).toEqual([
      "Iono's Bellibolt",
      "Pikachu",
    ]);
  });

  it("carries the printed sentence and the exact program it maps to", () => {
    for (const id of ["sv10-174", "sv10-225", "sv10-238"]) {
      expect(programFor(id)?.trainer, `${id}`).toEqual([
        { op: "switchActive", ownerPokemon: "Team Rocket", recordAs: "moved" },
        { op: "recordGate", slot: "moved", then: [{ op: "gust" }] },
      ]);
    }
    // The consequent IS Boss's Orders' whole program, byte for byte — one printed
    // action read off two different cards, which is this family's checkable claim.
    const gate = programFor("sv10-174")?.trainer?.[1];
    expect(gate?.op === "recordGate" ? gate.then : undefined).toEqual(
      programFor("sv02-172")?.trainer,
    );
    expect(GIOVANNI).toContain(BOSSS_ORDERS.charAt(0).toLowerCase() + BOSSS_ORDERS.slice(1));
  });
});

// ── 2b. Prime Catcher — the SAME seam, the other way round ──────────────────

describe("Prime Catcher sv05-157/sv08.5-119 — `gust.recordAs`, the mirror field", () => {
  it("gusts, and THEN switches own — Giovanni's two ops in the opposite order", () => {
    const state = stage(
      81,
      "fix-plain",
      ["fix-tr-nidorino", "fix-tr-meowth"],
      ["fix-plain", "fix-iono-body"],
    );
    const staged = inHand(state, "sv05-157");
    const { state: parked } = mustApply(staged.state, {
      type: "playTrainer",
      seat: "p1",
      uid: staged.uid,
    });
    // The FIRST park is the OPPONENT's Bench — the antecedent, not the consequent.
    expect(refNames(parked, choosePrompt(parked).candidates).sort()).toEqual([
      "Iono's Bellibolt",
      "Pikachu",
    ]);
    const { state: ownParked, events: first } = mustApply(parked, pick("p1", P2_BENCH(0)));
    expect(findEvent(first, "POKEMON_SWITCHED")?.seat).toBe("p2");
    expect(activeName(ownParked, "p2")).toBe("Pikachu");
    expect(ownParked.phase.kind).toBe("effect:choose");
    expect(parkedRecord(ownParked).moved).toEqual([ownParked.players.p2.active?.stack[0]]);
    // …and the consequent's candidates are the CONTROLLER's Bench, unnarrowed.
    expect(refNames(ownParked, choosePrompt(ownParked).candidates).sort()).toEqual([
      "Team Rocket's Meowth",
      "Team Rocket's Nidorino",
    ]);
    const { state: done, events: second } = mustApply(ownParked, pick("p1", P1_BENCH(0)));
    expect(findEvent(second, "POKEMON_SWITCHED")?.seat).toBe("p1");
    expect(activeName(done, "p1")).toBe("Team Rocket's Nidorino");
    expect(done.phase.kind).toBe("turn:action");
  });

  it("an empty OPPONENT Bench refuses the play; an empty OWN Bench does not", () => {
    const noOpp = inHand(stage(82, "fix-plain", ["fix-tr-nidorino"], []), "sv05-157");
    const refused = play(noOpp.state, noOpp.uid);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.code).toBe("NO_LEGAL_TARGET");

    const noOwn = inHand(stage(83, "fix-plain", [], ["fix-plain", "fix-iono-body"]), "sv05-157");
    const { state: parked } = mustApply(noOwn.state, {
      type: "playTrainer",
      seat: "p1",
      uid: noOwn.uid,
    });
    const { state: done } = mustApply(parked, pick("p1", P2_BENCH(0)));
    expect(activeName(done, "p2")).toBe("Pikachu");
    expect(activeName(done, "p1")).toBe("Pikachu");
    expect(done.phase.kind).toBe("turn:action");
  });

  it("a FORCED gust records too — the auto-apply path, not just the parked one", () => {
    const state = stage(85, "fix-plain", ["fix-tr-nidorino", "fix-tr-meowth"], ["fix-plain"]);
    const staged = inHand(state, "sv05-157");
    const { state: ownParked, events } = mustApply(staged.state, {
      type: "playTrainer",
      seat: "p1",
      uid: staged.uid,
    });
    expect(findEvent(events, "POKEMON_SWITCHED")?.seat).toBe("p2");
    expect(activeName(ownParked, "p2")).toBe("Pikachu");
    expect(parkedRecord(ownParked).moved).toEqual([ownParked.players.p2.active?.stack[0]]);
    // The consequent's own park — proof the gate read the forced filing.
    expect(refNames(ownParked, choosePrompt(ownParked).candidates).sort()).toEqual([
      "Team Rocket's Meowth",
      "Team Rocket's Nidorino",
    ]);
  });

  it("the PROMPT says what the answer buys, and Boss's Orders' does NOT", () => {
    const state = stage(
      84,
      "fix-plain",
      ["fix-tr-nidorino", "fix-tr-meowth"],
      ["fix-plain", "fix-iono-body"],
    );
    const staged = inHand(state, "sv05-157");
    const { state: parked } = mustApply(staged.state, {
      type: "playTrainer",
      seat: "p1",
      uid: staged.uid,
    });
    expect(choosePrompt(parked).note).toBe(
      "Gust up which of the opponent's Benched Pokémon? If you do, switch your Active Pokémon with 1 of your Benched Pokémon.",
    );
    // The un-riddered gust is untouched — same op, same heading, no clause.
    expect(programFor("sv02-172")?.trainer).toEqual([{ op: "gust" }]);
  });

  it("carries the exact program, and its consequent IS `SWITCH` byte for byte", () => {
    for (const id of ["sv05-157", "sv08.5-119"]) {
      expect(programFor(id)?.trainer, `${id}`).toEqual([
        { op: "gust", recordAs: "moved" },
        { op: "recordGate", slot: "moved", then: [{ op: "switchActive" }] },
      ]);
    }
    const gate = programFor("sv05-157")?.trainer?.[1];
    expect(gate?.op === "recordGate" ? gate.then : undefined).toEqual(
      programFor("sv01-194")?.trainer,
    );
  });
});

// ── 3. The regression half — the UNMARKED op is byte-identical ───────────────

describe("the unmarked `switchActive` did not move", () => {
  it("`sv01-194` is still the bare one-op program, with NEITHER key written", () => {
    expect(programFor("sv01-194")?.trainer).toEqual([{ op: "switchActive" }]);
    const op = programFor("sv01-194")?.trainer?.[0];
    expect(op).not.toHaveProperty("ownerPokemon");
    expect(op).not.toHaveProperty("recordAs");
  });

  it("offers EVERY benched body and keeps the unmarked heading, with no §9.2 clause", () => {
    const state = stage(31, "fix-plain", ["fix-tr-nidorino", "fix-plain", "fix-rocketeer"]);
    const staged = inHand(state, "sv01-194");
    const { state: parked } = mustApply(staged.state, {
      type: "playTrainer",
      seat: "p1",
      uid: staged.uid,
    });
    expect(refNames(parked, choosePrompt(parked).candidates).sort()).toEqual([
      "Pikachu",
      "Team Rocket's Nidorino",
      "Team Rocketeer",
    ]);
    expect(choosePrompt(parked).note).toBe("Switch to which Benched Pokémon?");
    expect(parkedRecord(parked)).toEqual({});
  });

  it("D189's ATTACK self-switch still derives to the field-less op", () => {
    expect(deriveAttackEffect(SELF_SWITCH)).toEqual([{ op: "switchActive" }]);
    expect(PLAIN_SWITCH).not.toContain("If you do");
  });
});

describe("the width of `ownerPokemon`, measured by what it cannot say", () => {
  it("Vikavolt sv07-053 (1 legal) — '{L} Pokémon' is a DIFFERENT axis, not this one", () => {
    const wattrel = LOCAL_CARDS["fix-lightning-body"] as Card;
    expect(wattrel.types).toEqual(["Lightning"]);
    expect(matchesFilter(wattrel, { kind: "ownerPokemon", owner: "{L}" })).toBe(false);
    expect(matchesFilter(wattrel, { kind: "ownerPokemon", owner: "Lightning" })).toBe(false);
    expect(deriveAttackEffect(VOLT_SWITCH)).toEqual([
      { op: "switchActive", targetType: "Lightning" },
    ]);
    // …and the field this file is about is still ABSENT from that program, which is
    // the half that carries the original claim: an `ownerPokemon` build would have
    // put "{L}" (or "Lightning") in this slot.
    expect(deriveAttackEffect(VOLT_SWITCH)?.[0]).not.toHaveProperty("ownerPokemon");
    expect(programFor("sv07-053")?.attack).toBeUndefined();
  });

  it("the possessive predicate is the SAME one three other read sites use", () => {
    // Shared, not re-implemented: a Team Rocket's Pokémon must mean the same
    // three conjuncts to a deck search, an attach target, a counter-move source
    // and now a switch, or a player learns one rule and the engine enforces two.
    const tr: Parameters<typeof matchesFilter>[1] = { kind: "ownerPokemon", owner: "Team Rocket" };
    expect(matchesFilter(LOCAL_CARDS["fix-tr-nidorino"] as Card, tr)).toBe(true);
    expect(matchesFilter(LOCAL_CARDS["fix-rocketeer"] as Card, tr)).toBe(false);
    expect(matchesFilter(LOCAL_CARDS["fix-lowercase"] as Card, tr)).toBe(false);
    expect(matchesFilter(LOCAL_CARDS["fix-iono-body"] as Card, tr)).toBe(false);
  });
});

describe("the landed census, re-derived", () => {
  it("lands SEVEN Standard-legal printings on TWO mirror ops and ZERO new vocabulary", () => {
    expect(LANDED.reduce((n, row) => n + row.legal, 0)).toBe(7);
    for (const row of LANDED) {
      expect(row.ids, `${row.card}: id list disagrees with its measured legal count`).toHaveLength(
        row.legal,
      );
      for (const id of row.ids)
        expect(programFor(id)?.trainer, `${id} (${row.card})`).toBeDefined();
      expect(
        deriveAttackEffect(row.sentence),
        `${row.card} is a TRAINER, not an attack`,
      ).toBeNull();
    }
  });

  it("shares ONE program object per card across its printings", () => {
    for (const row of LANDED) {
      const first = programFor(row.ids[0]);
      for (const id of row.ids) expect(programFor(id), `${id} left ${row.card}`).toBe(first);
    }
    expect(programFor("sv08-187")).not.toBe(programFor("sv10-174"));
    expect(programFor("sv05-157")).not.toBe(programFor("sv08-187"));
  });
});

describe("⏹️ FLAGGED — the CHOSEN DESTINATION counter move (D216: 2 of 8 landed; D565: 4 of 8; D572: 7 of 8; D574: 8 of 8 — the flag is EMPTY)", () => {
  const IDS: string[] = [];

  it("the ONE counter move in the union ALWAYS lands on the defender, and NEVER asks — driven", () => {
    let state = stage(41, "fix-tailswap", ["fix-tr-nidorino", "fix-tr-meowth"], ["fix-plain"]);
    state = attachFromDeck(state, "p1", "fix-psychic-energy", 2);
    state = setBenchDamage(state, "p1", 0, 30);
    state = setBenchDamage(state, "p1", 1, 50);
    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(choosePrompt(parked).candidates).toHaveLength(2);
    const { state: done } = mustApply(parked, pick("p1", P1_BENCH(1)));
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(done.players.p1.bench[1]?.damage).toBe(0);
    expect(done.players.p1.bench[0]?.damage).toBe(30);
    expect(done.players.p2.active?.damage).toBe(50);
    expect(done.players.p2.bench[0]?.damage).toBe(0);
  });

  it("and the ~~ONE still-flagged printing resolves on NEITHER route~~ ( D572: was FOUR; D574: ZERO — Alakazam resolves on the DERIVER route, by composition)", () => {
    expect(deriveAttackEffect(EXTENDED_DAMAGRIIIGUS)).toEqual([{ op: "moveCountersChosen" }]);
    expect(programFor("sv06-082")?.attack, "sv06-082 was half-built").toBeUndefined();
    expect(IDS).toHaveLength(0);
    expect(
      deriveAttackEffect(
        "You may move any number of damage counters from your opponent's Pokémon to their other Pokémon in any way you like.",
      ),
    ).toEqual([{ op: "moveCountersOpponentAnyWay", from: "any" }]);
    for (const id of ["sv06-095", "sv06.5-072", "sv08.5-044"]) {
      expect(programFor(id)?.abilities?.[0]?.program, id).toEqual([
        { op: "moveCountersToOpponentChosen", upTo: 3 },
      ]);
      expect(programFor(id)?.triggered, `${id} was half-built as a trigger`).toBeUndefined();
    }
    for (const id of ["sv10-089", "sv10-198"]) {
      expect(programFor(id)?.abilities?.[0]?.program, id).toEqual([
        { op: "moveCounterOwnChosen", ownerPokemon: "Team Rocket" },
      ]);
    }
    // The three sentences share ONE axis and differ on the others, which is what
    // makes them one flag rather than three: bounded amounts (Munkidori "up to 3",
    // Orbeetle "1") and repetition ("as often as you like") are SECOND pieces.
    expect(EXTENDED_DAMAGRIIIGUS).toContain("to 1 of your opponent's Pokémon");
    expect(ADRENA_BRAIN).toContain("to 1 of your opponent's Pokémon");
    expect(ROCKET_BRAIN).toContain("to another of your Pokémon");
    expect(TAIL_SWAP).toContain("to your opponent's Active Pokémon");
  });
});

describe("D561 BUILT — Scramble Switch sv08-186 (1 legal), the seam's third Trainer", () => {
  it("§9.2 still files the PROMOTED body by default, and Scramble Switch's `recordDemoted` files the DEMOTED one — driven", () => {
    const state = stage(51, "fix-plain", ["fix-tr-nidorino", "fix-tr-meowth"]);
    const staged = inHand(state, "sv08-187");
    const { state: parked } = mustApply(staged.state, {
      type: "playTrainer",
      seat: "p1",
      uid: staged.uid,
    });
    const wasActive = parked.players.p1.active?.stack[0];
    const incoming = parked.players.p1.bench[0]?.stack[0];
    // Two bodies, so "the record holds one of them" is a real distinction.
    expect(wasActive).not.toBe(incoming);
    const { state: gustLess } = mustApply(parked, pick("p1", P1_BENCH(0)));
    // The program finished, so read the filing off a board where it is still
    // parked: Giovanni's gust park carries the same record one op later.
    const trState = stage(
      52,
      "fix-tr-mewtwo",
      ["fix-tr-nidorino", "fix-tr-meowth"],
      ["fix-plain", "fix-iono-body"],
    );
    const trStaged = inHand(trState, "sv10-174");
    const { state: trParked } = mustApply(trState === trStaged.state ? trState : trStaged.state, {
      type: "playTrainer",
      seat: "p1",
      uid: trStaged.uid,
    });
    const demoted = trParked.players.p1.active?.stack[0];
    const { state: gustParked } = mustApply(trParked, pick("p1", P1_BENCH(0)));
    const filed = parkedRecord(gustParked).moved ?? [];
    expect(filed).toEqual([gustParked.players.p1.active?.stack[0]]);
    expect(filed).not.toContain(demoted);
    expect(gustParked.players.p1.bench.some((b) => b.stack[0] === demoted)).toBe(true);
    expect(gustLess.phase.kind).toBe("turn:action");
    const program = programFor("sv08-186")?.trainer;
    expect(program?.[0]).toEqual({ op: "switchActive", recordAs: "moved", recordDemoted: true });
    let scramble = stage(53, "fix-plain", ["fix-tr-nidorino", "fix-tr-meowth"]);
    scramble = attachFromDeck(scramble, "p1", "fix-psychic-energy", 2);
    const before = scramble.players.p1.active?.stack[0];
    const energy = scramble.players.p1.active?.energy ?? [];
    expect(energy).toHaveLength(2);
    const events: GameEvent[] = [];
    const first = runProgram(scramble, program ?? [], { seat: "p1" }, events);
    if (first.kind !== "parked") throw new Error("expected the switch to park");
    const second = resumeProgram(
      first.state,
      first.cont,
      { kind: "pokemon", ref: P1_BENCH(0) },
      events,
    );
    if (second.kind !== "parked" || second.prompt.kind !== "moveEnergy") {
      throw new Error("expected the Energy move to park");
    }
    expect(second.cont.record?.moved).toEqual([before]);
    expect(second.prompt.movable.map((m) => m.uid).sort()).toEqual([...energy].sort());
    expect(second.prompt.destinations).toEqual([{ seat: "p1", spot: { spot: "active" } }]);
    expect(SCRAMBLE_SWITCH).toContain("the Pokémon you moved to your Bench");
  });
});

describe("BUILT AT D331 — Lisia's Appeal sv08-179/-234/-246 (3 legal)", () => {
  it("the UNRIDDEN gust seam is untouched, and the ridden one now exists — both driven", () => {
    const state = stage(91, "fix-plain", ["fix-tr-nidorino"], ["fix-plain", "fix-stage1"]);
    const staged = inHand(state, "sv05-157");
    const { state: parked } = mustApply(staged.state, {
      type: "playTrainer",
      seat: "p1",
      uid: staged.uid,
    });
    expect(refNames(parked, choosePrompt(parked).candidates).sort()).toEqual([
      "Beartic",
      "Pikachu",
    ]);
    const gustOp = programFor("sv05-157")?.trainer?.[0];
    expect(gustOp).toEqual({ op: "gust", recordAs: "moved" });
    expect(gustOp).not.toHaveProperty("filter");
    // …and it did NOT quietly acquire the new rider.
    expect(gustOp).not.toHaveProperty("basicOnly");
    expect(programFor("sv08-179")?.trainer).toEqual([
      { op: "gust", basicOnly: true },
      { op: "applyStatus", target: "defender", status: "confused" },
    ]);
    // The rider is a NARROWING and not a `CardFilter` — the shape the flag got
    // wrong, pinned so a later widening has to argue with this line.
    expect(programFor("sv08-179")?.trainer?.[0]).not.toHaveProperty("filter");
    expect(LISIAS_APPEAL).toContain("Benched Basic Pokémon");
    expect(LISIAS_APPEAL).toContain("the new Active Pokémon is now Confused");
  });
});

describe("⏹️ FLAGGED — the seam on the ATTACK surface (4 legal printings)", () => {
  it("the anchor that reads the bare self-switch REFUSES both, and still reads the bare one", () => {
    expect(deriveAttackEffect(SELF_SWITCH)).toEqual([{ op: "switchActive" }]);
    expect(deriveAttackEffect(RETURN_CHARGE)).toEqual([
      { op: "switchActive", recordAs: "moved" },
      {
        op: "recordGate",
        slot: "moved",
        then: [
          {
            op: "attachEnergyFrom",
            source: "hand",
            energyType: "Lightning",
            toSelf: true,
            count: 2,
          },
        ],
      },
    ]);
    expect(deriveAttackEffect(RETURN_CHARGE)).not.toEqual(deriveAttackEffect(SELF_SWITCH));
    expect(deriveAttackEffect(INTERJET)).toEqual([
      { op: "switchActive", recordAs: "moved" },
      { op: "recordGate", slot: "moved", then: [{ op: "opponentSwitchOut" }] },
    ]);
    expect(deriveAttackEffect(INTERJET)).not.toEqual(deriveAttackEffect(SELF_SWITCH));
    expect(deriveAttackEffect(GOAD_N_GRAB)).toEqual([
      { op: "opponentSwitchOut", recordAs: "moved" },
      { op: "recordGate", slot: "moved", then: [{ op: "damageNewActive", amount: 160 }] },
    ]);
    expect(deriveAttackEffect(GOAD_N_GRAB)).not.toEqual([{ op: "opponentSwitchOut" }]);
    for (const id of ["sv08-068", "sv06-062", "sv07-096"]) {
      expect(programFor(id)?.attack, `${id} was half-built`).toBeUndefined();
    }
    expect(programFor("sv06.5-034")?.attack?.[0]?.[0]).toMatchObject({ op: "conditionGate" });
    expect(
      deriveAttackEffect("Switch this Pokémon with 1 of your Benched Pokémon."),
    ).not.toBeNull();
  });

  it("names each missing piece, and neither is the seam this slice built", () => {
    const goldenFlame = programFor("sv10-039")?.abilities?.[0]?.program?.[0];
    expect(goldenFlame).toMatchObject({ op: "attachEnergyFrom", count: 2 });
    expect(goldenFlame).not.toHaveProperty("toSelf");
    expect(deriveAttackEffect(RETURN_CHARGE)?.[1]).toMatchObject({
      op: "recordGate",
      then: [{ op: "attachEnergyFrom", toSelf: true }],
    });
    expect(programFor("sv02-172")?.trainer).toEqual([{ op: "gust" }]);
    expect(INTERJET).toContain("Your opponent chooses");
    const state = stage(93, "fix-plain", ["fix-tr-nidorino", "fix-tr-meowth"]);
    const staged = inHand(state, "sv08-187");
    const { state: parked } = mustApply(staged.state, {
      type: "playTrainer",
      seat: "p1",
      uid: staged.uid,
    });
    const { state: done } = mustApply(parked, pick("p1", P1_BENCH(0)));
    expect(done.allowances.supporterPlayed).toBe(true);
    expect(JSON.stringify(done.allowances)).not.toContain("sv08-187");
    expect(done.allowances.supporterPlayedUid).toBe(staged.uid);
  });
});

describe("⏹️ FLAGGED — N's Zoroark ex sv09-098/-175/-185/-189 (4 legal)", () => {
  const IDS = ["sv09-098", "sv09-175", "sv09-185", "sv09-189"] as const;

  it("built on NEITHER of these two routes ( D573: BUILT on a THIRD, `deriveAttackCopy`), and the gap was the COPY rather than the predicate", () => {
    for (const id of IDS) {
      expect(programFor(id)?.attack, `${id} grew a registry attack`).toBeUndefined();
      expect(programFor(id)?.abilities?.[0]?.name, `${id} lost its Trade Ability`).toBe("Trade");
    }
    expect(deriveAttackEffect(NIGHT_JOKER)).toBeNull();
    expect(
      deriveAttackEffect("Choose 1 of your Benched Pokémon's attacks and use it as this attack."),
    ).toBeNull();
    expect(NIGHT_JOKER).toContain("use it as this attack");
    expect(deriveAttackCopy(NIGHT_JOKER)).toEqual({ from: "benchOwner", owner: "N" });
    expect(
      deriveAttackCopy("Choose 1 of your Benched Pokémon's attacks and use it as this attack."),
    ).toBeNull();
  });
});

// ── 7. FIXTURE_POOL as a separate population, and MATCH_RECORD_VERSION ──────

describe("FIXTURE_POOL, swept as its own population", () => {
  it("holds EXACTLY D242's four owner-prefixed names, and nothing else", () => {
    const cards = Object.values(FIXTURE_POOL);
    expect(cards.length).toBeGreaterThan(300);
    const prefixed = cards.filter((card) => /^[A-Z][A-Za-z' ]*'s /.test(card.name));
    expect(prefixed.map((card) => card.id).sort()).toEqual(
      [
        "fix-powersaver",
        "fix-tr-body",
        "fix-tr-energy",
        "fix-not-tr-body",
        "fix-cynthia-aura",
        "fix-cynthia-body",
        "fix-hop-aura",
        "fix-repellingveil",
        "fix-tr-stage1",
        "fix-lillie-body",
        "fix-legacy-ex",
        "fix-ethans-cyndaquil",
        "fix-ethans-typhlosion",
        "fix-ethans-pichu",
        "fix-tr-other-energy",
        "fix-not-tr-energy",
        "fix-loveimpact",
        "fix-trnidoking",
        "fix-abruptflash",
        "fix-mistystaryu",
        "fix-inplaybodies",
        "fix-ethansadv",
        "fix-trsupporter",
        "fix-trtransceiver",
      ].sort(),
    );
  });

  it("holds exactly ONE `switchActive` carrier, and its program is unchanged", () => {
    const carriers = Object.keys(FIXTURE_POOL).filter((id) =>
      (programFor(id)?.trainer ?? []).some((op) => op.op === "switchActive"),
    );
    expect(carriers).toEqual(["sv01-194"]);
    expect(programFor("sv01-194")?.trainer).toEqual([{ op: "switchActive" }]);
  });

  it("the unmarked rider's candidate set IS the whole Bench — the play gate's own claim", () => {
    const state = stage(61, "fix-plain", ["fix-rocketeer", "fix-lowercase", "fix-iono-body"]);
    const staged = inHand(state, "sv01-194");
    const { state: parked } = mustApply(staged.state, {
      type: "playTrainer",
      seat: "p1",
      uid: staged.uid,
    });
    expect(choosePrompt(parked).candidates).toHaveLength(3);
  });
});

describe("MATCH_RECORD_VERSION — the derivation, not the habit", () => {
  it("STAYS 12, and the park question is asked rather than assumed", () => {
    expect(deriveAttackEffect(SELF_SWITCH)).toEqual([{ op: "switchActive" }]);
    const state = stage(71, "fix-plain", ["fix-tr-nidorino", "fix-plain"]);
    const staged = inHand(state, "sv01-194");
    const { state: parked } = mustApply(staged.state, {
      type: "playTrainer",
      seat: "p1",
      uid: staged.uid,
    });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected a park");
    expect(parked.phase.cont.record).toBeUndefined();
    expect(parked.phase.cont.pendingOp).toEqual({ op: "switchActive" });
    expect(parked.phase.prompt.kind).toBe("choosePokemon");
  });
});
