import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { legalAttackCorpus } from "./censusAttackCorpus";
import { deriveAttackEffect } from "./effects";
import { applyAction } from "./index";
import type { GameState, PokemonRef, Seat } from "./index";
import { programFor, registryCardIds } from "./registry";
import {
  FIXTURE_POOL,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  mustApply,
  setActiveFromDeck,
  typedEnergy,
  driveSetup,
} from "./testFixtures";

const EACH_CHOSEN =
  "Choose up to 2 of your {D} Pokémon. For each of those Pokémon, search your deck for a card that evolves from that Pokémon and put it onto that Pokémon to evolve it. Then, shuffle your deck.";
const BARE =
  "Search your deck for a card that evolves from this Pokémon and put it onto this Pokémon to evolve it. Then, shuffle your deck.";
const EACH_BENCHED =
  "For each of your Benched Pokémon, search your deck for a card that evolves from that Pokémon and put it onto that Pokémon to evolve it. Then, shuffle your deck.";
const BODY_CHOICE =
  "Search your deck for a card that evolves from 1 of your Pokémon and put it onto that Pokémon to evolve it. Then, shuffle your deck.";
const JANINE =
  "Choose up to 2 of your {D} Pokémon. For each of those Pokémon, search your deck for a Basic {D} Energy card and attach it to that Pokémon. Then, shuffle your deck. If you attached Energy to your Active Pokémon in this way, it is now Poisoned.";
const SHARED_HEAD = "Choose up to 2 of your {D} Pokémon. For each of those Pokémon, search your ";
const SHARED_TAIL = " and put it onto that Pokémon to evolve it. Then, shuffle your deck.";

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
  "ec-fire-c": basic("ec-fire-c", ["Fire"]),
  "ec-evo-c": stage1From("ec-evo-c", "ec-fire-c", ["Fire"]),
  "ec-dark-d": basic("ec-dark-d", ["Darkness"]),
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
  return driveSetup(seed, { p1: CHOSEN_DECK, p2: CHOSEN_DECK }, { pool: POOL, first });
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
    expect(deriveAttackEffect(EACH_CHOSEN)).toEqual([
      { op: "evolveFromDeckEachChosen", max: 2, pokemonType: "Darkness" },
      { op: "shuffleDeck" },
    ]);
  });

  it("the captures are READ, not hard-coded — a re-typed, re-counted variant follows them", () => {
    expect(deriveAttackEffect(EACH_CHOSEN.replace("up to 2", "up to 3"))).toEqual([
      { op: "evolveFromDeckEachChosen", max: 3, pokemonType: "Darkness" },
      { op: "shuffleDeck" },
    ]);
    expect(deriveAttackEffect(EACH_CHOSEN.replace("{D}", "{P}"))).toEqual([
      { op: "evolveFromDeckEachChosen", max: 3 - 1, pokemonType: "Psychic" },
      { op: "shuffleDeck" },
    ]);
  });

  it("an UNKNOWN brace code falls to the LOUD path — no default type is invented", () => {
    expect(deriveAttackEffect(EACH_CHOSEN.replace("{D}", "{Q}"))).toBeNull();
    // …and the "up to 0" nobody prints stays loud too, rather than deriving a
    // program that chooses nothing and shuffles anyway.
    expect(deriveAttackEffect(EACH_CHOSEN.replace("up to 2", "up to 0"))).toBeNull();
  });

  it("the THREE sibling sentences keep their own arms — nothing was swallowed", () => {
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

  it("JANINE'S SECRET ART shares this ANTECEDENT byte for byte and must stay elsewhere", () => {
    expect(
      JANINE.startsWith("Choose up to 2 of your {D} Pokémon. For each of those Pokémon, "),
    ).toBe(true);
    expect(EACH_CHOSEN.startsWith(SHARED_HEAD)).toBe(true);
    expect(JANINE.startsWith(SHARED_HEAD)).toBe(true);
    expect(deriveAttackEffect(JANINE)).toBeNull();
    for (const id of ["sv06.5-059", "sv06.5-088", "sv08.5-112", "sv08.5-173"]) {
      const program = programFor(id)?.trainer;
      expect(program, id).toBeDefined();
      expect(JSON.stringify(program), id).toContain("attachFromDeck");
      expect(JSON.stringify(program), id).not.toContain("evolveFromDeckEachChosen");
    }
  });

  it("the anchor is load-bearing at BOTH ends — the tail is shared with all three siblings", () => {
    expect(EACH_CHOSEN.endsWith(SHARED_TAIL)).toBe(true);
    expect(EACH_BENCHED.endsWith(SHARED_TAIL)).toBe(true);
    expect(BODY_CHOICE.endsWith(SHARED_TAIL)).toBe(true);
    expect(EACH_CHOSEN.includes(EACH_BENCHED)).toBe(false);
    expect(EACH_BENCHED.includes(EACH_CHOSEN)).toBe(false);
    // …and the ONE substring they really do share, named.
    expect(EACH_CHOSEN.includes("For each of those Pokémon, search your deck")).toBe(true);
    expect(EACH_BENCHED.includes("For each of your Benched Pokémon, search your deck")).toBe(true);
  });

  it("the corpus says 1, and the family's remainder goes 1 → 0: the row is CLOSED", () => {
    const units = (text: string) => legalAttackCorpus().find(([, t]) => t === text)?.[0];
    expect(units(EACH_CHOSEN)).toBe(1);
    const family = legalAttackCorpus().filter(([, t]) =>
      t.includes("deck for a card that evolves"),
    );
    expect(family.length).toBe(5);
    expect(family.reduce((sum, [n]) => sum + n, 0)).toBe(13);
    const refused = family.filter(([, t]) => deriveAttackEffect(t) === null);
    expect(refused.map(([, t]) => t)).not.toContain(EACH_CHOSEN);
    expect(refused.map(([, t]) => t)).toEqual([
      "If you go first, you can use this attack during your first turn. Search your deck for a card that evolves from this Pokémon and put it onto this Pokémon to evolve it. Then, shuffle your deck.",
    ]);
  });
});

describe("D315 §2 — the MULTI park: three predicates at once, and only the type half is new", () => {
  it("the park is a choosePokemonMulti at min 0, and the ACTIVE is on the offer", () => {
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

  it("the candidate set is TYPED and DECK-NARROWED — the two refusals, told apart", () => {
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
    expect(prompt.candidates).not.toContainEqual(benchRef(2));
    expect(prompt.candidates).not.toContainEqual(benchRef(3));
  });

  it("the DUAL-TYPE body is admitted — the {D} noun is membership, not equality", () => {
    // The catalog column is an ARRAY and dual-type Pokémon are printed. A
    // comparison written as `types[0] === pokemonType` or as equality on the whole
    // array passes every other rung in this file and fails only here.
    const prompt = multiPrompt(declare(board(41)));
    expect(prompt.candidates).toContainEqual(benchRef(4));
    expect(POOL["ec-dual-e"]?.types).toEqual(["Water", "Darkness"]);
  });

  it("NO FORCED-SINGLE: one eligible body still PARKS, because 'up to' keeps a decision", () => {
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
  it("picking TWO bodies parks twice, in the order named, each about its OWN body", () => {
    const first = declare(board(41));
    const parked = answerBodies(first, [benchRef(0), benchRef(1)]).state;
    const promptA = cardsPrompt(parked);
    expect(candidateIds(parked, promptA.candidates)).toEqual(["ec-evo-a1", "ec-evo-a2"]);
    expect(promptA.dest).toBe("evolve");
    expect(promptA.max).toBe(1);
    expect(promptA.note).toContain("ec-dark-a");
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

  it("ONE printed shuffle stays ONE shuffle across BOTH placements", () => {
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

  it("the EMPTY pick is the printed decline: nothing evolves, the shuffle still fires", () => {
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
  it("NO REGISTRY ROW is authored for Nidorina, and that is the priced decision", () => {
    expect(programFor("sv10-115")).toBeUndefined();
    // …while the reader really does resolve it, which is the half that makes the
    // absence a decision rather than a gap.
    expect(deriveAttackEffect(EACH_CHOSEN)).not.toBeNull();
  });

  it("the op has EXACTLY ONE producer in the whole build — the version SKIP's premise", () => {
    const fromCorpus = legalAttackCorpus().filter(([, t]) =>
      JSON.stringify(deriveAttackEffect(t) ?? []).includes("evolveFromDeckEachChosen"),
    );
    expect(fromCorpus.map(([, t]) => t)).toEqual([EACH_CHOSEN]);
    for (const id of registryCardIds()) {
      expect(JSON.stringify(programFor(id) ?? {}), id).not.toContain("evolveFromDeckEachChosen");
    }
  });

  it("the op carries TWO fields and no third — the printed count and the printed noun", () => {
    const derived = deriveAttackEffect(EACH_CHOSEN);
    expect(derived).not.toBeNull();
    expect(Object.keys(derived?.[0] ?? {}).sort()).toEqual(["max", "op", "pokemonType"]);
  });
});
