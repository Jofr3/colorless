import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { alliedRetreatDiscount, opposingRetreatSurcharge } from "./continuous";
import {
  applyAction,
  createGame,
  disabledAbilityUids,
  effectiveRetreatCost,
  hasFreeRetreatSelf,
  programFor,
} from "./index";
import type { GameState, InPlayPokemon, Seat } from "./index";
import {
  FIXTURE_POOL,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  setActiveFromDeck,
} from "./testFixtures";

// D322 — THE RETREAT-COST DELTA'S THREE UNBUILT SENTENCES, AND THE FIRST
// NEGATIVE TERM IN `effectiveRetreatCost` THAT IS NOT A STADIUM.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHAT THE HANDOFF ORDERED, AND WHY THE ROW IS BIGGER THAN ITS PRICE.
// ─────────────────────────────────────────────────────────────────────────────
//
// The handoff ordered TWO printings — Toedscruel `sv09-089` and Ariados
// `sv06-005` — priced off `instr(abilities_json,'Retreat Cost is') > 0`, which
// returns 5 rows / **2 legal** and RE-DERIVES exactly. The price is not wrong;
// it is INCOMPLETE, and the literal it was measured with is why.
//
// 🛑 **THE WIDER `instr(abilities_json,'Retreat Cost') > 0` RETURNS 24 / 9
// LEGAL ON SIX SENTENCES**, of which Metal Bridge ×3 (`sv07-107`/`sv07-155`/
// `sv08.5-070`) and Skyliner ×3 (`sv08-076`/`-220`/`-239`) are BUILT — verified
// by grepping `registry.ts` for each id, D321's rule, before any of this was
// written. The sixth sentence is **Ethan's Magcargo `sv10-036` "Melt Away"**,
// and the narrow literal CANNOT SEE IT: the print reads *"it HAS NO Retreat
// Cost"* and carries no "is". **A price measured with a literal inherits that
// literal's blind spot, and the blind spot is invisible from inside the price.**
//
// ✅ **AND THE POPULATION IS CLOSED, WHICH THE NARROW LITERAL COULD NOT SAY.**
// `instr(abilities_json,'Retreat') > 0` returns the SAME 24 rows / 9 legal, and
// the difference set — `'Retreat'` AND NOT `'Retreat Cost'` — is **EMPTY**. So
// these nine ARE every retreat-modifying Ability in Standard at any width.
// `'etreat cost'` (casing), `'Retreat Cost of'` and `'Retreat Costs'` (word
// order) and `'RetreatCost'` all return ZERO. Each of the three new ids appears
// EXACTLY ONCE in all 3,786 rows: three sentences, three printings, no reprint.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE SENTENCES, transcribed off the remote D1 `luminous`
// (`735f0fb5-cdc3-494d-8b97-74a8ade0124a`, 3,786 rows) on 2026-08-10 rather than
// copied out of a census bullet (D306).
// ─────────────────────────────────────────────────────────────────────────────
//
//   "As long as this Pokémon is on your Bench, your Active Pokémon's Retreat
//    Cost is {C}{C} less."
//        — Toedscruel `sv09-089` "Secret Forest Path", Stage 1 ← Toedscool,
//          {F}, 130 HP, printed retreat 2.
//
//   "Your opponent's Active Evolution Pokémon's Retreat Cost is {C} more."
//        — Ariados `sv06-005` "Big Net", Stage 1 ← Spinarak, {G}, 90 HP,
//          printed retreat 1.
//
//   "If this Pokémon has no Energy attached, it has no Retreat Cost."
//        — Ethan's Magcargo `sv10-036` "Melt Away", Stage 1 ← Ethan's Slugma,
//          {R}, 130 HP, printed retreat 3.
//
// ── THE FUNNEL, GREPPED BEFORE IT WAS BELIEVED (the handoff's 🛑) ───────────
//
// D320's whole loss was a scan site that *looked* sole: it predicted "one scan
// site in `switchInto`" and **`retreat` did not route through it**, so the
// sentence's commonest trigger would have shipped dead. Retreat is the SUBJECT
// here, so every route in was enumerated first:
//
//   `git grep effectiveRetreatCost` — FOUR non-test readers, and **all four
//   consume a NUMBER and take no diff from a new term**:
//     • `turn.ts:694`   — the `retreat` action's cost check. ✅ **THE COMMONEST
//       TRIGGER *DOES* ROUTE THROUGH THE FUNNEL**, which is the half D320's
//       `switchInto` did not, and it is asserted below on a real action rather
//       than inferred from the grep.
//     • `redact.ts:504` — the P4 client's view of its own cost.
//     • `attack.ts:182` — the defender-cost damage bonus (`bonus.per`).
//     • `src/features/game/GameHud.tsx:731` — the local HUD.
//   `retreatCostOf` is called exactly ONCE outside `cards.ts` — `continuous.ts`,
//   inside the funnel — so there is no second, printed-only path either.
//
// ── THE THREE SHAPES, AND WHY THEY ARE THREE FIELDS AND NOT ONE ────────────
//
//   1. `ownActiveRetreatDiscount` (NEW) — Toedscruel. The sign-flipped, OWN-SIDE
//      mirror of `opponentActiveRetreatSurcharge`: same derived-seat trick, same
//      Active TARGET clause, same §9 gate, same SUM over sources, and then it
//      reads the side it found rather than the other one. 🛑 **IT IS A DELTA AND
//      NOT A SET-TO-ZERO**, so it is a fourth TERM inside the funnel's single
//      `Math.max(0, …)` — a lone Toedscruel leaves a {C}{C}{C} Active at {C},
//      which is the assertion that separates it from `noRetreatCostAura`.
//   2. `opponentActiveRetreatSurcharge.target` (WIDENED) — Ariados. The bare
//      `number` becomes `{ amount, target? }`, and the rider is
//      **`seatDamageBonusBeforeWR.target`'s field name, type and filter member
//      REUSED WHOLE** (D245, Carracosta `sv07-038`, the same printed "your
//      opponent's Active Evolution Pokémon" on the damage seam).
//   3. `noRetreatCostSelf.requiresNoEnergyAttached` (NEW RIDER) — Melt Away.
//      Punk Out's antecedent-twin: same consequent, same scan, a gate that reads
//      the HOLDER instead of across the table.
//
// `MATCH_RECORD_VERSION` does not move: all three are catalog facts re-derived
// from the board on every read and persisted nowhere.

const ARIADOS = "sv06-005";
const TOEDSCRUEL = "sv09-089";
const MAGCARGO = "sv10-036";
/** Spidops ex "Trap Territory" — the UNMARKED print of the widened field, and
    this suite's control at the `target` rider: same sentence, no adjective.
    `legal_standard = 0` (rotated), so it moves no census row. */
const SPIDOPS = "sv01-019";

/** A printed-{C}{C}{C} BASIC — the body every discount assertion is read on,
    chosen at 3 so a single Toedscruel ({C}{C}) leaves a NON-ZERO remainder and
    the delta can be told apart from a set-to-zero. */
const HEAVY_BASIC = "fix-d322-heavy";
/** Its EVOLUTION, same printed retreat — the `target` rider's positive, where
    `HEAVY_BASIC` is its negative. The two differ in `evolveFrom` and in
    NOTHING ELSE, which is what makes the rider the only variable. */
const HEAVY_EVO = "fix-d322-heavy-evo";
/** A printed-{C} body, for the floor. */
const LIGHT_BASIC = "fix-d322-light";

/** The three real printings plus the two-body ladder they are read on. Local
    rather than in `FIXTURE_POOL` for D275's reason — these are Pokémon BODIES
    driven on a LOCAL `cardPool`, not Trainers played against the shared pool —
    and `catalogManifest.test.ts` diffs `FIXTURE_POOL` alone and reaches none of
    `sv06`/`sv09`/`sv10`, so a real id here would have no guard behind it either
    way. The printed Ability text is carried verbatim so a `FIXTURE_POOL`-shaped
    sentence sweep finds it; nothing reads it (the programs are keyed by id). */
const LOCAL_CARDS: Record<string, Card> = {
  [ARIADOS]: battler(ARIADOS, {
    name: "Ariados",
    hp: 90,
    retreat: 1,
    types: ["Grass"],
    stage: "Stage1",
    evolveFrom: "Spinarak",
    abilities: [
      {
        type: "Ability",
        name: "Big Net",
        effect: "Your opponent's Active Evolution Pokémon's Retreat Cost is {C} more.",
      },
    ],
  }),
  [TOEDSCRUEL]: battler(TOEDSCRUEL, {
    name: "Toedscruel",
    hp: 130,
    retreat: 2,
    types: ["Fighting"],
    stage: "Stage1",
    evolveFrom: "Toedscool",
    abilities: [
      {
        type: "Ability",
        name: "Secret Forest Path",
        effect:
          "As long as this Pokémon is on your Bench, your Active Pokémon's Retreat Cost is {C}{C} less.",
      },
    ],
  }),
  [MAGCARGO]: battler(MAGCARGO, {
    name: "Ethan's Magcargo",
    hp: 130,
    retreat: 3,
    types: ["Fire"],
    stage: "Stage1",
    evolveFrom: "Ethan's Slugma",
    abilities: [
      {
        type: "Ability",
        name: "Melt Away",
        effect: "If this Pokémon has no Energy attached, it has no Retreat Cost.",
      },
    ],
  }),
  [SPIDOPS]: battler(SPIDOPS, {
    name: "Spidops ex",
    hp: 260,
    retreat: 2,
    types: ["Grass"],
    stage: "Stage1",
    evolveFrom: "Tarountula",
    abilities: [
      {
        type: "Ability",
        name: "Trap Territory",
        effect: "Your opponent's Active Pokémon's Retreat Cost is {C} more.",
      },
    ],
  }),
  [HEAVY_BASIC]: battler(HEAVY_BASIC, { name: "Heavy Body", hp: 200, retreat: 3 }),
  [HEAVY_EVO]: battler(HEAVY_EVO, {
    name: "Heavy Body Evolved",
    hp: 200,
    retreat: 3,
    stage: "Stage1",
    evolveFrom: "Heavy Body",
  }),
  [LIGHT_BASIC]: battler(LIGHT_BASIC, { name: "Light Body", hp: 200, retreat: 1 }),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

/** This suite's own seeded deck (D270's rule). */
const RETREAT_DECK = deckOf({
  [ARIADOS]: 3,
  [TOEDSCRUEL]: 6,
  [MAGCARGO]: 3,
  [SPIDOPS]: 3,
  [HEAVY_BASIC]: 6,
  [HEAVY_EVO]: 6,
  [LIGHT_BASIC]: 4,
  "sv02-127": 3, // Ting-Lu ex — "Cursed Land", the §9 lock with NO stage clause
  "fix-basic-1": 8,
  "fix-energy": 18,
});

/** Three seeds, so nothing below rests on one shuffle (D270). */
const SEEDS = [8221, 8231, 8237] as const;

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

function localSetup(seed: number): GameState {
  const created = createGame({ seed, decks: { p1: RETREAT_DECK, p2: RETREAT_DECK }, cardPool: POOL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(
    applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first: "p1" }),
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

/** P1 fields `active`, with `p1Bench` behind it; P2 fields `p2Bench` behind a
    plain Active, so an opposing source is BENCHED unless a test says otherwise
    (the surcharge's source has no zone clause, which is the point). */
function board(
  seed: number,
  active: string,
  p1Bench: readonly string[] = [],
  p2Bench: readonly string[] = [],
): GameState {
  let state = localSetup(seed);
  state = clearBench(setActiveFromDeck(state, "p1", active), "p1");
  for (const id of p1Bench) state = benchFromDeck(state, "p1", id);
  if (p1Bench.length === 0) state = benchFromDeck(state, "p1", "fix-basic-1");
  state = clearBench(setActiveFromDeck(state, "p2", LIGHT_BASIC), "p2");
  for (const id of p2Bench) state = benchFromDeck(state, "p2", id);
  if (p2Bench.length === 0) state = benchFromDeck(state, "p2", "fix-basic-1");
  return state;
}

function p1Active(state: GameState): InPlayPokemon {
  const active = state.players.p1.active;
  if (active === null) throw new Error("p1 has no Active");
  return active;
}

/** P1's Active's cost under every continuous modifier in play. */
function cost(state: GameState): number {
  return effectiveRetreatCost(state, p1Active(state));
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. THE THREE REGISTRY ROWS — and what each one is NOT.
// ─────────────────────────────────────────────────────────────────────────────

describe("D322 §1 — the three registry rows", () => {
  it("Secret Forest Path is a DELTA with a source-zone gate, not a set-to-zero", () => {
    expect(programFor(TOEDSCRUEL)?.passive).toEqual({
      ownActiveRetreatDiscount: { amount: 2, sourceOnBench: true },
    });
    // 🛑 NOT `noRetreatCostAura`, the field two screens up that SETS the cost to
    // zero for every teammate matching a per-target clause. A build that reached
    // for it would free the whole board off one benched Toedscruel, and would be
    // GREEN on every board where the Active's printed cost is {C}{C} or less —
    // which is most of them. The negative is asserted, not assumed.
    expect(programFor(TOEDSCRUEL)?.passive?.noRetreatCostAura).toBeUndefined();
    expect(programFor(TOEDSCRUEL)?.passive?.noRetreatCostSelf).toBeUndefined();
    // …and NOT the cross-board field it mirrors, which is the other way to get
    // the sign right and the direction wrong.
    expect(programFor(TOEDSCRUEL)?.passive?.opponentActiveRetreatSurcharge).toBeUndefined();
    expect(programFor(TOEDSCRUEL)?.abilities).toBeUndefined();
    expect(programFor(TOEDSCRUEL)?.attack).toBeUndefined();
  });

  it("Big Net is the WIDENED surcharge, and its rider is D245's CardFilter reused", () => {
    expect(programFor(ARIADOS)?.passive).toEqual({
      opponentActiveRetreatSurcharge: { amount: 1, target: { kind: "evolutionPokemon" } },
    });
    // 🛑 THE RIDER IS NOT A BESPOKE BOOLEAN, AND THIS IS THE LINE THAT SAYS SO.
    // `seatDamageBonusBeforeWR.target` has stored this exact printed noun phrase
    // ("your opponent's Active **Evolution** Pokémon") as a `CardFilter` since
    // D245, matched against the DEFENDER's TOP CARD — an in-play body — so the
    // objection that `matchesFilter` is "a card read for deck/hand/discard" is
    // false on its face. Same member, same shape, one seam over.
    expect(programFor("sv07-038")?.passive?.seatDamageBonusBeforeWR?.target).toEqual({
      kind: "evolutionPokemon",
    });
    expect(programFor(ARIADOS)?.passive?.ownActiveRetreatDiscount).toBeUndefined();
  });

  it("Trap Territory is STILL the bare amount, which is what makes it a control", () => {
    for (const id of [SPIDOPS, "sv01-223", "sv01-243"]) {
      expect(programFor(id)?.passive).toEqual({ opponentActiveRetreatSurcharge: { amount: 1 } });
      expect(programFor(id)?.passive?.opponentActiveRetreatSurcharge?.target).toBeUndefined();
    }
    // All three printings share ONE program object — D190b's exact-map rule.
    expect(programFor(SPIDOPS)).toBe(programFor("sv01-223"));
  });

  it("Melt Away is Punk Out's antecedent-twin: same consequent, a HOLDER gate", () => {
    expect(programFor(MAGCARGO)?.passive).toEqual({
      noRetreatCostSelf: { requiresNoEnergyAttached: true },
    });
    // The two riders on this field are INDEPENDENT and both optional, which is
    // asserted in both directions: Melt Away carries the holder gate and NOT the
    // cross-board one, and Punk Out (Wimpod `sv08-041`) carries the reverse.
    expect(programFor(MAGCARGO)?.passive?.noRetreatCostSelf?.requiresOpponentSuffixInPlay)
      .toBeUndefined();
    // 🛑 AND IT IS NOT THE AURA. `noRetreatCostSelf` frees its HOLDER; a build on
    // `noRetreatCostAura` would free every teammate off a Magcargo with nothing
    // attached, which is the board this card is actually played on.
    expect(programFor(MAGCARGO)?.passive?.noRetreatCostAura).toBeUndefined();
    expect(programFor(MAGCARGO)?.passive?.ownActiveRetreatDiscount).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. SECRET FOREST PATH — the own-side discount, and the two clauses.
// ─────────────────────────────────────────────────────────────────────────────

describe("D322 §2 — Secret Forest Path, the own-side discount", () => {
  it("subtracts {C}{C} from its OWN side's Active — and leaves a remainder", () => {
    for (const seed of SEEDS) {
      const bare = board(seed, HEAVY_BASIC);
      expect(cost(bare)).toBe(3);
      const state = board(seed, HEAVY_BASIC, [TOEDSCRUEL]);
      // 🛑 THE ASSERTION THAT SEPARATES A DELTA FROM A SET-TO-ZERO. A printed
      // {C}{C}{C} body under ONE Toedscruel retreats for {C}, not for free —
      // and this is why the fixture is printed at 3 rather than at 2.
      expect(cost(state)).toBe(1);
      expect(alliedRetreatDiscount(state, p1Active(state))).toBe(2);
    }
  });

  it("SUMS its sources, and the floor is applied ONCE to the sum", () => {
    const state = board(SEEDS[0], HEAVY_BASIC, [TOEDSCRUEL, TOEDSCRUEL]);
    expect(alliedRetreatDiscount(state, p1Active(state))).toBe(4);
    // 3 − 4 = −1, clamped. A per-term floor would read the same here, which is
    // why §4 drives the composition where the two readings actually differ.
    expect(cost(state)).toBe(0);
  });

  it("SOURCE-ZONE GATE: an ACTIVE Toedscruel discounts nothing (`sourceOnBench`)", () => {
    // The printed "As long as this Pokémon is on your Bench". The source and the
    // beneficiary are on DISJOINT zones by construction here — the source must be
    // benched and the target is the Active — so promoting the Toedscruel ends the
    // discount for the body it displaces, and it can never be its own beneficiary.
    const state = board(SEEDS[1], TOEDSCRUEL, [HEAVY_BASIC]);
    expect(state.players.p1.active?.stack).toHaveLength(1);
    expect(cost(state)).toBe(2); // its own printed cost, undiscounted
    expect(alliedRetreatDiscount(state, p1Active(state))).toBe(0);
  });

  it("the SAME board minus the gate would have paid — the gate's live control", () => {
    // Reaching is necessary but not sufficient (D318): this pair is what proves
    // the `sourceOnBench` conjunct is LOAD-BEARING and not decorative. Same
    // Toedscruel, same Active body, one zone apart, two different answers.
    const benched = board(SEEDS[1], HEAVY_BASIC, [TOEDSCRUEL]);
    const promoted = board(SEEDS[1], TOEDSCRUEL, [HEAVY_BASIC]);
    expect(alliedRetreatDiscount(benched, p1Active(benched))).toBe(2);
    expect(alliedRetreatDiscount(promoted, p1Active(promoted))).toBe(0);
  });

  it("TARGET clause: a BENCHED teammate pays the printed cost", () => {
    // "your ACTIVE Pokémon's Retreat Cost", so the discount reaches exactly one
    // body per side even though the source is seat-wide.
    const state = board(SEEDS[2], LIGHT_BASIC, [TOEDSCRUEL, HEAVY_BASIC]);
    const benched = state.players.p1.bench.at(-1);
    if (benched === undefined) throw new Error("no benched body");
    expect(cost(state)).toBe(0); // 1 − 2, floored
    expect(effectiveRetreatCost(state, benched)).toBe(3); // printed, untouched
    expect(alliedRetreatDiscount(state, benched)).toBe(0);
  });

  it("🛑 is gated through disabledAbilityUids (§9) — DRIVEN, not asserted negative", () => {
    // ⚠️ **THIS BOARD EXISTS BECAUSE THE `--decision D322` PROBE FOUND THE GAP.**
    // The §9 conjunct was written into the scan and shipped UNOBSERVED: the
    // mutant that deletes it SURVIVED the first probe, because every board above
    // has no lock in play at all. A survivor is two hypotheses (the suite has a
    // gap, or the row is aimed at the wrong thing) and this one was the first.
    //
    // `trapTerritory.test.ts` could only assert the NEGATIVE here — Klefki's
    // "Mischievous Lock" narrows to BASIC Pokémon and Spidops ex is a Stage 1, so
    // no lock in the sv01–03 pool could reach that source. Toedscruel is a Stage 1
    // too, but **Ting-Lu ex `sv02-127` "Cursed Land" has no stage clause at all**:
    // it silences the opponent's DAMAGED, non-`ex` Pokémon while it is Active. A
    // benched, damaged Toedscruel is squarely inside that set, so the gate is
    // observable on this seam where it was not on the last one.
    const lit = board(SEEDS[0], HEAVY_BASIC, [TOEDSCRUEL]);
    expect(alliedRetreatDiscount(lit, p1Active(lit))).toBe(2);
    expect(cost(lit)).toBe(1);

    const locked = damageBench(setActiveFromDeck(lit, "p2", "sv02-127"), 0);
    const sourceUid = locked.players.p1.bench[0]?.stack.at(-1);
    if (sourceUid === undefined) throw new Error("p1 has no benched source");
    // The lock really reaches THIS body — asserted directly, so a board where
    // Cursed Land quietly stopped applying could not pass this test by accident.
    expect(disabledAbilityUids(locked).has(sourceUid)).toBe(true);
    expect(alliedRetreatDiscount(locked, p1Active(locked))).toBe(0);
    expect(cost(locked)).toBe(3); // the printed cost, back in full
  });

  it("is OWN-SIDE — an OPPOSING Toedscruel never discounts your Active", () => {
    // The mirror of `opposingRetreatSurcharge`'s own-side negative, and the one
    // assertion that would catch the scan reading `otherSeat` by copy-paste.
    const state = board(SEEDS[0], HEAVY_BASIC, [], [TOEDSCRUEL]);
    expect(cost(state)).toBe(3);
    expect(alliedRetreatDiscount(state, p1Active(state))).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. BIG NET — the target narrowing, and the trap it is built around.
// ─────────────────────────────────────────────────────────────────────────────

describe("D322 §3 — Big Net, the TARGET-narrowed surcharge", () => {
  it("surcharges an EVOLUTION Active and NOT a Basic one — the whole rider", () => {
    for (const seed of SEEDS) {
      const basic = board(seed, HEAVY_BASIC, [], [ARIADOS]);
      const evolution = board(seed, HEAVY_EVO, [], [ARIADOS]);
      // 🛑 THE TWO BODIES DIFFER IN `evolveFrom` AND IN NOTHING ELSE — same
      // printed retreat, same HP, same type — so the delta IS the adjective.
      expect(cost(basic)).toBe(3);
      expect(opposingRetreatSurcharge(basic, p1Active(basic))).toBe(0);
      expect(cost(evolution)).toBe(4);
      expect(opposingRetreatSurcharge(evolution, p1Active(evolution))).toBe(1);
    }
  });

  it("🛑 the rider is read off the TARGET and not off the SOURCE — the D320 trap", () => {
    // Ariados is ITSELF a Stage 1, so a build that matched the filter against the
    // SOURCE's card would be green on every board where this surcharge is imposed
    // at all, and would part from the printed reading only when the TARGET is a
    // Basic — which is exactly the board above. This test pins the direction by
    // asserting the source's own stage is the one that does NOT decide it.
    const sourceCard = POOL[ARIADOS];
    expect(sourceCard?.evolveFrom).toBe("Spinarak"); // the source IS an Evolution
    const basicTarget = board(SEEDS[0], HEAVY_BASIC, [], [ARIADOS]);
    // A source-side read would return 1 here. The target-side read returns 0.
    expect(opposingRetreatSurcharge(basicTarget, p1Active(basicTarget))).toBe(0);
  });

  it("imposes it from the BENCH — the SOURCE still has no zone clause", () => {
    // The widening narrowed the target and left the source alone, which the
    // sibling gate one field over (`sourceOnBench`) makes worth asserting: two
    // riders on one seam, one on each end, and only one of them is on this card.
    const benched = board(SEEDS[1], HEAVY_EVO, [], [ARIADOS]);
    const active = setActiveFromDeck(board(SEEDS[1], HEAVY_EVO), "p2", ARIADOS);
    expect(opposingRetreatSurcharge(benched, p1Active(benched))).toBe(1);
    expect(opposingRetreatSurcharge(active, p1Active(active))).toBe(1);
  });

  it("the UNMARKED print reaches the Basic the narrowed one cannot", () => {
    // Trap Territory vs Big Net on the SAME board: the control that makes the
    // rider legible rather than merely present. An absent `target` is UNGATED.
    const spidops = board(SEEDS[2], HEAVY_BASIC, [], [SPIDOPS]);
    const ariados = board(SEEDS[2], HEAVY_BASIC, [], [ARIADOS]);
    expect(opposingRetreatSurcharge(spidops, p1Active(spidops))).toBe(1);
    expect(opposingRetreatSurcharge(ariados, p1Active(ariados))).toBe(0);
  });

  it("SUMS a gated source with an ungated one, per target", () => {
    // Both live at once: facing a BASIC only Trap Territory pays; facing an
    // EVOLUTION both do. One board, two answers, one sum.
    const basic = board(SEEDS[0], HEAVY_BASIC, [], [SPIDOPS, ARIADOS]);
    const evolution = board(SEEDS[0], HEAVY_EVO, [], [SPIDOPS, ARIADOS]);
    expect(opposingRetreatSurcharge(basic, p1Active(basic))).toBe(1);
    expect(opposingRetreatSurcharge(evolution, p1Active(evolution))).toBe(2);
    expect(cost(basic)).toBe(4);
    expect(cost(evolution)).toBe(5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. THE FOLD — four terms, one floor, and the composition that needs both.
// ─────────────────────────────────────────────────────────────────────────────

describe("D322 §4 — the fold in effectiveRetreatCost", () => {
  it("🛑 a discount and a surcharge MEET, and only the SUM knows the answer", () => {
    // The composition that makes `alliedRetreatDiscount` a TERM rather than a
    // tier. A {C}{C}{C} Active under one Toedscruel (−2) facing one Spidops ex
    // (+1) is {C}{C}: a tiered engine that applied the discount first and floored
    // it would read 1 + 1 = 2 by luck, so the case below is chosen where a
    // per-term floor and a summed floor actually disagree.
    const state = board(SEEDS[0], HEAVY_BASIC, [TOEDSCRUEL], [SPIDOPS]);
    expect(alliedRetreatDiscount(state, p1Active(state))).toBe(2);
    expect(opposingRetreatSurcharge(state, p1Active(state))).toBe(1);
    expect(cost(state)).toBe(2); // 3 − 2 + 1
  });

  it("🛑 THE FLOOR IS APPLIED ONCE TO THE SUM, not per term", () => {
    // TWO Toedscruel (−4) against a printed {C} Active (+0 surcharge) is −3
    // before the floor. Add a Spidops ex (+1): a PER-TERM floor would clamp the
    // negative to 0 and then charge the surcharge, reading 1. The honest fold
    // reads 0 — the surcharge is absorbed by a discount that has already gone
    // past zero. **This is the only assertion in the suite that distinguishes
    // the two flooring strategies, and it is why the floor lives on the sum.**
    const state = board(SEEDS[1], LIGHT_BASIC, [TOEDSCRUEL, TOEDSCRUEL], [SPIDOPS]);
    expect(alliedRetreatDiscount(state, p1Active(state))).toBe(4);
    expect(opposingRetreatSurcharge(state, p1Active(state))).toBe(1);
    expect(cost(state)).toBe(0); // 1 − 4 + 1 = −2 → 0, NOT max(0, 1−4) + 1 = 1
  });

  it("loses to the set-to-zero tier, which is applied after the ± terms", () => {
    // Melt Away zeroes outright, so on a board where a surcharge is also live the
    // free-retreat short circuit wins — and the surcharge is still being imposed,
    // it is simply overruled. `noRetreatCostAura`/`Self` are the only tier.
    const state = board(SEEDS[2], MAGCARGO, [], [SPIDOPS]);
    expect(opposingRetreatSurcharge(state, p1Active(state))).toBe(1);
    expect(hasFreeRetreatSelf(state, p1Active(state))).toBe(true);
    expect(cost(state)).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. MELT AWAY — the holder gate, live rather than turn-scoped.
// ─────────────────────────────────────────────────────────────────────────────

describe("D322 §5 — Melt Away, the HOLDER-side antecedent", () => {
  it("frees a printed-{C}{C}{C} holder while it has NO Energy attached", () => {
    for (const seed of SEEDS) {
      const state = board(seed, MAGCARGO);
      expect(state.players.p1.active?.energy).toHaveLength(0);
      expect(hasFreeRetreatSelf(state, p1Active(state))).toBe(true);
      expect(cost(state)).toBe(0);
    }
  });

  it("🛑 THE GATE IS LIVE: one attached Energy takes the freedom away", () => {
    // The condition is read off the board on every call, not latched at the start
    // of a turn — which is the sharpest control this rider has, because a board
    // that never moves an Energy cannot tell it from an unconditional print.
    let state = board(SEEDS[0], MAGCARGO);
    expect(cost(state)).toBe(0);
    state = attachOne(state);
    expect(state.players.p1.active?.energy).toHaveLength(1);
    expect(hasFreeRetreatSelf(state, p1Active(state))).toBe(false);
    expect(cost(state)).toBe(3); // its own printed cost, back in full
  });

  it("counts ATTACHED CARDS, on the boundary of exactly one", () => {
    // The print says "no Energy attached", so the read is `energy.length`.
    // ⚠️ **AND THE MUTANT THAT SWAPS IT FOR `providedEnergy` IS DECLARED
    // EQUIVALENT, WHICH THE PROBE IS WHAT ESTABLISHED.** Every arm of `unitsOf`
    // returns a NON-EMPTY array, so at a `> 0` existence check the two readings
    // are the same predicate on every board this engine can build — the
    // distinction is real for a COUNT and vacuous here. This test therefore pins
    // the BOUNDARY (zero vs one attached card) and claims nothing it cannot see.
    const state = attachOne(board(SEEDS[1], MAGCARGO));
    expect(state.players.p1.active?.energy).toHaveLength(1);
    expect(hasFreeRetreatSelf(state, p1Active(state))).toBe(false);
  });

  it("is HOLDER-only — a teammate with no Energy is not freed", () => {
    // `noRetreatCostSelf` scopes its holder. The Magcargo is benched and the
    // Active is a bare {C}{C}{C} body with nothing attached, so a build on the
    // AURA field would read 0 here.
    const state = board(SEEDS[2], HEAVY_BASIC, [MAGCARGO]);
    expect(cost(state)).toBe(3);
    const benched = state.players.p1.bench.at(-1);
    if (benched === undefined) throw new Error("no benched body");
    expect(hasFreeRetreatSelf(state, benched)).toBe(true);
  });
});

/** Attach exactly one `fix-energy` from P1's hand or deck to P1's Active, as a
    real state edit rather than an action (the setup walk leaves P1 on turn 1,
    where an attach is legal but the deck order is not this suite's business). */
function attachOne(state: GameState): GameState {
  const side = state.players.p1;
  const uid = side.deck.find((u) => state.cardIdByUid[u] === "fix-energy");
  if (uid === undefined) throw new Error("p1 deck has no fix-energy");
  const active = side.active;
  if (active === null) throw new Error("p1 has no Active");
  return {
    ...state,
    players: {
      ...state.players,
      p1: {
        ...side,
        deck: side.deck.filter((u) => u !== uid),
        active: { ...active, energy: [...active.energy, uid] },
      },
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. THE ACTION — the funnel's commonest reader, driven rather than grepped.
// ─────────────────────────────────────────────────────────────────────────────

describe("D322 §6 — the retreat action pays the delta", () => {
  it("🛑 `retreat` ROUTES THROUGH THE FUNNEL — the half D320's slice did not", () => {
    // The grep says `turn.ts:694` calls `effectiveRetreatCost`. This drives it:
    // the printed cost is {C}{C}{C} and under one benched Toedscruel the action
    // REFUSES three Energy and ACCEPTS one. D320's whole loss was a sentence
    // whose commonest trigger did not route through the site it was built on, so
    // the routing is asserted on a real action rather than inferred.
    let state = board(SEEDS[0], HEAVY_BASIC, [TOEDSCRUEL]);
    state = attachN(state, 3);
    const paid = state.players.p1.active?.energy ?? [];
    expect(paid).toHaveLength(3);
    expect(cost(state)).toBe(1);

    // The PRINTED cost is now wrong in the action, not merely in the read model.
    const overpaid = applyAction(state, {
      type: "retreat",
      seat: "p1",
      discardEnergy: [...paid],
      promoteBenchIndex: 0,
    });
    expect(overpaid.ok).toBe(false);
    if (!overpaid.ok) expect(overpaid.error.code).toBe("RETREAT_COST_MISMATCH");

    // …and the DISCOUNTED cost is accepted.
    const done = must(
      applyAction(state, {
        type: "retreat",
        seat: "p1",
        discardEnergy: paid.slice(0, 1),
        promoteBenchIndex: 0,
      }),
    );
    expect(done.players.p1.active?.stack.at(-1)).toBeDefined();
    expect(done.players.p1.discard).toHaveLength(1);
  });

  it("the promotion ENDS the discount it was granted under", () => {
    // The retreat promotes the Toedscruel itself, so the body arriving in the
    // Active Spot is the source — and `sourceOnBench` immediately stops paying.
    // One action, two boards, and the zone clause is what separates them.
    let state = board(SEEDS[1], HEAVY_BASIC, [TOEDSCRUEL]);
    state = attachN(state, 3);
    const paid = state.players.p1.active?.energy ?? [];
    const done = must(
      applyAction(state, {
        type: "retreat",
        seat: "p1",
        discardEnergy: paid.slice(0, 1),
        promoteBenchIndex: 0,
      }),
    );
    expect(alliedRetreatDiscount(done, p1Active(done))).toBe(0);
    expect(cost(done)).toBe(2); // Toedscruel's own printed cost
  });
});

/** Put a damage counter on P1's benched body at `index` — the antecedent Cursed
    Land reads ("your opponent's Pokémon in play that have any damage counters on
    them have no Abilities"). A direct state edit rather than an attack, so the
    §9 board says nothing about the damage pipeline. */
function damageBench(state: GameState, index: number): GameState {
  const side = state.players.p1;
  const target = side.bench[index];
  if (target === undefined) throw new Error(`p1 has no benched Pokémon at ${index}`);
  return {
    ...state,
    players: {
      ...state.players,
      p1: {
        ...side,
        bench: side.bench.map((p, i) => (i === index ? { ...p, damage: 10 } : p)),
      },
    },
  };
}

/** Attach `count` `fix-energy` cards to P1's Active — `attachOne` repeated. */
function attachN(state: GameState, count: number): GameState {
  let next = state;
  for (let i = 0; i < count; i += 1) next = attachOne(next);
  return next;
}
