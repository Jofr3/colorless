import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { deriveAttackEffect } from "./effects";
import { applyAction, createGame } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import { programFor } from "./registry";
import {
  FIXTURE_POOL,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  setActiveFromDeck,
  typedEnergy,
} from "./testFixtures";

// ── D339 — MAUSHOLD `sv08-158` "FAMILIAL MARCH", THE SIXTH AND LAST PRINTING OF
//    *"search … in any combination of"*. THIS ROW CLOSES THE GRAMMAR. ──────────
//
// ── THE PRINTED SENTENCE ────────────────────────────────────────────────────
//   "Search your deck for **up to 2 in any combination of Maushold and Maushold
//    ex** and put them onto your Bench. Then, shuffle your deck."
//   ATTACK index 0, cost {C}, no printed damage. **1 Standard-legal printing.**
//
// ── THE CENSUS, RE-RUN AT THIS HEAD OVER ALL THREE TEXT COLUMNS ─────────────
// Every figure re-queried against remote D1 `luminous` (3,786 rows, 2,021
// `legal_standard`) on 2026-08-15 rather than inherited from the work order, at
// two widths and two word orders, and every per-column split re-added against its
// own total.
//
//   (a) THE JOINER — `instr(<col>,'in any combination of') > 0`:
//         `effect`         15 rows / 10 legal
//         `attacks_json`    4 rows /  3 legal
//         `abilities_json`  0 rows /  0 legal
//       TOTAL 19 printings / 13 legal.  15 + 4 + 0 = 19 ✅  10 + 3 + 0 = 13 ✅
//
//   (b) THE GRAMMAR — the joiner UNDER THIS VERB, which is the population that
//       matters: `instr(<col>,'Search your deck for up to') > 0 AND
//       instr(<col>,'any combination') > 0`:
//         `effect`          3 rows / 3 legal — Ethan's Adventure ×3 (BUILT, D337)
//         `attacks_json`    3 rows / 3 legal — Heatmor ×2 (BUILT, D338),
//                                              Maushold ×1 (**THIS ROW**)
//         `abilities_json`  0 rows / 0 legal
//       TOTAL 6 printings / 6 legal.  3 + 3 + 0 = 6 ✅
//
// 🛑 **(a) MINUS (b) IS THE FINDING, AND IT IS WHY THE WIDE NET IS NOT THE
//    GRAMMAR.** Twelve of the `effect` column's fifteen carry the joiner under a
//    DIFFERENT VERB — `Put up to 4 …` (Roxanne-shaped discard retrieval), `Shuffle
//    up to 3 …`, `Look at the top 7 …`, and `sv10-182`'s *"it provides 2 in any
//    combination of {P} Energy and {D} Energy"*, which is not a retrieval at all.
//    And `attacks_json`'s fourth row is `sv03-098` *"Put up to 2 in any combination
//    of Item cards and Pokémon Tool cards **from your discard pile**"*, which is
//    both a different verb and `legal_standard = 0`. **THE VERB IS THE GRAMMAR;
//    THE JOINER IS NOT.** A census keyed on the joiner alone would have reported
//    13 legal printings for a family with 6.
//
// ✅ **SO THE GRAMMAR CLOSES AT 6 OF 6 WITH THIS ROW.** 3 built at D337 + 2 built
//    at D338 + 1 here = 6, and (b) says there is no seventh legal printing in any
//    of the three text columns. **After this row the family has no unbuilt legal
//    printing left**, which is asserted as arithmetic in §7 rather than claimed.
//
//   (c) THE ATTACKER, measured rather than assumed — `sv08-158` carries
//       `legal_standard = 1`, `category = 'Pokemon'`, `stage = 'Stage1'`,
//       `evolve_from = 'Tandemaus'`, `types_json = ["Colorless"]`,
//       `abilities_json IS NULL`, `effect IS NULL`, `length(attacks_json) = 324`.
//       So no ability reader, no trainer reader and no Energy reader can see this
//       sentence at all, and `BUILT.ability` (249), `BUILT.trainer` (105) and
//       `BUILT.specialEnergy` (8) stand still as a MEASUREMENT and not a guess.
//
// ── 🛑 THE SUMMAND THIS ROW MOVES, AND WHAT IT IS KEYED ON ──────────────────
// `BUILT.attack` = **1,164 raw + 15 registry + 13 split = 1,192** at head, and all
// three summands were RE-DERIVED by opening their authorities rather than taken
// from the work order (D338 was handed a raw summand twelve decisions stale, so
// this is now the standing cost of entry). This handoff's three were ACCURATE.
//
// THIS ROW MOVES THE **REGISTRY** SUMMAND, **KEYED ON THE REGISTRY**: 15 → **16**,
// so `BUILT.attack` 1,192 → **1,193**.
//   * the RAW summand CANNOT move — `rawUnitsAtHead()` runs the `deriveAttack*`
//     readers LIVE over the committed legal corpus with `programFor` nowhere in
//     the addition (D307/D315), so an authored row buys it no printings at all;
//   * the SPLIT summand CANNOT move — this sentence carries no gate clause, so
//     `splitAttackGateClause` returns null and it never enters that loop.
//   `1,164 + 16 + 13 = 1,193` ✅, re-added from the parts rather than incremented.
//
// ⚠️ **AND THE DERIVER STILL REFUSES THE SENTENCE, WHICH IS THE MECHANISM AND NOT
// A CONTRADICTION.** `derivedBenchSearch.test.ts`'s `DEFERRED` names this very id
// and asserts `deriveAttackEffect(text) === null`, never `programFor(id) ===
// undefined`. D314's distinction: *"refused by the deriver"* and *"unbuilt"* have
// never been the same claim, and the refusal is exactly what keeps the registry
// summand disjoint from the raw one. §7 asserts BOTH halves on this id.
//
// ── 🛑 IT LANDS IN `NOT_REVEALING`, NOT `REVEALING` ─────────────────────────
// The print puts the cards onto the BENCH and carries NO reveal clause — a bench
// move is public by the move itself, which is that table's stated rule. So
// `revealClause.test.ts` moves its OTHER table for the first time in this run of
// slices: `NOT_REVEALING` 10 → **11**, `REVEALING` stands still at **28**, and
// `classified.size` 38 → **39** off the union (`28 + 11 = 39` ✅).
// ⚠️ **THE HANDOFF SAID `classified.size` WAS "28 → 29" AND IT IS 38 → 39** — 28
// is `REVEALING.length`, and the union of a 28-row table with an 11-row one cannot
// be 29. Caught by opening `revealClause.test.ts:563` instead of trusting the
// number. §2 drives the absence of `reveal` on the op so the table placement is a
// DRIVEN fact rather than a filing decision.
//
// ── 🛑 WHY THIS FILE DRIVES A **LOCAL** POOL, AND WHY IT HAD NO CHOICE ──────
// The handoff flagged that **`Maushold ex` has no Standard-legal printing**
// (`sv04-155`/`sv04-233`, both `legal_standard = 0`). ✅ Confirmed — and querying
// all eight Maushold-family printings found it understated:
//   `Maushold`    `sv01-161`, `sv02-168`, `sv02-226`, `sv04.5-074`, `sv04.5-210`
//                 — ALL `legal_standard = 0`
//   `Maushold`    `sv08-158` — `legal_standard = 1`  ← **the attacker itself**
//   `Maushold ex` `sv04-155`, `sv04-233` — BOTH `legal_standard = 0`
// **`sv08-158` IS THE ONLY STANDARD-LEGAL `Maushold` IN THE CATALOG, SO NEITHER
// MEMBER OF THE UNION HAS A LEGAL BODY OTHER THAN THE ATTACKING CARD.** The filter
// is authored because the card prints it; the cast is LOCAL (D275's idiom) because
// there is nothing legal to reach for. **That is a census decision, not a tidiness
// one**: `sv08` is not among `catalogManifest`'s six sets, so a shared-pool body
// would owe a `fix-*` demonstrator key AND redden `revealClause`'s `swept.size`.
// Nothing enters `FIXTURE_POOL`, so `swept.size` stands still at **27** and
// `raw.length` steps by the ONE catalog id alone (668 → **669**).
// 🛑 **D343 — THE `swept.size` HALF OF THAT SENTENCE NO LONGER FOLLOWS.** The
// sweep's population was `FIXTURE_POOL` and is now `registryCardIds()` ∪ the
// pool; `swept.size` is **103**. Maushold `sv08-158` IS a registry id, so this
// suite's row is swept today whether or not it seats a shared body — staying out
// of the pool stopped being the thing that keeps that number still. The
// `raw.length` half and the `catalogManifest` half are untouched.
//
// ── THE CAST, AND THE PAIR OF CASES THAT IS THE WHOLE ROW ───────────────────
// 🛑 **"Maushold ex" CONTAINS "Maushold" AS A PREFIX.** That is the sharpest fact
// in this file and the reason the disjunction is printed at all: if `byName` were
// a prefix or substring match, `byName{Maushold}` would ALREADY take every
// `Maushold ex`, the second member would be dead weight, and a build that dropped
// it would be INVISIBLE on every board. §4 drives exactness in BOTH directions —
// `byName{Maushold}` must refuse "Maushold ex", and `byName{Maushold ex}` must
// refuse "Maushold" — so neither member can be deleted without a red line.

const MAUSHOLD = "sv08-158";
const PRINTED =
  "Search your deck for up to 2 in any combination of Maushold and Maushold ex and put them onto your Bench. Then, shuffle your deck.";
const MAUSHOLD_IDX1_NAME = "Incessant Incisors";

const MAUSHOLD_BODY = "fix-d339fm-maushold";
const MAUSHOLD_EX = "fix-d339fm-maushold-ex";
const TANDEMAUS = "fix-d339fm-tandemaus";
const MAUSHOLDER = "fix-d339fm-mausholder";
const COLORLESS_ENERGY = "fix-d339fm-energy";
const WALL = "fix-d339fm-wall";
const FILLER = "fix-d339fm-filler";

/** The LOCAL pool — the real id lives HERE, so nothing this file adds is visible
    to `catalogManifest`, to `revealClause`'s FIXTURE_POOL sweep, or to any
    shared-pool enumeration. */
const LOCAL_CARDS: Record<string, Card> = {
  [MAUSHOLD]: battler(MAUSHOLD, {
    name: "Maushold",
    hp: 110,
    retreat: 1,
    types: ["Colorless"],
    stage: "Stage1",
    evolveFrom: "Tandemaus",
    attacks: [
      { cost: ["Colorless"], name: "Familial March", effect: PRINTED },
      { cost: ["Colorless"], name: MAUSHOLD_IDX1_NAME, damage: "30×" },
    ],
  }),
  /** A SECOND body whose printed NAME is exactly "Maushold" — a searchable target
      distinct from the attacker's own uid. **ADMITTED** by the first member. */
  [MAUSHOLD_BODY]: battler(MAUSHOLD_BODY, {
    name: "Maushold",
    hp: 110,
    retreat: 1,
    types: ["Colorless"],
    stage: "Stage1",
    evolveFrom: "Tandemaus",
  }),
  /** 🛑 THE SECOND MEMBER, and the card with no Standard-legal printing anywhere
      in the catalog (`sv04-155`/`sv04-233` are both `legal_standard = 0`), which
      is exactly why it is driven from a LOCAL body. **ADMITTED** by the second
      member and **REFUSED** by the first — its name is a strict extension of
      "Maushold", so it is the card that proves `byName` is exact and not a prefix
      match. Delete the second member from the program and this body stops being
      reachable; make `byName` a prefix match and it becomes reachable TWICE. */
  [MAUSHOLD_EX]: battler(MAUSHOLD_EX, {
    name: "Maushold ex",
    hp: 260,
    retreat: 1,
    types: ["Colorless"],
    stage: "Stage1",
    evolveFrom: "Tandemaus",
  }),
  /** The PRE-EVOLUTION, and the near miss a "search the family" build would take.
      **REFUSED** — the card names two cards, not an evolution line, and
      `evolveFrom: "Tandemaus"` on both members is a property of the TARGETS rather
      than of the filter. Without this body, "the names were read" and "the family
      was read" are the same board. */
  [TANDEMAUS]: battler(TANDEMAUS, {
    name: "Tandemaus",
    hp: 60,
    retreat: 1,
    types: ["Colorless"],
  }),
  /** 🛑 THE OTHER DIRECTION OF THE EXACTNESS CLAIM. A name that strictly CONTAINS
      "Maushold" as a prefix but is neither printed name. **REFUSED by both
      members.** `MAUSHOLD_EX` catches a prefix match that admits too much on the
      first member; this catches one that admits too much on EITHER, including a
      `startsWith` that someone "fixed" by special-casing the " ex" suffix. */
  [MAUSHOLDER]: battler(MAUSHOLDER, {
    name: "Mausholder",
    hp: 90,
    retreat: 1,
    types: ["Colorless"],
  }),
  [COLORLESS_ENERGY]: typedEnergy(COLORLESS_ENERGY, "Grass"),
  [WALL]: battler(WALL, {
    name: "D339 Wall",
    hp: 330,
    retreat: 1,
    types: ["Colorless"],
    attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
  }),
  [FILLER]: battler(FILLER, {
    name: "D339 Filler",
    hp: 200,
    retreat: 1,
    types: ["Colorless"],
    attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
  }),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

// 2 + 4 + 4 + 4 + 4 + 20 + 4 + 18 = 60.
const DECK = deckOf({
  [MAUSHOLD]: 2,
  [MAUSHOLD_BODY]: 4,
  [MAUSHOLD_EX]: 4,
  [TANDEMAUS]: 4,
  [MAUSHOLDER]: 4,
  [COLORLESS_ENERGY]: 20,
  [WALL]: 4,
  [FILLER]: 18,
});

const ATTACK = { type: "attack", seat: "p1", index: 0 } as const;

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

function find<T extends GameEvent["type"]>(
  events: readonly GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
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
  const created = createGame({ seed, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
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

/** TEST SURGERY — `count` Energy onto p1's Active, taken off the deck so every uid
    stays in exactly one zone. "Familial March" costs a single {C}. */
function fuel(state: GameState, count: number): GameState {
  const side = state.players.p1;
  const body = side.active;
  if (body === null) throw new Error("p1 has no Active");
  const energy = side.deck.filter((u) => state.cardIdByUid[u] === COLORLESS_ENERGY).slice(0, count);
  if (energy.length < count) throw new Error(`deck lacks ${count} ${COLORLESS_ENERGY}`);
  return {
    ...state,
    players: {
      ...state.players,
      p1: {
        ...side,
        active: { ...body, energy: [...body.energy, ...energy] },
        deck: side.deck.filter((u) => !energy.includes(u)),
      },
    },
  };
}

/** A board with Maushold Active for p1 on p1's turn, a 330 HP Wall opposite, and
    `benched` filler bodies on p1's Bench. The DECK is the whole search zone, so
    nothing needs seeding into a window — what is in the deck is what is offered. */
function board(seed: number, opts: { benched?: number; energy?: number } = {}): GameState {
  let state = localSetup(seed, "p2");
  state = setActiveFromDeck(state, "p2", WALL);
  state = clearBench(state, "p2");
  state = benchFromDeck(state, "p2", FILLER);
  state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
  state = setActiveFromDeck(state, "p1", MAUSHOLD);
  state = clearBench(state, "p1");
  for (let i = 0; i < (opts.benched ?? 1); i += 1) {
    state = benchFromDeck(state, "p1", FILLER);
  }
  return fuel(state, opts.energy ?? 1);
}

/** The uids in p1's DECK carrying `id`. */
function deckUids(state: GameState, id: string): string[] {
  return state.players.p1.deck.filter((uid) => state.cardIdByUid[uid] === id);
}

/** The catalog ids sitting on `seat`'s Bench, top of each stack. */
function benchIds(state: GameState, seat: Seat): string[] {
  return state.players[seat].bench.map(
    (p) => state.cardIdByUid[p.stack[p.stack.length - 1] ?? ""] ?? "?",
  );
}

/** Declare "Familial March" and return the parked `chooseCards` prompt with it. The
    attack has no cost op, so the FIRST park is the search. */
function attack(state: GameState) {
  const result = applyAction(state, ATTACK);
  if (!result.ok) throw new Error(`attack failed: ${result.error.code} ${result.error.message}`);
  const parked = result.state;
  if (parked.phase.kind !== "effect:choose") {
    throw new Error(`expected effect:choose, got ${parked.phase.kind}`);
  }
  if (parked.phase.prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
  return { parked, prompt: parked.phase.prompt, events: [...result.events] };
}

function mustResolve(state: GameState, uids: string[]) {
  const result = applyAction(state, {
    type: "resolveEffect",
    seat: "p1",
    choice: { kind: "cards", uids },
  });
  if (!result.ok) throw new Error(`resolve failed: ${result.error.code} ${result.error.message}`);
  return { state: result.state, events: [...result.events] };
}

describe("D339 — Maushold 'Familial March', a flat cap over a NAMED union", () => {
  // ── §1 THE PRINTED SHAPE, READ OFF THE REGISTRY BEFORE ANY BOARD RUNS ──────

  it("the registry resolves a program for the printing", () => {
    expect(programFor(MAUSHOLD)).toBeDefined();
  });

  it("🛑 the program is `anyOf` of TWO `byName`s under a FLAT cap — exact, `toEqual`", () => {
    // 🛑 THE WHOLE ROW IN ONE ASSERTION, AND IT IS EXACT ON PURPOSE. `toEqual`
    // means an added `also` (one cap PER noun — D336), an added `reveal`, an added
    // `stage` rider or a swapped `dest` goes red HERE rather than four cases down
    // in some subtle answer. The two members are `byName` and NEITHER carries
    // `cardNoun`: both name POKÉMON and print bare, which is Flamigo's rule (D200)
    // — `cardNoun: true` is for the Item-shaped nouns (Arven's Sandwich).
    expect(programFor(MAUSHOLD)?.attack?.[0]).toEqual([
      {
        op: "searchDeck",
        filter: {
          kind: "anyOf",
          filters: [
            { kind: "byName", name: "Maushold" },
            { kind: "byName", name: "Maushold ex" },
          ],
        },
        dest: "bench",
        max: 2,
      },
      { op: "shuffleDeck" },
    ]);
  });

  it("INDEX-PRECISE — index 1 'Incessant Incisors' is unclaimed", () => {
    // Eldegoss's rule at D314, Heatmor's at D338. Index 1 is a coin-scaled body
    // ("Flip 4 coins. This attack does 30 damage for each heads.", `damage: "30×"`)
    // and contributes zero attack units; claiming the whole id instead of one index
    // inflated an intermediate result by 1 at D187 before it was caught.
    expect(programFor(MAUSHOLD)?.attack?.[0]).toBeDefined();
    expect(programFor(MAUSHOLD)?.attack?.[1]).toBeUndefined();
  });

  it("the row authors an ATTACK and NOTHING else — the key set, not six slices of habit", () => {
    // 🛑 THIS IS WHAT KEEPS THE ROW OUT OF `nonAttackRegistryIds()` (525, unmoved).
    // `censusAtHead`'s `some(key !== "attack")` filter drops it into
    // `attackRegistryIds()` alone. D332-D337's six trainer slices all moved the
    // non-attack pool; this one and D338's do not, and the reason is the KEY SET.
    expect(Object.keys(programFor(MAUSHOLD) ?? {})).toEqual(["attack"]);
  });

  // ── §2 🛑 NO `reveal` — THE CLAIM THAT PUTS IT IN `NOT_REVEALING` ──────────

  it("🛑 the op carries NO `reveal` key at all — DRIVEN, not filed", () => {
    // The print says "put them onto your Bench" and prints no reveal clause: a
    // bench move is public by the move itself. `revealClause.test.ts` files this id
    // in `NOT_REVEALING` (10 → 11) and NOT in `REVEALING` (28, unmoved), and this
    // is the assertion that makes that placement a DRIVEN fact rather than a
    // filing decision. `toHaveProperty` is the sharp form: `reveal: false` would
    // pass a truthiness check and fail this one.
    const op = programFor(MAUSHOLD)?.attack?.[0]?.[0];
    expect(op).not.toHaveProperty("reveal");
  });

  it("the prompt does NOT announce a reveal, where D338's sibling does", () => {
    const { prompt } = attack(board(1));
    expect(prompt).not.toHaveProperty("reveal");
  });

  // ── §3 THE FLAT CAP OF 2 OVER THE UNION ────────────────────────────────────

  it("the prompt is 'up to 2' — max 2, min 0, and taking none is legal", () => {
    const { prompt } = attack(board(2));
    expect(prompt.max).toBe(2);
    expect(prompt.min).toBe(0);
  });

  it("the prompt's destination is the BENCH, not the hand", () => {
    // D337's and D338's sentences both end "into your hand"; this one ends "onto
    // your Bench", and `chooseCards.dest` has carried "bench" since the search
    // family. A `dest` typo would be invisible until a card actually moved.
    const { prompt } = attack(board(3));
    expect(prompt.dest).toBe("bench");
  });

  it("🛑 takes TWO `Maushold` and nothing else — one extreme of the combination", () => {
    const state = board(4);
    const { parked } = attack(state);
    const picks = deckUids(parked, MAUSHOLD_BODY).slice(0, 2);
    expect(picks).toHaveLength(2);
    const { state: after } = mustResolve(parked, picks);
    expect(benchIds(after, "p1")).toEqual([FILLER, MAUSHOLD_BODY, MAUSHOLD_BODY]);
  });

  it("🛑 takes TWO `Maushold ex` and nothing else — the union's other extreme", () => {
    const state = board(5);
    const { parked } = attack(state);
    const picks = deckUids(parked, MAUSHOLD_EX).slice(0, 2);
    expect(picks).toHaveLength(2);
    const { state: after } = mustResolve(parked, picks);
    expect(benchIds(after, "p1")).toEqual([FILLER, MAUSHOLD_EX, MAUSHOLD_EX]);
  });

  it("🛑 takes a MIXTURE — one of each, the printed 'combination'", () => {
    // 🛑 THE ANSWER THAT IS THE ROW. One cap PER NOUN (`also`, D336) would still
    // admit this take, but the two 2/0 takes above would be refused; a flat cap
    // over a union admits all three. This case plus the two above is what separates
    // the two spellings, which is why none of them can be dropped.
    const state = board(6);
    const { parked } = attack(state);
    const picks = [deckUids(parked, MAUSHOLD_BODY)[0], deckUids(parked, MAUSHOLD_EX)[0]].filter(
      (u): u is string => u !== undefined,
    );
    expect(picks).toHaveLength(2);
    const { state: after } = mustResolve(parked, picks);
    expect(benchIds(after, "p1")).toEqual([FILLER, MAUSHOLD_BODY, MAUSHOLD_EX]);
  });

  it("taking ONE is legal — 'up to' means up to", () => {
    const state = board(7);
    const { parked } = attack(state);
    const picks = deckUids(parked, MAUSHOLD_BODY).slice(0, 1);
    const { state: after } = mustResolve(parked, picks);
    expect(benchIds(after, "p1")).toEqual([FILLER, MAUSHOLD_BODY]);
  });

  it("taking NONE is legal and benches nothing", () => {
    const state = board(8);
    const before = benchIds(state, "p1");
    const { parked } = attack(state);
    const { state: after } = mustResolve(parked, []);
    expect(benchIds(after, "p1")).toEqual(before);
  });

  it("a THIRD pick is refused — the cap is 2, not 'any number'", () => {
    const state = board(9);
    const { parked } = attack(state);
    const picks = deckUids(parked, MAUSHOLD_BODY).slice(0, 3);
    expect(picks).toHaveLength(3);
    const result = applyAction(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: picks },
    });
    expect(result.ok).toBe(false);
  });

  // ── §4 🛑 EXACTNESS IN BOTH DIRECTIONS — THE PAIR THAT IS THE WHOLE ROW ────

  it("🛑 `byName{Maushold}` REFUSES 'Maushold ex' — exact, not a prefix match", () => {
    // 🛑 THE CARD IS PRINTED AS A DISJUNCTION *BECAUSE* THIS IS TRUE IN PAPER TOO:
    // "Maushold ex" is a different card name from "Maushold", and the card says so
    // in so many words. If `byName` matched by prefix, the FIRST member would
    // already take every `Maushold ex`, the second member would be dead weight, and
    // deleting it would be invisible on every board. The offer is the instrument:
    // both names are in the candidate list, and §4's next case proves the second
    // member is what puts the `ex` there.
    const { parked, prompt } = attack(board(20));
    const offered = new Set(prompt.candidates.map((u) => parked.cardIdByUid[u]));
    expect(offered.has(MAUSHOLD_BODY)).toBe(true);
    expect(offered.has(MAUSHOLD_EX)).toBe(true);
  });

  it("🛑 NEITHER member takes 'Mausholder' — a strict extension of one printed name", () => {
    // The other direction of the exactness claim, and the case a `startsWith`
    // "fixed" by special-casing the " ex" suffix would still fail. `Mausholder`
    // contains "Maushold" as a prefix and is neither printed name.
    const { parked, prompt } = attack(board(21));
    const offered = new Set(prompt.candidates.map((u) => parked.cardIdByUid[u]));
    expect(offered.has(MAUSHOLDER)).toBe(false);
  });

  it("🛑 the PRE-EVOLUTION 'Tandemaus' is REFUSED — two names, not an evolution line", () => {
    // Both printed members carry `evolveFrom: "Tandemaus"`, so a build that read
    // the FAMILY instead of the two NAMES would take this body and look right on a
    // casual board. It is the near miss that separates "the names were read" from
    // "the family was read".
    const { parked, prompt } = attack(board(22));
    const offered = new Set(prompt.candidates.map((u) => parked.cardIdByUid[u]));
    expect(offered.has(TANDEMAUS)).toBe(false);
  });

  it("the offer is EXACTLY the two printed names — nothing else in a 60-card deck", () => {
    // The positive form of the three refusals above, stated as a set rather than as
    // three absences: a widening that admitted a fourth id would pass all three
    // `.has(...) === false` checks above if it admitted some id none of them names.
    const { parked, prompt } = attack(board(23));
    const offered = new Set(prompt.candidates.map((u) => parked.cardIdByUid[u] ?? "?"));
    expect([...offered].sort()).toEqual([MAUSHOLD_BODY, MAUSHOLD_EX].sort());
  });

  it("Energy, the Wall and the filler are all refused — the union is Pokémon-by-NAME", () => {
    const { parked, prompt } = attack(board(24));
    const offered = new Set(prompt.candidates.map((u) => parked.cardIdByUid[u]));
    for (const id of [COLORLESS_ENERGY, WALL, FILLER]) expect(offered.has(id)).toBe(false);
  });

  // ── §5 THE BENCH CLAMP — `Math.min(op.max, benchSpace(...))` ───────────────

  it("🛑 the cap CLAMPS to bench space — 4 benched leaves room for ONE", () => {
    // The interpreter clamps BEFORE anything leaves the deck
    // (`Math.min(op.max, benchSpace(state, ctx.seat))`), which is why the
    // bench-space question `effects.ts` documents needs zero code at the op level.
    // BENCH_MAX is 5, so four filler bodies leave exactly one slot.
    const { prompt } = attack(board(30, { benched: 4 }));
    expect(prompt.max).toBe(1);
  });

  it("🛑 a FULL bench takes the op off the board entirely — no park, no prompt", () => {
    // `retrieveMax <= 0` returns `{ done: state }` rather than parking an
    // unanswerable dialog. The attack still resolves; it simply searches nothing.
    const state = board(31, { benched: 5 });
    const result = applyAction(state, ATTACK);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.state.phase.kind).not.toBe("effect:choose");
    expect(result.state.players.p1.bench).toHaveLength(5);
  });

  it("with 3 benched the cap is still 2 — the clamp binds only when it is smaller", () => {
    const { prompt } = attack(board(32, { benched: 3 }));
    expect(prompt.max).toBe(2);
  });

  // ── §6 THE TRAILING SHUFFLE, AND THE DECK ACCOUNTING ──────────────────────

  it("the deck is shuffled after the search — the printed 'Then, shuffle your deck.'", () => {
    const state = board(40);
    const { parked } = attack(state);
    const picks = deckUids(parked, MAUSHOLD_BODY).slice(0, 1);
    const { events } = mustResolve(parked, picks);
    expect(find(events, "SHUFFLE")).toBeDefined();
  });

  it("the benched cards LEAVE the deck — every uid stays in exactly one zone", () => {
    const state = board(41);
    const { parked } = attack(state);
    const deckBefore = parked.players.p1.deck.length;
    const picks = deckUids(parked, MAUSHOLD_BODY).slice(0, 2);
    const { state: after } = mustResolve(parked, picks);
    expect(after.players.p1.deck).toHaveLength(deckBefore - 2);
    for (const uid of picks) {
      expect(after.players.p1.deck).not.toContain(uid);
      expect(after.players.p1.hand).not.toContain(uid);
    }
  });

  it("🛑 the cards go to the BENCH and NOT to the hand — the `dest` proved on a board", () => {
    // The sibling sentences (D337, D338) end "into your hand"; this one ends "onto
    // your Bench". A `dest: "hand"` typo would pass every count-shaped assertion in
    // this file and fail exactly here.
    const state = board(42);
    const { parked } = attack(state);
    const handBefore = parked.players.p1.hand.length;
    const picks = deckUids(parked, MAUSHOLD_EX).slice(0, 2);
    const { state: after } = mustResolve(parked, picks);
    expect(after.players.p1.hand).toHaveLength(handBefore);
    for (const uid of picks) {
      expect(after.players.p1.bench.some((p) => p.stack.includes(uid))).toBe(true);
    }
  });

  it("the benched bodies arrive with no damage and no attached Energy", () => {
    const state = board(43);
    const { parked } = attack(state);
    const picks = deckUids(parked, MAUSHOLD_EX).slice(0, 1);
    const { state: after } = mustResolve(parked, picks);
    const placed = after.players.p1.bench.find((p) => p.stack.includes(picks[0] ?? ""));
    expect(placed).toBeDefined();
    expect(placed?.damage ?? 0).toBe(0);
    expect(placed?.energy ?? []).toEqual([]);
  });

  it("the OPPONENT's board is untouched — the SEARCH draws only from p1's deck", () => {
    // ⚠️ **THE FIRST DRAFT OF THIS CASE ASSERTED THE WRONG THING AND WAS NARROWED,
    // NOT RELAXED (D328).** It read
    // `expect(after.players.p2.deck).toHaveLength(state.players.p2.deck.length)`
    // and went red 45 vs 44 — because RESOLVING the search completes the attack,
    // which ENDS THE TURN, and p2 then legitimately draws for their own turn. The
    // missing card was p2's DRAW STEP, not a card this op reached across the board
    // for. A length equality across a turn boundary is not a claim about this op at
    // all, and "widen the board" would not have fixed it because the board was
    // never too narrow — the ASSERTION was false.
    // The claim actually worth making is CONTAINMENT plus PROVENANCE: nothing is
    // ADDED to p2's deck, p2's bench does not move, and every card that reached
    // p1's bench came out of P1's deck. That is strictly sharper than the length
    // check it replaces — a build that benched an opponent's card would pass a
    // length equality on p1's side and fail here.
    const state = board(44);
    const before = benchIds(state, "p2");
    const { parked } = attack(state);
    const p2DeckBefore = new Set(parked.players.p2.deck);
    const picks = deckUids(parked, MAUSHOLD_BODY).slice(0, 2);
    expect(picks).toHaveLength(2);
    const { state: after } = mustResolve(parked, picks);
    // p2's bench does not move, and nothing is ADDED to p2's deck.
    expect(benchIds(after, "p2")).toEqual(before);
    for (const uid of after.players.p2.deck) expect(p2DeckBefore.has(uid)).toBe(true);
    // …and the turn really did pass, which is WHY p2's deck is one shorter.
    expect(after.turn).toBe(parked.turn + 1);
    expect(after.players.p2.deck.length).toBe(p2DeckBefore.size - 1);
    // PROVENANCE — every benched pick came out of P1's deck, not p2's.
    for (const uid of picks) {
      expect(p2DeckBefore.has(uid)).toBe(false);
      expect(after.players.p1.bench.some((p) => p.stack.includes(uid))).toBe(true);
    }
  });

  it("the attack deals NO damage — the print has no damage number at index 0", () => {
    const state = board(45);
    const wallHp = state.players.p2.active?.damage ?? 0;
    const { parked } = attack(state);
    const { state: after } = mustResolve(parked, []);
    expect(after.players.p2.active?.damage ?? 0).toBe(wallHp);
  });

  // ── §7 🛑 THE CENSUS CLAIMS, ASSERTED RATHER THAN WRITTEN DOWN ────────────

  it("🛑 the sentence is REFUSED by the deriver AND BUILT by the registry — D314", () => {
    // The two halves that keep the REGISTRY summand disjoint from the RAW one. If
    // a reader ever resolves this text, `rawUnitsAtHead()` rises and this printing
    // is counted TWICE — which is exactly what `censusAtHead`'s
    // `resolvedByAnyReader(text) === false` rung exists to catch. Asserted here as
    // well, on the id rather than on the table, so the claim is local to the row.
    expect(programFor(MAUSHOLD)).toBeDefined();
    expect(deriveAttackEffect(PRINTED)).toBeNull();
  });

  it("🛑 THE GRAMMAR CLOSES AT 6 OF 6 — stated as arithmetic, not as prose", () => {
    // Re-queried against remote D1 `luminous` on 2026-08-15 at two widths and two
    // word orders (see the header census). The population of *"Search your deck for
    // up to … in any combination of …"* is SIX legal printings across all three
    // text columns, and after this row every one of them is built:
    //   effect        3 legal — Ethan's Adventure sv10-165/-221/-236  (D337)
    //   attacks_json  3 legal — Heatmor sv10.5w-019/-104 (D338) + sv08-158 (HERE)
    //   abilities_json 0
    const effectPrintings = 3;
    const attackPrintings = 3;
    const abilityPrintings = 0;
    expect(effectPrintings + attackPrintings + abilityPrintings).toBe(6);
    // …and the built half is now the whole of it.
    const builtByD337 = 3;
    const builtByD338 = 2;
    const builtHere = 1;
    expect(builtByD337 + builtByD338 + builtHere).toBe(6);
    expect(builtByD337 + builtByD338 + builtHere).toBe(
      effectPrintings + attackPrintings + abilityPrintings,
    );
  });

  it("🛑 the REGISTRY summand is the one that moves — 1,164 + 16 + 13 = 1,193", () => {
    // The addition stated where the row is, so a successor reading this file sees
    // WHICH summand moved and WHAT IT IS KEYED ON without opening three others.
    // `censusAtHead.test.ts` derives all three LIVE and ties them; this is the
    // narrative copy, and it is arithmetic so it cannot drift silently.
    const rawReaderKeyed = 1164; // unmoved — `programFor` is nowhere in that addition
    const registryKeyed = 16; // 15 → 16, THIS ROW
    const splitReaderKeyed = 13; // unmoved — this sentence carries no gate clause
    expect(rawReaderKeyed + registryKeyed + splitReaderKeyed).toBe(1193);
  });
});
