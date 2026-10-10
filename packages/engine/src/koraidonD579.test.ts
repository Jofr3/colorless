import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { resolvedByAnyReader } from "./censusAttackCorpus";
import { deriveAttackDamageBonus } from "./effects";
import type { GameEvent } from "./events";
import { applyAction, createGame } from "./index";
import type { GameAction, GameState, Seat } from "./index";
import { conditionHolds, conditionNote } from "./interpreter";
import { FIXTURE_POOL, battler, deckOf, typedEnergy } from "./testFixtures";
import { type InPlayPokemon, makeInPlay } from "./types";

// ── 🆕🆕🆕 D579 — KORAIDON `sv08-116` "UNRELENTING ONSLAUGHT" (attack index 0, 1 legal printing) ──
//
// {C}{C}, `30+`: *"If 1 of your other Ancient Pokémon used an attack during your last turn, this
// attack does 150 more damage."* A READER row: one `CONDITIONAL_DAMAGE_CLAUSES` literal, mapped to
// the NEW `BoardCondition` `yourOtherBannerPokemonAttackedLastTurn { banner: "Ancient" }`, read off
// the NEW REQUIRED `GameState.recentAttackers` — a SEAT-level record of which bodies attacked on
// this turn and on the seat's previous one, written beside `stampAttackUse` (flow.ts
// `stampSeatAttacker`). 🛑 R-1, RULED BY THE USER 2026-10-05: READING B — the record OUTLIVES the
// body, so an Ancient Pokémon that attacked last turn and then left play STILL counts.
// `MATCH_RECORD_VERSION` 40 → 41 (apps/api match.ts "D579"). R-1b (Angelite still reads the
// per-body stamp) is ⚠️ UNRULED and pinned as a divergence in §6.

const KORAIDON = "sv08-116";
const WAKE = "sv06-063"; // Walking Wake — Ancient (banners.ts)
const ONSLAUGHT =
  "If 1 of your other Ancient Pokémon used an attack during your last turn, this attack does 150 more damage.";
const CLAUSE = "1 of your other Ancient Pokémon used an attack during your last turn";
const PLAIN = "d579k-plain"; // not Ancient
const WALL = "d579k-wall";
const FILLER = "d579k-filler";
const C = "d579k-colorless";
const WATER = "d579k-water";

const LOCAL_CARDS: Record<string, Card> = {
  [KORAIDON]: battler(KORAIDON, {
    name: "Koraidon",
    hp: 130,
    types: ["Fighting"],
    retreat: 2,
    attacks: [
      { cost: ["Colorless", "Colorless"], name: "Unrelenting Onslaught", effect: ONSLAUGHT, damage: "30+" },
      { cost: ["Fighting", "Fighting", "Colorless"], name: "Hammer In", damage: 110 },
    ],
  }),
  [WAKE]: battler(WAKE, {
    name: "Walking Wake",
    hp: 130,
    types: ["Water"],
    retreat: 1,
    attacks: [
      { cost: ["Water"], name: "Aurora Gain", effect: "Heal 20 damage from this Pokémon.", damage: 20 },
      {
        cost: ["Water", "Water", "Colorless"],
        name: "Undulating Slice",
        effect:
          "Put up to 9 damage counters on this Pokémon. This attack does 20 damage for each damage counter you placed in this way.",
        damage: "20×",
      },
    ],
  }),
  [PLAIN]: battler(PLAIN, { name: "D579 Plain", hp: 130, types: ["Colorless"], attacks: [{ cost: [], name: "Tap", damage: 10 }] }),
  [WALL]: battler(WALL, { name: "D579 Wall", hp: 900, types: ["Colorless"], attacks: [{ cost: [], name: "Tap", damage: 10 }] }),
  [FILLER]: battler(FILLER, { name: "D579 Filler", hp: 900, types: ["Colorless"], attacks: [{ cost: [], name: "Tap", damage: 10 }] }),
  [C]: typedEnergy(C, "Fighting"),
  [WATER]: typedEnergy(WATER, "Water"),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const DECK = deckOf({
  [KORAIDON]: 2,
  [WAKE]: 2,
  [PLAIN]: 2,
  [WALL]: 2,
  [FILLER]: 24,
  [C]: 6,
  [WATER]: 6,
  "fix-energy": 16,
});

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

function run(state: GameState, action: GameAction): { state: GameState; events: GameEvent[] } {
  const result = applyAction(state, action);
  if (!result.ok) throw new Error(`${action.type} rejected: ${result.error.code}: ${result.error.message}`);
  return { state: result.state, events: result.events };
}

function opened(seed: number): GameState {
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
    const uid = state.players[s].hand.find((h) => POOL[state.cardIdByUid[h] ?? ""]?.stage === "Basic");
    if (uid === undefined) throw new Error(`no Basic in ${s}'s hand`);
    state = must(applyAction(state, { type: "setupPlaceActive", seat: s, uid }));
  }
  for (const s of ["p1", "p2"] as const) state = must(applyAction(state, { type: "setupReady", seat: s }));
  return must(applyAction(state, { type: "endTurn", seat: "p2" }));
}

function withSide(state: GameState, seat: Seat, patch: Partial<GameState["players"]["p1"]>): GameState {
  return { ...state, players: { ...state.players, [seat]: { ...state.players[seat], ...patch } } };
}

function pull(state: GameState, seat: Seat, id: string): { state: GameState; uid: string } {
  const side = state.players[seat];
  const is = (u: string) => state.cardIdByUid[u] === id;
  const zone = (["deck", "hand", "prizes"] as const).find((z) => side[z].some(is));
  if (zone === undefined) throw new Error(`${seat} has no ${id}`);
  const uid = side[zone].find(is) ?? "";
  if (zone === "prizes") {
    const swap = side.deck.find((u) => !is(u)) ?? "";
    return {
      uid,
      state: withSide(state, seat, {
        prizes: side.prizes.map((u) => (u === uid ? swap : u)),
        deck: side.deck.filter((u) => u !== swap),
      }),
    };
  }
  return { uid, state: withSide(state, seat, { [zone]: side[zone].filter((u) => u !== uid) }) };
}

interface Spot {
  id: string;
  energy?: readonly string[];
  damage?: number;
}

/** p1's turn: each seat's Active and Bench built from `Spot`s; every hand emptied into the deck. */
function table(opts: { p1: Spot; p1Bench?: readonly Spot[]; p2: Spot; p2Bench?: readonly Spot[] }): GameState {
  let state = opened(5792);
  for (const seat of ["p1", "p2"] as const) {
    const side = state.players[seat];
    const back = [
      ...side.hand,
      ...(side.active === null ? [] : [...side.active.stack, ...side.active.energy]),
      ...side.bench.flatMap((p) => [...p.stack, ...p.energy]),
    ];
    state = withSide(state, seat, { hand: [], active: null, bench: [], deck: [...side.deck, ...back] });
  }
  const take = (seat: Seat, id: string): string => {
    const pulled = pull(state, seat, id);
    state = pulled.state;
    return pulled.uid;
  };
  const build = (seat: Seat, spot: Spot): InPlayPokemon => {
    const top = take(seat, spot.id);
    const energy = (spot.energy ?? []).map((id) => take(seat, id));
    return { ...makeInPlay(top, 0), energy, damage: spot.damage ?? 0 };
  };
  for (const seat of ["p1", "p2"] as const) {
    const active = build(seat, seat === "p1" ? opts.p1 : opts.p2);
    const bench = (seat === "p1" ? (opts.p1Bench ?? []) : (opts.p2Bench ?? [])).map((s) => build(seat, s));
    state = withSide(state, seat, { active, bench });
  }
  return state;
}

const onslaught: GameAction = { type: "attack", seat: "p1", index: 0 };
const active = (state: GameState, seat: Seat): InPlayPokemon => state.players[seat].active as InPlayPokemon;
const top = (body: InPlayPokemon): string => body.stack[body.stack.length - 1] ?? "";
const COND = { kind: "yourOtherBannerPokemonAttackedLastTurn", banner: "Ancient" } as const;

/** Koraidon Active (two Energy), an Ancient Walking Wake and a non-Ancient body on p1's Bench. */
function koraidonBoard(): GameState {
  return table({
    p1: { id: KORAIDON, energy: [C, C] },
    p1Bench: [{ id: WAKE }, { id: PLAIN }],
    p2: { id: WALL },
  });
}

/** `board` with p1's seat record set to `entries` (each a uid and a turn offset from now). */
function recorded(board: GameState, entries: readonly { uid: string; ago: number }[]): GameState {
  return {
    ...board,
    recentAttackers: {
      ...board.recentAttackers,
      p1: entries.map((e) => ({ turn: board.turn - e.ago, uid: e.uid })),
    },
  };
}

const benchTop = (state: GameState, i: number): string => top(state.players.p1.bench[i] as InPlayPokemon);
const dealt = (board: GameState): number => active(run(board, onslaught).state, "p2").damage;

describe("D579 Koraidon §1 — the clause is a LITERAL row; the note round-trips", () => {
  it("🛑 the printed sentence derives to +150 behind the new member", () => {
    expect(deriveAttackDamageBonus(ONSLAUGHT)).toEqual({ per: 150, count: { kind: "boardCondition", cond: COND } });
    expect(resolvedByAnyReader(ONSLAUGHT)).toBe(true);
  });

  it("the note is the printed clause minus the \"If\" (no pronoun to resolve)", () => {
    expect(conditionNote(COND)).toBe(CLAUSE);
  });

  it("the FUTURE twin is NOT a row — a whole-clause literal, never a template over the banner", () => {
    expect(
      deriveAttackDamageBonus(ONSLAUGHT.replace("Ancient", "Future")),
    ).toBeNull();
  });
});

describe("D579 Koraidon §2 — the record: written at the attack's end, idempotent, bounded", () => {
  it("🛑 a fresh board's record is empty on both seats (REQUIRED key, setup.ts)", () => {
    const created = createGame({ seed: 1, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
    if (!created.ok) throw new Error("createGame failed");
    expect(created.state.recentAttackers).toEqual({ p1: [], p2: [] });
  });

  it("🛑 an attack stamps `{ turn, uid }` for the ATTACKING body on the attacking seat — the turn it attacked on", () => {
    const board = koraidonBoard();
    const after = run(board, onslaught).state;
    expect(after.recentAttackers.p1).toEqual([{ turn: board.turn, uid: top(active(board, "p1")) }]);
    expect(after.recentAttackers.p2).toEqual([]);
  });

  it("entries older than the seat's previous turn are PRUNED at the write; last turn's are kept", () => {
    // Six turns later (parity kept), so every stamped turn is a real, POSITIVE turn number.
    const base = koraidonBoard();
    const board = recorded({ ...base, turn: base.turn + 6 }, [
      { uid: "ancient-history", ago: 4 },
      { uid: "last-turn", ago: 2 },
    ]);
    const after = run(board, onslaught).state;
    expect(after.recentAttackers.p1).toEqual([
      { turn: board.turn - 2, uid: "last-turn" },
      { turn: board.turn, uid: top(active(board, "p1")) },
    ]);
  });

  it("the append is IDEMPOTENT on (turn, uid): a body already stamped this turn is not stamped twice", () => {
    const board = koraidonBoard();
    const pre = recorded(board, [{ uid: top(active(board, "p1")), ago: 0 }]);
    const after = run(pre, onslaught).state;
    expect(after.recentAttackers.p1).toEqual([{ turn: board.turn, uid: top(active(board, "p1")) }]);
  });
});

describe("D579 Koraidon §3 — the discriminating rungs", () => {
  it("🛑 another Ancient Pokémon attacked LAST turn: 30 + 150 = 180", () => {
    const board = koraidonBoard();
    expect(dealt(recorded(board, [{ uid: benchTop(board, 0), ago: 2 }]))).toBe(180);
  });

  it("🛑 nobody attacked: the printed 30 alone", () => {
    expect(dealt(koraidonBoard())).toBe(30);
  });

  it("🛑 OTHER: Koraidon's OWN attack last turn does not count", () => {
    const board = koraidonBoard();
    expect(dealt(recorded(board, [{ uid: top(active(board, "p1")), ago: 2 }]))).toBe(30);
  });

  it("🛑 the BANNER: a non-Ancient attacker last turn does not count", () => {
    const board = koraidonBoard();
    expect(dealt(recorded(board, [{ uid: benchTop(board, 1), ago: 2 }]))).toBe(30);
  });

  it("🛑 the WINDOW: an Ancient attack TWO of your turns ago is not \"your last turn\"", () => {
    const board = koraidonBoard();
    expect(dealt(recorded(board, [{ uid: benchTop(board, 0), ago: 4 }]))).toBe(30);
  });

  it("🛑 R-1 READING B — the DEPARTED body: an Ancient attacker that has LEFT PLAY still counts", () => {
    const board = koraidonBoard();
    const departed = benchTop(board, 0);
    const gone = withSide(board, "p1", {
      bench: board.players.p1.bench.slice(1),
      discard: [...board.players.p1.discard, departed],
    });
    expect(gone.players.p1.bench.some((b) => b.stack.includes(departed))).toBe(false);
    expect(dealt(recorded(gone, [{ uid: departed, ago: 2 }]))).toBe(180);
  });

  it("the predicate itself, seat-relative: the OTHER seat reads its own (empty) record", () => {
    const board = recorded(koraidonBoard(), [{ uid: "x", ago: 2 }]);
    const wake = recorded(board, [{ uid: benchTop(board, 0), ago: 2 }]);
    expect(conditionHolds(wake, "p1", COND)).toBe(true);
    expect(conditionHolds(wake, "p2", COND)).toBe(false);
  });
});

describe("D579 Koraidon §4 — BOTH CARDS, end to end: Walking Wake Knocks ITSELF Out, Koraidon pays +150", () => {
  it("🛑 turn T: Undulating Slice puts 9 on a damaged Walking Wake (self-KO); turn T+2: the promoted Koraidon deals 180", () => {
    let state = table({
      p1: { id: WAKE, energy: [WATER, WATER, WATER], damage: 60 },
      p1Bench: [{ id: KORAIDON, energy: [C, C] }],
      p2: { id: WALL },
    });
    const wakeUid = top(active(state, "p1"));
    const turnT = state.turn;
    state = run(state, { type: "attack", seat: "p1", index: 1 }).state;
    const sliced = run(state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon", ref: { seat: "p1", spot: { spot: "active" } }, take: 9 },
    } as GameAction);
    state = sliced.state;
    expect(sliced.events.some((e) => e.type === "KNOCKED_OUT" && e.uid === wakeUid)).toBe(true);
    expect(active(state, "p2").damage).toBe(180);
    // The record survives the body (R-1, reading B).
    expect(state.recentAttackers.p1).toEqual([{ turn: turnT, uid: wakeUid }]);
    // p2 takes its Prize; Koraidon, p1's lone Benched body, is promoted (forced at one candidate);
    // p2's turn passes.
    if (state.phase.kind !== "ko:takePrizes") throw new Error(`expected ko:takePrizes, got ${state.phase.kind}`);
    state = run(state, { type: "takePrizes", seat: "p2", prizeIndices: [0] }).state;
    if (state.phase.kind === "ko:promote") state = run(state, { type: "promote", seat: "p1", benchIndex: 0 }).state;
    expect(state.cardIdByUid[top(active(state, "p1"))]).toBe(KORAIDON);
    if (state.phase.kind !== "turn:action" || state.phase.seat !== "p2") throw new Error("expected p2's turn");
    state = run(state, { type: "endTurn", seat: "p2" }).state;
    if (state.phase.kind !== "turn:action" || state.phase.seat !== "p1") throw new Error("expected p1's turn");
    expect(state.turn).toBe(turnT + 2);
    const before = active(state, "p2").damage;
    const hit = run(state, onslaught).state;
    expect(active(hit, "p2").damage - before).toBe(180);
  });
});

describe("D579 Koraidon §5 — `MATCH_RECORD_VERSION` 40 → 41: a v40 record THROWS on this deploy (D326)", () => {
  it("🛑 the constant is ~~41~~ ~~42~~ ~~43~~ ~~44~~ ~~45~~ 46 (🆕🆕🆕 D637 stepped it 45 → 46; D636 stepped it 44 → 45; D630 stepped it 43 → 44; D621 stepped it 42 → 43; D583 stepped it 41 → 42), read off the raw source", () => {
    const RAW: Record<string, string> = (
      import.meta as unknown as {
        glob(
          pattern: string | readonly string[],
          options: { query: "?raw"; import: "default"; eager: true },
        ): Record<string, string>;
      }
    ).glob("../../../apps/api/src/lobby/match.ts", { query: "?raw", import: "default", eager: true });
    const match = Object.values(RAW)[0] ?? "";
    expect(match).toContain("export const MATCH_RECORD_VERSION = 46;");
  });

  it("🛑 a v40-shaped state (no `recentAttackers`) throws at the first attack's end — retired, never read", () => {
    const board = koraidonBoard();
    const { recentAttackers: _dropped, ...v40 } = board;
    expect(() => applyAction(v40 as GameState, onslaught)).toThrow();
  });
});

describe("D579 Koraidon §6 — R-1b (⚠️ UNRULED): Angelite is NOT re-pointed, and the divergence is pinned", () => {
  it("the seat record keeps a departed attacker; the per-body stamp Angelite reads does not", () => {
    // 🆕🆕🆕 D579 REVIEW FIX — DISCRIMINATING: the same Walking Wake carries BOTH records (the
    // per-body `usedAttack` stamp D394 writes and the seat entry D579 writes), so the CONTROL
    // reads both members TRUE while the body stands; only its departure parts them. Without the
    // control the per-body `false` below would hold whether or not the body had left.
    const board = koraidonBoard();
    const wake = benchTop(board, 0);
    const lastTurn = board.turn - 2;
    const stamped = recorded(
      withSide(board, "p1", {
        bench: board.players.p1.bench.map((b, i) =>
          i === 0 ? { ...b, usedAttack: { name: "Undulating Slice", turn: lastTurn } } : b,
        ),
      }),
      [{ uid: wake, ago: 2 }],
    );
    const angelite = { kind: "yourPokemonUsedAttackLastTurn", attack: "Undulating Slice" } as const;
    // CONTROL — the body is present: both members read TRUE.
    expect(conditionHolds(stamped, "p1", COND)).toBe(true);
    expect(conditionHolds(stamped, "p1", angelite)).toBe(true);
    // The body leaves play; the seat record is untouched.
    const gone = withSide(stamped, "p1", {
      bench: stamped.players.p1.bench.slice(1),
      discard: [...stamped.players.p1.discard, wake],
    });
    expect(gone.recentAttackers.p1).toEqual([{ turn: lastTurn, uid: wake }]);
    // Koraidon's member (reading B) still sees it…
    expect(conditionHolds(gone, "p1", COND)).toBe(true);
    // …while Angelite's member (D396, the per-body `usedAttack`) lost it with the body.
    expect(conditionHolds(gone, "p1", angelite)).toBe(false);
  });
});
