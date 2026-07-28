import { describe, expect, it } from "vitest";
import { cardOfUid, hasRuleBox, isBasicPokemon } from "./cards";
import { applyAction } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import {
  STADIUM_ABILITY_DECK,
  basicPokemon,
  battler,
  benchTopUid,
  deepFreeze,
  driveSetup,
  expectErr,
  handFromDeck,
  handUid,
  must,
  mustApply,
  trainerCard,
  types,
} from "./testFixtures";

// P3-M5 (D102, engine 0.53.0) — the "once during each player's turn" Stadium
// ACTIVATED ability, the last big op-family row: Artazon / Mesagoza / Town Store.
// A new `useStadiumAbility` action runs the shared Stadium's `ability.program`
// under the turn's own player, gated by the per-turn `stadiumAbilityUsed` flag
// (which re-arms every turn, so the opponent activates the SAME Stadium on THEIR
// own turn — "each player's turn" needs no non-active-seat routing). Two new
// CardFilter kinds carry the searches: `basicPokemon.noRuleBox` (Artazon) and
// `toolCard` (Town Store); Mesagoza reuses `anyPokemon` inside the Poké Ball
// coin gate.

const both = { p1: STADIUM_ABILITY_DECK, p2: STADIUM_ABILITY_DECK };

/** Setup then open P1's turn 2 (P2 went first, passed) — no §4 restrictions. */
function p1Turn2(seed: number): GameState {
  const state = driveSetup(seed, both, { first: "p2" });
  return must(applyAction(state, { type: "endTurn", seat: "p2" }));
}

/** Put a Stadium into `seat`'s hand from the deck and play it into the shared
    zone. Returns the turn:action state with the Stadium in play. */
function withStadium(state: GameState, seat: Seat, cardId: string): GameState {
  const next = handFromDeck(state, seat, cardId, 1);
  const uid = handUid(next, seat, cardId);
  return must(applyAction(next, { type: "playTrainer", seat, uid }));
}

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

function cardIdOf(state: GameState, uid: string): string {
  return cardOfUid(state, uid)?.id ?? "";
}

describe("useStadiumAbility — framework (§7.3)", () => {
  it("rejects when no Stadium is in play", () => {
    const state = deepFreeze(p1Turn2(1));
    expectErr(state, { type: "useStadiumAbility", seat: "p1" }, "STADIUM_ABILITY_UNAVAILABLE");
  });

  it("rejects a continuous-only Stadium (Beach Court has no activated ability)", () => {
    const state = withStadium(p1Turn2(1), "p1", "sv01-167");
    expectErr(state, { type: "useStadiumAbility", seat: "p1" }, "STADIUM_ABILITY_UNAVAILABLE");
  });

  it("only the turn's own player may activate — the opponent is refused (WRONG_SEAT)", () => {
    const state = withStadium(p1Turn2(1), "p1", "sv03-196"); // Town Store, on P1's turn
    expectErr(state, { type: "useStadiumAbility", seat: "p2" }, "WRONG_SEAT");
  });

  it("rejects while a search is parked (BAD_PHASE — turnGate)", () => {
    const state = withStadium(p1Turn2(1), "p1", "sv02-171"); // Artazon parks on a search
    const { state: parked } = mustApply(state, { type: "useStadiumAbility", seat: "p1" });
    expect(parked.phase.kind).toBe("effect:choose");
    expectErr(parked, { type: "useStadiumAbility", seat: "p1" }, "BAD_PHASE");
  });

  it("is once per turn — a second activation is refused (STADIUM_ABILITY_ALREADY_USED)", () => {
    const state = withStadium(p1Turn2(1), "p1", "sv03-196"); // Town Store
    const { state: parked } = mustApply(state, { type: "useStadiumAbility", seat: "p1" });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected search park");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    const { state: done } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [prompt.candidates[0] as string] },
    });
    expect(done.phase.kind).toBe("turn:action");
    expect(done.allowances.stadiumAbilityUsed).toBe(true);
    expectErr(done, { type: "useStadiumAbility", seat: "p1" }, "STADIUM_ABILITY_ALREADY_USED");
  });

  it("re-arms for EACH player's turn — the opponent activates the same shared Stadium", () => {
    // P1 plays + activates Town Store, then ends the turn.
    let state = withStadium(p1Turn2(1), "p1", "sv03-196");
    const { state: parked } = mustApply(state, { type: "useStadiumAbility", seat: "p1" });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected search park");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    state = must(
      applyAction(parked, {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "cards", uids: [prompt.candidates[0] as string] },
      }),
    );
    state = must(applyAction(state, { type: "endTurn", seat: "p1" }));
    // P2's turn: the Stadium is still in play (owner P1) and its ability re-armed.
    expect(state.stadium?.owner).toBe("p1");
    expect(state.allowances.stadiumAbilityUsed).toBe(false);
    const { state: p2Parked, events } = mustApply(state, { type: "useStadiumAbility", seat: "p2" });
    expect(find(events, "STADIUM_ABILITY_ACTIVATED")).toMatchObject({
      seat: "p2",
      stadium: "Town Store",
    });
    expect(p2Parked.phase.kind).toBe("effect:choose"); // P2 searches THEIR own deck
  });
});

describe("Artazon — search a no-Rule-Box Basic → Bench", () => {
  it("parks on a Bench search whose candidates are all no-Rule-Box Basics", () => {
    const state = withStadium(p1Turn2(2), "p1", "sv02-171");
    const benchBefore = state.players.p1.bench.length;
    const { state: parked, events } = mustApply(state, { type: "useStadiumAbility", seat: "p1" });
    expect(find(events, "STADIUM_ABILITY_ACTIVATED")).toMatchObject({
      seat: "p1",
      stadium: "Artazon",
    });
    expect(parked.allowances.stadiumAbilityUsed).toBe(true);
    if (parked.phase.kind !== "effect:choose") throw new Error("expected search park");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    expect(prompt.dest).toBe("bench");
    expect(prompt.max).toBe(1);
    // Every candidate is a Basic Pokémon WITHOUT a Rule Box…
    for (const uid of prompt.candidates) {
      const card = cardOfUid(parked, uid);
      if (card === undefined) throw new Error("candidate has no card");
      expect(isBasicPokemon(card)).toBe(true);
      expect(hasRuleBox(card)).toBe(false);
    }
    const candidateIds = prompt.candidates.map((u) => cardIdOf(parked, u));
    // …the plain Basic is offered, and Chien-Pao ex (a Basic WITH a Rule Box,
    // present in the deck) is DROPPED.
    expect(candidateIds).toContain("fix-basic-0");
    expect(candidateIds).not.toContain("sv02-061");
    expect(parked.players.p1.deck.some((u) => cardIdOf(parked, u) === "sv02-061")).toBe(true);

    // Resolve on the plain Basic → it benches, the deck shuffles, turn resumes.
    const pick = prompt.candidates.find((u) => cardIdOf(parked, u) === "fix-basic-0") as string;
    const { state: done, events: e2 } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [pick] },
    });
    const searched = find(e2, "DECK_SEARCHED");
    expect(searched?.dest).toBe("bench");
    expect(searched?.uids).toEqual([pick]);
    expect(types(e2)).toContain("SHUFFLE");
    expect(done.players.p1.bench.length).toBe(benchBefore + 1);
    expect(benchTopUid(done, "p1", done.players.p1.bench.length - 1)).toBe(pick);
    expect(done.players.p1.deck).not.toContain(pick);
    expect(done.phase.kind).toBe("turn:action");
  });
});

describe("Mesagoza — coin-gated search a Pokémon → hand", () => {
  it("heads parks on a Pokémon search; tails does nothing (NO shuffle) — allowance spent either way", () => {
    let sawHeads = false;
    let sawTails = false;
    for (let seed = 0; seed < 30 && !(sawHeads && sawTails); seed++) {
      const state = withStadium(p1Turn2(seed), "p1", "sv01-178");
      const { state: after, events } = mustApply(state, { type: "useStadiumAbility", seat: "p1" });
      // The activation is "used" the moment it is declared, before the coin.
      expect(after.allowances.stadiumAbilityUsed).toBe(true);
      expect(find(events, "STADIUM_ABILITY_ACTIVATED")).toMatchObject({
        seat: "p1",
        stadium: "Mesagoza",
      });
      const flip = find(events, "ATTACK_EFFECT_COIN_FLIP");
      if (flip === undefined) throw new Error("Mesagoza did not flip");
      if (flip.result === "heads") {
        sawHeads = true;
        expect(after.phase.kind).toBe("effect:choose");
        if (after.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
        const prompt = after.phase.prompt;
        if (prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
        expect(prompt.dest).toBe("hand");
        for (const uid of prompt.candidates) {
          expect(cardOfUid(after, uid)?.category).toBe("Pokemon");
        }
      } else {
        sawTails = true;
        // Tails does NOTHING — and NO shuffle (shuffleDeck sits inside the gate).
        expect(after.phase.kind).toBe("turn:action");
        expect(types(events)).not.toContain("DECK_SEARCHED");
        expect(types(events)).not.toContain("SHUFFLE");
        expect(types(events)).not.toContain("EFFECT_PENDING");
      }
    }
    expect(sawHeads && sawTails).toBe(true);
  });
});

describe("Town Store — search a Pokémon Tool → hand", () => {
  it("parks on a hand search whose candidates are all Pokémon Tools, then draws one", () => {
    const state = withStadium(p1Turn2(3), "p1", "sv03-196");
    const handBefore = state.players.p1.hand.length;
    const { state: parked, events } = mustApply(state, { type: "useStadiumAbility", seat: "p1" });
    expect(find(events, "STADIUM_ABILITY_ACTIVATED")).toMatchObject({
      seat: "p1",
      stadium: "Town Store",
    });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected search park");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    expect(prompt.dest).toBe("hand");
    for (const uid of prompt.candidates) {
      const card = cardOfUid(parked, uid);
      expect(card?.category).toBe("Trainer");
      expect(card?.trainerType).toBe("Tool");
    }
    const pick = prompt.candidates.find((u) => cardIdOf(parked, u) === "fix-tool") as string;
    const { state: done, events: e2 } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [pick] },
    });
    expect(find(e2, "DECK_SEARCHED")?.dest).toBe("hand");
    expect(types(e2)).toContain("SHUFFLE");
    expect(done.players.p1.hand).toContain(pick);
    expect(done.players.p1.hand.length).toBe(handBefore + 1);
    expect(done.phase.kind).toBe("turn:action");
  });
});

describe("Rule-Box detection — hasRuleBox (Artazon's `noRuleBox`)", () => {
  it("a plain Basic has no Rule Box", () => {
    expect(hasRuleBox(basicPokemon("fix-plain", 0))).toBe(false);
  });
  it("a suffix Pokémon (ex / V / VMAX / VSTAR / GX) has a Rule Box", () => {
    expect(hasRuleBox(battler("a", { name: "Chien-Pao ex" }))).toBe(true);
    expect(hasRuleBox(battler("b", { name: "Fixmon V" }))).toBe(true);
    expect(hasRuleBox(battler("c", { name: "Fixmon VSTAR" }))).toBe(true);
  });
  it("a Radiant Pokémon has a Rule Box (name PREFIX, not a suffix)", () => {
    expect(hasRuleBox(battler("d", { name: "Radiant Greninja" }))).toBe(true);
  });
  it("a non-Pokémon never has a Rule Box", () => {
    expect(hasRuleBox(trainerCard("t", "Tool", "A Tool."))).toBe(false);
  });
});
