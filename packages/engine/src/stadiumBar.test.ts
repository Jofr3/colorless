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

// D287 — THE STADIUM HALF OF THE IMPOSED HAND-PLAY LOCK, AND THE LAST
// TRAINER-SURFACE ROW OF D284's SEVEN-SENTENCE CENSUS.
//
// THE SENTENCE. One printing, one sentence, and it is `DAUNTING_GAZE`'s body
// with a single noun changed:
//
//   "As long as this Pokémon is in the Active Spot, your opponent can't play any
//    Stadium cards from their hand."
//        — Copperajah `sv06.5-042` "Massive Body", 1 legal printing.
//
// ── THE CENSUS, RE-DERIVED RATHER THAN INHERITED ────────────────────────────
//
// 🛑 **THE ROW ARRIVED WITH A CENSUS CLAIM ATTACHED THAT NO PROCESS HAD EVER
// RUN.** An agent died mid-slice having half-built this row; its patch asserted
// a D1 measurement (`abilities_json` 1 / `attacks_json` 0 / `effect` 0) and
// D286 excised the row without verifying it. **A MEASUREMENT WRITTEN BY A
// PROCESS THAT DIED IS A GUESS**, so it was re-run here — and re-run against the
// MECHANISM rather than against the sentence, which is D283's lesson spent
// instead of repeated. Remote D1 `luminous`
// (`735f0fb5-cdc3-494d-8b97-74a8ade0124a`), 2026-08-08, `legal_standard = 1`,
// one row of `SUM(instr(col,…)>0)` per column (D283's compound-SELECT limit):
//
//     predicate                                     ability  attack  effect
//     instr(col, "any Stadium cards")                   1       0       0
//     instr(col, "Stadium cards from their hand")       1       0       0
//     instr(col, "play any Stadium")                    1       0       0
//     "Stadium" AND "can't play" in the same column     1       0       —
//
// ✅ **THE GUESS WAS RIGHT, AND IT IS NOW A MEASUREMENT.** Every rung of the
// ladder returns the same 1/0/0, so the widening is not an artefact of one
// lucky substring. UNFILTERED BY LEGALITY the catalog holds **exactly one row**
// (`instr(abilities_json,'play any Stadium')>0` → `sv06.5-042`, Copperajah,
// `legal_standard = 1`), so there is **no reprint** and no non-Standard twin.
//
// 🛑 **THE ATTACK COLUMN'S ZERO IS THE LOAD-BEARING NUMBER, NOT THE ABILITY
// COLUMN'S ONE.** It is what keeps `"Stadium"` out of `StampedHandPlayClass`,
// and therefore out of `GameState.handPlayLockedTurn`, and therefore out of
// `MATCH_RECORD_VERSION` — §7 drives that consequence rather than asserting it.
//
// ⚠️ **AND THE BARRED SIDE WAS QUERIED TOO** (D286's rule: query both sides of
// an interaction, not just the side that carries the sentence). **26 legal
// Stadium printings under 19 distinct names.** Unlike D286's Rare Candy — whose
// four printings are all non-Standard, so the barred card and the barring card
// could not meet on a legal board — this bar has a large real population and the
// interaction is live.
//
// ── WHAT THE SLICE COST, AND WHY IT IS ONE LINE ─────────────────────────────
//
// D284 refused this printing and its refusal note named the reason BY LINE:
// *"the CLASS is spellable (`"Stadium"` IS a `Card.trainerType`); the READ is
// not. `playTrainer` hands a Stadium to `playStadium` on the line ABOVE this
// gate."* **A REFUSAL WHOSE STATED REASON NAMES A LINE IS THE CHEAPEST KIND TO
// CASH.** `playStadium` is the one of the engine's FOUR hand-Trainer play paths
// that did not ask `handPlayBarred` (the others: `playTrainer`'s Item/Supporter
// branch, `attachTool`, `rareCandy`), and there is no fifth — re-grepped at
// HEAD rather than inherited from D286's proof: the only other actions that
// consume a card from `side.hand` are `attachEnergy` (an Energy card) and
// `evolve` / the Basic placement path (a Pokémon card), neither of which is a
// Trainer at all.
//
// So: ONE gate inside `playStadium`, ONE new `HandPlayClass` member, ZERO lines
// in `handPlayBarred`, ZERO new `EffectOp`s, ZERO new `ErrorCode`s
// (`HAND_PLAY_BLOCKED` is REUSED), ZERO new events, ZERO new `GameState` fields
// and ZERO `MATCH_RECORD_VERSION` movement.
//
// 🛑 **THE COMPILER ASKED THE VERSION QUESTION FIRST.** Widening the union made
// `stampedBarFor` (types.ts) the ONLY `tsc -b` error on the tree — *`'"Stadium"'
// is not assignable to 'StampedPlayLockKey'`* — which is exactly the seam D284
// paid for. ⚠️ **IT IS ONE LINE, NOT THREE CALL SITES**: the error prints three
// times because three projects build that file, and a count read off the
// console rather than off the code would have priced the seam at 3x.
//
// ── WHAT IS STILL REFUSED, WITH THE MISSING MECHANISM NAMED ─────────────────
//
//   • ✅ ~~A STADIUM PAYABILITY MIRROR ON THE WIRE~~ — **CLOSED BY D288**, and §6
//     is now the INVERSE of what D287 wrote there. `redactedTrainersOf` emits the
//     Stadium row and greys it off the same `handPlayBarred` funnel; the full
//     mirror (§7.3's own two mechanics, the coverage strategy, the engine as
//     oracle) is `stadiumWireMirror.test.ts`. ⚠️ **D287's ROUTE TO IT WAS WRONG**:
//     deleting its `if (card.trainerType === "Stadium") continue;` reddens NOTHING
//     — every authored Stadium is `{stadium: …}` with `trainer` undefined, so the
//     line below it already skipped all 8 and the guard was DEAD CODE.
//   • **AN ENGINE-SIDE ACE SPEC CLASSIFIER.** Genesect `sv06.5-040` is the last
//     survivor of D284's seven, and it can never become a fifth `HandPlayClass`
//     member: `HandPlayClass` is now EXACTLY `Card.trainerType`, and ACE SPEC is
//     a RARITY axis orthogonal to it.
//
// ── THE HAZARDS THIS SUITE IS SHAPED AROUND ────────────────────────────────
//
// 🛑 **THE ORDER OF THE GATE IS A CLAIM AND NOT A DETAIL.** The bar sits ABOVE
// §7.3's own mechanics (the once-per-turn allowance, the same-name rule) and
// above "is it simulated", because those are facts about the ZONE rather than
// rules the player broke — a barred seat should not learn "only one Stadium play
// per turn" about a play the rules never let it attempt. §4 drives all three
// orderings by ERROR CODE, which is the only thing that can tell them apart: a
// build with the gate one line lower is green on every "the play is refused"
// assertion in §2.
//
// ⚠️ **EVERY REFUSAL IS READ AS A CODE, NEVER AS `ok === false`.** A Stadium
// play has five distinct ways to fail and four of them are not this rule.
//
// ⚠️ **THE CONTROL BODY IS THE POINT OF THE FILE.** Every "the bar bites" line
// below passes just as happily on a build that refused every Stadium play; only
// `PLAIN` on the same board with the same hands can tell them apart.

const MASSIVE_BODY_TEXT =
  "As long as this Pokémon is in the Active Spot, your opponent can't play any Stadium cards from their hand.";
const DAUNTING_GAZE_TEXT =
  "As long as this Pokémon is in the Active Spot, your opponent can't play any Item cards from their hand.";
/** The STAMPED Item lock's printed rider — §5's proof that the stamp cannot
    name a Stadium is driven off a real attack, not off the type alone. */
const ITEM_LOCK_TEXT =
  "During your opponent's next turn, they can't play any Item cards from their hand.";
const GALVANTULA_TEXT = `Discard all Energy from this Pokémon. ${ITEM_LOCK_TEXT}`;

/** The CONTINUOUS `"Stadium"` source, and the whole of this slice. */
const COPPERAJAH = "sv06.5-042";
/** The CONTINUOUS `"Item"` source — the CLASS control. Tyranitar's sentence is
    this one with a different noun, so a build that collapsed the class list to
    "any Trainer" is green on §2 and RED on §3. */
const TYRANITAR = "sv09-095";
/** The STAMPED `"Item"` source (an attack rider) — §5's other half. */
const GALVANTULA = "sv07-051";
/** Ting-Lu ex "Cursed Land" — the §9 ability lock, and the one body in this pool
    that can reach a Stage 2. ⚠️ IT EXEMPTS POKÉMON ex; Copperajah is not one. */
const TING_LU = "sv02-127";

/** Beach Court — an AUTHORED Stadium, so a refusal at its row can only ever be a
    RULE and never the coverage strategy. */
const STADIUM = "sv01-167";
/** Calamitous Wasteland — a SECOND authored Stadium with a DIFFERENT name, so
    §4 can drive §7.3's once-per-turn allowance without §7.3's same-name rule
    being the reason the second play fails. */
const STADIUM_2 = "sv02-175";
/** An UNAUTHORED Stadium — the `TRAINER_NOT_SIMULATED` row, and the ONLY way to
    show that the bar is ordered ABOVE the coverage strategy. */
const STADIUM_UNBUILT = "fix-stadium";
/** Potion — a plain Item with a board precondition every fixture satisfies. */
const ITEM = "sv01-188";
/** Professor's Research — the Supporter control. */
const SUPPORTER = "sv01-189";

/** The CONTROL body: same board, same hands, NO Ability and NO attack rider. */
const PLAIN = "fix-plain-stadium";
/** The victim's Active — 340 HP, so Galvantula ex's swing in §5 cannot Knock it
    Out and park the board on `ko:takePrizes`, where every refusal below would be
    green at the PHASE gate instead of at the rule under test. */
const WALL = "fix-stadium-wall";
/** A {L} Basic Energy, so §5's Galvantula ex can pay its PRINTED cost. */
const LIGHTNING = "fix-stadium-lightning";

// ── the local pool (FIXTURE_POOL is left untouched — D190's idiom) ───────────

/** Copperajah `sv06.5-042`, carrying the catalog's own HP/type/stage. The id is
    REAL, so `programFor` resolves the shipped `MASSIVE_BODY` row rather than a
    stand-in. ⚠️ NO ATTACKS — this body never swings, and an attack would give
    every refusal below a second possible explanation. */
function copperajah(id: string): Card {
  return battler(id, {
    name: "Copperajah",
    hp: 160,
    retreat: 3,
    types: ["Metal"],
    stage: "Stage1",
    evolveFrom: "Cufant",
    abilities: [{ type: "Ability", name: "Massive Body", effect: MASSIVE_BODY_TEXT }],
  });
}

function tyranitar(id: string): Card {
  return battler(id, {
    name: "Tyranitar",
    hp: 180,
    retreat: 3,
    types: ["Darkness"],
    stage: "Stage2",
    abilities: [{ type: "Ability", name: "Daunting Gaze", effect: DAUNTING_GAZE_TEXT }],
  });
}

function galvantula(id: string): Card {
  return battler(id, {
    name: "Galvantula ex",
    hp: 260,
    retreat: 1,
    types: ["Lightning"],
    stage: "Basic",
    attacks: [
      { name: "Electro Web", cost: ["Lightning"], damage: "180", effect: GALVANTULA_TEXT },
    ],
  });
}

const LOCAL_CARDS: Record<string, Card> = {
  [COPPERAJAH]: copperajah(COPPERAJAH),
  [TYRANITAR]: tyranitar(TYRANITAR),
  [GALVANTULA]: galvantula(GALVANTULA),
  [PLAIN]: battler(PLAIN, {
    name: "Plain Blocker",
    hp: 200,
    retreat: 1,
    types: ["Colorless"],
    stage: "Stage1",
  }),
  [WALL]: battler(WALL, {
    name: "Stadium Wall",
    hp: 340,
    retreat: 3,
    types: ["Colorless"],
    stage: "Basic",
  }),
  /** A {L} Basic Energy — the shared `fix-energy` provides Colorless only, and
      Galvantula ex's printed cost is `{L}`. Written as a local card rather than
      by relaxing the cost, so §5's stamp comes off the PRINTED attack. */
  [LIGHTNING]: {
    ...(FIXTURE_POOL["fix-fire-energy"] as Card),
    id: LIGHTNING,
    name: "Lightning Energy",
  },
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

/** This suite's own seeded deck (D270's rule). ⚠️ BOTH STADIUMS AND THE UNBUILT
    ONE ARE IN IT — `handFromDeck` pulls from the deck, so a Stadium named only
    in §1's catalog check would be untestable on a board. */
const STADIUM_DECK = deckOf({
  [COPPERAJAH]: 4,
  [TYRANITAR]: 3,
  [GALVANTULA]: 3,
  [PLAIN]: 4,
  [WALL]: 4,
  [TING_LU]: 3,
  // ⚠️ FIVE AND SIX RATHER THAN THE PLAYABLE FOUR: this is a FIXTURE deck, not a
  // legal decklist, and every one of these is pulled out of the DECK after a
  // 13-card setup draw on four seeds from both seats. At three copies the pull
  // genuinely ran dry, which fails LOUDLY — a fixture bug wearing a rule's name.
  [STADIUM]: 6,
  [STADIUM_2]: 5,
  [STADIUM_UNBUILT]: 5,
  [ITEM]: 5,
  [SUPPORTER]: 5,
  // ⚠️ TWELVE `fix-basic-1` — this deck's other Basics are all fixtures a board
  // pulls out of the deck by name, so a thin Basic count means MULLIGANS, and a
  // mulligan's `setupDrawExtra` drains the very deck every `handFromDeck` below
  // reads from. A deck that runs dry fails LOUDLY here and would be a fixture
  // bug wearing a rule's name.
  "fix-basic-1": 10,
  [LIGHTNING]: 3,
});

/** Four seeds, so nothing below rests on one shuffle (D270). */
const SEEDS = [7211, 7219, 7229, 7237] as const;

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

/** D275's `localSetup` with the FIRST PLAYER as a PARAMETER — a one-seat board is
    vacuous on a per-seat fact, and "whose hand is barred" is exactly one. */
function localSetup(seed: number, first: Seat): GameState {
  const created = createGame({ seed, decks: { p1: STADIUM_DECK, p2: STADIUM_DECK }, cardPool: POOL });
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

/** `barrier` holds `barrierId` in the ACTIVE SPOT; the VICTIM holds a 340 HP
    Wall. **BOTH SEATS HOLD BOTH STADIUMS, THE UNBUILT STADIUM, AN ITEM AND A
    SUPPORTER** — the symmetry is what lets §2 assert that the BARRING seat's own
    hand stays free on the very board that refuses the victim's.
    ⚠️ THE BENCH BODY IS LOAD-BEARING — §14.2 makes an empty Bench a LOSS the
    moment the Active leaves, and a `gameOver` board proves nothing about a bar.
    ⚠️ BOTH SEATS ARE DAMAGED so Potion always has a legal target and a refusal at
    the Item row can only ever be the rule under test. */
function board(seed: number, first: Seat, barrier: Seat, barrierId: string): GameState {
  let state = localSetup(seed, first);
  const victim = barrier === "p1" ? "p2" : "p1";
  state = setActiveFromDeck(state, barrier, barrierId);
  state = clearBench(state, barrier);
  state = benchFromDeck(state, barrier, "fix-basic-1");
  state = setActiveFromDeck(state, victim, WALL);
  state = clearBench(state, victim);
  state = benchFromDeck(state, victim, "fix-basic-1");
  // §5's swing needs a paid cost; harmless on every other barrier body, and
  // attached to the BARRIER so the victim's board is identical on all of them.
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

/** Walk the clock so `seat` is the one to move, at turn 3 or later so §4's
    first-turn Supporter ban is spent. Both a bar and its absence are only
    observable on the barred player's OWN turn — every other refusal below would
    be the phase gate wearing the rule's name. */
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
    ASSERTION IN §2–§5 GOES THROUGH THIS: a Stadium play has five distinct ways
    to fail and four of them are not this rule, so a green "the bar refuses" line
    read off `ok === false` could be any of them. */
function play(state: GameState, seat: Seat, cardId: string): string {
  const uid = handUid(state, seat, cardId);
  const result = applyAction(deepFreeze(state), { type: "playTrainer", seat, uid });
  return result.ok ? "OK" : result.error.code;
}

/** Play `cardId` for real (the caller asserts it succeeded) — §4 needs a Stadium
    actually IN the zone before the same-name and once-per-turn rules exist. */
function playOk(state: GameState, seat: Seat, cardId: string): GameState {
  return must(applyAction(state, { type: "playTrainer", seat, uid: handUid(state, seat, cardId) }));
}

/** Every Trainer row the WIRE projection emits for `seat`, by card id. */
function wireTrainerIds(state: GameState, seat: Seat): string[] {
  const phase = redactGame(state, seat).phase;
  if (phase.kind !== "turn:action") throw new Error(`expected turn:action, got ${phase.kind}`);
  return phase.trainers.map((t) => state.cardIdByUid[t.uid] ?? "?");
}

/** The wire projection's own answer for a Trainer row, or `undefined` when the
    projection emits no row for that card at all — the distinction §6 turns on. */
function wireDisabled(state: GameState, seat: Seat, cardId: string): boolean | undefined {
  const phase = redactGame(state, seat).phase;
  if (phase.kind !== "turn:action") throw new Error(`expected turn:action, got ${phase.kind}`);
  return phase.trainers.find((t) => t.uid === handUid(state, seat, cardId))?.disabled;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. THE CATALOG — one sentence, one printing, and the two claims about it.
// ─────────────────────────────────────────────────────────────────────────────

describe("D287 §1 — the printing, the class list, and the census that priced it", () => {
  it("the fixture carries the PRINTED sentence byte for byte", () => {
    // D284's rule: a claim that lives only in a comment cannot go red. A fixture
    // that drifted from the catalog would be testing a card nobody printed.
    expect(POOL[COPPERAJAH]?.abilities?.[0]?.effect).toBe(MASSIVE_BODY_TEXT);
    expect(MASSIVE_BODY_TEXT.startsWith("As long as this Pokémon is in the Active Spot,")).toBe(
      true,
    );
    // 🛑 AND IT IS `DAUNTING_GAZE` WITH ONE NOUN CHANGED — asserted, because that
    // is the entire argument for reusing `preventOpponentHandPlay` rather than
    // inventing a field. Replace "Stadium" with "Item" and the two are identical.
    expect(MASSIVE_BODY_TEXT.replace("Stadium", "Item")).toBe(DAUNTING_GAZE_TEXT);
  });

  it("🛑 THE CLASS LIST IS THE PRINTED ONE, AND THE THREE SENTENCES STAY DISJOINT", () => {
    expect(programFor(COPPERAJAH)?.passive?.preventOpponentHandPlay).toEqual(["Stadium"]);
    // The disjointness is the claim, not the presence. A build that widened every
    // row's list to all four classes is green on every "the bar bites" line in
    // this file and RED on these three.
    expect(programFor(TYRANITAR)?.passive?.preventOpponentHandPlay).toEqual(["Item"]);
    expect(programFor("sv10.5w-045")?.passive?.preventOpponentHandPlay).toEqual(["Item", "Tool"]);
    expect(programFor(COPPERAJAH)).not.toBe(programFor(TYRANITAR));
    // A SINGLETON — no reprint shares this program, measured at the catalog (the
    // whole D1 holds exactly one row for this sentence at any legality).
    expect(programFor(COPPERAJAH)?.passive?.preventOpponentPokemonPlay).toBeUndefined();
  });

  it("🛑 `\"Stadium\"` IS A `HandPlayClass` AND *NOT* A `StampedHandPlayClass` — the seam", () => {
    // The type says so and tsc enforces it; what a TEST can drive is the
    // CONSEQUENCE, which is that the persisted record has no key for it. §7
    // drives the round trip; this is the literal anchor beside it.
    const state = turnOf(board(SEEDS[0], "p1", "p1", COPPERAJAH), "p2");
    expect(Object.keys(state.handPlayLockedTurn.p2).sort()).toEqual(
      ["Item", "Supporter", "evolve"].sort(),
    );
    expect(Object.keys(state.handPlayLockedTurn.p2)).not.toContain("Stadium");
    // ⚠️ AND THE READER ANSWERS ANYWAY, rather than throwing or returning
    // `undefined` — `stampedBarFor` turns the class away by the TYPE and the
    // honest answer is "no stamp". The CONTINUOUS half is what says `true` here.
    expect(handPlayBarred(state, "p2", "Stadium", undefined)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. THE ENGINE GATE — the play is refused, and only for the barred seat.
// ─────────────────────────────────────────────────────────────────────────────

describe("D287 §2 — `playStadium` asks `handPlayBarred`, and the CONTROL says so", () => {
  it("🛑 THE BARRED SEAT CANNOT PLAY A STADIUM AND THE CONTROL BOARD CAN", () => {
    // The whole slice in two lines, on four seeds and from both seats. Without
    // the PLAIN half every line here is green on a build that refused every
    // Stadium play outright.
    for (const seed of SEEDS) {
      for (const first of ["p1", "p2"] as const) {
        const barred = turnOf(board(seed, first, "p1", COPPERAJAH), "p2");
        expect(play(barred, "p2", STADIUM), `${seed}/${first}`).toBe("HAND_PLAY_BLOCKED");
        const free = turnOf(board(seed, first, "p1", PLAIN), "p2");
        expect(play(free, "p2", STADIUM), `${seed}/${first} control`).toBe("OK");
      }
    }
  });

  it("🛑 THE BARRING SEAT'S OWN HAND IS FREE — *\"your opponent\"*, on one board", () => {
    // The sentence is printed on the holder and names the OTHER seat. A build
    // that barred both seats (or the wrong one) is green on every line above.
    for (const seed of SEEDS) {
      const state = board(seed, "p1", "p1", COPPERAJAH);
      expect(play(turnOf(state, "p2"), "p2", STADIUM)).toBe("HAND_PLAY_BLOCKED");
      expect(play(turnOf(state, "p1"), "p1", STADIUM)).toBe("OK");
    }
  });

  it("the bar is READ FROM THE ACTIVE SPOT — a benched Copperajah bars nothing", () => {
    // *"As long as this Pokémon is in the Active Spot"* — the clause that
    // collapses the holder loop to ONE read. A build that scanned the whole
    // board is green on §2's first line and RED here.
    for (const seed of SEEDS) {
      let state = board(seed, "p1", "p1", PLAIN);
      state = clearBench(state, "p1");
      state = benchFromDeck(state, "p1", COPPERAJAH);
      state = turnOf(state, "p2");
      expect(handPlayBarred(state, "p2", "Stadium", undefined)).toBe(false);
      expect(play(state, "p2", STADIUM)).toBe("OK");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. THE CLASS — Stadium only, and the other three classes are untouched.
// ─────────────────────────────────────────────────────────────────────────────

describe("D287 §3 — the class list is honoured in BOTH directions", () => {
  it("🛑 COPPERAJAH BARS STADIUMS AND NOT ITEMS OR SUPPORTERS", () => {
    for (const seed of SEEDS) {
      const state = turnOf(board(seed, "p1", "p1", COPPERAJAH), "p2");
      expect(play(state, "p2", STADIUM)).toBe("HAND_PLAY_BLOCKED");
      expect(play(state, "p2", ITEM)).toBe("OK");
      expect(play(state, "p2", SUPPORTER)).toBe("OK");
      expect(handPlayBarred(state, "p2", "Stadium", undefined)).toBe(true);
      expect(handPlayBarred(state, "p2", "Item", undefined)).toBe(false);
      expect(handPlayBarred(state, "p2", "Supporter", undefined)).toBe(false);
      expect(handPlayBarred(state, "p2", "Tool", undefined)).toBe(false);
    }
  });

  it("🛑 AND TYRANITAR BARS ITEMS AND NOT STADIUMS — the same board, inverted", () => {
    // The ATTRIBUTION CONTROL for the whole file. This is the pre-existing
    // sentence on the pre-existing gate; if the new `playStadium` gate had been
    // written as an unconditional refusal, or the class list collapsed to "any
    // Trainer", this line goes red and §2's does not.
    for (const seed of SEEDS) {
      const state = turnOf(board(seed, "p1", "p1", TYRANITAR), "p2");
      expect(play(state, "p2", ITEM)).toBe("HAND_PLAY_BLOCKED");
      expect(play(state, "p2", STADIUM)).toBe("OK");
      expect(handPlayBarred(state, "p2", "Stadium", undefined)).toBe(false);
      expect(handPlayBarred(state, "p2", "Item", undefined)).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. THE ORDER — the bar outranks all three of §7.3's own answers.
// ─────────────────────────────────────────────────────────────────────────────

describe("D287 §4 — the gate's PLACEMENT, driven by error code", () => {
  it("🛑 THE BAR OUTRANKS THE COVERAGE STRATEGY — an UNBUILT Stadium says the bar", () => {
    // A build with the gate one line lower answers `TRAINER_NOT_SIMULATED` here
    // and is green on every assertion in §2 and §3. The barred seat is told the
    // rule it is actually under, not a fact about this simulator's coverage.
    for (const seed of SEEDS) {
      const barred = turnOf(board(seed, "p1", "p1", COPPERAJAH), "p2");
      expect(play(barred, "p2", STADIUM_UNBUILT)).toBe("HAND_PLAY_BLOCKED");
      // …and with no bar, the coverage strategy is still what answers.
      const free = turnOf(board(seed, "p1", "p1", PLAIN), "p2");
      expect(play(free, "p2", STADIUM_UNBUILT)).toBe("TRAINER_NOT_SIMULATED");
    }
  });

  it("🛑 THE BAR OUTRANKS §7.3's ONCE-PER-TURN ALLOWANCE", () => {
    // A barred seat should not learn "only one Stadium play per turn" about a
    // play the rules never let it attempt. Driven on a board where the allowance
    // is GENUINELY SPENT, so both codes are live answers.
    for (const seed of SEEDS) {
      const free = playOk(turnOf(board(seed, "p1", "p1", PLAIN), "p2"), "p2", STADIUM);
      expect(free.allowances.stadiumPlayed).toBe(true);
      expect(play(free, "p2", STADIUM_2)).toBe("STADIUM_ALREADY_PLAYED");
      // The same spent allowance, under the bar: the bar answers first.
      const barred = turnOf(board(seed, "p1", "p1", COPPERAJAH), "p2");
      const spent = { ...barred, allowances: { ...barred.allowances, stadiumPlayed: true } };
      expect(play(spent, "p2", STADIUM_2)).toBe("HAND_PLAY_BLOCKED");
    }
  });

  it("🛑 THE BAR OUTRANKS §7.3's SAME-NAME RULE", () => {
    // The third of the three, and the one that needs a Stadium actually IN the
    // shared zone — put there by the BARRING seat, which is the only seat that
    // can still play one.
    for (const seed of SEEDS) {
      const withZone = playOk(turnOf(board(seed, "p1", "p1", COPPERAJAH), "p1"), "p1", STADIUM);
      expect(withZone.stadium).not.toBeNull();
      const barred = turnOf(withZone, "p2");
      expect(play(barred, "p2", STADIUM)).toBe("HAND_PLAY_BLOCKED");
      // …and the same zone with no bar answers the same-name rule instead.
      const openZone = playOk(turnOf(board(seed, "p1", "p1", PLAIN), "p1"), "p1", STADIUM);
      expect(play(turnOf(openZone, "p2"), "p2", STADIUM)).toBe("STADIUM_SAME_NAME");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. THE SOURCES — §9 takes the bar down, and the STAMP can never put it up.
// ─────────────────────────────────────────────────────────────────────────────

describe("D287 §5 — one funnel, two sources, and only one of them can name a Stadium", () => {
  it("§9 — Ting-Lu ex's ability lock takes the bar down and the Stadium lands", () => {
    // §9-suppressible per SOURCE, like every other printing of this field: the
    // bar is a printed Pokémon Ability, so silencing it lands the play. ⚠️ Ting-Lu
    // exempts Pokémon ex and Copperajah is not one, so this body is reachable.
    for (const seed of SEEDS) {
      const barred = turnOf(board(seed, "p1", "p1", COPPERAJAH), "p2");
      expect(play(barred, "p2", STADIUM)).toBe("HAND_PLAY_BLOCKED");
      let lifted = board(seed, "p1", "p1", COPPERAJAH);
      lifted = setActiveFromDeck(lifted, "p2", TING_LU);
      lifted = turnOf(lifted, "p2");
      expect(handPlayBarred(lifted, "p2", "Stadium", undefined)).toBe(false);
      expect(play(lifted, "p2", STADIUM)).toBe("OK");
    }
  });

  it("🛑 A STAMPED ITEM LOCK DOES NOT REACH A STADIUM — the split, driven", () => {
    // `StampedHandPlayClass` is why: no printed ATTACK can name a Stadium bar
    // (`attacks_json` 0, measured), so the stamped source answers `false` for
    // `"Stadium"` BY CONSTRUCTION. Driven off a real attack that really does
    // stamp, so a build that keyed the stamp by a string could go red here.
    for (const seed of SEEDS) {
      const stamped = swing(turnOf(board(seed, "p1", "p1", GALVANTULA), "p1"), "p1");
      const open = turnOf(stamped, "p2");
      expect(open.handPlayLockedTurn.p2.Item).toBe(open.turn);
      expect(handPlayBarred(open, "p2", "Item", undefined)).toBe(true);
      // …and the Stadium is untouched, from BOTH sources at once.
      expect(handPlayBarred(open, "p2", "Stadium", undefined)).toBe(false);
      expect(play(open, "p2", ITEM)).toBe("HAND_PLAY_BLOCKED");
      expect(play(open, "p2", STADIUM)).toBe("OK");
    }
  });

  it("🛑 BOTH SOURCES AT ONCE — and the Stadium bar is still the CONTINUOUS one", () => {
    // The funnel ORs them, so a board carrying a stamped Item lock AND an Active
    // Copperajah bars BOTH classes — and neither term is doing the other's work.
    for (const seed of SEEDS) {
      let state = board(seed, "p1", "p1", GALVANTULA);
      state = swing(turnOf(state, "p1"), "p1");
      state = setActiveFromDeck(state, "p1", COPPERAJAH);
      state = turnOf(state, "p2");
      expect(handPlayBarred(state, "p2", "Item", undefined)).toBe(true);
      expect(handPlayBarred(state, "p2", "Stadium", undefined)).toBe(true);
      expect(play(state, "p2", ITEM)).toBe("HAND_PLAY_BLOCKED");
      expect(play(state, "p2", STADIUM)).toBe("HAND_PLAY_BLOCKED");
      expect(play(state, "p2", SUPPORTER)).toBe("OK");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. THE MIRRORS — one is correct, and the other's ABSENCE is the refusal.
// ─────────────────────────────────────────────────────────────────────────────

describe("D288 §6 — the wire NOW emits the Stadium row, and the bar greys it", () => {
  it("🛑 `redactedTrainersOf` EMITS A GREYED STADIUM ROW — D287's refusal, INVERTED", () => {
    // 🆕 🛑 **THIS `it` IS D287's, WITH EVERY ASSERTION TURNED OVER.** It used to
    // read `not.toContain(STADIUM)` / `toBeUndefined()` and it was the ONLY
    // committed assertion in the whole suite that moved when D288 built the
    // mirror — the refusal was pinned here precisely so that the day someone
    // emitted the row, this line would say what was owed with it: the `barred`
    // term. It arrived on the same edit, which is what the inversion records.
    // ⚠️ **AND D287's OWN INSTRUCTION FOR REACHING THIS POINT WAS WRONG.** It said
    // to delete `redactedTrainersOf`'s `if (card.trainerType === "Stadium")
    // continue;` and read what reddens, *"the answer is the spec"*. **DELETING IT
    // REDDENS NOTHING — ZERO ASSERTIONS, THE WHOLE SUITE GREEN.** Every authored
    // Stadium program is `{stadium: …}` with `trainer` undefined, so the NEXT
    // line (`program.trainer === undefined`) already skipped all 8 of them: the
    // guard was DEAD CODE, and the absence this section asserted was held by a
    // line nobody had named. **A GUARD THAT IS NEVER THE REASON LOOKS EXACTLY
    // LIKE THE GUARD THAT IS**, and only deleting it tells them apart.
    for (const seed of SEEDS) {
      const barred = turnOf(board(seed, "p1", "p1", COPPERAJAH), "p2");
      expect(wireTrainerIds(barred, "p2")).toContain(STADIUM);
      expect(wireDisabled(barred, "p2", STADIUM)).toBe(true);
      expect(wireDisabled(barred, "p2", STADIUM_2)).toBe(true);
      // ⚠️ THE ATTRIBUTION CONTROL, KEPT AND STILL LOAD-BEARING: the projection
      // greys Item rows for this exact rule and leaves Supporter rows lit, so a
      // build that greyed EVERY row would be green above and RED here.
      const items = turnOf(board(seed, "p1", "p1", TYRANITAR), "p2");
      expect(wireTrainerIds(items, "p2")).toContain(ITEM);
      expect(wireDisabled(items, "p2", ITEM)).toBe(true);
      expect(wireDisabled(items, "p2", SUPPORTER)).toBe(false);
      // ⚠️ AND THE CLASS CONTROL IN THE OTHER DIRECTION: an ITEM barrier leaves
      // the Stadium rows LIT. Without this, a mirror that greyed Stadiums off
      // ANY bar would pass every line above.
      expect(wireDisabled(items, "p2", STADIUM)).toBe(false);
    }
  });

  it("⚠️ THE ENGINE IS AUTHORITATIVE ON BOTH TRANSPORTS — the gap costs a click, not a rule", () => {
    // The consequence of the gap, stated as a fact rather than a hope: an online
    // seat is never ALLOWED the play. It drags, the engine refuses, and the pill
    // carries the reason — `src/features/game/placement.ts`'s coarse-affordance
    // contract (D285's precedent). A slice that "fixed" the gap by loosening the
    // engine instead of by emitting the row would go red here.
    for (const seed of SEEDS) {
      const barred = turnOf(board(seed, "p1", "p1", COPPERAJAH), "p2");
      expect(play(barred, "p2", STADIUM)).toBe("HAND_PLAY_BLOCKED");
      expect(play(barred, "p2", STADIUM_2)).toBe("HAND_PLAY_BLOCKED");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. MATCH_RECORD_VERSION — 16, UNCHANGED, AND DRIVEN RATHER THAN ARGUED.
// ─────────────────────────────────────────────────────────────────────────────

describe("D287 §7 — the version does NOT move, and the claim is driven both ways", () => {
  it("🛑 A REAL JSON ROUND TRIP CARRIES THE WHOLE ANSWER — the bar is a DERIVED READ", () => {
    // ⚠️ THE STANDING TEST (match.ts): *can the PREVIOUS deploy's RECORD hold the
    // new TYPE*. This slice adds no `GameState` field, no key on an existing one,
    // no `EffectOp`, no event and no rename — it adds a READ of data a v16 record
    // already carries (the opponent's Active, and `programFor` off the catalog).
    // So a v16 record resumed under this deploy answers the NEW question
    // correctly without migration, which is what "no bump" has to MEAN.
    // 🛑 **AND THE FAILURE MODE HERE IS A SILENT WRONG ANSWER, NOT A THROW** —
    // which is why the assertion is the refusal CODE after the round trip and not
    // "the parse succeeded".
    for (const seed of SEEDS) {
      const barred = turnOf(board(seed, "p1", "p1", COPPERAJAH), "p2");
      const reloaded = JSON.parse(JSON.stringify(barred)) as GameState;
      expect(reloaded.handPlayLockedTurn.p2.Item).toBeNull();
      expect(handPlayBarred(reloaded, "p2", "Stadium", undefined)).toBe(true);
      expect(play(reloaded, "p2", STADIUM)).toBe("HAND_PLAY_BLOCKED");
      // 🛑 AND THE OTHER DIRECTION, which is the half a one-sided drive misses: a
      // record written with NO bar must still read as NO bar, so the round trip
      // cannot be passing because everything reloads as barred.
      const free = turnOf(board(seed, "p1", "p1", PLAIN), "p2");
      const freeReloaded = JSON.parse(JSON.stringify(free)) as GameState;
      expect(handPlayBarred(freeReloaded, "p2", "Stadium", undefined)).toBe(false);
      expect(play(freeReloaded, "p2", STADIUM)).toBe("OK");
    }
  });

  it("🛑 AND NOTHING PERSISTED MOVED — the diff, PAIRED with a literal anchor", () => {
    // D279's half-guard rule: a DIFF between two boards from ONE build is blind
    // to "every board grew a key", because the key appears on both sides. The
    // literal key lists sit beside it, and they are the lists D285 installed,
    // UNCHANGED — which is the whole claim of this slice's version half.
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
      expect(Object.keys(free.handPlayLockedTurn[seat]).sort()).toEqual(
        ["Item", "Supporter", "evolve"].sort(),
      );
    }
  });
});
