import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import {
  deriveAttackEffect,
  splitAttackGateClause,
  splitAttackTrailingClause,
} from "./effects";
import { applyAction, createGame, engineVersion, otherSeat, programFor } from "./index";
import type { GameEvent, GameState, InPlayPokemon, Seat } from "./index";
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
import { koByEffectMarker, scheduledCountersDue, withActive } from "./types";

// 0.335.0 → 0.336.0 — 🆕🆕 D434: THE DELAYED EFFECT, and the first thing this
// engine SCHEDULES rather than resolves.
//
//   "At the end of your opponent's next turn, put 9 damage counters on the
//    Defending Pokémon."
//
// **1 sentence / 3 legal printings** — `censusAttackCorpus.ts` row 54. ONE anchor
// (`DELAYED_DEFENDER_COUNTERS`), ONE arm in `deriveAttackEffect` (5f), ONE
// `EffectOp` (`scheduleCounters`), ONE `stepOp` case, ONE interpreter installer,
// ONE new record type (`ScheduledCounters`), ONE new REQUIRED `InPlayPokemon` field
// (`scheduledCounters`), ONE new reader (`scheduledCountersDue`), ONE new event
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
// `scheduledCounters` at all, not a `scheduledCounters` missing one key. **A "rest"
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

const DELAY = 0; // {C}, NO damage, the sentence
const PLAIN = 1; // {C}, NO damage, NO effect — the ONE-AXIS control
const DISCARD = 2; // {C}, NO damage, corpus row 53 — the loud-path witness
const POISON = 3; // {C}, NO damage, "…is now Poisoned." — the ordering board's other clock
const SMASH = 4; // {C}, 90 damage, NO effect — the ATTACK-KO control for the cause rung
const DEVOLVE = 5; // {C}, NO damage, D433's sweep — the fourth §10 literal's driver

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

  it("the arm reads it, counters become HP, and the two siblings stay unclaimed", () => {
    expect(deriveAttackEffect(SENTENCE)).toEqual([{ op: "scheduleCounters", amount: 90 }]);
    expect(resolvedByAnyReader(SENTENCE)).toBe(true);
    expect(resolvedByAnyReader(SIBLING_DISCARD)).toBe(false);
    expect(resolvedByAnyReader(SIBLING_KO)).toBe(false);
  });

  it("🛑 ROW 113 DOES NOT COMPOSE — MEASURED after the arm landed, not assumed", () => {
    // D426's mechanism: `splitAttackTrailingClause` composes when
    // `deriveAttackEffect` already reads the TAIL. Row 113's HEAD is claimed (D431's
    // *"Discard all Energy from this Pokémon."*) and its TAIL is this family's
    // KNOCK-OUT payload, which no anchor in `effects.ts` matches — so the splitter
    // returns `null` outright (`deriveAttackEffect(tail) === null` is its second
    // guard) and the whole compound stays on the loud `ATTACK_EFFECT_SKIPPED` path.
    // **This slice buys exactly 3 printings, and nothing composed.**
    expect(splitAttackTrailingClause(SIBLING_KO)).toBeNull();
    // …and the null is attributable to the TAIL alone, on one axis: the head is
    // claimed and the tail is not.
    expect(deriveAttackEffect("Discard all Energy from this Pokémon.")).not.toBeNull();
    expect(deriveAttackEffect(SIBLING_KO_TAIL)).toBeNull();
    expect(resolvedByAnyReader(SIBLING_KO_TAIL)).toBe(false);
    // 🛑 THE FALSIFIER IS EXECUTABLE (D428). The day a successor claims the KO
    // payload, this rung goes RED and the compound composes for free — which is the
    // condition that turns 3 printings into 5, stated as a test rather than as
    // prose.
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
    const scheduled = body(state.players.p2.active).scheduledCounters;
    expect(scheduled).toEqual({ turn: 3, amount: 90 });
    // …and the INSTALLER's own body carries nothing: bare means the defender.
    expect(body(state.players.p1.active).scheduledCounters).toBeNull();
    const row = find(events, "COUNTERS_SCHEDULED");
    expect(row).toEqual({
      type: "COUNTERS_SCHEDULED",
      seat: "p2",
      uid: baseUid(state.players.p2.active),
      amount: 90,
      turn: 3,
    });
  });

  it("the reader answers only on the stamped turn — driven in both directions", () => {
    const pokemon = body(install("p1").state.players.p2.active);
    expect(scheduledCountersDue(pokemon, 2)).toBeNull();
    expect(scheduledCountersDue(pokemon, 3)).toBe(90);
    expect(scheduledCountersDue(pokemon, 4)).toBeNull();
    // …and an unscheduled body answers `null` for every turn, which is what makes
    // "no schedule" and "a spent schedule" one answer at the read site.
    const fresh = body(armed("p1").players.p2.active);
    expect(fresh.scheduledCounters).toBeNull();
    expect(scheduledCountersDue(fresh, 3)).toBeNull();
  });

  it("the log row names the amount in HP and the turn from the VICTIM's side", () => {
    const { state, events } = install("p1");
    expect(render(events, state).find((r) => r.text.includes("scheduled"))).toEqual({
      who: "p2",
      text: "fix-doomed has 90 damage scheduled for the end of your next turn",
    });
  });

  it("no ATTACK_EFFECT_SKIPPED — and the one-axis sibling IS skipped", () => {
    expect(count(install("p1").events, "ATTACK_EFFECT_SKIPPED")).toBe(0);
    expect(count(install("p2").events, "ATTACK_EFFECT_SKIPPED")).toBe(0);
    const skipped = install("p1", DISCARD);
    expect(count(skipped.events, "ATTACK_EFFECT_SKIPPED")).toBe(1);
    expect(find(skipped.events, "ATTACK_EFFECT_SKIPPED")?.effect).toBe(SIBLING_DISCARD);
    expect(body(skipped.state.players.p2.active).scheduledCounters).toBeNull();
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
      expect(body(installed.state.players[victim].active).scheduledCounters).toEqual({
        turn: 3,
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
    expect(body(fired.state.players[victim].active).scheduledCounters).toEqual({
      turn: 3,
      amount: 90,
    });
    expect(scheduledCountersDue(body(fired.state.players[victim].active), fired.state.turn)).toBe(
      null,
    );
    // Two more turn boundaries, and the damage total never moves again.
    let state = mustApply(fired.state, { type: "endTurn", seat: installer }).state;
    state = mustApply(state, { type: "endTurn", seat: victim }).state;
    expect(body(state.players[victim].active).damage).toBe(90);
  });

  it("the PLAIN control schedules nothing and the Checkup places nothing", () => {
    const installed = install("p1", PLAIN, "fix-doom-tank");
    expect(body(installed.state.players.p2.active).scheduledCounters).toBeNull();
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
    return setConditions(installed, "p2", { poisonDamage: 10, burned: true, rotation: "asleep" });
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
    expect(body(state.players.p2.active).scheduledCounters).toEqual({ turn: 3, amount: 90 });
    return state;
  }

  function stampOf(pokemon: InPlayPokemon | undefined): unknown {
    if (pokemon === undefined) return "MISSING";
    return pokemon.scheduledCounters;
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
    expect(body(state.players.p2.active).scheduledCounters).toEqual({ turn: 3, amount: 90 });
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
      scheduledCounters: { turn: 5, amount: 90 },
    });
    const p1Turn = mustApply(rescheduled, { type: "endTurn", seat: "p2" }).state;
    expect(p1Turn.turn).toBe(4);
    expect(body(p1Turn.players.p2.active).scheduledCounters).toEqual({ turn: 5, amount: 90 });
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
    expect(find(attacked.events, "COUNTERS_SCHEDULED")?.turn).toBe(3);
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
    expect(promoted.scheduledCounters).toBeNull();
    const fired = mustApply(taken.state, { type: "endTurn", seat: "p2" });
    expect(all(fired.events, "COUNTERS_PLACED")).toEqual([]);
    expect(body(fired.state.players.p2.active).damage).toBe(0);
  });

  it("6. A FRESH BODY carries none (types.ts `makeInPlay`)", () => {
    const fresh = armed("p1");
    expect(body(fresh.players.p1.active).scheduledCounters).toBeNull();
    expect(body(fresh.players.p2.active).scheduledCounters).toBeNull();
    expect(fresh.players.p2.bench.every((p) => p.scheduledCounters === null)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §8 — THE PERSISTED QUESTION: `MATCH_RECORD_VERSION` 27 → 28, driven BOTH ways.
// ─────────────────────────────────────────────────────────────────────────────
describe("§8 — the bump, and the soft landing it refuses", () => {
  // ⚠️ `MATCH_RECORD_VERSION` IS NOT EXPORTED FROM THIS PACKAGE (it lives in
  // `apps/api/src/lobby/match.ts`, where the gate and its argument sit, and where
  // `match.test.ts` pins the literal 28 and drives ±1 to null). What is driven HERE
  // is the ENGINE-side fact the constant is about: whether a record written by the
  // previous deploy can be read benignly by this one.
  function saved(): GameState {
    const state = install("p1", DELAY, "fix-doom-tank").state;
    expect(state.turn).toBe(3);
    return JSON.parse(JSON.stringify(state)) as GameState;
  }

  it("🛑 DIRECTION 1 — a v28 record round-trips and the schedule STILL fires", () => {
    const record = saved();
    expect(body(record.players.p2.active).scheduledCounters).toEqual({ turn: 3, amount: 90 });
    const fired = mustApply(record, { type: "endTurn", seat: "p2" });
    expect(all(fired.events, "COUNTERS_PLACED").map((e) => e.source)).toEqual(["delayed"]);
    expect(body(fired.state.players.p2.active).damage).toBe(90);
  });

  it("🛑 DIRECTION 2 — a v27-SHAPED body is not a body this deploy can read AT ALL", () => {
    // The v27 shape is BUILT rather than imagined: the key is genuinely DELETED from
    // a JSON round-tripped board, which is what a record written by the previous
    // deploy actually looks like.
    const legacy = saved();
    const victim = body(legacy.players.p2.active) as Omit<
      InPlayPokemon,
      "scheduledCounters"
    > & { scheduledCounters?: { turn: number; amount: number } };
    // biome-ignore lint/performance/noDelete: the key must be genuinely ABSENT. `= undefined` leaves it PRESENT, which is the exact distinction D124's rule turns on and the one this case exists to drive.
    delete victim.scheduledCounters;
    // ABSENT, not `undefined` — the distinction D124 refuses to blur and a `toEqual`
    // would hide.
    expect("scheduledCounters" in victim).toBe(false);

    // 🛑 AND HERE THE RECORD-VALUED FIELD DIVERGES FROM D432's BARE STAMP, WHICH IS
    // A FINDING RATHER THAN A DETAIL. A missing `noWeaknessTurn` reads as
    // `undefined === state.turn`, i.e. FALSE — silent. A missing `scheduledCounters`
    // reads as `undefined !== null`, and the very next line dereferences `.turn`. So
    // this deploy does not lose a rule on a v27 record, it **dies at the next turn
    // boundary**: every Checkup calls this reader on the ended seat's Active.
    // 🛑 THE READER IS NOT WRITTEN DEFENSIVELY, AND THAT IS THE ENGINE'S STANDING
    // RULE RATHER THAN THIS SLICE's CHOICE — `attackBlockOf` and
    // `installedReductionOf` (continuous.ts) both say it in their own comments:
    // *"no defensive `=== undefined` arm: the field is REQUIRED, and a record
    // written before it existed is retired by MATCH_RECORD_VERSION rather than read
    // benignly here"*. Three record-valued fields, one rule, and the constant is
    // what makes it safe.
    expect(() => scheduledCountersDue(victim as unknown as InPlayPokemon, 3)).toThrow();
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
    ).toEqual(["scheduledCounters"]);
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
      const scheduled = pokemon.scheduledCounters as
        | { turn: number; amount: number }
        | null
        | undefined;
      return scheduled != null && scheduled.turn === turn ? scheduled.amount : null;
    };
    const withKey = saved();
    const withoutKey = saved();
    const stripped = body(withoutKey.players.p2.active) as Omit<
      InPlayPokemon,
      "scheduledCounters"
    > & { scheduledCounters?: { turn: number; amount: number } };
    // biome-ignore lint/performance/noDelete: the key must be genuinely ABSENT. `= undefined` leaves it PRESENT, which is the exact distinction D124's rule turns on and the one this case exists to drive.
    delete stripped.scheduledCounters;
    expect(tolerant(body(withKey.players.p2.active), 3)).toBe(90);
    expect(tolerant(stripped as unknown as InPlayPokemon, 3)).toBeNull();
    // Same board, same action, and a 90-point difference in what the victim takes —
    // with NOTHING in the event stream naming a lost rule. That is D124's benign soft
    // landing, and it is what optional would have bought.
    const a = mustApply(withKey, { type: "endTurn", seat: "p2" });
    expect(body(a.state.players.p2.active).damage).toBe(90);
  });

  it("the engine version moved with the behaviour", () => {
    expect(engineVersion).toBe("0.336.0");
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
    expect(count(attacked.events, "COUNTERS_SCHEDULED")).toBe(0);
    expect(body(attacked.state.players.p2.active).scheduledCounters).toBeNull();
    const fired = endVictimTurn(attacked.state, "p2");
    expect(all(fired.events, "COUNTERS_PLACED")).toEqual([]);
  });

  it("the ADMITTED control differs on ONE axis — the same board without the shield", () => {
    const attacked = install("p1");
    expect(count(attacked.events, "ATTACK_EFFECT_PREVENTED")).toBe(0);
    expect(count(attacked.events, "COUNTERS_SCHEDULED")).toBe(1);
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
    expect(body(installed.players.p2.active).scheduledCounters).toEqual({ turn: 3, amount: 90 });
    const bigger = withActive(installed, "p2", {
      ...body(installed.players.p2.active),
      scheduledCounters: { turn: 3, amount: 120 },
    });
    expect(scheduledCountersDue(body(bigger.players.p2.active), 3)).toBe(120);
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
    expect(body(raised.state.players.p2.active).scheduledCounters).toEqual({
      turn: 3,
      amount: 120,
    });
    // …and NOT 210: the merge is `Math.max`, not a sum.
    expect(all(up, "COUNTERS_SCHEDULED").map((e) => e.amount)).toEqual([90, 120]);

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
    expect(body(lowered.state.players.p2.active).scheduledCounters).toEqual({
      turn: 3,
      amount: 120,
    });
    // The SECOND op changed nothing, so it announced nothing — announcing a
    // re-install that moved no number would be announcing a non-event (D140/D146).
    expect(all(down, "COUNTERS_SCHEDULED").map((e) => e.amount)).toEqual([120]);
  });

  it("a schedule stamped for a LATER turn is untouched by the Checkup it is not for", () => {
    const installed = install("p1", DELAY, "fix-doom-tank").state;
    const later = withActive(installed, "p2", {
      ...body(installed.players.p2.active),
      scheduledCounters: { turn: 5, amount: 90 },
    });
    const fired = mustApply(later, { type: "endTurn", seat: "p2" });
    expect(all(fired.events, "COUNTERS_PLACED")).toEqual([]);
    expect(body(fired.state.players.p2.active).scheduledCounters).toEqual({
      turn: 5,
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
    expect(body(frozenArmed.players.p2.active).scheduledCounters).toBeNull();
    expect(body(installed.state.players.p2.active).scheduledCounters).toEqual({
      turn: 3,
      amount: 90,
    });

    const frozenScheduled = deepFreeze(installed.state);
    const fired = mustApply(frozenScheduled, { type: "endTurn", seat: "p2" });
    expect(body(frozenScheduled.players.p2.active).damage).toBe(0);
    expect(body(fired.state.players.p2.active).damage).toBe(90);
  });
});
