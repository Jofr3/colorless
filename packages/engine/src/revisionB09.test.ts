import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import type { GameEvent, GameState, InPlayPokemon, Seat } from "./index";
import { applyAction, createGame, effectiveRetreatCost } from "./index";
import { programFor } from "./registry";
import {
  FIXTURE_POOL,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  handFromDeck,
  mustApply,
  setActiveFromDeck,
  trainerCard,
} from "./testFixtures";

// ── CARD REVISION, BATCH B09 (Stadiums) ──
//
// The verified finding from the per-unit audit (docs/reference/card-revision.md "B09"), driven on a
// real board through `applyAction` and asserted against the PRINTED text (local D1 `cards.effect`,
// byte for byte below):
//   §1 Paradise Resort `svp-045` — the mark-G promo had no registry row and was refused as
//      TRAINER_NOT_SIMULATED, although it is `legal_standard_effective = 1` since 714256b3:
//      `legal_standard = 0`, print_key `f6d5263097478251`, shared with the authored `svp-150`,
//      `svp-224` and `mep-092` (B05's `mfb-33` Potion defect, on a Stadium).

const PARADISE_TEXT =
  "The Retreat Cost of each Psyduck in play (both yours and your opponent's) is {C} less.";
/** Every Paradise Resort printing on the local D1 (measured 2026-10-19), the authored twin first. */
const PARADISE_IDS = ["svp-150", "svp-224", "mep-092", "svp-045"] as const;

const PSYDUCK = "mep-007";
const GOLDUCK = "mep-008";
const FILLER = "b09-filler";

const LOCAL: Record<string, Card> = {
  ...Object.fromEntries(
    PARADISE_IDS.map((id) => [
      id,
      { ...trainerCard(id, "Stadium", PARADISE_TEXT), name: "Paradise Resort" },
    ]),
  ),
  [PSYDUCK]: battler(PSYDUCK, {
    name: "Psyduck",
    hp: 70,
    types: ["Water"],
    retreat: 1,
    attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
  }),
  [GOLDUCK]: battler(GOLDUCK, {
    name: "Golduck",
    stage: "Stage1",
    evolveFrom: "Psyduck",
    hp: 120,
    types: ["Water"],
    retreat: 1,
    attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
  }),
  [FILLER]: battler(FILLER, {
    name: "B09 Filler",
    hp: 200,
    types: ["Colorless"],
    retreat: 1,
    attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
  }),
};
const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL };

const DECK = deckOf({
  ...Object.fromEntries(PARADISE_IDS.map((id) => [id, 1])),
  [PSYDUCK]: 4,
  [GOLDUCK]: 4,
  [FILLER]: 12,
  "fix-energy": 36, // 60 cards
});

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

/** Setup with P1 first, then P1's SECOND turn (turn 3). Hands, prizes and discards back into the
    deck; six `fix-energy` make each prize row. */
function p1Turn(): GameState {
  const created = createGame({ seed: 909, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(
    applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first: "p1" }),
  );
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
  for (const s of ["p1", "p2"] as const)
    state = must(applyAction(state, { type: "setupReady", seat: s }));
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
        [s]: {
          ...side,
          hand: [],
          discard: [],
          prizes,
          deck: pile.filter((u) => !prizes.includes(u)),
        },
      },
    };
  }
  return state;
}

/** P1: Active Psyduck, Bench [Golduck, Filler]. P2: Active Psyduck, Bench [Filler]. No Energy
    anywhere, so a Retreat Cost of 1 cannot be paid and a Retreat Cost of 0 can. */
function board(): GameState {
  let state = clearBench(setActiveFromDeck(p1Turn(), "p1", PSYDUCK), "p1");
  state = benchFromDeck(benchFromDeck(state, "p1", GOLDUCK), "p1", FILLER);
  state = clearBench(setActiveFromDeck(state, "p2", PSYDUCK), "p2");
  return benchFromDeck(state, "p2", FILLER);
}

const idOf = (state: GameState, uid: string | undefined) =>
  uid === undefined ? undefined : state.cardIdByUid[uid];

function at(state: GameState, seat: Seat, spot: "active" | number = "active"): InPlayPokemon {
  const side = state.players[seat];
  const found = spot === "active" ? side.active : side.bench[spot];
  if (found === null || found === undefined) throw new Error(`${seat} has no body at ${spot}`);
  return found;
}
const rc = (state: GameState, seat: Seat, spot: "active" | number = "active") =>
  effectiveRetreatCost(state, at(state, seat, spot));

function play(
  state: GameState,
  id: string,
): { state: GameState; events: GameEvent[]; uid: string } {
  const next = handFromDeck(state, "p1", id, 1);
  const uid = next.players.p1.hand.find((u) => idOf(next, u) === id) as string;
  return { ...mustApply(next, { type: "playTrainer", seat: "p1", uid }), uid };
}

describe("B09 §1 — every Standard-legal printing of Paradise Resort runs its twin's program", () => {
  it("each printing resolves to the SAME program object as the authored `svp-150`", () => {
    const twin = programFor("svp-150");
    expect(twin).toEqual({
      stadium: { retreat: { filter: { kind: "byName", name: "Psyduck" }, discount: 1 } },
    });
    for (const id of PARADISE_IDS) expect(programFor(id), id).toBe(twin);
  });

  it("the CONTROL — with no Stadium in play every body keeps its printed Retreat Cost of 1", () => {
    const state = board();
    expect(state.stadium).toBeNull();
    expect([rc(state, "p1"), rc(state, "p1", 0), rc(state, "p1", 1), rc(state, "p2")]).toEqual([
      1, 1, 1, 1,
    ]);
    const refused = applyAction(state, {
      type: "retreat",
      seat: "p1",
      discardEnergy: [],
      promoteBenchIndex: 1,
    });
    expect(refused.ok).toBe(false);
  });

  it.each(PARADISE_IDS)(
    "Paradise Resort %s is played from the hand as a Stadium and stays in play",
    (id) => {
      const { state, events, uid } = play(board(), id);
      expect(events.find((e) => e.type === "TRAINER_PLAYED")).toMatchObject({
        uid,
        trainerType: "Stadium",
      });
      expect(state.stadium).toEqual({ uid, owner: "p1" });
      expect(state.players.p1.hand).not.toContain(uid);
      expect(state.players.p1.discard).not.toContain(uid);
    },
  );

  it.each(PARADISE_IDS)(
    'Paradise Resort %s: "The Retreat Cost of each Psyduck in play (both yours and your opponent\'s) is {C} less."',
    (id) => {
      const { state } = play(board(), id);
      // each Psyduck — yours AND your opponent's — 1 → 0; Golduck and the Filler are not Psyduck.
      expect(rc(state, "p1")).toBe(0);
      expect(rc(state, "p2")).toBe(0);
      expect(rc(state, "p1", 0)).toBe(1);
      expect(rc(state, "p1", 1)).toBe(1);
      expect(rc(state, "p2", 0)).toBe(1);
      // …and the 0 is paid: the Energy-less Psyduck retreats, the Filler comes up.
      const { state: retreated } = mustApply(state, {
        type: "retreat",
        seat: "p1",
        discardEnergy: [],
        promoteBenchIndex: 1,
      });
      expect(idOf(retreated, retreated.players.p1.active?.stack[0])).toBe(FILLER);
      expect(retreated.players.p1.bench.map((b) => idOf(retreated, b.stack[0]))).toContain(PSYDUCK);
    },
  );
});
