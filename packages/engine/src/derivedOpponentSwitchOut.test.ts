import { describe, expect, it } from "vitest";
import { deriveAttackCoinFlip, deriveAttackEffect } from "./effects";
import type { EffectOp, GameEvent, GameState } from "./index";
import { applyAction, phaseViewOf, programFor } from "./index";
import { programPlayable } from "./cardplay";
import {
  FIXTURE_POOL,
  TRAINER_OPS_DECK,
  activeUid,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  deepFreeze,
  driveSetup,
  mustApply,
  setActiveFromDeck,
  types,
  walkProgram,
  programmedCardIds,
} from "./testFixtures";

const CLAUSES = [
  {
    text: "Switch out your opponent's Active Pokémon to the Bench. (Your opponent chooses the new Active Pokémon.)",
    program: [{ op: "opponentSwitchOut" }] as EffectOp[],
    printings: 19,
    legalPrintings: 10,
  },
  {
    text: "You may switch out your opponent's Active Pokémon to the Bench. (Your opponent chooses the new Active Pokémon.)",
    program: [
      {
        op: "optional",
        note: "You may switch out your opponent's Active Pokémon to the Bench. (Your opponent chooses the new Active Pokémon.)",
        ops: [{ op: "opponentSwitchOut" }],
      },
    ] as EffectOp[],
    printings: 3,
    legalPrintings: 2,
  },
  {
    text: "Switch this Pokémon with 1 of your Benched Pokémon. If you do, switch out your opponent's Active Pokémon to the Bench. (Your opponent chooses the new Active Pokémon.)",
    program: [
      { op: "switchActive", recordAs: "moved" },
      { op: "recordGate", slot: "moved", ops: [{ op: "opponentSwitchOut" }] },
    ] as EffectOp[],
    printings: 8,
    legalPrintings: 1,
  },
] as const;

const BARE = 0;
const MAY = 1;
const COMPOUND = 2;

const DAMAGE_RIDER =
  "Switch out your opponent's Active Pokémon to the Bench. (Your opponent chooses the new Active Pokémon.) If you do, this attack does 160 damage to the new Active Pokémon.";

const GUST_DAMAGE_RIDERS = [
  [
    "Switch in 1 of your opponent's Benched Pokémon to the Active Spot. This attack does 30 damage to the new Active Pokémon.",
    2,
  ],
  [
    "Switch in 1 of your opponent's Benched Pokémon to the Active Spot. This attack does 20 damage to the new Active Pokémon.",
    2,
  ],
  [
    "Switch in 1 of your opponent's Benched Pokémon to the Active Spot. This attack does 40 damage to the new Active Pokémon.",
    2,
  ],
  [
    "Switch in 1 of your opponent's Benched Pokémon to the Active Spot. This attack does 70 damage to the new Active Pokémon.",
    1,
  ],
] as const;

/** U+2019, spelled as an escape: this pair of characters renders nearly
    identically, so the curly one is always written where a reader can see it. */
const RSQUO = "’";

const KICK_AWAY = 9;
const WINDING_WAVES = 10;
const INTERJET = 11;
const GOAD_N_GRAB = 12;
const SLIP_AWAY = 5;
const TAUNT = 2;

function board(seed: number): GameState {
  const state = driveSetup(seed, { p1: TRAINER_OPS_DECK, p2: TRAINER_OPS_DECK }, { first: "p2" });
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** p1 attacks with `fix-trainerops` and holds `ownBench` benched bodies; p2 has a
    `fix-bigbody` Active and `oppBench` benched ones. Both Benches are set
    explicitly, because every case here is about which side was ASKED. */
function ready(seed: number, ownBench: number, oppBench: number): GameState {
  let state = setActiveFromDeck(board(seed), "p1", "fix-trainerops");
  state = attachFromDeck(state, "p1", "fix-energy", 1);
  state = clearBench(state, "p1");
  for (let i = 0; i < ownBench; i++) state = benchFromDeck(state, "p1", "fix-basic-1");
  state = setActiveFromDeck(state, "p2", "fix-bigbody");
  state = clearBench(state, "p2");
  for (let i = 0; i < oppBench; i++) state = benchFromDeck(state, "p2", "fix-basic-1");
  return state;
}

function all<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. THE ANCHORS
// ─────────────────────────────────────────────────────────────────────────────

describe("the three anchors — one new op, and two compositions of things that existed", () => {
  it("derives each printed sentence to its program", () => {
    for (const { text, program } of CLAUSES) {
      expect(deriveAttackEffect(text), text).toEqual(program);
    }
  });

  it("adds up: 13 of the family's 14 legal printings, across 3 sentences", () => {
    expect(CLAUSES).toHaveLength(3);
    expect(CLAUSES.reduce((sum, c) => sum + c.legalPrintings, 0)).toBe(13);
    expect(CLAUSES[BARE].legalPrintings).toBe(10);
    expect(CLAUSES[MAY].legalPrintings).toBe(2);
    expect(CLAUSES[COMPOUND].legalPrintings).toBe(1);
    expect(deriveAttackEffect(DAMAGE_RIDER)).not.toEqual(CLAUSES[BARE].program);
    expect(deriveAttackEffect(DAMAGE_RIDER)?.[0]).toEqual({
      op: "opponentSwitchOut",
      recordAs: "moved",
    });
  });

  it("only the BARE arm invents an op; the other two COMPOSE", () => {
    const kinds = (ops: readonly EffectOp[]): string[] => ops.map((o) => o.op);
    expect(kinds(CLAUSES[BARE].program)).toEqual(["opponentSwitchOut"]);
    expect(kinds(CLAUSES[MAY].program)).toEqual(["optional"]);
    expect(kinds(CLAUSES[COMPOUND].program)).toEqual(["switchActive", "recordGate"]);
    const primeCatcher = programFor("sv05-157")?.trainer ?? [];
    expect(kinds(primeCatcher)).toEqual(["gust", "recordGate"]);
  });

  it("the GATED sentence's `then` is BYTE-IDENTICAL to the bare arm's whole program", () => {
    // This family's checkable claim, the same one the four draw anchors carry: a
    // "You may X" must be exactly "X" behind a gate, or the wrapper is quietly
    // building a different card.
    const gated = deriveAttackEffect(CLAUSES[MAY].text)?.[0];
    expect(gated?.op).toBe("optional");
    expect(gated?.op === "optional" ? gated.ops : undefined).toEqual(
      deriveAttackEffect(CLAUSES[BARE].text),
    );
    // …and the note is the WHOLE printed sentence, which is what the dialog shows.
    expect(gated?.op === "optional" ? gated.note : undefined).toBe(CLAUSES[MAY].text);
  });

  it("the COMPOUND's antecedent is the bare self-switch plus one recording key", () => {
    const [first] = deriveAttackEffect(CLAUSES[COMPOUND].text) ?? [];
    expect(first).toEqual({ op: "switchActive", recordAs: "moved" });
    expect(deriveAttackEffect("Switch this Pokémon with 1 of your Benched Pokémon.")).toEqual([
      { op: "switchActive" },
    ]);
  });

  it("accepts BOTH apostrophes on all three — deliberately, not accidentally", () => {
    for (const { text, program } of CLAUSES) {
      const curled = text.replaceAll("'", RSQUO);
      expect(curled).not.toBe(text);
      const derived = deriveAttackEffect(curled);
      expect(derived, curled).not.toBeNull();
      // Equal modulo the `optional` note, which ECHOES its input by design — the
      // one part of a derived program that is supposed to follow the spelling.
      expect(JSON.stringify(derived).replaceAll(RSQUO, "'"), curled).toEqual(
        JSON.stringify(program),
      );
    }
  });

  it("hands no clause to the coin reader, and reads no near-miss of its own", () => {
    for (const { text } of CLAUSES) expect(deriveAttackCoinFlip(text), text).toBeNull();
    expect(deriveAttackCoinFlip(DAMAGE_RIDER)).toBeNull();
    for (const text of [
      "Switch in 1 of your opponent's Benched Pokémon to the Active Spot.",
      "Your opponent chooses 1 of their Benched Pokémon and switches it with their Active Pokémon. The new Active Pokémon is now Asleep.",
    ]) {
      expect(deriveAttackEffect(text), text).not.toEqual(CLAUSES[BARE].program);
    }
  });

  it("refuses the anchor, punctuation and case rewrites — the parenthetical included", () => {
    const bare = CLAUSES[BARE].text;
    const rewrites = [
      "Switch out your opponent's Active Pokémon to the Bench.",
      // …and the parenthetical alone, which is not a sentence the engine reads.
      "(Your opponent chooses the new Active Pokémon.)",
      // A leading clause — the shape a `$`-only build eats.
      `Draw a card. ${bare}`,
      `${bare} Draw a card.`,
      // Case, which these readers commit to.
      bare.toLowerCase(),
      bare.toUpperCase(),
      // The plural the catalog does not print.
      bare.replace("Active Pokémon to the Bench", "Active Pokémon to the Benches"),
    ];
    for (const text of rewrites) expect(deriveAttackEffect(text), text).toBeNull();
    // …but outer whitespace is trimmed, like every other sentence this reader
    // takes — asserted so the refusals above are about the ANCHOR and not about
    // the reader being brittle.
    expect(deriveAttackEffect(`  ${bare}  `)).toEqual(CLAUSES[BARE].program);
  });
});

describe("PROVENANCE — the demonstrator carries all three of this slice's sentences, and the 14th beside them", () => {
  it("fields the family at indices 9-12, appended and not inserted", () => {
    const attacks = FIXTURE_POOL["fix-trainerops"]?.attacks ?? [];
    expect(attacks).toHaveLength(73);
    expect(attacks[KICK_AWAY]?.effect).toBe(CLAUSES[BARE].text);
    expect(attacks[WINDING_WAVES]?.effect).toBe(CLAUSES[MAY].text);
    expect(attacks[INTERJET]?.effect).toBe(CLAUSES[COMPOUND].text);
    expect(attacks[GOAD_N_GRAB]?.effect).toBe(DAMAGE_RIDER);
    expect(attacks[TAUNT]?.effect).toBe(
      "Switch in 1 of your opponent's Benched Pokémon to the Active Spot.",
    );
    expect(attacks[SLIP_AWAY]?.effect).toBe("Switch this Pokémon with 1 of your Benched Pokémon.");
  });

  it("▶️ D228 BUILT THE 14th — it no longer STAYS LOUD, and the board says which", () => {
    const state = ready(31, 1, 2);
    const wasActive = activeUid(state, "p2");
    deepFreeze(state);
    const parked = mustApply(state, { type: "attack", seat: "p1", index: GOAD_N_GRAB });
    // The opponent IS asked (two benched bodies), and they are the answerer.
    expect(parked.state.phase.kind).toBe("effect:choose");
    expect(phaseViewOf(parked.state, "p2").waitingSeat).toBe("p2");
    // Nothing has been dealt yet — the whole sentence is behind the answer.
    expect(all(parked.events, "DAMAGE_DEALT")).toHaveLength(0);
    expect(all(parked.events, "ATTACK_EFFECT_SKIPPED")).toHaveLength(0);
    const target = parked.state.players.p2.bench[0];
    const done = mustApply(parked.state, {
      type: "resolveEffect",
      seat: "p2",
      choice: { kind: "pokemon", ref: { seat: "p2", spot: { spot: "bench", index: 0 } } },
    });
    const dealt = all(done.events, "DAMAGE_DEALT");
    expect(dealt).toHaveLength(1);
    expect(dealt[0]?.uid).toBe(target?.stack[0]);
    expect(dealt[0]?.uid).not.toBe(wasActive);
    expect(dealt[0]?.base).toBe(160);
    expect(all(done.events, "KNOCKED_OUT")[0]?.uid).toBe(target?.stack[0]);
    // …and the body that was switched OUT is on the Bench, untouched.
    expect(done.state.players.p2.bench.some((b) => b.stack[0] === wasActive)).toBe(true);
    expect(all(done.events, "ATTACK_EFFECT_SKIPPED")).toHaveLength(0);
  });

  it("the four sentences the 14th shared its mechanism with are built too", () => {
    let riderPrintings = 1; // Grimmsnarl itself
    for (const [text, legal] of GUST_DAMAGE_RIDERS) {
      expect(deriveAttackEffect(text), text).not.toBeNull();
      riderPrintings += legal;
    }
    expect(riderPrintings).toBe(8);
    const counterPut = deriveAttackEffect(
      "Put 5 damage counters on your opponent's Active Pokémon.",
    );
    expect(counterPut).toEqual([{ op: "damageActive", amount: 50, source: "attack" }]);
  });
});

describe("end to end — the OPPONENT answers, and that is the whole op", () => {
  it("PARKS on the opponent's Bench with the opponent as ANSWERER", () => {
    const state = ready(41, 2, 3);
    const attacker = activeUid(state, "p1");
    deepFreeze(state);
    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: KICK_AWAY });

    expect(parked.phase.kind).toBe("effect:choose");
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(parked.phase.seat).toBe("p1");
    expect(parked.phase.answerer).toBe("p2");
    expect(parked.phase.resumeTail).toBe(true);
    // The candidates are the opponent's OWN Bench — the same set `gust` offers,
    // which is why the seat above is the only thing distinguishing the two.
    expect(parked.phase.prompt.kind).toBe("choosePokemon");
    if (parked.phase.prompt.kind !== "choosePokemon") throw new Error("expected choosePokemon");
    expect(parked.phase.prompt.candidates).toHaveLength(3);
    for (const ref of parked.phase.prompt.candidates) {
      expect(ref.seat).toBe("p2");
      expect(ref.spot.spot).toBe("bench");
    }
    // The note speaks to the ANSWERER about their own board.
    expect(parked.phase.prompt.note).toBe("Choose your new Active Pokémon.");
    // Nothing has moved yet, and the attacker is still where it was.
    expect(activeUid(parked, "p1")).toBe(attacker);
    expect(parked.pending).toEqual([
      { kind: "attackEpilogue", seat: "p1", uid: attacker, attack: "Kick Away" },
    ]);
  });

  it("REFUSES the CONTROLLER's answer, and accepts the opponent's", () => {
    const { state: parked } = mustApply(ready(42, 1, 2), {
      type: "attack",
      seat: "p1",
      index: KICK_AWAY,
    });
    const choice = {
      kind: "pokemon",
      ref: { seat: "p2", spot: { spot: "bench", index: 0 } },
    } as const;
    const refused = applyAction(parked, { type: "resolveEffect", seat: "p1", choice });
    expect(refused.ok).toBe(false);
    expect(refused.ok === false ? refused.error.code : undefined).toBe("WRONG_SEAT");
    // …and the same message from the other chair lands.
    const { state: done } = mustApply(parked, { type: "resolveEffect", seat: "p2", choice });
    expect(done.phase.kind).not.toBe("effect:choose");
  });

  it("the GUST is the same board and the OTHER answerer — the crossed-build control", () => {
    const { state: gusted } = mustApply(ready(43, 1, 3), {
      type: "attack",
      seat: "p1",
      index: TAUNT,
    });
    const { state: pushed } = mustApply(ready(43, 1, 3), {
      type: "attack",
      seat: "p1",
      index: KICK_AWAY,
    });
    if (gusted.phase.kind !== "effect:choose" || pushed.phase.kind !== "effect:choose") {
      throw new Error("expected both to park");
    }
    expect(gusted.phase.answerer).toBeUndefined();
    expect(pushed.phase.answerer).toBe("p2");
    // …and the OFFER is identical, which is what isolates the difference to the
    // seat rather than to the candidate computation.
    expect(
      pushed.phase.prompt.kind === "choosePokemon" ? pushed.phase.prompt.candidates : null,
    ).toEqual(gusted.phase.prompt.kind === "choosePokemon" ? gusted.phase.prompt.candidates : []);
  });

  it("moves the OPPONENT's Active, never the attacker's — the other crossed build", () => {
    const state = ready(44, 2, 1);
    const attacker = activeUid(state, "p1");
    const wasActive = activeUid(state, "p2");
    const wasBenched = state.players.p2.bench[0]?.stack[0];
    deepFreeze(state);
    const { state: done } = mustApply(state, { type: "attack", seat: "p1", index: KICK_AWAY });
    // One benched body → forced, no question to ask (the no-choice rule holds
    // for a cross-seat park exactly as for an own-seat one).
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(activeUid(done, "p2")).toBe(wasBenched);
    expect(done.players.p2.bench[0]?.stack[0]).toBe(wasActive);
    // The attacker did not move, and its own Bench is stocked so a crossed build
    // would have had somewhere to go.
    expect(activeUid(done, "p1")).toBe(attacker);
    expect(done.players.p1.bench).toHaveLength(2);
  });

  it("is a SILENT no-op on an empty opponent Bench — and not a skipped effect", () => {
    const state = ready(45, 2, 0);
    const before = [activeUid(state, "p1"), activeUid(state, "p2")];
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: KICK_AWAY,
    });
    expect([activeUid(done, "p1"), activeUid(done, "p2")]).toEqual(before);
    expect(done.phase.kind).not.toBe("effect:choose");
    // The sentence WAS read and had no legal target. p1's own Bench is stocked, so
    // a crossed build would have found candidates and moved something.
    expect(all(events, "ATTACK_EFFECT_SKIPPED")).toHaveLength(0);
    expect(types(events)).toContain("TURN_ENDED");
  });

  it("the ATTACKER's turn ends only once the OPPONENT has answered", () => {
    // The sequencing an `answerer` on an attack park buys, and the reason the
    // `attackEpilogue` had to be in `pending` behind it: the turn cannot fold while
    // the other player owes a decision, and it must fold the moment they pay it.
    const state = ready(46, 1, 2);
    const { state: parked, events: parkEvents } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: KICK_AWAY,
    });
    expect(types(parkEvents)).not.toContain("TURN_ENDED");
    // EFFECT_PENDING names the seat that must resolve — the ANSWERER, not the
    // controller (the event's own doc).
    expect(all(parkEvents, "EFFECT_PENDING")[0]?.seat).toBe("p2");
    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p2",
      choice: { kind: "pokemon", ref: { seat: "p2", spot: { spot: "bench", index: 1 } } },
    });
    expect(types(events)).toContain("TURN_ENDED");
    expect(done.pending).toEqual([]);
    expect(all(events, "POKEMON_SWITCHED")).toHaveLength(1);
  });

  it("`phaseViewOf` moves waitingSeat to the opponent and WITHHOLDS the prompt", () => {
    // The projection half, which is what makes this renderable on both surfaces
    // without a line of client code: the answerer is waited on and sees the
    // prompt; the controller is not and does not.
    const { state: parked } = mustApply(ready(47, 1, 3), {
      type: "attack",
      seat: "p1",
      index: KICK_AWAY,
    });
    const forOpponent = phaseViewOf(parked, "p2");
    expect(forOpponent.waitingSeat).toBe("p2");
    expect(forOpponent.activeSeat).toBe("p1"); // the TURN is still the attacker's
    expect(forOpponent.pendingDecision).not.toBeNull();
    const forController = phaseViewOf(parked, "p1");
    expect(forController.waitingSeat).toBe("p2");
    expect(forController.activeSeat).toBe("p1");
    expect(forController.pendingDecision).toBeNull();
    const decision = forOpponent.pendingDecision;
    if (decision?.kind !== "effectChoose") throw new Error("expected effectChoose");
    expect(decision.prompt.kind).toBe("choosePokemon");
    if (decision.prompt.kind !== "choosePokemon") throw new Error("expected choosePokemon");
    expect(decision.prompt.candidates.every((ref) => ref.seat === "p2")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. THE TWO COMPOSITIONS
// ─────────────────────────────────────────────────────────────────────────────

describe("end to end — the printed 'You may', two questions to two people", () => {
  it("asks the CONTROLLER first, then the OPPONENT — in that order", () => {
    const state = ready(51, 1, 3);
    const { state: confirming } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: WINDING_WAVES,
    });
    // Question one: the controller's consent.
    if (confirming.phase.kind !== "effect:choose") throw new Error("expected a confirm park");
    expect(confirming.phase.prompt.kind).toBe("confirm");
    expect(confirming.phase.answerer).toBeUndefined();
    expect(confirming.phase.seat).toBe("p1");

    // Question two: the opponent's pick, behind it.
    const { state: choosing } = mustApply(confirming, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "confirm", yes: true },
    });
    if (choosing.phase.kind !== "effect:choose") throw new Error("expected a pokemon park");
    expect(choosing.phase.prompt.kind).toBe("choosePokemon");
    expect(choosing.phase.answerer).toBe("p2");
  });

  it("D422 — ASKS ON AN EMPTY OPPONENT BENCH TOO, and the YES does nothing", () => {
    const state = ready(53, 1, 0);
    const before = [activeUid(state, "p1"), activeUid(state, "p2")];
    expect(state.players.p2.bench).toHaveLength(0);
    const { state: confirming } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: WINDING_WAVES,
    });
    // ASKED — on a board where the answer cannot matter.
    if (confirming.phase.kind !== "effect:choose") throw new Error("expected a confirm park");
    expect(confirming.phase.prompt.kind).toBe("confirm");
    expect(confirming.phase.answerer).toBeUndefined();
    // The YES: nothing moves, nobody is asked again, and the attack was USED.
    const { state: done, events } = mustApply(confirming, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "confirm", yes: true },
    });
    expect([activeUid(done, "p1"), activeUid(done, "p2")]).toEqual(before);
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(all(events, "POKEMON_SWITCHED")).toHaveLength(0);
    expect(all(events, "ATTACK_EFFECT_SKIPPED")).toHaveLength(0);
    expect(types(events)).toContain("TURN_ENDED");
    const { state: stocked } = mustApply(ready(53, 1, 2), {
      type: "attack",
      seat: "p1",
      index: WINDING_WAVES,
    });
    const { state: reached } = mustApply(stocked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "confirm", yes: true },
    });
    if (reached.phase.kind !== "effect:choose") throw new Error("expected the opponent park");
    expect(reached.phase.answerer).toBe("p2");
  });

  it("a DECLINE moves nobody and ends the turn — the opponent is never asked", () => {
    const state = ready(52, 1, 3);
    const wasActive = activeUid(state, "p2");
    const { state: confirming } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: WINDING_WAVES,
    });
    const { state: done, events } = mustApply(confirming, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "confirm", yes: false },
    });
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(activeUid(done, "p2")).toBe(wasActive);
    expect(all(events, "POKEMON_SWITCHED")).toHaveLength(0);
    expect(types(events)).toContain("TURN_ENDED");
  });
});

describe("end to end — Iron Bundle's compound, and the gate that is not decoration", () => {
  it("switches the ATTACKER, then hands the OPPONENT their own question", () => {
    const state = ready(61, 2, 3);
    const attacker = activeUid(state, "p1");
    const { state: ownPark } = mustApply(state, { type: "attack", seat: "p1", index: INTERJET });
    // Question one: the attacker's own Bench, answered by the attacker.
    if (ownPark.phase.kind !== "effect:choose") throw new Error("expected the self-switch park");
    expect(ownPark.phase.answerer).toBeUndefined();
    if (ownPark.phase.prompt.kind !== "choosePokemon") throw new Error("expected choosePokemon");
    expect(ownPark.phase.prompt.candidates.every((ref) => ref.seat === "p1")).toBe(true);
    expect(ownPark.phase.prompt.note).toBe(
      "Switch to which Benched Pokémon? If you do, switch out your opponent's Active Pokémon to the Bench.",
    );

    // Question two: the opponent's Bench, answered by the opponent.
    const { state: oppPark } = mustApply(ownPark, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon", ref: { seat: "p1", spot: { spot: "bench", index: 0 } } },
    });
    expect(activeUid(oppPark, "p1")).not.toBe(attacker);
    if (oppPark.phase.kind !== "effect:choose") throw new Error("expected the gated park");
    expect(oppPark.phase.answerer).toBe("p2");
    expect(oppPark.phase.prompt.note).toBe("Choose your new Active Pokémon.");
  });

  it("an EMPTY attacker Bench skips the consequent — the gate driven, not argued", () => {
    const state = ready(62, 0, 3);
    const attacker = activeUid(state, "p1");
    const wasActive = activeUid(state, "p2");
    expect(state.players.p1.bench).toHaveLength(0);
    deepFreeze(state);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: INTERJET,
    });
    expect(activeUid(done, "p1")).toBe(attacker); // nobody switched
    expect(activeUid(done, "p2")).toBe(wasActive); // …so nobody was pushed out
    expect(done.phase.kind).not.toBe("effect:choose"); // …and nothing was asked
    expect(all(events, "POKEMON_SWITCHED")).toHaveLength(0);
    // The attack was USED — the gate is a printed condition, not a failure.
    expect(all(events, "ATTACK_EFFECT_SKIPPED")).toHaveLength(0);
    expect(types(events)).toContain("TURN_ENDED");
    const { state: reached } = mustApply(ready(62, 1, 3), {
      type: "attack",
      seat: "p1",
      index: INTERJET,
    });
    if (reached.phase.kind !== "effect:choose") throw new Error("expected the gated park");
    expect(reached.phase.answerer).toBe("p2");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. THE SEAM — what this op does NOT reach
// ─────────────────────────────────────────────────────────────────────────────

describe("the seam — the gates and surfaces this op deliberately does not touch", () => {
  it("~~`programPlayable` gets NO arm~~ — the one card PLAY that reaches the op (D555) reaches it behind `switchActive`'s gate ( D587 (D539): WITHDRAWN — Repel `me01-126` is a top-level producer and the arm is written)", () => {
    const state = ready(71, 1, 0);
    expect(state.players.p2.bench).toHaveLength(0);
    expect(programPlayable(state, [{ op: "gust" }], "p1")).toBe(false);
    expect(programPlayable(state, [{ op: "opponentSwitchOut" }], "p1")).toBe(false);
    // …and the ATTACK on the same board is used, not refused — the difference the
    // predicate above is about.
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: KICK_AWAY });
    expect(all(events, "ATTACK_EFFECT_SKIPPED")).toHaveLength(0);
    const authored = programmedCardIds().filter((id) => {
      const card = programFor(id);
      const programs: EffectOp[][] = [
        ...(card?.trainer === undefined ? [] : [card.trainer]),
        ...(card?.abilities ?? []).map((a) => a.program),
        ...(card?.triggered ?? []).map((t) => t.program),
        ...Object.values(card?.attack ?? {}),
      ];
      return programs.some((ops) => walkProgram(ops).some((op) => op.op === "opponentSwitchOut"));
    });
    expect([...authored].sort()).toEqual(["me01-126", "sv10.5w-023", "sv10.5w-107"]);
    expect(programFor("me01-126")?.trainer).toEqual([{ op: "opponentSwitchOut" }]);
    for (const id of ["sv10.5w-023", "sv10.5w-107"]) {
      const program = programFor(id)?.abilities?.[0]?.program ?? [];
      // Never at the top level: behind the gate, after the gated switch.
      expect(program.map((op) => op.op)).toEqual(["switchActive", "recordGate"]);
    }
  });

  it("carries NO `recordAs`, and the absence is a fact about the catalog", () => {
    const bare = deriveAttackEffect(CLAUSES[BARE].text)?.[0];
    expect(bare).toEqual({ op: "opponentSwitchOut" });
    expect(Object.keys(bare ?? {})).toEqual(["op"]);
    // The two that DO record, for contrast — read off the shipped programs.
    expect(programFor("sv05-157")?.trainer?.[0]).toEqual({ op: "gust", recordAs: "moved" });
    expect(deriveAttackEffect(CLAUSES[COMPOUND].text)?.[0]).toHaveProperty("recordAs");
  });
});
