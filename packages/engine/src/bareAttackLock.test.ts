import { describe, expect, it } from "vitest";
import { attackLocked } from "./continuous";
import { deriveAttackEffect } from "./effects";
import type { EffectOp } from "./effects";
import { legalAttackCorpus } from "./censusAttackCorpus";
import { applyAction, engineVersion, programFor } from "./index";
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
} from "./testFixtures";

// 0.312.0 → 0.313.0 — 🆕🆕 D408: THE BARE ATTACK LOCK ON BOTH SEATS, AND A REPAIR
// NO CENSUS RUNG IN THIS REPO COULD SEE.
//
// Three printed sentences, 11 legal printings, and they are NOT three of a kind:
//
//   "During your opponent's next turn, the Defending Pokémon can't attack."    (3)
//   "During your opponent's next turn, the Defending Pokémon can't use attacks." (4)
//        — UNREAD before this slice. D148 read this rule only as the second clause
//          of two compounds and wrote in `effects.ts` that the bare form "is printed
//          NOWHERE in the pool as a standalone attack sentence". That was measured
//          against the SIX-SET local D1 (978 cards / 6 sets) and it was true of that
//          population; the `legal_standard = 1` attack column prints both spellings
//          standalone. §1 holds the correction as a GUARD.
//
//   "During your next turn, this Pokémon can't use attacks."                   (4)
//        — 🛑 READ WRONGLY since D154, which is a different and worse thing.
//          `SELF_CANT_USE_ATTACK` is written for "…can't use {AttackName}" and its
//          lazy `(.+?)` swallowed the bare plural, so the sentence derived
//          `preventAttackUse { attack: "attacks" }` — a lock keyed on an attack no
//          card is named. `resolveAttackIndex` answers -1, the op writes NOTHING,
//          and four legal printings were counted BUILT and did nothing at all.
//
// 🛑 WHY THIS FILE EXISTS AT ALL, AND WHY THE REPAIR NEEDED A BOARD. A sentence that
// RESOLVES to a program that does nothing is invisible to every coverage instrument
// in this repo: `BUILT.attack`, both reader instruments, the unbuilt-column count
// and the whole-census residue all count what resolves, never what resolves
// CORRECTLY. All of them stand still across the self-side repair, in both
// directions. So the ONLY rungs that can go red on it are a program comparison and
// a BOARD, and §3 and §4 are those rungs — measured red on the defective build
// before the arm was written, which is the order `conventions.md` asks for.
//
// ⚠️ AND THE REPAIR IS A REFUSAL IN THE PATTERN RATHER THAN AN ARM ORDERING.
// `SELF_CANT_USE_ATTACK`'s capture is now `([A-Z].+?)` — an attack name is a PROPER
// NOUN, which is the same capitalisation device that keeps the thirteen lowercase
// "you can't use…" Ability limiters off that path — and the bare plural's own arm
// sits BELOW the capture arm so that the refusal is what routes the sentence there.
// Ordering the new arm ABOVE would have repaired the board and left the pattern
// wrong in isolation, with a refusal nothing could falsify.
//
// SEED-FREE, like both suites it sits between: none of the three sentences flips
// anything, so a seed table would describe a shuffle rather than a rule. §5 pins
// that with an unchanged `rngState` across a whole install.

/** The three printed sentences, byte for byte off `legalAttackCorpus()`. */
const DEFENDER_BARE = "During your opponent's next turn, the Defending Pokémon can't attack.";
const DEFENDER_PLURAL =
  "During your opponent's next turn, the Defending Pokémon can't use attacks.";
const SELF_PLURAL = "During your next turn, this Pokémon can't use attacks.";
/** D143's self-side sentence and D148's compound — the two SHIPPED controls this
    slice's programs must equal, rather than merely resemble. */
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

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

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
  if (find(events, "ATTACK_LOCKED") === undefined) {
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

// ─────────────────────────────────────────────────────────────────────────────
// §1 — the printed datum, and the correction D148's census owed.
// ─────────────────────────────────────────────────────────────────────────────

describe("§1 — the supply check, and the claim it falsifies", () => {
  it("all three sentences are in the legal attack column, at 3 / 4 / 4", () => {
    // 🛑 THE EXECUTABLE CORRECTION. `effects.ts` said of the first of these that it
    // "is printed NOWHERE in the pool as a standalone attack sentence", and
    // `defenderLock.test.ts` asserted the consequence as a `toBeNull`. Both were
    // readings of the SIX-SET local D1 and both were right about it. This rung
    // reads the committed `legal_standard = 1` column instead, so the correction is
    // a guard rather than a comment: if a re-ingest ever takes these rows away, the
    // arm they justify goes with them and this line says so first.
    const corpus = legalAttackCorpus();
    const unitsOf = (sentence: string): number =>
      corpus.filter(([, s]) => s === sentence).reduce((sum, [n]) => sum + n, 0);
    expect(unitsOf(DEFENDER_BARE)).toBe(3);
    expect(unitsOf(DEFENDER_PLURAL)).toBe(4);
    expect(unitsOf(SELF_PLURAL)).toBe(4);
    // Each is ONE record, so "printings" and "sentences" are not the same step and
    // the census annotations that say +2 / +7 are reading two different columns.
    for (const sentence of [DEFENDER_BARE, DEFENDER_PLURAL, SELF_PLURAL]) {
      expect(corpus.filter(([, s]) => s === sentence), sentence).toHaveLength(1);
    }
  });

  it("the fixtures print those bytes, and no registry row exists for either", () => {
    // D183's rule: author and assert against the PRINTED BYTES. The ids that print
    // these sentences are unknown to this container (no D1 credentials, D369), so
    // the fixtures carry `fix-*` keys and every scalar but the effect text is
    // CHOSEN — which is exactly why the text itself must be checked against the
    // corpus and not against this file's own constants.
    const plural = FIXTURE_POOL["fix-lockplural"];
    expect(plural?.attacks?.[SELF_INSTALL_INDEX]?.effect).toBe(SELF_PLURAL);
    expect(plural?.attacks?.[SELF_SIBLING_INDEX]?.effect).toBeUndefined();
    const deflock = FIXTURE_POOL["fix-deflock"];
    expect(deflock?.attacks?.[DEF_BARE_INDEX]?.effect).toBe(DEFENDER_BARE);
    expect(deflock?.attacks?.[DEF_PLURAL_INDEX]?.effect).toBe(DEFENDER_PLURAL);
    // The printed text IS the program — no authored row behind either body.
    expect(programFor("fix-lockplural")).toBeUndefined();
    expect(programFor("fix-deflock")).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — derived, and equal to the SHIPPED programs rather than merely similar.
// ─────────────────────────────────────────────────────────────────────────────

describe("§2 — three sentences, two programs, and both were already shipped", () => {
  it("both defender spellings derive `preventAttack { target: 'defender' }`", () => {
    expect(deriveAttackEffect(DEFENDER_BARE)).toEqual([{ op: "preventAttack", target: "defender" }]);
    expect(deriveAttackEffect(DEFENDER_PLURAL)).toEqual([
      { op: "preventAttack", target: "defender" },
    ]);
    // No stray key: `toEqual` on a two-key object would not catch a third that the
    // shape happens to allow, so the key SET is asserted (D143's idiom).
    expect(Object.keys(ops(DEFENDER_BARE)[0] as object)).toEqual(["op", "target"]);
  });

  it("both are BYTE-IDENTICAL to the shipped compound's SECOND op", () => {
    // The family's checkable claim, and the reason ONE alternation is honest here:
    // there is one action, printed two ways, and the compound has been running it
    // since D148. If the bare arm and the compound ever diverge, one of the two has
    // grown a meaning the other has not — which no board can see, because both
    // write the same field on the same body.
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
    // The sharpest cross-family warrant this file has. All four sentences read here
    // write `InPlayPokemon.attackLockedTurn`; the only thing that decides WHOSE body
    // and WHICH turn is `target`. A reader that drifted between the seats would put
    // the right durated fact on the wrong side of the table, and every assertion
    // about the record's shape would still pass.
    expect(ops(SELF_PLURAL)).not.toEqual(ops(DEFENDER_PLURAL));
    expect(ops(SELF_BARE)).not.toEqual(ops(DEFENDER_BARE));
  });

  it("the typographic apostrophe derives IDENTICALLY on all three", () => {
    // D136/D137: a re-ingest that changes only punctuation must not silently
    // un-simulate 11 printings. The defender pair exposes a POSSESSIVE and a
    // CONTRACTION on one string, which is the asymmetry D137 found two tables
    // missing; the self plural exposes the contraction alone.
    for (const text of [DEFENDER_BARE, DEFENDER_PLURAL, SELF_PLURAL]) {
      expect(deriveAttackEffect(text.replace(/'/g, "’")), text).toEqual(
        deriveAttackEffect(text),
      );
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — THE DEFECT, and the two rungs that can go red on it.
// ─────────────────────────────────────────────────────────────────────────────

describe("§3 — the mis-read sentence, and why nothing in the repo could see it", () => {
  it("🛑 the bare plural is NOT read as a proper noun — the defect, named", () => {
    // THE ASSERTION THIS SLICE EXISTS FOR. On the build before D408 this derived
    // `[{ op: "preventAttackUse", attack: "attacks" }]` — it RESOLVED, so it was
    // counted BUILT by every census rung in this repo, and it installed nothing.
    // Asserting the positive program is not enough on its own: the failure mode has
    // a NAME, so the name is refused too.
    const derived = ops(SELF_PLURAL);
    expect(derived).toEqual([{ op: "preventAttack" }]);
    for (const op of derived) expect(op.op).not.toBe("preventAttackUse");
    expect(JSON.stringify(derived)).not.toContain("attacks");
  });

  it("…and the capture still reads every PROPER NOUN the column prints", () => {
    // The narrowing is `([A-Z].+?)`, so the repair must not cost D154 a printing.
    // Swept over the whole legal column rather than over this file's own list:
    // every "During your next turn, this Pokémon can't use X." sentence except the
    // bare plural still derives a `preventAttackUse` naming X verbatim.
    const named = legalAttackCorpus().filter(
      ([, s]) => s.startsWith("During your next turn, this Pokémon can't use ") && s !== SELF_PLURAL,
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

  it("🛑 the DEFECTIVE program, run on a real board, installs NOTHING", () => {
    // THE OTHER HALF OF "no instrument could see it", DRIVEN rather than argued.
    // The op is CONSTRUCTED here — after D408 no sentence derives it — and it is
    // constructed through the deriver so the shape is the real one and only the
    // noun is invented. `resolveAttackIndex` answers -1 for a name the holder does
    // not print, so the op returns early: no event, no stamp, no refusal. That is
    // why four legal printings could be "built" for fifty-four decisions and do
    // nothing, and why a census can never be the guard for this class of defect.
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
    const fixed = runProgram(before, ops(SELF_PLURAL), { seat: "p1", invokedBy: "attack" }, events2);
    if (fixed.kind !== "done") throw new Error(`expected done, got ${fixed.kind}`);
    expect(find(events2, "ATTACK_LOCKED")).toBeDefined();
    expect(fixed.state.players.p1.active?.attackLockedTurn).toBe(before.turn + 2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — the boards. Both seats, both windows, both verbs.
// ─────────────────────────────────────────────────────────────────────────────

describe("§4 — the SELF-side plural, driven across a real turn boundary", () => {
  it("🛑 locks the POKÉMON — BOTH indexes refused on the holder's own next turn", () => {
    // THE BOARD THE REPAIR OWES. On the defective build this body attacks freely on
    // turn 4: the lock named an attack no card is named, so nothing installed and
    // BOTH of these read "ok". The window is `state.turn + 2` — declaring an attack
    // ends the turn, so the holder's own next turn is one full round later.
    let state = installed("fix-lockplural", "fix-titan", SELF_INSTALL_INDEX);
    expect(state.players.p1.active?.attackLockedTurn).toBe(4);
    expect(state.players.p2.active?.attackLockedTurn ?? null).toBeNull();
    state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
    expect(state.turn).toBe(4);
    expect(refusal(state, "p1", SELF_INSTALL_INDEX)).toBe("ATTACK_PREVENTED");
    // …and the SIBLING, which is the assertion that separates this sentence from
    // the twelve "can't use {AttackName}" printings one arm above it: those bar ONE
    // index and leave the other live. "Tail Whip" costs {C} and two are attached,
    // so this refusal cannot be an Energy shortfall.
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
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(20);
  });

  it("the turn IN BETWEEN is untouched — a `+ 1` stamp would bar the wrong seat", () => {
    // The failure D143 named on this window: a defender-side number on a self-side
    // sentence bars the victim of nothing and leaves the drawback unpaid.
    const state = installed("fix-lockplural", "fix-titan", SELF_INSTALL_INDEX);
    expect(state.turn).toBe(3);
    expect(attackLocked(state, state.players.p1.active as InPlayPokemon)).toBe(false);
  });
});

describe("§4b — the OPPONENT-side lock, in BOTH printed verbs", () => {
  it("🛑 both verbs write the SAME window on the SAME body — the index is the only diff", () => {
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
    // The INSTALLER's own turn 4 — the turn D143's `+ 2` would have hit instead.
    state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
    expect(state.turn).toBe(4);
    expect(refusal(state, "p1", DEF_BARE_INDEX)).toBe("ok");
    state = must(applyAction(state, { type: "endTurn", seat: "p1" }));
    expect(state.turn).toBe(5);
    expect(attackLocked(state, state.players.p2.active as InPlayPokemon)).toBe(false);
    const { events } = mustApply(state, { type: "attack", seat: "p2", index: VICTIM_FREE_INDEX });
    expect(find(events, "ATTACK_DECLARED")).toBeDefined();
  });

  it("the printed damage still lands — the rider is a rider", () => {
    const { events } = mustApply(armed("fix-deflock", "fix-attacker"), {
      type: "attack",
      seat: "p1",
      index: DEF_BARE_INDEX,
    });
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(30);
    expect(find(events, "ATTACK_LOCKED")?.seat).toBe("p2");
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

  it("refuses the COIN-GATED defender lock, which this slice measured and left out", () => {
    // "Flip a coin. If heads, during your opponent's next turn, the Defending
    // Pokémon can't attack." — 1 legal printing, and the arm would be one regex and
    // one `coinFlipGate` whose `then` is this slice's own program. It is OUT on the
    // WITNESS rather than on the arm: this suite and both suites it sits between
    // are deliberately SEED-FREE, and a coin-gated printing turns that determinism
    // claim into a coincidence of one shuffle. One printing against a seed sweep
    // and a fourth fixture is worse than the residue head it would be taken from.
    expect(
      deriveAttackEffect(
        "Flip a coin. If heads, during your opponent's next turn, the Defending Pokémon can't attack.",
      ),
    ).toBeNull();
  });

  it("refuses both SIDE-WIDE spellings — they name a zone this op has no member for", () => {
    // 1 + 1 legal printings, and OUT for a reason that is not a price: `preventAttack`
    // locks ONE body (`state.players[seat].active`), and both of these lock a SIDE,
    // including bodies that arrive later. That is a different mechanism, not a
    // wider `target`, and mapping it here would be the wrong-but-plausible program
    // this whole file is a repair of.
    expect(
      deriveAttackEffect(
        "During your next turn, your Pokémon can't attack. (This includes new Pokémon that come into play.)",
      ),
    ).toBeNull();
    expect(
      deriveAttackEffect(
        "During your opponent's next turn, Pokémon that have 2 or less Energy attached can't attack. (This includes new Pokémon that come into play.)",
      ),
    ).toBeNull();
  });

  it("leaves every neighbour in the family reading exactly what it read before", () => {
    // The whole `can't attack` / `can't use attacks` neighbourhood, asserted as
    // PROGRAMS rather than as nulls (D299/D382): each of these has its own arm, and
    // a drift between any two of them is invisible on a board because they all
    // write one field.
    expect(deriveAttackEffect(SELF_BARE)).toEqual([{ op: "preventAttack" }]);
    expect(
      deriveAttackEffect("If the Defending Pokémon is a Basic Pokémon, it can't attack during your opponent's next turn."),
    ).toEqual([
      {
        op: "conditionGate",
        cond: { kind: "opponentActiveIsBasic" },
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable.
        then: [{ op: "preventAttack", target: "defender" }],
      },
    ]);
    expect(
      deriveAttackEffect("Flip a coin. If tails, during your next turn, this Pokémon can't attack."),
    ).toEqual([
      // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable.
      { op: "coinFlipGate", onTails: true, then: [{ op: "preventAttack" }] },
    ]);
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
  it("🛑 MATCH_RECORD_VERSION stays 25 — nothing new can reach a saved record", () => {
    // ⚠️ `MATCH_RECORD_VERSION` IS NOT AN EXPORTED CONSTANT (D406), so the claim is
    // DRIVEN rather than asserted. Two things could put something new into a saved
    // record: a PARKED op (it rides `GameState.phase.cont.pendingOp`) and a new
    // stamped field. This slice adds neither — `preventAttack` has never parked,
    // and it writes `InPlayPokemon.attackLockedTurn`, which D148 already reused
    // unchanged from D143. Every op this slice produces is an inhabitant a v25
    // record could already carry, and means there exactly what it means here.
    expect(ops(DEFENDER_BARE)).toEqual(ops(DEFENDER_PLURAL));
    const before = armed("fix-deflock", "fix-attacker");
    const { state } = mustApply(before, { type: "attack", seat: "p1", index: DEF_BARE_INDEX });
    expect(state.phase.kind).toBe("turn:action");
    // …no continuation at all, so there is no `pendingOp` to persist.
    expect("cont" in state.phase).toBe(false);
    expect(state.players.p2.active?.lockedAttacks ?? []).toEqual([]);
  });

  it("the engine version moved with the behaviour", () => {
    // 🆕🆕 D416 — 0.319.0 → **0.320.0**, moved with the behaviour: THE PARKING KO PAIR (*"Flip a coin. If heads, Knock Out your opponent's Active Basic Pokémon. If tails, Knock Out 1 of your opponent's Benched Basic Pokémon."*, 4 printings, and *"Knock Out 1 of your opponent's Pokémon that has exactly 6 damage counters on it."*, 2 printings — **2 sentences / 6 printings**, both claimed WHOLE by `deriveAttackEffect`) is a WIDENING — ONE new PARKING `EffectOp` (`knockOutChosen`, required `target` plus two optional riders) reached through the EXISTING `choosePokemon` prompt and the EXISTING `KNOCKED_OUT` sweep, ZERO new persisted record fields — so the engine version moves and `MATCH_RECORD_VERSION` STAYS 26 (D307's paragraph: no v26 deploy can author `{ op: "knockOutChosen", … }` into a record THIS deploy reads).
    // 🆕🆕 D417 — 0.320.0 → **0.321.0**, moved with the behaviour: THE TRAILING CANCEL (*"Discard a Stadium in play. If you can't, this attack does nothing."*, Eternatus `sv08-141`, **1 legal printing**) gains a TWELFTH whole-sentence reader, `deriveAttackCancelRequirement` — the anaphoric cancel `deriveAttackRequirement`'s leading `^If` could never see. `MATCH_RECORD_VERSION` **STAYS 26**, asked rather than assumed: the reader returns an EXISTING `BoardCondition` through the EXISTING requirement channel and adds NO persisted field, so no v26 record gains a shape this deploy would not already read.
    expect(engineVersion).toBe("0.379.0");
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
