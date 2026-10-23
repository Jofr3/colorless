import { describe, expect, it } from "vitest";
import { attackLocked } from "./continuous";
import { deriveAttackEffect } from "./effects";
import type { EffectOp } from "./effects";
import * as effectsModule from "./effects";
import { attackReaderSurface, legalAttackCorpus } from "./censusAttackCorpus";
import { applyAction, programFor } from "./index";
import type { GameEvent, GameState, InPlayPokemon, Seat } from "./index";
import { runProgram } from "./interpreter";
import {
  BARE_ATTACK_LOCK_DECK,
  FIXTURE_POOL,
  attachFromDeck,
  driveSetup,
  must,
  mustApply,
  setActiveFromDeck,
  findEvent,
} from "./testFixtures";

const DEFENDER_BARE = "During your opponent's next turn, the Defending Pokémon can't attack.";
const DEFENDER_PLURAL =
  "During your opponent's next turn, the Defending Pokémon can't use attacks.";
const SELF_PLURAL = "During your next turn, this Pokémon can't use attacks.";
const SELF_BARE = "During your next turn, this Pokémon can't attack.";
const EISCUE_COMPOUND =
  "Discard an Energy from this Pokémon. During your opponent's next turn, the Defending Pokémon can't attack.";

/** ONE seed for the whole suite; the value is arbitrary and the board it produces
    is asserted by `armed` rather than assumed. */
const SEED = 19;

/** `fix-lockplural` — "Tail Whip" ({C}, 20) and "Overdrive" ({C}{C}, 90 + the
    self-side bare plural). */
const SELF_INSTALL_INDEX = 1;
const SELF_SIBLING_INDEX = 0;
/** `fix-deflock` — "Frost Bind" ({C}, 30 + "can't attack") and "Glacier Hold"
    ({C}{C}, 30 + "can't use attacks"): ONE body, the verb the only difference. */
const DEF_BARE_INDEX = 0;
const DEF_PLURAL_INDEX = 1;
/** `fix-attacker` — the victim. "Bite" ({C}, 30) at 0 and costless "Yawn" at 2, so
    a refusal on this body is never an Energy shortfall wearing the lock's face. */
const VICTIM_PAID_INDEX = 0;
const VICTIM_FREE_INDEX = 2;

/** The engine's rejection code for an attack declaration, or `"ok"`. */
function refusal(state: GameState, seat: Seat, index: number): string {
  const result = applyAction(state, { type: "attack", seat, index });
  return result.ok ? "ok" : result.error.code;
}

/** P2 opens and passes, so P1's turn 2 carries no §4 attack restriction. The
    installer goes on P1's Active with two {C}, which pays either index on either
    fixture; the victim goes on P2's. */
function armed(installer: "fix-lockplural" | "fix-deflock", victim: string): GameState {
  let state = must(
    applyAction(
      driveSetup(SEED, { p1: BARE_ATTACK_LOCK_DECK, p2: BARE_ATTACK_LOCK_DECK }, { first: "p2" }),
      { type: "endTurn", seat: "p2" },
    ),
  );
  state = setActiveFromDeck(state, "p2", victim);
  state = setActiveFromDeck(state, "p1", installer);
  if (state.turn !== 2) throw new Error(`armed() expected turn 2, got ${state.turn}`);
  return attachFromDeck(state, "p1", "fix-energy", 2);
}

/** `armed`, then the install declared — asserted to have landed, so no later case
    can assert "nothing was refused" against a board that never locked anything.
    Returns P2's turn 3. */
function installed(
  installer: "fix-lockplural" | "fix-deflock",
  victim: string,
  index: number,
): GameState {
  const { state, events } = mustApply(armed(installer, victim), {
    type: "attack",
    seat: "p1",
    index,
  });
  if (findEvent(events, "ATTACK_LOCKED") === undefined) {
    throw new Error(`${installer} index ${index} installed no lock`);
  }
  if (state.turn !== 3) throw new Error(`expected P2's turn 3, got ${state.turn}`);
  return state;
}

function ops(text: string): EffectOp[] {
  const derived = deriveAttackEffect(text);
  if (derived === null) throw new Error(`${text} derives nothing`);
  return derived as EffectOp[];
}

describe("§1 — the supply check, and the claim it falsifies", () => {
  it("all three sentences are in the legal attack column, at 3 / 4 / 4", () => {
    const corpus = legalAttackCorpus();
    const unitsOf = (sentence: string): number =>
      corpus.filter(([, s]) => s === sentence).reduce((sum, [n]) => sum + n, 0);
    expect(unitsOf(DEFENDER_BARE)).toBe(3);
    expect(unitsOf(DEFENDER_PLURAL)).toBe(4);
    expect(unitsOf(SELF_PLURAL)).toBe(4);
    for (const sentence of [DEFENDER_BARE, DEFENDER_PLURAL, SELF_PLURAL]) {
      expect(
        corpus.filter(([, s]) => s === sentence),
        sentence,
      ).toHaveLength(1);
    }
  });

  it("the fixtures print those bytes, and no registry row exists for either", () => {
    const plural = FIXTURE_POOL["fix-lockplural"];
    expect(plural?.attacks?.[SELF_INSTALL_INDEX]?.effect).toBe(SELF_PLURAL);
    expect(plural?.attacks?.[SELF_SIBLING_INDEX]?.effect).toBeUndefined();
    const deflock = FIXTURE_POOL["fix-deflock"];
    expect(deflock?.attacks?.[DEF_BARE_INDEX]?.effect).toBe(DEFENDER_BARE);
    expect(deflock?.attacks?.[DEF_PLURAL_INDEX]?.effect).toBe(DEFENDER_PLURAL);
    expect(programFor("fix-lockplural")).toBeUndefined();
    expect(programFor("fix-deflock")).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — derived, and equal to the SHIPPED programs rather than merely similar.
// ─────────────────────────────────────────────────────────────────────────────

describe("§2 — three sentences, two programs, and both were already shipped", () => {
  it("both defender spellings derive `preventAttack { target: 'defender' }`", () => {
    expect(deriveAttackEffect(DEFENDER_BARE)).toEqual([
      { op: "preventAttack", target: "defender" },
    ]);
    expect(deriveAttackEffect(DEFENDER_PLURAL)).toEqual([
      { op: "preventAttack", target: "defender" },
    ]);
    expect(Object.keys(ops(DEFENDER_BARE)[0] as object)).toEqual(["op", "target"]);
  });

  it("both are BYTE-IDENTICAL to the shipped compound's SECOND op", () => {
    const compound = ops(EISCUE_COMPOUND);
    expect(compound).toHaveLength(2);
    expect(ops(DEFENDER_BARE)[0]).toEqual(compound[1]);
    expect(ops(DEFENDER_PLURAL)[0]).toEqual(compound[1]);
  });

  it("the SELF-side plural is byte-identical to D143's bare sentence's program", () => {
    // The same claim on the other seat: "can't attack" and "can't use attacks" are
    // two printed spellings of one rule, so the two arms must return one program.
    expect(deriveAttackEffect(SELF_PLURAL)).toEqual([{ op: "preventAttack" }]);
    expect(ops(SELF_PLURAL)).toEqual(ops(SELF_BARE));
    expect(Object.keys(ops(SELF_PLURAL)[0] as object)).toEqual(["op"]);
  });

  it("the two seats stay APART — one field, two directions, never one program", () => {
    expect(ops(SELF_PLURAL)).not.toEqual(ops(DEFENDER_PLURAL));
    expect(ops(SELF_BARE)).not.toEqual(ops(DEFENDER_BARE));
  });

  it("the typographic apostrophe derives IDENTICALLY on all three", () => {
    for (const text of [DEFENDER_BARE, DEFENDER_PLURAL, SELF_PLURAL]) {
      expect(deriveAttackEffect(text.replace(/'/g, "’")), text).toEqual(deriveAttackEffect(text));
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — THE DEFECT, and the two rungs that can go red on it.
// ─────────────────────────────────────────────────────────────────────────────

describe("§3 — the mis-read sentence, and why nothing in the repo could see it", () => {
  it("the bare plural is NOT read as a proper noun — the defect, named", () => {
    const derived = ops(SELF_PLURAL);
    expect(derived).toEqual([{ op: "preventAttack" }]);
    for (const op of derived) expect(op.op).not.toBe("preventAttackUse");
    expect(JSON.stringify(derived)).not.toContain("attacks");
  });

  it("…and the capture still reads every PROPER NOUN the column prints", () => {
    const named = legalAttackCorpus().filter(
      ([, s]) =>
        s.startsWith("During your next turn, this Pokémon can't use ") && s !== SELF_PLURAL,
    );
    expect(named).toHaveLength(12);
    expect(named.reduce((sum, [n]) => sum + n, 0)).toBe(26);
    for (const [, sentence] of named) {
      const name = sentence.slice("During your next turn, this Pokémon can't use ".length, -1);
      expect(deriveAttackEffect(sentence), sentence).toEqual([
        { op: "preventAttackUse", attack: name },
      ]);
    }
  });

  it("the DEFECTIVE program, run on a real board, installs NOTHING", () => {
    const before = armed("fix-lockplural", "fix-titan");
    const bogus = ops("During your next turn, this Pokémon can't use Attacks.");
    expect(bogus).toEqual([{ op: "preventAttackUse", attack: "Attacks" }]);
    const events: GameEvent[] = [];
    const result = runProgram(before, bogus, { seat: "p1", invokedBy: "attack" }, events);
    if (result.kind !== "done") throw new Error(`expected done, got ${result.kind}`);
    expect(events).toEqual([]);
    expect(result.state.players.p1.active?.attackLockedTurn ?? null).toBeNull();
    expect(result.state.players.p1.active?.lockedAttacks ?? []).toEqual([]);
    // …and the repaired reading of the SAME sentence shape does the opposite.
    const events2: GameEvent[] = [];
    const fixed = runProgram(
      before,
      ops(SELF_PLURAL),
      { seat: "p1", invokedBy: "attack" },
      events2,
    );
    if (fixed.kind !== "done") throw new Error(`expected done, got ${fixed.kind}`);
    expect(findEvent(events2, "ATTACK_LOCKED")).toBeDefined();
    expect(fixed.state.players.p1.active?.attackLockedTurn).toBe(before.turn + 2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — the boards. Both seats, both windows, both verbs.
// ─────────────────────────────────────────────────────────────────────────────

describe("§4 — the SELF-side plural, driven across a real turn boundary", () => {
  it("locks the POKÉMON — BOTH indexes refused on the holder's own next turn", () => {
    let state = installed("fix-lockplural", "fix-titan", SELF_INSTALL_INDEX);
    expect(state.players.p1.active?.attackLockedTurn).toBe(4);
    expect(state.players.p2.active?.attackLockedTurn ?? null).toBeNull();
    state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
    expect(state.turn).toBe(4);
    expect(refusal(state, "p1", SELF_INSTALL_INDEX)).toBe("ATTACK_PREVENTED");
    expect(refusal(state, "p1", SELF_SIBLING_INDEX)).toBe("ATTACK_PREVENTED");
    expect(attackLocked(state, state.players.p1.active as InPlayPokemon)).toBe(true);
  });

  it("the window EXPIRES, and the stale stamp answers nothing", () => {
    let state = installed("fix-lockplural", "fix-titan", SELF_INSTALL_INDEX);
    state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
    state = must(applyAction(state, { type: "endTurn", seat: "p1" }));
    state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
    expect(state.turn).toBe(6);
    expect(state.players.p1.active?.attackLockedTurn).toBe(4);
    expect(attackLocked(state, state.players.p1.active as InPlayPokemon)).toBe(false);
    const { events } = mustApply(state, { type: "attack", seat: "p1", index: SELF_SIBLING_INDEX });
    expect(findEvent(events, "DAMAGE_DEALT")?.dealt).toBe(20);
  });

  it("the turn IN BETWEEN is untouched — a `+ 1` stamp would bar the wrong seat", () => {
    const state = installed("fix-lockplural", "fix-titan", SELF_INSTALL_INDEX);
    expect(state.turn).toBe(3);
    expect(attackLocked(state, state.players.p1.active as InPlayPokemon)).toBe(false);
  });
});

describe("§4b — the OPPONENT-side lock, in BOTH printed verbs", () => {
  it("both verbs write the SAME window on the SAME body — the index is the only diff", () => {
    // ONE anchor, one alternation, two printed spellings: the claim is that the
    // verb changes nothing, and the only honest way to say that on a board is to
    // drive both indexes of ONE fixture and compare the stamps.
    for (const index of [DEF_BARE_INDEX, DEF_PLURAL_INDEX]) {
      const state = installed("fix-deflock", "fix-attacker", index);
      expect(state.players.p2.active?.attackLockedTurn, `index ${index}`).toBe(3);
      expect(state.players.p1.active?.attackLockedTurn ?? null, `index ${index}`).toBeNull();
      expect(attackLocked(state, state.players.p2.active as InPlayPokemon)).toBe(true);
    }
  });

  it("refuses BOTH of the victim's attacks — the lock is on the POKÉMON", () => {
    // Read from the victim's seat, with a COSTLESS attack among the two so that a
    // refusal can never be an unpayable cost wearing the lock's error code.
    for (const index of [DEF_BARE_INDEX, DEF_PLURAL_INDEX]) {
      let state = installed("fix-deflock", "fix-attacker", index);
      state = attachFromDeck(state, "p2", "fix-energy", 1);
      expect(refusal(state, "p2", VICTIM_PAID_INDEX), `index ${index}`).toBe("ATTACK_PREVENTED");
      expect(refusal(state, "p2", VICTIM_FREE_INDEX), `index ${index}`).toBe("ATTACK_PREVENTED");
    }
  });

  it("the window is `+ 1` and it drives turn by turn from BOTH seats", () => {
    let state = installed("fix-deflock", "fix-attacker", DEF_BARE_INDEX);
    expect(state.turn).toBe(3);
    expect(refusal(state, "p2", VICTIM_FREE_INDEX)).toBe("ATTACK_PREVENTED");
    state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
    expect(state.turn).toBe(4);
    expect(refusal(state, "p1", DEF_BARE_INDEX)).toBe("ok");
    state = must(applyAction(state, { type: "endTurn", seat: "p1" }));
    expect(state.turn).toBe(5);
    expect(attackLocked(state, state.players.p2.active as InPlayPokemon)).toBe(false);
    const { events } = mustApply(state, { type: "attack", seat: "p2", index: VICTIM_FREE_INDEX });
    expect(findEvent(events, "ATTACK_DECLARED")).toBeDefined();
  });

  it("the printed damage still lands — the rider is a rider", () => {
    const { events } = mustApply(armed("fix-deflock", "fix-attacker"), {
      type: "attack",
      seat: "p1",
      index: DEF_BARE_INDEX,
    });
    expect(findEvent(events, "DAMAGE_DEALT")?.dealt).toBe(30);
    expect(findEvent(events, "ATTACK_LOCKED")?.seat).toBe("p2");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — the anchors, and the neighbourhood each one refuses.
// ─────────────────────────────────────────────────────────────────────────────

describe("§5 — anchored end to end, and every refusal is a warrant", () => {
  it("refuses a prefix, a suffix and a lead-in on all three sentences", () => {
    for (const text of [DEFENDER_BARE, DEFENDER_PLURAL, SELF_PLURAL]) {
      expect(deriveAttackEffect(`Then, ${text}`), text).toBeNull();
      expect(deriveAttackEffect(`${text} Draw a card.`), text).toBeNull();
      expect(deriveAttackEffect(text.slice(0, -1)), text).toBeNull();
    }
  });

  it("D495 BUILT the COIN-GATED defender lock — re-pointed onto the OP, refusals kept", () => {
    const PRINTED =
      "Flip a coin. If heads, during your opponent's next turn, the Defending Pokémon can't attack.";
    expect(legalAttackCorpus().filter(([, s]) => s === PRINTED)).toEqual([[1, PRINTED]]);
    expect(deriveAttackEffect(PRINTED)).toEqual([
      {
        op: "coinFlipGate",
        then: [{ op: "preventAttack", target: "defender" }],
      },
    ]);
    const gate = (deriveAttackEffect(PRINTED) as EffectOp[])[0] as { then: EffectOp[] };
    expect(gate.then).toEqual(deriveAttackEffect(DEFENDER_BARE));
    expect(
      deriveAttackEffect(
        "Flip a coin. If tails, during your opponent's next turn, the Defending Pokémon can't attack.",
      ),
    ).toBeNull();
    for (const name of attackReaderSurface()) {
      if (name === "deriveAttackEffect") continue;
      const read = (effectsModule as unknown as Record<string, (t: string) => unknown>)[name];
      expect(read?.(PRINTED) ?? null, name).toBeNull();
    }
    expect(attackReaderSurface()).toHaveLength(14);
  });

  it('D549 — both SIDE-WIDE spellings map to their OWN op, `lockSideAttacks`, and never to `preventAttack` (was: "refuses both SIDE-WIDE spellings — they name a zone this op has no member for")', () => {
    const side = deriveAttackEffect(
      "During your next turn, your Pokémon can't attack. (This includes new Pokémon that come into play.)",
    );
    expect(side).toEqual([{ op: "lockSideAttacks", whose: "self", maxEnergy: null }]);
    const capped = deriveAttackEffect(
      "During your opponent's next turn, Pokémon that have 2 or less Energy attached can't attack. (This includes new Pokémon that come into play.)",
    );
    expect(capped).toEqual([{ op: "lockSideAttacks", whose: "opponent", maxEnergy: 2 }]);
    // …and neither program is the ONE-body lock this file repairs.
    expect([...(side ?? []), ...(capped ?? [])].some((op) => op.op === "preventAttack")).toBe(
      false,
    );
  });

  it("leaves every neighbour in the family reading exactly what it read before", () => {
    expect(deriveAttackEffect(SELF_BARE)).toEqual([{ op: "preventAttack" }]);
    expect(
      deriveAttackEffect(
        "If the Defending Pokémon is a Basic Pokémon, it can't attack during your opponent's next turn.",
      ),
    ).toEqual([
      {
        op: "conditionGate",
        cond: { kind: "opponentActiveIsBasic" },
        then: [{ op: "preventAttack", target: "defender" }],
      },
    ]);
    expect(
      deriveAttackEffect(
        "Flip a coin. If tails, during your next turn, this Pokémon can't attack.",
      ),
    ).toEqual([{ op: "coinFlipGate", onTails: true, then: [{ op: "preventAttack" }] }]);
    expect(
      deriveAttackEffect(
        "Choose 1 of your opponent's Active Pokémon's attacks. During your opponent's next turn, that Pokémon can't use that attack.",
      ),
    ).toEqual([{ op: "preventChosenAttack" }]);
    // …and the compound whose first sentence alone is a LIVE reading, which is why
    // the bare arm below it had to be whole-sentence anchored rather than a prefix.
    expect(deriveAttackEffect("Discard an Energy from this Pokémon.")).toEqual([
      { op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" } },
    ]);
  });

  it("consumes no rng across a whole install — the seed-free claim, made directly", () => {
    const before = armed("fix-deflock", "fix-attacker");
    const { state } = mustApply(before, { type: "attack", seat: "p1", index: DEF_PLURAL_INDEX });
    expect(state.rngState).toBe(before.rngState);
    expect(state.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — the persisted question, the version, and the fixtures.
// ─────────────────────────────────────────────────────────────────────────────

describe("§6 — the persisted question, asked and DRIVEN", () => {
  it("MATCH_RECORD_VERSION stays 25 — nothing new can reach a saved record", () => {
    expect(ops(DEFENDER_BARE)).toEqual(ops(DEFENDER_PLURAL));
    const before = armed("fix-deflock", "fix-attacker");
    const { state } = mustApply(before, { type: "attack", seat: "p1", index: DEF_BARE_INDEX });
    expect(state.phase.kind).toBe("turn:action");
    // …no continuation at all, so there is no `pendingOp` to persist.
    expect("cont" in state.phase).toBe(false);
    expect(state.players.p2.active?.lockedAttacks ?? []).toEqual([]);
  });
});

describe("§7 — the fixtures ARE the deck, and the deck is 60", () => {
  it("both new fixtures are Basics with the attacks this suite indexes", () => {
    for (const id of ["fix-lockplural", "fix-deflock"]) {
      const card = FIXTURE_POOL[id];
      expect(card, id).toBeDefined();
      expect(card?.stage, id).toBe("Basic");
      expect(card?.attacks, id).toHaveLength(2);
      expect(card?.hp, id).toBe(130);
    }
    // The victim survives two installs at 30 apiece, which is what lets one body
    // carry the whole §4b sweep.
    expect(FIXTURE_POOL["fix-attacker"]?.hp).toBe(120);
  });

  it("the deck is 60 cards and the pool holds every id in it", () => {
    expect(BARE_ATTACK_LOCK_DECK).toHaveLength(60);
    for (const id of new Set(BARE_ATTACK_LOCK_DECK)) expect(FIXTURE_POOL[id]).toBeDefined();
  });
});
