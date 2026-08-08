import manifest from "../package.json" with { type: "json" };
import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { matchesFilter } from "./cards";
import type { CardFilter } from "./effects";
import {
  applyAction,
  conditionHolds,
  conditionNote,
  createGame,
  engineVersion,
  programFor,
} from "./index";
import type { GameState, Seat } from "./index";
import {
  FIXTURE_POOL,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  firstBasicInHand,
  handFromDeck,
  must,
  setActiveFromDeck,
} from "./testFixtures";
import { isFirstTurnOf } from "./types";

// D275 — THE PER-SEAT TURN ORDINAL, AND THE LAST ROW ON THE NAME-LOCK SWEEP.
//
// THE SENTENCE. *"Once during your **first** turn, you may search your deck for
// up to 3 {C} Pokémon with 100 HP or less, reveal them, and put them into your
// hand. Then, shuffle your deck. You can't use more than 1 Fan Call Ability
// during your turn."* — Fan Rotom, TWO Standard-legal printings, `sv07-118` and
// `sv08.5-085`, whose `abilities_json` is BYTE-IDENTICAL (re-queried against
// remote D1 `luminous`, 2026-08-08, both `legal_standard = 1`, both
// `types_json ["Colorless"]`, both `hp` 70).
//
// ── WHAT THIS SLICE SETTLED BEFORE IT BUILT ANYTHING ────────────────────────
//
// 🛑 **THE TURN-ORDINAL GATE IS A DERIVED READ, NOT A `GameState` FIELD**, and
// the question was settled by READING SIGNATURES rather than by analogy. D273's
// handoff priced it both ways and left the choice open; D274's resume point made
// settling it the required first step. `GameState` already carries `turn`
// (1-based, 0 in setup) and `firstPlayer` (`Seat | null`), and `phaseViewOf` —
// the ONE exhaustive reading of turn ownership — spells the invariant that
// decides it: **odd turns belong to `firstPlayer`**. So the going-first seat's
// first turn is turn 1, the other seat's is turn 2, and there is no third case.
// A field would have been a cached copy of that comparison, costing a write
// site, an initialiser, a `MATCH_RECORD_VERSION` question and a way to be wrong.
//
// ⚠️ **AND THE EXPRESSION WAS ALREADY WRITTEN THREE TIMES AT HEAD** — `turn.ts`
// `evolve`, `cardplay.ts` `rareCandy` and `rareCandyOptions`, all spelling §4's
// first-turn evolve ban inline. This slice's gate would have been a FOURTH copy.
// It is instead ONE exported reader (`isFirstTurnOf`, types.ts) with four
// callers: **widen a funnel, do not add a parallel one**, and one reading of
// "your first turn" rather than four that can drift.
//
// 🛑 **THE CONTRAST WITH D271 IS THE TRANSFERABLE PART.** `lastKoTurn` DID need
// a `GameState` field, and the difference is not scale — it is whether the live
// board can still answer the question. "Which turn did this seat lose a Pokémon"
// is HISTORY: the body has left play and no allowance survives the boundary, so
// nothing can recompute it. "Is this my first turn" is ARITHMETIC over two
// fields that are still sitting there. **Ask whether the state can recompute it
// before you decide to store it.**
//
// ── WHAT ELSE THE ROW COST, AND WHAT IT DID NOT ─────────────────────────────
//
// ONE new `BoardCondition` member (`yourFirstTurn`), ONE new optional property on
// an existing `CardFilter` member (`typedPokemon.maxHp` — D265's rider arriving
// exactly where D265's own doc block said it was owed), ZERO new `EffectOp`
// members, ZERO new reject codes, ZERO new events, ZERO `GameState` fields and
// ZERO `src/` files: `GameHud.tsx` reads `playableIf` through `conditionHolds` /
// `conditionNote` generically, so the new gate greys the button and captions
// itself with no app diff at all.
//
// ── THE HAZARD THIS SUITE IS SHAPED AROUND ─────────────────────────────────
//
// ⚠️ **A ONE-SEAT BOARD IS VACUOUS ON A PER-SEAT ORDINAL.** `state.turn === 1`
// and `isFirstTurnOf(state, seat)` are INDISTINGUISHABLE on every board where
// the going-FIRST player is the one using the Ability — which is every board a
// lazy fixture builds. The second player's first turn is turn **2**, so §5 below
// drives the Ability from BOTH seats under BOTH first-player assignments, and
// that is the only place the difference between the two readings shows up.
//
// ⚠️ **AND A ONE-COPY BOARD IS VACUOUS ON A CROSS-COPY LOCK** (D272's hazard,
// inherited whole). §6 benches `sv07-118` AND `sv08.5-085` — two DISTINCT
// catalog ids, one Ability name — because a build keyed `${cardId}:${name}`
// passes a two-copy board of ONE printing and fails the print.

// ── the local pool (FIXTURE_POOL is left untouched — D190's idiom) ───────────

/** The printed text, once, byte-for-byte, shared by both printings. */
const FAN_CALL_TEXT =
  "Once during your first turn, you may search your deck for up to 3 {C} Pokémon with 100 HP or less, reveal them, and put them into your hand. Then, shuffle your deck. You can't use more than 1 Fan Call Ability during your turn.";

/** A Fan Rotom printing, carrying the catalog's OWN hp (70) and type
    (`Colorless`) — read off the D1 row rather than invented, because a fixture
    that disagrees with the catalog tests a card nobody printed. The id is REAL,
    so `programFor` resolves the shipped `FAN_CALL` row rather than a stand-in.
    ⚠️ IT IS ITSELF A LEGAL CANDIDATE for its own search (70 HP, {C}), which is a
    fact about the card and not an accident of the fixture. */
function fanRotom(id: string): Card {
  return battler(id, {
    name: "Fan Rotom",
    hp: 70,
    retreat: 1,
    types: ["Colorless"],
    abilities: [{ type: "Ability", name: "Fan Call", effect: FAN_CALL_TEXT }],
  });
}

const LOCAL_CARDS: Record<string, Card> = {
  "sv07-118": fanRotom("sv07-118"),
  "sv08.5-085": fanRotom("sv08.5-085"),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

/** The ELEVENTH seeded deck (D270's rule: a seeded suite gets its OWN deck). The
    Pokémon rows are chosen for what the FILTER must say about each:
      · `fix-basic-1` (60 HP {C}) and `fix-victim` (30 HP {C}) — ADMITTED;
      · `fix-stage1` (90 HP {C}, an Evolution) — ADMITTED, because the printed
        noun carries no stage word and this filter therefore has no `stage`;
      · `fix-tough` (120 HP {C}) — REFUSED by the threshold alone;
      · `fix-zero-hp` (0 HP {C}) — REFUSED by the NULL, `hpOf`'s data-gap read;
      · `fix-psychic-1` (60 HP {P}) — REFUSED by the type alone;
      · the two Fan Rotom printings themselves (70 HP {C}) — ADMITTED.
    Every one of those verdicts is asserted in §4 at the unit AND in §5 as the
    candidate list an actual park offers. */
const FAN_DECK = deckOf({
  "sv07-118": 4,
  "sv08.5-085": 4,
  "fix-basic-1": 4,
  "fix-victim": 4,
  "fix-stage1": 4,
  "fix-tough": 4,
  "fix-zero-hp": 2,
  "fix-psychic-1": 4,
  "fix-energy": 30,
});

function localSetup(seed: number, first: Seat): GameState {
  const created = createGame({ seed, decks: { p1: FAN_DECK, p2: FAN_DECK }, cardPool: POOL });
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

/** A board with `seat`'s Fan Rotom ACTIVE and a second body benched, at whatever
    turn `localSetup` opens on (turn 1, owned by `first`).
    ⚠️ THE BENCH BODY IS LOAD-BEARING — §14.2 makes an empty Bench a LOSS the
    moment the Active leaves, and a `gameOver` board proves nothing about a gate. */
function board(seed: number, first: Seat, seat: Seat, activeId = "sv07-118"): GameState {
  let state = localSetup(seed, first);
  state = setActiveFromDeck(state, seat, activeId);
  state = clearBench(state, seat);
  state = benchFromDeck(state, seat, "fix-basic-1");
  return state;
}

function passTurns(state: GameState, count: number): GameState {
  let next = state;
  for (let i = 0; i < count; i += 1) {
    if (next.phase.kind !== "turn:action") throw new Error(`stuck in ${next.phase.kind}`);
    next = must(applyAction(next, { type: "endTurn", seat: next.phase.seat }));
  }
  return next;
}

const ACTIVE = { spot: "active" } as const;
const BENCH_0 = { spot: "bench", index: 0 } as const;
const BENCH_1 = { spot: "bench", index: 1 } as const;

function useFanCall(
  state: GameState,
  seat: Seat,
  target: typeof ACTIVE | typeof BENCH_0 | typeof BENCH_1,
) {
  return applyAction(state, { type: "useAbility", seat, target, abilityName: "Fan Call" });
}

/** The parked `chooseCards` prompt, or a loud throw. */
function cardsPrompt(state: GameState) {
  const phase = state.phase;
  if (phase.kind !== "effect:choose" || phase.prompt.kind !== "chooseCards") {
    throw new Error(`expected a chooseCards park, got ${phase.kind}`);
  }
  return phase.prompt;
}

/** The distinct catalog ids a park is offering. */
function offeredIds(state: GameState): string[] {
  return [
    ...new Set(
      cardsPrompt(state).candidates.map((uid) => state.cardIdByUid[uid] ?? "<no catalog id>"),
    ),
  ].sort();
}

const SEEDS = [4, 19, 38, 57, 88] as const;

// ─────────────────────────────────────────────────────────────────────────────
// 1. The registry rows — the printed sentence, as data.
// ─────────────────────────────────────────────────────────────────────────────

describe("Fan Rotom — the two printings as registry data", () => {
  it("both ids resolve to ONE program carrying all four printed clauses", () => {
    for (const id of ["sv07-118", "sv08.5-085"]) {
      const ability = programFor(id)?.abilities?.[0];
      expect(ability?.name, id).toBe("Fan Call");
      // "You can't use more than 1 Fan Call Ability DURING YOUR TURN" — note the
      // wording differs from the other two carriers of this lock ("each turn")
      // and the FIELD DOES NOT CARE. `true` here would be a live bug on any board
      // with a second copy, driven for real in §6.
      expect(ability?.oncePerTurn, id).toBe("sharedByName");
      // "Once during your FIRST turn" — the slice.
      expect(ability?.playableIf, id).toEqual({ kind: "yourFirstTurn" });
      // No "in the Active Spot" clause is printed, which is also what makes the
      // benched-copy board in §6 reachable.
      expect(ability?.activeOnly, id).toBe(false);
      // The search: Genesect ex's "Metallic Signal" program with a different
      // filter, plus D265's threshold rider on `typedPokemon`.
      expect(ability?.program, id).toEqual([
        {
          op: "searchDeck",
          filter: { kind: "typedPokemon", pokemonType: "Colorless", maxHp: 100 },
          dest: "hand",
          max: 3,
          reveal: true,
        },
        { op: "shuffleDeck" },
      ]);
    }
  });

  it("the two printings share ONE program object — a reprint is not a second authoring", () => {
    expect(programFor("sv08.5-085")).toBe(programFor("sv07-118"));
  });

  it("no `trainerPlayableIf` was authored — this gate is on the ABILITY surface", () => {
    // ⚠️ THE MUTANT THIS KILLS: parking the gate on `trainerPlayableIf`. A Pokémon
    // is not a Trainer and `playTrainer` never sees this card, so a gate authored
    // there would be UNREACHABLE — green everywhere, enforcing nothing.
    expect(programFor("sv07-118")?.trainerPlayableIf).toBeUndefined();
  });

  it("the filter carries NO `stage` — the printed noun has no stage word", () => {
    // ⚠️ A NEGATIVE WORTH SPELLING. `typedPokemon` admits `stage`, and "{C}
    // Pokémon" reads to a hurried author like "Basic {C} Pokémon" because most
    // search targets are Basics. A `stage: "basic"` here would silently refuse
    // every Stage 1 in the deck — the quiet-wrong-answer direction — and §5 shows
    // an Evolution really is offered.
    const ability = programFor("sv07-118")?.abilities?.[0];
    const op = ability?.program?.[0];
    expect(op?.op).toBe("searchDeck");
    expect(op?.op === "searchDeck" ? op.filter : undefined).not.toHaveProperty("stage");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. `isFirstTurnOf` — the derived read, at the unit.
// ─────────────────────────────────────────────────────────────────────────────

describe("isFirstTurnOf — the per-seat turn ORDINAL, derived and not stored", () => {
  /** A bare state carrying only the two fields the reader consults. Deliberately
      NOT a driven board: this is the arithmetic, and the arithmetic is total. */
  const at = (turn: number, firstPlayer: Seat | null) =>
    ({ turn, firstPlayer }) as unknown as GameState;

  it("turn 1 is the FIRST player's first turn and NOBODY else's", () => {
    expect(isFirstTurnOf(at(1, "p1"), "p1")).toBe(true);
    expect(isFirstTurnOf(at(1, "p1"), "p2")).toBe(false);
  });

  it("🛑 turn 2 is the SECOND player's first turn — the whole point of the reader", () => {
    // THE CASE `state.turn === 1` GETS WRONG. A build that read the turn number
    // alone would refuse the going-second seat's Ability on the only turn it is
    // printed for, and no board with p1 acting could ever show it.
    expect(isFirstTurnOf(at(2, "p1"), "p2")).toBe(true);
    expect(isFirstTurnOf(at(2, "p1"), "p1")).toBe(false);
  });

  it("MIRRORS when p2 goes first — the ordinal is per SEAT, not per seat NAME", () => {
    expect(isFirstTurnOf(at(1, "p2"), "p2")).toBe(true);
    expect(isFirstTurnOf(at(1, "p2"), "p1")).toBe(false);
    expect(isFirstTurnOf(at(2, "p2"), "p1")).toBe(true);
    expect(isFirstTurnOf(at(2, "p2"), "p2")).toBe(false);
  });

  it("is FALSE for both seats from turn 3 onward — it is an ORDINAL, not 'early'", () => {
    // ⚠️ THE MUTANT THIS KILLS: `turn <= 1 ? 1 : 2` and every other reading that
    // makes the predicate a WINDOW instead of a point. A turn-3 Fan Call is a
    // late-game tutor, which is the reading the printed word "first" forbids.
    for (const turn of [3, 4, 5, 12]) {
      expect(isFirstTurnOf(at(turn, "p1"), "p1"), `turn ${turn}`).toBe(false);
      expect(isFirstTurnOf(at(turn, "p1"), "p2"), `turn ${turn}`).toBe(false);
    }
  });

  it("is FALSE during setup, with no null guard spelled", () => {
    // `firstPlayer` is null ONLY while `turn` is still 0, so the `? 2` branch
    // compares `0 === 2` and answers FALSE without a guard. A spelled-out
    // `firstPlayer !== null` would be a conjunct no board can make false.
    expect(isFirstTurnOf(at(0, null), "p1")).toBe(false);
    expect(isFirstTurnOf(at(0, null), "p2")).toBe(false);
  });

  it("§4's evolve ban and the printed gate ask the SAME function on a REAL board", () => {
    // ⚠️ THE CROSS-CHECK THE EXTRACTION EXISTS FOR. Before this slice the
    // expression was copied at three sites; the risk of a fourth copy is not that
    // it is wrong on day one but that it drifts. Driven rather than asserted
    // structurally: on the same live states, the rules ban and the card gate
    // agree seat by seat and turn by turn.
    let state = localSetup(SEEDS[0], "p1");
    for (const turn of [1, 2, 3, 4]) {
      expect(state.turn, "the board really is on this turn").toBe(turn);
      for (const seat of ["p1", "p2"] as const) {
        const derived = isFirstTurnOf(state, seat);
        expect(conditionHolds(state, seat, { kind: "yourFirstTurn" }), `${seat}@${turn}`).toBe(
          derived,
        );
      }
      state = passTurns(state, 1);
    }
  });

  it("🛑 §4's EVOLVE BAN fires on exactly the turns the new gate opens on", () => {
    // ⚠️ THE CROSS-CHECK THE EXTRACTION EXISTS FOR, DRIVEN RATHER THAN ARGUED.
    // The rules ban (`turn.ts evolve`) and the printed card gate (`useAbility` →
    // `conditionHolds`) now call ONE function; if they ever stop agreeing, this
    // goes red without anyone having to notice the second copy. Four consecutive
    // turns, whoever is acting, with a REAL evolution available every time.
    let state = localSetup(SEEDS[1], "p1");
    for (const turn of [1, 2, 3, 4]) {
      expect(state.turn).toBe(turn);
      const phase = state.phase;
      if (phase.kind !== "turn:action") throw new Error(`stuck in ${phase.kind}`);
      const seat = phase.seat;
      // A body that has been in play since setup (turnPlayed 0) plus its
      // Evolution in hand, so nothing but §4 can stand in the way.
      let board = setActiveFromDeck(state, seat, "fix-basic-1");
      board = handFromDeck(board, seat, "fix-stage1", 1);
      const uid = board.players[seat].hand.find((u) => board.cardIdByUid[u] === "fix-stage1");
      if (uid === undefined) throw new Error("fix-stage1 never reached the hand");
      const attempt = applyAction(board, { type: "evolve", seat, uid, target: ACTIVE });
      const banned = !attempt.ok && attempt.error.code === "FIRST_TURN_EVOLVE";
      expect(banned, `${seat}@${turn}`).toBe(isFirstTurnOf(board, seat));
      // …and the card gate answers identically on the very same board.
      expect(conditionHolds(board, seat, { kind: "yourFirstTurn" }), `${seat}@${turn}`).toBe(
        banned,
      );
      // Anti-vacuity: off the ban the evolution really does go through, so
      // "banned" is not just "this board never evolves".
      if (!banned) expect(attempt.ok, `${seat}@${turn}`).toBe(true);
      state = passTurns(state, 1);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. The `BoardCondition` member — `conditionHolds` and `conditionNote`.
// ─────────────────────────────────────────────────────────────────────────────

describe("BoardCondition.yourFirstTurn — the fifth turn-reading member", () => {
  const COND = { kind: "yourFirstTurn" } as const;

  it("holds for exactly ONE seat on turn 1 and the OTHER on turn 2", () => {
    for (const first of ["p1", "p2"] as const) {
      const second = first === "p1" ? "p2" : "p1";
      const turn1 = localSetup(SEEDS[1], first);
      expect(conditionHolds(turn1, first, COND)).toBe(true);
      expect(conditionHolds(turn1, second, COND)).toBe(false);
      const turn2 = passTurns(turn1, 1);
      expect(conditionHolds(turn2, second, COND)).toBe(true);
      expect(conditionHolds(turn2, first, COND)).toBe(false);
    }
  });

  it("is FALSE for BOTH seats once turn 3 opens", () => {
    const turn3 = passTurns(localSetup(SEEDS[1], "p1"), 2);
    expect(turn3.turn).toBe(3);
    for (const seat of ["p1", "p2"] as const) expect(conditionHolds(turn3, seat, COND)).toBe(false);
  });

  it("captions itself in the printed vocabulary", () => {
    // The note is what a player reads off a greyed HUD row (`GameHud.tsx` prints
    // `Only if ${conditionNote(...)}`), so it is the printed clause and not the
    // engine's arithmetic — nobody's card says "turn 1 or 2 depending on seat".
    expect(conditionNote(COND)).toBe("it is your first turn");
    expect(conditionNote(COND)).not.toBe(
      conditionNote({ kind: "yourPokemonKoedOnOpponentsLastTurn" }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. `typedPokemon.maxHp` — D265's rider on its second member.
// ─────────────────────────────────────────────────────────────────────────────

describe("CardFilter.typedPokemon.maxHp — the printed HP threshold", () => {
  const FAN: CardFilter = { kind: "typedPokemon", pokemonType: "Colorless", maxHp: 100 };
  const BARE: CardFilter = { kind: "typedPokemon", pokemonType: "Colorless" };

  it("ADMITS a {C} body at or under the threshold, at any stage", () => {
    expect(matchesFilter(FIXTURE_POOL["fix-basic-1"], FAN)).toBe(true); // 60, Basic
    expect(matchesFilter(FIXTURE_POOL["fix-victim"], FAN)).toBe(true); // 30, Basic
    expect(matchesFilter(FIXTURE_POOL["fix-stage1"], FAN)).toBe(true); // 90, Stage 1
    expect(matchesFilter(LOCAL_CARDS["sv07-118"], FAN)).toBe(true); // 70, the card itself
  });

  it("REFUSES a {C} body OVER the threshold — the rider is the whole point", () => {
    expect(matchesFilter(FIXTURE_POOL["fix-tough"], FAN)).toBe(false); // 120
    expect(matchesFilter(FIXTURE_POOL["fix-bigbody"], FAN)).toBe(false); // 200
    // …and it is a `<=`, not a `<`: "100 HP or less" includes 100 exactly.
    expect(matchesFilter(battler("t-exactly-100", { hp: 100, types: ["Colorless"] }), FAN)).toBe(
      true,
    );
    expect(matchesFilter(battler("t-just-over", { hp: 110, types: ["Colorless"] }), FAN)).toBe(
      false,
    );
  });

  it("🛑 REFUSES a NULL HP rather than admitting it — `null <= 100` is TRUE in JS", () => {
    // D265's trap, inherited byte for byte. `hpOf` returns null for a
    // non-Pokémon and for a non-positive printed value (a data gap), and an
    // unguarded comparison would offer every one of them to a sentence that names
    // a Pokémon with a printed HP. An unknown HP is not "100 HP or less".
    expect(matchesFilter(FIXTURE_POOL["fix-zero-hp"], FAN)).toBe(false);
    // …and the SAME card passes the bare filter, so the refusal is the rider's
    // and not the type conjunct's.
    expect(matchesFilter(FIXTURE_POOL["fix-zero-hp"], BARE)).toBe(true);
  });

  it("REFUSES an off-type body under the threshold — the type conjunct is still live", () => {
    expect(matchesFilter(FIXTURE_POOL["fix-psychic-1"], FAN)).toBe(false); // 60 {P}
    expect(matchesFilter(FIXTURE_POOL["fix-grass-basic"], FAN)).toBe(false); // 60 {G}
  });

  it("ADMITS a DUAL-type body — the read is `.includes`, not `types[0]`", () => {
    // D238's rule, re-driven under the new conjunct: dual-type Pokémon are
    // printed, and a `types[0] === …` read would drop them silently. There is no
    // dual {C} body under 100 HP in `FIXTURE_POOL`, so the witness is built here.
    const dual = battler("t-dual-c", { hp: 90, types: ["Water", "Colorless"] });
    expect(matchesFilter(dual, FAN)).toBe(true);
    expect(matchesFilter(battler("t-dual-big", { hp: 130, types: ["Water", "Colorless"] }), FAN),
    ).toBe(false);
  });

  it("is OPTIONAL — the bare member is UNCHANGED, which is what makes it a widening", () => {
    // ⚠️ THE MUTANT THIS KILLS: a mandatory threshold, or a default. Every
    // `typedPokemon` authored before this slice (Metallic Signal, the Lilligant
    // aura, the brace-coded deriver) carries no `maxHp` and must keep admitting
    // bodies of any size.
    expect(matchesFilter(FIXTURE_POOL["fix-tough"], BARE)).toBe(true); // 120
    expect(matchesFilter(FIXTURE_POOL["fix-bigbody"], BARE)).toBe(true); // 200
  });

  it("leaves `basicPokemon.maxHp` alone — two members, one reading", () => {
    // The rider now spans TWO members and the two must agree on every card,
    // because they call the same `hpOf`. `fix-stage1` is the discriminator: a
    // Stage 1 under the threshold, admitted by one member and refused by the other
    // for a reason that has nothing to do with HP.
    const basic: CardFilter = { kind: "basicPokemon", maxHp: 100 };
    expect(matchesFilter(FIXTURE_POOL["fix-basic-1"], basic)).toBe(true);
    expect(matchesFilter(FIXTURE_POOL["fix-stage1"], basic)).toBe(false);
    expect(matchesFilter(FIXTURE_POOL["fix-stage1"], FAN)).toBe(true);
    expect(matchesFilter(FIXTURE_POOL["fix-tough"], basic)).toBe(false); // 120
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. The park — the caption and the offer, which must agree.
// ─────────────────────────────────────────────────────────────────────────────

describe("the Fan Call park — `retrieveNoun` and the candidate set", () => {
  it("captions the offer with the printed THRESHOLD, not with the bare noun", () => {
    // D245's lesson, re-applied: a describer arm is only built when a BOARD reads
    // it, and a caption that disagrees with the offer is the defect. This is the
    // first `typedPokemon` caption in the pool to carry a threshold suffix.
    const parked = must(useFanCall(board(SEEDS[2], "p1", "p1"), "p1", ACTIVE));
    expect(cardsPrompt(parked).note).toBe(
      "Search your deck for up to 3 Colorless Pokémon with 100 HP or less into your hand.",
    );
  });

  it("🛑 OFFERS exactly the bodies the filter admits — the caption's own claim", () => {
    const parked = must(useFanCall(board(SEEDS[2], "p1", "p1"), "p1", ACTIVE));
    // Every {C} body at or under 100 in the deck, and nothing else: the 120 HP
    // `fix-tough`, the 0 HP `fix-zero-hp` and the {P} `fix-psychic-1` are all in
    // the same deck and all absent. `fix-stage1` being present is the proof that
    // no stage word was invented.
    expect(offeredIds(parked)).toEqual([
      "fix-basic-1",
      "fix-stage1",
      "fix-victim",
      "sv07-118",
      "sv08.5-085",
    ]);
  });

  it("puts up to 3 chosen cards into the HAND and shuffles the deck", () => {
    const before = board(SEEDS[2], "p1", "p1");
    const handBefore = before.players.p1.hand.length;
    const deckBefore = before.players.p1.deck.length;
    const parked = must(useFanCall(before, "p1", ACTIVE));
    const picks = cardsPrompt(parked).candidates.slice(0, 3);
    expect(picks.length).toBe(3);
    const after = must(
      applyAction(parked, { type: "resolveEffect", seat: "p1", choice: { kind: "cards", uids: picks } }),
    );
    expect(after.phase.kind).toBe("turn:action");
    expect(after.players.p1.hand.length).toBe(handBefore + 3);
    expect(after.players.p1.deck.length).toBe(deckBefore - 3);
    for (const uid of picks) expect(after.players.p1.hand).toContain(uid);
    // "up to 3" — the park's own `min: 0` is what makes taking FEWER legal.
    const none = must(
      applyAction(parked, { type: "resolveEffect", seat: "p1", choice: { kind: "cards", uids: [] } }),
    );
    expect(none.players.p1.hand.length).toBe(handBefore);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. The board — the ordinal gate and the name lock, driven from BOTH seats.
// ─────────────────────────────────────────────────────────────────────────────

describe("Fan Call on a real board", () => {
  it("the FIRST player may use it on turn 1", () => {
    for (const seed of SEEDS) {
      const state = board(seed, "p1", "p1");
      expect(state.turn).toBe(1);
      expect(useFanCall(state, "p1", ACTIVE).ok, `seed ${seed}`).toBe(true);
    }
  });

  it("🛑 the SECOND player may use it on TURN 2 — the board `state.turn === 1` fails", () => {
    // THE HEADLINE. Turn 2 is the going-second seat's FIRST turn, and this is the
    // only assertion in the suite that distinguishes the shipped reader from the
    // one-line turn-number read. Swept over five seeds because the setup draw
    // decides which bodies are in hand and none of that may matter.
    for (const seed of SEEDS) {
      const turn2 = passTurns(board(seed, "p1", "p2"), 1);
      expect(turn2.turn).toBe(2);
      expect(turn2.phase.kind === "turn:action" && turn2.phase.seat).toBe("p2");
      expect(useFanCall(turn2, "p2", ACTIVE).ok, `seed ${seed}`).toBe(true);
    }
  });

  it("🛑 and may NOT use it on turn 1, which is the OPPONENT's first turn", () => {
    // The other half of the same fact, and the one a `turn <= 2` build gets
    // wrong: on turn 1 the going-second seat is not even the acting seat, so the
    // refusal here is the phase gate — which is why the assertion that carries the
    // weight is the turn-3 one below, where the seat DOES own the turn.
    const state = board(SEEDS[0], "p1", "p2");
    const rejected = useFanCall(state, "p2", ACTIVE);
    expect(rejected.ok).toBe(false);
  });

  it("🛑 REFUSES it on the seat's SECOND turn, naming the printed clause", () => {
    // Turn 3 with p1 first: p1 owns the phase, holds an unused Ability, and the
    // ONLY thing standing in the way is the ordinal. This is the assertion the
    // whole slice exists for.
    const turn3 = passTurns(board(SEEDS[0], "p1", "p1"), 2);
    expect(turn3.turn).toBe(3);
    const rejected = useFanCall(turn3, "p1", ACTIVE);
    expect(rejected.ok).toBe(false);
    if (rejected.ok) throw new Error("expected a refusal");
    expect(rejected.error.code).toBe("ABILITY_CONDITION_NOT_MET");
    expect(rejected.error.message).toContain("it is your first turn");
  });

  it("REFUSES it on turn 4 for the going-SECOND seat too", () => {
    const turn4 = passTurns(board(SEEDS[0], "p1", "p2"), 3);
    expect(turn4.turn).toBe(4);
    const rejected = useFanCall(turn4, "p2", ACTIVE);
    expect(rejected.ok).toBe(false);
  });

  it("🛑 the cross-copy lock: TWO DISTINCT printings share ONE use per turn", () => {
    // D272's hazard, inherited: a build keyed `${uid}:${name}` gives each body its
    // own use, and a build keyed `${cardId}:${name}` passes a two-copy board of
    // one printing. Both are refused by benching the OTHER printing.
    let state = board(SEEDS[3], "p1", "p1");
    state = benchFromDeck(state, "p1", "sv08.5-085");
    const parked = must(useFanCall(state, "p1", ACTIVE));
    const resolved = must(
      applyAction(parked, { type: "resolveEffect", seat: "p1", choice: { kind: "cards", uids: [] } }),
    );
    // The SECOND Fan Rotom, a different catalog id, on the same turn. It sits at
    // bench index 1 — `board` fills slot 0 with `fix-basic-1`, and naming the
    // wrong slot gets NO_SUCH_ABILITY, which is a green-looking refusal for the
    // wrong reason (this assertion caught exactly that on first run).
    const second = useFanCall(resolved, "p1", BENCH_1);
    expect(second.ok).toBe(false);
    if (second.ok) throw new Error("expected a refusal");
    expect(second.error.code).toBe("ABILITY_ALREADY_USED");
  });

  it("🛑 an already-used Ability reports the LOCK, not the gate — the refusal ORDER", () => {
    // ⚠️ THE ORDER MUTANT: hoisting `playableIf` above the once-per-turn lock. On
    // this card the two rejects can never BOTH be true (the lock only fires on a
    // turn the gate allows), so the hoist is invisible here — which is exactly why
    // the assertion is written on the board where the lock IS reachable: the
    // first turn, after one use. `ABILITY_ALREADY_USED` is the message that tells
    // the player something they did not know.
    const state = board(SEEDS[3], "p1", "p1");
    const parked = must(useFanCall(state, "p1", ACTIVE));
    const resolved = must(
      applyAction(parked, { type: "resolveEffect", seat: "p1", choice: { kind: "cards", uids: [] } }),
    );
    const again = useFanCall(resolved, "p1", ACTIVE);
    expect(again.ok).toBe(false);
    if (again.ok) throw new Error("expected a refusal");
    expect(again.error.code).toBe("ABILITY_ALREADY_USED");
  });

  it("a BENCHED Fan Rotom may use it — no `activeOnly` is printed", () => {
    let state = localSetup(SEEDS[4], "p1");
    state = setActiveFromDeck(state, "p1", "fix-basic-1");
    state = clearBench(state, "p1");
    state = benchFromDeck(state, "p1", "sv07-118");
    state = benchFromDeck(state, "p1", "fix-victim");
    expect(useFanCall(state, "p1", BENCH_0).ok).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. The record boundary — DRIVEN, not argued.
// ─────────────────────────────────────────────────────────────────────────────

describe("MATCH_RECORD_VERSION stays 14", () => {
  it("a v14-shaped park — a `searchDeck` with NO `maxHp` — replays BENIGNLY", () => {
    // The standing test is "can the PREVIOUS deploy's RECORD be read by THIS
    // deploy" (apps/api/src/lobby/match.ts). Nothing was added to `GameState`, to
    // any event or to any allowance — the gate is DERIVED from two fields v14
    // already carried, which is the version question answering itself. But a
    // PARKED program serializes into the phase, so the new filter property does
    // cross the record boundary and the question is real rather than rhetorical.
    const parked = must(useFanCall(board(SEEDS[2], "p1", "p1"), "p1", ACTIVE));
    const roundTripped = JSON.parse(JSON.stringify(parked)) as GameState;
    expect(cardsPrompt(roundTripped).candidates.length).toBeGreaterThan(0);

    // A v14 record holds a `searchDeck` with no `maxHp`, because no v14 deploy had
    // a registry row that could write one. Stripped from a live continuation:
    const legacy = JSON.parse(
      JSON.stringify(parked).replaceAll('"maxHp":100', '"unused":0'),
    ) as GameState;
    // 🆕 AND THE DRIVE ANSWERS WHAT THE ARGUMENT WOULD HAVE GUESSED AT. The filter
    // is NOT re-read on resume — `parkOrForce` files the CANDIDATE LIST and the
    // CAPTION into the phase, so the record carries the narrowing's RESULT rather
    // than its inputs. The park therefore resumes with the same rows and the same
    // caption, which is BENIGN in the strongest available sense: a pre-D275 park
    // holds a pre-D275 candidate list, computed by the deploy that wrote it.
    expect(cardsPrompt(legacy).note).toBe(cardsPrompt(parked).note);
    expect(cardsPrompt(legacy).candidates).toEqual(cardsPrompt(parked).candidates);
    // …and answering it still works, which is what "replays" means.
    const resumed = must(
      applyAction(legacy, {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "cards", uids: cardsPrompt(legacy).candidates.slice(0, 1) },
      }),
    );
    expect(resumed.phase.kind).toBe("turn:action");
  });

  it("a v14 GAMESTATE is missing nothing — the gate reads fields v14 already had", () => {
    // The direction a new `GameState` field would have broken. `turn` and
    // `firstPlayer` have been on the record since M1, so a v14 snapshot answers
    // the new condition with no migration, no default and no `?? 0`.
    const state = board(SEEDS[0], "p1", "p1");
    const legacy = JSON.parse(JSON.stringify(state)) as GameState;
    expect(conditionHolds(legacy, "p1", { kind: "yourFirstTurn" })).toBe(true);
    expect(useFanCall(legacy, "p1", ACTIVE).ok).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. The version debt — found on the way past, and GUARDED rather than fixed.
// ─────────────────────────────────────────────────────────────────────────────

describe("engineVersion and the package manifest are ONE number", () => {
  // 🛑 **FOUND WHILE BUMPING, NOT WHILE LOOKING.** At the head of this slice
  // `packages/engine/package.json` read **0.189.0** and `engineVersion` still said
  // **0.187.0**: D272 and D273 each bumped the manifest and left the constant
  // behind, and nothing anywhere compared the two. That is the FIFTH version-block
  // debt this branch has paid (D208 paid three, D221 a fourth), and every previous
  // payment fixed the numbers without stopping the next drift — `conventions.md`
  // has named the cause all along, that the version is a shared mutable resource
  // held in TWO files.
  //
  // ⚠️ **A DEBT PAID FIVE TIMES IS A MISSING GUARD, NOT A RECURRING MISTAKE.**
  // This is the tie. It is deliberately a READ of the manifest rather than a
  // recorded literal: a literal here would be a THIRD copy of the number and would
  // itself go stale, which is the same defect one file over.
  it("the constant IS the manifest's version", () => {
    expect(engineVersion).toBe(manifest.version);
  });

  it("and it is a real semver triple, so neither side can satisfy the tie with junk", () => {
    // ⚠️ WITHOUT THIS, `""` on both sides passes. The tie above says the two
    // AGREE; this says the thing they agree on is a version.
    expect(engineVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
