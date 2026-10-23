import type { Card, SeatLogEntry } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { prizeValueOf } from "./cards";
import { deriveAttackEffect } from "./effects";
import type { BoardCondition, EffectOp } from "./effects";
import { applyAction, attackLocked, programFor, redactGame } from "./index";
import type { GameEvent, GameState, InPlayPokemon, Seat } from "./index";
import { conditionHolds, conditionNote } from "./interpreter";
import { type LogContext, logFromEvents } from "./log";
import {
  DEFENDER_LOCK_DECK,
  FIXTURE_POOL,
  activeUid,
  attachFromDeck,
  benchFromDeck,
  driveSetup,
  handFromDeck,
  handUid,
  must,
  mustApply,
  setActiveFromDeck,
  setConditions,
  findEvent,
} from "./testFixtures";

const EISCUE_TEXT =
  "Discard an Energy from this Pokémon. During your opponent's next turn, the Defending Pokémon can't attack.";
const HOUNDOOM_TEXT =
  "If the Defending Pokémon is a Basic Pokémon, it can't attack during your opponent's next turn.";
const SELF_TEXT = "During your next turn, this Pokémon can't attack.";
/** Eiscue ex's first sentence ALONE. It derives — it is `SELF_DISCARD_ONE`, live
    since 0.x — which is precisely why the compound needs a whole-sentence anchor:
    a PREFIX match here would pay the Energy and install nothing. */
const DISCARD_HALF_ONLY = "Discard an Energy from this Pokémon.";

const SEED = 11;

const INSTALL_INDEX = 0;

function countOf<T extends GameEvent["type"]>(events: GameEvent[], type: T): number {
  return events.filter((e) => e.type === type).length;
}

/** The engine's rejection code for an attack declaration, or `"ok"`. */
function refusal(state: GameState, seat: Seat, index: number): string {
  const result = applyAction(state, { type: "attack", seat, index });
  return result.ok ? "ok" : result.error.code;
}

const LOG_CTX = (state: GameState): LogContext => ({
  names: { p1: "Ember", p2: "Tide" },
  state,
  elapsed: "+00:07",
});

function textOf(entry: SeatLogEntry | undefined): string {
  if (entry === undefined) return "";
  if (entry.kind === "turn") return `— turn ${entry.turn} —`;
  return entry.segments.map((segment) => segment.text).join("");
}

function renderedLock(
  events: GameEvent[],
  after: GameState,
): (SeatLogEntry & { kind: "action" }) | undefined {
  const locked = events.filter((e) => e.type === "ATTACK_LOCKED");
  if (locked.length === 0) return undefined;
  const row = logFromEvents(locked, LOG_CTX(after))[0];
  return row?.kind === "action" ? row : undefined;
}

type Installer = "sv03-042" | "sv03-134";
type Victim = "sv01-048" | "sv03-134" | "fix-titan";

function armed(installer: Installer, victim: Victim, spare = false): GameState {
  let state = must(
    applyAction(
      driveSetup(SEED, { p1: DEFENDER_LOCK_DECK, p2: DEFENDER_LOCK_DECK }, { first: "p2" }),
      { type: "endTurn", seat: "p2" },
    ),
  );
  state = setActiveFromDeck(state, "p2", victim);
  state = setActiveFromDeck(state, "p1", installer);
  // The displaced setup Actives are now benched on both sides, which three of the
  // §10 cases and every KO case need — asserted, because a bench-less board would
  // make them vacuous rather than failing.
  if (state.players.p1.bench.length === 0) throw new Error("armed() left P1 with no bench");
  if (state.players.p2.bench.length === 0) throw new Error("armed() left P2 with no bench");
  if (state.turn !== 2) throw new Error(`armed() expected turn 2, got ${state.turn}`);
  state =
    installer === "sv03-042"
      ? attachFromDeck(state, "p1", "fix-water-energy", 3)
      : attachFromDeck(state, "p1", "fix-dark-energy", 2);
  return spare ? attachFromDeck(state, "p1", "fix-energy", 1) : state;
}

function installed(installer: Installer, victim: Victim, spare = false): GameState {
  const { state, events } = mustApply(armed(installer, victim, spare), {
    type: "attack",
    seat: "p1",
    index: INSTALL_INDEX,
  });
  let next = state;
  let rows = events;
  if (next.phase.kind === "effect:choose") {
    const energyUid = next.players.p1.active?.energy[0];
    if (energyUid === undefined) throw new Error("parked with no Energy to discard");
    const resolved = mustApply(next, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardEnergy", uids: [energyUid] },
    });
    next = resolved.state;
    rows = [...rows, ...resolved.events];
  }
  if (findEvent(rows, "ATTACK_LOCKED") === undefined) {
    throw new Error(`${installer} installed no lock`);
  }
  if (next.turn !== 3) throw new Error(`expected P2's turn 3, got ${next.turn}`);
  return next;
}

// ── The deriver ──────────────────────────────────────────────────────────────

describe("the opponent-side lock — derived, not authored", () => {
  it("neither printing has a registry row — the printed text IS the program", () => {
    for (const id of ["sv03-042", "sv03-134"]) {
      expect(programFor(id)?.attack).toBeUndefined();
    }
  });

  it("derives Eiscue ex's COMPOUND to TWO ops in PRINTED ORDER", () => {
    const printed = FIXTURE_POOL["sv03-042"]?.attacks?.[INSTALL_INDEX]?.effect;
    expect(printed).toBe(EISCUE_TEXT);
    expect(deriveAttackEffect(EISCUE_TEXT)).toEqual([
      { op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" } },
      { op: "preventAttack", target: "defender" },
    ]);
    expect(deriveAttackEffect(EISCUE_TEXT.replace(/'/g, "’"))).toEqual(
      deriveAttackEffect(EISCUE_TEXT),
    );
  });

  it("derives Houndoom ex's CLASS GATE to a conditionGate over the SAME op", () => {
    const printed = FIXTURE_POOL["sv03-134"]?.attacks?.[INSTALL_INDEX]?.effect;
    expect(printed).toBe(HOUNDOOM_TEXT);
    expect(deriveAttackEffect(HOUNDOOM_TEXT)).toEqual([
      {
        op: "conditionGate",
        cond: { kind: "opponentActiveIsBasic" },
        then: [{ op: "preventAttack", target: "defender" }],
      },
    ]);
    expect(deriveAttackEffect(HOUNDOOM_TEXT.replace(/'/g, "’"))).toEqual(
      deriveAttackEffect(HOUNDOOM_TEXT),
    );
  });

  it("the gated `then` is byte-identical to the compound's SECOND op", () => {
    const gated = deriveAttackEffect(HOUNDOOM_TEXT) as EffectOp[];
    const gate = gated[0];
    if (gate?.op !== "conditionGate") throw new Error("expected a conditionGate");
    const compound = deriveAttackEffect(EISCUE_TEXT) as EffectOp[];
    expect(gate.then).toEqual([compound[1]]);
    expect(Object.keys(gate)).toEqual(["op", "cond", "then"]);
  });

  it("the DEFENDER arm and the SELF arm are two different programs", () => {
    expect(deriveAttackEffect(SELF_TEXT)).toEqual([{ op: "preventAttack" }]);
    const selfOp = (deriveAttackEffect(SELF_TEXT) as EffectOp[])[0] as object;
    expect(Object.keys(selfOp)).toEqual(["op"]);
    const defenderOp = (deriveAttackEffect(EISCUE_TEXT) as EffectOp[])[1] as object;
    expect(Object.keys(defenderOp)).toEqual(["op", "target"]);
    expect(defenderOp).not.toEqual(selfOp);
  });

  it("refuses the compound's FIRST SENTENCE as a prefix — and that half DERIVES", () => {
    expect(deriveAttackEffect(DISCARD_HALF_ONLY)).toEqual([
      { op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" } },
    ]);
    expect(deriveAttackEffect(EISCUE_TEXT)).not.toEqual(deriveAttackEffect(DISCARD_HALF_ONLY));
    const compoundOps = deriveAttackEffect(EISCUE_TEXT) as EffectOp[];
    expect(
      deriveAttackEffect("During your opponent's next turn, the Defending Pokémon can't attack."),
    ).toEqual([compoundOps[1]]);
    // …and the bare-plural spelling of the same rule, which the ONE alternation
    // anchor also claims: same op, same seat, same window, one token apart.
    expect(
      deriveAttackEffect(
        "During your opponent's next turn, the Defending Pokémon can't use attacks.",
      ),
    ).toEqual([compoundOps[1]]);
  });

  it("is anchored end to end", () => {
    for (const text of [
      `Then, ${EISCUE_TEXT}`,
      EISCUE_TEXT.slice(0, -1),
      EISCUE_TEXT.toLowerCase(),
      EISCUE_TEXT.replace(". During", ".During"),
      `${HOUNDOOM_TEXT} Draw a card.`,
      HOUNDOOM_TEXT.slice(0, -1),
      HOUNDOOM_TEXT.toLowerCase(),
      HOUNDOOM_TEXT.replace("a Basic Pokémon", "an Evolution Pokémon"),
      HOUNDOOM_TEXT.replace("a Basic Pokémon", "a Darkness Pokémon"),
      // …and the printed noun phrase matters: "your opponent's Active Pokémon" is
      // the SAME board fact under a different name, and no card prints it on this
      // skeleton, so it stays loud rather than being read by resemblance.
      HOUNDOOM_TEXT.replace("the Defending Pokémon", "your opponent's Active Pokémon"),
    ]) {
      expect(deriveAttackEffect(text)).toBeNull();
    }
    // Outer whitespace SURVIVES by design (the deriver trims), which states which
    // drift is tolerated and which is not.
    expect(deriveAttackEffect(`\t  ${HOUNDOOM_TEXT}\n`)).toEqual(deriveAttackEffect(HOUNDOOM_TEXT));
  });

  it("Houndoom ex's INDEX 1 derives its own sentence, and no program leaks", () => {
    // The index control, and the one claim the remainder list DID make about this
    // card: "Hound's Fang" (220) at index 1 prints a BARE recoil, simulated since
    // 0.x. Read off the fixture so the index itself is pinned.
    const second = FIXTURE_POOL["sv03-134"]?.attacks?.[1];
    expect(second?.name).toBe("Hound's Fang");
    expect(second?.damage).toBe(220);
    expect(deriveAttackEffect(second?.effect ?? "")).toEqual([{ op: "damageSelf", amount: 30 }]);
  });
});

// ── The BoardCondition ───────────────────────────────────────────────────────

describe("`opponentActiveIsBasic` — the predicate, read off the board", () => {
  const BASIC: BoardCondition = { kind: "opponentActiveIsBasic" };
  const EVOLUTION: BoardCondition = { kind: "opponentActiveIsEvolution" };

  it("is the exact complement of `opponentActiveIsEvolution` on every real body", () => {
    for (const victim of ["sv01-048", "sv03-134", "fix-titan"] as const) {
      const state = armed("sv03-134", victim);
      expect(conditionHolds(state, "p1", BASIC)).not.toBe(conditionHolds(state, "p1", EVOLUTION));
    }
    // …and the two answers are actually different from each other across the set,
    // so the assertion above is not vacuously satisfied by one constant.
    expect(conditionHolds(armed("sv03-134", "sv01-048"), "p1", BASIC)).toBe(true);
    expect(conditionHolds(armed("sv03-134", "sv03-134"), "p1", BASIC)).toBe(false);
  });

  it("reads the TOP card, so an EVOLVED body is no longer Basic", () => {
    // §1.2 — a Pokémon's identity is its top card. This is what makes the §10
    // evolve clear a real counterplay rather than a rule written for symmetry,
    // and it is asserted on a real evolution rather than by surgery.
    let state = armed("sv03-134", "sv01-048");
    expect(conditionHolds(state, "p1", BASIC)).toBe(true);
    state = must(applyAction(state, { type: "endTurn", seat: "p1" }));
    state = handFromDeck(state, "p2", "fix-mola-stage1", 1);
    state = must(
      applyAction(state, {
        type: "evolve",
        seat: "p2",
        uid: handUid(state, "p2", "fix-mola-stage1"),
        target: { spot: "active" },
      }),
    );
    expect(conditionHolds(state, "p1", BASIC)).toBe(false);
  });

  it("is FALSE with an empty Active Spot, and reads the OPPONENT of `seat`", () => {
    const state = armed("sv03-134", "sv01-048");
    // The cross-board direction: P1's own Active is a Stage 1 Houndoom ex, P2's is
    // a Basic Alomomola, so the two seats give opposite answers off one board.
    expect(conditionHolds(state, "p1", BASIC)).toBe(true);
    expect(conditionHolds(state, "p2", BASIC)).toBe(false);
    const emptied: GameState = {
      ...state,
      players: { ...state.players, p2: { ...state.players.p2, active: null } },
    };
    expect(conditionHolds(emptied, "p1", BASIC)).toBe(false);
  });

  it("has a printed note, phrased off the BOARD rather than off the card", () => {
    expect(conditionNote(BASIC)).toBe("your opponent's Active Pokémon is a Basic Pokémon");
    expect(conditionNote(BASIC)).not.toBe(conditionNote(EVOLUTION));
  });
});

// ── The window ───────────────────────────────────────────────────────────────

describe("the opponent-side lock — the window is `state.turn + 1`", () => {
  it("locks the DEFENDER on the very next turn, and NOT the installer", () => {
    const state = installed("sv03-134", "sv01-048");
    expect(state.players.p2.active?.attackLockedTurn).toBe(3);
    expect(state.players.p1.active?.attackLockedTurn).toBeNull();
    expect(attackLocked(state, state.players.p2.active as InPlayPokemon)).toBe(true);
    expect(attackLocked(state, state.players.p1.active as InPlayPokemon)).toBe(false);
  });

  it("drives the whole window turn by turn, from BOTH seats", () => {
    // Install on turn 2 → stamp 3 → the victim's turn 3 refuses BOTH of their
    // attacks → the installer's turn 4 is untouched → the victim's turn 5 attacks
    // normally. Every boundary is a real `endTurn`, never arithmetic on the field.
    let state = installed("sv03-134", "sv01-048");
    state = attachFromDeck(state, "p2", "fix-water-energy", 2);
    expect(state.turn).toBe(3);
    expect(refusal(state, "p2", 0)).toBe("ATTACK_PREVENTED");
    expect(refusal(state, "p2", 1)).toBe("ATTACK_PREVENTED");
    state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
    expect(state.turn).toBe(4);
    expect(refusal(state, "p1", INSTALL_INDEX)).toBe("ok");
    state = must(applyAction(state, { type: "endTurn", seat: "p1" }));
    // …and the victim's turn 5: expired by arithmetic, with the stale stamp still
    // sitting on the body answering nothing.
    expect(state.turn).toBe(5);
    expect(state.players.p2.active?.attackLockedTurn).toBe(3);
    expect(attackLocked(state, state.players.p2.active as InPlayPokemon)).toBe(false);
    const { events } = mustApply(state, { type: "attack", seat: "p2", index: 0 });
    expect(findEvent(events, "DAMAGE_DEALT")?.dealt).toBe(30);
  });

  it("refuses BOTH of the victim's attacks — the lock is on the POKÉMON", () => {
    let state = installed("sv03-134", "sv01-048");
    state = attachFromDeck(state, "p2", "fix-water-energy", 2);
    state = attachFromDeck(state, "p2", "fix-energy", 1);
    expect(refusal(state, "p2", 0)).toBe("ATTACK_PREVENTED");
    expect(refusal(state, "p2", 1)).toBe("ATTACK_PREVENTED");
  });

  it("Eiscue ex writes the same window from behind its Energy cost", () => {
    const state = installed("sv03-042", "sv03-134", true);
    expect(state.players.p2.active?.attackLockedTurn).toBe(3);
    expect(state.players.p2.active?.damage).toBe(160);
    expect(refusal(state, "p2", 0)).toBe("ATTACK_PREVENTED");
    expect(refusal(state, "p2", 1)).toBe("ATTACK_PREVENTED");
  });

  it("the §12 gate still comes FIRST — two refusals, two codes", () => {
    let state = installed("sv03-134", "sv01-048");
    expect(refusal(state, "p2", 0)).toBe("ATTACK_PREVENTED");
    state = setConditions(state, "p2", { rotation: "asleep" });
    expect(refusal(state, "p2", 0)).toBe("STATUS_PREVENTS_ATTACK");
  });
});

// ── The park, and the seed-free claim ────────────────────────────────────────

describe("the opponent-side lock — it installs BEHIND a park", () => {
  it("parks on the discard, then installs on the RESUMED tail", () => {
    const state = armed("sv03-042", "sv03-134", true);
    const first = mustApply(state, { type: "attack", seat: "p1", index: INSTALL_INDEX });
    expect(first.state.phase.kind).toBe("effect:choose");
    expect(findEvent(first.events, "ATTACK_LOCKED")).toBeUndefined();
    expect(first.state.players.p2.active?.attackLockedTurn).toBeNull();
    const energyUid = first.state.players.p1.active?.energy[0];
    if (energyUid === undefined) throw new Error("parked with no Energy to discard");
    const resolved = mustApply(first.state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardEnergy", uids: [energyUid] },
    });
    const rows = [...first.events, ...resolved.events];
    const discardAt = rows.findIndex((e) => e.type === "ENERGY_DISCARDED");
    const lockAt = rows.findIndex((e) => e.type === "ATTACK_LOCKED");
    expect(discardAt).toBeGreaterThanOrEqual(0);
    expect(lockAt).toBeGreaterThan(discardAt);
    expect(resolved.state.players.p2.active?.attackLockedTurn).toBe(3);
  });

  it("does NOT park when the pick has no pick in it, and still installs", () => {
    // Three identical {W} attached collapses the offer to one distinct choice, so
    // the M1 no-choice rule auto-resolves it and the whole attack settles inline.
    // The lock must land either way — the park is procedure, not effect.
    const state = armed("sv03-042", "sv03-134");
    const { state: after, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: INSTALL_INDEX,
    });
    expect(after.phase.kind).not.toBe("effect:choose");
    expect(findEvent(events, "ATTACK_LOCKED")).toBeDefined();
    expect(after.players.p2.active?.attackLockedTurn).toBe(3);
  });

  it("consumes NO rng across a whole park-and-resolve — the seed-free claim", () => {
    const before = armed("sv03-042", "sv03-134", true);
    const first = mustApply(before, { type: "attack", seat: "p1", index: INSTALL_INDEX });
    const energyUid = first.state.players.p1.active?.energy[0];
    if (energyUid === undefined) throw new Error("parked with no Energy to discard");
    const resolved = mustApply(first.state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardEnergy", uids: [energyUid] },
    });
    expect(resolved.state.rngState).toEqual(before.rngState);
    // …and Houndoom's gate takes none either: a board CONDITION is a fact both
    // players can read off the table, which is exactly why `conditionGate` emits
    // no event and draws no coin (effects.ts).
    const gate = armed("sv03-134", "sv01-048");
    const claw = mustApply(gate, { type: "attack", seat: "p1", index: INSTALL_INDEX });
    expect(claw.state.rngState).toEqual(gate.rngState);
  });
});

// ── The predicate, on real boards ────────────────────────────────────────────

describe("Evil Claw's class gate — both answers, one printed line of play apart", () => {
  it("HOLDS on a Basic defender — the attack lands AND the lock installs", () => {
    const state = armed("sv03-134", "sv01-048");
    const { state: after, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: INSTALL_INDEX,
    });
    expect(findEvent(events, "DAMAGE_DEALT")?.dealt).toBe(90);
    expect(findEvent(events, "ATTACK_LOCKED")).toBeDefined();
    expect(after.players.p2.active?.attackLockedTurn).toBe(3);
  });

  it("FAILS on an EVOLVED defender — full damage, no lock, and NO row at all", () => {
    let state = armed("sv03-134", "sv01-048");
    state = must(applyAction(state, { type: "endTurn", seat: "p1" }));
    state = handFromDeck(state, "p2", "fix-mola-stage1", 1);
    state = must(
      applyAction(state, {
        type: "evolve",
        seat: "p2",
        uid: handUid(state, "p2", "fix-mola-stage1"),
        target: { spot: "active" },
      }),
    );
    state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
    state = attachFromDeck(state, "p1", "fix-dark-energy", 2);
    expect(state.turn).toBe(4);
    const { state: after, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: INSTALL_INDEX,
    });
    expect(findEvent(events, "DAMAGE_DEALT")?.dealt).toBe(90);
    expect(findEvent(events, "ATTACK_LOCKED")).toBeUndefined();
    expect(findEvent(events, "ATTACK_EFFECT_SKIPPED")).toBeUndefined();
    expect(after.players.p2.active?.attackLockedTurn).toBeNull();
    // …and the un-locked body attacks on its own next turn, so "no lock" is a
    // fact about the board rather than about an absent event.
    let free = attachFromDeck(after, "p2", "fix-water-energy", 1);
    expect(free.turn).toBe(5);
    const swing = mustApply(free, { type: "attack", seat: "p2", index: 0 });
    expect(findEvent(swing.events, "DAMAGE_DEALT")?.dealt).toBe(40);
    free = swing.state;
    expect(free.players.p1.active?.attackLockedTurn).toBeNull();
  });

  it("reads the defender as of RESOLUTION, not as of the turn's start", () => {
    let state = benchFromDeck(armed("sv03-134", "sv03-134"), "p2", "sv01-048");
    expect(conditionHolds(state, "p1", { kind: "opponentActiveIsBasic" })).toBe(false);
    state = handFromDeck(state, "p1", "sv02-172", 1);
    const played = mustApply(state, {
      type: "playTrainer",
      seat: "p1",
      uid: handUid(state, "p1", "sv02-172"),
    });
    let next = played.state;
    if (next.phase.kind === "effect:choose") {
      const index = next.players.p2.bench.findIndex((p) => {
        const uid = p.stack[p.stack.length - 1];
        return uid !== undefined && next.cardIdByUid[uid] === "sv01-048";
      });
      expect(index).toBeGreaterThanOrEqual(0);
      next = must(
        applyAction(next, {
          type: "resolveEffect",
          seat: "p1",
          choice: { kind: "pokemon", ref: { seat: "p2", spot: { spot: "bench", index } } },
        }),
      );
    }
    expect(next.cardIdByUid[activeUid(next, "p2")]).toBe("sv01-048");
    const { events } = mustApply(next, { type: "attack", seat: "p1", index: INSTALL_INDEX });
    expect(findEvent(events, "ATTACK_LOCKED")).toBeDefined();
  });
});

// ── Both payability projections ──────────────────────────────────────────────

describe("the opponent-side lock — both projections, from the LOCKED seat", () => {
  it("`redactedAttacksOf` offers the victim nothing the server would take", () => {
    let held = installed("sv03-134", "sv01-048");
    held = attachFromDeck(held, "p2", "fix-water-energy", 2);
    held = attachFromDeck(held, "p2", "fix-energy", 1);
    const locked = redactGame(held, "p2").phase;
    if (locked.kind !== "turn:action") throw new Error(`expected turn:action, got ${locked.kind}`);
    expect(locked.attacks).toHaveLength(2);
    for (const attack of locked.attacks) {
      expect(attack.playable, `attack ${attack.index} offered under a lock`).toBe(false);
      expect(refusal(held, "p2", attack.index)).toBe("ATTACK_PREVENTED");
    }
    // …and two turns later the same projection offers them again, so the sweep
    // above is about the LOCK rather than about an unpayable cost.
    let later = must(applyAction(held, { type: "endTurn", seat: "p2" }));
    later = must(applyAction(later, { type: "endTurn", seat: "p1" }));
    const free = redactGame(later, "p2").phase;
    if (free.kind !== "turn:action") throw new Error(`expected turn:action, got ${free.kind}`);
    expect(free.attacks.some((a) => a.playable)).toBe(true);
  });

  it("GameHud's own predicate agrees with the gate on both seats and both turns", () => {
    const held = installed("sv03-134", "sv01-048");
    expect(attackLocked(held, held.players.p2.active as InPlayPokemon)).toBe(true);
    expect(attackLocked(held, held.players.p1.active as InPlayPokemon)).toBe(false);
    let later = must(applyAction(held, { type: "endTurn", seat: "p2" }));
    expect(attackLocked(later, later.players.p1.active as InPlayPokemon)).toBe(false);
    later = must(applyAction(later, { type: "endTurn", seat: "p1" }));
    expect(attackLocked(later, later.players.p2.active as InPlayPokemon)).toBe(false);
  });

  it("only ATTACKING is gated — every other turn:action verb still works", () => {
    // The guard is SWEPT over the vocabulary rather than sampled, in the one
    // direction that has never been swept: on the seat that did not install.
    let state = installed("sv03-134", "sv01-048");
    state = handFromDeck(state, "p2", "sv01-194", 1);
    state = handFromDeck(state, "p2", "fix-water-energy", 1);
    // attach
    const attached = mustApply(state, {
      type: "attachEnergy",
      seat: "p2",
      uid: handUid(state, "p2", "fix-water-energy"),
      target: { spot: "active" },
    });
    expect(attached.state.allowances.energyAttached).toBe(true);
    // play a Trainer (the Switch this suite uses for the §10 clear elsewhere)
    expect(
      applyAction(state, {
        type: "playTrainer",
        seat: "p2",
        uid: handUid(state, "p2", "sv01-194"),
      }).ok,
    ).toBe(true);
    const funded = attachFromDeck(state, "p2", "fix-energy", 2);
    expect(
      applyAction(funded, {
        type: "retreat",
        seat: "p2",
        discardEnergy: (funded.players.p2.active?.energy ?? []).slice(0, 2),
        promoteBenchIndex: 0,
      }).ok,
    ).toBe(true);
    // …and ending the turn, which is the only thing a fully locked player has left
    expect(applyAction(state, { type: "endTurn", seat: "p2" }).ok).toBe(true);
  });
});

// ── The §10 early clears — the VICTIM's counterplay ──────────────────────────

describe("the opponent-side lock — §10 ends it, and every route is the VICTIM's", () => {
  it("EVOLVING frees the locked body to attack the SAME turn", () => {
    let held = installed("sv03-134", "sv01-048");
    expect(refusal(held, "p2", 0)).toBe("ATTACK_PREVENTED");
    held = handFromDeck(held, "p2", "fix-mola-stage1", 1);
    held = must(
      applyAction(held, {
        type: "evolve",
        seat: "p2",
        uid: handUid(held, "p2", "fix-mola-stage1"),
        target: { spot: "active" },
      }),
    );
    expect(held.players.p2.active?.attackLockedTurn).toBeNull();
    held = attachFromDeck(held, "p2", "fix-water-energy", 1);
    const { events } = mustApply(held, { type: "attack", seat: "p2", index: 0 });
    expect(findEvent(events, "DAMAGE_DEALT")?.dealt).toBe(40);
  });

  it("RETREATING clears it, and a Switch brings the body back able to attack", () => {
    let held = installed("sv03-134", "sv01-048");
    const locked = activeUid(held, "p2");
    held = attachFromDeck(held, "p2", "fix-energy", 2);
    held = must(
      applyAction(held, {
        type: "retreat",
        seat: "p2",
        discardEnergy: (held.players.p2.active?.energy ?? []).slice(0, 2),
        promoteBenchIndex: 0,
      }),
    );
    const benched = held.players.p2.bench.find((p) => p.stack.includes(locked));
    expect(benched?.attackLockedTurn).toBeNull();
    // …and GONE rather than merely unread. Switch it back and it attacks.
    held = handFromDeck(held, "p2", "sv01-194", 1);
    const switched = mustApply(held, {
      type: "playTrainer",
      seat: "p2",
      uid: handUid(held, "p2", "sv01-194"),
    });
    let back = switched.state;
    if (back.phase.kind === "effect:choose") {
      const index = back.players.p2.bench.findIndex((p) => p.stack.includes(locked));
      expect(index).toBeGreaterThanOrEqual(0);
      back = must(
        applyAction(back, {
          type: "resolveEffect",
          seat: "p2",
          choice: { kind: "pokemon", ref: { seat: "p2", spot: { spot: "bench", index } } },
        }),
      );
    }
    expect(activeUid(back, "p2")).toBe(locked);
    expect(back.players.p2.active?.attackLockedTurn).toBeNull();
    back = attachFromDeck(back, "p2", "fix-water-energy", 2);
    const { events } = mustApply(back, { type: "attack", seat: "p2", index: 0 });
    expect(findEvent(events, "DAMAGE_DEALT")?.dealt).toBe(30);
  });

  it("the INSTALLER cannot reach any of the three routes inside the window", () => {
    const held = installed("sv03-134", "sv01-048");
    expect(held.turn).toBe(3);
    expect(applyAction(held, { type: "endTurn", seat: "p1" }).ok).toBe(false);
    expect(
      applyAction(held, { type: "retreat", seat: "p1", discardEnergy: [], promoteBenchIndex: 0 })
        .ok,
    ).toBe(false);
  });

  it("a KNOCKED OUT holder takes the lock out of play with the stack", () => {
    const { state, events } = mustApply(armed("sv03-042", "sv01-048"), {
      type: "attack",
      seat: "p1",
      index: INSTALL_INDEX,
    });
    const lockAt = events.findIndex((e) => e.type === "ATTACK_LOCKED");
    const koAt = events.findIndex((e) => e.type === "KNOCKED_OUT");
    expect(lockAt).toBeGreaterThanOrEqual(0);
    expect(koAt).toBeGreaterThan(lockAt);
    // The promoted body is a DIFFERENT Pokémon and carries no lock at all.
    let next = state;
    if (next.phase.kind === "ko:takePrizes") {
      next = must(applyAction(next, { type: "takePrizes", seat: "p1", prizeIndices: [0] }));
    }
    if (next.phase.kind === "ko:promote") {
      next = must(applyAction(next, { type: "promote", seat: "p2", benchIndex: 0 }));
    }
    expect(next.players.p2.active).not.toBeNull();
    expect(next.players.p2.active?.attackLockedTurn).toBeNull();
    expect(attackLocked(next, next.players.p2.active as InPlayPokemon)).toBe(false);
  });
});

// ── The §11 block — the defender refuses the rider ───────────────────────────

describe("the opponent-side lock — a §11 effects block REFUSES it", () => {
  function shielded(state: GameState): GameState {
    const active = state.players.p2.active;
    if (active === null) throw new Error("no defender to shield");
    return {
      ...state,
      players: {
        ...state.players,
        p2: { ...state.players.p2, active: { ...active, attackBlock: { turn: 2, effects: true } } },
      },
    };
  }

  it("a WIDE block refuses the lock and announces the refusal", () => {
    // The classification `preventBlock.test.ts` demanded before it would go green:
    // this op reaches one of the opponent's Pokémon, so a live block must refuse
    // it. `preventRetreat`'s exact case, one op along.
    const { state, events } = mustApply(shielded(armed("sv03-134", "sv01-048")), {
      type: "attack",
      seat: "p1",
      index: INSTALL_INDEX,
    });
    expect(findEvent(events, "ATTACK_EFFECT_PREVENTED")).toBeDefined();
    expect(findEvent(events, "ATTACK_LOCKED")).toBeUndefined();
    expect(state.players.p2.active?.attackLockedTurn).toBeNull();
    // …and the damage half was nulled by the same block, which is what makes this
    // one block and not two rules that happen to agree.
    expect(findEvent(events, "DAMAGE_DEALT")?.prevented).toBe(true);
  });

  it("a NARROW block nulls the damage and lets the lock through", () => {
    const state = armed("sv03-134", "sv01-048");
    const active = state.players.p2.active;
    if (active === null) throw new Error("no defender");
    const narrow: GameState = {
      ...state,
      players: {
        ...state.players,
        p2: {
          ...state.players.p2,
          active: { ...active, attackBlock: { turn: 2, effects: false } },
        },
      },
    };
    const { state: after, events } = mustApply(narrow, {
      type: "attack",
      seat: "p1",
      index: INSTALL_INDEX,
    });
    expect(findEvent(events, "DAMAGE_DEALT")?.prevented).toBe(true);
    expect(findEvent(events, "ATTACK_EFFECT_PREVENTED")).toBeUndefined();
    expect(findEvent(events, "ATTACK_LOCKED")).toBeDefined();
    expect(after.players.p2.active?.attackLockedTurn).toBe(3);
  });

  it("refuses Eiscue ex's lock while its Energy cost is still paid", () => {
    const before = shielded(armed("sv03-042", "sv03-134"));
    const energyBefore = before.players.p1.active?.energy.length ?? 0;
    const { state, events } = mustApply(before, {
      type: "attack",
      seat: "p1",
      index: INSTALL_INDEX,
    });
    expect(state.players.p1.active?.energy.length).toBe(energyBefore - 1);
    expect(findEvent(events, "ATTACK_EFFECT_PREVENTED")).toBeDefined();
    expect(state.players.p2.active?.attackLockedTurn).toBeNull();
  });
});

// ── Two installers, one body ─────────────────────────────────────────────────

describe("the opponent-side lock — two installs on one body", () => {
  it("a self-lock and a defender-lock can name the SAME turn, and the second is silent", () => {
    let state = armed("sv03-134", "sv01-048");
    state = must(applyAction(state, { type: "endTurn", seat: "p1" }));
    state = attachFromDeck(state, "p2", "fix-water-energy", 2);
    state = attachFromDeck(state, "p2", "fix-energy", 1);
    expect(state.turn).toBe(3);
    const selfLock = mustApply(state, { type: "attack", seat: "p2", index: 1 });
    expect(selfLock.state.players.p2.active?.attackLockedTurn).toBe(5);
    expect(findEvent(selfLock.events, "ATTACK_LOCKED")?.seat).toBe("p2");
    let next = selfLock.state;
    expect(next.turn).toBe(4);
    const second = mustApply(next, { type: "attack", seat: "p1", index: INSTALL_INDEX });
    next = second.state;
    expect(next.players.p2.active?.attackLockedTurn).toBe(5);
    expect(findEvent(second.events, "ATTACK_LOCKED")).toBeUndefined();
    expect(refusal(next, "p2", 0)).toBe("ATTACK_PREVENTED");
    expect(refusal(next, "p2", 1)).toBe("ATTACK_PREVENTED");
  });

  it("the stamps are MONOTONE — a later install never writes an earlier turn", () => {
    let state = installed("sv03-134", "fix-titan");
    const stamps: number[] = [state.players.p2.active?.attackLockedTurn ?? -1];
    for (let round = 0; round < 2; round += 1) {
      state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
      const { state: after } = mustApply(state, {
        type: "attack",
        seat: "p1",
        index: INSTALL_INDEX,
      });
      state = after;
      stamps.push(state.players.p2.active?.attackLockedTurn ?? -1);
    }
    expect(stamps).toEqual([...stamps].sort((a, b) => a - b));
    expect(new Set(stamps).size).toBe(stamps.length);
  });
});

// ── The log ──────────────────────────────────────────────────────────────────

describe("the opponent-side lock — one row, read in sequence from both seats", () => {
  it("files the row under the LOCKED seat and reads correctly there", () => {
    const state = armed("sv03-134", "sv01-048");
    const { state: after, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: INSTALL_INDEX,
    });
    const row = findEvent(events, "ATTACK_LOCKED");
    expect(row?.seat).toBe("p2");
    expect(row?.uid).toBe(activeUid(state, "p2"));
    const rendered = renderedLock(events, after);
    expect(rendered?.who).toBe("p2");
    expect(textOf(rendered)).toBe("Alomomola can't attack next turn");
    expect(countOf(events, "ATTACK_LOCKED")).toBe(1);
  });

  it("renders the SAME wording for the self arm — one arm, both directions", () => {
    let state = installed("sv03-134", "sv01-048");
    state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
    state = must(applyAction(state, { type: "endTurn", seat: "p1" }));
    state = attachFromDeck(state, "p2", "fix-water-energy", 2);
    state = attachFromDeck(state, "p2", "fix-energy", 1);
    const { state: after, events } = mustApply(state, { type: "attack", seat: "p2", index: 1 });
    const row = findEvent(events, "ATTACK_LOCKED");
    expect(row?.seat).toBe("p2");
    const rendered = renderedLock(events, after);
    expect(rendered?.who).toBe("p2");
    expect(textOf(rendered)).toBe("Alomomola can't attack next turn");
  });

  it("emits NOTHING when the class gate declines", () => {
    const state = armed("sv03-134", "sv03-134");
    const { state: after, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: INSTALL_INDEX,
    });
    expect(countOf(events, "ATTACK_LOCKED")).toBe(0);
    const rows = logFromEvents(events, LOG_CTX(after));
    expect(rows.some((entry) => textOf(entry).includes("can't attack"))).toBe(false);
  });
});

// ── The fixtures, verified against the printed catalog ───────────────────────

describe("the fixtures ARE the printed cards", () => {
  it("carries every field this slice reads, per printing", () => {
    const eiscue = FIXTURE_POOL["sv03-042"];
    expect(eiscue?.name).toBe("Eiscue ex");
    expect(eiscue?.hp).toBe(210);
    expect(eiscue?.stage).toBe("Basic");
    expect(eiscue?.attacks).toHaveLength(1);
    expect(eiscue?.attacks?.[0]?.name).toBe("Scalding Block");
    expect(eiscue?.attacks?.[0]?.damage).toBe(160);
    expect(eiscue?.attacks?.[0]?.cost).toEqual(["Water", "Water", "Water"]);

    const houndoom = FIXTURE_POOL["sv03-134"];
    expect(houndoom?.name).toBe("Houndoom ex");
    expect(houndoom?.hp).toBe(270);
    expect(houndoom?.stage).toBe("Stage1");
    expect(houndoom?.evolveFrom).toBe("Houndour");
    expect(houndoom?.attacks).toHaveLength(2);
    expect(houndoom?.attacks?.[0]?.name).toBe("Evil Claw");
    expect(houndoom?.attacks?.[0]?.damage).toBe(90);
    expect(houndoom?.attacks?.[0]?.cost).toEqual(["Darkness", "Darkness"]);
    expect(houndoom?.attacks?.[1]?.name).toBe("Hound's Fang");
    expect(prizeValueOf(eiscue as Card)).toBe(2);
    expect(prizeValueOf(houndoom as Card)).toBe(2);
  });

  it("the deck is 60 cards and the pool holds every id in it", () => {
    expect(DEFENDER_LOCK_DECK).toHaveLength(60);
    for (const id of new Set(DEFENDER_LOCK_DECK)) expect(FIXTURE_POOL[id]).toBeDefined();
  });
});
