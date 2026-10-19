import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { benchMatches, namesItsCard } from "./cards";
import { deriveAttackEffect } from "./effects";
import type { CardFilter, EffectOp, GameEvent, GameState, InPlayPokemon, Seat } from "./index";
import { applyAction, createGame, engineVersion } from "./index";
import { runProgram } from "./interpreter";
import { programFor } from "./registry";
import {
  FIXTURE_POOL,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  deepFreeze,
  discardFromDeck,
  handFromDeck,
  handUid,
  setActiveFromDeck,
  toDeckTop,
} from "./testFixtures";

// ── 🆕🆕🆕 D613 — TWO CORRECTNESS FIXES ─────────────────────────────────────────────────────────
//
// §1–§2: D610's open review finding. Jet Energy `sv02-190` (*"When you attach this card from your hand
// to 1 of your Benched Pokémon, switch that Pokémon with your Active Pokémon."*) runs `switchInto`
// from turn.ts `attachEnergy`, outside any program, so no `settleProgram` sweep follows it. Team
// Rocket's Dugtrio "Holes" counters placed by that switch were never Knock-Out-checked. The other
// `switchInto` routes are programs (`settleProgram` / `finishAttack` sweep) and `retreat` sweeps itself.
//
// §3–§7: R-BC1 / D238. An effect that puts a Pokémon "onto your Bench" admits Basic Pokémon only,
// unless the printed noun names its card (Ninjask's "a Shedinja", Charjabug's "up to 3 Charjabug").
// Texts measured on the LOCAL D1 2026-10-09.

const HOLES =
  "Whenever your opponent's Active Pokémon moves to the Bench during their turn, place 2 damage counters on that Pokémon.";
const KINGS_ORDER = "Put up to 3 {W} Pokémon from your discard pile onto your Bench."; // Kingdra ex ×3
const BOOMING_CALL = "Put up to 3 {N} Pokémon from your discard pile onto your Bench."; // Salamence ex ×2 (`30th`)
const REVIVAL_BLESSING = "Put a Pokémon from your discard pile onto your Bench."; // Rabsca ×3
const SUMMONING_GATE =
  "Look at the top 8 cards of your deck. You may put any number of Pokémon you find there onto your Bench. Shuffle the other cards back into your deck."; // Reuniclus ×2
const CINNABAR_LURE =
  "Look at the top 10 cards of your deck. You may put any number of Pokémon you find there onto your Bench. Shuffle the other cards back into your deck."; // Tatsugiri ex ×2
const PARALLEL_PLACEMENT =
  "Search your deck for up to 3 Charjabug and put them onto your Bench. Then, shuffle your deck."; // Charjabug `sv07-052`

const DUGTRIO = "me02.5-101"; // Team Rocket's Dugtrio "Holes" (D610)
const JET = "sv02-190";
const FREE = "fix-basic-0"; // 60 HP, retreat 0
const BASIC = "fix-basic-1";
const W_BASIC = "d613-w-basic";
const W_STAGE1 = "d613-w-stage1";
const N_BASIC = "d613-n-basic";
const N_STAGE1 = "d613-n-stage1";
const CHARJABUG = "d613-charjabug";
const SHEDINJA = "d613-shedinja";
const MAUSHOLD = "d613-maushold";
const SILCOON = "d613-silcoon";
const TRAINER = "d613-item";

const LOCAL: Record<string, Card> = {
  [DUGTRIO]: battler(DUGTRIO, {
    name: "Team Rocket's Dugtrio",
    stage: "Stage1",
    evolveFrom: "Team Rocket's Diglett",
    hp: 100,
    types: ["Fighting"],
    abilities: [{ type: "Ability", name: "Holes", effect: HOLES }],
  } as Partial<Card>),
  [W_BASIC]: battler(W_BASIC, { name: "Horsea", types: ["Water"] }),
  [W_STAGE1]: battler(W_STAGE1, { name: "Seadra", stage: "Stage1", evolveFrom: "Horsea", types: ["Water"] } as Partial<Card>),
  [N_BASIC]: battler(N_BASIC, { name: "Bagon", types: ["Dragon"] }),
  [N_STAGE1]: battler(N_STAGE1, { name: "Shelgon", stage: "Stage1", evolveFrom: "Bagon", types: ["Dragon"] } as Partial<Card>),
  [CHARJABUG]: battler(CHARJABUG, { name: "Charjabug", stage: "Stage1", evolveFrom: "Grubbin" } as Partial<Card>),
  [SHEDINJA]: battler(SHEDINJA, { name: "Shedinja", stage: "Stage1", evolveFrom: "Nincada" } as Partial<Card>),
  [MAUSHOLD]: battler(MAUSHOLD, { name: "Maushold", stage: "Stage1", evolveFrom: "Tandemaus" } as Partial<Card>),
  [SILCOON]: battler(SILCOON, { name: "Silcoon", stage: "Stage1", evolveFrom: "Wurmple" } as Partial<Card>),
  [TRAINER]: { ...(FIXTURE_POOL["sv01-194"] as Card), id: TRAINER },
};
const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL };
const DECK = deckOf({
  [DUGTRIO]: 2,
  [JET]: 2,
  [W_BASIC]: 3,
  [W_STAGE1]: 3,
  [N_BASIC]: 2,
  [N_STAGE1]: 2,
  [CHARJABUG]: 2,
  [SHEDINJA]: 1,
  [MAUSHOLD]: 1,
  [SILCOON]: 1,
  [TRAINER]: 1,
  [FREE]: 20,
  [BASIC]: 20,
});

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

/** Both hands back into the decks and every Prize swapped for deck filler (D610's `reset`). */
function reset(state: GameState): GameState {
  let next = state;
  for (const s of ["p1", "p2"] as const) {
    const side = next.players[s];
    let deck = [...side.deck, ...side.hand];
    const filler = (u: string) => [FREE, BASIC].includes(next.cardIdByUid[u] as string);
    const prizes = side.prizes.map((u) => {
      if (filler(u)) return u;
      const swap = deck.find(filler);
      if (swap === undefined) throw new Error("no swap card");
      deck = [...deck.filter((d) => d !== swap), u];
      return swap;
    });
    next = { ...next, players: { ...next.players, [s]: { ...side, hand: [], prizes, deck } } };
  }
  return next;
}

/** Setup with p2 first; then the clock walks to `seat`'s turn ≥ 3 (D610's `turnOf`). */
function turnOf(seat: Seat, seed = 6131): GameState {
  const created = createGame({ seed, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first: "p2" }));
  while (state.phase.kind === "setup:drawExtra") {
    const phase = state.phase;
    const s = (["p1", "p2"] as const).find((x) => !phase.decided[x]);
    if (s === undefined) throw new Error("setup:drawExtra with every seat decided");
    state = must(applyAction(state, { type: "setupDrawExtra", seat: s, count: phase.owed[s] }));
  }
  for (const s of ["p1", "p2"] as const) {
    const uid = state.players[s].hand.find(
      (h) => POOL[state.cardIdByUid[h] ?? ""]?.stage === "Basic",
    );
    if (uid === undefined) throw new Error(`no Basic in ${s}'s hand`);
    state = must(applyAction(state, { type: "setupPlaceActive", seat: s, uid }));
  }
  for (const s of ["p1", "p2"] as const) state = must(applyAction(state, { type: "setupReady", seat: s }));
  for (let i = 0; i < 12; i += 1) {
    if (state.phase.kind !== "turn:action") throw new Error(`stuck in ${state.phase.kind}`);
    if (state.phase.seat === seat && state.turn >= 3) return reset(state);
    state = must(applyAction(state, { type: "endTurn", seat: state.phase.seat }));
  }
  throw new Error(`never reached ${seat}'s turn`);
}

function lay(state: GameState, seat: Seat, active: string, bench: readonly string[]): GameState {
  let next = clearBench(setActiveFromDeck(state, seat, active), seat);
  for (const id of bench) next = benchFromDeck(next, seat, id);
  return next;
}
function hurt(state: GameState, seat: Seat, damage: number): GameState {
  const side = state.players[seat];
  return {
    ...state,
    players: { ...state.players, [seat]: { ...side, active: { ...(side.active as InPlayPokemon), damage } } },
  };
}
const top = (p: InPlayPokemon | null | undefined) => p?.stack.at(-1);

/** p2's turn: p2's Active is `fix-basic-0` (60 HP) with `damage`, one Basic on the Bench and Jet
    Energy in hand; p1's Bench holds `watchers` (the reviewer's repro board). */
function jetBoard(damage: number, watchers: readonly string[]): GameState {
  const laid = lay(lay(turnOf("p2"), "p1", BASIC, watchers), "p2", FREE, [BASIC]);
  return handFromDeck(hurt(laid, "p2", damage), "p2", JET, 1);
}
const attachJet = (state: GameState) =>
  applyAction(deepFreeze(state), {
    type: "attachEnergy",
    seat: "p2",
    uid: handUid(state, "p2", JET),
    target: { spot: "bench", index: 0 },
  });

describe("D613 §1 — a Jet Energy switch runs the mid-turn Knock Out check (D610's review finding)", () => {
  it("🛑 the reviewer's repro: 40 damage + Holes' 20 on a 60-HP body that Jet moved is a Knock Out for p1's Prize", () => {
    const before = jetBoard(40, [DUGTRIO]);
    const moved = top(before.players.p2.active);
    const after = must(attachJet(before));
    expect(after.phase.kind).toBe("ko:takePrizes");
    expect(after.phase.kind === "ko:takePrizes" && after.phase.seat).toBe("p1");
    expect(after.players.p2.bench.some((b) => top(b) === moved)).toBe(false);
    expect(after.players.p2.discard).toContain(moved);
  });

  it("non-lethal: the moved body takes 20 and the turn goes on (`turn:action`, the sweep's fast path)", () => {
    const before = jetBoard(0, [DUGTRIO]);
    const moved = top(before.players.p2.active);
    const after = must(attachJet(before));
    expect(after.phase.kind).toBe("turn:action");
    expect(after.players.p2.bench.map((b) => [top(b), b.damage])).toEqual([[moved, 20]]);
  });

  it("control: with no Dugtrio, the same attach on 40 damage places nothing and Knocks nothing Out", () => {
    const after = must(attachJet(jetBoard(40, [])));
    expect(after.phase.kind).toBe("turn:action");
    expect(after.players.p2.bench.map((b) => b.damage)).toEqual([40]);
  });
});

const RAW: Record<string, string> = (
  import.meta as unknown as {
    glob(
      pattern: string | readonly string[],
      options: { query: "?raw"; import: "default"; eager: true },
    ): Record<string, string>;
  }
).glob(["./{turn,cardplay,flow,triggers,attack}.ts"], { query: "?raw", import: "default", eager: true });

describe("D613 §2 — the switchInto audit", () => {
  it("turn.ts `attachEnergy` is the only `switchInto` call outside interpreter.ts, and it now records the move", () => {
    const turn = RAW["./turn.ts"] ?? "";
    expect(turn.match(/switchInto\(/g)?.length).toBe(1);
    expect(turn).toContain("    switched = moved !== next;\n");
    // 🆕🆕🆕 D636 (D539): the sweep's board is `shocked` (Electrified Incisors placed after the watched triggers).
    expect(turn).toContain("    if (shocked !== next || switched) {\n");
    for (const f of ["cardplay", "flow", "triggers", "attack"]) {
      const text = RAW[`./${f}.ts`];
      expect(text, f).toBeDefined();
      expect(text?.includes("switchInto("), f).toBe(false);
    }
  });
});

// ── §3–§7: Basic only onto the Bench ──────────────────────────────────────────────────────────────

/** p1's turn with `pile` moved from the deck into p1's discard pile. */
function withDiscard(pile: Record<string, number>): GameState {
  let state = lay(turnOf("p1"), "p1", BASIC, []);
  for (const [id, n] of Object.entries(pile)) state = discardFromDeck(state, "p1", id, n);
  return state;
}
function offered(state: GameState, program: readonly EffectOp[], seat: Seat = "p1"): string[] {
  const events: GameEvent[] = [];
  const result = runProgram(state, program, { seat }, events);
  if (result.kind !== "parked") return [];
  const prompt = result.prompt as { kind: string; candidates?: readonly string[] };
  if (prompt.kind !== "chooseCards" || prompt.candidates === undefined) throw new Error(`unexpected ${prompt.kind}`);
  return prompt.candidates.map((u) => state.cardIdByUid[u] as string);
}
const derived = (text: string): EffectOp[] => {
  const program = deriveAttackEffect(text);
  if (program === null) throw new Error(`not derived: ${text}`);
  return program;
};

describe("D613 §3 — the discard pile onto the Bench: Basic only (R-BC1 retired)", () => {
  it("King's Order (\"{W} Pokémon\", Kingdra ex ×3) offers the Basic {W} Pokémon, not the Stage 1", () => {
    const ids = offered(withDiscard({ [W_BASIC]: 2, [W_STAGE1]: 2 }), derived(KINGS_ORDER));
    expect(ids).toEqual([W_BASIC, W_BASIC]);
  });

  it("Booming Call (\"{N} Pokémon\", Salamence ex ×2) offers Bagon, not Shelgon; a Stage 1-only pile whiffs", () => {
    expect(offered(withDiscard({ [N_BASIC]: 1, [N_STAGE1]: 2 }), derived(BOOMING_CALL))).toEqual([N_BASIC]);
    expect(offered(withDiscard({ [N_STAGE1]: 2 }), derived(BOOMING_CALL))).toEqual([]);
  });

  it("Revival Blessing (\"a Pokémon\", Rabsca ×3) offers Basics only", () => {
    expect(offered(withDiscard({ [W_STAGE1]: 1, [N_BASIC]: 1 }), derived(REVIVAL_BLESSING))).toEqual([N_BASIC]);
  });

  it("the same noun into the HAND is unchanged: a Stage 1 is offered", () => {
    const toHand: EffectOp[] = [{ op: "discardPileRetrieval", filter: { kind: "typedPokemon", pokemonType: "Water" }, dest: "hand", max: 3 }];
    expect(offered(withDiscard({ [W_BASIC]: 1, [W_STAGE1]: 1 }), toHand).sort()).toEqual([W_BASIC, W_STAGE1].sort());
  });
});

describe("D613 §4 — the deck top onto the Bench: Basic only", () => {
  it("Summoning Gate and Cinnabar Lure (\"any number of Pokémon\") offer the Basics in the window, not the Stage 1s", () => {
    let state = lay(turnOf("p1"), "p1", BASIC, []);
    state = toDeckTop(toDeckTop(state, "p1", W_STAGE1, 2), "p1", N_BASIC, 1);
    for (const text of [SUMMONING_GATE, CINNABAR_LURE]) {
      const ids = offered(state, derived(text));
      expect(ids).toContain(N_BASIC);
      expect(ids).not.toContain(W_STAGE1);
    }
  });
});

describe("D613 §5 — a deck search onto the Bench: Basic only, unless the noun names its card", () => {
  it("a class noun (\"{W} Pokémon\") onto the Bench offers no Stage 1; into the hand it does", () => {
    const state = lay(turnOf("p1"), "p1", BASIC, []);
    const filter: CardFilter = { kind: "typedPokemon", pokemonType: "Water" };
    const bench = offered(state, [{ op: "searchDeck", filter, dest: "bench", max: 2 }]);
    expect(new Set(bench)).toEqual(new Set([W_BASIC]));
    const hand = offered(state, [{ op: "searchDeck", filter, dest: "hand", max: 2 }]);
    expect(new Set(hand)).toEqual(new Set([W_BASIC, W_STAGE1]));
  });

  it("\"any\" sizes the offer off the benchable matches only", () => {
    const state = lay(turnOf("p1"), "p1", BASIC, []);
    const events: GameEvent[] = [];
    const result = runProgram(state, [{ op: "searchDeck", filter: { kind: "typedPokemon", pokemonType: "Water" }, dest: "bench", max: "any" }], { seat: "p1" }, events);
    expect(result.kind).toBe("parked");
    expect(result.kind === "parked" && (result.prompt as { max?: number }).max).toBe(3);
  });

  it("a printed name is the permission: Charjabug's \"up to 3 Charjabug\" (derived), Ninjask's Shedinja, Familial March's Maushold and Multiplying Cocoon's Silcoon (registry)", () => {
    const state = lay(turnOf("p1"), "p1", BASIC, []);
    expect(offered(state, derived(PARALLEL_PLACEMENT))).toEqual([CHARJABUG, CHARJABUG]);
    const shell = programFor("me01-017")?.triggered?.[0]?.program ?? [];
    expect(offered(state, shell)).toEqual([SHEDINJA]);
    const march = programFor("sv08-158")?.attack?.[0] ?? [];
    expect(offered(state, march)).toEqual([MAUSHOLD]);
    const cocoon = programFor("me02.5-012")?.triggered?.[0]?.program ?? [];
    expect(offered(state, cocoon)).toEqual([SILCOON]);
  });

  it("the disjunctive search (`orElse`) onto the Bench refuses a Stage 1 too (no printing benches through it)", () => {
    const state = lay(turnOf("p1"), "p1", BASIC, []);
    const op: EffectOp = {
      op: "searchDeck",
      filter: { kind: "typedPokemon", pokemonType: "Water" },
      dest: "bench",
      max: 2,
      orElse: { filter: { kind: "typedPokemon", pokemonType: "Dragon" }, max: 1 },
    };
    expect(new Set(offered(state, [op]))).toEqual(new Set([W_BASIC, N_BASIC]));
  });
});

describe("D613 §6 — the opponent's hand onto their Bench: Basic only", () => {
  it("a class noun offers the opponent's Basic, never their Stage 1", () => {
    let state = lay(turnOf("p1"), "p1", BASIC, []);
    state = lay(state, "p2", BASIC, []);
    state = handFromDeck(handFromDeck(state, "p2", W_STAGE1, 1), "p2", N_BASIC, 1);
    const op: EffectOp = { op: "bottomFromOpponentHand", filter: { kind: "anyPokemon" }, dest: "bench", upTo: 2 };
    expect(offered(state, [op])).toEqual([N_BASIC]);
  });
});

describe("D613 §7 — the predicate, and the version", () => {
  const card = (id: string) => POOL[id] as Card;
  it("`benchMatches`: a matching Basic yes, a matching Stage 1 no unless named, a non-match no, a matching non-Pokémon is the filter's business (🆕🆕🆕 D635 (D539): a Trainer only with an in-play face)", () => {
    const water: CardFilter = { kind: "typedPokemon", pokemonType: "Water" };
    expect(benchMatches(card(W_BASIC), water)).toBe(true);
    expect(benchMatches(card(W_STAGE1), water)).toBe(false);
    expect(benchMatches(card(N_BASIC), water)).toBe(false);
    expect(benchMatches(card(CHARJABUG), { kind: "byName", name: "Charjabug" })).toBe(true);
    // 🆕🆕🆕 D635 (D539): ~~true~~ — a Trainer goes onto the Bench only with an in-play Pokémon face
    // (`FOSSIL_IDS`, Fossil Quarry); this Item has none. An Energy is still the filter's business.
    expect(benchMatches(card(TRAINER), { kind: "item" })).toBe(false);
    expect(benchMatches(card("fix-energy"), { kind: "anyEnergy" })).toBe(true);
    expect(benchMatches(undefined, { kind: "anyCard" })).toBe(false);
  });

  it("`namesItsCard`: byName, a name fragment and an all-name `anyOf`; never a class noun or an empty / mixed `anyOf`", () => {
    expect(namesItsCard({ kind: "byName", name: "Shedinja" })).toBe(true);
    expect(namesItsCard({ kind: "pokemonNameContaining", fragment: "Koffing" })).toBe(true);
    expect(namesItsCard({ kind: "anyOf", filters: [{ kind: "byName", name: "Silcoon" }, { kind: "byName", name: "Cascoon" }] })).toBe(true);
    expect(namesItsCard({ kind: "anyOf", filters: [] })).toBe(false);
    expect(namesItsCard({ kind: "anyOf", filters: [{ kind: "byName", name: "Silcoon" }, { kind: "anyPokemon" }] })).toBe(false);
    expect(namesItsCard({ kind: "typedPokemon", pokemonType: "Water" })).toBe(false);
    expect(namesItsCard({ kind: "anyPokemon" })).toBe(false);
  });

  it("is built at engine 0.549.0", () => {
    expect(engineVersion).toBe("0.549.0");
  });
});
