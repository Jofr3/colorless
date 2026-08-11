import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { legalAttackCorpus } from "./censusAttackCorpus";
import { deriveAttackEffect, splitAttackGateClause } from "./effects";
import { applyAction, createGame } from "./index";
import type { GameState, PokemonRef, Seat } from "./index";
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

// ── D309 — "SEARCH YOUR DECK FOR A CARD THAT EVOLVES FROM 1 OF YOUR POKÉMON AND
//    PUT IT ONTO THAT POKÉMON TO EVOLVE IT." THE BODY-CHOICE HALF OF D307's
//    FAMILY — AND THIS IS THE ONE THAT REALLY DOES OWE A SECOND PARK. ──
//
// THE POPULATION, re-queried END TO END against remote Cloudflare D1 `luminous`
// (`735f0fb5-cdc3-494d-8b97-74a8ade0124a`) over MCP on **2026-08-10**, with the
// WHOLE COLUMN read on every row (D306's rule — every arm, `damage` and `cost`
// included):
//
//   SELECT id, name, set_id, legal_standard, stage, evolve_from, attacks_json
//     FROM cards
//    WHERE instr(attacks_json,'evolves from 1 of your') > 0
//    ORDER BY legal_standard DESC, id;
//
// **THREE rows, TWO of them legal**:
//
//   • **2 — THIS SLICE.** Duosion `sv10.5b-038` and `sv10.5b-119` "Cellular
//     Evolution" ({C}, no damage; second attack "Spray Fluid" {C} `damage: 30`).
//     Both Stage 1 off Solosis, both `legal_standard = 1`, and the two print the
//     sentence BYTE-IDENTICALLY — which is why ONE corpus record carries both
//     units and why `BUILT.attack` moves by 2 rather than by 2 records.
//   • **0 — Indeedee `sv01-153` "Expert Nurturer"**, `legal_standard = 0`,
//     printing the identical sentence (its second attack is "Hypnoblast",
//     {C}{C} `damage: 30`, *"Your opponent's Active Pokémon is now Asleep."*).
//     ⚠️ **THE ARM'S REACH IS 3 AND ITS CENSUS VALUE IS 2** — `conventions.md`'s
//     *an arm transfers across sets* with a witness on the record rather than a
//     hypothetical, and D302's rule about sizing a step off LEGAL printings
//     rather than off the sentence.
//
// ── WHY THIS HALF OWES THE PARK AND D308's DID NOT ──────────────────────────
//
// 🛑 **D308's FINDING HOLDS RATHER THAN FAILS.** *"For each"* is not a choice, so
// the iterated sentence asked nothing and needed only D216's `schedule`. *"1 of
// your Pokémon"* IS a choice, so this sentence asks a question BEFORE the card
// question — and ONE OP GETS ONE PARK (the standing statement of the blocker,
// D216). The body question and the card question are therefore TWO OPS, and the
// channel between them is `continuationOps`, which gains its **THIRD** member
// here after `optional` (D186) and `moveCountersChosen` (D216).
//
// ⚠️ **AND IT IS THE FIRST MEMBER WHOSE ANSWER BUYS AN OP OF A DIFFERENT KIND.**
// D216 carried its first answer on the op ITSELF (`fromBench`) because the same
// op asks question two. Here question two is `evolveFromDeck` — an op that
// already exists, already parks and already knows how to put a deck card onto a
// named body — so the answer is written onto THAT op's `onto` and
// `evolveFromDeckChosen` is never seen again. `applyChoice`'s arm for it returns
// the state untouched, which is the honest spelling of *"the answer buys an op"*.
//
// 🛑 **THE FIELD IT WRITES IS D308's, WIDENED AND RENAMED — A RECORDED
// REVERSAL.** `evolveFromDeck.ontoBench?: number` is now `onto?: PokemonTarget`,
// because *"1 of your Pokémon"* admits the **ACTIVE** and a bench index cannot
// say so. D308's reason for the index was good (*an op field spells what the
// catalog spells*, and its sentence said *"Benched"*); what changed is that a
// SECOND printed sentence now writes the same field, and **the union of what the
// two sentences spell IS a target**. ⚠️ **THAT RENAME IS WHY
// `MATCH_RECORD_VERSION` MOVES 17 → 18** — §5 drives it.
//
// ── WHAT THE ROW COSTS ──────────────────────────────────────────────────────
//
// ONE new `EffectOp` with **no fields** (`evolveFromDeckChosen`), ONE WIDENED
// field on an existing one, ONE anchored regex with **no captures**, ONE deriver
// arm, ONE `continuationOps` member. **NO new prompt kind, NO new choice kind, NO
// new event, NO new error code, NO new `GameState` field, NO new `CardFilter`
// member, NO new `chooseCards.dest` member and NO REGISTRY ROW** — the raw
// summand of `BUILT.attack` is keyed on the READER over the whole legal corpus
// (`censusAtHead.test.ts`'s D274 block), so an authored row for Duosion would buy
// zero printings. `packages/schema`, `redact.ts` and `src/` take ZERO.

/** The sentence this slice builds — Duosion `sv10.5b-038`/`-119`, and Indeedee
    `sv01-153` byte-identically behind the rotation. */
const BODY_CHOICE =
  "Search your deck for a card that evolves from 1 of your Pokémon and put it onto that Pokémon to evolve it. Then, shuffle your deck.";
/** D307's PRONOUN sentence — the same mechanism with no question in it. */
const BARE =
  "Search your deck for a card that evolves from this Pokémon and put it onto this Pokémon to evolve it. Then, shuffle your deck.";
/** D308's ITERATED sentence — the same mechanism with no question in it either,
    and the sibling arm this one must not swallow. */
const EACH_BENCHED =
  "For each of your Benched Pokémon, search your deck for a card that evolves from that Pokémon and put it onto that Pokémon to evolve it. Then, shuffle your deck.";
/** Team Rocket's Nidorina `sv10-115` — 🆕 **D315 BUILT IT AND THE FAMILY IS
    CLOSED**; kept here so the separation from THIS arm stays a measurement. */
const MULTI_BODY =
  "Choose up to 2 of your {D} Pokémon. For each of those Pokémon, search your deck for a card that evolves from that Pokémon and put it onto that Pokémon to evolve it. Then, shuffle your deck.";
/** ⚠️ **THE ELEVEN BYTES THIS ANCHOR TURNS ON, TRANSCRIBED AND NOT BUILT.**
    D306's rule and D308's re-learning of it: this constant is the SHARED HEAD of
    `BODY_CHOICE` and `BARE`, typed out rather than sliced off either, so §1's
    claim is about the printed bytes and not about its own arithmetic. */
const SHARED_HEAD = "Search your deck for a card that evolves from ";
/** …and the shared TAIL, likewise typed out. Head and tail together are why the
    `^…$` is load-bearing in BOTH directions here, which no other arm of this
    family can say. */
const SHARED_TAIL = " and put it onto that Pokémon to evolve it. Then, shuffle your deck.";

/** Duosion `sv10.5b-038`, BOTH attacks — D306's lesson as a fixture. A file that
    transcribed only the matching arm would build a one-attack Duosion and make
    every per-index claim about it vacuous. (Printed a Stage 1 off Solosis; it is
    placed as the Active by surgery here, so the chain datum is not exercised.) */
function duosion(id: string): Card {
  return battler(id, {
    name: "Duosion",
    hp: 80,
    retreat: 2,
    types: ["Psychic"],
    attacks: [
      { cost: ["Colorless"], name: "Cellular Evolution", effect: BODY_CHOICE },
      { cost: ["Colorless"], name: "Spray Fluid", damage: 30 },
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
  "sv10.5b-038": duosion("sv10.5b-038"),
  /** Bench slot 0's body, with TWO evolutions in the deck, so the SECOND park is
      a real choice once this body is picked. */
  "bc-basic-a": basic("bc-basic-a"),
  "bc-evo-a1": stage1From("bc-evo-a1", "bc-basic-a", 110),
  "bc-evo-a2": stage1From("bc-evo-a2", "bc-basic-a", 100),
  /** Bench slot 1's body — ONE evolution in the deck. */
  "bc-basic-b": basic("bc-basic-b"),
  "bc-evo-b": stage1From("bc-evo-b", "bc-basic-b", 90),
  /** 🛑 THE NARROWING'S SUBJECT. Bench slot 2's body, with NOTHING in the pool
      that evolves from it. *"1 of your Pokémon"* names it and the offer must not:
      spending the only decision this sentence has on a guaranteed whiff is what
      §3 exists to forbid. */
  "bc-basic-c": basic("bc-basic-c"),
  /** 🛑 THE ACTIVE's OWN EVOLUTION, and the whole reason the carried answer is a
      TARGET rather than D308's bench index. Reuniclus evolves from Duosion in
      print; this stands in for it, so "the Active is offered" is a refusal the
      board can actually make and not an absence. */
  "bc-evo-active": stage1From("bc-evo-active", "Duosion", 150),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

/** The SIXTEENTH seeded deck (D270's rule: a seeded suite gets its OWN deck). */
const CHOICE_DECK = deckOf({
  "sv10.5b-038": 4,
  "bc-basic-a": 4,
  "bc-basic-b": 4,
  "bc-basic-c": 4,
  "bc-evo-a1": 4,
  "bc-evo-a2": 4,
  "bc-evo-b": 4,
  "bc-evo-active": 4,
  "fix-basic-1": 4,
  "fix-energy": 24,
});

function localSetup(seed: number, first: Seat): GameState {
  const created = createGame({ seed, decks: { p1: CHOICE_DECK, p2: CHOICE_DECK }, cardPool: POOL });
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

/** p1 with Duosion Active, `bench` on the Bench in the order given, one {C}
    attached. p2 goes FIRST and ends their turn, so p1 attacks on turn 2. */
function board(
  seed: number,
  bench: readonly string[] = ["bc-basic-a", "bc-basic-b", "bc-basic-c"],
): GameState {
  let state = localSetup(seed, "p2");
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", "sv10.5b-038");
  state = clearBench(state, "p1");
  for (const id of bench) state = benchFromDeck(state, "p1", id);
  return attachFromDeck(state, "p1", "fix-energy", 1);
}

/** TEST SURGERY — every copy of `cardId` leaves p1's deck (to the bottom of the
    DISCARD, so the deck count stays honest about what is searchable). */
function stripDeck(state: GameState, cardIds: readonly string[]): GameState {
  const side = state.players.p1;
  const drop = new Set(cardIds);
  const removed = side.deck.filter((uid) => drop.has(state.cardIdByUid[uid] ?? ""));
  return {
    ...state,
    players: {
      ...state.players,
      p1: {
        ...side,
        deck: side.deck.filter((uid) => !drop.has(state.cardIdByUid[uid] ?? "")),
        discard: [...side.discard, ...removed],
      },
    },
  };
}

/** Declare Cellular Evolution (index 0) and hand back whatever it left behind. */
function declare(state: GameState, index = 0): GameState {
  return mustApply(state, { type: "attack", seat: "p1", index }).state;
}

function pokemonPrompt(state: GameState) {
  const phase = state.phase;
  if (phase.kind !== "effect:choose" || phase.prompt.kind !== "choosePokemon") {
    throw new Error(`expected a choosePokemon park, got ${phase.kind}`);
  }
  return phase.prompt;
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

/** Answer the BODY question. */
function answerBody(state: GameState, ref: PokemonRef): GameState {
  return mustApply(state, { type: "resolveEffect", seat: "p1", choice: { kind: "pokemon", ref } })
    .state;
}

/** Answer the CARD question. */
function answerCard(state: GameState, uids: readonly string[]): GameState {
  return mustApply(state, {
    type: "resolveEffect",
    seat: "p1",
    choice: { kind: "cards", uids: [...uids] },
  }).state;
}

function candidateIds(state: GameState, uids: readonly string[]): string[] {
  return uids.map((uid) => state.cardIdByUid[uid] ?? "").sort();
}

/** Pick the first offered uid whose card id is `cardId`. */
function offered(state: GameState, uids: readonly string[], cardId: string): string {
  const uid = uids.find((u) => state.cardIdByUid[u] === cardId);
  if (uid === undefined) throw new Error(`${cardId} was not offered`);
  return uid;
}

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

const ACTIVE_REF: PokemonRef = { seat: "p1", spot: { spot: "active" } };
const benchRef = (index: number): PokemonRef => ({ seat: "p1", spot: { spot: "bench", index } });

describe("D309 §1 — the reader: ONE anchor, and the eleven bytes it turns on", () => {
  it("the body-choice sentence derives to the two-op program, and NOTHING else is in it", () => {
    // The D230 shape: the asker plus the printed "Then, shuffle your deck." as a
    // real op, so the shuffle fires on the whiff, on the decline and on the
    // placement alike. Asserted as the whole array so an extra op reddens.
    expect(deriveAttackEffect(BODY_CHOICE)).toEqual([
      { op: "evolveFromDeckChosen" },
      { op: "shuffleDeck" },
    ]);
  });

  it("🛑 the THREE sibling sentences keep their own arms — nothing was swallowed", () => {
    // The family is now three built arms and one refusal, and every one of the
    // three is told apart from this slice's by its HEAD alone. A widened anchor
    // that swallowed a sibling would show up here as an op set that is not that
    // sibling's — the wrong-row failure D207 named — rather than as a null.
    expect(deriveAttackEffect(BARE)).toEqual([{ op: "evolveFromDeck" }, { op: "shuffleDeck" }]);
    expect(deriveAttackEffect(EACH_BENCHED)).toEqual([
      { op: "evolveFromDeckEachBenched" },
      { op: "shuffleDeck" },
    ]);
    // 🆕 D315 — THE ASSERTION FLIPS RATHER THAN BEING DELETED, which is this
    // family's own repair (D308 §1 did it for D309's sentence, D307 §1 for both).
    // The multi-body sentence is still not THIS arm's — it has a leading clause a
    // `^…$` cannot swallow — and it is now somebody's, so a widened anchor here
    // shows up as the wrong OP rather than as a vanished null.
    expect(deriveAttackEffect(MULTI_BODY)).toEqual([
      { op: "evolveFromDeckEachChosen", max: 2, pokemonType: "Darkness" },
      { op: "shuffleDeck" },
    ]);
  });

  it("🛑 ELEVEN BYTES IN THE MIDDLE — the anchor is load-bearing in BOTH directions", () => {
    // ⚠️ THE CLAIM THIS FAMILY CANNOT MAKE ANYWHERE ELSE. D307's sentence and this
    // one share BOTH ends — head and tail, transcribed above rather than sliced
    // off either constant (D306's by-construction trap) — and differ only in the
    // middle: "this Pokémon" against "1 of your Pokémon". An unanchored pattern
    // over either end therefore matches both, so `^` and `$` are each doing work
    // that the other cannot do alone.
    expect(BODY_CHOICE.startsWith(SHARED_HEAD)).toBe(true);
    expect(BARE.startsWith(SHARED_HEAD)).toBe(true);
    expect(BODY_CHOICE.endsWith(SHARED_TAIL)).toBe(true);
    // …and the tail really is shared with the OTHER two arms as well, which is
    // what makes a `$`-only anchor insufficient on its own.
    expect(EACH_BENCHED.endsWith(SHARED_TAIL)).toBe(true);
    expect(MULTI_BODY.endsWith(SHARED_TAIL)).toBe(true);
    // The middles, named. Neither sentence contains the other, in either
    // direction — asserted rather than assumed, because "obviously not" is how
    // D308's containment claim came out backwards.
    expect(BODY_CHOICE.includes("1 of your Pokémon")).toBe(true);
    expect(BARE.includes("this Pokémon")).toBe(true);
    expect(BODY_CHOICE.includes(BARE)).toBe(false);
    expect(BARE.includes(BODY_CHOICE)).toBe(false);
  });

  it("the corpus says 2, and the family's remainder goes 3 → 1", () => {
    // 🛑 THE POPULATION MEASURED FROM THE COMMITTED CORPUS, NOT QUOTED FROM THE D1
    // QUERY IN THE HEADER — the second independent route, and it agrees to the row.
    const units = (text: string) => legalAttackCorpus().find(([, t]) => t === text)?.[0];
    expect(units(BODY_CHOICE)).toBe(2);
    // The whole family, keyed on the corpus rather than on this file's constants.
    const family = legalAttackCorpus().filter(([, t]) =>
      t.includes("deck for a card that evolves"),
    );
    expect(family.reduce((sum, [n]) => sum + n, 0)).toBe(13);
    const refused = family.filter(([, t]) => deriveAttackEffect(t) === null);
    // ⚠️ EXEGGCUTE'S LICENSED RECORD IS IN THIS LIST AND IS NONETHELESS BUILT,
    // through D282's split — the exact over-count D307 closed and D308 restated.
    // 🆕 D315 — what was "Nidorina alone, at 1 printing" is now NOTHING: the
    // multi-body sentence has its own arm and the family is CLOSED. The claim
    // flips to the pair that says the same thing without naming a remainder — the
    // only bare refusal left in the family is the GATE sentence, and it is built
    // through the split.
    expect(refused.map(([, t]) => t)).not.toContain(MULTI_BODY);
    expect(refused.every(([, t]) => splitAttackGateClause(t) !== null)).toBe(true);
    // …and this slice's sentence is no longer among them.
    expect(refused.map(([, t]) => t)).not.toContain(BODY_CHOICE);
  });

  it("🆕 the ROTATED printing derives too — the arm's reach is 3, its census value 2", () => {
    // Indeedee `sv01-153` prints the identical bytes at `legal_standard = 0`. The
    // reader has no legality in it, so the arm covers the printing the day the set
    // rotates back; the CENSUS counts only what is legal today. Asserting both
    // halves keeps "an arm transfers across sets" from being a claim nobody drove.
    expect(legalAttackCorpus().find(([, t]) => t === BODY_CHOICE)?.[0]).toBe(2);
    expect(deriveAttackEffect(BODY_CHOICE)).not.toBeNull();
  });
});

describe("D309 §2 — the printed attack on a real board: the BODY park, then the CARD park", () => {
  it("🛑 the FIRST park is the BODY question, and the ACTIVE is on the offer", () => {
    // ⚠️ THE RUNG THE WHOLE SLICE TURNS ON. *"1 of your Pokémon"* is the whole own
    // board and the printed word is not "Benched", so D308's bench INDEX could not
    // have carried this answer — which is the entire case for the rename.
    const parked = declare(board(31));
    const prompt = pokemonPrompt(parked);
    expect(prompt.candidates).toContainEqual(ACTIVE_REF);
    expect(prompt.candidates).toContainEqual(benchRef(0));
    expect(prompt.candidates).toContainEqual(benchRef(1));
    // THE PROMPT SAYS WHAT THE ANSWER BUYS (the §9.2 note doctrine): a player told
    // only "which Pokémon?" would read this as the whole decision.
    expect(prompt.note).toContain("You will then choose the card");
  });

  it("answering with a BENCH body parks again on THAT body's evolutions", () => {
    const first = declare(board(31));
    const second = answerBody(first, benchRef(0));
    const prompt = cardsPrompt(second);
    expect([...new Set(candidateIds(second, prompt.candidates))]).toEqual([
      "bc-evo-a1",
      "bc-evo-a2",
    ]);
    expect(prompt.dest).toBe("evolve");
    expect(prompt.min).toBe(0);
    expect(prompt.max).toBe(1);
    expect(prompt.note).toContain("bc-basic-a");
    // 🛑 AND IT IS NOT ABOUT THE ATTACKER. The note naming the wrong body is the
    // failure a redirected op makes that an unredirected one cannot.
    expect(prompt.note).not.toContain("Duosion");
    const done = answerCard(second, [offered(second, prompt.candidates, "bc-evo-a2")]);
    expect(benchTopId(done, 0)).toBe("bc-evo-a2");
    expect(activeTopId(done)).toBe("sv10.5b-038");
    expect(done.phase.kind).not.toBe("effect:choose");
  });

  it("🛑 answering with the ACTIVE evolves the ATTACKER — the target, driven", () => {
    // The other half of the widening, on a board. `evolveFromDeckOffer` reads
    // `ref.spot`, so an `{ spot: "active" }` answer names the attacker's own stack
    // — a body a bench index has no spelling for at any value.
    const first = declare(board(32));
    const second = answerBody(first, ACTIVE_REF);
    const prompt = cardsPrompt(second);
    expect([...new Set(candidateIds(second, prompt.candidates))]).toEqual(["bc-evo-active"]);
    expect(prompt.note).toContain("Duosion");
    const done = answerCard(second, [prompt.candidates[0] ?? ""]);
    expect(activeTopId(done)).toBe("bc-evo-active");
    // §10's carry-over came with it — this is `placeEvolution`'s own body, so the
    // attached Energy stays on the stack.
    expect(done.players.p1.active?.energy.length).toBe(1);
    expect(done.players.p1.active?.stack.length).toBe(2);
  });

  it("the CARD decline is still legal, and the attack ends silently", () => {
    // `min: 0` is the printed "up to"… except this sentence has no "up to". The
    // decline is inherited from `evolveFromDeck`, whose own doc records it, and it
    // matters here because the second park is reached by an answer rather than by
    // a declaration: a player who picks a body and then finds nothing they want
    // must still be able to stop.
    const first = declare(board(33));
    const second = answerBody(first, benchRef(1));
    const done = answerCard(second, []);
    expect(benchTopId(done, 1)).toBe("bc-basic-b");
    expect(done.phase.kind).not.toBe("effect:choose");
  });

  it("a POKEMON_EVOLVED event is filed, and exactly one SHUFFLE", () => {
    // One printed sentence, one shuffle — the trailing op sits BEHIND both parks,
    // so it fires once no matter which ending the two questions took.
    const first = declare(board(34));
    const second = answerBody(first, benchRef(0));
    const applied = mustApply(second, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [offered(second, cardsPrompt(second).candidates, "bc-evo-a1")] },
    });
    const types = applied.events.map((event) => event.type);
    expect(types).toContain("POKEMON_EVOLVED");
    expect(types.filter((t) => t === "SHUFFLE").length).toBe(1);
    expect(types).not.toContain("DECK_SEARCHED");
  });
});

describe("D309 §3 — the NARROWING: a body the deck cannot evolve is not a choice", () => {
  it("🛑 `bc-basic-c` is on the board, named by the print, and NOT on the offer", () => {
    // ⚠️ THE SLICE'S REAL WORK. Nothing in the pool evolves from `bc-basic-c`, so
    // offering it would spend the only decision this sentence has on a guaranteed
    // whiff. The narrowing lives in `stepOp` and NOT in `programPlayable`, which
    // never reads the deck.
    const parked = declare(board(35));
    const prompt = pokemonPrompt(parked);
    expect(prompt.candidates).not.toContainEqual(benchRef(2));
    // THE CONTROL ON THE CONTROL (`conventions.md`'s vacuous-guard rule): the body
    // really is on the Bench at that index, so "not offered" is a refusal and not
    // an absence.
    expect(benchTopId(parked, 2)).toBe("bc-basic-c");
    expect(parked.players.p1.bench.length).toBe(3);
  });

  it("🛑 the narrowing tracks the DECK, not the board — strip it and the body drops", () => {
    // The stronger form of the rung above, and the one that could not pass on a
    // hard-coded exclusion: `bc-basic-b` IS offered on the ordinary board, and
    // stops being offered on a board that differs ONLY in what its deck holds.
    expect(pokemonPrompt(declare(board(36))).candidates).toContainEqual(benchRef(1));
    const stripped = declare(stripDeck(board(36), ["bc-evo-b"]));
    expect(pokemonPrompt(stripped).candidates).not.toContainEqual(benchRef(1));
    // …and the body is still there, still Benched, still named by the print.
    expect(benchTopId(stripped, 1)).toBe("bc-basic-b");
  });

  it("the ALL-WHIFF board is a legal declaration that resolves to NOTHING — and shuffles", () => {
    // No park at all: the op returns the state untouched, the attack runs on, and
    // the deriver's trailing `shuffleDeck` still fires. That is the silent ending
    // `searchDeck` and `evolveFromDeck` both already take, and it is why
    // `programPlayable` was left alone.
    const barren = stripDeck(board(37), [
      "bc-evo-a1",
      "bc-evo-a2",
      "bc-evo-b",
      "bc-evo-active",
    ]);
    const applied = mustApply(barren, { type: "attack", seat: "p1", index: 0 });
    expect(applied.state.phase.kind).not.toBe("effect:choose");
    expect(benchTopId(applied.state, 0)).toBe("bc-basic-a");
    expect(activeTopId(applied.state)).toBe("sv10.5b-038");
    expect(applied.events.map((event) => event.type)).toContain("SHUFFLE");
  });
});

describe("D309 §4 — ONE eligible body is FORCED, not prompted", () => {
  it("🛑 a single candidate raises NO body park — it goes straight to the card", () => {
    // M1's no-choice doctrine at its second site, through the SAME helper the
    // parked ending uses (`evolveBodyAnswered`), so a board of one and a board of
    // three resolve the printed sentence down one code path. ⚠️ Deliberately NOT
    // `parkOrForce`: that helper's forced arm applies a `(ref) => GameState`,
    // which is exactly the shape that cannot ask a second question.
    const single = stripDeck(board(38), ["bc-evo-a1", "bc-evo-a2", "bc-evo-active"]);
    const parked = declare(single);
    const prompt = cardsPrompt(parked);
    expect([...new Set(candidateIds(parked, prompt.candidates))]).toEqual(["bc-evo-b"]);
    expect(prompt.note).toContain("bc-basic-b");
    const done = answerCard(parked, [prompt.candidates[0] ?? ""]);
    expect(benchTopId(done, 1)).toBe("bc-evo-b");
  });

  it("…and the forced path and the chosen path land on the SAME board", () => {
    // The claim the forcing makes: skipping the question changes WHO is asked and
    // nothing else. Same seed, same deck surgery, the only difference being that
    // one board has a second eligible body and therefore parks first.
    const forced = declare(stripDeck(board(39), ["bc-evo-a1", "bc-evo-a2", "bc-evo-active"]));
    const chosen = answerBody(
      declare(stripDeck(board(39), ["bc-evo-a2", "bc-evo-active"])),
      benchRef(1),
    );
    expect(cardsPrompt(forced).note).toBe(cardsPrompt(chosen).note);
    expect(cont(forced).pendingOp).toEqual(cont(chosen).pendingOp);
  });
});

describe("D309 §5 — the persisted shape, and MATCH_RECORD_VERSION 17 → 18", () => {
  it("🛑 the ANSWER is written onto the NEXT op, and it is a TARGET", () => {
    // What a saved match holds after question one. `evolveFromDeckChosen` is never
    // stored — it is answered and gone — and what replaces it carries the body as
    // `{ spot, index }` rather than as a number.
    const parked = answerBody(declare(board(40)), benchRef(1));
    const stored = cont(parked);
    expect(stored.pendingOp).toEqual({ op: "evolveFromDeck", onto: { spot: "bench", index: 1 } });
    expect(stored.rest).toEqual([{ op: "shuffleDeck" }]);
    // The ACTIVE answer, which is the spelling D308's field had no room for.
    const onActive = answerBody(declare(board(41)), ACTIVE_REF);
    expect(cont(onActive).pendingOp).toEqual({
      op: "evolveFromDeck",
      onto: { spot: "active" },
    });
    // …and the whole phase is JSON, which is what makes the record replayable.
    expect(JSON.parse(JSON.stringify(parked.phase)).cont.pendingOp.onto).toEqual({
      spot: "bench",
      index: 1,
    });
  });

  it("🛑 FORWARD: a version-17 record's `ontoBench` is read as NOTHING, and the WRONG BODY is offered", () => {
    // 🛑 THE BUMP, DRIVEN — AND IT IS THE FIRST ON THIS PAGE OWED TO A RENAME.
    // Every recorded SKIP in `match.ts` rests on "no older deploy can author the
    // new value", which is true of a WIDENING by construction. A rename inverts
    // it: D308's deploy (engine `0.214.0`, its own released minor) writes
    // `{ op: "evolveFromDeck", ontoBench: n }` into `cont.rest`, and it is THIS
    // deploy that cannot read it.
    //
    // The bag below is exactly what a D308 record holds mid-iteration: a park,
    // with an old-spelled scheduled op still queued behind it. Rebuilt by
    // REWRITING a real parked board rather than hand-rolling a state.
    const live = answerBody(declare(board(42)), benchRef(0));
    const stale = withRest(live, [
      { op: "evolveFromDeck", ontoBench: 1 } as unknown as EffectOpLike,
      { op: "shuffleDeck" },
    ]);
    // Decline the current card park so the engine steps into the stale op.
    const resumed = answerCard(stale, []);
    const prompt = cardsPrompt(resumed);
    // 🛑 THE MISREAD, NAMED. `onto` is `undefined`, so `evolveFromDeckOffer` falls
    // back to `sourceRef` and the player is asked about the ATTACKER — not about
    // `bc-basic-b`, which is what the record said. A SILENT wrong-body resolution
    // is the worse of the two failures this constant prevents; D299's throw was
    // merely the loud version of it.
    expect(prompt.note).toContain("Duosion");
    expect(prompt.note).not.toContain("bc-basic-b");
    expect([...new Set(candidateIds(resumed, prompt.candidates))]).toEqual(["bc-evo-active"]);
  });

  it("🛑 BACKWARD: the SAME bag in the new spelling asks about the body the record named", () => {
    // The control that makes the rung above attributable to the SPELLING and not
    // to the board: one field name apart, same seed, same surgery, same decline.
    const live = answerBody(declare(board(42)), benchRef(0));
    const current = withRest(live, [
      { op: "evolveFromDeck", onto: { spot: "bench", index: 1 } } as unknown as EffectOpLike,
      { op: "shuffleDeck" },
    ]);
    const resumed = answerCard(current, []);
    const prompt = cardsPrompt(resumed);
    expect(prompt.note).toContain("bc-basic-b");
    expect(prompt.note).not.toContain("Duosion");
    expect([...new Set(candidateIds(resumed, prompt.candidates))]).toEqual(["bc-evo-b"]);
    // …and it really does place the card on that body, so the new spelling is
    // read end to end and not merely rendered into a note.
    const done = answerCard(resumed, [prompt.candidates[0] ?? ""]);
    expect(benchTopId(done, 1)).toBe("bc-evo-b");
  });

  it("no `GameState` key moved — the literal anchor beside the bump", () => {
    // D279's half-guard rule: a "nothing ELSE persisted moved" claim is only worth
    // anything if the key list is spelled out. The version moved for the OP's
    // shape; this is what says the state's shape did not move with it.
    const parked = declare(board(43));
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

  it("the wire REFUSES a body that is not on the offer", () => {
    // `validateChoice` (cardplay.ts) matches a wire answer against the PROMPT,
    // never against the op — which is why `evolveBodyAnswered` carries no seat
    // test and no spot test of its own (D216's measured reason, and the
    // mutant-masking pair it deleted).
    const parked = declare(board(44));
    const rejected = applyAction(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon", ref: benchRef(2) },
    });
    expect(rejected.ok).toBe(false);
    // …and an OPPONENT's body is refused too, on the same rule.
    const stranger = applyAction(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon", ref: { seat: "p2", spot: { spot: "active" } } },
    });
    expect(stranger.ok).toBe(false);
  });
});

describe("D309 §6 — the second attack, which a fragment-keyed census would not see", () => {
  it("Duosion's index 1 is Spray Fluid and is NOT this program", () => {
    // D306's lesson as an assertion. `sv10.5b-038` prints TWO attacks; a file that
    // transcribed only the matching arm would carry "one attack" into a per-index
    // claim, which is the exact error D277 made on this family.
    const struck = declare(board(45), 1);
    expect(struck.phase.kind).not.toBe("effect:choose");
    expect(struck.players.p2.active?.damage).toBe(30);
    expect(activeTopId(struck)).toBe("sv10.5b-038");
  });
});

/** The op shape `cont.rest` holds. Spelled locally rather than imported, because
    the FORWARD rung above has to build one in the OLD spelling — a shape the
    current `EffectOp` union deliberately no longer has a name for. */
type EffectOpLike = { op: string } & Record<string, unknown>;

/** TEST SURGERY — replace a parked continuation's `rest` queue, which is how a
    record written by a PREVIOUS deploy is simulated without hand-rolling a whole
    `GameState`. Everything else on the board is the live engine's own. */
function withRest(state: GameState, rest: readonly EffectOpLike[]): GameState {
  const phase = state.phase;
  if (phase.kind !== "effect:choose") throw new Error(`expected a park, got ${phase.kind}`);
  return {
    ...state,
    phase: { ...phase, cont: { ...phase.cont, rest: rest as never } },
  };
}
