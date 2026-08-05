import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { applyAction, conditionHolds, conditionNote, createGame, programFor } from "./index";
import type { BoardCondition, GameEvent, GameState, Seat } from "./index";
import {
  FIXTURE_POOL,
  deckOf,
  firstBasicInHand,
  handFromDeck,
  handUid,
  must,
  mustApply,
  setPrizes,
  trainerCard,
  types,
} from "./testFixtures";

// D207 — THE OPPONENT'S REMAINING-PRIZE GATE, AND THE FINDING IS THAT THERE WAS
// NOTHING TO BUILD.
//
// ⚠️ D199's `DROPPED` row for Lacey priced this family at "ONE new
// `BoardCondition` union member", and named only `morePrizesThanOpponent` as the
// member that could not carry it. The member it was asking for —
// `BoardCondition.opponentPrizesRemaining { counts }` — WAS ALREADY IN THE UNION
// AT D199's OWN COMMIT. `git show 21623b5:packages/engine/src/effects.ts` finds
// three hits: the union member itself (line 329 of that revision) and the two
// damage-bonus rows that drove it in, Krokorok `sv01-116` "Payback" (`[1]`) and
// Houndstone `sv03-101` "Two Four-ocious" (`[2, 4]`). `interpreter.ts` has folded
// it since the M5 board-condition slice, in BOTH consumers, as
// `cond.counts.includes(state.players[otherSeat(seat)].prizes.length)`.
//
// So the price was not one union member plus two registry rows. It was TWO
// REGISTRY ROWS. Seven Standard-legal printings sat behind a `needs` string that
// said "new union member" and meant nothing of the kind — which is why the
// re-homed row in `legalNonAttackPrograms.test.ts` records the mistake instead of
// quietly disappearing.
//
// ── THE CENSUS, RE-DERIVED ───────────────────────────────────────────────────
// Remote D1 `luminous` (`735f0fb5-cdc3-494d-8b97-74a8ade0124a`; 3,786 rows / 20
// sets, 2,021 `legal_standard = 1`) on 2026-08-04, ⚠️ with **`GLOB`** and never
// `LIKE` (SQLite's `LIKE` is case-insensitive and cost D200 a census), and the
// JSON surfaces swept through `json_each(abilities_json)` /
// `json_each(attacks_json)` rather than a grouped query on the blob — D206
// attributed a printed sentence to the wrong card that way two slices ago.
//
// `effect GLOB '*Prize cards remaining, draw*'` → **exactly 7 rows, all
// `legal_standard = 1`**, marks H and I, and the counts match D199's to the id:
//   ✅ Lacey — "Shuffle your hand into your deck. Then, draw 4 cards. If your
//      opponent has 3 or fewer Prize cards remaining, draw 8 cards instead."
//      `sv07-139`, `sv07-166`, `sv07-172`, `sv08.5-114`, `sv08.5-175` — 5 legal.
//   ✅ Emcee's Hype — "Draw 2 cards. If your opponent has 3 or fewer Prize cards
//      remaining, draw 2 more cards."  `sv10-163`, `sv10-220` — 2 legal.
//
// The wider sweep (`'*Prize cards remaining*'` across `effect` + both JSON
// surfaces) returns 38 rows and confirms the family's edges: the OTHER legal
// readers of the opponent's remaining Prize count are Briar ×4 (below), Reversal
// Energy `sv04-266`, Counter Gain `sv08-169`/`-249`, and five ATTACK printings —
// none of which this slice touches.
//
// ── ⏹️ THE THIRD SENTENCE, REFUSED, AND WHY THE FLAG NEEDED NARROWING ────────
// Briar `sv07-132`/`-163`/`-171`, `sv08.5-100` (4 legal) prints "You can use this
// card only if your opponent has exactly 2 Prize cards remaining." — which is
// FREE here, `trainerPlayableIf: { kind: "opponentPrizesRemaining", counts: [2] }`,
// Fighting Au Lait's idiom at the arity the member was literally built for. Its
// SECOND sentence is what refuses it: "…Knocked Out by damage from an attack used
// by your **Tera** Pokémon…".
//
// ⚠️ The usual phrasing of that flag — "'Tera' is in no ingested column" — is
// FALSE AS WRITTEN, and is narrowed here rather than repeated. `name GLOB
// '*Tera*'` is 10 rows and `effect GLOB '*Tera *'` is 12. What those hits ARE is
// the point: the `name` rows are the SPECIES Terapagos (plus the Item "Tera
// Orb"), and the `effect` rows are Trainers ASKING for Tera Pokémon (Briar ×4,
// Area Zero Underdepths ×3, Glass Trumpet ×2, Sparkling Crystal ×2, Tera Orb).
// **Every hit is DEMAND.** The SUPPLY side — anything marking a Pokémon AS Tera —
// is absent, and the demonstration is a card this engine already authors:
// Charizard ex `sv03-125` IS a Tera Pokémon, and its row reads `stage: "Stage2"`,
// `types_json: ["Darkness"]`, `rarity: "Double rare"`, `regulation_mark: "G"`,
// name "Charizard ex" — indistinguishable, field for field, from a non-Tera Stage
// 2. An op authored over that absence has a permanently EMPTY candidate set,
// which `programPlayable` turns into a card that can NEVER be played: strictly
// worse than the loud "not simulated" path Briar takes today.
//
// ⚠️ WHAT WOULD TURN THE FLAG RED. `programFor` on all four Briar ids is asserted
// `undefined` below. That guard goes red the moment anyone authors Briar — which
// is exactly the event that needs a second look, because the only honest way to
// author it is to have added the Tera datum first.
//
// ── ⚠️ TWO SPELLINGS EXIST AND THEY ARE NOT THE SAME NUMBER ──────────────────
// `prizes.length` is REMAINING — what is still face down. `opponentPrizesTaken`
// (a `DamageCountSource`, folded at attack.ts:148) is `6 − remaining`. Both read
// the same array on the same seat and mean opposite ends of it, and both printed
// sentences here carry the word "remaining", so both are the `BoardCondition`.
// The crossing is asserted NOT to have happened, at the two Prize counts where a
// crossed reading and the right one disagree (see "remaining, never taken").

const LACEY_TEXT =
  "Shuffle your hand into your deck. Then, draw 4 cards. If your opponent has 3 or fewer Prize cards remaining, draw 8 cards instead.";
const HYPE_TEXT =
  "Draw 2 cards. If your opponent has 3 or fewer Prize cards remaining, draw 2 more cards.";

/** The five Lacey printings and the two Emcee's Hype printings, verbatim from the
    catalog. Declared HERE rather than in `FIXTURE_POOL` because the catalog
    manifest cannot be regenerated (`SQLITE_CANTOPEN`), so no real-card fixture may
    be added to the shared pool — D190/D199/D200's precedent. */
const LACEY_IDS = ["sv07-139", "sv07-166", "sv07-172", "sv08.5-114", "sv08.5-175"] as const;
const HYPE_IDS = ["sv10-163", "sv10-220"] as const;
/** The refused sibling — same clause, same union member, a second sentence with
    no datum behind it. */
const BRIAR_IDS = ["sv07-132", "sv07-163", "sv07-171", "sv08.5-100"] as const;

const LOCAL_CARDS: Record<string, Card> = {
  ...Object.fromEntries(LACEY_IDS.map((id) => [id, trainerCard(id, "Supporter", LACEY_TEXT)])),
  ...Object.fromEntries(HYPE_IDS.map((id) => [id, trainerCard(id, "Supporter", HYPE_TEXT)])),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

// Deep enough that Lacey's 8-draw is never deck-limited, and both real ids of
// each card are in it so a reprint is driven and not merely asserted equal.
const DECK = deckOf({
  "fix-basic-1": 8,
  "sv07-139": 4,
  "sv08.5-175": 2,
  "sv10-163": 4,
  "sv10-220": 2,
  "fix-energy": 40,
});

function localSetup(seed: number, first: Seat): GameState {
  const created = createGame({ seed, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first }));
  while (state.phase.kind === "setup:drawExtra") {
    const phase = state.phase;
    const seat = (["p1", "p2"] as const).find((s) => !phase.decided[s]);
    if (seat === undefined) throw new Error("setup:drawExtra with every seat decided");
    state = must(applyAction(state, { type: "setupDrawExtra", seat, count: phase.owed[seat] }));
  }
  for (const seat of ["p1", "p2"] as const) {
    state = must(applyAction(state, { type: "setupPlaceActive", seat, uid: firstBasicInHand(state, seat) }));
  }
  for (const seat of ["p1", "p2"] as const) state = must(applyAction(state, { type: "setupReady", seat }));
  return state;
}

/** P1 to move on turn 3 — past §4's going-first Supporter restriction, which
    matters because BOTH landed rows are Supporters. */
function board(seed: number): GameState {
  let state = localSetup(seed, "p1");
  while (state.turn < 3) {
    if (state.phase.kind !== "turn:action") throw new Error(`stuck in ${state.phase.kind}`);
    state = must(applyAction(state, { type: "endTurn", seat: state.turn % 2 === 1 ? "p1" : "p2" }));
  }
  return state;
}

/** A board where P2 (the opponent) has `oppPrizes` Prize cards REMAINING and P1
    has `ownPrizes` — deliberately different, so every assertion below is also a
    seat test. */
function withPrizes(seed: number, oppPrizes: number, ownPrizes: number): GameState {
  return setPrizes(setPrizes(board(seed), "p2", oppPrizes), "p1", ownPrizes);
}

function handCount(state: GameState, seat: Seat): number {
  return state.players[seat].hand.length;
}

function findAll<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

/** Put `cardId` into P1's hand and play it. */
function play(state: GameState, cardId: string): { state: GameState; events: GameEvent[] } {
  const withCard = handFromDeck(state, "p1", cardId, 1);
  const uid = handUid(withCard, "p1", cardId);
  return mustApply(withCard, { type: "playTrainer", seat: "p1", uid });
}

/** The two rows' gate, as authored — read off the registry rather than restated,
    so a registry edit cannot drift from the claims below. */
function gateOf(cardId: string): BoardCondition {
  const program = programFor(cardId);
  const ops = program?.trainer ?? [];
  for (const op of ops) if (op.op === "conditionGate") return op.cond;
  throw new Error(`${cardId} has no conditionGate`);
}

// ── 1. The claim this slice exists to check ──────────────────────────────────

describe("D207 — `opponentPrizesRemaining` was ALREADY THERE", () => {
  it("is folded by conditionHolds today, at every arity the pool prints", () => {
    // If this member were new, this test would be the one that could not have
    // been written before the slice. It could have been written at D199.
    const state = withPrizes(21, 3, 5);
    expect(conditionHolds(state, "p1", { kind: "opponentPrizesRemaining", counts: [3] })).toBe(true);
    expect(conditionHolds(state, "p1", { kind: "opponentPrizesRemaining", counts: [2, 4] })).toBe(false);
    expect(conditionHolds(state, "p1", { kind: "opponentPrizesRemaining", counts: [2, 3, 4] })).toBe(true);
    // …and it is SEAT-RELATIVE, which is the whole content of "opponent": read
    // from p2, the number in question is P1's 5.
    expect(conditionHolds(state, "p2", { kind: "opponentPrizesRemaining", counts: [5] })).toBe(true);
    expect(conditionHolds(state, "p2", { kind: "opponentPrizesRemaining", counts: [3] })).toBe(false);
  });

  it("⚠️ set MEMBERSHIP, not a threshold — 3 reads FALSE between two true values", () => {
    // The member's doc block's oldest claim, and it survives D207's amendment
    // unchanged: `[2, 4]` is not "2 to 4". This is what makes `[0, 1, 2, 3]` an
    // ENUMERATION of "3 or fewer" rather than an encoding of it.
    const twoFour: BoardCondition = { kind: "opponentPrizesRemaining", counts: [2, 4] };
    expect(conditionHolds(withPrizes(21, 2, 6), "p1", twoFour)).toBe(true);
    expect(conditionHolds(withPrizes(21, 3, 6), "p1", twoFour)).toBe(false);
    expect(conditionHolds(withPrizes(21, 4, 6), "p1", twoFour)).toBe(true);
  });
});

// ── 2. The gates as authored ─────────────────────────────────────────────────

describe("D207 — the authored gate is `[0, 1, 2, 3]` on both rows", () => {
  it("enumerates '3 or fewer' exactly, and 4 is outside it", () => {
    for (const id of [...LACEY_IDS, ...HYPE_IDS]) {
      expect(gateOf(id)).toEqual({ kind: "opponentPrizesRemaining", counts: [0, 1, 2, 3] });
    }
    // The boundary, at the level where it is observable: 3 in, 4 out. A `[0,1,2]`
    // mutant (the off-by-one an author actually writes) dies on the first line.
    const gate = gateOf("sv07-139");
    expect(conditionHolds(withPrizes(22, 3, 6), "p1", gate)).toBe(true);
    expect(conditionHolds(withPrizes(22, 4, 6), "p1", gate)).toBe(false);
  });

  it("⚠️ includes 0 for exactness — pinned where it is OBSERVABLE, not where it is not", () => {
    // `0` is the literal reading of "3 or fewer" and is UNREACHABLE in a legal
    // game: taking the sixth Prize ends it, so no board with the opponent at 0
    // remaining is ever presented to this gate. It is therefore asserted at the
    // `conditionHolds` level — where a synthetic state makes it real — and NOT
    // claimed as a game-level difference. A `[1, 2, 3]` mutant dies HERE and
    // nowhere else, and this comment is why that is honest rather than a hole.
    expect(conditionHolds(withPrizes(22, 0, 6), "p1", gateOf("sv10-163"))).toBe(true);
  });

  it("⚠️ remaining, NEVER taken — asserted at the two counts where the two disagree", () => {
    // `opponentPrizesTaken` is `6 − remaining`. A gate reading TAKEN against the
    // same `[0, 1, 2, 3]` would fire iff remaining ≥ 3 — the two readings agree
    // ONLY at remaining = 3, so a single-point test would be vacuous. These are
    // the two points that separate them:
    const gate = gateOf("sv07-139");
    //   remaining 2 (taken 4): the card fires; a taken-reader would NOT.
    expect(conditionHolds(withPrizes(23, 2, 6), "p1", gate)).toBe(true);
    //   remaining 4 (taken 2): the card does NOT fire; a taken-reader WOULD.
    expect(conditionHolds(withPrizes(23, 4, 6), "p1", gate)).toBe(false);
    // And the same two points driven end to end, so the claim is about the CARD
    // and not only about the predicate.
    expect(handCount(play(withPrizes(23, 2, 6), "sv07-139").state, "p1")).toBe(8);
    expect(handCount(play(withPrizes(23, 4, 6), "sv07-139").state, "p1")).toBe(4);
  });
});

// ── 3. Lacey — the `otherwise` arm, driven ───────────────────────────────────

describe("D207 — Lacey (the printed 'instead' is a genuine if/ELSE)", () => {
  it("shuffles and draws 4 when the opponent still has 5 Prizes left", () => {
    // The hand is stuffed BEFORE the play, so "hand size is exactly 4" is a claim
    // about the shuffle-in and not an accident of the opening hand: a mutant that
    // wrote the `otherwise` arm as a bare `drawCards 4` would land on 13 here.
    const state = handFromDeck(withPrizes(24, 5, 6), "p1", "fix-energy", 3);
    expect(handCount(state, "p1")).toBeGreaterThan(8);
    const played = play(state, "sv07-139");
    expect(handCount(played.state, "p1")).toBe(4);
  });

  it("shuffles and draws 8 INSTEAD when the opponent is down to 3 or fewer", () => {
    const played = play(withPrizes(24, 3, 6), "sv07-139");
    expect(handCount(played.state, "p1")).toBe(8);
  });

  it("⚠️ EXACTLY ONE arm runs — one shuffle event, not two", () => {
    // Grusha's test could not make this claim (its two arms are both
    // `drawUntilHandSize`, so run-BOTH is behaviourally equivalent there). Here
    // each arm carries a `handRefresh`, and each `handRefresh` emits its own
    // HAND_SHUFFLED_INTO_DECK — so a gate that ran both arms shows up as two
    // shuffles and a hand of 4 on the bonus board.
    for (const [oppPrizes, expected] of [
      [3, 8],
      [5, 4],
    ] as const) {
      const played = play(withPrizes(25, oppPrizes, 6), "sv07-139");
      expect(findAll(played.events, "HAND_SHUFFLED_INTO_DECK")).toHaveLength(1);
      expect(findAll(played.events, "CARDS_DRAWN")).toHaveLength(1);
      expect(findAll(played.events, "CARDS_DRAWN")[0]?.uids).toHaveLength(expected);
    }
  });

  it("⚠️ the seats are not crossed — P1's OWN Prize count never moves the gate", () => {
    // The mutant is `state.players[seat]` where the fold says
    // `otherSeat(seat)`. Both boards below have P1 and P2 on OPPOSITE sides of
    // the threshold, so the crossed reading inverts BOTH answers.
    //   opponent 5 / own 2 → no bonus (a crossed reader would give 8).
    expect(handCount(play(withPrizes(26, 5, 2), "sv07-139").state, "p1")).toBe(4);
    //   opponent 2 / own 5 → bonus (a crossed reader would give 4).
    expect(handCount(play(withPrizes(26, 2, 5), "sv07-139").state, "p1")).toBe(8);
  });

  it("⚠️ the branches are not swapped — MANY Prizes left is the SMALL draw", () => {
    // The author's mistake is putting the 8 in `otherwise`. At the extremes:
    expect(handCount(play(withPrizes(27, 6, 6), "sv07-139").state, "p1")).toBe(4);
    expect(handCount(play(withPrizes(27, 1, 6), "sv07-139").state, "p1")).toBe(8);
  });

  it("emits NO event for the gate itself — a public condition is not news", () => {
    const played = play(withPrizes(28, 2, 6), "sv07-139");
    expect(types(played.events)).toEqual([
      "TRAINER_PLAYED",
      "HAND_SHUFFLED_INTO_DECK",
      "CARDS_DRAWN",
    ]);
  });

  it("all five printings are one program object, and the reprint is DRIVEN", () => {
    const first = programFor(LACEY_IDS[0]);
    expect(first).toBeDefined();
    for (const id of LACEY_IDS) expect(programFor(id)).toBe(first);
    // Not merely identical by reference: a second real id played through the
    // engine, because `programFor` being shared is not the same claim as the
    // reprint being PLAYABLE (it must also be in the pool and pass §7.2).
    expect(handCount(play(withPrizes(29, 2, 6), "sv08.5-175").state, "p1")).toBe(8);
  });
});

// ── 4. Emcee's Hype — the one-armed gate ─────────────────────────────────────

describe("D207 — Emcee's Hype ('2 MORE' is additive where Lacey's 'instead' replaces)", () => {
  it("draws exactly 2 with the opponent at 4 Prizes remaining", () => {
    const state = withPrizes(31, 4, 6);
    const before = handCount(state, "p1");
    const played = play(state, "sv10-163");
    // +1 for the Hype put into hand, −1 for playing it, +2 drawn.
    expect(handCount(played.state, "p1")).toBe(before + 2);
    expect(findAll(played.events, "CARDS_DRAWN")).toHaveLength(1);
  });

  it("draws 2 MORE (4 total, as two separate draws) at 3 or fewer", () => {
    const state = withPrizes(31, 3, 6);
    const before = handCount(state, "p1");
    const played = play(state, "sv10-163");
    expect(handCount(played.state, "p1")).toBe(before + 4);
    // Two ops, not one merged count of 4 — the log reads as the card does.
    expect(findAll(played.events, "CARDS_DRAWN").map((d) => d.uids.length)).toEqual([2, 2]);
  });

  it("⚠️ never SHUFFLES — the two rows share a gate and nothing else", () => {
    // The copy-paste mutant: Lacey's `handRefresh` pasted into Emcee's Hype. It
    // would reach the same hand SIZE on the bonus arm from a 4-card hand, so the
    // claim has to be about the shuffle, and the hand is stuffed to make the
    // size claim bite too.
    const state = handFromDeck(withPrizes(32, 2, 6), "p1", "fix-energy", 3);
    const before = handCount(state, "p1");
    const played = play(state, "sv10-163");
    expect(findAll(played.events, "HAND_SHUFFLED_INTO_DECK")).toHaveLength(0);
    expect(handCount(played.state, "p1")).toBe(before + 4);
  });

  it("⚠️ the seats are not crossed here either", () => {
    const many = withPrizes(33, 5, 2);
    expect(handCount(play(many, "sv10-163").state, "p1")).toBe(handCount(many, "p1") + 2);
    const few = withPrizes(33, 2, 5);
    expect(handCount(play(few, "sv10-163").state, "p1")).toBe(handCount(few, "p1") + 4);
  });

  it("both printings are one program, and the reprint is DRIVEN", () => {
    const first = programFor(HYPE_IDS[0]);
    expect(first).toBeDefined();
    for (const id of HYPE_IDS) expect(programFor(id)).toBe(first);
    const state = withPrizes(34, 1, 6);
    expect(handCount(play(state, "sv10-220").state, "p1")).toBe(handCount(state, "p1") + 4);
  });
});

// ── 5. What did NOT land, and what turns each flag red ────────────────────────

describe("D207 — Briar stays UNBUILT, and the guard says when to look again", () => {
  it("⚠️ no program on any of the four printings", () => {
    // RED when: anyone authors Briar. That is the event worth interrupting for,
    // because the only honest way to author its second sentence is to have added
    // a Tera datum to the ingest first — and if it was authored WITHOUT one, the
    // card can never be played and this guard is the only thing that says so.
    for (const id of BRIAR_IDS) expect(programFor(id)).toBeUndefined();
  });

  it("⚠️ but its GATE is free — the refusal is the SECOND sentence, priced honestly", () => {
    // If the gate were the expensive part, this line could not be written. It is
    // the same member at the arity it was built for, and it evaluates correctly
    // right now on a board Briar would legally see.
    const gate: BoardCondition = { kind: "opponentPrizesRemaining", counts: [2] };
    expect(conditionHolds(withPrizes(35, 2, 6), "p1", gate)).toBe(true);
    expect(conditionHolds(withPrizes(35, 3, 6), "p1", gate)).toBe(false);
    // …and the printed clause round-trips through `conditionNote` verbatim, which
    // is what a `trainerPlayableIf` would surface in the HUD.
    expect(conditionNote(gate)).toBe("your opponent has exactly 2 Prize cards remaining");
  });
});

describe("D207 — `conditionNote` and the '3 or fewer' wording, flagged not papered", () => {
  it("⚠️ would MISREPORT this slice's gate — and is never asked, because these are conditionGates", () => {
    // A real defect if it were reachable: the note is built from the parameter and
    // hard-codes the word "exactly", so this slice's `[0, 1, 2, 3]` renders as a
    // sentence no card prints.
    expect(conditionNote(gateOf("sv07-139"))).toBe(
      "your opponent has exactly 0, 1, 2, or 3 Prize cards remaining",
    );
    // It is UNREACHABLE from either row, and this is the assertion that keeps it
    // so: `conditionNote`'s only three callers (cardplay.ts's
    // PLAY_CONDITION_NOT_MET, redact.ts's wire gate label, GameHud.tsx's button
    // title) all read `trainerPlayableIf`, and NEITHER row has one. A mid-program
    // `conditionGate` emits no event and renders no label.
    //
    // RED when: someone re-authors either row's gate as a PLAY gate — which is
    // precisely when the wording becomes user-visible and has to be fixed.
    for (const id of [...LACEY_IDS, ...HYPE_IDS]) {
      expect(programFor(id)?.trainerPlayableIf).toBeUndefined();
    }
  });
});

// ── 6. Persistence ───────────────────────────────────────────────────────────

describe("D207 — MATCH_RECORD_VERSION stays 12, derived rather than assumed", () => {
  it("⚠️ NEITHER row parks, so nothing new reaches `GameState.phase`", () => {
    // The derivation D190 made for a registry row is "a row is a map lookup keyed
    // by card id, so no persisted shape moves" — but that is only sufficient when
    // the program cannot PARK, because a parked program lives in `GameState.phase`
    // (`EffectContinuation.pendingOp`) and IS persisted. So the park question is
    // asked here rather than assumed.
    //
    // Both rows are built from three ops, and all three are documented
    // non-parking: `handRefresh` ("Fully automatic — no decision, so it never
    // parks", interpreter.ts), `drawCards`, and `conditionGate` (which SPLICES
    // into the work queue and makes no decision of its own). Asserted as
    // behaviour: every play in this file resolves to `turn:action` in one action,
    // with no `effect:choose` in between.
    for (const [id, oppPrizes] of [
      ["sv07-139", 2],
      ["sv07-139", 5],
      ["sv10-163", 2],
      ["sv10-163", 5],
    ] as const) {
      const played = play(withPrizes(36, oppPrizes, 6), id);
      expect(played.state.phase.kind).toBe("turn:action");
    }
    // And no NEW vocabulary was introduced for a record to carry: the gate uses a
    // union member that predates D199 and a `counts` list, both already
    // serialisable, so an old record replays to the same board.
    expect(gateOf("sv07-139").kind).toBe("opponentPrizesRemaining");
  });
});
