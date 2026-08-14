import { describe, expect, it } from "vitest";
import type { GameEvent, GameState } from "./index";
import { programFor } from "./registry";
import {
  FIXTURE_POOL,
  MULTI_NOUN_SEARCH_DECK,
  driveSetup,
  expectErr,
  handFromDeck,
  handUid,
  mustApply,
} from "./testFixtures";

// D336 — THE THREE- AND FOUR-NOUN `searchDeck`, AND THE SIXTH CONSECUTIVE
// INHERITED PRICE THAT IS FALSE IN THE CLAUSE THAT MADE ITS ROW CHEAP.
//
// ── THE PRINTED SENTENCES ───────────────────────────────────────────────────
//   Larry's Skill `sv08.5-115`/`-139` (Supporter, 2 legal):
//     "Discard your hand and search your deck for **a Pokémon, a Supporter
//      card, and a Basic Energy card**, reveal them, and put them into your
//      hand. Then, shuffle your deck."
//   Secret Box `sv06-163` (Item, 1 legal):
//     "You can use this card only if you discard 3 other cards from your hand.
//      / Search your deck for **an Item card, a Pokémon Tool card, a Supporter
//      card, and a Stadium card**, reveal them, and put them into your hand.
//      Then, shuffle your deck."
//
// ── THE CENSUS, RE-RUN AT THIS HEAD AND WIDENED PAST THE INHERITED LITERAL ──
// Every figure re-queried against remote D1 `luminous` (3,786 rows, 2,021
// `legal_standard`) on 2026-08-14 rather than inherited, and every split
// re-added against its own total.
//
//   (a) THE INHERITED LITERAL — `instr(<col>,', and a ') > 0`:
//         `effect`         3 rows / 3 legal — Secret Box + Larry's Skill ×2
//         `attacks_json`   0 rows / 0 legal
//         `abilities_json` 0 rows / 0 legal
//       TOTAL 3 rows / 3 legal.  3 + 0 + 0 = 3 ✅   3 + 0 + 0 = 3 ✅
//       So the resume point's "3 rows / 3 legal" is TRUE, and it is also the
//       narrowest true statement available.
//
//   (b) 🛑 THE WIDENED FORM, WHICH FINDS FIVE PRINTINGS THAT LITERAL CANNOT
//       SEE — `instr(<col>,'earch your deck for') > 0 AND
//       instr(<col>,' and a ') > 0`, i.e. the SENTENCE rather than the Oxford
//       comma, over all three text columns:
//
//         arity | printings | legal | cards
//           2   |     5     |   0   | Arven `sv01-166`/`-235`/`-249`,
//               |           |       |       `sv03-186`, `sv04.5-235`
//           3   |     2     |   2   | Larry's Skill `sv08.5-115`/`-139`
//           4   |     1     |   1   | Secret Box `sv06-163`
//       TOTAL 8 printings / 3 legal.  5 + 2 + 1 = 8 ✅   0 + 2 + 1 = 3 ✅
//
//       **THE ARITY AXIS STARTS AT TWO AND ITS TWO IS ENTIRELY OUT OF
//       STANDARD.** Arven is measured and deliberately NOT built — D187's rule
//       that an arm transfers across sets and a registry ROW does not, legality
//       being a hard filter on a row keyed by card id. It is recorded because it
//       is the evidence that decided the field's SHAPE, not because it is
//       buildable.
//
//   (c) THE WORD ORDER AND THE ARTICLE, probed rather than assumed:
//       `', and an '` returns **0 rows over all three columns**, so no printing
//       ends its list on a vowel-initial noun; `', and 1 '` and `', and 2 '`
//       return 0 as well, so no printed list caps a member above one.
//
//   (d) ⚠️ THE NEAR MISS THAT IS A DIFFERENT GRAMMAR, and it is worth naming
//       because it is what the field must NOT be. `instr(abilities_json,
//       'card, a ') > 0` returns **4 rows / 4 legal** — Infernape `svp-116`/
//       `sv06-033`/`sv06-173` and Steven's Metagross ex `sv10-145` — and every
//       one of them prints *"a Basic {X} Energy card, a Basic {Y} Energy card,
//       **or 1 of each**"*. That is a DISJUNCTION with an either/or total, not a
//       conjunction of separately capped nouns; `sv10-145` is even a
//       `searchDeck` sentence. Building `also` as "several filters, take some"
//       would have claimed these four and got all four wrong.
//
// ── THE INHERITED PRICE, AND THE HALF THAT IS FALSE ─────────────────────────
// The resume point priced this row: *"`chooseCards.caps` is **already a LIST**
// for exactly this reason, so that slice buys only its own op field."*
//
// ✅ **THE FIRST CLAUSE IS TRUE, AND GREPPING THE READERS MAKES IT SHARPER.**
//    `caps` is `readonly {uids; max}[]` (D332) and BOTH of its readers are
//    arity-blind: `validateChoice`'s `for (const cap of prompt.caps ?? [])`
//    (cardplay.ts) and `GameHud`'s `cappedOut` `.some(...)`. A third and a
//    fourth group cost them nothing, `packages/schema` gains no key, and
//    `redact.ts` and `projection.ts` copy the list whole. The prompt half really
//    was free.
//
// 🛑 **"BUYS ONLY ITS OWN OP FIELD" IS THE FALSE HALF — THE SIXTH CONSECUTIVE
//    PRICE FALSE IN ITS CHEAPEST CLAUSE.** `searchNote` (interpreter.ts) took
//    ONE filter and ONE number and had **no join at all**: `lookNote` was given
//    its two-noun join at D332 and this function never was. The op field feeds a
//    PREDICATE (candidates, total, caps) *and* a STRING, and D334's rule is that
//    such a field owes BOTH arms. Without the caption arm this slice would have
//    shipped a dialog reading **"Search your deck for up to 3 Pokémon into your
//    hand."** over Larry's Skill — the flat SUM against the FIRST group's noun,
//    with the printed conjunction deleted. That is not a gap; it is a live
//    mis-caption of exactly the class D330 and D332 keep finding, and the case
//    below drives it.
//
// 🛑 **AND THE SERIAL COMMA IS ITS OWN SUB-CLAUSE.** `lookNote` joins with a
//    bare " and " because Drayton spells two nouns. Three and four need
//    "A, B, and C" / "A, B, C, and D", which that join cannot produce at any
//    arity. **A LIST FIELD DOES NOT INHERIT A PAIR FIELD'S CAPTION.**
//
// 🆕 **THE LESSON: "THE OTHER OP ALREADY DID THIS" IS A CLAIM ABOUT ONE
//    CONSUMER.** D332 paid for `lookAtTopN`'s prompt half AND its caption half;
//    the price forwarded to this slice remembered only the prompt half, because
//    that is the half that was hard last time. **A SHARED PIECE IS SHARED PER
//    READER, NOT PER OP** — so grep the readers of the thing you are reusing,
//    not the slice that built it.

const LARRY_IDS = ["sv08.5-115", "sv08.5-139"] as const;

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

/** Setup, then open P1's turn 2 (P2 went first and passed) — P1's first
    unrestricted turn, so a Supporter is legal (§7.2). */
function board(seed: number): GameState {
  const state = driveSetup(
    seed,
    { p1: MULTI_NOUN_SEARCH_DECK, p2: MULTI_NOUN_SEARCH_DECK },
    { first: "p2" },
  );
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** The uids in p1's DECK carrying `id`. The deck is the whole search zone, so —
    unlike the sibling op — no window needs seeding: what is in the deck is what
    is offered. */
function deckUids(state: GameState, id: string): string[] {
  return state.players.p1.deck.filter((uid) => state.cardIdByUid[uid] === id);
}

/** Play `id` out of p1's hand and return the parked chooseCards prompt with it. */
function play(state: GameState, id: string) {
  const withCard = handFromDeck(state, "p1", id, 1);
  const uid = handUid(withCard, "p1", id);
  const { state: parked, events } = mustApply(withCard, {
    type: "playTrainer",
    seat: "p1",
    uid,
  });
  if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
  if (parked.phase.prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
  return { parked, prompt: parked.phase.prompt, events, seeded: withCard };
}

/** Secret Box parks its hand COST first — `payFromHand{3}`. Resolve that with
    three cards the player is happy to lose and return the SEARCH prompt behind
    it. A test that stopped at the first park would be asserting about the cost. */
function playSecretBox(state: GameState) {
  const withCard = handFromDeck(state, "p1", "fix-secretbox", 1);
  const uid = handUid(withCard, "p1", "fix-secretbox");
  const { state: costParked } = mustApply(withCard, { type: "playTrainer", seat: "p1", uid });
  if (costParked.phase.kind !== "effect:choose") throw new Error("expected the cost park");
  if (costParked.phase.prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
  const paid = costParked.phase.prompt.candidates.slice(0, 3);
  const { state: parked } = mustApply(costParked, {
    type: "resolveEffect",
    seat: "p1",
    choice: { kind: "cards", uids: paid },
  });
  if (parked.phase.kind !== "effect:choose") throw new Error("expected the search park");
  if (parked.phase.prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
  return { parked, prompt: parked.phase.prompt, paid };
}

describe("D336 — the three- and four-noun searchDeck", () => {
  // ── §1 THE PRINTED SHAPE, READ OFF THE REGISTRY BEFORE ANY BOARD RUNS ──────
  //
  // 🆕 D335's finding, kept as a standing section: a value no board can
  // distinguish is still the wrong printed word, and the only thing that catches
  // a card printed wrong in a way the rules cannot see yet is an assertion about
  // the SHAPE.

  it("the registry resolves a program for all three printings and both demonstrators", () => {
    for (const id of LARRY_IDS) expect(programFor(id), id).toBeDefined();
    expect(programFor("sv06-163")).toBeDefined();
    expect(programFor("fix-larrysskill")).toBeDefined();
    expect(programFor("fix-secretbox")).toBeDefined();
  });

  it("Larry's two printings share ONE program object — a reprint, not two authorings", () => {
    const first = programFor("sv08.5-115");
    for (const id of LARRY_IDS) expect(programFor(id), id).toBe(first);
  });

  it("Larry's Skill prints THREE groups, each capped at one, in the printed order", () => {
    const op = programFor("fix-larrysskill")?.trainer?.[1];
    if (op?.op !== "searchDeck") throw new Error("expected a searchDeck op");
    expect(op.filter).toEqual({ kind: "anyPokemon" });
    expect(op.max).toBe(1);
    expect(op.dest).toBe("hand");
    expect(op.reveal).toBe(true);
    // The list is the printed tail of the sentence, in the printed sequence —
    // the caption walks it in order, so the order is load-bearing for the string
    // even though the candidate set and the caps are order-free.
    expect(op.also).toEqual([
      { filter: { kind: "supporter" }, max: 1 },
      { filter: { kind: "basicEnergy" }, max: 1 },
    ]);
  });

  it("Secret Box prints FOUR groups — the arity a pair field could not have spelled", () => {
    const op = programFor("fix-secretbox")?.trainer?.[1];
    if (op?.op !== "searchDeck") throw new Error("expected a searchDeck op");
    expect(op.filter).toEqual({ kind: "item" });
    expect(op.also).toHaveLength(3);
    expect(op.also).toEqual([
      { filter: { kind: "toolCard" }, max: 1 },
      { filter: { kind: "supporter" }, max: 1 },
      { filter: { kind: "stadium" }, max: 1 },
    ]);
    // 🛑 FOUR IS THE WHOLE ARGUMENT FOR A LIST. `lookAtTopN.also` is a single
    // pair by D331's rule (ship the arity the printing spells); this op's
    // printing spells four, so the same rule produces a different shape.
    expect([op.filter, ...(op.also ?? [])]).toHaveLength(4);
  });

  it("Secret Box's program is Ultra Ball's with a wider middle — cost, search, shuffle", () => {
    const program = programFor("fix-secretbox")?.trainer;
    const ultra = programFor("sv01-196")?.trainer;
    expect(program?.map((op) => op.op)).toEqual(["payFromHand", "searchDeck", "shuffleDeck"]);
    expect(ultra?.map((op) => op.op)).toEqual(["payFromHand", "searchDeck", "shuffleDeck"]);
    // The printed "3 OTHER cards" needs no rider: playTrainer discards the card
    // before the program runs, so the Item can never pay for itself.
    const cost = program?.[0];
    if (cost?.op !== "payFromHand") throw new Error("expected payFromHand");
    expect(cost.count).toBe(3);
    expect(cost.to).toBe("discard");
  });

  it("Larry's program discards the hand BEFORE it searches — the printed order", () => {
    // Ordering these the other way would discard the three cards the search just
    // found, which is why the sequence is asserted rather than the membership.
    expect(programFor("fix-larrysskill")?.trainer?.map((op) => op.op)).toEqual([
      "discardHand",
      "searchDeck",
      "shuffleDeck",
    ]);
  });

  it("the attribution control is the SAME op with `also` absent", () => {
    // Earthen Vessel: `payFromHand{1} + searchDeck{basicEnergy, max 2, reveal}`.
    // Every difference the boards below observe is attributable to `also` and to
    // nothing else — and its flat `max: 2` is what makes "two of one kind" a
    // LEGAL answer somewhere on this very deck.
    const control = programFor("sv06.5-096")?.trainer?.[1];
    if (control?.op !== "searchDeck") throw new Error("expected a searchDeck op");
    expect(control.also).toBeUndefined();
    expect(control.max).toBe(2);
    expect(control.reveal).toBe(true);
    expect(control.dest).toBe("hand");
  });

  it("the fixture pool prints both sentences this slice built", () => {
    // 🛑 D330's rule: a program can be reachable from the catalog and
    // unreachable from the only pool the tests own. These are the printed bytes
    // the boards below actually play.
    expect(FIXTURE_POOL["fix-larrysskill"]?.effect).toContain(
      "a Pokémon, a Supporter card, and a Basic Energy card",
    );
    expect(FIXTURE_POOL["fix-larrysskill"]?.trainerType).toBe("Supporter");
    expect(FIXTURE_POOL["fix-secretbox"]?.effect).toContain(
      "an Item card, a Pokémon Tool card, a Supporter card, and a Stadium card",
    );
    expect(FIXTURE_POOL["fix-secretbox"]?.trainerType).toBe("Item");
    // The cost sentence is on the same printed card and is why `payFromHand`
    // leads the program.
    expect(FIXTURE_POOL["fix-secretbox"]?.effect).toContain("discard 3 other cards from your hand");
  });

  // ── §2 THE OFFER: THE UNION, THE TOTAL AND THE CAPS ───────────────────────

  it("offers the UNION of all three filters, and refuses what no group names", () => {
    const state = board(1);
    const { prompt } = play(state, "fix-larrysskill");
    const candidates = new Set(prompt.candidates);

    for (const id of ["fix-basic-1", "fix-basic-2", "sv01-189", "fix-energy", "fix-fire-energy"]) {
      for (const uid of deckUids(state, id)) {
        expect(candidates.has(uid), `${id} must be offered`).toBe(true);
      }
    }
    // 🛑 THE REFUSAL IS WHAT PROVES IT IS A UNION OF FILTERS RATHER THAN "THE
    // WHOLE DECK". Tools and Stadiums are named by SECRET BOX and by no group of
    // Larry's, so they must not appear here.
    for (const id of ["fix-tool", "fix-stadium"]) {
      for (const uid of deckUids(state, id)) {
        expect(candidates.has(uid), `${id} must NOT be offered`).toBe(false);
      }
    }
  });

  it("the total is the SUM of the printed caps, and the caps are per noun", () => {
    const state = board(2);
    const { prompt } = play(state, "fix-larrysskill");

    expect(prompt.max).toBe(3); // 1 + 1 + 1
    expect(prompt.min).toBe(0); // a search is "up to" — declining is legal
    expect(prompt.dest).toBe("hand");
    expect(prompt.caps).toHaveLength(3);
    expect(prompt.caps?.[0]?.max).toBe(1);
    expect(prompt.caps?.[1]?.max).toBe(1);
    expect(prompt.caps?.[2]?.max).toBe(1);

    // Each cap's uid list is its OWN group's matches, not the union — which is
    // what makes a uid countable against one cap and not another.
    const pokemon = new Set([...deckUids(state, "fix-basic-1"), ...deckUids(state, "fix-basic-2")]);
    expect(new Set(prompt.caps?.[0]?.uids)).toEqual(pokemon);
    const energy = new Set([...deckUids(state, "fix-energy"), ...deckUids(state, "fix-fire-energy")]);
    expect(new Set(prompt.caps?.[2]?.uids)).toEqual(energy);
  });

  it("Secret Box offers all FOUR nouns and totals four", () => {
    const state = board(3);
    const { prompt } = playSecretBox(state);

    expect(prompt.max).toBe(4); // 1 + 1 + 1 + 1
    expect(prompt.caps).toHaveLength(4);
    const candidates = new Set(prompt.candidates);
    for (const id of ["fix-item", "fix-tool", "sv01-189", "fix-stadium"]) {
      for (const uid of deckUids(state, id)) {
        expect(candidates.has(uid), `${id} must be offered`).toBe(true);
      }
    }
    // Energy is named by LARRY'S and by no group of Secret Box's — the converse
    // refusal, so neither card's offer is "every Trainer plus everything else".
    for (const uid of deckUids(state, "fix-energy")) {
      expect(candidates.has(uid), "Basic Energy must NOT be offered").toBe(false);
    }
  });

  it("a single-group search still carries NO `caps` — the six older parks are untouched", () => {
    // The absent key, D135's rule: `caps: undefined` is not the same wire value
    // as no key at all, and these prompts are compared by value. Earthen Vessel
    // is a `searchDeck` with no `also`, and its prompt must be byte-identical to
    // what it was before this slice existed.
    const state = board(4);
    const withCard = handFromDeck(state, "p1", "sv06.5-096", 1);
    const uid = handUid(withCard, "p1", "sv06.5-096");
    const { state: costParked } = mustApply(withCard, { type: "playTrainer", seat: "p1", uid });
    if (costParked.phase.kind !== "effect:choose") throw new Error("expected the cost park");
    if (costParked.phase.prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    const { state: parked } = mustApply(costParked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: costParked.phase.prompt.candidates.slice(0, 1) },
    });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected the search park");
    if (parked.phase.prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    expect(parked.phase.prompt.caps).toBeUndefined();
    expect("caps" in parked.phase.prompt).toBe(false);
    expect(parked.phase.prompt.max).toBe(2);
  });

  // ── §3 THE CAPTION — THE HALF THE INHERITED PRICE SAID WAS FREE ───────────

  it("🛑 CAPTIONS THE PRINTED THREE-NOUN LIST WITH THE PRINTED SERIAL COMMA", () => {
    const state = board(5);
    const { prompt } = play(state, "fix-larrysskill");
    expect(prompt.note).toBe(
      "Search your deck for a Pokémon, a Supporter card, and a Basic Energy card into your hand.",
    );
    // 🛑 THE PRICE'S FALSE CLAUSE, DRIVEN. Had the caption not been paid for,
    // `searchNote` would have read the flat SUM against the FIRST group's noun.
    expect(prompt.note).not.toBe("Search your deck for up to 3 Pokémon into your hand.");
    expect(prompt.note).not.toContain("up to 3");
    // And it is not the disjunction the free `anyOf` candidate set would caption.
    expect(prompt.note).not.toContain(" or ");
  });

  it("🛑 CAPTIONS FOUR NOUNS — the arity `lookNote`'s pair join cannot reach", () => {
    const state = board(6);
    const { prompt } = playSecretBox(state);
    expect(prompt.note).toBe(
      "Search your deck for an Item card, a Pokémon Tool card, a Supporter card, and a Stadium card into your hand.",
    );
    // Three commas' worth of list: two separators plus the Oxford one.
    expect(prompt.note.split(", ")).toHaveLength(4);
  });

  it("the SINGLE-group caption is byte-identical to what it was before this slice", () => {
    // The attribution control for the caption, and the reason the old arm reads
    // the CLAMPED total rather than the group's own number.
    const state = board(7);
    const withCard = handFromDeck(state, "p1", "sv06.5-096", 1);
    const uid = handUid(withCard, "p1", "sv06.5-096");
    const { state: costParked } = mustApply(withCard, { type: "playTrainer", seat: "p1", uid });
    if (costParked.phase.kind !== "effect:choose") throw new Error("expected the cost park");
    if (costParked.phase.prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    const { state: parked } = mustApply(costParked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: costParked.phase.prompt.candidates.slice(0, 1) },
    });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected the search park");
    if (parked.phase.prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    expect(parked.phase.prompt.note).toBe(
      "Search your deck for up to 2 Basic Energy cards into your hand.",
    );
    // No comma, no "and" — the pluralised single-noun sentence, unmoved.
    expect(parked.phase.prompt.note).not.toContain(", and ");
  });

  // ── §4 THE ANSWERS ────────────────────────────────────────────────────────

  it("takes ONE of each noun — all three land in hand and all three are named", () => {
    const state = board(8);
    const { parked } = play(state, "fix-larrysskill");
    const pokemon = deckUids(parked, "fix-basic-1")[0] as string;
    const supporter = deckUids(parked, "sv01-189")[0] as string;
    const energy = deckUids(parked, "fix-energy")[0] as string;
    // `discardHand` has already run, so the hand is whatever the search returns.
    const handBefore = parked.players.p1.hand.length;

    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [pokemon, supporter, energy] },
    });

    expect(done.phase.kind).toBe("turn:action");
    for (const uid of [pokemon, supporter, energy]) {
      expect(done.players.p1.hand).toContain(uid);
      expect(done.players.p1.deck).not.toContain(uid);
    }
    expect(done.players.p1.hand.length).toBe(handBefore + 3);
    // `reveal: true` is the printed "reveal them", so all three are NAMED rather
    // than counted.
    const searched = find(events, "DECK_SEARCHED");
    expect(searched?.reveal).toBe(true);
    expect(new Set(searched?.uids)).toEqual(new Set([pokemon, supporter, energy]));
  });

  it("🛑 REFUSES TWO POKÉMON — the answer the flat total alone would have allowed", () => {
    // THE PRICE'S TRUE CLAUSE, DRIVEN. Two Pokémon is two cards out of an offer
    // whose total is THREE, so the flat `max` admits it happily; only the
    // per-noun cap refuses, and only because it reaches the wire validator.
    const state = board(9);
    const { parked } = play(state, "fix-larrysskill");
    const pokemon = deckUids(parked, "fix-basic-1");
    const a = pokemon[0] as string;
    const b = pokemon[1] as string;
    // Two copies of ONE printing — the plainest form of the refusal; the case
    // below drives the same refusal over two DISTINCT printings.
    expect(a).not.toBe(b);
    expectErr(
      parked,
      { type: "resolveEffect", seat: "p1", choice: { kind: "cards", uids: [a, b] } },
      "BAD_EFFECT_CHOICE",
    );
  });

  it("🛑 REFUSES TWO DISTINCT POKÉMON PRINTINGS — not an interchangeable-copy artifact", () => {
    // D328's §7: a cap tested over two copies of ONE id cannot name which card
    // was offered. These are two different printings.
    const state = board(10);
    const { parked } = play(state, "fix-larrysskill");
    const one = deckUids(parked, "fix-basic-1")[0] as string;
    const two = deckUids(parked, "fix-basic-2")[0] as string;
    expect(one).not.toBe(two);
    expectErr(
      parked,
      { type: "resolveEffect", seat: "p1", choice: { kind: "cards", uids: [one, two] } },
      "BAD_EFFECT_CHOICE",
    );
  });

  it("🛑 REFUSES TWO BASIC ENERGY on Larry's and ALLOWS them on Earthen Vessel", () => {
    // 🛑 THE ATTRIBUTION CONTROL, ON ONE DECK, IN ONE CASE. The same two cards,
    // the same op, the same destination, the same printed reveal — and opposite
    // verdicts, because one program carries `also` and the other does not. This
    // is the case that would still pass if `caps` were deleted and the flat
    // `max` left alone… except that it would not: the refusal below is the half
    // that goes red.
    const state = board(11);
    const { parked } = play(state, "fix-larrysskill");
    const e1 = deckUids(parked, "fix-energy")[0] as string;
    const e2 = deckUids(parked, "fix-fire-energy")[0] as string;
    expectErr(
      parked,
      { type: "resolveEffect", seat: "p1", choice: { kind: "cards", uids: [e1, e2] } },
      "BAD_EFFECT_CHOICE",
    );

    // The control: the very same pair of printings, taken two-at-once, is LEGAL
    // under a flat `max: 2` with no `also`.
    const control = board(11);
    const withCard = handFromDeck(control, "p1", "sv06.5-096", 1);
    const uid = handUid(withCard, "p1", "sv06.5-096");
    const { state: costParked } = mustApply(withCard, { type: "playTrainer", seat: "p1", uid });
    if (costParked.phase.kind !== "effect:choose") throw new Error("expected the cost park");
    if (costParked.phase.prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    const { state: searchParked } = mustApply(costParked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: costParked.phase.prompt.candidates.slice(0, 1) },
    });
    const c1 = deckUids(searchParked, "fix-energy")[0] as string;
    const c2 = deckUids(searchParked, "fix-fire-energy")[0] as string;
    const { state: done } = mustApply(searchParked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [c1, c2] },
    });
    expect(done.players.p1.hand).toContain(c1);
    expect(done.players.p1.hand).toContain(c2);
  });

  it("🛑 REFUSES TWO OF ONE NOUN ON SECRET BOX TOO — four groups, same rule", () => {
    const state = board(12);
    const { parked } = playSecretBox(state);
    const i1 = deckUids(parked, "fix-item")[0] as string;
    const i2 = deckUids(parked, "sv06.5-096")[0] as string; // Earthen Vessel is an Item
    expect(i1).not.toBe(i2);
    expectErr(
      parked,
      { type: "resolveEffect", seat: "p1", choice: { kind: "cards", uids: [i1, i2] } },
      "BAD_EFFECT_CHOICE",
    );
  });

  it("REFUSES a FOURTH card on Larry's — the flat total still binds", () => {
    // Both refusals are live and independent: a pick can be under the total and
    // over its own cap, and under its cap and over the total.
    const state = board(13);
    const { parked } = play(state, "fix-larrysskill");
    const pokemon = deckUids(parked, "fix-basic-1")[0] as string;
    const supporter = deckUids(parked, "sv01-189")[0] as string;
    const energy = deckUids(parked, "fix-energy")[0] as string;
    const extra = deckUids(parked, "fix-basic-2")[0] as string;
    expectErr(
      parked,
      {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "cards", uids: [pokemon, supporter, energy, extra] },
      },
      "BAD_EFFECT_CHOICE",
    );
  });

  it("TAKING FEWER IS LEGAL — a search is 'up to', so one noun alone resolves", () => {
    const state = board(14);
    const { parked } = play(state, "fix-larrysskill");
    const supporter = deckUids(parked, "sv01-189")[0] as string;
    const { state: done } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [supporter] },
    });
    expect(done.phase.kind).toBe("turn:action");
    expect(done.players.p1.hand).toContain(supporter);
    expect(done.players.p1.hand.length).toBe(1);
  });

  it("DECLINING IS LEGAL and the deck is still shuffled", () => {
    const state = board(15);
    const { parked } = play(state, "fix-larrysskill");
    const deckBefore = parked.players.p1.deck.length;
    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [] },
    });
    expect(done.phase.kind).toBe("turn:action");
    expect(done.players.p1.hand.length).toBe(0);
    expect(done.players.p1.deck.length).toBe(deckBefore);
    // The trailing `shuffleDeck` fires on every path, decline included.
    expect(find(events, "SHUFFLE")).toBeDefined();
  });

  it("a card matching NO group cannot be taken, even under the total", () => {
    const state = board(16);
    const { parked } = play(state, "fix-larrysskill");
    const tool = deckUids(parked, "fix-tool")[0] as string;
    expectErr(
      parked,
      { type: "resolveEffect", seat: "p1", choice: { kind: "cards", uids: [tool] } },
      "BAD_EFFECT_CHOICE",
    );
  });
});
