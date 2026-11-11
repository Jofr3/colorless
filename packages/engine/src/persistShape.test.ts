import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import type { EffectChoice, EffectPrompt } from "./effectPrompt";
import type { EffectOp } from "./effectTypes";
import { settleProgram } from "./flow";
import { type GameEvent, type GameState, type Seat, applyAction, createGame } from "./index";
import { runProgram } from "./interpreter";
import { GAME_STATE_VERSION } from "./persist";
import {
  attachBenchFromDeck,
  attachFromDeck,
  attachToolFromDeck,
  benchFromDeck,
  completeSetup,
  drbgSeed,
  ensureInDeck,
  roundTrip,
  setDamage,
} from "./testFixtures";
import { clearedAttackEffects, clearedSideInstalls, freshAllowances, makeInPlay } from "./types";

// A persisted state is read back as-is only when its version matches, so any change to its shape
// must come with a version bump. This pins a key-and-type skeleton of that shape, together with the
// version it was taken at, in `persistShape.snap`. A fresh game holds every install field empty and
// no parked op, so the skeleton also takes fixed samples: a body and a side with every install
// field set by the op that installs it, and one program parked on each prompt kind, some after a
// first answer. A new field inside an install record or a parked op then
// changes the skeleton too.

const STALE = `the persisted state shape or GAME_STATE_VERSION no longer matches persistShape.snap. A shape change needs a version bump in persist.ts (with a migration step if old states can be carried forward); then rewrite the snapshot with "bunx vitest run packages/engine/src/persistShape.test.ts -u"`;

/** Maps keyed by uid or card id: their keys vary with the decks, only their values have a shape. */
const KEYED_BY_ID = new Set(["cardIdByUid", "cardPool"]);

function uniqueShapes(values: readonly unknown[]): unknown[] {
  const byText = new Map(values.map((value) => [JSON.stringify(value), value]));
  return [...byText.keys()].sort().map((text) => byText.get(text));
}

/** Sorted keys and `typeof` leaves; array elements and id-keyed map values merged to their distinct shapes. */
function skeleton(value: unknown): unknown {
  if (value === null) return "null";
  if (Array.isArray(value)) return uniqueShapes(value.map(skeleton));
  if (typeof value !== "object") return typeof value;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    const entry = (value as Record<string, unknown>)[key];
    out[key] =
      KEYED_BY_ID.has(key) && entry !== null && typeof entry === "object"
        ? { "<id>": uniqueShapes(Object.values(entry).map(skeleton)) }
        : skeleton(entry);
  }
  return out;
}

function basicCard(id: string): Card {
  return {
    id,
    setId: "test",
    localId: "1",
    name: id,
    category: "Pokemon",
    image: null,
    illustrator: null,
    rarity: null,
    regulationMark: null,
    hp: 60,
    stage: "Basic",
    evolveFrom: null,
    types: ["Colorless"],
    retreat: 1,
    abilities: null,
    attacks: null,
    weaknesses: null,
    resistances: null,
    trainerType: null,
    energyType: null,
    effect: null,
    legal: { standard: true, expanded: true },
    variants: null,
  };
}

/** The samples' Pokémon: two attacks, so an attack can be barred by name or by choice. */
function attackerCard(): Card {
  return {
    ...basicCard("mon"),
    hp: 120,
    attacks: [
      { name: "Tackle", cost: ["Colorless"], damage: 10 },
      { name: "Slam", cost: ["Colorless", "Colorless"], damage: 30 },
    ],
  };
}

function energyCard(id: string, name: string): Card {
  return {
    ...basicCard(id),
    name,
    category: "Energy",
    hp: null,
    stage: null,
    types: null,
    retreat: null,
    energyType: "Normal",
  };
}

/** p1's first turn with three benched Pokémon a side, Energy on each Active and first Bench
    body, damage and a Tool on each Active, and two kinds of Energy in p1's hand. */
function sampleBoard(): GameState {
  const deck = [
    ...Array<string>(38).fill("mon"),
    ...Array<string>(10).fill("energy"),
    ...Array<string>(10).fill("fire"),
    ...Array<string>(2).fill("tool"),
  ];
  const started = createGame({
    seed: drbgSeed(3),
    decks: { p1: [...deck], p2: [...deck] },
    cardPool: {
      mon: attackerCard(),
      energy: energyCard("energy", "Colorless Energy"),
      fire: energyCard("fire", "Fire Energy"),
      tool: { ...basicCard("tool"), category: "Trainer", trainerType: "Tool", stage: null },
    },
  });
  if (!started.ok) throw new Error(started.error.message);
  let state = completeSetup(started.state, { first: "p1" });
  for (const seat of ["p1", "p2"] as const) {
    while (state.players[seat].bench.length < 3) state = benchFromDeck(state, seat, "mon");
    state = attachFromDeck(state, seat, "energy", 2);
    state = attachBenchFromDeck(state, seat, 0, "energy", 1);
    state = setDamage(state, seat, 30);
    state = attachToolFromDeck(ensureInDeck(state, seat, "tool"), seat, "active", "tool");
  }
  return state;
}

/** `ops` run as p1's attack and settled. */
function ran(state: GameState, ops: readonly EffectOp[]): GameState {
  const events: GameEvent[] = [];
  const sourceUid = state.players.p1.active?.stack[0];
  const ctx = { seat: "p1" as Seat, sourceUid, invokedBy: "attack" as const, dealt: 30 };
  const settled = settleProgram(runProgram(state, ops, ctx, {}, events), "p1", {}, events);
  if (!settled.ok) throw new Error(settled.error.message);
  return settled.state;
}

/** One op per install field (on p1's Active, p2's Active or either side). */
const INSTALL_OPS: readonly EffectOp[] = [
  { op: "preventRetreat" },
  { op: "preventRetreat", target: "self" },
  { op: "preventDamage", maxDamage: 60 },
  { op: "preventAttack" },
  { op: "preventAttack", target: "defender" },
  { op: "flipLockAttack" },
  { op: "flipLockAttack", coins: 2 },
  { op: "reduceDamage", amount: 30 },
  { op: "installNoWeakness" },
  { op: "scheduleCounters", amount: 30 },
  { op: "weakenDefenderAttacks", amount: 30 },
  { op: "exposeDefender", amount: 30 },
  { op: "retypeDefenderWeakness", type: "Fire" },
  { op: "taxDefender" },
  { op: "bountyDefender", amount: 1 },
  { op: "markHandAttach", counters: 2 },
  { op: "installRecoil", amount: 30 },
  { op: "preventAttackUse", attack: "Tackle" },
  { op: "boostAttack", attack: null, amount: 30 },
  { op: "lockSideAttacks", whose: "opponent", maxEnergy: null },
  { op: "installSideDamageReductionNextTurn", amount: 30 },
  { op: "installSideAttackBlock", banner: "Future", fromClass: { stage: "basic" } },
  { op: "lockSideRetreat", status: "poisoned" },
  { op: "flipLockTrainerPlay" },
];

const isCleared = (value: unknown, cleared: unknown) =>
  JSON.stringify(value) === JSON.stringify(cleared);

/** Each key of `cleared` with the value whichever of `sources` holds set, else the cleared one. */
function setFields<T extends object>(cleared: T, sources: readonly object[]): T {
  const out: Record<string, unknown> = {};
  for (const [key, empty] of Object.entries(cleared)) {
    const set = sources.find((source) => !isCleared(Reflect.get(source, key), empty));
    out[key] = set === undefined ? empty : Reflect.get(set, key);
  }
  return out as T;
}

/** A body and a side with every install field as the engine installs it. */
function installed() {
  const state = ran(sampleBoard(), INSTALL_OPS);
  const shielded = mustAnswer(
    ran(state, [{ op: "installChosenAttackShield", fromClass: { stage: "ex" } }]),
    (prompt) =>
      prompt.kind === "choosePokemon" ? { kind: "pokemon", ref: prompt.candidates[0] } : null,
  );
  const { p1, p2 } = shielded.players;
  const bodies = [p1.active, p2.active].filter((body) => body !== null);
  return {
    body: setFields(clearedAttackEffects(), bodies),
    side: setFields(clearedSideInstalls(), [p1, p2]),
  };
}

/** `state` after its parked prompt is answered with what `answer` picks. */
function mustAnswer(
  state: GameState,
  answer: (prompt: EffectPrompt) => EffectChoice | null,
): GameState {
  if (state.phase.kind !== "effect:choose") throw new Error("the program did not park");
  const choice = answer(state.phase.prompt);
  if (choice === null) throw new Error(`no answer to a ${state.phase.prompt.kind} prompt`);
  const seat = state.phase.answerer ?? state.phase.seat;
  const result = applyAction(state, { type: "resolveEffect", seat, choice });
  if (!result.ok) throw new Error(result.error.message);
  return result.state;
}

/** Every prompt kind, so a new one fails to compile until it is sampled. */
const PROMPT_KINDS: Record<EffectPrompt["kind"], true> = {
  chooseCards: true,
  choosePokemon: true,
  choosePokemonMulti: true,
  moveEnergy: true,
  discardEnergy: true,
  discardTools: true,
  attachCards: true,
  mayDraw: true,
  guessHp: true,
  chooseAttack: true,
  choosePrize: true,
  confirm: true,
  orderCards: true,
};

/** One program parked on each prompt kind but confirm, which is `parkedGame`'s. Keyed by prompt
    kind and parked op. */
function parkedByPrompt(): Record<string, unknown> {
  const board = sampleBoard();
  const parks = [
    ran(board, [
      { op: "searchDeck", filter: { kind: "anyPokemon" }, dest: "hand", max: 1 },
      { op: "shuffleDeck" },
    ]),
    ran(board, [{ op: "switchActive" }]),
    ran(board, [
      { op: "damageChosen", target: "opponentBench", amount: 10, count: 2, source: "attack" },
    ]),
    ran(board, [{ op: "moveEnergy", filter: { kind: "anyEnergy" }, max: 1 }]),
    ran(board, [{ op: "discardEnergy", from: "yours", filter: { kind: "anyEnergy" } }]),
    ran(board, [
      { op: "attachFromDeck", filter: { kind: "basicEnergy" }, max: 2 },
      { op: "shuffleDeck" },
    ]),
    ran(board, [{ op: "opponentMayDraw", count: 1 }]),
    ran(board, [{ op: "preventChosenAttack" }]),
    ran(board, [{ op: "reorderTop", n: 3 }]),
    ran(board, [{ op: "turnPrizeFaceUp" }]),
    ran(board, [{ op: "discardTools", count: 1 }]),
    // Tyme parks twice: the card to show, then the opponent's guess.
    mustAnswer(ran(board, [{ op: "opponentGuessesHp", draw: 1 }]), (prompt) =>
      prompt.kind === "chooseCards" ? { kind: "cards", uids: prompt.candidates.slice(0, 1) } : null,
    ),
    // A hand attach parks on the target, then on the card with the chosen target recorded.
    mustAnswer(ran(board, [{ op: "attachEnergyFrom", source: "hand" }]), (prompt) =>
      prompt.kind === "choosePokemon" ? { kind: "pokemon", ref: prompt.candidates[0] } : null,
    ),
  ];
  const out: Record<string, unknown> = {};
  for (const state of parks) {
    if (state.phase.kind !== "effect:choose")
      throw new Error(`sample ${parks.indexOf(state)} did not park: ${state.phase.kind}`);
    const op = (state.phase.cont as { pendingOp?: { op?: unknown } }).pendingOp?.op;
    out[`${state.phase.prompt.kind} (${String(op)})`] = state.phase;
  }
  return out;
}

function freshGame(): GameState {
  const deck = Array.from({ length: 60 }, () => "basic");
  const started = createGame({
    seed: drbgSeed(3),
    decks: { p1: [...deck], p2: [...deck] },
    cardPool: { basic: basicCard("basic") },
  });
  if (!started.ok) throw new Error(started.error.message);
  return started.state;
}

/** A program parked mid-way, with a recorded slot and ops still queued behind the question. */
function parkedGame(inTurn: GameState): GameState {
  const events: GameEvent[] = [];
  const run = runProgram(
    inTurn,
    [
      { op: "drawCards", count: 1, recordAs: "moved" },
      { op: "optional", note: "You may draw a card.", ops: [{ op: "drawCards", count: 1 }] },
      { op: "shuffleDeck" },
    ],
    { seat: "p1" },
    {},
    events,
  );
  const settled = settleProgram(run, "p1", {}, events);
  if (!settled.ok) throw new Error(settled.error.message);
  return settled.state;
}

function persistedParkKind(): string {
  const parked = parkedGame(completeSetup(freshGame())).phase;
  return parked.kind === "effect:choose" ? parked.prompt.kind : parked.kind;
}

function persistedShape(): unknown {
  const game = freshGame();
  const inTurn = completeSetup(game);
  const parked = parkedGame(inTurn);
  if (parked.phase.kind !== "effect:choose") throw new Error("the program did not park");
  const installs = installed();
  // As stored: an absent optional field is dropped, not kept as `undefined`.
  return skeleton(
    roundTrip({
      game,
      side: inTurn.players.p1,
      inPlay: makeInPlay("uid", 1),
      allowances: freshAllowances(),
      parked: parked.phase,
      installedBody: installs.body,
      installedSide: installs.side,
      parkedByPrompt: parkedByPrompt(),
    }),
  );
}

describe("the persisted shape is pinned to GAME_STATE_VERSION", () => {
  it("matches the snapshot taken at this version", async () => {
    const pinned = JSON.stringify(
      { version: GAME_STATE_VERSION, shape: persistedShape() },
      null,
      2,
    );
    await expect(`${pinned}\n`, STALE).toMatchFileSnapshot("./persistShape.snap");
  });

  it("samples every install field set", () => {
    // A new install field needs an op in INSTALL_OPS, or its record's keys go unpinned.
    const { body, side } = installed();
    const unset = [
      ...Object.entries(clearedAttackEffects()).filter(([k, v]) =>
        isCleared(Reflect.get(body, k), v),
      ),
      ...Object.entries(clearedSideInstalls()).filter(([k, v]) =>
        isCleared(Reflect.get(side, k), v),
      ),
    ].map(([key]) => key);
    expect(unset).toEqual([]);
  });

  it("samples a park on every prompt kind", () => {
    const sampled = new Set(Object.keys(parkedByPrompt()).map((key) => key.split(" ")[0]));
    sampled.add(persistedParkKind());
    expect([...sampled].sort()).toEqual(Object.keys(PROMPT_KINDS).sort());
  });

  it("the skeleton sees a renamed key, a changed leaf type and a new array element shape", () => {
    expect(skeleton({ b: 1, a: [null, "x", "y"] })).toEqual({ a: ["null", "string"], b: "number" });
    expect(skeleton({ a: 1 })).not.toEqual(skeleton({ b: 1 }));
    expect(skeleton({ a: 1 })).not.toEqual(skeleton({ a: "1" }));
    expect(skeleton({ a: [{ x: 1 }] })).not.toEqual(skeleton({ a: [{ x: 1 }, { x: 1, y: 2 }] }));
    expect(skeleton({ cardIdByUid: { "p1-1": "a", "p2-9": "b" } })).toEqual({
      cardIdByUid: { "<id>": ["string"] },
    });
  });
});
