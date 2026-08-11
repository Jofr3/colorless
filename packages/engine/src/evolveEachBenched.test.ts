import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { legalAttackCorpus } from "./censusAttackCorpus";
import { deriveAttackEffect, splitAttackGateClause } from "./effects";
import { applyAction, createGame } from "./index";
import type { GameState, Seat } from "./index";
import {
  FIXTURE_POOL,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  firstBasicInHand,
  must,
  mustApply,
  setActiveFromDeck,
} from "./testFixtures";

// ── D308 — "FOR EACH OF YOUR BENCHED POKÉMON, SEARCH YOUR DECK FOR A CARD THAT
//    EVOLVES FROM THAT POKÉMON AND PUT IT ONTO THAT POKÉMON TO EVOLVE IT." THE
//    ITERATED HALF OF D307's FAMILY — AND IT NEEDS NO PARK OF ITS OWN. ──
//
// THE POPULATION, re-queried END TO END against remote Cloudflare D1 `luminous`
// (`735f0fb5-cdc3-494d-8b97-74a8ade0124a`) over MCP on **2026-08-09**:
//
//   SELECT id, name, stage, evolve_from, legal_standard, attacks_json
//     FROM cards
//    WHERE instr(attacks_json,'deck for a card that evolves') > 0
//      AND legal_standard = 1
//    ORDER BY id;
//
// **THIRTEEN legal printings**, which is D307's DOUBT ONE answered: its number
// came off `censusAtHead.test.ts`'s hand-maintained row 0 and it is exactly right,
// re-derived a SECOND way off the committed corpus (`censusAttackCorpus.ts` lines
// 84 / 267 / 450 / 451 and the licensed record at 331). D307 built 6; the
// remainder is **7**, split **4 / 2 / 1**, and the whole column was read on every
// row (D306's rule — every arm, `damage` and `cost` included):
//
//   • **4 — THIS SLICE.** Vivillon `sv08-007`/`-193` "Evo-Powder" ({C}, no damage;
//     second attack "Cutting Wind" {G} `damage: 90`) and Reuniclus
//     `sv10.5b-039`/`svp-212` "Cellular Ascension" ({C}; second attack
//     "Evo-Lariat" `damage "40+"`, *"40 more damage for each of your Evolution
//     Pokémon in play"*). Both Stage 2. **The two cards print the sentence
//     BYTE-IDENTICALLY**, which is why one corpus record carries all four units.
//   • **2 — the BODY-CHOICE sentence, still refused.** Duosion `sv10.5b-038`/
//     `-119` "Cellular Evolution": *"…a card that evolves from **1 of your
//     Pokémon** and put it onto that Pokémon…"*. §1 drives that refusal.
//   • **1 — the {D} MULTI-BODY sentence, still refused HERE.** Team Rocket's
//     Nidorina `sv10-115` "Dark Awakening": *"**Choose up to 2 of your {D}
//     Pokémon.** For each of those Pokémon, …"*. It carries this slice's tail
//     verbatim, which is why the anchor is `^…$`; §1 drives that refusal too.
//     🆕 **D315 BUILT IT ON ITS OWN ARM** (`evolveFromDeckEachChosen`) and this
//     anchor's refusal is UNCHANGED — §1's rung now asserts both halves.
//
// ── D307's DOUBT TWO, ANSWERED THE OTHER WAY ────────────────────────────────
//
// 🛑 **IT IS ONE BLOCKER WITH THREE DIFFERENT SURCHARGES, AND D307's HEADLINE
// NAMED THE WRONG SENTENCE AS THE EXEMPLAR.** The blocker is single and D307 typed
// it correctly: `evolveFromDeck` resolves its subject through `ctx.sourceUid` and
// has no spelling for another body. What sits on top of it differs per sentence:
//
//   • THIS one needs **no park and no `continuationOps` member**. *"For each"* is
//     not a choice, so the op asks nothing: it resolves synchronously into D216's
//     `schedule`, one already-parking `evolveFromDeck` per occupied bench slot,
//     and `runProgram` unshifts them onto the queue. §5 drives the fact that makes
//     this legal — `cont.rest` carries the ops not yet reached ACROSS a park, so
//     the second and third questions survive a serialised `MatchRecord`.
//   • The DUOSION sentence needs the body-CHOICE park D307 described, and a
//     TARGET rather than a bench index, because it says *"1 of your Pokémon"* and
//     the Active qualifies.
//   • The NIDORINA sentence needs a type-filtered MULTI-body choice, which this
//     comment claimed was "a prompt shape that does not exist at any width today".
//     🆕 🛑 **D315 MEASURED THAT AND IT WAS FALSE** — `choosePokemonMulti` has
//     existed since D47, `cardplay.ts` validates it and both HUDs render it. The
//     surcharge that was really owed is the FOURTH `continuationOps` member, the
//     first whose answer buys N ops. **THE THREE SURCHARGES WERE STILL THREE
//     DIFFERENT ONES; this one was mis-named, not mis-counted.**
//
// **D307's own DOUBT TWO said this and D307's own HEADLINE did not** — a flag's
// doubt out-predicting its headline for the SIXTH consecutive slice on this page
// (D301, D302, D305, D306, D307, D308).
//
// ── WHAT THE ROW COSTS ──────────────────────────────────────────────────────
//
// ONE new `EffectOp` with **no fields** (`evolveFromDeckEachBenched`), ONE new
// OPTIONAL FIELD on `evolveFromDeck` (`ontoBench`, WIDENED TO `onto` AT D309 —
// see that field's doc block for the recorded reversal), ONE anchored regex with **no
// captures**, ONE deriver arm. **NO new prompt kind, NO new choice kind, NO new
// event, NO new error code, NO new `GameState` field, NO new `CardFilter` member,
// NO new `chooseCards.dest` member, NO `continuationOps` member and NO REGISTRY
// ROW** — the raw summand of `BUILT.attack` is keyed on the READER over the whole
// legal corpus (`censusAtHead.test.ts`'s D274 block), so an authored row for
// Vivillon or Reuniclus would buy zero printings. `packages/schema`, `redact.ts`
// and `src/` take ZERO.

/** The sentence this slice builds — Vivillon and Reuniclus, byte-identical. */
const EACH_BENCHED =
  "For each of your Benched Pokémon, search your deck for a card that evolves from that Pokémon and put it onto that Pokémon to evolve it. Then, shuffle your deck.";
/** Duosion `sv10.5b-038`/`-119` — the BODY-CHOICE sentence, still refused. */
const BODY_CHOICE =
  "Search your deck for a card that evolves from 1 of your Pokémon and put it onto that Pokémon to evolve it. Then, shuffle your deck.";
/** Team Rocket's Nidorina `sv10-115` — the {D} MULTI-BODY sentence, refused by
    THIS anchor and built by D315's own (`evolveFromDeckEachChosen`).
    ⚠️ **TRANSCRIBED FROM THE PRINT, NOT BUILT BY INTERPOLATION** (D306's rule, and
    the first draft of this file got it wrong exactly that way): its middle clause
    is *"For each of **those** Pokémon"*, NOT *"of your Benched Pokémon"*, so it
    does **not** contain `EACH_BENCHED` at all. What the two share is the TAIL,
    which is what the `$`-anchor and the leading `For each of your Benched` both
    have to survive; §1 asserts the shared tail rather than a containment that
    would have been true by construction. */
const MULTI_BODY =
  "Choose up to 2 of your {D} Pokémon. For each of those Pokémon, search your deck for a card that evolves from that Pokémon and put it onto that Pokémon to evolve it. Then, shuffle your deck.";
/** The clause `EACH_BENCHED`, `MULTI_BODY` and D307's `BARE` all end on, modulo
    the pronoun. Three sentences of one mechanism, told apart by their HEADS. */
const SHARED_TAIL =
  "search your deck for a card that evolves from that Pokémon and put it onto that Pokémon to evolve it. Then, shuffle your deck.";
/** D307's own sentence — the pronoun half, which must keep resolving to the
    UNSCHEDULED op with no `onto` on it. */
const BARE =
  "Search your deck for a card that evolves from this Pokémon and put it onto this Pokémon to evolve it. Then, shuffle your deck.";

/** Vivillon `sv08-007`, BOTH attacks — D306's lesson as a fixture. A file that
    transcribed only the matching arm would build a one-attack Vivillon and make
    every per-index claim about it vacuous. (Printed a Stage 2 off Spewpa; it is
    placed as the Active by surgery here, so the chain datum is not exercised and
    is deliberately not invented.) */
function vivillon(id: string): Card {
  return battler(id, {
    name: "Vivillon",
    hp: 130,
    retreat: 1,
    types: ["Grass"],
    attacks: [
      { cost: ["Colorless"], name: "Evo-Powder", effect: EACH_BENCHED },
      { cost: ["Grass"], name: "Cutting Wind", damage: 90 },
    ],
  });
}

function basic(id: string): Card {
  return battler(id, { hp: 60, retreat: 1, types: ["Colorless"] });
}

function stage1From(id: string, from: string, hp: number): Card {
  return {
    ...battler(id, { hp, retreat: 1, types: ["Colorless"] }),
    stage: "Stage1",
    evolveFrom: from,
  };
}

const LOCAL_CARDS: Record<string, Card> = {
  "sv08-007": vivillon("sv08-007"),
  /** Bench slot 0's body, with TWO evolutions in the deck so its park is a real
      choice rather than a forced one. */
  "eb-basic-a": basic("eb-basic-a"),
  "eb-evo-a1": stage1From("eb-evo-a1", "eb-basic-a", 110),
  "eb-evo-a2": stage1From("eb-evo-a2", "eb-basic-a", 100),
  /** Bench slot 1's body — ONE evolution, so the second park is a singleton and
      still a park (the printed decline is not a no-choice; D307 §2's rule). */
  "eb-basic-b": basic("eb-basic-b"),
  "eb-evo-b": stage1From("eb-evo-b", "eb-basic-b", 90),
  /** Bench slot 2's body — NOTHING in the pool evolves from it, so its scheduled
      op is the silent whiff. */
  "eb-basic-c": basic("eb-basic-c"),
  /** 🛑 THE ATTRIBUTION CONTROL FOR *"BENCHED"*. An evolution off the ATTACKER
      itself, sitting in the same deck. Without it, "the Active was not evolved"
      would pass on a board where no card could have evolved it — the vacuous
      guard `conventions.md` names eight times. */
  "eb-evo-active": stage1From("eb-evo-active", "Vivillon", 150),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

/** The FIFTEENTH seeded deck (D270's rule: a seeded suite gets its OWN deck). */
const EACH_DECK = deckOf({
  "sv08-007": 4,
  "eb-basic-a": 4,
  "eb-basic-b": 4,
  "eb-basic-c": 4,
  "eb-evo-a1": 4,
  "eb-evo-a2": 4,
  "eb-evo-b": 4,
  "eb-evo-active": 4,
  "fix-basic-1": 4,
  "fix-energy": 24,
});

function localSetup(seed: number, first: Seat): GameState {
  const created = createGame({ seed, decks: { p1: EACH_DECK, p2: EACH_DECK }, cardPool: POOL });
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

/** p1 with Vivillon Active, `bench` on the Bench in the order given, one {C}
    attached. p2 goes FIRST and ends their turn, so p1 attacks on turn 2. */
function board(seed: number, bench: readonly string[] = ["eb-basic-a", "eb-basic-b", "eb-basic-c"]) {
  let state = localSetup(seed, "p2");
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", "sv08-007");
  state = clearBench(state, "p1");
  for (const id of bench) state = benchFromDeck(state, "p1", id);
  return attachFromDeck(state, "p1", "fix-energy", 1);
}

/** Declare Evo-Powder (index 0) and hand back whatever it left behind. */
function declare(state: GameState): GameState {
  return mustApply(state, { type: "attack", seat: "p1", index: 0 }).state;
}

function cardsPrompt(state: GameState) {
  const phase = state.phase;
  if (phase.kind !== "effect:choose" || phase.prompt.kind !== "chooseCards") {
    throw new Error(`expected a chooseCards park, got ${phase.kind}`);
  }
  return phase.prompt;
}

function cont(state: GameState) {
  const phase = state.phase;
  if (phase.kind !== "effect:choose") throw new Error(`expected a park, got ${phase.kind}`);
  return phase.cont;
}

function resolve(state: GameState, uids: readonly string[]): GameState {
  return mustApply(state, {
    type: "resolveEffect",
    seat: "p1",
    choice: { kind: "cards", uids: [...uids] },
  }).state;
}

function candidateIds(state: GameState, uids: readonly string[]): string[] {
  return uids.map((uid) => state.cardIdByUid[uid] ?? "").sort();
}

/** The card id on top of p1's bench slot `index`. */
function benchTopId(state: GameState, index: number): string {
  const body = state.players.p1.bench[index];
  if (body === undefined) throw new Error(`p1 has no bench[${index}]`);
  const uid = body.stack[body.stack.length - 1];
  return state.cardIdByUid[uid ?? ""] ?? "";
}

function activeTopId(state: GameState): string {
  const active = state.players.p1.active;
  if (active === undefined || active === null) throw new Error("p1 has no Active");
  const uid = active.stack[active.stack.length - 1];
  return state.cardIdByUid[uid ?? ""] ?? "";
}

/** Pick the first offered uid whose card id is `cardId`. */
function offered(state: GameState, uids: readonly string[], cardId: string): string {
  const uid = uids.find((u) => state.cardIdByUid[u] === cardId);
  if (uid === undefined) throw new Error(`${cardId} was not offered`);
  return uid;
}

describe("D308 §1 — the reader: ONE anchor, and the two refusals that stay refused", () => {
  it("the iterated sentence derives to the two-op program, and NOTHING else is in it", () => {
    // The D230 shape: the scheduler plus the printed "Then, shuffle your deck." as
    // a real op. ⚠️ The shuffle is ONE op and not one per body — `schedule`
    // unshifts AHEAD of the rest of the queue, so this trailing op lands after
    // every placement. Asserted as the whole array so an extra op reddens.
    expect(deriveAttackEffect(EACH_BENCHED)).toEqual([
      { op: "evolveFromDeckEachBenched" },
      { op: "shuffleDeck" },
    ]);
  });

  it("🛑 D307's PRONOUN sentence still derives to the UNSCHEDULED op — no `onto`", () => {
    // The new field is optional and no printed sentence authors it; only the
    // scheduler writes it. If a later slice folds the two arms together, this
    // reddens by name rather than the pronoun printings quietly acquiring a bench
    // index they have no business carrying.
    expect(deriveAttackEffect(BARE)).toEqual([{ op: "evolveFromDeck" }, { op: "shuffleDeck" }]);
  });

  it("🛑 the {D} MULTI-BODY sentence is refused, and the SHARED TAIL is why anchors matter", () => {
    // ⚠️ THE CONTAINMENT IS NOT WHAT THE FIRST DRAFT OF THIS FILE CLAIMED. Team
    // Rocket's Nidorina `sv10-115` says "For each of **those** Pokémon", so it does
    // NOT contain the built sentence — asserted in the negative, because a
    // hand-written constant that "obviously" contains another is exactly D306's
    // by-construction trap and this one really was wrong. What the two DO share is
    // the tail: three sentences of one mechanism told apart only by their HEADS,
    // which is what makes an unanchored pattern over the tail the wrong-row
    // failure and the `^…$` load-bearing in BOTH directions.
    expect(MULTI_BODY.includes(EACH_BENCHED)).toBe(false);
    expect(EACH_BENCHED.endsWith(SHARED_TAIL)).toBe(true);
    expect(MULTI_BODY.endsWith(SHARED_TAIL)).toBe(true);
    // 🆕 D315 PAID THIS ONE TOO, AND THE ASSERTION FLIPS RATHER THAN BEING DELETED
    // — D309's repair of this rung's sibling, at its second site. The sentence is
    // still NOT this arm's, and it is now somebody's; a build that widened THIS
    // anchor to swallow it would show up here as the wrong OP rather than as a
    // vanished null, which is the wrong-row failure (D207) the shared tail invites.
    expect(deriveAttackEffect(MULTI_BODY)).toEqual([
      { op: "evolveFromDeckEachChosen", max: 2, pokemonType: "Darkness" },
      { op: "shuffleDeck" },
    ]);
  });

  it("🛑 the BODY-CHOICE sentence resolves to the OTHER arm — D308's refusal, PAID", () => {
    // Duosion `sv10.5b-038`/`-119`. D308 refused it here and said why: it says
    // "1 of your Pokémon", so its body may be the ACTIVE and its choice is a real
    // question — neither is what THIS op does. 🆕 D309 paid both surcharges, and
    // the assertion flips rather than being deleted: the sentence is still not
    // this arm's, and it is now somebody's. That is what "a slice that widens this
    // anchor has to come here and say so" was written for.
    expect(deriveAttackEffect(BODY_CHOICE)).toEqual([
      { op: "evolveFromDeckChosen" },
      { op: "shuffleDeck" },
    ]);
    // The two arms stay TOLD APART, which is the claim the shared tail threatens:
    // neither sentence derives to the other's op.
    expect(deriveAttackEffect(EACH_BENCHED)).toEqual([
      { op: "evolveFromDeckEachBenched" },
      { op: "shuffleDeck" },
    ]);
  });

  it("the corpus says 4, and the remainder behind the blocker goes 3 → 1", () => {
    // 🛑 THE POPULATION MEASURED FROM THE COMMITTED CORPUS, NOT QUOTED FROM THE
    // HANDOFF — the second independent route to D307's DOUBT ONE, and it agrees
    // with the live D1 sweep in the header to the row.
    const units = (text: string) => legalAttackCorpus().find(([, t]) => t === text)?.[0];
    expect(units(EACH_BENCHED)).toBe(4);
    expect(units(BODY_CHOICE)).toBe(2);
    expect(units(MULTI_BODY)).toBe(1);
    // The whole family, keyed on the corpus rather than on this file's constants.
    const family = legalAttackCorpus().filter(([, t]) =>
      t.includes("deck for a card that evolves"),
    );
    expect(family.reduce((sum, [n]) => sum + n, 0)).toBe(13);
    // ⚠️ THE PREDICATE HAS TO GO THROUGH THE SPLIT, AND THAT IS NOT A DETAIL:
    // Exeggcute's licensed record IS refused whole by `deriveAttackEffect` and is
    // nonetheless BUILT, through the split summand. A "refused" filter that only
    // asked the reader would report the remainder as 5 on 3 sentences instead of 3
    // on 2 — the exact over-count D307 closed. (This file's first draft did it.)
    const refused = family.filter(
      ([, t]) =>
        deriveAttackEffect(t) === null &&
        deriveAttackEffect(splitAttackGateClause(t)?.body ?? t) === null,
    );
    // 🆕 D309 — the refused set is a SINGLETON and the remainder is 1. Row 0 of
    // `censusAtHead.test.ts` has now moved 13 → 7 → 3 → **1** on three consecutive
    // slices, each step re-derived off the committed corpus rather than carried in
    // prose, and what is left is the prompt SHAPE nobody has built.
    // 🆕 🛑 D315 — the refused set is **EMPTY** and the remainder is **0**: the
    // row moved a FOURTH time and the family is CLOSED at 5 sentences / 13 legal
    // printings. ⚠️ **AND THE PROMPT SHAPE D309 SAID "NOBODY HAS BUILT" WAS BUILT
    // AT D47** — `choosePokemonMulti` — so the surcharge named in the line above
    // was never owed. The remainder was right; the reason for it was not, which is
    // exactly why the corpus filter and not the prose is what this rung asserts.
    expect(refused.map(([, t]) => t)).toEqual([]);
    expect(refused.reduce((sum, [n]) => sum + n, 0)).toBe(0);
    // …and the CONVERSE, so an empty refused set cannot be a broken filter: the
    // family really does hold five sentences and every one of them resolves.
    expect(family.length).toBe(5);
    for (const [, text] of family) {
      expect(
        deriveAttackEffect(splitAttackGateClause(text)?.body ?? text),
        text,
      ).not.toBeNull();
    }
  });
});

describe("D308 §2 — the printed attack on a real board: THREE slots, TWO parks", () => {
  it("the FIRST park is about bench[0] BY NAME, and offers only its two evolutions", () => {
    // The park is the ordinary `evolveFromDeck` park — same prompt kind, same
    // `dest`, same `min: 0`. What the scheduler changed is WHICH body it is about,
    // and the note is built from the offer so it says so in the player's words.
    const parked = declare(board(11));
    const prompt = cardsPrompt(parked);
    expect([...new Set(candidateIds(parked, prompt.candidates))]).toEqual([
      "eb-evo-a1",
      "eb-evo-a2",
    ]);
    expect(prompt.dest).toBe("evolve");
    expect(prompt.min).toBe(0);
    expect(prompt.max).toBe(1);
    expect(prompt.note).toContain("eb-basic-a");
    // 🛑 AND IT IS NOT ABOUT THE ATTACKER. The note naming the wrong body is the
    // failure a scheduled op makes that an unscheduled one cannot.
    expect(prompt.note).not.toContain("Vivillon");
  });

  it("🛑 resolving it evolves bench[0] AND PARKS AGAIN on bench[1] — the whole design", () => {
    // This is the rung the slice turns on: one op parks once, and the ops the
    // scheduler pushed travel in `cont.rest` across that park. If they did not,
    // the sentence would need the second park D307 priced.
    const first = declare(board(11));
    const pick = offered(first, cardsPrompt(first).candidates, "eb-evo-a2");
    const second = resolve(first, [pick]);
    expect(benchTopId(second, 0)).toBe("eb-evo-a2");
    // …and the board is asking about the NEXT slot, not finished.
    const prompt = cardsPrompt(second);
    expect([...new Set(candidateIds(second, prompt.candidates))]).toEqual(["eb-evo-b"]);
    expect(prompt.note).toContain("eb-basic-b");
    // A SINGLE candidate still PARKS — the printed decline is not a no-choice
    // (D307 §2's rule, inherited by every scheduled copy).
    expect(prompt.candidates.length).toBeGreaterThan(0);
  });

  it("resolving the second finishes the attack: slot 2 is a SILENT whiff", () => {
    // `eb-basic-c` has no evolution anywhere in the pool, so its scheduled op
    // offers nothing and returns `{ done }` — the same silent ending an empty deck
    // match already took. The program then reaches the trailing shuffle and the
    // attack ends; no third prompt is ever raised.
    let state = declare(board(11));
    state = resolve(state, [offered(state, cardsPrompt(state).candidates, "eb-evo-a1")]);
    state = resolve(state, [offered(state, cardsPrompt(state).candidates, "eb-evo-b")]);
    expect(state.phase.kind).not.toBe("effect:choose");
    expect(benchTopId(state, 0)).toBe("eb-evo-a1");
    expect(benchTopId(state, 1)).toBe("eb-evo-b");
    expect(benchTopId(state, 2)).toBe("eb-basic-c");
  });

  it("🛑 THE ATTRIBUTION CONTROL — the ACTIVE is never offered and never evolves", () => {
    // The printed subject is *"your **Benched** Pokémon"*. `eb-evo-active` evolves
    // from Vivillon and sits in the same deck, so a scheduler that walked the
    // whole board instead of the Bench would offer it — which is exactly what
    // makes this assertion able to go red.
    let state = declare(board(12));
    const everOffered: string[] = [];
    while (state.phase.kind === "effect:choose") {
      const prompt = cardsPrompt(state);
      everOffered.push(...candidateIds(state, prompt.candidates));
      state = resolve(state, [prompt.candidates[0] ?? ""]);
    }
    expect(everOffered).not.toContain("eb-evo-active");
    expect(activeTopId(state)).toBe("sv08-007");
    // The control on the control: the card really is in the deck, so "not offered"
    // is a refusal rather than an absence.
    const inDeck = state.players.p1.deck.filter((u) => state.cardIdByUid[u] === "eb-evo-active");
    expect(inDeck.length).toBeGreaterThan(0);
  });

  it("the DECLINE is a legal answer and the NEXT slot is still asked", () => {
    // `min: 0` on every scheduled copy: declining bench[0] must not abandon the
    // iteration, because the printed sentence is one sentence about every body.
    const first = declare(board(13));
    const second = resolve(first, []);
    expect(benchTopId(second, 0)).toBe("eb-basic-a");
    expect(cardsPrompt(second).note).toContain("eb-basic-b");
  });

  it("an EMPTY Bench schedules nothing — no park, and the attack still resolves", () => {
    // §14.2 makes an empty Bench a losing board for the ACTIVE's Knock Out, but
    // Evo-Powder deals no damage, so this board is legal and is the degenerate
    // case of "for each": zero iterations.
    const state = declare(board(14, []));
    expect(state.phase.kind).not.toBe("effect:choose");
    expect(state.players.p1.bench).toEqual([]);
  });
});

describe("D308 §3 — one shuffle, not N", () => {
  it("the trailing shuffle sits BEHIND every scheduled op, and there is exactly one", () => {
    // The printed "Then, shuffle your deck." follows the whole iteration. Read off
    // the PARKED continuation rather than off the deriver, because that is where a
    // scheduler that pushed its own shuffle per body would show up.
    const parked = declare(board(11));
    const rest = cont(parked).rest;
    expect(rest.filter((op) => op.op === "shuffleDeck").length).toBe(1);
    expect(rest[rest.length - 1]).toEqual({ op: "shuffleDeck" });
  });
});

describe("D308 §4 — the persisted shape: `cont.rest` carries the schedule across a park", () => {
  it("🛑 the parked continuation stores the scheduled op AND the ones not yet reached", () => {
    // 🛑 THE `MATCH_RECORD_VERSION` ARGUMENT, DRIVEN, AND IT COMES OUT A RECORDED
    // **SKIP** — D125's condition, word for word D299's and D307's. A saved match
    // holds `phase.cont.pendingOp` and `phase.cont.rest`, and both gain values
    // here they could not hold before (`onto`, and a queue of them). That is
    // the direction the constant does NOT protect: `readMatchRecord` gates a
    // record written by an OLDER deploy, and no version-17 deploy can author
    // `evolveFromDeckEachBenched` or an `onto` field. Nothing else persisted
    // moved — the `GameState` key list below is the anchor for that.
    // 🆕 ⚠️ **D309 RE-POINTED THIS RUNG AND FOUND THE ARGUMENT ABOVE IS HALF
    // WRONG.** The field is now `onto: PokemonTarget` (the Active qualifies for the
    // body-choice sentence), and a RENAME is not a union widening: the D308 deploy
    // is ITSELF a version-17 deploy — engine `0.214.0`, its own released minor —
    // that authors `ontoBench`, so a v17 record can carry a spelling this deploy
    // reads as `undefined` and silently redirects to the ATTACKER.
    // `MATCH_RECORD_VERSION` therefore moved **17 → 18** at D309 — see
    // `evolveBodyChoice.test.ts` §5, which replays exactly that bag.
    const parked = declare(board(11));
    const stored = cont(parked);
    expect(stored.pendingOp).toEqual({ op: "evolveFromDeck", onto: { spot: "bench", index: 0 } });
    expect(stored.rest).toEqual([
      { op: "evolveFromDeck", onto: { spot: "bench", index: 1 } },
      { op: "evolveFromDeck", onto: { spot: "bench", index: 2 } },
      { op: "shuffleDeck" },
    ]);
    // …and the whole phase is JSON, which is what makes the record replayable.
    expect(JSON.parse(JSON.stringify(parked.phase)).cont.rest[0].onto).toEqual({
      spot: "bench",
      index: 1,
    });
  });

  it("no `GameState` key moved — the literal anchor behind the recorded SKIP", () => {
    // D279's half-guard rule: a "nothing else persisted moved" claim is only worth
    // anything if the key list is spelled out. Read off a real PARKED board, so the
    // phase's own shape is inside the snapshot being anchored.
    const parked = declare(board(15));
    expect(Object.keys(parked).sort()).toEqual([
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
    ]);
  });

  it("the wire REFUSES a card that is not on THIS slot's offer", () => {
    // `validateChoice` reads the PROMPT, never the op — so a crafted frame naming
    // bench[1]'s evolution while bench[0] is the one being asked about is rejected
    // before any placement is reached. The scheduled op inherits that belt whole.
    const parked = declare(board(11));
    const stranger = parked.players.p1.deck.find((u) => parked.cardIdByUid[u] === "eb-evo-b");
    const rejected = applyAction(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [stranger ?? ""] },
    });
    expect(rejected.ok).toBe(false);
  });
});
