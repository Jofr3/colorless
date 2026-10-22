import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import type { GameAction, GameEvent, GameState, InPlayPokemon, Seat } from "./index";
import { applyAction, createGame, logFromEvents } from "./index";
import { programFor } from "./registry";
import {
  FIXTURE_POOL,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  setActiveFromDeck,
  typedEnergy,
} from "./testFixtures";

// ── CARD REVISION, BATCH B12 (Abilities) ──
//
// The verified findings from the per-unit audit (docs/reference/card-revision.md "B12"), driven on a
// real board through `applyAction` and asserted against the PRINTED text (local D1
// `cards.abilities_json`, byte for byte below):
//   §1 Infernape "Pyro Dance" (`sv06-033` / `sv06-173` / `svp-116`) — *"a Basic {R} Energy card, a
//      Basic {F} Energy card, or 1 of each"*: three printed answers, {R}, {F} and {R,F}, and no empty
//      one. The program was two MANDATORY one-card attaches, so a hand holding both types always
//      attached both (forced outright when Infernape was the only Pokémon in play). The two ops now
//      carry `atLeastOne` over one record slot: an op of the pair is declinable while another of it
//      already attached, or one later in the program can still attach.
//   §2 Magneton "Overvolt Discharge" (`sv08-059` / `svp-153` / `svp-159`) — the LAST attach onto the
//      host resolves in the same reduction as the printed self Knock Out, and the log row named the
//      host "a Pokémon" (the post-state no longer holds the Energy on any body). log.ts now names the
//      body the same batch's KNOCKED_OUT discarded the Energy with.

const PYRO_DANCE =
  "Once during your turn, you may attach a Basic {R} Energy card, a Basic {F} Energy card, or 1 of each from your hand to your Pokémon in any way you like.";
const OVERVOLT_DISCHARGE =
  "Once during your turn, you may attach up to 3 Basic Energy cards from your discard pile to your {L} Pokémon in any way you like. If you use this Ability, this Pokémon is Knocked Out.";

/** Every Standard-legal printing of each sentence on the local D1 (measured 2026-10-19). */
const INFERNAPE = ["sv06-033", "sv06-173", "svp-116"] as const;
const MAGNETON = ["sv08-059", "svp-153", "svp-159"] as const;
const FILLER = "b12-filler";
const FIRE = "b12-fire";
const FIGHTING = "b12-fighting";
const WATER = "b12-water";

const LOCAL: Record<string, Card> = {
  ...Object.fromEntries(
    INFERNAPE.map((id) => [
      id,
      battler(id, {
        name: "Infernape",
        stage: "Stage2",
        evolveFrom: "Monferno",
        types: ["Fire"],
        hp: 160,
        retreat: 2,
        abilities: [{ type: "Ability", name: "Pyro Dance", effect: PYRO_DANCE }],
        attacks: [{ cost: ["Fire", "Colorless"], name: "Burning Kick", damage: 120 }],
      }),
    ]),
  ),
  ...Object.fromEntries(
    MAGNETON.map((id) => [
      id,
      battler(id, {
        name: "Magneton",
        stage: "Stage1",
        evolveFrom: "Magnemite",
        types: ["Lightning"],
        hp: 90,
        retreat: 2,
        abilities: [{ type: "Ability", name: "Overvolt Discharge", effect: OVERVOLT_DISCHARGE }],
        attacks: [{ cost: ["Lightning", "Colorless"], name: "Head Bolt", damage: 50 }],
      }),
    ]),
  ),
  [FILLER]: battler(FILLER, {
    name: "B12 Filler",
    hp: 200,
    types: ["Colorless"],
    retreat: 1,
    attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
  }),
  [FIRE]: typedEnergy(FIRE, "Fire"),
  [FIGHTING]: typedEnergy(FIGHTING, "Fighting"),
  [WATER]: typedEnergy(WATER, "Water"),
};
const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL };

const DECK = deckOf({
  ...Object.fromEntries(INFERNAPE.map((id) => [id, 1])),
  ...Object.fromEntries(MAGNETON.map((id) => [id, 1])),
  [FILLER]: 14,
  [FIRE]: 6,
  [FIGHTING]: 6,
  [WATER]: 6,
  "fix-energy": 22, // 60 cards
});

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

function run(state: GameState, action: GameAction): { state: GameState; events: GameEvent[] } {
  const result = applyAction(state, action);
  if (!result.ok) throw new Error(`${action.type} rejected: ${result.error.code}: ${result.error.message}`);
  return { state: result.state, events: [...result.events] };
}

/** Setup with P1 first, then P1's SECOND turn (turn 3). Hands, prizes and discards back into the
    deck; six `fix-energy` make each prize row. */
function p1Turn(): GameState {
  const created = createGame({ seed: 1212, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first: "p1" }));
  while (state.phase.kind === "setup:drawExtra") {
    const phase = state.phase;
    const s = (["p1", "p2"] as const).find((x) => !phase.decided[x]);
    if (s === undefined) throw new Error("setup:drawExtra with every seat decided");
    state = must(applyAction(state, { type: "setupDrawExtra", seat: s, count: phase.owed[s] }));
  }
  for (const s of ["p1", "p2"] as const) {
    const uid = state.players[s].hand.find((h) => POOL[state.cardIdByUid[h] ?? ""]?.stage === "Basic");
    if (uid === undefined) throw new Error(`no Basic in ${s}'s hand`);
    state = must(applyAction(state, { type: "setupPlaceActive", seat: s, uid }));
  }
  for (const s of ["p1", "p2"] as const) state = must(applyAction(state, { type: "setupReady", seat: s }));
  state = must(applyAction(state, { type: "endTurn", seat: "p1" }));
  state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
  if (state.turn !== 3) throw new Error(`expected turn 3, got ${state.turn}`);
  for (const s of ["p1", "p2"] as const) {
    const side = state.players[s];
    const pile = [...side.deck, ...side.hand, ...side.prizes, ...side.discard];
    const prizes = pile.filter((u) => state.cardIdByUid[u] === "fix-energy").slice(0, 6);
    state = {
      ...state,
      players: {
        ...state.players,
        [s]: { ...side, hand: [], discard: [], prizes, deck: pile.filter((u) => !prizes.includes(u)) },
      },
    };
  }
  return state;
}

/** TEST SURGERY — deck copies of each id move to p1's `zone`. */
function give(state: GameState, zone: "hand" | "discard", ids: readonly string[]): GameState {
  let side = state.players.p1;
  const moved: string[] = [];
  for (const id of ids) {
    const uid = side.deck.find((u) => state.cardIdByUid[u] === id && !moved.includes(u));
    if (uid === undefined) throw new Error(`no ${id} in p1's deck`);
    moved.push(uid);
  }
  side = { ...side, deck: side.deck.filter((u) => !moved.includes(u)), [zone]: [...side[zone], ...moved] };
  return { ...state, players: { ...state.players, p1: side } };
}

/** P1: Active `active`, Bench [Filler] unless `alone`, `hand` in hand and `discard` in the discard
    pile. P2: Active Filler, Bench [Filler]. */
function board(
  active: string,
  opts: { alone?: boolean; hand?: readonly string[]; discard?: readonly string[] } = {},
): GameState {
  let state = clearBench(setActiveFromDeck(p1Turn(), "p1", active), "p1");
  if (opts.alone !== true) state = benchFromDeck(state, "p1", FILLER);
  state = clearBench(setActiveFromDeck(state, "p2", FILLER), "p2");
  state = benchFromDeck(state, "p2", FILLER);
  state = give(state, "hand", opts.hand ?? []);
  return give(state, "discard", opts.discard ?? []);
}

const ACTIVE = { seat: "p1" as Seat, spot: { spot: "active" as const } };
const BENCH0 = { seat: "p1" as Seat, spot: { spot: "bench" as const, index: 0 } };

const use = (name: string): GameAction =>
  ({ type: "useAbility", seat: "p1", target: { spot: "active" }, abilityName: name }) as GameAction;
const pick = (ref: typeof ACTIVE | typeof BENCH0): GameAction =>
  ({ type: "resolveEffect", seat: "p1", choice: { kind: "pokemon", ref } }) as GameAction;
const DECLINE = { type: "resolveEffect", seat: "p1", choice: { kind: "pokemon" } } as GameAction;

function body(state: GameState, ref: typeof ACTIVE | typeof BENCH0): InPlayPokemon {
  const side = state.players[ref.seat];
  const found = ref.spot.spot === "active" ? side.active : side.bench[ref.spot.index];
  if (found === null || found === undefined) throw new Error("no body");
  return found;
}
const energyNames = (state: GameState, ref: typeof ACTIVE | typeof BENCH0): string[] =>
  body(state, ref).energy.map((u) => POOL[state.cardIdByUid[u] ?? ""]?.name ?? "?");
const handNames = (state: GameState): string[] =>
  state.players.p1.hand.map((u) => POOL[state.cardIdByUid[u] ?? ""]?.name ?? "?").sort();

describe("B12 §1 — Infernape 'Pyro Dance': {R}, {F} or 1 of each, and never nothing", () => {
  it("every printing resolves to the one program, two Pyro Dance attaches over the hand", () => {
    const program = programFor(INFERNAPE[0])?.abilities?.[0]?.program;
    expect(program).toBeDefined();
    for (const id of INFERNAPE) expect(programFor(id)?.abilities?.[0]?.program, id).toBe(program);
    expect(program?.map((op) => (op.op === "attachEnergyFrom" ? [op.source, op.energyType] : op.op))).toEqual([
      ["hand", "Fire"],
      ["hand", "Fighting"],
    ]);
  });

  for (const id of INFERNAPE) {
    it(`${id}: hand {R}{F} — the {R} alone is reachable (take {R}, decline {F})`, () => {
      let state = run(board(id, { hand: [FIRE, FIGHTING] }), use("Pyro Dance")).state;
      expect(state.phase.kind).toBe("effect:choose");
      state = run(state, pick(ACTIVE)).state;
      expect(state.phase.kind).toBe("effect:choose");
      state = run(state, DECLINE).state;
      expect(state.phase.kind).toBe("turn:action");
      expect(energyNames(state, ACTIVE)).toEqual(["Fire Energy"]);
      expect(energyNames(state, BENCH0)).toEqual([]);
      expect(handNames(state)).toEqual(["Fighting Energy"]);
    });

    it(`${id}: hand {R}{F} — the {F} alone is reachable (decline {R}, take {F})`, () => {
      let state = run(board(id, { hand: [FIRE, FIGHTING] }), use("Pyro Dance")).state;
      state = run(state, DECLINE).state;
      expect(state.phase.kind).toBe("effect:choose");
      state = run(state, pick(BENCH0)).state;
      expect(state.phase.kind).toBe("turn:action");
      expect(energyNames(state, ACTIVE)).toEqual([]);
      expect(energyNames(state, BENCH0)).toEqual(["Fighting Energy"]);
      expect(handNames(state)).toEqual(["Fire Energy"]);
    });
  }

  it("hand {R}{F} — 1 of each, onto two bodies, still lands", () => {
    let state = run(board(INFERNAPE[0], { hand: [FIRE, FIGHTING] }), use("Pyro Dance")).state;
    state = run(state, pick(BENCH0)).state;
    state = run(state, pick(ACTIVE)).state;
    expect(state.phase.kind).toBe("turn:action");
    expect(energyNames(state, BENCH0)).toEqual(["Fire Energy"]);
    expect(energyNames(state, ACTIVE)).toEqual(["Fighting Energy"]);
    expect(state.players.p1.hand).toEqual([]);
  });

  it("🛑 the EMPTY answer is not printed: declining {R} makes the {F} mandatory", () => {
    let state = run(board(INFERNAPE[0], { hand: [FIRE, FIGHTING] }), use("Pyro Dance")).state;
    state = run(state, DECLINE).state;
    const refused = applyAction(state, DECLINE);
    expect(refused.ok).toBe(false);
    if (refused.ok) throw new Error("the second decline was accepted");
    expect(refused.error.code).toBe("BAD_EFFECT_CHOICE");
  });

  it("Infernape the ONLY Pokémon, hand {R}{F}: the choice is asked, not forced, and {R} alone lands", () => {
    const used = run(board(INFERNAPE[1], { alone: true, hand: [FIRE, FIGHTING] }), use("Pyro Dance"));
    expect(used.state.phase.kind).toBe("effect:choose");
    expect(used.events.filter((e) => e.type === "ENERGY_ATTACHED")).toEqual([]);
    let state = run(used.state, pick(ACTIVE)).state;
    expect(state.phase.kind).toBe("effect:choose");
    state = run(state, DECLINE).state;
    expect(state.phase.kind).toBe("turn:action");
    expect(energyNames(state, ACTIVE)).toEqual(["Fire Energy"]);
    expect(handNames(state)).toEqual(["Fighting Energy"]);
  });

  it("Infernape the ONLY Pokémon, hand {R}{F}: decline {R}, and the lone {F} target is forced", () => {
    let state = run(board(INFERNAPE[2], { alone: true, hand: [FIRE, FIGHTING] }), use("Pyro Dance")).state;
    state = run(state, DECLINE).state;
    expect(state.phase.kind).toBe("turn:action");
    expect(energyNames(state, ACTIVE)).toEqual(["Fighting Energy"]);
    expect(handNames(state)).toEqual(["Fire Energy"]);
  });

  it("CONTROL — hand {R} only: the one printed answer is {R}, so its pick cannot be declined", () => {
    const state = run(board(INFERNAPE[0], { hand: [FIRE, WATER] }), use("Pyro Dance")).state;
    expect(state.phase.kind).toBe("effect:choose");
    const refused = applyAction(state, DECLINE);
    expect(refused.ok).toBe(false);
    const done = run(state, pick(BENCH0)).state;
    expect(done.phase.kind).toBe("turn:action");
    expect(energyNames(done, BENCH0)).toEqual(["Fire Energy"]);
  });

  it("CONTROL — hand {F} only: the {R} half is a silent no-op and the {F} pick cannot be declined", () => {
    const state = run(board(INFERNAPE[0], { hand: [FIGHTING] }), use("Pyro Dance")).state;
    expect(state.phase.kind).toBe("effect:choose");
    expect(applyAction(state, DECLINE).ok).toBe(false);
    const done = run(state, pick(ACTIVE)).state;
    expect(energyNames(done, ACTIVE)).toEqual(["Fighting Energy"]);
  });

  it("CONTROL — hand {R} only with Infernape alone: still attached with no question", () => {
    const used = run(board(INFERNAPE[0], { alone: true, hand: [FIRE] }), use("Pyro Dance"));
    expect(used.state.phase.kind).toBe("turn:action");
    expect(energyNames(used.state, ACTIVE)).toEqual(["Fire Energy"]);
  });
});

function rows(events: readonly GameEvent[], state: GameState): string[] {
  return logFromEvents(events, { names: { p1: "P1", p2: "P2" }, state, elapsed: "+00:00" }).flatMap((entry) =>
    entry.kind === "action" ? [entry.segments.map((s) => s.text).join("")] : [],
  );
}

/** Answer Overvolt Discharge's parks: the target is always the Active Magneton, and the card
    question (an unlike pile) takes the next of `order` by name. Returns every log line written. */
function discharge(state: GameState, order: readonly string[]): { state: GameState; lines: string[] } {
  let step = run(state, use("Overvolt Discharge"));
  const lines: string[] = [];
  let next = 0;
  for (let i = 0; i < 12 && step.state.phase.kind === "effect:choose"; i++) {
    const prompt = step.state.phase.prompt;
    if (prompt.kind === "choosePokemon") {
      step = run(step.state, pick(ACTIVE));
    } else if (prompt.kind === "chooseCards") {
      const wanted = order[next];
      next += 1;
      const uid = prompt.candidates.find((u) => POOL[step.state.cardIdByUid[u] ?? ""]?.name === wanted);
      if (uid === undefined) throw new Error(`no ${wanted} offered`);
      step = run(step.state, { type: "resolveEffect", seat: "p1", choice: { kind: "cards", uids: [uid] } } as GameAction);
    } else {
      throw new Error(`unexpected prompt ${prompt.kind}`);
    }
    lines.push(...rows(step.events, step.state));
  }
  return { state: step.state, lines };
}

describe("B12 §2 — Magneton 'Overvolt Discharge': every attach row names the host", () => {
  for (const id of MAGNETON) {
    it(`${id}: three attaches onto Magneton, the last in the self-KO's reduction, all read '→ Magneton'`, () => {
      const order = ["Fire Energy", "Fighting Energy", "Water Energy"];
      const { state, lines } = discharge(board(id, { discard: [FIRE, FIGHTING, WATER] }), order);
      expect(state.phase.kind).not.toBe("effect:choose");
      const attached = lines.filter((line) => line.startsWith("attached "));
      expect(attached).toEqual(order.map((name) => `attached ${name} → Magneton`));
      expect(lines).toContain("Magneton was Knocked Out");
    });
  }
});
