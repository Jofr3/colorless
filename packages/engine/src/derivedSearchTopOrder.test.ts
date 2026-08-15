import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { deriveAttackEffect, searchTopOrderProgram } from "./effects";
import type { EffectOp } from "./effects";
import { applyAction, createGame, engineVersion } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import { logFromEvents } from "./log";
import type { LogContext } from "./log";
import { redactGame } from "./redact";
import { programFor } from "./registry";
import { FIXTURE_POOL, battler, deckOf, trainerCard, typedEnergy } from "./testFixtures";

// ── D342 — "SEARCH YOUR DECK FOR 2 CARDS, SHUFFLE YOUR DECK, THEN PUT THOSE
//    CARDS ON TOP OF IT **IN ANY ORDER**": THE FIRST PROGRAM WHOSE SECOND PARK
//    READS THE FIRST PARK'S ANSWER — THROUGH THE DECK. ────────────────────────
//
// ── THE ONE PRINTED SENTENCE, IN TWO COLUMNS ────────────────────────────────
//   "Search your deck for 2 cards, shuffle your deck, then put those cards on
//    top of it in any order."
//      • `effect`        — Ciphermaniac's Codebreaking `sv05-145` / `sv05-198` /
//                          `sv08.5-104` (Supporter, mark H). **3 legal**, an
//                          authored REGISTRY row.
//      • `attacks_json`  — Dialga `sv08-135` "Time Manipulation", attack index
//                          0, cost {C}. **1 legal**, read by a DERIVER.
//   **4 Standard-legal printings, ONE byte-identical sentence, TWO columns.**
//
// ── THE CENSUS, RE-DERIVED AT THIS HEAD RATHER THAN INHERITED ───────────────
// Every figure re-queried against remote D1 `luminous` (3,786 rows, 2,021
// `legal_standard`) on 2026-08-15, in one 3-arm `UNION ALL` (D340/D341's shape;
// the compound-SELECT cap is five arms).
//
//   (a) THE FAMILY — `instr(<col>,'in any order') > 0`, all three columns:
//         `effect` 8 rows / 6 legal · `attacks_json` 7 / 5 · `abilities_json` 0 / 0
//         TOTAL **15 printings / 11 legal on 7 sentences.**
//         8 + 7 + 0 = 15 ✅   6 + 5 + 0 = 11 ✅   (D341's figure, re-confirmed)
//
//   (b) THIS SENTENCE — `instr(<col>,'on top of it') > 0`, all three columns:
//         **4 rows, ALL `legal_standard = 1`, ONE sentence** — `sv05-145`,
//         `sv05-198`, `sv08.5-104` (`effect`) and `sv08-135` (`attacks_json`).
//
//   (c) THE SAME QUERY AT A SECOND WIDTH, because one width is an anecdote:
//         `instr(<col>,'then put those cards on top') > 0` returns **the SAME
//         4 rows**. Two widths, one answer.
//
//   (d) 🛑 THE WORD ORDER PROBE THAT CLOSES THE FAMILY.
//         `instr(effect,'on top of your deck') > 0 OR instr(attacks_json,
//         'on top of your deck') > 0` returns **ZERO ROWS**. There is no
//         possessive spelling of this destination anywhere in the catalog, so
//         the anchor is not leaving a wider grammar on the table — the family is
//         **CLOSED AT FOUR** and a `dest` that reads only "on top of it" reads
//         all of it.
//
//   (e) THE STANDING-STILL, MEASURED RATHER THAN ASSUMED. All three
//       Ciphermaniac's ids carry `attacks_json IS NULL` AND `abilities_json IS
//       NULL` against a byte-identical 96-char `effect`; Dialga carries `effect
//       IS NULL` AND `abilities_json IS NULL` against a 234-char `attacks_json`.
//       So `BUILT.ability` cannot see any of the four, no attack reader can see
//       the three Supporters, and no trainer reader can see the Pokémon.
//
// ── WHAT THIS ROW OWED, AND THE HALF OF THE PRICE THAT WAS WRONG ────────────
// The resume point priced it: *"a `searchDeck` whose PICKS are then sequenced
// onto the deck — i.e. the `orderCards` prompt parked a second time, behind the
// search's own park, over the cards the first answer chose. **What is new is a
// prompt whose candidates are the previous answer, which no op in this engine
// does yet.**"*
//
// ✅ **THE FIRST CLAUSE IS EXACTLY RIGHT** — two printed decisions, two parks,
//    and D216's correction of D206 says two parks means two OPS.
//
// 🛑 **THE SECOND CLAUSE IS FALSE AT THIS HEAD, AND ITS FALSENESS IS THE WHOLE
//    REASON THIS ROW COST WHAT IT DID.** No channel has to be built, because
//    **THE CHANNEL IS THE DECK**. `searchDeck { dest: "deckTop" }` puts the
//    picks on top; `reorderTop { n: 2 }` — with no `from`, the TOP fork, which
//    is the only one that existed when this was written — then reads
//    `deck.slice(0, 2)`, which
//    ARE the picks, by construction, with nothing carried across the park and no
//    `continuationOps` member. A program has parked twice since D186
//    (`resumeProgram` → `runProgram(rest)`, Koraidon "Dino Cry"), so the second
//    park was already free; what looked like a missing mechanism was a missing
//    OBSERVATION about where two ops can meet.
//
// 🆕 **THE LESSON: "NO OP DOES THIS YET" IS A CLAIM ABOUT OPS, AND A PROGRAM IS
//    NOT AN OP.** Every previous re-pricing of this row asked what a single op
//    could carry between two questions. The answer was that it does not have to
//    carry anything — the ZONE between the two ops already holds it. **BEFORE
//    BUYING A CHANNEL BETWEEN TWO PARKS, CHECK WHETHER THE BOARD IS ONE.**
//
// 🛑 **AND `exact` IS THE CLAUSE NOBODY PRICED AT ALL.** It reads like a caption
//    field (the print says "2 cards", not "up to 2") and it is a CORRECTNESS
//    field: left at the standing `min: 0`, a player who declines the search — or
//    takes 1 of 2 — is handed an ordering window containing a card they never
//    searched for and were never shown, which is an information gain and a
//    re-ordering the print does not grant. §4 drives exactly that board.
//
// ── WHAT MOVED, AND WHAT DID NOT ────────────────────────────────────────────
//   `BUILT.attack` 1197 → 1198 through its **RAW** summand alone (1168 → 1169),
//   `BUILT.trainer` 105 → 108, `MATCH_RECORD_VERSION` **STAYS 20** — both the
//   `dest` inhabitant and the `exact` field are ADDED INHABITANTS of persisted
//   unions (D125's widening test), not D309's rename.

const CIPHER_A = "sv05-145";
const CIPHER_B = "sv05-198";
const CIPHER_C = "sv08.5-104";
const CIPHER_IDS = [CIPHER_A, CIPHER_B, CIPHER_C] as const;
const DIALGA = "sv08-135";

/** The printed sentence, byte-for-byte off remote D1 (`sv05-145`.`effect`, and
    the `effect` of `sv08-135`'s attack index 0 — the two are identical, which is
    the whole premise of this file). */
const PRINTED =
  "Search your deck for 2 cards, shuffle your deck, then put those cards on top of it in any order.";

/** 🛑 THE THREE NEAR MISSES, and each is a REAL printing rather than a mutation
    of the sentence. They are here because the `$` anchor is the only thing
    refusing them and a dropped `$` is exactly the mutant D234 left behind:
      • Kofu `sv07-138`/`-165` — a DIFFERENT verb and zone pair, plus a printed
        "if you do" gate. 2 legal. **THIS DERIVER DOES NOT READ IT**, and that is
        the permanent claim; it is an AUTHORED REGISTRY ROW (`const KOFU`), so
        `deriveAttackEffect` must return nothing for it no matter what the
        registry does.
        🆕🛑 **D343 — THIS BULLET USED TO SAY "deliberately unbuilt" AND THAT WAS
        ALREADY FALSE WHEN IT WAS WRITTEN.** `const KOFU` was in `registry.ts`
        and wired at both ids at the head that wrote it; D343 then added the
        `reorderTop { from: "bottom" }` its printed "in any order" needs, making
        the sentence doubly false. **AN ASSERTION ABOUT WHAT IS NOT BUILT HAS A
        SHELF LIFE — AND THIS ONE HAD EXPIRED BEFORE IT WAS PRINTED.** The
        narrower claim above ("this deriver does not read it") is the one that
        cannot rot, because it is about THIS FILE'S anchor and not about the
        engine's coverage.
      • Deduction Kit `sv08-171` — the `reorderTop` sentence PLUS a printed
        two-armed `or`. 1 legal; **this deriver does not read it** (the same
        narrower claim, for the same reason).
        🆕 **D344 BUILT IT** (`const DEDUCTION_KIT`, an authored registry row), and
        the narrower claim is exactly what survives the build — which is the whole
        point of the bullet above it. Note the ASYMMETRY with Kofu: that bullet
        rotted because it asserted "deliberately unbuilt", a claim about the
        ENGINE; this one asserts only what THIS ANCHOR reads, and a build cannot
        touch it.
      • Raifort `sv06-161`/`sv08.5-142` — a `lookAtTopN` whose LEFTOVERS are
        ordered, two parks in one sentence. 0 legal. */
const KOFU =
  "Put 2 cards from your hand on the bottom of your deck in any order. If you put 2 cards on the bottom of your deck in this way, draw 4 cards. (If you can't put 2 cards from your hand on the bottom of your deck, you can't use this card.)";
const DEDUCTION_KIT =
  "Look at the top 3 cards of your deck and put them back in any order, or shuffle them and put them on the bottom of your deck.";
const RAIFORT =
  "Look at the top 5 cards of your deck and discard any number of them. Put the other cards back in any order.";

/** 🆕 D342 — an AUTHORED registry program this slice did not write, carried in
    the local pool purely so §3's "nothing widened" claim can be DRIVEN rather
    than asserted: Earthen Vessel's `searchDeck` has no `exact` and must keep the
    printed "up to". The registry program is what runs; the effect text on the
    fixture is never read (Trainers have no text deriver). */
const EARTHEN_VESSEL = "sv06.5-096";
const METAL_ENERGY = "fix-d342-metal";
const WALL = "fix-d342-wall";
const FILLERS = ["fix-d342-f1", "fix-d342-f2", "fix-d342-f3", "fix-d342-f4"] as const;

/** 🆕 A LOCAL `cardPool` (D275's idiom, `derivedReorderTop.test.ts`'s shape one
    slice over), NOT an addition to `FIXTURE_POOL` — the four ids under test are
    REAL catalog printings and already carry real registry keys, so nothing here
    owes a `fix-*` registry row and `raw.length` moves by exactly the three
    Supporter ids this slice authors.
    ⚠️ AND THE LOCAL POOL IS NO LONGER LOAD-BEARING FOR THE AUDITORS. D341
    re-pointed `preventBlock`'s §11 sweep at the DERIVER (`OFF_POOL_ATTACK_TEXT`)
    precisely because a fixture pool is a SAMPLE and not a domain; the pool stays
    local here for isolation, which is the honest reason, and no longer to hold a
    census rung still. */
const LOCAL_CARDS: Record<string, Card> = {
  ...Object.fromEntries(CIPHER_IDS.map((id) => [id, trainerCard(id, "Supporter", PRINTED)])),
  [DIALGA]: battler(DIALGA, {
    name: "Dialga",
    hp: 150,
    retreat: 2,
    types: ["Metal"],
    stage: "Basic",
    attacks: [
      { cost: ["Colorless"], name: "Time Manipulation", effect: PRINTED },
      { cost: ["Psychic", "Metal", "Colorless"], name: "Buster Tail", damage: 160 },
    ],
  }),
  [EARTHEN_VESSEL]: trainerCard(EARTHEN_VESSEL, "Item", "Discard a card from your hand."),
  [METAL_ENERGY]: typedEnergy(METAL_ENERGY, "Metal"),
  [WALL]: battler(WALL, {
    name: "D342 Wall",
    hp: 330,
    retreat: 1,
    types: ["Colorless"],
    attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
  }),
  ...Object.fromEntries(
    FILLERS.map((id, i) => [
      id,
      battler(id, {
        name: `D342 Filler ${String(i + 1)}`,
        hp: 200,
        retreat: 1,
        types: ["Colorless"],
        attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
      }),
    ]),
  ),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

// 4 + 4 + 4 + 4 + 4 + 12 + 4 + 4×6 = 60.
const DECK = deckOf({
  [CIPHER_A]: 4,
  [CIPHER_B]: 4,
  [CIPHER_C]: 4,
  [DIALGA]: 4,
  [EARTHEN_VESSEL]: 4,
  [METAL_ENERGY]: 12,
  [WALL]: 4,
  ...Object.fromEntries(FILLERS.map((id) => [id, 6])),
});

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

function apply(
  state: GameState,
  action: Parameters<typeof applyAction>[1],
): { state: GameState; events: readonly GameEvent[] } {
  const result = applyAction(state, action);
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return { state: result.state, events: result.events };
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

/** TEST SURGERY — replace `seat`'s deck outright. Every assertion in this file is
    about a deck's CONTENTS and ORDER, so a known starting sequence is what makes
    "the picks landed on top" distinguishable from "the shuffle put them there". */
function setDeck(state: GameState, seat: Seat, deck: readonly string[]): GameState {
  return {
    ...state,
    players: { ...state.players, [seat]: { ...state.players[seat], deck: [...deck] } },
  };
}

/** TEST SURGERY — move one copy of `id` from `seat`'s deck into their hand. */
function toHand(state: GameState, seat: Seat, id: string): { state: GameState; uid: string } {
  const side = state.players[seat];
  const uid = side.deck.find((u) => state.cardIdByUid[u] === id);
  if (uid === undefined) throw new Error(`${seat}'s deck has no ${id}`);
  return {
    state: {
      ...state,
      players: {
        ...state.players,
        [seat]: { ...side, deck: side.deck.filter((u) => u !== uid), hand: [...side.hand, uid] },
      },
    },
    uid,
  };
}

/** P1's first unrestricted turn — P2 went first and passed, so a Supporter is
    legal under §7.2. */
function supporterBoard(seed: number): GameState {
  return must(applyAction(localSetup(seed, "p2"), { type: "endTurn", seat: "p2" }));
}

/** Play a Ciphermaniac's printing out of p1's hand and return the parked SEARCH
    prompt with it. */
function playCipher(state: GameState, id: string = CIPHER_A) {
  const { state: withCard, uid } = toHand(state, "p1", id);
  const { state: parked, events } = apply(withCard, { type: "playTrainer", seat: "p1", uid });
  if (parked.phase.kind !== "effect:choose") throw new Error(`not parked: ${parked.phase.kind}`);
  if (parked.phase.prompt.kind !== "chooseCards") {
    throw new Error(`wrong prompt: ${parked.phase.prompt.kind}`);
  }
  return { parked, prompt: parked.phase.prompt, events, seeded: withCard };
}

function pick(state: GameState, uids: readonly string[]) {
  return apply(state, {
    type: "resolveEffect",
    seat: "p1",
    choice: { kind: "cards", uids: [...uids] },
  });
}

function order(state: GameState, uids: readonly string[]) {
  return apply(state, {
    type: "resolveEffect",
    seat: "p1",
    choice: { kind: "orderCards", uids: [...uids] },
  });
}

function orderPrompt(state: GameState) {
  if (state.phase.kind !== "effect:choose") throw new Error(`not parked: ${state.phase.kind}`);
  if (state.phase.prompt.kind !== "orderCards") {
    throw new Error(`wrong prompt: ${state.phase.prompt.kind}`);
  }
  return state.phase.prompt;
}

// ─────────────────────────────────────────────────────────────────────────────
describe("§1 the reader — one sentence, one program, and the near misses it refuses", () => {
  it("the printed attack sentence derives to shuffle → search-to-top → reorder", () => {
    expect(deriveAttackEffect(PRINTED)).toEqual<EffectOp[]>([
      { op: "shuffleDeck" },
      { op: "searchDeck", filter: { kind: "anyCard" }, max: 2, exact: true, dest: "deckTop" },
      { op: "reorderTop", n: 2 },
    ]);
  });

  it("`shuffleDeck` LEADS, and the order of the three ops is the assertion", () => {
    // The print reads search → shuffle → place; the program reads shuffle →
    // search-and-place. The transposition is sound (the answer is a SET of cards,
    // so shuffling before or after their removal is the same distribution) and it
    // is what keeps `"deckTop"` a pure destination. Asserted as a SEQUENCE rather
    // than as a set, because "the shuffle is in the program somewhere" is exactly
    // the claim that would be true of a version that buried the picks.
    const program = deriveAttackEffect(PRINTED) ?? [];
    expect(program.map((op) => op.op)).toEqual(["shuffleDeck", "searchDeck", "reorderTop"]);
  });

  it("the deriver and the registry factory return the SAME program, not two copies", () => {
    // A sentence printed in two columns owes ONE reading. Both entry points call
    // `searchTopOrderProgram`, and this is what makes the sharing observable from
    // outside instead of only true by inspection.
    expect(deriveAttackEffect(PRINTED)).toEqual(searchTopOrderProgram(2));
    for (const id of CIPHER_IDS) expect(programFor(id)?.trainer).toEqual(searchTopOrderProgram(2));
  });

  it("the window is the PRINTED number and the factory carries it into both ops", () => {
    // `max` and `n` are the same number from the same capture — derived once and
    // used twice, so a re-scan cannot make the search and the ordering disagree
    // about how many cards are in flight.
    const program = searchTopOrderProgram(3);
    expect(program[1]).toEqual({
      op: "searchDeck",
      filter: { kind: "anyCard" },
      max: 3,
      exact: true,
      dest: "deckTop",
    });
    expect(program[2]).toEqual({ op: "reorderTop", n: 3 });
  });

  it("refuses the three REAL neighbouring printings — the `$` anchor, not a guard", () => {
    // Each of these is a printing in the same "in any order" family that owes a
    // second mechanism. A dropped `$` would read the first two as this arm and
    // silently drop a printed draw and a printed alternative.
    for (const text of [KOFU, DEDUCTION_KIT, RAIFORT]) {
      expect(deriveAttackEffect(text), text.slice(0, 40)).toBeNull();
    }
  });

  it("refuses a trailing clause welded onto the exact sentence", () => {
    // 🛑 THE FIRST FORM HERE IS THE ONE THAT DOES **NOT** TEST THE `$`, AND THE
    // SWEEP IS WHAT SAID SO. `PRINTED.slice(0, -1)` drops the final period, so
    // the anchor's own `\.` already refuses it and the trailing anchor is never
    // reached — the D342 `$` mutant SURVIVED against exactly this assertion. It
    // is kept because refusing a comma-spliced clause is still a real claim, and
    // the SECOND form is the one that reaches the `$`: it keeps the printed
    // period and appends a whole further sentence, which is how Kofu and Raifort
    // actually print (a complete ordered-answer sentence, then another one).
    // **AN ASSERTION THAT REFUSES A STRING FOR THE WRONG REASON IS GREEN AND
    // WORTHLESS; ONLY A MUTANT CAN TELL YOU WHICH ONE YOU WROTE.**
    expect(deriveAttackEffect(`${PRINTED.slice(0, -1)}, then draw a card.`)).toBeNull();
    expect(deriveAttackEffect(`${PRINTED} Then, draw a card.`)).toBeNull();
    expect(deriveAttackEffect(`${PRINTED} If you do, draw 4 cards.`)).toBeNull();
    // Raifort's real shape: a complete sentence followed by a second one.
    expect(deriveAttackEffect(`${PRINTED} Put the other cards back in any order.`)).toBeNull();
  });

  it("refuses a leading clause, so the match is not floating", () => {
    expect(deriveAttackEffect(`Discard an Energy from this Pokémon. ${PRINTED}`)).toBeNull();
  });

  it("the window is a `\\d+` — `4e1` and `0x28` are not printed numbers", () => {
    for (const bogus of ["4e1", "0x28", " 2", "+2"]) {
      expect(
        deriveAttackEffect(
          `Search your deck for ${bogus} cards, shuffle your deck, then put those cards on top of it in any order.`,
        ),
        bogus,
      ).toBeNull();
    }
  });

  it("a window of 0 and a window past the printed ceiling are both refused", () => {
    for (const n of [0, 31, 99]) {
      expect(
        deriveAttackEffect(
          `Search your deck for ${String(n)} cards, shuffle your deck, then put those cards on top of it in any order.`,
        ),
        String(n),
      ).toBeNull();
    }
  });

  it("Dialga's own catalog text resolves off the fixture, not off the constant", () => {
    const card = LOCAL_CARDS[DIALGA];
    const printed = card?.attacks?.[0]?.effect;
    expect(printed).toBe(PRINTED);
    expect(deriveAttackEffect(printed ?? "")).toEqual(searchTopOrderProgram(2));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§2 the registry — three printings, ONE object, one card", () => {
  it("all three ids carry a trainer program", () => {
    for (const id of CIPHER_IDS) expect(programFor(id)?.trainer, id).toBeDefined();
  });

  it("the three printings SHARE one program object, as a card's reprints must", () => {
    const first = programFor(CIPHER_A)?.trainer;
    for (const id of CIPHER_IDS) expect(programFor(id)?.trainer).toBe(first);
  });

  it("no attack and no ability program rides along — the column standing-still", () => {
    // Measured on remote D1 this session: all three ids are `attacks_json IS NULL`
    // and `abilities_json IS NULL`. The registry must not contradict the catalog.
    for (const id of CIPHER_IDS) {
      const program = programFor(id);
      expect(program?.attack, id).toBeUndefined();
      expect(program?.abilities, id).toBeUndefined();
    }
  });

  it("Dialga carries NO registry row — it is READER-keyed, which is the summand", () => {
    // The +1 on `BUILT.attack` this slice is RAW, not registry. If this id ever
    // gained a row the raw remainder and the registry summand would both move and
    // `censusAtHead`'s partition would go red for a reason nobody wrote down.
    expect(programFor(DIALGA)).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§3 the search park — a MANDATORY pick into a destination that is not a zone change", () => {
  it('the Supporter parks a chooseCards over the whole deck, `dest: "deckTop"`', () => {
    const { prompt } = playCipher(supporterBoard(11));
    expect(prompt.dest).toBe("deckTop");
    expect(prompt.max).toBe(2);
  });

  it('the FLOOR equals the ceiling — the printed take carries no "up to"', () => {
    const { prompt } = playCipher(supporterBoard(11));
    expect(prompt.min).toBe(2);
    expect(prompt.min).toBe(prompt.max);
  });

  it("the candidate set is the WHOLE deck — the printed noun is uncategorised", () => {
    const board = supporterBoard(11);
    const { parked, prompt } = playCipher(board);
    expect(prompt.candidates.length).toBe(parked.players.p1.deck.length);
  });

  it('the caption prints the number and DROPS the "up to"', () => {
    const { prompt } = playCipher(supporterBoard(11));
    expect(prompt.note).toBe("Search your deck for 2 cards on top of your deck.");
    expect(prompt.note).not.toContain("up to");
  });

  it("a declining answer is REFUSED, which is what the floor buys", () => {
    const { parked } = playCipher(supporterBoard(11));
    const result = applyAction(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [] },
    });
    expect(result.ok).toBe(false);
  });

  it("a SHORT answer is refused too — one of two is not two", () => {
    const { parked, prompt } = playCipher(supporterBoard(11));
    const one = prompt.candidates.slice(0, 1);
    const result = applyAction(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: one },
    });
    expect(result.ok).toBe(false);
  });

  it("the op literal carries `exact` and NO `reveal` — the print, read off the program", () => {
    const program = searchTopOrderProgram(2);
    const search = program[1];
    if (search?.op !== "searchDeck") throw new Error("expected the search op");
    expect(search.exact).toBe(true);
    // NO `reveal`: this sentence prints none, and D135 says absent rather than
    // `false` because these ops are compared by value.
    expect("reveal" in search).toBe(false);
  });

  it("🛑 an OTHER search still parks at `min: 0` — driven on a board, not asserted", () => {
    // 🛑 **THIS CASE EXISTS BECAUSE THE SWEEP SAID THE OLD ONE DID NOT.** The
    // rung this replaces read `exact` off the program literal and called that
    // "nothing widened" — so the mutant that DELETES the rider check and makes
    // EVERY search mandatory (`min: Math.min(max, candidates.length)` for all six
    // pre-existing producers, so Nest Ball and Earthen Vessel can no longer be
    // declined) survived untouched. A claim about the other producers has to be
    // driven on one of the other producers.
    //
    // Earthen Vessel `sv06.5-096` parks its printed hand COST first
    // (`payFromHand{1}`), so that is resolved and the SEARCH behind it is the
    // subject — an authored registry program this slice did not write, whose
    // `searchDeck` carries no `exact` and must still spell the printed "up to".
    const board = supporterBoard(11);
    const { state: withCard, uid } = toHand(board, "p1", EARTHEN_VESSEL);
    const { state: costParked } = apply(withCard, { type: "playTrainer", seat: "p1", uid });
    if (
      costParked.phase.kind !== "effect:choose" ||
      costParked.phase.prompt.kind !== "chooseCards"
    ) {
      throw new Error("expected the hand-cost park");
    }
    const { state: parked } = pick(costParked, costParked.phase.prompt.candidates.slice(0, 1));
    if (parked.phase.kind !== "effect:choose" || parked.phase.prompt.kind !== "chooseCards") {
      throw new Error("expected the search park");
    }
    expect(parked.phase.prompt.dest).toBe("hand");
    expect(parked.phase.prompt.min).toBe(0);
    expect(parked.phase.prompt.max).toBe(2);
    // …and the decline really is answerable, which is what `min: 0` MEANS.
    const declined = applyAction(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [] },
    });
    expect(declined.ok).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§4 the placement — the picks land on TOP and the deck never changes size", () => {
  it("the two picked cards are the top two, in the ORDER they were picked", () => {
    const { parked, prompt } = playCipher(supporterBoard(11));
    const picks = prompt.candidates.slice(4, 6);
    const { state } = pick(parked, picks);
    expect(state.players.p1.deck.slice(0, 2)).toEqual([...picks]);
  });

  it("the deck's SIZE is invariant — this destination is not a zone change", () => {
    const { parked, prompt } = playCipher(supporterBoard(11));
    const before = parked.players.p1.deck.length;
    const { state } = pick(parked, prompt.candidates.slice(4, 6));
    expect(state.players.p1.deck.length).toBe(before);
  });

  it("the picked cards do NOT enter the hand, and the hand is untouched", () => {
    const { parked, prompt } = playCipher(supporterBoard(11));
    const before = [...parked.players.p1.hand];
    const picks = prompt.candidates.slice(4, 6);
    const { state } = pick(parked, picks);
    expect(state.players.p1.hand).toEqual(before);
    for (const uid of picks) expect(state.players.p1.hand).not.toContain(uid);
  });

  it("each picked uid appears EXACTLY ONCE in the deck afterwards", () => {
    // The placement prepends and the removal filters; a version that forgot the
    // filter would duplicate a uid, which is the card-duplication shape the M1
    // review called out on the mirror-image bench clamp.
    const { parked, prompt } = playCipher(supporterBoard(11));
    const picks = prompt.candidates.slice(4, 6);
    const { state } = pick(parked, picks);
    for (const uid of picks) {
      expect(state.players.p1.deck.filter((u) => u === uid).length, uid).toBe(1);
    }
  });

  it("the SHUFFLE happens, and it happens BEFORE the placement", () => {
    // Seed a known deck order, play the card, pick the two cards that were NOT on
    // top, and assert both halves at once: the picks are on top (so the placement
    // ran last) and the tail is no longer the seeded sequence (so the shuffle ran
    // at all). A program that shuffled AFTER placing would fail the first half.
    let board = supporterBoard(11);
    const deck = [...board.players.p1.deck];
    board = setDeck(board, "p1", deck);
    const { parked, prompt } = playCipher(board);
    const picks = prompt.candidates.slice(-2);
    const { state } = pick(parked, picks);
    expect(state.players.p1.deck.slice(0, 2)).toEqual([...picks]);
    expect(state.players.p1.deck).not.toEqual(deck);
  });

  it("the SAME uids are in the deck before and after — nothing is created or lost", () => {
    const { parked, prompt } = playCipher(supporterBoard(11));
    const before = [...parked.players.p1.deck].sort();
    const { state } = pick(parked, prompt.candidates.slice(4, 6));
    expect([...state.players.p1.deck].sort()).toEqual(before);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§5 the SECOND park — its candidates are the first answer, through the deck", () => {
  it("the search's answer parks an `orderCards` over exactly the picked cards", () => {
    const { parked, prompt } = playCipher(supporterBoard(11));
    const picks = prompt.candidates.slice(4, 6);
    const { state } = pick(parked, picks);
    expect(orderPrompt(state).candidates).toEqual([...picks]);
  });

  it("the ordering window is `n` deep and never deeper", () => {
    const { parked, prompt } = playCipher(supporterBoard(11));
    const { state } = pick(parked, prompt.candidates.slice(4, 6));
    expect(orderPrompt(state).candidates.length).toBe(2);
  });

  it("NO card the player did not search for is in the ordering window", () => {
    // This is the assertion `exact` exists for. Every candidate of the second
    // park must have been an answer to the first one.
    const { parked, prompt } = playCipher(supporterBoard(11));
    const picks = prompt.candidates.slice(4, 6);
    const { state } = pick(parked, picks);
    for (const uid of orderPrompt(state).candidates) expect(picks).toContain(uid);
  });

  it("the ordering answer re-sequences the top of the deck", () => {
    const { parked, prompt } = playCipher(supporterBoard(11));
    const picks = prompt.candidates.slice(4, 6);
    const { state: ordering } = pick(parked, picks);
    const reversed = [...orderPrompt(ordering).candidates].reverse();
    const { state } = order(ordering, reversed);
    expect(state.players.p1.deck.slice(0, 2)).toEqual(reversed);
  });

  it("the IDENTITY permutation is a legal answer and leaves the pick order alone", () => {
    const { parked, prompt } = playCipher(supporterBoard(11));
    const picks = prompt.candidates.slice(4, 6);
    const { state: ordering } = pick(parked, picks);
    const { state } = order(ordering, orderPrompt(ordering).candidates);
    expect(state.players.p1.deck.slice(0, 2)).toEqual([...picks]);
  });

  it("a non-permutation answer to the second park is refused", () => {
    const { parked, prompt } = playCipher(supporterBoard(11));
    const picks = prompt.candidates.slice(4, 6);
    const { state: ordering } = pick(parked, picks);
    const first = picks[0] ?? "";
    const result = applyAction(ordering, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "orderCards", uids: [first, first] },
    });
    expect(result.ok).toBe(false);
  });

  it("the program ENDS after the ordering — two parks, then done", () => {
    const { parked, prompt } = playCipher(supporterBoard(11));
    const { state: ordering } = pick(parked, prompt.candidates.slice(4, 6));
    const { state } = order(ordering, [...orderPrompt(ordering).candidates].reverse());
    expect(state.phase.kind).not.toBe("effect:choose");
  });

  it("the deck's SIZE survives both parks unchanged", () => {
    const board = supporterBoard(11);
    const { parked, prompt } = playCipher(board);
    const before = parked.players.p1.deck.length;
    const { state: ordering } = pick(parked, prompt.candidates.slice(4, 6));
    const { state } = order(ordering, [...orderPrompt(ordering).candidates].reverse());
    expect(state.players.p1.deck.length).toBe(before);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§6 the attack column — Dialga runs the identical program", () => {
  /** A board with Dialga Active for p1, fuelled for its {C} attack. */
  function attackBoard(seed: number): GameState {
    let state = localSetup(seed, "p2");
    state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
    const side = state.players.p1;
    const body = side.active;
    if (body === null) throw new Error("p1 has no Active");
    const dialgaUid = side.deck.find((u) => state.cardIdByUid[u] === DIALGA);
    const energyUid = side.deck.find((u) => state.cardIdByUid[u] === METAL_ENERGY);
    if (dialgaUid === undefined || energyUid === undefined) throw new Error("deck lacks fixtures");
    return {
      ...state,
      players: {
        ...state.players,
        p1: {
          ...side,
          // The whole STACK is replaced, not just a top card: the seeded Active
          // is a different Basic and Dialga is not evolving onto it.
          active: { ...body, stack: [dialgaUid], energy: [energyUid] },
          deck: side.deck.filter((u) => u !== dialgaUid && u !== energyUid),
          discard: [...side.discard, ...body.stack],
        },
      },
    };
  }

  it("the attack parks the SAME search prompt the Supporter does", () => {
    const state = must(applyAction(attackBoard(7), { type: "attack", seat: "p1", index: 0 }));
    if (state.phase.kind !== "effect:choose") throw new Error(`not parked: ${state.phase.kind}`);
    if (state.phase.prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    expect(state.phase.prompt.dest).toBe("deckTop");
    expect(state.phase.prompt.min).toBe(2);
    expect(state.phase.prompt.max).toBe(2);
  });

  it("the attack's two parks resolve to the same top-of-deck as the Supporter's", () => {
    const parked = must(applyAction(attackBoard(7), { type: "attack", seat: "p1", index: 0 }));
    if (parked.phase.kind !== "effect:choose" || parked.phase.prompt.kind !== "chooseCards") {
      throw new Error("expected the search park");
    }
    const picks = parked.phase.prompt.candidates.slice(3, 5);
    const { state: ordering } = pick(parked, picks);
    const reversed = [...orderPrompt(ordering).candidates].reverse();
    const { state } = order(ordering, reversed);
    expect(state.players.p1.deck.slice(0, 2)).toEqual(reversed);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§7 the log and the events — a count row, and no card is named", () => {
  function lines(events: readonly GameEvent[], state: GameState): string {
    const ctx: LogContext = { names: { p1: "P1", p2: "P2" }, state, elapsed: "+00:00" };
    return logFromEvents(events, ctx)
      .flatMap((r) => (r.kind === "action" ? [r.segments.map((seg) => seg.text).join("")] : []))
      .join("\n");
  }

  it("`DECK_SEARCHED` carries the new destination and no `reveal`", () => {
    const { parked, prompt } = playCipher(supporterBoard(11));
    const { events } = pick(parked, prompt.candidates.slice(4, 6));
    const row = find(events, "DECK_SEARCHED");
    expect(row?.dest).toBe("deckTop");
    expect(row?.reveal).toBeUndefined();
  });

  it("the log row is a COUNT and names no card — the deck is hidden", () => {
    const { parked, prompt } = playCipher(supporterBoard(11));
    const picks = prompt.candidates.slice(4, 6);
    const { events } = pick(parked, picks);
    const text = lines(events, parked);
    expect(text).toContain("searched their deck — put 2 cards on top");
    for (const uid of picks) {
      const name = POOL[parked.cardIdByUid[uid] ?? ""]?.name ?? "?";
      expect(text).not.toContain(name);
    }
  });

  it("the LOOK is announced when the window opens, not when the answer lands", () => {
    // 🛑 `DECK_TOP_REORDERED` rides the action that RAN `reorderTop` — the search
    // resolve — and not the ordering resolve behind it. That is D241's rule ("the
    // look is announced on every path, including the ones that do not park") and
    // it is asserted here rather than assumed because the intuitive reading is
    // the other one: the opponent is owed the fact that cards were LOOKED AT the
    // moment they were, whether or not the looker ever answers.
    const { parked, prompt } = playCipher(supporterBoard(11));
    const { state: ordering, events: opened } = pick(parked, prompt.candidates.slice(4, 6));
    const row = find(opened, "DECK_TOP_REORDERED");
    expect(row?.count).toBe(2);
    expect(row?.seat).toBe("p1");
    expect(row?.actor).toBe("p1");
    // And the answer itself files nothing — the sequence is private, so there is
    // no second row and no card is ever named on either.
    const { events: answered } = order(ordering, [...orderPrompt(ordering).candidates].reverse());
    expect(find(answered, "DECK_TOP_REORDERED")).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§8 the wire — the prompt crosses redaction with its new destination", () => {
  it('the controller\'s redacted view carries `dest: "deckTop"`', () => {
    const { parked } = playCipher(supporterBoard(11));
    const view = redactGame(parked, "p1");
    if (view.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    if (view.phase.prompt?.kind !== "chooseCards") throw new Error("expected chooseCards");
    expect(view.phase.prompt.dest).toBe("deckTop");
    expect(view.phase.prompt.min).toBe(2);
  });

  it("the OPPONENT is told there is a prompt and not what is in it", () => {
    const { parked } = playCipher(supporterBoard(11));
    const view = redactGame(parked, "p2");
    if (view.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(view.phase.prompt).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§9 the short deck — the floor clamps and the second park collapses", () => {
  it("a ONE-card deck lowers the floor to what the zone can offer", () => {
    let board = supporterBoard(11);
    const { state: withCard, uid } = toHand(board, "p1", CIPHER_A);
    board = setDeck(withCard, "p1", withCard.players.p1.deck.slice(0, 1));
    const { state: parked } = apply(board, { type: "playTrainer", seat: "p1", uid });
    if (parked.phase.kind !== "effect:choose" || parked.phase.prompt.kind !== "chooseCards") {
      throw new Error("expected the search park");
    }
    // The ceiling is still the printed 2 — a ceiling above the candidate count
    // never binds — but the FLOOR must fall or the prompt is unanswerable.
    expect(parked.phase.prompt.min).toBe(1);
    expect(parked.phase.prompt.max).toBe(2);
  });

  it("that one card lands on top and NO ordering park follows it", () => {
    // `reorderTop`'s own arithmetic guard: a 1-card window admits exactly one
    // ordering, so a park would offer a prompt with one legal answer.
    let board = supporterBoard(11);
    const { state: withCard, uid } = toHand(board, "p1", CIPHER_A);
    board = setDeck(withCard, "p1", withCard.players.p1.deck.slice(0, 1));
    const { state: parked } = apply(board, { type: "playTrainer", seat: "p1", uid });
    if (parked.phase.kind !== "effect:choose" || parked.phase.prompt.kind !== "chooseCards") {
      throw new Error("expected the search park");
    }
    const only = parked.phase.prompt.candidates;
    const { state } = pick(parked, only);
    expect(state.players.p1.deck).toEqual([...only]);
    expect(state.phase.kind).not.toBe("effect:choose");
  });

  it("an EMPTY deck plays the card, parks nothing and ends silently", () => {
    // `searchDeck` carries no `programPlayable` arm, which is the standing
    // reading: a search that can find nothing is a no-op, and the printed
    // shuffle of an empty deck is a shuffle of an empty deck.
    let board = supporterBoard(11);
    const { state: withCard, uid } = toHand(board, "p1", CIPHER_A);
    board = setDeck(withCard, "p1", []);
    const { state } = apply(board, { type: "playTrainer", seat: "p1", uid });
    expect(state.phase.kind).not.toBe("effect:choose");
    expect(state.players.p1.deck).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("§10 the version anchor", () => {
  it("the engine version moved PAST the D342 bump", () => {
    // 🆕 D342 — re-pointed here from `derivedReorderTop.test.ts` (D341's file),
    // which is where this assertion has lived since that slice. ONE bump: a new
    // `dest` inhabitant, a new optional op field, one new reader and one new
    // registry object — no persisted literal was RENAMED, so
    // `MATCH_RECORD_VERSION` stays 20 and only the engine version moves.
    //
    // 🆕🛑🛑 **D343 — D342 WROTE THE LESSON AND THEN COMMITTED THE DEFECT ONE FILE
    // OVER, IN THE SAME COMMIT.** Its own handoff says it plainly: *"A FILE THAT
    // PINS A VERSION IT DOES NOT OWN IS A RUNG THAT REDDENS FOR SOMEONE ELSE'S
    // REASON — `derivedReorderTop.test.ts` pinned `engineVersion` exactly; the
    // anchor now lives with the slice that owns the number and the old site keeps
    // the permanent `>=` claim."* It converted D341's site to `>=` and then wrote
    // a fresh EXACT pin here, which went red at D343 for D343's reason. **THE
    // REMEDY WAS UNDERSTOOD, APPLIED BACKWARDS, AND SURVIVED ITS OWN AUTHOR BY
    // ONE SLICE.**
    //
    // So this site now keeps the claim that is permanently true of it: the row
    // this file is about shipped at 0.248.0, and nothing later can un-ship it.
    // **THE EXACT PIN LIVES IN `legacyEnergy.test.ts` AND NOWHERE ELSE** — it is
    // the site whose whole subject IS the number, it is one of the four that a
    // bump must touch anyway, and a second exact pin is not a second measurement,
    // it is a second thing to remember.
    expect(engineVersion >= "0.248.0").toBe(true);
  });
});
