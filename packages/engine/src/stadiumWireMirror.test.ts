import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { applyAction, createGame, handPlayBarred, programFor, redactGame } from "./index";
import type { GameState, Seat } from "./index";
import {
  FIXTURE_POOL,
  battler,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  deckOf,
  deepFreeze,
  handFromDeck,
  handUid,
  setActiveFromDeck,
  setDamage,
} from "./testFixtures";

// D288 — THE STADIUM PAYABILITY MIRROR ON THE WIRE, AND THE GUARD THAT WAS
// NEVER THE REASON.
//
// ── THE ROW THIS SLICE CAME FROM, AND WHY ITS INSTRUCTION FAILED ────────────
//
// D287 shipped the ENGINE half of the Copperajah `sv06.5-042` Stadium bar (a
// `handPlayBarred` gate inside `playStadium`) and the LOCAL half (a widened
// `barred` term in `playableTrainers`, GameHud.tsx), and named the wire half as
// the last open gap in the hand-play family. Its handoff was specific:
//
//   > START BY DELETING `redact.ts`'s `if (card.trainerType === "Stadium")
//   > continue;` (line 642 at HEAD) AND READING WHAT REDDENS … PREDICT IT
//   > REDDENS MORE THAN THE HAND-PLAY SUITES … PREDICT AT LEAST 3 SUITES
//   > OUTSIDE `stadiumBar.test.ts` AND NAME THEM BEFORE YOU FIX ANY.
//
// 🛑 **IT WAS DELETED, AND NOTHING REDDENED. 5,876 OF 5,876 GREEN, ZERO
// ASSERTIONS MOVED, ZERO SUITES — NOT THREE, NOT ONE.** The line was DEAD CODE.
// Every authored Stadium program in the registry is `{stadium: …}` with no
// `trainer` key, so the very next statement —
//
//     if (!isRareCandy && program.trainer === undefined) continue;
//
// — already skipped every one of them, and had done since before the Stadium
// guard was written. §1 below asserts that decomposition (8 Stadium printings in
// the pool, 7 with programs, 0 with `program.trainer`) so the finding is a
// MEASUREMENT and not a story about a diff nobody can re-run.
//
// 🛑 **THE LESSON, AND IT IS ABOUT WHAT AN EXPERIMENT CAN AND CANNOT SHOW.** A
// guard that is never the reason looks EXACTLY like the guard that is: both are
// present, both name the right class, both sit above the behaviour they appear
// to cause, and the suite is green either way. Reading the code cannot tell them
// apart, because the code does not record which of two sufficient conditions
// fires first. Only DELETING one does. D287's instruction was methodologically
// right and factually wrong, and running it cost four minutes and bought the
// whole shape of this slice — the alternative was to "fix" a line that did
// nothing and report a mirror that had not been built.
//
// ── WHAT THE REAL SPEC TURNED OUT TO BE ────────────────────────────────────
//
// Not the deleted line but the LOCAL list it was supposed to mirror.
// `playableTrainers` (GameHud.tsx) has emitted Stadium button rows all along —
// `isStadium ? program.stadium === undefined : program.trainer === undefined` is
// its play-path discriminant, and D287 gave its Stadium rows the `barred` term.
// So the asymmetry was never "buttons versus drags": Stadiums are BOTH on the
// local page, a button in the Trainer list and a drag onto the shared slot.
// `redactedTrainersOf`'s docstring said they were excluded because offering them
// "would double the affordance", which was a description of the local page
// stated as a reason to differ from it.
//
// 🛑 **AND THE ROW HAD TO ARRIVE WITH ITS BAR ON THE SAME EDIT.** Emitting a
// Stadium row WITHOUT the `barred` term would have been strictly worse than the
// gap it closes: a lit row the engine refuses, which is the afford-then-reject
// defect the whole mirror exists to close. §3 is the assertion that keeps them
// together — the engine's own answer as the oracle, on a barred board and a free
// one, in both directions.
//
// ── WHAT IS STILL REFUSED, WITH THE MISSING MECHANISM NAMED ────────────────
//
//   • **AN ENGINE-SIDE ACE SPEC CLASSIFIER.** Genesect `sv06.5-040` (*"If this
//     Pokémon has a Pokémon Tool attached, your opponent can't play any ACE SPEC
//     cards from their hand."*) is the last survivor of D284's seven and is NOT
//     reachable from here. `HandPlayClass` is now EXACTLY `Card.trainerType`, and
//     this slice widened a PROJECTION over that union rather than the union — ACE
//     SPEC is a RARITY axis orthogonal to `trainerType` (`Card.rarity` carries
//     `"ACE SPEC Rare"`, 33 legal rows), so it needs a SECOND DIMENSION of
//     question that no widening of this list can supply.
//   • **NO DOM TEST ASSERTS THE HAND-PLAY BAR IN THE LOCAL HUD** — now for D283,
//     D284, D286, D287 *and* D288. `playableTrainers`'s `barred` term has never
//     been driven from `src/`. The ONLINE twin is pinned here and in
//     `rareCandyBar.test.ts` §5 / `screamTail.test.ts` §4 / `stadiumBar.test.ts`
//     §6. This is a SUITE GAP, deliberately not a corpus row.

const MASSIVE_BODY_TEXT =
  "As long as this Pokémon is in the Active Spot, your opponent can't play any Stadium cards from their hand.";
const DAUNTING_GAZE_TEXT =
  "As long as this Pokémon is in the Active Spot, your opponent can't play any Item cards from their hand.";
const ITEM_LOCK_TEXT =
  "During your opponent's next turn, they can't play any Item cards from their hand.";
const GALVANTULA_TEXT = `Discard all Energy from this Pokémon. ${ITEM_LOCK_TEXT}`;

/** The CONTINUOUS `"Stadium"` source — the only sentence that can grey these rows. */
const COPPERAJAH = "sv06.5-042";
/** The CONTINUOUS `"Item"` source — the CLASS control. A mirror that greyed a
    Stadium row off ANY bar is green on every barred-board line and RED here. */
const TYRANITAR = "sv09-095";
/** The STAMPED `"Item"` source (an attack rider) — §4's half. `StampedHandPlayClass`
    cannot NAME a Stadium, so a stamped bar must leave these rows lit. */
const GALVANTULA = "sv07-051";

/** Beach Court — an AUTHORED Stadium, so a refusal at its row is a RULE and never
    the coverage strategy. */
const STADIUM = "sv01-167";
/** Calamitous Wasteland — a SECOND authored Stadium with a DIFFERENT NAME, so §5
    can drive §7.3's once-per-turn allowance WITHOUT the same-name rule being the
    reason the second row is dead. */
const STADIUM_2 = "sv02-175";
/** An UNAUTHORED Stadium — the `TRAINER_NOT_SIMULATED` row, and the only way to
    show the projection still distinguishes NO ROW from a GREYED row now that
    Stadiums have rows at all. */
const STADIUM_UNBUILT = "fix-stadium";
/** Potion — a plain Item with a board precondition every fixture satisfies. */
const ITEM = "sv01-188";
/** Professor's Research — the Supporter control. */
const SUPPORTER = "sv01-189";

/** The CONTROL body: same board, same hands, NO Ability and NO attack rider. */
const PLAIN = "fix-plain-wire";
/** The victim's Active — 340 HP, so §4's swing cannot Knock it Out and park the
    board on `ko:takePrizes`, where every refusal below would be the PHASE gate
    wearing the rule's name. */
const WALL = "fix-wire-wall";
/** A {L} Basic Energy, so §4's Galvantula ex can pay its PRINTED cost. */
const LIGHTNING = "fix-wire-lightning";

const LOCAL_CARDS: Record<string, Card> = {
  [COPPERAJAH]: battler(COPPERAJAH, {
    name: "Copperajah",
    hp: 160,
    retreat: 3,
    types: ["Metal"],
    stage: "Stage1",
    evolveFrom: "Cufant",
    abilities: [{ type: "Ability", name: "Massive Body", effect: MASSIVE_BODY_TEXT }],
  }),
  [TYRANITAR]: battler(TYRANITAR, {
    name: "Tyranitar",
    hp: 180,
    retreat: 3,
    types: ["Darkness"],
    stage: "Stage2",
    abilities: [{ type: "Ability", name: "Daunting Gaze", effect: DAUNTING_GAZE_TEXT }],
  }),
  [GALVANTULA]: battler(GALVANTULA, {
    name: "Galvantula ex",
    hp: 260,
    retreat: 1,
    types: ["Lightning"],
    stage: "Basic",
    attacks: [
      { name: "Electro Web", cost: ["Lightning"], damage: "180", effect: GALVANTULA_TEXT },
    ],
  }),
  [PLAIN]: battler(PLAIN, {
    name: "Plain Blocker",
    hp: 200,
    retreat: 1,
    types: ["Colorless"],
    stage: "Stage1",
  }),
  [WALL]: battler(WALL, {
    name: "Wire Wall",
    hp: 340,
    retreat: 3,
    types: ["Colorless"],
    stage: "Basic",
  }),
  [LIGHTNING]: {
    ...(FIXTURE_POOL["fix-fire-energy"] as Card),
    id: LIGHTNING,
    name: "Lightning Energy",
  },
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

/** This suite's OWN seeded deck (D270's rule). ⚠️ Counts are deliberately above
    the legal four: this is a FIXTURE deck, and every named card is pulled OUT of
    the deck after a 13-card setup draw on four seeds from both seats. A deck that
    runs dry fails LOUDLY — a fixture bug wearing a rule's name. */
const WIRE_DECK = deckOf({
  [COPPERAJAH]: 4,
  [TYRANITAR]: 3,
  [GALVANTULA]: 3,
  [PLAIN]: 4,
  [WALL]: 4,
  [STADIUM]: 6,
  [STADIUM_2]: 5,
  [STADIUM_UNBUILT]: 5,
  [ITEM]: 5,
  [SUPPORTER]: 5,
  // ⚠️ THIRTEEN — this deck must total exactly 60 and the Basics are the slack
  // term. A thin Basic count also means MULLIGANS, whose `setupDrawExtra` drains
  // the very deck every `handFromDeck` below pulls from.
  "fix-basic-1": 13,
  [LIGHTNING]: 3,
});

/** Four seeds, so nothing below rests on one shuffle (D270). */
const SEEDS = [8311, 8317, 8329, 8353] as const;

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

function localSetup(seed: number, first: Seat): GameState {
  const created = createGame({ seed, decks: { p1: WIRE_DECK, p2: WIRE_DECK }, cardPool: POOL });
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

/** `barrier` holds `barrierId` Active; the VICTIM holds a 340 HP Wall. BOTH SEATS
    hold both Stadiums, the unbuilt Stadium, an Item and a Supporter, so a per-seat
    claim can be made on one board. ⚠️ THE BENCH BODY IS LOAD-BEARING — §14.2 makes
    an empty Bench a LOSS the moment the Active leaves, and a `gameOver` board
    proves nothing about a projection. ⚠️ BOTH SEATS ARE DAMAGED so Potion always
    has a legal target and a greyed Item row is only ever the rule under test. */
function board(seed: number, first: Seat, barrier: Seat, barrierId: string): GameState {
  let state = localSetup(seed, first);
  const victim = barrier === "p1" ? "p2" : "p1";
  state = setActiveFromDeck(state, barrier, barrierId);
  state = clearBench(state, barrier);
  state = benchFromDeck(state, barrier, "fix-basic-1");
  state = setActiveFromDeck(state, victim, WALL);
  state = clearBench(state, victim);
  state = benchFromDeck(state, victim, "fix-basic-1");
  state = attachFromDeck(state, barrier, LIGHTNING, 1);
  for (const seat of ["p1", "p2"] as const) {
    state = handFromDeck(state, seat, STADIUM, 1);
    state = handFromDeck(state, seat, STADIUM_2, 1);
    state = handFromDeck(state, seat, STADIUM_UNBUILT, 1);
    state = handFromDeck(state, seat, ITEM, 1);
    state = handFromDeck(state, seat, SUPPORTER, 1);
    state = setDamage(state, seat, 10);
  }
  return state;
}

/** Walk the clock so `seat` moves, at turn 3+ so §4's first-turn Supporter ban is
    spent. A bar and its absence are only observable on the barred seat's OWN turn. */
function turnOf(state: GameState, seat: Seat): GameState {
  let next = state;
  for (let i = 0; i < 12; i += 1) {
    if (next.phase.kind !== "turn:action") throw new Error(`stuck in ${next.phase.kind}`);
    if (next.phase.seat === seat && next.turn >= 3) return next;
    next = must(applyAction(next, { type: "endTurn", seat: next.phase.seat }));
  }
  throw new Error(`never reached ${seat}'s turn`);
}

function swing(state: GameState, seat: Seat): GameState {
  return must(applyAction(state, { type: "attack", seat, index: 0 }));
}

/** Play `cardId` from `seat`'s hand and report the ERROR CODE, or "OK". ⚠️ EVERY
    ORACLE ASSERTION BELOW GOES THROUGH THIS: a Stadium play has FIVE distinct ways
    to fail and four of them are not the bar, so a green "the engine refuses" read
    off `ok === false` could be any of them. */
function play(state: GameState, seat: Seat, cardId: string): string {
  const uid = handUid(state, seat, cardId);
  const result = applyAction(deepFreeze(state), { type: "playTrainer", seat, uid });
  return result.ok ? "OK" : result.error.code;
}

function playOk(state: GameState, seat: Seat, cardId: string): GameState {
  return must(applyAction(state, { type: "playTrainer", seat, uid: handUid(state, seat, cardId) }));
}

/** Every Trainer row the WIRE projection emits for `seat`, by card id. */
function wireTrainerIds(state: GameState, seat: Seat): string[] {
  const phase = redactGame(state, seat).phase;
  if (phase.kind !== "turn:action") throw new Error(`expected turn:action, got ${phase.kind}`);
  return phase.trainers.map((t) => state.cardIdByUid[t.uid] ?? "?");
}

/** The wire's own answer for a Trainer row, or `undefined` when the projection
    emits NO row for that card — the distinction §2 turns on. */
function wireDisabled(state: GameState, seat: Seat, cardId: string): boolean | undefined {
  const phase = redactGame(state, seat).phase;
  if (phase.kind !== "turn:action") throw new Error(`expected turn:action, got ${phase.kind}`);
  return phase.trainers.find((t) => t.uid === handUid(state, seat, cardId))?.disabled;
}

function wireRow(state: GameState, seat: Seat, cardId: string) {
  const phase = redactGame(state, seat).phase;
  if (phase.kind !== "turn:action") throw new Error(`expected turn:action, got ${phase.kind}`);
  return phase.trainers.find((t) => t.uid === handUid(state, seat, cardId));
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. THE DEAD GUARD, DECOMPOSED — why deleting the line moved nothing.
// ─────────────────────────────────────────────────────────────────────────────

describe("D288 §1 — the skipped line was DEAD CODE, and here is the arithmetic", () => {
  it("🛑 EVERY AUTHORED STADIUM HAS `program.stadium` AND NO `program.trainer`", () => {
    // THE MEASUREMENT BEHIND THE FINDING. `redactedTrainersOf` used to carry BOTH
    // `if (card.trainerType === "Stadium") continue;` AND, one line later,
    // `if (!isRareCandy && program.trainer === undefined) continue;`. The second
    // subsumes the first for every card in the catalog, which is why deleting the
    // first reddened nothing. Asserted as the DECOMPOSITION rather than as a
    // sentence, so a future Stadium authored with `trainer` ops fails HERE — and
    // that is exactly the day the two guards would stop agreeing.
    const stadiums = Object.values(POOL).filter(
      (c) => c.category === "Trainer" && c.trainerType === "Stadium",
    );
    expect(stadiums.length).toBe(8);
    expect(stadiums.filter((c) => programFor(c.id) !== undefined).length).toBe(7);
    expect(stadiums.filter((c) => programFor(c.id)?.stadium !== undefined).length).toBe(7);
    // 🛑 THE LOAD-BEARING ZERO — the whole reason the guard could be deleted with
    // no consequence, and the reason the mirror needed a DIFFERENT discriminant.
    expect(stadiums.filter((c) => programFor(c.id)?.trainer !== undefined).length).toBe(0);
    // ⚠️ THE ATTRIBUTION CONTROL: Items DO carry `trainer` ops, so the zero above
    // is a fact about Stadiums and not about how this walk reads a program.
    const items = Object.values(POOL).filter(
      (c) => c.category === "Trainer" && c.trainerType === "Item",
    );
    expect(items.filter((c) => programFor(c.id)?.trainer !== undefined).length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. THE ROW EXISTS — and NO ROW is still distinguishable from a GREYED row.
// ─────────────────────────────────────────────────────────────────────────────

describe("D288 §2 — the projection emits Stadium rows, and still withholds unbuilt ones", () => {
  it("🛑 AN AUTHORED STADIUM GETS A ROW; AN UNAUTHORED ONE STILL GETS NONE", () => {
    // The coverage strategy survives the widening: `TRAINER_NOT_SIMULATED` is not
    // a rule the player broke, so it must stay a MISSING row rather than become a
    // greyed one — the same treatment an unauthored Item gets. Without this line a
    // build that dropped the play-path check entirely would be green on every
    // other assertion in this file.
    for (const seed of SEEDS) {
      const free = turnOf(board(seed, "p1", "p1", PLAIN), "p2");
      expect(wireTrainerIds(free, "p2")).toContain(STADIUM);
      expect(wireTrainerIds(free, "p2")).toContain(STADIUM_2);
      expect(wireTrainerIds(free, "p2")).not.toContain(STADIUM_UNBUILT);
      expect(wireDisabled(free, "p2", STADIUM_UNBUILT)).toBeUndefined();
      // And the engine agrees about WHY it has no row.
      expect(play(free, "p2", STADIUM_UNBUILT)).toBe("TRAINER_NOT_SIMULATED");
    }
  });

  it("the row carries the four wire fields and NOTHING else — a diff PAIRED with a literal", () => {
    // D279's half-guard rule. `Object.keys` of a Stadium row against an Item row
    // catches "the Stadium row grew a field"; the literal list beside it catches
    // "every row grew one", which the diff alone cannot see.
    const free = turnOf(board(SEEDS[0], "p1", "p1", PLAIN), "p2");
    const stadium = wireRow(free, "p2", STADIUM);
    const item = wireRow(free, "p2", ITEM);
    if (stadium === undefined || item === undefined) throw new Error("expected both rows");
    expect(Object.keys(stadium).sort()).toEqual(Object.keys(item).sort());
    expect(Object.keys(stadium).sort()).toEqual(
      ["disabled", "name", "rareCandy", "reason", "uid"].sort(),
    );
    // A Stadium is not Rare Candy and has no printed clause to quote, so its
    // `reason` is null and its click dispatches `playTrainer` like any other row.
    expect(stadium.rareCandy).toBe(false);
    expect(stadium.reason).toBeNull();
    expect(stadium.name).toBe(POOL[STADIUM]?.name);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. THE ENGINE IS THE ORACLE — both directions, barred board AND free board.
// ─────────────────────────────────────────────────────────────────────────────

describe("D288 §3 — the wire row is greyed EXACTLY when the engine refuses", () => {
  it("🛑 THE BAR GREYS BOTH STADIUM ROWS, AND `applyAction` IS THE ORACLE", () => {
    // ⚠️ COMPARED AGAINST THE ACTION, NEVER AGAINST A LITERAL `true`/`false`. A
    // hard-coded expectation is green when BOTH the mirror and the gate are wrong
    // in the same direction, which is the only failure mode that matters here.
    for (const seed of SEEDS) {
      for (const barrierId of [COPPERAJAH, PLAIN]) {
        const open = turnOf(board(seed, "p1", "p1", barrierId), "p2");
        for (const stadiumId of [STADIUM, STADIUM_2]) {
          const refused = play(open, "p2", stadiumId) !== "OK";
          expect(wireDisabled(open, "p2", stadiumId), `${barrierId}/${stadiumId}`).toBe(refused);
        }
      }
    }
  });

  it("🛑 THE BARRING SEAT'S OWN ROWS STAY LIT — the bar is on the OPPONENT's hand", () => {
    // The same board, the other seat. A mirror reading the ability off the wrong
    // side of the table is green on every line above and red here.
    for (const seed of SEEDS) {
      const own = turnOf(board(seed, "p1", "p1", COPPERAJAH), "p1");
      expect(wireDisabled(own, "p1", STADIUM)).toBe(false);
      expect(play(own, "p1", STADIUM)).toBe("OK");
    }
  });

  it("🛑 AN ITEM BAR LEAVES STADIUM ROWS LIT — the CLASS control", () => {
    // Tyranitar's sentence is Copperajah's with one noun changed. A mirror that
    // greyed Stadium rows off `handPlayBarred(…, "Item", undefined)`, or off "is this seat
    // barred at all", passes §3.1 and fails here.
    for (const seed of SEEDS) {
      const items = turnOf(board(seed, "p1", "p1", TYRANITAR), "p2");
      expect(wireDisabled(items, "p2", STADIUM)).toBe(false);
      expect(wireDisabled(items, "p2", STADIUM_2)).toBe(false);
      expect(wireDisabled(items, "p2", ITEM)).toBe(true);
      expect(wireDisabled(items, "p2", SUPPORTER)).toBe(false);
      expect(play(items, "p2", STADIUM)).toBe("OK");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. THE STAMPED SOURCE CANNOT NAME A STADIUM — one funnel, two sources.
// ─────────────────────────────────────────────────────────────────────────────

describe("D288 §4 — a STAMPED Item bar greys Items and leaves Stadiums lit", () => {
  it("🛑 `StampedHandPlayClass` HAS NO `\"Stadium\"` MEMBER, DRIVEN OFF A REAL ATTACK", () => {
    // The mirror asks `handPlayBarred` — ONE funnel that consults BOTH the
    // continuous source and the turn-stamped one — rather than a fifth predicate
    // of its own. This drives the stamped half through a printed attack rider, so
    // the claim is about the shipped card and not about the type alone: a Stadium
    // row must come back LIT under a stamp that darkens every Item row.
    for (const seed of SEEDS) {
      const stamped = swing(turnOf(board(seed, "p1", "p1", GALVANTULA), "p1"), "p1");
      const open = turnOf(stamped, "p2");
      expect(wireDisabled(open, "p2", ITEM)).toBe(true);
      expect(handPlayBarred(open, "p2", "Item", undefined)).toBe(true);
      expect(handPlayBarred(open, "p2", "Stadium", undefined)).toBe(false);
      expect(wireDisabled(open, "p2", STADIUM)).toBe(false);
      expect(play(open, "p2", STADIUM)).toBe("OK");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. §7.3's OWN TWO MECHANICS ON THE WIRE — the allowance and the same name.
// ─────────────────────────────────────────────────────────────────────────────

describe("D288 §5 — the once-per-turn allowance and the same-name rule", () => {
  it("🛑 AFTER A STADIUM PLAY, EVERY STADIUM ROW GOES DARK — §7.3's allowance", () => {
    // ⚠️ TWO DIFFERENT NAMES, ON PURPOSE: with only one Stadium in hand this line
    // would be green under the same-name rule alone and would say nothing about
    // the allowance. `STADIUM_2` is a different card with a different name, so the
    // only thing that can be darkening it is `allowances.stadiumPlayed`.
    for (const seed of SEEDS) {
      const open = turnOf(board(seed, "p1", "p1", PLAIN), "p2");
      expect(wireDisabled(open, "p2", STADIUM_2)).toBe(false);
      const after = playOk(open, "p2", STADIUM);
      expect(after.allowances.stadiumPlayed).toBe(true);
      expect(wireDisabled(after, "p2", STADIUM_2)).toBe(true);
      expect(play(after, "p2", STADIUM_2)).toBe("STADIUM_ALREADY_PLAYED");
      // The ITEM row is untouched — an allowance for Stadiums, not a turn-wide one.
      expect(wireDisabled(after, "p2", ITEM)).toBe(false);
    }
  });

  it("🛑 THE SAME NAME CANNOT REPLACE ITSELF, AND THE WIRE READS THE NAME", () => {
    // The occupant is put in play by p2 and the row is read on p1's NEXT turn, so
    // `allowances.stadiumPlayed` has reset and the ONLY live refusal is the name.
    // ⚠️ THIS IS THE TERM THAT WOULD HAVE FORCED A SCHEMA CHANGE IF THE PROJECTION
    // COULD NOT SEE IT — it needs the shared zone's occupant NAME, which the state
    // already carries, so the row stayed a DERIVED READ with no new field.
    for (const seed of SEEDS) {
      const open = turnOf(board(seed, "p1", "p1", PLAIN), "p2");
      const occupied = playOk(open, "p2", STADIUM);
      const next = turnOf(occupied, "p1");
      expect(next.allowances.stadiumPlayed).toBe(false);
      expect(wireDisabled(next, "p1", STADIUM)).toBe(true);
      expect(play(next, "p1", STADIUM)).toBe("STADIUM_SAME_NAME");
      // The DIFFERENT-named Stadium is lit on the same board — so the greying
      // above is the NAME and not "a Stadium is in play".
      expect(wireDisabled(next, "p1", STADIUM_2)).toBe(false);
      expect(play(next, "p1", STADIUM_2)).toBe("OK");
    }
  });

  it("the bar is ordered ABOVE §7.3's mechanics — a barred seat is barred, not 'already played'", () => {
    // `playStadium` asks `handPlayBarred` FIRST, above both mechanics and above
    // the coverage strategy, so a barred seat is never told about an allowance it
    // was never allowed to spend. The wire folds all three into ONE boolean, so
    // this asserts the ENGINE's ordering beside the wire's agreement.
    for (const seed of SEEDS) {
      const barred = turnOf(board(seed, "p1", "p1", COPPERAJAH), "p2");
      expect(play(barred, "p2", STADIUM_UNBUILT)).toBe("HAND_PLAY_BLOCKED");
      expect(wireDisabled(barred, "p2", STADIUM)).toBe(true);
      expect(play(barred, "p2", STADIUM)).toBe("HAND_PLAY_BLOCKED");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. THE OPPONENT AND THE SPECTATOR — the widening leaks nothing.
// ─────────────────────────────────────────────────────────────────────────────

describe("D288 §6 — the new rows reach ONLY the acting viewer", () => {
  it("🛑 THE NON-ACTING VIEWER AND THE SPECTATOR SEE NO TRAINER ROWS AT ALL", () => {
    // A Stadium row names a card in a HAND, so the actor gate is the hidden-info
    // barrier for it exactly as for every other row. Asserted for the widening
    // rather than assumed from the gate, because a new row type is precisely the
    // thing a field-by-field decision could miss.
    for (const seed of SEEDS) {
      const open = turnOf(board(seed, "p1", "p1", PLAIN), "p2");
      const opponent = redactGame(open, "p1").phase;
      if (opponent.kind !== "turn:action") throw new Error("expected turn:action");
      expect(opponent.trainers).toEqual([]);
      const spectator = redactGame(open, "p2", true).phase;
      if (spectator.kind !== "turn:action") throw new Error("expected turn:action");
      expect(spectator.trainers).toEqual([]);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. MATCH_RECORD_VERSION — 16, UNCHANGED, DRIVEN BOTH WAYS ON BOTH BOARDS.
// ─────────────────────────────────────────────────────────────────────────────

describe("D288 §7 — the version does NOT move, and the claim is driven", () => {
  it("🛑 A v16 RECORD ANSWERS THE NEW QUESTION — a PROJECTION, not a persisted byte", () => {
    // ⚠️ THE STANDING TEST (match.ts): *can the PREVIOUS deploy's RECORD hold the
    // new TYPE*. This slice adds no `GameState` field, no key on an existing one,
    // no `EffectOp`, no event and no rename — it adds ROWS TO A PROJECTION that is
    // rebuilt from the record on every read. So a v16 record resumed under this
    // deploy produces the new rows without migration, which is what "no bump" has
    // to MEAN. 🛑 **THE FAILURE MODE IS A SILENT WRONG ANSWER, NOT A THROW** —
    // hence the assertion is the ROW'S FLAG after the round trip, not "it parsed".
    for (const seed of SEEDS) {
      const barred = turnOf(board(seed, "p1", "p1", COPPERAJAH), "p2");
      const reloaded = JSON.parse(JSON.stringify(barred)) as GameState;
      expect(wireTrainerIds(reloaded, "p2")).toContain(STADIUM);
      expect(wireDisabled(reloaded, "p2", STADIUM)).toBe(true);
      expect(play(reloaded, "p2", STADIUM)).toBe("HAND_PLAY_BLOCKED");
      // 🛑 AND THE OTHER DIRECTION — a record written with NO bar must reload as no
      // bar, so the round trip cannot be passing because everything reloads dark.
      const free = turnOf(board(seed, "p1", "p1", PLAIN), "p2");
      const freeReloaded = JSON.parse(JSON.stringify(free)) as GameState;
      expect(wireTrainerIds(freeReloaded, "p2")).toContain(STADIUM);
      expect(wireDisabled(freeReloaded, "p2", STADIUM)).toBe(false);
      expect(play(freeReloaded, "p2", STADIUM)).toBe("OK");
    }
  });

  it("🛑 NOTHING PERSISTED MOVED — the diff, PAIRED with the literal key anchors", () => {
    // The lists D285 installed and D287 re-asserted, UNCHANGED. A projection
    // slice's whole version claim is that these do not move.
    const barred = turnOf(board(SEEDS[0], "p1", "p1", COPPERAJAH), "p2");
    const free = turnOf(board(SEEDS[0], "p1", "p1", PLAIN), "p2");
    expect(Object.keys(barred).sort()).toEqual(Object.keys(free).sort());
    expect(Object.keys(barred).sort()).toEqual(
      [
        "allowances",
        "cardIdByUid",
        "cardPool",
        "firstPlayer",
        "handPlayLockedTurn",
        "lastKoMarks",
        "lastKoTurn",
        "oncePerGameSpent",
        "pending",
        "phase",
        "players",
        "rngState",
        "stadium",
        "turn",
      ].sort(),
    );
    for (const seat of ["p1", "p2"] as const) {
      expect(Object.keys(barred.handPlayLockedTurn[seat]).sort()).toEqual(
        ["Item", "Supporter", "evolve"].sort(),
      );
    }
    // And the wire phase's own key list — the surface this slice DID change, whose
    // shape it did not.
    const phase = redactGame(barred, "p2").phase;
    expect(Object.keys(phase).sort()).toEqual(
      [
        "abilities",
        "attacks",
        "kind",
        "rareCandy",
        "retreat",
        "stadiumAbility",
        "trainers",
      ].sort(),
    );
  });
});
