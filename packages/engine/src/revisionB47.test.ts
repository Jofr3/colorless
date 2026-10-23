import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import type { GameAction, GameEvent, GameState, Seat } from "./index";
import { applyAction, createGame } from "./index";
import { type LogContext, formatElapsed, logFromEvents } from "./log";
import {
  battler,
  completeSetup,
  deckOf,
  typedEnergy,
  mustApply as must,
  effectPrompt,
} from "./testFixtures";
import { type InPlayPokemon, makeInPlay } from "./types";

const SONIC_RIPPER =
  "Shuffle all Energy attached to this Pokémon into your deck, and this attack does 220 damage to 1 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";
const TORRENTIAL_PUMP =
  "You may shuffle 3 Energy attached to this Pokémon into your deck. If you do, this attack also does 120 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";
const SOB = "During your opponent's next turn, the Defending Pokémon can't retreat.";
const PILE_TEXT = "Discard all Energy from this Pokémon.";

const FILLER = "b47-filler";
const M = "b47-metal";
const D = "b47-darkness";
const W = "b47-water";
const PILE = "b47-pile";

const TAP = [{ cost: ["Colorless"], name: "Tap", damage: 10 }];
const skarmory = (id: string): Card =>
  battler(id, {
    name: "Mega Skarmory ex",
    hp: 260,
    types: ["Metal"],
    attacks: [
      { cost: ["Metal", "Metal", "Colorless"], name: "Sonic Ripper", effect: SONIC_RIPPER },
    ],
  });
const ogerpon = (id: string): Card =>
  battler(id, {
    name: "Wellspring Mask Ogerpon ex",
    hp: 210,
    types: ["Water"],
    attacks: [
      { cost: ["Colorless"], name: "Sob", effect: SOB, damage: 20 },
      {
        cost: ["Water", "Colorless", "Colorless"],
        name: "Torrential Pump",
        effect: TORRENTIAL_PUMP,
        damage: 100,
      },
    ],
  });
const LOCAL: Record<string, Card> = {
  "me03-055": skarmory("me03-055"),
  "me03-106": skarmory("me03-106"),
  "sv06-064": ogerpon("sv06-064"),
  "sv06-194": ogerpon("sv06-194"),
  "sv06-213": ogerpon("sv06-213"),
  "sv08.5-027": ogerpon("sv08.5-027"),
  "sv08.5-152": ogerpon("sv08.5-152"),
  [PILE]: battler(PILE, {
    name: "B47 Pile",
    hp: 300,
    attacks: [{ cost: ["Colorless"], name: "Dump", effect: PILE_TEXT, damage: 10 }],
  }),
  // No Weakness / Resistance on the defender, so the printed damage is the whole total.
  [FILLER]: battler(FILLER, {
    name: "B47 Filler",
    hp: 400,
    types: ["Colorless"],
    weaknesses: [],
    resistances: [],
    attacks: TAP,
  }),
  [M]: typedEnergy(M, "Metal"),
  [D]: typedEnergy(D, "Darkness"),
  [W]: typedEnergy(W, "Water"),
};

const DECK = deckOf({ [FILLER]: 20, [M]: 40 });
const NAMES: Record<Seat, string> = { p1: "Ember", p2: "Tide" };

/** P1's turn 3 (past the §4 first-turn ban) on a 60-card filler deck. */
function base(): GameState {
  const created = createGame({ seed: 4747, decks: { p1: DECK, p2: DECK }, cardPool: LOCAL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = completeSetup(created.state, { first: "p1" });
  for (const seat of ["p1", "p2"] as const) {
    const result = applyAction(state, { type: "endTurn", seat });
    if (!result.ok) throw new Error(`endTurn rejected: ${result.error.code}`);
    state = result.state;
  }
  return state;
}

/** TEST SURGERY — P1's Active is `attacker` carrying `energy`, P2's Active a 400-HP Filler and
    `oppBench` Benched Fillers, both decks 10 Fillers. Fresh uids for every card placed. */
function table(attacker: string, energy: readonly string[], oppBench = 0): GameState {
  const state: GameState = JSON.parse(JSON.stringify(base()));
  let n = 0;
  const alloc = (id: string): string => {
    const uid = `b47#${n++}`;
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
  for (const seat of ["p1", "p2"] as const) {
    const side = state.players[seat];
    state.players[seat] = {
      ...side,
      active: seat === "p1" ? body(attacker, energy) : body(FILLER, []),
      bench: seat === "p1" ? [] : Array.from({ length: oppBench }, () => body(FILLER, [])),
      hand: [],
      discard: [],
      deck: Array.from({ length: 10 }, () => alloc(FILLER)),
    };
  }
  return state;
}
const ofType = <T extends GameEvent["type"]>(events: readonly GameEvent[], type: T) =>
  events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
function render(events: readonly GameEvent[], state: GameState): string[] {
  const ctx: LogContext = { names: NAMES, state, elapsed: formatElapsed(0) };
  return logFromEvents([...events], ctx).flatMap((entry) =>
    entry.kind === "turn" ? [] : [entry.segments.map((s) => s.text).join("")],
  );
}

// ─────────────────────────────────────────────────────────────────────────────

describe("B47 §1 — an attack that shuffles its own Energy into the deck says so in the log (U0625)", () => {
  it.each(["me03-055", "me03-106"])(
    '%s "Sonic Ripper": every Energy goes to the deck, the row reads "shuffled … into Ember\'s deck", never "discarded"',
    (id) => {
      const board = table(id, [M, M, M, M, D]);
      const attached = board.players.p1.active?.energy ?? [];
      const deckBefore = board.players.p1.deck.length;
      // P2 has no Bench, so the one-target damage auto-resolves on the Active.
      const { state, events } = must(board, { type: "attack", seat: "p1", index: 0 });
      // Board half (already right): all five to the deck, none to the pile, 220 on the defender.
      expect(state.players.p1.active?.energy).toEqual([]);
      expect(state.players.p1.discard).toEqual([]);
      expect(state.players.p1.deck).toHaveLength(deckBefore + 5);
      expect(attached.every((uid) => state.players.p1.deck.includes(uid))).toBe(true);
      expect(state.players.p2.active?.damage).toBe(220);
      expect(ofType(events, "ENERGY_DISCARDED")).toEqual([
        expect.objectContaining({ seat: "p1", actor: "p1", uids: attached, to: "deck" }),
      ]);
      const texts = render(events, state);
      expect(texts).toContain(
        "shuffled Metal Energy ×4, Darkness Energy from Ember's Mega Skarmory ex into Ember's deck",
      );
      expect(texts.some((t) => t.startsWith("discarded "))).toBe(false);
    },
  );

  it.each(["sv06-064", "sv06-194", "sv06-213", "sv08.5-027", "sv08.5-152"])(
    '%s "Torrential Pump" (the other to-deck printing): the 3 shuffled Energy read "shuffled … into Ember\'s deck"',
    (id) => {
      const board = table(id, [W, W, W, W], 1);
      let step = must(board, { type: "attack", seat: "p1", index: 1 });
      const events: GameEvent[] = [...step.events];
      // Answer every park the printed "You may … 1 of your opponent's Benched Pokémon" raises
      // with its first legal option (accept the shuffle, the first 3 Energy, the one Benched Filler).
      for (let guard = 0; step.state.phase.kind === "effect:choose" && guard < 5; guard++) {
        const p = effectPrompt(step.state);
        const choice =
          p.kind === "chooseCards"
            ? { kind: "cards" as const, uids: p.candidates.slice(0, p.max) }
            : p.kind === "choosePokemon"
              ? { kind: "pokemon" as const, ref: p.candidates[0] }
              : p.kind === "confirm"
                ? { kind: "confirm" as const, yes: true }
                : (() => {
                    throw new Error(`unexpected prompt ${p.kind}`);
                  })();
        step = must(step.state, { type: "resolveEffect", seat: "p1", choice } as GameAction);
        events.push(...step.events);
      }
      const { state } = step;
      expect(state.players.p1.active?.energy).toHaveLength(1);
      expect(state.players.p1.discard).toEqual([]);
      expect(state.players.p2.bench[0]?.damage).toBe(120);
      const moved = ofType(events, "ENERGY_DISCARDED");
      expect(moved).toEqual([expect.objectContaining({ seat: "p1", to: "deck" })]);
      expect(moved[0]?.uids).toHaveLength(3);
      const texts = render(events, state);
      expect(texts).toContain(
        "shuffled Water Energy ×3 from Ember's Wellspring Mask Ogerpon ex into Ember's deck",
      );
      expect(texts.some((t) => t.startsWith("discarded "))).toBe(false);
    },
  );
});

describe('B47 §2 — the control: an Energy discard to the pile still reads "discarded"', () => {
  it('"Discard all Energy from this Pokémon." — the pile row is byte-identical', () => {
    const board = table(PILE, [M, D]);
    const { state, events } = must(board, { type: "attack", seat: "p1", index: 0 });
    expect(state.players.p1.discard).toHaveLength(2);
    expect(ofType(events, "ENERGY_DISCARDED")[0]?.to).toBeUndefined();
    const texts = render(events, state);
    expect(texts).toContain("discarded Metal Energy, Darkness Energy from Ember's B47 Pile");
    expect(texts.some((t) => t.startsWith("shuffled ") && t.includes("Energy"))).toBe(false);
  });
});
