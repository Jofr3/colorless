import { describe, expect, it } from "vitest";
import { phaseViewOf, programFor } from "./index";
import type { GameEvent, GameState } from "./index";
import {
  COUNTERATTACKING_PINCER_DECK,
  attachFromDeck,
  deepFreeze,
  driveSetup,
  expectErr,
  mustApply,
  setActiveFromDeck,
  setDamage,
  types,
} from "./testFixtures";

// 0.51.0 → 0.52.0 — the `onDamagedByAttack` PARKING reactive-trigger (P3-M5, D101):
// Klawf ex sv03-120 "Counterattacking Pincer" — "If this Pokémon is in the Active
// Spot and is damaged by an attack from your opponent's Pokémon (even if this
// Pokémon is Knocked Out), discard an Energy from the Attacking Pokémon."
//
// The card that made the D99 `onDamagedByAttack` trigger PARK. Its reactive
// program is a `discardEnergy from:"opponentActive"` (Mawile's op) run under the
// DAMAGED seat, so `opponentActive` reaches the ATTACKER's Active — and the
// DEFENDER chooses which Energy. That choice parks DURING the opponent's turn:
// attack.ts stages it as a `damagedTrigger` behind the attackEpilogue, and
// flow.ts `runDamagedTrigger` folds it through settleProgram with `resumeTail`
// under the DAMAGED seat (the koTrigger routing) — so the DEFENDER is the
// answerer, the attacker still owns the turn (koParkActiveSeat), and finishAttack
// (KO sweep + turn end) resumes after the pick.

const bite = { type: "attack", seat: "p1", index: 0 } as const; // Bite — {C}, 30, no effect
const yawn = { type: "attack", seat: "p1", index: 2 } as const; // Yawn — no damage, a status

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

/** The Energy uids on `seat`'s Active, in attachment order. */
function activeEnergy(state: GameState, seat: "p1" | "p2"): string[] {
  return [...(state.players[seat].active?.energy ?? [])];
}

/** Setup then open P1's turn (P2 went first and passed) — P1 is the attacker. */
function board(seed: number): GameState {
  const state = driveSetup(
    seed,
    { p1: COUNTERATTACKING_PINCER_DECK, p2: COUNTERATTACKING_PINCER_DECK },
    { first: "p2" },
  );
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** P1 fields fix-attacker with TWO different Energy (Colorless pays Bite, Fire is
    the second candidate that makes the discard a real CHOICE); P2 fields Klawf ex.
    setActiveFromDeck displaces each setup Active (fix-bigbody) to the bench, so a
    KO always has a body to promote into. */
function fight(seed: number): GameState {
  let state = setActiveFromDeck(board(seed), "p1", "fix-attacker");
  state = attachFromDeck(state, "p1", "fix-energy", 1); // Colorless — pays Bite's {C}
  state = attachFromDeck(state, "p1", "fix-fire-energy", 1); // Fire — the 2nd, DIFFERENT candidate
  return setActiveFromDeck(state, "p2", "sv03-120");
}

describe("Counterattacking Pincer — the REGISTRY trigger (onDamagedByAttack)", () => {
  it("authors Klawf ex (sv03-120) as an active-only onDamagedByAttack discard", () => {
    expect(programFor("sv03-120")?.triggered).toEqual([
      {
        name: "Counterattacking Pincer",
        trigger: "onDamagedByAttack",
        activeOnly: true,
        program: [{ op: "discardEnergy", from: "opponentActive", filter: { kind: "anyEnergy" } }],
      },
    ]);
  });
});

describe("Counterattacking Pincer — the DEFENDER-side discard PARKS during the attacker's turn (§9.4)", () => {
  it("Bite deals 30, then the DEFENDER is asked which of the ATTACKER's Energy to discard", () => {
    const state = fight(1);
    const attackerEnergy = activeEnergy(state, "p1"); // [Colorless, Fire]
    deepFreeze(state);

    const { state: parked, events } = mustApply(state, bite);

    // The main hit first: 30 to Klawf ex (220 HP — survives), no Weakness on Bite.
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ seat: "p2", dealt: 30 });
    // …then the reactive trigger fires on the DAMAGED defender (P2, Klawf ex)…
    expect(find(events, "ABILITY_TRIGGERED")).toMatchObject({
      seat: "p2",
      ability: "Counterattacking Pincer",
    });

    // …and PARKS: the DEFENDER (P2) owes the decision, mid the ATTACKER's turn.
    expect(parked.phase.kind).toBe("effect:choose");
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(parked.phase.seat).toBe("p2"); // the reacting DEFENDER is the controller/answerer…
    expect(parked.phase.answerer).toBeUndefined(); // …so no separate answerer (the koTrigger routing)
    expect(parked.phase.resumeTail).toBe(true); // the attackEpilogue sits behind the park

    if (parked.phase.prompt.kind !== "discardEnergy") throw new Error("expected discardEnergy");
    // The candidates are the ATTACKER's (P1's) Active Energy — `opponentActive`
    // resolves to `otherSeat(damagedSeat)` = the attacker.
    expect([...parked.phase.prompt.discardable.map((d) => d.uid)].sort()).toEqual(
      [...attackerEnergy].sort(),
    );
    expect(
      parked.phase.prompt.discardable.every(
        (d) => d.from.seat === "p1" && d.from.spot.spot === "active",
      ),
    ).toBe(true);
    // The prompt is announced to the seat that must answer it — the DEFENDER.
    expect(find(events, "EFFECT_PENDING")).toMatchObject({ seat: "p2" });
  });

  it("projects the ATTACKER as active (owns the turn) and the DEFENDER as waiting", () => {
    const { state: parked } = mustApply(fight(2), bite);
    // Read the turn owner off the attackEpilogue in `pending` (koParkActiveSeat),
    // not off phase.seat — the same shape as an on-KO trigger park.
    const view = phaseViewOf(parked, "p1");
    expect(view.activeSeat).toBe("p1"); // the attacker still owns the turn
    expect(view.waitingSeat).toBe("p2"); // the defender owes the reactive decision
  });

  it("the ATTACKER cannot answer the DEFENDER's discard (WRONG_SEAT)", () => {
    const state = fight(3);
    const attackerEnergy = activeEnergy(state, "p1");
    const { state: parked } = mustApply(state, bite);
    // The turn is P1's, but this reactive decision is the DEFENDER's alone.
    expectErr(
      parked,
      { type: "resolveEffect", seat: "p1", choice: { kind: "discardEnergy", uids: [attackerEnergy[0] as string] } },
      "WRONG_SEAT",
    );
  });

  it("the DEFENDER's pick discards that Energy from the attacker, then the turn ends", () => {
    const state = fight(4);
    const attackerEnergy = activeEnergy(state, "p1");
    const { state: parked } = mustApply(state, bite);

    const chosen = attackerEnergy[0] as string; // discard the Colorless
    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p2",
      choice: { kind: "discardEnergy", uids: [chosen] },
    });

    // The ATTACKER (P1) lost exactly the chosen Energy…
    expect(find(events, "ENERGY_DISCARDED")).toMatchObject({ seat: "p1", uids: [chosen] });
    expect(activeEnergy(done, "p1")).toEqual([attackerEnergy[1]]); // the Fire one remains
    // …and the attack finished afterwards — the attackEpilogue behind the park
    // drained (finishAttack) and ended the attacker's turn.
    expect(types(events)).toContain("TURN_ENDED");
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });
});

describe("Counterattacking Pincer — 'even if this Pokémon is Knocked Out'", () => {
  it("still discards from the attacker when the attack KOs Klawf ex, which prizes 2 (ex)", () => {
    // Klawf ex pre-damaged to 190; Bite's 30 is lethal (220 ≥ 220): the discard
    // must STILL be offered, because the damagedTrigger stage runs before
    // finishAttack's §8.1 sweep.
    let state = fight(5);
    state = setDamage(state, "p2", 190);
    const attackerEnergy = activeEnergy(state, "p1");
    const klawf = state.players.p2.active?.stack.at(-1) ?? "";
    deepFreeze(state);

    const { state: parked, events } = mustApply(state, bite);
    // The reaction parked even though Klawf ex is lethally damaged.
    expect(find(events, "ABILITY_TRIGGERED")).toMatchObject({ ability: "Counterattacking Pincer" });
    expect(parked.phase.kind).toBe("effect:choose");

    const chosen = attackerEnergy[0] as string;
    const { state: done, events: resolved } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p2",
      choice: { kind: "discardEnergy", uids: [chosen] },
    });

    // The discard landed BEFORE the KO sweep…
    expect(find(resolved, "ENERGY_DISCARDED")).toMatchObject({ seat: "p1", uids: [chosen] });
    expect(find(resolved, "KNOCKED_OUT")).toMatchObject({ seat: "p2", uid: klawf });
    const order = types(resolved);
    expect(order.indexOf("ENERGY_DISCARDED")).toBeLessThan(order.indexOf("KNOCKED_OUT"));
    // …and Klawf ex is a rule-box ex, so the attacker is owed 2 Prizes (§8.1, D93).
    expect(done.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: 2 });
  });
});

describe("Counterattacking Pincer — the read-site gate (only when actually damaged)", () => {
  it("does NOT react to a 0-damage attack (Yawn — a status), so the attacker keeps its Energy", () => {
    const state = fight(6);
    const attackerEnergy = activeEnergy(state, "p1");
    deepFreeze(state);

    const { state: done, events } = mustApply(state, yawn);

    expect(types(events)).not.toContain("DAMAGE_DEALT");
    expect(
      events.find((e) => e.type === "ABILITY_TRIGGERED" && e.ability === "Counterattacking Pincer"),
    ).toBeUndefined();
    expect(types(events)).not.toContain("ENERGY_DISCARDED");
    // Both Energy are still on the attacker.
    expect([...activeEnergy(done, "p1")].sort()).toEqual([...attackerEnergy].sort());
    // Yawn DID resolve — the defender (P2) is the one that got a status (Asleep).
    expect(find(events, "STATUS_APPLIED")).toMatchObject({ seat: "p2" });
  });
});

describe("Counterattacking Pincer — a single Energy is a forced discard (no park)", () => {
  it("fires and discards without a decision when the attacker holds ONE Energy", () => {
    // One candidate ⇒ the discard is forced (M1: a choice with no choice is not a
    // choice), so the staged trigger runs non-parking — advance drains it straight
    // into the epilogue.
    let state = setActiveFromDeck(board(7), "p1", "fix-attacker");
    state = attachFromDeck(state, "p1", "fix-energy", 1); // exactly one
    state = setActiveFromDeck(state, "p2", "sv03-120");
    const only = activeEnergy(state, "p1")[0] as string;
    deepFreeze(state);

    const { state: done, events } = mustApply(state, bite);

    expect(find(events, "ABILITY_TRIGGERED")).toMatchObject({
      seat: "p2",
      ability: "Counterattacking Pincer",
    });
    // No park — resolved inline.
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(find(events, "ENERGY_DISCARDED")).toMatchObject({ seat: "p1", uids: [only] });
    expect(activeEnergy(done, "p1")).toEqual([]);
    expect(types(events)).toContain("TURN_ENDED");
  });
});
