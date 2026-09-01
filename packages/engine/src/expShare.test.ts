import { describe, expect, it } from "vitest";
import { CATALOG_MANIFEST } from "./catalogManifest";
import { disabledAbilityUids } from "./continuous";
import { deriveAttackEffect, programFor } from "./index";
import type { GameEvent, GameState, PendingStage } from "./index";
import { type LogContext, logFromEvents } from "./log";
import { phaseViewOf } from "./phaseView";
import { redactGame } from "./redact";
import { koToolTriggersOf } from "./triggers";
import {
  EXP_SHARE_DECK,
  FIXTURE_POOL,
  attachBenchFromDeck,
  attachFromDeck,
  attachToolFromDeck,
  benchFromDeck,
  clearBench,
  deepFreeze,
  driveSetup,
  handFromDeck,
  handUid,
  mustApply,
  setConditions,
  setDamage,
  expectErr,
  setActiveFromDeck,
  types,
} from "./testFixtures";

// 0.115.0 → D171 — Exp. Share sv01-174 (P3-M5 long tail), the THIRD and LAST
// consumer of the KO antecedent D158 censused, and the first card in this engine
// whose printed sentence is carried by a POKÉMON TOOL attached to a body OTHER
// than the one the sentence is about:
//
//   "When your Active Pokémon is Knocked Out by damage from an attack from your
//    opponent's Pokémon, you may move a Basic Energy from that Pokémon to the
//    Pokémon this card is attached to."              (Trainer/Tool, `effect`)
//
// ⚠️ THE CENSUS IS THIS SESSION'S OWN QUERY, over ALL THREE text columns against
// the local D1 (2026-08-03, 978 rows / 6 sets). `LIKE '%Knocked Out by damage
// from an attack%'` returns SIX rows — D158's figure, D162's re-run and D164's
// third confirmation, now a FOURTH:
//
//   sv03-197  Vengeful Punch (Trainer/Tool, `effect`)          → D158
//   sv01-174  Exp. Share     (Trainer/Tool, `effect`)          → THIS
//   sv01-114  Lucario        (Pokemon,      `attacks_json`)    → NOT this family
//   sv06.5-037/-083/-091  Munkidori ex (Pokemon, `abilities_json`) → D164
//
// Excluding Lucario (D164's correction — "during your opponent's LAST turn",
// retrospective, board-wide, type-filtered, no possessive) the family is FIVE
// printings / THREE sentences, and with this slice it is CLOSED at 5/5 authored
// but for the ONE deliberate abstention (`sv01-114`, kept as the live
// fall-through witness in conditionClause.test.ts).
//
// ⚠️ AND A SEVENTH ROW THE CENSUS PATTERN CANNOT SEE, RECORDED RATHER THAN
// ABSORBED. Corviknight sv02-148 "Accelerate" prints "If your opponent's Pokémon
// is Knocked Out by damage from THIS ATTACK, during your opponent's next turn,
// prevent all damage from and effects of attacks done to this Pokémon."
// (`attacks_json`). That is a DIFFERENT antecedent — the KO is *caused by* the
// attack being resolved rather than *suffered by* the reader, and its consequent
// is a durated self-prevention — so it belongs to no member of this family. It
// has no registry row. Every run of this census since D158 has been blind to it
// because the pattern says "from an attack" and this row says "from this attack".
//
// ⚠️ THE SHAPE — WHY NEITHER EXISTING KO SEAM SERVES THIS, WHICH IS THE SLICE.
//   • `koTrigger` is a TEMPORAL IMPOSSIBILITY, not a widening problem.
//     `collectKnockOuts` queues every koTrigger AFTER `knockOut` has run for the
//     whole batch, and `knockOut` discards the dying stack WHOLE — so the Energy
//     this sentence moves is already in the discard pile.
//   • `koRecoilOf` (Vengeful Punch's site) IS before `knockOut`, deliberately —
//     but it is SYNCHRONOUS and cannot park, and this consequent is a choice.
//   So the seam is a SIBLING OF `damagedTrigger`: a new `koToolTrigger` stage,
//   seeded by attack.ts ahead of the attackEpilogue, run under the DAMAGED seat,
//   folded through settleProgram with `resumeTail`.
//
// ⚠️ AND THE REAL COST WAS THAT NOTHING RAN A TOOL'S `triggered` PROGRAM. The
// bearer is a SURVIVING body; the dying one is only the Energy's source. All
// three existing detection sites miss it — `onKnockOutTrigger` reads the KO'd
// body's top card, `triggersOf` reads any body's top card (a Tool is never a
// stack top), and `passivesOf` is the only site that walks `pokemon.tools` but
// folds `passive` into NUMBERS. Hence `koToolTriggersOf`, a FOURTH site, and the
// group of cases below that drives its two deliberate refusals.

/** The printed sentence, byte-for-byte off the local D1 row (2026-08-03). */
const EXP_SHARE =
  "When your Active Pokémon is Knocked Out by damage from an attack from your opponent's Pokémon, you may move a Basic Energy from that Pokémon to the Pokémon this card is attached to.";
/** Vengeful Punch's, kept verbatim because the point is that the ANTECEDENT is
    the same and only the consequent moved the whole design. */
const VENGEFUL_PUNCH =
  "If the Pokémon this card is attached to is Knocked Out by damage from an attack from your opponent's Pokémon, put 4 damage counters on the Attacking Pokémon.";
/** Corviknight's, so the seventh row is a STRING in the repo rather than a note
    in a census the next slice has to re-run. */
const ACCELERATE =
  "If your opponent's Pokémon is Knocked Out by damage from this attack, during your opponent's next turn, prevent all damage from and effects of attacks done to this Pokémon.";

const bite = { type: "attack", seat: "p1", index: 0 } as const; // Bite — {C}, 30
const yawn = { type: "attack", seat: "p1", index: 2 } as const; // Yawn — no damage
const spread = { type: "attack", seat: "p1", index: 0 } as const; // Spread Shot

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

/** The rendered log a player actually reads — the same helper shape
    `ohNoYouDont.test.ts` and `vengefulPunch.test.ts` use, so the three suites'
    rows over one printed antecedent are directly comparable. */
function render(
  events: GameEvent[],
  state: GameState,
  names: { p1: string; p2: string } = { p1: "Ember", p2: "Tide" },
): { who: string; text: string }[] {
  const ctx: LogContext = { names, state, elapsed: "+00:21" };
  return logFromEvents(events, ctx).flatMap((entry) =>
    entry.kind === "turn"
      ? []
      : [{ who: entry.who, text: entry.segments.map((s) => s.text).join("") }],
  );
}

interface FieldOpts {
  /** The DYING Active on the defender's board (default fix-victim, 30 HP). */
  victim?: string;
  /** The defender's bench, in order. The Tool lands on `holderIndex`. */
  bench?: string[];
  /** Which benched body carries Exp. Share (default 0). `"active"` puts it on
      the dying body itself — the self-attached no-op. `null` attaches none. */
  holder?: number | "active" | null;
  /** A second Exp. Share, for the "first match fires" board. */
  secondHolder?: number;
  /** A Tool that is NOT this card, on `holderIndex` (the scan's negative). */
  otherTool?: number;
  /** Basic Energy ids to hang on the dying Active (default one fix-energy). */
  victimEnergy?: string[];
  /** The ATTACKER's Active (default fix-attacker: Bite idx 0 / Yawn idx 2). */
  attacker?: string;
  /** Energy ids on the attacker (default one fix-energy — every {C} cost). */
  attackerEnergy?: string[];
  /** Bench the ATTACKER's side too — the "from your OPPONENT'S Pokémon" board. */
  attackerBench?: string[];
  /** Put the Tool on the ATTACKER's board instead, to drive the possessive. */
  attackerHolder?: number;
}

/** P2 (going first) fields the DEFENDER — the dying Active, the bench, the Tool
    and the Energy — then the turn passes to P1, who fields the attacker with one
    {C} attached. The mirror of `ohNoYouDont.test.ts`'s `field`, deliberately, so
    the two suites' boards over one printed antecedent are comparable.

    SEED-FREE in the sense that matters: this card flips no coin, and every body
    on both boards is placed by surgery rather than dealt. */
function field(seed: number, opts: FieldOpts = {}): GameState {
  let state = driveSetup(seed, { p1: EXP_SHARE_DECK, p2: EXP_SHARE_DECK }, { first: "p2" });
  // — the DEFENDER's board (p2) —
  state = setActiveFromDeck(state, "p2", opts.victim ?? "fix-victim");
  state = clearBench(state, "p2");
  for (const id of opts.bench ?? ["fix-bigbody"]) state = benchFromDeck(state, "p2", id);
  for (const id of opts.victimEnergy ?? ["fix-energy"]) {
    state = attachFromDeck(state, "p2", id, 1);
  }
  const holder = opts.holder === undefined ? 0 : opts.holder;
  if (holder !== null) state = attachToolFromDeck(state, "p2", holder, "sv01-174");
  if (opts.secondHolder !== undefined) {
    state = attachToolFromDeck(state, "p2", opts.secondHolder, "sv01-174");
  }
  if (opts.otherTool !== undefined) {
    state = attachToolFromDeck(state, "p2", opts.otherTool, "sv01-193");
  }
  // — hand the turn to P1 and field the ATTACKER —
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", opts.attacker ?? "fix-attacker");
  state = clearBench(state, "p1");
  for (const id of opts.attackerBench ?? ["fix-bigbody"]) state = benchFromDeck(state, "p1", id);
  if (opts.attackerHolder !== undefined) {
    state = attachToolFromDeck(state, "p1", opts.attackerHolder, "sv01-174");
  }
  for (const id of opts.attackerEnergy ?? ["fix-energy"]) {
    state = attachFromDeck(state, "p1", id, 1);
  }
  return state;
}

/** The Energy uids on p2's Active, before the attack. */
function victimEnergy(state: GameState): string[] {
  return [...(state.players.p2.active?.energy ?? [])];
}

/** The one destination the route pins — the Tool's holder. Throws unless the
    board is parked on this card's own prompt, so no case can go vacuous. */
function destinationOf(state: GameState) {
  if (state.phase.kind !== "effect:choose") {
    throw new Error(`expected a park, got ${state.phase.kind}`);
  }
  const prompt = state.phase.prompt;
  if (prompt.kind !== "moveEnergy") throw new Error(`expected moveEnergy, got ${prompt.kind}`);
  const dest = prompt.destinations[0];
  if (dest === undefined) throw new Error("the prompt offered no destination");
  return dest;
}

/** Answer the parked moveEnergy prompt: take `uids` onto the offered
    destination, or DECLINE with an empty pick (the printed "you may"). */
function answer(state: GameState, uids: string[]): { state: GameState; events: GameEvent[] } {
  const dest = destinationOf(state);
  if (state.phase.kind !== "effect:choose") throw new Error("unreachable");
  return mustApply(state, {
    type: "resolveEffect",
    seat: state.phase.answerer ?? state.phase.seat,
    choice: { kind: "moveEnergy", picks: uids.map((uid) => ({ uid, dest })) },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// The printed datum — re-queried per claim, never inherited.
// ─────────────────────────────────────────────────────────────────────────────

describe("the printed datum — re-queried, not inherited", () => {
  it("authors sv01-174 as an `onAllyActiveKnockOut` trigger, and on NO other timing", () => {
    expect(programFor("sv01-174")?.triggered).toEqual([
      {
        name: "Exp. Share",
        trigger: "onAllyActiveKnockOut",
        optional: true,
        program: [
          {
            op: "moveEnergy",
            filter: { kind: "basicEnergy" },
            max: 1,
            route: "koedActiveToToolHolder",
          },
        ],
      },
    ]);
    // ⚠️ IT HAS NO `passive`, WHICH IS THE WHOLE DIFFERENCE FROM ITS TWO
    // NEIGHBOURS. Rocky Helmet and Vengeful Punch are passives and nothing else;
    // this is a program and nothing else. A `passive` here would mean the slice
    // had found a way to say "move a card the player chooses" as a number.
    expect(programFor("sv01-174")?.passive).toBeUndefined();
    expect(programFor("sv01-193")?.triggered).toBeUndefined();
    expect(programFor("sv03-197")?.triggered).toBeUndefined();
  });

  it("the fixture's Tool text is the D1 row, character for character", () => {
    const card = FIXTURE_POOL["sv01-174"];
    expect(card?.category).toBe("Trainer");
    expect(card?.trainerType).toBe("Tool");
    expect(card?.effect).toBe(EXP_SHARE);
    // The row carries NO attacks and NO abilities — the sentence lives in
    // `effect`, which is the column this family's censuses keep mis-reading.
    expect(card?.attacks ?? []).toEqual([]);
    expect(card?.abilities ?? []).toEqual([]);
    // The GENERATED manifest is an independent second reading of the same row —
    // it comes from the sqlite, not from this file — so the NAME is checked by a
    // path that cannot inherit a typo from the fixture.
    expect(CATALOG_MANIFEST.printed["sv01-174"]).toEqual({
      name: "Exp. Share",
      // `types` joined this row at D173. A Trainer prints none, and the empty
      // array is asserted rather than skipped: this is the one manifest row this
      // file reads WHOLE, so a field added to it must be answered for here.
      types: [],
      attacks: [],
      abilities: [],
    });
  });

  it("the sentence is a TOOL's and never derives as an attack effect", () => {
    // The column-blindness this family keeps tripping over, made a test — the
    // same case ohNoYouDont.test.ts runs for the Ability column.
    expect(deriveAttackEffect(EXP_SHARE)).toBeNull();
  });

  it("⚠️ it shares Vengeful Punch's ANTECEDENT exactly, and only the CONSEQUENT moved", () => {
    // Both Tools, both read at the same instant, both refusing the same KOs. The
    // clause below is the shared half, word for word.
    const shared = "Knocked Out by damage from an attack from your opponent's Pokémon";
    expect(EXP_SHARE).toContain(shared);
    expect(VENGEFUL_PUNCH).toContain(shared);
    expect(FIXTURE_POOL["sv03-197"]?.effect).toBe(VENGEFUL_PUNCH);
    // …and the two clauses that are NOT shared are exactly the two that cost this
    // printing everything: whose body the sentence is about, and what it does.
    expect(EXP_SHARE).toContain("your Active Pokémon"); // the SUBJECT is another body
    expect(VENGEFUL_PUNCH).toContain("the Pokémon this card is attached to is Knocked Out");
    expect(EXP_SHARE).toContain("you may move a Basic Energy"); // a CHOICE, not a number
    expect(VENGEFUL_PUNCH).toContain("put 4 damage counters");
  });

  it("⚠️ CORVIKNIGHT sv02-148 is a SEVENTH row this census cannot see — recorded, not absorbed", () => {
    // "Knocked Out by damage from THIS attack" — the KO is CAUSED BY the attack
    // being resolved, not SUFFERED BY the card's owner, and the consequent is a
    // durated self-prevention. A different antecedent family, deliberately
    // unmapped, and pinned here so the next census does not rediscover it.
    expect(FIXTURE_POOL["sv02-148"]).toBeUndefined();
    expect(ACCELERATE).toContain("Knocked Out by damage from this attack");
    expect(ACCELERATE).not.toContain("from an attack");
    expect(ACCELERATE).not.toContain("from your opponent's Pokémon");
    expect(EXP_SHARE).not.toContain("this attack");
    expect(programFor("sv02-148")).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The board scan — the slice's real decision, driven directly.
// ─────────────────────────────────────────────────────────────────────────────

describe("koToolTriggersOf — the FOURTH detection site", () => {
  it("finds a Tool on a BENCHED body, keyed on the ACTIVE's uid", () => {
    const state = field(11);
    const koed = state.players.p2.active?.stack.at(-1);
    expect(koed).toBeDefined();
    const found = koToolTriggersOf(state, "p2", koed as string);
    expect(found).toHaveLength(1);
    expect(found[0]?.ability.name).toBe("Exp. Share");
    // The TOOL's uid and the HOLDER's are different cards, which is the fact none
    // of the other three sites can express.
    expect(found[0]?.toolUid).toBe(state.players.p2.bench[0]?.tools[0]);
    expect(found[0]?.holderUid).toBe(state.players.p2.bench[0]?.stack.at(-1));
    expect(found[0]?.toolUid).not.toBe(found[0]?.holderUid);
  });

  it("⚠️ SKIPS the KO'd body — a self-attached Exp. Share names no second Pokémon", () => {
    const state = field(12, { holder: "active" });
    const koed = state.players.p2.active?.stack.at(-1) as string;
    expect(state.players.p2.active?.tools).toHaveLength(1); // it IS attached
    expect(koToolTriggersOf(state, "p2", koed)).toEqual([]);
    // …and the same board with the Tool one slot over DOES find it, so the empty
    // result above is the skip rather than a broken scan.
    expect(koToolTriggersOf(field(12), "p2", koed)).toHaveLength(1);
  });

  it("ignores a Tool that is not this one — Rocky Helmet is a `passive`", () => {
    const state = field(13, { holder: null, otherTool: 0 });
    const koed = state.players.p2.active?.stack.at(-1) as string;
    expect(state.players.p2.bench[0]?.tools).toHaveLength(1);
    expect(koToolTriggersOf(state, "p2", koed)).toEqual([]);
  });

  it("finds NOTHING on a board with no Tools at all, on either seat", () => {
    const state = field(14, { holder: null });
    const koed = state.players.p2.active?.stack.at(-1) as string;
    expect(koToolTriggersOf(state, "p2", koed)).toEqual([]);
    expect(koToolTriggersOf(state, "p1", koed)).toEqual([]);
  });

  it("⚠️ the three EXISTING sites cannot see this card, which is why the fourth exists", () => {
    // `passivesOf` is the only pre-D171 site that walks `pokemon.tools`, and it
    // folds `passive` — which this card does not have — into NUMBERS. Asserted
    // through the registry rather than by calling it, because the claim is about
    // the SHAPE of what that fold can carry, not about one board's total.
    expect(programFor("sv01-174")?.passive).toBeUndefined();
    // `onKnockOutTrigger` / `triggersOf` both key on a TOP CARD, and a Tool is
    // never one — so no `triggered` timing other than this card's own would be
    // reachable from a Tool at all. The registry-wide guard: every
    // `onAllyActiveKnockOut` producer in the pool is a Tool, and no Tool carries
    // any OTHER trigger timing (which would silently never fire).
    for (const id of Object.keys(FIXTURE_POOL)) {
      const card = FIXTURE_POOL[id];
      const triggered = programFor(id)?.triggered ?? [];
      const toolTimings = triggered.filter((t) => t.trigger === "onAllyActiveKnockOut");
      if (toolTimings.length > 0) {
        expect(card?.trainerType, `${id} carries a Tool timing but is not a Tool`).toBe("Tool");
      }
      if (card?.trainerType === "Tool" && triggered.length > 0) {
        expect(
          triggered.every((t) => t.trigger === "onAllyActiveKnockOut"),
          `${id} is a Tool carrying a timing no scan reads`,
        ).toBe(true);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The PARK, its controller, and its resume.
// ─────────────────────────────────────────────────────────────────────────────

describe("the park — who is asked, and what resumes", () => {
  it("a lethal attack PARKS the KO'd player on a moveEnergy prompt, BEFORE the KO", () => {
    const state = deepFreeze(field(21));
    const { state: after, events } = mustApply(state, bite);
    // The park is real, and it belongs to the DEFENDER — not the turn owner.
    expect(after.phase.kind).toBe("effect:choose");
    if (after.phase.kind !== "effect:choose") throw new Error("expected a park");
    expect(after.phase.seat).toBe("p2");
    expect(after.phase.resumeTail).toBe(true);
    expect(after.phase.prompt.kind).toBe("moveEnergy");
    expect(find(events, "EFFECT_PENDING")?.seat).toBe("p2");
    // ⚠️ AND THE DYING BODY IS STILL ON THE BOARD, which is the whole seam: the
    // Energy this card moves has not been discarded yet.
    expect(after.players.p2.active).not.toBeNull();
    expect(types(events)).not.toContain("KNOCKED_OUT");
    // The attackEpilogue is sitting behind the park, waiting to do the KO.
    expect(after.pending.map((s: PendingStage) => s.kind)).toEqual(["attackEpilogue"]);
  });

  it("the prompt pins BOTH endpoints and offers exactly one destination", () => {
    const state = field(22, { victimEnergy: ["fix-energy", "fix-fire-energy"] });
    const { state: after } = mustApply(state, bite);
    if (after.phase.kind !== "effect:choose") throw new Error("expected a park");
    const prompt = after.phase.prompt;
    if (prompt.kind !== "moveEnergy") throw new Error("expected moveEnergy");
    // SOURCE — the dying ACTIVE alone (both its Basic Energy, and nothing off the
    // bench, which the free Energy Switch route would have offered).
    expect(prompt.movable).toHaveLength(2);
    expect(prompt.movable.every((m) => m.from.spot.spot === "active")).toBe(true);
    // DESTINATION — the Tool's HOLDER, by uid, and only it.
    expect(prompt.destinations).toEqual([{ seat: "p2", spot: { spot: "bench", index: 0 } }]);
    expect(prompt.max).toBe(1);
    // The note is the printed second half, so the prompt is the only thing that
    // names this card to a player (a Tool emits no ABILITY_TRIGGERED row).
    expect(prompt.note).toBe(
      "Move a Basic Energy from that Pokémon to the Pokémon this card is attached to.",
    );
  });

  it("resolving MOVES the Energy, then the tail resumes and the KO happens", () => {
    const state = field(23);
    const [energy] = victimEnergy(state);
    const { state: parked } = mustApply(state, bite);
    const { state: after, events } = answer(parked, [energy as string]);
    // The Energy landed on the HOLDER…
    expect(after.players.p2.bench.some((p) => p.energy.includes(energy as string))).toBe(true);
    expect(after.players.p2.discard).not.toContain(energy);
    // …and the tail then ran to completion: the KO, the prize, the promotion.
    const order = types(events);
    expect(order.indexOf("ENERGY_MOVED")).toBeLessThan(order.indexOf("KNOCKED_OUT"));
    expect(order).toContain("KNOCKED_OUT");
    expect(after.players.p2.active).toBeNull(); // promotion is owed
    expect(after.phase.kind).toBe("ko:takePrizes");
  });

  it('⚠️ THE DECLINE IS FREE — the printed "you may", answered with an empty pick', () => {
    const state = field(24);
    const [energy] = victimEnergy(state);
    const { state: parked } = mustApply(state, bite);
    const { state: after, events } = answer(parked, []);
    // Nothing moved…
    expect(types(events)).not.toContain("ENERGY_MOVED");
    expect(after.players.p2.bench.every((p) => !p.energy.includes(energy as string))).toBe(true);
    // …and the Energy went to the discard with its Pokémon, which is what
    // declining MEANS. No confirm arm, no new prompt family: `moveEnergy` was
    // already declinable and optional triggers already auto-fire.
    expect(after.players.p2.discard).toContain(energy);
    expect(types(events)).toContain("KNOCKED_OUT");
    expect(programFor("sv01-174")?.triggered?.[0]?.optional).toBe(true);
  });

  it("the ATTACKER cannot answer the KO'd player's prompt", () => {
    const state = field(25);
    const [energy] = victimEnergy(state);
    const { state: parked } = mustApply(state, bite);
    expectErr(
      parked,
      {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "moveEnergy", picks: [{ uid: energy as string, dest: destinationOf(parked) }] },
      },
      "WRONG_SEAT",
    );
  });

  it("the projection shows the TURN OWNER acting while the KO'd player answers", () => {
    // `resumeTail` marks a mid-tail park, so `activeSeat` is read off the pending
    // queue (koParkActiveSeat) rather than off phase.seat — the same reading the
    // on-KO and damaged triggers already get. Without it the HUD would show the
    // KO'd player as the one whose turn it is.
    const state = field(26);
    const { state: parked } = mustApply(state, bite);
    const view = phaseViewOf(parked, "p2");
    expect(view.activeSeat).toBe("p1"); // the attacker still owns the turn
    expect(view.waitingSeat).toBe("p2"); // the KO'd player owes the answer
    expect(view.pendingDecision?.kind).toBe("effectChoose");
    // …and viewer-relative, which is what the wire actually carries.
    expect(redactGame(parked, "p2").activePlayer).toBe("opponent");
    expect(redactGame(parked, "p2").waitingOn).toBe("you");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The ANTECEDENT — every clause refused on its own board.
// ─────────────────────────────────────────────────────────────────────────────

describe("the antecedent — each clause refused on its own board", () => {
  it('"is Knocked Out": a NON-lethal attack seeds the stage and moves nothing', () => {
    // ⚠️ THE LETHALITY RE-CHECK, and it is the reason the stage cannot answer its
    // own condition at the seed: the Tool is present, so the stage IS queued at
    // damage time, and only the run-time re-read refuses it.
    const state = field(31);
    const [energy] = victimEnergy(state);
    const { state: after, events } = mustApply(state, yawn); // no damage at all
    expect(after.phase.kind).not.toBe("effect:choose");
    expect(types(events)).not.toContain("ENERGY_MOVED");
    expect(types(events)).not.toContain("KNOCKED_OUT");
    expect(after.players.p2.active?.energy).toContain(energy);
  });

  it('"is Knocked Out": a DAMAGING but survivable attack moves nothing either', () => {
    const state = field(32, { victim: "fix-bigbody" }); // 200 HP vs Bite's 30
    const { state: after, events } = mustApply(state, bite);
    expect(types(events)).toContain("DAMAGE_DEALT");
    expect(types(events)).not.toContain("ENERGY_MOVED");
    expect(after.phase.kind).toBe("turn:action"); // p2's turn, the tail ended
  });

  it("\"from your OPPONENT'S Pokémon\": the ATTACKER's own holder pays nothing", () => {
    // The possessive, driven by putting Exp. Share on the ATTACKING side and
    // Knocking Out a body on the ATTACKER's own board — a `damageSelf` shape the
    // epilogue sweeps too. Here the simpler witness: the attacker's Tool is not
    // consulted when the DEFENDER dies, because the stage is seeded for the
    // defender's seat alone.
    const state = field(33, { holder: null, attackerHolder: 0 });
    const { state: after, events } = mustApply(state, bite);
    expect(types(events)).toContain("KNOCKED_OUT");
    expect(types(events)).not.toContain("ENERGY_MOVED");
    expect(after.phase.kind).not.toBe("effect:choose");
  });

  it('"by damage from an attack": a CHECKUP KO never reaches this stage', () => {
    // Poison finishes the Active between turns. `runCheckup` calls
    // `collectKnockOuts` directly and nothing seeds a koToolTrigger, so the
    // clause is discharged by PLACEMENT — D158's mechanism, third printing.
    let state = field(34);
    const [energy] = victimEnergy(state);
    state = mustApply(state, yawn).state; // a real attack that deals NO damage
    // …poison the survivor and end the turn, so the Checkup tick is what kills it.
    state = setDamage(state, "p2", 20);
    state = setConditions(state, "p2", { poisonDamage: 10 });
    const { state: after, events } = mustApply(state, { type: "endTurn", seat: "p2" });
    expect(types(events)).toContain("KNOCKED_OUT");
    expect(types(events)).not.toContain("ENERGY_MOVED");
    expect(after.players.p2.discard).toContain(energy);
  });

  it("a Basic Energy on a benched body is NOT movable — the source is the ACTIVE", () => {
    let state = field(35);
    state = attachBenchFromDeck(state, "p2", 0, "fix-fire-energy", 1);
    const { state: parked } = mustApply(state, bite);
    if (parked.phase.kind !== "effect:choose") throw new Error("expected a park");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "moveEnergy") throw new Error("expected moveEnergy");
    // The free Energy Switch route would offer the benched copy as a source; this
    // route does not. One movable Energy, off the Active.
    expect(prompt.movable).toHaveLength(1);
    expect(prompt.movable[0]?.from.spot).toEqual({ spot: "active" });
  });

  it('a SPECIAL Energy on the dying body is refused — the printed "a BASIC Energy"', () => {
    const state = field(36, { victimEnergy: ["fix-special"] });
    const { state: after, events } = mustApply(state, bite);
    // Nothing matched the filter, so the op is a no-op and never parks.
    expect(after.phase.kind).not.toBe("effect:choose");
    expect(types(events)).not.toContain("ENERGY_MOVED");
    expect(types(events)).toContain("KNOCKED_OUT");
  });

  it("a dying body with NO Energy at all never parks", () => {
    const state = field(37, { victimEnergy: [] });
    const { state: after, events } = mustApply(state, bite);
    expect(after.phase.kind).not.toBe("effect:choose");
    expect(types(events)).not.toContain("ENERGY_MOVED");
    expect(types(events)).toContain("KNOCKED_OUT");
  });

  it("a self-attached Exp. Share never seeds the stage — no second Pokémon", () => {
    const state = field(38, { holder: "active" });
    const { state: after, events } = mustApply(state, bite);
    expect(after.phase.kind).not.toBe("effect:choose");
    expect(types(events)).not.toContain("ENERGY_MOVED");
    expect(types(events)).toContain("KNOCKED_OUT");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The seam — order, the surviving holder, and §9.
// ─────────────────────────────────────────────────────────────────────────────

describe("the seam", () => {
  it("⚠️ the stage is seeded ONLY when the board carries the Tool", () => {
    // The pending queue of every other attack is byte-identical to pre-D171, and
    // that is what makes the seed gate a gate rather than an overhead.
    const bare = field(41, { holder: null, victim: "fix-bigbody" });
    const { state: after } = mustApply(bare, bite);
    expect(after.pending).toEqual([]);
    // With the Tool present and the same non-lethal hit, the stage is queued and
    // then drains itself — which is why the observable above is the QUEUE and the
    // observable below is that nothing happened.
    const armed = field(41, { victim: "fix-bigbody" });
    const { state: armedAfter, events } = mustApply(armed, bite);
    expect(armedAfter.pending).toEqual([]);
    expect(types(events)).not.toContain("ENERGY_MOVED");
  });

  it("⚠️ FIRES ON AN ATTACK THAT DEALT NO MAIN DAMAGE — the seed is not `dealt > 0`", () => {
    // Mimikyu "Ghost Eye" has NO printed `damage` field: the §8.5 pipeline is
    // skipped whole (`dealt` is never computed, and no damagedTrigger is even
    // considered), and the KO comes from the EFFECT PROGRAM's 7 counters. The
    // printed condition is the Knock Out, not the hit — so copying the reactive
    // trigger's `dealt > 0` gate would switch this card off against the one
    // attacker in the pool that can prove the difference.
    const state = field(45, {
      attacker: "sv02-097",
      attackerEnergy: ["fix-psychic-energy", "fix-energy"],
    });
    const [energy] = victimEnergy(state);
    const { state: parked, events } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(types(events)).not.toContain("DAMAGE_DEALT"); // no main hit at all
    expect(types(events)).toContain("COUNTERS_PLACED");
    expect(parked.phase.kind).toBe("effect:choose");
    const { state: after, events: resolved } = answer(parked, [energy as string]);
    expect(types(resolved)).toContain("ENERGY_MOVED");
    expect(types(resolved)).toContain("KNOCKED_OUT");
    expect(after.players.p2.bench.some((p) => p.energy.includes(energy as string))).toBe(true);
  });

  it("⚠️ the HOLDER can die in the SAME batch and still be paid first", () => {
    // Spread Shot kills the 30 HP Active and puts 20 on each benched body. The
    // holder here is a fix-victim (30 HP) already at 10, so the same swing is
    // lethal for it too — and this stage runs BEFORE the sweep, so the Energy
    // moves onto a Pokémon that is about to be Knocked Out. Both cards then go to
    // the discard together, which is what "one simultaneous batch" means.
    let state = field(42, {
      bench: ["fix-victim"],
      attacker: "fix-sniper",
    });
    state = {
      ...state,
      players: {
        ...state.players,
        p2: {
          ...state.players.p2,
          bench: state.players.p2.bench.map((p, i) => (i === 0 ? { ...p, damage: 10 } : p)),
        },
      },
    };
    const [energy] = victimEnergy(state);
    const { state: parked } = mustApply(state, spread);
    expect(parked.phase.kind).toBe("effect:choose");
    const { state: after, events } = answer(parked, [energy as string]);
    const order = types(events);
    expect(order.indexOf("ENERGY_MOVED")).toBeLessThan(order.indexOf("KNOCKED_OUT"));
    // TWO Knock Outs in the batch, and the rescued Energy is in the discard —
    // rescued onto a body that died in the same instant.
    expect(events.filter((e) => e.type === "KNOCKED_OUT")).toHaveLength(2);
    expect(after.players.p2.discard).toContain(energy);
  });

  it("⚠️ §9 DOES NOT REACH IT — a Tool is not an Ability", () => {
    // Klefki "Mischievous Lock" ("each Basic Pokémon in play, both yours and your
    // opponent's, has no Abilities") sits Active on the ATTACKER's side, so the
    // aura is live over the whole board. `triggersOf` would suppress a triggered
    // Ability here; `koToolTriggersOf` deliberately has no such gate, for
    // `passivesOf`'s stated reason. The Tool still fires.
    // ⚠️ THE VICTIM IS PRE-DAMAGED TO 20 SINCE D173, and the reason is the fixture
    // fix rather than this card: Klefki used to carry a SUBSTITUTED Bite ({C}, 30)
    // that Knocked Out a 30 HP fix-victim outright. It now carries its own printed
    // "Joust" ({C}, 10), so the 20 is what makes the hit lethal. `isLethallyDamaged`
    // is what the stage re-reads, and 20 + 10 = 30 = HP satisfies it exactly.
    const state = setDamage(field(43, { attacker: "sv01-096" }), "p2", 20);
    const koed = state.players.p2.active?.stack.at(-1) as string;
    const holderUid = state.players.p2.bench[0]?.stack.at(-1) as string;
    // ⚠️ THE LOCK IS PROVED LIVE FIRST, so the positive below cannot be vacuous:
    // the HOLDER is a Basic and its uid really is in the suppressed set.
    const locked = disabledAbilityUids(state);
    expect(locked.has(holderUid)).toBe(true);
    expect(locked.has(koed)).toBe(true);
    // …and the Tool fires anyway.
    expect(koToolTriggersOf(state, "p2", koed)).toHaveLength(1);
    const [energy] = victimEnergy(state);
    // Klefki's own printed "Joust" ({C}, 10) is what does the Knocking Out, so the
    // aura is live at the very instant the Tool reads.
    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(parked.phase.kind).toBe("effect:choose");
    const { state: after } = answer(parked, [energy as string]);
    expect(after.players.p2.bench.some((p) => p.energy.includes(energy as string))).toBe(true);
  });

  it("TWO holders on one board: the FIRST match fires, and only it", () => {
    const state = field(44, {
      bench: ["fix-bigbody", "fix-titan"],
      holder: 0,
      secondHolder: 1,
    });
    const koed = state.players.p2.active?.stack.at(-1) as string;
    expect(koToolTriggersOf(state, "p2", koed)).toHaveLength(2);
    const [energy] = victimEnergy(state);
    const { state: parked } = mustApply(state, bite);
    if (parked.phase.kind !== "effect:choose") throw new Error("expected a park");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "moveEnergy") throw new Error("expected moveEnergy");
    // ONE destination — the first holder — not two. A second parking trigger
    // chained behind the first is the same follow-up the board triggers defer.
    expect(prompt.destinations).toEqual([{ seat: "p2", spot: { spot: "bench", index: 0 } }]);
    const { state: after, events } = answer(parked, [energy as string]);
    expect(events.filter((e) => e.type === "ENERGY_MOVED")).toHaveLength(1);
    expect(after.players.p2.bench[0]?.energy).toContain(energy);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The VOICE — what a reader is told.
// ─────────────────────────────────────────────────────────────────────────────

describe("the voice", () => {
  it("⚠️ the ENERGY_MOVED row names the DYING Pokémon by UID, not by its spot", () => {
    // The defect this slice found: `logFromEvents` renders against the POST-state,
    // where `{spot:"active"}` no longer names the source — on a board that
    // auto-promotes it names the Pokémon that REPLACED it. The event carries
    // `fromUid`, and the row reads it.
    const state = field(51, { bench: ["fix-bigbody"] });
    const [energy] = victimEnergy(state);
    const { state: parked } = mustApply(state, bite);
    const { state: after, events } = answer(parked, [energy as string]);
    const moved = find(events, "ENERGY_MOVED");
    expect(moved?.fromUid).toBe(parked.players.p2.active?.stack.at(-1));
    const rows = render(events, after);
    expect(rows.some((r) => r.text === "moved 1 energy from fix-victim to fix-bigbody")).toBe(true);
    // …and the promoted Pokémon is NOT what the row names, which is the whole
    // point (the sole benched body was force-promoted by the KO).
    expect(rows.every((r) => !r.text.includes("from fix-bigbody to fix-bigbody"))).toBe(true);
  });

  it("emits NO ABILITY_TRIGGERED row — a Tool has no Ability to trigger", () => {
    // D141's rule at the neighbouring recoil arm, verbatim: the prompt and the
    // ENERGY_MOVED row are the whole of what a reader is told.
    const state = field(52);
    const [energy] = victimEnergy(state);
    const { state: parked, events: parkEvents } = mustApply(state, bite);
    expect(types(parkEvents)).not.toContain("ABILITY_TRIGGERED");
    const { events } = answer(parked, [energy as string]);
    expect(types(events)).not.toContain("ABILITY_TRIGGERED");
  });

  it("Energy Switch's own row is UNCHANGED — the uid renders identically", () => {
    // The regression half: `fromUid` is emitted on every move, so the pre-existing
    // producer must render byte-identically. Same event, same sentence.
    const rows = render(
      [
        {
          type: "ENERGY_MOVED",
          seat: "p1",
          // 🆕 D443 — `actor === seat` is the own-board reading, and this rung is
          // now also the CONTROL for the cross-board arm: it pins that the row a
          // same-seat move renders is byte-identical to the one it rendered before
          // the field existed.
          actor: "p1",
          uids: ["e1"],
          from: { spot: "bench", index: 0 },
          to: { spot: "active" },
        },
      ],
      field(53),
    );
    expect(rows[0]?.text).toBe("moved 1 energy from fix-bigbody to fix-attacker");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The structural questions.
// ─────────────────────────────────────────────────────────────────────────────

describe("the structural questions", () => {
  it('⚠️ `attachTool` no longer keys "simulated" on `passive` alone', () => {
    // The gate that belonged to ONE term (D169's lesson, second sighting): every
    // Tool authored before this one expressed its sentence as continuous numbers,
    // so "has a passive" and "is simulated" were the same predicate by accident.
    // Exp. Share has NO passive — the old gate would have refused to attach a card
    // the engine fully simulates.
    let state = driveSetup(61, { p1: EXP_SHARE_DECK, p2: EXP_SHARE_DECK }, { first: "p1" });
    state = handFromDeck(state, "p1", "sv01-174", 1);
    const uid = handUid(state, "p1", "sv01-174");
    const { state: after, events } = mustApply(state, {
      type: "attachTool",
      seat: "p1",
      uid,
      target: { spot: "active" },
    });
    expect(types(events)).toContain("TOOL_ATTACHED");
    expect(after.players.p1.active?.tools).toContain(uid);
    // …and the OTHER term still holds: an unauthored Tool is still refused.
    expect(programFor("sv01-174")?.passive).toBeUndefined();
    expect(programFor("sv01-193")?.passive).toBeDefined();
  });

  it("PARK? YES. PERSIST? NO — `MATCH_RECORD_VERSION` stays 11", () => {
    // D124's test is DIRECTIONAL: can the PREVIOUS deploy's record hold the shape
    // the new code expects? `GameState.pending` IS persisted — a park mid-attack
    // is a live, reachable, stored position — but an old record cannot CONTAIN a
    // `koToolTrigger` (nothing wrote one), and every kind it can contain is still
    // handled. The `moveEnergy` `route` change is a WIDENED ENUM on an op that can
    // sit in `phase.cont`, which D124 explicitly excludes; no REQUIRED field was
    // added to anything persisted. The absolute value is pinned in
    // `apps/api/src/lobby/match.test.ts`; this case pins the REASON.
    const state = field(62);
    const { state: parked } = mustApply(state, bite);
    // The park is a resting state that a record would hold…
    expect(parked.phase.kind).toBe("effect:choose");
    // …and the queue behind it holds NO new stage kind: the koToolTrigger popped
    // itself before running, so the stored `pending` is entirely pre-D171 kinds.
    expect(parked.pending.map((s: PendingStage) => s.kind)).toEqual(["attackEpilogue"]);
    // The one place the new kind is observable is BETWEEN the seed and the drain,
    // which no action boundary can land inside.
    if (parked.phase.kind !== "effect:choose") throw new Error("expected a park");
    expect(parked.phase.cont.pendingOp?.op).toBe("moveEnergy");
  });

  it("gates no action, and the reducer refuses nothing new", () => {
    // No error code was added and no action path acquired a check: the whole
    // mechanism lives between two stages of a tail the player never addresses.
    const state = field(63);
    const [energy] = victimEnergy(state);
    const { state: parked } = mustApply(state, bite);
    // The only new refusal surface is the shared moveEnergy validator, and it is
    // the pre-existing one: a uid that was never offered.
    expectErr(
      parked,
      {
        type: "resolveEffect",
        seat: "p2",
        choice: { kind: "moveEnergy", picks: [{ uid: "not-a-uid", dest: destinationOf(parked) }] },
      },
      "BAD_EFFECT_CHOICE",
    );
    // …and the legal answer still works from the same board.
    const { events } = answer(parked, [energy as string]);
    expect(types(events)).toContain("ENERGY_MOVED");
  });

  it("the wire projection needs no new shape — the prompt is the existing one", () => {
    const state = field(64);
    const { state: parked } = mustApply(state, bite);
    const view = redactGame(parked, "p2");
    expect(view.phase.kind).toBe("effect:choose");
    if (view.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(view.phase.prompt?.kind).toBe("moveEnergy");
    // The route is invisible on the wire: the client sees the same compound
    // decision Energy Switch produces, with a one-entry destination list.
    if (view.phase.prompt?.kind !== "moveEnergy") throw new Error("expected moveEnergy");
    expect(view.phase.prompt.destinations).toHaveLength(1);
    expect(view.phase.prompt.max).toBe(1);
    // A SPECTATOR never sees a prompt whose candidates it could not answer.
    const spectator = redactGame(parked, "p2", true);
    if (spectator.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(spectator.phase.prompt).toBeNull();
  });

  it("a deep-frozen board is never mutated by any of it", () => {
    const state = deepFreeze(field(65));
    const [energy] = victimEnergy(state);
    const { state: parked } = mustApply(state, bite);
    expect(() => answer(deepFreeze(parked), [energy as string])).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The family, after D171.
// ─────────────────────────────────────────────────────────────────────────────

describe("the KO-antecedent family after D171", () => {
  it("every authored member of the family is accounted for, by SITE", () => {
    // Three sentences, three sites, and the sites are different BECAUSE the
    // consequents are — which is this family's whole lesson across D158/D164/D171.
    const sites: Record<string, string> = {
      "sv03-197": "passive.damageAttackerOnKo → flow.ts koRecoilOf (synchronous)",
      "sv06.5-037": "triggered.onKoPrizeReduction → flow.ts planPrizes (inside the sweep)",
      "sv01-174": "triggered.onAllyActiveKnockOut → flow.ts runKoToolTrigger (before the sweep)",
    };
    expect(programFor("sv03-197")?.passive?.damageAttackerOnKo).toBeDefined();
    expect(programFor("sv06.5-037")?.triggered?.[0]?.onKoPrizeReduction).toBeDefined();
    expect(programFor("sv01-174")?.triggered?.[0]?.trigger).toBe("onAllyActiveKnockOut");
    expect(Object.keys(sites)).toHaveLength(3);
    // The one deliberate abstention stays an abstention.
    expect(programFor("sv01-114")?.triggered).toBeUndefined();
  });

  it("`onAllyActiveKnockOut` has exactly ONE producer, and it is a Tool", () => {
    const producers: string[] = [];
    for (const id of Object.keys(FIXTURE_POOL)) {
      for (const t of programFor(id)?.triggered ?? []) {
        if (t.trigger === "onAllyActiveKnockOut") producers.push(id);
      }
    }
    expect(producers).toEqual(["sv01-174"]);
    expect(FIXTURE_POOL["sv01-174"]?.trainerType).toBe("Tool");
  });

  it("the new route has exactly ONE producer, and it is never a top-level play", () => {
    // `moveEnergyPlayable` has no context, so this route offers no destination
    // there — a Trainer authored with it would be refused as a would-only-whiff
    // play, which is correct: it is reachable only from a Tool's on-KO trigger.
    const routed: string[] = [];
    for (const id of Object.keys(FIXTURE_POOL)) {
      const program = programFor(id);
      const ops = [
        ...(program?.trainer ?? []),
        ...(program?.triggered ?? []).flatMap((t) => t.program),
      ];
      for (const op of ops) {
        if (op.op === "moveEnergy" && op.route === "koedActiveToToolHolder") routed.push(id);
      }
    }
    expect(routed).toEqual(["sv01-174"]);
    expect(programFor("sv01-174")?.trainer).toBeUndefined();
  });
});
