import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import type { GameAction, GameEvent, GameState } from "./index";
import { applyAction, createGame } from "./index";
import { programFor } from "./registry";
import {
  FIXTURE_POOL,
  attachFromDeck,
  attachToolFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  mustApply,
  setActiveFromDeck,
  setDamage,
  trainerCard,
  typedEnergy,
} from "./testFixtures";

// ── CARD REVISION, BATCH B07 (Tools + Special Energy) ──
//
// The verified finding from the per-unit audit (docs/reference/card-revision.md "B07"), driven on a
// real board through `applyAction` and asserted against the PRINTED text (local D1 `cards.effect` /
// `attacks_json`, byte for byte below):
//   §1 Heavy Baton `sv05-151` — "… and is Knocked Out by damage from an attack from your opponent's
//      Pokémon …": a damage-free "that Pokémon is Knocked Out" (Mega Absol ex `me01-086` "Terminal
//      Period", a `knockOutDefender` doom) offered the move. flow.ts `runKoToolTrigger` now refuses a
//      `knockOutDefender` doom (`lethalByEffect`) for EVERY entry of the KO-moment scan, not only the
//      Ability arm (Miraidon "Photon Cord", R-PHC1) — the reading Amulet of Hope already had (R-AH).

const BATON_TEXT =
  "If the Pokémon this card is attached to has a Retreat Cost of exactly 4, is in the Active Spot, and is Knocked Out by damage from an attack from your opponent's Pokémon, move up to 3 Basic Energy cards from that Pokémon to your Benched Pokémon in any way you like.";
const TERMINAL_TEXT =
  "If your opponent's Active Pokémon has exactly 6 damage counters on it, that Pokémon is Knocked Out.";
const CLAW_TEXT = "Your opponent reveals their hand, and you discard a card you find there.";

const BATON = "sv05-151";
const ABSOL = "me01-086";
const ONIX = "me01-070";
const DARK = "b07-darkness-energy";
const FILLER = "b07-filler";

const LOCAL: Record<string, Card> = {
  [BATON]: { ...trainerCard(BATON, "Tool", BATON_TEXT), name: "Heavy Baton" },
  [DARK]: typedEnergy(DARK, "Darkness"),
  [ABSOL]: battler(ABSOL, {
    name: "Mega Absol ex",
    hp: 280,
    types: ["Darkness"],
    retreat: 2,
    weaknesses: [{ type: "Grass", value: "×2" }],
    attacks: [
      { cost: ["Darkness", "Colorless"], name: "Terminal Period", effect: TERMINAL_TEXT },
      {
        cost: ["Darkness", "Darkness", "Colorless"],
        name: "Claw of Darkness",
        effect: CLAW_TEXT,
        damage: 200,
      },
    ],
  }),
  [ONIX]: battler(ONIX, {
    name: "Onix",
    hp: 120,
    types: ["Fighting"],
    retreat: 4,
    weaknesses: [{ type: "Grass", value: "×2" }],
    attacks: [
      {
        cost: ["Colorless", "Colorless"],
        name: "Bind",
        effect: "Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed.",
        damage: 30,
      },
      { cost: ["Colorless", "Colorless", "Colorless", "Colorless"], name: "Strength", damage: 100 },
    ],
  }),
  [FILLER]: battler(FILLER, {
    name: "B07 Filler",
    hp: 200,
    types: ["Colorless"],
    retreat: 1,
    attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
  }),
};
const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL };

const DECK = deckOf({
  [BATON]: 2,
  [ABSOL]: 2,
  [ONIX]: 2,
  [DARK]: 6,
  [FILLER]: 28,
  "fix-energy": 20, // 60 cards
});

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

/** Setup with P1 first, then P1's SECOND turn (turn 3). Hands, prizes and discards back into the
    deck; six `fix-energy` make each prize row. */
function p1Turn(): GameState {
  const created = createGame({ seed: 707, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
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

/** P1's Active is Mega Absol ex with three Darkness Energy (both attacks paid); P2's Active is Onix
    (printed Retreat Cost 4) carrying Heavy Baton, three Basic Energy and `damage`, one Filler benched. */
function board(damage: number): GameState {
  let state = clearBench(setActiveFromDeck(p1Turn(), "p1", ABSOL), "p1");
  state = attachFromDeck(state, "p1", DARK, 3);
  state = clearBench(setActiveFromDeck(state, "p2", ONIX), "p2");
  state = benchFromDeck(state, "p2", FILLER);
  state = attachToolFromDeck(state, "p2", "active", BATON);
  state = attachFromDeck(state, "p2", "fix-energy", 3);
  return setDamage(state, "p2", damage);
}

const terminalPeriod: GameAction = { type: "attack", seat: "p1", index: 0 };
const clawOfDarkness: GameAction = { type: "attack", seat: "p1", index: 1 };
const knockOuts = (events: readonly GameEvent[]) =>
  events.filter((e): e is Extract<GameEvent, { type: "KNOCKED_OUT" }> => e.type === "KNOCKED_OUT");

describe('B07 §1 — Heavy Baton: "… and is Knocked Out by damage from an attack from your opponent\'s Pokémon …"', () => {
  it("the row is the self-timing move this suite drives (registry unchanged)", () => {
    expect(programFor(BATON)?.triggered?.[0]?.trigger).toBe("onHolderActiveKnockedOut");
  });

  it('🛑 Terminal Period\'s damage-free "that Pokémon is Knocked Out" offers NO move: the Onix goes down with its three Energy', () => {
    const state = board(60);
    const energy = state.players.p2.active?.energy ?? [];
    expect(energy).toHaveLength(3);
    const { state: after, events } = mustApply(state, terminalPeriod);
    expect(events.some((e) => e.type === "DAMAGE_DEALT")).toBe(false);
    expect(after.phase.kind).not.toBe("effect:choose");
    expect(events.some((e) => e.type === "ENERGY_MOVED")).toBe(false);
    const ko = knockOuts(events);
    expect(ko).toHaveLength(1);
    expect(ko[0]?.discarded).toEqual(expect.arrayContaining([...energy]));
    expect(after.players.p2.bench.flatMap((p) => p.energy)).toEqual([]);
  });

  it("🛑 the control: Claw of Darkness's 200 damage Knocks the same Onix Out BY DAMAGE, and the Baton's move parks for P2", () => {
    const state = board(60);
    const energy = state.players.p2.active?.energy ?? [];
    const { state: after } = mustApply(state, clawOfDarkness);
    if (after.phase.kind !== "effect:choose")
      throw new Error(`expected effect:choose, got ${after.phase.kind}`);
    expect(after.phase.seat).toBe("p2");
    const prompt = after.phase.prompt;
    if (prompt.kind !== "moveEnergy") throw new Error(`expected moveEnergy, got ${prompt.kind}`);
    expect(prompt.movable.map((m) => m.uid).sort()).toEqual([...energy].sort());
    expect(prompt.max).toBe(3);
  });
});
