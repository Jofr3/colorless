import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { legalAttackCorpus } from "./censusAttackCorpus";
import { deriveAttackEffect } from "./effects";
import { applyAction, createGame } from "./index";
import type { GameState, PokemonRef, Seat } from "./index";
import { programFor, registryCardIds } from "./registry";
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
  typedEnergy,
} from "./testFixtures";

// ── D315 — "CHOOSE UP TO 2 OF YOUR {D} POKÉMON. FOR EACH OF THOSE POKÉMON,
//    SEARCH YOUR DECK FOR A CARD THAT EVOLVES FROM THAT POKÉMON AND PUT IT ONTO
//    THAT POKÉMON TO EVOLVE IT. THEN, SHUFFLE YOUR DECK." THE FAMILY'S LAST
//    SENTENCE, AND THE ROW IT CLOSES. ──
//
// THE POPULATION, re-queried END TO END against remote Cloudflare D1 `luminous`
// (`735f0fb5-cdc3-494d-8b97-74a8ade0124a`) over MCP on **2026-08-10**, with the
// WHOLE COLUMN read on every row (D306's rule) and ALL THREE text columns swept
// (`conventions.md`'s rule), on the part of the sentence a paraphrase cannot
// change:
//
//   SELECT id, name, legal_standard, category, trainer_type,
//          attacks_json, abilities_json, effect
//     FROM cards
//    WHERE instr(attacks_json,'For each of those')   > 0
//       OR instr(abilities_json,'For each of those') > 0
//       OR instr(effect,'For each of those')         > 0;
//
// **NINE rows, FIVE of them legal, and only ONE of the five is this sentence**:
//
//   • **1 — THIS SLICE.** Team Rocket's Nidorina `sv10-115` "Dark Awakening"
//     ({D}, no damage; second attack "Scratch" {D}{D} `damage: 50`). Stage 1 off
//     Team Rocket's Nidoran♀, `types_json = ["Darkness"]`, `legal_standard = 1`.
//   • **4 — JANINE'S SECRET ART** `sv06.5-059`/`-088`/`sv08.5-112`/`-173`
//     (Supporter, `legal_standard = 1`), which prints the IDENTICAL antecedent
//     *"Choose up to 2 of your {D} Pokémon. For each of those Pokémon, …"* and a
//     DIFFERENT consequent (*"…search your deck for a Basic {D} Energy card and
//     attach it to that Pokémon."*). 🛑 **IT IS ALREADY BUILT AND IT DOES NOT USE
//     THIS OP** — see §1's own rung.
//   • **4 — Chi-Yu ex** `sv02-061`-family "Flame Surge", `legal_standard = 0`:
//     *"Choose up to 3 of your Benched Pokémon. For each of those Pokémon, …"*,
//     again the ATTACH consequent. Rotated, and a different noun besides.
//
// ⚠️ **SO THE ARM'S REACH IS 1 AND ITS CENSUS VALUE IS 1** — the first sentence in
// this family with no rotated twin behind it (D307 had none either; D309 had
// Indeedee). Sized off the LEGAL printings and not off the sentence (D302, D309).
//
// ── THE HANDOFF PRICED THIS AS A REGISTRY ROW AND IT IS AN ARM ──────────────
//
// 🛑 D314's resume point derived the slice in full and got ONE part wrong, in the
// direction that would have moved the wrong number: *"1 registry row"*. The three
// siblings (D307/D308/D309) are all **deriver arms**, and `BUILT.attack`'s raw
// summand is keyed on the READER over the whole legal corpus with `programFor`
// nowhere in the addition (`censusAtHead.test.ts`'s D274 block) — so an authored
// row for Nidorina would have bought **ZERO** printings while leaving the raw
// remainder untouched. `conventions.md`'s *an arm transfers across sets; a
// registry row does not* points the same way. **ZERO registry rows are authored**
// and §6 asserts that against the live registry.
//
// 🛑 AND ONE PART WRONG IN THE OTHER DIRECTION: *"`healEach.pokemonType` is the
// only typed own-board read in the op set and it is a FOLD, not a candidate
// builder."* `attachEnergyTargets`' `targetType` rider (Gardevoir's *"your {P}
// Pokémon"*) and `switchBenchNarrowing`'s (Pecharunt's *"Benched {D} Pokémon"*)
// are both typed own-board CANDIDATE BUILDERS, and both read the TOP card exactly
// as this one does. The type half cost one conjunct.
//
// ── WHAT THE ROW COSTS ──────────────────────────────────────────────────────
//
// ONE new `EffectOp` (`evolveFromDeckEachChosen`) with **two required fields**,
// ONE anchored regex with **two captures** (the family's first with any), ONE
// deriver arm, ONE `stepOp` arm, ONE do-nothing `applyChoice` arm, ONE
// `continuationOps` member — its **FOURTH**, and the **FIRST whose answer buys N
// ops rather than one**, and the **FIRST to answer a `pokemonMulti`** — and ONE
// shared candidate builder factored out of D309's arm. **NO new prompt kind, NO
// new choice kind, NO new event, NO new error code, NO new `GameState` field, NO
// new `CardFilter` member, NO new `chooseCards.dest` member and NO REGISTRY ROW.**
// `packages/schema`, `redact.ts`, `log.ts`, `cardplay.ts` and `src/` take ZERO.

/** The sentence this slice builds — Team Rocket's Nidorina `sv10-115`. */
const EACH_CHOSEN =
  "Choose up to 2 of your {D} Pokémon. For each of those Pokémon, search your deck for a card that evolves from that Pokémon and put it onto that Pokémon to evolve it. Then, shuffle your deck.";
/** D307's PRONOUN sentence. */
const BARE =
  "Search your deck for a card that evolves from this Pokémon and put it onto this Pokémon to evolve it. Then, shuffle your deck.";
/** D308's ITERATED sentence — the one this slice's consequent very nearly is. */
const EACH_BENCHED =
  "For each of your Benched Pokémon, search your deck for a card that evolves from that Pokémon and put it onto that Pokémon to evolve it. Then, shuffle your deck.";
/** D309's BODY-CHOICE sentence. */
const BODY_CHOICE =
  "Search your deck for a card that evolves from 1 of your Pokémon and put it onto that Pokémon to evolve it. Then, shuffle your deck.";
/** 🛑 **JANINE'S SECRET ART, TRANSCRIBED AND NOT INTERPOLATED** (D306). The four
    legal printings that share this slice's ANTECEDENT byte for byte and are
    already built on a different op — the reason §1 asserts the separation. */
const JANINE =
  "Choose up to 2 of your {D} Pokémon. For each of those Pokémon, search your deck for a Basic {D} Energy card and attach it to that Pokémon. Then, shuffle your deck. If you attached Energy to your Active Pokémon in this way, it is now Poisoned.";
/** ⚠️ **THE SHARED HEAD, TYPED OUT RATHER THAN SLICED OFF EITHER CONSTANT** —
    D306's rule and D308's re-learning of it, so §1's claim is about the printed
    bytes and not about its own arithmetic. */
const SHARED_HEAD = "Choose up to 2 of your {D} Pokémon. For each of those Pokémon, search your ";
/** …and the tail this slice shares with all THREE siblings. */
const SHARED_TAIL = " and put it onto that Pokémon to evolve it. Then, shuffle your deck.";

/** Team Rocket's Nidorina `sv10-115`, BOTH attacks — D306's lesson as a fixture.
    A file that transcribed only the matching arm would build a one-attack
    Nidorina and make every per-index claim about it vacuous. (Printed a Stage 1
    off Team Rocket's Nidoran♀; it is placed as the Active by surgery here, so the
    chain datum is not exercised.) */
function nidorina(id: string): Card {
  return battler(id, {
    name: "Team Rocket's Nidorina",
    hp: 90,
    retreat: 1,
    types: ["Darkness"],
    attacks: [
      { cost: ["Darkness"], name: "Dark Awakening", effect: EACH_CHOSEN },
      { cost: ["Darkness", "Darkness"], name: "Scratch", damage: 50 },
    ],
  });
}

function basic(id: string, types: Card["types"]): Card {
  return battler(id, { hp: 60, retreat: 1, types });
}

function stage1From(id: string, from: string, types: Card["types"]): Card {
  return { ...battler(id, { hp: 110, retreat: 1, types }), stage: "Stage1", evolveFrom: from };
}

const LOCAL_CARDS: Record<string, Card> = {
  "sv10-115": nidorina("sv10-115"),
  /** Bench 0 — {D}, TWO evolutions in the deck, so its card park is a real choice. */
  "ec-dark-a": basic("ec-dark-a", ["Darkness"]),
  "ec-evo-a1": stage1From("ec-evo-a1", "ec-dark-a", ["Darkness"]),
  "ec-evo-a2": stage1From("ec-evo-a2", "ec-dark-a", ["Darkness"]),
  /** Bench 1 — {D}, ONE evolution in the deck. */
  "ec-dark-b": basic("ec-dark-b", ["Darkness"]),
  "ec-evo-b": stage1From("ec-evo-b", "ec-dark-b", ["Darkness"]),
  /** 🛑 THE TYPE NARROWING'S SUBJECT. Bench 2 — a {R} body WITH an evolution in
      the deck. It fails ONLY the type conjunct, so a build that dropped the type
      offers it and a build that dropped the deck read still would not. The two
      refusals are therefore told apart by construction rather than by hope. */
  "ec-fire-c": basic("ec-fire-c", ["Fire"]),
  "ec-evo-c": stage1From("ec-evo-c", "ec-fire-c", ["Fire"]),
  /** 🛑 THE DECK NARROWING'S SUBJECT. Bench 3 — a {D} body with NOTHING in the
      pool that evolves from it. It fails ONLY the deck conjunct. */
  "ec-dark-d": basic("ec-dark-d", ["Darkness"]),
  /** 🛑 THE DUAL-TYPE CONTROL. Bench 4 — `["Water","Darkness"]`, which the printed
      `{D}` noun MUST admit: the catalog column is an array and dual types are
      printed, so a membership test written as equality would drop this body. */
  "ec-dual-e": basic("ec-dual-e", ["Water", "Darkness"]),
  "ec-evo-e": stage1From("ec-evo-e", "ec-dual-e", ["Water", "Darkness"]),
  /** The ATTACKER's own evolution — Nidoqueen in print. Nidorina is {D} and is
      itself a candidate, which is what makes "the Active is on the offer" a
      refusal the board can make rather than an absence. */
  "ec-evo-active": stage1From("ec-evo-active", "Team Rocket's Nidorina", ["Darkness"]),
  /** The attack costs {D}, so the suite needs a Basic Darkness Energy of its own —
      `fix-energy` provides Colorless (its NAME is the datum, per `typedEnergy`). */
  "ec-dark-energy": typedEnergy("ec-dark-energy", "Darkness"),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

/** The SEVENTEENTH seeded deck (D270's rule: a seeded suite gets its OWN deck). */
const CHOSEN_DECK = deckOf({
  "sv10-115": 4,
  "ec-dark-a": 4,
  "ec-dark-b": 4,
  "ec-dark-d": 4,
  "ec-fire-c": 4,
  "ec-dual-e": 4,
  "ec-evo-a1": 4,
  "ec-evo-a2": 4,
  "ec-evo-b": 4,
  "ec-evo-c": 4,
  "ec-evo-e": 4,
  "ec-evo-active": 4,
  "fix-basic-1": 4,
  "ec-dark-energy": 8,
});

function localSetup(seed: number, first: Seat): GameState {
  const created = createGame({ seed, decks: { p1: CHOSEN_DECK, p2: CHOSEN_DECK }, cardPool: POOL });
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

const DEFAULT_BENCH = ["ec-dark-a", "ec-dark-b", "ec-fire-c", "ec-dark-d", "ec-dual-e"] as const;

/** p1 with Nidorina Active, `bench` benched in the order given, `energy` {D}
    attached. p2 goes FIRST and ends their turn, so p1 attacks on turn 2. */
function board(seed: number, bench: readonly string[] = DEFAULT_BENCH, energy = 1): GameState {
  let state = localSetup(seed, "p2");
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", "sv10-115");
  state = clearBench(state, "p1");
  for (const id of bench) state = benchFromDeck(state, "p1", id);
  return attachFromDeck(state, "p1", "ec-dark-energy", energy);
}

/** TEST SURGERY — every copy of `cardIds` leaves p1's deck (to the bottom of the
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

/** Declare Dark Awakening (index 0) and hand back whatever it left behind. */
function declare(state: GameState, index = 0): GameState {
  return mustApply(state, { type: "attack", seat: "p1", index }).state;
}

/** Declare, keeping the EVENTS — the log is a stream this engine returns per
    action rather than a field on the state, so a claim about how many times the
    deck was shuffled has to be summed across the actions that ran the program. */
function declareWith(state: GameState, index = 0) {
  return mustApply(state, { type: "attack", seat: "p1", index });
}

function shuffles(...batches: readonly { type: string }[][]): number {
  return batches.reduce((sum, evts) => sum + evts.filter((e) => e.type === "SHUFFLE").length, 0);
}

function multiPrompt(state: GameState) {
  const phase = state.phase;
  if (phase.kind !== "effect:choose" || phase.prompt.kind !== "choosePokemonMulti") {
    throw new Error(`expected a choosePokemonMulti park, got ${phase.kind}`);
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

/** Answer the BODY question. */
function answerBodies(state: GameState, refs: readonly PokemonRef[]) {
  return mustApply(state, {
    type: "resolveEffect",
    seat: "p1",
    choice: { kind: "pokemonMulti", refs: [...refs] },
  });
}

/** Answer a CARD question. */
function answerCard(state: GameState, uids: readonly string[]) {
  return mustApply(state, {
    type: "resolveEffect",
    seat: "p1",
    choice: { kind: "cards", uids: [...uids] },
  });
}

function candidateIds(state: GameState, uids: readonly string[]): string[] {
  return [...new Set(uids.map((uid) => state.cardIdByUid[uid] ?? ""))].sort();
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

describe("D315 §1 — the reader: ONE anchor, TWO captures, and the head it must NOT swallow", () => {
  it("the multi-body sentence derives to the two-op program, with both captures threaded", () => {
    // The D230 shape: the asker plus the printed "Then, shuffle your deck." as a
    // real op. Asserted as the WHOLE array so an extra op reddens, and with both
    // field values spelled — the captures are the family's first and a hard-coded
    // `max: 2` / `pokemonType: "Darkness"` would pass a shape assertion silently.
    expect(deriveAttackEffect(EACH_CHOSEN)).toEqual([
      { op: "evolveFromDeckEachChosen", max: 2, pokemonType: "Darkness" },
      { op: "shuffleDeck" },
    ]);
  });

  it("🛑 the captures are READ, not hard-coded — a re-typed, re-counted variant follows them", () => {
    // ⚠️ THE RUNG THAT SEPARATES A PARAMETERISED ANCHOR FROM A LITERAL ONE. The
    // catalog prints exactly one of these sentences today, so every assertion in
    // this file about `max: 2` / `"Darkness"` is equally true of an arm that
    // ignores its own capture groups. These two synthetic strings are not printed
    // by any card and are not claimed to be — they exist to make the threading
    // observable, which is the only way this claim can go red.
    expect(deriveAttackEffect(EACH_CHOSEN.replace("up to 2", "up to 3"))).toEqual([
      { op: "evolveFromDeckEachChosen", max: 3, pokemonType: "Darkness" },
      { op: "shuffleDeck" },
    ]);
    expect(deriveAttackEffect(EACH_CHOSEN.replace("{D}", "{P}"))).toEqual([
      { op: "evolveFromDeckEachChosen", max: 3 - 1, pokemonType: "Psychic" },
      { op: "shuffleDeck" },
    ]);
  });

  it("🛑 an UNKNOWN brace code falls to the LOUD path — no default type is invented", () => {
    // `POKEMON_TYPE_BY_CODE` is the schema-derived vocabulary every brace-coded
    // noun in this reader asks, and a code outside it must return null rather than
    // resolve to a program whose candidate set is a type no card can print. The
    // failure the guard prevents is silent: a `?? "Colorless"` would derive a
    // program that offers the wrong bodies forever.
    expect(deriveAttackEffect(EACH_CHOSEN.replace("{D}", "{Q}"))).toBeNull();
    // …and the "up to 0" nobody prints stays loud too, rather than deriving a
    // program that chooses nothing and shuffles anyway.
    expect(deriveAttackEffect(EACH_CHOSEN.replace("up to 2", "up to 0"))).toBeNull();
  });

  it("🛑 the THREE sibling sentences keep their own arms — nothing was swallowed", () => {
    // The family is now FOUR built arms and no refusal, and each is told apart by
    // its HEAD. A widened anchor that swallowed a sibling would show up here as an
    // op set that is not that sibling's — the wrong-row failure D207 named —
    // rather than as a null.
    expect(deriveAttackEffect(BARE)).toEqual([{ op: "evolveFromDeck" }, { op: "shuffleDeck" }]);
    expect(deriveAttackEffect(EACH_BENCHED)).toEqual([
      { op: "evolveFromDeckEachBenched" },
      { op: "shuffleDeck" },
    ]);
    expect(deriveAttackEffect(BODY_CHOICE)).toEqual([
      { op: "evolveFromDeckChosen" },
      { op: "shuffleDeck" },
    ]);
  });

  it("🛑 JANINE'S SECRET ART shares this ANTECEDENT byte for byte and must stay elsewhere", () => {
    // ⚠️ THE FINDING THIS FILE EXISTS TO PIN, AND IT IS ABOUT A CARD THAT WAS
    // ALREADY BUILT. Four legal Supporter printings spell this slice's whole
    // leading clause and then ATTACH instead of evolving. They are authored as
    // `attachFromDeck { maxPerTarget: 1 }`, where the body pick COLLAPSED into the
    // `attachCards` map because Energy of one type are fungible — evolution cards
    // are not, so this sentence cannot collapse the same way and the two readings
    // must never meet.
    expect(JANINE.startsWith("Choose up to 2 of your {D} Pokémon. For each of those Pokémon, ")).toBe(
      true,
    );
    expect(EACH_CHOSEN.startsWith(SHARED_HEAD)).toBe(true);
    expect(JANINE.startsWith(SHARED_HEAD)).toBe(true);
    // 🛑 THE CONSEQUENT IS WHAT SEPARATES THEM, AND IT IS INSIDE THE ANCHOR — so no
    // widening of the head can reach Janine. Driven in both directions: the attack
    // reader refuses Janine's text outright, and Janine's programs are real.
    expect(deriveAttackEffect(JANINE)).toBeNull();
    for (const id of ["sv06.5-059", "sv06.5-088", "sv08.5-112", "sv08.5-173"]) {
      const program = programFor(id)?.trainer;
      expect(program, id).toBeDefined();
      expect(JSON.stringify(program), id).toContain("attachFromDeck");
      // …and NOT this slice's op, which is the claim that would break if a later
      // author "unified" the two on their shared head.
      expect(JSON.stringify(program), id).not.toContain("evolveFromDeckEachChosen");
    }
  });

  it("🛑 the anchor is load-bearing at BOTH ends — the tail is shared with all three siblings", () => {
    // This sentence CONTAINS D308's consequent almost whole ("For each of THOSE
    // Pokémon" against "For each of YOUR BENCHED Pokémon"), and shares the tail
    // with every arm in the family, so `^` and `$` each do work the other cannot.
    expect(EACH_CHOSEN.endsWith(SHARED_TAIL)).toBe(true);
    expect(EACH_BENCHED.endsWith(SHARED_TAIL)).toBe(true);
    expect(BODY_CHOICE.endsWith(SHARED_TAIL)).toBe(true);
    // Neither sentence contains the other, in either direction — asserted rather
    // than assumed, because "obviously not" is how D308's containment claim came
    // out backwards.
    expect(EACH_CHOSEN.includes(EACH_BENCHED)).toBe(false);
    expect(EACH_BENCHED.includes(EACH_CHOSEN)).toBe(false);
    // …and the ONE substring they really do share, named.
    expect(EACH_CHOSEN.includes("For each of those Pokémon, search your deck")).toBe(true);
    expect(EACH_BENCHED.includes("For each of your Benched Pokémon, search your deck")).toBe(true);
  });

  it("the corpus says 1, and the family's remainder goes 1 → 0: the row is CLOSED", () => {
    // 🛑 THE POPULATION MEASURED FROM THE COMMITTED CORPUS, NOT QUOTED FROM THE D1
    // QUERY IN THE HEADER — the second independent route, and it agrees to the row.
    const units = (text: string) => legalAttackCorpus().find(([, t]) => t === text)?.[0];
    expect(units(EACH_CHOSEN)).toBe(1);
    const family = legalAttackCorpus().filter(([, t]) =>
      t.includes("deck for a card that evolves"),
    );
    // FIVE distinct sentences carrying THIRTEEN legal printings.
    expect(family.length).toBe(5);
    expect(family.reduce((sum, [n]) => sum + n, 0)).toBe(13);
    // ⚠️ EXEGGCUTE'S LICENSED RECORD IS IN THIS LIST AND IS BUILT THROUGH D282's
    // SPLIT, so a bare `deriveAttackEffect` refusal is expected on it and on
    // NOTHING ELSE — which is exactly the shape D307/D308/D309 each left behind
    // and the shape this slice finally empties.
    const refused = family.filter(([, t]) => deriveAttackEffect(t) === null);
    expect(refused.map(([, t]) => t)).not.toContain(EACH_CHOSEN);
    expect(refused.map(([, t]) => t)).toEqual([
      "If you go first, you can use this attack during your first turn. Search your deck for a card that evolves from this Pokémon and put it onto this Pokémon to evolve it. Then, shuffle your deck.",
    ]);
  });
});

describe("D315 §2 — the MULTI park: three predicates at once, and only the type half is new", () => {
  it("🛑 the park is a choosePokemonMulti at min 0, and the ACTIVE is on the offer", () => {
    // ⚠️ THE RUNG THE WHOLE SLICE TURNS ON. *"your {D} Pokémon"* is the own board
    // and the printed word is not "Benched", so the attacker itself is a candidate
    // — Nidorina is {D} and Nidoqueen is in the deck.
    const prompt = multiPrompt(declare(board(41)));
    expect(prompt.candidates).toContainEqual(ACTIVE_REF);
    expect(prompt.min).toBe(0);
    expect(prompt.max).toBe(2);
    // `declinable` is the SEPARATE printed "you may" and this sentence prints none;
    // a `min: 0` prompt is declinable by construction (the prompt's own doc block).
    expect(prompt.declinable).toBe(false);
    // THE PROMPT SAYS WHAT THE ANSWER BUYS (§9.2's note doctrine at its third site
    // in this family) and NAMES THE TYPE, because the candidate set is narrowed by
    // it and a caption saying "your Pokémon" would describe a set it is not offering.
    expect(prompt.note).toContain("Darkness");
    expect(prompt.note).toContain("You will then choose a card for each");
  });

  it("🛑 the candidate set is TYPED and DECK-NARROWED — the two refusals, told apart", () => {
    // The default board benches five bodies and only THREE of them plus the Active
    // are eligible. Each rejected body fails exactly ONE conjunct, so a build that
    // dropped either narrowing offers a different set and this rung names which.
    const prompt = multiPrompt(declare(board(41)));
    expect(prompt.candidates).toEqual([
      ACTIVE_REF, // Nidorina, {D}, Nidoqueen in deck
      benchRef(0), // ec-dark-a, {D}, two evolutions in deck
      benchRef(1), // ec-dark-b, {D}, one evolution in deck
      benchRef(4), // ec-dual-e, ["Water","Darkness"] — the dual-type control
    ]);
    // 🛑 THE FIRE BODY HAS AN EVOLUTION IN THE DECK AND IS STILL REFUSED — the type
    // conjunct alone. Dropping it admits bench 2.
    expect(prompt.candidates).not.toContainEqual(benchRef(2));
    // 🛑 THE FOURTH DARK BODY HAS NOTHING THAT EVOLVES FROM IT AND IS REFUSED — the
    // deck conjunct alone (D309's real work, inherited). Dropping it admits bench 3.
    expect(prompt.candidates).not.toContainEqual(benchRef(3));
  });

  it("🛑 the DUAL-TYPE body is admitted — the {D} noun is membership, not equality", () => {
    // The catalog column is an ARRAY and dual-type Pokémon are printed. A
    // comparison written as `types[0] === pokemonType` or as equality on the whole
    // array passes every other rung in this file and fails only here.
    const prompt = multiPrompt(declare(board(41)));
    expect(prompt.candidates).toContainEqual(benchRef(4));
    expect(POOL["ec-dual-e"]?.types).toEqual(["Water", "Darkness"]);
  });

  it("🛑 NO FORCED-SINGLE: one eligible body still PARKS, because 'up to' keeps a decision", () => {
    // ⚠️ WHERE THIS OP PARTS FROM `evolveFromDeckChosen`, AND THE REASON IS THE
    // PRINTED ARTICLE RATHER THAN THE CANDIDATE COUNT. D309 forces a board of one
    // because *"1 of your Pokémon"* is MANDATORY — with one eligible body there is
    // no decision left to take. *"Choose UP TO 2"* keeps one on every board, since
    // taking fewer (including none) is a printed answer. A build that copied D309's
    // forcing would silently delete the decline, and this is the board that says so.
    const one = board(41, ["ec-dark-b", "ec-fire-c", "ec-dark-d"]);
    const parked = declare(stripDeck(one, ["ec-evo-active"]));
    const prompt = multiPrompt(parked);
    expect(prompt.candidates).toEqual([benchRef(0)]);
    // §8.6 — `max` is clamped to the board, so a printed "up to 2" over one
    // eligible body offers 1 rather than an unanswerable 2.
    expect(prompt.max).toBe(1);
    expect(prompt.min).toBe(0);
    expect(prompt.note).toContain("up to 1");
  });

  it("NO eligible body at all is the silent ending, and the trailing shuffle still fires", () => {
    // The same silent ending `searchDeck`, `evolveFromDeck` and `evolveFromDeckChosen`
    // all take: the narrowing reads the DECK and `programPlayable` never does, so an
    // all-whiff board is a LEGAL declaration that resolves to nothing.
    const barren = stripDeck(board(41, ["ec-fire-c", "ec-dark-d"]), [
      "ec-evo-active",
      "ec-evo-a1",
      "ec-evo-a2",
      "ec-evo-b",
      "ec-evo-e",
    ]);
    const ran = declareWith(barren);
    expect(ran.state.phase.kind).not.toBe("effect:choose");
    // …and the printed "Then, shuffle your deck." ran anyway.
    expect(shuffles(ran.events)).toBe(1);
  });
});

describe("D315 §3 — the answer buys N ops: two bodies, two card parks, ONE shuffle", () => {
  it("🛑 picking TWO bodies parks twice, in the order named, each about its OWN body", () => {
    // THE FOURTH `continuationOps` MEMBER, AND THE FIRST WHOSE ANSWER BUYS MORE
    // THAN ONE OP. `resumeProgram` splices the scheduled ops AHEAD of `cont.rest`,
    // so both parks land in front of the trailing shuffle and each re-derives its
    // own offer off the `onto` the answer wrote.
    const first = declare(board(41));
    const parked = answerBodies(first, [benchRef(0), benchRef(1)]).state;
    const promptA = cardsPrompt(parked);
    expect(candidateIds(parked, promptA.candidates)).toEqual(["ec-evo-a1", "ec-evo-a2"]);
    expect(promptA.dest).toBe("evolve");
    expect(promptA.max).toBe(1);
    expect(promptA.note).toContain("ec-dark-a");
    // 🛑 AND IT IS NOT ABOUT THE ATTACKER. A note naming the wrong body is the
    // failure a redirected op makes that an unredirected one cannot.
    expect(promptA.note).not.toContain("Nidorina");

    const second = answerCard(parked, [offered(parked, promptA.candidates, "ec-evo-a2")]).state;
    const promptB = cardsPrompt(second);
    expect(candidateIds(second, promptB.candidates)).toEqual(["ec-evo-b"]);
    expect(promptB.note).toContain("ec-dark-b");

    const done = answerCard(second, [offered(second, promptB.candidates, "ec-evo-b")]).state;
    expect(benchTopId(done, 0)).toBe("ec-evo-a2");
    expect(benchTopId(done, 1)).toBe("ec-evo-b");
    // The attacker was not picked and did not evolve.
    expect(activeTopId(done)).toBe("sv10-115");
    expect(done.phase.kind).not.toBe("effect:choose");
  });

  it("🛑 ONE printed shuffle stays ONE shuffle across BOTH placements", () => {
    // ⚠️ D308's ARGUMENT AT ITS SECOND SITE, DRIVEN RATHER THAN INHERITED. The
    // trailing `shuffleDeck` is the DERIVER's second op, so it sits BEHIND
    // everything the continuation unshifts; a build that scheduled the shuffle per
    // body — the obvious mistake, since the printed sentence follows an iteration —
    // would emit two.
    const declared = declareWith(board(41));
    const bodies = answerBodies(declared.state, [benchRef(0), benchRef(1)]);
    const cardA = answerCard(bodies.state, [
      offered(bodies.state, cardsPrompt(bodies.state).candidates, "ec-evo-a1"),
    ]);
    const cardB = answerCard(cardA.state, [
      offered(cardA.state, cardsPrompt(cardA.state).candidates, "ec-evo-b"),
    ]);
    expect(shuffles(declared.events, bodies.events, cardA.events, cardB.events)).toBe(1);
  });

  it("picking the ACTIVE evolves the ATTACKER — the carried answer is a TARGET", () => {
    // D309's widening (`ontoBench` → `onto`) is what makes this reachable, and this
    // slice is its second consumer: a bench INDEX could not have carried it.
    const declared = declareWith(board(41));
    const bodies = answerBodies(declared.state, [ACTIVE_REF]);
    const prompt = cardsPrompt(bodies.state);
    expect(candidateIds(bodies.state, prompt.candidates)).toEqual(["ec-evo-active"]);
    const card = answerCard(bodies.state, [
      offered(bodies.state, prompt.candidates, "ec-evo-active"),
    ]);
    expect(activeTopId(card.state)).toBe("ec-evo-active");
    expect(shuffles(declared.events, bodies.events, card.events)).toBe(1);
  });

  it("🛑 the EMPTY pick is the printed decline: nothing evolves, the shuffle still fires", () => {
    // *"Choose UP TO 2"* legalises taking none, and an answer that buys nothing
    // splices nothing — the same ending `optional`'s "no" takes. The board must be
    // untouched and the program must still finish.
    const declared = declareWith(board(41));
    const declined = answerBodies(declared.state, []);
    const done = declined.state;
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(activeTopId(done)).toBe("sv10-115");
    expect(benchTopId(done, 0)).toBe("ec-dark-a");
    expect(benchTopId(done, 1)).toBe("ec-dark-b");
    expect(shuffles(declared.events, declined.events)).toBe(1);
  });

  it("picking ONE of two available bodies parks ONCE — 'up to' means up to", () => {
    const parked = answerBodies(declare(board(41)), [benchRef(1)]).state;
    const prompt = cardsPrompt(parked);
    expect(candidateIds(parked, prompt.candidates)).toEqual(["ec-evo-b"]);
    const done = answerCard(parked, [offered(parked, prompt.candidates, "ec-evo-b")]).state;
    expect(benchTopId(done, 1)).toBe("ec-evo-b");
    expect(benchTopId(done, 0)).toBe("ec-dark-a");
    expect(done.phase.kind).not.toBe("effect:choose");
  });

  it("DECLINING a per-body CARD park leaves that body alone and the next park still comes", () => {
    // Each `evolveFromDeck` is "up to" in its own right (`min: 0`), so a player may
    // take the first body's evolution and skip the second's. The two parks are
    // independent decisions, which is what makes them two ops.
    const first = declare(board(41));
    const parked = answerBodies(first, [benchRef(0), benchRef(1)]).state;
    const second = answerCard(parked, []).state;
    const promptB = cardsPrompt(second);
    expect(candidateIds(second, promptB.candidates)).toEqual(["ec-evo-b"]);
    const done = answerCard(second, [offered(second, promptB.candidates, "ec-evo-b")]).state;
    expect(benchTopId(done, 0)).toBe("ec-dark-a");
    expect(benchTopId(done, 1)).toBe("ec-evo-b");
  });
});

describe("D315 §4 — the wire: the validator is the prompt, and no second copy of the rule", () => {
  it("a body the NARROWING excluded is rejected off the prompt, not by a duplicated predicate", () => {
    // `validateChoice` (cardplay.ts) matches a wire answer against
    // `prompt.candidates`, so a body this op's builder excluded is unreachable from
    // a crafted frame BY CONSTRUCTION rather than by a second copy of the rule —
    // which is why `evolvableOwnRefs` needs no validation arm of its own.
    const parked = declare(board(41));
    for (const ref of [benchRef(2), benchRef(3)]) {
      const rejected = applyAction(parked, {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "pokemonMulti", refs: [ref] },
      });
      expect(rejected.ok).toBe(false);
      if (!rejected.ok) expect(rejected.error.code).toBe("BAD_EFFECT_CHOICE");
    }
  });

  it("over-picking and double-picking are both refused, at the printed number", () => {
    const parked = declare(board(41));
    const over = applyAction(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [ACTIVE_REF, benchRef(0), benchRef(1)] },
    });
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.error.code).toBe("BAD_EFFECT_CHOICE");
    const twice = applyAction(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [benchRef(0), benchRef(0)] },
    });
    expect(twice.ok).toBe(false);
    if (!twice.ok) expect(twice.error.code).toBe("BAD_EFFECT_CHOICE");
  });

  it("the WRONG choice kind buys nothing rather than throwing", () => {
    // `continuationOps`' arm reads `choice.kind === "pokemonMulti"`; every other
    // shape falls out to the empty list. The wire cannot get here (the validator
    // has already matched the shape against the prompt), so this is the same
    // by-construction guard the other three members carry.
    const parked = declare(board(41));
    const wrong = applyAction(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon", ref: benchRef(0) },
    });
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.error.code).toBe("BAD_EFFECT_CHOICE");
  });
});

describe("D315 §5 — index precision, and the SECOND attack that must stay unsimulated", () => {
  it("index 1 is 'Scratch' — damage only, no program, and it must not inherit this one", () => {
    // D187's inflated intermediate result, at this family's fourth site: marking a
    // whole CARD built instead of one index is the mistake, and the fixture carries
    // both printed attacks precisely so the claim can be made in both directions.
    const nid = POOL["sv10-115"];
    expect(nid?.attacks?.[1]?.name).toBe("Scratch");
    expect(nid?.attacks?.[1]?.effect).toBeUndefined();
    expect(nid?.attacks?.[1]?.damage).toBe(50);
    const done = declare(board(41, DEFAULT_BENCH, 2), 1);
    expect(done.phase.kind).not.toBe("effect:choose");
    expect(done.players.p2.active?.damage).toBe(50);
  });
});

describe("D315 §6 — the ABSENCES, asserted against the live build rather than left as prose", () => {
  it("🛑 NO REGISTRY ROW is authored for Nidorina, and that is the priced decision", () => {
    // ⚠️ THE HANDOFF ASKED FOR ONE. `BUILT.attack`'s raw summand is keyed on the
    // READER over the whole legal corpus with `programFor` nowhere in the addition,
    // so a row here would buy ZERO printings — and `conventions.md`'s *an arm
    // transfers across sets; a registry row does not* points the same way. An
    // absence nobody asks about is the one a later author "fixes".
    expect(programFor("sv10-115")).toBeUndefined();
    // …while the reader really does resolve it, which is the half that makes the
    // absence a decision rather than a gap.
    expect(deriveAttackEffect(EACH_CHOSEN)).not.toBeNull();
  });

  it("🛑 the op has EXACTLY ONE producer in the whole build — the version SKIP's premise", () => {
    // ⚠️ CLASSIFY BEFORE COPYING EITHER PARAGRAPH (D309's rule). D309 bumped
    // `MATCH_RECORD_VERSION` 17 → 18 for a RENAME, the one shape that is not a
    // widening, because an older record could hold the OLD spelling. This slice
    // adds a new union MEMBER, and the SKIP rests on a premise this rung drives
    // rather than asserts in prose: **a v18 deploy cannot author this op**, so no
    // v18 record can hold one and this deploy reads every v18 record unchanged.
    // The premise is checkable HERE — the op has exactly one producer, this
    // slice's arm, and nothing in the registry can write it into a `pendingOp`.
    const fromCorpus = legalAttackCorpus().filter(([, t]) =>
      JSON.stringify(deriveAttackEffect(t) ?? []).includes("evolveFromDeckEachChosen"),
    );
    expect(fromCorpus.map(([, t]) => t)).toEqual([EACH_CHOSEN]);
    for (const id of registryCardIds()) {
      expect(JSON.stringify(programFor(id) ?? {}), id).not.toContain("evolveFromDeckEachChosen");
    }
  });

  it("the op carries TWO fields and no third — the printed count and the printed noun", () => {
    // D104's minimal shape, asserted rather than described: both fields are
    // REQUIRED because the pool prints exactly one sentence and it carries both, so
    // an absent field would be a state no card can author (D222's closed world).
    const derived = deriveAttackEffect(EACH_CHOSEN);
    expect(derived).not.toBeNull();
    expect(Object.keys(derived?.[0] ?? {}).sort()).toEqual(["max", "op", "pokemonType"]);
  });
});
