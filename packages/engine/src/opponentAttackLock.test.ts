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
} from "./testFixtures";

// 0.103.1 → 0.104.0 — the OPPONENT-SIDE PER-ATTACK LOCK (P3-M5 long tail, D157):
//
//   "Choose 1 of your opponent's Active Pokémon's attacks.
//    During your opponent's next turn, that Pokémon can't use that attack."
//
// Item 1b of D156's remainder list, and the LAST unread member of the per-attack
// neighbourhood: D154 read the self-side bar, D155 the self-side buff, and both
// left this one LOUD in their own doc blocks because the address here is CHOSEN
// rather than printed.
//
// CENSUS (local D1, 2026-08-03, **890 rows across FIVE sets** — the population
// D156 measured, pinned and named; `catalogManifest.ts` holds it). Run as its OWN
// question across all three text columns rather than inherited from §D154's
// table: `LIKE '%can''t use that attack%'` returns exactly TWO rows and both are
// this sentence — Medicham sv01-111 "Acu-Punch-Ture" ({F}, 30, INDEX 0) and
// Oranguru sv02-094 "Plotter's Command" ({P}{C}, 30, INDEX 0). The D1 itself says
// the two effect strings are byte-identical. `FIXTURE_POOL` was swept SEPARATELY
// (D154's finding, D156's rule): no fixture printed the sentence before this
// slice, so unlike D154 there is no fielded-but-uncatalogued third printing. Both
// ids were swept repo-wide for a misnamed comment or test title and were clean.
//
// ⚠️ AND SEE D160/D162. The 890 / 5 above is the OUTAGE-WINDOW catalog and is left
// standing as the population this slice actually queried; D160 re-ingested
// `swsh10.5` (978 rows / 6 sets) and D162 re-ran this census against the restored
// catalog — `LIKE '%can''t use that attack%'` still returns exactly TWO rows, the
// restored set contributing ZERO. The floor above is also the TOTAL.
//
// FOUR things this slice turns on, and every one of them is a question the two
// slices in front of it did NOT have to answer:
//
//   • THE ADDRESS IS PARKED. `preventChosenAttack` carries no fields at all — the
//     INDEX arrives on the answer to a new `chooseAttack` prompt, whose candidates
//     are the rows of a Pokémon's printed attack list rather than cards or
//     Pokémon. Three endings, all reachable off the two printings: no attacks →
//     silent, one attack → forced, two or more → park;
//   • THE FIELD IS SHARED AND THE OP IS NOT. `InPlayPokemon.lockedAttack` is
//     reused UNCHANGED (no new stamped field, `MATCH_RECORD_VERSION` untouched at
//     10) because `lockedAttackIndex` is its ONE reader and REFUSES the index
//     whichever op wrote it — D148's answer at the address. D155 refused to share
//     `boostedAttack` with that same record on the same axis and got the opposite
//     result, because ITS consumer PAYS the index. One test, two answers, decided
//     by the read site both times;
//   • IT IS `blocked` BY §11, where both siblings are `untouched` — the first op
//     in this family a wide block stops, because it is the first that writes onto
//     the DEFENDING Pokémon;
//   • THE STAMP IS `state.turn + 1`, D142/D148's number, and the LOCKED SEAT IS
//     THE ONE THAT DID NOT ACT — which is what makes both payability projections
//     worth re-driving even though neither takes a diff.

/** The printed sentence, byte-for-byte off BOTH local D1 rows (the database
    compares them equal; this constant is used for both fixtures for that reason
    rather than out of convenience). */
const PLOTTED =
  "Choose 1 of your opponent's Active Pokémon's attacks. During your opponent's next turn, that Pokémon can't use that attack.";

/** fix-attacker's SIX printed attacks — the body every headline board bars.
    Barring index 0 must leave the other five legal, which is the whole difference
    from D148's whole-Pokémon lock.

    `YAWN` is the sibling every legality assertion below uses, and it is chosen for
    a property rather than for variety: it prints **no cost at all**, so "the other
    attack is still legal" is answered by the §8 gate alone and never by whatever
    energy a board happened to attach. */
const BITE = 0;
const FLAME = 1;
const YAWN = 2;

/** One seed for the whole suite: neither printing carries a coin and no board
    below declares Medicham's index-1 "Kick Shot" (which does), so a seed table
    would describe a shuffle rather than a rule — D143's move, inherited by every
    durated slice since D147. */
const SEED = 21;

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

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

/** P2 opens and passes, so P1's turn 2 carries no §4 attack restriction. P1
    fields the BARRER with the energy its attack costs; P2 fields the VICTIM,
    whose printed attack COUNT is the axis this slice varies. */
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

/** `ready`, then the barrer's index-0 attack DECLARED and the park ANSWERED with
    `index`. Asserts the park actually happened and the row actually landed, so no
    case below can assert "nothing was refused" against a board that barred
    nothing. Returns the state AFTER the epilogue drained — i.e. P2's turn, which
    IS the window (the stamp is `+ 1`). */
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
  const row = find(events, "ATTACK_LOCKED");
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

/** TEST SURGERY: put a live WIDE §11 block on `seat`'s Active for the turn it is
    about to be attacked on. The printed installer (Scyther sv03-004 "Agility")
    is COIN-GATED, and this deck is deliberately seed-free — so the state is
    written rather than played, and the §11 verdict's own driven board lives in
    `preventBlock.test.ts`'s probe table (D150's mechanism), where every op in the
    engine is driven under the same block. */
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
    // D151's rule (a fixture can be wrong by OMISSION and `toEqual` on the fields
    // it HAS will never say so), and since D156 a TEST says so too —
    // `catalogManifest.test.ts` diffs both of these ids against the committed
    // measurement of the D1. The absences are asserted here as well, because that
    // is the assertion a later "completion" would have to move on purpose.
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
    // Its index-1 attack is read by a DIFFERENT reader (D126's `cancelOnTails`),
    // which is the reason no board here declares it: it would need a seed.
    expect(medicham?.attacks?.[1]?.name).toBe("Kick Shot");
    expect(deriveAttackEffect(must0Str(medicham?.attacks?.[1]?.effect))).toBeNull();
  });

  it("both printings sit at INDEX 0, and the effect strings are IDENTICAL", () => {
    // D144's index trap, checked per printing rather than assumed constant — and
    // here the identity of the two strings is the reason this is ONE anchor for
    // two printings (D121's second-printing warrant met by the cards, not by an
    // argument about similarity).
    const at = (id: string, name: string) =>
      FIXTURE_POOL[id]?.attacks?.findIndex((a) => a.name === name);
    expect(at("sv02-094", "Plotter's Command")).toBe(0);
    expect(at("sv01-111", "Acu-Punch-Ture")).toBe(0);
    expect(FIXTURE_POOL["sv02-094"]?.attacks?.[0]?.effect).toBe(
      FIXTURE_POOL["sv01-111"]?.attacks?.[0]?.effect,
    );
  });

  it("derives ONE op with NO capture, on both printings", () => {
    // The only anchor in this neighbourhood that is a `test` rather than an
    // `exec`: "that attack" is ANAPHORIC — it points at a decision the player has
    // not taken yet — so there is nothing to capture and the address is produced
    // by the park instead.
    expect(deriveAttackEffect(PLOTTED)).toEqual([{ op: "preventChosenAttack" }]);
    expect(deriveAttackEffect(must0Str(FIXTURE_POOL["sv01-111"]?.attacks?.[0]?.effect))).toEqual([
      { op: "preventChosenAttack" },
    ]);
  });

  it("the anchor refuses the neighbourhood, and each refusal is a warrant", () => {
    for (const text of [
      // The FIRST SENTENCE ALONE. This is the refusal that matters most, because
      // the two halves are not two consequents (arm 25's shape) — sentence one is
      // the ANTECEDENT of sentence two, and a prefix reader would offer a choice
      // that bought nothing.
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
    // 🆕 **D299 — THE THIRD `Choose 1 of your opponent` ROW LEFT THE `toBeNull`
    // LOOP AND BECAME A PROGRAM COMPARISON, WHICH IS A STRONGER WARRANT.** Sylveon
    // `svp-172`/`sv06.5-022` "Mystical Return" is what the capitalised `^Choose`
    // was always holding off (a lowercase mid-sentence "choose", a different noun,
    // a coin in front); `returnBenched` reads it now, so "this anchor refuses it"
    // can no longer be spelled as "nobody reads it". Asserting the WHOLE program
    // says both things at once: this reader did not claim it, and the reader that
    // did claim it produced the shuffle-away rather than an attack lock.
    expect(
      deriveAttackEffect(
        "Flip a coin. If heads, choose 1 of your opponent's Benched Pokémon. Shuffle that Pokémon and all attached cards into their deck.",
      ),
    ).toEqual([
      // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable.
      { op: "coinFlipGate", then: [{ op: "returnBenched", whose: "opponent", dest: "deck" }] },
    ]);
    // …and the two SELF-side siblings, asserted as DIFFERENT PROGRAMS rather than
    // as nulls. All three sentences bar or buy ONE named attack for ONE turn; a
    // reader that drifted between them would be invisible on every board, which is
    // exactly why the warrant is an op comparison and not a `toBeNull`.
    expect(deriveAttackEffect("During your next turn, this Pokémon can't use Peck.")).toEqual([
      { op: "preventAttackUse", attack: "Peck" },
    ]);
    // 🆕🆕 **D408 — AND THE OPPONENT-SIDE WHOLE-POKÉMON LOCK JOINED THEM, FOR
    // EXACTLY D299's REASON ONE ROW UP.** This line was a `toBeNull` warrant: D148
    // read the sentence only as the second clause of a compound, so "this anchor
    // refuses it" could be spelled as "nobody reads it". The bare form is printed on
    // 3 legal printings (plus 4 of *"…can't use attacks."*) and
    // `DEFENDER_CANT_ATTACK_NEXT_TURN` reads it now, so the warrant is asserted as a
    // DIFFERENT PROGRAM instead. That says both things at once, and the second is the
    // one that matters here: this anchor did not claim the sentence, and the reader
    // that did produced a WHOLE-POKÉMON lock rather than this file's per-attack one —
    // two ops that write to the same body and are told apart by nothing on a board.
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
    // The candidates are ROWS of the DEFENDER's attack list — index + printed
    // name, in printed order, with nothing filtered. The engine resolves the label
    // here because the wire cannot: `RedactedCard` carries no attack rows and
    // `RedactedAttack[]` is published for the viewer's OWN Active only.
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
    // …and the attack's own damage landed BEFORE the park, which is the §8.5
    // pipeline running in front of the tail program (D125's placement rule).
    expect(find(opened.events, "DAMAGE_DEALT")?.dealt).toBe(30);
    // The turn has NOT ended: the epilogue is queued behind the park.
    expect(opened.state.turn).toBe(2);
  });

  it("a ONE-attack defender is FORCED — no prompt, and the same record", () => {
    // The M1 doctrine ("a choice with no choice in it is not a choice"), and this
    // is also the board on which this op and D148's whole-Pokémon lock become
    // observationally identical — the control that proves the suite is not only
    // measuring the easy case.
    const opened = mustApply(ready("sv02-094", "fix-echoer-stage1"), {
      type: "attack",
      seat: "p1",
      index: 0,
    });
    expect(opened.state.phase.kind).not.toBe("effect:choose");
    expect(find(opened.events, "ATTACK_LOCKED")).toEqual({
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
    // fix-titan (340 HP, no `attacks`). A lock on a Pokémon with nothing to lock
    // is inert, and the honest representation of inert is absence (D140/D146 — a
    // gate that declines emits nothing). Reachable off both printings: an
    // attackless defender is an ordinary board.
    const opened = mustApply(ready("sv02-094", "fix-titan"), {
      type: "attack",
      seat: "p1",
      index: 0,
    });
    expect(opened.state.phase.kind).not.toBe("effect:choose");
    expect(types(opened.events)).not.toContain("ATTACK_LOCKED");
    expect(opened.state.players.p2.active?.lockedAttacks ?? []).toEqual([]);
    // …and the attack itself still resolved, which is the difference between a
    // silent rider and a cancelled attack (D145's two words for "nothing
    // happened", which resolve oppositely).
    expect(find(opened.events, "DAMAGE_DEALT")?.dealt).toBe(30);
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
    // The stamp is the LOCKED Pokémon's controller's next turn — D142/D148's
    // number, not D143's. Declaring an attack ENDS the turn (§5.3), so the turn
    // after the installing one belongs to the victim, and the window opens the
    // moment the epilogue drains.
    expect(state.players.p2.active?.lockedAttacks).toEqual([{ turn: 3, attackIndex: BITE }]);
    expect(state.turn).toBe(3);
    expect(row).toEqual({ type: "ATTACK_LOCKED", seat: "p2", uid: victimUid, attack: "Bite" });
    // …and the ACTOR's own body carries nothing at all. The two per-attack ops
    // that write `ctx.seat`'s Active are D154's and D155's; this one never does.
    expect(state.players.p1.active?.lockedAttacks ?? []).toEqual([]);
    expect(state.players.p1.active?.attackLockedTurn ?? null).toBeNull();
  });

  it("refuses exactly the barred index and OFFERS the other three", () => {
    // The whole content of the rule, as a board. D148's lock refuses every
    // declaration; this one refuses one of four.
    const { state } = barred(BITE);
    expect(state.phase).toEqual({ kind: "turn:action", seat: "p2" });
    expect(refusal(state, "p2", BITE)).toBe("ATTACK_PREVENTED");
    expect(refusal(state, "p2", YAWN)).toBeNull();
    // …and the message NAMES the barred attack, because what differs from D143's
    // rejection is what the player must do next.
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
    // Unreachable off the two printings on this side too (an attack ends the turn,
    // and the window is the very next one), so it is a surgery — and it is
    // `addLockedAttack`'s EARLY RETURN rather than `boostAttack`'s `Math.max`,
    // because this record carries an address and no number.
    //
    // ⚠️ D165 CHANGED THE SECOND HALF. It used to assert that a differing index
    // REPLACED the record; the field has TWO writers and that overwrite is
    // precisely how this op deleted a victim's own live self-installed bar (the
    // played board is in `lockedAttackMerge.test.ts`). The merge APPENDS.
    const board = ready("sv02-094", "fix-attacker");
    const same = setLock(board, "p2", [{ turn: 3, attackIndex: BITE }]);
    const events: GameEvent[] = [];
    const again = runProgram(
      same,
      [{ op: "preventChosenAttack" }],
      { seat: "p1", invokedBy: "attack" },
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
    // …and a DIFFERENT index is ADDED BESIDE the live one, because the address is
    // the whole content: there is no "keep the larger of two" to fall back on and
    // — since D165 — no "keep the later one" either.
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
    expect(find(other.events, "ATTACK_LOCKED")?.attack).toBe("Flame");
  });

  it("an OUT-OF-RANGE index writes nothing — the apply re-validates the board", () => {
    // Unreachable through `applyAction` (validateChoice rejects an index the
    // prompt did not offer, and nothing promotes or evolves the DEFENDER between
    // an attack's park and its answer), so it is driven straight through
    // `resumeProgram` — BELOW the wire check, which is the only place the apply's
    // own guard is observable. An index the body does not have installs NOTHING
    // and emits no row, `printedAttackIndex`'s no-match contract from the other
    // side of the same question.
    const board = ready("sv02-094", "fix-echoer");
    const parkEvents: GameEvent[] = [];
    const result = runProgram(
      board,
      [{ op: "preventChosenAttack" }],
      { seat: "p1", invokedBy: "attack" },
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
    expect(find(good, "ATTACK_LOCKED")?.attack).toBe("Echo Chorus");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// VOICE — the first ATTACK_LOCKED row that is VICTIM-side AND names an attack.
// ─────────────────────────────────────────────────────────────────────────────

describe("the log row — rendered under BOTH seats and READ", () => {
  it("names the VICTIM's Pokémon and the barred attack, and needs no new wording", () => {
    // ⚠️ THIS IS THE CELL OF THE CROSS-PRODUCT NOBODY HAD FILLED. `ATTACK_LOCKED`
    // has been victim-side since D148 (which added no `attack` field) and has
    // carried the `attack` narrowing since D154 (whose op has no defender arm).
    // This slice is the first path that is BOTH, so the wording was re-read here
    // rather than inherited from either.
    //
    // "next turn" means the NAMED player's own next turn under this family's seat
    // rule — and the named player is the victim, whose next turn is exactly the
    // `+ 1` window this stamp encodes. So the row is true as it stands.
    const { state, row } = barred(BITE);
    expect(render([row], state)).toEqual([
      { who: "p2", text: "fix-attacker can't use Bite next turn" },
    ]);
    // …and the MIRROR: the same row under the ACTOR's name, which is what a build
    // that copied D154's `seat: ctx.seat` would print. It is not stilted, it is
    // FALSE — P1's Oranguru is barred from nothing, and a player reading it would
    // pass a turn they could have attacked on.
    expect(render([{ ...row, seat: "p1" }], state)).toEqual([
      { who: "p1", text: "fix-attacker can't use Bite next turn" },
    ]);
    // …and the BARE wording, which is D148's row: also false here, in the other
    // direction — it promises a whole-Pokémon lock where three attacks stay legal.
    expect(render([{ ...row, attack: undefined }], state)).toEqual([
      { who: "p2", text: "fix-attacker can't attack next turn" },
    ]);
    expect(refusal(state, "p2", YAWN)).toBeNull();
  });

  it("prints the CARD's spelling of the attack, not an index", () => {
    // The install resolves index → name once and puts both where they are read:
    // the index into the record (every consumer addresses attacks by index), the
    // name onto the row (a log row is read by a player holding the card).
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

// ─────────────────────────────────────────────────────────────────────────────
// §10 — the four clears, SWEPT, with the agency inverted (D148's finding).
// ─────────────────────────────────────────────────────────────────────────────

describe("§10 sheds it — every clear driven from the VICTIM's chair", () => {
  it("RETREATING inside the window sheds it — the victim's own route", () => {
    // The window is the VICTIM's own turn, so all three routes below are lines the
    // LOCKED player takes. That is D148's agency inversion: on D154's side these
    // are the holder escaping their own card's drawback, here they are counterplay
    // against an effect the player never chose.
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
    expect(retreated.players.p2.bench.at(-1)?.lockedAttacks ?? []).toEqual([]);
  });

  it("EVOLVING inside the window frees the barred attack — and points at NOTHING", () => {
    // fix-echoer prints TWO attacks and evolves into fix-echoer-stage1, which
    // prints ONE — so a stale record surviving the evolution would not merely
    // persist, it would bar an index the new body does not have. The failure this
    // rules out is "barred somewhere else", which is the sharper of the two.
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
    // Boss's Orders played by the seat that installed the lock. On D154's side
    // this is the opponent's counterplay; on this side it is the installer undoing
    // their own effect, which is worth driving precisely because it looks like a
    // play nobody would make and is the same §10 literal.
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
    // D149's rule: the clear-set is four hand-written literals in two files with
    // nothing making them agree, so the sweep is structural — every §10-sheddable
    // key read off ONE body that has been through a clear. A literal that forgot a
    // field fails on the FIELD rather than on a board somebody remembered to write.
    //
    // ⚠️ AND THIS SLICE ADDS NO CLEAR, WHICH IS THE POINT: the field it writes is
    // D154's, already on all four literals. What the sweep proves is that pointing
    // an existing field at the OTHER seat's body needs no fifth site — the clears
    // are written on `InPlayPokemon` and know nothing about who installed what.
    // 🆕🆕 D432 — the NO-WEAKNESS bar joins the swept set. It is read STRUCTURALLY
    // here for the reason its own suite states: §8.5 applies Weakness only to the
    // ACTIVE, so once a body has been through a §10 clear there is no number left
    // that could witness the bar's absence. The field is the only witness there is.
    const { state } = barred(1, "fix-echoer");
    const held = handFromDeck(state, "p2", "fix-echoer-stage1", 1);
    const { state: evolved } = mustApply(held, {
      type: "evolve",
      seat: "p2",
      uid: handUid(held, "p2", "fix-echoer-stage1"),
      target: { spot: "active" },
    });
    // 🆕🆕 D434 — the SCHEDULED counter placement joins the swept set, and it is read
    // STRUCTURALLY for a reason of its own: the record's whole effect is in the
    // future, so after a §10 clear there is no number that could witness its absence
    // until a Checkup that will never place anything. The field IS the witness.
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
    // `discardEnergy`'s placement and its reason verbatim: the refusal is taken
    // BEFORE the candidates are built, so a blocked defender never reaches the
    // prompt and the attacker is not invited to pick an attack that will not be
    // barred. The verdict itself (`blocked`, where both siblings are `untouched`)
    // is driven for every op in the engine by `preventBlock.test.ts`'s probe table.
    const shielded = shield(ready("sv02-094", "fix-attacker"), "p2");
    const { state, events } = mustApply(shielded, { type: "attack", seat: "p1", index: 0 });
    expect(state.phase.kind).not.toBe("effect:choose");
    expect(types(events)).toContain("ATTACK_EFFECT_PREVENTED");
    expect(find(events, "ATTACK_EFFECT_PREVENTED")).toEqual({
      type: "ATTACK_EFFECT_PREVENTED",
      seat: "p2",
      uid: activeUid(shielded, "p2"),
    });
    expect(state.players.p2.active?.lockedAttacks ?? []).toEqual([]);
    expect(types(events)).not.toContain("ATTACK_LOCKED");
  });

  it("…and the SAME board with the block removed installs — the control", () => {
    // Without this the case above would pass against a build that refused
    // everything (D150's two-sided rule).
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
    // ⚠️ NEITHER PROJECTION TAKES A DIFF, AND THAT WAS CHECKED RATHER THAN
    // ASSUMED. `redactedAttacksOf` returns rows only for `viewerSeat === turnSeat`
    // and reads that viewer's OWN Active's `lockedAttack`; the locked seat here is
    // the one that did NOT act, and it is the turn owner exactly during the window
    // — so the same line answers. What changes is WHO is looking at the greyed
    // button: a player who never chose the lock and has no card of their own to
    // read the reason off, which is the case D148 called the sharper one to get
    // wrong.
    // One {C} on the victim, so BITE is payable and the ONLY thing that can grey
    // it is this record. Without it the case would pass against a build that
    // never wrote anything, the cost check having greyed the row anyway.
    const state = attachFromDeck(barred(BITE).state, "p2", "fix-energy", 1);
    const view = redactGame(state, "p2").phase;
    if (view.kind !== "turn:action") throw new Error(`expected turn:action, got ${view.kind}`);
    expect(view.attacks).toHaveLength(6);
    expect(view.attacks[BITE]?.name).toBe("Bite");
    expect(view.attacks[BITE]?.playable).toBe(false);
    expect(view.attacks[YAWN]?.name).toBe("Yawn");
    expect(view.attacks[YAWN]?.playable).toBe(true);
    // …and the SAME board with the record removed offers it. This is the control
    // D150's two-sided rule asks for: exactly ONE more row is greyed by the lock
    // than by the board's own payability, and it is the barred one.
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
    // The public-ref reading, driven: the candidates are printed attacks of a
    // face-up Active, so nothing is resolved out of a private zone — but they
    // carry a NAME, because an attack index resolves against nothing the wire
    // ships. Both halves are asserted, because the pair is the finding.
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
    // The reason `lockedAttack` is reused and `MATCH_RECORD_VERSION` does not
    // move: "which of this body's attacks is barred, and on which turn" is ONE
    // question about ONE body (D148's answer), and its ONE reader REFUSES the
    // index whichever op wrote it. Two records of the same shape, on two bodies,
    // answered by the same function.
    const { state } = barred(BITE);
    const selfSide = setLock(state, "p1", [{ turn: 3, attackIndex: 1 }]);
    expect(lockedAttackIndexes(selfSide, must0(selfSide.players.p1.active))).toEqual([1]);
    expect(lockedAttackIndexes(selfSide, must0(selfSide.players.p2.active))).toEqual([BITE]);
  });

  it("a Pokémon can carry this bar AND D148's whole lock at once", () => {
    // The two facts are on two fields and both are live on the same turn — the
    // reachability argument D154 made for keeping `lockedAttack` out of
    // `attackLockedTurn`, run from the OTHER seat. One record could not hold both.
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
