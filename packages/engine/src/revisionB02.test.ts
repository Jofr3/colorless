import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import type { GameEvent, GameState } from "./index";
import { applyAction, createGame, formatElapsed, logFromEvents } from "./index";
import { programFor } from "./registry";
import {
  FIXTURE_POOL,
  battler,
  benchFromDeck,
  clearBench,
  completeSetup,
  deckOf,
  handFromDeck,
  mustApply,
  setActiveFromDeck,
  setConditions,
  trainerCard,
} from "./testFixtures";

// ── CARD REVISION, BATCH B02 (Supporters) ──
//
// Two findings from the per-unit audit (docs/reference/card-revision.md "B02"), each driven on a
// real board through `applyAction` and asserted against the PRINTED text (local D1 `cards.effect`,
// byte for byte below):
//   §1 Caretaker — "shuffle this Caretaker into your deck instead of discarding it": the end state
//      was right, but the log announced a discard-pile retrieval ("shuffled 1 card from their
//      discard pile into their deck"). The row now names the played Caretaker going into the deck.
//   §2 Roxie's Performance — the opponent's Poisoned Pokémon can't retreat on their next turn: the
//      lock held, but the refusal blamed "an attack effect". A Supporter's side lock now gets its
//      own message (same RETREAT_PREVENTED code).

const CARETAKER = ["sv06-144", "sv06-203"] as const;
const CARETAKER_TEXT =
  "Draw 2 cards. If you drew any cards in this way and if Community Center is in play, shuffle this Caretaker into your deck instead of discarding it.";
const COMMUNITY_CENTER = "sv06-146";
const CC_TEXT =
  "Once during each player's turn, if they played a Supporter card from their hand this turn, they may heal 10 damage from each of their Pokémon.";
const ROXIE = ["me04-081", "me04-112", "me04-121"] as const;
const ROXIE_TEXT =
  "During your opponent's next turn, their Poisoned Pokémon can't retreat. (This includes newly Poisoned Pokémon.)";

const BASIC = "b02-basic";
const FILLER = "b02-filler";

const trainer = (id: string, name: string, type: string, text: string): Card => ({
  ...trainerCard(id, type, text),
  name,
});
const mon = (id: string, name: string): Card =>
  battler(id, {
    name,
    hp: 200,
    types: ["Colorless"],
    retreat: 0,
    attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
  });

const LOCAL: Record<string, Card> = {
  ...Object.fromEntries(
    CARETAKER.map((id) => [id, trainer(id, "Caretaker", "Supporter", CARETAKER_TEXT)]),
  ),
  ...Object.fromEntries(
    ROXIE.map((id) => [id, trainer(id, "Roxie's Performance", "Supporter", ROXIE_TEXT)]),
  ),
  [COMMUNITY_CENTER]: trainer(COMMUNITY_CENTER, "Community Center", "Stadium", CC_TEXT),
  [BASIC]: mon(BASIC, "B02 Basic"),
  [FILLER]: mon(FILLER, "B02 Filler"),
};
const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL };
const DECK = deckOf({
  ...Object.fromEntries(CARETAKER.map((id) => [id, 1])),
  ...Object.fromEntries(ROXIE.map((id) => [id, 1])),
  [COMMUNITY_CENTER]: 1,
  [BASIC]: 8,
  [FILLER]: 10,
  "fix-energy": 36, // 60 cards
});

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

/** Setup with P2 first, then P1's SECOND turn (turn 4). Hands and discard piles emptied into the deck, six `fix-energy`
    made each prize row. P1's Active is a
    Basic; P2's Active is a Basic (retreat 0) with one Filler on its Bench. */
function p1Turn(): GameState {
  const created = createGame({ seed: 2020, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = completeSetup(created.state, { first: "p2" });
  state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
  state = must(applyAction(state, { type: "endTurn", seat: "p1" }));
  state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
  if (state.turn !== 4) throw new Error(`expected turn 4, got ${state.turn}`);
  for (const s of ["p1", "p2"] as const) {
    const side = state.players[s];
    const pile = [...side.deck, ...side.hand, ...side.prizes, ...side.discard];
    const prizes = pile.filter((u) => state.cardIdByUid[u] === "fix-energy").slice(0, 6);
    const deck = pile.filter((u) => !prizes.includes(u));
    state = {
      ...state,
      players: { ...state.players, [s]: { ...side, hand: [], discard: [], prizes, deck } },
    };
  }
  state = clearBench(setActiveFromDeck(state, "p1", BASIC), "p1");
  state = clearBench(setActiveFromDeck(state, "p2", BASIC), "p2");
  return benchFromDeck(state, "p2", FILLER);
}

function play(
  state: GameState,
  id: string,
): { state: GameState; events: GameEvent[]; uid: string } {
  const next = handFromDeck(state, "p1", id, 1);
  const uid = next.players.p1.hand.find((u) => next.cardIdByUid[u] === id) as string;
  return { ...mustApply(next, { type: "playTrainer", seat: "p1", uid }), uid };
}

function rows(events: readonly GameEvent[], state: GameState): string[] {
  const entries = logFromEvents(events, {
    names: { p1: "Ana", p2: "Bo" },
    state,
    elapsed: formatElapsed(0),
  });
  return entries.flatMap((e) =>
    e.kind === "turn" ? [] : [e.segments.map((s) => s.text).join("")],
  );
}

describe("B02 §1 — Caretaker: the log names the played Caretaker going into the deck", () => {
  it("both printings run the one program", () => {
    expect(programFor(CARETAKER[1])).toBe(programFor(CARETAKER[0]));
  });

  for (const id of CARETAKER) {
    it(`${id} with Community Center in play: "shuffle this Caretaker into your deck instead of discarding it" — the row says so`, () => {
      const centered = play(p1Turn(), COMMUNITY_CENTER).state;
      expect(centered.stadium?.uid).toBeDefined();
      const { state, events, uid } = play(centered, id);
      expect(state.players.p1.deck).toContain(uid);
      expect(state.players.p1.discard).not.toContain(uid);
      const log = rows(events, state);
      expect(log).toContain("shuffled Caretaker into their deck instead of discarding it");
      expect(log.some((r) => r.includes("from their discard pile"))).toBe(false);
      // The trailing SHUFFLE row still follows the move.
      expect(events.map((e) => e.type).slice(-2)).toEqual(["DISCARD_RETRIEVED", "SHUFFLE"]);
    });
  }

  it("without Community Center it is discarded as usual and no deck row is written", () => {
    const { state, events, uid } = play(p1Turn(), CARETAKER[0]);
    expect(state.players.p1.discard).toContain(uid);
    expect(rows(events, state).some((r) => r.includes("into their deck"))).toBe(false);
  });
});

describe("B02 §2 — Roxie's Performance: the refusal names a Trainer effect, not an attack", () => {
  const retreat = (state: GameState) =>
    applyAction(state, { type: "retreat", seat: "p2", discardEnergy: [], promoteBenchIndex: 0 });

  for (const id of ROXIE) {
    it(`${id}: on the opponent's next turn their Poisoned Active can't retreat, and the message says why`, () => {
      const played = play(p1Turn(), id).state;
      const theirTurn = must(applyAction(played, { type: "endTurn", seat: "p1" }));
      const poisoned = setConditions(theirTurn, "p2", { poisonDamage: 10 });
      const refused = retreat(poisoned);
      if (refused.ok) throw new Error("expected the retreat to be refused");
      expect(refused.error.code).toBe("RETREAT_PREVENTED");
      expect(refused.error.message).toBe(
        "a Trainer effect prevents Poisoned Pokémon from retreating this turn (§11)",
      );
      expect(refused.error.message).not.toMatch(/attack/);
      // The unpoisoned body is free (the lock is the printed condition, nothing more).
      expect(retreat(setConditions(theirTurn, "p2", { poisonDamage: 0 })).ok).toBe(true);
    });
  }

  it("an attack lock on the same body keeps the attack message (the attack is also a reason)", () => {
    const played = play(p1Turn(), ROXIE[0]).state;
    const theirTurn = must(applyAction(played, { type: "endTurn", seat: "p1" }));
    const poisoned = setConditions(theirTurn, "p2", { poisonDamage: 10 });
    const active = poisoned.players.p2.active;
    if (active === null) throw new Error("no Active");
    const both: GameState = {
      ...poisoned,
      players: {
        ...poisoned.players,
        p2: { ...poisoned.players.p2, active: { ...active, retreatBlocked: true } },
      },
    };
    const refused = retreat(both);
    if (refused.ok) throw new Error("expected the retreat to be refused");
    expect(refused.error.message).toBe(
      "an attack effect prevents this Pokémon from retreating (§11)",
    );
  });
});
