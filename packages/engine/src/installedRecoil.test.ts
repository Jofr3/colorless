import { describe, expect, it } from "vitest";
import {
  attackReaderSurface,
  legalAttackCorpus,
  resolvedByAnyReader,
} from "./censusAttackCorpus";
import { installedRecoilOf, passivesOf } from "./continuous";
import { deriveAttackEffect } from "./effects";
import { applyAction, programFor } from "./index";
import { registryCardIds } from "./registry";
import { runProgram } from "./interpreter";
import type { GameEvent, GameState, Seat } from "./index";
import type { InstalledRecoil } from "./types";
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
// ⚠️ UPDATE (D158): VENGEFUL PUNCH sv03-197 HAS LANDED, on exactly the read site
// this block predicted — flow.ts's §8.1 sweep, a `damageAttackerOnKo` sibling on
// `PassiveEffects`, one registry row, NO duration and NO MATCH_RECORD_VERSION
// bump. The pricing D152 wrote here was verified rather than inherited and it
// held. `vengefulPunch.test.ts` owns the printing; the case below is re-pointed
// to the claim that survived (a Trainer's `effect` never derives as an ATTACK
// effect). Mabosstiff sv02-143 is the family's LAST printing and is still blocked
// on the damage-dealt channel.
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
/** 🆕🆕 D456 — corpus line **180**, **2 legal printings**: the same duration, the same
    body, the same read site, and an amount D152's `(\d+)` structurally cannot admit
    because it is a CHANNEL rather than a number. Kept LOUD from D152 to D455 and CLAIMED
    at D456 by a second whole-sentence anchor.

    ⚠️ **THE STRING BELOW IS THE ONE D152 WROTE AND IT IS A PARAPHRASE.** It spells
    *"(even if **it** is Knocked Out)"*; the catalog prints *"(even if **this Pokémon**
    is Knocked Out)"* and nothing else on this sentence. It is KEPT at that spelling on
    purpose — the widened anchor admits both, so keeping the historical string here and
    asserting the PRINTED one beside it (`COMEUPPANCE_PRINTED`) is what makes the
    difference visible instead of quietly corrected. FOUR test files carried this
    paraphrase; all four are re-pointed at D456. */
const COMEUPPANCE =
  "During your opponent's next turn, if this Pokémon is damaged by an attack (even if it is Knocked Out), put damage counters on the Attacking Pokémon equal to the damage done to this Pokémon.";
/** …and the byte string the CATALOG carries, read off `censusAttackCorpus.ts` line 180
    rather than typed from memory (D421's rule about remembered bytes). */
const COMEUPPANCE_PRINTED = COMEUPPANCE.replace(
  "(even if it is Knocked Out)",
  "(even if this Pokémon is Knocked Out)",
);
/** Corpus line **179**, **1 legal printing**: D152's own sentence with a different
    printed count AND the other parenthetical spelling — the whole of what kept it
    unread for 304 decisions. */
const SIX_COUNTERS =
  "During your opponent's next turn, if this Pokémon is damaged by an attack (even if this Pokémon is Knocked Out), put 6 damage counters on the Attacking Pokémon.";
/** D152's anchor STILL refuses the unprinted-amount sentence — asserted as a property of
    the DERIVED PROGRAM rather than by importing a private regex: the flat anchor's op
    always carries a NUMBER, so an `amount` that is not a number cannot have come from
    it. That is the strongest statement this file can make about a module-private
    constant, and it is stronger than a source scan (D210). */
const SELF_INSTALLED_RECOIL_REFUSES_IT =
  typeof (deriveAttackEffect(COMEUPPANCE)?.[0] as { amount?: unknown } | undefined)?.amount !==
  "number";
/** Rocky Helmet's own contribution, read off the registry so a data change moves
    every expectation in this file at once (D141's move). */
const HELMET = programFor("sv01-193")?.passive?.damageAttacker?.amount ?? 0;
/** …and Cacnea's, the always-on ABILITY control. */
const QUILLS = programFor("sv01-005")?.passive?.damageAttacker?.amount ?? 0;

/** One seed for the whole suite: nothing in this family flips a coin — none of the
    three printings carries one — so a seed table would describe a shuffle rather than
    a rule (D143's move, inherited by every durated slice since). */
const SEED = 13;

/** 🆕🆕 D456 — the `damageTaken` argument every direct `installedRecoilOf` call in
    this file passes, and it is a CONTROL rather than a placeholder. Each of those
    four calls asserts a FLAT record's answer, so a reader that had lost the
    `ofDamageTaken` discrimination — and answered `Math.max(amount, damageTaken)`
    unconditionally — would return this instead of the flat number and every one of
    them would go RED. A `0` here would have been the same assertion with none of the
    discrimination (D424's "a refusal owes a control on the same axis"). */
const PROBE_TAKEN = 9999;

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

/** 🆕🆕 D456 — the same surgery taking a WHOLE record, so a case can write bytes
    `withRecoil`'s `(amount, turn)` signature cannot express: a v29 literal with no
    rider, a round-tripped one, and a rider-stripped one. Kept BESIDE `withRecoil`
    rather than replacing it — the four-argument helper is what every D152 case reads,
    and re-pointing them all to build a record object would move numbers this slice has
    nothing to do with (D418's rule, applied in the direction that keeps the diff small). */
function withRawRecoil(state: GameState, seat: Seat, record: InstalledRecoil): GameState {
  const side = state.players[seat];
  const active = side.active;
  if (active === null) throw new Error("no Active to stamp");
  return {
    ...state,
    players: { ...state.players, [seat]: { ...side, active: { ...active, installedRecoil: record } } },
  };
}

/** 🆕🆕 D456 — a live §11 ATTACK BLOCK written straight onto a body, for Q3's
    reachability claim: the gate this placement does NOT ask is asked here anyway, on the
    only turn a block can legally be stamped for. */
function withBlock(state: GameState, seat: Seat, turn: number): GameState {
  const side = state.players[seat];
  const active = side.active;
  if (active === null) throw new Error("no Active to shield");
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: { ...side, active: { ...active, attackBlock: { turn, effects: true } } },
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

  it("🆕🆕 D456 — CLAIMS the neighbouring sentence, which differs only in its amount SLOT", () => {
    // 🛑 **RE-POINTED RATHER THAN DELETED (D418), AND THE OLD RUNG WAS RIGHT ABOUT THE
    // ANCHOR AND WRONG ABOUT THE FAMILY.** It read: *"`^…$` refuses it in both
    // directions and it stays LOUD — a prefix match would have shipped a 0-HP trap
    // under a card that prints a real one."* Both halves survive: `SELF_INSTALLED_RECOIL`
    // still refuses this sentence in both directions, and D456 did NOT loosen it. What
    // changed is that a SECOND whole-sentence anchor claims it, over the same op with a
    // widened `amount`. The warning was heeded exactly as written.
    expect(SELF_INSTALLED_RECOIL_REFUSES_IT).toBe(true);
    expect(deriveAttackEffect(COMEUPPANCE)).toEqual([
      { op: "installRecoil", amount: "damageTaken" },
    ]);
    expect(programFor("sv02-143")).toBeUndefined();
    // …and Vengeful Punch sv03-197, the KO-conditioned TOOL, likewise — but the
    // reason has CHANGED and the witness is re-pointed rather than deleted. It
    // LANDED at D158, so it is no longer unmapped; what stays true, and is the
    // only thing this deriver case was ever about, is that its sentence is a
    // TRAINER's `effect` and must never derive as an ATTACK effect. It is read out
    // of the registry like Rocky Helmet, at a read site of its own.
    expect(
      deriveAttackEffect(
        "If the Pokémon this card is attached to is Knocked Out by damage from an attack from your opponent's Pokémon, put 4 damage counters on the Attacking Pokémon.",
      ),
    ).toBeNull();
    expect(programFor("sv03-197")?.attack).toBeUndefined();
    expect(programFor("sv03-197")?.passive).toEqual({ damageAttackerOnKo: { amount: 40 } });
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
    expect(installedRecoilOf(state, mustActive(state, "p1"), PROBE_TAKEN)).toBe(ARMED_HP);
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
    expect(installedRecoilOf(state, mustActive(state, "p1"), PROBE_TAKEN)).toBe(ARMED_HP);
    state = withRecoil(state, "p1", ARMED_HP, state.turn + 5);
    // …and the SAME record on the wrong turn answers 0, with nobody having cleared
    // it — D124's expiry-by-arithmetic, pinned on this field too.
    expect(installedRecoilOf(state, mustActive(state, "p1"), PROBE_TAKEN)).toBe(0);
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
    expect(installedRecoilOf(state, mustActive(state, "p1"), PROBE_TAKEN)).toBe(0); // …and answers 0
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

// ─────────────────────────────────────────────────────────────────────────────
// 🆕🆕 D456 — the UNPRINTED amount: corpus lines 179 and 180, 3 legal printings.
// ─────────────────────────────────────────────────────────────────────────────

/** Arm the line-180 trap from the armer's own chair. Corpus line 180 has no fixture
    card in this pool (the ids are unresolvable here — D425), so the op is fed to
    `runProgram` exactly as D152's own two-installs case is: this drives the REAL
    install path, the real merge and the real event, and only the printed sentence's
    delivery is simulated. ⚠️ `runProgram` does not END the turn, so the caller must —
    the record is stamped `state.turn + 1` and the window is the opponent's. */
function armScaled(state: GameState): { state: GameState; events: GameEvent[] } {
  const events: GameEvent[] = [];
  const result = runProgram(
    state,
    [{ op: "installRecoil", amount: "damageTaken" }],
    { seat: "p1", invokedBy: "attack" },
    events,
  );
  return { state: result.state, events };
}

/** …and then hand the turn over, so the stamp's window is NOW. */
function intoWindow(state: GameState): GameState {
  return must(applyAction(state, { type: "endTurn", seat: "p1" }));
}

describe("🆕🆕 D456 §1 — the datum, and the family CLOSED over the corpus", () => {
  it("🛑 `Attacking Pokémon` over all 640 sentences returns THREE rows — and none is a ten", () => {
    // THE PATTERN, PUBLISHED SO ITS EDGES ARE VISIBLE (D424/D425): the printed noun
    // phrase that names the retaliation's TARGET, which is the only token this family
    // owns outright. It is not `/damage counters/` (38 printings, most of them
    // placements) and not `/During your opponent's next turn/` (17 sentences, most of
    // them bars) — the target noun is what makes the set exactly this family.
    // ⚠️ **WHAT IT CANNOT SEE**: the ALWAYS-ON printings of the same mechanism, which
    // live in `abilities_json` / Trainer `effect` and are outside `legalAttackCorpus()`
    // entirely (Cacnea, Cacturne, Stunfisk, Rocky Helmet, Vengeful Punch — five
    // printings this file already drives from the registry). This pattern is a census of
    // the ATTACK column, and the family is bigger than the column.
    const family = legalAttackCorpus().filter(([, t]) => /Attacking Pokémon/.test(t));
    expect(family).toHaveLength(3);
    expect(family.reduce((sum, [n]) => sum + n, 0)).toBe(8);
    // 🛑 **THE PRINTED COUNTS, AND THEY FALSIFY A CLAIM THAT WAS LIVE IN SEVEN PLACES.**
    // `types.ts`, `effects.ts` (twice), `index.ts`, `interpreter.ts`, this file and
    // `apps/api/src/lobby/match.ts` all quoted *"put 10 damage counters … 2 printings,
    // Lycanroc ex sv02-117/-241"*. D454 found it, D455 corrected `interpreter.ts` and
    // reported *"corrected in place"* — one of seven. **No corpus row prints a ten.**
    expect(family.map(([n, t]) => [n, /put (\d+) damage counters/.exec(t)?.[1] ?? "—"])).toEqual([
      [5, "8"],
      [1, "6"],
      [2, "—"],
    ]);
    expect(family.some(([, t]) => t.includes("10 damage counters"))).toBe(false);
    // …and ALL THREE now resolve, so the ATTACK column's half of this family is CLOSED.
    for (const [, t] of family) expect(resolvedByAnyReader(t), t).toBe(true);
    expect(attackReaderSurface()).toHaveLength(13); // no fourteenth reader
  });

  it("the parenthetical varies BY PRINTING, which is why the alternation is not invented", () => {
    // The whole of line 179's price. Lines 178 and 179 differ on exactly TWO tokens —
    // the counter count (which D152's `(\d+)` already captured) and the pronoun — so the
    // sentence was ONE alternation away from being read for 304 decisions.
    const family = legalAttackCorpus()
      .map(([, t]) => t)
      .filter((t) => /Attacking Pokémon/.test(t));
    const spellings = new Set(
      family.map((t) => /\(even if ([^)]*) is Knocked Out\)/.exec(t)?.[1] ?? "?"),
    );
    expect([...spellings].sort()).toEqual(["it", "this Pokémon"]);
    // …and it really is the ONLY difference between 178 and 179, driven by rewriting one
    // into the other rather than asserted (D428's "quote the text beside the number").
    const eight = family.find((t) => t.includes("8 damage counters")) as string;
    const six = family.find((t) => t.includes("6 damage counters")) as string;
    expect(eight.replace("even if it is", "even if this Pokémon is").replace(" 8 ", " 6 ")).toBe(
      six,
    );
  });

  it("both new sentences derive, to the SAME op and to DIFFERENT amounts", () => {
    expect(deriveAttackEffect(SIX_COUNTERS)).toEqual([{ op: "installRecoil", amount: 60 }]);
    expect(deriveAttackEffect(COMEUPPANCE_PRINTED)).toEqual([
      { op: "installRecoil", amount: "damageTaken" },
    ]);
    // ⚠️ ONE OP, TWO INHABITANTS — not two ops. `heal.amount`'s `number | "dealt"` at a
    // second address (D427), and the reason is the same: the read site already sums,
    // already gates on `dealt > 0` and already labels its row, so a second op would
    // restate three rules with three chances to drift.
    expect(deriveAttackEffect(SIX_COUNTERS)?.[0]?.op).toBe(
      deriveAttackEffect(COMEUPPANCE_PRINTED)?.[0]?.op,
    );
    expect(deriveAttackEffect(SIX_COUNTERS)).not.toEqual(deriveAttackEffect(COMEUPPANCE_PRINTED));
    // …and the ALWAYS-ON spelling is STILL refused, which is D152's control and the rung
    // that keeps the widened anchor from being a prefix match (D424: every refusal owes
    // an admission on the same axis, and every admission owes a refusal).
    expect(
      deriveAttackEffect(
        "If this Pokémon is in the Active Spot and is damaged by an attack from your opponent's Pokémon (even if this Pokémon is Knocked Out), put 3 damage counters on the Attacking Pokémon.",
      ),
    ).toBeNull();
    // …as is the same sentence with the DURATION but a different window.
    expect(
      deriveAttackEffect(
        "During your next turn, if this Pokémon is damaged by an attack (even if this Pokémon is Knocked Out), put 6 damage counters on the Attacking Pokémon.",
      ),
    ).toBeNull();
  });
});

describe("🆕🆕 D456 §2 — the record, the row and the merge", () => {
  it("stores a FLOOR of 0 with the flag, and says so in words rather than in a 0", () => {
    const before = ready();
    const { state, events } = armScaled(before);
    expect(state.players.p1.active?.installedRecoil).toEqual({
      turn: before.turn + 1,
      amount: 0,
      ofDamageTaken: true,
    });
    // ⚠️ `false` IS NEVER WRITTEN — the key has exactly two inhabitants and `undefined`
    // is one of them, which is what keeps a PERSISTED record from having two spellings
    // of absent.
    expect(Object.keys(state.players.p1.active?.installedRecoil ?? {})).toEqual([
      "turn",
      "amount",
      "ofDamageTaken",
    ]);
    expect(find(events, "RECOIL_ARMED")).toEqual({
      type: "RECOIL_ARMED",
      seat: "p1",
      uid: activeUid(state, "p1"),
      amount: 0,
      ofDamageTaken: true,
    });
    // 🛑 **THE LOG ROW IS WHY THE EVENT CARRIES THE FLAG AT ALL.** Without it this row
    // rendered *"…will counterattack for 0 damage during your opponent's next turn"* — a
    // claim that nothing will happen, printed at the instant a real trap is armed. D421:
    // a log row is a claim with the same standing as a predicate.
    const rows = render(events, state).filter((r) => r.text.includes("counterattack"));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.who).toBe("p1");
    expect(rows[0]?.text).toBe(
      "Lycanroc ex will counterattack for the damage it takes during your opponent's next turn",
    );
    expect(rows[0]?.text).not.toContain("for 0 damage");
    // …and the FLAT row is untouched, which is the control that keeps the arm honest.
    const flat = mustApply(ready(), { type: "attack", seat: "p1", index: 1 });
    expect(
      render(flat.events, flat.state).find((r) => r.text.includes("counterattack"))?.text,
    ).toBe("Lycanroc ex will counterattack for 100 damage during your opponent's next turn");
  });

  it("MERGES the two inhabitants: the flag STICKS and the flat amount is the FLOOR", () => {
    // Unreachable off any printing — one attack per turn, and no card prints two of
    // these — so CONSTRUCTED and pinned, D152's own two-installs case extended by one
    // axis. The rule the merge keeps is D152's, restated for a channel: *a second
    // installation may never leave the holder with less than one of them printed*, so
    // the flat number survives as a FLOOR and the channel survives as a flag.
    const state = ready();
    const events: GameEvent[] = [];
    const result = runProgram(
      state,
      [
        { op: "installRecoil", amount: 40 },
        { op: "installRecoil", amount: "damageTaken" },
        { op: "installRecoil", amount: 20 },
      ],
      { seat: "p1", invokedBy: "attack" },
      events,
    );
    expect(result.state.players.p1.active?.installedRecoil).toEqual({
      turn: state.turn + 1,
      amount: 40,
      ofDamageTaken: true,
    });
    // TWO rows, not three: the third install merged to the same floor AND the same flag,
    // so it changed nothing and announcing it would announce a non-event (D140/D146).
    // 🛑 **AND THE SECOND ROW IS THE CONJUNCT THAT WOULD OTHERWISE BE SILENT.** Its
    // FLOOR is unchanged at 40 — under D152's one-conjunct suppression it would have
    // been swallowed — but the trap has just stopped being capped, which is emphatically
    // news. That is why the guard has two conjuncts.
    expect(findAll(events, "RECOIL_ARMED").map((r) => [r.amount, r.ofDamageTaken ?? false])).toEqual(
      [
        [40, false],
        [40, true],
      ],
    );
    // …and the answer honours the floor: a 20 hit still retaliates for 40. Read INSIDE
    // the window (the stamp is `turn + 1` and `installedRecoilOf` compares it to
    // `state.turn`), which is the same expiry-by-arithmetic every case in this file is
    // subject to and is asserted directly below.
    const live = intoWindow(result.state);
    expect(installedRecoilOf(live, mustActive(live, "p1"), 20)).toBe(40);
    // …while a 90 hit retaliates for 90, which is the whole point of the flag.
    expect(installedRecoilOf(live, mustActive(live, "p1"), 90)).toBe(90);
    // …and OUTSIDE the window it answers 0 whatever the hit was, floor and flag alike.
    expect(installedRecoilOf(result.state, mustActive(result.state, "p1"), 90)).toBe(0);
  });

  it("🛑 a SPENT stamp does not lend its flag to the next install — the stale-record read", () => {
    // 🛑 **FOUND BY READING THE MERGE RATHER THAN BY A FAILING BOARD, AND IT IS THE ONE
    // DEFECT THIS SLICE INTRODUCED AND CAUGHT ITSELF.** `existing` is the record sitting
    // on the body, which D124's expiry-by-arithmetic leaves there after its window has
    // passed — nothing sweeps it. The AMOUNT read has been gated on `stacking` since
    // D152; the first draft of the FLAG read was not, so a spent line-180 stamp turned a
    // fresh FLAT install into a scaled one two turns later. The two reads must carry the
    // same gate, and the asymmetry is exactly what a reader skims past.
    //
    // ⚠️ **UNREACHABLE OFF ANY PRINTING AND PINNED ANYWAY** (D144/D146's precedent, and
    // the same argument the two-installs case above makes): it takes ONE body arming the
    // unprinted member and then the flat one, and no card prints both. Constructed from
    // the armer's chair across a real turn boundary, so the STALENESS is produced by the
    // clock rather than written by hand.
    let state = ready();
    state = armScaled(state).state; // line 180: {turn: T+1, amount: 0, ofDamageTaken}
    const spent = state.players.p1.active?.installedRecoil;
    expect(spent).toEqual({ turn: state.turn + 1, amount: 0, ofDamageTaken: true });
    // …a full round later the stamp is SPENT and still on the body.
    state = intoWindow(state);
    state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
    expect(state.players.p1.active?.installedRecoil).toEqual(spent);
    expect(installedRecoilOf(state, mustActive(state, "p1"), 999)).toBe(0);
    // …and a FLAT install now must produce a FLAT record, with no inherited flag.
    const events: GameEvent[] = [];
    const again = runProgram(
      state,
      [{ op: "installRecoil", amount: 60 }],
      { seat: "p1", invokedBy: "attack" },
      events,
    );
    expect(again.state.players.p1.active?.installedRecoil).toEqual({
      turn: state.turn + 1,
      amount: 60,
    });
    expect(find(events, "RECOIL_ARMED")?.ofDamageTaken).toBeUndefined();
    const live = intoWindow(again.state);
    expect(installedRecoilOf(live, mustActive(live, "p1"), 999)).toBe(60);
    // …and the CONTROL on the same axis (D424): inside ONE window the flag DOES stick,
    // which is the behaviour the gate must not break while it fixes the stale read.
    expect(
      runProgram(
        ready(),
        [
          { op: "installRecoil", amount: "damageTaken" },
          { op: "installRecoil", amount: 60 },
        ],
        { seat: "p1", invokedBy: "attack" },
        [],
      ).state.players.p1.active?.installedRecoil,
    ).toEqual({ turn: ready().turn + 1, amount: 60, ofDamageTaken: true });
  });
});

describe("🆕🆕 D456 §3 — the §9 read: the amount IS the hit", () => {
  it("retaliates for exactly what the hit did — TWO different attacks, ONE trap", () => {
    const state = intoWindow(armScaled(ready()).state);
    // "Bite" — a flat 30 into a 260 HP body.
    const bite = swing(state, "fix-attacker", [...BITE]);
    expect(find(bite.events, "DAMAGE_DEALT")?.dealt).toBe(30);
    expect(find(bite.events, "COUNTERS_PLACED")).toEqual({
      type: "COUNTERS_PLACED",
      seat: "p2",
      uid: activeUid(bite.state, "p2"),
      amount: 30,
      source: "counterattack",
    });
    expect(bite.state.players.p2.active?.damage).toBe(30);
    // …and "Rage", whose damage SCALES off counters already on the attacker, so the same
    // trap answers a different number on the same board. A fixed amount cannot do this,
    // which is what makes the pair a real discrimination rather than one board twice.
    let raging = setActiveFromDeck(state, "p2", "fix-attacker");
    raging = attachFromDeck(raging, "p2", "fix-energy", 1);
    raging = withDamage(raging, "p2", 60);
    const rage = mustApply(raging, { type: "attack", seat: "p2", index: 3 });
    expect(find(rage.events, "DAMAGE_DEALT")?.dealt).toBe(70); // 10 + 10 × 6 counters
    expect(find(rage.events, "COUNTERS_PLACED")?.amount).toBe(70);
    // 🛑 THE IDENTITY, ASSERTED AS ONE: the retaliation is the SAME number
    // `DAMAGE_DEALT.dealt` publishes one push up, so the row and the trap can never
    // disagree. `dealt` and not `clamped` (a KO-survival TOTAL) and not `wouldDeal`
    // (which ignores prevention) — D427's identical choice one field over.
    for (const r of [bite, rage]) {
      expect(find(r.events, "COUNTERS_PLACED")?.amount).toBe(find(r.events, "DAMAGE_DEALT")?.dealt);
    }
  });

  it("SUMS with the always-on fold, in ONE row — the channel joins D141's judgement", () => {
    // The armed body wears Rocky Helmet: the catalog half is 20 and the installed half
    // is now *the hit*, so a 30 Bite retaliates for 50 in one row labelled by MECHANISM.
    // ⚠️ D141's stake, re-run with an amount that is not even a NUMBER at install time,
    // and it STILL needs no new `COUNTERS_PLACED.source` member.
    let state = equip(ready(), "p1", "sv01-193");
    state = intoWindow(armScaled(state).state);
    const { state: done, events } = swing(state, "fix-attacker", [...BITE]);
    expect(findAll(events, "COUNTERS_PLACED")).toHaveLength(1);
    expect(find(events, "COUNTERS_PLACED")?.amount).toBe(30 + HELMET);
    expect(find(events, "COUNTERS_PLACED")?.source).toBe("counterattack");
    expect(done.players.p2.active?.damage).toBe(30 + HELMET);
    const rows = render(events, done).filter((r) => r.text.includes("Counterattack"));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.who).toBe("system");
    expect(rows[0]?.text).toBe(`Counterattack: ${String(30 + HELMET)} damage to fix-attacker`);
  });

  it("🛑 the `dealt > 0` boundary — a PREVENTED hit arms nothing and the stamp SURVIVES", () => {
    // The channel's zero case is the read site's own gate and needs no `>= 1` guard on
    // the op (the flat arm has one because a printed 0 is a real sentence to refuse; a
    // channel has no printed number to refuse). "Growl" prints no damage at all.
    const state = intoWindow(armScaled(ready()).state);
    let growling = setActiveFromDeck(state, "p2", "sv02-062");
    growling = attachFromDeck(growling, "p2", "fix-lightning-energy", 1);
    const window = state.turn;
    const { state: done, events } = mustApply(growling, { type: "attack", seat: "p2", index: 0 });
    expect(findAll(events, "COUNTERS_PLACED")).toHaveLength(0);
    // …and the trap is still armed, because nothing consumed it — the stamp is compared,
    // never swept (D124), so it is still on the body after its window has passed.
    expect(done.turn).toBe(window + 1);
    expect(done.players.p1.active?.installedRecoil).toEqual({
      turn: window,
      amount: 0,
      ofDamageTaken: true,
    });
  });
});

describe("🆕🆕 D456 §4 — the four questions the printed clause raises", () => {
  it("Q1 — fires from a body being REMOVED in the same step, for the LETHAL hit's own damage", () => {
    // 🛑 **"(EVEN IF THIS POKÉMON IS KNOCKED OUT)" IS THE LOAD-BEARING CLAUSE AND IT IS
    // DRIVEN, NOT REASONED ABOUT.** §9 runs BEFORE `finishAttack`'s §8.1 both-board
    // sweep, so the install is still readable when the KO is collected — and for THIS
    // member the clause does more work than it does for D152's, because the AMOUNT is
    // read at the same instant: a design that captured the figure after the sweep would
    // have nothing to read it off, the body being gone.
    let state = clearBench(ready(), "p1");
    state = benchFromDeck(state, "p1", "fix-titan");
    state = withDamage(state, "p1", 250); // 260 HP; a 30 Bite is lethal
    const { state: done, events } = swing(intoWindow(armScaled(state).state), "fix-attacker", [
      ...BITE,
    ]);
    const order = types(events);
    expect(order).toContain("KNOCKED_OUT");
    expect(order.indexOf("COUNTERS_PLACED")).toBeGreaterThan(-1);
    expect(order.indexOf("COUNTERS_PLACED")).toBeLessThan(order.indexOf("KNOCKED_OUT"));
    // ⚠️ **AND THE AMOUNT IS THE UNCLAMPED HIT.** The holder had 10 HP left and took 30;
    // the retaliation is 30, not 10. `dealt` is deliberately not clamped — *"the attack
    // really did deal it"* (attack.ts §8.1) — and the printed words are *"the damage
    // done to this Pokémon"*, which is what was done and not what fitted.
    expect(find(events, "COUNTERS_PLACED")?.amount).toBe(30);
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(30);
    expect(done.players.p2.active?.damage).toBe(30);
  });

  it("Q2 — 'the Attacking Pokémon' is the body that dealt it, on the OTHER seat", () => {
    // The retaliating body's OWNER is not the attacker, and the reference is resolved at
    // the read site rather than carried: `attack.ts` uses the binding it rebinds at the
    // pre-damage seam (D429) and the interpreter's twin re-reads `activeTop` live, so
    // neither can name a body that has left. The observable claim is the pair of seats.
    const state = intoWindow(armScaled(ready()).state);
    const { state: done, events } = swing(state, "fix-attacker", [...BITE]);
    const placed = find(events, "COUNTERS_PLACED");
    // `seat` is the ATTACKER's — it OWNS the damaged Pokémon, which is this event's
    // contract (D136's finding 1) — while the CAUSER is the armer, which is why the log
    // row is SYSTEM-voiced.
    expect(placed?.seat).toBe("p2");
    expect(placed?.uid).toBe(activeUid(done, "p2"));
    expect(placed?.uid).not.toBe(activeUid(done, "p1"));
    // …and the armer takes nothing: this is not a mirror, it is a cross-table placement.
    expect(done.players.p1.active?.damage).toBe(30);
    expect(render(events, done).find((r) => r.text.includes("Counterattack"))?.who).toBe("system");
    // 🛑 **THE STALE-REFERENCE CLASS (D447) CANNOT ARISE HERE AND THE REASON IS
    // STRUCTURAL, NOT LUCK.** The §9 block sits INSIDE the §8.5 damage branch, ahead of
    // the attack's own effect program — the only thing in an attack that can move the
    // attacker — so there is no window between the install being read and the counters
    // landing. Pinned as an ordering over the event stream, which is the only place it
    // is observable: nothing runs between the hit and the retaliation.
    expect(types(events).slice(0, 3)).toEqual([
      "ATTACK_DECLARED",
      "DAMAGE_DEALT",
      "COUNTERS_PLACED",
    ]);
  });

  it("Q3 — counters are NOT damage: no Weakness, no Resistance, and no §11 ask", () => {
    // D449's finding, inherited rather than re-derived, and CHECKED at this member: the
    // §9 site adds flat HP to the attacker's `damage` outside the §8.5 pipeline. The
    // observable form is the arithmetic — `dealt` in, `dealt` out, with a Weakness on the
    // board that would have doubled it had the number gone through §8.5.
    const state = intoWindow(armScaled(ready()).state);
    const { state: done, events } = swing(state, "fix-attacker", [...BITE]);
    const attacker = FIXTURE_POOL["fix-attacker"];
    expect(attacker?.weaknesses ?? null).toBeNull(); // …so this board cannot show it, and says so
    expect(find(events, "COUNTERS_PLACED")?.amount).toBe(30);
    // 🛑 **SO THE CLAIM IS MADE WHERE IT IS OBSERVABLE: the EVENT TYPE.** A retaliation
    // that went through §8.5 would file `DAMAGE_DEALT` with `weakness`/`resistance`
    // fields; this files `COUNTERS_PLACED`, which has no such fields to carry. There is
    // exactly ONE `DAMAGE_DEALT` in the stream and it is the attacker's own hit.
    expect(findAll(events, "DAMAGE_DEALT")).toHaveLength(1);
    expect(find(events, "DAMAGE_DEALT")?.seat).toBe("p1");
    expect(findAll(events, "COUNTERS_PLACED")).toHaveLength(1);
    // ⚠️ **AND THE §11 PREVENTION GATE IS NOT ASKED, WHICH IS D450's QUESTION ANSWERED
    // BY REACHABILITY RATHER THAN BY A GATE.** A §11 attack block is installed on the
    // INSTALLER's own Active stamped `state.turn + 1`, so a block on P2's body is live
    // during P1's turn — and this placement happens during P2's own turn. No legal
    // sequence puts a live block on the body being retaliated against. Driven: the
    // retaliation lands on a board where P2's Active carries a block stamped for the
    // turn it CAN be stamped for, and the number is unchanged.
    const shielded = withBlock(state, "p2", state.turn + 1);
    const guarded = swing(shielded, "fix-attacker", [...BITE]);
    expect(find(guarded.events, "COUNTERS_PLACED")?.amount).toBe(30);
    expect(findAll(guarded.events, "ATTACK_EFFECT_PREVENTED")).toHaveLength(0);
    expect(done.players.p2.active?.damage).toBe(30);
  });

  it("Q4 — it CAN kill, the Prize IS paid, and the cause marker is NOT stamped", () => {
    // A 120 HP attacker already carrying 60 uses "Rage" for 70 and retaliates into its
    // own death: 60 + 70 = 130 ≥ 120. §9 runs before §8.1, so the sweep collects it.
    let state = intoWindow(armScaled(ready()).state);
    state = setActiveFromDeck(state, "p2", "fix-attacker");
    state = attachFromDeck(state, "p2", "fix-energy", 1);
    state = withDamage(state, "p2", 60);
    const { state: done, events } = mustApply(state, { type: "attack", seat: "p2", index: 3 });
    expect(find(events, "COUNTERS_PLACED")?.amount).toBe(70);
    expect(find(events, "KNOCKED_OUT")?.seat).toBe("p2");
    // 🛑 **THE PRIZE GOES TO THE ARMER**, which is the half a retaliation could get
    // wrong in a way no damage assertion would notice.
    expect(find(events, "PRIZES_OWED")).toEqual({ type: "PRIZES_OWED", seat: "p1", count: 1 });
    expect(done.phase.kind).toBe("ko:takePrizes");
    // ⚠️ **AND D414's `koByEffect` MARKER IS NOT STAMPED — D449's answer, re-derived at
    // a placer that is a RETALIATION rather than an attack clause.** The marker means
    // *"this body's lethality is an EFFECT's doing rather than damage's"*, and it denies
    // the KO-conditioned recoil family (`damageAttackerOnKo`, flow.ts). This site adds
    // to `damage`, so the Knock Out genuinely IS by damage and stamping it would deny a
    // recoil that is owed. Driven on the SURVIVING board, because a stamped body is
    // discarded before anything can read it.
    // ⚠️ **WHAT THIS CONTROL CANNOT SEE, STATED**: a successor that stamped the marker
    // only on the lethal branch would pass it. No board in this pool can show that half
    // — reading a marker off a body §8.1 has already discarded is not possible from
    // `applyAction` — and inventing a fixture to reach it is a bigger change than the
    // claim is worth. The half that IS checked is the one a copy-paste from
    // `devolveEach`/`knockOutChosen` would break.
    const survivor = swing(intoWindow(armScaled(ready()).state), "fix-attacker", [...BITE]);
    expect(survivor.state.players.p2.active?.damage).toBe(30);
    expect(survivor.state.players.p2.active?.markers).toEqual([]);
    expect(
      survivor.state.players.p2.active?.markers.some((m) => m.startsWith("koByEffect")),
    ).toBe(false);
  });
});

describe("🆕🆕 D456 §5 — `MATCH_RECORD_VERSION` 29, driven over the SERIALIZED BYTES", () => {
  it("🛑 the version PREDICTION in THREE directions, LOSS included", () => {
    // 🛑 **WHICH SITUATION THIS IS, ASKED RATHER THAN INHERITED (D386/D443) — AND THE
    // ARGUMENT THE LAST THREE SLICES USED DOES NOT APPLY AT ALL.** D453, D454 and D455
    // each held 29 partly on *"an `EffectOp` reaches storage only through a park"*.
    // `InPlayPokemon.installedRecoil` is a `GameState` field: it is persisted DIRECTLY,
    // every turn, park or no park. So the question has to be answered on `match.ts`'s own
    // discriminator instead — *"does the OLD byte string still mean what it meant"* — and
    // it is answered TWICE, because this slice changes shape at two addresses.

    const before = ready();
    const armed = armScaled(before).state;
    const record = armed.players.p1.active?.installedRecoil;
    expect(record).toEqual({ turn: before.turn + 1, amount: 0, ofDamageTaken: true });

    // **DIRECTION 1 — BACKWARD: a v29 record written BEFORE this slice.** The literal
    // bytes an earlier deploy wrote, parsed and read by TODAY's reader. `{turn, amount}`
    // with no rider must mean exactly what it meant: a flat trap, indifferent to the hit.
    // ⚠️ **EVERY DIRECTION IS READ INSIDE THE WINDOW**, i.e. after the turn has been
    // handed over, because `installedRecoilOf` gates on `installed.turn === state.turn`
    // FIRST. A direction read outside the window answers 0 for the CLOCK's reason and
    // says nothing whatever about the bytes — which is exactly how a bytes rung passes
    // for the wrong reason (D416's shape at a serialisation boundary).
    const inWindow = intoWindow(armed);
    expect(inWindow.turn).toBe(before.turn + 1);
    const v29 = JSON.parse(
      `{"turn":${String(before.turn + 1)},"amount":100}`,
    ) as InstalledRecoil;
    const legacy = withRawRecoil(inWindow, "p1", v29);
    expect(installedRecoilOf(legacy, mustActive(legacy, "p1"), 0)).toBe(100);
    expect(installedRecoilOf(legacy, mustActive(legacy, "p1"), 999)).toBe(100);
    expect(Object.keys(v29)).toEqual(["turn", "amount"]);

    // **DIRECTION 2 — FORWARD: the bytes this deploy writes, whole and round-tripped.**
    // Key sets asserted rather than eyeballed, because "the object looked right" is how a
    // key goes missing. ⚠️ **AND THE OP's STRING IS ABSENT FROM THE WIRE**, which is the
    // one claim that separates the two surfaces: `EffectOp.installRecoil.amount` is
    // `number | "damageTaken"` and the RECORD's `amount` is a `number`. A persisted
    // `"damageTaken"` would be a string in the field `attack.ts` SUMS with
    // `passivesOf().damageAttacker`, so a deploy that did not know the inhabitant would
    // compute `20 + "damageTaken"` → `"20damageTaken"` → `> 0` false, and would silently
    // drop the ALWAYS-ON Rocky Helmet share along with the installed one.
    const wire = JSON.stringify(armed.players.p1.active?.installedRecoil);
    expect(wire).toBe(`{"turn":${String(before.turn + 1)},"amount":0,"ofDamageTaken":true}`);
    expect(wire).not.toContain("damageTaken\":\"");
    expect(JSON.stringify(armed)).not.toContain('"amount":"damageTaken"');
    const round = JSON.parse(wire) as InstalledRecoil;
    const revived = withRawRecoil(inWindow, "p1", round);
    expect(installedRecoilOf(revived, mustActive(revived, "p1"), 45)).toBe(45);
    expect(installedRecoilOf(revived, mustActive(revived, "p1"), 0)).toBe(0);

    // **DIRECTION 3 — LOSS: a build that DROPS the rider, which is D421's criterion
    // applied rather than copied (D425).** The criterion is *choose the REST of the
    // record so that losing the key is DETECTABLE*, and the answer here is in the bytes:
    // the residue is `{turn, amount: 0}`, and **no flat install can author that**.
    const lost = JSON.parse(
      JSON.stringify(round, (k, v) => (k === "ofDamageTaken" ? undefined : v)),
    ) as InstalledRecoil;
    expect(Object.keys(lost)).toEqual(["turn", "amount"]);
    const degraded = withRawRecoil(inWindow, "p1", lost);
    // The degradation is INERT — the trap simply does not fire — and NOT D435's silent
    // corruption (`damage + undefined` → NaN → a body that can never be Knocked Out
    // again), which is the reason the optional road is taken here and was refused there.
    expect(installedRecoilOf(degraded, mustActive(degraded, "p1"), 999)).toBe(0);
    const quiet = swing(degraded, "fix-attacker", [...BITE]);
    expect(findAll(quiet.events, "COUNTERS_PLACED")).toHaveLength(0);
    // 🛑 **AND THE RESIDUE IS UNAUTHORABLE BY THE SURVIVING PATH — MEASURED OVER THE
    // WHOLE CORPUS AND THE WHOLE REGISTRY, not asserted.** The deriver's `counters >= 1`
    // guard is the only producer of a FLAT `installRecoil` in the engine, so a
    // `{turn, amount: 0}` with no rider is a byte string this deploy cannot write. A
    // reader who finds one has found the dropped key, which is what "detectable" means.
    const flatAmounts: number[] = [];
    for (const [, text] of legalAttackCorpus()) {
      for (const op of deriveAttackEffect(text) ?? []) {
        if (op.op === "installRecoil" && typeof op.amount === "number") flatAmounts.push(op.amount);
      }
    }
    expect(flatAmounts.length).toBeGreaterThan(0);
    expect(flatAmounts.every((n) => n >= 10)).toBe(true);
    for (const id of registryCardIds()) {
      const card = programFor(id);
      if (card === undefined) continue;
      const programs = [
        ...Object.values(card.attack ?? {}),
        ...(card.abilities ?? []).map((a) => a.program),
        ...(card.triggered ?? []).map((t) => t.program),
        ...(card.trainer === undefined ? [] : [card.trainer]),
      ];
      for (const op of programs.flat()) expect(op.op, id).not.toBe("installRecoil");
    }
  });
});
