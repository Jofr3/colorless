// @vitest-environment jsdom
// D293 — THE ACE SPEC BAR'S **CLIENT** HALF, DRIVEN — AND THE MEASUREMENT THAT
// RE-TYPES D292's REFUSAL.
//
// ── WHY THIS FILE EXISTS, AND WHAT IT SETTLED BEFORE A LINE WAS DESIGNED ────
//
// D292 built the engine's fourth ACE SPEC surface (`attachEnergy` asks
// `aceSpecPlayBarred`) and REFUSED one row — *"an energy-row playability
// projection on the wire"* — typing its blocker as **CODE plus a SCHEMA FIELD**
// and justifying that with one clause it flagged as its own most-likely-wrong:
//
//   *"the engine gate is authoritative on both transports, so the missing
//    projection is a UX gap and never a rules gap."*
//
// 🛑 **IT FLAGGED THAT CLAUSE BECAUSE THE LOCAL HUD HAD BEEN READ AND NEVER
// DRIVEN.** `GameHud.tsx` renders *"drag an energy to attach"*, and a string
// offering a gesture the rules forbid is a WRONG STRING rather than a missing
// grey — and if the gesture could actually LAND, it would be a rules gap and the
// slice's whole shape would change. **THIS FILE DRIVES IT. §3 IS THAT
// MEASUREMENT AND IT IS THE REASON THE FILE IS ORGANISED THE WAY IT IS.**
//
// ✅ **THE VERDICT: THE CLAUSE HOLDS, AND IT HOLDS BECAUSE OF §3 AND NOT BECAUSE
// OF THE ASSERTION D292 MADE FOR IT.** The drag IS offered on a barred board (the
// coarse gate has no card identity to refuse it with), it DOES translate to a
// real `attachEnergy`, and `applyAction` answers `HAND_PLAY_BLOCKED`. No illegal
// action is reachable through the UI on either transport. **THE GAP IS
// AFFORD-THEN-REJECT — UX — EXACTLY AS D287's STADIUM GAP WAS.**
//
// 🛑 **BUT THE AXIS D292 NAMED IS THE WRONG ONE, AND THAT IS THIS FILE'S REAL
// FINDING.** D292 framed the gap as LOCAL-versus-WIRE: *"an ACE SPEC Item greys
// itself on the wire and an ACE SPEC Energy cannot — there is no row to carry
// `disabled`"*. Driven, the two transports AGREE at every step (§4): both grey
// the ACE SPEC Item, both offer the barred Energy drag, neither has an Energy
// row. **THE AXIS IS BUTTON-VERSUS-DRAG, NOT LOCAL-VERSUS-WIRE** — and the
// drag case was already settled, by name, four slices earlier: D289 §2 asserts
// that a Pokémon TOOL *"has NO row in this list at all — the absence is the
// answer, not a grey"*, because a Tool attaches by drag. **AN ACE SPEC ENERGY IS
// THE TOOL'S CASE**, and §2 below says so on the same board that greys the Item.
//
// ⚠️ **SO THE MISSING MECHANISM IS RE-TYPED** (D293's decision row carries the
// full argument): greying a DRAG needs PER-HAND-CARD playability, and
// `PlacementContext` (placement.ts) deliberately carries no card identity at all
// — it is a phase KIND, a turn bit and a ready bit, kept that way so local and
// online build the SAME gate. On the wire the same bit is a field on
// `redactedCardSchema` — the card schema, reached by hand / discard / attached
// energies / attached tools / in-play tops — and NOT the `z.array` on the phase
// D292 priced, which would be the first row in that phase with no local twin.
//
// ── WHAT WAS UNASSERTED, AND IT IS MORE THAN THE ENERGY ────────────────────
//
// 🛑 **`src/` HAD ZERO ASSERTIONS ABOUT THE ACE SPEC BAR OF ANY KIND.** D291/D292
// recorded a ZERO diff in `src/` and called it by-design. It is by-design AND the
// zero is load-bearing: `playableTrainers` passes the whole `card` to
// `handPlayBarred`, so the rarity arm rides in with no term of its own — which is
// exactly the kind of reach nothing observes until it breaks. D289's suite is the
// nearest thing and every board in it is a CLASS bar (Tyranitar/Items,
// Scream Tail ex/Supporters, Copperajah/Stadiums); a build that dropped the
// `card` argument on GameHud.tsx's line is GREEN on all 18 of its `it`s (measured, not counted by eye).
// **§1 IS THAT BOARD.**
//
// ⚠️ **THE CONTROL IS NOT OPTIONAL, IN BOTH DIRECTIONS.** Every "the ACE SPEC row
// greys" line passes just as happily on a HUD that greyed every row (the §7.5 hand
// cost, the §7 no-target judgement, a `programFor` miss) — so each is paired with
// a PLAIN card of the SAME class from the SAME hand on the SAME board. And every
// "the barred Energy is refused" line passes on an engine that refused every
// Energy attach — so §3 pairs it with `sv02-190`, a SPECIAL Energy one rarity
// away, which must attach `OK` on that same board.
//
// ── 🆕 D303 · THE DRAG POPULATION, RE-QUERIED — AND THE LABEL WAS THE ROT ───
//
// Ten consecutive handoffs carried *"THE ACE SPEC **DRAG POPULATION** (D293's
// `11 = 8 Tools + 3 Energy`) HAS STILL NEVER BEEN RE-QUERIED"*, and the standing
// advice was to expect the NUMBER to be wrong the way D301's `24` was — an
// operand from one footing against an operand from another. **RE-QUERIED, BOTH
// OPERANDS ARE EXACTLY RIGHT.** 8 Tools, 3 Energy, 20 Items, 2 Stadiums, 33 in
// total, every one `legal_standard = 1` — D291's table reproduced to the row.
//
// 🛑 **THE DEFECT IS IN THE LABEL, AND A LABEL CANNOT BE RE-DERIVED BY RE-RUNNING
// THE QUERY THAT PRODUCED THE NUMBER.** `11` is the size of the set with NO ROW
// IN THE TRAINERS LIST — the set §2 is about — and it is correct as that.
// It is NOT "the drag population": `placement.ts`'s drop gate answers for FOUR
// source types, and one of them is **`stadium`** (its arm is three lines below
// the Tool's). So the set a barred seat can still GESTURE is **13**, and the two
// ACE SPEC Stadiums `sv06.5-060` / `sv07-136` are in BOTH sets at once — greyed
// as a button by §1.3 and offered as a drag by §6.3, on ONE render of ONE board.
//
// ⚠️ **SO THE GREY §1.3 ASSERTS BUYS LESS THAN IT LOOKS.** It is not wrong and it
// is not useless — the button is the surface most players use — but "the ACE SPEC
// Stadium is greyed" and "the ACE SPEC Stadium cannot be played" are different
// claims, and only the first was ever asserted. The engine still refuses
// (`HAND_PLAY_BLOCKED` on all four seeds), so this remains AFFORD-THEN-REJECT and
// never a rules gap — D293's verdict is unchanged and now covers three surfaces
// instead of one.
//
// ⚠️ **AND THE ACE SPEC TOOL DRAG HAD NEVER BEEN DRIVEN AT ALL.** §2 asserts the
// Tool has no ROW; that is a statement about the button list, and every slice
// since read it as though it settled the drag. §6.6 drives it: offered,
// translated to a real `attachTool`, refused. **AN ABSENCE ASSERTED ON ONE
// SURFACE IS NOT A MEASUREMENT ON ANOTHER.**

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { GameState, Seat } from "@luminous/engine";
import { applyAction, createGame, redactGame } from "@luminous/engine";
import type { Card } from "@luminous/schema";
import {
  FIXTURE_POOL,
  attachToolFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  handFromDeck,
  handUid,
  setActiveFromDeck,
  setDamage,
  specialEnergy,
  trainerCard,
} from "../../../packages/engine/src/testFixtures";
import type { BoardState } from "../playmat/types";
import { installDomShims } from "../../test/domShims";
import { GameHud } from "./GameHud";
import { moveToAction } from "./moveToAction";
import { gamePlacementPredicate, placementPredicateFor } from "./placement";
import { projectGameState, projectionFromRedacted } from "./projection";

beforeAll(installDomShims);
afterEach(cleanup);

const NAMES = { p1: "Ember", p2: "Tide" } as const;

// ─────────────────────────────────────────────────────────────────────────────
// The printed strings and ids, byte-exact off the engine suite that owns them
// (`aceSpecBar.test.ts`), so a divergence shows up in a diff and not only in a
// failure.
// ─────────────────────────────────────────────────────────────────────────────

const ACE_NULLIFIER_TEXT =
  "If this Pokémon has a Pokémon Tool attached, your opponent can't play any ACE SPEC cards from their hand.";

/** Genesect `sv06.5-040` "ACE Nullifier" — the one printing of this mechanism.
    ⚠️ ITS OWN rarity is "Uncommon": the barring body is not an ACE SPEC. */
const GENESECT = "sv06.5-040";
/** Dangerous Laser `sv06.5-058` — an ACE SPEC **Item** with a registry row and a
    precondition every board here satisfies (a damaged own Pokémon). */
const ACE_ITEM = "sv06.5-058";
/** Potion `sv01-188` — a plain Item, the class-matched control. Same precondition. */
const ITEM = "sv01-188";
/** Neutralization Zone `sv06.5-060` — the catalog's ACE SPEC **Stadium** that
    carries a registry row. The SECOND button surface, so §1 is not a one-class
    board. */
const ACE_STADIUM = "sv06.5-060";
/** Beach Court `sv01-167` — a plain Stadium, the surface-matched control. */
const STADIUM = "sv01-167";
/** Maximum Belt `sv08.5-117` — an ACE SPEC **Tool**. It has no row in this list;
    §2 pins that beside the Energy, because the two are the SAME case. */
const ACE_TOOL = "sv08.5-117";
/** Vitality Band `sv01-197` — a plain Tool, and ALSO the card Genesect wears to
    open its own window. One fixture, both jobs, exactly as the engine suite does. */
const TOOL = "sv01-197";
/** Enriching Energy `sv08-191` — an ACE SPEC **Special Energy**, D292's surface
    and this file's subject. */
const ACE_ENERGY = "sv08-191";
/** Jet Energy `sv02-190` — a SPECIAL Energy that is NOT an ACE SPEC, and the
    sharpest control in the file: every "the Energy is refused" line below passes
    on a build that refused every Special Energy attach, and only this card can
    tell the RARITY axis from the SUBTYPE one. ⚠️ Its on-attach program fires on a
    BENCH attach only and every attach below aims at the Active, so its own rider
    never runs. */
const SPECIAL_ENERGY = "sv02-190";

/** 🆕 **D303 — THE WHOLE ACE SPEC POPULATION, RE-QUERIED AND TRANSCRIBED BY ID.**
    Remote D1 `luminous` (`735f0fb5-cdc3-494d-8b97-74a8ade0124a`), 2026-08-09:

        SELECT rarity, category, trainer_type, legal_standard, COUNT(*)
          FROM cards WHERE instr(rarity, 'ACE SPEC') > 0
         GROUP BY rarity, category, trainer_type, legal_standard;

    ✅ **THE 33 AND THE 20 / 8 / 2 / 3 SPLIT BOTH HELD EXACTLY** against D291's
    table, two set rotations later, and `legal_standard = 1` on every one of the
    33 — so no rung here mixes a raw operand with a legal one (D301's defect).
    ⚠️ **THE ATTRIBUTION CONTROL**: `instr(effect,'ACE SPEC') > 0` returns **ZERO**
    rows, so `rarity` is the ONLY marker in this catalog and a text-keyed census
    would have found nothing at all.
    🛑 **THE IDS ARE HERE RATHER THAN THE COUNTS** because the number was never the
    rotten part — the SET was. */
const ACE_SPEC_D1 = {
  item: [
    "sv05-141", "sv05-153", "sv05-157", "sv05-158", "sv06-152",
    "sv06-162", "sv06-163", "sv06-165", "sv06.5-058", "sv06.5-062",
    "sv08-164", "sv08-176", "sv08-182", "sv08-183", "sv08-185",
    "sv08-186", "sv08.5-116", "sv08.5-119", "sv08.5-128", "sv08.5-131",
  ],
  stadium: ["sv06.5-060", "sv07-136"],
  tool: [
    "sv05-152", "sv05-154", "sv06-164", "sv07-134",
    "sv07-142", "sv08-162", "sv08.5-117", "sv08.5-129",
  ],
  energy: ["sv05-162", "sv06-167", "sv08-191"],
} as const;

/** The victim's Active — 340 HP, so nothing here can Knock it Out and park the
    board on `ko:takePrizes`, where every refusal would be green at the PHASE gate
    instead of at the rule under test. */
const WALL = "fix-ace-wall";
/** The CONTROL body: same board, same hands, no Ability at all. */
const PLAIN = "fix-ace-plain";

// ── the local pool (FIXTURE_POOL is left untouched — D190's idiom) ───────────

function genesect(id: string): Card {
  return battler(id, {
    name: "Genesect",
    hp: 110,
    retreat: 1,
    types: ["Metal"],
    stage: "Basic",
    rarity: "Uncommon",
    abilities: [{ type: "Ability", name: "ACE Nullifier", effect: ACE_NULLIFIER_TEXT }],
  });
}

/** A catalog printing with its REAL rarity — the field this whole rule reads,
    and the one `blank` leaves `null` on every engine fixture. */
function priced(id: string, rarity: string | null, card: Card): Card {
  return { ...card, id, rarity };
}

const LOCAL_CARDS: Record<string, Card> = {
  [GENESECT]: genesect(GENESECT),
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

/** The printings `FIXTURE_POOL` does not carry, written from their D1 rows.
    ⚠️ THE IDS ARE REAL AND EACH ALREADY HAS A REGISTRY PROGRAM, so a greyed row
    here can only ever be a RULE and never the coverage strategy. */
const NEW_PRINTINGS: Record<string, Card> = {
  [ACE_ITEM]: trainerCard(
    ACE_ITEM,
    "Item",
    "Your opponent's Active Pokémon is now Burned and Confused.",
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
/** ⚠️ **THE RARITY IS STAMPED ONTO THE SHARED FIXTURES RATHER THAN INVENTED.**
    Each id is a REAL catalog printing; only `rarity` is set, to the exact string
    the remote D1 carries. A fixture that made up a RARITY would be testing this
    file's opinion of the catalog. */
const RARITIES: Record<string, string> = {
  [ACE_ITEM]: "ACE SPEC Rare",
  [ACE_STADIUM]: "ACE SPEC Rare",
  [ACE_TOOL]: "ACE SPEC Rare",
  [ACE_ENERGY]: "ACE SPEC Rare",
  [ITEM]: "Common",
  [STADIUM]: "Uncommon",
  [TOOL]: "Uncommon",
  [SPECIAL_ENERGY]: "Uncommon",
};
for (const [id, rarity] of Object.entries(RARITIES)) {
  const base = POOL[id];
  if (base === undefined) throw new Error(`POOL has no ${id}`);
  POOL[id] = priced(id, rarity, base);
}

/** This suite's own seeded deck (D270's rule), 60 exactly.
    ⚠️ **THE BASIC COUNT IS 23 AND THAT IS THE BUDGET, NOT A COINCIDENCE** —
    D292's fixture failed on an UNRELATED Item because paying for a new row out
    of the Basics multiplied the mulligans and drained the deck. Every non-Basic
    row below is at four or five copies because each is pulled out of the DECK by
    `handFromDeck` after a 13-card setup draw, on four seeds, from BOTH seats. */
const ACE_DECK = deckOf({
  [GENESECT]: 5,
  [PLAIN]: 5,
  [WALL]: 5,
  "fix-basic-1": 6,
  [ACE_ITEM]: 5,
  [ITEM]: 5,
  [ACE_STADIUM]: 5,
  [STADIUM]: 5,
  [ACE_TOOL]: 5,
  [ACE_ENERGY]: 5,
  [SPECIAL_ENERGY]: 5,
  // ⚠️ FOUR, NOT FIVE: `TOOL` is pulled ONCE per board (P2's `attachToolFromDeck`)
  // where every row above it is pulled TWICE (both seats' hands). Four copies of a
  // seven-row hand-pull ran the deck dry on one seed of four — the depth here is
  // measured, not chosen.
  [TOOL]: 4,
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

/** D275's `localSetup` with the FIRST PLAYER as a parameter — a one-seat board is
    vacuous on a per-seat fact, and "whose hand is barred" is exactly one.
    ⚠️ `driveSetup` cannot be reused: it hard-wires `FIXTURE_POOL`, and the
    barring body here is a LOCAL card. */
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

/** Walk the clock so `seat` is the one to move, at turn 3 or later so §4's
    first-turn bans are spent. A bar and its absence are only observable on the
    barred player's OWN turn. */
function turnOf(state: GameState, seat: Seat): GameState {
  let next = state;
  for (let i = 0; i < 12; i += 1) {
    if (next.phase.kind !== "turn:action") throw new Error(`stuck in ${next.phase.kind}`);
    if (next.phase.seat === seat && next.turn >= 3) return next;
    next = must(applyAction(next, { type: "endTurn", seat: next.phase.seat }));
  }
  throw new Error(`never reached ${seat}'s turn`);
}

/** **THE BOARD EVERY SECTION SHARES.** It is P1's turn; P2 (the opponent) holds
    the barring body, `armed` deciding whether it is a Tool-wearing Genesect or a
    body that prints nothing at all. **BOTH SEATS HOLD EVERY CARD UNDER TEST**, so
    §1.4 can assert the BARRING seat's own rows stay lit on the very board that
    greys the victim's.
    ⚠️ THE BENCH IS ALWAYS FILLED — §14.2 makes an empty Bench a LOSS the moment
    the Active leaves, and a `gameOver` board proves nothing about a bar.
    ⚠️ BOTH SEATS ARE DAMAGED so Potion always has a legal target and a grey at the
    Item row can only ever be the rule under test. */
function board(seed: number, armed: boolean, mover: Seat = "p1"): GameState {
  let state = localSetup(seed, "p2");
  state = setActiveFromDeck(state, "p2", armed ? GENESECT : PLAIN);
  state = clearBench(state, "p2");
  state = benchFromDeck(state, "p2", PLAIN);
  if (armed) state = attachToolFromDeck(state, "p2", "active", TOOL);
  state = setActiveFromDeck(state, "p1", WALL);
  state = clearBench(state, "p1");
  state = benchFromDeck(state, "p1", "fix-basic-1");
  for (const seat of ["p1", "p2"] as const) {
    for (const id of [ACE_ITEM, ITEM, ACE_STADIUM, STADIUM, ACE_TOOL, ACE_ENERGY, SPECIAL_ENERGY]) {
      state = handFromDeck(state, seat, id, 1);
    }
    state = setDamage(state, seat, 10);
  }
  return turnOf(state, mover);
}

function renderHud(state: GameState, seat: Seat = "p1") {
  render(
    <GameHud
      game={state}
      projection={projectGameState(state, seat)}
      viewerSeat={seat}
      names={NAMES}
      dispatch={vi.fn()}
      onPlayAgain={() => {}}
    />,
  );
}

/** The row's `disabled` bit. ⚠️ `getByRole` THROWS when the row is absent, which
    is what this helper wants: "no row at all" and "a greyed row" are two
    different findings and must never collapse into one (D289's rule). */
function rowDisabled(name: string): boolean {
  return (screen.getByRole("button", { name }) as HTMLButtonElement).disabled;
}

/** **THE THREE STEPS OF A DRAG, RUN IN ORDER ON ONE BOARD.** The drop gate that
    decides whether the playmat OFFERS the release, the router that turns the
    release into an action, and the engine's verdict on that action. Returning all
    three is the point: "offered" and "legal" are different questions and this
    file's whole finding is that they disagree. */
function dragFromHand(
  state: GameState,
  cardId: string,
  sourceType: "energy" | "tool" | "stadium",
  to: { owner: "you"; zone: "active" } | { owner: "global"; zone: "stadium" },
): { offered: boolean; action: string | null; verdict: string } {
  const uid = handUid(state, "p1", cardId);
  const projected = projectGameState(state, "p1");
  const index = projected.board.you.hand.findIndex((c) => c.id === uid);
  if (index < 0) throw new Error(`${cardId} is not in p1's projected hand`);
  const offered = gamePlacementPredicate(state, "p1")(
    projected.board,
    { owner: "you", zone: "hand", index },
    to,
    sourceType,
  );
  const action = moveToAction(
    { cardId: uid, from: { owner: "you", zone: "hand", index }, to },
    { viewerSeat: "p1", phaseKind: "turn:action", isViewerTurn: true, board: projected.board },
  );
  if (action === null) return { offered, action: null, verdict: "NO ACTION" };
  const result = applyAction(state, action);
  return { offered, action: action.type, verdict: result.ok ? "OK" : result.error.code };
}

function dragEnergyToActive(
  state: GameState,
  cardId: string,
): { offered: boolean; action: string | null; verdict: string } {
  return dragFromHand(state, cardId, "energy", { owner: "you", zone: "active" });
}

// ─────────────────────────────────────────────────────────────────────────────
describe("D293 §1 — the RARITY bar reaches the local Trainers list, and `src/` never said so", () => {
  it("🛑 THE ACE SPEC ITEM ROW GREYS AND THE PLAIN ITEM STAYS LIT — one render, one rarity apart", () => {
    // **THE ASSERTION `src/` HAS NEVER CARRIED.** `playableTrainers` passes the
    // whole `card` to `handPlayBarred`, so D291's rarity arm rides in with no term
    // of its own. A build that passed `undefined` there — dropping the arm and
    // keeping every class bar — is GREEN on all of D289's boards and red here.
    for (const seed of SEEDS) {
      renderHud(board(seed, true));
      expect(rowDisabled(ACE_ITEM)).toBe(true);
      expect(rowDisabled(ITEM)).toBe(false);
      cleanup();
    }
  });

  it("🛑 THE CONTROL — the same board under a body that prints NOTHING leaves both lit", () => {
    // Without this, "the row greys" is equally true of a HUD that greyed the row
    // for the §7.5 hand cost, the §7 no-target judgement or a `programFor` miss.
    for (const seed of SEEDS) {
      renderHud(board(seed, false));
      expect(rowDisabled(ACE_ITEM)).toBe(false);
      expect(rowDisabled(ITEM)).toBe(false);
      cleanup();
    }
  });

  it("🛑 THE ACE SPEC STADIUM ROW GREYS TOO, AND THE PLAIN STADIUM DOES NOT", () => {
    // The bar names NO class, so it must cross the class partition — and the
    // Stadium row reaches `playableTrainers` through a different arm than the Item
    // (D287). A one-class board could not tell a rarity reader from a class one.
    for (const seed of SEEDS) {
      renderHud(board(seed, true));
      expect(rowDisabled("Neutralization Zone")).toBe(true);
      expect(rowDisabled("Beach Court")).toBe(false);
      cleanup();
    }
  });

  it("the BARRING seat's own rows stay lit on that same board — the sentence says *your opponent*", () => {
    // ⚠️ THE PERSPECTIVE IS THE EASY ONE TO INVERT. Both seats hold both cards, so
    // this is the same board seen from the other chair rather than a second
    // fixture. ⚠️ **THE CLOCK MUST MOVE TOO**: the Turn-actions panel renders only
    // for the seat that is `waitingOn`, so a P2 render on P1's turn is an EMPTY
    // document and every assertion here would throw rather than pass. Measured,
    // not assumed — the first version of this `it` did exactly that.
    for (const seed of SEEDS) {
      renderHud(board(seed, true, "p2"), "p2");
      expect(rowDisabled(ACE_ITEM)).toBe(false);
      expect(rowDisabled("Neutralization Zone")).toBe(false);
      cleanup();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("D293 §2 — the ACE SPEC ENERGY has NO row, and that is the TOOL's answer", () => {
  it("🛑 NO ENERGY ROW EXISTS AT ALL — and the Item row on the SAME render is greyed", () => {
    // **THE MEASUREMENT THAT RE-TYPES D292's REFUSAL.** D292 priced an `energies`
    // array on the redacted phase because *"there is no row to carry `disabled`"*.
    // There is no row on the LOCAL surface either, and the local list is the wire
    // list's twin — so the absence is symmetric and is not a wire defect.
    // `queryByRole` (not `getByRole`) because the assertion IS the absence; the
    // greyed Item beside it is what stops this passing on a list that failed to
    // render.
    renderHud(board(SEEDS[0], true));
    expect(screen.queryByRole("button", { name: "Enriching Energy" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Jet Energy" })).toBeNull();
    expect(rowDisabled(ACE_ITEM)).toBe(true);
  });

  it("🛑 AND NEITHER DOES THE ACE SPEC **TOOL** — the two are one case, not two", () => {
    // D289 §2 settled this for Tools by name: *"a Tool attaches by board DRAG,
    // never a Trainers-list button, so the local HUD honours that half of the
    // sentence by having nothing to honour."* An Energy attaches by the same
    // gesture through the same predicate branch (placement.ts pairs them
    // explicitly). **THE AXIS IS BUTTON-VERSUS-DRAG.**
    renderHud(board(SEEDS[0], true));
    expect(screen.queryByRole("button", { name: ACE_TOOL })).toBeNull();
    expect(screen.queryByRole("button", { name: TOOL })).toBeNull();
    expect(rowDisabled("Neutralization Zone")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("D293 §3 — the drag is OFFERED and the engine REFUSES: UX, never rules", () => {
  it("🛑 THE WHOLE FINDING IN ONE BOARD — offered, translated, and refused HAND_PLAY_BLOCKED", () => {
    // **THE MEASUREMENT D292 NEVER MADE.** Three steps in order on one barred
    // board: the drop gate OFFERS the release (it has a phase kind, a turn bit and
    // a ready bit — no card identity to refuse with), `moveToAction` translates it
    // to a real `attachEnergy`, and `applyAction` answers `HAND_PLAY_BLOCKED`.
    // **THE ILLEGAL ACTION IS NEVER REACHABLE, SO THE GAP IS AFFORD-THEN-REJECT
    // AND NOT A RULES GAP** — D292's flagged clause, held on a drive rather than
    // on an assertion about it.
    for (const seed of SEEDS) {
      expect(dragEnergyToActive(board(seed, true), ACE_ENERGY), `${seed}`).toEqual({
        offered: true,
        action: "attachEnergy",
        verdict: "HAND_PLAY_BLOCKED",
      });
    }
  });

  it("🛑 THE CONTROL — the plain Special Energy takes the SAME three steps and lands OK", () => {
    // Every line above passes on a build that refused every Energy attach, or that
    // keyed on "is a Special Energy". `sv02-190` is a SPECIAL Energy that is not an
    // ACE SPEC: same category, same subtype, same hand, same board, one rarity
    // apart. ⚠️ Note `offered` is IDENTICAL for both cards — the drop gate cannot
    // tell them apart, which is precisely the mechanism §2 refuses to fake.
    for (const seed of SEEDS) {
      expect(dragEnergyToActive(board(seed, true), SPECIAL_ENERGY), `${seed}`).toEqual({
        offered: true,
        action: "attachEnergy",
        verdict: "OK",
      });
    }
  });

  it("and on the UNARMED board the very same ACE SPEC Energy attaches — the bar is the difference", () => {
    for (const seed of SEEDS) {
      expect(dragEnergyToActive(board(seed, false), ACE_ENERGY), `${seed}`).toEqual({
        offered: true,
        action: "attachEnergy",
        verdict: "OK",
      });
    }
  });

  it("🛑 A REFUSED DRAG COSTS THE SEAT NOTHING — the §6.2 allowance is unspent and the card is in hand", () => {
    // The afford-then-reject defect is only survivable because the refusal is
    // free. If the barred attach spent `energyAttached`, the wrong string in §5
    // would be the least of it: the player would lose the turn's attach to a
    // gesture the rules never let them make.
    const state = board(SEEDS[0], true);
    const uid = handUid(state, "p1", ACE_ENERGY);
    const result = applyAction(state, {
      type: "attachEnergy",
      seat: "p1",
      uid,
      target: { spot: "active" },
    });
    expect(result.ok).toBe(false);
    expect(state.allowances.energyAttached).toBe(false);
    expect(state.players.p1.hand).toContain(uid);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("D293 §4 — the WIRE agrees with the local board at every step", () => {
  // 🛑 **THE SECTION THAT CORRECTS D292's AXIS.** Its refusal reads as a
  // local-versus-wire asymmetry. Driven, there is none: the same Item greys, the
  // same drag is offered, the same Energy has no row.

  it("🛑 THE WIRE GREYS THE SAME ITEM ROW THE LOCAL HUD GREYS, AND LEAVES THE SAME ONE LIT", () => {
    const state = board(SEEDS[0], true);
    const wire = redactGame(state, "p1");
    if (wire.phase.kind !== "turn:action") throw new Error("expected turn:action");
    const row = (name: string) => wire.phase.kind === "turn:action"
      ? wire.phase.trainers.find((t) => t.name === name)
      : undefined;
    expect(row(ACE_ITEM)?.disabled).toBe(true);
    expect(row(ITEM)?.disabled).toBe(false);
    expect(row("Neutralization Zone")?.disabled).toBe(true);
    expect(row("Beach Court")?.disabled).toBe(false);
  });

  it("🛑 THE REDACTED `turn:action` CARRIES EXACTLY THESE SEVEN KEYS — the LITERAL anchor", () => {
    // ⚠️ **A LITERAL KEY LIST, NOT A DIFF** (D279's half-guard rule): a comparison
    // between two boards of one build is blind to "the phase grew a key". This is
    // the assertion that goes red the day an `energies` / `playables` array is
    // added, which is exactly the design call D293 refuses — so the refusal is
    // observable rather than merely written down.
    const wire = redactGame(board(SEEDS[0], true), "p1");
    expect(Object.keys(wire.phase).sort()).toEqual([
      "abilities",
      "attacks",
      "kind",
      "rareCandy",
      "retreat",
      "stadiumAbility",
      "trainers",
    ]);
    if (wire.phase.kind !== "turn:action") throw new Error("expected turn:action");
    // …and NO row in it is the Energy, on a board holding two of them.
    for (const trainer of wire.phase.trainers) {
      expect(trainer.name).not.toBe("Enriching Energy");
      expect(trainer.name).not.toBe("Jet Energy");
    }
  });

  it("🛑 THE ONLINE DROP GATE OFFERS THE SAME BARRED DRAG THE LOCAL ONE OFFERS", () => {
    // `placementPredicateFor` is the transport-agnostic half `gamePlacementPredicate`
    // wraps, and this drives it off a REDACTED board rather than a `GameState`.
    // Both answer `true` — so an online seat gestures and learns the rule from the
    // pill, exactly as a local one does. **No transport is more permissive than the
    // other, and neither can land the play.**
    const state = board(SEEDS[0], true);
    const wire = redactGame(state, "p1");
    const projected = projectionFromRedacted(wire);
    const gate = placementPredicateFor({
      phaseKind: wire.phase.kind,
      isViewerTurn: wire.activePlayer === "you" && wire.phase.kind === "turn:action",
      isReady: false,
    });
    const offered = (board: BoardState, index: number) =>
      gate(
        board,
        { owner: "you", zone: "hand", index },
        { owner: "you", zone: "active" },
        "energy",
      );
    const index = projected.board.you.hand.findIndex((c) => c.type === "energy");
    expect(index).toBeGreaterThanOrEqual(0);
    expect(offered(projected.board, index)).toBe(true);
    // ⚠️ AND THE REDACTED HAND CARRIES NO PLAYABILITY BIT TO HAVE READ — the field
    // D293 refuses to add, asserted as absent so its arrival is a red line here.
    for (const card of wire.board.you.hand) {
      expect(Object.keys(card)).not.toContain("disabled");
      expect(Object.keys(card)).not.toContain("rarity");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("D293 §5 — the hint string is an ALLOWANCE hint and not an affordance", () => {
  it("🛑 *drag an energy to attach* RENDERS IDENTICALLY ON THE BARRED AND THE FREE BOARD", () => {
    // D292's handoff suspected this string of being a WRONG STRING on a barred
    // board. **DRIVEN, IT IS NOT ABOUT THE CARD AT ALL**: it reads
    // `game.allowances.energyAttached` and nothing else, so it says the same thing
    // on both boards and would say it on a board holding no Energy whatsoever.
    // It is a §6.2 allowance readout wearing a gesture's words — a pre-existing
    // looseness with no ACE SPEC in it, and NOT the gap D292 was reaching for.
    renderHud(board(SEEDS[0], true));
    expect(screen.getByText(/drag an energy to attach/)).not.toBeNull();
    cleanup();
    renderHud(board(SEEDS[0], false));
    expect(screen.getByText(/drag an energy to attach/)).not.toBeNull();
  });

  it("and it flips on the ALLOWANCE, which a refused barred drag never spends", () => {
    // The other half of the same claim: the string tracks `energyAttached`, so the
    // only thing that changes it is a SUCCESSFUL attach. The barred seat's refused
    // drag leaves it exactly where it was (§3.4), so the hint is still offered
    // after the refusal — which is what makes it a UX defect and a real one.
    const state = board(SEEDS[0], true);
    const spent = must(
      applyAction(state, {
        type: "attachEnergy",
        seat: "p1",
        uid: handUid(state, "p1", SPECIAL_ENERGY),
        target: { spot: "active" },
      }),
    );
    expect(spent.allowances.energyAttached).toBe(true);
    renderHud(spent);
    expect(screen.queryByText(/drag an energy to attach/)).toBeNull();
    expect(screen.getByText(/energy attached ✓/)).not.toBeNull();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
describe("D303 §6 — the DRAG population, re-queried and re-partitioned: it is 13, not 11", () => {
  it("the D1 census partitions the 33 with NOTHING LEFT OVER, at 20 / 2 / 8 / 3", () => {
    // ⚠️ The weld. Without this the four lists below are ids somebody liked.
    expect(ACE_SPEC_D1.item.length).toBe(20);
    expect(ACE_SPEC_D1.stadium.length).toBe(2);
    expect(ACE_SPEC_D1.tool.length).toBe(8);
    expect(ACE_SPEC_D1.energy.length).toBe(3);
    const all = [
      ...ACE_SPEC_D1.item,
      ...ACE_SPEC_D1.stadium,
      ...ACE_SPEC_D1.tool,
      ...ACE_SPEC_D1.energy,
    ];
    expect(all.length).toBe(33);
    expect(new Set(all).size).toBe(33);
    // And the cards this file actually drives are MEMBERS, so a set rotation that
    // renamed one of them reddens here rather than silently testing a fixture.
    expect(ACE_SPEC_D1.item).toContain(ACE_ITEM);
    expect(ACE_SPEC_D1.stadium).toContain(ACE_STADIUM);
    expect(ACE_SPEC_D1.tool).toContain(ACE_TOOL);
    expect(ACE_SPEC_D1.energy).toContain(ACE_ENERGY);
  });

  it("🛑 THE CORRECTION — 11 is the NO-ROW set and 13 is the DRAG-REACHABLE one, and the Stadium is in BOTH", () => {
    // 🛑 THE HANDOFF CARRIED *"the ACE SPEC DRAG POPULATION = 11 = 8 Tools + 3
    // Energy"* through ten slices. **BOTH OPERANDS ARE RIGHT AND THE LABEL IS
    // WRONG.** A Tool and an Energy have no row in the Trainers list at all (§2),
    // so 11 is exactly the size of the set that CANNOT be greyed. But `placement.ts`
    // offers a drop for FOUR source types — energy, pokemon, tool and **stadium** —
    // so the set a barred seat can still GESTURE is 8 + 3 + **2**. The two ACE SPEC
    // Stadiums are greyed on one surface and offered on the other, which is why no
    // single number describes them and why this is a partition rather than a fix.
    const noRow = [...ACE_SPEC_D1.tool, ...ACE_SPEC_D1.energy];
    const dragReachable = [...ACE_SPEC_D1.stadium, ...noRow];
    const buttonRow = [...ACE_SPEC_D1.item, ...ACE_SPEC_D1.stadium];
    expect(noRow.length).toBe(11);
    expect(dragReachable.length).toBe(13);
    expect(buttonRow.length).toBe(22);
    // The overlap IS the finding: 22 + 11 = 33 and 22 + 13 = 35, so the two sets
    // cannot both be complements of one another.
    expect(buttonRow.length + noRow.length).toBe(33);
    for (const id of ACE_SPEC_D1.stadium) {
      expect(dragReachable, id).toContain(id);
      expect(buttonRow, id).toContain(id);
    }
  });

  it("🛑 THE ACE SPEC **STADIUM** GREYS ITS BUTTON AND OFFERS ITS DRAG — one card, one board, two answers", () => {
    // **THE MEASUREMENT NOBODY MADE.** §1.3 already asserts the grey; this asserts
    // that the grey buys nothing, because the same card reaches `playTrainer`
    // through the playmat on the very same board.
    for (const seed of SEEDS) {
      const state = board(seed, true);
      renderHud(state);
      expect(rowDisabled("Neutralization Zone"), `${seed}`).toBe(true);
      cleanup();
      expect(
        dragFromHand(state, ACE_STADIUM, "stadium", { owner: "global", zone: "stadium" }),
        `${seed}`,
      ).toEqual({ offered: true, action: "playTrainer", verdict: "HAND_PLAY_BLOCKED" });
    }
  });

  it("🛑 THE CONTROL — the plain Stadium takes the SAME three steps on that board and lands OK", () => {
    for (const seed of SEEDS) {
      expect(
        dragFromHand(board(seed, true), STADIUM, "stadium", { owner: "global", zone: "stadium" }),
        `${seed}`,
      ).toEqual({ offered: true, action: "playTrainer", verdict: "OK" });
    }
  });

  it("and on the UNARMED board the very same ACE SPEC Stadium lands — the bar is the difference", () => {
    for (const seed of SEEDS) {
      expect(
        dragFromHand(board(seed, false), ACE_STADIUM, "stadium", { owner: "global", zone: "stadium" }),
        `${seed}`,
      ).toEqual({ offered: true, action: "playTrainer", verdict: "OK" });
    }
  });

  it("🛑 AND THE ACE SPEC **TOOL** DRAG — the surface §2 named by absence and no suite ever drove", () => {
    // §2 asserts the Tool has NO row. That is a statement about the BUTTON list and
    // says nothing about what the playmat offers. Driven: offered, translated to a
    // real `attachTool`, refused `HAND_PLAY_BLOCKED` — the Energy's case exactly,
    // which is what makes "an ACE SPEC Energy is the Tool's case" a measurement.
    for (const seed of SEEDS) {
      expect(
        dragFromHand(board(seed, true), ACE_TOOL, "tool", { owner: "you", zone: "active" }),
        `${seed}`,
      ).toEqual({ offered: true, action: "attachTool", verdict: "HAND_PLAY_BLOCKED" });
    }
  });

  it("🛑 THE CONTROL — a PLAIN Tool attaches on that same armed board", () => {
    // Dealt here rather than in `board`, because every row in that hand is pulled
    // for BOTH seats and the deck's Tool depth is measured (see `ACE_DECK`).
    for (const seed of SEEDS) {
      const state = handFromDeck(board(seed, true), "p1", TOOL, 1);
      expect(
        dragFromHand(state, TOOL, "tool", { owner: "you", zone: "active" }),
        `${seed}`,
      ).toEqual({ offered: true, action: "attachTool", verdict: "OK" });
    }
  });

  it("and on the UNARMED board the very same ACE SPEC Tool attaches", () => {
    for (const seed of SEEDS) {
      expect(
        dragFromHand(board(seed, false), ACE_TOOL, "tool", { owner: "you", zone: "active" }),
        `${seed}`,
      ).toEqual({ offered: true, action: "attachTool", verdict: "OK" });
    }
  });
});
