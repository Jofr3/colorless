import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import type { GameAction, GameEvent, GameState } from "./index";
import { applyAction } from "./index";
import { programFor } from "./registry";
import {
  FIXTURE_POOL,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  mustApply,
  setActiveFromDeck,
  setDamage,
  typedEnergy,
  must,
  driveSetup,
} from "./testFixtures";

const OH_NO_TEXT =
  "If this Pokémon is Knocked Out by damage from an attack from your opponent's Pokémon, and if you have any Pecharunt ex in play, your opponent takes 1 fewer Prize card.";
const TERMINAL_TEXT =
  "If your opponent's Active Pokémon has exactly 6 damage counters on it, that Pokémon is Knocked Out.";
const CLAW_TEXT = "Your opponent reveals their hand, and you discard a card you find there.";
const HANDS_TEXT = "Choose 2 of your opponent's Pokémon and put 3 damage counters on each of them.";

const MUNKIDORI_IDS = ["sv06.5-037", "sv06.5-083", "sv06.5-091"] as const;
const PECHARUNT = "sv06.5-039";
const ABSOL = "me01-086";
const MIMIKYU = "sv09-069";
const DARK = "b20-darkness-energy";
const PSYCHIC = "b20-psychic-energy";
const FILLER = "b20-filler";

const munkidori = FIXTURE_POOL["sv06.5-037"];
if (munkidori === undefined) throw new Error("FIXTURE_POOL lacks Munkidori ex sv06.5-037");

const LOCAL: Record<string, Card> = {
  ...Object.fromEntries(MUNKIDORI_IDS.map((id) => [id, { ...munkidori, id }])),
  [DARK]: typedEnergy(DARK, "Darkness"),
  [PSYCHIC]: typedEnergy(PSYCHIC, "Psychic"),
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
  [MIMIKYU]: battler(MIMIKYU, {
    name: "Mimikyu ex",
    hp: 190,
    types: ["Psychic"],
    retreat: 1,
    weaknesses: [{ type: "Darkness", value: "×2" }],
    attacks: [
      { cost: ["Psychic", "Colorless"], name: "Mischievous Hands", effect: HANDS_TEXT },
      {
        cost: ["Psychic", "Psychic", "Colorless"],
        name: "Ghostly Trip",
        effect: "Your opponent's Active Pokémon is now Confused.",
        damage: 120,
      },
    ],
  }),
  [FILLER]: battler(FILLER, {
    name: "B20 Filler",
    hp: 200,
    types: ["Colorless"],
    retreat: 1,
    attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
  }),
};
const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL };

const DECK = deckOf({
  ...Object.fromEntries(MUNKIDORI_IDS.map((id) => [id, 1])),
  [PECHARUNT]: 1,
  [ABSOL]: 1,
  [MIMIKYU]: 1,
  [DARK]: 4,
  [PSYCHIC]: 4,
  [FILLER]: 27,
  "fix-energy": 19, // 60 cards
});

function p1Turn(): GameState {
  let state = driveSetup(2020, { p1: DECK, p2: DECK }, { pool: POOL, first: "p1" });
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

function board(holder: string, attacker: string, energy: string, damage: number): GameState {
  let state = clearBench(setActiveFromDeck(p1Turn(), "p1", attacker), "p1");
  state = attachFromDeck(state, "p1", energy, 3);
  state = clearBench(setActiveFromDeck(state, "p2", holder), "p2");
  state = benchFromDeck(state, "p2", PECHARUNT);
  state = benchFromDeck(state, "p2", FILLER);
  return setDamage(state, "p2", damage);
}

const terminalPeriod: GameAction = { type: "attack", seat: "p1", index: 0 };
const clawOfDarkness: GameAction = { type: "attack", seat: "p1", index: 1 };
const mischievousHands: GameAction = { type: "attack", seat: "p1", index: 0 };
const ofType = <T extends GameEvent["type"]>(events: readonly GameEvent[], type: T) =>
  events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);

describe('B20 §1 — Munkidori ex "Oh No You Don\'t": a damage-free Knock Out is not "Knocked Out by damage from an attack"', () => {
  it("every printing carries the printed sentence and the one `onKoPrizeReduction` row", () => {
    for (const id of MUNKIDORI_IDS) {
      expect(POOL[id]?.abilities?.[0]?.effect, id).toBe(OH_NO_TEXT);
      expect(programFor(id)?.triggered, id).toEqual([
        {
          name: "Oh No You Don't",
          trigger: "onKnockOut",
          program: [],
          onKoPrizeReduction: { by: 1, requiresInPlay: "Pecharunt ex" },
        },
      ]);
    }
  });

  it.each(MUNKIDORI_IDS)(
    '%s: Terminal Period\'s "that Pokémon is Knocked Out" (no damage) reduces NOTHING — P1 takes both Prizes',
    (id) => {
      const { events } = mustApply(board(id, ABSOL, DARK, 60), terminalPeriod);
      expect(ofType(events, "DAMAGE_DEALT")).toEqual([]);
      expect(ofType(events, "KNOCKED_OUT")).toHaveLength(1);
      expect(ofType(events, "ABILITY_TRIGGERED")).toEqual([]);
      expect(ofType(events, "PRIZE_REDUCED")).toEqual([]);
      expect(ofType(events, "PRIZES_OWED")).toEqual([
        { type: "PRIZES_OWED", seat: "p1", count: 2 },
      ]);
    },
  );

  it.each(MUNKIDORI_IDS)(
    "%s, the control: Claw of Darkness's 200 damage Knocks it Out BY DAMAGE, and P1 takes 1 fewer",
    (id) => {
      const { events } = mustApply(board(id, ABSOL, DARK, 60), clawOfDarkness);
      expect(ofType(events, "KNOCKED_OUT")).toHaveLength(1);
      expect(ofType(events, "ABILITY_TRIGGERED")).toEqual([
        {
          type: "ABILITY_TRIGGERED",
          seat: "p2",
          uid: expect.any(String),
          ability: "Oh No You Don't",
        },
      ]);
      expect(ofType(events, "PRIZES_OWED")).toEqual([
        { type: "PRIZES_OWED", seat: "p1", count: 1 },
      ]);
    },
  );
});

describe('B20 §2 — R-PD1 UNRULED, pinned and NOT changed: a Knock Out from counters an attack placed counts as "by damage"', () => {
  it("Mischievous Hands' 3 counters on a 200-damage Munkidori ex take 1 fewer Prize (the recorded reading)", () => {
    const state = board("sv06.5-037", MIMIKYU, PSYCHIC, 200);
    const parked = mustApply(state, mischievousHands).state;
    if (parked.phase.kind !== "effect:choose")
      throw new Error(`expected effect:choose, got ${parked.phase.kind}`);
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "choosePokemonMulti") throw new Error(`unexpected prompt ${prompt.kind}`);
    const active = prompt.candidates.find((ref) => ref.spot.spot === "active");
    const bench = prompt.candidates.find((ref) => ref.spot.spot === "bench");
    if (active === undefined || bench === undefined)
      throw new Error("expected Active and Bench candidates");
    const { events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [active, bench] },
    });
    expect(ofType(events, "DAMAGE_DEALT")).toEqual([]);
    expect(ofType(events, "KNOCKED_OUT")).toHaveLength(1);
    expect(ofType(events, "PRIZES_OWED")).toEqual([{ type: "PRIZES_OWED", seat: "p1", count: 1 }]);
  });
});
