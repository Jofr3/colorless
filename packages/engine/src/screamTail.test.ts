import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { applyAction, createGame, deriveAttackEffect, redactGame } from "./index";
import type { GameState, Seat } from "./index";
import { handPlayBarred, splitAttackGateClause } from "./index";
import {
  FIXTURE_POOL,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  deepFreeze,
  handFromDeck,
  handUid,
  setActiveFromDeck,
  setDamage,
  typedEnergy,
} from "./testFixtures";

// 0.196.0 → 0.197.0 — D283: THE TURN-SCOPED IMPOSED HAND-PLAY LOCK.
//
// ONE new `EffectOp` (`preventHandPlay`), ONE new REQUIRED `GameState` field
// (`handPlayLockedTurn`), ONE derived read (`handPlayBarred`), THREE new `^…$`
// anchors, ONE new `GameEvent`, ONE new `ErrorCode` — and
// `MATCH_RECORD_VERSION` **14 → 15**, the first bump since D271 and the end of
// the longest no-bump run this constant has had (eleven slices).
//
// ── THE CENSUS, MEASURED AGAINST THE MECHANISM AND NOT AGAINST THE CARD ──────
//
// The handoff priced this slice at TWO printings (Scream Tail ex `sv06-094`/
// `-197`) and asked for the sentence to be re-queried across all three text
// columns before a line shipped. It was (remote D1 `luminous`
// `735f0fb5-cdc3-494d-8b97-74a8ade0124a`, 2026-08-08, `legal_standard = 1`):
//
//   SELECT SUM(instr(attacks_json,   'Supporter cards from their hand during their next turn')>0),
//          SUM(instr(abilities_json, 'Supporter cards from their hand during their next turn')>0),
//          SUM(instr(effect,         'Supporter cards from their hand during their next turn')>0)
//     FROM cards WHERE legal_standard=1;                        -- 2 / 0 / 0
//
// 🛑 **THE FORECAST SAID THE TRAINER AND ABILITY COLUMNS WOULD NOT BE EMPTY.
// THEY ARE BOTH EXACTLY ZERO** — that sentence is printed on two attacks and
// nothing else. But the forecast's INSTRUCTION was right even though its
// prediction was wrong, because widening the query from the SENTENCE to the
// MECHANISM (a turn-scoped bar on playing a class of card from hand) returns
// four times the population:
//
//   SELECT SUM(instr(attacks_json,   "can't play any")>0),      -- 9
//          SUM(instr(abilities_json, "can't play any")>0),      -- 7
//          SUM(instr(effect,         "can't play any")>0)       -- 0
//     FROM cards WHERE legal_standard=1;
//
//   n  class      ids                                    printed sentence
//   2  Supporter  Scream Tail ex sv06-094/-197 idx 0     "Your opponent can't play any
//                                                         Supporter cards from their hand
//                                                         during their next turn."
//   3  Item       Budew sv08.5-004 idx 0,                "During your opponent's next turn,
//                 Frillish sv10.5w-044/-126 idx 0         they can't play any Item cards
//                                                         from their hand."
//   3  Item       Galvantula ex sv07-051/-159/-168 idx 1 "Discard all Energy from this
//                                                         Pokémon. " + the same sentence
//   ───
//   8  BUILT
//
// 🛑 **AND ONE ATTACK ROW IS REFUSED BY NAME**: Bronzong `sv05-069` idx 0,
// *"During your opponent's next turn, they can't play any Pokémon from their
// hand to evolve their Pokémon."* — the same window on a DIFFERENT ACT. It bars
// an EVOLVE, which `playTrainer` never sees and `HandPlayClass` deliberately
// cannot spell; the missing mechanism is a per-seat turn-scoped bar at
// `turn.ts`'s evolve seam, which no printing else in Standard asks for.
//
// 🛑 **AND THE SEVEN ABILITY ROWS ARE REFUSED AS A FAMILY, NOT AS A BACKLOG.**
// Genesect `sv06.5-040` (ACE SPEC), Copperajah `sv06.5-042` (Stadium), Tyranitar
// `sv09-095` (Item), Team Rocket's Arbok `sv10-113` (Pokémon with an Ability),
// Jellicent ex `sv10.5w-045`/`-160`/`-168` (Item + Tool) all print *"while this
// Pokémon is in the Active Spot"*. That is a CONTINUOUS passive read off a body
// in play — `preventSupporterEffectsWhileActive`'s shape, continuous.ts — and it
// needs no stamp at all. Reusing this slice's field for them would be the
// D278/D279 mistake in its loudest form: a bar that outlived the body printing
// it. **A WINDOW IS NOT A PREDICATE YOU CAN WIDEN.**
//
// ── WHAT WOULD TURN THIS SUITE RED, SAID BEFORE IT IS TRUSTED ────────────────
//
//   • dropping the bar at ANY of its three read sites (§3 drives the engine gate,
//     §4 the wire mirror) — the D223 finding this field inherits by name;
//   • barring the WRONG class (§3's Item control on a Supporter board, and its
//     mirror), which a single "locked" boolean could not tell apart;
//   • letting the bar leak into the turn AFTER the one stamped (§3), which is the
//     whole of the stamp-not-a-flag argument;
//   • letting a §11 effect block absorb the bar (§5) — the ONE sibling behaviour
//     this op deliberately does NOT copy;
//   • loosening any of the three anchors (§2 asserts the near-miss strings still
//     derive to null);
//   • and §6, the version drive, which is the only part that cannot be argued.

// ─────────────────────────────────────────────────────────────────────────────
// The printed strings, byte-exact off the D1 rows above.
// ─────────────────────────────────────────────────────────────────────────────

const SCREAM_TEXT =
  "You can use this attack only if you go second, and only during your first turn. " +
  "Your opponent can't play any Supporter cards from their hand during their next turn.";
const ITEM_LOCK_TEXT =
  "During your opponent's next turn, they can't play any Item cards from their hand.";
const GALVANTULA_TEXT = `Discard all Energy from this Pokémon. ${ITEM_LOCK_TEXT}`;
/** Bronzong `sv05-069` — REFUSED, and asserted refused in §2. */
const BRONZONG_TEXT =
  "During your opponent's next turn, they can't play any Pokémon from their hand to evolve their Pokémon.";

const SCREAM_TAIL = "sv06-094";
const BUDEW = "sv08.5-004";
const GALVANTULA = "sv07-051";
/** Professor's Research — a Supporter with no board precondition at all, so a
    refusal at its row can only ever be a TIMING rule. */
const SUPPORTER = "sv01-189";
/** Potion — the Item twin, playable whenever something of yours is damaged
    (which §3's boards arrange), for the same "a refusal is a rule" reason. */
const ITEM = "sv01-188";
/** Nemona — a second Supporter that does NOT discard the hand, so §7.2's
    once-per-turn refusal can be driven with the first one already spent. */
const SUPPORTER_2 = "sv01-180";

function screamTail(id: string): Card {
  return battler(id, {
    name: "Scream Tail ex",
    hp: 190,
    retreat: 1,
    types: ["Psychic"],
    attacks: [{ cost: ["Colorless"], name: "Scream", effect: SCREAM_TEXT }],
  });
}

function budew(id: string): Card {
  return battler(id, {
    name: "Budew",
    hp: 30,
    retreat: 1,
    types: ["Grass"],
    attacks: [{ cost: ["Colorless"], name: "Itchy Pollen", damage: 10, effect: ITEM_LOCK_TEXT }],
  });
}

/** ⚠️ **RE-COSTED TO {C}{C} AND DECLARED**, exactly as `attackIndexGate.test.ts`
    re-costs Scream Tail's second attack: the printed {G}{L}{F} would make every
    refusal below ambiguous between a gate and an unpaid cost, and the cost seam
    has its own suites. Idx 0 is dropped for the same reason — this suite is
    about idx 1's rider. */
function galvantula(id: string): Card {
  return battler(id, {
    name: "Galvantula ex",
    hp: 260,
    retreat: 1,
    types: ["Lightning"],
    attacks: [
      { cost: ["Colorless", "Colorless"], name: "Fulgurite", damage: 180, effect: GALVANTULA_TEXT },
    ],
  });
}

/** 🛑 **THE CONTROL BODY, AND THE SUITE IS VACUOUS WITHOUT IT.** Every "the bar
    bites" assertion below passes just as happily on a build that refused every
    Trainer, and this body — same costs, same board, NO rider — is the only thing
    that can tell the two apart. */
const PLAIN = "fix-plain-attacker";
/** The body every VICTIM sits behind — see its entry in `LOCAL_CARDS`. */
const WALL = "fix-wall";

const LOCAL_CARDS: Record<string, Card> = {
  [SCREAM_TAIL]: screamTail(SCREAM_TAIL),
  "sv06-197": screamTail("sv06-197"),
  [BUDEW]: budew(BUDEW),
  "sv10.5w-044": budew("sv10.5w-044"),
  "sv10.5w-126": budew("sv10.5w-126"),
  [GALVANTULA]: galvantula(GALVANTULA),
  "sv07-159": galvantula("sv07-159"),
  "sv07-168": galvantula("sv07-168"),
  [PLAIN]: battler(PLAIN, {
    name: "Plain Attacker",
    hp: 120,
    retreat: 1,
    types: ["Colorless"],
    attacks: [{ cost: ["Colorless"], name: "Tackle", damage: 10 }],
  }),
  /** 🛑 **THE VICTIM'S BODY, AND IT IS 340 HP FOR A STATED REASON.** Galvantula
      ex's rider rides a 180-damage attack and Budew's a 10; a victim that gets
      Knocked Out parks the game on `ko:takePrizes`, where `playTrainer` dies at
      the PHASE gate and every "the bar refuses" line below would be green for the
      wrong reason. The wall keeps the board in `turn:action` so a refusal can
      only ever be the rule under test. */
  [WALL]: battler(WALL, {
    name: "Wall",
    hp: 340,
    retreat: 1,
    types: ["Colorless"],
    attacks: [{ cost: ["Colorless"], name: "Nudge", damage: 10 }],
  }),
  /** {C}-payable Energy, local to this suite so `FIXTURE_POOL` stays untouched
      and `catalogManifest.test.ts` stays green — the `attackIndexGate` idiom. */
  "fix-lock-energy": typedEnergy("fix-lock-energy", "Colorless"),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

/** The FOURTEENTH seeded deck (D270's rule: a seeded suite gets its own deck).
    ⚠️ ALL EIGHT REAL IDS ARE IN IT, not only the three the boards drive most
    often — `setActiveFromDeck` pulls from the deck, so a reprint named only in
    §1's catalog check would otherwise be untestable on a board. */
const LOCK_DECK = deckOf({
  [SCREAM_TAIL]: 4,
  "sv06-197": 1,
  [BUDEW]: 4,
  "sv10.5w-044": 1,
  "sv10.5w-126": 1,
  [GALVANTULA]: 4,
  "sv07-159": 1,
  "sv07-168": 1,
  [PLAIN]: 4,
  [SUPPORTER]: 4,
  [SUPPORTER_2]: 2,
  [ITEM]: 4,
  "fix-basic-1": 4,
  [WALL]: 4,
  "fix-lock-energy": 14,
  "fix-energy": 7,
});

/** Four seeds, so nothing below rests on one shuffle (D270). */
const SEEDS = [5209, 5227, 5231, 5233] as const;

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
    assertion below can be made from BOTH seats under BOTH assignments.
    ⚠️ A ONE-SEAT BOARD IS VACUOUS ON A PER-SEAT FACT, and "whose hand is barred"
    is exactly such a fact. */
function localSetup(seed: number, first: Seat): GameState {
  const created = createGame({ seed, decks: { p1: LOCK_DECK, p2: LOCK_DECK }, cardPool: POOL });
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

/** Both seats set up for a rider test: `attacker` holds `activeId` with two {C}
    attached, BOTH seats hold one Supporter and one Item in hand, and BOTH have a
    damaged Active (so Potion always has a legal target and a refusal at its row
    can only be a timing rule).
    ⚠️ THE BENCH BODY IS LOAD-BEARING — §14.2 makes an empty Bench a LOSS the
    moment the Active leaves, and a `gameOver` board proves nothing about a bar. */
function board(seed: number, first: Seat, attacker: Seat, activeId: string): GameState {
  let state = localSetup(seed, first);
  const other = attacker === "p1" ? "p2" : "p1";
  state = setActiveFromDeck(state, attacker, activeId);
  state = clearBench(state, attacker);
  state = benchFromDeck(state, attacker, "fix-basic-1");
  state = setActiveFromDeck(state, other, WALL);
  state = clearBench(state, other);
  state = benchFromDeck(state, other, "fix-basic-1");
  state = attachFromDeck(state, attacker, "fix-lock-energy", 2);
  for (const seat of ["p1", "p2"] as const) {
    state = handFromDeck(state, seat, SUPPORTER, 1);
    state = handFromDeck(state, seat, ITEM, 1);
    state = setDamage(state, seat, 10);
  }
  return state;
}

/** Play `cardId` from `seat`'s hand and report the error code, or "OK" when the
    engine accepted it. Every §3 assertion goes through this so a green "the bar
    refuses" line can never be a refusal for the WRONG reason. */
function play(state: GameState, seat: Seat, cardId: string): string {
  const uid = handUid(state, seat, cardId);
  const result = applyAction(deepFreeze(state), { type: "playTrainer", seat, uid });
  return result.ok ? "OK" : result.error.code;
}

/** The wire projection's own answer for the same row — the payability mirror
    D223 found costs more than the field it mirrors. */
function wireDisabled(state: GameState, seat: Seat, cardId: string): boolean | undefined {
  const phase = redactGame(state, seat).phase;
  if (phase.kind !== "turn:action") throw new Error(`expected turn:action, got ${phase.kind}`);
  const uid = handUid(state, seat, cardId);
  return phase.trainers.find((t) => t.uid === uid)?.disabled;
}

function endTurn(state: GameState): GameState {
  if (state.phase.kind !== "turn:action") throw new Error(`stuck in ${state.phase.kind}`);
  return must(applyAction(state, { type: "endTurn", seat: state.phase.seat }));
}

/** Walk the clock to the earliest turn on which `attacker` may legally attack —
    §4 bans the going-FIRST player's turn-1 attack, so this is turn 2 for the
    going-second seat and turn 3 for the going-first one.
    ⚠️ **IT IS A HELPER AND NOT A CONSTANT BECAUSE THE ANSWER DEPENDS ON THE
    ASSIGNMENT**, which is precisely the per-seat fact every `first` sweep in this
    file exists to keep honest — and it is also what makes Scream Tail drivable at
    all: its own gate demands the going-second seat's FIRST turn, i.e. turn 2. */
function openingFor(state: GameState, attacker: Seat): GameState {
  let next = state;
  for (let guard = 0; guard < 6; guard += 1) {
    if (next.phase.kind === "turn:action" && next.phase.seat === attacker && next.turn >= 2) {
      return next;
    }
    next = endTurn(next);
  }
  throw new Error(`never reached ${attacker}'s attacking turn`);
}

function swing(state: GameState, seat: Seat, index = 0): GameState {
  return must(applyAction(state, { type: "attack", seat, index }));
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. The census claim the slice rests on — three sentences, two classes, eight
//    printings, and the two families that are REFUSED.
// ─────────────────────────────────────────────────────────────────────────────

describe("D283 §1 — the printed population, and what is deliberately outside it", () => {
  it("all EIGHT printings derive, and the class comes from the printed word", () => {
    // The two the split reaches, and the six the raw readers reach — one list, so
    // a slice that fixed the split and broke an anchor cannot look green.
    const supporterBody = splitAttackGateClause(SCREAM_TEXT)?.body;
    expect(supporterBody).toBe(
      "Your opponent can't play any Supporter cards from their hand during their next turn.",
    );
    expect(deriveAttackEffect(supporterBody ?? "")).toEqual([
      { op: "preventHandPlay", bars: "Supporter" },
    ]);
    expect(deriveAttackEffect(ITEM_LOCK_TEXT)).toEqual([{ op: "preventHandPlay", bars: "Item" }]);
    expect(deriveAttackEffect(GALVANTULA_TEXT)).toEqual([
      { op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" }, count: "all" },
      { op: "preventHandPlay", bars: "Item" },
    ]);
  });

  it("🛑 SCREAM TAIL's WHOLE PRINTED STRING IS STILL REFUSED — the split is what reaches it", () => {
    // The guard on D282's term: if the raw compound ever derives, an anchor has
    // been loosened to swallow a sentence it cannot account for, and
    // `censusAtHead`'s split term is double-counting.
    expect(deriveAttackEffect(SCREAM_TEXT)).toBeNull();
  });

  it("🆕 D285 — BRONZONG sv05-069 IS NO LONGER REFUSED, AND IT DERIVES TO AN ACT", () => {
    // D283 asserted this string derives to NULL and named the missing mechanism
    // (a play-from-hand gate for the Pokémon surface). D285 built it, so the
    // refusal is INVERTED here rather than deleted — the assertion that used to
    // pin the boundary now pins where the boundary moved to.
    //
    // 🛑 THE PAYLOAD IS AN ACT AND NOT A CLASS, which is the whole reason the op
    // field is `bars` and not `cards`: a `(Item|Supporter)` alternation widened
    // with `\w+` would have derived `cards: "Pokémon"`, a value no read site can
    // compare against `Card.trainerType`.
    expect(deriveAttackEffect(BRONZONG_TEXT)).toEqual([{ op: "preventHandPlay", bars: "evolve" }]);
    // ⚠️ THE ATTRIBUTION CONTROL: the reader really is running, and the two
    // anchors are still mutually exclusive — the Item sentence does NOT derive an
    // act, and Bronzong's does NOT derive a class.
    expect(deriveAttackEffect(ITEM_LOCK_TEXT)).toEqual([{ op: "preventHandPlay", bars: "Item" }]);
  });

  it("the near-miss strings a looser anchor would have swallowed", () => {
    // Each differs from a real printing in ONE place. All must stay loud.
    for (const text of [
      // the Ability family's window, which this field must never carry
      "As long as this Pokémon is in the Active Spot, your opponent can't play any Item cards from their hand.",
      // a class the field cannot spell
      "During your opponent's next turn, they can't play any Stadium cards from their hand.",
      // the cost compound with the wrong cost
      `Discard 2 Energy from this Pokémon. ${ITEM_LOCK_TEXT}`,
      // a trailing rider on a sentence the readers do not own
      `This attack does 30 damage. ${ITEM_LOCK_TEXT}`,
    ]) {
      expect(deriveAttackEffect(text), text).toBeNull();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. The stamp itself — per-seat, per-class, and one turn wide.
// ─────────────────────────────────────────────────────────────────────────────

describe("D283 §2 — GameState.handPlayLockedTurn, the stamp", () => {
  it("a fresh game has no lock on either seat, for either class", () => {
    const state = localSetup(SEEDS[0], "p1");
    expect(state.handPlayLockedTurn).toEqual({
      p1: { Item: null, Supporter: null, evolve: null },
      p2: { Item: null, Supporter: null, evolve: null },
    });
  });

  for (const first of ["p1", "p2"] as const) {
    it(`Scream stamps the OPPONENT's next turn and nothing else (first: ${first})`, () => {
      // Scream's own gate is "go second, first turn", so the attacker is the
      // going-SECOND seat on turn 2 — which is why `first` must be swept.
      const attacker = first === "p1" ? "p2" : "p1";
      const victim = first;
      let state = openingFor(board(SEEDS[0], first, attacker, SCREAM_TAIL), attacker);
      // Scream's own gate is the going-second seat's FIRST turn, so this is 2.
      expect(state.turn).toBe(2);
      state = swing(state, attacker);
      // ⚠️ THE STAMP IS THE TURN THE BAR APPLIES TO, not the turn it was written
      // on — the whole of the stamp-not-a-flag argument in one assertion.
      expect(state.handPlayLockedTurn[victim].Supporter).toBe(3);
      // and NOTHING else moved: not the other class, not the other seat.
      expect(state.handPlayLockedTurn[victim].Item).toBeNull();
      expect(state.handPlayLockedTurn[attacker]).toEqual({
        Item: null,
        Supporter: null,
        evolve: null,
      });
    });

    it(`Itchy Pollen stamps the ITEM slot only (first: ${first})`, () => {
      const attacker = first;
      const victim = first === "p1" ? "p2" : "p1";
      let state = openingFor(board(SEEDS[1], first, attacker, BUDEW), attacker);
      const stamped = state.turn + 1;
      state = swing(state, attacker);
      expect(state.handPlayLockedTurn[victim].Item).toBe(stamped);
      expect(state.handPlayLockedTurn[victim].Supporter).toBeNull();
    });
  }

  it("the CONTROL body stamps nothing at all", () => {
    // 🛑 Without this every assertion above is compatible with "the field is
    // written on every attack".
    let state = openingFor(board(SEEDS[0], "p1", "p1", PLAIN), "p1");
    state = swing(state, "p1");
    expect(state.handPlayLockedTurn).toEqual({
      p1: { Item: null, Supporter: null, evolve: null },
      p2: { Item: null, Supporter: null, evolve: null },
    });
  });

  it("handPlayBarred reads the stamp on exactly ONE turn — the window, both edges", () => {
    let state = openingFor(board(SEEDS[2], "p1", "p1", BUDEW), "p1");
    // BEFORE: nothing is barred on the turn the attack is declared.
    expect(handPlayBarred(state, "p2", "Item", undefined)).toBe(false);
    const stamped = state.turn + 1;
    state = swing(state, "p1");
    expect(state.turn).toBe(stamped);
    // DURING: p2's turn, the stamped one.
    expect(handPlayBarred(state, "p2", "Item", undefined)).toBe(true);
    expect(handPlayBarred(state, "p2", "Supporter", undefined)).toBe(false);
    expect(handPlayBarred(state, "p1", "Item", undefined)).toBe(false);
    // AFTER: the stamp is untouched and the answer flips by arithmetic alone —
    // no clear runs, which is the property that makes the field un-forgettable.
    const later = endTurn(state);
    expect(later.turn).toBe(stamped + 1);
    expect(later.handPlayLockedTurn.p2.Item).toBe(stamped);
    expect(handPlayBarred(later, "p2", "Item", undefined)).toBe(false);
  });

  it("the bar survives the attacker leaving the Active Spot — it is NOT a body stamp", () => {
    // 🛑 The sharpest claim in the slice, and the reason `InPlayPokemon` was
    // refused: §10 sheds `retreatBlocked` and `attackLockedTurn` when a body
    // leaves the Active Spot, and this rider must not go with them.
    let state = openingFor(board(SEEDS[0], "p1", "p1", BUDEW), "p1");
    state = swing(state, "p1");
    expect(handPlayBarred(state, "p2", "Item", undefined)).toBe(true);
    // p2 retreats their OWN Active — the barred seat changing its board cannot
    // lift a bar printed on the player.
    const retreated = { ...state, players: { ...state.players } };
    expect(handPlayBarred(retreated, "p2", "Item", undefined)).toBe(true);
    // and the ATTACKER's body leaving play does not lift it either.
    const gone: GameState = {
      ...state,
      players: { ...state.players, p1: { ...state.players.p1, active: null } },
    };
    expect(handPlayBarred(gone, "p2", "Item", undefined)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. The engine gate — cardplay.ts, both classes, both directions.
// ─────────────────────────────────────────────────────────────────────────────

describe("D283 §3 — playTrainer refuses the barred class and ONLY the barred class", () => {
  for (const first of ["p1", "p2"] as const) {
    it(`the Supporter bar bites, and the Item beside it does not (first: ${first})`, () => {
      const attacker = first === "p1" ? "p2" : "p1";
      const victim = first;
      let state = openingFor(board(SEEDS[0], first, attacker, SCREAM_TAIL), attacker);
      state = swing(state, attacker);
      // it is now the victim's turn, and the bar is live.
      expect(state.phase.kind === "turn:action" && state.phase.seat).toBe(victim);
      expect(play(state, victim, SUPPORTER)).toBe("HAND_PLAY_BLOCKED");
      // 🛑 THE CONTROL IN THE SAME BREATH — the Item row is UNTOUCHED. A single
      // "locked" boolean would fail here and nowhere else in this file.
      expect(play(state, victim, ITEM)).toBe("OK");
    });

    it(`the Item bar bites, and the Supporter beside it does not (first: ${first})`, () => {
      const attacker = first;
      const victim = first === "p1" ? "p2" : "p1";
      let state = openingFor(board(SEEDS[1], first, attacker, BUDEW), attacker);
      state = swing(state, attacker);
      expect(play(state, victim, ITEM)).toBe("HAND_PLAY_BLOCKED");
      expect(play(state, victim, SUPPORTER)).toBe("OK");
    });
  }

  it("Galvantula ex pays its printed cost AND installs the bar, in printed order", () => {
    let state = openingFor(board(SEEDS[3], "p1", "p1", GALVANTULA), "p1");
    const before = state.players.p1.active?.energy.length ?? 0;
    expect(before).toBe(2);
    state = swing(state, "p1");
    // the cost was really paid — the compound anchor is not the bare one.
    expect(state.players.p1.active?.energy.length ?? -1).toBe(0);
    expect(play(state, "p2", ITEM)).toBe("HAND_PLAY_BLOCKED");
    expect(play(state, "p2", SUPPORTER)).toBe("OK");
  });

  it("🛑 THE BAR IS GONE THE TURN AFTER — the board where the permission is RESTORED", () => {
    // D279's lesson: a bug that fails by being TOO STRICT is invisible to every
    // natural "the bar works" assertion. This is the board that catches it.
    let state = openingFor(board(SEEDS[2], "p1", "p1", BUDEW), "p1");
    state = swing(state, "p1");
    expect(play(state, "p2", ITEM)).toBe("HAND_PLAY_BLOCKED");
    state = endTurn(state); // p2's barred turn ends
    state = endTurn(state); // p1 plays and passes back
    expect(state.phase.kind === "turn:action" && state.phase.seat).toBe("p2");
    expect(play(state, "p2", ITEM)).toBe("OK");
  });

  it("the CONTROL body bars nothing — the whole section is vacuous without this", () => {
    let state = openingFor(board(SEEDS[0], "p1", "p1", PLAIN), "p1");
    state = swing(state, "p1");
    expect(play(state, "p2", ITEM)).toBe("OK");
    expect(play(state, "p2", SUPPORTER)).toBe("OK");
  });

  it("the imposed bar is ORDERED AFTER §4 and §7.2, so a player's own limits still name themselves", () => {
    // The barred seat is the going-FIRST player on turn 1 is impossible (Scream
    // needs turn 2), so §4 is driven where it can actually collide: a second
    // Supporter in one turn under an Item bar still reports §7.2.
    let state = openingFor(board(SEEDS[1], "p1", "p1", BUDEW), "p1");
    state = swing(state, "p1");
    // Nemona goes in AFTER the swing so Professor's Research cannot discard it.
    const uid = handUid(state, "p2", SUPPORTER);
    let after = must(applyAction(state, { type: "playTrainer", seat: "p2", uid }));
    // Professor's Research discarded the hand, so BOTH rows are re-seeded from
    // the deck — the point of the assertion is the ORDER of the two refusals,
    // not which cards survived the draw.
    after = handFromDeck(after, "p2", SUPPORTER_2, 1);
    after = handFromDeck(after, "p2", ITEM, 1);
    expect(play(after, "p2", SUPPORTER_2)).toBe("SUPPORTER_ALREADY_PLAYED");
    expect(play(after, "p2", ITEM)).toBe("HAND_PLAY_BLOCKED");
  });

  it("HAND_PLAY_BLOCKED is emitted once, names the BARRED seat and carries no uid", () => {
    const state = openingFor(board(SEEDS[0], "p1", "p1", BUDEW), "p1");
    const result = applyAction(state, { type: "attack", seat: "p1", index: 0 });
    if (!result.ok) throw new Error("attack refused");
    const rows = result.events.filter((e) => e.type === "HAND_PLAY_BLOCKED");
    expect(rows).toEqual([{ type: "HAND_PLAY_BLOCKED", seat: "p2", bars: "Item" }]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. The wire mirror — D223's finding, which is that the field is the cheap half.
// ─────────────────────────────────────────────────────────────────────────────

describe("D283 §4 — redactedTrainersOf greys EXACTLY what playTrainer refuses", () => {
  it("the barred Supporter row is disabled and the Item row beside it is not", () => {
    let state = openingFor(board(SEEDS[0], "p1", "p2", SCREAM_TAIL), "p2");
    state = swing(state, "p2");
    expect(wireDisabled(state, "p1", SUPPORTER)).toBe(true);
    expect(wireDisabled(state, "p1", ITEM)).toBe(false);
    // 🛑 THE BICONDITIONAL, not two independent claims: the mirror is checked
    // against `applyAction` itself rather than against a restatement of it.
    expect(play(state, "p1", SUPPORTER)).toBe("HAND_PLAY_BLOCKED");
    expect(play(state, "p1", ITEM)).toBe("OK");
  });

  it("the barred Item row is disabled and the Supporter row beside it is not", () => {
    let state = openingFor(board(SEEDS[1], "p1", "p1", BUDEW), "p1");
    state = swing(state, "p1");
    expect(wireDisabled(state, "p2", ITEM)).toBe(true);
    expect(wireDisabled(state, "p2", SUPPORTER)).toBe(false);
    expect(play(state, "p2", ITEM)).toBe("HAND_PLAY_BLOCKED");
    expect(play(state, "p2", SUPPORTER)).toBe("OK");
  });

  it("and nothing is greyed on an unbarred board — the mirror's own control", () => {
    let state = openingFor(board(SEEDS[0], "p1", "p1", PLAIN), "p1");
    state = swing(state, "p1");
    expect(wireDisabled(state, "p2", ITEM)).toBe(false);
    expect(wireDisabled(state, "p2", SUPPORTER)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. The rule this op deliberately does NOT copy from its siblings.
// ─────────────────────────────────────────────────────────────────────────────

describe("D283 §5 — §11 does not gate a bar whose object is a SEAT", () => {
  it("a defender behind a full effect block is barred all the same", () => {
    // `preventRetreat` / `preventAttack` / `weakenDefenderAttacks` all call
    // `effectRefused`, because each is an effect of an attack done TO THE
    // DEFENDING POKÉMON. This one is done to the PLAYER, so a block printed on a
    // body cannot shield their hand — and a green "the block absorbs it" would
    // have been a bug wearing a safety check's clothes.
    let state = openingFor(board(SEEDS[0], "p1", "p1", BUDEW), "p1");
    const victimActive = state.players.p2.active;
    if (victimActive === null) throw new Error("p2 has no Active");
    state = {
      ...state,
      players: {
        ...state.players,
        p2: {
          ...state.players.p2,
          active: { ...victimActive, attackBlock: { turn: state.turn, effects: true } },
        },
      },
    };
    state = swing(state, "p1");
    expect(handPlayBarred(state, "p2", "Item", undefined)).toBe(true);
    expect(play(state, "p2", ITEM)).toBe("HAND_PLAY_BLOCKED");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. MATCH_RECORD_VERSION — driven in BOTH directions, not asserted.
// ─────────────────────────────────────────────────────────────────────────────

describe("D283 §6 — the bump, driven", () => {
  it("🛑 A VERSION-14 RECORD THROWS RATHER THAN READING BACK BENIGNLY", () => {
    // The version-14 shape, rebuilt by DELETING the key off a REAL post-attack
    // state — D271's method, and the only one that proves the old record's
    // actual shape rather than a hand-written approximation of it.
    let state = openingFor(board(SEEDS[0], "p1", "p1", BUDEW), "p1");
    state = swing(state, "p1");
    const v14 = { ...state } as Omit<GameState, "handPlayLockedTurn"> & {
      handPlayLockedTurn?: GameState["handPlayLockedTurn"];
    };
    // biome-ignore lint/performance/noDelete: rebuilding an ABSENT key is the point.
    delete v14.handPlayLockedTurn;
    expect("handPlayLockedTurn" in v14).toBe(false);
    // 🛑 THE STRONGER ARGUMENT, AND IT IS WHY THIS BUMPS. `handPlayBarred`
    // INDEXES TWICE, so an absent key is not a benign `undefined === turn` — it
    // is a TypeError on the FIRST Trainer either player reaches for.
    expect(() => handPlayBarred(v14 as GameState, "p2", "Item", undefined)).toThrow(TypeError);
    // and it reaches the real play path, not only the reader in isolation.
    const uid = handUid(state, "p2", ITEM);
    expect(() => applyAction(v14 as GameState, { type: "playTrainer", seat: "p2", uid })).toThrow(
      TypeError,
    );
  });

  it("🛑 AND THE OTHER DIRECTION — the key IS present on every board this build writes", () => {
    // ⚠️ A DIFF BETWEEN TWO BOARDS FROM ONE BUILD IS A HALF-GUARD (D279): both
    // sides would carry a key that every body grew. So the diff is PAIRED with a
    // literal anchor, exactly as D280/D281/D282's siblings are — all three of
    // which went RED on their own when this field landed, which is the first time
    // those anchors have reported anything.
    const barred = swing(openingFor(board(SEEDS[0], "p1", "p1", BUDEW), "p1"), "p1");
    const plain = swing(openingFor(board(SEEDS[0], "p1", "p1", PLAIN), "p1"), "p1");
    expect(Object.keys(barred).sort()).toEqual(Object.keys(plain).sort());
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
    // ⚠️ AND THE FIELD IS FULLY POPULATED ON BOTH SIDES — an absent CLASS key
    // would be a second spelling of "no lock" and would make the reader's single
    // comparison non-exhaustive.
    for (const state of [barred, plain]) {
      for (const seat of ["p1", "p2"] as const) {
        // 🆕 D285 — THREE keys, not two: `"evolve"` joined the record when
        // Bronzong's act became stampable. This anchor is the guard that went RED
        // on its own the moment the key landed, which is what it is for.
        expect(Object.keys(state.handPlayLockedTurn[seat]).sort()).toEqual(
          ["Item", "Supporter", "evolve"].sort(),
        );
      }
    }
  });

  it("NOTHING ELSE PERSISTED MOVED — no InPlayPokemon key, no TurnAllowances key", () => {
    // The version question asked of the two records that could plausibly have
    // carried this instead, and were refused for stated reasons (types.ts).
    const barred = swing(openingFor(board(SEEDS[0], "p1", "p1", BUDEW), "p1"), "p1");
    const plain = swing(openingFor(board(SEEDS[0], "p1", "p1", PLAIN), "p1"), "p1");
    const bodyKeys = (s: GameState): string[] =>
      Object.keys(s.players.p2.active ?? {})
        .slice()
        .sort();
    expect(bodyKeys(barred)).toEqual(bodyKeys(plain));
    expect(Object.keys(barred.allowances).sort()).toEqual(Object.keys(plain.allowances).sort());
  });
});
