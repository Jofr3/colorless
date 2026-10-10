import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { passivesOf } from "./continuous";
import type { GameEvent } from "./events";
import { applyAction, createGame, engineVersion, redactGame } from "./index";
import type { GameAction, GameState, Seat } from "./index";
import { attackAgainBarred, attackAgainLicensed } from "./interpreter";
import type { LogContext } from "./log";
import { formatElapsed, logFromEvents } from "./log";
import { programFor } from "./registry";
import {
  completeSetup,
  FIXTURE_POOL,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  setActiveFromDeck,
  setConditions,
  trainerCard,
} from "./testFixtures";
import type { InPlayPokemon } from "./types";
import { freshAllowances } from "./types";

// ── 🆕🆕🆕 D570 — FESTIVAL LEAD, THE ATTACK-AGAIN TURN MACHINE (7 printings) ──
//
//   Dipplin  sv06-018 / sv06-170 / sv08.5-010  "Do the Wave"
//   Goldeen  sv06-044 / sv08.5-020             "Whirlpool"
//   Swirlix  sv06-089                          "Sneaky Placement"
//   Seaking  sv08.5-021                        "Rapid Draw"
//
//   "If Festival Grounds is in play, this Pokémon may use an attack it has twice. If the
//    first attack Knocks Out your opponent's Active Pokémon, you may attack again after
//    your opponent chooses a new Active Pokémon."
//
// `PassiveEffects.attackTwiceIf` (registry.ts) on D564's `stadiumInPlayNamed`, collected RAW
// by `passivesOf`, evaluated by `attackAgainLicensed`; the window is the REQUIRED
// `TurnAllowances.attackAgainUid` (types.ts), opened by flow.ts `finishAttack`, narrowed by
// turn.ts `turnGate` (R-FL1), re-read at the second declaration by `attackAgainBarred`
// (R-FL2, attack.ts / redact.ts / GameHud [🆕 D570 landing (D539): and flow.ts `resumeTurn`'s
// offer row, the fourth caller]). R-FL1..R-FL4 are UNRULED: docs/decisions.md D570.
// Driven on the REAL ids, on a LOCAL `cardPool` (D275) in the suite's OWN 60-card deck (D270).

const FESTIVAL_IDS = ["sv06-018", "sv06-044", "sv06-089", "sv06-170", "sv08.5-010", "sv08.5-020", "sv08.5-021"] as const;
const SEAKING = "sv08.5-021";
const GOLDEEN = "sv06-044";
const SWIRLIX = "sv06-089"; // ⚠️ TEST SURGERY: the printed id, a DEMONSTRATOR attack (below)
const TR_ENERGY = "fix-tr-energy";
const DISCARD_DEFENDER_TEXT =
  "Discard a Team Rocket's Energy from this Pokémon. If you do, discard your opponent's Active Pokémon and all attached cards.";
const FESTIVAL = ["sv06-149", "sv08.5-108"] as const;
const JAMMING = "sv06-153";
const FLUTTER = "sv05-078";
const KLEFKI = "sv01-096"; // FIXTURE_POOL's transcription: Basic Pokémon in play have no Abilities
const WALL = "d570-wall"; // 900 HP, no Weakness — the defender that never falls
const SOFT = "d570-soft"; // 60 HP, no Weakness — Rapid Draw's 60 Knocks it Out

const FESTIVAL_LEAD_TEXT =
  "If Festival Grounds is in play, this Pokémon may use an attack it has twice. If the first attack Knocks Out your opponent's Active Pokémon, you may attack again after your opponent chooses a new Active Pokémon.";
const FESTIVAL_TEXT =
  "Each Pokémon that has any Energy attached (both yours and your opponent's) recovers from all Special Conditions and can't be affected by any Special Conditions.";
const JAMMING_TEXT =
  "Pokémon Tools attached to each Pokémon (both yours and your opponent's) have no effect.";
const FESTIVAL_LEAD = { type: "Ability", name: "Festival Lead", effect: FESTIVAL_LEAD_TEXT };

const LOCAL_CARDS: Record<string, Card> = {
  ...Object.fromEntries(
    FESTIVAL.map((id) => [id, { ...trainerCard(id, "Stadium", FESTIVAL_TEXT), name: "Festival Grounds" }]),
  ),
  [JAMMING]: { ...trainerCard(JAMMING, "Stadium", JAMMING_TEXT), name: "Jamming Tower" },
  [SEAKING]: battler(SEAKING, {
    name: "Seaking",
    stage: "Stage1",
    evolveFrom: "Goldeen",
    hp: 110,
    retreat: 1,
    types: ["Water"],
    weaknesses: [{ type: "Lightning", value: "×2" }],
    abilities: [FESTIVAL_LEAD],
    attacks: [{ cost: ["Colorless"], name: "Rapid Draw", damage: 60, effect: "Draw 2 cards." }],
  }),
  [GOLDEEN]: battler(GOLDEEN, {
    name: "Goldeen",
    hp: 50,
    retreat: 1,
    types: ["Water"],
    weaknesses: [{ type: "Lightning", value: "×2" }],
    abilities: [FESTIVAL_LEAD],
    attacks: [
      {
        cost: ["Colorless", "Colorless"],
        name: "Whirlpool",
        damage: 10,
        effect: "Flip a coin. If heads, discard an Energy from your opponent's Active Pokémon.",
      },
    ],
  }),
  // ⚠️ TEST SURGERY: Swirlix's REAL id (so the registry's `FESTIVAL_LEAD` row reaches it) with a
  // demonstrator attack in place of "Sneaky Placement" — the derived `discardDefender` (D536),
  // the one shipped op that empties the OPPONENT's Active Spot with no Knock Out, so the window's
  // own orphaned-promotion splice is driven.
  [SWIRLIX]: battler(SWIRLIX, {
    name: "Swirlix",
    hp: 50,
    retreat: 1,
    types: ["Psychic"],
    abilities: [FESTIVAL_LEAD],
    attacks: [{ cost: ["Colorless"], name: "D570 Bounce", damage: 10, effect: DISCARD_DEFENDER_TEXT }],
  }),
  [FLUTTER]: battler(FLUTTER, {
    name: "Flutter Mane",
    hp: 90,
    retreat: 1,
    types: ["Psychic"],
    weaknesses: [{ type: "Metal", value: "×2" }],
    abilities: [
      {
        type: "Ability",
        name: "Midnight Fluttering",
        effect:
          "As long as this Pokémon is in the Active Spot, your opponent's Active Pokémon has no Abilities, except for Midnight Fluttering.",
      },
    ],
    attacks: [{ cost: ["Colorless", "Colorless", "Colorless"], name: "Hex Hurl", damage: 90 }],
  }),
  [WALL]: battler(WALL, { name: "D570 Wall", hp: 900, retreat: 2, types: ["Colorless"], weaknesses: null }),
  [SOFT]: battler(SOFT, { name: "D570 Soft", hp: 60, retreat: 1, types: ["Colorless"], weaknesses: null }),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

/** Its OWN deck (D270), 60 by construction. */
const DECK = deckOf({
  [FESTIVAL[0]]: 1,
  [FESTIVAL[1]]: 1,
  [JAMMING]: 1,
  [SEAKING]: 2,
  [GOLDEEN]: 2,
  [SWIRLIX]: 1,
  [TR_ENERGY]: 2,
  [FLUTTER]: 1,
  [KLEFKI]: 1,
  [WALL]: 15,
  [SOFT]: 6,
  "fix-energy": 27,
});

/** 🆕 D570 review — §7's MAIN-PHASE deck (D270: its own 60, so the boards every other rung
    stands on keep their draws). It carries what the window must WITHHOLD and the first deck
    could not offer at all: an activated Ability (`fix-drakloak` "Recon Directive", usable from
    the Bench), a Rare Candy pairing (`sv01-191` + `fix-basic-1` → `fix-stage2`, `fix-stage1` the bridge), and a Stadium
    with an activated ability (Town Store `sv03-196`, and a `fix-tool` for it to find). */
const RARE_CANDY = "sv01-191";
const TOWN_STORE = "sv03-196";
const DRAKLOAK = "fix-drakloak";
const MAIN_PHASE_DECK = deckOf({
  [FESTIVAL[0]]: 1,
  [FESTIVAL[1]]: 1,
  [SEAKING]: 2,
  [TOWN_STORE]: 1,
  [RARE_CANDY]: 1,
  "fix-basic-1": 2,
  "fix-stage1": 1, // the bridge: Rare Candy's chain check reads the GAME's pool, which is the decks'
  "fix-stage2": 1,
  [DRAKLOAK]: 1,
  "fix-tool": 1,
  [WALL]: 15,
  "fix-energy": 33,
});

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

function run(state: GameState, action: GameAction): { state: GameState; events: GameEvent[] } {
  const result = applyAction(state, action);
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return { state: result.state, events: result.events };
}

function refused(state: GameState, action: GameAction): { code: string; message: string } {
  const result = applyAction(state, action);
  if (result.ok) throw new Error(`expected ${action.type} to be refused`);
  return result.error;
}

/** Setup with p2 going first; returns p1's (unrestricted) turn 2 after p2 passed. */
function opened(seed: number, deck: readonly string[] = DECK): GameState {
  const created = createGame({ seed, decks: { p1: [...deck], p2: [...deck] }, cardPool: POOL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first: "p2" }));
  state = completeSetup(state);
  return must(applyAction(state, { type: "endTurn", seat: "p2" }));
}

/** TEST SURGERY — one copy of `id` into `seat`'s DECK (back from the hand, or swapped out
    of the Prizes for the deck's bottom card). Every uid stays in exactly one zone. */
function ensureInDeck(state: GameState, seat: Seat, id: string): GameState {
  const side = state.players[seat];
  if (side.deck.some((u) => state.cardIdByUid[u] === id)) return state;
  const held = side.hand.find((u) => state.cardIdByUid[u] === id);
  if (held !== undefined) {
    const next = { ...side, hand: side.hand.filter((u) => u !== held), deck: [...side.deck, held] };
    return { ...state, players: { ...state.players, [seat]: next } };
  }
  const prized = side.prizes.find((u) => state.cardIdByUid[u] === id);
  const swap = side.deck[side.deck.length - 1];
  if (prized === undefined || swap === undefined) throw new Error(`${seat} has no ${id} to seat`);
  const next = {
    ...side,
    prizes: side.prizes.map((u) => (u === prized ? swap : u)),
    deck: [...side.deck.slice(0, -1), prized],
  };
  return { ...state, players: { ...state.players, [seat]: next } };
}

/** TEST SURGERY — `id` into the shared Stadium zone, owned by `owner`. */
function stadium(state: GameState, id: string, owner: Seat = "p1"): GameState {
  const ensured = ensureInDeck(state, owner, id);
  const side = ensured.players[owner];
  const uid = side.deck.find((u) => ensured.cardIdByUid[u] === id) as string;
  return {
    ...ensured,
    stadium: { uid, owner },
    players: { ...ensured.players, [owner]: { ...side, deck: side.deck.filter((u) => u !== uid) } },
  };
}

/** p1's turn 2: p1 `active` (with `energy` {C}), p2 `oppActive`, p2's Bench `oppBench`, p1's
    Bench `bench`, and the Stadium `stadiumId` in play (Festival Grounds by default; `null`
    for none). */
function table(opts: {
  active?: string;
  energy?: number;
  oppActive?: string;
  oppBench?: string[];
  bench?: string[];
  stadiumId?: string | null;
  seed?: number;
  deck?: readonly string[];
} = {}): GameState {
  let state = opened(opts.seed ?? 5701, opts.deck);
  const mine = opts.active ?? SEAKING;
  state = setActiveFromDeck(ensureInDeck(state, "p1", mine), "p1", mine);
  const theirs = opts.oppActive ?? WALL;
  state = setActiveFromDeck(ensureInDeck(state, "p2", theirs), "p2", theirs);
  state = clearBench(clearBench(state, "p1"), "p2");
  for (const id of opts.oppBench ?? []) state = benchFromDeck(ensureInDeck(state, "p2", id), "p2", id);
  for (const id of opts.bench ?? []) state = benchFromDeck(ensureInDeck(state, "p1", id), "p1", id);
  state = attachFromDeck(state, "p1", "fix-energy", opts.energy ?? 2);
  const stadiumId = opts.stadiumId === undefined ? FESTIVAL[0] : opts.stadiumId;
  if (stadiumId !== null) state = stadium(state, stadiumId);
  return state;
}

/** TEST SURGERY — Festival Grounds' REPRINT `sv08.5-108` into p1's hand: a Trainer the
    turn:action projection lists (unplayable while its namesake is in play, but listed). */
function withHandTrainer(state: GameState): GameState {
  const ensured = ensureInDeck(state, "p1", FESTIVAL[1]);
  const side = ensured.players.p1;
  const uid = side.deck.find((u) => ensured.cardIdByUid[u] === FESTIVAL[1]) as string;
  return {
    ...ensured,
    players: { ...ensured.players, p1: { ...side, deck: side.deck.filter((u) => u !== uid), hand: [...side.hand, uid] } },
  };
}

/** TEST SURGERY — one copy of `id` into `seat`'s HAND (from the deck or the Prizes). */
function toHand(state: GameState, seat: Seat, id: string): GameState {
  if (state.players[seat].hand.some((u) => state.cardIdByUid[u] === id)) return state;
  const ensured = ensureInDeck(state, seat, id);
  const side = ensured.players[seat];
  const uid = side.deck.find((u) => ensured.cardIdByUid[u] === id) as string;
  return {
    ...ensured,
    players: { ...ensured.players, [seat]: { ...side, deck: side.deck.filter((u) => u !== uid), hand: [...side.hand, uid] } },
  };
}

/** 🆕 D570 review — p1's TURN 4 (driven: p1 and p2 each pass once from `table`, so Rare Candy
    is past §4's first-turn ban), Seaking Active under Festival Grounds, a benched
    `fix-basic-1` (in play since before this turn) and a benched Drakloak, and Rare Candy +
    `fix-stage2` in hand. Every main-phase affordance but the Stadium's is LIVE here. */
function mainPhaseBoard(): GameState {
  let state = table({ deck: MAIN_PHASE_DECK, bench: ["fix-basic-1", DRAKLOAK], seed: 5711 });
  state = must(applyAction(state, { type: "endTurn", seat: "p1" }));
  state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
  if (state.phase.kind !== "turn:action" || state.phase.seat !== "p1" || state.turn !== 4) {
    throw new Error(`expected p1's turn 4, got ${state.phase.kind} on turn ${state.turn}`);
  }
  return toHand(toHand(state, "p1", RARE_CANDY), "p1", "fix-stage2");
}

/** TEST SURGERY — the shared Stadium swapped for `id` (owned by p1), the old one to its
    owner's discard so every uid stays in exactly one zone. */
function swapStadium(state: GameState, id: string): GameState {
  const old = state.stadium;
  const placed = stadium(state, id);
  if (old === null) return placed;
  const owner = placed.players[old.owner];
  return { ...placed, players: { ...placed.players, [old.owner]: { ...owner, discard: [...owner.discard, old.uid] } } };
}

/** The same board with the window CLOSED — the control every §7 projection is read against. */
const closed = (state: GameState): GameState => ({ ...state, allowances: { ...state.allowances, attackAgainUid: null } });

function all<T extends GameEvent["type"]>(
  events: readonly GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}
const active = (state: GameState, seat: Seat) => state.players[seat].active as InPlayPokemon;
const topOf = (state: GameState, seat: Seat) => active(state, seat).stack[active(state, seat).stack.length - 1];
const swing = (state: GameState) => run(state, { type: "attack", seat: "p1", index: 0 });

/** The nine OTHER in-turn actions, each addressed at something real on the board. */
function nineOthers(state: GameState): GameAction[] {
  const hand = state.players.p1.hand[0] ?? "none";
  return [
    { type: "attachEnergy", seat: "p1", uid: hand, target: { spot: "active" } },
    { type: "playBasicToBench", seat: "p1", uid: hand },
    { type: "evolve", seat: "p1", uid: hand, target: { spot: "active" } },
    { type: "rareCandy", seat: "p1", uid: hand, target: { spot: "active" }, evolutionUid: hand },
    { type: "retreat", seat: "p1", discardEnergy: [], promoteBenchIndex: 0 },
    { type: "playTrainer", seat: "p1", uid: hand },
    { type: "attachTool", seat: "p1", uid: hand, target: { spot: "active" } },
    { type: "useAbility", seat: "p1", target: { spot: "active" }, abilityName: "Festival Lead" },
    { type: "useStadiumAbility", seat: "p1" },
  ];
}

// ────────────────────────────────────────────────────────────────────────────
describe("D570 §1 — the prints, the registry rows and the fold", () => {
  it("all 7 printings carry ONE `passive` key: `attackTwiceIf` on `stadiumInPlayNamed \"Festival Grounds\"`, and NO `attack` key", () => {
    for (const id of FESTIVAL_IDS) {
      expect(programFor(id), id).toEqual({
        passive: { attackTwiceIf: { kind: "stadiumInPlayNamed", name: "Festival Grounds" } },
      });
    }
  });

  it("`passivesOf` collects the licence RAW, and a §9 lock (Flutter Mane) empties it", () => {
    const open = table();
    expect(passivesOf(open, active(open, "p1")).attackTwiceIf).toEqual([
      { kind: "stadiumInPlayNamed", name: "Festival Grounds" },
    ]);
    const locked = table({ oppActive: FLUTTER });
    expect(passivesOf(locked, active(locked, "p1")).attackTwiceIf).toEqual([]);
    expect(passivesOf(open, active(open, "p2")).attackTwiceIf).toEqual([]);
  });

  it("`attackAgainLicensed` reads the Stadium BY NAME: Festival Grounds (either printing) yes; Jamming Tower or none no", () => {
    for (const id of FESTIVAL) {
      const state = table({ stadiumId: id });
      expect(attackAgainLicensed(state, "p1", active(state, "p1")), id).toBe(true);
    }
    const jammed = table({ stadiumId: JAMMING });
    expect(attackAgainLicensed(jammed, "p1", active(jammed, "p1"))).toBe(false);
    const bare = table({ stadiumId: null });
    expect(attackAgainLicensed(bare, "p1", active(bare, "p1"))).toBe(false);
  });

  it("the allowance is REQUIRED and fresh at `null`; `attackAgainBarred` is false while it is", () => {
    expect(freshAllowances().attackAgainUid).toBeNull();
    const state = table();
    expect(state.allowances.attackAgainUid).toBeNull();
    expect(attackAgainBarred(state, "p1", active(state, "p1"))).toBe(false);
    const bare = table({ stadiumId: null });
    expect(attackAgainBarred(bare, "p1", active(bare, "p1"))).toBe(false);
  });
});

describe("D570 §2 — the window opens after the first attack, and the second attack ends the turn", () => {
  it("first attack with Festival Grounds in play: turn:action comes BACK, the window holds the attacker's uid, ATTACK_AGAIN_OFFERED, no TURN_ENDED", () => {
    const state = table();
    const uid = topOf(state, "p1");
    const first = swing(state);
    expect(first.state.phase).toEqual({ kind: "turn:action", seat: "p1" });
    expect(first.state.allowances.attackAgainUid).toBe(uid);
    expect(first.state.turn).toBe(state.turn);
    expect(first.state.pending).toEqual([]);
    expect(active(first.state, "p2").damage).toBe(60);
    expect(all(first.events, "TURN_ENDED")).toEqual([]);
    expect(all(first.events, "ATTACK_AGAIN_OFFERED")).toEqual([{ type: "ATTACK_AGAIN_OFFERED", seat: "p1", uid }]);
    // Rapid Draw's own effect ran (Draw 2) — the first attack is a whole attack.
    expect(first.state.players.p1.hand.length).toBe(state.players.p1.hand.length + 2);
  });

  it("the SECOND attack resolves in full and ENDS the turn (no third attack: the window does not reopen)", () => {
    const first = swing(table());
    const second = swing(first.state);
    expect(active(second.state, "p2").damage).toBe(120);
    expect(all(second.events, "ATTACK_AGAIN_OFFERED")).toEqual([]);
    expect(all(second.events, "TURN_ENDED")).toEqual([{ type: "TURN_ENDED", turn: first.state.turn, seat: "p1" }]);
    expect(second.state.phase).toEqual({ kind: "turn:action", seat: "p2" });
    // Allowances reset next turn.
    expect(second.state.allowances.attackAgainUid).toBeNull();
    expect(second.state.allowances).toEqual(freshAllowances());
  });

  it("the log names the attacker and the Ability", () => {
    const state = table();
    const first = swing(state);
    const ctx: LogContext = { names: { p1: "Ember", p2: "Tide" }, state: first.state, elapsed: formatElapsed(0) };
    const rows = logFromEvents(first.events, ctx).flatMap((entry) =>
      entry.kind === "turn" ? [] : [entry.segments.map((segment) => segment.text).join("")],
    );
    expect(rows).toContain("Seaking may attack again (Festival Lead)");
  });
});

describe("D570 §3 — no window without the licence", () => {
  it("no Stadium: the first attack ends the turn exactly as before", () => {
    const result = swing(table({ stadiumId: null }));
    expect(all(result.events, "TURN_ENDED")).toHaveLength(1);
    expect(all(result.events, "ATTACK_AGAIN_OFFERED")).toEqual([]);
    expect(result.state.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("ANOTHER Stadium (Jamming Tower): the first attack ends the turn", () => {
    const result = swing(table({ stadiumId: JAMMING }));
    expect(all(result.events, "TURN_ENDED")).toHaveLength(1);
    expect(result.state.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("🛑 a LOCKED Ability: an opposing Active Flutter Mane (Midnight Fluttering) — no window", () => {
    const result = swing(table({ oppActive: FLUTTER }));
    expect(all(result.events, "TURN_ENDED")).toHaveLength(1);
    expect(all(result.events, "ATTACK_AGAIN_OFFERED")).toEqual([]);
  });

  it("🛑 a LOCKED Ability: Klefki (Basic Pokémon have no Abilities) against a Basic Goldeen — no window; the same Goldeen opens one against a wall", () => {
    const locked = swing(table({ active: GOLDEEN, oppActive: KLEFKI }));
    expect(all(locked.events, "TURN_ENDED")).toHaveLength(1);
    expect(all(locked.events, "ATTACK_AGAIN_OFFERED")).toEqual([]);
    const control = swing(table({ active: GOLDEEN, oppActive: WALL }));
    expect(all(control.events, "TURN_ENDED")).toEqual([]);
    expect(control.state.allowances.attackAgainUid).toBe(topOf(control.state, "p1"));
  });

  it("a body with no Festival Lead (the opponent's Wall, attacking on its own turn) never opens one", () => {
    const first = swing(table());
    const ended = run(first.state, { type: "endTurn", seat: "p1" }).state;
    expect(ended.phase).toEqual({ kind: "turn:action", seat: "p2" });
    expect(passivesOf(ended, active(ended, "p2")).attackTwiceIf).toEqual([]);
  });
});

describe("D570 §4 — R-FL4: the window survives a Knock Out's prize and promotion stages", () => {
  it("first attack KOs the Defender → p1 takes a Prize → p2 promotes → turn:action is p1's again → the second attack lands on the NEW Active", () => {
    const state = table({ oppActive: SOFT, oppBench: [WALL, WALL] });
    const uid = topOf(state, "p1");
    const first = swing(state);
    expect(all(first.events, "KNOCKED_OUT")).toHaveLength(1);
    expect(first.state.phase.kind).toBe("ko:takePrizes");
    expect(first.state.allowances.attackAgainUid).toBe(uid);
    expect(all(first.events, "ATTACK_AGAIN_OFFERED")).toEqual([]);
    const prized = run(first.state, { type: "takePrizes", seat: "p1", prizeIndices: [0] });
    expect(prized.state.phase.kind).toBe("ko:promote");
    const promoted = run(prized.state, { type: "promote", seat: "p2", benchIndex: 1 });
    expect(promoted.state.phase).toEqual({ kind: "turn:action", seat: "p1" });
    expect(all(promoted.events, "ATTACK_AGAIN_OFFERED")).toEqual([{ type: "ATTACK_AGAIN_OFFERED", seat: "p1", uid }]);
    expect(all([...first.events, ...prized.events, ...promoted.events], "TURN_ENDED")).toEqual([]);
    const second = swing(promoted.state);
    expect(all(second.events, "TURN_ENDED")).toHaveLength(1);
    expect(second.state.players.p2.discard.length).toBeGreaterThan(0);
    // The promoted Wall took the second hit before the turn passed.
    const wall = second.state.players.p2.active as InPlayPokemon;
    expect(wall.damage).toBe(60);
  });

  it("🛑 no Checkup runs between the attacks: a Poisoned Defender takes no Poison until the turn really ends", () => {
    const state = setConditions(table(), "p2", { poisonDamage: 10 });
    const first = swing(state);
    expect(active(first.state, "p2").damage).toBe(60);
    const ended = run(first.state, { type: "endTurn", seat: "p1" });
    // `endTurn` declines the second attack and ends the turn normally — the Checkup runs.
    expect(all(ended.events, "TURN_ENDED")).toHaveLength(1);
    expect(active(ended.state, "p2").damage).toBe(70);
    expect(ended.state.phase).toEqual({ kind: "turn:action", seat: "p2" });
    expect(ended.state.allowances.attackAgainUid).toBeNull();
  });

  it("🛑 the window keeps the ORPHANED promotion in front of it: an attack that discards the Defender (no Knock Out) — p2 promotes BEFORE turn:action comes back", () => {
    let state = table({ active: SWIRLIX, energy: 0, oppBench: [WALL] });
    state = attachFromDeck(attachFromDeck(state, "p1", TR_ENERGY, 1), "p1", "fix-energy", 1);
    const uid = topOf(state, "p1");
    const defender = topOf(state, "p2");
    const first = swing(state);
    expect(all(first.events, "KNOCKED_OUT")).toEqual([]);
    expect(first.state.players.p2.discard).toContain(defender);
    expect(first.state.players.p2.active).not.toBeNull();
    expect(topOf(first.state, "p2")).not.toBe(defender);
    expect(first.state.phase).toEqual({ kind: "turn:action", seat: "p1" });
    expect(first.state.allowances.attackAgainUid).toBe(uid);
    expect(first.state.pending).toEqual([]);
  });

  it("the first attack takes the LAST Prize: the game ends, no window is offered", () => {
    let state = table({ oppActive: SOFT, oppBench: [WALL] });
    const side = state.players.p1;
    state = {
      ...state,
      players: {
        ...state.players,
        p1: { ...side, prizes: side.prizes.slice(0, 1), deck: [...side.deck, ...side.prizes.slice(1)] },
      },
    };
    const first = swing(state);
    expect(first.state.phase.kind).toBe("gameOver");
    expect(all(first.events, "ATTACK_AGAIN_OFFERED")).toEqual([]);
  });
});

describe("D570 §5 — R-FL1: only `attack` and `endTurn` are legal in the window", () => {
  it("every one of the NINE other in-turn actions is refused with the window's own message", () => {
    const first = swing(table({ bench: [WALL] })).state;
    for (const action of nineOthers(first)) {
      const error = refused(first, action);
      expect(error.code, action.type).toBe("BAD_PHASE");
      expect(error.message, action.type).toContain("only a second attack or ending the turn is legal (Festival Lead)");
    }
  });

  it("the CONTROL: the same nine are not refused by the window outside it", () => {
    const state = table({ bench: [WALL] });
    for (const action of nineOthers(state)) {
      const result = applyAction(state, action);
      if (!result.ok) expect(result.error.message, action.type).not.toContain("only a second attack");
    }
    // …and one of them really is legal there: the turn's Energy attachment.
    const energy = state.players.p1.hand.find((u) => state.cardIdByUid[u] === "fix-energy");
    expect(energy).toBeDefined();
    run(state, { type: "attachEnergy", seat: "p1", uid: energy as string, target: { spot: "active" } });
  });

  it("the opponent is still refused by the SEAT check, not the window", () => {
    const first = swing(table()).state;
    expect(refused(first, { type: "endTurn", seat: "p2" }).code).toBe("WRONG_SEAT");
  });
});

describe("D570 §6 — R-FL2: the second declaration re-reads the licence", () => {
  it("the body LEFT the Active Spot (surgery: a Benched Wall swapped in) — the second attack is refused; endTurn still ends the turn", () => {
    const first = swing(table({ bench: [WALL] })).state;
    const side = first.players.p1;
    const swapped: GameState = {
      ...first,
      players: {
        ...first.players,
        p1: { ...side, active: side.bench[0] ?? null, bench: side.active === null ? [] : [side.active] },
      },
    };
    expect(attackAgainBarred(swapped, "p1", active(swapped, "p1"))).toBe(true);
    const error = refused(swapped, { type: "attack", seat: "p1", index: 0 });
    expect(error.code).toBe("ATTACK_PREVENTED");
    expect(error.message).toContain("Festival Lead");
    expect(all(run(swapped, { type: "endTurn", seat: "p1" }).events, "TURN_ENDED")).toHaveLength(1);
  });

  it("the licence was LOST: Festival Grounds left play between the attacks — refused", () => {
    const first = swing(table()).state;
    const gone: GameState = { ...first, stadium: null };
    expect(refused(gone, { type: "attack", seat: "p1", index: 0 }).code).toBe("ATTACK_PREVENTED");
  });

  it("the licence was LOST: p2 PROMOTES a Flutter Mane after the KO — the window is open but the locked Seaking may not use it [🆕 D570 third review: and NO `ATTACK_AGAIN_OFFERED` row claims it may]", () => {
    const first = swing(table({ oppActive: SOFT, oppBench: [FLUTTER] }));
    const prized = run(first.state, { type: "takePrizes", seat: "p1", prizeIndices: [0] });
    // A Bench of one auto-promotes (the M1 no-choice doctrine).
    expect(prized.state.phase).toEqual({ kind: "turn:action", seat: "p1" });
    expect(prized.state.allowances.attackAgainUid).toBe(topOf(prized.state, "p1"));
    // 🆕 D570 THIRD REVIEW — the offer row is filed only when the second declaration is NOT
    // barred: turn:action came back on a board where the declaration is refused, so no log
    // row may say "Seaking may attack again".
    expect(all(prized.events, "ATTACK_AGAIN_OFFERED")).toEqual([]);
    expect(refused(prized.state, { type: "attack", seat: "p1", index: 0 }).code).toBe("ATTACK_PREVENTED");
    expect(all(run(prized.state, { type: "endTurn", seat: "p1" }).events, "TURN_ENDED")).toHaveLength(1);
  });

  it("the second declaration is a FULL one: an Asleep attacker (surgery — UNREACHABLE in play [🆕 D570 review], pinned anyway) is refused by §12, not waved through by the window", () => {
    // 🆕 D570 REVIEW — ⚠️ THIS BOARD CANNOT OCCUR, AND THE TITLE NOW SAYS SO. The licence needs
    // Festival Grounds in play (built at D562), which keeps every Pokémon with Energy attached
    // free of Special Conditions — and every Festival Lead attack costs Energy, so a body that
    // can declare in the window is a body no Special Condition can stay on. The rung is kept as
    // a CONSTRUCTED pin (D144/D146's precedent) of the code fact it measures: the window adds a
    // re-read to the declaration and removes none of §12's gates.
    const first = swing(table()).state;
    const asleep = setConditions(first, "p1", { rotation: "asleep" });
    expect(refused(asleep, { type: "attack", seat: "p1", index: 0 }).code).toBe("STATUS_PREVENTS_ATTACK");
  });
});

describe("D570 §7 — redaction parity (redact.ts `mainPhase`, mirrored in GameHud)", () => {
  it("in the window the actor's turn:action carries the attack and NOTHING else: null retreat, empty lists, null Stadium ability [🆕 D570 review: on `table()`'s board, where only retreat and the Trainer row are live — the two rungs below drive the other three]", () => {
    const first = swing(withHandTrainer(table({ bench: [WALL] }))).state;
    expect(first.players.p1.hand.some((u) => first.cardIdByUid[u] === FESTIVAL[1])).toBe(true);
    const view = redactGame(first, "p1");
    if (view.phase.kind !== "turn:action") throw new Error("expected turn:action");
    expect(view.phase.retreat).toBeNull();
    expect(view.phase.abilities).toEqual([]);
    expect(view.phase.trainers).toEqual([]);
    expect(view.phase.rareCandy).toEqual([]);
    expect(view.phase.stadiumAbility).toBeNull();
    expect(view.phase.attacks.map((a) => a.playable)).toEqual([true]);
  });

  it("the CONTROL before the first attack: the same board offers a retreat and lists the hand's Trainer", () => {
    const view = redactGame(withHandTrainer(table({ bench: [WALL] })), "p1");
    if (view.phase.kind !== "turn:action") throw new Error("expected turn:action");
    expect(view.phase.retreat).not.toBeNull();
    expect(view.phase.trainers.length).toBeGreaterThan(0);
  });

  // 🆕 D570 REVIEW — THE TWO RUNGS ABOVE PASSED ON THE BOARD'S DEFAULTS FOR THREE OF THE FIVE
  // PROJECTIONS. `table()` has no activated Ability, no Rare Candy and a Stadium with no
  // ability, so `abilities` [], `rareCandy` [] and `stadiumAbility` null held whether or not the
  // window was honoured — MEASURED: redact.ts reading `actor` for those three stayed green. The
  // two rungs below put each affordance on the board LIVE and read the SAME state twice, the
  // window open and closed, so the only difference between the two projections is the window.
  // 🆕🆕🆕 D576 — "every main-phase affordance" GREW A SIXTH, `turn:action.discardable` (an
  // Antique Fossil's discard-from-play offer). This board has no fossil, so that affordance's
  // window rung lives in `antiqueFossilsD576.test.ts` §3 (the same state, window shut and
  // open, read on the wire) — the title below names the ones this board carries.
  it("🛑 every main-phase affordance on this board LIVE with the window closed — an activated Ability, a Rare Candy pairing, the Trainer row, Retreat (the fossil discard offer: D576 §3) — and each one WITHHELD inside it", () => {
    const win = swing(mainPhaseBoard()).state;
    expect(win.allowances.attackAgainUid).toBe(topOf(win, "p1"));
    const shut = redactGame(closed(win), "p1").phase;
    const open = redactGame(win, "p1").phase;
    if (shut.kind !== "turn:action" || open.kind !== "turn:action") throw new Error("expected turn:action");
    // The control: every one is offered, and offered LIT.
    expect(shut.abilities).toContainEqual(
      expect.objectContaining({ abilityName: "Recon Directive", target: { spot: "bench", index: 1 }, disabled: false }),
    );
    expect(shut.rareCandy.map((o) => o.target)).toEqual([{ spot: "bench", index: 0 }]);
    expect(shut.trainers).toContainEqual(expect.objectContaining({ name: "Rare Candy", disabled: false, rareCandy: true }));
    expect(shut.retreat).not.toBeNull();
    // The window: the attack, and nothing else.
    expect(open.abilities).toEqual([]);
    expect(open.rareCandy).toEqual([]);
    expect(open.trainers).toEqual([]);
    expect(open.retreat).toBeNull();
    expect(open.attacks.map((a) => a.playable)).toEqual([true]);
  });

  it("🛑 …and the Stadium row — CONSTRUCTED (Town Store swapped in mid-window by surgery): live with the window closed, null inside it", () => {
    // ⚠️ UNREACHABLE IN PLAY, PINNED ANYWAY (D144/D146's precedent): only Festival Grounds opens
    // a window, it has no activated ability, and R-FL1 refuses the Stadium play that could
    // replace it — so a live Stadium row inside a window needs surgery. `redactPhase` withholds
    // it through the same `mainPhase` guard, and this is the only board that can tell.
    const win = swapStadium(ensureInDeck(swing(mainPhaseBoard()).state, "p1", "fix-tool"), TOWN_STORE);
    expect(win.allowances.attackAgainUid).not.toBeNull();
    const shut = redactGame(closed(win), "p1").phase;
    const open = redactGame(win, "p1").phase;
    if (shut.kind !== "turn:action" || open.kind !== "turn:action") throw new Error("expected turn:action");
    expect(shut.stadiumAbility).toEqual({ label: "Town Store", disabled: false, reason: null });
    expect(open.stadiumAbility).toBeNull();
    // …and the engine agrees: inside the window the activation is the window's refusal.
    expect(refused(win, { type: "useStadiumAbility", seat: "p1" }).message).toContain("(Festival Lead)");
  });

  it("a barred second declaration greys the attack (the licence lost)", () => {
    const first = swing(table()).state;
    const view = redactGame({ ...first, stadium: null }, "p1");
    if (view.phase.kind !== "turn:action") throw new Error("expected turn:action");
    expect(view.phase.attacks.map((a) => a.playable)).toEqual([false]);
  });
});

describe("§8 — the bytes, and THE TENTH POSITION (`MATCH_RECORD_VERSION` 36 → 37)", () => {
  it("🛑 the window round-trips through JSON and still narrows the turn", () => {
    const first = swing(table()).state;
    const revived = JSON.parse(JSON.stringify(first)) as GameState;
    expect(revived.allowances.attackAgainUid).toBe(first.allowances.attackAgainUid);
    expect(refused(revived, { type: "retreat", seat: "p1", discardEnergy: [], promoteBenchIndex: 0 }).code).toBe(
      "BAD_PHASE",
    );
    expect(all(swing(revived).events, "TURN_ENDED")).toHaveLength(1);
  });

  it("🛑 (i) a 0.453 ROLLBACK resuming a v37 record MID-WINDOW ignores the key and GRANTS main-phase plays between the attacks — NOT inert", () => {
    // A 0.453 engine never reads the key, which is this engine with the key at its fresh
    // value: an Energy attachment (and every other main-phase play) is accepted between
    // the two attacks, which the printed card never allows.
    const first = JSON.parse(JSON.stringify(swing(table()).state)) as GameState;
    const rolled: GameState = { ...first, allowances: { ...first.allowances, attackAgainUid: null } };
    const energy = rolled.players.p1.hand.find((u) => rolled.cardIdByUid[u] === "fix-energy") as string;
    expect(energy).toBeDefined();
    expect(refused(first, { type: "attachEnergy", seat: "p1", uid: energy, target: { spot: "active" } }).code).toBe(
      "BAD_PHASE",
    );
    const granted = run(rolled, { type: "attachEnergy", seat: "p1", uid: energy, target: { spot: "active" } });
    expect(active(granted.state, "p1").energy).toContain(energy);
  });

  it("🛑 (ii) a v36-SHAPED bag (the key ABSENT) is NOT read benignly — MEASURED: every action but `endTurn` is refused", () => {
    // `undefined !== null`: `turnGate` reads an open window and `attackAgainBarred` a uid
    // no body holds. A v36 record resumed by this deploy would strand the turn owner with
    // one legal action — retired by `readMatchRecord`'s version gate (D124), not by the reader.
    const state = table();
    const { attackAgainUid: _window, ...v36Allowances } = state.allowances;
    const v36 = { ...state, allowances: v36Allowances } as unknown as GameState;
    expect(refused(v36, { type: "attack", seat: "p1", index: 0 }).code).toBe("ATTACK_PREVENTED");
    const energy = v36.players.p1.hand.find((u) => v36.cardIdByUid[u] === "fix-energy") as string;
    expect(refused(v36, { type: "attachEnergy", seat: "p1", uid: energy, target: { spot: "active" } }).code).toBe(
      "BAD_PHASE",
    );
    expect(all(run(v36, { type: "endTurn", seat: "p1" }).events, "TURN_ENDED")).toHaveLength(1);
  });

  it("the engine is 0.512.0", () => {
    expect(engineVersion).toBe("0.512.0");
  });
});
