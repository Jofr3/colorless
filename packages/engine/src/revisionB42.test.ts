import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import type { GameAction, GameState } from "./index";
import { applyAction, createGame } from "./index";
import { flipCoin } from "./rng";
import {
  attachFromDeck,
  battler,
  clearBench,
  completeSetup,
  deckOf,
  mustApply,
  setActiveFromDeck,
  typedEnergy,
} from "./testFixtures";

// ── CARD REVISION, BATCH B42 (Attacks) ──
//
// The verified finding from the per-unit audit (docs/reference/card-revision.md "B42"), driven on a
// real board through `applyAction` and asserted against the PRINTED text (local D1 `cards.attacks_json`
// / `cards.abilities_json`, byte for byte below):
//   §1 Ditto "Surprisingly Transform" (`30th-115`, `mep-106`, U0119) — *"search your deck for a
//      Pokémon and switch it with this Pokémon"*. Palafin ex (`sv06-061` / `sv06-193` /
//      `sv08.5-151` / `svp-126`) prints Hero's Spirit: *"Put this Pokémon into play only with the
//      effect of Palafin's Zero to Hero Ability."* Ditto's deck offer (`deckSwapCandidates`) admitted
//      it, and the swap put it into play. The offer now drops a card whose program carries
//      `intoPlayOnlyVia` — the same refusal `evolveFromDeckOffer` and the hand evolve make.
//   §2 the control: a deck whose only Pokémon are Palafin ex offers nothing; the search whiffs, the
//      deck is still shuffled (the printed "Then, shuffle your deck"), and Ditto stays Active.

const TRANSFORM =
  "Flip a coin. If heads, search your deck for a Pokémon and switch it with this Pokémon. Any attached cards, damage counters, Special Conditions, turns in play, and any other effects remain on the new Pokémon. If you switched a Pokémon in this way, put this card into your deck. Then, shuffle your deck.";
const HEROS_SPIRIT = "Put this Pokémon into play only with the effect of Palafin's Zero to Hero Ability.";

const DITTOS = ["30th-115", "mep-106"] as const;
const PALAFINS = ["sv06-061", "sv06-193", "sv08.5-151", "svp-126"] as const;
const FILLER = "b42-filler";
const C = "b42-colorless";

const ditto = (id: string): Card =>
  battler(id, {
    name: "Ditto",
    hp: 70,
    types: ["Colorless"],
    retreat: 1,
    attacks: [{ cost: ["Colorless", "Colorless"], name: "Surprisingly Transform", effect: TRANSFORM }],
  });
const palafin = (id: string): Card =>
  battler(id, {
    name: "Palafin ex",
    hp: 340,
    types: ["Water"],
    stage: "Stage1",
    evolveFrom: "Finizen",
    abilities: [{ type: "Ability", name: "Hero's Spirit", effect: HEROS_SPIRIT }],
    attacks: [
      { cost: ["Water"], name: "Giga Impact", effect: "During your next turn, this Pokémon can't attack.", damage: 250 },
    ],
  });

const LOCAL: Record<string, Card> = {
  ...Object.fromEntries(DITTOS.map((id) => [id, ditto(id)])),
  ...Object.fromEntries(PALAFINS.map((id) => [id, palafin(id)])),
  [FILLER]: battler(FILLER, {
    name: "B42 Filler",
    hp: 400,
    types: ["Colorless"],
    weaknesses: [],
    resistances: [],
    attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
  }),
  [C]: typedEnergy(C, "Colorless"),
};

/** P1's turn 3 on a deck of `withFiller` Fillers, both Dittos, every Palafin ex printing and Energy. */
function base(withFiller: boolean): GameState {
  const deck = deckOf({
    [DITTOS[0]]: 1,
    [DITTOS[1]]: 1,
    ...Object.fromEntries(PALAFINS.map((id) => [id, 1])),
    [FILLER]: 12,
    [C]: 42,
  });
  const created = createGame({ seed: 4242, decks: { p1: deck, p2: deck }, cardPool: LOCAL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = completeSetup(created.state, { first: "p1" });
  for (const seat of ["p1", "p2"] as const) {
    const result = applyAction(state, { type: "endTurn", seat });
    if (!result.ok) throw new Error(`endTurn rejected: ${result.error.code}`);
    state = result.state;
  }
  // Every non-play card back into the deck; with `withFiller` false the Fillers leave the game
  // entirely (P1's only deck Pokémon are then the Palafin ex printings and the other Ditto).
  const side = state.players.p1;
  const pile = [...side.deck, ...side.hand, ...side.prizes, ...side.discard];
  const prizes = pile.filter((u) => state.cardIdByUid[u] === C).slice(0, 6);
  const deckRest = pile.filter((u) => !prizes.includes(u) && (withFiller || state.cardIdByUid[u] !== FILLER));
  return {
    ...state,
    players: { ...state.players, p1: { ...side, hand: [], discard: [], prizes, deck: deckRest } },
  };
}

/** P1 Active `dittoId` with {C}{C}, an empty Bench, and the next coin heads. */
function table(dittoId: string, withFiller: boolean): GameState {
  let state = base(withFiller);
  // The Active (a Filler or the other Ditto) goes back to the deck first, so `setActiveFromDeck`
  // never needs bench room and the deck is the only place the Fillers live.
  const side = state.players.p1;
  const returned = [...(side.active?.stack ?? []), ...(side.active?.energy ?? [])].filter(
    (u) => withFiller || state.cardIdByUid[u] !== FILLER,
  );
  state = clearBench(state, "p1");
  const cleared = state.players.p1;
  state = { ...state, players: { ...state.players, p1: { ...cleared, active: null, deck: [...cleared.deck, ...returned] } } };
  if (!withFiller) {
    const p1 = state.players.p1;
    state = {
      ...state,
      players: { ...state.players, p1: { ...p1, deck: p1.deck.filter((u) => state.cardIdByUid[u] !== FILLER) } },
    };
  }
  state = setActiveFromDeck(state, "p1", dittoId);
  state = attachFromDeck(state, "p1", C, 2);
  return { ...state, rngState: cursorFor("heads") };
}

function cursorFor(face: "heads" | "tails"): number {
  for (let n = 1; n < 1000; n++) if (flipCoin(n)[0] === face) return n;
  throw new Error("no cursor");
}

const attack: GameAction = { type: "attack", seat: "p1", index: 0 };
const idsOf = (state: GameState, uids: readonly string[]) => uids.map((u) => state.cardIdByUid[u]);

describe("B42 §1 — Surprisingly Transform never offers a Hero's Spirit Pokémon (U0119)", () => {
  for (const dittoId of DITTOS) {
    it(`${dittoId}: heads offers the deck's Pokémon but none of the four Palafin ex printings`, () => {
      const start = table(dittoId, true);
      // Non-vacuous: every Palafin ex printing is in P1's deck.
      expect(new Set(idsOf(start, start.players.p1.deck))).toEqual(
        new Set([...PALAFINS, FILLER, C, DITTOS.find((d) => d !== dittoId)]),
      );
      const parked = mustApply(start, attack).state;
      if (parked.phase.kind !== "effect:choose") throw new Error(`expected effect:choose, got ${parked.phase.kind}`);
      const prompt = parked.phase.prompt;
      if (prompt.kind !== "chooseCards") throw new Error(`expected chooseCards, got ${prompt.kind}`);
      expect(new Set(idsOf(parked, prompt.candidates))).toEqual(
        new Set([FILLER, DITTOS.find((d) => d !== dittoId)]),
      );
      // A hand-written answer naming a Palafin ex is refused, and the Filler answer swaps the Filler in.
      for (const id of PALAFINS) {
        const uid = parked.players.p1.deck.find((u) => parked.cardIdByUid[u] === id);
        const refused = applyAction(parked, {
          type: "resolveEffect",
          seat: "p1",
          choice: { kind: "cards", uids: [uid] },
        } as GameAction);
        expect(refused.ok ? "accepted" : refused.error.code, id).toBe("BAD_EFFECT_CHOICE");
      }
      const filler = prompt.candidates.find((u) => parked.cardIdByUid[u] === FILLER);
      const swapped = mustApply(parked, {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "cards", uids: [filler] },
      } as GameAction);
      expect(swapped.events.some((e) => e.type === "POKEMON_SWAPPED_FROM_DECK")).toBe(true);
      const active = swapped.state.players.p1.active;
      expect(active === null ? undefined : swapped.state.cardIdByUid[active.stack.at(-1) ?? ""]).toBe(FILLER);
    });
  }
});

describe("B42 §2 — the control: only Palafin ex in the deck, the search whiffs and still shuffles", () => {
  for (const dittoId of DITTOS) {
    it(`${dittoId}: no prompt, no swap, a SHUFFLE, Ditto stays Active`, () => {
      // The other Ditto is a Pokémon too: take it out so Palafin ex is all that is left.
      let start = table(dittoId, false);
      const p1 = start.players.p1;
      const other = DITTOS.find((d) => d !== dittoId);
      start = {
        ...start,
        players: { ...start.players, p1: { ...p1, deck: p1.deck.filter((u) => start.cardIdByUid[u] !== other) } },
      };
      expect(new Set(idsOf(start, start.players.p1.deck))).toEqual(new Set([...PALAFINS, C]));
      const { state, events } = mustApply(start, attack);
      expect(state.phase.kind).not.toBe("effect:choose");
      expect(events.some((e) => e.type === "ATTACK_EFFECT_COIN_FLIP" && e.result === "heads")).toBe(true);
      expect(events.some((e) => e.type === "POKEMON_SWAPPED_FROM_DECK")).toBe(false);
      expect(events.some((e) => e.type === "SHUFFLE" && e.seat === "p1")).toBe(true);
      const active = state.players.p1.active;
      expect(active === null ? undefined : state.cardIdByUid[active.stack.at(-1) ?? ""]).toBe(dittoId);
      for (const id of PALAFINS) expect(idsOf(state, state.players.p1.deck)).toContain(id);
    });
  }
});
