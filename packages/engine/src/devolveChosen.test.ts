import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import type { EffectOp } from "./effects";
import { deriveAttackEffect } from "./effects";
import { applyAction, createGame, programFor, redactGame } from "./index";
import type { GameEvent, GameState, InPlayPokemon, PokemonRef, Seat } from "./index";
import { type LogContext, logFromEvents } from "./log";
import {
  FIXTURE_POOL,
  attachBenchFromDeck,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  deepFreeze,
  firstBasicInHand,
  handFromDeck,
  handUid,
  must,
  mustApply,
  setActiveFromDeck,
  setBenchDamage,
  setDamage,
  types,
} from "./testFixtures";
import { koByEffectMarker } from "./types";

const SENTENCE =
  "Devolve 1 of your opponent's evolved Pokémon by putting the highest Stage Evolution card on it into your opponent's hand.";
const SWEEP_SENTENCE =
  "Devolve each of your opponent's evolved Pokémon by shuffling the highest Stage Evolution card on it into your opponent's deck.";

const PICK = 0; // {C}, NO damage, the sentence — the pure "one body devolves" board
const PLAIN = 1; // {C}, NO damage, NO effect — the one-axis control
const BLOW = 2; // {C}, 60 damage, the sentence — damage AND the pick on one board
const SWEEP = 3;

const LOCAL_CARDS: Record<string, Card> = {
  "d540-devolver": battler("d540-devolver", {
    types: ["Colorless"],
    hp: 300,
    retreat: 1,
    attacks: [
      { cost: ["Colorless"], name: "Hand Regression", effect: SENTENCE },
      { cost: ["Colorless"], name: "Plain Call" },
      { cost: ["Colorless"], name: "Regressive Blow", damage: 60, effect: SENTENCE },
      { cost: ["Colorless"], name: "Ancestral Call", effect: SWEEP_SENTENCE },
    ],
  }),
  "d540-basic": battler("d540-basic", { types: ["Colorless"], hp: 60, retreat: 1 }),
  "d540-s1": battler("d540-s1", {
    types: ["Colorless"],
    hp: 90,
    retreat: 1,
    stage: "Stage1",
    evolveFrom: "d540-basic",
  }),
  "d540-s2": battler("d540-s2", {
    types: ["Colorless"],
    hp: 140,
    retreat: 1,
    stage: "Stage2",
    evolveFrom: "d540-s1",
  }),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const CHOSEN_DECK = deckOf({
  "d540-devolver": 4,
  "d540-basic": 8,
  "d540-s1": 6,
  "d540-s2": 6,
  "fix-mist-energy": 4,
  "fix-titan": 4,
  "fix-bigbody": 8,
  "fix-energy": 16,
  "sv03-197": 4,
});

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

function all<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

function body(pokemon: InPlayPokemon | null | undefined): InPlayPokemon {
  if (pokemon === null || pokemon === undefined) throw new Error("expected a Pokémon");
  return pokemon;
}

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

function pass(state: GameState, seat: Seat): GameState {
  return mustApply(state, { type: "endTurn", seat }).state;
}

/** Evolve `seat`'s body at `target` by drawing the evolution card into hand and
    playing a REAL `evolve` action — never by writing `stack` directly, so every field
    `devolvedBodyOf` sheds arrives the way `evolveOnto` wrote it. */
function evolveInto(
  state: GameState,
  seat: Seat,
  cardId: string,
  target: { spot: "active" } | { spot: "bench"; index: number },
): GameState {
  const held = handFromDeck(state, seat, cardId, 1);
  return mustApply(held, { type: "evolve", seat, uid: handUid(held, seat, cardId), target }).state;
}

interface BoardOpts {
  /** How far up the chain the VICTIM's Active is evolved. 0 = an unevolved Basic. */
  stages: 0 | 1 | 2;
  /** A second, BENCHED body on the victim's board, evolved one step. This is what
      turns the FORCED path into the PARKED one: two candidates ask. */
  benchStages?: 0 | 1;
  damage?: number;
  benchDamage?: number;
  /** Mist Energy onto the victim's BENCHED body (the §8 shield). */
  shieldBench?: boolean;
  /** Mist Energy onto the victim's ACTIVE (§8's other side). */
  shieldActive?: boolean;
  /** Which seat attacks. The other seat is the victim. */
  attacker?: Seat;
  energy?: number;
  /** Give the ATTACKER an evolved benched body too — the control that proves the
      funnel reads "your opponent's" and not "every". */
  attackerEvolves?: boolean;
}

function armed(seed: number, opts: BoardOpts): GameState {
  const attacker = opts.attacker ?? "p1";
  const victim = attacker === "p1" ? "p2" : "p1";
  let state = localSetup(seed, attacker);
  state = setActiveFromDeck(state, attacker, "d540-devolver");
  state = clearBench(state, attacker);
  state = attachFromDeck(state, attacker, "fix-energy", opts.energy ?? 2);
  if (opts.attackerEvolves === true) state = benchFromDeck(state, attacker, "d540-basic");
  state = setActiveFromDeck(state, victim, "d540-basic");
  state = clearBench(state, victim);
  if (opts.benchStages !== undefined) state = benchFromDeck(state, victim, "d540-basic");
  state = benchFromDeck(state, victim, "fix-titan");
  state = benchFromDeck(state, victim, "fix-bigbody");

  // Turn 1 is the ATTACKER's (§4 forbids its attack anyway) and turn 2 is the VICTIM's
  // OWN first turn, on which §4/§10 forbids evolving — so both are passed before any
  // evolution, and each evolution then costs a full round.
  state = pass(state, attacker);
  state = pass(state, victim);
  const rounds = Math.max(
    opts.stages,
    opts.benchStages ?? 0,
    opts.attackerEvolves === true ? 1 : 0,
  );
  for (let step = 0; step < rounds; step += 1) {
    if (step === 0 && opts.attackerEvolves === true) {
      state = evolveInto(state, attacker, "d540-s1", { spot: "bench", index: 0 });
    }
    state = pass(state, attacker);
    if (step < opts.stages) {
      state = evolveInto(state, victim, step === 0 ? "d540-s1" : "d540-s2", { spot: "active" });
    }
    if (step < (opts.benchStages ?? 0)) {
      state = evolveInto(state, victim, "d540-s1", { spot: "bench", index: 0 });
    }
    state = pass(state, victim);
  }
  if (opts.damage !== undefined) state = setDamage(state, victim, opts.damage);
  if (opts.benchDamage !== undefined) state = setBenchDamage(state, victim, 0, opts.benchDamage);
  if (opts.shieldActive === true) state = attachFromDeck(state, victim, "fix-mist-energy", 1);
  if (opts.shieldBench === true)
    state = attachBenchFromDeck(state, victim, 0, "fix-mist-energy", 1);
  return state;
}

function strike(state: GameState, seat: Seat, index: number) {
  return mustApply(state, { type: "attack", seat, index });
}

/** Answer the parked `choosePokemon` prompt with `ref`. */
function answer(state: GameState, seat: Seat, ref: PokemonRef) {
  return mustApply(state, { type: "resolveEffect", seat, choice: { kind: "pokemon", ref } });
}

function parked(state: GameState): {
  candidates: PokemonRef[];
  note: string;
  pendingOp: EffectOp | undefined;
} {
  const phase = state.phase;
  if (phase.kind !== "effect:choose") throw new Error(`expected effect:choose, got ${phase.kind}`);
  const prompt = phase.prompt as { kind: string; candidates?: PokemonRef[]; note?: string };
  if (prompt.kind !== "choosePokemon")
    throw new Error(`expected choosePokemon, got ${prompt.kind}`);
  return {
    candidates: prompt.candidates ?? [],
    note: prompt.note ?? "",
    pendingOp: (phase.cont as { pendingOp?: EffectOp }).pendingOp,
  };
}

/** Walk the §8.1 stages a Knock Out queues — Prize, then promotion. */
function settle(state: GameState): GameState {
  let next = state;
  for (let guard = 0; guard < 12; guard += 1) {
    if (next.phase.kind === "ko:takePrizes") {
      const { seat, count: owed } = next.phase;
      next = must(
        applyAction(next, {
          type: "takePrizes",
          seat,
          prizeIndices: Array.from({ length: owed }, (_, i) => i),
        }),
      );
      continue;
    }
    if (next.phase.kind === "ko:promote") {
      const seat = next.phase.seat;
      next = must(applyAction(next, { type: "promote", seat, benchIndex: 0 }));
      continue;
    }
    return next;
  }
  throw new Error("KO stages never settled");
}

function idOf(state: GameState, uid: string): string | undefined {
  return state.cardIdByUid[uid];
}

const ACTIVE: PokemonRef = { seat: "p2", spot: { spot: "active" } };
const BENCH0: PokemonRef = { seat: "p2", spot: { spot: "bench", index: 0 } };

// ─────────────────────────────────────────────────────────────────────────────
// §1 — THE DERIVATION, off the LIVE module, and the family closure it buys.
// ─────────────────────────────────────────────────────────────────────────────
describe("§1 — the sentence derives to ONE field-free op", () => {
  it("the printed sentence derives to exactly `[{ op: 'devolveChosen' }]`", () => {
    expect(deriveAttackEffect(SENTENCE)).toEqual([{ op: "devolveChosen" }]);
  });

  it("the corpus row is the byte-for-byte string this suite asserts against", () => {
    const rows = legalAttackCorpus().filter(([, text]) => /[Dd]evolv/.test(text));
    expect(rows).toHaveLength(2);
    expect(rows.map(([, text]) => text).sort()).toEqual([SENTENCE, SWEEP_SENTENCE].sort());
    expect(rows.find(([, text]) => text === SENTENCE)?.[0]).toBe(1);
    expect(rows.find(([, text]) => text === SWEEP_SENTENCE)?.[0]).toBe(3);
    expect(rows.reduce((sum, [n]) => sum + n, 0)).toBe(4);
  });

  it("THE FAMILY IS CLOSED — both devolve rows now resolve, and neither is off the table", () => {
    expect(resolvedByAnyReader(SENTENCE)).toBe(true);
    expect(resolvedByAnyReader(SWEEP_SENTENCE)).toBe(true);
    const rows = legalAttackCorpus().filter(([, text]) => /[Dd]evolv/.test(text));
    expect(rows.filter(([, t]) => /Ancient|Future|Tera /.test(t))).toEqual([]);
    expect(rows.filter(([, t]) => !resolvedByAnyReader(t))).toEqual([]);
  });

  it("the op reaches a real attack program through `programFor`'s fallback", () => {
    expect(programFor("d540-devolver")?.attack).toBeUndefined();
  });
});

describe("§2 — anchor × string, all four cells", () => {
  it("CELL (each-anchor, row 88) — the sweep anchor claims the sweep sentence", () => {
    expect(deriveAttackEffect(SWEEP_SENTENCE)).toEqual([{ op: "devolveEach" }]);
  });

  it("CELL (each-anchor, row 87) — the sweep anchor REFUSES this sentence", () => {
    expect(deriveAttackEffect(SENTENCE)?.[0]?.op).toBe("devolveChosen");
    expect(deriveAttackEffect(SENTENCE)?.[0]?.op).not.toBe("devolveEach");
  });

  it("CELL (1-of-anchor, row 87) — this anchor claims this sentence", () => {
    expect(deriveAttackEffect(SENTENCE)).toEqual([{ op: "devolveChosen" }]);
  });

  it("CELL (1-of-anchor, row 88) — the cell arm ORDER masks, made observable instead", () => {
    const oneOfIntoDeck = SENTENCE.replace(
      "by putting the highest Stage Evolution card on it into your opponent's hand.",
      "by shuffling the highest Stage Evolution card on it into your opponent's deck.",
    );
    const eachIntoHand = SWEEP_SENTENCE.replace(
      "by shuffling the highest Stage Evolution card on it into your opponent's deck.",
      "by putting the highest Stage Evolution card on it into your opponent's hand.",
    );
    expect(oneOfIntoDeck).not.toBe(SENTENCE);
    expect(oneOfIntoDeck).not.toBe(SWEEP_SENTENCE);
    expect(eachIntoHand).not.toBe(SENTENCE);
    expect(eachIntoHand).not.toBe(SWEEP_SENTENCE);
    expect(deriveAttackEffect(oneOfIntoDeck)).toBeNull();
    expect(eachIntoHand).toBe(
      "Devolve each of your opponent's evolved Pokémon by putting the highest Stage Evolution card on it into your opponent's hand.",
    );
    expect(deriveAttackEffect(eachIntoHand)).toEqual([{ op: "devolveEach", toHand: true }]);
    const eachShuffledIntoHand = SWEEP_SENTENCE.replace(
      "your opponent's deck.",
      "your opponent's hand.",
    );
    expect(eachShuffledIntoHand).not.toBe(SWEEP_SENTENCE);
    expect(deriveAttackEffect(eachShuffledIntoHand)).toBeNull();
  });

  it("TOKEN 2 IS THE AXIS — the two sentences differ there and nowhere in the head", () => {
    // The re-pointed claim, driven rather than re-asserted in prose: the two printed
    // strings agree on token 1 ("Devolve") and disagree on token 2 ("1" vs "each").
    expect(SENTENCE.split(" ")[0]).toBe(SWEEP_SENTENCE.split(" ")[0]);
    expect(SENTENCE.split(" ")[0]).toBe("Devolve");
    expect(SENTENCE.split(" ")[1]).toBe("1");
    expect(SWEEP_SENTENCE.split(" ")[1]).toBe("each");
  });

  const NEAR_MISSES: [string, string][] = [
    ["the OWN side", SENTENCE.replace("1 of your opponent's evolved", "1 of your evolved")],
    ["the DESTINATION", SENTENCE.replace("opponent's hand.", "opponent's deck.")],
    ["the VERB", SENTENCE.replace("by putting", "by shuffling")],
    ["the QUANTIFIER", SENTENCE.replace("Devolve 1 of", "Devolve 2 of")],
    ["the FILTER", SENTENCE.replace("evolved Pokémon", "Pokémon")],
    ["the STAGE WORD", SENTENCE.replace("highest Stage Evolution", "lowest Stage Evolution")],
    ["a LEADING clause, capital KEPT", `Discard an Energy from this Pokémon. ${SENTENCE}`],
    [
      "a LEADING clause, lower-cased",
      `If you have any Benched Pokémon, ${SENTENCE[0]?.toLowerCase()}${SENTENCE.slice(1)}`,
    ],
    ["a TRAILING clause, period STRIPPED", `${SENTENCE.slice(0, -1)} Then, draw a card.`],
    ["a TRAILING clause, period KEPT", `${SENTENCE} Then, draw a card.`],
  ];

  for (const [axis, text] of NEAR_MISSES) {
    it(`refuses a string differing only in ${axis}`, () => {
      expect(deriveAttackEffect(text)).toBeNull();
      expect(text).not.toBe(SENTENCE);
    });
  }

  const CURLY_SLOT_1 = `${SENTENCE.slice(0, 26)}\u2019${SENTENCE.slice(27)}`;
  const CURLY_SLOT_2 = `${SENTENCE.slice(0, 113)}\u2019${SENTENCE.slice(114)}`;

  it("SLOT 1 — a CURLED first possessive still derives (the `['’]` class is real)", () => {
    // The index is asserted rather than trusted: a re-ingest that moves the possessive
    // would otherwise curl a letter and leave this rung green for the wrong reason.
    expect(SENTENCE[26]).toBe("'");
    expect(CURLY_SLOT_1).not.toBe(SENTENCE);
    expect(CURLY_SLOT_1).toContain("opponent\u2019s evolved");
    expect(deriveAttackEffect(CURLY_SLOT_1)).toEqual([{ op: "devolveChosen" }]);
  });

  it("SLOT 2 — a CURLED second possessive still derives", () => {
    expect(SENTENCE[113]).toBe("'");
    expect(CURLY_SLOT_2).not.toBe(SENTENCE);
    expect(CURLY_SLOT_2).toContain("opponent\u2019s hand.");
    expect(deriveAttackEffect(CURLY_SLOT_2)).toEqual([{ op: "devolveChosen" }]);
  });

  it("…and BOTH curled together derives too — the class is on both slots", () => {
    const both = `${CURLY_SLOT_1.slice(0, 113)}\u2019${CURLY_SLOT_1.slice(114)}`;
    expect(both).not.toBe(SENTENCE);
    expect(deriveAttackEffect(both)).toEqual([{ op: "devolveChosen" }]);
  });

  it("THE CONTROL — the corpus row itself prints U+0027 at BOTH slots", () => {
    const row = legalAttackCorpus().find(([, t]) => t === SENTENCE)?.[1] ?? "";
    expect(row).toBe(SENTENCE);
    expect(row.codePointAt(26)).toBe(0x27);
    expect(row.codePointAt(113)).toBe(0x27);
    expect(row).not.toContain("\u2019");
  });

  it("THE ADMISSION CONTROL — the reader still says YES to the real sentence", () => {
    expect(deriveAttackEffect(SENTENCE)).toEqual([{ op: "devolveChosen" }]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — THE FORCED PATH: one candidate is not a decision (the M1 rule).
// ─────────────────────────────────────────────────────────────────────────────
describe("§3 — a lone evolved body is FORCED, with no prompt at all", () => {
  it("the Active devolves with no `effect:choose` phase and no prompt", () => {
    const before = armed(11, { stages: 1 });
    expect(body(before.players.p2.active).stack).toHaveLength(2);
    const { state, events } = strike(before, "p1", PICK);
    // No park: `parkOrForce`'s one-candidate arm resolves inline, so the attack ran to
    // the turn boundary.
    expect(state.phase.kind).not.toBe("effect:choose");
    const devolved = all(events, "POKEMON_DEVOLVED");
    expect(devolved).toHaveLength(1);
    expect(devolved[0]?.seat).toBe("p2");
    expect(devolved[0]?.actor).toBe("p1");
    expect(devolved[0]?.zone).toBe("hand");
  });

  it("the stack shortens by ONE and the top is the Basic again", () => {
    const { state } = strike(armed(11, { stages: 1 }), "p1", PICK);
    const after = body(state.players.p2.active);
    expect(after.stack).toHaveLength(1);
    expect(idOf(state, must0(after.stack))).toBe("d540-basic");
  });

  it("the card is in the VICTIM's hand, and NO shuffle fired", () => {
    const before = armed(11, { stages: 1 });
    const top = must0(body(before.players.p2.active).stack.slice(-1));
    const { state, events } = strike(before, "p1", PICK);
    expect(types(events)).not.toContain("SHUFFLE");
    // The victim drew at the top of its own turn, so the two library zones are asked
    // about together where the board is not parked — but the DEVOLVED uid is pinned to
    // the hand specifically.
    expect(state.players.p2.hand).toContain(top);
    expect(state.players.p2.deck).not.toContain(top);
    expect(state.players.p2.discard).not.toContain(top);
  });

  it("it never touches the ATTACKER's OWN evolved bodies", () => {
    // The control that proves `devolveTargets` reads "your opponent's" and not "every".
    const before = armed(12, { stages: 1, attackerEvolves: true });
    expect(body(before.players.p1.bench[0]).stack).toHaveLength(2);
    const { state, events } = strike(before, "p1", PICK);
    expect(all(events, "POKEMON_DEVOLVED")).toHaveLength(1);
    expect(body(state.players.p1.bench[0]).stack).toHaveLength(2);
    expect(body(state.players.p2.active).stack).toHaveLength(1);
  });

  it("BOTH SEATS — p2 attacking p1 devolves p1's board and fills p1's hand", () => {
    const before = armed(13, { stages: 1, attacker: "p2" });
    const top = must0(body(before.players.p1.active).stack.slice(-1));
    const { state, events } = strike(before, "p2", PICK);
    const devolved = find(events, "POKEMON_DEVOLVED");
    expect(devolved?.seat).toBe("p1");
    expect(devolved?.actor).toBe("p2");
    expect(state.players.p1.hand).toContain(top);
    expect(state.players.p2.hand).not.toContain(top);
  });
});

describe("§4 — two candidates PARK, and the answer really moves the board", () => {
  it("the attack parks on `choosePokemon` with BOTH evolved bodies offered", () => {
    const { state } = strike(armed(21, { stages: 1, benchStages: 1 }), "p1", PICK);
    const { candidates } = parked(state);
    // `oppAnyRefs`' order: the Active first, then the Bench in index order.
    expect(candidates).toEqual([ACTIVE, BENCH0]);
  });

  it("the prompt's note is the PRINTED sentence, possessive included", () => {
    const { state } = strike(armed(21, { stages: 1, benchStages: 1 }), "p1", PICK);
    expect(parked(state).note).toBe(SENTENCE);
  });

  it("ANSWERING 'the Active' devolves the ACTIVE and leaves the BENCH alone", () => {
    const before = armed(21, { stages: 1, benchStages: 1 });
    const activeTop = must0(body(before.players.p2.active).stack.slice(-1));
    const { state: waiting } = strike(before, "p1", PICK);
    const { state, events } = answer(waiting, "p1", ACTIVE);
    expect(body(state.players.p2.active).stack).toHaveLength(1);
    expect(body(state.players.p2.bench[0]).stack).toHaveLength(2);
    expect(state.players.p2.hand).toContain(activeTop);
    expect(all(events, "POKEMON_DEVOLVED")).toHaveLength(1);
    expect(find(events, "POKEMON_DEVOLVED")?.zone).toBe("hand");
    expect(types(events)).not.toContain("SHUFFLE");
  });

  it("ANSWERING 'the Bench' devolves the BENCH and leaves the ACTIVE alone", () => {
    const before = armed(21, { stages: 1, benchStages: 1 });
    const benchTop = must0(body(before.players.p2.bench[0]).stack.slice(-1));
    const { state: waiting } = strike(before, "p1", PICK);
    const { state, events } = answer(waiting, "p1", BENCH0);
    expect(body(state.players.p2.bench[0]).stack).toHaveLength(1);
    expect(body(state.players.p2.active).stack).toHaveLength(2);
    expect(state.players.p2.hand).toContain(benchTop);
    expect(all(events, "POKEMON_DEVOLVED")).toHaveLength(1);
  });

  it("THE TWO ANSWERS PRODUCE DIFFERENT BOARDS — the answer is not discarded", () => {
    // The rung that dies the moment `applyChoice`'s arm is deleted: with the answer
    // dropped BOTH boards come back with two full stacks and these are equal.
    const before = armed(22, { stages: 1, benchStages: 1 });
    const { state: waiting } = strike(before, "p1", PICK);
    const pickActive = answer(waiting, "p1", ACTIVE).state;
    const pickBench = answer(waiting, "p1", BENCH0).state;
    expect(body(pickActive.players.p2.active).stack).toHaveLength(1);
    expect(body(pickBench.players.p2.active).stack).toHaveLength(2);
    expect(body(pickActive.players.p2.bench[0]).stack).toHaveLength(2);
    expect(body(pickBench.players.p2.bench[0]).stack).toHaveLength(1);
    expect(pickActive.players.p2.active).not.toEqual(pickBench.players.p2.active);
  });

  it("A FORCED DEVOLUTION AND AN ANSWERED ONE ARE THE SAME BOARD", () => {
    // One writer, two entry points — the whole reason `devolveBodyToHand` exists.
    // The forced board offers ONE candidate; the parked board is answered with the
    // SAME spot, and the victim's Active must come out identical.
    const forced = strike(armed(23, { stages: 1 }), "p1", PICK).state;
    const asked = answer(
      strike(armed(23, { stages: 1, benchStages: 1 }), "p1", PICK).state,
      "p1",
      ACTIVE,
    ).state;
    expect(body(asked.players.p2.active).stack).toEqual(body(forced.players.p2.active).stack);
    expect(body(asked.players.p2.active).conditions).toEqual(
      body(forced.players.p2.active).conditions,
    );
    expect(body(asked.players.p2.active).evolvedTurn).toBe(
      body(forced.players.p2.active).evolvedTurn,
    );
  });

  it("the parked op is MANDATORY — no `upTo` on the prompt, so a decline is not offered", () => {
    const { state } = strike(armed(21, { stages: 1, benchStages: 1 }), "p1", PICK);
    const phase = state.phase;
    if (phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(Object.keys(phase.prompt)).not.toContain("upTo");
    // …and no `answerer` is filed: the print says neither "You may" nor "(Your
    // opponent chooses …)", so the pick is the ATTACKER's.
    expect((phase as { answerer?: Seat }).answerer).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — THE EMPTY CANDIDATE SET: a silent no-op, every sibling's contract.
// ─────────────────────────────────────────────────────────────────────────────
describe("§5 — an entirely UNEVOLVED opponent board is a silent no-op", () => {
  it("no devolve row, no refusal row, no skip row, no prompt", () => {
    const before = armed(31, { stages: 0 });
    expect(body(before.players.p2.active).stack).toHaveLength(1);
    const { state, events } = strike(before, "p1", PICK);
    expect(types(events)).not.toContain("POKEMON_DEVOLVED");
    expect(types(events)).not.toContain("ATTACK_EFFECT_PREVENTED");
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(types(events)).not.toContain("SHUFFLE");
    expect(state.phase.kind).not.toBe("effect:choose");
  });

  it("`===` ON THE BODY — `parkOrForce`'s empty arm returns the state it was given", () => {
    const before = armed(31, { stages: 0 });
    const activeBefore = before.players.p2.active;
    const benchBefore = before.players.p2.bench;
    const { state } = strike(before, "p1", PICK);
    expect(state.players.p2.active).toBe(activeBefore);
    expect(state.players.p2.bench).toBe(benchBefore);
  });

  it("the no-effect control behaves the same — an absent sentence is not a gap", () => {
    const { events } = strike(armed(31, { stages: 1 }), "p1", PLAIN);
    expect(types(events)).not.toContain("POKEMON_DEVOLVED");
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — "the highest Stage Evolution card" is ONE card, not the whole stack.
// ─────────────────────────────────────────────────────────────────────────────
describe("§6 — a Stage 2 devolves to its Stage 1, NOT to its Basic", () => {
  it("the three-card stack becomes a TWO-card stack topped by the Stage 1", () => {
    const before = armed(41, { stages: 2 });
    expect(body(before.players.p2.active).stack).toHaveLength(3);
    const { state } = strike(before, "p1", PICK);
    const after = body(state.players.p2.active);
    expect(after.stack).toHaveLength(2);
    expect(idOf(state, must0(after.stack.slice(-1)))).toBe("d540-s1");
    expect(idOf(state, must0(after.stack))).toBe("d540-basic");
  });

  it("EXACTLY ONE card moved, and it is the Stage 2", () => {
    const before = armed(41, { stages: 2 });
    const stage2 = must0(body(before.players.p2.active).stack.slice(-1));
    const stage1 = must0(body(before.players.p2.active).stack.slice(-2, -1));
    const { state } = strike(before, "p1", PICK);
    expect(state.players.p2.hand).toContain(stage2);
    expect(state.players.p2.hand).not.toContain(stage1);
    expect(idOf(state, stage2)).toBe("d540-s2");
  });

  it("the survivor's HP is the STAGE 1's, which is what the KO check will read", () => {
    const { state } = strike(armed(41, { stages: 2, damage: 50 }), "p1", PICK);
    const after = body(state.players.p2.active);
    // 140 → 90: three distinct numbers in the chain, so this cannot be satisfied by
    // the wrong body.
    expect(POOL[idOf(state, must0(after.stack.slice(-1))) ?? ""]?.hp).toBe(90);
    expect(after.damage).toBe(50);
  });
});

describe("§7 — the KO by maximum, its cause, its Prize and its promotion", () => {
  it("a 100-damage Stage 2 dropping to a 90 HP Stage 1 is Knocked Out", () => {
    // No damage is dealt and no counter is placed: `isLethallyDamaged` is a
    // `damage >= effectiveMaxHp` STATE check and the maximum moved under it.
    const { state, events } = strike(armed(51, { stages: 2, damage: 100 }), "p1", PICK);
    expect(all(events, "DAMAGE_DEALT")).toHaveLength(0);
    expect(state.phase.kind).toBe("ko:takePrizes");
  });

  it("`lastKoMarks` records `byAttack: false` — the CAUSE is the maximum, not damage", () => {
    const { state } = strike(armed(51, { stages: 2, damage: 100 }), "p1", PICK);
    const marks = state.lastKoMarks.p2;
    expect(marks).toHaveLength(1);
    expect(marks[0]?.byAttack).toBe(false);
    expect(state.lastKoTurn.p2).toBe(state.turn);
  });

  it("a devolved SURVIVOR is never marked — the observable half of the same stamp", () => {
    const { state } = strike(armed(51, { stages: 2, damage: 80 }), "p1", PICK);
    expect(body(state.players.p2.active).markers).toEqual([]);
    expect(koByEffectMarker(state.turn)).not.toBe("");
  });

  it("THE CONTROL — 80 damage on the same board does NOT Knock Out", () => {
    const { state, events } = strike(armed(51, { stages: 2, damage: 80 }), "p1", PICK);
    expect(types(events)).not.toContain("KNOCKED_OUT");
    expect(state.phase.kind).not.toBe("ko:takePrizes");
    expect(body(state.players.p2.active).damage).toBe(80);
  });

  it("the Prize is owed to the ATTACKER and taken, then the victim promotes", () => {
    const { state } = strike(armed(52, { stages: 2, damage: 100 }), "p1", PICK);
    if (state.phase.kind !== "ko:takePrizes") throw new Error("expected ko:takePrizes");
    expect(state.phase.seat).toBe("p1");
    const settled = settle(state);
    expect(settled.players.p1.prizes.filter((p) => p !== null)).toHaveLength(5);
    expect(settled.players.p2.active).not.toBeNull();
  });

  it("the KO'd stack goes to the DISCARD — but the devolved card is in the HAND", () => {
    // The two zones on one board, which is the pin that a writer sending the shed card
    // to the discard alongside the corpse would fail.
    const before = armed(53, { stages: 2, damage: 100 });
    const stage2 = must0(body(before.players.p2.active).stack.slice(-1));
    const stage1 = must0(body(before.players.p2.active).stack.slice(-2, -1));
    const { state } = strike(before, "p1", PICK);
    const settled = settle(state);
    expect(settled.players.p2.hand).toContain(stage2);
    expect(settled.players.p2.discard).toContain(stage1);
    expect(settled.players.p2.discard).not.toContain(stage2);
  });

  it("a BENCHED body devolved into lethality is Knocked Out with no promotion", () => {
    const before = armed(54, { stages: 0, benchStages: 1, benchDamage: 70 });
    const { state } = strike(before, "p1", PICK);
    // 90 → 60 with 70 on it: lethal the instant the stack shortens.
    expect(state.phase.kind).toBe("ko:takePrizes");
    const settled = settle(state);
    expect(settled.players.p2.active).not.toBeNull();
    expect(body(settled.players.p2.active).stack).toHaveLength(1);
  });

  it("THE `wasLethal` CONJUNCT — an already-lethal body's KO IS 'by damage'", () => {
    const { state } = strike(armed(55, { stages: 2, damage: 100 }), "p1", BLOW);
    const marks = state.lastKoMarks.p2;
    expect(marks).toHaveLength(1);
    expect(marks[0]?.byAttack).toBe(true);
  });
});

describe("§8 — a Mist Energy holder is not OFFERED, and the rest still devolve", () => {
  it("the shielded BENCHED body is dropped from the candidate list", () => {
    const { state, events } = strike(
      armed(61, { stages: 1, benchStages: 1, shieldBench: true }),
      "p1",
      PICK,
    );
    // TWO evolved bodies, ONE shielded — so the offer has ONE candidate and
    // `parkOrForce` FORCES it. That is the observable shape of a FILTER rather than a
    // guard: the op still ran, on the body that was not shielded.
    expect(state.phase.kind).not.toBe("effect:choose");
    expect(find(events, "ATTACK_EFFECT_PREVENTED")).toBeDefined();
    expect(all(events, "POKEMON_DEVOLVED")).toHaveLength(1);
    expect(find(events, "POKEMON_DEVOLVED")?.seat).toBe("p2");
    expect(body(state.players.p2.bench[0]).stack).toHaveLength(2);
    expect(body(state.players.p2.active).stack).toHaveLength(1);
  });

  it("the shielded ACTIVE body is dropped from the candidate list", () => {
    const { state, events } = strike(
      armed(62, { stages: 1, benchStages: 1, shieldActive: true }),
      "p1",
      PICK,
    );
    expect(state.phase.kind).not.toBe("effect:choose");
    expect(find(events, "ATTACK_EFFECT_PREVENTED")).toBeDefined();
    expect(body(state.players.p2.active).stack).toHaveLength(2);
    expect(body(state.players.p2.bench[0]).stack).toHaveLength(1);
  });

  it("BOTH shielded — the op is a silent no-op with TWO refusals and no prompt", () => {
    const { state, events } = strike(
      armed(63, { stages: 1, benchStages: 1, shieldActive: true, shieldBench: true }),
      "p1",
      PICK,
    );
    expect(all(events, "ATTACK_EFFECT_PREVENTED")).toHaveLength(2);
    expect(types(events)).not.toContain("POKEMON_DEVOLVED");
    expect(state.phase.kind).not.toBe("effect:choose");
  });

  it("A SHIELDED BODY THAT IS NOT EVOLVED FILES NO REFUSAL AT ALL", () => {
    const { events } = strike(armed(64, { stages: 0, shieldActive: true }), "p1", PICK);
    expect(types(events)).not.toContain("ATTACK_EFFECT_PREVENTED");
    expect(types(events)).not.toContain("POKEMON_DEVOLVED");
  });

  it("THE ADMISSION CONTROL — the same board UNSHIELDED parks with both bodies", () => {
    const { state } = strike(armed(61, { stages: 1, benchStages: 1 }), "p1", PICK);
    expect(parked(state).candidates).toEqual([ACTIVE, BENCH0]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §9 — THE HAND-COUNT PUBLICATION RUNG.
// ─────────────────────────────────────────────────────────────────────────────
describe("§9 — the hand grows by exactly one, and the uid stays hidden", () => {
  it("+1 CARD IN HAND, with the victim's own draw controlled OUT", () => {
    const before = armed(71, { stages: 1, benchStages: 1 });
    const start = before.players.p2.hand.length;
    const control = strike(before, "p1", PLAIN).state.players.p2.hand.length;
    const devolvedTo = answer(strike(before, "p1", PICK).state, "p1", ACTIVE).state.players.p2.hand
      .length;
    expect(control).toBe(start + 1);
    expect(devolvedTo).toBe(control + 1);
  });

  it("the devolved uid is IN the victim's hand and in no other zone", () => {
    const before = armed(71, { stages: 1, benchStages: 1 });
    const top = must0(body(before.players.p2.active).stack.slice(-1));
    const { state } = answer(strike(before, "p1", PICK).state, "p1", ACTIVE);
    expect(state.players.p2.hand).toContain(top);
    expect(state.players.p2.deck).not.toContain(top);
    expect(state.players.p2.discard).not.toContain(top);
    expect(state.players.p2.prizes).not.toContain(top);
    expect(body(state.players.p2.active).stack).not.toContain(top);
  });

  it("THE UID NEVER APPEARS IN THE OPPONENT'S PROJECTION — only the COUNT moves", () => {
    const before = armed(72, { stages: 1, benchStages: 1 });
    const top = must0(body(before.players.p2.active).stack.slice(-1));
    const { state } = answer(strike(before, "p1", PICK).state, "p1", ACTIVE);
    const attackerView = redactGame(state, "p1");
    expect(JSON.stringify(attackerView)).not.toContain(top);
    expect(attackerView.board.opponent.hand.map((c) => c.id)).not.toContain(top);
    expect(attackerView.board.opponent.hand).toHaveLength(state.players.p2.hand.length);
    // …and the victim's OWN view does resolve it, which is the control that keeps the
    // rung above a statement about redaction rather than about an empty hand.
    expect(JSON.stringify(redactGame(state, "p2"))).toContain(top);
  });
});

describe("§10 — the persisted `pendingOp`, over the serialized bytes", () => {
  it('`"cont" in phase` IS TRUE and `pendingOp` IS the new inhabitant', () => {
    const { state } = strike(armed(81, { stages: 1, benchStages: 1 }), "p1", PICK);
    const phase = state.phase;
    if (phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect("cont" in phase).toBe(true);
    expect(parked(state).pendingOp).toEqual({ op: "devolveChosen" });
  });

  it("DIRECTION 1 — the parked op survives a JSON round trip and resolves", () => {
    // The whole board through `JSON.parse(JSON.stringify(...))`: what a `MatchRecord`
    // actually stores, rather than the in-memory object.
    const parkedState = strike(armed(81, { stages: 1, benchStages: 1 }), "p1", PICK).state;
    const bytes = JSON.stringify(parkedState);
    expect(bytes).toContain('"devolveChosen"');
    const revived = JSON.parse(bytes) as GameState;
    const { state, events } = answer(revived, "p1", BENCH0);
    expect(find(events, "POKEMON_DEVOLVED")?.zone).toBe("hand");
    expect(body(state.players.p2.bench[0]).stack).toHaveLength(1);
    expect(body(state.players.p2.active).stack).toHaveLength(2);
  });

  it("DIRECTION 2 — a v30 OP AT THE SAME ADDRESS STILL MEANS WHAT IT MEANT", () => {
    const start = armed(82, { stages: 1, benchStages: 1 });
    const stage1 = must0(body(start.players.p2.active).stack.slice(-1));
    const parkedState = strike(start, "p1", PICK).state;
    const bytes = JSON.stringify(parkedState);
    expect(bytes).toContain('{"op":"devolveChosen"}');
    const swapped = JSON.parse(
      bytes.replace('{"op":"devolveChosen"}', '{"op":"knockOutChosen","target":"opponentAny"}'),
    ) as GameState;
    const { state, events } = answer(swapped, "p1", ACTIVE);
    expect(types(events)).not.toContain("POKEMON_DEVOLVED");
    expect(state.phase.kind).toBe("ko:takePrizes");
    expect(state.players.p2.hand).not.toContain(stage1);
    expect(state.players.p2.discard).toContain(stage1);
  });

  it("THE FORCED BOARD PUTS NOTHING IN THE RECORD AT ALL — the carrier door", () => {
    const { state } = strike(armed(84, { stages: 1 }), "p1", PICK);
    expect("cont" in state.phase).toBe(false);
    expect(JSON.stringify(state)).not.toContain("devolveChosen");
  });

  it("nothing this slice adds is a REQUIRED field on a persisted structure", () => {
    const before = armed(83, { stages: 1 });
    const active = body(before.players.p2.active);
    expect(Object.keys(active)).toContain("stack");
    expect(Object.keys(active)).toContain("markers");
    expect(Object.keys(active)).toContain("evolvedTurn");
    const revived = JSON.parse(JSON.stringify(before)) as GameState;
    const live = strike(before, "p1", PICK);
    const replayed = strike(revived, "p1", PICK);
    expect(types(replayed.events)).toEqual(types(live.events));
    expect(replayed.state.players.p2.active).toEqual(live.state.players.p2.active);
    expect(replayed.state.players.p2.hand).toEqual(live.state.players.p2.hand);
  });
});

describe("§11 — the log row names the HAND, and the sweep's row still does not", () => {
  const ctx = (state: GameState): LogContext => ({
    names: { p1: "Ash", p2: "Gary" },
    state,
    elapsed: "+00:10",
  });

  /** The rendered action lines, `who|text` — `devolveEach.test.ts` §3's instrument. */
  function lines(state: GameState, events: GameEvent[]): string[] {
    return logFromEvents(events, ctx(state)).map((entry) =>
      entry.kind === "action"
        ? `${entry.who}|${entry.segments.map((seg) => seg.text).join("")}`
        : "",
    );
  }

  it("the row files under the ACTOR and names the destination HAND", () => {
    const before = armed(91, { stages: 1 });
    const { state, events } = strike(before, "p1", PICK);
    const rendered = lines(state, events).filter((line) => line.includes("devolved"));
    expect(rendered).toHaveLength(1);
    expect(rendered[0]).toBe("p1|devolved Gary's d540-s1 → d540-basic — to Gary's hand");
  });

  it("THE PAIR — the SWEEP's row names NO zone, byte-identically to before", () => {
    const before = armed(91, { stages: 1 });
    const { state, events } = strike(before, "p1", SWEEP);
    const rendered = lines(state, events).filter((line) => line.includes("devolved"));
    expect(rendered).toHaveLength(1);
    expect(rendered[0]).toBe("p1|devolved Gary's d540-s1 → d540-basic");
    expect(rendered[0]).not.toContain("hand");
    expect(find(events, "POKEMON_DEVOLVED")?.zone).toBeUndefined();
  });

  it("the §12 Special Condition clear is announced with reason 'devolved'", () => {
    // Asleep on the victim's Active, then devolved: the shed is `devolvedBodyOf`'s and
    // the announcement is the writer's.
    const before = armed(92, { stages: 1 });
    const asleep: GameState = {
      ...before,
      players: {
        ...before.players,
        p2: {
          ...before.players.p2,
          active: {
            ...body(before.players.p2.active),
            conditions: { ...body(before.players.p2.active).conditions, rotation: "asleep" },
          },
        },
      },
    };
    const { events } = strike(asleep, "p1", PICK);
    const cleared = find(events, "STATUS_CLEARED");
    expect(cleared?.reason).toBe("devolved");
    expect(cleared?.statuses).toContain("asleep");
  });

  it("a board with NOTHING to clear emits no STATUS_CLEARED at all", () => {
    const { events } = strike(armed(92, { stages: 1 }), "p1", PICK);
    expect(types(events)).not.toContain("STATUS_CLEARED");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §12 — PURITY, and the damage arm on one board with the pick.
// ─────────────────────────────────────────────────────────────────────────────
describe("§12 — the op is a pure reduction", () => {
  it("a DEEP-FROZEN board devolves without throwing", () => {
    const before = deepFreeze(armed(101, { stages: 1, benchStages: 1 }));
    const { state } = strike(before, "p1", PICK);
    const { state: done } = answer(state, "p1", ACTIVE);
    expect(body(done.players.p2.active).stack).toHaveLength(1);
  });

  it("THE PAIR — the ORIGINAL board is byte-identical afterwards", () => {
    const before = armed(101, { stages: 1, benchStages: 1 });
    const snapshot = JSON.stringify(before);
    const { state } = strike(before, "p1", PICK);
    answer(state, "p1", BENCH0);
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it("DAMAGE AND THE PICK ON ONE BOARD — the 60 lands and the stack still shortens", () => {
    const before = armed(102, { stages: 1, benchStages: 1 });
    const { state: waiting, events: hit } = strike(before, "p1", BLOW);
    // The damage step runs BEFORE the program parks, so the 60 is already on the board
    // while the prompt is open.
    expect(find(hit, "DAMAGE_DEALT")?.damage).toBe(60);
    expect(body(waiting.players.p2.active).damage).toBe(60);
    const { state } = answer(waiting, "p1", ACTIVE);
    // 90 HP Stage 1 → 60 HP Basic with 60 on it: lethal the instant the stack shortens.
    expect(state.phase.kind).toBe("ko:takePrizes");
  });
});

/** A total `[0]`/`at(-1)` read: `noUncheckedIndexedAccess` is on, and a rung that
    silently compared `undefined` to `undefined` would be green for the wrong reason. */
function must0<T>(items: readonly (T | undefined)[]): T {
  const first = items[0];
  if (first === undefined) throw new Error("expected a value");
  return first;
}
