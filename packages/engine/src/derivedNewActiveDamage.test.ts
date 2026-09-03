import { describe, expect, it } from "vitest";
import { deriveAttackEffect } from "./effects";
import type { EffectOp, GameEvent, GameState } from "./index";
import { applyAction, phaseViewOf } from "./index";
import {
  FIXTURE_POOL,
  NEW_ACTIVE_DAMAGE_DECK,
  activeUid,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  deepFreeze,
  driveSetup,
  mustApply,
  setActiveFromDeck,
  types,
} from "./testFixtures";

// 0.144.0 → 0.145.0 — D228, THE DAMAGE RIDER ON A PROMOTED BODY: the split-out
// row D227 measured, and the mechanism it priced as missing TURNED OUT TO EXIST.
//
// "This attack does {N} damage to the new Active Pokémon." — 8 Standard-legal
// printings across five sentences, every one of them the second clause of a
// sentence whose first clause promoted the body.
//
// 🛑 D227 LEFT AN OPEN QUESTION AND THE ANSWER IS "NEITHER". It asked whether the
// §8.5 fold in `attack.ts` gets RE-ENTERED per promoted body or whether the
// interpreter gains an op that `attack.ts` resolves — and warned that the fold
// sits in front of the interpreter with no channel back from a program. Both
// halves of that framing are true and neither is the price: `snipeActive` has run
// the whole pipeline from INSIDE a program since D96 (Hail Blade's
// `damageDefender`), and it addresses its target by asking `activeTop` who is
// Active *right now*. A body promoted one op earlier is that body. So the price
// is ONE op with one printed number and no addressing machinery at all.
//
// 🛑 THE TWO PRINTED SHAPES ARE TWO PROGRAMS, WHICH IS THE ONE THING THIS FILE
// EXISTS TO KEEP APART. Grimmsnarl `sv07-096` prints "**If you do,** this attack
// does 160 damage…" and the four "Drag Off" sentences print no conditional at
// all. On a board where the promotion succeeds the two are indistinguishable; on
// an opponent with an EMPTY BENCH they differ completely, and that board is the
// spine of section 4 below.
//
// ⚠️ AND ONE FIXTURE BYTE WAS FABRICATED, WHICH THIS SLICE FOUND BY NEEDING IT TO
// BE TRUE. D227 fielded Grimmsnarl with `damage: 130` under a comment reading
// "Its printed 130 is the card's own base damage"; the real row prints NO damage
// field (its 160 base belongs to the card's OTHER attack). The provenance comment
// said "char-for-char" and meant the EFFECT STRING — the numeric fields beside it
// were never in the claim's scope, which is how a made-up byte survives a
// provenance note. Corrected here, and section 2 asserts the absence.

/** The five printed sentences this slice reads, with the program each derives to
    and the LEGAL printing count measured for it.

    Census RE-DERIVED (not inherited from D227, per conventions.md's standing
    rule) on 2026-08-05 against the remote D1 `luminous` — 3,786 rows / 20 sets,
    2,021 `legal_standard = 1` — over `json_each(attacks_json)` +
    `json_extract(value,'$.effect')`, with `GLOB` rather than `LIKE` because
    SQLite's `LIKE` is ASCII case-insensitive and has cost this repo a census.
    Both figures per row: `printings` over the whole remote catalog,
    `legalPrintings` over the Standard pool. A count without a population AND a
    legality is not a fact. */
const CLAUSES = [
  {
    // `sv05-112` Mawile "Invite and Strike", `sv10-091` Primeape "Drag Off"
    // (`sv01-147` Zangoose and `sv03-037` Lampent print it rotated).
    text: "Switch in 1 of your opponent's Benched Pokémon to the Active Spot. This attack does 30 damage to the new Active Pokémon.",
    program: [{ op: "gust" }, { op: "damageNewActive", amount: 30 }] as EffectOp[],
    printings: 4,
    legalPrintings: 2,
  },
  {
    // `sv10.5b-027`/`-111` Cryogonal "Drag Off".
    text: "Switch in 1 of your opponent's Benched Pokémon to the Active Spot. This attack does 20 damage to the new Active Pokémon.",
    program: [{ op: "gust" }, { op: "damageNewActive", amount: 20 }] as EffectOp[],
    printings: 2,
    legalPrintings: 2,
  },
  {
    // `sv08-153`/`-214` Braviary "Drag Off".
    text: "Switch in 1 of your opponent's Benched Pokémon to the Active Spot. This attack does 40 damage to the new Active Pokémon.",
    program: [{ op: "gust" }, { op: "damageNewActive", amount: 40 }] as EffectOp[],
    printings: 2,
    legalPrintings: 2,
  },
  {
    // `sv06-127` Dipplin "Syrup Catcher".
    text: "Switch in 1 of your opponent's Benched Pokémon to the Active Spot. This attack does 70 damage to the new Active Pokémon.",
    program: [{ op: "gust" }, { op: "damageNewActive", amount: 70 }] as EffectOp[],
    printings: 1,
    legalPrintings: 1,
  },
  {
    // `sv07-096` Grimmsnarl "Goad 'n' Grab" — the GATED one, and the family's only
    // printed "If you do".
    text: "Switch out your opponent's Active Pokémon to the Bench. (Your opponent chooses the new Active Pokémon.) If you do, this attack does 160 damage to the new Active Pokémon.",
    program: [
      { op: "opponentSwitchOut", recordAs: "moved" },
      // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable.
      { op: "recordGate", slot: "moved", then: [{ op: "damageNewActive", amount: 160 }] },
    ] as EffectOp[],
    printings: 1,
    legalPrintings: 1,
  },
] as const;

const GUST_30 = 0;
const GUST_20 = 1;
const GUST_40 = 2;
const GUST_70 = 3;
const GATED = 4;

/** U+2019, spelled as an escape: this pair of characters renders nearly
    identically, so the curly one is always written where a reader can see it. */
const RSQUO = "’";

// ── The board. `fix-trainerops` indices, D227's 12 and D228's 13. ──
const GOAD_N_GRAB = 12;
const DRAG_OFF = 13;
/** D181's bare GUST at index 2 — the CONTROL for every rider case: the same
    promotion, the same park, and NO damage clause after it. */
const TAUNT = 2;
/** D227's bare switch-out at index 9 — the gated arm's control, same shape. */
const KICK_AWAY = 9;

function board(seed: number): GameState {
  const state = driveSetup(
    seed,
    { p1: NEW_ACTIVE_DAMAGE_DECK, p2: NEW_ACTIVE_DAMAGE_DECK },
    { first: "p2" },
  );
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** p1 attacks with `fix-trainerops`; p2 holds a `fix-bigbody` Active and a Bench
    built from `benched` — the ids are explicit because WHICH body comes up is the
    whole subject of the damage clause. */
function ready(seed: number, benched: readonly string[]): GameState {
  let state = setActiveFromDeck(board(seed), "p1", "fix-trainerops");
  state = attachFromDeck(state, "p1", "fix-energy", 1);
  state = clearBench(state, "p1");
  state = benchFromDeck(state, "p1", "fix-basic-1");
  state = setActiveFromDeck(state, "p2", "fix-bigbody");
  state = clearBench(state, "p2");
  for (const id of benched) state = benchFromDeck(state, "p2", id);
  return state;
}

function all<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

/** The opponent's bench-index-0 answer, which both parks in this file offer. */
const PICK_FIRST = {
  kind: "pokemon",
  ref: { seat: "p2", spot: { spot: "bench", index: 0 } },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// 1. THE ANCHORS
// ─────────────────────────────────────────────────────────────────────────────

describe("the two anchors — one new op, and the promotion each sentence prints", () => {
  it("derives each printed sentence to its program", () => {
    for (const { text, program } of CLAUSES) {
      expect(deriveAttackEffect(text), text).toEqual(program);
    }
  });

  it("adds up: 8 legal printings across 5 sentences, from 2 anchors", () => {
    // The arithmetic stated rather than described — a slice that quietly dropped
    // one number would still pass every accept case above.
    expect(CLAUSES).toHaveLength(5);
    expect(CLAUSES.reduce((sum, c) => sum + c.legalPrintings, 0)).toBe(8);
    // …which is EXACTLY the figure D227's split-out backlog row promised, and the
    // only one of its figures this slice did not have to correct.
    expect(CLAUSES.reduce((sum, c) => sum + c.printings, 0)).toBe(10);
  });

  it("the AMOUNT is captured, not alternated over the four printed numbers", () => {
    // The claim that makes this two anchors rather than eight: the printed value
    // is read out of `(\d+)`, so a reprint at a number the catalog has never
    // carried derives with no edit. Driven with 55, which no printing prints.
    const invented = deriveAttackEffect(
      "Switch in 1 of your opponent's Benched Pokémon to the Active Spot. This attack does 55 damage to the new Active Pokémon.",
    );
    expect(invented).toEqual([{ op: "gust" }, { op: "damageNewActive", amount: 55 }]);
    // …and on the gated anchor too, so the capture is not a property of one regex.
    expect(
      deriveAttackEffect(
        "Switch out your opponent's Active Pokémon to the Bench. (Your opponent chooses the new Active Pokémon.) If you do, this attack does 55 damage to the new Active Pokémon.",
      )?.[1],
    ).toEqual({
      op: "recordGate",
      slot: "moved",
      // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable.
      then: [{ op: "damageNewActive", amount: 55 }],
    });
  });

  it("each arm's ANTECEDENT is the bare sentence's whole program, plus at most a slot", () => {
    // This family's checkable claim, the same one the draw and switch families
    // carry: a "X. Then Y." must be exactly X followed by Y, or the arm is
    // quietly building a different card.
    const [gustHead] = deriveAttackEffect(CLAUSES[GUST_30].text) ?? [];
    expect(gustHead).toEqual({ op: "gust" });
    expect(
      deriveAttackEffect("Switch in 1 of your opponent's Benched Pokémon to the Active Spot."),
    ).toEqual([gustHead]);
    // The gated arm's antecedent differs from D227's bare op by `recordAs` and by
    // NOTHING else — the field that arrived with this printing.
    const [gatedHead] = deriveAttackEffect(CLAUSES[GATED].text) ?? [];
    expect(gatedHead).toEqual({ op: "opponentSwitchOut", recordAs: "moved" });
    expect(
      deriveAttackEffect(
        "Switch out your opponent's Active Pokémon to the Bench. (Your opponent chooses the new Active Pokémon.)",
      ),
    ).toEqual([{ op: "opponentSwitchOut" }]);
  });

  it("🛑 the CONDITIONAL is read only where it is printed — the two shapes are two programs", () => {
    // The compound-eaten-as-its-first-clause failure, refused in the one direction
    // it could happen here: four sentences print no "If you do" and one does, so a
    // build that gated all five (or none) would be right about the ops and wrong
    // about the card on every whiffed promotion.
    const kinds = (ops: readonly EffectOp[] | null): string[] => (ops ?? []).map((o) => o.op);
    for (const clause of [CLAUSES[GUST_30], CLAUSES[GUST_20], CLAUSES[GUST_40], CLAUSES[GUST_70]]) {
      expect(kinds(deriveAttackEffect(clause.text)), clause.text).toEqual([
        "gust",
        "damageNewActive",
      ]);
    }
    expect(kinds(deriveAttackEffect(CLAUSES[GATED].text))).toEqual([
      "opponentSwitchOut",
      "recordGate",
    ]);
  });

  it("accepts BOTH apostrophes on both anchors", () => {
    // D227's rule, inherited whole: these sentences CONTAIN "opponent's", so a
    // re-ingest that curls the character must derive the SAME program. A measured
    // zero in today's catalog is not a reason to narrow a PARSER — the mistake
    // D227's first draft shipped and `clauseApostrophe.test.ts` caught.
    for (const { text, program } of CLAUSES) {
      const curled = text.replaceAll("'", RSQUO);
      expect(curled).not.toBe(text);
      expect(deriveAttackEffect(curled), curled).toEqual(program);
    }
  });

  it("🛑 REFUSES the near misses, including the one legal printing left unbuilt", () => {
    // ⚠️ THE RESIDUAL IS NAMED RATHER THAN ROUNDED AWAY. Malamar `sv06.5-034`
    // "Colluding Tentacles" is a THIRD sentence on the same string — a trailing
    // "this attack does nothing" requirement over a fact the engine does not keep
    // ("if you didn't play Xerosic's Machinations from your hand during this
    // turn") — so it needs the composition seam D192's block already defers, not a
    // looser regex here. Every deriver in this engine is fully anchored, so it
    // falls to the loud ATTACK_EFFECT_SKIPPED path rather than being half-read.
    const residual =
      "Switch in 1 of your opponent's Benched Pokémon to the Active Spot. If you do, this attack does 120 damage to the new Active Pokémon. If you didn't play Xerosic's Machinations from your hand during this turn, this attack does nothing.";
    expect(deriveAttackEffect(residual)).toBeNull();
    for (const text of [
      // The rotated flip-and-Paralyze compound (`sv03-069` Eelektross), 0 legal.
      "Switch in 1 of your opponent's Benched Pokémon to the Active Spot. If you do, this attack does 60 damage to the new Active Pokémon, and then flip a coin. If heads, that Pokémon is now Paralyzed.",
      // The two "is now Asleep" riders, 0 legal between them — same first clause,
      // a STATUS consequent rather than a damage one.
      "Switch in 1 of your opponent's Benched Pokémon to the Active Spot. The new Active Pokémon is now Asleep.",
      "Your opponent chooses 1 of their Benched Pokémon and switches it with their Active Pokémon. The new Active Pokémon is now Asleep.",
      // A gust rider whose amount is not a number, and one with a leading clause —
      // both anchored out, so neither is half-read.
      "Switch in 1 of your opponent's Benched Pokémon to the Active Spot. This attack does some damage to the new Active Pokémon.",
      "If your opponent's Active Pokémon is a Pokémon ex, switch in 1 of your opponent's Benched Pokémon to the Active Spot. This attack does 30 damage to the new Active Pokémon.",
      // …and the ungated sentence with the gated one's promotion op, which is a
      // sentence no card prints and which must not fall through either anchor.
      "Switch out your opponent's Active Pokémon to the Bench. (Your opponent chooses the new Active Pokémon.) This attack does 160 damage to the new Active Pokémon.",
      // ⚠️ A TRAILING CLAUSE ON EACH ANCHOR — CONSTRUCTED, AND THE CONSTRUCTION IS
      // THE POINT. The `$` on both anchors has NO catalog witness: every printed
      // sentence that extends these two does so at the "If you do" join, which
      // fails the anchors on their own bytes long before the tail matters. So a
      // build that dropped the `$` survives every real string — measured, it
      // survived the mutation harness — and the only honest guard is a tail no
      // card prints. This is D227's arrangement on its own bare anchor, reached
      // here from the opposite direction: that one had a real witness (this
      // slice's own printing) and these have none, which is why they are written
      // down as constructed rather than passed off as census rows.
      `${CLAUSES[GUST_30].text} Draw a card.`,
      `${CLAUSES[GATED].text} Draw a card.`,
      // …and the `^` on the gated anchor, whose leading-clause witness is likewise
      // constructed (the gust anchor's is real, two rows up).
      `Draw a card. ${CLAUSES[GATED].text}`,
    ]) {
      expect(deriveAttackEffect(text), text).toBeNull();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. THE FIXTURE — and the byte D227 invented
// ─────────────────────────────────────────────────────────────────────────────

describe("PROVENANCE — both printed shapes on one body, and NEITHER prints base damage", () => {
  it("fields the pair at indices 12-13, appended and not inserted", () => {
    const attacks = FIXTURE_POOL["fix-trainerops"]?.attacks ?? [];
    // 48 at D236, which appended 43-47 (attach from the HAND); 43 at D235, which
    // appended 35-42 (the deck search that ATTACHES); 35 at
    // D234, which appended 29-34 (the discard-pile attach); 29 at D232,
    // which appended 25-28 (the opponent-hand family); 25 at D231, which appended
    // 20-24 (the deck search into your own HAND); 20 at D230, which appended 17-19
    // (the deck search onto your own Bench); 17 at D229, which appended 14-16 (the
    // attacker's own Energy onto its own Bench) — 12-13 did not move, which is
    // what this file's constants depend on.
    // ⚠️ FIFTY-FIVE AT D240; **58 at D241**, which appended 55-57 (look at the
    // top N — "Summoning Gate" / "Larimar Rain" / "Dig It Up").
    // `derivedLookAtTop.test.ts` owns 55-57. ELEVEN slices, eleven appends, zero
    // inserts.
    // 🆕🆕 **63 AT D426**, which appended **61-62** — the opponent-chooses hand
    // discard (*"Your opponent discards 2 cards from their hand."* / *"…a card…"*).
    // `opponentHandDiscard.test.ts` owns them, and the append-never-insert
    // discipline this whole paragraph exists for holds again: 0-60 are addressed by
    // constant in a dozen sibling suites and every one of them still means what it
    // meant. ⚠️ NO ORDINAL IS CLAIMED (*"the Nth slice"*) — the running count above
    // was last written at D241 and was already one append behind by D246, which is
    // exactly how a count in a comment rots. The LENGTH is the executable half and
    // it is the line below.
    // 🆕🆕 **68 AT D443**, which appended **66-67** — the OPPONENT-BOARD pair
    // (`derivedOpponentEnergyMove.test.ts` owns them). TWELVE sibling suites carry
    // this pin and all twelve were stepped in one pass, as D442 stepped eleven.
    // 🆕🆕 **66 AT D442**, which appended **63-65** — the destination-side SPREAD
    // (`derivedSpreadEnergyMove.test.ts` owns them). ELEVEN sibling suites carry this
    // same length pin and ALL of them were stepped in one pass (D431): a green run
    // after fixing the one that reddened is evidence the runner stopped early.
    expect(attacks).toHaveLength(73); // 🆕🆕 **72 AT D457**, which appended **71** — and NOT to field a new family: index 42 was the demonstrator's LAST unread sentence and D457 built it, leaving `optionalSelfSwitch.test.ts` §7's loud-path attribution control with no subject at all. 71 is corpus line 404 (the Future-banner attach, DATA-BLOCKED rather than merely unbuilt), and `testFixtures.ts` carries the argument. THIRTEEN suites carry this pin and all thirteen were stepped in one pass (D431).
    expect(attacks[GOAD_N_GRAB]?.effect).toBe(CLAUSES[GATED].text);
    expect(attacks[DRAG_OFF]?.effect).toBe(CLAUSES[GUST_30].text);
    // The indices this file and its two siblings address by constant did not move.
    expect(attacks[TAUNT]?.effect).toBe(
      "Switch in 1 of your opponent's Benched Pokémon to the Active Spot.",
    );
    expect(attacks[KICK_AWAY]?.effect).toBe(
      "Switch out your opponent's Active Pokémon to the Bench. (Your opponent chooses the new Active Pokémon.)",
    );
  });

  it("🛑 NO PRINTED BASE DAMAGE on either — the field D227 invented is gone", () => {
    // ⚠️ THE ASSERTION THAT WOULD HAVE CAUGHT THE FABRICATION, WRITTEN NOW THAT IT
    // HAS COST SOMETHING. All 8 legal printings of this mechanism carry no
    // `damage` field (measured over the remote D1); D227's fixture carried
    // `damage: 130` and a comment claiming the number was the card's own, and a
    // green case in the sibling suite read that number as evidence "the attack
    // works". The absence is a PROVENANCE claim, so it is asserted, not assumed.
    const attacks = FIXTURE_POOL["fix-trainerops"]?.attacks ?? [];
    expect(attacks[GOAD_N_GRAB]?.damage).toBeUndefined();
    expect(attacks[DRAG_OFF]?.damage).toBeUndefined();
    // …and the neighbouring index that DOES print a number still does, so this is
    // an assertion about these two rows and not about the fixture being damageless.
    expect(attacks[3]?.damage).toBe(60);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. THE POINT OF THE SLICE — the damage lands on the body that CAME UP
// ─────────────────────────────────────────────────────────────────────────────

describe("end to end — genuine §8.5 damage, on the promoted body", () => {
  it("deals the printed N to the body the CONTROLLER gusted up", () => {
    const state = ready(11, ["fix-basic-1", "fix-basic-1"]);
    const wasActive = activeUid(state, "p2");
    const target = state.players.p2.bench[0]?.stack[0];
    deepFreeze(state);
    // Two benched bodies → the gust parks on the CONTROLLER's own pick.
    const parked = mustApply(state, { type: "attack", seat: "p1", index: DRAG_OFF });
    expect(parked.state.phase.kind).toBe("effect:choose");
    expect(phaseViewOf(parked.state, "p1").waitingSeat).toBe("p1");
    // Nothing is dealt before the promotion — the clause has no subject yet.
    expect(all(parked.events, "DAMAGE_DEALT")).toHaveLength(0);
    const done = mustApply(parked.state, {
      type: "resolveEffect",
      seat: "p1",
      choice: PICK_FIRST,
    });
    expect(activeUid(done.state, "p2")).toBe(target);
    const dealt = all(done.events, "DAMAGE_DEALT");
    expect(dealt).toHaveLength(1);
    // 🛑 THE UID IS THE ASSERTION. A build that dealt to the captured defender
    // would produce the same number against the wrong body — and on this board the
    // wrong body is the one now sitting on the Bench.
    expect(dealt[0]?.uid).toBe(target);
    expect(dealt[0]?.uid).not.toBe(wasActive);
    expect(dealt[0]?.dealt).toBe(30);
    expect(done.state.players.p2.active?.damage).toBe(30);
    // …and the displaced body took nothing at all.
    expect(done.state.players.p2.bench[1]?.damage ?? 0).toBe(0);
  });

  it("forces at one candidate and deals in the same action", () => {
    // The M1 no-choice ending, which is also the simplest board this op has.
    const state = ready(12, ["fix-basic-1"]);
    const target = state.players.p2.bench[0]?.stack[0];
    deepFreeze(state);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: DRAG_OFF,
    });
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(activeUid(done, "p2")).toBe(target);
    expect(all(events, "DAMAGE_DEALT")[0]?.uid).toBe(target);
    expect(types(events)).toContain("TURN_ENDED");
  });

  it("🛑 runs the WHOLE §8.5 pipeline on the promoted body — Weakness DOUBLES it", () => {
    // ⚠️ THE CASE THAT SEPARATES THIS OP FROM THE ONE THE BACKLOG ROW WARNED
    // ABOUT. `damageActive` would place 3 counters (30 HP flat) and emit
    // COUNTERS_PLACED; the printed words are "this attack DOES 30 damage", so the
    // hit is genuine attack damage and a ×2 Colorless body takes 60. The attacker
    // is Colorless, which is why the witness has to be the synthetic
    // `fix-colorless-weak` — no real card prints a Colorless Weakness.
    const state = ready(13, ["fix-colorless-weak"]);
    const target = state.players.p2.bench[0]?.stack[0];
    deepFreeze(state);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: DRAG_OFF,
    });
    expect(activeUid(done, "p2")).toBe(target);
    const dealt = all(events, "DAMAGE_DEALT");
    expect(dealt).toHaveLength(1);
    expect(dealt[0]?.base).toBe(30);
    expect(dealt[0]?.weakness).toEqual({ op: "multiply", amount: 2 });
    expect(dealt[0]?.dealt).toBe(60);
    expect(done.players.p2.active?.damage).toBe(60);
    // …and the row is DAMAGE_DEALT, never COUNTERS_PLACED: the distinction is what
    // the whole op turns on and it is visible in the event stream.
    expect(all(events, "COUNTERS_PLACED")).toHaveLength(0);
  });

  it("the CONTROL: the same promotion with no damage clause deals nothing", () => {
    // D181's bare gust at index 2 — same board, same park, same promotion. Without
    // it, "the damage landed" could be read off a build that damages on every
    // promotion, which is a different (and wrong) card.
    const state = ready(13, ["fix-colorless-weak"]);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: TAUNT,
    });
    expect(activeUid(done, "p2")).toBe(state.players.p2.bench[0]?.stack[0]);
    expect(all(events, "DAMAGE_DEALT")).toHaveLength(0);
    expect(done.players.p2.active?.damage).toBe(0);
  });

  it("a lethal rider Knocks Out the promoted body, swept by the attack epilogue", () => {
    // The gated printing's 160 into a 60 HP body. The KO is not this op's business
    // — it places no prizes and ends no turn — and that is the claim: the epilogue
    // already queued behind the park sweeps it, like every program-emitted hit.
    const state = ready(14, ["fix-basic-1", "fix-basic-1"]);
    const target = state.players.p2.bench[0]?.stack[0];
    deepFreeze(state);
    const parked = mustApply(state, { type: "attack", seat: "p1", index: GOAD_N_GRAB });
    const { events } = mustApply(parked.state, {
      type: "resolveEffect",
      seat: "p2",
      choice: PICK_FIRST,
    });
    expect(all(events, "DAMAGE_DEALT")[0]?.dealt).toBe(160);
    const kos = all(events, "KNOCKED_OUT");
    expect(kos).toHaveLength(1);
    expect(kos[0]?.uid).toBe(target);
    expect(types(events)).toContain("PRIZES_OWED");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. THE WHIFF — where the two printed shapes stop agreeing
// ─────────────────────────────────────────────────────────────────────────────

describe("🛑 the EMPTY opponent Bench — the printed 'If you do' is the whole difference", () => {
  it("the UNGATED sentence still deals, to the Active that never moved", () => {
    // "Switch in 1 of your opponent's Benched Pokémon to the Active Spot. This
    // attack does 30 damage to the new Active Pokémon." — no conditional is
    // printed, so nothing gates the damage: the gust does as much as it can (§8.6,
    // i.e. nothing) and the clause lands on whoever holds the Active Spot.
    const state = ready(21, []);
    const wasActive = activeUid(state, "p2");
    deepFreeze(state);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: DRAG_OFF,
    });
    expect(activeUid(done, "p2")).toBe(wasActive);
    expect(done.phase.kind).not.toBe("effect:choose");
    const dealt = all(events, "DAMAGE_DEALT");
    expect(dealt).toHaveLength(1);
    expect(dealt[0]?.uid).toBe(wasActive);
    expect(dealt[0]?.dealt).toBe(30);
    // The sentence WAS read — the silence is the board's, not the deriver's.
    expect(all(events, "ATTACK_EFFECT_SKIPPED")).toHaveLength(0);
  });

  it("the GATED sentence deals NOTHING at all", () => {
    // "…(Your opponent chooses the new Active Pokémon.) **If you do,** this attack
    // does 160 damage…" — the promotion whiffed, so `switchRecording` filed an
    // empty slot, `recordGateHolds` reads its LENGTH as false and the branch never
    // runs. Same board, same seed, same attacker; the printed conditional is the
    // only difference between this case and the one above it.
    const state = ready(21, []);
    const wasActive = activeUid(state, "p2");
    deepFreeze(state);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: GOAD_N_GRAB,
    });
    expect(activeUid(done, "p2")).toBe(wasActive);
    expect(all(events, "DAMAGE_DEALT")).toHaveLength(0);
    expect(done.players.p2.active?.damage).toBe(0);
    // …and it is still not a SKIPPED effect: the engine read the whole sentence
    // and the board had no answer for it.
    expect(all(events, "ATTACK_EFFECT_SKIPPED")).toHaveLength(0);
    expect(types(events)).toContain("TURN_ENDED");
  });

  it("…and on a board where the promotion SUCCEEDS the two agree again", () => {
    // The other half of the pair, and the reason the gate cannot be tested on a
    // normal board: with a Bench to promote from, both shapes deal their printed
    // number. A build that dropped the `recordGate` entirely would pass every case
    // in section 3 and fail only the one above this.
    // `fix-bigbody` (200 HP, no Weakness) so the 160 lands without a KO — the
    // claim here is that the gate HELD, and a Knocked-Out body would leave p2 with
    // no Active to read it off.
    const state = ready(22, ["fix-bigbody"]);
    const target = state.players.p2.bench[0]?.stack[0];
    deepFreeze(state);
    const parked = mustApply(state, { type: "attack", seat: "p1", index: GOAD_N_GRAB });
    // One candidate → forced, no question to ask, so this is one action.
    expect(parked.state.phase.kind).not.toBe("effect:choose");
    expect(activeUid(parked.state, "p2")).toBe(target);
    const dealt = all(parked.events, "DAMAGE_DEALT");
    expect(dealt).toHaveLength(1);
    expect(dealt[0]?.uid).toBe(target);
    expect(dealt[0]?.dealt).toBe(160);
  });

  it("the recording is filed on the PARKED arm too, not only the forced one", () => {
    // ⚠️ THE ARM A REAL GRIMMSNARL BOARD ACTUALLY TAKES. The opponent picks when
    // they have ≥2 benched bodies, so an omitted `switchRecording` on the RESUMED
    // arm would file nothing exactly there — the gate would read an empty slot and
    // the 160 would silently vanish on every board where the park is interesting.
    // The forced arm above cannot see that mistake at all.
    const state = ready(23, ["fix-colorless-weak", "fix-basic-1"]);
    const target = state.players.p2.bench[0]?.stack[0];
    deepFreeze(state);
    const parked = mustApply(state, { type: "attack", seat: "p1", index: GOAD_N_GRAB });
    expect(parked.state.phase.kind).toBe("effect:choose");
    expect(phaseViewOf(parked.state, "p2").waitingSeat).toBe("p2");
    const { events } = mustApply(parked.state, {
      type: "resolveEffect",
      seat: "p2",
      choice: PICK_FIRST,
    });
    const dealt = all(events, "DAMAGE_DEALT");
    expect(dealt).toHaveLength(1);
    expect(dealt[0]?.uid).toBe(target);
    // ×2 Colorless on the promoted body, so the number also proves the pipeline
    // ran on the RESUMED path and not only on the forced one — and 320 into 200 HP
    // is lethal, which is why the body is read off the event rather than the board.
    expect(dealt[0]?.dealt).toBe(320);
    expect(all(events, "KNOCKED_OUT")[0]?.uid).toBe(target);
  });

  it("the CONTROL: D227's bare switch-out on the same empty Bench", () => {
    // The gated sentence minus its rider. Same silent no-op, same absence of a
    // loud row — so the case above it is about the GATE and not about the
    // promotion op having become noisy.
    const state = ready(21, []);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: KICK_AWAY,
    });
    expect(all(events, "DAMAGE_DEALT")).toHaveLength(0);
    expect(all(events, "ATTACK_EFFECT_SKIPPED")).toHaveLength(0);
    expect(done.phase.kind).not.toBe("effect:choose");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. §11 — the block, on the one board where it can still bite
// ─────────────────────────────────────────────────────────────────────────────

describe("a live §11 block, and the body it can still protect", () => {
  it("does NOT protect the promoted body — it protects the one that left", () => {
    // The composed §11 reading, which `preventBlock.test.ts` classifies one op at
    // a time and cannot show: the block's holder is the Active when the attack is
    // declared, and by the time the damage op asks who is Active it is on the
    // Bench. The hit lands on the unshielded body that came up, at full value.
    let state = ready(31, ["fix-basic-1"]);
    const shielded = activeUid(state, "p2");
    const target = state.players.p2.bench[0]?.stack[0];
    const p2 = state.players.p2;
    // A wide block on p2's Active, stamped for the turn this attack lands in —
    // the same shape `preventBlock.test.ts` builds its probe board from.
    state = {
      ...state,
      players: {
        ...state.players,
        p2: {
          ...p2,
          active:
            p2.active === null
              ? null
              : { ...p2.active, attackBlock: { turn: state.turn, effects: true } },
        },
      },
    };
    deepFreeze(state);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: DRAG_OFF,
    });
    // The shielded body moved (the promotion is `untouched` by §11) …
    expect(activeUid(done, "p2")).toBe(target);
    expect(done.players.p2.bench[0]?.stack[0]).toBe(shielded);
    // … and the damage landed on the body that came up, unreduced.
    const dealt = all(events, "DAMAGE_DEALT");
    expect(dealt).toHaveLength(1);
    expect(dealt[0]?.uid).toBe(target);
    expect(dealt[0]?.dealt).toBe(30);
    expect(dealt[0]?.prevented).toBeUndefined();
  });

  it("…and DOES protect it when the promotion whiffed", () => {
    // The one composed board where the block bites: an empty opponent Bench leaves
    // the shielded Active in place, so the ungated clause hits the body the block
    // is about and is nulled to 0 with the flag set.
    let state = ready(32, []);
    const shielded = activeUid(state, "p2");
    const p2 = state.players.p2;
    state = {
      ...state,
      players: {
        ...state.players,
        p2: {
          ...p2,
          active:
            p2.active === null
              ? null
              : { ...p2.active, attackBlock: { turn: state.turn, effects: true } },
        },
      },
    };
    deepFreeze(state);
    const { state: done, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: DRAG_OFF,
    });
    expect(activeUid(done, "p2")).toBe(shielded);
    const dealt = all(events, "DAMAGE_DEALT");
    expect(dealt).toHaveLength(1);
    expect(dealt[0]?.uid).toBe(shielded);
    expect(dealt[0]?.dealt).toBe(0);
    expect(dealt[0]?.prevented).toBe(true);
    expect(done.players.p2.active?.damage).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. THE WIRE — the op crosses a park, so it crosses a record
// ─────────────────────────────────────────────────────────────────────────────

describe("the parked program survives a JSON round trip", () => {
  it("replays the gated printing through a serialised continuation", () => {
    // The op rides `EffectContinuation.pendingOp` on the gated arm (the gate and
    // its branch are queued behind a park the OPPONENT answers), so a record
    // written by this build must still resolve after crossing the wire. No
    // `MATCH_RECORD_VERSION` bump is claimed, and this is the check behind that
    // claim rather than an assertion of it.
    const state = ready(41, ["fix-bigbody", "fix-basic-1"]);
    const target = state.players.p2.bench[0]?.stack[0];
    const parked = mustApply(state, { type: "attack", seat: "p1", index: GOAD_N_GRAB });
    const rehydrated = JSON.parse(JSON.stringify(parked.state)) as GameState;
    expect(rehydrated.phase.kind).toBe("effect:choose");
    const resumed = applyAction(rehydrated, {
      type: "resolveEffect",
      seat: "p2",
      choice: PICK_FIRST,
    });
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) throw new Error("expected the resumed action to apply");
    expect(activeUid(resumed.state, "p2")).toBe(target);
    expect(all(resumed.events, "DAMAGE_DEALT")[0]?.dealt).toBe(160);
  });
});
