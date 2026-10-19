import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import type { GameAction, GameEvent, GameState } from "./index";
import { applyAction, createGame } from "./index";
import { battler, completeSetup, deckOf, typedEnergy } from "./testFixtures";
import { type InPlayPokemon, makeInPlay } from "./types";

// ── CARD REVISION, BATCH B51 (Attacks) ──
//
// The audit finding (docs/reference/card-revision.md "B51"), driven on a real board through
// `applyAction` and asserted against the PRINTED text (local D1 `cards.attacks_json`, byte for byte
// below). NOTHING WAS CHANGED IN THE ENGINE: the finding was DEFERRED, and this suite pins the current
// reading on every printing.
//   §1 *"You may draw cards until you have 6 cards in your hand."* (Thievul "Greedy Hunt", Mismagius ex
//      "Hexa-Magic", Cynthia's Garchomp ex "Corkscrew Dive", Blissey ex / Lumineon / Audino "Return"),
//      *"… until you have 5 cards …"* (Deoxys "Psyspeed") and *"You may draw 5 cards."* (Cyclizar ex
//      "Zircon Road"). The derived `optional` parks its Yes / No on EVERY board, including the two on
//      which "yes" draws nothing: a hand already holding the printed size (`drawUntilHandSize` never
//      trims), and an empty deck. That is the recorded D186 / D202 design ("the engine may not decide a
//      printed 'may' on the player's behalf by peeking at their hand"), pinned by
//      `optionalConfirm.test.ts` "ALWAYS parks …" and `optionalDraw.test.ts` "draws only up to the
//      printed size …". So the prompt stays, and §1 pins it: the question is asked, and both answers
//      reach the same board, so nothing about the game depends on it. Reversal recipe in the doc.
//   §2 the controls: with a draw available the confirm parks with the printed sentence as its note,
//      "yes" draws to the printed size (or the printed 5), and "no" draws nothing.

const UNTIL_6 = "You may draw cards until you have 6 cards in your hand.";
const UNTIL_5 = "You may draw cards until you have 5 cards in your hand.";
const DRAW_5 = "You may draw 5 cards.";

/** A printed cost symbol, as `attacks_json` spells it. */
type EnergyType = string;

type Printing = {
  id: string;
  name: string;
  attack: string;
  index: number;
  cost: EnergyType[];
  damage: number;
  text: string;
  /** The printed hand size for "until you have N", absent for the flat "draw 5". */
  size?: number;
};

const C: EnergyType = "Colorless";
const P: EnergyType = "Psychic";
const F: EnergyType = "Fighting";
const G: EnergyType = "Grass";
const R: EnergyType = "Fire";

const GARCHOMP = (id: string): Printing => ({
  id,
  name: "Cynthia's Garchomp ex",
  attack: "Corkscrew Dive",
  index: 0,
  cost: [F],
  damage: 100,
  text: UNTIL_6,
  size: 6,
});
const PRINTINGS: readonly Printing[] = [
  { id: "me01-090", name: "Thievul", attack: "Greedy Hunt", index: 0, cost: [C], damage: 20, text: UNTIL_6, size: 6 },
  ...["me02-036", "me02-112"].map(
    (id): Printing => ({ id, name: "Mismagius ex", attack: "Hexa-Magic", index: 0, cost: [P, P], damage: 150, text: UNTIL_6, size: 6 }),
  ),
  ...["me02.5-111", "sv10-104", "sv10-215", "sv10-232", "sv10-241", "svp-204"].map(GARCHOMP),
  ...["sv06-134", "sv06-201"].map(
    (id): Printing => ({ id, name: "Blissey ex", attack: "Return", index: 0, cost: [C, C, C], damage: 180, text: UNTIL_6, size: 6 }),
  ),
  { id: "sv07-036", name: "Lumineon", attack: "Return", index: 0, cost: [C], damage: 20, text: UNTIL_6, size: 6 },
  ...["sv10.5b-074", "sv10.5b-151"].map(
    (id): Printing => ({ id, name: "Audino", attack: "Return", index: 0, cost: [C], damage: 30, text: UNTIL_6, size: 6 }),
  ),
  { id: "me04-034", name: "Deoxys", attack: "Psyspeed", index: 0, cost: [P], damage: 30, text: UNTIL_5, size: 5 },
  ...["sv08-159", "sv08-228"].map(
    (id): Printing => ({ id, name: "Cyclizar ex", attack: "Zircon Road", index: 1, cost: [G, R, P], damage: 180, text: DRAW_5 }),
  ),
];

const FILLER = "b51-filler";
const ENERGY: Record<string, string> = {
  Colorless: "b51-colorless-pay",
  Psychic: "b51-psychic",
  Fighting: "b51-fighting",
  Grass: "b51-grass",
  Fire: "b51-fire",
};

/** The printed face, attacks in printed order (Cyclizar ex's Zircon Road is its SECOND attack). */
function face(p: Printing): Card {
  const filler = { cost: [C], name: "B51 Tap", damage: 10 };
  const printed = { cost: p.cost, name: p.attack, effect: p.text, damage: p.damage };
  return battler(p.id, {
    name: p.name,
    hp: 330,
    attacks: p.index === 0 ? [printed] : [filler, printed],
  });
}

const LOCAL: Record<string, Card> = {
  ...Object.fromEntries(PRINTINGS.map((p) => [p.id, face(p)])),
  // No Weakness / Resistance on the defender, so the printed damage is the whole total.
  [FILLER]: battler(FILLER, {
    name: "B51 Filler",
    hp: 400,
    types: ["Colorless"],
    weaknesses: [],
    resistances: [],
    attacks: [{ cost: [C], name: "B51 Tap", damage: 10 }],
  }),
  [ENERGY.Colorless as string]: typedEnergy(ENERGY.Colorless as string, "Darkness"),
  [ENERGY.Psychic as string]: typedEnergy(ENERGY.Psychic as string, "Psychic"),
  [ENERGY.Fighting as string]: typedEnergy(ENERGY.Fighting as string, "Fighting"),
  [ENERGY.Grass as string]: typedEnergy(ENERGY.Grass as string, "Grass"),
  [ENERGY.Fire as string]: typedEnergy(ENERGY.Fire as string, "Fire"),
};

const DECK = deckOf({ [FILLER]: 60 });

/** P1's turn 3 (past the §4 first-turn ban) on a 60-card filler deck. */
function base(): GameState {
  const created = createGame({ seed: 5151, decks: { p1: DECK, p2: DECK }, cardPool: LOCAL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = completeSetup(created.state, { first: "p1" });
  for (const seat of ["p1", "p2"] as const) {
    const result = applyAction(state, { type: "endTurn", seat });
    if (!result.ok) throw new Error(`endTurn rejected: ${result.error.code}`);
    state = result.state;
  }
  return state;
}

/** TEST SURGERY — P1's Active is the printing carrying Energy that pays its printed cost, with
    `hand` Fillers in hand and `deck` Fillers in deck; P2's Active is a 400-HP Filler (no Bench, a
    10-card deck). Fresh uids for every card placed. */
function table(p: Printing, hand: number, deck: number): GameState {
  const state: GameState = JSON.parse(JSON.stringify(base()));
  let n = 0;
  const alloc = (id: string): string => {
    const uid = `b51#${n++}`;
    state.cardIdByUid[uid] = id;
    const card = LOCAL[id];
    if (card === undefined) throw new Error(`no local face for ${id}`);
    state.cardPool = { ...state.cardPool, [id]: card };
    return uid;
  };
  const body = (id: string, attached: readonly string[]): InPlayPokemon => ({
    ...makeInPlay(alloc(id), 1),
    energy: attached.map(alloc),
  });
  const fillers = (count: number) => Array.from({ length: count }, () => alloc(FILLER));
  state.players.p1 = {
    ...state.players.p1,
    active: body(
      p.id,
      p.cost.map((type) => ENERGY[type] as string),
    ),
    bench: [],
    hand: fillers(hand),
    discard: [],
    deck: fillers(deck),
  };
  state.players.p2 = {
    ...state.players.p2,
    active: body(FILLER, []),
    bench: [],
    hand: [],
    discard: [],
    deck: fillers(10),
  };
  return state;
}

function must(state: GameState, action: GameAction): { state: GameState; events: GameEvent[] } {
  const result = applyAction(state, action);
  if (!result.ok)
    throw new Error(`${action.type} rejected: ${result.error.code} ${result.error.message}`);
  return { state: result.state, events: result.events };
}
const ofType = <T extends GameEvent["type"]>(events: readonly GameEvent[], type: T) =>
  events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
const attack = (state: GameState, p: Printing) => must(state, { type: "attack", seat: "p1", index: p.index });
const until = PRINTINGS.filter((p) => p.size !== undefined);
const flat = PRINTINGS.filter((p) => p.size === undefined);
const label = (p: Printing) => `${p.id} ${p.name} "${p.attack}"`;

// ─────────────────────────────────────────────────────────────────────────────

/** Attack, see the printed confirm, and answer it both ways. Returns the two finished boards and
    the P1 draw rows each answer filed. */
function bothAnswers(board: GameState, p: Printing) {
  const parked = attack(board, p).state;
  expect(parked.phase.kind).toBe("effect:choose");
  if (parked.phase.kind === "effect:choose") {
    expect(parked.phase.prompt).toEqual(expect.objectContaining({ kind: "confirm", note: p.text }));
  }
  const answer = (yes: boolean) => {
    const done = must(parked, { type: "resolveEffect", seat: "p1", choice: { kind: "confirm", yes } });
    return { state: done.state, drawn: ofType(done.events, "CARDS_DRAWN").filter((e) => e.seat === "p1") };
  };
  return { yes: answer(true), no: answer(false) };
}

describe("B51 §1 — a moot \"You may draw …\" still asks, and both answers reach the same board (U0217 / U0294 / U0462 / U0693 / U1155 / U1513, deferred: D186 / D202 reading pinned, NOT changed)", () => {
  it("the census: every printing is wired, and the printed sentence is the attack's text", () => {
    expect(PRINTINGS.map((p) => p.id)).toHaveLength(17);
    for (const p of PRINTINGS) expect(LOCAL[p.id]?.attacks?.[p.index]?.effect).toBe(p.text);
  });

  it.each(until.map((p) => [label(p), p] as const))(
    "%s: a hand already holding the printed size is still asked; yes and no both draw nothing, and the damage lands",
    (_, p) => {
      const size = p.size as number;
      for (const held of [size, size + 1]) {
        const board = table(p, held, 10);
        const handBefore = board.players.p1.hand;
        const { yes, no } = bothAnswers(board, p);
        for (const answer of [yes, no]) {
          expect(answer.state.players.p1.hand).toEqual(handBefore);
          expect(answer.state.players.p1.deck).toHaveLength(10);
          expect(answer.drawn).toEqual([]);
          expect(answer.state.players.p2.active?.damage).toBe(p.damage);
        }
      }
    },
  );

  it.each(PRINTINGS.map((p) => [label(p), p] as const))(
    "%s: an empty deck is still asked; yes and no both draw nothing, and the damage lands",
    (_, p) => {
      const { yes, no } = bothAnswers(table(p, 1, 0), p);
      for (const answer of [yes, no]) {
        expect(answer.state.players.p1.hand).toHaveLength(1);
        expect(answer.state.players.p1.deck).toEqual([]);
        expect(answer.drawn).toEqual([]);
        expect(answer.state.players.p2.active?.damage).toBe(p.damage);
      }
    },
  );
});

describe("B51 §2 — the controls: with a draw available the printed question is still asked", () => {
  it.each(PRINTINGS.map((p) => [label(p), p] as const))(
    "%s: the confirm parks with the printed note; yes draws to the printed amount, no draws nothing",
    (_, p) => {
      // One short of the printed size (or 7 cards for the flat "draw 5": a big hand does not cap it).
      const held = p.size === undefined ? 7 : p.size - 1;
      const board = table(p, held, 10);
      const parked = attack(board, p).state;
      expect(parked.phase.kind).toBe("effect:choose");
      if (parked.phase.kind !== "effect:choose") return;
      expect(parked.phase.prompt).toEqual(expect.objectContaining({ kind: "confirm", note: p.text }));
      const yes = must(parked, { type: "resolveEffect", seat: "p1", choice: { kind: "confirm", yes: true } }).state;
      const drawn = p.size === undefined ? 5 : 1;
      expect(yes.players.p1.hand).toHaveLength(held + drawn);
      expect(yes.players.p1.deck).toHaveLength(10 - drawn);
      const no = must(parked, { type: "resolveEffect", seat: "p1", choice: { kind: "confirm", yes: false } }).state;
      expect(no.players.p1.hand).toHaveLength(held);
      expect(no.players.p1.deck).toHaveLength(10);
      expect(yes.players.p2.active?.damage).toBe(p.damage);
    },
  );

  it.each(until.map((p) => [label(p), p] as const))(
    "%s: a one-card deck still asks, and yes short-draws the one card",
    (_, p) => {
      const parked = attack(table(p, 0, 1), p).state;
      expect(parked.phase.kind).toBe("effect:choose");
      const yes = must(parked, { type: "resolveEffect", seat: "p1", choice: { kind: "confirm", yes: true } }).state;
      expect(yes.players.p1.hand).toHaveLength(1);
      expect(yes.players.p1.deck).toEqual([]);
    },
  );

  it.each(flat.map((p) => [label(p), p] as const))("%s: a one-card deck still asks", (_, p) => {
    expect(attack(table(p, 0, 1), p).state.phase.kind).toBe("effect:choose");
  });
});
