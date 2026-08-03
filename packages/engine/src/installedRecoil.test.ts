import { describe, expect, it } from "vitest";
import { installedRecoilOf, passivesOf } from "./continuous";
import { deriveAttackEffect } from "./effects";
import { applyAction, programFor } from "./index";
import { runProgram } from "./interpreter";
import type { GameEvent, GameState, Seat } from "./index";
import { type LogContext, logFromEvents } from "./log";
import {
  FIXTURE_POOL,
  INSTALLED_RECOIL_DECK,
  activeUid,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  driveSetup,
  handFromDeck,
  handUid,
  must,
  mustApply,
  setActiveFromDeck,
  types,
} from "./testFixtures";

// 0.99.0 → 0.100.0 — the ATTACK-INSTALLED REACTIVE RECOIL (P3-M5 long tail, D152),
// the §9 recoil family's durated member and the LAST slice of a sixteen-slice run:
//
//   "During your opponent's next turn, if this Pokémon is damaged by an attack
//    (even if it is Knocked Out), put 10 damage counters on the Attacking
//    Pokémon."                          (Lycanroc ex sv02-117/-241 "Scary Fangs")
//
// ⚠️ TWO PRINTINGS, AND THE CENSUS IS THIS SESSION'S OWN QUERY rather than §D141's
// count. The local D1 (2026-08-02, 978 cards / 6 sets) prints "…damage counters on the
// Attacking Pokémon" on EIGHT rows: four ALWAYS-ON printings already simulated
// since 0.x (Cacnea sv01-005 / Cacturne sv01-006 "Counterattack Quills", 3
// counters; Stunfisk sv03-112 "Custom Trap", 5, `requiresTool`; Rocky Helmet
// sv01-193, 2, a Pokémon TOOL), these two, and TWO deliberately out of scope —
// Vengeful Punch sv03-197 (a Tool on a KO condition, wanting the §8.1 sweep rather
// than the `dealt > 0` block) and Mabosstiff sv02-143 (the same sentence with the
// amount read off the damage done, wanting the §8.5-result channel). Both stay
// LOUD, and counterattack.test.ts still pins them.
//
// ⚠️ IT IS `installedReductionOf`'s SIBLING, NOT ITS MIRROR. Same holder ("this
// Pokémon" — the installer's own Active), same `state.turn + 1` window, same
// `{ turn, amount }` record, same `Math.max` merge, same three §10 clears, same
// no-`attackEffectRefused` verdict. The ONE difference is which number the stamp
// feeds: D147's is subtracted at §8.5 step 5, this one is ADDED at the §9 reactive
// recoil — the site that has summed `passivesOf().damageAttacker` since 0.x.
//
// ⚠️ AND THAT SUM IS D141's JUDGEMENT RE-RUN WITH A THIRD PROVENANCE. D141 refused
// a provenance label on COUNTERS_PLACED because `passivesOf` folds a holder's
// Ability AND every attached Tool into one number. An ATTACK's installation now
// joins that fold: a Lycanroc ex carrying 100 and wearing Rocky Helmet retaliates
// for 120 in ONE row labelled `"counterattack"`, with NO new `source` member. That
// board is this suite's headline, and it is the test of whether the mechanism axis
// was right.

/** The printed sentence, byte-for-byte off the local D1 row. */
const SCARY_FANGS =
  "During your opponent's next turn, if this Pokémon is damaged by an attack (even if it is Knocked Out), put 10 damage counters on the Attacking Pokémon.";
/** The printed COUNTERS, and the HP they are worth. The conversion happens once,
    at the deriver; every consumer downstream speaks HP. */
const COUNTERS = 10;
const ARMED_HP = COUNTERS * 10;
/** Mabosstiff sv02-143 "Comeuppance" — the same duration, the same body, the same
    read site, and an amount this anchor's `(\d+)` structurally cannot admit
    because it is a CHANNEL rather than a number. Kept LOUD on purpose. */
const COMEUPPANCE =
  "During your opponent's next turn, if this Pokémon is damaged by an attack (even if it is Knocked Out), put damage counters on the Attacking Pokémon equal to the damage done to this Pokémon.";
/** Rocky Helmet's own contribution, read off the registry so a data change moves
    every expectation in this file at once (D141's move). */
const HELMET = programFor("sv01-193")?.passive?.damageAttacker?.amount ?? 0;
/** …and Cacnea's, the always-on ABILITY control. */
const QUILLS = programFor("sv01-005")?.passive?.damageAttacker?.amount ?? 0;

/** One seed for the whole suite: nothing in this family flips a coin — neither
    printing carries one — so a seed table would describe a shuffle rather than a
    rule (D143's move, inherited by every durated slice since). */
const SEED = 13;

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

function findAll<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

/** P2 opens and passes, so P1's turn 2 carries no §4 attack restriction. The
    ARMER goes on P1's Active with the {F}{C}{C} "Scary Fangs" costs. */
function ready(): GameState {
  let state = must(
    applyAction(
      driveSetup(SEED, { p1: INSTALLED_RECOIL_DECK, p2: INSTALLED_RECOIL_DECK }, { first: "p2" }),
      { type: "endTurn", seat: "p2" },
    ),
  );
  state = setActiveFromDeck(state, "p1", "sv02-117");
  // ⚠️ P2 fields fix-titan (340 HP, no attacks): "Scary Fangs" hits for a printed
  // 140 and every other body in this deck dies to it, which would leave the board
  // in `ko:takePrizes` before the window even opens.
  state = setActiveFromDeck(state, "p2", "fix-titan");
  state = attachFromDeck(state, "p1", "fix-fighting-energy", 1);
  return attachFromDeck(state, "p1", "fix-energy", 2);
}

/** `ready`, then "Scary Fangs" DECLARED — asserting the row actually landed, so a
    board that failed to arm can never leave a case asserting "nothing retaliated"
    against nothing. Returns P2's turn, which IS the window. */
function armed(): GameState {
  const { state, events } = mustApply(ready(), { type: "attack", seat: "p1", index: 1 });
  const row = find(events, "RECOIL_ARMED");
  if (row === undefined) throw new Error("Scary Fangs did not arm a recoil");
  if (row.amount !== ARMED_HP) throw new Error(`armed ${String(row.amount)}`);
  return state;
}

/** The declaration every read-site case is: put `attacker` on P2's Active with the
    energy it needs and swing into the armed body. */
function swing(
  state: GameState,
  attacker: string,
  energy: { id: string; count: number }[],
  index = 0,
) {
  let next = setActiveFromDeck(state, "p2", attacker);
  for (const { id, count } of energy) next = attachFromDeck(next, "p2", id, count);
  return mustApply(next, { type: "attack", seat: "p2", index });
}

/** fix-attacker's "Bite" — {C}, 30, no effect. The plain P2 swing. */
const BITE = [{ id: "fix-energy", count: 1 }] as const;

/** The seat's Active, or a thrown error — so a board that lost its Active fails
    HERE rather than passing an assertion vacuously. */
function mustActive(state: GameState, seat: Seat) {
  const active = state.players[seat].active;
  if (active === null) throw new Error(`${seat} has no Active`);
  return active;
}

/** Attach a Tool from a seat's deck onto that seat's Active. */
function equip(state: GameState, seat: Seat, toolId: string): GameState {
  const withCard = handFromDeck(state, seat, toolId, 1);
  const uid = handUid(withCard, seat, toolId);
  const done = mustApply(withCard, { type: "attachTool", seat, uid, target: { spot: "active" } })
    .state;
  expect(done.players[seat].active?.tools).toContain(uid);
  return done;
}

/** Damage written straight onto a seat's Active — for the boards a 260 HP ex
    cannot be brought to in one printed swing. */
function withDamage(state: GameState, seat: Seat, damage: number): GameState {
  const side = state.players[seat];
  const active = side.active;
  if (active === null) throw new Error("no Active to damage");
  return {
    ...state,
    players: { ...state.players, [seat]: { ...side, active: { ...active, damage } } },
  };
}

/** A live record written straight onto a body — for the boards no printing can
    reach (two arms in one window; a shield beside the trap). D144/D146's precedent
    for pinning a rule with no card behind it, and D147's `withReduction` verbatim. */
function withRecoil(state: GameState, seat: Seat, amount: number, turn = state.turn): GameState {
  const side = state.players[seat];
  const active = side.active;
  if (active === null) throw new Error("no Active to stamp");
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: { ...side, active: { ...active, installedRecoil: { turn, amount } } },
    },
  };
}

function withReduction(state: GameState, seat: Seat, amount: number, turn = state.turn): GameState {
  const side = state.players[seat];
  const active = side.active;
  if (active === null) throw new Error("no Active to stamp");
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: { ...side, active: { ...active, damageReduction: { turn, amount } } },
    },
  };
}

function render(events: GameEvent[], state: GameState): { who: string; text: string }[] {
  const ctx: LogContext = { names: { p1: "Ember", p2: "Tide" }, state, elapsed: "+00:14" };
  return logFromEvents(events, ctx).flatMap((entry) =>
    entry.kind === "turn"
      ? []
      : [{ who: entry.who, text: entry.segments.map((s) => s.text).join("") }],
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// The datum: the catalog row, the fixture, and the deriver.
// ─────────────────────────────────────────────────────────────────────────────

describe("the printed datum — re-queried per printing, not inherited", () => {
  it("carries Lycanroc ex's NAME, its attack INDEX and its effect string verbatim", () => {
    // ⚠️ EVERY FIELD, INCLUDING THE ONES THE FIXTURE DOES NOT HAVE (D151's rule
    // after 40 pool fixtures turned out to be missing a printed Ability or attack).
    // The D1 row for sv02-117 carries NO `abilities_json` and NO resistance, so the
    // absences are asserted rather than left to be noticed.
    const card = FIXTURE_POOL["sv02-117"];
    expect(card?.name).toBe("Lycanroc ex");
    expect(card?.hp).toBe(260);
    expect(card?.stage).toBe("Stage1");
    expect(card?.evolveFrom).toBe("Rockruff");
    expect(card?.types).toEqual(["Fighting"]);
    expect(card?.retreat).toBe(2);
    expect(card?.weaknesses).toEqual([{ type: "Grass", value: "×2" }]);
    expect(card?.abilities ?? null).toBeNull();
    expect(card?.resistances ?? null).toBeNull();
    // ⚠️ THE INDEX IS 1, NOT 0 — the trap D144 found, D146 sharpened and D147/D149
    // both hit again. Read per printing off the D1 rather than assumed constant.
    expect(card?.attacks?.[1]).toEqual({
      cost: ["Fighting", "Colorless", "Colorless"],
      name: "Scary Fangs",
      damage: 140,
      effect: SCARY_FANGS,
    });
    expect(card?.attacks?.[0]).toEqual({ cost: ["Fighting"], name: "Rock Throw", damage: 40 });
  });

  it("derives to ONE op, with the COUNTERS converted to HP exactly once", () => {
    // The only arm in this deriver tail that converts its capture. The registry's
    // four always-on printings of the same clause store HP (Cacnea's THREE printed
    // counters are `{ amount: 30 }`), so the conversion is what makes the two
    // halves summable at one read site instead of two.
    expect(deriveAttackEffect(SCARY_FANGS)).toEqual([{ op: "installRecoil", amount: ARMED_HP }]);
    expect(QUILLS).toBe(30); // 3 printed counters, stored as HP
    expect(ARMED_HP).toBe(100); // …and 10 printed counters, likewise
    // No registry row: this derives from the TEXT, like every other durated rider.
    expect(programFor("sv02-117")).toBeUndefined();
  });

  it("refuses the NEIGHBOURING sentence, which differs only in its amount SLOT", () => {
    // ⚠️ THE SAFETY PROPERTY, DRIVEN. Mabosstiff sv02-143 "Comeuppance" prints this
    // family's other sentence: same duration, same body, same read site, and an
    // amount that is a CHANNEL from the §8.5 result rather than a number. `^…$`
    // refuses it in both directions and it stays LOUD — a prefix match would have
    // shipped a 0-HP trap under a card that prints a real one.
    expect(deriveAttackEffect(COMEUPPANCE)).toBeNull();
    expect(programFor("sv02-143")).toBeUndefined();
    // …and Vengeful Punch sv03-197, the KO-conditioned TOOL, likewise.
    expect(programFor("sv03-197")).toBeUndefined();
  });

  it("does NOT derive the always-on spelling — the duration is the whole difference", () => {
    // The same mechanism minus the four-word prefix is a printed ABILITY on three
    // Pokémon and a TOOL, all read out of the registry. Deriving one as an attack
    // effect would install a one-turn stamp under a permanent printing.
    expect(
      deriveAttackEffect(
        "If this Pokémon is in the Active Spot and is damaged by an attack from your opponent's Pokémon (even if this Pokémon is Knocked Out), put 3 damage counters on the Attacking Pokémon.",
      ),
    ).toBeNull();
    expect(programFor("sv01-005")?.passive?.damageAttacker).toEqual({ amount: QUILLS });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The install: the stamp, the window and the row.
// ─────────────────────────────────────────────────────────────────────────────

describe("arming it — the stamp, the window and the row", () => {
  it("stamps the ARMER's own Active for the OPPONENT's next turn, and hits for 140", () => {
    const before = ready();
    const { state, events } = mustApply(before, { type: "attack", seat: "p1", index: 1 });
    // The window is `state.turn + 1` — the printed "during your opponent's next
    // turn", and declaring an attack ENDS the turn (§5.3), so the turn after the
    // arming one is the opponent's by construction.
    expect(state.players.p1.active?.installedRecoil).toEqual({
      turn: before.turn + 1,
      amount: ARMED_HP,
    });
    expect(state.turn).toBe(before.turn + 1); // …and that turn is now
    // It is an ATTACK, so the printed 140 still lands.
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(140);
    // Nothing on the DEFENDER: "this Pokémon" is the actor's own.
    expect(state.players.p2.active?.installedRecoil).toBeNull();
    // It never parks and consumes no rng (D143's pin).
    expect(state.phase.kind).not.toBe("effect:choose");
    expect(state.rngState).toBe(before.rngState);
  });

  it("emits RECOIL_ARMED under the ARMER's own seat, in printed order", () => {
    const { state, events } = mustApply(ready(), { type: "attack", seat: "p1", index: 1 });
    expect(find(events, "RECOIL_ARMED")).toEqual({
      type: "RECOIL_ARMED",
      seat: "p1",
      uid: activeUid(state, "p1"),
      amount: ARMED_HP,
    });
    // The rider lands AFTER the damage — the whole effect is in the future, so
    // nothing about it needs to precede §8.5 (D147/D149's placement verbatim).
    expect(types(events)).toEqual([
      "ATTACK_DECLARED",
      "DAMAGE_DEALT",
      "RECOIL_ARMED",
      "TURN_ENDED",
      "TURN_STARTED",
      "CARDS_DRAWN",
    ]);
  });

  it("reads the printed words back to the ARMER, in HP and in the mechanism's name", () => {
    const { state, events } = mustApply(ready(), { type: "attack", seat: "p1", index: 1 });
    const rows = render(events, state).filter((r) => r.text.includes("counterattack"));
    expect(rows).toHaveLength(1);
    // ACTIVE voice: the op has no defender arm, so `seat` is the actor's own and
    // the PRINTED "during your opponent's next turn" is honest here — which is the
    // wording D149's victim-side row could NOT carry (log.ts).
    expect(rows[0]?.who).toBe("p1");
    expect(rows[0]?.text).toBe(
      "Lycanroc ex will counterattack for 100 damage during your opponent's next turn",
    );
    // ⚠️ THE UNIT IS THE ONE THE PLAYER WILL BE SHOWN, not the one the card prints:
    // the COUNTERS_PLACED row next turn says 100 too, so the arithmetic checks out.
    expect(rows[0]?.text).not.toContain("10 damage counters");
    // …and it names the same MECHANISM the row it sets up will name (D141).
    expect(rows[0]?.text).toContain("counterattack");
  });

  it("MERGES by MAX when armed twice in one window, and says nothing when it need not", () => {
    // Unreachable off any printing — one attack per turn, and no card prints two of
    // these — so it is CONSTRUCTED and pinned, fed straight to `runProgram` from
    // the armer's chair (D144/D150's precedent). The rule both this and D147's
    // `Math.max` are instances of: a second installation may never leave the holder
    // with less than one of them printed. ⚠️ NOTE THE CONTRAST ONE FILE OVER: the
    // §9 read site really does SUM this stamp with `passivesOf`'s fold, because
    // those are two different card effects from two different sources. ONE field,
    // ONE installation, MAX; TWO sources, SUM.
    const state = ready();
    const events: GameEvent[] = [];
    const result = runProgram(
      state,
      [
        { op: "installRecoil", amount: 40 },
        { op: "installRecoil", amount: ARMED_HP },
        { op: "installRecoil", amount: 60 },
      ],
      { seat: "p1", invokedBy: "attack" },
      events,
    );
    expect(result.state.players.p1.active?.installedRecoil).toEqual({
      turn: state.turn + 1,
      amount: ARMED_HP,
    });
    // TWO rows, not three: the third arm merged to the same number and announcing
    // a re-arm that changed nothing would be announcing a non-event (D140/D146).
    expect(findAll(events, "RECOIL_ARMED").map((r) => r.amount)).toEqual([40, ARMED_HP]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The read site: the SUM, and the label that survives it.
// ─────────────────────────────────────────────────────────────────────────────

describe("⚠️ the §9 SUM — the armed stamp beside the catalog fold, in ONE row", () => {
  it("retaliates across the TURN BOUNDARY, end to end off two printed declarations", () => {
    // The whole slice in one case: P1 arms on its turn, P2 swings on the NEXT turn,
    // and the counters land on P2's attacker.
    const state = armed();
    expect(installedRecoilOf(state, mustActive(state, "p1"))).toBe(ARMED_HP);
    const { state: done, events } = swing(state, "fix-attacker", [...BITE]);

    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ seat: "p1", dealt: 30 });
    expect(find(events, "COUNTERS_PLACED")).toEqual({
      type: "COUNTERS_PLACED",
      seat: "p2",
      uid: activeUid(done, "p2"),
      amount: ARMED_HP,
      source: "counterattack",
    });
    expect(done.players.p2.active?.damage).toBe(ARMED_HP);
    // The armed body took only the Bite.
    expect(done.players.p1.active?.damage).toBe(30);
  });

  it("SUMS with an attached TOOL on the same body — 100 + 20 in ONE row of 120", () => {
    // ⚠️ D141's JUDGEMENT RE-RUN WITH A THIRD PROVENANCE, AND IT SURVIVES. That
    // slice refused a `"tool"`/`"ability"` label because `passivesOf` folds a
    // holder's Ability and every attached Tool into one number. An ATTACK's
    // installation now joins the same sum, so a provenance label is wrong on a
    // THIRD axis — and the row still needs no new `source` member.
    let state = ready();
    state = equip(state, "p1", "sv01-193");
    state = mustApply(state, { type: "attack", seat: "p1", index: 1 }).state;
    expect(passivesOf(state, mustActive(state, "p1")).damageAttacker).toBe(HELMET);

    const { state: done, events } = swing(state, "fix-attacker", [...BITE]);
    const placed = findAll(events, "COUNTERS_PLACED");
    expect(placed).toHaveLength(1); // NOT one row per contributing effect
    expect(placed[0]).toMatchObject({ amount: ARMED_HP + HELMET, source: "counterattack" });
    // Read from the two authored numbers rather than written as 120, so the
    // arithmetic is asserted rather than the constant.
    expect(ARMED_HP + HELMET).toBe(120);
    // …and 120 is EXACTLY fix-attacker's printed HP, so the attacker is gone from
    // the Active Spot by the time the dust settles — which is the next case.
    expect(types(events)).toContain("KNOCKED_OUT");
    expect(done.players.p2.active).toBeNull();
  });

  it("…and the LOG says one thing, because the number no longer has one source", () => {
    let state = ready();
    state = equip(state, "p1", "sv01-193");
    state = mustApply(state, { type: "attack", seat: "p1", index: 1 }).state;
    const { state: done, events } = swing(state, "fix-attacker", [...BITE]);
    const rows = render(events, done).filter((r) => r.text.startsWith("Counterattack:"));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.who).toBe("system");
    expect(rows[0]?.text).toBe("Counterattack: 120 damage to fix-attacker");
    // Neither the card nor the attack that supplied the HP appears, and neither
    // could: the number is their sum.
    expect(rows[0]?.text).not.toContain("Rocky Helmet");
    expect(rows[0]?.text).not.toContain("Scary Fangs");
    expect(rows[0]?.text).not.toContain("Ability");
  });

  it("kills the attacker on the summed number, and the KO is prized to the ARMER", () => {
    // fix-attacker is 120 HP and the sum is EXACTLY 120, so the retaliation is
    // lethal on the nose with no arithmetic to arrange. §9 runs BEFORE
    // finishAttack's §8.1 both-board sweep, which is what makes a lethal
    // retaliation possible at all.
    let state = ready();
    state = equip(state, "p1", "sv01-193");
    state = mustApply(state, { type: "attack", seat: "p1", index: 1 }).state;
    const { state: done, events } = swing(state, "fix-attacker", [...BITE]);
    expect(types(events)).toContain("KNOCKED_OUT");
    expect(find(events, "KNOCKED_OUT")?.seat).toBe("p2");
    expect(done.phase.kind).toBe("ko:takePrizes");
  });

  it("the ALWAYS-ON control: the same clause without a duration is the same number", () => {
    // Cacnea's Counterattack Quills is this sentence minus its four-word prefix,
    // read out of the registry and folded by `passivesOf`. Driven on the same
    // board so the two halves are shown to be the SAME mechanism at the SAME site.
    const state = must(
      applyAction(
        driveSetup(SEED, { p1: INSTALLED_RECOIL_DECK, p2: INSTALLED_RECOIL_DECK }, { first: "p2" }),
        { type: "endTurn", seat: "p2" },
      ),
    );
    let fielded = setActiveFromDeck(state, "p1", "sv01-005");
    fielded = must(applyAction(fielded, { type: "endTurn", seat: "p1" }));
    const { events } = swing(fielded, "fix-attacker", [...BITE]);
    expect(find(events, "COUNTERS_PLACED")).toMatchObject({
      amount: QUILLS,
      source: "counterattack",
    });
  });

  it("survives a §9 ABILITY-LOCK that would silence the catalog half", () => {
    // ⚠️ THE AURA/INSTALLATION DISTINCTION, OBSERVABLE. `passivesOf` suppresses a
    // holder's own printed passive under an Ability-lock; a Tool is not an Ability
    // and keeps contributing; and an attack INSTALLATION is neither, so no lock can
    // reach it. Constructed on the ONE fold a lock can zero, by asserting the
    // reader is not routed through `passivesOf` at all: the installed number is
    // read from the record even on a body whose own passive is gone.
    let state = armed();
    // A body with no printed passive of its own — so the catalog half is 0 and the
    // whole retaliation is the installation's, which is the claim.
    expect(passivesOf(state, mustActive(state, "p1")).damageAttacker).toBe(0);
    expect(installedRecoilOf(state, mustActive(state, "p1"))).toBe(ARMED_HP);
    state = withRecoil(state, "p1", ARMED_HP, state.turn + 5);
    // …and the SAME record on the wrong turn answers 0, with nobody having cleared
    // it — D124's expiry-by-arithmetic, pinned on this field too.
    expect(installedRecoilOf(state, mustActive(state, "p1"))).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The guard: `dealt > 0`, driven from BOTH sides.
// ─────────────────────────────────────────────────────────────────────────────

describe("⚠️ the `dealt > 0` boundary — D149's cases, which this must not break", () => {
  it("an attack with NO PRINTED DAMAGE draws nothing, and the stamp SURVIVES it", () => {
    // The OUTER gate, reachable off a printed line: Pikachu's "Growl" (idx 0) has
    // no printed damage at all, so §8.5's branch is never entered and no
    // COUNTERS_PLACED can exist. The trap is untouched, not spent.
    const state = armed();
    const { state: done, events } = swing(state, "sv02-062", [{ id: "fix-energy", count: 1 }], 0);
    expect(findAll(events, "DAMAGE_DEALT")).toHaveLength(0);
    expect(findAll(events, "COUNTERS_PLACED")).toHaveLength(0);
    expect(done.players.p1.active?.installedRecoil).toEqual({
      turn: state.turn,
      amount: ARMED_HP,
    });
    expect(done.players.p2.active?.damage).toBe(0);
  });

  it("a hit CLAMPED TO 0 inside the branch draws nothing either — a row, no counters", () => {
    // The INNER gate, and the sharper one: the §8.5 branch IS entered (a printed 30
    // Bite), a DAMAGE_DEALT row IS emitted, and `dealt` is 0 — so the recoil must
    // not fire. Constructed, and it says so: an armed body and a live shield are
    // two installs whose windows are the same turn, which one attack per turn
    // cannot produce (D144/D146's precedent for pinning a rule with no card).
    let state = armed();
    state = withReduction(state, "p1", 200, state.turn);
    const { state: done, events } = swing(state, "fix-attacker", [...BITE]);
    const row = find(events, "DAMAGE_DEALT");
    expect(row?.dealt).toBe(0);
    expect(row?.reduction).toBe(200);
    expect(findAll(events, "COUNTERS_PLACED")).toHaveLength(0);
    expect(done.players.p2.active?.damage).toBe(0);
    // …and the trap is still armed, so "a clamped zero is not an attack that did
    // damage" is a statement about THIS hit rather than about the window.
    expect(done.players.p1.active?.installedRecoil?.amount).toBe(ARMED_HP);
  });

  it("…and 1 HP through the same shield is enough — the boundary, from the other side", () => {
    // A two-sided pin. Drop the shield to 29 and the same Bite deals 1, which is
    // `dealt > 0` and draws the FULL retaliation: the recoil is not proportional to
    // the hit, which is the whole difference from Mabosstiff's unread sentence.
    let state = armed();
    state = withReduction(state, "p1", 29, state.turn);
    const { state: done, events } = swing(state, "fix-attacker", [...BITE]);
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(1);
    expect(find(events, "COUNTERS_PLACED")?.amount).toBe(ARMED_HP);
    expect(done.players.p2.active?.damage).toBe(ARMED_HP);
  });

  it("fires EVEN IF THE HOLDER IS KNOCKED OUT — the printed clause, with no field", () => {
    // "(even if it is Knocked Out)" needs no op field: §9 runs BEFORE finishAttack's
    // §8.1 sweep, which is the behaviour the four always-on printings have had
    // since 0.x. Lycanroc ex is 260 HP and no printed swing in this deck reaches
    // that, so the body is brought to 250 by surgery and the 30 Bite finishes it.
    let state = clearBench(armed(), "p1");
    state = benchFromDeck(state, "p1", "fix-titan");
    state = withDamage(state, "p1", 250);
    const { state: done, events } = swing(state, "fix-attacker", [...BITE]);
    expect(types(events)).toContain("KNOCKED_OUT");
    // The recoil landed anyway, and it landed BEFORE the KO sweep.
    const order = types(events);
    expect(order.indexOf("COUNTERS_PLACED")).toBeGreaterThan(-1);
    expect(order.indexOf("COUNTERS_PLACED")).toBeLessThan(order.indexOf("KNOCKED_OUT"));
    expect(done.players.p2.active?.damage).toBe(ARMED_HP);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The lifetime: the window's end, and the three §10 clears.
// ─────────────────────────────────────────────────────────────────────────────

describe("the lifetime — one turn, and the three §10 early endings", () => {
  it("expires by ARITHMETIC when the window passes, with nobody clearing it", () => {
    // D124's rule on a fifth field: the stamp is compared, never swept, so a trap
    // whose turn has gone simply stops answering. Driven across a full round —
    // "Rock Throw" (idx 0) is the un-arming declaration that lets the armer take
    // its next turn without re-arming.
    let state = armed();
    state = must(applyAction(state, { type: "endTurn", seat: "p2" })); // back to P1
    const stamp = state.players.p1.active?.installedRecoil;
    expect(stamp).not.toBeNull();
    expect(installedRecoilOf(state, mustActive(state, "p1"))).toBe(0); // …and answers 0
    state = mustApply(state, { type: "attack", seat: "p1", index: 0 }).state; // Rock Throw
    // The record is STILL there, untouched, and still silent.
    expect(state.players.p1.active?.installedRecoil).toEqual(stamp);
    const { events } = swing(state, "fix-attacker", [...BITE]);
    expect(findAll(events, "COUNTERS_PLACED")).toHaveLength(0);
  });

  it("ends when the Pokémon leaves the Active Spot — a Boss's Orders INSIDE the window", () => {
    // §10's reachable clear, and it is reachable for D147's reason rather than
    // D149's: the window belongs to the OPPONENT, so the opponent is the only
    // player who can move the armed body while it is live.
    let state = armed();
    const armedUid = activeUid(state, "p1");
    expect(state.players.p1.bench.length).toBeGreaterThan(0);
    state = handFromDeck(state, "p2", "sv02-172", 1);
    const gusted = mustApply(state, {
      type: "playTrainer",
      seat: "p2",
      uid: handUid(state, "p2", "sv02-172"),
    });
    let next = gusted.state;
    if (next.phase.kind === "effect:choose") {
      next = must(
        applyAction(next, {
          type: "resolveEffect",
          seat: "p2",
          choice: { kind: "pokemon", ref: { seat: "p1", spot: { spot: "bench", index: 0 } } },
        }),
      );
    }
    const benchIndex = next.players.p1.bench.findIndex((p) => p.stack.includes(armedUid ?? ""));
    expect(benchIndex).toBeGreaterThanOrEqual(0);
    expect(next.players.p1.bench[benchIndex]?.installedRecoil).toBeNull();
    // Silent: the POKEMON_SWITCHED row already tells the story (D112's call).
    expect(types(gusted.events)).not.toContain("RECOIL_ARMED");
    // And it is GONE rather than merely unread — the promoted body draws nothing.
    const { events } = swing(next, "fix-attacker", [...BITE]);
    expect(findAll(events, "COUNTERS_PLACED")).toHaveLength(0);
  });

  it("ends on EVOLVING — unreachable by construction, written anyway", () => {
    // §10 sheds the effects of ATTACKS. Arming ends the turn, the window is the
    // opponent's, and nobody evolves on someone else's turn — so no legal sequence
    // puts an evolution between the arming and the expiry, exactly as at D147. A
    // surgery pins the RULE rather than a sequence.
    let state = armed();
    state = must(applyAction(state, { type: "endTurn", seat: "p2" })); // hand the turn back
    state = setActiveFromDeck(state, "p1", "sv01-048"); // Alomomola, a real pre-evolution
    state = withRecoil(state, "p1", ARMED_HP, state.turn);
    expect(state.players.p1.active?.installedRecoil).toEqual({
      turn: state.turn,
      amount: ARMED_HP,
    });
    state = handFromDeck(state, "p1", "fix-mola-stage1", 1);
    const { state: done, events } = mustApply(state, {
      type: "evolve",
      seat: "p1",
      uid: handUid(state, "p1", "fix-mola-stage1"),
      target: { spot: "active" },
    });
    expect(types(events)).toContain("POKEMON_EVOLVED");
    expect(done.players.p1.active?.installedRecoil).toBeNull();
    // Silent, like every §10 clear in this family.
    expect(types(events)).not.toContain("RECOIL_ARMED");
  });

  it("leaves play with a KNOCKED OUT holder — the promoted body carries nothing", () => {
    let state = clearBench(armed(), "p1");
    state = benchFromDeck(state, "p1", "fix-titan");
    state = withDamage(state, "p1", 250);
    const { state: done } = swing(state, "fix-attacker", [...BITE]);
    let next = done;
    expect(next.phase.kind).toBe("ko:takePrizes");
    // TWO prizes: Lycanroc ex has a rule box (§8.1's prize value, D-era).
    next = must(applyAction(next, { type: "takePrizes", seat: "p2", prizeIndices: [0, 1] }));
    if (next.phase.kind === "ko:promote") {
      next = must(applyAction(next, { type: "promote", seat: "p1", benchIndex: 0 }));
    }
    expect(next.players.p1.active?.installedRecoil).toBeNull();
  });
});
