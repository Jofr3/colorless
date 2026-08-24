import type { Card, SeatLogEntry } from "@luminous/schema";
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
} from "./testFixtures";

// 0.96.0 → 0.97.0 — the OPPONENT-SIDE ATTACK LOCK (P3-M5 long tail, D148):
//
//   "Discard an Energy from this Pokémon. During your opponent's next turn,
//    the Defending Pokémon can't attack."                              (3 printings)
//   "If the Defending Pokémon is a Basic Pokémon, it can't attack during
//    your opponent's next turn."                                       (1 printing)
//
// Item 1 of D147's remainder list, and the slice that answers a question D143
// wrote down and refused to guess: whether `preventAttack` should carry a
// `target`. Four things it turns on, and three of them overturn what an earlier
// slice expected:
//
//   • `target` IS ONE AXIS, NOT TWO. D143 declined the field because "a `target`
//     would have to carry a DIFFERENT STAMP as well as a different holder (the
//     defender-side window is state.turn + 1, this one is + 2)". Both numbers are
//     real and they are NOT independent: the window is always the LOCKED
//     Pokémon's controller's next turn, and declaring an attack ends the turn
//     (§5.3), so `+ 1` and `+ 2` are one rule read on two seats. The stamp is
//     DERIVED from the field, which is exactly the widen-don't-add test D131 asks
//     for and D143 said to run with two readings in hand;
//   • THE STATE COSTS NOTHING. Both printings reuse `InPlayPokemon.attackLockedTurn`
//     unchanged — "on which turn may this body not attack" is one question about
//     one body — so this is the first durated slice in four that adds no stamped
//     field, does not bump MATCH_RECORD_VERSION, and needs NO diff at the §8 gate,
//     at `attackLocked`, at either payability projection or at any of the three
//     §10 clear sites. All of those are DRIVEN anyway, from the seat that has
//     never driven them before;
//   • THE CLASS PREDICATE COSTS NO FIELD EITHER, and the reason is the mirror of
//     D146's. That slice had to defer `isBasicPokemon` to the four damage READ
//     SITES because the class was a fact about an ATTACKER who had not declared
//     yet; here it is a fact about the DEFENDER, who is on the board in front of
//     the attack resolving — so it is a `BoardCondition` evaluated at install
//     time, through the `conditionGate` op that has existed since M4;
//   • THE §10 CLEARS ARE D143's REACHABILITY WITH THE AGENCY INVERTED. Every route
//     off the Active Spot is still a line of play on the locked player's own turn
//     — but that player is now the VICTIM, so retreat, Switch and evolve are
//     COUNTERPLAY against an imposed effect rather than an escape from a drawback
//     the holder chose. Same three sites, opposite agency, and evolving is the
//     cheapest of the three.

const EISCUE_TEXT =
  "Discard an Energy from this Pokémon. During your opponent's next turn, the Defending Pokémon can't attack.";
const HOUNDOOM_TEXT =
  "If the Defending Pokémon is a Basic Pokémon, it can't attack during your opponent's next turn.";
/** D143's SELF-side sentence — the cross-family control. The two readings must
    derive DIFFERENT programs off the same four-word rider. */
const SELF_TEXT = "During your next turn, this Pokémon can't attack.";
/** Eiscue ex's first sentence ALONE. It derives — it is `SELF_DISCARD_ONE`, live
    since 0.x — which is precisely why the compound needs a whole-sentence anchor:
    a PREFIX match here would pay the Energy and install nothing. */
const DISCARD_HALF_ONLY = "Discard an Energy from this Pokémon.";

/** ONE seed for the whole suite. Neither printed sentence flips a coin — the
    only decision either makes is WHICH Energy the discard takes, which is a park
    and not a draw — so there is nothing to sweep for and no seed table to pin.
    The determinism claim is made directly instead, by an unchanged `rngState`
    across a whole park-and-resolve (below). */
const SEED = 11;

/** Eiscue ex sv03-042 "Scalding Block" and Houndoom ex sv03-134 "Evil Claw" are
    both at attack INDEX 0 — checked against the local D1 rather than assumed
    (D139's Pour Tea, D143's Nine-Tailed Dance, D144's split family). Houndoom's
    index 1 is "Hound's Fang" (220 + a bare recoil), which the remainder list DID
    name and which is the control that no program leaks across indices. */
const INSTALL_INDEX = 0;

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

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

/** Flatten one rendered row to its plain text (log.test.ts's helper). */
function textOf(entry: SeatLogEntry | undefined): string {
  if (entry === undefined) return "";
  if (entry.kind === "turn") return `— turn ${entry.turn} —`;
  return entry.segments.map((segment) => segment.text).join("");
}

/** The RENDERED `ATTACK_LOCKED` row — the log a player actually reads, not the
    event. `logFromEvents` is the same reducer `/play` and the online HUD run, so
    a row asserted here is the row a reader gets. */
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

/** P2 opens and passes, so P1's turn 2 carries no §4 attack restriction.
    `installer` goes on P1's Active with exactly the Energy its INDEX-0 attack
    costs, `victim` on P2's. The victim is chosen per case for its HP and its
    STAGE, which is the axis this slice's boards actually turn on:

      • sv01-048 Alomomola — BASIC (Evil Claw's predicate HOLDS), 110 HP, TWO
        attacks. Survives Evil Claw's 90 and DIES to Scalding Block's 160;
      • sv03-134 Houndoom ex — 270 HP and two attacks, so it is the body that
        survives Scalding Block with room to be asserted about afterwards (and a
        Stage 1, which Evil Claw's predicate would decline);
      • fix-titan — 340 HP, NO attacks; the inert body for cases about the field
        rather than about the refusal.

    `spare` puts a 4th Energy of a different kind on the installer, which is what
    turns Eiscue's discard into a real PARK. */
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

/** `armed`, then the install DECLARED and (when the discard parks) its pick
    resolved. Asserts the lock actually landed rather than trusting the sentence,
    so no window case can assert "nothing was refused" against a board that never
    locked anything. Returns P2's turn 3 — the window. */
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
  if (find(rows, "ATTACK_LOCKED") === undefined) {
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
    // Read off the FIXTURE rather than off a literal, so the fixture's effect
    // string and the anchor are pinned to agree — the failure mode D146 and D147
    // both hit is a card field nobody re-queries.
    const printed = FIXTURE_POOL["sv03-042"]?.attacks?.[INSTALL_INDEX]?.effect;
    expect(printed).toBe(EISCUE_TEXT);
    expect(deriveAttackEffect(EISCUE_TEXT)).toEqual([
      { op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" } },
      { op: "preventAttack", target: "defender" },
    ]);
    // THREE apostrophe slots — the possessive "opponent's" and the contraction
    // "can't" — and the D137 hazard (classing one and not the other) would leave
    // this deriving under a U+2019 re-ingest while a sibling stopped. Equality
    // with the straight form, never merely non-null (D136's shape).
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
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: [{ op: "preventAttack", target: "defender" }],
      },
    ]);
    expect(deriveAttackEffect(HOUNDOOM_TEXT.replace(/'/g, "’"))).toEqual(
      deriveAttackEffect(HOUNDOOM_TEXT),
    );
  });

  it("the gated `then` is byte-identical to the compound's SECOND op", () => {
    // The family's checkable claim (D134's on the heads face, D144/D145's on
    // tails, and the reason these two sentences are ONE slice): there is one
    // ACTION here, printed two ways, and the gate is a condition in front of it.
    // If the two ever diverge, one anchor has grown a meaning the other has not.
    const gated = deriveAttackEffect(HOUNDOOM_TEXT) as EffectOp[];
    const gate = gated[0];
    if (gate?.op !== "conditionGate") throw new Error("expected a conditionGate");
    const compound = deriveAttackEffect(EISCUE_TEXT) as EffectOp[];
    expect(gate.then).toEqual([compound[1]]);
    // …and there is no `otherwise`: the printed sentence says what happens when
    // the condition HOLDS and nothing at all about when it does not (D138's
    // no-fields-at-all call, on a gate instead of an op).
    expect(Object.keys(gate)).toEqual(["op", "cond", "then"]);
  });

  it("the DEFENDER arm and the SELF arm are two different programs", () => {
    // The direction is the whole content of the field, and an absent key is not
    // the same value as `"defender"` — asserted rather than reasoned about,
    // because a deriver that leaked the key onto D143's 22 printings would lock
    // the WRONG SEAT and no board would look wrong: the attacker would simply be
    // unable to attack next turn.
    expect(deriveAttackEffect(SELF_TEXT)).toEqual([{ op: "preventAttack" }]);
    const selfOp = (deriveAttackEffect(SELF_TEXT) as EffectOp[])[0] as object;
    expect(Object.keys(selfOp)).toEqual(["op"]);
    const defenderOp = (deriveAttackEffect(EISCUE_TEXT) as EffectOp[])[1] as object;
    expect(Object.keys(defenderOp)).toEqual(["op", "target"]);
    expect(defenderOp).not.toEqual(selfOp);
  });

  it("refuses the compound's FIRST SENTENCE as a prefix — and that half DERIVES", () => {
    // The sharpest version of the family's safety property, because unlike
    // D143's compound the prefix here is a LIVE reading: "Discard an Energy from
    // this Pokémon." has been `SELF_DISCARD_ONE` since 0.x. A prefix match would
    // therefore return a program that runs — pay the Energy, install nothing —
    // rather than null, which is a card the catalog does not print.
    expect(deriveAttackEffect(DISCARD_HALF_ONLY)).toEqual([
      { op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" } },
    ]);
    expect(deriveAttackEffect(EISCUE_TEXT)).not.toEqual(deriveAttackEffect(DISCARD_HALF_ONLY));
    // 🆕🆕 **D408 — THE SECOND SENTENCE ALONE LEFT THE `toBeNull`, AND THE CLAIM
    // AROUND IT WAS FALSE RATHER THAN MERELY STALE.** What stood here was *"printed
    // NOWHERE in the pool as an attack effect (censused, 978 cards / 6 sets), which
    // is why there is no bare anchor for it and why it must stay LOUD"*. That census
    // was right about ITS population and wrong about the wider one: the
    // `legal_standard = 1` attack column prints this sentence standalone on **3**
    // printings and its bare-plural twin (*"…can't use attacks."*) on **4**, and
    // `DEFENDER_CANT_ATTACK_NEXT_TURN` reads both. **A "there is none" is the one
    // verdict a narrow population gets wrong in the direction nothing re-checks** —
    // every count carries a POPULATION and a LEGALITY (`conventions.md`), and this
    // rung had been asserting the consequence of a scope for sixty decisions.
    //
    // ⚠️ RE-POINTED RATHER THAN DELETED, AND IT IS A STRONGER WARRANT NOW THAN IT
    // WAS AS A NULL (D299's move, D382's practice). The bare arm must produce this
    // compound's SECOND OP byte for byte, so a reader that drifted between the two
    // shows up HERE as two different programs rather than on a board as a lock
    // sitting on the wrong seat — which no assertion about the record's shape sees.
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
      // The class token is spelled, not captured (D146's call on the same word):
      // a token with no reading behind it must not derive a gate that answers
      // false forever.
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
    expect(deriveAttackEffect(`\t  ${HOUNDOOM_TEXT}\n`)).toEqual(
      deriveAttackEffect(HOUNDOOM_TEXT),
    );
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
    // Two members reading one axis, so they are pinned against each other rather
    // than each against a fixture: if they ever agree, one of them is wrong about
    // what "Basic" means (D131 — one reading, one implementation).
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
    // D116's rule: a reject/tooltip fragment is read where no attack is resolving,
    // so the printed pronoun ("the Defending Pokémon") is dropped for the board
    // fact — the same call `yourActiveDamaged` and `opponentActiveDamaged` made.
    expect(conditionNote(BASIC)).toBe("your opponent's Active Pokémon is a Basic Pokémon");
    expect(conditionNote(BASIC)).not.toBe(conditionNote(EVOLUTION));
  });
});

// ── The window ───────────────────────────────────────────────────────────────

describe("the opponent-side lock — the window is `state.turn + 1`", () => {
  it("locks the DEFENDER on the very next turn, and NOT the installer", () => {
    // THE ASSERTION THE SLICE EXISTS FOR, and it is two claims in one drive: the
    // stamp lands on the other seat's body, and the installer's own is untouched.
    // A build that copied D143's `+ 2` would write a window on a turn TWO later,
    // silently deleting the printed effect on a board where nothing looks wrong.
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
    // The INSTALLER's own turn 4 — the turn D143's stamp would have hit.
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
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(30);
  });

  it("refuses BOTH of the victim's attacks — the lock is on the POKÉMON", () => {
    // D143's assertion made from the other seat, and it is the one that separates
    // this family from the 10 printings that say "can't use {AttackName}". The
    // locked body is Alomomola, whose index-0 "Surf" and index-1 "Aqua Slash" are
    // two different attacks at two different costs; both are refused, and the
    // refusal is the LOCK's code rather than an unpayable cost.
    let state = installed("sv03-134", "sv01-048");
    state = attachFromDeck(state, "p2", "fix-water-energy", 2);
    state = attachFromDeck(state, "p2", "fix-energy", 1);
    expect(refusal(state, "p2", 0)).toBe("ATTACK_PREVENTED");
    expect(refusal(state, "p2", 1)).toBe("ATTACK_PREVENTED");
  });

  it("Eiscue ex writes the same window from behind its Energy cost", () => {
    // The other printing, on a body that survives its 160 (Houndoom ex, 270 HP) so
    // the window can be asserted rather than swept up by a Knock Out.
    const state = installed("sv03-042", "sv03-134", true);
    expect(state.players.p2.active?.attackLockedTurn).toBe(3);
    expect(state.players.p2.active?.damage).toBe(160);
    expect(refusal(state, "p2", 0)).toBe("ATTACK_PREVENTED");
    expect(refusal(state, "p2", 1)).toBe("ATTACK_PREVENTED");
  });

  it("the §12 gate still comes FIRST — two refusals, two codes", () => {
    // The lock is not a Special Condition (types.ts), and the two gates are
    // ordered: an Asleep Active reports the §12 code even when it is also locked,
    // so a reader is told the reason nearest the top of the rulebook. Both codes
    // exist and neither has swallowed the other.
    let state = installed("sv03-134", "sv01-048");
    expect(refusal(state, "p2", 0)).toBe("ATTACK_PREVENTED");
    state = setConditions(state, "p2", { rotation: "asleep" });
    expect(refusal(state, "p2", 0)).toBe("STATUS_PREVENTS_ATTACK");
  });
});

// ── The park, and the seed-free claim ────────────────────────────────────────

describe("the opponent-side lock — it installs BEHIND a park", () => {
  it("parks on the discard, then installs on the RESUMED tail", () => {
    // The first time in this family an OPPONENT-side install has sat behind a
    // park: `discardEnergy` asks a real question whenever two different Energy are
    // attached, so the lock lands only after `resolveEffect`. Both halves are
    // asserted in ORDER, because a build that installed before parking would put
    // the lock row in front of a cost the player has not yet paid.
    const state = armed("sv03-042", "sv03-134", true);
    const first = mustApply(state, { type: "attack", seat: "p1", index: INSTALL_INDEX });
    expect(first.state.phase.kind).toBe("effect:choose");
    expect(find(first.events, "ATTACK_LOCKED")).toBeUndefined();
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
    expect(find(events, "ATTACK_LOCKED")).toBeDefined();
    expect(after.players.p2.active?.attackLockedTurn).toBe(3);
  });

  it("consumes NO rng across a whole park-and-resolve — the seed-free claim", () => {
    // D143's move, and the reason this suite has no seed table: neither sentence
    // flips anything, so the whole slice is deterministic and says so directly
    // rather than by the absence of a sweep.
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
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(90);
    expect(find(events, "ATTACK_LOCKED")).toBeDefined();
    expect(after.players.p2.active?.attackLockedTurn).toBe(3);
  });

  it("FAILS on an EVOLVED defender — full damage, no lock, and NO row at all", () => {
    // The filter's other answer, driven off a real evolution rather than a
    // surgery: Alomomola evolves into fix-mola-stage1 on P2's own turn, and the
    // very same declaration that locked it one case up now does nothing but
    // damage. A rule that DECLINES emits NOTHING (D140/D146) — and the sentence is
    // still SIMULATED, so there is no loud ATTACK_EFFECT_SKIPPED row either, which
    // is the pair of assertions a silent decline actually needs.
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
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(90);
    expect(find(events, "ATTACK_LOCKED")).toBeUndefined();
    expect(find(events, "ATTACK_EFFECT_SKIPPED")).toBeUndefined();
    expect(after.players.p2.active?.attackLockedTurn).toBeNull();
    // …and the un-locked body attacks on its own next turn, so "no lock" is a
    // fact about the board rather than about an absent event.
    let free = attachFromDeck(after, "p2", "fix-water-energy", 1);
    expect(free.turn).toBe(5);
    const swing = mustApply(free, { type: "attack", seat: "p2", index: 0 });
    expect(find(swing.events, "DAMAGE_DEALT")?.dealt).toBe(40);
    free = swing.state;
    expect(free.players.p1.active?.attackLockedTurn).toBeNull();
  });

  it("reads the defender as of RESOLUTION, not as of the turn's start", () => {
    // The gate runs at the attack's TAIL, so the body it asks about is whatever a
    // Boss's Orders put there this turn — which is the installer's own setup line
    // rather than a corner case: gust a Basic up, then lock it. Driven, because
    // "evaluated against the state AS OF this op" is a claim `conditionGate`'s doc
    // block makes and nothing in the pool had ever tested across seats.
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
    expect(find(events, "ATTACK_LOCKED")).toBeDefined();
  });
});

// ── Both payability projections ──────────────────────────────────────────────

describe("the opponent-side lock — both projections, from the LOCKED seat", () => {
  it("`redactedAttacksOf` offers the victim nothing the server would take", () => {
    // D143's rule ("a gate on an ACTION owes BOTH payability projections") applied
    // to a gate the VICTIM never chose — which is the case where a stale button
    // hurts most, since the player has no card of their own to read the reason
    // off. Swept over both attacks in both directions rather than sampled.
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
    // The LOCAL /play path computes `attackLocked(game, active)` off raw
    // GameState (GameHud.tsx), which is the same predicate `redactedAttacksOf`
    // folds into `playable`. Asserting the predicate itself is what makes the two
    // projections one claim rather than two — and it is asserted for the
    // INSTALLER too, whose button must stay live.
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
    // retreat (the §10 clear itself, asserted as LEGAL here rather than for its
    // effect — that is the next describe's job). Alomomola's printed retreat is
    // 2, so the cost is put on the body first: this case is about the LOCK not
    // refusing the action, never about affording it.
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
    // The cheapest of the three routes and the sharpest: §10 sheds the effects of
    // ATTACKS, so an evolution played on the locked turn un-locks the body and it
    // swings immediately. Same site, same clear as D143's — opposite agency, since
    // the player taking it is the one the effect was done to.
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
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(40);
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
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(30);
  });

  it("the INSTALLER cannot reach any of the three routes inside the window", () => {
    // The agency claim, stated as a fact about the turn order rather than as
    // prose: the window is the victim's own turn, so the installer has no action
    // at all while it is open — their turn ended when they declared (§5.3). This
    // is the exact inversion of D142's block, whose only in-window clear was the
    // OPPONENT's Boss's Orders.
    const held = installed("sv03-134", "sv01-048");
    expect(held.turn).toBe(3);
    expect(applyAction(held, { type: "endTurn", seat: "p1" }).ok).toBe(false);
    expect(
      applyAction(held, { type: "retreat", seat: "p1", discardEnergy: [], promoteBenchIndex: 0 })
        .ok,
    ).toBe(false);
  });

  it("a KNOCKED OUT holder takes the lock out of play with the stack", () => {
    // Eiscue ex's printed 160 into Alomomola's 110 — a LETHAL install, which on
    // this arm is a line rather than a corner: the attack that locks the body is
    // the same attack that can end it. The row is still emitted (attack.ts runs
    // the program before the §8.1 sweep, exactly as a defender-targeted status
    // lands on a lethal hit), and the PROMOTED body carries no lock.
    const { state, events } = mustApply(
      armed("sv03-042", "sv01-048"),
      { type: "attack", seat: "p1", index: INSTALL_INDEX },
    );
    // The ORDER is the assertion, not just the presence: the lock row lands
    // BEFORE the Knock Out, because attack.ts runs the effect program at its tail
    // and sweeps §8.1 after it. Writing a stamp onto a body that is about to leave
    // play is harmless and it is what "in printed order" means.
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
  /** D142's WIDE block, surgeried onto the defender for the installing turn.
      Every one of the pool's 13 `effects: true` printings is COIN-GATED (censused,
      978 cards / 6 sets), so driving one would put a coin into a suite whose whole
      determinism claim is that it takes none — D143's own move on this same
      field, and D144's precedent for pinning a rule with no ungated card. */
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
    expect(find(events, "ATTACK_EFFECT_PREVENTED")).toBeDefined();
    expect(find(events, "ATTACK_LOCKED")).toBeUndefined();
    expect(state.players.p2.active?.attackLockedTurn).toBeNull();
    // …and the damage half was nulled by the same block, which is what makes this
    // one block and not two rules that happen to agree.
    expect(find(events, "DAMAGE_DEALT")?.prevented).toBe(true);
  });

  it("a NARROW block nulls the damage and lets the lock through", () => {
    // D142's two readings, kept disjoint (its "this is where shipping TWO
    // readings pays" argument, on a third op): the narrow spelling refuses DAMAGE
    // only, so the defender takes nothing and is locked anyway.
    const state = armed("sv03-134", "sv01-048");
    const active = state.players.p2.active;
    if (active === null) throw new Error("no defender");
    const narrow: GameState = {
      ...state,
      players: {
        ...state.players,
        p2: { ...state.players.p2, active: { ...active, attackBlock: { turn: 2, effects: false } } },
      },
    };
    const { state: after, events } = mustApply(narrow, {
      type: "attack",
      seat: "p1",
      index: INSTALL_INDEX,
    });
    expect(find(events, "DAMAGE_DEALT")?.prevented).toBe(true);
    expect(find(events, "ATTACK_EFFECT_PREVENTED")).toBeUndefined();
    expect(find(events, "ATTACK_LOCKED")).toBeDefined();
    expect(after.players.p2.active?.attackLockedTurn).toBe(3);
  });

  it("refuses Eiscue ex's lock while its Energy cost is still paid", () => {
    // The compound under a block, and the ordering matters: sentence one is the
    // attacker's OWN cost and nothing about the defender's block touches it, so
    // the Energy goes and the lock does not land. A build that refused the whole
    // program would give the attacker their Energy back.
    const before = shielded(armed("sv03-042", "sv03-134"));
    const energyBefore = before.players.p1.active?.energy.length ?? 0;
    const { state, events } = mustApply(before, {
      type: "attack",
      seat: "p1",
      index: INSTALL_INDEX,
    });
    expect(state.players.p1.active?.energy.length).toBe(energyBefore - 1);
    expect(find(events, "ATTACK_EFFECT_PREVENTED")).toBeDefined();
    expect(state.players.p2.active?.attackLockedTurn).toBeNull();
  });
});

// ── Two installers, one body ─────────────────────────────────────────────────

describe("the opponent-side lock — two installs on one body", () => {
  it("a self-lock and a defender-lock can name the SAME turn, and the second is silent", () => {
    // THE CASE D143's IDEMPOTENCE ANSWER WAS WRITTEN FOR AND COULD NOT REACH: two
    // DIFFERENT ops, on two different seats' turns, writing ONE number onto one
    // body. Alomomola locks ITSELF with "Aqua Slash" on turn 3 (D143's `+ 2` →
    // stamp 5); Houndoom ex locks it from across the table on turn 4 (D148's
    // `+ 1` → stamp 5). Same fact from two directions, so the second install is
    // SILENT — D142's "when the merge says nothing new the row is suppressed
    // entirely", reached for the first time by two different printings.
    let state = armed("sv03-134", "sv01-048");
    state = must(applyAction(state, { type: "endTurn", seat: "p1" }));
    state = attachFromDeck(state, "p2", "fix-water-energy", 2);
    state = attachFromDeck(state, "p2", "fix-energy", 1);
    expect(state.turn).toBe(3);
    const selfLock = mustApply(state, { type: "attack", seat: "p2", index: 1 });
    expect(selfLock.state.players.p2.active?.attackLockedTurn).toBe(5);
    expect(find(selfLock.events, "ATTACK_LOCKED")?.seat).toBe("p2");
    // …then P1's turn 4 aims the OTHER printing at the same body and names the
    // same turn.
    let next = selfLock.state;
    expect(next.turn).toBe(4);
    const second = mustApply(next, { type: "attack", seat: "p1", index: INSTALL_INDEX });
    next = second.state;
    expect(next.players.p2.active?.attackLockedTurn).toBe(5);
    expect(find(second.events, "ATTACK_LOCKED")).toBeUndefined();
    expect(refusal(next, "p2", 0)).toBe("ATTACK_PREVENTED");
    expect(refusal(next, "p2", 1)).toBe("ATTACK_PREVENTED");
  });

  it("the stamps are MONOTONE — a later install never writes an earlier turn", () => {
    // The property that makes "the later stamp wins" correct without a `Math.max`
    // (contrast `reduceDamage`, whose sources really can disagree). Every install
    // writes its holder's next turn measured from the install, and installs are
    // ordered in time — so the sequence on any one body never goes backwards.
    // Driven on fix-titan (340 HP), which outlives three Evil Claws so the
    // sequence is about the STAMPS rather than about a KO ending it.
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
    // D136's finding 1: `seat` owns the AFFECTED Pokémon. On D143's 22 printings
    // that seat happened to be the actor's own, which made the row read as ACTIVE
    // voice; here it is the victim's, and the WORDING D143 chose ("phrased from
    // the holder's side, so it reads as RETREAT_BLOCKED's sibling") turns out to
    // be exactly what the other direction needed. Driven and READ rather than
    // argued (D144's rule).
    const state = armed("sv03-134", "sv01-048");
    const { state: after, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: INSTALL_INDEX,
    });
    const row = find(events, "ATTACK_LOCKED");
    expect(row?.seat).toBe("p2");
    expect(row?.uid).toBe(activeUid(state, "p2"));
    const rendered = renderedLock(events, after);
    expect(rendered?.who).toBe("p2");
    expect(textOf(rendered)).toBe("Alomomola can't attack next turn");
    // ONE row per install, never one per attack the lock will refuse.
    expect(countOf(events, "ATTACK_LOCKED")).toBe(1);
  });

  it("renders the SAME wording for the self arm — one arm, both directions", () => {
    // The claim that no second phrasing was owed, asserted rather than asserted
    // about: the identical sentence shape comes out under the OTHER seat's name
    // when the OTHER printing installs it. A build that keyed the wording on the
    // direction would have to say something the row cannot know (whose attack
    // wrote it) to tell the reader something they already have (whose Pokémon it
    // is).
    let state = installed("sv03-134", "sv01-048");
    state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
    state = must(applyAction(state, { type: "endTurn", seat: "p1" }));
    state = attachFromDeck(state, "p2", "fix-water-energy", 2);
    state = attachFromDeck(state, "p2", "fix-energy", 1);
    const { state: after, events } = mustApply(state, { type: "attack", seat: "p2", index: 1 });
    const row = find(events, "ATTACK_LOCKED");
    expect(row?.seat).toBe("p2");
    const rendered = renderedLock(events, after);
    expect(rendered?.who).toBe("p2");
    expect(textOf(rendered)).toBe("Alomomola can't attack next turn");
  });

  it("emits NOTHING when the class gate declines", () => {
    // A rule that DECLINES is silent (D140/D146): the attack's own DAMAGE_DEALT
    // row already says the whole thing, and loudness in this engine is owed to
    // UNREAD TEXT rather than to a read rule saying no. Asserted on the LOG rather
    // than only on the event stream, because a stray row is a reader-facing bug.
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
    // D146's and D147's own miss was in the CARD NAMES, so every field is checked
    // rather than recognised. The three Eiscue ex printings are one attack in
    // three rarities (sv03-042 / -210 / -222) and only one is fielded, which is
    // the standing convention — the OTHER two are pinned by the deriver, which
    // reads the identical string.
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
    // Both are `ex`, so a KO of either takes TWO Prizes — kept on purpose
    // (D133's Skeledirge precedent) rather than sanded off for a quieter board.
    expect(prizeValueOf(eiscue as Card)).toBe(2);
    expect(prizeValueOf(houndoom as Card)).toBe(2);
  });

  it("the deck is 60 cards and the pool holds every id in it", () => {
    expect(DEFENDER_LOCK_DECK).toHaveLength(60);
    for (const id of new Set(DEFENDER_LOCK_DECK)) expect(FIXTURE_POOL[id]).toBeDefined();
  });
});
