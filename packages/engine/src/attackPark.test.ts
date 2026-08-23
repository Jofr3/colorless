import { describe, expect, it } from "vitest";
import { deriveAttackEffect } from "./effects";
import { applyAction } from "./index";
import type { GameEvent, GameState } from "./index";
import {
  ATTACK_PARK_DECK,
  activeUid,
  attachBenchFromDeck,
  attachFromDeck,
  benchFromDeck,
  deepFreeze,
  driveSetup,
  expectErr,
  mustApply,
  setActiveFromDeck,
  types,
} from "./testFixtures";

// M5 op-slice: ATTACK EFFECT PROGRAMS CAN PARK — the `attackEpilogue` stage.
//
// attack.ts used to run an attack's effect program as `runProgram(...).state`,
// which silently DROPPED a parked prompt and every op behind it. It now seeds a
// one-stage `pending` queue before the program runs and folds through
// settleProgram's `resumeTail`, so a program that stops for a decision leaves the
// epilogue (the §8.1 KO sweep + the §5.3 turn end) waiting in the queue, and
// resolveEffect drains it once the answer lands.
//
// The card family that needs it is the self-discard attack COST, a DERIVED effect
// (there is no registry row — effects.ts reads the printed sentence):
//   • "Discard an Energy from this Pokémon."  → discardEnergy yourActive (PARKS
//     when the attacker holds two distinguishable Energy);
//   • "Discard all Energy from this Pokémon." → the same op with count "all",
//     which asks nothing and resolves inline.

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

/** Setup, then open P1's turn 2 (P2 went first and passed) — P1's first
    unrestricted turn, so attacking is legal (§4). */
function board(seed: number): GameState {
  const state = driveSetup(seed, { p1: ATTACK_PARK_DECK, p2: ATTACK_PARK_DECK }, { first: "p2" });
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

function activeEnergy(state: GameState, seat: "p1" | "p2"): string[] {
  return [...(state.players[seat].active?.energy ?? [])];
}

/** P1 fields `attackerId` with `energy` attached and P2 fields `defenderId`. */
function matchup(
  seed: number,
  attackerId: string,
  defenderId: string,
  energy: readonly { id: string; count: number }[],
): GameState {
  let state = setActiveFromDeck(board(seed), "p1", attackerId);
  state = setActiveFromDeck(state, "p2", defenderId);
  for (const { id, count } of energy) state = attachFromDeck(state, "p1", id, count);
  return state;
}

describe("M5 op-slice — attack effect programs can PARK", () => {
  // ── The deriver: the printed sentences, and the ones it must NOT claim ──

  it("derives both self-discard sentences, and refuses the variants it cannot express", () => {
    expect(deriveAttackEffect("Discard an Energy from this Pokémon.")).toEqual([
      { op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" } },
    ]);
    expect(deriveAttackEffect("Discard all Energy from this Pokémon.")).toEqual([
      { op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" }, count: "all" },
    ]);
    // What is left on the loud skipped path is a RIDER after the discard, or a
    // gate this engine cannot express — never a shape of the discard itself.
    // (Everything this list used to hold now derives: the NUMERIC counts and the
    // opponent-side twins in attackDiscards.test.ts, the TYPED ones in
    // providesEnergy.test.ts.)
    for (const text of [
      // Whole-sentence anchoring: a rider after the discard is a different card.
      "Discard all Energy from this Pokémon. Your opponent's Active Pokémon is now Paralyzed.",
    ]) {
      expect(deriveAttackEffect(text)).toBeNull();
    }
    // ⚠️ RE-POINTED AT D401, NOT DELETED — the FOURTH row this list has moved rather
    // than dropped, and the last of D145's four compounds to leave it. Kyurem
    // sv06.5-047 "Trifrost" sat here as a NULL witness for the whole-sentence
    // anchoring claim; `SELF_DISCARD_THEN_ANY_TARGET` maps it, so the claim moves
    // from "nothing reads this" to the strictly stronger "THIS anchor does not reach
    // it, and the anchor that does derives BOTH halves in printed order". The
    // distinction is worth more here than on any earlier row, because a build whose
    // bare `SELF_DISCARD_ALL` swallowed the compound as a PREFIX would return the
    // discard op ALONE — an attack that pays every Energy on the body and then does
    // nothing at all — and a `toBeNull` could no longer tell that from a refusal.
    expect(
      deriveAttackEffect(
        "Discard all Energy from this Pokémon. This attack does 110 damage to 3 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      ),
    ).toEqual([
      { op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" }, count: "all" },
      { op: "damageChosen", target: "opponentAny", amount: 110, count: 3, source: "attack", deals: true },
    ]);
    // ⚠️ RE-POINTED AT D148, NOT DELETED — the THIRD row this list has moved
    // rather than dropped, and the first on the "an" form rather than the "all"
    // one. Eiscue ex sv03-042/-210/-222 "Scalding Block" sat here as a NULL
    // witness for the whole-sentence anchoring claim; D148 mapped it, so the claim
    // moves from "nothing reads this" to the strictly stronger "THIS anchor does
    // not reach it, and the anchor that does derives BOTH halves in printed
    // order". The distinction matters most on exactly this pair, because a build
    // whose bare `SELF_DISCARD_ONE` swallowed the compound as a PREFIX would
    // return the discard op ALONE — a card that pays the Energy and installs
    // nothing — and a `toBeNull` could no longer tell that from a refusal.
    expect(
      deriveAttackEffect(
        "Discard an Energy from this Pokémon. During your opponent's next turn, the Defending Pokémon can't attack.",
      ),
    ).toEqual([
      { op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" } },
      { op: "preventAttack", target: "defender" },
    ]);
    // ⚠️ RE-POINTED AT D147, NOT DELETED — and this is the SECOND time this list
    // has had to move a row rather than drop one. Eiscue sv02-048/-205 "Frigid
    // Block" sat here as a NULL witness with the note that "Eiscue's rider is a
    // family the engine will map"; D147 mapped it, so the claim moves from
    // "nothing reads this" to the strictly stronger "THIS anchor does not reach
    // it, and the anchor that does derives BOTH halves in printed order". A build
    // whose bare discard anchor swallowed the compound would return the discard
    // op ALONE, which a `toBeNull` could no longer distinguish from a correct
    // refusal — the shape claim can.
    expect(
      deriveAttackEffect(
        "Discard all Energy from this Pokémon. During your opponent's next turn, this Pokémon takes 100 less damage from attacks (after applying Weakness and Resistance).",
      ),
    ).toEqual([
      { op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" }, count: "all" },
      { op: "reduceDamage", amount: 100 },
    ]);
    // ⚠️ RE-POINTED AT D145, NOT DELETED. This list held the TAILS-GATED form of
    // the "all" sentence as a null witness until D145 mapped it; the claim was
    // never "unmapped", it was "THIS anchor does not reach it", so the row moves
    // from a NULL to a SHAPE claim — strictly stronger, because a build where the
    // bare body claimed the gated string would return the inner op UNWRAPPED and
    // a `toBeNull` could no longer say so. The gated program's `then` is this
    // anchor's own output, byte for byte.
    expect(deriveAttackEffect("Flip a coin. If tails, discard all Energy from this Pokémon.")).toEqual(
      [
        {
          op: "coinFlipGate",
          onTails: true,
          // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
          then: deriveAttackEffect("Discard all Energy from this Pokémon."),
        },
      ],
    );
  });

  // ── The park itself ──

  it("PARKS when the attacker holds two distinguishable Energy — and the epilogue waits", () => {
    // Blaze Dash costs {R}{R}{C}: two Fire + one colourless filler is both a legal
    // cost and a real choice (Fire or filler).
    const state = matchup(1, "sv02-028", "fix-bigbody", [
      { id: "fix-fire-energy", count: 2 },
      { id: "fix-energy", count: 1 },
    ]);
    const { state: parked, events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });

    // Damage landed FIRST (§8 printed order), then the effect asked its question.
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(120);
    expect(types(events)).toContain("EFFECT_PENDING");
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(parked.phase.seat).toBe("p1"); // the ATTACKER decides
    expect(parked.phase.resumeTail).toBe(true);
    // The attacker is the program's "this Pokémon" — the context names it by uid.
    expect(parked.phase.cont.ctx.sourceUid).toBe(find(events, "ATTACK_DECLARED")?.uid);
    if (parked.phase.prompt.kind !== "discardEnergy") throw new Error("expected discardEnergy");
    expect(parked.phase.prompt.note).toBe("Discard an Energy from this Pokémon.");
    expect(parked.phase.prompt.scope).toEqual({ kind: "total", count: 1 });

    // The epilogue is QUEUED, not run: the turn has not ended and nothing was
    // discarded yet. This is the whole regression — the old code returned here
    // with the prompt thrown away and the turn already over.
    // D189 — and the stage NAMES THE ATTACKER, which is the field that makes the
    // epilogue survive a program that moves its own actor. It is the same uid the
    // ATTACK_DECLARED row carries, not a re-read of whoever is in the spot.
    expect(parked.pending).toEqual([
      {
        kind: "attackEpilogue",
        seat: "p1",
        uid: find(events, "ATTACK_DECLARED")?.uid,
        // 🆕 D394 — the stage also names the ATTACK, off the same row, for the same
        // reason: `finishAttack` stamps `usedAttack` and cannot re-derive the name.
        attack: find(events, "ATTACK_DECLARED")?.attack,
      },
    ]);
    expect(types(events)).not.toContain("TURN_ENDED");
    expect(activeEnergy(parked, "p1")).toHaveLength(3);
    expect(parked.players.p1.discard).toHaveLength(0);
  });

  it("resolving the park discards, then RUNS the epilogue — the turn ends and P2 starts", () => {
    const state = matchup(2, "sv02-028", "fix-bigbody", [
      { id: "fix-fire-energy", count: 2 },
      { id: "fix-energy", count: 1 },
    ]);
    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    if (parked.phase.prompt.kind !== "discardEnergy") throw new Error("expected discardEnergy");
    const pick = parked.phase.prompt.discardable[0]?.uid as string;

    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardEnergy", uids: [pick] },
    });

    // The Energy came off the attacker into ITS OWN owner's discard pile.
    expect(activeEnergy(done, "p1")).toHaveLength(2);
    expect(activeEnergy(done, "p1")).not.toContain(pick);
    expect(done.players.p1.discard).toContain(pick);
    expect(done.players.p2.discard).not.toContain(pick);
    const discarded = find(events, "ENERGY_DISCARDED");
    expect(discarded?.seat).toBe("p1"); // the victim…
    expect(discarded?.actor).toBe("p1"); // …is also the actor, for a self-discard
    expect(discarded?.from).toEqual({ spot: "active" });

    // …and only THEN the §5.3 tail ran, in one batch.
    expect(types(events)).toEqual([
      "ENERGY_DISCARDED",
      "TURN_ENDED",
      "TURN_STARTED",
      "CARDS_DRAWN",
    ]);
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
    expect(done.pending).toEqual([]);
  });

  it("the epilogue still resolves the KO the damage caused — across the park", () => {
    // fix-victim has 30 HP: Blaze Dash's 120 is lethal, so the prize/promotion
    // stages must be queued by the epilogue AFTER the decision, not before it.
    const state = matchup(3, "sv02-028", "fix-victim", [
      { id: "fix-fire-energy", count: 2 },
      { id: "fix-energy", count: 1 },
    ]);
    const { state: parked, events: attackEvents } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: 1,
    });
    // The defender is lethally damaged but NOT yet Knocked Out — the sweep is
    // part of the epilogue, which has not run.
    expect(types(attackEvents)).not.toContain("KNOCKED_OUT");
    expect(parked.players.p2.active).not.toBeNull();

    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    if (parked.phase.prompt.kind !== "discardEnergy") throw new Error("expected discardEnergy");
    const pick = parked.phase.prompt.discardable[0]?.uid as string;
    const { state: after, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardEnergy", uids: [pick] },
    });

    // Discard, then the KO, then the prize P1 is owed (P2 promotes after).
    expect(types(events).slice(0, 2)).toEqual(["ENERGY_DISCARDED", "KNOCKED_OUT"]);
    expect(types(events)).toContain("PRIZES_OWED");
    expect(after.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: 1 });
    expect(after.pending[0]).toEqual({ kind: "takePrizes", seat: "p1", count: 1 });
  });

  it("a FORCED pick needs no park at all — the attack resolves in one action", () => {
    // Ember costs a single {R}: one Fire attached is the only candidate.
    const state = matchup(4, "sv01-039", "fix-bigbody", [{ id: "fix-fire-energy", count: 1 }]);
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });

    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(activeEnergy(done, "p1")).toHaveLength(0);
    expect(done.players.p1.discard).toHaveLength(1);
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
    expect(done.pending).toEqual([]);
  });

  it("three copies of ONE Energy print are interchangeable — no prompt", () => {
    // The M1 doctrine, applied to card identity: discarding any of three
    // identical Fire Energy leaves the identical board and the identical pile.
    const state = matchup(5, "sv02-028", "fix-bigbody", [{ id: "fix-fire-energy", count: 3 }]);
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });

    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(activeEnergy(done, "p1")).toHaveLength(2);
    expect(done.players.p1.discard).toHaveLength(1);
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("the prompt offers ONE representative per interchangeable class", () => {
    // Two Fire + two filler: four attached Energy, but only TWO real answers.
    const state = matchup(6, "sv02-028", "fix-bigbody", [
      { id: "fix-fire-energy", count: 2 },
      { id: "fix-energy", count: 2 },
    ]);
    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    if (parked.phase.prompt.kind !== "discardEnergy") throw new Error("expected discardEnergy");
    const attached = activeEnergy(parked, "p1");
    expect(attached).toHaveLength(4);
    // The first of each print, in board order.
    expect(parked.phase.prompt.discardable.map((d) => d.uid)).toEqual([attached[0], attached[2]]);

    // A suppressed duplicate was never offered, so the wire cannot reach it.
    expectErr(
      parked,
      {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "discardEnergy", uids: [attached[1] as string] },
      },
      "BAD_EFFECT_CHOICE",
    );
  });

  it("'this Pokémon' is the ACTIVE — Energy on the attacker's own Bench is untouchable", () => {
    // §8: only the Active attacks, so the printed "this Pokémon" can never reach
    // the Bench. Without the Active-only scope the attacker's benched Energy
    // would be offered as a candidate and the attack would park on a choice the
    // card does not grant.
    let state = matchup(12, "sv02-028", "fix-bigbody", [{ id: "fix-fire-energy", count: 3 }]);
    state = benchFromDeck(state, "p1", "fix-basic-1");
    state = attachBenchFromDeck(state, "p1", 0, "fix-energy", 1);
    const benched = [...(state.players.p1.bench[0]?.energy ?? [])];
    expect(benched).toHaveLength(1);

    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    // The three Active {R} are interchangeable and the Bench is out of scope, so
    // there is nothing left to ask.
    expect(types(events)).not.toContain("EFFECT_PENDING");
    const discarded = find(events, "ENERGY_DISCARDED");
    expect(discarded?.from).toEqual({ spot: "active" });
    // The benched Energy is exactly where it was.
    expect(done.players.p1.bench[0]?.energy).toEqual(benched);
    expect(done.players.p1.discard).not.toContain(benched[0]);
  });

  it("Basic Energy of the same TYPE is interchangeable even across catalog prints", () => {
    // The catalog prints one Basic Fire Energy under several ids (sve-002 /
    // sve-010 / sve-018). A card-id key would call those three separate answers
    // and park on a non-choice; a Basic Energy has no in-play identity beyond the
    // type it provides. fix-fire-energy and fix-fire-energy-alt are two ids with
    // one name, exactly that shape.
    const state = matchup(13, "sv02-028", "fix-bigbody", [
      { id: "fix-fire-energy", count: 2 },
      { id: "fix-fire-energy-alt", count: 1 },
    ]);
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: 1 });

    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(activeEnergy(done, "p1")).toHaveLength(2);
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("a Basic and a Special Energy never collapse, even providing the same type", () => {
    // The other direction: the two identity spaces are kept apart, so a Special
    // Energy is always its own answer.
    const state = matchup(14, "sv02-028", "fix-bigbody", [
      { id: "fix-fire-energy", count: 2 },
      { id: "fix-special", count: 1 },
    ]);
    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    if (parked.phase.prompt.kind !== "discardEnergy") throw new Error("expected discardEnergy");
    expect(parked.phase.prompt.discardable).toHaveLength(2);
  });

  it("a mid-tail park with an EMPTY pending queue is rejected, not silently looped", () => {
    // resumeTail's DONE branch hands control to `advance` and writes no phase of
    // its own, so an empty queue would return this very effect:choose phase with
    // the same continuation — forever, with the discard re-applied each time.
    // Unreachable through the engine's transitions; this is the ko:* handlers'
    // crafted-snapshot guard applied to the one fold that cannot self-recover.
    const state = matchup(15, "sv02-028", "fix-bigbody", [
      { id: "fix-fire-energy", count: 2 },
      { id: "fix-energy", count: 1 },
    ]);
    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    if (parked.phase.prompt.kind !== "discardEnergy") throw new Error("expected discardEnergy");
    const pick = parked.phase.prompt.discardable[0]?.uid as string;

    expectErr(
      { ...parked, pending: [] },
      { type: "resolveEffect", seat: "p1", choice: { kind: "discardEnergy", uids: [pick] } },
      "PHASE_DESYNC",
    );
    // The same answer against the INTACT queue is fine — the guard is about the
    // missing tail, not the choice.
    expect(
      applyAction(parked, {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "discardEnergy", uids: [pick] },
      }).ok,
    ).toBe(true);
  });

  it("count 'all' strips every Energy with no decision — duplicates included", () => {
    const state = matchup(7, "fix-alldiscard", "fix-bigbody", [
      { id: "fix-fire-energy", count: 2 },
      { id: "fix-energy", count: 1 },
    ]);
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });

    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(activeEnergy(done, "p1")).toEqual([]);
    expect(done.players.p1.discard).toHaveLength(3);
    // ONE event carrying all three uids — one per affected Pokémon, not per card.
    const discarded = find(events, "ENERGY_DISCARDED");
    expect(discarded?.uids).toHaveLength(3);
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  // ── The paths the epilogue must NOT disturb ──

  it("an attack with NO effect program is byte-identical to before the stage existed", () => {
    // Paldean Tauros' Raging Horns now SIMULATES its scaling ("20+" folds the
    // self-counter clause into the base, 0.34.0) but has NO PARKING program:
    // scaling is pre-damage math, not an EffectOp, so `program` is still null and
    // the epilogue runs inline. At 0 damage counters it deals its printed base 20
    // with no `scaled` and no skip — the "no park, inline epilogue" intent is kept.
    const state = matchup(8, "sv02-028", "fix-bigbody", [{ id: "fix-fire-energy", count: 2 }]);
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });

    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(done.pending).toEqual([]);
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p2" });
    // Nothing was discarded — there is no program, so no discard ran.
    expect(activeEnergy(done, "p1")).toHaveLength(2);
  });

  it("the attacker cannot act on its turn while the attack's effect is parked", () => {
    const state = matchup(9, "sv02-028", "fix-bigbody", [
      { id: "fix-fire-energy", count: 2 },
      { id: "fix-energy", count: 1 },
    ]);
    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    // turn:action is gone, so the mid-resolution attack cannot be abandoned.
    expectErr(parked, { type: "endTurn", seat: "p1" }, "BAD_PHASE");
    expectErr(parked, { type: "attack", seat: "p1", index: 1 }, "BAD_PHASE");
    // …and the opponent cannot answer the attacker's own question.
    expectErr(
      parked,
      {
        type: "resolveEffect",
        seat: "p2",
        choice: { kind: "discardEnergy", uids: [activeEnergy(parked, "p1")[0] as string] },
      },
      "WRONG_SEAT",
    );
  });

  it("never mutates the input state — the attack AND the resolve (frozen boards)", () => {
    const state = matchup(10, "sv02-028", "fix-victim", [
      { id: "fix-fire-energy", count: 2 },
      { id: "fix-energy", count: 1 },
    ]);
    expect(() =>
      applyAction(deepFreeze(state), { type: "attack", seat: "p1", index: 1 }),
    ).not.toThrow();

    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    if (parked.phase.prompt.kind !== "discardEnergy") throw new Error("expected discardEnergy");
    const pick = parked.phase.prompt.discardable[0]?.uid as string;
    expect(() =>
      applyAction(deepFreeze(parked), {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "discardEnergy", uids: [pick] },
      }),
    ).not.toThrow();
  });

  it("conserves cards across the park — every uid stays in exactly one zone", () => {
    const state = matchup(11, "sv02-028", "fix-bigbody", [
      { id: "fix-fire-energy", count: 2 },
      { id: "fix-energy", count: 1 },
    ]);
    const total = (s: GameState) =>
      (["p1", "p2"] as const).reduce((sum, seat) => {
        const side = s.players[seat];
        const inPlay = [side.active, ...side.bench].filter((p) => p !== null);
        return (
          sum +
          side.deck.length +
          side.hand.length +
          side.discard.length +
          side.prizes.length +
          inPlay.reduce((n, p) => n + p.stack.length + p.energy.length + p.tools.length, 0)
        );
      }, 0);

    const before = total(state);
    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: 1 });
    expect(total(parked)).toBe(before);
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    if (parked.phase.prompt.kind !== "discardEnergy") throw new Error("expected discardEnergy");
    const { state: done } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardEnergy", uids: [parked.phase.prompt.discardable[0]?.uid as string] },
    });
    // Invariant, not +1: the epilogue's tail drew for P2 and the pick left the
    // attacker, but both are pure MOVES between zones this sum already spans.
    expect(total(done)).toBe(before);
    expect(activeUid(done, "p1")).toBeDefined();
  });
});
