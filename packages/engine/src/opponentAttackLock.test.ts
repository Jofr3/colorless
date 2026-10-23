import { describe, expect, it } from "vitest";
import { attackLocked, lockedAttackIndexes } from "./continuous";
import { deriveAttackEffect } from "./effects";
import { applyAction, redactGame } from "./index";
import type { ApplyResult, GameEvent, GameState, InPlayPokemon, Seat } from "./index";
import { resumeProgram, runProgram } from "./interpreter";
import { type LogContext, logFromEvents } from "./log";
import {
  FIXTURE_POOL,
  OPPONENT_ATTACK_LOCK_DECK,
  activeUid,
  attachFromDeck,
  driveSetup,
  handFromDeck,
  handUid,
  must,
  mustApply,
  setActiveFromDeck,
  types,
  findEvent,
} from "./testFixtures";

/** The printed sentence, byte-for-byte off BOTH local D1 rows (the database
    compares them equal; this constant is used for both fixtures for that reason
    rather than out of convenience). */
const PLOTTED =
  "Choose 1 of your opponent's Active Pokémon's attacks. During your opponent's next turn, that Pokémon can't use that attack.";

const BITE = 0;
const FLAME = 1;
const YAWN = 2;

const SEED = 21;

function must0(pokemon: InPlayPokemon | null): InPlayPokemon {
  if (pokemon === null) throw new Error("expected an Active Pokémon");
  return pokemon;
}

function render(events: GameEvent[], state: GameState): { who: string; text: string }[] {
  const ctx: LogContext = { names: { p1: "Ember", p2: "Tide" }, state, elapsed: "+00:14" };
  return logFromEvents(events, ctx).flatMap((entry) =>
    entry.kind === "turn"
      ? []
      : [{ who: entry.who, text: entry.segments.map((s) => s.text).join("") }],
  );
}

/** The error code a declaration comes back with, or `null` when it applies. */
function refusal(state: GameState, seat: Seat, index: number): string | null {
  const result = applyAction(state, { type: "attack", seat, index });
  return result.ok ? null : result.error.code;
}

function ready(
  barrer: string,
  victim: string,
  energy: { id: string; count: number }[] | undefined = [
    { id: "fix-psychic-energy", count: 1 },
    { id: "fix-energy", count: 1 },
  ],
): GameState {
  let state = must(
    applyAction(
      driveSetup(
        SEED,
        { p1: OPPONENT_ATTACK_LOCK_DECK, p2: OPPONENT_ATTACK_LOCK_DECK },
        { first: "p2" },
      ),
      { type: "endTurn", seat: "p2" },
    ),
  );
  state = setActiveFromDeck(state, "p1", barrer);
  state = setActiveFromDeck(state, "p2", victim);
  for (const { id, count } of energy) state = attachFromDeck(state, "p1", id, count);
  return state;
}

function barred(
  index: number,
  victim = "fix-attacker",
  barrer = "sv02-094",
  energy?: { id: string; count: number }[],
) {
  const opened = mustApply(ready(barrer, victim, energy), { type: "attack", seat: "p1", index: 0 });
  if (opened.state.phase.kind !== "effect:choose") {
    throw new Error(`expected a park, got ${opened.state.phase.kind}`);
  }
  const { state, events } = mustApply(opened.state, {
    type: "resolveEffect",
    seat: "p1",
    choice: { kind: "attack", index },
  });
  const row = findEvent(events, "ATTACK_LOCKED");
  if (row === undefined) throw new Error(`the pick of index ${String(index)} barred nothing`);
  return { state, events, row, parked: opened.state };
}

/** TEST SURGERY: write a `lockedAttack` record directly, for the cases no line of
    play reaches (a stale index, a second install landing on a live record). Said
    so rather than skipped, per the family's standing rule. */
function setLock(state: GameState, seat: Seat, lock: InPlayPokemon["lockedAttacks"]): GameState {
  const side = state.players[seat];
  const active = must0(side.active);
  return {
    ...state,
    players: { ...state.players, [seat]: { ...side, active: { ...active, lockedAttacks: lock } } },
  };
}

function shield(state: GameState, seat: Seat): GameState {
  const side = state.players[seat];
  const active = must0(side.active);
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: { ...side, active: { ...active, attackBlock: { turn: state.turn, effects: true } } },
    },
  };
}

function err(result: ApplyResult): string | null {
  return result.ok ? null : result.error.code;
}

// ─────────────────────────────────────────────────────────────────────────────
// The datum: two catalog rows, re-queried rather than inherited.
// ─────────────────────────────────────────────────────────────────────────────

describe("the printed datum — both printings re-queried, field by field", () => {
  it("carries both barrers verbatim, including the fields the rows do NOT have", () => {
    const oranguru = FIXTURE_POOL["sv02-094"];
    expect(oranguru?.name).toBe("Oranguru");
    expect(oranguru?.hp).toBe(120);
    expect(oranguru?.stage).toBe("Basic");
    expect(oranguru?.types).toEqual(["Psychic"]);
    expect(oranguru?.retreat).toBe(2);
    expect(oranguru?.weaknesses).toEqual([{ type: "Darkness", value: "×2" }]);
    expect(oranguru?.resistances).toEqual([{ type: "Fighting", value: "-30" }]);
    expect(oranguru?.abilities ?? null).toBeNull();
    expect(oranguru?.evolveFrom ?? null).toBeNull();
    expect(oranguru?.attacks?.[0]).toEqual({
      cost: ["Psychic", "Colorless"],
      name: "Plotter's Command",
      damage: 30,
      effect: PLOTTED,
    });
    // …the sibling that prints NO effect text at all, which is what makes this
    // card the cleanest control for "the other attack is untouched".
    expect(oranguru?.attacks?.[1]).toEqual({
      cost: ["Psychic", "Colorless", "Colorless"],
      name: "Super Psy Bolt",
      damage: 80,
    });

    const medicham = FIXTURE_POOL["sv01-111"];
    expect(medicham?.name).toBe("Medicham");
    expect(medicham?.hp).toBe(90);
    expect(medicham?.stage).toBe("Stage1");
    expect(medicham?.evolveFrom).toBe("Meditite");
    expect(medicham?.types).toEqual(["Fighting"]);
    expect(medicham?.retreat).toBe(1);
    expect(medicham?.weaknesses).toEqual([{ type: "Psychic", value: "×2" }]);
    expect(medicham?.resistances ?? null).toBeNull();
    expect(medicham?.abilities ?? null).toBeNull();
    expect(medicham?.attacks?.[0]).toEqual({
      cost: ["Fighting"],
      name: "Acu-Punch-Ture",
      damage: 30,
      effect: PLOTTED,
    });
    expect(medicham?.attacks?.[1]?.name).toBe("Kick Shot");
    expect(deriveAttackEffect(must0Str(medicham?.attacks?.[1]?.effect))).toBeNull();
  });

  it("both printings sit at INDEX 0, and the effect strings are IDENTICAL", () => {
    const at = (id: string, name: string) =>
      FIXTURE_POOL[id]?.attacks?.findIndex((a) => a.name === name);
    expect(at("sv02-094", "Plotter's Command")).toBe(0);
    expect(at("sv01-111", "Acu-Punch-Ture")).toBe(0);
    expect(FIXTURE_POOL["sv02-094"]?.attacks?.[0]?.effect).toBe(
      FIXTURE_POOL["sv01-111"]?.attacks?.[0]?.effect,
    );
  });

  it("derives ONE op with NO capture, on both printings", () => {
    expect(deriveAttackEffect(PLOTTED)).toEqual([{ op: "preventChosenAttack" }]);
    expect(deriveAttackEffect(must0Str(FIXTURE_POOL["sv01-111"]?.attacks?.[0]?.effect))).toEqual([
      { op: "preventChosenAttack" },
    ]);
  });

  it("the anchor refuses the neighbourhood, and each refusal is a warrant", () => {
    for (const text of [
      "Choose 1 of your opponent's Active Pokémon's attacks.",
      // …the SECOND sentence alone, which no card prints standalone and whose
      // "that attack" has no referent at all.
      "During your opponent's next turn, that Pokémon can't use that attack.",
      // …and the same sentence with the possessive dropped, so the class in the
      // pattern is doing work rather than the words around it.
      "Choose 1 of your opponents Active Pokémon's attacks. During your opponent's next turn, that Pokémon can't use that attack.",
    ]) {
      expect(deriveAttackEffect(text), text).toBeNull();
    }
    expect(
      deriveAttackEffect(
        "Flip a coin. If heads, choose 1 of your opponent's Benched Pokémon. Shuffle that Pokémon and all attached cards into their deck.",
      ),
    ).toEqual([
      { op: "coinFlipGate", then: [{ op: "returnBenched", whose: "opponent", dest: "deck" }] },
    ]);
    expect(deriveAttackEffect("During your next turn, this Pokémon can't use Peck.")).toEqual([
      { op: "preventAttackUse", attack: "Peck" },
    ]);
    expect(
      deriveAttackEffect("During your opponent's next turn, the Defending Pokémon can't attack."),
    ).toEqual([{ op: "preventAttack", target: "defender" }]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The park — the three endings, and a candidate set that is not a card or a body.
// ─────────────────────────────────────────────────────────────────────────────

describe("the park — a new KIND of candidate, and `parkOrForce`'s three endings", () => {
  it("PARKS on the defender's printed attacks, naming each one", () => {
    const opened = mustApply(ready("sv02-094", "fix-attacker"), {
      type: "attack",
      seat: "p1",
      index: 0,
    });
    const phase = opened.state.phase;
    if (phase.kind !== "effect:choose") throw new Error(`expected a park, got ${phase.kind}`);
    expect(phase.prompt).toEqual({
      kind: "chooseAttack",
      candidates: [
        { index: 0, name: "Bite" },
        { index: 1, name: "Flame" },
        { index: 2, name: "Yawn" },
        { index: 3, name: "Rage" },
        { index: 4, name: "Fury" },
        { index: 5, name: "Bounty" },
      ],
      note: "Choose 1 of fix-attacker's attacks — it can't use that attack next turn.",
    });
    // The ANSWERER is the controller (the attacker), not the victim — the seat
    // whose card is asking. `answerer` is undefined, which is what puts this
    // prompt on the controller-answered side of `redactedPromptOf`'s gate.
    expect(phase.seat).toBe("p1");
    expect(phase.answerer).toBeUndefined();
    expect(findEvent(opened.events, "DAMAGE_DEALT")?.dealt).toBe(30);
    // The turn has NOT ended: the epilogue is queued behind the park.
    expect(opened.state.turn).toBe(2);
  });

  it("a ONE-attack defender is FORCED — no prompt, and the same record", () => {
    const opened = mustApply(ready("sv02-094", "fix-echoer-stage1"), {
      type: "attack",
      seat: "p1",
      index: 0,
    });
    expect(opened.state.phase.kind).not.toBe("effect:choose");
    expect(findEvent(opened.events, "ATTACK_LOCKED")).toEqual({
      type: "ATTACK_LOCKED",
      seat: "p2",
      uid: activeUid(opened.state, "p2"),
      attack: "Ripple",
    });
    expect(opened.state.players.p2.active?.lockedAttacks).toEqual([{ turn: 3, attackIndex: 0 }]);
    // …and the forced pick is BYTE-IDENTICAL to an answered one: the inline path
    // and the resolved park call the same function, which is what `parkOrForce`'s
    // contract promises for the prompts whose candidates ARE Pokémon.
    expect(opened.state.turn).toBe(3);
  });

  it("a defender with NO attacks is SILENT — no record, no row, no prompt", () => {
    const opened = mustApply(ready("sv02-094", "fix-titan"), {
      type: "attack",
      seat: "p1",
      index: 0,
    });
    expect(opened.state.phase.kind).not.toBe("effect:choose");
    expect(types(opened.events)).not.toContain("ATTACK_LOCKED");
    expect(opened.state.players.p2.active?.lockedAttacks ?? []).toEqual([]);
    expect(findEvent(opened.events, "DAMAGE_DEALT")?.dealt).toBe(30);
  });

  it("the wire cannot answer with an index the prompt did not offer", () => {
    const opened = mustApply(ready("sv02-094", "fix-echoer"), {
      type: "attack",
      seat: "p1",
      index: 0,
    });
    // fix-echoer prints TWO attacks, so 0 and 1 are the whole offer.
    for (const bad of [2, -1, 1.5, "0" as unknown as number]) {
      expect(
        err(
          applyAction(opened.state, {
            type: "resolveEffect",
            seat: "p1",
            choice: { kind: "attack", index: bad },
          }),
        ),
        String(bad),
      ).toBe("BAD_EFFECT_CHOICE");
    }
    // …and the wrong SHAPE of answer, which is the belt every prompt in this
    // engine wears: `validateChoice` matches the answer against the PARKED prompt.
    expect(
      err(
        applyAction(opened.state, {
          type: "resolveEffect",
          seat: "p1",
          choice: { kind: "pokemon", ref: { seat: "p2", spot: { spot: "active" } } },
        }),
      ),
    ).toBe("BAD_EFFECT_CHOICE");
    // …and the VICTIM cannot answer the attacker's card. The prompt files no
    // `answerer`, so the controller is the only legal respondent.
    expect(
      err(
        applyAction(opened.state, {
          type: "resolveEffect",
          seat: "p2",
          choice: { kind: "attack", index: 0 },
        }),
      ),
    ).toBe("WRONG_SEAT");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The install — the OPPONENT's body, and the `+ 1` window.
// ─────────────────────────────────────────────────────────────────────────────

describe("the install — the record lands ACROSS the table, stamped + 1", () => {
  it("writes { turn: +1, attackIndex } onto the DEFENDER and nothing onto the actor", () => {
    const before = ready("sv02-094", "fix-attacker");
    expect(before.turn).toBe(2);
    const victimUid = activeUid(before, "p2");
    const { state, row } = barred(BITE);
    expect(state.players.p2.active?.lockedAttacks).toEqual([{ turn: 3, attackIndex: BITE }]);
    expect(state.turn).toBe(3);
    expect(row).toEqual({ type: "ATTACK_LOCKED", seat: "p2", uid: victimUid, attack: "Bite" });
    expect(state.players.p1.active?.lockedAttacks ?? []).toEqual([]);
    expect(state.players.p1.active?.attackLockedTurn ?? null).toBeNull();
  });

  it("refuses exactly the barred index and OFFERS the other three", () => {
    const { state } = barred(BITE);
    expect(state.phase).toEqual({ kind: "turn:action", seat: "p2" });
    expect(refusal(state, "p2", BITE)).toBe("ATTACK_PREVENTED");
    expect(refusal(state, "p2", YAWN)).toBeNull();
    const rejected = applyAction(state, { type: "attack", seat: "p2", index: BITE });
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.error.message).toContain("Bite");
  });

  it("expires by ARITHMETIC — one turn only, and the stale record answers nothing", () => {
    // YAWN rather than BITE, because this case ends by DECLARING the formerly
    // barred attack: Yawn prints no cost, so what applies it is the gate having
    // stopped answering and never an energy the board happened to hold.
    const { state } = barred(YAWN);
    expect(lockedAttackIndexes(state, must0(state.players.p2.active))).toEqual([YAWN]);
    // P2's turn ends, P1's turn 4 passes, and P2's turn 5 is outside the window.
    let later = must(applyAction(state, { type: "endTurn", seat: "p2" }));
    expect(later.turn).toBe(4);
    later = must(applyAction(later, { type: "endTurn", seat: "p1" }));
    expect(later.turn).toBe(5);
    // The record is STILL THERE and no longer answers — the family's expiry rule
    // (a turn stamp with no boundary clear).
    expect(later.players.p2.active?.lockedAttacks).toEqual([{ turn: 3, attackIndex: YAWN }]);
    expect(lockedAttackIndexes(later, must0(later.players.p2.active))).toEqual([]);
    expect(refusal(later, "p2", YAWN)).toBeNull();
  });

  it("is IDEMPOTENT on the same address and ADDS a different one", () => {
    const board = ready("sv02-094", "fix-attacker");
    const same = setLock(board, "p2", [{ turn: 3, attackIndex: BITE }]);
    const events: GameEvent[] = [];
    const again = runProgram(
      same,
      [{ op: "preventChosenAttack" }],
      { seat: "p1", invokedBy: "attack" },
      {},
      events,
    );
    if (again.kind !== "parked") throw new Error("expected a park");
    const resolved = mustApply(must(applyAction(same, { type: "attack", seat: "p1", index: 0 })), {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "attack", index: BITE },
    });
    expect(types(resolved.events)).not.toContain("ATTACK_LOCKED");
    expect(resolved.state.players.p2.active?.lockedAttacks).toEqual([
      { turn: 3, attackIndex: BITE },
    ]);
    const other = mustApply(must(applyAction(same, { type: "attack", seat: "p1", index: 0 })), {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "attack", index: FLAME },
    });
    expect(other.state.players.p2.active?.lockedAttacks).toEqual([
      { turn: 3, attackIndex: BITE },
      { turn: 3, attackIndex: FLAME },
    ]);
    expect(lockedAttackIndexes(other.state, must0(other.state.players.p2.active))).toEqual([
      BITE,
      FLAME,
    ]);
    expect(findEvent(other.events, "ATTACK_LOCKED")?.attack).toBe("Flame");
  });

  it("an OUT-OF-RANGE index writes nothing — the apply re-validates the board", () => {
    const board = ready("sv02-094", "fix-echoer");
    const parkEvents: GameEvent[] = [];
    const result = runProgram(
      board,
      [{ op: "preventChosenAttack" }],
      { seat: "p1", invokedBy: "attack" },
      {},
      parkEvents,
    );
    if (result.kind !== "parked") throw new Error("expected a park");
    expect(result.prompt.kind).toBe("chooseAttack");
    const events: GameEvent[] = [];
    const resumed = resumeProgram(result.state, result.cont, { kind: "attack", index: 9 }, events);
    expect(events).toEqual([]);
    expect(resumed.state.players.p2.active?.lockedAttacks ?? []).toEqual([]);
    // …and the IN-RANGE answer through the same path DOES install, so the case
    // above cannot pass against a resolver that never writes anything.
    const good: GameEvent[] = [];
    const ok = resumeProgram(result.state, result.cont, { kind: "attack", index: 1 }, good);
    expect(ok.state.players.p2.active?.lockedAttacks).toEqual([{ turn: 3, attackIndex: 1 }]);
    expect(findEvent(good, "ATTACK_LOCKED")?.attack).toBe("Echo Chorus");
  });
});

describe("the log row — rendered under BOTH seats and READ", () => {
  it("names the VICTIM's Pokémon and the barred attack, and needs no new wording", () => {
    const { state, row } = barred(BITE);
    expect(render([row], state)).toEqual([
      { who: "p2", text: "fix-attacker can't use Bite next turn" },
    ]);
    expect(render([{ ...row, seat: "p1" }], state)).toEqual([
      { who: "p1", text: "fix-attacker can't use Bite next turn" },
    ]);
    expect(render([{ ...row, attack: undefined }], state)).toEqual([
      { who: "p2", text: "fix-attacker can't attack next turn" },
    ]);
    expect(refusal(state, "p2", YAWN)).toBeNull();
  });

  it("prints the CARD's spelling of the attack, not an index", () => {
    const { row } = barred(FLAME);
    expect(row.attack).toBe("Flame");
    const medicham = barred(BITE, "fix-attacker", "sv01-111", [
      { id: "fix-fighting-energy", count: 1 },
    ]);
    expect(medicham.row.attack).toBe("Bite");
    expect(medicham.state.players.p2.active?.lockedAttacks).toEqual([
      { turn: 3, attackIndex: BITE },
    ]);
  });
});

describe("§10 sheds it — every clear driven from the VICTIM's chair", () => {
  it("RETREATING inside the window sheds it — the victim's own route", () => {
    const { state } = barred(BITE);
    const bench = state.players.p2.bench;
    expect(bench.length).toBeGreaterThan(0);
    const withEnergy = attachFromDeck(state, "p2", "fix-energy", 1);
    const { state: retreated } = mustApply(withEnergy, {
      type: "retreat",
      seat: "p2",
      discardEnergy: must0(withEnergy.players.p2.active).energy.slice(0, 1),
      promoteBenchIndex: 0,
    });
    expect(retreated.players.p2.bench[0]?.lockedAttacks ?? []).toEqual([]);
  });

  it("EVOLVING inside the window frees the barred attack — and points at NOTHING", () => {
    const { state } = barred(1, "fix-echoer");
    expect(state.players.p2.active?.lockedAttacks).toEqual([{ turn: 3, attackIndex: 1 }]);
    const held = handFromDeck(state, "p2", "fix-echoer-stage1", 1);
    const { state: evolved } = mustApply(held, {
      type: "evolve",
      seat: "p2",
      uid: handUid(held, "p2", "fix-echoer-stage1"),
      target: { spot: "active" },
    });
    expect(evolved.players.p2.active?.lockedAttacks).toEqual([]);
    const { events } = mustApply(attachFromDeck(evolved, "p2", "fix-water-energy", 1), {
      type: "attack",
      seat: "p2",
      index: 0,
    });
    expect(types(events)).toContain("DAMAGE_DEALT");
  });

  it("a FORCED switch sheds it — and here that route is the INSTALLER's own mistake", () => {
    const { state } = barred(BITE);
    const p1Turn = must(applyAction(state, { type: "endTurn", seat: "p2" }));
    const held = handFromDeck(p1Turn, "p1", "sv02-172", 1);
    const barredUid = activeUid(held, "p2");
    let gusted = mustApply(held, {
      type: "playTrainer",
      seat: "p1",
      uid: handUid(held, "p1", "sv02-172"),
    }).state;
    if (gusted.phase.kind === "effect:choose") {
      gusted = must(
        applyAction(gusted, {
          type: "resolveEffect",
          seat: "p1",
          choice: { kind: "pokemon", ref: { seat: "p2", spot: { spot: "bench", index: 0 } } },
        }),
      );
    }
    const benched = gusted.players.p2.bench.find((p) => p.stack.includes(barredUid));
    expect(benched).toBeDefined();
    expect(benched?.lockedAttacks ?? []).toEqual([]);
  });

  it("the clear-set is the SAME set every durated field is on — swept, not listed", () => {
    const { state } = barred(1, "fix-echoer");
    const held = handFromDeck(state, "p2", "fix-echoer-stage1", 1);
    const { state: evolved } = mustApply(held, {
      type: "evolve",
      seat: "p2",
      uid: handUid(held, "p2", "fix-echoer-stage1"),
      target: { spot: "active" },
    });
    const body = must0(evolved.players.p2.active);
    expect({
      attackBlock: body.attackBlock,
      attackLockedTurn: body.attackLockedTurn,
      retreatLockedTurn: body.retreatLockedTurn,
      damageReduction: body.damageReduction,
      noWeaknessTurn: body.noWeaknessTurn,
      scheduledEffect: body.scheduledEffect,
      attackDamageDebuff: body.attackDamageDebuff,
      installedRecoil: body.installedRecoil,
      lockedAttacks: body.lockedAttacks,
      boostedAttack: body.boostedAttack,
      retreatBlocked: body.retreatBlocked,
    }).toEqual({
      attackBlock: null,
      attackLockedTurn: null,
      retreatLockedTurn: null,
      damageReduction: null,
      noWeaknessTurn: null,
      scheduledEffect: null,
      attackDamageDebuff: null,
      installedRecoil: null,
      lockedAttacks: [],
      boostedAttack: null,
      retreatBlocked: false,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §11 — the FIRST op in this family a wide block stops.
// ─────────────────────────────────────────────────────────────────────────────

describe("§11 — a shielded defender is not even ASKED", () => {
  it("refuses the whole op in front of the candidate scan", () => {
    const shielded = shield(ready("sv02-094", "fix-attacker"), "p2");
    const { state, events } = mustApply(shielded, { type: "attack", seat: "p1", index: 0 });
    expect(state.phase.kind).not.toBe("effect:choose");
    expect(types(events)).toContain("ATTACK_EFFECT_PREVENTED");
    expect(findEvent(events, "ATTACK_EFFECT_PREVENTED")).toEqual({
      type: "ATTACK_EFFECT_PREVENTED",
      seat: "p2",
      uid: activeUid(shielded, "p2"),
    });
    expect(state.players.p2.active?.lockedAttacks ?? []).toEqual([]);
    expect(types(events)).not.toContain("ATTACK_LOCKED");
  });

  it("…and the SAME board with the block removed installs — the control", () => {
    const bare = ready("sv02-094", "fix-attacker");
    const opened = mustApply(bare, { type: "attack", seat: "p1", index: 0 });
    expect(opened.state.phase.kind).toBe("effect:choose");
    expect(types(opened.events)).not.toContain("ATTACK_EFFECT_PREVENTED");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The projections — computed for the seat that did NOT act.
// ─────────────────────────────────────────────────────────────────────────────

describe("both payability projections agree with the §8 gate, on the LOCKED seat", () => {
  it("greys the barred row for the VICTIM and offers the other three", () => {
    const state = attachFromDeck(barred(BITE).state, "p2", "fix-energy", 1);
    const view = redactGame(state, "p2").phase;
    if (view.kind !== "turn:action") throw new Error(`expected turn:action, got ${view.kind}`);
    expect(view.attacks).toHaveLength(6);
    expect(view.attacks[BITE]?.name).toBe("Bite");
    expect(view.attacks[BITE]?.playable).toBe(false);
    expect(view.attacks[YAWN]?.name).toBe("Yawn");
    expect(view.attacks[YAWN]?.playable).toBe(true);
    const bare = redactGame(setLock(state, "p2", []), "p2").phase;
    if (bare.kind !== "turn:action") throw new Error("expected turn:action");
    expect(bare.attacks[BITE]?.playable).toBe(true);
    const dead = (rows: readonly { playable: boolean }[]) => rows.filter((r) => !r.playable).length;
    expect(dead(view.attacks) - dead(bare.attacks)).toBe(1);
    // …and the projection AGREES with the gate on both rows.
    expect(refusal(state, "p2", BITE)).toBe("ATTACK_PREVENTED");
    expect(refusal(state, "p2", YAWN)).toBeNull();
    // The INSTALLER's own view carries no attack rows at all (it is not their
    // turn), which is the seat asymmetry `redactedAttacksOf` has always had.
    const actorView = redactGame(state, "p1").phase;
    if (actorView.kind !== "turn:action") throw new Error("expected turn:action");
    expect(actorView.attacks).toEqual([]);
  });

  it("the whole-Pokémon predicate stays FALSE — this bar is not that lock", () => {
    // `attackLocked` and `lockedAttackIndex` read two different fields, and a
    // build that routed this op into `attackLockedTurn` would grey every button on
    // the victim's panel while passing every assertion about index 0.
    const { state } = barred(BITE);
    const victim = must0(state.players.p2.active);
    expect(attackLocked(state, victim)).toBe(false);
    expect(lockedAttackIndexes(state, victim)).toEqual([BITE]);
  });

  it("the PROMPT crosses to the attacker alone, with no card identity on it", () => {
    const opened = mustApply(ready("sv02-094", "fix-attacker"), {
      type: "attack",
      seat: "p1",
      index: 0,
    });
    const mine = redactGame(opened.state, "p1").phase;
    const theirs = redactGame(opened.state, "p2").phase;
    if (mine.kind !== "effect:choose" || theirs.kind !== "effect:choose") {
      throw new Error("expected effect:choose on both views");
    }
    expect(mine.prompt).toEqual({
      kind: "chooseAttack",
      candidates: [
        { index: 0, name: "Bite" },
        { index: 1, name: "Flame" },
        { index: 2, name: "Yawn" },
        { index: 3, name: "Rage" },
        { index: 4, name: "Fury" },
        { index: 5, name: "Bounty" },
      ],
      note: "Choose 1 of fix-attacker's attacks — it can't use that attack next turn.",
    });
    // The answerer gate: the victim's view carries no prompt. Here that is a
    // convenience rather than the hidden-information barrier it is for a deck
    // search — everything on the prompt is already on the victim's own board.
    expect(theirs.prompt).toBeNull();
    // …and the SPECTATOR sees neither (3c-vii).
    const watching = redactGame(opened.state, "p1", true).phase;
    if (watching.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(watching.prompt).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The design answers, as boards.
// ─────────────────────────────────────────────────────────────────────────────

describe("the shared FIELD and the separate OP, driven rather than argued", () => {
  it("D154's op and this one write the SAME field, read by the SAME reader", () => {
    const { state } = barred(BITE);
    const selfSide = setLock(state, "p1", [{ turn: 3, attackIndex: 1 }]);
    expect(lockedAttackIndexes(selfSide, must0(selfSide.players.p1.active))).toEqual([1]);
    expect(lockedAttackIndexes(selfSide, must0(selfSide.players.p2.active))).toEqual([BITE]);
  });

  it("a Pokémon can carry this bar AND D148's whole lock at once", () => {
    const { state } = barred(BITE);
    const both = {
      ...state,
      players: {
        ...state.players,
        p2: {
          ...state.players.p2,
          active: { ...must0(state.players.p2.active), attackLockedTurn: 3 },
        },
      },
    };
    expect(attackLocked(both, must0(both.players.p2.active))).toBe(true);
    expect(lockedAttackIndexes(both, must0(both.players.p2.active))).toEqual([BITE]);
    // …and every declaration is refused, because the WIDER fact wins at the gate.
    expect(refusal(both, "p2", BITE)).toBe("ATTACK_PREVENTED");
    expect(refusal(both, "p2", YAWN)).toBe("ATTACK_PREVENTED");
  });
});

/** A printed effect string that must exist — the fixtures above are asserted
    field by field one describe up, so a missing one here is a broken pool rather
    than a case worth branching on. */
function must0Str(value: string | undefined): string {
  if (value === undefined) throw new Error("expected a printed effect string");
  return value;
}
