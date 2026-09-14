import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import {
  deriveAttackEffect,
  splitAttackGateClause,
  splitAttackTrailingClause,
} from "./effects";
import { applyAction, createGame, engineVersion, otherSeat, programFor } from "./index";
import type { EffectOp, GameEvent, GameState, InPlayPokemon, Seat } from "./index";
import { runProgram } from "./interpreter";
import { type LogContext, logFromEvents } from "./log";
import {
  FIXTURE_POOL,
  attachFromDeck,
  attachToolFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  deepFreeze,
  firstBasicInHand,
  handFromDeck,
  handUid,
  must,
  mustApply,
  setActiveFromDeck,
  setConditions,
  setDamage,
  types,
} from "./testFixtures";
import { koByEffectMarker, scheduledEffectDue, withActive } from "./types";

// 0.336.0 → 0.337.0 — 🆕🆕 D435: THE DELAYED FAMILY CLOSED, and the distinction the
// two new payloads exist to keep apart is A PRIZE CARD.
//
//   row  53 (1 printing)  "At the end of your opponent's next turn, discard the
//                          Defending Pokémon and all attached cards."
//   row 113 (2 printings) "Discard all Energy from this Pokémon. At the end of your
//                          opponent's next turn, the Defending Pokémon will be
//                          Knocked Out."
//
// 🛑 **DISCARD AND KNOCK OUT ARE DIFFERENT EVENTS WITH DIFFERENT CONSEQUENCES, AND
// THE RULE SAYS SO IN ONE SENTENCE.** `docs/reference/ptcg-rules.md` §8.1: *"The
// player **who KO'd** the Pokémon **takes prize card(s)**"*. The Prize is owed by the
// Knock Out and by nothing else. On the board the two payloads are indistinguishable
// — the body leaves play, the Active Spot empties, a promotion is owed — and they
// differ on exactly one row of the prize track. §12 drives that on ONE axis.
//
// D435 adds: TWO anchors (`DELAYED_DEFENDER_DISCARD`, `DELAYED_DEFENDER_KO` — the
// second BARE, so `splitAttackTrailingClause`'s shadow refusal cannot take the
// compound whole), TWO arms (5g, 5h), TWO field-free `EffectOp`s
// (`scheduleDiscard`, `scheduleKnockOut`), TWO `stepOp` cases, ONE shared installer
// (`scheduleDelayed` — D434's inline body factored rather than copied, D416's rule),
// the `ScheduledCounters` → `ScheduledEffect` DISCRIMINATED UNION with its field and
// reader renamed, `COUNTERS_SCHEDULED` → `EFFECT_SCHEDULED` carrying the record, TWO
// new log rows, a THREE-ARM firing site, and `orphanedPromotions` — D311/D312's
// promotion filter HOISTED to a third caller, exactly as D312 said it should be.
// `MATCH_RECORD_VERSION` 28 → 29.
//
// 🛑 **D434's REFUSAL RUNG PAID OUT.** It measured `splitAttackTrailingClause`
// refusing row 113 *because no anchor claimed its tail* and left a rung that would
// redden the day one did. It reddened on that exact line, and §1 re-points it onto the
// split's exact halves rather than onto `not.toBeNull()` (D418).
//
// 0.335.0 → 0.336.0 — 🆕🆕 D434: THE DELAYED EFFECT, and the first thing this
// engine SCHEDULES rather than resolves.
//
//   "At the end of your opponent's next turn, put 9 damage counters on the
//    Defending Pokémon."
//
// **1 sentence / 3 legal printings** — `censusAttackCorpus.ts` row 54. ONE anchor
// (`DELAYED_DEFENDER_COUNTERS`), ONE arm in `deriveAttackEffect` (5f), ONE
// `EffectOp` (`scheduleCounters`), ONE `stepOp` case, ONE interpreter installer,
// ONE new record type (`ScheduledEffect`), ONE new REQUIRED `InPlayPokemon` field
// (`scheduledEffect`), ONE new reader (`scheduledEffectDue`), ONE new event
// (`COUNTERS_SCHEDULED`) with ONE log row, ONE new `COUNTERS_PLACED` source
// (`"delayed"`) with ONE log row, ONE FIRING SITE in the §13 Checkup, and FIVE
// `InPlayPokemon` literals.
//
// 🛑 **A STAMP ALONE IS INERT, AND THAT IS THE SHAPE OF THIS SLICE.** Every other
// durated record on `InPlayPokemon` is read by code that was going to run anyway —
// §8.5 asks `installedReductionOf` while computing a hit, §11 asks `retreatLocked`
// while validating a retreat. NOTHING reads this one. So the build is a stamp PLUS
// a firing site (flow.ts `runCheckup`), and either half alone is a program that
// resolves, emits its row, persists its record and never places a counter — D407's
// built-but-dead defect wearing a green suite. Both halves carry their own mutant.
//
// 🛑 **`MATCH_RECORD_VERSION` 27 → 28, AND THE REASON IS D432's ARRIVED AT FROM THE
// OPPOSITE PREMISE.** D432 bumped because its record was ONE NUMBER with no rest,
// so D421's *"choose the rest of the record so that losing the key is detectable"*
// had nothing to work with. **This record HAS a rest — a turn AND an amount — and
// the road is still unavailable**, because the rest D421 means is the rest that
// ALREADY EXISTS in records a previous deploy wrote. Both keys here arrive in the
// same deploy, so they cannot witness each other's loss: a v27 record has no
// `scheduledEffect` at all, not a `scheduledEffect` missing one key. **A "rest"
// must be OLD, not merely PLURAL.** §8 drives BOTH directions, including the soft
// landing the constant refuses.
//
// 🛑 **THE §10 STORY IS INVERTED, WHICH IS THE OTHER FINDING.** Every neighbouring
// durated field has its window on the OPPONENT's turn, so its holder's controller
// cannot retreat or evolve inside it and three of its four clears are written for
// the rule rather than for a board. This record fires at the end of the HOLDER's
// OWN next turn, so retreat, a Switch and EVOLVING are all live lines of play
// inside the window — and all three are the victim's printed counterplay. §7 drives
// every one of them, plus the Knock Out that takes the body out of play with it.

const SENTENCE = "At the end of your opponent's next turn, put 9 damage counters on the Defending Pokémon.";
/** Corpus row 53 — the family's DISCARD payload, 1 legal printing, deliberately
    unbuilt. A one-axis near-miss (same clock, same subject, different payload) and
    this suite's loud `ATTACK_EFFECT_SKIPPED` witness. */
const SIBLING_DISCARD =
  "At the end of your opponent's next turn, discard the Defending Pokémon and all attached cards.";
/** Corpus row 113 — the family's KNOCK-OUT payload, 2 legal printings, a COMPOUND
    whose head D431 already claims. The composition question, driven in §1. */
const SIBLING_KO =
  "Discard all Energy from this Pokémon. At the end of your opponent's next turn, the Defending Pokémon will be Knocked Out.";
const SIBLING_KO_TAIL =
  "At the end of your opponent's next turn, the Defending Pokémon will be Knocked Out.";

const DELAY = 0; // {C}, NO damage, corpus row 54 — the COUNTERS payload (D434)
const PLAIN = 1; // {C}, NO damage, NO effect — the ONE-AXIS control
const DISCARD = 2; // {C}, NO damage, corpus row 53 — 🆕🆕 the DISCARD payload (D435)
const POISON = 3; // {C}, NO damage, "…is now Poisoned." — the ordering board's other clock
const SMASH = 4; // {C}, 90 damage, NO effect — the ATTACK-KO control for the cause rung
const DEVOLVE = 5; // {C}, NO damage, D433's sweep — the fourth §10 literal's driver
// 🆕🆕 D435 — the KNOCK-OUT payload, driven two ways on purpose.
const DOOM = 6; // {C}, NO damage, the BARE TAIL of row 113 — the payload in isolation
const COMPOUND = 7; // {C}, NO damage, the PRINTED WHOLE of row 113 — the composition
const NEAR_MISS = 8; // {C}, NO damage, a constructed unclaimed sentence — the loud witness

/** 🆕🆕 D435's loud-path witness, and it is CONSTRUCTED rather than taken off the
    catalog — because D434's witness (corpus row 53) is now BUILT and this suite would
    otherwise have no `ATTACK_EFFECT_SKIPPED` case at all. One token off `SENTENCE`
    (the clock: *During* rather than *At the end of*), which is the ONE-axis rule, and
    no printing carries it. */
const NEAR_MISS_TEXT =
  "During your opponent's next turn, put 9 damage counters on the Defending Pokémon.";

/** The ids are `fix-*` keys with no catalog row behind them — the three cards that
    PRINT row 54 are unresolvable in this checkout (no D1) and are stated unresolved
    rather than invented (D425). */
const LOCAL_CARDS: Record<string, Card> = {
  "fix-doom": battler("fix-doom", {
    types: ["Colorless"],
    hp: 300,
    retreat: 1,
    attacks: [
      { cost: ["Colorless"], name: "Doom Clock", effect: SENTENCE },
      { cost: ["Colorless"], name: "Plain Clock" },
      { cost: ["Colorless"], name: "Doom Sweep", effect: SIBLING_DISCARD },
      {
        cost: ["Colorless"],
        name: "Doom Venom",
        effect: "Your opponent's Active Pokémon is now Poisoned.",
      },
      { cost: ["Colorless"], name: "Doom Smash", damage: 90 },
      {
        cost: ["Colorless"],
        name: "Doom Regression",
        effect:
          "Devolve each of your opponent's evolved Pokémon by shuffling the highest Stage Evolution card on it into your opponent's deck.",
      },
      // 🆕🆕 D435 — the KNOCK-OUT payload alone. It prints STANDALONE on zero cards
      // (both printings are the tail of the compound below), so this attack is a
      // CONSTRUCTED board and is marked as one: it exists so the payload can be driven
      // without the head's Energy discard moving the board underneath it.
      { cost: ["Colorless"], name: "Doom Sentence", effect: SIBLING_KO_TAIL },
      // 🆕🆕 D435 — and the PRINTED WHOLE, which is what the catalog actually carries.
      // Served by `splitAttackTrailingClause`, not by a whole-sentence anchor.
      { cost: ["Colorless"], name: "Doom Purge", effect: SIBLING_KO },
      { cost: ["Colorless"], name: "Doom Miss", effect: NEAR_MISS_TEXT },
    ],
  }),
  /** 90 HP EXACTLY — nine counters is lethal to the digit, so the KO cannot be
      satisfied by an accidental extra source. No Weakness and no Resistance, so 90
      placed is 90 taken. */
  "fix-doomed": battler("fix-doomed", { types: ["Colorless"], hp: 90, retreat: 1 }),
  /** The Stage 1 the victim evolves into — §7's EVOLVE clear, which for this field
      is a played line rather than a theoretical one. */
  "fix-doomed-s1": battler("fix-doomed-s1", {
    types: ["Colorless"],
    hp: 160,
    retreat: 1,
    stage: "Stage1",
    evolveFrom: "fix-doomed",
  }),
  /** 300 HP — the NON-KO control, and the ordering board's body (it must survive
      90 delayed + 10 poison + 20 burn without the batch's KO sweep firing). */
  "fix-doom-tank": battler("fix-doom-tank", { types: ["Colorless"], hp: 300, retreat: 1 }),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

/** Its OWN deck (D270's rule, and D412's warning about widening a shared one):
    8+8+4+6+4+4+4+6+16 = 60, counted before the first run.
      • `fix-doom` — the demonstrator, five indices;
      • `fix-doomed` (90 HP) / `fix-doomed-s1` — the exact-lethal victim and the
        evolution §7 walks it into;
      • `fix-doom-tank` (300 HP) — the non-KO control and the ordering board;
      • `sv01-194` Switch (Item) — §7's FORCED-SWITCH clear, `switchInto`'s literal;
      • `sv03-197` Vengeful Punch — the KO-conditioned recoil §6 is about, reused
        rather than re-fixtured so this suite and `devolveEach.test.ts` argue about
        one card;
      • `fix-mist-energy` — Mist Energy `sv05-161`'s §11 effects-only shield, the
        cheapest live `preventAttackEffects` in the pool (§9);
      • `fix-titan` (340 HP, no attacks) — bench filler nothing here can Knock Out,
        the promote target, and the mulligan-free starter;
      • `fix-energy` — Colorless Basic: every printed cost in this deck is {C}. */
const DOOM_DECK = deckOf({
  "fix-doom": 8,
  "fix-doomed": 8,
  "fix-doomed-s1": 4,
  "fix-doom-tank": 6,
  "sv01-194": 4,
  "sv03-197": 4,
  "fix-mist-energy": 4,
  "fix-titan": 6,
  "fix-energy": 16,
});

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

function all<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

function count(events: GameEvent[], type: GameEvent["type"]): number {
  return events.filter((e) => e.type === type).length;
}

function body(pokemon: InPlayPokemon | null | undefined): InPlayPokemon {
  if (pokemon === null || pokemon === undefined) throw new Error("expected a Pokémon");
  return pokemon;
}

/** The stack-BOTTOM uid — the identity a body keeps across an evolution, and the
    uid every event in this suite names for an unevolved one. */
function baseUid(pokemon: InPlayPokemon | null | undefined): string {
  const uid = body(pokemon).stack[0];
  if (uid === undefined) throw new Error("expected a non-empty stack");
  return uid;
}

function localSetup(seed: number, first: Seat): GameState {
  const created = createGame({ seed, decks: { p1: DOOM_DECK, p2: DOOM_DECK }, cardPool: POOL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(
    applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first }),
  );
  while (state.phase.kind === "setup:drawExtra") {
    const phase = state.phase;
    const seat = (["p1", "p2"] as const).find((s) => !phase.decided[s]);
    if (seat === undefined) throw new Error("setup:drawExtra with every seat decided");
    state = must(applyAction(state, { type: "setupDrawExtra", seat, count: phase.owed[seat] }));
  }
  for (const seat of ["p1", "p2"] as const) {
    state = must(
      applyAction(state, { type: "setupPlaceActive", seat, uid: firstBasicInHand(state, seat) }),
    );
  }
  for (const seat of ["p1", "p2"] as const) {
    state = must(applyAction(state, { type: "setupReady", seat }));
  }
  return state;
}

/** `installer` owns TURN 2 with one {C} on its `fix-doom`; the victim's Active has
    already been surgically set to `victimCard` with one {C} of its own. The seat
    that goes FIRST is the victim, and it ends turn 1 immediately — §4 forbids the
    going-first player's turn-1 attack, and this way the installer's attack lands on
    turn 2 so the schedule's stamp is 3 and the victim's own turn 3 is its window.

    Every board here is seed-free by construction up to the Checkup: nothing this
    suite declares flips a coin during a turn, and every Active, bench body and
    attachment is placed by surgery. */
function armed(installer: Seat, victimCard = "fix-doomed", seed = 4): GameState {
  const victimSeat = otherSeat(installer);
  let state = localSetup(seed, victimSeat);
  state = mustApply(state, { type: "endTurn", seat: victimSeat }).state;
  expect(state.turn).toBe(2);
  state = setActiveFromDeck(state, victimSeat, victimCard);
  state = setActiveFromDeck(state, installer, "fix-doom");
  state = attachFromDeck(state, installer, "fix-energy", 1);
  state = attachFromDeck(state, victimSeat, "fix-energy", 1);
  // ONE benched body on the victim's side: a lone promotion is FORCED and
  // auto-resolves (the M1 doctrine), which keeps §5's KO board from parking on a
  // promote choice this slice has nothing to say about. §5 drives the parked prize
  // pick, which is the decision the KO really does owe.
  state = clearBench(state, victimSeat);
  return benchFromDeck(state, victimSeat, "fix-titan");
}

/** The installer declares `index` on turn 2 (which ENDS its turn, §5.3). */
function install(installer: Seat, index = DELAY, victimCard = "fix-doomed", seed = 4) {
  return mustApply(armed(installer, victimCard, seed), {
    type: "attack",
    seat: installer,
    index,
  });
}

/** The victim ends turn 3 — the Checkup that follows is the one the schedule names. */
function endVictimTurn(state: GameState, victimSeat: Seat) {
  expect(state.turn).toBe(3);
  return mustApply(state, { type: "endTurn", seat: victimSeat });
}

/** Rendered log rows as `{ who, text }`, the idiom every sibling suite uses. */
function render(events: GameEvent[], state: GameState): { who: string; text: string }[] {
  const ctx: LogContext = { names: { p1: "Ana", p2: "Ben" }, state, elapsed: "+00:14" };
  return logFromEvents(events, ctx).flatMap((entry) =>
    entry.kind === "turn"
      ? []
      : [{ who: entry.who, text: entry.segments.map((seg) => seg.text).join("") }],
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// §1 — the sentence, the family, and what does NOT compose.
// ─────────────────────────────────────────────────────────────────────────────
describe("§1 — one sentence, three printings, and the family read to its edges", () => {
  it("the corpus carries the sentence at 3 legal printings, off the live corpus", () => {
    const rows = legalAttackCorpus().filter(([, text]) => text === SENTENCE);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.[0]).toBe(3);
  });

  it("🛑 the WHOLE family is three sentences / six printings — the loosest pattern, every hit read", () => {
    // The pattern is `/at the end of/i` over all 640 committed sentences. Stated so
    // the next reader can see its edges rather than inheriting a blind spot (D424),
    // and asserted off the LIVE corpus so the claim cannot rot into prose.
    const hits = legalAttackCorpus().filter(([, text]) => /at the end of/i.test(text));
    expect(hits.map(([, text]) => text).sort()).toEqual(
      [SIBLING_DISCARD, SENTENCE, SIBLING_KO].sort(),
    );
    expect(hits.reduce((sum, [units]) => sum + units, 0)).toBe(6);
  });

  it("⚠️ the LOOSER stem `/end of/i` catches a fourth row, and it is a DURATION, not a schedule", () => {
    // D433's rule about grepping a concept two ways, applied to this family: the
    // narrower pattern above is the one the family is defined by, and the wider one
    // is what proves the narrowing is not hiding a member. The extra row prints
    // "Until the end of your NEXT turn" — a window on a continuous fact, with no
    // moment at which anything fires — so it belongs to the `noWeaknessTurn` family
    // and not to this one.
    const wider = legalAttackCorpus().filter(([, text]) => /end of/i.test(text));
    const extra = wider.map(([, text]) => text).filter((t) => !/at the end of/i.test(t));
    expect(extra).toEqual([
      "Until the end of your next turn, the Defending Pokémon's Weakness is now {C}. (The amount of Weakness doesn't change.)",
    ]);
  });

  it("🆕🆕 D435 — all THREE payloads derive, and each to its OWN op", () => {
    expect(deriveAttackEffect(SENTENCE)).toEqual([{ op: "scheduleCounters", amount: 90 }]);
    expect(deriveAttackEffect(SIBLING_DISCARD)).toEqual([{ op: "scheduleDiscard" }]);
    expect(deriveAttackEffect(SIBLING_KO_TAIL)).toEqual([{ op: "scheduleKnockOut" }]);
    expect(resolvedByAnyReader(SENTENCE)).toBe(true);
    expect(resolvedByAnyReader(SIBLING_DISCARD)).toBe(true);
    expect(resolvedByAnyReader(SIBLING_KO_TAIL)).toBe(true);
    // 🛑 THE COMPOUND ITSELF IS STILL NOT CLAIMED WHOLE, AND THAT IS THE DESIGN.
    // `resolvedByAnyReader` asks the twelve WHOLE-SENTENCE readers; row 113 is served
    // by the SPLITTER instead (next rung). A `true` here would mean the bare anchor
    // had been written wide enough to swallow the head, which is exactly the shadow
    // refusal `splitAttackTrailingClause` exists to prevent.
    expect(resolvedByAnyReader(SIBLING_KO)).toBe(false);
  });

  /** 🆕🆕 **D435 — D434's REFUSAL RUNG, RE-POINTED ONTO THE COMPOSITION IT PREDICTED
      (D418: re-point, do not delete — AND say what the old claim caught).**

      D434 asserted `splitAttackTrailingClause(SIBLING_KO) === null` and wrote its own
      expiry date: *"the rung reddens and the compound composes free the day a
      successor claims that tail."* It did, on the exact line, which is what makes
      D428's executable-falsifier rule pay rather than merely sound good.

      🛑 **WHAT THE OLD CLAIM COULD CATCH THAT THE NEW ONE CANNOT, AND HOW IT IS
      REPLACED.** The old rung was a NEGATIVE (*"nothing claims this tail"*) and would
      have gone red if any anchor had crept wide enough to claim it. The replacement
      asserts the SPLIT'S SHAPE — the exact head, the exact tail and the exact composed
      program — which reddens on a build whose bare anchor swallowed the head (the head
      would then be empty and the split refused) AND on a build that lost the tail arm.
      A bare `not.toBeNull()` would have been the D418 defect verbatim: true under the
      real build and under a build whose anchor claimed the whole sentence alike. */
  it("🛑 ROW 113 COMPOSES — the split's exact halves, and the exact composed program", () => {
    // D426's mechanism, arriving: `splitAttackTrailingClause` composes when
    // `deriveAttackEffect` already reads the TAIL. D431 claims the head; D435 claims
    // the tail; the compound is served with no change to `attack.ts` at all.
    expect(splitAttackTrailingClause(SIBLING_KO)).toEqual({
      head: "Discard all Energy from this Pokémon.",
      tail: SIBLING_KO_TAIL,
    });
    // …and each half on its own axis, so a failure names WHICH half moved.
    expect(deriveAttackEffect("Discard all Energy from this Pokémon.")).not.toBeNull();
    expect(deriveAttackEffect(SIBLING_KO_TAIL)).toEqual([{ op: "scheduleKnockOut" }]);
    // 🛑 AND THE COMPOSITION END TO END ON A REAL BOARD, because the composed program
    // is assembled inside `attack.ts` and is not a value any accessor exposes: the
    // printed WHOLE is declared, the HEAD's Energy discard happens AND the TAIL's
    // appointment lands, with nothing on the loud path. Both halves are asserted
    // because a build that lost either one would still pass a one-sided rung.
    const composed = install("p1", COMPOUND);
    expect(count(composed.events, "ATTACK_EFFECT_SKIPPED")).toBe(0);
    expect(body(composed.state.players.p1.active).energy).toEqual([]);
    expect(body(composed.state.players.p2.active).scheduledEffect).toEqual({
      turn: 3,
      kind: "knockOut",
    });
  });

  it("no gate clause hides inside the sentence either", () => {
    expect(splitAttackGateClause(SENTENCE)).toBeNull();
    expect(splitAttackTrailingClause(SENTENCE)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — the anchor claims the sentence WHOLE, and each near-miss differs on ONE axis.
// ─────────────────────────────────────────────────────────────────────────────
describe("§2 — the anchor's edges, one axis at a time", () => {
  it("the printed 9 is a CAPTURE — other counts derive, and 0 is refused", () => {
    expect(deriveAttackEffect(SENTENCE.replace("9 damage", "3 damage"))).toEqual([
      { op: "scheduleCounters", amount: 30 },
    ]);
    expect(deriveAttackEffect(SENTENCE.replace("9 damage", "12 damage"))).toEqual([
      { op: "scheduleCounters", amount: 120 },
    ]);
    // ⚠️ THE ADMITTED CASE ABOVE IS WHAT MAKES THIS REFUSAL MEAN ANYTHING (D424):
    // a reader that refused everything would pass the next line too.
    expect(deriveAttackEffect(SENTENCE.replace("9 damage", "0 damage"))).toBeNull();
  });

  it("the possessive apostrophe is a CLASS — both bytes derive identically", () => {
    // The committed corpus row spells U+0027, checked byte-wise rather than
    // remembered (D421). D136/D137's rule is that a re-ingest can normalise it.
    expect(SENTENCE.includes("opponent's")).toBe(true);
    expect(deriveAttackEffect(SENTENCE.replace("opponent's", "opponent’s"))).toEqual([
      { op: "scheduleCounters", amount: 90 },
    ]);
  });

  it("each near-miss differs on exactly ONE axis, and every one is refused", () => {
    // D427: a near-miss that differs on more than one axis tests nothing about
    // either. Each line below changes ONE token of the printed sentence.
    const misses = [
      // the CLOCK: during, not at the end of
      SENTENCE.replace("At the end of your opponent's", "During your opponent's"),
      // the SEAT: your own next turn
      SENTENCE.replace("your opponent's next turn", "your next turn"),
      // the SUBJECT: this Pokémon, not the Defending one
      SENTENCE.replace("the Defending Pokémon", "this Pokémon"),
      // the PAYLOAD: heal, not put
      SENTENCE.replace("put 9 damage counters on", "heal 90 damage from"),
      // the UNIT: damage, not counters
      SENTENCE.replace("9 damage counters on", "90 damage to"),
    ];
    for (const text of misses) expect(deriveAttackEffect(text), text).toBeNull();
    // …and the ADMITTED control on the same axis, so the rung above cannot pass by
    // a reader that refuses everything.
    expect(deriveAttackEffect(SENTENCE)).not.toBeNull();
  });

  it("the anchor is whole-sentence — a prefix or a suffix is refused", () => {
    expect(deriveAttackEffect(`Draw a card. ${SENTENCE}`)).toBeNull();
    expect(deriveAttackEffect(`${SENTENCE} Draw a card.`)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — what the INSTALL writes, and what it announces.
// ─────────────────────────────────────────────────────────────────────────────
describe("§3 — the schedule lands on the DEFENDING Pokémon with the opponent's turn stamped", () => {
  it("the record is `{ turn: state.turn + 1, amount: 90 }` on the DEFENDER's Active", () => {
    const { state, events } = install("p1");
    const scheduled = body(state.players.p2.active).scheduledEffect;
    expect(scheduled).toEqual({ turn: 3, kind: "counters", amount: 90 });
    // …and the INSTALLER's own body carries nothing: bare means the defender.
    expect(body(state.players.p1.active).scheduledEffect).toBeNull();
    const row = find(events, "EFFECT_SCHEDULED");
    expect(row).toEqual({
      type: "EFFECT_SCHEDULED",
      seat: "p2",
      uid: baseUid(state.players.p2.active),
      scheduled: { turn: 3, kind: "counters", amount: 90 },
    });
  });

  it("the reader answers only on the stamped turn — driven in both directions", () => {
    const pokemon = body(install("p1").state.players.p2.active);
    expect(scheduledEffectDue(pokemon, 2)).toBeNull();
    expect(scheduledEffectDue(pokemon, 3)).toEqual({ turn: 3, kind: "counters", amount: 90 });
    expect(scheduledEffectDue(pokemon, 4)).toBeNull();
    // …and an unscheduled body answers `null` for every turn, which is what makes
    // "no schedule" and "a spent schedule" one answer at the read site.
    const fresh = body(armed("p1").players.p2.active);
    expect(fresh.scheduledEffect).toBeNull();
    expect(scheduledEffectDue(fresh, 3)).toBeNull();
  });

  it("the log row names the amount in HP and the turn from the VICTIM's side", () => {
    const { state, events } = install("p1");
    expect(render(events, state).find((r) => r.text.includes("scheduled"))).toEqual({
      who: "p2",
      text: "fix-doomed has 90 damage scheduled for the end of your next turn",
    });
  });

  /** 🆕🆕 **D435 RE-POINTED THIS RUNG, AND IT NAMES WHAT THE OLD CLAIM COULD CATCH
      THAT THE NEW ONE CANNOT (D418).** D434 used corpus row 53 as its loud
      `ATTACK_EFFECT_SKIPPED` witness — the one-axis near-miss whose payload no reader
      claimed. D435 BUILDS row 53, so that witness has to move rather than be deleted
      (D415), and the discrimination it provided has to be replaced rather than
      dropped. The old claim was *"a sentence one token off this anchor stays LOUD"*;
      the replacement keeps exactly that shape by using a CONSTRUCTED near-miss the
      catalog does not print (the counters payload with the clock changed to
      *"During"*), so a build whose anchors leaked would still redden here. The
      built-ness of rows 53 and 113 is asserted in §1 and §12 instead. */
  it("no ATTACK_EFFECT_SKIPPED for any of the THREE payloads — and a near-miss IS skipped", () => {
    expect(count(install("p1").events, "ATTACK_EFFECT_SKIPPED")).toBe(0);
    expect(count(install("p2").events, "ATTACK_EFFECT_SKIPPED")).toBe(0);
    expect(count(install("p1", DISCARD).events, "ATTACK_EFFECT_SKIPPED")).toBe(0);
    expect(count(install("p1", DOOM).events, "ATTACK_EFFECT_SKIPPED")).toBe(0);
    const skipped = install("p1", NEAR_MISS);
    expect(count(skipped.events, "ATTACK_EFFECT_SKIPPED")).toBe(1);
    expect(find(skipped.events, "ATTACK_EFFECT_SKIPPED")?.effect).toBe(NEAR_MISS_TEXT);
    expect(body(skipped.state.players.p2.active).scheduledEffect).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — the FIRING: it survives the opponent's turn and lands at the end of it.
// ─────────────────────────────────────────────────────────────────────────────
describe("§4 — the counters land at the end of the victim's own next turn", () => {
  for (const installer of ["p1", "p2"] as const) {
    const victim = otherSeat(installer);
    it(`both seats — ${installer} schedules, ${victim} takes 90 at the end of turn 3`, () => {
      const installed = install(installer, DELAY, "fix-doom-tank");
      // It SURVIVES the Checkup that ends the installing turn: the stamp is 3 and
      // that Checkup runs at turn 2. This is the off-by-one the shape invites.
      expect(body(installed.state.players[victim].active).damage).toBe(0);
      expect(body(installed.state.players[victim].active).scheduledEffect).toEqual({
        turn: 3,
        kind: "counters",
        amount: 90,
      });
      const fired = endVictimTurn(installed.state, victim);
      const placed = all(fired.events, "COUNTERS_PLACED").filter((e) => e.source === "delayed");
      expect(placed).toEqual([
        {
          type: "COUNTERS_PLACED",
          seat: victim,
          uid: baseUid(installed.state.players[victim].active),
          amount: 90,
          source: "delayed",
        },
      ]);
      expect(body(fired.state.players[victim].active).damage).toBe(90);
      expect(fired.state.turn).toBe(4);
    });
  }

  it("🛑 it fires ONCE — the turn after is silent, with no clear site anywhere", () => {
    const installer: Seat = "p1";
    const victim: Seat = "p2";
    const fired = endVictimTurn(install(installer, DELAY, "fix-doom-tank").state, victim);
    // The stamp is STILL on the body — nothing cleared it, which is the design
    // (`attackLockedTurn`'s rule: a stamp expires by arithmetic).
    expect(body(fired.state.players[victim].active).scheduledEffect).toEqual({
      turn: 3,
      kind: "counters",
      amount: 90,
    });
    expect(scheduledEffectDue(body(fired.state.players[victim].active), fired.state.turn)).toBe(
      null,
    );
    // Two more turn boundaries, and the damage total never moves again.
    let state = mustApply(fired.state, { type: "endTurn", seat: installer }).state;
    state = mustApply(state, { type: "endTurn", seat: victim }).state;
    expect(body(state.players[victim].active).damage).toBe(90);
  });

  it("the PLAIN control schedules nothing and the Checkup places nothing", () => {
    const installed = install("p1", PLAIN, "fix-doom-tank");
    expect(body(installed.state.players.p2.active).scheduledEffect).toBeNull();
    const fired = endVictimTurn(installed.state, "p2");
    expect(all(fired.events, "COUNTERS_PLACED")).toEqual([]);
    expect(body(fired.state.players.p2.active).damage).toBe(0);
  });

  it("the log row is a SYSTEM row, like Poison — not the victim's own voice", () => {
    const installed = install("p1", DELAY, "fix-doom-tank");
    const fired = endVictimTurn(installed.state, "p2");
    expect(render(fired.events, fired.state).find((r) => r.text.startsWith("Delayed:"))).toEqual({
      who: "system",
      text: "Delayed: 90 damage to fix-doom-tank",
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — ORDERING against the §13 condition steps.
// ─────────────────────────────────────────────────────────────────────────────
describe("§5 — a body that is Poisoned, Burned and Asleep takes the delayed counters FIRST", () => {
  /** The three conditions are placed by SURGERY rather than by three more attacks:
      what is under test is the ORDER of the Checkup's steps, and scripting three
      status attacks would put two extra Checkups (and two extra coin flips) between
      the install and the moment being measured. */
  function loaded(): GameState {
    const installed = install("p1", DELAY, "fix-doom-tank").state;
    return setConditions(installed, "p2", { poisonDamage: 10, burned: true, rotation: "asleep", confusionDamage: 30 });
  }

  it("🛑 the DELAYED row precedes poison, burn and the wake-up flip", () => {
    const fired = endVictimTurn(loaded(), "p2");
    const names = types(fired.events);
    const order = names.slice(names.indexOf("TURN_ENDED"));
    // The first four rows after the turn ends, in the engine's fixed §13 sequence
    // with the end-of-turn placement ahead of it.
    expect(order.slice(0, 5)).toEqual([
      "TURN_ENDED",
      "COUNTERS_PLACED", // D434 — "at the END OF" the turn
      "COUNTERS_PLACED", // §13.1 Poison — "During Pokémon Checkup"
      "COUNTERS_PLACED", // §13.2 Burn
      "CHECKUP_COIN_FLIP", // §13.2's cure flip
    ]);
    expect(all(fired.events, "COUNTERS_PLACED").map((e) => [e.source, e.amount])).toEqual([
      ["delayed", 90],
      ["poison", 10],
      ["burn", 20],
    ]);
    // …and the board is the sum, which is the half the ordering canNOT change:
    // damage is additive and the KO sweep runs once, for the whole batch.
    expect(body(fired.state.players.p2.active).damage).toBe(120);
  });

  it("⚠️ the ordering is a DECISION, and the control is the same board without the schedule", () => {
    // D430's rule read from the other side: here the fix and its inverse produce the
    // SAME board, and only the event sequence differs — so the claim is asserted on
    // the sequence, and this control proves the sequence is not simply "whatever the
    // Checkup already did".
    const bare = setConditions(install("p1", PLAIN, "fix-doom-tank").state, "p2", {
      poisonDamage: 10,
      burned: true,
      rotation: "asleep",
      confusionDamage: 30,
    });
    const fired = mustApply(bare, { type: "endTurn", seat: "p2" });
    expect(all(fired.events, "COUNTERS_PLACED").map((e) => e.source)).toEqual(["poison", "burn"]);
    expect(body(fired.state.players.p2.active).damage).toBe(30);
  });

  it("§13.4's paralysis clear still keys on the ended seat, with the schedule in flight", () => {
    const paralyzed = setConditions(install("p1", DELAY, "fix-doom-tank").state, "p2", {
      rotation: "paralyzed",
    });
    const fired = endVictimTurn(paralyzed, "p2");
    expect(body(fired.state.players.p2.active).conditions.rotation).toBe("none");
    expect(body(fired.state.players.p2.active).damage).toBe(90);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — the KNOCK OUT: the Prize, the promotion, and the CAUSE.
// ─────────────────────────────────────────────────────────────────────────────
describe("§6 — 90 counters onto a 90 HP body, between turns", () => {
  /** `fix-doomed` is 90 HP and the schedule is 90, so the placement is lethal to the
      digit — and it happens on the OPPONENT's turn, with no attack in flight. */
  function killed(installer: Seat = "p1") {
    const victim = otherSeat(installer);
    return { victim, fired: endVictimTurn(install(installer).state, victim) };
  }

  it("🛑 the body is Knocked Out by the Checkup's own sweep — no new KO machinery", () => {
    const { victim, fired } = killed();
    expect(find(fired.events, "KNOCKED_OUT")?.seat).toBe(victim);
    expect(count(fired.events, "KNOCKED_OUT")).toBe(1);
    // The prize pick is OWED to the installer and PARKS — six prizes, one to take.
    expect(find(fired.events, "PRIZES_OWED")).toEqual({
      type: "PRIZES_OWED",
      seat: "p1",
      count: 1,
    });
    expect(fired.state.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: 1 });
  });

  it("🛑 the Prize goes to the INSTALLER and the victim promotes — both driven", () => {
    const { victim, fired } = killed();
    const taken = mustApply(fired.state, {
      type: "takePrizes",
      seat: "p1",
      prizeIndices: [0],
    });
    expect(find(taken.events, "PRIZES_TAKEN")?.seat).toBe("p1");
    expect(taken.state.players.p1.prizes).toHaveLength(5);
    // The lone benched `fix-titan` is a FORCED promotion and auto-resolves.
    expect(find(taken.events, "POKEMON_PROMOTED")?.seat).toBe(victim);
    expect(taken.state.players[victim].bench).toHaveLength(0);
    expect(taken.state.cardIdByUid[baseUid(taken.state.players[victim].active)]).toBe("fix-titan");
    // …and the game moves on to the installer's turn, the Checkup having finished.
    expect(taken.state.turn).toBe(4);
    expect(taken.state.phase).toEqual({ kind: "turn:action", seat: "p1" });
  });

  it("the NON-KO control differs on ONE axis — a 300 HP body takes the same 90 and lives", () => {
    const fired = endVictimTurn(install("p1", DELAY, "fix-doom-tank").state, "p2");
    expect(count(fired.events, "KNOCKED_OUT")).toBe(0);
    expect(body(fired.state.players.p2.active).damage).toBe(90);
  });

  it("🛑 THE CAUSE — `byAttack` is FALSE, which is attack-applied POISON's shipped answer", () => {
    const { victim, fired } = killed();
    const marks = fired.state.lastKoMarks[victim];
    expect(marks).toHaveLength(1);
    expect(marks[0]?.byAttack).toBe(false);
    expect(fired.state.lastKoTurn[victim]).toBe(3);

    // ⚠️ THE PRECEDENT IS DRIVEN, NOT CITED (D422). A Poison applied by an attack
    // produces a Checkup Knock Out of exactly this shape, and it has answered
    // `byAttack: false` since D326 — the delayed placement inherits that reading
    // rather than making a second one. `collectKnockOuts` takes an `attackerSeat`
    // only from `finishAttack`; the Checkup passes none, and that is the whole
    // mechanism for both.
    const poisoned = install("p1", POISON).state;
    const dying = setDamage(poisoned, "p2", 80);
    const byPoison = mustApply(dying, { type: "endTurn", seat: "p2" });
    expect(find(byPoison.events, "KNOCKED_OUT")?.seat).toBe("p2");
    expect(byPoison.state.lastKoMarks.p2[0]?.byAttack).toBe(false);
  });

  it("🛑 NO `koByEffect` MARKER — this Knock Out really is BY DAMAGE", () => {
    // D414's marker exists to say *"this body went lethal WITHOUT damage"*, and
    // D433's second producer needed a `wasLethal` conjunct on top of it. Neither
    // question arises here, and the reason is not a judgement call: this op places
    // damage counters, so the body is lethally DAMAGED and the marker would be a lie.
    // Driven on a body that SURVIVES the placement, so the marker set is still
    // readable — a pre-existing marker is carried through untouched and no
    // `koByEffect` joins it.
    const installed = install("p1", DELAY, "fix-doom-tank").state;
    const probed = withActive(installed, "p2", {
      ...body(installed.players.p2.active),
      markers: ["d434-probe"],
    });
    const fired = endVictimTurn(probed, "p2");
    const after = body(fired.state.players.p2.active);
    expect(after.damage).toBe(90);
    expect(after.markers).toEqual(["d434-probe"]);
    expect(after.markers.includes(koByEffectMarker(3))).toBe(false);
  });

  it("🛑 Vengeful Punch pays NOTHING — a Checkup KO is outside the attack, and the control differs on ONE axis", () => {
    const recoil = programFor("sv03-197")?.passive?.damageAttackerOnKo?.amount ?? 0;
    expect(recoil).toBeGreaterThan(0);

    // THE DELAYED KO: the Tool is on the doomed body, the body dies, and the
    // installer's Active takes nothing — `koRecoilOf` is called by `finishAttack`
    // alone and the Checkup never reaches it.
    const armedBoard = attachToolFromDeck(armed("p1"), "p2", "active", "sv03-197");
    const installed = mustApply(armedBoard, { type: "attack", seat: "p1", index: DELAY });
    const fired = endVictimTurn(installed.state, "p2");
    expect(count(fired.events, "KNOCKED_OUT")).toBe(1);
    expect(body(fired.state.players.p1.active).damage).toBe(0);

    // THE CONTROL, differing on ONE axis — the same Tool, the same doomed body, the
    // same 90 HP, Knocked Out by an ATTACK instead of by the schedule. The recoil
    // lands, so the rung above is about the CAUSE and not about a Tool that never
    // works.
    const smashed = mustApply(armedBoard, { type: "attack", seat: "p1", index: SMASH });
    expect(count(smashed.events, "KNOCKED_OUT")).toBe(1);
    expect(body(smashed.state.players.p1.active).damage).toBe(recoil);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7 — THE BODY MAY NOT BE THERE: every absence case, decided and pinned.
// ─────────────────────────────────────────────────────────────────────────────
describe("§7 — the schedule DIES WITH THE BODY: four §10 literals plus the Knock Out", () => {
  /** Turn 3 is the victim's own turn, and every route below is legal on it — which
      is what makes this field's §10 clears the reachable case rather than the
      theoretical one every neighbour's are. */
  function inWindow(): GameState {
    const state = install("p1", DELAY, "fix-doom-tank").state;
    expect(state.turn).toBe(3);
    expect(body(state.players.p2.active).scheduledEffect).toEqual({ turn: 3, kind: "counters", amount: 90 });
    return state;
  }

  function stampOf(pokemon: InPlayPokemon | undefined): unknown {
    if (pokemon === undefined) return "MISSING";
    return pokemon.scheduledEffect;
  }

  it("1. RETREAT (turn.ts `clearOnLeavingActive`) — and the Checkup then places NOTHING", () => {
    const state = inWindow();
    const uid = baseUid(state.players.p2.active);
    const retreated = must(
      applyAction(state, {
        type: "retreat",
        seat: "p2",
        discardEnergy: (state.players.p2.active?.energy ?? []).slice(0, 1),
        promoteBenchIndex: 0,
      }),
    );
    expect(stampOf(retreated.players.p2.bench.find((p) => p.stack.includes(uid)))).toBeNull();
    // 🛑 THE CLEAR IS NOT THE CLAIM — THE SILENT CHECKUP IS. A field read alone
    // would pass on a build that cleared the record and fired off a second copy.
    const fired = mustApply(retreated, { type: "endTurn", seat: "p2" });
    expect(all(fired.events, "COUNTERS_PLACED")).toEqual([]);
    expect(body(fired.state.players.p2.active).damage).toBe(0);
    expect(
      body(fired.state.players.p2.bench.find((p) => p.stack.includes(uid))).damage,
    ).toBe(0);
  });

  it("2. FORCED SWITCH (interpreter.ts `switchInto`), via the Switch Item", () => {
    const state = handFromDeck(inWindow(), "p2", "sv01-194", 1);
    const uid = baseUid(state.players.p2.active);
    let switched = must(
      applyAction(state, {
        type: "playTrainer",
        seat: "p2",
        uid: handUid(state, "p2", "sv01-194"),
      }),
    );
    if (switched.phase.kind === "effect:choose") {
      switched = must(
        applyAction(switched, {
          type: "resolveEffect",
          seat: "p2",
          choice: { kind: "pokemon", ref: { seat: "p2", spot: { spot: "bench", index: 0 } } },
        }),
      );
    }
    expect(stampOf(switched.players.p2.bench.find((p) => p.stack.includes(uid)))).toBeNull();
    const fired = mustApply(switched, { type: "endTurn", seat: "p2" });
    expect(all(fired.events, "COUNTERS_PLACED")).toEqual([]);
  });

  it("3. EVOLVE (types.ts `evolveOnto`) — the first field here whose evolve clear is a PLAYED LINE", () => {
    // The victim evolves its own Active on its own turn 3, INSIDE the window. Every
    // neighbouring durated field's evolve clear is written for the rule and pinned by
    // surgery, because their windows sit on the opponent's turn. This one is a line
    // of play, and it is the printed answer to the attack.
    const state = handFromDeck(install("p1", DELAY, "fix-doomed").state, "p2", "fix-doomed-s1", 1);
    expect(body(state.players.p2.active).scheduledEffect).toEqual({ turn: 3, kind: "counters", amount: 90 });
    const evolved = must(
      applyAction(state, {
        type: "evolve",
        seat: "p2",
        uid: handUid(state, "p2", "fix-doomed-s1"),
        target: { spot: "active" },
      }),
    );
    expect(stampOf(evolved.players.p2.active ?? undefined)).toBeNull();
    const fired = mustApply(evolved, { type: "endTurn", seat: "p2" });
    expect(all(fired.events, "COUNTERS_PLACED")).toEqual([]);
    expect(body(fired.state.players.p2.active).damage).toBe(0);
  });

  it("4. DEVOLVE (interpreter.ts `devolveEach`) — the clear is UNREACHABLE, and is driven anyway", () => {
    // 🛑 THE BOARD IS CONSTRUCTED AND SAID TO BE. Devolution arrives only as an
    // opponent's attack effect, and inside this record's window the opponent is the
    // seat that installed it — whose turn it is not. So no legal sequence devolves a
    // scheduled body before it fires. The clear is written because the four §10
    // literals AGREE about the durated set (D433's rule), not because a board needs
    // it — and it is driven through a REAL `devolveEach` on a surgically re-scheduled
    // body, which is stronger than reading the literal.
    const evolvedBoard = handFromDeck(
      install("p1", DELAY, "fix-doomed").state,
      "p2",
      "fix-doomed-s1",
      1,
    );
    const evolved = must(
      applyAction(evolvedBoard, {
        type: "evolve",
        seat: "p2",
        uid: handUid(evolvedBoard, "p2", "fix-doomed-s1"),
        target: { spot: "active" },
      }),
    );
    // A schedule for a turn still in the future, on the now-EVOLVED body.
    const rescheduled = withActive(evolved, "p2", {
      ...body(evolved.players.p2.active),
      scheduledEffect: { turn: 5, kind: "counters", amount: 90 },
    });
    const p1Turn = mustApply(rescheduled, { type: "endTurn", seat: "p2" }).state;
    expect(p1Turn.turn).toBe(4);
    expect(body(p1Turn.players.p2.active).scheduledEffect).toEqual({ turn: 5, kind: "counters", amount: 90 });
    const devolved = mustApply(p1Turn, { type: "attack", seat: "p1", index: DEVOLVE });
    expect(count(devolved.events, "POKEMON_DEVOLVED")).toBe(1);
    expect(stampOf(devolved.state.players.p2.active ?? undefined)).toBeNull();
    // …and the Checkup at the end of turn 5 places nothing, which is the claim the
    // field read alone cannot make.
    const fired = mustApply(devolved.state, { type: "endTurn", seat: "p2" });
    expect(fired.state.turn).toBe(6);
    expect(all(fired.events, "COUNTERS_PLACED")).toEqual([]);
  });

  it("5. KNOCKED OUT before it fires — the schedule dies, and the PROMOTED body does not inherit it", () => {
    // The victim is at 80 damage on a 90 HP body and Poisoned, so the Checkup that
    // ends the INSTALLER's own turn 2 Knocks it Out — one turn before the schedule
    // would have fired. Fully legal, fully reachable, and the surgery goes on the
    // board BEFORE the attack so the sequence is the one a match would produce.
    const pre = setConditions(setDamage(armed("p1"), "p2", 80), "p2", { poisonDamage: 10 });
    const attacked = mustApply(pre, { type: "attack", seat: "p1", index: DELAY });
    expect(find(attacked.events, "EFFECT_SCHEDULED")?.scheduled.turn).toBe(3);
    expect(find(attacked.events, "KNOCKED_OUT")?.seat).toBe("p2");
    const taken = mustApply(attacked.state, {
      type: "takePrizes",
      seat: "p1",
      prizeIndices: [0],
    });
    expect(taken.state.turn).toBe(3);
    // The promoted body is a DIFFERENT Pokémon and carries no schedule — the fact
    // rode the BODY, not the spot.
    const promoted = body(taken.state.players.p2.active);
    expect(taken.state.cardIdByUid[baseUid(promoted)]).toBe("fix-titan");
    expect(promoted.scheduledEffect).toBeNull();
    const fired = mustApply(taken.state, { type: "endTurn", seat: "p2" });
    expect(all(fired.events, "COUNTERS_PLACED")).toEqual([]);
    expect(body(fired.state.players.p2.active).damage).toBe(0);
  });

  it("6. A FRESH BODY carries none (types.ts `makeInPlay`)", () => {
    const fresh = armed("p1");
    expect(body(fresh.players.p1.active).scheduledEffect).toBeNull();
    expect(body(fresh.players.p2.active).scheduledEffect).toBeNull();
    expect(fresh.players.p2.bench.every((p) => p.scheduledEffect === null)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §8 — THE PERSISTED QUESTION: `MATCH_RECORD_VERSION` 27 → 28 (D434) → 29 (D435),
//      driven BOTH ways at BOTH bumps.
// ─────────────────────────────────────────────────────────────────────────────
describe("§8 — the bump, and the soft landing it refuses", () => {
  // ⚠️ `MATCH_RECORD_VERSION` IS NOT EXPORTED FROM THIS PACKAGE (it lives in
  // `apps/api/src/lobby/match.ts`, where the gate and its argument sit, and where
  // `match.test.ts` pins the literal 29 and drives ±1 to null). What is driven HERE
  // is the ENGINE-side fact the constant is about: whether a record written by the
  // previous deploy can be read benignly by this one.
  function saved(): GameState {
    const state = install("p1", DELAY, "fix-doom-tank").state;
    expect(state.turn).toBe(3);
    return JSON.parse(JSON.stringify(state)) as GameState;
  }

  it("🛑 DIRECTION 1 — a v29 record round-trips and the schedule STILL fires", () => {
    const record = saved();
    expect(body(record.players.p2.active).scheduledEffect).toEqual({ turn: 3, kind: "counters", amount: 90 });
    const fired = mustApply(record, { type: "endTurn", seat: "p2" });
    expect(all(fired.events, "COUNTERS_PLACED").map((e) => e.source)).toEqual(["delayed"]);
    expect(body(fired.state.players.p2.active).damage).toBe(90);
  });

  it("🛑 DIRECTION 2 — a v28-SHAPED body is not a body this deploy can read AT ALL", () => {
    // The old shape is BUILT rather than imagined: the key is genuinely DELETED from
    // a JSON round-tripped board, which is what a record written by the previous
    // deploy actually looks like.
    // 🆕🆕 D435 — AND THE ARGUMENT SURVIVES THE RENAME UNCHANGED, WHICH IS THE POINT.
    // At D434 the previous deploy (v27) wrote no key at all; at D435 the previous
    // deploy (v28) wrote `scheduledCounters`, a key nothing on this deploy reads. Both
    // land on the same line for the same reason — `scheduledEffect` is ABSENT — so the
    // rename does not soften the retirement, and the leftover key does not rescue it.
    // The `scheduledCounters` half is driven in its own rung directly below.
    const legacy = saved();
    const victim = body(legacy.players.p2.active) as Omit<
      InPlayPokemon,
      "scheduledEffect"
    > & { scheduledEffect?: { turn: number; amount: number } };
    // biome-ignore lint/performance/noDelete: the key must be genuinely ABSENT. `= undefined` leaves it PRESENT, which is the exact distinction D124's rule turns on and the one this case exists to drive.
    delete victim.scheduledEffect;
    // ABSENT, not `undefined` — the distinction D124 refuses to blur and a `toEqual`
    // would hide.
    expect("scheduledEffect" in victim).toBe(false);

    // 🛑 AND HERE THE RECORD-VALUED FIELD DIVERGES FROM D432's BARE STAMP, WHICH IS
    // A FINDING RATHER THAN A DETAIL. A missing `noWeaknessTurn` reads as
    // `undefined === state.turn`, i.e. FALSE — silent. A missing `scheduledEffect`
    // reads as `undefined !== null`, and the very next line dereferences `.turn`. So
    // this deploy does not lose a rule on an old record, it **dies at the next turn
    // boundary**: every Checkup calls this reader on the ended seat's Active.
    // 🛑 THE READER IS NOT WRITTEN DEFENSIVELY, AND THAT IS THE ENGINE'S STANDING
    // RULE RATHER THAN THIS SLICE's CHOICE — `attackBlockOf` and
    // `installedReductionOf` (continuous.ts) both say it in their own comments:
    // *"no defensive `=== undefined` arm: the field is REQUIRED, and a record
    // written before it existed is retired by MATCH_RECORD_VERSION rather than read
    // benignly here"*. Three record-valued fields, one rule, and the constant is
    // what makes it safe.
    expect(() => scheduledEffectDue(victim as unknown as InPlayPokemon, 3)).toThrow();
    expect(() => mustApply(legacy, { type: "endTurn", seat: "p2" })).toThrow();

    // …and the STRUCTURAL fact the version gate keys on: this body is not an
    // inhabitant of the new type at all. Asserted as a key-set diff in both
    // directions, because a diff between two boards from ONE build is blind to a key
    // that grew on both (D279).
    const live = body(saved().players.p2.active);
    expect(Object.keys(victim).sort()).not.toEqual(Object.keys(live).sort());
    expect(
      Object.keys(live)
        .sort()
        .filter((k) => !Object.keys(victim).includes(k)),
    ).toEqual(["scheduledEffect"]);
  });

  /** 🆕🆕 **D435 — THE *ACTUAL* v28 BYTE STRING, WHICH IS NOT THE SAME OBJECT AS
      DIRECTION 2's.** D434's retirement was about a record with NO key; D435's is
      about a record with the key under its OLD NAME. A reader that had been written
      defensively — or a rename done by adding a second field instead of moving one —
      would pass DIRECTION 2 and still resume a v28 board with the schedule silently
      gone. This rung is the difference, and it is the one that reddens on a build
      that tried to be tolerant. */
  it("🆕🆕 D435 — a v28 body carries `scheduledCounters`, and that key rescues NOTHING", () => {
    const legacy = saved();
    const victim = body(legacy.players.p2.active) as unknown as Record<string, unknown>;
    victim.scheduledCounters = victim.scheduledEffect;
    // biome-ignore lint/performance/noDelete: the NEW key must be genuinely ABSENT — a v28 writer never wrote it.
    delete victim.scheduledEffect;
    expect("scheduledCounters" in victim).toBe(true);
    expect("scheduledEffect" in victim).toBe(false);
    // The old key is not read by anything on this deploy, so the board is exactly as
    // unreadable as DIRECTION 2's: `undefined !== null`, then `.turn`.
    expect(() => scheduledEffectDue(victim as unknown as InPlayPokemon, 3)).toThrow();
    expect(() => mustApply(legacy, { type: "endTurn", seat: "p2" })).toThrow();
  });

  /** 🆕🆕 **D435 — THE OPTIONAL ROAD WAS *AVAILABLE* THIS TIME, AND IT IS STILL
      REFUSED. THE RULE IS NOT "REQUIRED ALWAYS"; IT IS "MEASURE WHAT THE LOSS
      DEGRADES INTO" (D425: apply the test, do not copy the outcome).**

      D432 refused optional because its record had NO rest. D434 refused it because the
      rest was NEW — *a rest must be OLD, not merely PLURAL*. **Neither refusal reaches
      D435**: `{turn, amount}` were both written by the v28 deploy, so a v28 record
      genuinely IS a `scheduledEffect` missing exactly one key, which is precisely the
      shape D421's mitigation is written for. A `kind?: "counters"` defaulting to
      counters would have kept every v28 byte string meaning what it meant, and would
      have cost no bump.

      🛑 **SO THE ROAD IS MEASURED RATHER THAN ARGUED, AND WHAT IT PRODUCES IS NOT A
      SOFT LANDING — IT IS `NaN`.** The tolerant reader is written out here (not
      shipped) and handed a record for one of the NEW payloads with its `kind` dropped,
      which is exactly what a v29 writer's key going missing looks like. It reads as the
      counters member, `amount` is `undefined`, the Checkup computes
      `damage + undefined`, and `isLethallyDamaged` then answers `NaN >= hp` → FALSE.
      The body is not discarded, is not Knocked Out, **and can never be Knocked Out
      again**, on a board that looks entirely normal. That is worse than D124's benign
      landing and worse than a throw: it is silent corruption. */
  it("🆕🆕 D435 — DROPPING AN OPTIONAL `kind` YIELDS NaN DAMAGE AND AN UNKILLABLE BODY", () => {
    const tolerantKind = (scheduled: Record<string, unknown>): string =>
      typeof scheduled.kind === "string" ? scheduled.kind : "counters";
    // A v29 record for the DISCARD payload, with its discriminant lost in transit.
    const lost: Record<string, unknown> = { turn: 3 };
    expect(tolerantKind(lost)).toBe("counters");
    // …and the counters arm then reads an amount that is not there.
    const damage = 0 + (lost.amount as number);
    expect(Number.isNaN(damage)).toBe(true);
    // 🛑 THE CONSEQUENCE, NOT THE ARITHMETIC: a NaN-damaged body is never lethal, in
    // EITHER direction of the comparison, so §8.1's state check can never collect it.
    expect(damage >= 90).toBe(false);
    expect(damage < 90).toBe(false);
    // …and the CONTROL on the same axis, so this rung cannot pass by a reader that
    // says "not lethal" about everything: a real record of the same kind IS lethal.
    const real = 0 + 90;
    expect(real >= 90).toBe(true);
    // 🛑 AND THE SHIPPED BUILD CANNOT PRODUCE THAT RECORD AT ALL, which is what the
    // bump buys: `kind` is REQUIRED, so the only way to a kind-less appointment is a
    // record this deploy refuses to read.
    const shipped = install("p1", DISCARD).state;
    expect(body(shipped.players.p2.active).scheduledEffect).toEqual({
      turn: 3,
      kind: "discard",
    });
  });

  it("🛑 THE OPTIONAL-KEY ROAD WAS DRIVEN TOO, AND THE RECORD'S SECOND KEY DOES NOT SAVE IT", () => {
    // D425's rule: apply the test, do not copy the outcome — and here the outcome
    // MATCHES D432 while the premise is its opposite. D421 can take the optional road
    // because the key it adds sits inside a record a previous deploy ALREADY WROTE,
    // so the surviving fields make the loss visible. **Both of this record's keys
    // arrive together**, so a v27 record does not hold a half-record; it holds
    // nothing, and there is no rest to make the loss loud.
    //
    // An OPTIONAL field would ALSO force the reader to admit `undefined` — which is
    // what turns DIRECTION 2's loud crash into D432's silent soft landing. The
    // tolerant predicate is written out here rather than shipped, so the road is
    // measured instead of imagined: it answers "nothing due" on the stripped body and
    // the board that follows is 0 where the real one is 90.
    const tolerant = (pokemon: InPlayPokemon, turn: number): number | null => {
      const scheduled = pokemon.scheduledEffect as
        | { turn: number; amount: number }
        | null
        | undefined;
      return scheduled != null && scheduled.turn === turn ? scheduled.amount : null;
    };
    const withKey = saved();
    const withoutKey = saved();
    const stripped = body(withoutKey.players.p2.active) as Omit<
      InPlayPokemon,
      "scheduledEffect"
    > & { scheduledEffect?: { turn: number; amount: number } };
    // biome-ignore lint/performance/noDelete: the key must be genuinely ABSENT. `= undefined` leaves it PRESENT, which is the exact distinction D124's rule turns on and the one this case exists to drive.
    delete stripped.scheduledEffect;
    expect(tolerant(body(withKey.players.p2.active), 3)).toBe(90);
    expect(tolerant(stripped as unknown as InPlayPokemon, 3)).toBeNull();
    // Same board, same action, and a 90-point difference in what the victim takes —
    // with NOTHING in the event stream naming a lost rule. That is D124's benign soft
    // landing, and it is what optional would have bought.
    const a = mustApply(withKey, { type: "endTurn", seat: "p2" });
    expect(body(a.state.players.p2.active).damage).toBe(90);
  });

  it("the engine version moved with the behaviour", () => {
    expect(engineVersion).toBe("0.400.0");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §9 — §11: the schedule is an effect of an attack done TO the Defending Pokémon.
// ─────────────────────────────────────────────────────────────────────────────
describe("§9 — a §11 effects-block refuses the schedule, and the control is admitted", () => {
  it("🛑 Mist Energy's effects-only shield refuses it — one row, no record", () => {
    const shielded = attachFromDeck(armed("p1"), "p2", "fix-mist-energy", 1);
    const attacked = mustApply(shielded, { type: "attack", seat: "p1", index: DELAY });
    expect(count(attacked.events, "ATTACK_EFFECT_PREVENTED")).toBe(1);
    expect(count(attacked.events, "EFFECT_SCHEDULED")).toBe(0);
    expect(body(attacked.state.players.p2.active).scheduledEffect).toBeNull();
    const fired = endVictimTurn(attacked.state, "p2");
    expect(all(fired.events, "COUNTERS_PLACED")).toEqual([]);
  });

  it("the ADMITTED control differs on ONE axis — the same board without the shield", () => {
    const attacked = install("p1");
    expect(count(attacked.events, "ATTACK_EFFECT_PREVENTED")).toBe(0);
    expect(count(attacked.events, "EFFECT_SCHEDULED")).toBe(1);
  });

  it("⚠️ the gate is asked at the INSTALL, not at the firing — a block that arrives later does not save it", () => {
    // Stated as a decision rather than left to look like an oversight (D421): the
    // printed block refuses the EFFECT OF AN ATTACK DONE TO this Pokémon, and the
    // doing is the install. A second gate at the Checkup would be a second opinion
    // that can disagree with the first — `koRecoilOf`'s rule, one seam over.
    const installed = install("p1", DELAY, "fix-doom-tank").state;
    const shieldedLate = attachFromDeck(installed, "p2", "fix-mist-energy", 1);
    const fired = endVictimTurn(shieldedLate, "p2");
    expect(all(fired.events, "COUNTERS_PLACED").map((e) => e.source)).toEqual(["delayed"]);
    expect(body(fired.state.players.p2.active).damage).toBe(90);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §10 — idempotence and the merge, constructed because no printing reaches them.
// ─────────────────────────────────────────────────────────────────────────────
describe("§10 — a second schedule in the same turn merges by MAX, not by sum", () => {
  // ⚠️ UNREACHABLE OFF ANY PRINTING — one attack per turn, and no card in the pool
  // prints two of these — so the merge is reached by surgery rather than by a board
  // no deck can build, and it is CONSTRUCTED AND PINNED rather than trusted
  // (`weakenDefenderAttacks`' answer, transferred with its reason).
  it("the LARGER amount survives and fires; the sum never appears", () => {
    const installed = install("p1", DELAY, "fix-doom-tank").state;
    expect(body(installed.players.p2.active).scheduledEffect).toEqual({ turn: 3, kind: "counters", amount: 90 });
    const bigger = withActive(installed, "p2", {
      ...body(installed.players.p2.active),
      scheduledEffect: { turn: 3, kind: "counters", amount: 120 },
    });
    expect(scheduledEffectDue(body(bigger.players.p2.active), 3)).toEqual({
      turn: 3,
      kind: "counters",
      amount: 120,
    });
    const fired = mustApply(bigger, { type: "endTurn", seat: "p2" });
    expect(body(fired.state.players.p2.active).damage).toBe(120);
    // …and NOT 210, which is what a summing merge would have produced.
    expect(body(fired.state.players.p2.active).damage).not.toBe(210);
  });

  it("🛑 two ops in ONE program: the second MERGES by max and announces only a change", () => {
    // Reached through `runProgram` rather than through a board, because no deck can
    // build one — and that is what makes the merge testable at all rather than a
    // branch nothing can witness (D416's rule about a park nobody's board reaches,
    // read one op over).
    const base = armed("p1", "fix-doom-tank");
    const up: GameEvent[] = [];
    const raised = runProgram(
      base,
      [
        { op: "scheduleCounters", amount: 90 },
        { op: "scheduleCounters", amount: 120 },
      ],
      { seat: "p1" },
      up,
    );
    expect(body(raised.state.players.p2.active).scheduledEffect).toEqual({
      turn: 3,
      kind: "counters",
      amount: 120,
    });
    // …and NOT 210: the merge is `Math.max`, not a sum.
    expect(all(up, "EFFECT_SCHEDULED").map((e) => e.scheduled)).toEqual([
      { turn: 3, kind: "counters", amount: 90 },
      { turn: 3, kind: "counters", amount: 120 },
    ]);

    const down: GameEvent[] = [];
    const lowered = runProgram(
      base,
      [
        { op: "scheduleCounters", amount: 120 },
        { op: "scheduleCounters", amount: 90 },
      ],
      { seat: "p1" },
      down,
    );
    expect(body(lowered.state.players.p2.active).scheduledEffect).toEqual({
      turn: 3,
      kind: "counters",
      amount: 120,
    });
    // The SECOND op changed nothing, so it announced nothing — announcing a
    // re-install that moved no number would be announcing a non-event (D140/D146).
    expect(all(down, "EFFECT_SCHEDULED").map((e) => e.scheduled)).toEqual([
      { turn: 3, kind: "counters", amount: 120 },
    ]);
  });

  /** 🆕🆕 **D435 — AND A SCHEDULE OF A *DIFFERENT KIND* REPLACES RATHER THAN MERGES,
      WHICH IS A DECISION AND NOT A FALLTHROUGH.** The field holds ONE appointment, so
      two payloads for one turn cannot both be kept; the alternative would be inventing
      a precedence order between three printed sentences that no rule states. Both
      directions are driven so the answer cannot be "whichever the code happens to
      reach", and the board is CONSTRUCTED and said to be: it needs two attacks in one
      turn, and no card prints two of these. */
  it("🆕🆕 D435 — a DIFFERENT kind REPLACES, and it does so in both directions", () => {
    const base = armed("p1");
    const pairs: [EffectOp, EffectOp][] = [
      [{ op: "scheduleCounters", amount: 90 }, { op: "scheduleKnockOut" }],
      [{ op: "scheduleKnockOut" }, { op: "scheduleDiscard" }],
      [{ op: "scheduleDiscard" }, { op: "scheduleCounters", amount: 90 }],
    ];
    for (const [first, second] of pairs) {
      const events: GameEvent[] = [];
      const ran = runProgram(base, [first, second], { seat: "p1" }, events);
      const expected =
        second.op === "scheduleCounters"
          ? { turn: 3, kind: "counters", amount: 90 }
          : second.op === "scheduleDiscard"
            ? { turn: 3, kind: "discard" }
            : { turn: 3, kind: "knockOut" };
      expect(body(ran.state.players.p2.active).scheduledEffect, second.op).toEqual(expected);
      // TWO rows, because the second op really did change the appointment — the
      // suppression is for a merge that says nothing new, not for a replacement.
      expect(all(events, "EFFECT_SCHEDULED"), second.op).toHaveLength(2);
    }
  });

  it("a schedule stamped for a LATER turn is untouched by the Checkup it is not for", () => {
    const installed = install("p1", DELAY, "fix-doom-tank").state;
    const later = withActive(installed, "p2", {
      ...body(installed.players.p2.active),
      scheduledEffect: { turn: 5, kind: "counters", amount: 90 },
    });
    const fired = mustApply(later, { type: "endTurn", seat: "p2" });
    expect(all(fired.events, "COUNTERS_PLACED")).toEqual([]);
    expect(body(fired.state.players.p2.active).scheduledEffect).toEqual({
      turn: 5,
      kind: "counters",
      amount: 90,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §11 — purity: neither half mutates the board it was handed.
// ─────────────────────────────────────────────────────────────────────────────
describe("§11 — the install and the firing mutate nothing they were handed", () => {
  it("a deep-frozen board survives the install AND the Checkup that fires it", () => {
    const frozenArmed = deepFreeze(armed("p1", "fix-doom-tank"));
    const installed = mustApply(frozenArmed, { type: "attack", seat: "p1", index: DELAY });
    expect(body(frozenArmed.players.p2.active).scheduledEffect).toBeNull();
    expect(body(installed.state.players.p2.active).scheduledEffect).toEqual({
      turn: 3,
      kind: "counters",
      amount: 90,
    });

    const frozenScheduled = deepFreeze(installed.state);
    const fired = mustApply(frozenScheduled, { type: "endTurn", seat: "p2" });
    expect(body(frozenScheduled.players.p2.active).damage).toBe(0);
    expect(body(fired.state.players.p2.active).damage).toBe(90);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §12 — 🆕🆕 D435: THE PRIZE, AND IT IS THE ONLY THING THAT SEPARATES THE TWO
//       NEW PAYLOADS. Same board, same clock, same removal — one axis.
// ─────────────────────────────────────────────────────────────────────────────
/** 🛑 **THE DISTINCTION THIS WHOLE SLICE EXISTS TO KEEP, AND IT IS A RULES FACT
    RATHER THAN A DESIGN PREFERENCE.** `docs/reference/ptcg-rules.md` §8.1 defines the
    Knock Out — *"A Pokémon is **Knocked Out** when its **damage ≥ its current HP**"* —
    and then says *"The player **who KO'd** the Pokémon **takes prize card(s)**"*. The
    Prize is owed BY the Knock Out, and by nothing else in the rules: no clause
    anywhere pays a Prize for a card leaving play any other way. Corpus row 53 prints
    *discard* and Knocks nothing Out; corpus row 113 prints *"will be Knocked Out"*.

    ⚠️ **AND THE ENGINE AGREED WITH THE RULE BEFORE EITHER PAYLOAD EXISTED**, which is
    what makes this a check rather than a new policy: `returnSelf` with
    `dest: "discard"` (D313, Revavroom ex `sv06.5-015`/`-081`) removes a body to the
    discard pile and stages NO `takePrizes`; `knockOut` (flow.ts) stages one. The two
    payloads reach those two shipped seams.

    🛑 **THE TWO BOARDS ARE OTHERWISE IDENTICAL, WHICH IS THE POINT OF DRIVING THEM
    HERE RATHER THAN IN TWO SECTIONS.** Same installer, same victim, same 90 HP body,
    same {C} cost, same turn, same empty Active Spot, same promotion, same cards in the
    same discard pile. If the two ever collapse into one "remove the body" payload, the
    prize row is the ONLY assertion in this file that reddens. */
describe("§12 — a discard takes NO Prize and a Knock Out takes ONE, on one axis", () => {
  it("🛑 THE ONE AXIS — same board, same clock: 6 prizes against 5", () => {
    const discarded = endVictimTurn(install("p1", DISCARD).state, "p2");
    const doomed = endVictimTurn(install("p1", DOOM).state, "p2");

    // The DISCARD: nothing is Knocked Out, nothing is owed, nobody parks on a prize.
    expect(count(discarded.events, "KNOCKED_OUT")).toBe(0);
    expect(count(discarded.events, "PRIZES_OWED")).toBe(0);
    expect(discarded.state.players.p1.prizes).toHaveLength(6);
    expect(discarded.state.players.p2.prizes).toHaveLength(6);

    // The KNOCK OUT: §8.1 in full, and the prize pick PARKS for the installer.
    expect(count(doomed.events, "KNOCKED_OUT")).toBe(1);
    expect(find(doomed.events, "PRIZES_OWED")).toEqual({
      type: "PRIZES_OWED",
      seat: "p1",
      count: 1,
    });
    expect(doomed.state.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: 1 });
    const taken = mustApply(doomed.state, { type: "takePrizes", seat: "p1", prizeIndices: [0] });
    expect(taken.state.players.p1.prizes).toHaveLength(5);
    expect(taken.state.players.p2.prizes).toHaveLength(6);
  });

  it("🛑 …and EVERYTHING ELSE agrees: the same cards leave play into the same pile", () => {
    const discarded = endVictimTurn(install("p1", DISCARD).state, "p2");
    const doomed = endVictimTurn(install("p1", DOOM).state, "p2");
    const settled = mustApply(doomed.state, {
      type: "takePrizes",
      seat: "p1",
      prizeIndices: [0],
    }).state;

    // The body and its Energy are in the VICTIM's discard pile on both boards, and
    // the installer's pile is untouched on both.
    const pile = (state: GameState) =>
      state.players.p2.discard.map((uid) => state.cardIdByUid[uid]).sort();
    expect(pile(discarded.state)).toEqual(["fix-doomed", "fix-energy"]);
    expect(pile(settled)).toEqual(pile(discarded.state));
    expect(discarded.state.players.p1.discard).toEqual([]);
    expect(settled.players.p1.discard).toEqual([]);

    // Both promote the lone benched `fix-titan`, and both hand the turn back.
    for (const state of [discarded.state, settled]) {
      expect(state.cardIdByUid[baseUid(state.players.p2.active)]).toBe("fix-titan");
      expect(state.players.p2.bench).toHaveLength(0);
      expect(state.turn).toBe(4);
      expect(state.phase).toEqual({ kind: "turn:action", seat: "p1" });
    }
  });

  it("🛑 the KO-only facts are absent on the discard: no `lastKoTurn`, no `lastKoMarks`", () => {
    // D271's stamp is *"any of your Pokémon were Knocked Out"*, and a discard is not
    // that. This is the same distinction one layer out from the Prize: a printed
    // sentence keyed on a Knock Out must not fire because a body left play.
    const discarded = endVictimTurn(install("p1", DISCARD).state, "p2");
    expect(discarded.state.lastKoTurn.p2).toBeNull();
    expect(discarded.state.lastKoMarks.p2).toEqual([]);
    // …and the CONTROL on the same axis, so the rung cannot pass on a build where
    // nothing ever stamps.
    const doomed = endVictimTurn(install("p1", DOOM).state, "p2");
    expect(doomed.state.lastKoTurn.p2).toBe(3);
    expect(doomed.state.lastKoMarks.p2).toHaveLength(1);
  });

  it("🛑 the two LOG rows do not read alike — the arming row names which one it is", () => {
    const discard = install("p1", DISCARD);
    const doom = install("p1", DOOM);
    expect(
      render(discard.events, discard.state).find((r) => r.text.includes("scheduled")),
    ).toEqual({
      who: "p2",
      text: "fix-doomed is scheduled to be discarded at the end of your next turn",
    });
    expect(render(doom.events, doom.state).find((r) => r.text.includes("scheduled"))).toEqual({
      who: "p2",
      text: "fix-doomed is scheduled to be Knocked Out at the end of your next turn",
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §13 — 🆕🆕 D435: THE DISCARD PAYLOAD (corpus row 53, 1 legal printing).
// ─────────────────────────────────────────────────────────────────────────────
describe("§13 — the body and all attached cards, to their OWNER's discard pile", () => {
  it("the record is `{ turn: state.turn + 1, kind: 'discard' }` on the DEFENDER's Active", () => {
    const { state, events } = install("p1", DISCARD);
    expect(body(state.players.p2.active).scheduledEffect).toEqual({ turn: 3, kind: "discard" });
    expect(body(state.players.p1.active).scheduledEffect).toBeNull();
    expect(find(events, "EFFECT_SCHEDULED")).toEqual({
      type: "EFFECT_SCHEDULED",
      seat: "p2",
      uid: baseUid(state.players.p2.active),
      scheduled: { turn: 3, kind: "discard" },
    });
  });

  for (const installer of ["p1", "p2"] as const) {
    const victim = otherSeat(installer);
    it(`both seats — ${installer} schedules, ${victim}'s Active is discarded at the end of turn 3`, () => {
      const installed = install(installer, DISCARD);
      // It SURVIVES the Checkup that ends the installing turn — the stamp is 3 and
      // that Checkup runs at turn 2, which is the off-by-one this shape invites.
      expect(installed.state.players[victim].active).not.toBeNull();
      const fired = endVictimTurn(installed.state, victim);
      expect(find(fired.events, "POKEMON_RETURNED")).toEqual({
        type: "POKEMON_RETURNED",
        seat: victim,
        uid: baseUid(installed.state.players[victim].active),
        // 🛑 THE ACTOR IS THE INSTALLER AND THE SEAT IS THE VICTIM, and they differ —
        // D299's row carries both precisely because they can (Illumise's printing).
        // A row filed under the owner would read as something they chose to do.
        actor: installer,
        dest: "discard",
        uids: expect.any(Array),
      });
      expect(fired.state.turn).toBe(4);
    });
  }

  /** 🛑 **"AND ALL ATTACHED CARDS" — THE SET, CHECKED AGAINST TWO PRECEDENTS RATHER
      THAN COPIED FROM ONE (D433).** Three shipped literals could have supplied the
      set. §8.1's `knockOut` (flow.ts) and `returnSelf` with `dest: "discard"`
      (interpreter.ts, D313) AGREE to the byte: it is `stackUids` =
      `[...stack, ...energy, ...tools]`, the evolution stack bottom→top, then Energy,
      then Tools, appended to the OWNER's pile in §2's order. `devolveEach` (D433) is
      NOT a third opinion — it moves ONE evolution card and never touches an
      attachment — so it is not a precedent for this sentence at all, which is a
      finding rather than an omission.

      ⚠️ **THE EVOLVED BODY IS REACHED THE LONG WAY ROUND, BECAUSE THE SHORT WAY IS
      UNREACHABLE.** Evolving is one of this record's §10 clears (§7 case 3), so a body
      cannot evolve *inside* the window and still be scheduled. The board here evolves
      FIRST and is re-scheduled for a later turn — the same construction §7 case 4
      uses, and reachable in a longer real game (evolve on turn 3, take the attack on
      turn 4, decline to evolve on turn 5). */
  it("🛑 the WHOLE pile moves — evolution stack, Energy and Tool, in §2's order", () => {
    const withHand = handFromDeck(install("p1", DISCARD).state, "p2", "fix-doomed-s1", 1);
    const evolved = must(
      applyAction(withHand, {
        type: "evolve",
        seat: "p2",
        uid: handUid(withHand, "p2", "fix-doomed-s1"),
        target: { spot: "active" },
      }),
    );
    // Evolving CLEARED the schedule (§7 case 3), so it is re-installed for a later
    // turn on the now-two-card stack, with a second Energy and a Tool attached.
    const loaded = attachToolFromDeck(
      attachFromDeck(evolved, "p2", "fix-energy", 1),
      "p2",
      "active",
      "sv03-197",
    );
    const rescheduled = withActive(loaded, "p2", {
      ...body(loaded.players.p2.active),
      scheduledEffect: { turn: 5, kind: "discard" },
    });
    const victimBody = body(rescheduled.players.p2.active);
    expect(victimBody.stack).toHaveLength(2);
    expect(victimBody.energy).toHaveLength(2);
    expect(victimBody.tools).toHaveLength(1);
    const expected = [...victimBody.stack, ...victimBody.energy, ...victimBody.tools];

    const p1Turn = mustApply(rescheduled, { type: "endTurn", seat: "p2" }).state;
    expect(p1Turn.turn).toBe(4);
    const back = mustApply(p1Turn, { type: "endTurn", seat: "p1" }).state;
    expect(back.turn).toBe(5);
    const fired = mustApply(back, { type: "endTurn", seat: "p2" });

    // 🛑 EVERY CARD, IN ORDER, IN THE **VICTIM'S** PILE — not the actor's.
    expect(find(fired.events, "POKEMON_RETURNED")?.uids).toEqual(expected);
    expect(fired.state.players.p2.discard.slice(-expected.length)).toEqual(expected);
    for (const uid of expected) expect(fired.state.players.p1.discard).not.toContain(uid);
    // …and the Stage 1 is named by the row, because `uid` is the STACK TOP.
    expect(fired.state.cardIdByUid[find(fired.events, "POKEMON_RETURNED")?.uid ?? ""]).toBe(
      "fix-doomed-s1",
    );
  });

  /** 🛑 **THE THIRD SITE OF D311/D312's PROMOTION SEAM, AND IT IS THE ONE THING THIS
      PAYLOAD NEEDED THAT NO §10 CLEAR COVERS.** The delayed discard is the first thing
      in this engine that empties an Active Spot DURING the Checkup, and the very next
      stage in the queue is the OTHER seat's `startTurn`. Without the promotion the
      victim would face an attack with no Active Pokémon at all. */
  it("🛑 the emptied Active Spot is refilled BEFORE the next turn starts", () => {
    const fired = endVictimTurn(install("p1", DISCARD).state, "p2");
    expect(find(fired.events, "POKEMON_PROMOTED")?.seat).toBe("p2");
    expect(fired.state.players.p2.active).not.toBeNull();
    expect(fired.state.cardIdByUid[baseUid(fired.state.players.p2.active)]).toBe("fix-titan");
    expect(fired.state.players.p2.bench).toHaveLength(0);
    // 🛑 AND THE ORDER IS LOAD-BEARING: the promotion happens before `TURN_STARTED`,
    // which is what "before the next turn starts" means as an assertion rather than
    // as a sentence.
    const names = types(fired.events);
    expect(names.indexOf("POKEMON_PROMOTED")).toBeLessThan(names.indexOf("TURN_STARTED"));
    expect(fired.state.phase).toEqual({ kind: "turn:action", seat: "p1" });
  });

  it("🛑 …and with an EMPTY Bench the victim LOSES (§14.2), through the shipped stage", () => {
    // The promote stage is already total over the three boards it can meet; this is
    // the third of them, reached for the first time from a Checkup. Without the seam
    // above, this player would simply keep playing with no Active Pokémon.
    const noBench = clearBench(armed("p1"), "p2");
    const installed = mustApply(noBench, { type: "attack", seat: "p1", index: DISCARD }).state;
    const fired = mustApply(installed, { type: "endTurn", seat: "p2" });
    expect(find(fired.events, "GAME_OVER")?.outcome).toEqual({
      result: "win",
      winner: "p1",
      reason: "noPokemon",
    });
    // …and NO Prize was taken on the way there, which is the §12 axis surviving into
    // the win condition.
    expect(count(fired.events, "PRIZES_OWED")).toBe(0);
    expect(fired.state.players.p1.prizes).toHaveLength(6);
  });

  /** 🛑 **THE ORDERING AGAINST §13.1, AND FOR THIS PAYLOAD IT IS A *BOARD* DIFFERENCE
      RATHER THAN A SEQUENCE ONE.** D434 could only assert the event SEQUENCE, because
      damage is commutative and the KO is resolved for the whole batch. A DISCARDED
      body is gone before §13.1 reads the spot, so a Poisoned victim takes no poison
      damage and files no `source: "poison"` row at all. Swap this block with §13.1 and
      the board differs, not merely the log. */
  it("🛑 a discarded body cannot be Poisoned — no poison row, and the CONTROL files one", () => {
    const poisoned = setConditions(install("p1", DISCARD).state, "p2", {
      poisonDamage: 10,
      burned: true,
    });
    const fired = endVictimTurn(poisoned, "p2");
    expect(all(fired.events, "COUNTERS_PLACED")).toEqual([]);
    const names = types(fired.events);
    expect(names.slice(names.indexOf("TURN_ENDED"), names.indexOf("TURN_ENDED") + 2)).toEqual([
      "TURN_ENDED",
      "POKEMON_RETURNED",
    ]);
    // 🛑 THE CONTROL DIFFERS ON ONE AXIS — the same conditions on the same board with
    // the COUNTERS payload instead, where the body survives and both rows are filed.
    const control = setConditions(install("p1", DELAY, "fix-doom-tank").state, "p2", {
      poisonDamage: 10,
      burned: true,
    });
    const firedControl = endVictimTurn(control, "p2");
    expect(all(firedControl.events, "COUNTERS_PLACED").map((e) => e.source)).toEqual([
      "delayed",
      "poison",
      "burn",
    ]);
  });

  it("§10 — RETREAT sheds it, and the Checkup that follows discards NOTHING", () => {
    // The clear-rung asserts the SILENT AFTERMATH and not the cleared field (D434):
    // reading `null` back passes on a build that clears the record and fires anyway.
    const installed = install("p1", DISCARD).state;
    const retreated = must(
      applyAction(installed, {
        type: "retreat",
        seat: "p2",
        discardEnergy: (installed.players.p2.active?.energy ?? []).slice(0, 1),
        promoteBenchIndex: 0,
      }),
    );
    expect(body(retreated.players.p2.active).scheduledEffect).toBeNull();
    const fired = mustApply(retreated, { type: "endTurn", seat: "p2" });
    expect(count(fired.events, "POKEMON_RETURNED")).toBe(0);
    expect(fired.state.players.p2.active).not.toBeNull();
    expect(fired.state.players.p2.bench).toHaveLength(1);
  });

  it("§11 — a Mist Energy shield refuses it, and the ADMITTED control differs on ONE axis", () => {
    const shielded = attachFromDeck(armed("p1"), "p2", "fix-mist-energy", 1);
    const attacked = mustApply(shielded, { type: "attack", seat: "p1", index: DISCARD });
    expect(count(attacked.events, "ATTACK_EFFECT_PREVENTED")).toBe(1);
    expect(count(attacked.events, "EFFECT_SCHEDULED")).toBe(0);
    expect(body(attacked.state.players.p2.active).scheduledEffect).toBeNull();
    const fired = endVictimTurn(attacked.state, "p2");
    expect(count(fired.events, "POKEMON_RETURNED")).toBe(0);
    // …the same board without the shield.
    const admitted = install("p1", DISCARD);
    expect(count(admitted.events, "ATTACK_EFFECT_PREVENTED")).toBe(0);
    expect(count(admitted.events, "EFFECT_SCHEDULED")).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §14 — 🆕🆕 D435: THE KNOCK-OUT PAYLOAD (corpus row 113's tail, 2 printings).
// ─────────────────────────────────────────────────────────────────────────────
describe("§14 — §8.1 in full, Prize included, and the cause re-derived", () => {
  it("the record is `{ turn: state.turn + 1, kind: 'knockOut' }` on the DEFENDER's Active", () => {
    const { state, events } = install("p1", DOOM);
    expect(body(state.players.p2.active).scheduledEffect).toEqual({ turn: 3, kind: "knockOut" });
    expect(body(state.players.p1.active).scheduledEffect).toBeNull();
    expect(find(events, "EFFECT_SCHEDULED")).toEqual({
      type: "EFFECT_SCHEDULED",
      seat: "p2",
      uid: baseUid(state.players.p2.active),
      scheduled: { turn: 3, kind: "knockOut" },
    });
  });

  for (const installer of ["p1", "p2"] as const) {
    const victim = otherSeat(installer);
    it(`both seats — ${installer} schedules, ${victim}'s Active is Knocked Out at the end of turn 3`, () => {
      const installed = install(installer, DOOM);
      expect(installed.state.players[victim].active).not.toBeNull();
      const fired = endVictimTurn(installed.state, victim);
      expect(find(fired.events, "KNOCKED_OUT")?.seat).toBe(victim);
      expect(fired.state.phase).toEqual({ kind: "ko:takePrizes", seat: installer, count: 1 });
      const taken = mustApply(fired.state, {
        type: "takePrizes",
        seat: installer,
        prizeIndices: [0],
      });
      expect(taken.state.players[installer].prizes).toHaveLength(5);
      expect(taken.state.cardIdByUid[baseUid(taken.state.players[victim].active)]).toBe(
        "fix-titan",
      );
      expect(taken.state.turn).toBe(4);
    });
  }

  /** 🛑 **IT IS A KNOCK OUT WITH NO DAMAGE, AND THAT IS THE FACT THE CAUSE
      DERIVATION TURNS ON.** D434's payload PUTS DAMAGE COUNTERS ON, so its Knock Out
      genuinely is by damage. This one places none: the body's `damage` reaches
      `effectiveMaxHp` only because `doomBodyAt` marks it, which is D414's marker's
      exact subject (*"lethal WITHOUT damage"*). D434's reasoning therefore does not
      transfer and was re-derived rather than inherited (D433's rule for a marker's
      second producer). */
  it("🛑 THE KO IS NOT DAMAGE — a full-HP body dies with no `COUNTERS_PLACED` anywhere", () => {
    const installed = install("p1", DOOM, "fix-doom-tank").state;
    // 300 HP and ZERO damage: nothing this engine can place would be lethal here.
    expect(body(installed.players.p2.active).damage).toBe(0);
    const fired = endVictimTurn(installed, "p2");
    expect(all(fired.events, "COUNTERS_PLACED")).toEqual([]);
    expect(count(fired.events, "DAMAGE_DEALT")).toBe(0);
    expect(count(fired.events, "KNOCKED_OUT")).toBe(1);
  });

  it("🛑 THE CAUSE — `byAttack` is FALSE, and the KO-by-damage readers see nothing", () => {
    const fired = endVictimTurn(install("p1", DOOM).state, "p2");
    const marks = fired.state.lastKoMarks.p2;
    expect(marks).toHaveLength(1);
    expect(marks[0]?.byAttack).toBe(false);
    expect(fired.state.lastKoTurn.p2).toBe(3);
    // ⚠️ THE MECHANISM, NAMED: `collectKnockOuts` takes an `attackerSeat` from
    // `finishAttack` ALONE, and the Checkup passes none — so `byAttackFor` answers
    // false before it ever looks at the body. That is the SAME line D434's payload
    // and an attack-applied Poison both answer on, which is why the answer agrees
    // while the reasoning behind the MARKER does not.
    const poisonKo = endVictimTurn(
      setDamage(install("p1", POISON).state, "p2", 80),
      "p2",
    );
    expect(poisonKo.state.lastKoMarks.p2[0]?.byAttack).toBe(false);
  });

  /** 🛑 **VENGEFUL PUNCH PAYS NOTHING, AND FOR THIS PAYLOAD THERE ARE *TWO*
      INDEPENDENT REASONS WHERE D434's BOARD HAD ONE.** `koRecoilOf` is called by
      `finishAttack` alone, so a Checkup Knock Out is outside the window whatever the
      body carries — that is D434's reason and it still holds. **And** this body's
      lethality is an effect's doing rather than damage's, which is the second reason
      and the one the printed *"by damage from an attack"* is actually about. The
      one-axis contrast is the same Tool on the same body Knocked Out by a real
      attack, which pays 40. */
  it("🛑 the KO-conditioned recoil pays 0, and the ATTACK control on one axis pays 40", () => {
    const recoil = programFor("sv03-197")?.passive?.damageAttackerOnKo?.amount ?? 0;
    expect(recoil).toBeGreaterThan(0);
    const armedTool = attachToolFromDeck(armed("p1"), "p2", "active", "sv03-197");
    const scheduled = mustApply(armedTool, { type: "attack", seat: "p1", index: DOOM }).state;
    const fired = endVictimTurn(scheduled, "p2");
    expect(count(fired.events, "KNOCKED_OUT")).toBe(1);
    expect(body(fired.state.players.p1.active).damage).toBe(0);
    // …and the control: the SAME Tool on the SAME body, Knocked Out by an attack.
    const smashed = mustApply(attachToolFromDeck(armed("p1"), "p2", "active", "sv03-197"), {
      type: "attack",
      seat: "p1",
      index: SMASH,
    });
    expect(count(smashed.events, "KNOCKED_OUT")).toBe(1);
    expect(body(smashed.state.players.p1.active).damage).toBe(recoil);
  });

  /** ⚠️ **D433's `wasLethal` CONJUNCT DOES ARISE HERE, WHERE IT DID NOT FOR D434.** A
      body already lethally damaged when the appointment fires WAS Knocked Out by
      damage, whatever the appointment says, and stamping `koByEffect` onto it would
      deny a recoil that is genuinely owed. The board is CONSTRUCTED and said to be —
      no printing puts a lethal body at a Checkup this schedule is due at, because
      mid-turn Knock Outs resolve the instant they occur.

      ⚠️ **AND THE MARKER ITSELF IS OBSERVATIONALLY INERT ON THIS PATH TODAY, WHICH IS
      MEASURED AND STATED RATHER THAN GLOSSED (D414).** Its only two readers are
      `byAttackFor` (short-circuits to false when `attackerSeat` is undefined, which
      the Checkup's call always is) and `koRecoilOf` (reached from `finishAttack`
      alone). So no board distinguishes the stamped build from the unstamped one, and
      the corresponding mutant row is DECLARED `equivalent` rather than expected to
      die — which makes it self-invalidating (D427): the day a third reader appears,
      the row is KILLED and the sweep reports `STALE-SURVIVOR`. What IS observable is
      asserted below: the KO happens either way, and the Prize is paid either way. */
  it("⚠️ an ALREADY-LETHAL body is still collected, and still pays its Prize", () => {
    const installed = install("p1", DOOM).state;
    const dying = setDamage(installed, "p2", 90);
    const fired = endVictimTurn(dying, "p2");
    expect(count(fired.events, "KNOCKED_OUT")).toBe(1);
    expect(fired.state.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: 1 });
    expect(fired.state.lastKoMarks.p2[0]?.byAttack).toBe(false);
  });

  /** 🛑 **THIS ENGINE MARKS; §8.1 KILLS — AND THE ORDERING SHOWS IT.** The doomed body
      is still standing when §13.1 reads the spot, so Poison lands on it and files its
      row. Harmless (the KO is resolved once, for the whole batch, at the bottom of
      `runCheckup`) and asserted anyway, because it is the observable difference
      between "marks" and "kills" — and the discard payload's rung one section up is
      the same question answered the other way on the same clock. */
  it("🛑 a DOOMED body is still there for §13.1 — Poison files its row, unlike the discard", () => {
    const poisoned = setConditions(install("p1", DOOM).state, "p2", { poisonDamage: 10 });
    const fired = endVictimTurn(poisoned, "p2");
    expect(all(fired.events, "COUNTERS_PLACED").map((e) => [e.source, e.amount])).toEqual([
      ["poison", 10],
    ]);
    expect(count(fired.events, "KNOCKED_OUT")).toBe(1);
  });

  it("🛑 …and with an EMPTY Bench the victim LOSES — the Prize is taken FIRST", () => {
    const noBench = clearBench(armed("p1"), "p2");
    const installed = mustApply(noBench, { type: "attack", seat: "p1", index: DOOM }).state;
    const fired = mustApply(installed, { type: "endTurn", seat: "p2" });
    // §8.1's prize pick comes before the promotion that cannot happen.
    expect(fired.state.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: 1 });
    const taken = mustApply(fired.state, { type: "takePrizes", seat: "p1", prizeIndices: [0] });
    expect(taken.state.players.p1.prizes).toHaveLength(5);
    expect(find(taken.events, "GAME_OVER")?.outcome).toEqual({
      result: "win",
      winner: "p1",
      reason: "noPokemon",
    });
  });

  it("§10 — RETREAT sheds it, and the Checkup that follows Knocks NOTHING Out", () => {
    const installed = install("p1", DOOM).state;
    const retreated = must(
      applyAction(installed, {
        type: "retreat",
        seat: "p2",
        discardEnergy: (installed.players.p2.active?.energy ?? []).slice(0, 1),
        promoteBenchIndex: 0,
      }),
    );
    expect(body(retreated.players.p2.active).scheduledEffect).toBeNull();
    const fired = mustApply(retreated, { type: "endTurn", seat: "p2" });
    expect(count(fired.events, "KNOCKED_OUT")).toBe(0);
    expect(count(fired.events, "PRIZES_OWED")).toBe(0);
    expect(fired.state.players.p1.prizes).toHaveLength(6);
  });

  it("§11 — a Mist Energy shield refuses it, and the ADMITTED control differs on ONE axis", () => {
    const shielded = attachFromDeck(armed("p1"), "p2", "fix-mist-energy", 1);
    const attacked = mustApply(shielded, { type: "attack", seat: "p1", index: DOOM });
    expect(count(attacked.events, "ATTACK_EFFECT_PREVENTED")).toBe(1);
    expect(count(attacked.events, "EFFECT_SCHEDULED")).toBe(0);
    const fired = endVictimTurn(attacked.state, "p2");
    expect(count(fired.events, "KNOCKED_OUT")).toBe(0);
    const admitted = install("p1", DOOM);
    expect(count(admitted.events, "ATTACK_EFFECT_PREVENTED")).toBe(0);
    expect(count(admitted.events, "EFFECT_SCHEDULED")).toBe(1);
  });

  it("🛑 the PRINTED compound fires end to end — the head's discard AND the tail's KO", () => {
    // The catalog prints row 113 as a compound, so this is the board a real card
    // produces: `splitAttackTrailingClause` composes D431's head with D435's tail.
    const composed = install("p1", COMPOUND);
    expect(body(composed.state.players.p1.active).energy).toEqual([]);
    expect(body(composed.state.players.p2.active).scheduledEffect).toEqual({
      turn: 3,
      kind: "knockOut",
    });
    const fired = endVictimTurn(composed.state, "p2");
    expect(count(fired.events, "KNOCKED_OUT")).toBe(1);
    expect(fired.state.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: 1 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §15 — 🆕🆕 D435: purity and the replay, for BOTH new payloads.
// ─────────────────────────────────────────────────────────────────────────────
describe("§15 — frozen boards, and a v29 record that round-trips", () => {
  /** Drain the ONE decision either payload can leave parked: the Knock Out's §8.1
      prize pick. The discard owes none, so this is the identity there — which is the
      §12 axis showing up as a helper rather than as a sentence. */
  const settle = (result: { state: GameState }): GameState =>
    result.state.phase.kind === "ko:takePrizes"
      ? mustApply(result.state, { type: "takePrizes", seat: "p1", prizeIndices: [0] }).state
      : result.state;

  for (const [name, index] of [
    ["discard", DISCARD],
    ["knockOut", DOOM],
  ] as const) {
    it(`the ${name} install and its firing mutate nothing they were handed`, () => {
      const frozenArmed = deepFreeze(armed("p1"));
      const installed = mustApply(frozenArmed, { type: "attack", seat: "p1", index });
      expect(body(frozenArmed.players.p2.active).scheduledEffect).toBeNull();
      expect(body(installed.state.players.p2.active).scheduledEffect).toEqual({
        turn: 3,
        kind: name,
      });
      const frozenScheduled = deepFreeze(installed.state);
      const fired = mustApply(frozenScheduled, { type: "endTurn", seat: "p2" });
      // The FROZEN board still holds the appointment; the new one has spent it.
      expect(body(frozenScheduled.players.p2.active).scheduledEffect).toEqual({
        turn: 3,
        kind: name,
      });
      // The Knock-Out payload parks on §8.1's prize pick before it promotes, so the
      // spot is drained through that stage; the discard owes no prize and promotes
      // inside the same batch. Both end with `fix-titan` Active — one axis apart.
      const settled = settle(fired);
      expect(settled.players.p2.active).not.toBeNull();
      expect(settled.cardIdByUid[baseUid(settled.players.p2.active)]).toBe("fix-titan");
    });

    it(`a v29 record carrying a ${name} appointment round-trips and STILL fires`, () => {
      const record = JSON.parse(
        JSON.stringify(install("p1", index).state),
      ) as GameState;
      expect(body(record.players.p2.active).scheduledEffect).toEqual({ turn: 3, kind: name });
      const settled = settle(mustApply(record, { type: "endTurn", seat: "p2" }));
      expect(settled.players.p2.bench).toHaveLength(0);
      expect(settled.cardIdByUid[baseUid(settled.players.p2.active)]).toBe("fix-titan");
    });
  }
});
