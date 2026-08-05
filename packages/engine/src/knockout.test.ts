import { describe, expect, it } from "vitest";
import { applyAction, deriveAttackEffect, topUid } from "./index";
import type { GameEvent, GameState } from "./index";
import {
  KNOCKOUT_DECK,
  activeUid,
  attachFromDeck,
  benchFromDeck,
  benchTopUid,
  deepFreeze,
  driveSetup,
  must,
  mustApply,
  setActiveFromDeck,
  setBenchDamage,
  setPrizes,
  types,
} from "./testFixtures";

// M4 slice 4 — the Knock Out generalized off the Active. Two reaches the old
// engine could not: BENCH Knock Outs (a spread attack finishing a Benched
// Pokémon, resolved by the shared board sweep in flow.ts collectKnockOuts) and
// MID-TURN Knock Outs that RESUME the actor's turn (evolve-below-HP — see the
// characterization test in stadiumTool.test.ts). This suite drives the spread
// path end to end; the fix-sniper's "Spread Shot" does 30 to the Active AND 20
// to each of the opponent's Benched Pokémon (effect text the deriver reads).

/** Setup then open P1's turn 2 (P2 went first and passed) — P1 goes second, so
    turn 2 is their first turn with no §4 attack restriction. */
function p1Turn2(seed: number): GameState {
  const state = driveSetup(seed, { p1: KNOCKOUT_DECK, p2: KNOCKOUT_DECK }, { first: "p2" });
  return must(applyAction(state, { type: "endTurn", seat: "p2" }));
}

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

/** P1 fix-sniper (energied to attack) vs a P2 board — the shared arrangement.
    setActiveFromDeck displaces the setup Active to the bench, so p2's bench is
    reset to EXACTLY the requested Pokémon before they are added. */
function sniperVs(seed: number, p2Active: string, bench: string[]): GameState {
  let state = p1Turn2(seed);
  state = setActiveFromDeck(state, "p1", "fix-sniper");
  state = attachFromDeck(state, "p1", "fix-energy", 1); // pays Spread Shot [C]
  state = setActiveFromDeck(state, "p2", p2Active);
  state = { ...state, players: { ...state.players, p2: { ...state.players.p2, bench: [] } } };
  for (const id of bench) state = benchFromDeck(state, "p2", id);
  return state;
}

describe("spreadDamage — the derived spread op", () => {
  it("derives from its effect text, with and without the era's W/R clarifier", () => {
    expect(
      deriveAttackEffect("This attack does 20 damage to each of your opponent's Benched Pokémon."),
    ).toEqual([{ op: "spreadDamage", target: "opponentBench", amount: 20 }]);
    expect(
      deriveAttackEffect(
        "This attack does 30 damage to each of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      ),
    ).toEqual([{ op: "spreadDamage", target: "opponentBench", amount: 30 }]);
  });

  it("derives the flat 'also' rider (Cetoddle sv02-053 'Avalanche') to the same op", () => {
    // Avalanche does 30 to the Active (the attack's own `damage` field) THEN
    // this secondary spread; the "also" is emphasis of the main hit, not a
    // different op — it derives to the identical `spreadDamage`. Verbatim card
    // text from the live SV pool, so the deriver reads a real print.
    expect(
      deriveAttackEffect(
        "This attack also does 10 damage to each of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      ),
    ).toEqual([{ op: "spreadDamage", target: "opponentBench", amount: 10 }]);
  });
});

describe("spread attack damage (§8.5)", () => {
  it("places flat damage on EVERY opponent Benched Pokémon — no Weakness on the Bench", () => {
    // fix-weak is weak to Fire ×2, but on the Bench weakness never applies.
    const state = sniperVs(1, "fix-wall", ["fix-wall", "fix-weak"]);
    const benchedWeak = benchTopUid(state, "p2", 1);
    const { state: after, events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });

    // The derived spread ran — it is SIMULATED, not flagged as skipped.
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    // Active took the base 30; each benched a FLAT 20 (no ×2 on fix-weak).
    expect(after.players.p2.active?.damage).toBe(30);
    expect(after.players.p2.bench[0]?.damage).toBe(20);
    expect(after.players.p2.bench[1]?.damage).toBe(20);
    const weakHit = events.find((e) => e.type === "DAMAGE_DEALT" && e.uid === benchedWeak);
    expect(weakHit).toMatchObject({ seat: "p2", base: 20, dealt: 20, weakness: null, resistance: null });
  });

  it("still applies a benched Pokémon's own damage-reduction passive (Bouffer) to spread", () => {
    // A reduction passive that is NOT Active-only (Bouffalant "Bouffer", −20)
    // reduces spread damage on the Bench too; the attacker's Active-only bonus
    // (Vitality Band) does not reach the Bench.
    const state = sniperVs(7, "fix-wall", ["sv03-174"]); // Bouffalant benched
    const benchedBouff = benchTopUid(state, "p2", 0);
    const { state: after, events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    const hit = events.find(
      (e) => e.type === "DAMAGE_DEALT" && e.uid === benchedBouff,
    ) as Extract<GameEvent, { type: "DAMAGE_DEALT" }> | undefined;
    expect(hit).toMatchObject({ base: 20, reduction: 20, dealt: 0 });
    expect(after.players.p2.bench[0]?.damage).toBe(0); // 20 spread − 20 Bouffer
  });

  it("is a no-op against an empty opponent Bench", () => {
    const state = sniperVs(4, "fix-wall", []);
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    // Only the Active took damage; nothing on the Bench, no KO, no crash.
    expect(events.filter((e) => e.type === "DAMAGE_DEALT")).toHaveLength(1);
    expect(types(events)).not.toContain("KNOCKED_OUT");
  });
});

describe("bench Knock Outs via spread (§8.1, generalized off the Active)", () => {
  it("Knocks Out a Benched Pokémon the spread makes lethal — owes its prize, NO promotion", () => {
    let state = sniperVs(2, "fix-wall", ["fix-victim"]); // wall survives 30
    state = setBenchDamage(state, "p2", 0, 10); // 10 + spread 20 = 30 = fix-victim HP
    const benched = benchTopUid(state, "p2", 0);
    const { state: after, events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });

    const ko = find(events, "KNOCKED_OUT");
    expect(ko).toMatchObject({ seat: "p2", uid: benched });
    expect(ko?.discarded).toContain(benched);
    expect(after.players.p2.discard).toContain(benched);
    // A benched KO leaves no empty Active spot, so it owes a prize but NO
    // promotion; the bench compacts and the Active is untouched.
    expect(after.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: 1 });
    expect(after.pending.map((s) => s.kind)).toEqual([
      "takePrizes",
      "endTurn",
      "checkup",
      "startTurn",
    ]);
    expect(after.players.p2.active).not.toBeNull();
    expect(after.players.p2.bench.some((p) => topUid(p) === benched)).toBe(false);
  });

  it("owes both prizes then a promotion when the spread KOs the Active AND a Benched Pokémon (prizes-first)", () => {
    let state = sniperVs(3, "fix-victim", ["fix-victim", "fix-wall"]); // active 30 HP → base 30 KOs it
    state = setBenchDamage(state, "p2", 0, 10); // benched fix-victim: 10 + 20 = 30 → KO
    const activeVictim = activeUid(state, "p2");
    const benchedVictim = benchTopUid(state, "p2", 0);
    const { state: after, events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });

    expect(
      events
        .filter((e) => e.type === "KNOCKED_OUT")
        .map((e) => (e as Extract<GameEvent, { type: "KNOCKED_OUT" }>).uid)
        .sort(),
    ).toEqual([activeVictim, benchedVictim].sort());
    // §8.1 — all prizes are taken before the promotion refills the board.
    expect(after.pending.map((s) => s.kind)).toEqual([
      "takePrizes",
      "takePrizes",
      "promote",
      "endTurn",
      "checkup",
      "startTurn",
    ]);
    expect(after.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: 1 });

    // Drive it out: p1 takes both prizes, p2 force-promotes the surviving wall,
    // then the turn ends and passes to p2.
    let next = must(applyAction(after, { type: "takePrizes", seat: "p1", prizeIndices: [0] }));
    expect(next.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: 1 });
    next = must(applyAction(next, { type: "takePrizes", seat: "p1", prizeIndices: [0] }));
    // A lone benched Pokémon (the wall) is a forced promotion → auto-resolved.
    expect(next.players.p2.active).not.toBeNull();
    expect(next.phase).toEqual({ kind: "turn:action", seat: "p2" });
    expect(next.players.p1.prizes.length).toBe(4); // took 2 of 6
  });

  it("wins immediately when a Benched KO takes the attacker's last prize (§14.1)", () => {
    let state = sniperVs(5, "fix-wall", ["fix-victim"]); // wall survives the 30
    state = setPrizes(state, "p1", 1); // one prize from victory
    state = setBenchDamage(state, "p2", 0, 10); // spread 20 → KO
    const { state: after, events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    // The forced last-prize take auto-resolves and ends the game (§14.1).
    expect(find(events, "GAME_OVER")?.outcome).toEqual({
      result: "win",
      winner: "p1",
      reason: "prizesTaken",
    });
    expect(after.phase.kind).toBe("gameOver");
  });

  it("never mutates the state it was given (purity)", () => {
    const state = sniperVs(6, "fix-wall", ["fix-victim"]);
    deepFreeze(state);
    expect(() => applyAction(state, { type: "attack", seat: "p1", index: 0 })).not.toThrow();
  });
});
