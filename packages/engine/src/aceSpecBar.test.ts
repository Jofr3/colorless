import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { applyAction, createGame, handPlayBarred, programFor, redactGame } from "./index";
import type { GameState, Seat } from "./index";
import { aceSpecPlayBarred, isAceSpec } from "./continuous";
import {
  FIXTURE_POOL,
  attachToolFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  deepFreeze,
  handFromDeck,
  handUid,
  setActiveFromDeck,
  setDamage,
  specialEnergy,
  trainerCard,
} from "./testFixtures";

// D291 (+ 🆕 D292) — THE ACE SPEC BAR, THE LAST ROW OF D284's SEVEN-SENTENCE
// CENSUS, AND THE FOURTH SURFACE IT REACHES.
//
// THE SENTENCE. One printing, one sentence, and — unlike every other member of
// this family — it names NO class at all:
//
//   "If this Pokémon has a Pokémon Tool attached, your opponent can't play any
//    ACE SPEC cards from their hand."
//        — Genesect `sv06.5-040` "ACE Nullifier", 1 legal printing.
//
// ── WHY IT TOOK SEVEN SLICES, AND WHAT ACTUALLY UNBLOCKED IT ────────────────
//
// 🛑 **THIS ROW WAS REFUSED BY NAME AT D284, D287, D288, D289 AND D290 WITH THE
// MISSING MECHANISM RECORDED AS "AN ENGINE-SIDE ACE SPEC CLASSIFIER".** The
// refusal was CORRECT about the shape and WRONG about the price. Both halves of
// its stated reasoning survive re-derivation:
//
//   • ACE SPEC is a RARITY axis ORTHOGONAL to `Card.trainerType`, so no widening
//     of `HandPlayClass` reaches it at any width. TRUE, and it is why
//     `preventOpponentAceSpecPlayWhileToolAttached` is a SECOND FIELD.
//   • the printed window is HOLDER-STATE with no zone in it, so the one-Active
//     scan cannot express it. TRUE, and it is why the reader walks the BENCH.
//
// ⚠️ **BUT THE THIRD CLAUSE — "a RULES property read off a rarity label is an
// ingest decision this slice does not get to make alone" — WAS NOT A MECHANISM
// AT ALL, AND THE DECISION HAD ALREADY BEEN MADE.** `src/features/builder/
// cards.ts` has read exactly this label to enforce the deck validator's
// one-ACE-SPEC-per-deck rule since P2. **THE MISSING MECHANISM WAS ALREADY
// IMPLEMENTED THREE DIRECTORIES AWAY**, and `isAceSpec` here is that expression
// copied rather than re-derived, so the engine and the builder cannot disagree
// about what an ACE SPEC is. D290's rule one slice on: **BEFORE REFUSING A
// MECHANISM, GREP THE TREE FOR CODE THAT ALREADY IMPLEMENTS IT.**
//
// ── THE CENSUS, RUN BEFORE A LINE WAS WRITTEN ──────────────────────────────
//
// D290's handoff made this the FIRST action of the slice, on the ground that the
// inherited "33 legal ACE SPEC rows" had been re-quoted through six handoffs
// without a single re-query. Remote D1 `luminous`
// (`735f0fb5-cdc3-494d-8b97-74a8ade0124a`), 2026-08-08, ONE query,
// `rarity LIKE '%ACE SPEC%'` with NO legality filter, grouped by `rarity`,
// `legal_standard`, `category`, `trainer_type` and by registry membership:
//
//   Item     20   (8 already carry a registry row)
//   Tool      8   (2)
//   Stadium   2   (1)
//   Energy    3   (2)      `category = 'Energy'`, `trainer_type` NULL
//   ───────────────
//   total    33   (13)     ALL `legal_standard = 1`, ALL regulation mark H
//
// ✅ **THE 33 HELD EXACTLY.** ⚠️ **AND THE SPLIT IS THE FINDING.** Three facts
// no note anywhere stated, each of which changed a design decision:
//   • `rarity` takes EXACTLY ONE distinct ACE SPEC value, so the classifier is a
//     discriminator rather than a family of spellings;
//   • ZERO of the 33 is a Supporter and ZERO is a Pokémon — the reachable set is
//     Item / Tool / Stadium plus three Special Energy;
//   • the catalog holds NO illegal ACE SPEC printing at all, which is the exact
//     inverse of D290's 81-row fold and is why this row is buildable and that
//     one was not.
//
// 🛑 **D291 SHIPPED THIS AT 30 OF THE 33 AND ASSERTED THE GAP RATHER THAN
// DESCRIBING IT. 🆕 D292 CLOSED IT: 33 OF 33.** The three ACE SPEC Special Energy
// printings (`sv05-162` Neo Upper, `sv08-191` Enriching, `sv06-167` Legacy) are
// played by `attachEnergy` (turn.ts), which at D291 asked no hand-play bar of any
// kind. It now asks `aceSpecPlayBarred` — the rarity arm EXTRACTED out of
// `handPlayBarred`, because a Special Energy has no `HandPlayClass` and inventing
// one for it would have been a lie the compiler could never catch. **§5 IS AN
// INVERSION OF D291's OWN ABSENCE ASSERTION**, which is the fourth time D284's
// write-the-refusal-as-a-test design has cashed.
//
// ⚠️ **AND D291's FLAGGED CLAUSE, GRADED BY READING THE FUNCTION RATHER THAN THE
// GREP: "asks no hand-play bar of any kind" IS TRUE ON ITS LETTER AND THE DOUBT
// IT RAISED IS REAL.** `attachEnergy` has SIX guards — `turnGate`, the §6.2
// once-per-turn ALLOWANCE, card-in-hand, unknown-card, `isEnergyCard` and the
// target checks — and none of them is a hand-play bar; but the allowance IS the
// per-turn energy gate D291 suspected, and where the new bar sits relative to it
// was the ordering call, not a formality. §5 pins that order.
//
// ⚠️ **WHAT IS STILL MISSING, AND IT IS A DIFFERENT MECHANISM: THE WIRE HAS NO
// ENERGY ROW TO GREY.** The redacted `turn:action` phase carries `trainers` and
// nothing else playable-from-hand, so an ACE SPEC Item greys itself on the wire
// (§7) and an ACE SPEC Energy cannot. **MISSING: an energy-row playability
// projection — CODE *plus* a SCHEMA field.** §5's last test asserts it.
//
// ── THE DESIGN, AND THE TWO THINGS THAT MAKE IT NOT A WIDENING ─────────────
//
// **(1) A SECOND PREDICATE CROSSED WITH THE FIRST, NEVER A FIFTH MEMBER.**
// `HandPlayClass` is exactly `Card.trainerType` (D287) and stays that way. An
// `"AceSpec"` arm added to that union would have PARALLELED a predicate instead
// of CROSSING two, and would then have had to answer "is a Master Ball an Item
// or an AceSpec?" — a question the printed cards do not ask. §1 pins this.
//
// **(2) THE HOLDER LOOP DOES NOT COLLAPSE.** Every other printing in this family
// prints "As long as this Pokémon is in the Active Spot", so its scan is ONE
// read of `side.active`. This one prints "If this Pokémon has a Pokémon Tool
// attached" — a window with no zone in it — so a BENCHED Genesect wearing a Tool
// bars just as hard. **§3 IS THE SECTION THAT SEPARATES THIS ROW FROM ITS
// FAMILY**, and an Active-only reader is green on every other section of this
// file.
//
// ⚠️ **EVERY REFUSAL IS READ AS A CODE, NEVER AS `ok === false`.** A Trainer
// play has half a dozen distinct ways to fail and none of the others is this
// rule.
//
// ⚠️ **THE CONTROL CARD IS THE POINT OF THE FILE.** Every "the bar bites" line
// below passes just as happily on a build that refused every Trainer play; only
// the NON-ACE-SPEC card of the same class, from the same hand, on the same
// board, can tell them apart. And the control is paired per SURFACE, because the
// bar reaches three of them through three different gates.

const ACE_NULLIFIER_TEXT =
  "If this Pokémon has a Pokémon Tool attached, your opponent can't play any ACE SPEC cards from their hand.";
/** Copperajah's sentence — the CLASS-vocabulary sibling, and §1's proof that the
    two rows are not the same shape with a different noun. */
const MASSIVE_BODY_TEXT =
  "As long as this Pokémon is in the Active Spot, your opponent can't play any Stadium cards from their hand.";

/** The one and only printing of this mechanism. ⚠️ **GENESECT IS ITSELF AN
    "Uncommon"** — the barring body is not an ACE SPEC, which §1 asserts so that a
    build keying the bar off the HOLDER's rarity instead of the PLAYED card's
    could not pass. */
const GENESECT = "sv06.5-040";
/** Copperajah `sv06.5-042` — the CLASS control body. Its bar is `["Stadium"]`,
    so a build that let one row's field leak onto the other is RED in §1 and §4. */
const COPPERAJAH = "sv06.5-042";
/** Ting-Lu ex "Cursed Land" — the §9 ability lock. It silences the opponent's
    DAMAGED Pokémon in play (Active AND Bench, non-ex only), which is exactly the
    reach §6 needs to silence a BENCHED Genesect. */
const TING_LU = "sv02-127";

/** Dangerous Laser `sv06.5-058` — an ACE SPEC **Item** with a registry row and a
    precondition every board below satisfies ("Your opponent's Active Pokémon is
    now Burned and Confused."). THE MAIN SUBJECT. */
const ACE_ITEM = "sv06.5-058";
/** Master Ball `sv05-153` — a SECOND ACE SPEC Item under a different name, so
    §2's claim is about the RARITY and not about one card's program. */
const ACE_ITEM_2 = "sv05-153";
/** Potion `sv01-188` — a plain Item, the CLASS-MATCHED control. */
const ITEM = "sv01-188";
/** Neutralization Zone `sv06.5-060` — the catalog's ACE SPEC **Stadium** (there
    are exactly two, and this is the one that carries a registry row). */
const ACE_STADIUM = "sv06.5-060";
/** Beach Court `sv01-167` — a plain Stadium, the surface-matched control. */
const STADIUM = "sv01-167";
/** Maximum Belt `sv08.5-117` — an ACE SPEC **Tool**, reached through
    `attachTool` rather than `playTrainer`: a THIRD gate on the same funnel. */
const ACE_TOOL = "sv08.5-117";
/** Vitality Band `sv01-197` — a plain Tool, and ALSO the card Genesect wears to
    open its own window. One fixture doing both jobs is deliberate: §3's window
    is armed by the very card §4 proves is not barred. */
const TOOL = "sv01-197";
/** Enriching Energy `sv08-191` — an ACE SPEC **Special Energy**, and the surface
    D291 refused and **D292 BUILT**. §5 drives it. */
const ACE_ENERGY = "sv08-191";
/** 🆕 D292 — Jet Energy `sv02-190`, "Uncommon" off the remote D1: a SPECIAL
    Energy that is NOT an ACE SPEC, and the sharpest control in the file. Every
    "the Energy is barred" line below passes just as happily on a build that
    refused every Special Energy attach; only this card can tell the RARITY axis
    from the SUBTYPE one. ⚠️ Its on-attach program fires on a BENCH attach only,
    and every attach below is to the Active, so its own rider never runs. */
const SPECIAL_ENERGY = "sv02-190";
/** 🆕 D292 — `fix-energy`, a BASIC Colorless with `rarity: null`. Asserted as a
    CLASSIFIER fact only and deliberately NOT put in the deck: `ACE_DECK` is
    exactly 60 and every count in it is sized so that a 13-card setup removal
    cannot exhaust a pull, so a card that earns nothing a board can show must not
    buy four slots. `SPECIAL_ENERGY` is the stronger control on every board. */
const BASIC_ENERGY = "fix-energy";
/** Professor's Research `sv01-189` — a Supporter, and the class the ACE SPEC
    population contains ZERO of. §1 records that as a measurement. */
const SUPPORTER = "sv01-189";

/** The victim's Active — 340 HP, so nothing in this pool can Knock it Out and
    park the board on `ko:takePrizes`, where every refusal below would be green at
    the PHASE gate instead of at the rule under test. */
const WALL = "fix-ace-wall";
/** The CONTROL body: same board, same hands, no Ability at all. */
const PLAIN = "fix-ace-plain";

// ── the local pool (FIXTURE_POOL is left untouched — D190's idiom) ───────────

/** Genesect `sv06.5-040`, carrying the catalog's own HP / type / stage / retreat
    and its ONE printed attack, re-queried at the remote D1 on 2026-08-08. The id
    is REAL, so `programFor` resolves the shipped `ACE_NULLIFIER` row rather than
    a stand-in. ⚠️ **`rarity: "Uncommon"` IS THE PRINTED VALUE AND IS LOAD-BEARING
    HERE**, not decoration: it is what makes §1's "the holder is not an ACE SPEC"
    assertion a real board fact. */
function genesect(id: string): Card {
  return battler(id, {
    name: "Genesect",
    hp: 110,
    retreat: 1,
    types: ["Metal"],
    stage: "Basic",
    rarity: "Uncommon",
    abilities: [{ type: "Ability", name: "ACE Nullifier", effect: ACE_NULLIFIER_TEXT }],
    attacks: [{ name: "Magnetic Blast", cost: ["Metal", "Colorless", "Colorless"], damage: "100" }],
  });
}

function copperajah(id: string): Card {
  return battler(id, {
    name: "Copperajah",
    hp: 160,
    retreat: 3,
    types: ["Metal"],
    stage: "Stage1",
    evolveFrom: "Cufant",
    rarity: "Uncommon",
    abilities: [{ type: "Ability", name: "Massive Body", effect: MASSIVE_BODY_TEXT }],
  });
}

/** A catalog Trainer/Energy printing with its REAL rarity — the field this whole
    slice reads, and the one `blank` leaves `null`. Everything else comes from
    `FIXTURE_POOL` when the id is already there, so no printing is re-typed. */
function priced(id: string, rarity: string | null, card: Card): Card {
  return { ...card, id, rarity };
}

const LOCAL_CARDS: Record<string, Card> = {
  [GENESECT]: genesect(GENESECT),
  [COPPERAJAH]: copperajah(COPPERAJAH),
  [PLAIN]: battler(PLAIN, {
    name: "Plain Blocker",
    hp: 200,
    retreat: 1,
    types: ["Colorless"],
    stage: "Basic",
  }),
  [WALL]: battler(WALL, {
    name: "Ace Wall",
    hp: 340,
    retreat: 3,
    types: ["Colorless"],
    stage: "Basic",
  }),
};

/** ⚠️ **THE RARITY IS STAMPED ONTO THE SHARED FIXTURES RATHER THAN INVENTED.**
    `blank` leaves `rarity` null on every engine fixture, which is the honest
    default for a suite that never asked — but it makes every card in
    `FIXTURE_POOL` a non-ACE-SPEC, so a board built out of it could not tell this
    rule from a build that did nothing at all. Each id below is a REAL catalog
    printing with a REAL registry program; only `rarity` is set, to the exact
    string the remote D1 carries (re-queried 2026-08-08). A fixture that made up
    a card would be testing a printing nobody published, and one that made up a
    RARITY would be testing this file's opinion of the catalog. */
const RARITIES: Record<string, string> = {
  [ACE_ITEM]: "ACE SPEC Rare",
  [ACE_ITEM_2]: "ACE SPEC Rare",
  [ACE_STADIUM]: "ACE SPEC Rare",
  [ACE_TOOL]: "ACE SPEC Rare",
  [ACE_ENERGY]: "ACE SPEC Rare",
  [ITEM]: "Common",
  [STADIUM]: "Uncommon",
  [TOOL]: "Uncommon",
  [SUPPORTER]: "Rare",
  // 🆕 D292 — the SPECIAL-ENERGY control's REAL rarity, re-queried 2026-08-08.
  // ⚠️ `sv02-190` is `legal_standard = 0` and that is deliberate here: this is a
  // CONTROL fixture, not a census claim, and its job is to be a Special Energy
  // the classifier must answer `false` for. No line below counts it.
  [SPECIAL_ENERGY]: "Uncommon",
};

/** The four printings `FIXTURE_POOL` does not carry, written from their D1 rows.
    ⚠️ THE IDS ARE REAL AND EACH ALREADY HAS A REGISTRY PROGRAM, so a refusal at
    any of these rows can only ever be a RULE and never the coverage strategy —
    `TRAINER_NOT_SIMULATED` is checked ABOVE the bar in `playTrainer`, so an
    unauthored card would report the wrong code and the section would be green
    for the wrong reason. */
const NEW_PRINTINGS: Record<string, Card> = {
  [ACE_ITEM]: trainerCard(
    ACE_ITEM,
    "Item",
    "Your opponent's Active Pokémon is now Burned and Confused.",
  ),
  [ACE_ITEM_2]: trainerCard(
    ACE_ITEM_2,
    "Item",
    "Search your deck for a Pokémon, reveal it, and put it into your hand. Then, shuffle your deck.",
  ),
  [ACE_TOOL]: trainerCard(
    ACE_TOOL,
    "Tool",
    "Attacks used by the Pokémon this card is attached to do 50 more damage to your opponent's Active Pokémon ex (before applying Weakness and Resistance).",
  ),
  [ACE_ENERGY]: specialEnergy(
    ACE_ENERGY,
    "Enriching Energy",
    "As long as this card is attached to a Pokémon, it provides {C} Energy.\n\nWhen you attach this card from your hand to a Pokémon, draw 4 cards.",
  ),
};
const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS, ...NEW_PRINTINGS };
for (const [id, rarity] of Object.entries(RARITIES)) {
  const base = POOL[id];
  if (base === undefined) throw new Error(`POOL has no ${id}`);
  POOL[id] = priced(id, rarity, base);
}

/** This suite's own seeded deck (D270's rule). */
const ACE_DECK = deckOf({
  // ⚠️ FOUR AND FIVE COPIES RATHER THAN THE LEGAL ONE: this is a FIXTURE deck,
  // not a decklist (a real deck may hold ONE ACE SPEC in total), and every card
  // here is pulled out of the DECK after a 13-card setup draw, on four seeds,
  // from both seats. At one copy the pull runs dry, which fails LOUDLY — a
  // fixture bug wearing a rule's name.
  // ⚠️ 🆕 D292 — FOUR SLOTS FREED FOR `SPECIAL_ENERGY`, AND **NOT ONE OF THEM
  // TAKEN FROM A BASIC**. The deck must total exactly 60 (`BAD_DECK_SIZE`
  // otherwise), and the first attempt paid for the new row out of GENESECT and
  // WALL — which dropped the Basic count from 21 to 19, multiplied the MULLIGANS,
  // and drained the deck until an unrelated `handFromDeck` for `sv05-153` came up
  // empty. **THE THIN-BASIC WARNING BELOW IS ABOUT THE WHOLE DECK, NOT ONE ROW.**
  // The four slots come from ACE_ITEM, ITEM, TOOL and STADIUM, each still at or
  // above the depth of a row already proven at that depth.
  [GENESECT]: 5,
  [COPPERAJAH]: 3,
  [TING_LU]: 3,
  [PLAIN]: 5,
  [WALL]: 5,
  [ACE_ITEM]: 4,
  [ACE_ITEM_2]: 4,
  [ITEM]: 4,
  [ACE_STADIUM]: 4,
  [STADIUM]: 3,
  [ACE_TOOL]: 4,
  [TOOL]: 4,
  [ACE_ENERGY]: 4,
  // 🆕 D292 — the SPECIAL-ENERGY control, at the same four-copy depth and for the
  // same reason as every row above it.
  [SPECIAL_ENERGY]: 4,
  // ⚠️ A THIN BASIC COUNT MEANS MULLIGANS, and a mulligan's `setupDrawExtra`
  // drains the very deck every `handFromDeck` below reads from.
  "fix-basic-1": 4,
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

/** D275's `localSetup` with the FIRST PLAYER as a PARAMETER — a one-seat board is
    vacuous on a per-seat fact, and "whose hand is barred" is exactly one. */
function localSetup(seed: number, first: Seat): GameState {
  const created = createGame({ seed, decks: { p1: ACE_DECK, p2: ACE_DECK }, cardPool: POOL });
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

/** Where the barring body stands, and whether it is wearing a Tool — the two
    axes §3 crosses. `"none"` puts a `PLAIN` body in both slots instead. */
interface Barrier {
  readonly where: "active" | "bench" | "none";
  readonly tool: boolean;
  readonly id?: string;
}

/** `barrier` holds the barring body; the VICTIM holds a 340 HP Wall. **BOTH
    SEATS HOLD EVERY CARD UNDER TEST** — the symmetry is what lets §2 assert that
    the BARRING seat's own hand stays free on the very board that refuses the
    victim's.
    ⚠️ THE BENCH IS ALWAYS FILLED — §14.2 makes an empty Bench a LOSS the moment
    the Active leaves, and a `gameOver` board proves nothing about a bar.
    ⚠️ BOTH SEATS ARE DAMAGED so Potion always has a legal target and a refusal at
    the Item row can only ever be the rule under test. */
function board(seed: number, first: Seat, barrier: Seat, spec: Barrier): GameState {
  let state = localSetup(seed, first);
  const victim = barrier === "p1" ? "p2" : "p1";
  const bodyId = spec.id ?? GENESECT;
  // ⚠️ **`clearBench` COMES AFTER THE ACTIVE SURGERY, NEVER BEFORE IT.**
  // `setActiveFromDeck` DISPLACES the Active it replaces onto the bench, so a
  // board that cleared first silently carries the setup Active at bench[0] — and
  // the Tool attaches to the wrong body while every other assertion stays green.
  // That is exactly how §3's benched case failed before this line was ordered.
  state = setActiveFromDeck(state, barrier, spec.where === "active" ? bodyId : PLAIN);
  state = clearBench(state, barrier);
  state = benchFromDeck(state, barrier, spec.where === "bench" ? bodyId : PLAIN);
  if (spec.tool) {
    state = attachToolFromDeck(state, barrier, spec.where === "bench" ? 0 : "active", TOOL);
  }
  state = setActiveFromDeck(state, victim, WALL);
  state = clearBench(state, victim);
  state = benchFromDeck(state, victim, "fix-basic-1");
  for (const seat of ["p1", "p2"] as const) {
    for (const id of [
      ACE_ITEM,
      ACE_ITEM_2,
      ITEM,
      ACE_STADIUM,
      STADIUM,
      ACE_TOOL,
      ACE_ENERGY,
      SPECIAL_ENERGY,
    ]) {
      state = handFromDeck(state, seat, id, 1);
    }
    state = handFromDeck(state, seat, TOOL, 1);
    state = setDamage(state, seat, 10);
  }
  return state;
}

/** Walk the clock so `seat` is the one to move, at turn 3 or later so §4's
    first-turn bans are spent. Both a bar and its absence are only observable on
    the barred player's OWN turn. */
function turnOf(state: GameState, seat: Seat): GameState {
  let next = state;
  for (let i = 0; i < 12; i += 1) {
    if (next.phase.kind !== "turn:action") throw new Error(`stuck in ${next.phase.kind}`);
    if (next.phase.seat === seat && next.turn >= 3) return next;
    next = must(applyAction(next, { type: "endTurn", seat: next.phase.seat }));
  }
  throw new Error(`never reached ${seat}'s turn`);
}

/** Play `cardId` from `seat`'s hand and report the ERROR CODE, or "OK". ⚠️ EVERY
    ASSERTION IN §2–§6 GOES THROUGH ONE OF THESE THREE: each surface has several
    distinct ways to fail and only one of them is this rule. */
function play(state: GameState, seat: Seat, cardId: string): string {
  const uid = handUid(state, seat, cardId);
  const result = applyAction(deepFreeze(state), { type: "playTrainer", seat, uid });
  return result.ok ? "OK" : result.error.code;
}

function attach(state: GameState, seat: Seat, cardId: string): string {
  const uid = handUid(state, seat, cardId);
  const result = applyAction(deepFreeze(state), {
    type: "attachTool",
    seat,
    uid,
    target: { spot: "active" },
  });
  return result.ok ? "OK" : result.error.code;
}

function attachEnergy(state: GameState, seat: Seat, cardId: string): string {
  const uid = handUid(state, seat, cardId);
  const result = applyAction(deepFreeze(state), {
    type: "attachEnergy",
    seat,
    uid,
    target: { spot: "active" },
  });
  return result.ok ? "OK" : result.error.code;
}

/** The wire projection's own answer for a Trainer row, or `undefined` when the
    projection emits no row for that card at all — the distinction §7 turns on. */
function wireDisabled(state: GameState, seat: Seat, cardId: string): boolean | undefined {
  const phase = redactGame(state, seat).phase;
  if (phase.kind !== "turn:action") throw new Error(`expected turn:action, got ${phase.kind}`);
  return phase.trainers.find((t) => t.uid === handUid(state, seat, cardId))?.disabled;
}

const ARMED: Barrier = { where: "active", tool: true };

// ─────────────────────────────────────────────────────────────────────────────
// 1. THE CATALOG, THE CLASSIFIER AND THE CENSUS — three claims that must be
//    measurements rather than comments.
// ─────────────────────────────────────────────────────────────────────────────

describe("D291 §1 — the printing, the classifier and the ACE SPEC census", () => {
  it("the fixture carries the PRINTED sentence byte for byte, and its window is NOT the Active Spot", () => {
    // D284's rule: a claim that lives only in a comment cannot go red.
    expect(POOL[GENESECT]?.abilities?.[0]?.effect).toBe(ACE_NULLIFIER_TEXT);
    // 🛑 THE INHERITED CLAIM D284 CORRECTED, PINNED SO IT CANNOT ROT BACK. D283
    // recorded all seven printings of its census as carrying "while this Pokémon
    // is in the Active Spot"; this one prints a HOLDER-STATE window instead, and
    // that difference is a whole loop in the reader (§3).
    expect(ACE_NULLIFIER_TEXT.startsWith("If this Pokémon has a Pokémon Tool attached")).toBe(true);
    expect(ACE_NULLIFIER_TEXT).not.toContain("Active Spot");
    expect(MASSIVE_BODY_TEXT).toContain("Active Spot");
    // AND THE NOUN IS A RARITY, NOT A CLASS — the other half of the refusal.
    expect(ACE_NULLIFIER_TEXT).toContain("any ACE SPEC cards from their hand");
  });

  it("🛑 THE ROW IS ON ITS OWN FIELD AND `HandPlayClass` DID NOT GROW", () => {
    expect(programFor(GENESECT)?.passive?.preventOpponentAceSpecPlayWhileToolAttached).toBe(true);
    // 🛑 THE NEGATIVES ARE THE ASSERTION. A build that reached ACE SPEC by adding
    // a fifth `HandPlayClass` member would be GREEN on every "the bar bites" line
    // in this file and RED here — which is the one failure the whole design is
    // arranged to prevent.
    expect(programFor(GENESECT)?.passive?.preventOpponentHandPlay).toBeUndefined();
    expect(programFor(GENESECT)?.passive?.preventOpponentPokemonPlay).toBeUndefined();
    // And the CLASS sibling keeps its own list — the two rows stay disjoint.
    expect(programFor(COPPERAJAH)?.passive?.preventOpponentHandPlay).toEqual(["Stadium"]);
    expect(programFor(COPPERAJAH)?.passive?.preventOpponentAceSpecPlayWhileToolAttached)
      .toBeUndefined();
    expect(programFor(GENESECT)).not.toBe(programFor(COPPERAJAH));
  });

  it("the classifier answers off `Card.rarity`, and it agrees with the deck validator", () => {
    // The four ACE SPEC printings this suite drives, across THREE trainer types
    // and one Energy — the census's own shape, asserted as a predicate.
    for (const id of [ACE_ITEM, ACE_ITEM_2, ACE_STADIUM, ACE_TOOL, ACE_ENERGY]) {
      expect(isAceSpec(POOL[id]), id).toBe(true);
    }
    // ⚠️ THE CONTROLS ARE PER-CLASS, because the bar's whole claim is that the
    // class is irrelevant: an Item, a Stadium and a Tool that are NOT ACE SPEC.
    for (const id of [ITEM, STADIUM, TOOL, SUPPORTER]) {
      expect(isAceSpec(POOL[id]), id).toBe(false);
    }
    // 🛑 AND THE BARRING BODY ITSELF IS NOT ONE. A build that keyed the bar off
    // the HOLDER's rarity rather than the PLAYED card's would pass §2 on a board
    // where both happened to be ACE SPEC; Genesect prints "Uncommon", so that
    // build cannot even arm here.
    expect(POOL[GENESECT]?.rarity).toBe("Uncommon");
    expect(isAceSpec(POOL[GENESECT])).toBe(false);
    // A card with no rarity at all is FALSE, not a throw — every engine fixture
    // carries `rarity: null` and this predicate is asked on every Trainer play.
    expect(isAceSpec(FIXTURE_POOL["fix-basic-1"])).toBe(false);
    expect(isAceSpec(undefined)).toBe(false);
  });

  it("🛑 THE CENSUS: 33 legal ACE SPEC printings, and the split is what this build is priced on", () => {
    // Remote D1 `luminous`, 2026-08-08, ONE query, `rarity LIKE '%ACE SPEC%'`
    // with NO legality filter. Recorded as a TABLE so the arithmetic below is
    // derived from it rather than restated beside it (D290's idiom).
    const census = {
      Item: { total: 20, registered: 8 },
      Tool: { total: 8, registered: 2 },
      Stadium: { total: 2, registered: 1 },
      Energy: { total: 3, registered: 2 },
    } as const;
    const rows = Object.values(census);
    expect(rows.reduce((n, r) => n + r.total, 0)).toBe(33);
    expect(rows.reduce((n, r) => n + r.registered, 0)).toBe(13);
    // 🛑 **THE NUMBER THIS SLICE IS PRICED ON.** Three of the 33 are Special
    // Energy, which `attachEnergy` plays and which no hand-play gate sees, so
    // this build reaches THIRTY. Derived from the table, not asserted beside it:
    // a slice that later builds the energy surface changes ONE number here.
    expect(33 - census.Energy.total).toBe(30);
    // ⚠️ AND THE TWO SURPRISES, RECORDED BECAUSE NO NOTE ANYWHERE HAD THEM.
    // ZERO of the 33 is a Supporter — so `HandPlayClass`'s "Supporter" member and
    // this rule can never meet on a Standard board, which is why §2's Supporter
    // control is about the CLASS list and not about this bar.
    expect(Object.keys(census)).not.toContain("Supporter");
    // And 13 of the 33 already carried a registry row BEFORE this slice — the
    // third number D290's handoff called "the interesting one", and it is why
    // the bar has something to bite on the day it lands rather than in a future
    // authoring slice.
    expect(census.Item.registered + census.Tool.registered).toBe(10);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. THE BAR BITES, AND THE CLASS IS IRRELEVANT — the Item surface.
// ─────────────────────────────────────────────────────────────────────────────

describe("D291 §2 — the bar on the Item surface, with its class-matched control", () => {
  it("the victim's ACE SPEC Item is refused and its PLAIN Item is not — on the same board", () => {
    for (const seed of SEEDS) {
      const state = turnOf(board(seed, "p1", "p1", ARMED), "p2");
      expect(play(state, "p2", ACE_ITEM), `${seed}`).toBe("HAND_PLAY_BLOCKED");
      // 🛑 THE CONTROL, AND THE WHOLE FILE RESTS ON IT. Same seat, same hand,
      // same turn, same class — only the rarity differs.
      expect(play(state, "p2", ITEM), `${seed}`).toBe("OK");
    }
  });

  it("a SECOND ACE SPEC Item under a different name is refused too — the claim is the rarity", () => {
    // One card's refusal could be that card's own program misbehaving. Two, with
    // different programs and different preconditions, cannot both be that.
    const state = turnOf(board(SEEDS[0], "p1", "p1", ARMED), "p2");
    expect(play(state, "p2", ACE_ITEM_2)).toBe("HAND_PLAY_BLOCKED");
    expect(programFor(ACE_ITEM)).not.toBe(programFor(ACE_ITEM_2));
  });

  it("🛑 THE BARRING SEAT'S OWN ACE SPEC IS FREE — the perspective flip, on the barred board", () => {
    // The sentence reads "your OPPONENT can't play", so the seat holding Genesect
    // keeps its whole hand. A build that dropped `otherSeat` bars both seats and
    // is green on every line above.
    for (const seed of SEEDS) {
      const state = turnOf(board(seed, "p1", "p1", ARMED), "p1");
      expect(play(state, "p1", ACE_ITEM), `${seed}`).toBe("OK");
    }
  });

  it("both seat assignments and both first-players — a one-seat board is vacuous here", () => {
    for (const first of ["p1", "p2"] as const) {
      for (const barrier of ["p1", "p2"] as const) {
        const victim = barrier === "p1" ? "p2" : "p1";
        const state = turnOf(board(SEEDS[1], first, barrier, ARMED), victim);
        expect(play(state, victim, ACE_ITEM), `${first}/${barrier}`).toBe("HAND_PLAY_BLOCKED");
        expect(play(state, victim, ITEM), `${first}/${barrier}`).toBe("OK");
      }
    }
  });

  it("the predicate answers at the reader, per CARD rather than per class", () => {
    const state = turnOf(board(SEEDS[0], "p1", "p1", ARMED), "p2");
    // ⚠️ THE SAME CLASS ARGUMENT, TWO DIFFERENT ANSWERS — which is precisely what
    // no `HandPlayClass` widening could ever produce, and the sharpest statement
    // of why this is a second dimension.
    expect(handPlayBarred(state, "p2", "Item", POOL[ACE_ITEM])).toBe(true);
    expect(handPlayBarred(state, "p2", "Item", POOL[ITEM])).toBe(false);
    // And a caller that passes no card at all loses only the rarity term.
    expect(handPlayBarred(state, "p2", "Item", undefined)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. THE WINDOW — the section that separates this row from its whole family.
// ─────────────────────────────────────────────────────────────────────────────

describe("D291 §3 — the printed window is the TOOL, and it has no zone in it", () => {
  it("🛑 NO TOOL, NO BAR — the window is closed and the ACE SPEC lands", () => {
    for (const seed of SEEDS) {
      const state = turnOf(board(seed, "p1", "p1", { where: "active", tool: false }), "p2");
      expect(play(state, "p2", ACE_ITEM), `${seed}`).toBe("OK");
    }
  });

  it("🛑 A BENCHED GENESECT WITH A TOOL BARS JUST AS HARD — the assertion an Active-only reader fails", () => {
    // **THIS IS THE ONE LINE IN THE FILE THAT SEPARATES THIS ROW FROM D284's.**
    // `handPlayBarredByOpponentActive` reads `players[other].active` and nothing
    // else, because its four printings print "As long as this Pokémon is in the
    // Active Spot". Copy that reader here and every other section stays green.
    for (const seed of SEEDS) {
      const state = turnOf(board(seed, "p1", "p1", { where: "bench", tool: true }), "p2");
      expect(play(state, "p2", ACE_ITEM), `${seed}`).toBe("HAND_PLAY_BLOCKED");
      expect(play(state, "p2", ITEM), `${seed}`).toBe("OK");
    }
  });

  it("a benched Genesect WITHOUT a Tool bars nothing — the window, not the zone", () => {
    // Paired with the case above so "benched bodies always bar" cannot pass for
    // the rule: the difference between the two boards is one Tool.
    const state = turnOf(board(SEEDS[0], "p1", "p1", { where: "bench", tool: false }), "p2");
    expect(play(state, "p2", ACE_ITEM)).toBe("OK");
  });

  it("no Genesect anywhere and nothing is barred — the attribution control for the whole file", () => {
    // Without this, every "OK" above could be a board where the ACE SPEC play was
    // failing for a reason nobody named, and every "blocked" a board that refused
    // everything. `PLAIN` occupies both slots and wears the same Tool.
    for (const seed of SEEDS) {
      const state = turnOf(board(seed, "p1", "p1", { where: "none", tool: true }), "p2");
      expect(play(state, "p2", ACE_ITEM), `${seed}`).toBe("OK");
      expect(play(state, "p2", ITEM), `${seed}`).toBe("OK");
    }
  });

  it("🛑 THE WINDOW OPENS THROUGH THE REAL `attachTool` ACTION, NOT THROUGH SURGERY", () => {
    // Every other board in this file arms the window with `attachToolFromDeck`,
    // which is test surgery. Here the BARRING seat plays the Tool for real on its
    // own turn and the victim's next turn is barred — so the window is armed by
    // the GAME rather than by the fixture, and a build whose reader answered off
    // something the real action does not write would be red here and green above.
    const open = board(SEEDS[0], "p1", "p1", { where: "active", tool: false });
    const before = turnOf(open, "p2");
    expect(play(before, "p2", ACE_ITEM)).toBe("OK");
    let armed = turnOf(open, "p1");
    armed = must(
      applyAction(armed, {
        type: "attachTool",
        seat: "p1",
        uid: handUid(armed, "p1", TOOL),
        target: { spot: "active" },
      }),
    );
    expect(play(turnOf(armed, "p2"), "p2", ACE_ITEM)).toBe("HAND_PLAY_BLOCKED");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. EVERY SURFACE THE VOCABULARY REACHES — three gates, one funnel.
// ─────────────────────────────────────────────────────────────────────────────

describe("D291 §4 — the Stadium and Tool surfaces, each with its own control", () => {
  it("the ACE SPEC STADIUM is refused and the plain Stadium is not — `playStadium`'s gate", () => {
    // A DIFFERENT GATE from §2's: `playTrainer` dispatches Stadiums to
    // `playStadium` on the line above its own bar, which is why D287 had to build
    // that read at all. The rarity term rides it for free.
    for (const seed of SEEDS) {
      const state = turnOf(board(seed, "p1", "p1", ARMED), "p2");
      expect(play(state, "p2", ACE_STADIUM), `${seed}`).toBe("HAND_PLAY_BLOCKED");
      expect(play(state, "p2", STADIUM), `${seed}`).toBe("OK");
    }
  });

  it("the ACE SPEC TOOL is refused and the plain Tool is not — `attachTool`'s gate", () => {
    // A THIRD gate, and the one whose control is doing double duty: the plain
    // Tool that attaches here is the same card Genesect is wearing to arm the
    // window, so "Tools are barred" cannot pass for the rule.
    for (const seed of SEEDS) {
      const state = turnOf(board(seed, "p1", "p1", ARMED), "p2");
      expect(attach(state, "p2", ACE_TOOL), `${seed}`).toBe("HAND_PLAY_BLOCKED");
      expect(attach(state, "p2", TOOL), `${seed}`).toBe("OK");
    }
  });

  it("🛑 THE CLASS SIBLING DOES NOT REACH ANY OF THEM — Copperajah bars Stadiums and only Stadiums", () => {
    // The inverse control, and the reason the two fields are two. On a board
    // whose barrier is COPPERAJAH the ACE SPEC Stadium is refused (its CLASS is
    // barred) while the ACE SPEC Item and the ACE SPEC Tool are free.
    const state = turnOf(board(SEEDS[0], "p1", "p1", { where: "active", tool: true, id: COPPERAJAH }), "p2");
    expect(play(state, "p2", ACE_STADIUM)).toBe("HAND_PLAY_BLOCKED");
    expect(play(state, "p2", STADIUM)).toBe("HAND_PLAY_BLOCKED");
    expect(play(state, "p2", ACE_ITEM)).toBe("OK");
    expect(attach(state, "p2", ACE_TOOL)).toBe("OK");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. 🆕 D292 — THE ENERGY SURFACE, WHICH D291 REFUSED AND ASSERTED AS AN ABSENCE.
//    ⚠️ **THIS SECTION IS AN INVERSION, NOT AN ADDITION.** D291 wrote
//    `expect(attachEnergy(…)).toBe("OK")` on a fully barred board precisely so
//    that building the gate would cost a DELIBERATE edit here — the same design
//    D284 used for its three refusals, cashed for the fourth time. The old line
//    is preserved below as the `false`-side control it became.
// ─────────────────────────────────────────────────────────────────────────────

describe("D292 §5 — the ACE SPEC Special Energy is barred, and it is the RARITY that bars it", () => {
  it("🛑 AN ACE SPEC SPECIAL ENERGY IS REFUSED ON A BARRED BOARD — 33 of 33, and the other 3 are these", () => {
    // **THE SURFACE D291 PRICED AT 30-OF-33, CLOSED.** Genesect's printed sentence
    // says "any ACE SPEC cards from their hand", and attaching an Energy from hand
    // IS playing that card. `attachEnergy` (turn.ts) now asks `aceSpecPlayBarred`.
    for (const seed of SEEDS) {
      const state = turnOf(board(seed, "p1", "p1", ARMED), "p2");
      // The Item on the same board, from the same hand, is barred by the same
      // sentence — so a red here is a SURFACE failure and not an unarmed board.
      expect(play(state, "p2", ACE_ITEM), `${seed}`).toBe("HAND_PLAY_BLOCKED");
      expect(attachEnergy(state, "p2", ACE_ENERGY), `${seed}`).toBe("HAND_PLAY_BLOCKED");
    }
  });

  it("🛑 THE SPECIAL-ENERGY CONTROL ATTACHES ON THAT SAME BOARD — the axis is RARITY, not category", () => {
    // **THE POINT OF THE SECTION.** A build that refused every Energy attach while
    // any bar was up — or that keyed on "is a Special Energy" — is GREEN on the
    // line above and RED here. `sv02-190` is a SPECIAL Energy that is not an ACE
    // SPEC: same category, same subtype, same hand, same board, one rarity apart.
    for (const seed of SEEDS) {
      const state = turnOf(board(seed, "p1", "p1", ARMED), "p2");
      expect(attachEnergy(state, "p2", SPECIAL_ENERGY), `${seed}`).toBe("OK");
    }
  });

  it("the barred Energy really is an ACE SPEC, and the two controls really are not", () => {
    // The attribution control D291 wrote for the GAP, kept and pointed at the
    // BUILD: without it, "the Energy is barred" would be true of any card the
    // classifier happened to recognise for some other reason.
    expect(isAceSpec(POOL[ACE_ENERGY])).toBe(true);
    expect(POOL[ACE_ENERGY]?.category).toBe("Energy");
    expect(POOL[ACE_ENERGY]?.trainerType).toBeNull();
    expect(isAceSpec(POOL[SPECIAL_ENERGY])).toBe(false);
    expect(POOL[SPECIAL_ENERGY]?.category).toBe("Energy");
    expect(isAceSpec(POOL[BASIC_ENERGY])).toBe(false);
    expect(POOL[BASIC_ENERGY]?.rarity ?? null).toBeNull();
  });

  it("🛑 THE SITE ASKS `aceSpecPlayBarred` AND NOT `handPlayBarred` — no class word is invented", () => {
    // **THE DESIGN CALL OF THIS SLICE, PINNED AS A BOARD FACT.** `HandPlayClass`
    // is exactly `Card.trainerType` and is NULL on all three Energy printings, so
    // the class funnel has no member to offer. D291's own §5 recorded that
    // `handPlayBarred(…, "Item", ACE_ENERGY)` answers `true` — it does, and that
    // is precisely why passing `"Item"` here would have WORKED and been a lie.
    // The extracted rarity reader answers the question this site actually means.
    const barred = turnOf(board(SEEDS[0], "p1", "p1", ARMED), "p2");
    expect(aceSpecPlayBarred(barred, "p2", POOL[ACE_ENERGY])).toBe(true);
    expect(aceSpecPlayBarred(barred, "p2", POOL[SPECIAL_ENERGY])).toBe(false);
    expect(aceSpecPlayBarred(barred, "p2", undefined)).toBe(false);
    // ⚠️ AND THE EXTRACTION DID NOT CHANGE THE CLASS FUNNEL'S ANSWER — D291's
    // line, kept verbatim, so the refactor is observable rather than asserted.
    expect(handPlayBarred(barred, "p2", "Item", POOL[ACE_ENERGY])).toBe(true);
    // The barring seat's OWN hand is free of both, on the same board.
    const own = turnOf(board(SEEDS[0], "p1", "p1", ARMED), "p1");
    expect(aceSpecPlayBarred(own, "p1", POOL[ACE_ENERGY])).toBe(false);
    expect(attachEnergy(own, "p1", ACE_ENERGY)).toBe("OK");
  });

  it("🛑 §6.2's OWN-LIMIT NAMES ITSELF FIRST — the gate sits BELOW the allowance", () => {
    // `playTrainer`'s ordering rule on the Energy surface: the once-per-turn
    // allowance is the player's OWN limit and is entitled to name itself, and a
    // barred seat learns the bar only once its own play was otherwise legal. A
    // build that put this gate above the allowance is green on every other line
    // in this file and red here.
    let state = turnOf(board(SEEDS[0], "p1", "p1", ARMED), "p2");
    const spent = applyAction(state, {
      type: "attachEnergy",
      seat: "p2",
      uid: handUid(state, "p2", SPECIAL_ENERGY),
      target: { spot: "active" },
    });
    if (!spent.ok) throw new Error(`control attach failed: ${spent.error.code}`);
    state = spent.state;
    expect(state.allowances.energyAttached).toBe(true);
    expect(attachEnergy(state, "p2", ACE_ENERGY)).toBe("ENERGY_ALREADY_ATTACHED");
  });

  it("🛑 A REFUSED ATTACH COSTS NOTHING — the card stays in hand and the allowance is unspent", () => {
    // The gate sits ABOVE the mutation, so the refusal is free. Without this, a
    // build that barred the play *after* removing the card from hand would be
    // green on every "HAND_PLAY_BLOCKED" line above while destroying the card.
    const state = turnOf(board(SEEDS[0], "p1", "p1", ARMED), "p2");
    const uid = handUid(state, "p2", ACE_ENERGY);
    const result = applyAction(state, {
      type: "attachEnergy",
      seat: "p2",
      uid,
      target: { spot: "active" },
    });
    expect(result.ok).toBe(false);
    expect(state.players.p2.hand).toContain(uid);
    expect(state.allowances.energyAttached).toBe(false);
    expect(state.players.p2.active?.energy ?? []).not.toContain(uid);
  });

  it("the window and the §9 lock reach this surface too — the loop is not re-implemented here", () => {
    // The gate asks the SAME extracted reader every Trainer surface asks, so
    // everything §3 and §6 proved about the holder loop holds here for free.
    // Driven rather than asserted, because "for free" is a claim about code.
    const seed = SEEDS[0];
    // No Tool on the holder → no window → the Energy lands.
    expect(attachEnergy(turnOf(board(seed, "p1", "p1", { where: "active", tool: false }), "p2"), "p2", ACE_ENERGY)).toBe("OK");
    // A BENCHED armed holder bars it — the loop, one surface over.
    expect(attachEnergy(turnOf(board(seed, "p1", "p1", { where: "bench", tool: true }), "p2"), "p2", ACE_ENERGY)).toBe(
      "HAND_PLAY_BLOCKED",
    );
    // No holder at all → nothing bars anything.
    expect(attachEnergy(turnOf(board(seed, "p1", "p1", { where: "none", tool: true }), "p2"), "p2", ACE_ENERGY)).toBe("OK");
    // §9 — Ting-Lu ex silences the one damaged Active holder and the Energy lands.
    let locked = board(seed, "p1", "p1", ARMED);
    locked = turnOf(setActiveFromDeck(locked, "p2", TING_LU), "p2");
    expect(attachEnergy(locked, "p2", ACE_ENERGY)).toBe("OK");
  });

  it("⚠️ THE REFUSAL THIS SLICE MAKES: the WIRE cannot grey the Energy row, because it has none", () => {
    // **PRICED AS A BOARD FACT, D291's idiom reused on D292's own gap.** The
    // redacted `turn:action` phase carries a `trainers` array and nothing else
    // playable-from-hand (`packages/schema/src/match/redacted.ts`), so an ACE SPEC
    // Item greys itself on the wire (§7) and an ACE SPEC Energy cannot — there is
    // no row to carry `disabled`. **MISSING: an energy-row playability projection
    // — missing CODE *plus* a SCHEMA field**, not a catalog fact and not a
    // permission. ⚠️ `src/features/game/placement.ts` already DEFERS energy
    // legality to the engine in a written comment, so the drag stays offered and
    // the engine refuses it; the client half is free by design, not by omission.
    const state = turnOf(board(SEEDS[0], "p1", "p1", ARMED), "p2");
    expect(wireDisabled(state, "p2", ACE_ITEM)).toBe(true);
    // The Energy is in the same hand and gets NO row at all — `undefined`, which
    // is the distinction this helper exists to make.
    expect(wireDisabled(state, "p2", ACE_ENERGY)).toBeUndefined();
    expect(wireDisabled(state, "p2", SPECIAL_ENERGY)).toBeUndefined();
    const phase = redactGame(state, "p2").phase;
    if (phase.kind !== "turn:action") throw new Error(`expected turn:action, got ${phase.kind}`);
    for (const row of phase.trainers) {
      const card = POOL[state.cardIdByUid[row.uid] ?? ""];
      expect(card?.category, row.uid).toBe("Trainer");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. §9 SUPPRESSION, PER SOURCE — and per source is load-bearing here.
// ─────────────────────────────────────────────────────────────────────────────

describe("D291 §6 — the Ability lock takes the bar down, one SOURCE at a time", () => {
  it("a silenced Genesect bars nothing — §9, driven through a real Ability lock", () => {
    // Ting-Lu ex's "Cursed Land" silences the opponent's DAMAGED non-ex Pokémon in
    // play. Every board here damages both seats, so the Active Genesect is inside
    // its reach and the ACE SPEC lands.
    let state = board(SEEDS[0], "p1", "p1", ARMED);
    state = setActiveFromDeck(state, "p2", TING_LU);
    state = turnOf(state, "p2");
    expect(play(state, "p2", ACE_ITEM)).toBe("OK");
  });

  it("🛑 SILENCING ONE HOLDER DOES NOT TAKE THE BAR DOWN — per SOURCE, which only a LOOP can get wrong", () => {
    // **THIS FAILURE MODE DOES NOT EXIST IN THE REST OF THIS FAMILY**, because
    // every other member reads exactly one body. With a holder LOOP a reader that
    // returned `false` as soon as it met a silenced source — the natural way to
    // write "the Ability is off" — takes the whole bar down on a board where a
    // SECOND holder is still speaking. The two boards differ only in whether the
    // Bench holds a second armed Genesect.
    //
    // ⚠️ Cursed Land silences the opponent's DAMAGED non-ex bodies, and
    // `setDamage` damages the ACTIVE only — so the benched Genesect is outside
    // the lock's reach by construction, and that is asserted rather than assumed
    // by the first board below going the other way.
    const locked = (withSecondHolder: boolean): GameState => {
      let state = board(SEEDS[0], "p1", "p1", ARMED);
      if (withSecondHolder) {
        state = benchFromDeck(state, "p1", GENESECT);
        state = attachToolFromDeck(state, "p1", 1, TOOL);
      }
      return turnOf(setActiveFromDeck(state, "p2", TING_LU), "p2");
    };
    // ONE holder, and it is damaged and silenced: the bar is down.
    expect(play(locked(false), "p2", ACE_ITEM)).toBe("OK");
    // TWO holders, the second undamaged and therefore untouched by the lock: the
    // bar is still up. A "any source silenced ⇒ no bar" reader answers "OK" here.
    expect(play(locked(true), "p2", ACE_ITEM)).toBe("HAND_PLAY_BLOCKED");
    // And the plain Item is free on BOTH, so neither answer is the board refusing
    // Trainer plays for some other reason.
    expect(play(locked(false), "p2", ITEM)).toBe("OK");
    expect(play(locked(true), "p2", ITEM)).toBe("OK");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. NOTHING PERSISTED, AND BOTH MIRRORS.
// ─────────────────────────────────────────────────────────────────────────────

describe("D291 §7 — the bar is DERIVED, and the wire greys the row it should", () => {
  it("NOTHING WAS WRITTEN — `handPlayLockedTurn` is empty on both seats on a barred board", () => {
    // The whole difference from D283 stated as a board fact: this bar is derived
    // from the board, so no write happened and the persisted record is untouched.
    // ⚠️ PAIRED WITH THE LITERAL KEY LIST (D279's half-guard rule): a diff between
    // two boards from one build is blind to "every body grew a key".
    const state = turnOf(board(SEEDS[0], "p1", "p1", ARMED), "p2");
    expect(play(state, "p2", ACE_ITEM)).toBe("HAND_PLAY_BLOCKED");
    for (const seat of ["p1", "p2"] as const) {
      expect(state.handPlayLockedTurn[seat]).toEqual({ Item: null, Supporter: null, evolve: null });
      expect(Object.keys(state.handPlayLockedTurn[seat]).sort()).toEqual([
        "Item",
        "Supporter",
        "evolve",
      ]);
    }
  });

  it("🛑 THE WIRE GREYS THE ACE SPEC ROW AND NOT THE PLAIN ONE — and `RedactedCard` gains no field", () => {
    // `redactedTrainersOf` runs SERVER-side over the full catalog `Card`, so the
    // rarity is answerable there and the client is told `disabled` rather than
    // being handed the label. That is the asymmetry D287/D288 had to BUILD for
    // Stadiums, arriving for nothing here.
    const state = turnOf(board(SEEDS[0], "p1", "p1", ARMED), "p2");
    expect(wireDisabled(state, "p2", ACE_ITEM)).toBe(true);
    expect(wireDisabled(state, "p2", ITEM)).toBe(false);
    expect(wireDisabled(state, "p2", ACE_STADIUM)).toBe(true);
    expect(wireDisabled(state, "p2", STADIUM)).toBe(false);
    // ⚠️ AND THE PROJECTION CARRIES NO `rarity` — asserted, because "the client
    // could compute it" is the design this slice deliberately did not take.
    const view = redactGame(state, "p2");
    expect(view.board.you.hand.length).toBeGreaterThan(0);
    for (const card of view.board.you.hand) {
      expect(Object.keys(card)).not.toContain("rarity");
    }
  });

  it("the barring seat's OWN wire rows stay lit on the same board — the mirror's perspective flip", () => {
    const state = turnOf(board(SEEDS[0], "p1", "p1", ARMED), "p1");
    expect(wireDisabled(state, "p1", ACE_ITEM)).toBe(false);
    expect(wireDisabled(state, "p1", ITEM)).toBe(false);
  });
});
