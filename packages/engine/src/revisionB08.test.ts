import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import type { GameAction, GameEvent, GameState } from "./index";
import { ANY_ENERGY, applyAction, createGame, providedEnergy } from "./index";
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
  setPrizes,
  specialEnergy,
  trainerCard,
  typedEnergy,
} from "./testFixtures";

// ── CARD REVISION, BATCH B08 (Tools + Special Energy) ──
//
// The verified findings from the per-unit audit (docs/reference/card-revision.md "B08"), driven on
// a real board through `applyAction` and asserted against the PRINTED text (local D1 `cards.effect`
// / `attacks_json`, byte for byte below):
//   §1 Lillie's Pearl `sv09-151` and §2 Legacy Energy `sv06-167` — "… is Knocked Out by damage from
//      an attack from your opponent's Pokémon, that player takes 1 fewer Prize card": a damage-free
//      "that Pokémon is Knocked Out" (Mega Absol ex `me01-086` "Terminal Period", a
//      `knockOutDefender` doom) reduced the Prize count, and for Legacy Energy spent its once-per-game
//      latch. flow.ts `attachedPrizeReductions` now asks `koByOpponentAttack` (the predicate Shadowy
//      Concealment and Amulet of Hope already read), so a `lethalByEffect` body reduces nothing.
//   §3 Reversal Energy `sv02-192` — `legal_standard_effective = 1` since 714256b3 (print_key
//      `c22445438109bc4e`, shared with the authored `sv04-266`) but had no registry row, so it fell
//      into `unitsOf`'s unauthored Special Energy branch and always provided one {C}.

const PEARL_TEXT =
  "If the Lillie's Pokémon this card is attached to is Knocked Out by damage from an attack from your opponent's Pokémon, that player takes 1 fewer Prize card.";
const LEGACY_TEXT =
  "As long as this card is attached to a Pokémon, it provides every type of Energy but provides only 1 Energy at a time.\n\nIf the Pokémon this card is attached to is Knocked Out by damage from an attack from your opponent's Pokémon, that player takes 1 fewer Prize card. This effect of your Legacy Energy can't be applied more than once per game.";
const REVERSAL_TEXT =
  "As long as this card is attached to a Pokémon, it provides {C} Energy.\n\nIf you have more Prize cards remaining than your opponent, and if this card is attached to an Evolution Pokémon that doesn't have a Rule Box (Pokémon ex, Pokémon V, etc. have Rule Boxes), this card provides every type of Energy but provides only 3 Energy at a time.";
const TERMINAL_TEXT =
  "If your opponent's Active Pokémon has exactly 6 damage counters on it, that Pokémon is Knocked Out.";
const CLAW_TEXT = "Your opponent reveals their hand, and you discard a card you find there.";

const PEARL = "sv09-151";
const LEGACY = "sv06-167";
/** Every Reversal Energy printing on the local D1 (measured 2026-10-19), the authored twin first. */
const REVERSAL_IDS = ["sv04-266", "sv02-192"] as const;
const ABSOL = "me01-086";
const CLEFAIRY = "sv09-056";
const DARKRAI = "svp-110";
const KADABRA = "b08-kadabra";
const STRIKER = "b08-striker";
const DARK = "b08-darkness-energy";
const FILLER = "b08-filler";

const LOCAL: Record<string, Card> = {
  [PEARL]: { ...trainerCard(PEARL, "Tool", PEARL_TEXT), name: "Lillie's Pearl" },
  [LEGACY]: specialEnergy(LEGACY, "Legacy Energy", LEGACY_TEXT),
  ...Object.fromEntries(
    REVERSAL_IDS.map((id) => [id, specialEnergy(id, "Reversal Energy", REVERSAL_TEXT)]),
  ),
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
  [CLEFAIRY]: battler(CLEFAIRY, {
    name: "Lillie's Clefairy ex",
    hp: 190,
    types: ["Psychic"],
    retreat: 1,
    weaknesses: [{ type: "Metal", value: "×2" }],
    attacks: [
      {
        cost: ["Psychic", "Colorless"],
        name: "Full Moon Rondo",
        effect:
          "This attack does 20 more damage for each Benched Pokémon (both yours and your opponent's).",
        damage: 20,
      },
    ],
  }),
  [DARKRAI]: battler(DARKRAI, {
    name: "Darkrai ex",
    hp: 210,
    types: ["Darkness"],
    retreat: 2,
    weaknesses: [{ type: "Grass", value: "×2" }],
    attacks: [
      { cost: ["Darkness", "Colorless"], name: "Wind of Darkness", damage: 40 },
      { cost: ["Darkness", "Darkness", "Colorless"], name: "Night Impact", damage: 110 },
    ],
  }),
  /** A no-Rule-Box EVOLUTION holder, and the {P}{W}{F} cost only three wildcard units can pay. */
  [KADABRA]: battler(KADABRA, {
    name: "Kadabra",
    stage: "Stage1",
    evolveFrom: FILLER,
    hp: 80,
    types: ["Psychic"],
    attacks: [{ cost: ["Psychic", "Water", "Fighting"], name: "B08 Triple", damage: 30 }],
  }),
  /** The same cost on a BASIC holder — the term-1 near miss. */
  [STRIKER]: battler(STRIKER, {
    name: "B08 Striker",
    hp: 80,
    types: ["Psychic"],
    attacks: [{ cost: ["Psychic", "Water", "Fighting"], name: "B08 Triple", damage: 30 }],
  }),
  [FILLER]: battler(FILLER, {
    name: "B08 Filler",
    hp: 200,
    types: ["Colorless"],
    retreat: 1,
    attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
  }),
};
const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL };

const DECK = deckOf({
  [PEARL]: 1,
  [LEGACY]: 1,
  ...Object.fromEntries(REVERSAL_IDS.map((id) => [id, 1])),
  [ABSOL]: 1,
  [CLEFAIRY]: 1,
  [DARKRAI]: 1,
  [KADABRA]: 1,
  [STRIKER]: 1,
  [DARK]: 4,
  [FILLER]: 27,
  "fix-energy": 20, // 60 cards
});

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

/** Setup with P1 first, then P1's SECOND turn (turn 3). Hands, prizes and discards back into the
    deck; six `fix-energy` make each prize row. */
function p1Turn(): GameState {
  const created = createGame({ seed: 808, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
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

/** P1's Active is Mega Absol ex with three Darkness Energy (both attacks paid); P2's Active is
    `holder` with `dress` applied and 60 damage (exactly 6 counters), one Filler benched. */
function absolBoard(holder: string, dress: (state: GameState) => GameState): GameState {
  let state = clearBench(setActiveFromDeck(p1Turn(), "p1", ABSOL), "p1");
  state = attachFromDeck(state, "p1", DARK, 3);
  state = clearBench(setActiveFromDeck(state, "p2", holder), "p2");
  state = benchFromDeck(state, "p2", FILLER);
  return setDamage(dress(state), "p2", 60);
}
const pearlBoard = () =>
  absolBoard(CLEFAIRY, (state) => attachToolFromDeck(state, "p2", "active", PEARL));
const legacyBoard = () => absolBoard(DARKRAI, (state) => attachFromDeck(state, "p2", LEGACY, 1));

const terminalPeriod: GameAction = { type: "attack", seat: "p1", index: 0 };
const clawOfDarkness: GameAction = { type: "attack", seat: "p1", index: 1 };
const ofType = <T extends GameEvent["type"]>(events: readonly GameEvent[], type: T) =>
  events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);

describe("B08 §1 — Lillie's Pearl: \"… is Knocked Out by damage from an attack from your opponent's Pokémon, that player takes 1 fewer Prize card.\"", () => {
  it("the row is the attached reduction this suite drives (registry unchanged)", () => {
    expect(programFor(PEARL)?.passive).toMatchObject({
      onKoPrizeReduction: { by: 1, requiresHolderOwner: "Lillie" },
    });
  });

  it('🛑 Terminal Period\'s damage-free "that Pokémon is Knocked Out" reduces NOTHING: P1 takes both Prizes for the ex', () => {
    const { events } = mustApply(pearlBoard(), terminalPeriod);
    expect(ofType(events, "DAMAGE_DEALT")).toEqual([]);
    expect(ofType(events, "KNOCKED_OUT")).toHaveLength(1);
    expect(ofType(events, "PRIZE_REDUCED")).toEqual([]);
    expect(ofType(events, "PRIZES_OWED")).toEqual([{ type: "PRIZES_OWED", seat: "p1", count: 2 }]);
  });

  it("🛑 the control: Claw of Darkness's 200 damage Knocks the same Clefairy ex Out BY DAMAGE, and P1 takes 1 fewer", () => {
    const { events } = mustApply(pearlBoard(), clawOfDarkness);
    expect(ofType(events, "KNOCKED_OUT")).toHaveLength(1);
    expect(ofType(events, "PRIZE_REDUCED")).toEqual([
      { type: "PRIZE_REDUCED", seat: "p2", uid: expect.any(String), by: 1, count: 1 },
    ]);
    expect(ofType(events, "PRIZES_OWED")).toEqual([{ type: "PRIZES_OWED", seat: "p1", count: 1 }]);
  });
});

describe('B08 §2 — Legacy Energy: "… Knocked Out by damage from an attack … This effect of your Legacy Energy can\'t be applied more than once per game."', () => {
  it("🛑 Terminal Period's damage-free Knock Out reduces NOTHING and leaves the once-per-game latch UNSPENT", () => {
    const { state: after, events } = mustApply(legacyBoard(), terminalPeriod);
    expect(ofType(events, "DAMAGE_DEALT")).toEqual([]);
    expect(ofType(events, "KNOCKED_OUT")).toHaveLength(1);
    expect(ofType(events, "PRIZE_REDUCED")).toEqual([]);
    expect(ofType(events, "PRIZES_OWED")).toEqual([{ type: "PRIZES_OWED", seat: "p1", count: 2 }]);
    expect(after.oncePerGameSpent).toEqual({ p1: [], p2: [] });
  });

  it("🛑 the control: Claw of Darkness's damage Knock Out reduces 2 → 1 and spends the latch", () => {
    const { state: after, events } = mustApply(legacyBoard(), clawOfDarkness);
    expect(ofType(events, "PRIZE_REDUCED")).toEqual([
      { type: "PRIZE_REDUCED", seat: "p2", uid: expect.any(String), by: 1, count: 1 },
    ]);
    expect(ofType(events, "PRIZES_OWED")).toEqual([{ type: "PRIZES_OWED", seat: "p1", count: 1 }]);
    expect(after.oncePerGameSpent).toEqual({ p1: [], p2: ["Legacy Energy"] });
  });
});

/** P1's Active is `body` holding one copy of `energy`; P1 keeps 6 Prizes, P2 is cut to `p2Prizes`. */
function reversalBoard(body: string, energy: string, p2Prizes: number): GameState {
  let state = clearBench(setActiveFromDeck(p1Turn(), "p1", body), "p1");
  state = attachFromDeck(state, "p1", energy, 1);
  state = clearBench(setActiveFromDeck(state, "p2", FILLER), "p2");
  return setPrizes(state, "p2", p2Prizes);
}
const p1Active = (state: GameState) => {
  const active = state.players.p1.active;
  if (active === null) throw new Error("p1 has no Active Pokémon");
  return active;
};

describe("B08 §3 — every Standard-legal printing of Reversal Energy runs its twin's program", () => {
  it("each printing resolves to the SAME program object as the authored `sv04-266`", () => {
    const twin = programFor("sv04-266");
    expect(twin?.energy).toBeDefined();
    for (const id of REVERSAL_IDS) expect(programFor(id), id).toBe(twin);
  });

  it.each(REVERSAL_IDS)(
    "Reversal Energy %s: behind on Prizes (6 to 3) on a no-Rule-Box Evolution — every type, only 3 at a time, and {P}{W}{F} is paid",
    (id) => {
      const state = reversalBoard(KADABRA, id, 3);
      expect(providedEnergy(state, p1Active(state))).toEqual([ANY_ENERGY, ANY_ENERGY, ANY_ENERGY]);
      const { events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
      expect(ofType(events, "DAMAGE_DEALT")).toHaveLength(1);
    },
  );

  it.each(REVERSAL_IDS)(
    "Reversal Energy %s: level on Prizes, or on a Basic — it provides {C} only, and {P}{W}{F} is refused",
    (id) => {
      const level = reversalBoard(KADABRA, id, 6);
      expect(providedEnergy(level, p1Active(level))).toEqual(["Colorless"]);
      const basic = reversalBoard(STRIKER, id, 3);
      expect(providedEnergy(basic, p1Active(basic))).toEqual(["Colorless"]);
      const refused = applyAction(basic, { type: "attack", seat: "p1", index: 0 });
      expect(refused.ok).toBe(false);
      if (!refused.ok) expect(refused.error.code).toBe("ATTACK_COST_UNMET");
    },
  );
});
