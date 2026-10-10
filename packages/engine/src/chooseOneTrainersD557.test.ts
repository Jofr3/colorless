import type { Card } from "@luminous/schema";
import { redactedEffectPromptSchema } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import type { CardFilter, EffectOp } from "./effects";
import type { GameEvent } from "./events";
import { applyAction, createGame, engineVersion, redactGame } from "./index";
import type { GameState, InPlayPokemon, Seat } from "./index";
import { runProgram } from "./interpreter";
import { type LogContext, formatElapsed, logFromEvents } from "./log";
import { programFor } from "./registry";
import { flipCoin } from "./rng";
import {
  FIXTURE_POOL,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  firstBasicInHand,
  must,
  mustApply,
  setActiveFromDeck,
  setDamage,
  trainerCard,
  types,
} from "./testFixtures";

// ── 🆕🆕🆕 D557 A — KIERAN'S PRINTED "Choose 1:" AND TEAM ROCKET'S VENTURE BOMB ──
//
//   Kieran                      sv06-154 / -206 / -218, sv08.5-113 / -174  Supporter (5 legal)
//   "Choose 1: • Switch your Active Pokémon with 1 of your Benched Pokémon. • During
//    this turn, attacks used by your Pokémon do 30 more damage to your opponent's
//    Active Pokémon ex and Active Pokémon V (before applying Weakness and Resistance)."
//   Team Rocket's Venture Bomb  sv10-179                                    Item (1 legal)
//   "Flip a coin. If heads, put 2 damage counters on 1 of your opponent's Pokémon. If
//    tails, put 2 damage counters on your Active Pokémon."
//
// Kieran is the `optional` gate with the new `labels` rider (the dialog's two button
// captions) over D556's `boostSideAttacksThisTurn`; Venture Bomb is a two-armed
// `coinFlipGate` whose placements carry the new `"trainer"` provenance. Real ids on a
// LOCAL `cardPool` (D275) in their OWN 60-card deck (D270). `MATCH_RECORD_VERSION`
// HOLDS at 35 — driven in §8, not asserted. docs/decisions.md D557.

const KIERAN = ["sv06-154", "sv06-206", "sv06-218", "sv08.5-113", "sv08.5-174"] as const;
const VENTURE = "sv10-179";
const BLACK_BELT = "sv08.5-096";

const KIERAN_TEXT =
  "Choose 1: • Switch your Active Pokémon with 1 of your Benched Pokémon. • During this turn, attacks used by your Pokémon do 30 more damage to your opponent's Active Pokémon ex and Active Pokémon V (before applying Weakness and Resistance).";
const VENTURE_TEXT =
  "Flip a coin. If heads, put 2 damage counters on 1 of your opponent's Pokémon. If tails, put 2 damage counters on your Active Pokémon.";
const LABELS = { yes: "Switch your Active Pokémon", no: "+30 damage to ex and V this turn" } as const;
const EX_OR_V: CardFilter = {
  kind: "anyOf",
  filters: [
    { kind: "suffixPokemon", suffix: "ex" },
    { kind: "suffixPokemon", suffix: "V" },
  ],
};
const KIERAN_BONUS = 30;

const STRIKE = 0; // {C}, 50
const PICK_OFF = 1; // {C}, a chosen 30 onto any of the opponent's Pokémon

const LOCAL_CARDS: Record<string, Card> = {
  ...Object.fromEntries(
    KIERAN.map((id) => [id, { ...trainerCard(id, "Supporter", KIERAN_TEXT), name: "Kieran" }]),
  ),
  [VENTURE]: { ...trainerCard(VENTURE, "Item", VENTURE_TEXT), name: "Team Rocket's Venture Bomb" },
  "d557-striker": battler("d557-striker", {
    name: "D557 Striker",
    types: ["Colorless"],
    hp: 300,
    retreat: 0,
    attacks: [
      { cost: ["Colorless"], name: "Strike", damage: 50 },
      {
        cost: ["Colorless"],
        name: "Pick Off",
        effect:
          "This attack does 30 damage to 1 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      },
    ] as Card["attacks"],
  }),
  "d557-relief": battler("d557-relief", { name: "D557 Relief", types: ["Colorless"], hp: 300, retreat: 0 }),
  "d557-relief-2": battler("d557-relief-2", { name: "D557 Relief Two", types: ["Colorless"], hp: 300, retreat: 0 }),
  "d557-wall-ex": battler("d557-wall-ex", { name: "D557 Wall ex", types: ["Fighting"], hp: 900, retreat: 1 }),
  "d557-wall-v": battler("d557-wall-v", { name: "D557 Wall V", types: ["Fighting"], hp: 900, retreat: 1 }),
  "d557-wall-vmax": battler("d557-wall-vmax", { name: "D557 Wall VMAX", types: ["Fighting"], hp: 900, retreat: 1 }),
  "d557-wall-vstar": battler("d557-wall-vstar", { name: "D557 Wall VSTAR", types: ["Fighting"], hp: 900, retreat: 1 }),
  "d557-wall": battler("d557-wall", { name: "D557 Wall", types: ["Fighting"], hp: 900, retreat: 1 }),
  "d557-weak-ex": battler("d557-weak-ex", {
    name: "D557 Weak ex",
    types: ["Fighting"],
    hp: 900,
    retreat: 1,
    weaknesses: [{ type: "Colorless", value: "×2" }],
  }),
  "d557-bench": battler("d557-bench", { name: "D557 Bench", types: ["Fighting"], hp: 300, retreat: 1 }),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

/** Its OWN deck (D270), 60 by construction. */
const DECK = deckOf({
  [KIERAN[0]]: 4,
  ...Object.fromEntries(KIERAN.slice(1).map((id) => [id, 1])),
  [VENTURE]: 4,
  "d557-striker": 4,
  "d557-relief": 2,
  "d557-relief-2": 2,
  "d557-wall-ex": 3,
  "d557-wall-v": 2,
  "d557-wall-vmax": 1,
  "d557-wall-vstar": 1,
  "d557-wall": 2,
  "d557-weak-ex": 2,
  "d557-bench": 4,
  "fix-unnerve": 2,
  "fix-energy": 23,
});

const NAMES: Record<Seat, string> = { p1: "Ember", p2: "Tide" };
const SEED = 20260926;

function find<T extends GameEvent["type"]>(
  events: readonly GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

function all<T extends GameEvent["type"]>(
  events: readonly GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

function body(pokemon: InPlayPokemon | null | undefined): InPlayPokemon {
  if (pokemon === null || pokemon === undefined) throw new Error("expected a Pokémon");
  return pokemon;
}

function localSetup(seed: number): GameState {
  const created = createGame({ seed, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first: "p1" }));
  while (state.phase.kind === "setup:drawExtra") {
    const phase = state.phase;
    const seat = (["p1", "p2"] as const).find((s) => !phase.decided[s]);
    if (seat === undefined) throw new Error("setup:drawExtra with every seat decided");
    state = must(applyAction(state, { type: "setupDrawExtra", seat, count: phase.owed[seat] }));
  }
  for (const seat of ["p1", "p2"] as const) {
    state = must(applyAction(state, { type: "setupPlaceActive", seat, uid: firstBasicInHand(state, seat) }));
  }
  for (const seat of ["p1", "p2"] as const) state = must(applyAction(state, { type: "setupReady", seat }));
  return state;
}

/** TEST SURGERY — one copy of `id` into `seat`'s DECK (back from the hand, or swapped
    out of the Prizes for the deck's bottom card). Every uid stays in exactly one zone. */
function ensureInDeck(state: GameState, seat: Seat, id: string): GameState {
  const side = state.players[seat];
  if (side.deck.some((u) => state.cardIdByUid[u] === id)) return state;
  const inHand = side.hand.find((u) => state.cardIdByUid[u] === id);
  if (inHand !== undefined) {
    const next = { ...side, hand: side.hand.filter((u) => u !== inHand), deck: [...side.deck, inHand] };
    return { ...state, players: { ...state.players, [seat]: next } };
  }
  const prized = side.prizes.find((u) => state.cardIdByUid[u] === id);
  const swap = side.deck[side.deck.length - 1];
  if (prized === undefined || swap === undefined) throw new Error(`${seat} has no more ${id}`);
  const next = {
    ...side,
    deck: [...side.deck.slice(0, -1), prized],
    prizes: side.prizes.map((u) => (u === prized ? swap : u)),
  };
  return { ...state, players: { ...state.players, [seat]: next } };
}

/** TEST SURGERY — one copy of `id` moved into `seat`'s hand. */
function pullToHand(state: GameState, seat: Seat, id: string): GameState {
  const ensured = ensureInDeck(state, seat, id);
  const side = ensured.players[seat];
  const uid = side.deck.find((u) => ensured.cardIdByUid[u] === id) as string;
  return {
    ...ensured,
    players: {
      ...ensured.players,
      [seat]: { ...side, deck: side.deck.filter((u) => u !== uid), hand: [...side.hand, uid] },
    },
  };
}

const activeFrom = (state: GameState, seat: Seat, id: string) =>
  setActiveFromDeck(ensureInDeck(state, seat, id), seat, id);
const benchFrom = (state: GameState, seat: Seat, id: string) =>
  benchFromDeck(ensureInDeck(state, seat, id), seat, id);

/** P1's turn 3: P1 fields `attacker` (two Energy) and `bench`, P2 fields `defender`
    and `oppBench`; P1 holds `card`. */
function ready(
  opts: {
    attacker?: string;
    bench?: readonly string[];
    defender?: string;
    oppBench?: readonly string[];
    card?: string;
  } = {},
): GameState {
  const {
    attacker = "d557-striker",
    bench = ["d557-relief"],
    defender = "d557-wall-ex",
    oppBench = [],
    card = KIERAN[0],
  } = opts;
  let state = localSetup(SEED);
  state = mustApply(state, { type: "endTurn", seat: "p1" }).state;
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = activeFrom(state, "p1", attacker);
  state = clearBench(state, "p1");
  state = attachFromDeck(state, "p1", "fix-energy", 2);
  for (const id of bench) state = benchFrom(state, "p1", id);
  state = activeFrom(state, "p2", defender);
  state = clearBench(state, "p2");
  for (const id of oppBench) state = benchFrom(state, "p2", id);
  return pullToHand(state, "p1", card);
}

/** P1 plays `card` (the last copy pulled into the hand). */
function play(start: GameState, card: string = KIERAN[0]) {
  const uid = [...start.players.p1.hand].reverse().find((u) => start.cardIdByUid[u] === card);
  if (uid === undefined) throw new Error(`no ${card} in hand`);
  return { uid, ...mustApply(start, { type: "playTrainer", seat: "p1", uid }) };
}

const confirm = (parked: GameState, yes: boolean) =>
  mustApply(parked, { type: "resolveEffect", seat: "p1", choice: { kind: "confirm", yes } });

/** Kieran played and answered: `yes` = the switch, `no` = the +30. */
function kieran(yes: boolean, opts: Parameters<typeof ready>[0] = {}) {
  const parked = play(ready(opts)).state;
  return confirm(parked, yes);
}

const attack = (state: GameState, index: number) => mustApply(state, { type: "attack", seat: "p1", index });
const dealt = (state: GameState, index = STRIKE) => find(attack(state, index).events, "DAMAGE_DEALT");

function parkedPrompt(state: GameState) {
  if (state.phase.kind !== "effect:choose") throw new Error(`expected effect:choose, got ${state.phase.kind}`);
  return state.phase.prompt;
}

function render(events: readonly GameEvent[], state: GameState): { who: string; text: string }[] {
  const ctx: LogContext = { names: NAMES, state, elapsed: formatElapsed(0) };
  return logFromEvents([...events], ctx).flatMap((entry) =>
    entry.kind === "turn" ? [] : [{ who: entry.who, text: entry.segments.map((s) => s.text).join("") }],
  );
}

/** An rng cursor whose first flip lands on `face`. */
function cursorFor(face: "heads" | "tails"): number {
  for (let n = 1; n < 1000; n++) if (flipCoin(n)[0] === face) return n;
  throw new Error("no cursor");
}

const withCoin = (state: GameState, face: "heads" | "tails"): GameState => ({ ...state, rngState: cursorFor(face) });

// ═════════════════════════════════════════════════════════════════════════════
// KIERAN
// ═════════════════════════════════════════════════════════════════════════════

describe("D557 §1 — Kieran: the print, and the registry row that maps it", () => {
  it("the program is ONE labelled `optional`, pinned by toEqual", () => {
    expect(programFor(KIERAN[0])).toEqual({
      trainer: [
        {
          op: "optional",
          note: KIERAN_TEXT,
          labels: LABELS,
          // biome-ignore lint/suspicious/noThenProperty: `then` is the effect gate's step list, not a thenable.
          then: [{ op: "switchActive" }],
          otherwise: [{ op: "boostSideAttacksThisTurn", amount: KIERAN_BONUS, target: EX_OR_V }],
        },
      ],
    });
  });

  it("all five printings share ONE object, and each is the printed Supporter", () => {
    const first = programFor(KIERAN[0]);
    for (const id of KIERAN) {
      expect(programFor(id), id).toBe(first);
      expect(POOL[id]?.name).toBe("Kieran");
      expect(POOL[id]?.trainerType).toBe("Supporter");
    }
  });

  it("the note is the whole print and the labels are button-length paraphrases of the two bullets", () => {
    const op = programFor(KIERAN[0])?.trainer?.[0];
    if (op?.op !== "optional") throw new Error("expected optional");
    expect(op.note).toBe(KIERAN_TEXT);
    expect(op.labels?.yes.length).toBeLessThan(40);
    expect(op.labels?.no.length).toBeLessThan(40);
    expect(KIERAN_TEXT).toContain("Switch your Active Pokémon");
  });
});

describe("D557 §2 — the park: a labelled `confirm`, answered by the controller", () => {
  it("every printing parks `{ kind: \"confirm\", note, labels }` — the labels on the ENGINE prompt", () => {
    for (const card of KIERAN) {
      const { state, events } = play(ready({ card }), card);
      expect(types(events), card).toEqual(["TRAINER_PLAYED", "EFFECT_PENDING"]);
      expect(parkedPrompt(state), card).toStrictEqual({ kind: "confirm", note: KIERAN_TEXT, labels: LABELS });
      expect(state.allowances.supporterPlayed).toBe(true);
    }
  });

  it("the redacted wire carries the labels, and the schema KEEPS them (zod strips undeclared keys)", () => {
    const parked = play(ready()).state;
    const wire = redactGame(parked, "p1");
    if (wire.phase.kind !== "effect:choose" || wire.phase.prompt === null) throw new Error("expected a prompt");
    expect(wire.phase.prompt).toStrictEqual({ kind: "confirm", note: KIERAN_TEXT, labels: LABELS });
    const parsed = redactedEffectPromptSchema.safeParse(wire.phase.prompt);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data).toStrictEqual({ kind: "confirm", note: KIERAN_TEXT, labels: LABELS });
  });

  it("a MALFORMED labels object is refused by the schema, and an unlabeled confirm still parses", () => {
    expect(
      redactedEffectPromptSchema.safeParse({ kind: "confirm", note: "x", labels: { yes: "a" } }).success,
    ).toBe(false);
    expect(
      redactedEffectPromptSchema.safeParse({ kind: "confirm", note: "x", labels: { yes: 1, no: "b" } }).success,
    ).toBe(false);
    expect(redactedEffectPromptSchema.safeParse({ kind: "confirm", note: "x" }).success).toBe(true);
  });

  it("🛑 an UNLABELED `optional` parks the byte-identical two-field prompt (D135)", () => {
    const start = ready();
    const program: EffectOp[] = [
      // biome-ignore lint/suspicious/noThenProperty: `then` is the effect gate's step list, not a thenable.
      { op: "optional", note: "You may draw a card.", then: [{ op: "drawCards", count: 1 }] },
    ];
    const run = runProgram(start, program, { seat: "p1" }, []);
    if (run.kind !== "parked") throw new Error(`expected parked, got ${run.kind}`);
    expect(run.prompt).toStrictEqual({ kind: "confirm", note: "You may draw a card." });
    expect(Object.keys(run.prompt)).toEqual(["kind", "note"]);
  });
});

describe("D557 §3 — the FIRST bullet (yes): the switch, and no bonus", () => {
  it("one Benched Pokémon: the switch is forced, and the bag stays EMPTY", () => {
    const start = ready();
    const { state, events } = kieran(true);
    expect(state.phase.kind).toBe("turn:action");
    expect(state.cardIdByUid[body(state.players.p1.active).stack[0] as string]).toBe("d557-relief");
    expect(state.players.p1.bench.map((b) => state.cardIdByUid[b.stack[0] as string])).toEqual(["d557-striker"]);
    expect(state.allowances.sideAttackBonuses).toEqual([]);
    expect(find(events, "SIDE_ATTACKS_BOOSTED")).toBeUndefined();
    expect(start.allowances.sideAttackBonuses).toEqual([]);
  });

  it("two Benched Pokémon: the switch PARKS its own pick, and the answer is honoured", () => {
    const parked = kieran(true, { bench: ["d557-relief", "d557-relief-2"] }).state;
    const prompt = parkedPrompt(parked);
    expect(prompt?.kind).toBe("choosePokemon");
    const { state } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon", ref: { seat: "p1", spot: { spot: "bench", index: 1 } } },
    });
    expect(state.cardIdByUid[body(state.players.p1.active).stack[0] as string]).toBe("d557-relief-2");
    expect(state.allowances.sideAttackBonuses).toEqual([]);
  });

  it("⚠️ R-K1 (UNRULED) — the switch chosen with an EMPTY Bench whiffs SILENTLY: no row, no bonus, Supporter spent", () => {
    const start = ready({ bench: [] });
    const parked = play(start).state;
    const { state, events } = confirm(parked, true);
    expect(state.phase.kind).toBe("turn:action");
    expect(types(events)).toEqual([]);
    expect(state.players.p1.active).toEqual(start.players.p1.active);
    expect(state.allowances.sideAttackBonuses).toEqual([]);
    expect(state.allowances.supporterPlayed).toBe(true);
  });

  it("the card is PLAYABLE with an empty Bench (its second bullet is still live)", () => {
    const parked = play(ready({ bench: [] })).state;
    expect(parkedPrompt(parked)?.kind).toBe("confirm");
  });
});

describe("D557 §4 — the SECOND bullet (no): +30 to an Active ex and an Active V", () => {
  it("installs `{ 30, anyOf[ex, V] }` on the bag and files SIDE_ATTACKS_BOOSTED; the Active does not move", () => {
    const start = ready();
    const { state, events } = kieran(false);
    expect(state.allowances.sideAttackBonuses).toEqual([{ amount: KIERAN_BONUS, target: EX_OR_V }]);
    expect(find(events, "SIDE_ATTACKS_BOOSTED")).toStrictEqual({
      type: "SIDE_ATTACKS_BOOSTED",
      seat: "p1",
      amount: KIERAN_BONUS,
      target: EX_OR_V,
    });
    expect(state.players.p1.active).toEqual(start.players.p1.active);
  });

  it("Strike does 50 + 30 = 80 to an Active ex AND to an Active V", () => {
    for (const defender of ["d557-wall-ex", "d557-wall-v"]) {
      const row = dealt(kieran(false, { defender }).state);
      expect(row?.bonus, defender).toBe(KIERAN_BONUS);
      expect(row?.dealt, defender).toBe(50 + KIERAN_BONUS);
    }
  });

  // ⚠️ R-K2 is a STANDING ENGINE DEVIATION (a named debt), not the printed reading: the
  // Sword & Shield-era rules count Pokémon VMAX and VSTAR as Pokémon V, but
  // `suffixPokemon` matches the name suffix exactly (`pokemonSuffixOf`, D92/D446). No
  // V-family Pokémon is Standard-legal. This rung pins the CURRENT behaviour so fixing
  // the classification turns it red on purpose. (Title before the review: "🛑 R-K2 —
  // the EXACT-SUFFIX reading: …", withdrawn as a claim of correctness.)
  it("⚠️ R-K2 DEVIATION (debt) — the engine's exact-suffix classification: a VMAX, a VSTAR and a non-rule-box Pokémon get NOTHING today", () => {
    for (const defender of ["d557-wall-vmax", "d557-wall-vstar", "d557-wall"]) {
      const row = dealt(kieran(false, { defender }).state);
      expect(row?.bonus, defender).toBeUndefined();
      expect(row?.dealt, defender).toBe(50);
    }
  });

  it("the unplayed control on the same board does the printed 50", () => {
    expect(dealt(ready())?.dealt).toBe(50);
  });

  it("PRE-W/R: (50 + 30) × 2 = 160 on a Weakness ex", () => {
    const row = dealt(kieran(false, { defender: "d557-weak-ex" }).state);
    expect(row?.dealt).toBe((50 + KIERAN_BONUS) * 2);
  });

  it("the snipe site (`snipeActive`): Pick Off onto the Active ex does 30 + 30 = 60", () => {
    const window = kieran(false, { oppBench: ["d557-bench"] }).state;
    const parked = attack(window, PICK_OFF).state;
    const row = find(
      mustApply(parked, {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "pokemonMulti", refs: [{ seat: "p2", spot: { spot: "active" } }] },
      }).events,
      "DAMAGE_DEALT",
    );
    expect(row?.bonus).toBe(KIERAN_BONUS);
    expect(row?.dealt).toBe(30 + KIERAN_BONUS);
  });

  it("🛑 it STACKS with Black Belt's Training's +40 in the same bag: 50 + 30 + 40 = 120 on an ex, 80 on a V", () => {
    const blackBelt = programFor(BLACK_BELT)?.trainer ?? [];
    expect(blackBelt).toHaveLength(1);
    for (const [defender, expected] of [
      ["d557-wall-ex", 50 + KIERAN_BONUS + 40],
      ["d557-wall-v", 50 + KIERAN_BONUS],
    ] as const) {
      const after = runProgram(kieran(false, { defender }).state, blackBelt, { seat: "p1" }, []);
      if (after.kind !== "done") throw new Error("expected done");
      expect(after.state.allowances.sideAttackBonuses, defender).toHaveLength(2);
      expect(dealt(after.state)?.dealt, defender).toBe(expected);
    }
  });
});

describe("D557 §5 — `MATCH_RECORD_VERSION` HOLDS AT 35: the labels are a widening, DRIVEN", () => {
  function stripped(parked: GameState): GameState {
    const revived = JSON.parse(JSON.stringify(parked)) as GameState;
    if (revived.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const phase = revived.phase as unknown as {
      prompt: Record<string, unknown>;
      cont: { pendingOp: Record<string, unknown> };
    };
    phase.prompt.labels = undefined;
    phase.cont.pendingOp.labels = undefined;
    return JSON.parse(JSON.stringify(revived)) as GameState;
  }

  it("the parked record really carries the labels on the prompt AND on the pending op", () => {
    const parked = play(ready()).state;
    const wire = JSON.stringify(parked.phase);
    expect(wire.split('"labels"').length - 1).toBe(2);
    expect(JSON.stringify(stripped(parked).phase)).not.toContain('"labels"');
  });

  it("🛑 a revived park with the labels STRIPPED (the v35 reader) still resolves yes = switch", () => {
    const { state } = confirm(stripped(play(ready()).state), true);
    expect(state.cardIdByUid[body(state.players.p1.active).stack[0] as string]).toBe("d557-relief");
    expect(state.allowances.sideAttackBonuses).toEqual([]);
  });

  it("🛑 …and no = +30, byte for byte what the labelled park resolves to", () => {
    const labelled = confirm(play(ready()).state, false).state;
    const bare = confirm(stripped(play(ready()).state), false).state;
    expect(bare.allowances.sideAttackBonuses).toEqual([{ amount: KIERAN_BONUS, target: EX_OR_V }]);
    expect(bare.allowances).toEqual(labelled.allowances);
    expect(dealt(bare)?.dealt).toBe(50 + KIERAN_BONUS);
  });

  it("the engine is 0.513.0", () => {
    expect(engineVersion).toBe("0.513.0");
  });
});

describe("D557 §6 — the log row: \"…ex or Pokémon V\" (anyOf joins with \"or\"; zero log.ts bytes)", () => {
  it("renders under the installer with the union noun", () => {
    const { state, events } = kieran(false);
    expect(render(events, state)).toContainEqual({
      who: "p1",
      text: "Pokémon's attacks do 30 more damage to the opponent's Active Pokémon ex or Pokémon V this turn (before Weakness and Resistance)",
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// TEAM ROCKET'S VENTURE BOMB
// ═════════════════════════════════════════════════════════════════════════════

const venture = (opts: Parameters<typeof ready>[0], face: "heads" | "tails") =>
  play(withCoin(ready({ card: VENTURE, ...opts }), face), VENTURE);

describe("D557 §7 — Venture Bomb: the print, and the registry row that maps it", () => {
  it("the program is a two-armed coin over two `\"trainer\"` placements, pinned by toEqual", () => {
    expect(programFor(VENTURE)).toEqual({
      trainer: [
        {
          op: "coinFlipGate",
          // biome-ignore lint/suspicious/noThenProperty: `then` is the effect gate's step list, not a thenable.
          then: [{ op: "damageChosen", target: "opponentAny", amount: 20, count: 1, source: "trainer" }],
          otherwise: [{ op: "damageSelf", amount: 20, source: "trainer" }],
        },
      ],
    });
    expect(POOL[VENTURE]?.trainerType).toBe("Item");
  });
});

describe("D557 §8 — HEADS: 2 counters on 1 of the opponent's Pokémon, flat", () => {
  it("with a Bench it PARKS a one-pick over Active + Bench; a Benched pick takes 20", () => {
    const { state: parked, events } = venture({ oppBench: ["d557-bench"] }, "heads");
    expect(find(events, "ATTACK_EFFECT_COIN_FLIP")).toEqual({ type: "ATTACK_EFFECT_COIN_FLIP", seat: "p1", result: "heads" });
    const prompt = parkedPrompt(parked);
    if (prompt?.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");
    expect(prompt.candidates).toEqual([
      { seat: "p2", spot: { spot: "active" } },
      { seat: "p2", spot: { spot: "bench", index: 0 } },
    ]);
    expect([prompt.min, prompt.max]).toEqual([1, 1]);
    const { state, events: after } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [{ seat: "p2", spot: { spot: "bench", index: 0 } }] },
    });
    expect(body(state.players.p2.bench[0]).damage).toBe(20);
    expect(body(state.players.p2.active).damage).toBe(0);
    expect(find(after, "COUNTERS_PLACED")).toMatchObject({ seat: "p2", amount: 20, source: "trainer" });
  });

  it("🛑 an Active WITH A WEAKNESS takes a flat 20 — a placement is not attack damage (no W/R)", () => {
    const { state, events } = venture({ defender: "d557-weak-ex" }, "heads");
    expect(body(state.players.p2.active).damage).toBe(20);
    expect(find(events, "DAMAGE_DEALT")).toBeUndefined();
    expect(find(events, "COUNTERS_PLACED")).toMatchObject({ seat: "p2", amount: 20, source: "trainer" });
    expect(body(state.players.p1.active).damage).toBe(0);
  });

  it("the row reads \"Trainer: 20 damage to …\" — never \"Ability:\" and never \"…to itself\"", () => {
    const { state, events } = venture({ defender: "d557-weak-ex" }, "heads");
    const rows = render(events, state).map((r) => r.text);
    expect(rows).toContain("Trainer: 20 damage to D557 Weak ex");
    expect(rows.some((t) => t.startsWith("Ability:") || t.includes("to itself"))).toBe(false);
  });

  it("🛑 preventTrainerEffects REFUSES it: a shielded Active is never offered, and alone it whiffs with a refusal row", () => {
    const withBench = venture({ defender: "fix-unnerve", oppBench: ["d557-bench"] }, "heads");
    expect(withBench.state.phase.kind).toBe("turn:action");
    expect(body(withBench.state.players.p2.active).damage).toBe(0);
    expect(body(withBench.state.players.p2.bench[0]).damage).toBe(20);
    expect(find(withBench.events, "TRAINER_EFFECT_PREVENTED")).toMatchObject({ seat: "p2", trainerType: "item" });
    const alone = venture({ defender: "fix-unnerve" }, "heads");
    expect(body(alone.state.players.p2.active).damage).toBe(0);
    expect(find(alone.events, "COUNTERS_PLACED")).toBeUndefined();
    expect(all(alone.events, "TRAINER_EFFECT_PREVENTED")).toHaveLength(1);
  });

  it("a lethal heads is swept by the mid-turn Knock Out sweep: the controller takes the Prize", () => {
    let start = ready({ card: VENTURE, oppBench: ["d557-bench"] });
    start = setDamage(start, "p2", 900 - 20);
    const parked = play(withCoin(start, "heads"), VENTURE).state;
    const { state, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [{ seat: "p2", spot: { spot: "active" } }] },
    });
    expect(find(events, "KNOCKED_OUT")).toMatchObject({ seat: "p2" });
    // The KO'd body was P2's Pokémon ex, so P1 — the Item's player — takes TWO Prizes.
    expect(state.phase).toMatchObject({ kind: "ko:takePrizes", seat: "p1", count: 2 });
  });
});

describe("D557 §9 — TAILS: 2 counters on YOUR OWN Active", () => {
  it("the player's own Active takes 20; the opponent is untouched; the row is the Item's", () => {
    const { state, events } = venture({ oppBench: ["d557-bench"] }, "tails");
    expect(find(events, "ATTACK_EFFECT_COIN_FLIP")?.result).toBe("tails");
    expect(state.phase.kind).toBe("turn:action");
    expect(body(state.players.p1.active).damage).toBe(20);
    expect(body(state.players.p2.active).damage).toBe(0);
    expect(find(events, "COUNTERS_PLACED")).toMatchObject({ seat: "p1", amount: 20, source: "trainer" });
    expect(render(events, state).map((r) => r.text)).toContain("Trainer: 20 damage to D557 Striker");
  });

  it("🛑 a SELF-KO is swept by `resolveMidTurnKnockOuts`, and the OPPONENT takes the Prize", () => {
    let start = ready({ card: VENTURE });
    start = setDamage(start, "p1", 300 - 20);
    const { state, events } = play(withCoin(start, "tails"), VENTURE);
    expect(find(events, "KNOCKED_OUT")).toMatchObject({ seat: "p1" });
    // The KO'd body was P1's OWN Active, so the OPPONENT (P2) is owed the Prize.
    expect(state.phase).toMatchObject({ kind: "ko:takePrizes", seat: "p2", count: 1 });
  });

  it("the attack recoil's own row is untouched: an absent `source` still reads \"did N damage to itself\"", () => {
    const start = ready();
    const events: GameEvent[] = [];
    const run = runProgram(start, [{ op: "damageSelf", amount: 30 }], { seat: "p1", invokedBy: "attack" }, events);
    if (run.kind !== "done") throw new Error("expected done");
    expect(find(events, "COUNTERS_PLACED")).toMatchObject({ source: "self", amount: 30 });
    expect(render(events, run.state).map((r) => r.text)).toContain("D557 Striker did 30 damage to itself");
  });
});
