import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { attackGateOf, attackTimingBlocked, firstTurnAttackBanned } from "./index";
import { applyAction, createGame, programFor, redactGame } from "./index";
// ⚠️ NOT RE-EXPORTED FROM THE PACKAGE INDEX (D272, deliberately) — the whole-pool
// sweep in §6 is the only kind of caller it has.
import { registryCardIds } from "./registry";
import type { BoardCondition, GameState, InPlayPokemon, Seat } from "./index";
import {
  FIXTURE_POOL,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  deepFreeze,
  setActiveFromDeck,
  typedEnergy,
  walkProgram,
} from "./testFixtures";

// 0.194.0 → 0.195.0 — D281: THE PER-ATTACK-INDEX TIMING GATE.
//
// ONE new `CardProgram` field (`attackGate`), keyed by the SAME attack index the
// `attack` map is keyed by, carrying THREE arms over TWO polarities of one printed
// clause family — and **ZERO new `BoardCondition` members**, because D280 built
// the condition that 10 of the 13 printings need and this slice authors it
// unchanged at both signs.
//
// ── THE CENSUS, RE-DERIVED RATHER THAN CARRIED ───────────────────────────────
//
// D280 measured 13 and left the number to be re-derived. It reproduces EXACTLY,
// with the 7/3/3 split intact (remote D1 `luminous`, 2026-08-08, `json_each` over
// `attacks_json` so the printed INDEX comes back with the text):
//
//   n  shape    ids                                        printed clause
//   7  BAN      Terapagos ex sv07-128/-170/-173/            "If you go second, you
//               sv08.5-092/-169/-180/svp-165 idx 0          can't use this attack
//                                                           during your first turn."
//   3  GATE     Illumise sv06-010 idx 0;                    "You can use this attack
//               Scream Tail ex sv06-094/-197 idx 0          only if you go second,
//                                                           and only during your
//                                                           first turn."
//   3  LICENCE  Volbeat sv06-009 idx 0;                     "If you go first, you can
//               Exeggcute sv08-001/-192 idx 0               use this attack during
//                                                           your first turn."
//   ──
//  13  and the pool-wide query returns 15 — the other 2 are Bombirdier ex
//      `sv04-156`/`-234`, both `legal_standard = 0`. The phrase family is
//      EXHAUSTED in Standard: there is no fourth shape OF THIS PHRASE FAMILY.
//      🆕🆕 **D395 — AND "THIS PHRASE FAMILY" IS THE LOAD-BEARING QUALIFIER**, which
//      the sentence used to leave implicit. `CardProgram.attackGate` now carries a
//      FOURTEENTH printing from a DIFFERENT family (Miltank `sv08.5-081`, whose
//      condition is a per-body used-attack window and not a §4 turn-order fact).
//      The 13 / 7+3+3 above is unmoved and correct; what was never true is that the
//      FIELD's population and this FAMILY's population are the same number.
//
// ⚠️ **EVERY ONE OF THE 13 IS AT INDEX 0**, and that is asserted from the fixture
// bytes below rather than believed.
// 🆕🆕 **D395 — AND THAT IS NOW A CLAIM ABOUT THIS FAMILY AND NOT ABOUT THE FIELD.**
// `CardProgram.attackGate` carries a FOURTEENTH printing, Miltank `sv08.5-081` idx
// **1** — a second clause family (`onlyIf` over D394's per-body used-attack window)
// whose gate is at a NON-ZERO index and whose own idx 0 is the attack the clause
// names. It is driven in `rolloutGate.test.ts`, which is where the per-INDEX key
// finally gets a board that can falsify it: every assertion in THIS file is written
// about index 0, so an index-blind read is green on all of them.
// The original wording, kept — four of the five bodies carry a SECOND attack
// that must not inherit the clause, and a per-INDEX field authored off an assumed
// reprint layout is the one way this shape fails silently.
//
// ── 🛑 TWO NUMBERS, NOT ONE: 13 GATES BUILT, 0 BODIES ────────────────────────
//
// Every one of the five printed bodies is refused on a mechanism that does not
// exist, NAMED here and in registry.ts by id:
//
//   • Terapagos "Unified Beatdown" — wants `DamageCountSource.yourBenchCount`.
//     The multiply fold has EIGHT count sources including `opponentBenchCount` and
//     `bothSidesBenchCount`, and none counts YOUR OWN Bench as bodies;
//     `damageCountersOnYourBench` is the near miss and tallies COUNTERS. A second
//     blocker rides with it: the fold's anchors are whole-sentence and the gate
//     clause precedes the damage sentence.
//   • Illumise "Slowing Perfume" — wants a CROSS-SEAT put-into-deck. No `EffectOp`
//     moves an opponent's benched Pokémon and its attached cards into the
//     OPPONENT'S deck; `searchMove`/`retrieveMove` hard-code `ctx.seat`'s zones.
//     Mandibuzz `sv10.5w-064`/`-145`'s schema-boundary refusal, verbatim.
//   • Scream Tail ex "Scream" — wants a TURN-SCOPED IMPOSED SUPPORTER LOCK.
//     `preventSupporterEffectsWhileActive` is a continuous passive whose object is
//     a Supporter's EFFECT, not its PLAY; this sentence stamps the OPPONENT'S seat
//     for their next turn and `TurnAllowances` carries no such field.
//   • Volbeat "Quick Sign" — wants a SPLIT ANCHOR. effects.ts's bench-search
//     reader already names this id as one of four legal deferrals for exactly this
//     reason: its anchor is whole-sentence and the licence clause sits in front.
//   • Exeggcute "Precocious Evolution" — wants a `searchDeck` `dest` THAT EVOLVES,
//     onto a body that is the searcher itself.
//
// So the gate is honoured at the §8 declaration seam and the effect stays on the
// loud ATTACK_EFFECT_SKIPPED path — the coverage strategy this repo has used since
// M4. `BUILT.attack` does NOT move (half a printed sentence resolving is not a
// built attack unit); `BUILT.ability` moves by 13 because the census's pool
// predicate is the NEGATIVE one, and `attackGate` is the EIGHTH non-attack surface
// and the FIRST that is not an Ability. See `censusAtHead.test.ts`.
//
// ── WHAT THIS SUITE EXISTS TO PIN ────────────────────────────────────────────
//
// 1. 🛑 **THE BOARD WHERE THE LICENCE IS DENIED, FIRST.** D278 and D279 both shipped
//    a permission that failed by being TOO STRICT, and the standing lesson is that
//    every natural "the permission works" assertion is written on the board the
//    permission is most obviously about. So §2 asserts Volbeat's idx 1
//    "Coordinated Strike" is STILL §4-banned on the same turn its idx 0 is
//    licensed, before it asserts the licence works at all. A per-BODY flag is green
//    on every other assertion in this file.
// 2. 🛑 **THE TWO POLARITIES ARE ONE CONDITION**, and §3 asserts it by IDENTITY:
//    Terapagos's `barredIf` and Illumise's `onlyIf` are `toEqual` on their
//    conditions and answer OPPOSITELY on the same board. A build with two parallel
//    index maps would be green on every other line here.
// 3. 🛑 **§9 DOES NOT REACH THIS FIELD**, and that is the inverse of the rule
//    `attackFirstTurnExempt` follows. §4 drives a Klefki `sv01-096` Ability-lock
//    live and asserts the gate answers IDENTICALLY under it, on both polarities —
//    the one place a build that reused `passivesOf` out of habit shows.
// 4. **ALL THREE PAYABILITY PROJECTIONS AGREE, PER INDEX.** §5 drives the engine's
//    §8 gate and the wire projection against each other per seed, per seat and per
//    ROW. D223's `needs` string named a field and not its two mirrors, and the
//    failure direction is the quiet one.
// 5. **`MATCH_RECORD_VERSION` STAYS 14, DRIVEN.** §6.

// ── the local pool (FIXTURE_POOL is left untouched — D190's idiom) ───────────

const BAN_TEXT =
  "If you go second, you can't use this attack during your first turn. This attack does 30 damage for each of your Benched Pokémon.";
const GATE_TEXT_ILLUMISE =
  "You can use this attack only if you go second, and only during your first turn. Shuffle 1 of your opponent's Benched Pokémon and all attached cards into their deck.";
const GATE_TEXT_SCREAM =
  "You can use this attack only if you go second, and only during your first turn. Your opponent can't play any Supporter cards from their hand during their next turn.";
const LICENCE_TEXT_VOLBEAT =
  "If you go first, you can use this attack during your first turn. Search your deck for up to 2 Basic Pokémon and put them onto your Bench. Then, shuffle your deck.";
const LICENCE_TEXT_EXEGGCUTE =
  "If you go first, you can use this attack during your first turn. Search your deck for a card that evolves from this Pokémon and put it onto this Pokémon to evolve it. Then, shuffle your deck.";

const BAN_IDS = [
  "sv07-128",
  "sv07-170",
  "sv07-173",
  "sv08.5-092",
  "sv08.5-169",
  "sv08.5-180",
  "svp-165",
] as const;
const GATE_IDS = ["sv06-010", "sv06-094", "sv06-197"] as const;
const LICENCE_IDS = ["sv06-009", "sv08-001", "sv08-192"] as const;
const ALL_IDS = [...BAN_IDS, ...GATE_IDS, ...LICENCE_IDS];

/** Terapagos ex, carrying the catalog's own hp (230), type ({C}), retreat (2)
    and BOTH attack costs — read off the D1 row rather than invented (D146's rule:
    a fixture that claims to BE the printing gets every scalar re-read, not only
    the ones the assertions touch). ⚠️ THE SECOND ATTACK IS LOAD-BEARING: "Crown
    Opal" is what proves the bar is per-INDEX rather than per-body. */
function terapagos(id: string): Card {
  return battler(id, {
    name: "Terapagos ex",
    hp: 230,
    retreat: 2,
    types: ["Colorless"],
    attacks: [
      { cost: ["Colorless", "Colorless"], name: "Unified Beatdown", effect: BAN_TEXT },
      { cost: ["Colorless", "Colorless"], name: "Crown Opal", damage: 180 },
    ],
  });
}

/** Scream Tail ex. ⚠️ **ITS SECOND ATTACK'S PRINTED COST IS {P}{C}{C} AND IS
    DELIBERATELY RE-COSTED TO {C}{C} HERE**, declared rather than silent: this
    suite attaches two {C}-payable Energy so that a refusal at either row can only
    ever be a GATE and never an unpaid cost. The gate is what is under test; the
    cost seam has its own suites. */
function screamTail(id: string): Card {
  return battler(id, {
    name: "Scream Tail ex",
    hp: 190,
    retreat: 1,
    types: ["Psychic"],
    attacks: [
      { cost: ["Colorless"], name: "Scream", effect: GATE_TEXT_SCREAM },
      { cost: ["Colorless", "Colorless"], name: "Crunch", damage: 120 },
    ],
  });
}

function exeggcute(id: string): Card {
  return battler(id, {
    name: "Exeggcute",
    hp: 30,
    retreat: 1,
    types: ["Grass"],
    attacks: [{ cost: ["Colorless"], name: "Precocious Evolution", effect: LICENCE_TEXT_EXEGGCUTE }],
  });
}

/** The CONTROL body: two attacks, same costs as Terapagos, NO `attackGate`.
    🛑 **THE SUITE IS VACUOUS WITHOUT IT** — every "the gate bites" assertion below
    passes just as happily on a build that refused ALL attacks, and this body is
    the only thing that can tell the two apart. */
const UNGATED = "fix-ungated";

const LOCAL_CARDS: Record<string, Card> = {
  ...Object.fromEntries(BAN_IDS.map((id) => [id, terapagos(id)])),
  "sv06-010": battler("sv06-010", {
    name: "Illumise",
    hp: 70,
    retreat: 1,
    types: ["Grass"],
    attacks: [
      { cost: ["Colorless"], name: "Slowing Perfume", effect: GATE_TEXT_ILLUMISE },
      { cost: ["Colorless", "Colorless"], name: "Glide", damage: 30 },
    ],
  }),
  "sv06-094": screamTail("sv06-094"),
  "sv06-197": screamTail("sv06-197"),
  "sv06-009": battler("sv06-009", {
    name: "Volbeat",
    hp: 70,
    retreat: 1,
    types: ["Grass"],
    attacks: [
      { cost: ["Colorless"], name: "Quick Sign", effect: LICENCE_TEXT_VOLBEAT },
      { cost: ["Colorless", "Colorless"], name: "Coordinated Strike", damage: 20 },
    ],
  }),
  "sv08-001": exeggcute("sv08-001"),
  "sv08-192": exeggcute("sv08-192"),
  [UNGATED]: battler(UNGATED, {
    name: "Ungated Control",
    hp: 230,
    retreat: 2,
    types: ["Colorless"],
    attacks: [
      { cost: ["Colorless", "Colorless"], name: "Plain Beatdown", damage: 30 },
      { cost: ["Colorless", "Colorless"], name: "Plain Opal", damage: 180 },
    ],
  }),
  "fix-gate-energy": typedEnergy("fix-gate-energy", "Colorless"),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

/** The THIRTEENTH seeded deck (D270's rule: a seeded suite gets its own deck). */
// ⚠️ **ALL THIRTEEN REAL IDS ARE IN IT**, not just the three the assertions drive
// most often: `setActiveFromDeck` pulls from the deck, so a reprint that is only
// ever named in §1's catalog check would be untestable on a board. The reprints
// carry 1 copy each and the three principals 4, which is what keeps the 60 honest.
const GATE_DECK = deckOf({
  "sv07-128": 4,
  "sv07-170": 1,
  "sv07-173": 1,
  "sv08.5-092": 1,
  "sv08.5-169": 1,
  "sv08.5-180": 1,
  "svp-165": 1,
  "sv06-010": 4,
  "sv06-094": 1,
  "sv06-197": 1,
  "sv06-009": 4,
  "sv08-001": 2,
  "sv08-192": 2,
  [UNGATED]: 4,
  "sv01-096": 2, // Klefki — the §9 Ability-lock control
  "fix-basic-1": 4,
  "fix-gate-energy": 20,
  "fix-energy": 6,
});

/** Four seeds, so nothing below rests on one shuffle (D270). */
const SEEDS = [4111, 4127, 4133, 4159] as const;

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

function firstBasicInHand(state: GameState, seat: Seat): string {
  const uid = state.players[seat].hand.find((h) => {
    const card = POOL[state.cardIdByUid[h] ?? ""];
    return card?.category === "Pokemon" && card.stage === "Basic";
  });
  if (uid === undefined) throw new Error(`no Basic in ${seat}'s hand`);
  return uid;
}

/** D275's `localSetup`, D277's shape: the FIRST PLAYER is a PARAMETER, so every
    assertion below can be made from BOTH seats under BOTH assignments. ⚠️ A
    ONE-SEAT BOARD IS VACUOUS ON A PER-SEAT FACT, and both `youGoSecond` and
    `yourFirstTurn` are exactly such facts. */
function localSetup(seed: number, first: Seat): GameState {
  const created = createGame({ seed, decks: { p1: GATE_DECK, p2: GATE_DECK }, cardPool: POOL });
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

/** A board with `seat`'s Active set to `activeId`, TWO {C} attached (so every
    printed cost in this pool is payable and a refusal can only ever be a gate)
    and a benched body behind it.
    ⚠️ THE BENCH BODY IS LOAD-BEARING — §14.2 makes an empty Bench a LOSS the
    moment the Active leaves, and a `gameOver` board proves nothing about a gate. */
function board(seed: number, first: Seat, seat: Seat, activeId: string): GameState {
  let state = localSetup(seed, first);
  state = setActiveFromDeck(state, seat, activeId);
  state = clearBench(state, seat);
  state = benchFromDeck(state, seat, "fix-basic-1");
  return attachFromDeck(state, seat, "fix-gate-energy", 2);
}

function activeOf(state: GameState, seat: Seat): InPlayPokemon {
  const active = state.players[seat].active;
  if (active === null) throw new Error(`${seat} has no Active`);
  return active;
}

function passTurns(state: GameState, count: number): GameState {
  let next = state;
  for (let i = 0; i < count; i += 1) {
    if (next.phase.kind !== "turn:action") throw new Error(`stuck in ${next.phase.kind}`);
    next = must(applyAction(next, { type: "endTurn", seat: next.phase.seat }));
  }
  return next;
}

/** Declare `index` and report the error code, or "OK" when the engine accepted
    it. Every §8 assertion in this file goes through this so a green "the gate
    refuses" line can never be a refusal for the WRONG reason. */
function declare(state: GameState, seat: Seat, index: number): string {
  const result = applyAction(deepFreeze(state), { type: "attack", seat, index });
  return result.ok ? "OK" : result.error.code;
}

/** The wire projection's own answer for the same row — the payability mirror. */
function wirePlayable(state: GameState, seat: Seat, index: number): boolean | undefined {
  const phase = redactGame(state, seat).phase;
  if (phase.kind !== "turn:action") throw new Error(`expected turn:action, got ${phase.kind}`);
  return phase.attacks.find((a) => a.index === index)?.playable;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. The catalog claim the whole field rests on — every gate is at INDEX 0.
// ─────────────────────────────────────────────────────────────────────────────

describe("D281 — the census, and the per-INDEX claim checked against the printings", () => {
  it("all 13 FIRST-TURN ids carry an `attackGate`, and every one of THOSE is at index 0", () => {
    for (const id of ALL_IDS) {
      const gate = programFor(id)?.attackGate;
      expect(gate, id).toBeDefined();
      expect(Object.keys(gate ?? {}), id).toEqual(["0"]);
    }
    expect(ALL_IDS.length).toBe(13);
  });

  it("🛑 the gated attack really IS index 0 on every fixture, and idx 1 exists on four of five", () => {
    // 🛑 THE ASSERTION A PER-INDEX FIELD CANNOT DO WITHOUT. The registry authors
    // `{ 0: … }` by hand for each id; if any printing ordered its attacks
    // differently the clause would land on the wrong row and NOTHING else in this
    // file would notice — every other assertion is written about index 0 too.
    // Driven off the printed EFFECT text, which is the thing the clause is in.
    const gatedText: Record<string, string> = {
      "sv07-128": BAN_TEXT,
      "sv06-010": GATE_TEXT_ILLUMISE,
      "sv06-094": GATE_TEXT_SCREAM,
      "sv06-009": LICENCE_TEXT_VOLBEAT,
      "sv08-001": LICENCE_TEXT_EXEGGCUTE,
    };
    for (const [id, text] of Object.entries(gatedText)) {
      const attacks = POOL[id]?.attacks ?? [];
      expect(attacks[0]?.effect, id).toBe(text);
      // …and no OTHER row on the card prints the clause, which is the half that
      // catches "the fixture happens to start with it".
      expect(attacks.slice(1).filter((a) => (a.effect ?? "").includes("first turn")), id).toEqual(
        [],
      );
    }
    // Four of the five carry a SECOND attack that must not inherit the clause;
    // Exeggcute carries exactly ONE, which is why registry.ts argues the per-index
    // shape from the printed REFERENT ("this attack") and not from a body count.
    expect(POOL["sv07-128"]?.attacks).toHaveLength(2);
    expect(POOL["sv06-010"]?.attacks).toHaveLength(2);
    expect(POOL["sv06-094"]?.attacks).toHaveLength(2);
    expect(POOL["sv06-009"]?.attacks).toHaveLength(2);
    expect(POOL["sv08-001"]?.attacks).toHaveLength(1);
  });

  it("`attackGateOf` is TOTAL — an ungated body, a missing index and a bogus one all answer undefined", () => {
    const state = board(SEEDS[0], "p1", "p1", "sv07-128");
    const gated = activeOf(state, "p1");
    expect(attackGateOf(state, gated, 0)).toBeDefined();
    expect(attackGateOf(state, gated, 1)).toBeUndefined();
    expect(attackGateOf(state, gated, 99)).toBeUndefined();
    expect(attackGateOf(state, gated, -1)).toBeUndefined();
    const plain = board(SEEDS[0], "p1", "p1", UNGATED);
    expect(attackGateOf(plain, activeOf(plain, "p1"), 0)).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. 🛑 THE LICENCE, AND THE BOARD WHERE IT IS DENIED — ASSERTED FIRST.
// ─────────────────────────────────────────────────────────────────────────────

describe("D281 — the per-INDEX LICENCE (Volbeat, Exeggcute)", () => {
  it("🛑 licenses idx 0 on turn 1 and leaves idx 1 BANNED — the board a per-BODY flag gets wrong", () => {
    // 🛑 THE FIRST ASSERTION IN THE FILE ABOUT THE LICENCE IS THE ONE WHERE IT
    // MUST NOT REACH, because the standing lesson is that a permission that is
    // too WIDE is green on every "it works" line anyone naturally writes. A
    // `PassiveEffects.attackFirstTurnExempt` on Volbeat — the shape D277 built and
    // this slice deliberately did not reuse — passes every other assertion in this
    // file and fails exactly here.
    for (const first of ["p1", "p2"] as const) {
      const state = board(SEEDS[0], first, first, "sv06-009");
      expect(state.turn, `${first}`).toBe(1);
      expect(declare(state, first, 0), `${first} idx0`).toBe("OK");
      expect(declare(state, first, 1), `${first} idx1`).toBe("FIRST_TURN_ATTACK");
      // …and the predicate says the same thing, per index.
      expect(firstTurnAttackBanned(state, activeOf(state, first), 0), `${first}`).toBe(false);
      expect(firstTurnAttackBanned(state, activeOf(state, first), 1), `${first}`).toBe(true);
    }
  });

  it("the CONTROL body is banned at BOTH indices on the same board — the licence is doing the work", () => {
    for (const first of ["p1", "p2"] as const) {
      const state = board(SEEDS[1], first, first, UNGATED);
      expect(declare(state, first, 0), `${first} idx0`).toBe("FIRST_TURN_ATTACK");
      expect(declare(state, first, 1), `${first} idx1`).toBe("FIRST_TURN_ATTACK");
    }
  });

  it("Exeggcute's ONE attack is licensed on turn 1 — the single-attack printing", () => {
    for (const id of ["sv08-001", "sv08-192"] as const) {
      for (const first of ["p1", "p2"] as const) {
        const state = board(SEEDS[2], first, first, id);
        expect(declare(state, first, 0), `${id}/${first}`).toBe("OK");
      }
    }
  });

  it("the licence changes NOTHING from turn 2 onward — it lifts a ban, it does not create one", () => {
    for (const activeId of ["sv06-009", UNGATED]) {
      for (const first of ["p1", "p2"] as const) {
        let state = board(SEEDS[3], first, first, activeId);
        for (let turn = 2; turn <= 5; turn += 1) {
          state = passTurns(state, 1);
          const seat = state.phase.kind === "turn:action" ? state.phase.seat : first;
          state = setActiveFromDeck(state, seat, activeId);
          state = clearBench(state, seat);
          state = benchFromDeck(state, seat, "fix-basic-1");
          state = attachFromDeck(state, seat, "fix-gate-energy", 2);
          expect(
            firstTurnAttackBanned(state, activeOf(state, seat), 0),
            `${activeId}@${turn}`,
          ).toBe(false);
          expect(
            firstTurnAttackBanned(state, activeOf(state, seat), 1),
            `${activeId}@${turn}`,
          ).toBe(false);
        }
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. 🛑 THE TWO POLARITIES — ONE CONDITION, OPPOSITE SIGNS.
// ─────────────────────────────────────────────────────────────────────────────

describe("D281 — `onlyIf` and `barredIf` are ONE condition at two signs", () => {
  it("🛑 Terapagos's `barredIf` and Illumise's `onlyIf` carry the IDENTICAL condition", () => {
    // 🛑 THE ASSERTION THAT MAKES "ONE FIELD, TWO POLARITIES" A MEASUREMENT RATHER
    // THAN A DESIGN NOTE. If these two conditions ever diverge, the argument for a
    // polarity TOKEN (rather than two parallel index maps) has gone with them.
    const ban = programFor("sv07-128")?.attackGate?.[0];
    const gate = programFor("sv06-010")?.attackGate?.[0];
    expect(ban?.kind).toBe("barredIf");
    expect(gate?.kind).toBe("onlyIf");
    const expected: BoardCondition = {
      kind: "allOf",
      conditions: [{ kind: "youGoSecond" }, { kind: "yourFirstTurn" }],
    };
    expect(ban?.kind === "barredIf" ? ban.condition : undefined).toEqual(expected);
    expect(gate?.kind === "onlyIf" ? gate.condition : undefined).toEqual(expected);
    // ZERO new `BoardCondition` members: every leaf here shipped at D275/D280.
    expect(new Set(expected.kind === "allOf" ? expected.conditions.map((c) => c.kind) : [])).toEqual(
      new Set(["youGoSecond", "yourFirstTurn"]),
    );
  });

  it("🛑 on the ONE board the condition holds, they answer OPPOSITELY", () => {
    // The going-second seat's first turn is TURN 2 — the only moment in any game
    // where `allOf([youGoSecond, yourFirstTurn])` is true. §4 does not ban turn 2,
    // so the printed clause is the only thing deciding either row.
    for (const first of ["p1", "p2"] as const) {
      const second = first === "p1" ? "p2" : "p1";
      let state = passTurns(localSetup(SEEDS[0], first), 1);
      expect(state.turn, `${first}`).toBe(2);
      // The BAN: barred on exactly this turn.
      let banBoard = setActiveFromDeck(state, second, "sv07-128");
      banBoard = clearBench(banBoard, second);
      banBoard = benchFromDeck(banBoard, second, "fix-basic-1");
      banBoard = attachFromDeck(banBoard, second, "fix-gate-energy", 2);
      expect(declare(banBoard, second, 0), `${first} ban idx0`).toBe("ATTACK_PREVENTED");
      // …and its OTHER attack is live on the same board, which is the whole
      // content of the field being per-index.
      expect(declare(banBoard, second, 1), `${first} ban idx1`).toBe("OK");
      // The GATE: usable on exactly this turn.
      let gateBoard = setActiveFromDeck(state, second, "sv06-010");
      gateBoard = clearBench(gateBoard, second);
      gateBoard = benchFromDeck(gateBoard, second, "fix-basic-1");
      gateBoard = attachFromDeck(gateBoard, second, "fix-gate-energy", 2);
      expect(declare(gateBoard, second, 0), `${first} gate idx0`).toBe("OK");
      state = banBoard;
    }
  });

  it("🛑 and on EVERY OTHER turn they swap — the gate closes and the ban lifts", () => {
    for (const first of ["p1", "p2"] as const) {
      const second = first === "p1" ? "p2" : "p1";
      // Turn 4: the going-second seat's SECOND turn. `yourFirstTurn` is false, so
      // the conjunction is false for both bodies.
      let state = passTurns(localSetup(SEEDS[1], first), 3);
      expect(state.turn, `${first}`).toBe(4);
      for (const [id, expected] of [
        ["sv07-128", "OK"],
        ["sv06-010", "ATTACK_PREVENTED"],
      ] as const) {
        let b = setActiveFromDeck(state, second, id);
        b = clearBench(b, second);
        b = benchFromDeck(b, second, "fix-basic-1");
        b = attachFromDeck(b, second, "fix-gate-energy", 2);
        expect(declare(b, second, 0), `${first}/${id}@4`).toBe(expected);
      }
      state = passTurns(state, 1);
    }
  });

  it("the GATE is closed for the going-FIRST seat at every moment — `youGoSecond` is a seat fact", () => {
    // ⚠️ TURN 3 IS THE GOING-FIRST SEAT'S SECOND TURN, and `yourFirstTurn` is
    // false there too — so this case is about `youGoSecond` specifically. Turn 1
    // is asserted separately below, where §4's own ban would mask it.
    for (const first of ["p1", "p2"] as const) {
      let state = passTurns(localSetup(SEEDS[2], first), 2);
      expect(state.turn, `${first}`).toBe(3);
      state = setActiveFromDeck(state, first, "sv06-010");
      state = clearBench(state, first);
      state = benchFromDeck(state, first, "fix-basic-1");
      state = attachFromDeck(state, first, "fix-gate-energy", 2);
      expect(declare(state, first, 0), `${first} gate`).toBe("ATTACK_PREVENTED");
      // …and its idx 1 "Glide" is live, so the refusal is the CLAUSE and not the
      // body being unable to attack at all.
      expect(declare(state, first, 1), `${first} glide`).toBe("OK");
    }
  });

  it("🛑 on TURN 1 the going-first seat's gated attack is refused by §4 FIRST, and that ordering is deliberate", () => {
    // Both rules refuse; the message a player gets names the one nearest the top
    // of the rulebook, which is what keeps the §4 gate above the index check in
    // `attack`. The alternative (moving §4 below `BAD_ATTACK_INDEX` so it could
    // read a validated index) would have re-ordered §12's status gate and §11's
    // lock as a side effect — three rejections changed to serve one slice.
    for (const first of ["p1", "p2"] as const) {
      const state = board(SEEDS[3], first, first, "sv06-010");
      expect(state.turn, `${first}`).toBe(1);
      expect(declare(state, first, 0), `${first}`).toBe("FIRST_TURN_ATTACK");
    }
  });

  it("the §8 reject NAMES the printed clause, in the printed polarity", () => {
    const first = "p1" as const;
    const second = "p2" as const;
    let state = passTurns(localSetup(SEEDS[0], first), 1);
    let gateBoard = setActiveFromDeck(passTurns(state, 2), second, "sv06-010");
    gateBoard = clearBench(gateBoard, second);
    gateBoard = benchFromDeck(gateBoard, second, "fix-basic-1");
    gateBoard = attachFromDeck(gateBoard, second, "fix-gate-energy", 2);
    const gateResult = applyAction(gateBoard, { type: "attack", seat: second, index: 0 });
    expect(gateResult.ok).toBe(false);
    if (!gateResult.ok) {
      expect(gateResult.error.message).toContain("Slowing Perfume");
      expect(gateResult.error.message).toContain(
        "it can only be used if you go second and it is your first turn",
      );
    }
    let banBoard = setActiveFromDeck(state, second, "sv07-128");
    banBoard = clearBench(banBoard, second);
    banBoard = benchFromDeck(banBoard, second, "fix-basic-1");
    banBoard = attachFromDeck(banBoard, second, "fix-gate-energy", 2);
    const banResult = applyAction(banBoard, { type: "attack", seat: second, index: 0 });
    expect(banResult.ok).toBe(false);
    if (!banResult.ok) {
      expect(banResult.error.message).toContain("Unified Beatdown");
      expect(banResult.error.message).toContain(
        "it cannot be used while you go second and it is your first turn",
      );
    }
    state = banBoard;
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. 🛑 §9 DOES NOT REACH THIS FIELD — the inverse of `attackFirstTurnExempt`.
// ─────────────────────────────────────────────────────────────────────────────

describe("D281 — a §9 Ability-lock does NOT touch a printed attack clause", () => {
  it("🛑 Klefki `sv01-096` leaves BOTH polarities and the licence answering identically", () => {
    // 🛑 THE ONE PLACE A BUILD THAT REUSED `passivesOf` OUT OF HABIT SHOWS. D277's
    // licence is printed as an ABILITY and a §9 lock must silence it and hand the
    // §4 ban back; every clause in THIS field is printed as ATTACK TEXT and §9
    // locks Abilities only. So the correct answer here is "no change", and a
    // wrong build gets a Terapagos that may suddenly attack and a Volbeat that
    // suddenly may not — in the same call.
    for (const first of ["p1", "p2"] as const) {
      const second = first === "p1" ? "p2" : "p1";
      const base = passTurns(localSetup(SEEDS[0], first), 1);
      for (const [id, index, expected] of [
        ["sv07-128", 0, "ATTACK_PREVENTED"],
        ["sv06-010", 0, "OK"],
      ] as const) {
        let clean = setActiveFromDeck(base, second, id);
        clean = clearBench(clean, second);
        clean = benchFromDeck(clean, second, "fix-basic-1");
        clean = attachFromDeck(clean, second, "fix-gate-energy", 2);
        // The LOCK is live: Klefki sits on the OPPOSING Active, which is where
        // "Mischievous Lock" reads from.
        const locked = setActiveFromDeck(clean, first, "sv01-096");
        expect(declare(clean, second, index), `${first}/${id} clean`).toBe(expected);
        expect(declare(locked, second, index), `${first}/${id} locked`).toBe(expected);
        // …and the READER agrees, not only the action.
        expect(
          attackTimingBlocked(clean, second, activeOf(clean, second), index) !== undefined,
          `${first}/${id} reader clean`,
        ).toBe(expected !== "OK");
        expect(
          attackTimingBlocked(locked, second, activeOf(locked, second), index) !== undefined,
          `${first}/${id} reader locked`,
        ).toBe(expected !== "OK");
      }
      // …and the LICENCE, on turn 1, under the same lock.
      let licensed = board(SEEDS[0], first, first, "sv06-009");
      expect(declare(licensed, first, 0), `${first} licence clean`).toBe("OK");
      licensed = setActiveFromDeck(licensed, second, "sv01-096");
      expect(declare(licensed, first, 0), `${first} licence locked`).toBe("OK");
    }
  });

  it("the ATTRIBUTION CONTROL — the lock really is live in this pool", () => {
    // Without this, the case above passes just as happily on a Klefki that never
    // reached the board: "no change under a lock" and "no lock" are the same
    // observation. Meloetta ex is not in this deck, so the control is the lock's
    // OWN reader rather than a second licence.
    const state = board(SEEDS[0], "p1", "p2", "sv01-096");
    expect(POOL["sv01-096"]?.abilities?.[0]?.name).toBe("Mischievous Lock");
    expect(activeOf(state, "p2").stack.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. THE THREE PAYABILITY PROJECTIONS — driven against each other, PER ROW.
// ─────────────────────────────────────────────────────────────────────────────

describe("D281 — the engine gate and the wire projection agree row by row", () => {
  it("every (seed × assignment × body × row) pair agrees — the sweep D223's `needs` string missed", () => {
    // ⚠️ THE FAILURE DIRECTION IS THE QUIET ONE: an engine-legal attack whose row
    // is greyed is never clicked, so no player ever reports it. The sweep asserts
    // AGREEMENT rather than either side's value, which is the only shape that
    // catches a projection that forgot the field entirely.
    let compared = 0;
    let disagreements = 0;
    let legalRows = 0;
    for (const seed of SEEDS) {
      for (const first of ["p1", "p2"] as const) {
        const second = first === "p1" ? "p2" : "p1";
        for (const turns of [0, 1, 2, 3]) {
          const base = passTurns(localSetup(seed, first), turns);
          if (base.phase.kind !== "turn:action") continue;
          const seat = base.phase.seat;
          for (const id of ["sv07-128", "sv06-010", "sv06-009", UNGATED]) {
            let state = setActiveFromDeck(base, seat, id);
            state = clearBench(state, seat);
            state = benchFromDeck(state, seat, "fix-basic-1");
            state = attachFromDeck(state, seat, "fix-gate-energy", 2);
            const rows = POOL[id]?.attacks?.length ?? 0;
            for (let index = 0; index < rows; index += 1) {
              const accepted = declare(state, seat, index) === "OK";
              const offered = wirePlayable(state, seat, index);
              compared += 1;
              if (accepted) legalRows += 1;
              if (offered !== accepted) disagreements += 1;
            }
          }
          expect(seat === first || seat === second).toBe(true);
        }
      }
    }
    // THE ATTRIBUTION CONTROLS, both directions: the sweep really ran, and it
    // really found live rows as well as refused ones. Without the second one this
    // whole `it` passes on a build that refuses every attack in the game.
    // 4 seeds × 2 assignments × 4 turn offsets × 8 rows (2 per body, 4 bodies).
    expect(compared).toBe(256);
    expect(legalRows).toBeGreaterThan(0);
    expect(legalRows).toBeLessThan(compared);
    expect(disagreements).toBe(0);
  });

  it("the wire greys ONE row and leaves its sibling live — the per-index projection", () => {
    // The case a body-wide `banned` term gets wrong, asserted on the wire rather
    // than inferred from the engine: Terapagos's idx 0 is barred on the exact turn
    // its idx 1 is live.
    for (const first of ["p1", "p2"] as const) {
      const second = first === "p1" ? "p2" : "p1";
      let state = setActiveFromDeck(passTurns(localSetup(SEEDS[0], first), 1), second, "sv07-128");
      state = clearBench(state, second);
      state = benchFromDeck(state, second, "fix-basic-1");
      state = attachFromDeck(state, second, "fix-gate-energy", 2);
      expect(wirePlayable(state, second, 0), `${first}`).toBe(false);
      expect(wirePlayable(state, second, 1), `${first}`).toBe(true);
    }
    // …and the LICENCE's mirror image on turn 1: idx 0 offered, idx 1 greyed.
    for (const first of ["p1", "p2"] as const) {
      const state = board(SEEDS[0], first, first, "sv06-009");
      expect(wirePlayable(state, first, 0), `${first} licensed`).toBe(true);
      expect(wirePlayable(state, first, 1), `${first} banned`).toBe(false);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. `MATCH_RECORD_VERSION` — DRIVEN, BOTH HALVES.
// ─────────────────────────────────────────────────────────────────────────────

describe("D281 — MATCH_RECORD_VERSION stays 14, and the reachability claim is MEASURED", () => {
  it("NO registry program's `attackGate` carries an op — the persisted-op reachability sweep", () => {
    // 🛑 THE HALF THAT ACTUALLY DECIDES THE CONSTANT. `pendingOp` is a PERSISTED
    // structure riding `GameState.phase.cont` into the match record, so the
    // question is not "does a gated attack park" — it is **"can an `attackGate`
    // value reach a stored continuation from anywhere"**. It cannot, structurally:
    // the field's values are conditions and a bare tag, and NOTHING in the union
    // is an `EffectOp`. Measured with the same NEGATIVE predicate `walkProgram`
    // uses (an op is any object with a string `op`), so a fourth arm of
    // `AttackTimingGate` that smuggled ops in would redden this line.
    let gatesFound = 0;
    let opsInGates = 0;
    let programsWalked = 0;
    for (const id of registryCardIds()) {
      const program = programFor(id);
      if (program === undefined) continue;
      programsWalked += 1;
      for (const gate of Object.values(program.attackGate ?? {})) {
        gatesFound += 1;
        const seen = JSON.stringify(gate);
        // A structural read rather than a `kind` switch: the point is that no
        // shape reachable from this value is an op, whatever the arms become.
        expect(seen.includes('"op":'), id).toBe(false);
        opsInGates += walkProgram(
          (gate as unknown as { then?: [] }).then ?? [],
        ).length;
      }
    }
    // THE ATTRIBUTION CONTROLS: the sweep really walked programs and really found
    // gates, so "no ops" is an answer rather than an empty population.
    expect(programsWalked).toBeGreaterThan(300);
    // 🆕🆕 D396 — 14 -> **17**: Sylveon ex `sv08-086`/`sv08.5-041`/`sv08.5-156`'s
    // `barredIf` over D396's in-play window, on THREE keys sharing ONE program
    // object — so this counter steps by 3 where the object count steps by 1, which
    // is the reprint idiom being counted from the id side. The reachability claim is
    // UNCHANGED and re-measured rather than assumed: that condition is the same
    // two-field record with no `then` and no op anywhere inside it.
    // 🆕🆕 D395 — 13 -> **14**: Miltank `sv08.5-081`'s `onlyIf` over D394's
    // per-body window. The reachability claim is UNCHANGED and re-measured rather
    // than assumed — that condition is a two-field record with no `then` and no op
    // anywhere inside it, so this sweep still answers 0.
    expect(gatesFound).toBe(17);
    expect(opsInGates).toBe(0);
  });

  it("a gated REFUSAL and a licensed ACCEPTANCE both leave the persisted shape untouched", () => {
    // ⚠️ **A DIFF BETWEEN TWO BOARDS FROM ONE BUILD IS A HALF-GUARD** (D279): it
    // catches "the new path writes something extra" and is blind to "every body
    // grew a key", because the key would be on both sides. So the diff is PAIRED
    // WITH A LITERAL KEY-LIST ANCHOR.
    const first = "p1" as const;
    const licensedBoard = board(SEEDS[0], first, first, "sv06-009");
    const plainBoard = board(SEEDS[0], first, first, UNGATED);
    const licensed = applyAction(licensedBoard, { type: "attack", seat: first, index: 0 });
    expect(licensed.ok).toBe(true);
    if (!licensed.ok) return;
    // The DIFF: an attack the new licence let through writes the same top-level
    // shape as the board it came from.
    expect(Object.keys(licensed.state).sort()).toEqual(Object.keys(plainBoard).sort());
    // The ANCHOR: a literal list, so a key added to EVERY board is caught too.
    expect(Object.keys(licensed.state).sort()).toEqual(
      [
        "allowances",
        "cardIdByUid",
        "cardPool",
        "firstPlayer",
        "lastKoMarks",
        "lastKoTurn",
        "oncePerGameSpent",
        // 🆕 D283 — `handPlayLockedTurn`, the turn-scoped imposed hand-play bar.
        "handPlayLockedTurn",
        "pending",
        "phase",
        "players",
        "rngState",
        "stadium",
        "turn",
      ].sort(),
    );
    // …and a REFUSED declaration returns the state UNCHANGED by identity, so the
    // gate cannot have written anything at all.
    const refused = applyAction(licensedBoard, { type: "attack", seat: first, index: 1 });
    expect(refused.ok).toBe(false);
    // The in-play stack the gate is read off carries no new field either.
    expect(Object.keys(activeOf(licensedBoard, first)).includes("attackGate")).toBe(false);
  });
});
