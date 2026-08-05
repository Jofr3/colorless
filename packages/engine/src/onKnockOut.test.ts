import { describe, expect, it } from "vitest";
import { applyAction } from "./index";
import type { GameEvent, GameState } from "./index";
import {
  ONKO_DECK,
  activeUid,
  attachFromDeck,
  deepFreeze,
  driveSetup,
  expectErr,
  must,
  mustApply,
  setActiveFromDeck,
  setConditions,
  setDamage,
  setPrizes,
  types,
} from "./testFixtures";

// M4 slice 9 — on-KO triggered Abilities (§9): the Abilities that fire "when
// this Pokémon is Knocked Out". Unlike the slice-6 board triggers (which fire on
// the controller's OWN turn), an on-KO trigger fires during the OPPONENT's turn,
// mid-KO-sweep — the hairiest timing, because a decision must PAUSE the sweep and
// then RESUME it draining the remaining prize/promotion stages (resume-the-tail).
//   • Glimmora "Shattering Crystal" (real, sv02-126) — a coin-flip PRIZE guard:
//     heads → the opponent takes no Prize for it. Resolved inline in the KO sweep
//     (flow.ts collectKnockOuts / planPrizes), before the §14 tie guard.
//   • fix-onko "Last Wish" (FIXTURE) — the resume-the-tail PARKING demonstrator:
//     an on-KO program (search a Basic → hand) that PARKS on effect:choose (no
//     real SV on-KO Ability requires a decision — the fix-sniper precedent).

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

/** P1 (going SECOND, so their turn 2 has no §4 attack ban) with an energied
    fix-attacker Active (Bite [C] 30, index 0) vs P2 whose Active is `p2Active`
    (a 30-HP body → Bite one-shots it). setActiveFromDeck displaces each setup
    Active to the bench, so P2 always keeps a lone benched fix-basic-1 to promote
    into after their Active is Knocked Out. */
function onkoBoard(seed: number, p2Active: string): GameState {
  let state = driveSetup(seed, { p1: ONKO_DECK, p2: ONKO_DECK }, { first: "p2" });
  state = must(applyAction(state, { type: "endTurn", seat: "p2" })); // → P1's turn 2
  state = setActiveFromDeck(state, "p1", "fix-attacker");
  state = attachFromDeck(state, "p1", "fix-energy", 1); // pays Bite [C]
  state = setActiveFromDeck(state, "p2", p2Active);
  return state;
}

const SEED = 4;
const bite = { type: "attack", seat: "p1", index: 0 } as const;

// ── Glimmora "Shattering Crystal" — the coin-flip PRIZE guard ─────────────────

describe("Glimmora's Shattering Crystal — on-KO prize denial (§8.1)", () => {
  it("fires AFTER the Knock Out, flipping a coin for the KO'd Pokémon", () => {
    const state = onkoBoard(SEED, "sv02-126");
    const glimmora = activeUid(state, "p2");
    const { events } = mustApply(state, bite);

    const koIdx = events.findIndex((e) => e.type === "KNOCKED_OUT");
    const trigIdx = events.findIndex((e) => e.type === "ABILITY_TRIGGERED");
    const flipIdx = events.findIndex((e) => e.type === "ABILITY_COIN_FLIP");
    expect(koIdx).toBeGreaterThanOrEqual(0);
    // The Ability fires as a CONSEQUENCE of the KO — both after it.
    expect(trigIdx).toBeGreaterThan(koIdx);
    expect(flipIdx).toBeGreaterThan(trigIdx);
    expect(find(events, "ABILITY_TRIGGERED")).toMatchObject({
      seat: "p2",
      uid: glimmora,
      ability: "Shattering Crystal",
    });
    expect(find(events, "ABILITY_COIN_FLIP")).toMatchObject({
      seat: "p2",
      uid: glimmora,
      ability: "Shattering Crystal",
    });
  });

  it("heads DENIES the opponent's prize; tails GRANTS it (both branches reachable)", () => {
    let sawHeads = false;
    let sawTails = false;
    for (let seed = 0; seed < 30 && !(sawHeads && sawTails); seed++) {
      const state = onkoBoard(seed, "sv02-126");
      const glimmora = activeUid(state, "p2");
      const { state: after, events } = mustApply(state, bite);
      expect(find(events, "KNOCKED_OUT")).toMatchObject({ seat: "p2", uid: glimmora });
      const flip = find(events, "ABILITY_COIN_FLIP");
      if (flip === undefined) throw new Error("Shattering Crystal did not flip");

      if (flip.result === "heads") {
        sawHeads = true;
        // No prize for Glimmora: PRIZE_PREVENTED, no prize owed, P1 keeps all 6.
        expect(find(events, "PRIZE_PREVENTED")).toMatchObject({ seat: "p2", uid: glimmora });
        expect(types(events)).not.toContain("PRIZES_OWED");
        expect(after.players.p1.prizes.length).toBe(6);
        expect(after.pending.some((s) => s.kind === "takePrizes")).toBe(false);
        // The KO'd Active still promotes (lone bench → auto), then the turn passes.
        expect(after.players.p2.active).not.toBeNull();
        expect(after.phase).toEqual({ kind: "turn:action", seat: "p2" });
      } else {
        sawTails = true;
        // A prize IS owed — P1 parks on ko:takePrizes for exactly it.
        expect(types(events)).not.toContain("PRIZE_PREVENTED");
        expect(after.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: 1 });
        const taken = must(applyAction(after, { type: "takePrizes", seat: "p1", prizeIndices: [0] }));
        expect(taken.players.p1.prizes.length).toBe(5);
      }
    }
    expect(sawHeads && sawTails).toBe(true);
  });

  it("fires from the CHECKUP KO sweep too (Glimmora poisoned to death between turns)", () => {
    let state = onkoBoard(SEED, "sv02-126");
    // Poison it to lethal-on-tick: 20 damage + a 10 poison counter = 30 = its HP.
    state = setDamage(state, "p2", 20);
    state = setConditions(state, "p2", { poisonDamage: 10 });
    const glimmora = activeUid(state, "p2");
    // P1 ends their turn → the Checkup ticks poison → Glimmora is Knocked Out →
    // Shattering Crystal fires inside that same between-turns sweep.
    const { events } = mustApply(state, { type: "endTurn", seat: "p1" });
    expect(find(events, "KNOCKED_OUT")).toMatchObject({ seat: "p2", uid: glimmora });
    expect(find(events, "ABILITY_TRIGGERED")).toMatchObject({
      uid: glimmora,
      ability: "Shattering Crystal",
    });
    expect(find(events, "ABILITY_COIN_FLIP")).toBeDefined();
  });

  it("resolves BEFORE the §14 win check — heads can DENY a game-winning prize", () => {
    // P1 is one prize from victory, and Glimmora's prize would be their last (a
    // §14.1 win). But the guard flips FIRST (inline in the KO sweep): heads
    // DENIES the prize, so P1 does NOT win and the game continues; tails GRANTS
    // it and P1 wins outright. Both branches are reachable — the flip really is
    // resolved before the win check, not skipped by an imminent win.
    let sawHeads = false;
    let sawTails = false;
    for (let seed = 0; seed < 30 && !(sawHeads && sawTails); seed++) {
      let state = onkoBoard(seed, "sv02-126");
      state = setPrizes(state, "p1", 1);
      const { state: after, events } = mustApply(state, bite);
      const flip = find(events, "ABILITY_COIN_FLIP");
      if (flip === undefined) throw new Error("Shattering Crystal did not flip");
      if (flip.result === "heads") {
        sawHeads = true;
        expect(find(events, "PRIZE_PREVENTED")).toBeDefined();
        expect(after.phase.kind).not.toBe("gameOver"); // prize denied → no win
        expect(after.players.p1.prizes.length).toBe(1); // still one from victory
      } else {
        sawTails = true;
        expect(after.phase.kind).toBe("gameOver");
        if (after.phase.kind !== "gameOver") throw new Error("expected gameOver");
        expect(after.phase.outcome).toEqual({ result: "win", winner: "p1", reason: "prizesTaken" });
      }
    }
    expect(sawHeads && sawTails).toBe(true);
  });
});

// ── fix-onko "Last Wish" — the resume-the-tail PARKING path ───────────────────

describe("on-KO parking — the resume-the-tail continuation (§8.1)", () => {
  it("queues a koTrigger AFTER the prize, before the promotion", () => {
    const state = onkoBoard(SEED, "fix-onko");
    const { state: after } = mustApply(state, bite);
    // Prizes-first: P1's prize parks first; the koTrigger and the promotion wait.
    expect(after.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: 1 });
    expect(after.pending.map((s) => s.kind)).toEqual([
      "takePrizes",
      "koTrigger",
      "promote",
      "endTurn",
      "checkup",
      "startTurn",
    ]);
  });

  it("PARKS mid-sweep on the KO'd player's decision, then RESUMES draining the tail", () => {
    const state = onkoBoard(SEED, "fix-onko");
    const fixOnko = activeUid(state, "p2");
    const { state: afterAttack } = mustApply(state, bite);

    // P1 takes the prize → the sweep reaches the koTrigger → "Last Wish" PARKS.
    const { state: parked, events: e2 } = mustApply(afterAttack, {
      type: "takePrizes",
      seat: "p1",
      prizeIndices: [0],
    });
    expect(find(e2, "ABILITY_TRIGGERED")).toMatchObject({
      seat: "p2",
      uid: fixOnko,
      ability: "Last Wish",
    });
    expect(types(e2)).toContain("EFFECT_PENDING");
    expect(parked.phase.kind).toBe("effect:choose");
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    // The KO'd player (P2 — the NON-turn player) owes the decision; resumeTail
    // marks the mid-sweep park so resolveEffect drains the tail, not a turn.
    expect(parked.phase.seat).toBe("p2");
    expect(parked.phase.resumeTail).toBe(true);
    // The KO'd Pokémon is the program's "this Pokémon" — named even though it
    // left play (a source-reading op then finds no board top and whiffs).
    expect(parked.phase.cont.ctx.sourceUid).toBe(fixOnko);
    expect(parked.phase.prompt.kind).toBe("chooseCards");
    // The prize/promotion tail is still queued behind the park.
    expect(parked.pending.map((s) => s.kind)).toEqual(["promote", "endTurn", "checkup", "startTurn"]);

    // Resolve it (take a Basic into hand) → the sweep RESUMES: P2 promotes the
    // lone bench (forced → auto), the turn ends and passes to P2.
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    const pick = prompt.candidates.slice(0, 1);
    const { state: done, events: e3 } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p2",
      choice: { kind: "cards", uids: pick },
    });
    expect(find(e3, "DECK_SEARCHED")).toMatchObject({ seat: "p2", dest: "hand", uids: pick });
    // The searched Basic landed in P2's hand (the turn-start draw on resume adds
    // another, so assert the specific card, not the count).
    expect(done.players.p2.hand).toContain(pick[0]);
    expect(done.players.p2.active).not.toBeNull(); // promoted the lone bench
    expect(done.phase.kind).toBe("turn:action");
    expect(done.phase).toMatchObject({ seat: "p2" });
  });

  it("declining the on-KO search (take none) still resumes the tail", () => {
    const state = onkoBoard(SEED, "fix-onko");
    const afterAttack = mustApply(state, bite).state;
    const parked = mustApply(afterAttack, {
      type: "takePrizes",
      seat: "p1",
      prizeIndices: [0],
    }).state;
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const done = mustApply(parked, {
      type: "resolveEffect",
      seat: "p2",
      choice: { kind: "cards", uids: [] },
    }).state;
    expect(done.players.p2.active).not.toBeNull();
    expect(done.phase.kind).toBe("turn:action");
  });

  it("§14 WIN skips the on-KO program — a game-ending prize clears the koTrigger", () => {
    // P1 one prize from victory KOs fix-onko: taking the forced last prize wins
    // outright (§14.1), so finishGame clears the pending queue and the queued
    // koTrigger PROGRAM never runs — no "Last Wish" trigger, no park.
    let state = onkoBoard(SEED, "fix-onko");
    state = setPrizes(state, "p1", 1);
    const { state: after, events } = mustApply(state, bite);
    expect(find(events, "KNOCKED_OUT")).toBeDefined();
    expect(after.phase.kind).toBe("gameOver");
    if (after.phase.kind !== "gameOver") throw new Error("expected gameOver");
    expect(after.phase.outcome).toEqual({ result: "win", winner: "p1", reason: "prizesTaken" });
    expect(types(events)).not.toContain("ABILITY_TRIGGERED");
    expect(types(events)).not.toContain("EFFECT_PENDING");
  });

  it("wire-safety — only the KO'd player resolves the on-KO park", () => {
    const state = onkoBoard(SEED, "fix-onko");
    const afterAttack = mustApply(state, bite).state;
    const parked = mustApply(afterAttack, {
      type: "takePrizes",
      seat: "p1",
      prizeIndices: [0],
    }).state;
    // P1 (the turn owner / attacker) is NOT the one who owes this decision.
    expectErr(parked, { type: "resolveEffect", seat: "p1", choice: { kind: "cards", uids: [] } }, "WRONG_SEAT");
  });
});

// ── Non-regression + purity ──────────────────────────────────────────────────

describe("on-KO triggers — non-regression and purity", () => {
  it("a KO of a Pokémon with NO on-KO Ability queues no koTrigger and fires no guard", () => {
    const state = onkoBoard(SEED, "fix-victim"); // 30 HP, no Ability
    const { state: after, events } = mustApply(state, bite);
    expect(find(events, "KNOCKED_OUT")).toMatchObject({ seat: "p2" });
    expect(types(events)).not.toContain("ABILITY_TRIGGERED");
    expect(types(events)).not.toContain("ABILITY_COIN_FLIP");
    expect(types(events)).not.toContain("PRIZE_PREVENTED");
    expect(after.pending.some((s) => s.kind === "koTrigger")).toBe(false);
    // Ordinary KO: P1 owes exactly the one prize.
    expect(after.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: 1 });
  });

  it("never mutates the input state (frozen board survives an on-KO KO)", () => {
    const state = deepFreeze(onkoBoard(SEED, "sv02-126"));
    expect(() => applyAction(state, bite)).not.toThrow();
    // And the parking path over a frozen board.
    const state2 = deepFreeze(onkoBoard(SEED, "fix-onko"));
    const after = must(applyAction(state2, bite));
    expect(() => applyAction(deepFreeze(after), { type: "takePrizes", seat: "p1", prizeIndices: [0] })).not.toThrow();
  });
});
