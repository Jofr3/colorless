import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import type { EffectOp } from "./effectTypes";
import {
  deriveAttackEffect,
  splitAttackGateClause,
  splitAttackRequirementClause,
  splitAttackTrailingClause,
  timingGateFromAttackText,
} from "./effects";
import { applyAction, attackGateOf } from "./index";
import { programFor, registryCardIds } from "./registry";
import type { GameEvent, GameState, PokemonRef, Seat } from "./index";
import { shuffle } from "./rng";
import {
  FIXTURE_POOL,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  setActiveFromDeck,
  must,
  activeOf,
  driveSetup,
  roundTrip,
} from "./testFixtures";
import { stackUids } from "./types";

const PRINTED =
  "Choose 2 of your opponent's Benched Pokémon. Shuffle those Pokémon and all attached cards into your opponent's deck. If 1 of your Pokémon used Angelite during your last turn, this attack can't be used.";

const CLAUSE =
  "If 1 of your Pokémon used Angelite during your last turn, this attack can't be used.";

const BODY =
  "Choose 2 of your opponent's Benched Pokémon. Shuffle those Pokémon and all attached cards into your opponent's deck.";

const KEEP_SENTENCE =
  "Choose 3 of your opponent's Benched Pokémon. If you do, shuffle all of your opponent's Benched Pokémon that you didn't choose, and all cards attached to those Pokémon, into their deck.";

/** The other near miss that shares this opening — `COUNTER_PUT_ON_CHOSEN_OPPONENTS`. */
const COUNTER_SENTENCE =
  "Choose 2 of your opponent's Pokémon and put 3 damage counters on each of them.";

/** The head the two bench anchors SHARE, byte for byte. */
const SHARED_HEAD = "Choose 2 of your opponent's Benched Pokémon.";

/** The tail `CHOOSE_SHUFFLE_CHOSEN` requires. */
const CHOSEN_TAIL = "Shuffle those Pokémon and all attached cards into your opponent's deck.";

const PROGRAM: EffectOp[] = [{ op: "returnBenchedChosen", count: 2 }];

/** The printed prompt caption, pinned byte for byte in §9. */
const NOTE = "Choose 2 of your opponent's Benched Pokémon to shuffle into their deck.";

const SYLVEON_IDS = ["sv08-086", "sv08.5-041", "sv08.5-156"] as const;

const CHARMER = "d541-sylveon";
const WALL = "d541-wall";
const B1 = "d541-b1";
const B2 = "d541-b2";
const B3 = "d541-b3";
const B4 = "d541-b4";
const B5 = "d541-b5";
const STAGE1 = "d541-stage1";
/** The BENCH-GATED §11 shield — Poltchageist "Curious Tea Party"
    (`preventDamageAndEffectsWhileBenched`), the one prevent in this pool that fires
    on a BENCHED body and therefore the only one this op can meet. */
const TEAPARTY = "fix-teaparty";
const TOOL = "fix-tool";
const ENERGY = "fix-energy";

const bencher = (id: string, name: string, hp: number): Card =>
  battler(id, {
    name,
    hp,
    retreat: 1,
    types: ["Colorless"],
    attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
  });

const LOCAL_CARDS: Record<string, Card> = {
  [CHARMER]: battler(CHARMER, {
    name: "D541 Charmer",
    hp: 270,
    retreat: 1,
    types: ["Colorless"],
    attacks: [
      { cost: ["Colorless"], name: "Angelite", effect: PRINTED },
      { cost: ["Colorless"], name: "Plain Tap", damage: 10 },
    ],
  }),
  [WALL]: bencher(WALL, "D541 Wall", 330),
  [B1]: bencher(B1, "D541 B1", 200),
  [B2]: bencher(B2, "D541 B2", 200),
  [B3]: bencher(B3, "D541 B3", 200),
  [B4]: bencher(B4, "D541 B4", 200),
  [B5]: bencher(B5, "D541 B5", 200),
  [STAGE1]: battler(STAGE1, {
    name: "D541 Stage 1",
    hp: 140,
    retreat: 1,
    stage: "Stage 1",
    evolveFrom: "D541 B2",
    types: ["Colorless"],
    attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
  }),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const DECK = deckOf({
  [CHARMER]: 4,
  [WALL]: 4,
  [B1]: 4,
  [B2]: 4,
  [B3]: 4,
  [B4]: 4,
  [B5]: 4,
  [STAGE1]: 2,
  [TEAPARTY]: 4,
  [TOOL]: 2,
  [ENERGY]: 24,
});

function localSetup(seed: number): GameState {
  return driveSetup(seed, { p1: DECK, p2: DECK }, { pool: POOL, first: "p2" });
}

/** TEST SURGERY — attach one `cardId` off `seat`'s deck onto the benched body at
    `index`, as ENERGY or as a TOOL. */
function attachToBench(
  state: GameState,
  seat: Seat,
  index: number,
  cardId: string,
  as: "energy" | "tools",
): GameState {
  const side = state.players[seat];
  const body = side.bench[index];
  if (body === undefined) throw new Error(`${seat} has no bench[${index}]`);
  const uid = side.deck.find((u) => state.cardIdByUid[u] === cardId);
  if (uid === undefined) throw new Error(`${seat}'s deck lacks ${cardId}`);
  const grown = { ...body, [as]: [...body[as], uid] };
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: {
        ...side,
        bench: [...side.bench.slice(0, index), grown, ...side.bench.slice(index + 1)],
        deck: side.deck.filter((u) => u !== uid),
      },
    },
  };
}

/** TEST SURGERY — push one `cardId` UNDER the benched body at `index`. */
function underBench(state: GameState, seat: Seat, index: number, cardId: string): GameState {
  const side = state.players[seat];
  const body = side.bench[index];
  if (body === undefined) throw new Error(`${seat} has no bench[${index}]`);
  const uid = side.deck.find((u) => state.cardIdByUid[u] === cardId);
  if (uid === undefined) throw new Error(`${seat}'s deck lacks ${cardId}`);
  const grown = { ...body, stack: [uid, ...body.stack] };
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: {
        ...side,
        bench: [...side.bench.slice(0, index), grown, ...side.bench.slice(index + 1)],
        deck: side.deck.filter((u) => u !== uid),
      },
    },
  };
}

/** TEST SURGERY — attach `count` copies of `fix-energy` onto `seat`'s Active. */
function fuel(state: GameState, seat: Seat, count: number): GameState {
  let next = state;
  for (let i = 0; i < count; i++) {
    const side = next.players[seat];
    const body = side.active;
    if (body === null) throw new Error(`${seat} has no Active`);
    const uid = side.deck.find((u) => next.cardIdByUid[u] === ENERGY);
    if (uid === undefined) throw new Error(`${seat}'s deck lacks ${ENERGY}`);
    next = {
      ...next,
      players: {
        ...next.players,
        [seat]: {
          ...side,
          active: { ...body, energy: [...body.energy, uid] },
          deck: side.deck.filter((u) => u !== uid),
        },
      },
    };
  }
  return next;
}

function board(seed: number, bench: readonly string[]): GameState {
  let state = localSetup(seed);
  state = setActiveFromDeck(state, "p2", WALL);
  state = clearBench(state, "p2");
  for (const id of bench) state = benchFromDeck(state, "p2", id);
  state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
  state = setActiveFromDeck(state, "p1", CHARMER);
  state = clearBench(state, "p1");
  state = benchFromDeck(state, "p1", B1);
  return fuel(state, "p1", 1);
}

function attack(state: GameState, index = 0): { state: GameState; events: readonly GameEvent[] } {
  const result = applyAction(state, { type: "attack", seat: "p1", index });
  if (!result.ok) throw new Error(`attack failed: ${result.error.code} ${result.error.message}`);
  return { state: result.state, events: result.events };
}

function answer(
  state: GameState,
  refs: readonly PokemonRef[],
): { state: GameState; events: readonly GameEvent[] } {
  const result = applyAction(state, {
    type: "resolveEffect",
    seat: "p1",
    choice: { kind: "pokemonMulti", refs: [...refs] },
  });
  if (!result.ok) throw new Error(`answer refused: ${result.error.code} ${result.error.message}`);
  return { state: result.state, events: result.events };
}

const SEED = 541;
const SEEDS = [541, 557, 563, 569] as const;
const benchIds = (state: GameState, seat: Seat): string[] =>
  state.players[seat].bench.map((b) => state.cardIdByUid[b.stack[b.stack.length - 1] ?? ""] ?? "?");
const benchRef = (index: number): PokemonRef => ({ seat: "p2", spot: { spot: "bench", index } });
const rows = (events: readonly GameEvent[], type: string) => events.filter((e) => e.type === type);
const libraryOf = (state: GameState, seat: Seat): string[] => [
  ...state.players[seat].deck,
  ...state.players[seat].hand,
];
function bodyAt(state: GameState, seat: Seat, index: number) {
  const body = state.players[seat].bench[index];
  if (body === undefined) throw new Error(`no ${seat} bench[${index}]`);
  return body;
}

function parkedPrompt(state: GameState) {
  if (state.phase.kind !== "effect:choose") throw new Error(`not parked: ${state.phase.kind}`);
  const prompt = state.phase.prompt;
  if (prompt.kind !== "choosePokemonMulti") throw new Error(`wrong prompt: ${prompt.kind}`);
  return prompt;
}

/** Wind the clock until it is `seat`'s turn again, ending turns and nothing else. */
function untilTurnOf(state: GameState, seat: Seat, guard = 12): GameState {
  let next = state;
  for (let i = 0; i < guard; i++) {
    if (next.phase.kind === "turn:action" && next.phase.seat === seat) return next;
    const phase = next.phase;
    if (phase.kind !== "turn:action") throw new Error(`stuck in ${phase.kind}`);
    next = must(applyAction(next, { type: "endTurn", seat: phase.seat }));
  }
  throw new Error(`never reached ${seat}'s turn`);
}

// ─────────────────────────────────────────────────────────────────────────────
// §1 — THE READING: the anchor claims the STRIPPED BODY and nothing else.
// ─────────────────────────────────────────────────────────────────────────────

describe("D541 §1 — the anchor claims the STRIPPED body, and refuses the row, the clause and both near misses", () => {
  it("the row is READ off the census by index and by units, never retyped (D183/D456)", () => {
    const corpus = legalAttackCorpus();
    const row = corpus[29];
    expect(row?.[1]).toBe(PRINTED);
    expect(row?.[0]).toBe(3);
    expect(corpus.filter(([, t]) => t === PRINTED)).toHaveLength(1);
  });

  it("the PRINTED row is claimed by no reader whole, and the STRIPPED body is claimed by one", () => {
    expect(resolvedByAnyReader(PRINTED)).toBe(false);
    expect(deriveAttackEffect(PRINTED)).toBeNull();
    expect(resolvedByAnyReader(BODY)).toBe(true);
    expect(deriveAttackEffect(BODY)).toEqual(PROGRAM);
  });

  it("the CLAUSE alone derives NOTHING — it is a gate, not a program", () => {
    expect(deriveAttackEffect(CLAUSE)).toBeNull();
    expect(resolvedByAnyReader(CLAUSE)).toBe(false);
    expect(splitAttackGateClause(CLAUSE)).toEqual({ clause: CLAUSE, body: "" });
  });

  it("THE UNPREFIXED CONTROL (D424): the body alone is what the anchor is about", () => {
    // Without this the two refusals below are green on a build whose anchor matches
    // nothing at all.
    expect(deriveAttackEffect(BODY)).toEqual(PROGRAM);
  });

  it("THE CARET KILLER, and it KEEPS the leading capital (D539(1a))", () => {
    // A prefix that lowercases or rewrites the body's first word would be refused by
    // the WORD and not by the `^`. This one leaves "Choose" capitalised and intact,
    // so the ONLY thing refusing it is the anchor's own `^`.
    expect(deriveAttackEffect(`Draw a card. ${BODY}`)).toBeNull();
    expect(resolvedByAnyReader(`Draw a card. ${BODY}`)).toBe(false);
  });

  it("THE TERMINATOR KILLER, and it KEEPS the period (D540(1a))", () => {
    expect(BODY.endsWith(".")).toBe(true);
    expect(deriveAttackEffect(`${BODY} Then, draw a card.`)).toBeNull();
    expect(resolvedByAnyReader(`${BODY} Then, draw a card.`)).toBe(false);
  });

  it("THE NUMBER IS CAPTURED, not a literal 2 — and it is the number REMOVED", () => {
    expect(deriveAttackEffect(BODY.replace("Choose 2", "Choose 3"))).toEqual([
      { op: "returnBenchedChosen", count: 3 },
    ]);
    expect(deriveAttackEffect(BODY.replace("Choose 2", "Choose 1"))).toEqual([
      { op: "returnBenchedChosen", count: 1 },
    ]);
    // THE FLOOR, printed rather than defensive: "Choose 0" names no pick at all, so
    // the arm declines and the sentence goes to the loud path.
    expect(deriveAttackEffect(BODY.replace("Choose 2", "Choose 0"))).toBeNull();
  });

  it("THE TWO NEAR MISSES, BOTH DIRECTIONS — the inversion and the counter placement", () => {
    expect(deriveAttackEffect(KEEP_SENTENCE)).toEqual([{ op: "returnBenchedRest", keep: 3 }]);
    // ② …and the other direction: this anchor does not claim that sentence, and that
    //    is what the arm ORDER would otherwise hide (see the composed cell below).
    // ③ `COUNTER_PUT_ON_CHOSEN_OPPONENTS` — the same opening, a different tail.
    expect(deriveAttackEffect(COUNTER_SENTENCE)).toEqual([
      { op: "damageChosen", target: "opponentAny", amount: 30, count: 2, source: "attack" },
    ]);
    expect(COUNTER_SENTENCE.startsWith("Choose 2 of your opponent's ")).toBe(true);
  });

  it("THE 2×2 MATRIX, WITH THE ONE CELL ARM ORDER MASKS NAMED AS COMPOSED (D540)", () => {
    expect(deriveAttackEffect(KEEP_SENTENCE)).toEqual([{ op: "returnBenchedRest", keep: 3 }]);
    // (2) THIS sentence → 42-ter's op. Direct — AND it also settles "does 42-bis
    //     claim this body?" in the NEGATIVE, because 42-bis runs first and did not
    //     return.
    expect(deriveAttackEffect(BODY)).toEqual(PROGRAM);
    // (3) Either sentence with its own tail removed → null. Direct.
    expect(deriveAttackEffect(SHARED_HEAD)).toBeNull();
    const WRONG_TAIL = `${SHARED_HEAD} Shuffle those Pokémon and all attached cards into their deck.`;
    expect(deriveAttackEffect(WRONG_TAIL)).toBeNull();
    //       (b) …and 42-bis's sentence does not CONTAIN that tail at all.
    expect(KEEP_SENTENCE.includes(CHOSEN_TAIL)).toBe(false);
    //     (a) ∧ (b) ⟹ the masked cell is `null`. Stated as a composition, not as a
    //     measurement, because that is what it is.
  });

  it("BOTH `['’]` SLOTS, ONE AT A TIME AND BOTH TOGETHER — the rows that survive otherwise", () => {
    const curl = (s: string, which: 1 | 2 | "both"): string => {
      const parts = s.split("'");
      if (parts.length !== 3) throw new Error(`expected 2 apostrophes, got ${parts.length - 1}`);
      const [a, b, c] = parts as [string, string, string];
      if (which === 1) return `${a}’${b}'${c}`;
      if (which === 2) return `${a}'${b}’${c}`;
      return `${a}’${b}’${c}`;
    };
    expect(deriveAttackEffect(curl(BODY, 1))).toEqual(PROGRAM);
    expect(deriveAttackEffect(curl(BODY, 2))).toEqual(PROGRAM);
    expect(deriveAttackEffect(curl(BODY, "both"))).toEqual(PROGRAM);
    // …and the straight form still works, so the class is a CLASS and not a swap.
    expect(deriveAttackEffect(BODY)).toEqual(PROGRAM);
  });

  it("THE CONTROL FOR THOSE SLOTS READS THE LIVE CORPUS ROW, not this file's constant", () => {
    const row = legalAttackCorpus()[29]?.[1] ?? "";
    const straight = [...row].flatMap((ch, i) => (ch === "'" ? [i] : []));
    const curled = [...row].flatMap((ch, i) => (ch === "’" ? [i] : []));
    // Three straight apostrophes: two possessives in the BODY and the "can't" inside
    // the trailing clause. Zero curled ones.
    expect(straight).toEqual([25, 108, 190]);
    expect(curled).toEqual([]);
    // …and the three `é` are single real U+00E9, NOT decomposed (the other half of
    // the same measurement).
    expect([...row].flatMap((ch, i) => (ch === "é" ? [i] : []))).toEqual([39, 62, 133]);
    expect(row.includes("́")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — THE SPLITTER: the trailing branch, the leading population, the tripwire.
// ─────────────────────────────────────────────────────────────────────────────

describe("D541 §2 — the TRAILING branch claims exactly this row, and the leading branch still claims its 14 ( D545 → 16)", () => {
  it("the trailing branch claims THIS row and hands back the body", () => {
    expect(splitAttackGateClause(PRINTED)).toEqual({ clause: CLAUSE, body: BODY });
    expect(`${BODY} ${CLAUSE}`).toBe(legalAttackCorpus()[29]?.[1]);
  });

  it("THE SPLIT IS IDEMPOTENT — the body it returns carries no clause of its own", () => {
    expect(splitAttackGateClause(BODY)).toBeNull();
  });

  it("the split claims 7 sentences / 17 printings ( D545 → 9 / 19), of which the TRAILING branch is 1 / 3", () => {
    const corpus = legalAttackCorpus();
    const gated = corpus.filter(([, t]) => splitAttackGateClause(t) !== null);
    expect(gated).toHaveLength(9);
    expect(gated.reduce((sum, [n]) => sum + n, 0)).toBe(19);
    const trailing = gated.filter(([, t]) => {
      const split = splitAttackGateClause(t);
      return split !== null && split.body !== "" && t.trim().endsWith(split.clause);
    });
    expect(trailing).toHaveLength(1);
    expect(trailing.reduce((sum, [n]) => sum + n, 0)).toBe(3);
    expect(trailing[0]?.[1]).toBe(PRINTED);
    const leading = gated.filter(([, t]) => {
      const split = splitAttackGateClause(t);
      return split !== null && (split.body === "" || t.trim().startsWith(split.clause));
    });
    expect(leading).toHaveLength(8);
    expect(leading.reduce((sum, [n]) => sum + n, 0)).toBe(16);
    expect(trailing.length + leading.length).toBe(gated.length);
  });

  it("THE LEADING-AND-TRAILING TRIPWIRE — a string matching at both ends is REFUSED", () => {
    const LEADING = "If you go second, you can't use this attack during your first turn.";
    expect(splitAttackGateClause(`${LEADING} ${BODY}`)).toEqual({
      clause: LEADING,
      body: BODY,
    });
    // ① the SAME clause at both ends;
    expect(splitAttackGateClause(`${LEADING} ${BODY} ${LEADING}`)).toBeNull();
    // ② …and, the case a per-clause tripwire would miss, TWO DIFFERENT clauses.
    expect(splitAttackGateClause(`${LEADING} ${BODY} ${CLAUSE}`)).toBeNull();
    expect(splitAttackGateClause(`${CLAUSE} ${BODY} ${LEADING}`)).toBeNull();
    // ③ THE ATTRIBUTION CONTROL: each half alone still splits, so the three `null`s
    //    above are about the COMBINATION and not about a broken splitter.
    expect(splitAttackGateClause(`${BODY} ${CLAUSE}`)).toEqual({ clause: CLAUSE, body: BODY });
    expect(splitAttackGateClause(`${BODY}${CLAUSE}`)).toBeNull();
  });

  it("…and no printed string in the corpus trips it — measured, not assumed", () => {
    for (const [, text] of legalAttackCorpus()) {
      const split = splitAttackGateClause(text);
      if (split === null) continue;
      expect(split.body.includes(split.clause), text).toBe(false);
    }
  });

  it("DISJOINTNESS AGAINST THE OTHER TWO STRIPPERS, DRIVEN AND NOT QUOTED", () => {
    const corpus = legalAttackCorpus();
    const gate = corpus.filter(([, t]) => splitAttackGateClause(t) !== null);
    const req = corpus.filter(([, t]) => splitAttackRequirementClause(t) !== null);
    const trail = corpus.filter(([, t]) => splitAttackTrailingClause(t) !== null);
    expect(req).toHaveLength(1);
    expect(req.reduce((sum, [n]) => sum + n, 0)).toBe(2);
    expect(trail).toHaveLength(12);
    expect(trail.reduce((sum, [n]) => sum + n, 0)).toBe(22);
    const both = (
      a: readonly (readonly [number, string])[],
      b: readonly (readonly [number, string])[],
    ) => a.filter(([, t]) => b.some(([, u]) => u === t));
    expect(both(gate, req)).toHaveLength(0);
    expect(both(gate, trail)).toHaveLength(0);
    // THE ATTRIBUTION CONTROL: the three sets are non-empty, so three zeroes above
    // are not three empty filters.
    expect(gate.length * req.length * trail.length).toBeGreaterThan(0);
  });

  it("§1's 16-PARTITION IS UNMOVED BY CONSTRUCTION — CHECKED, not assumed (D540)", () => {
    expect(PRINTED.startsWith("If ")).toBe(false);
    const ifOpen = legalAttackCorpus().filter(([, t]) => t.startsWith("If ") && t.includes(". "));
    expect(ifOpen).toHaveLength(8);
    expect(ifOpen.reduce((sum, [n]) => sum + n, 0)).toBe(16);
  });
});

describe("D541 §3 — the census arithmetic, and the two figures that must NOT move", () => {
  const corpus = () => legalAttackCorpus();
  const units = (r: readonly (readonly [number, string])[]) => r.reduce((sum, [n]) => sum + n, 0);

  it("the GATE arm steps 6/14 → 7/17 ( D545 → 9/19) and this row is IN it", () => {
    const gate = corpus().filter(([, t]) => {
      const split = splitAttackGateClause(t);
      return split !== null && (split.body === "" || resolvedByAnyReader(split.body));
    });
    expect(gate).toHaveLength(9);
    expect(units(gate)).toBe(19);
    expect(gate.some(([, t]) => t === PRINTED)).toBe(true);
  });

  it("D541's ROW moved NEITHER the reader arm nor the raw residue — the case for the split route", () => {
    expect(resolvedByAnyReader(PRINTED)).toBe(false);
    expect(splitAttackGateClause(PRINTED)).not.toBeNull();
  });

  it("the RESIDUE steps 48/67 → 47/64 → 46/63, and `BUILT.attack` 1665 → 1668 → 1669 ( D545: at this head 42/57 and 1675 — the chain in this title was last stepped at D541)", () => {
    const residue = corpus().filter(([, text]) => {
      if (!resolvedByAnyReader(text)) {
        const gate = splitAttackGateClause(text);
        if (gate !== null && (gate.body === "" || resolvedByAnyReader(gate.body))) return false;
        return splitAttackTrailingClause(text) === null;
      }
      return false;
    });
    expect(residue).toHaveLength(19);
    expect(units(residue)).toBe(28);
  });

  it("the TRAILING-COMPOUND summand is UNMOVED at 11/21", () => {
    const trail = corpus().filter(([, t]) => splitAttackTrailingClause(t) !== null);
    expect([trail.length, units(trail)]).toEqual([12, 22]);
  });
});

describe("D541 §4 — the answer names the bodies that LEAVE, and they reach the victim's deck", () => {
  it("the park asks for EXACTLY 2, is NOT declinable, and offers the opponent's whole Bench", () => {
    const { state } = attack(board(SEED, [B1, B2, B3, B4]));
    const prompt = parkedPrompt(state);
    expect(prompt.min).toBe(2);
    expect(prompt.max).toBe(2);
    expect(prompt.declinable).toBe(false);
    expect(prompt.candidates).toHaveLength(4);
    expect(prompt.candidates.every((c) => c.seat === "p2" && c.spot.spot === "bench")).toBe(true);
    expect(prompt.note).toBe(NOTE);
    // NO `decider`: the CONTROLLER answers a pick on the other board (§9.4).
    if (state.phase.kind !== "effect:choose") throw new Error("expected a park");
    expect(state.phase.seat).toBe("p1");
  });

  it("BOTH bodies and ALL their attached cards reach the VICTIM'S deck — never the actor's", () => {
    let start = board(SEED, [B1, B2, B3]);
    start = attachToBench(start, "p2", 0, ENERGY, "energy");
    start = attachToBench(start, "p2", 0, TOOL, "tools");
    start = underBench(start, "p2", 1, STAGE1);
    const parked = attack(start).state;
    const leaving = [0, 1].flatMap((i) => stackUids(bodyAt(parked, "p2", i)));
    expect(leaving).toHaveLength(5); // 2 bodies + 1 Energy + 1 Tool + 1 buried card
    const p1Library = libraryOf(parked, "p1");
    const { state } = answer(parked, [benchRef(0), benchRef(1)]);
    for (const uid of leaving) expect(libraryOf(state, "p2"), uid).toContain(uid);
    // …and NOTHING reached the actor's own library or anyone's discard.
    expect(libraryOf(state, "p1")).toEqual(
      expect.arrayContaining(p1Library.filter((u) => !leaving.includes(u))),
    );
    for (const uid of leaving) expect(libraryOf(state, "p1")).not.toContain(uid);
    expect(state.players.p2.discard).toHaveLength(0);
    expect(benchIds(state, "p2")).toEqual([B3]);
  });

  it("THE NON-ADJACENT PAIR — the board an ASCENDING splice gets wrong", () => {
    // Pick {0,2} on a 4-bench: removing index 0 first compacts the bench, and index 2
    // then names B4 rather than B3. `benchKeepShuffleRest.test.ts` §5's precedent,
    // driven here on the ANSWER rather than on the complement.
    const parked = attack(board(SEED, [B1, B2, B3, B4])).state;
    const { state, events } = answer(parked, [benchRef(0), benchRef(2)]);
    expect(benchIds(state, "p2")).toEqual([B2, B4]);
    expect(
      rows(events, "POKEMON_RETURNED").map((e) => state.cardIdByUid[(e as { uid: string }).uid]),
    ).toEqual([B1, B3]);
  });

  it("…and the ADJACENT-FROM-THE-FRONT pair {0,1}, the other half of the same defect", () => {
    // A loop over the shipped `returnBenched` removes A, the bench compacts, and
    // index 1 then removes C rather than B — SILENTLY, under a correct-looking event.
    const parked = attack(board(SEED, [B1, B2, B3, B4])).state;
    const { state } = answer(parked, [benchRef(0), benchRef(1)]);
    expect(benchIds(state, "p2")).toEqual([B3, B4]);
  });

  it("…and the TAIL pair {1,3}, where an ascending splice reads `undefined` and one body SURVIVES", () => {
    const parked = attack(board(SEED, [B1, B2, B3, B4])).state;
    const { state, events } = answer(parked, [benchRef(1), benchRef(3)]);
    expect(benchIds(state, "p2")).toEqual([B1, B3]);
    expect(rows(events, "POKEMON_RETURNED")).toHaveLength(2);
  });

  it("EXACTLY ONE `SHUFFLE` row naming the OWNER, and ONE `POKEMON_RETURNED` per body in BOARD order", () => {
    // A loop over `returnBenched` would file TWO SHUFFLE rows and take TWO RNG draws
    // for ONE printed shuffle: the right board with the wrong log.
    const parked = attack(board(SEED, [B1, B2, B3, B4])).state;
    const { state, events } = answer(parked, [benchRef(2), benchRef(0)]);
    expect(rows(events, "SHUFFLE")).toHaveLength(1);
    expect(rows(events, "SHUFFLE").map((e) => (e as { seat: Seat }).seat)).toEqual(["p2"]);
    const returned = rows(events, "POKEMON_RETURNED");
    expect(returned).toHaveLength(2);
    expect(returned.map((e) => state.cardIdByUid[(e as { uid: string }).uid])).toEqual([B1, B3]);
    expect(returned.map((e) => (e as { dest: string }).dest)).toEqual(["deck", "deck"]);
    expect(returned.map((e) => (e as { seat: Seat }).seat)).toEqual(["p2", "p2"]);
    expect(returned.map((e) => (e as { actor: Seat }).actor)).toEqual(["p1", "p1"]);
  });

  it("EXACTLY ONE RNG DRAW — the `rngState` is the ONE shuffle's, computed rather than remembered", () => {
    const parked = attack(board(SEED, [B1, B2, B3, B4])).state;
    const leaving = [0, 1].flatMap((i) => stackUids(bodyAt(parked, "p2", i)));
    const expected = shuffle([...parked.players.p2.deck, ...leaving], parked.rngState)[1];
    const { state } = answer(parked, [benchRef(0), benchRef(1)]);
    // Fisher–Yates consumes `n − 1` draws, so two shuffles of two smaller piles land
    // on a DIFFERENT state than one shuffle of the whole pile. This is the rung a
    // per-ref shuffle cannot pass even where the board happens to agree.
    expect(state.rngState).toBe(expected);
  });

  it("A PLAYER'S CLICK ORDER IS NOT A GAME FACT — the same picks answered both ways give ONE board", () => {
    const parked = attack(board(SEED, [B1, B2, B3, B4])).state;
    const forwards = answer(parked, [benchRef(0), benchRef(2)]);
    const backwards = answer(parked, [benchRef(2), benchRef(0)]);
    expect(backwards.state.rngState).toBe(forwards.state.rngState);
    expect(JSON.stringify(backwards.state)).toBe(JSON.stringify(forwards.state));
    expect(JSON.stringify(backwards.events)).toBe(JSON.stringify(forwards.events));
  });

  it("§8.6 CLAMPS AND DOES NOT CANCEL — a bench SHORTER than the printed number shuffles what is there", () => {
    const one = attack(board(SEED, [B1]));
    expect(one.state.phase.kind).toBe("effect:choose");
    const prompt = parkedPrompt(one.state);
    expect(prompt.candidates).toHaveLength(1);
    // CLAMPED, not widened: a short board asks for FEWER, never for "up to".
    expect(prompt.min).toBe(1);
    expect(prompt.max).toBe(1);
    expect(prompt.declinable).toBe(false);
    // …and the answer really moves that body, whole, into the VICTIM's library.
    const leaving = stackUids(bodyAt(one.state, "p2", 0));
    const { state, events } = answer(one.state, [benchRef(0)]);
    expect(benchIds(state, "p2")).toEqual([]);
    for (const uid of leaving) expect(libraryOf(state, "p2")).toContain(uid);
    expect(rows(events, "SHUFFLE")).toHaveLength(1);
    expect(rows(events, "POKEMON_RETURNED")).toHaveLength(1);
  });

  it("…and the clamp is a CEILING and not a floor — bench 2, 3 and 4 all ask for exactly 2", () => {
    for (const bench of [
      [B1, B2],
      [B1, B2, B3],
      [B1, B2, B3, B4],
    ] as const) {
      const state = attack(board(SEED, [...bench])).state;
      const prompt = parkedPrompt(state);
      expect(prompt.candidates, `bench ${bench.length}`).toHaveLength(bench.length);
      expect([prompt.min, prompt.max], `bench ${bench.length}`).toEqual([2, 2]);
    }
    // BENCH EXACTLY 2 — the board `returnBenchedRest`'s `<= keep` comparator would
    // silently skip, and the board on which this op does the MOST work.
    const two = attack(board(SEED, [B1, B2])).state;
    const { state: emptied } = answer(two, [benchRef(0), benchRef(1)]);
    expect(benchIds(emptied, "p2")).toEqual([]);
  });

  it("ZERO candidates is the ONLY board that does not park — and it is a NO-OP, not an empty shuffle", () => {
    const start = board(SEED, []);
    const { state, events } = attack(start);
    expect(state.phase.kind).not.toBe("effect:choose");
    expect(benchIds(state, "p2")).toEqual([]);
    expect(rows(events, "SHUFFLE")).toHaveLength(0);
    expect(rows(events, "POKEMON_RETURNED")).toHaveLength(0);
    expect(state.rngState).toBe(start.rngState);
  });

  it("no §8.1 promotion is owed — a bench-only op leaves the Active alone", () => {
    const parked = attack(board(SEED, [B1, B2, B3])).state;
    const activeUid = parked.players.p2.active?.stack[0];
    const { state, events } = answer(parked, [benchRef(0), benchRef(1)]);
    expect(state.players.p2.active?.stack[0]).toBe(activeUid);
    expect(rows(events, "KNOCKED_OUT")).toHaveLength(0);
    expect(state.pending.filter((p) => p.kind === "promote")).toHaveLength(0);
  });

  it("THE CONTROL INDEX: 'Plain Tap' on the same body parks nothing and moves no bench", () => {
    const start = board(SEED, [B1, B2, B3]);
    const { state, events } = attack(start, 1);
    expect(state.phase.kind).not.toBe("effect:choose");
    expect(benchIds(state, "p2")).toEqual([B1, B2, B3]);
    expect(rows(events, "SHUFFLE")).toHaveLength(0);
  });

  it("a wire answer naming a body that has since LEFT PLAY narrows nothing and does not throw", () => {
    // `returnBenched`'s trust level, verbatim: the funnel re-reads the LIVE bench, so
    // a stale ref matches nothing.
    const parked = attack(board(SEED, [B1, B2, B3])).state;
    const shrunk: GameState = {
      ...parked,
      players: {
        ...parked.players,
        p2: { ...parked.players.p2, bench: parked.players.p2.bench.slice(0, 2) },
      },
    };
    const { state, events } = answer(shrunk, [benchRef(0), benchRef(2)]);
    expect(benchIds(state, "p2")).toEqual([B2]);
    expect(rows(events, "POKEMON_RETURNED")).toHaveLength(1);
    expect(rows(events, "SHUFFLE")).toHaveLength(1);
  });

  it("`validateChoice` refuses a short answer, a long one and a repeat — the printed number is EXACT", () => {
    const parked = attack(board(SEED, [B1, B2, B3])).state;
    for (const refs of [
      [benchRef(0)],
      [benchRef(0), benchRef(1), benchRef(2)],
      [benchRef(0), benchRef(0)],
      [],
    ]) {
      const result = applyAction(parked, {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "pokemonMulti", refs: [...refs] },
      });
      expect(result.ok, JSON.stringify(refs)).toBe(false);
      if (result.ok) throw new Error("expected a refusal");
      expect(result.error.code).toBe("BAD_EFFECT_CHOICE");
    }
    // …and a ref that was never a candidate (the actor's OWN bench).
    const foreign = applyAction(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: {
        kind: "pokemonMulti",
        refs: [{ seat: "p1", spot: { spot: "bench", index: 0 } }, benchRef(0)],
      },
    });
    expect(foreign.ok).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — §11, ASKED AT THE PARK. Both directions, because both are silent.
// ─────────────────────────────────────────────────────────────────────────────

describe("D541 §5 — the shield is asked at PARK TIME, about the bodies the effect will REACH", () => {
  it("a SHIELDED benched body is NOT OFFERED — the candidates are filtered before the prompt", () => {
    const { state } = attack(board(SEED, [B1, TEAPARTY, B3]));
    const prompt = parkedPrompt(state);
    expect(prompt.candidates).toHaveLength(2);
    expect(
      prompt.candidates.map((c) => benchIds(state, "p2")[(c.spot as { index: number }).index]),
    ).toEqual([B1, B3]);
  });

  it("…and an UNSHIELDED one IS offered, on the same board shape — the other direction", () => {
    const { state } = attack(board(SEED, [B1, B2, B3]));
    expect(parkedPrompt(state).candidates).toHaveLength(3);
  });

  it("ONE `ATTACK_EFFECT_PREVENTED` row for the shielded body, filed at the PARK", () => {
    const { events } = attack(board(SEED, [B1, TEAPARTY, B3]));
    expect(rows(events, "ATTACK_EFFECT_PREVENTED")).toHaveLength(1);
  });

  it("NO FALSE `ATTACK_EFFECT_PREVENTED` on a board where nothing was going to be reached", () => {
    const { events } = attack(board(SEED, [B1, B2, B3]));
    expect(rows(events, "ATTACK_EFFECT_PREVENTED")).toHaveLength(0);
    // …and on a board that does not even park (ZERO candidates, §4), still none.
    expect(rows(attack(board(SEED, [])).events, "ATTACK_EFFECT_PREVENTED")).toHaveLength(0);
  });

  it("a shield that takes the bench BELOW the printed number CLAMPS the prompt — it does not cancel the attack", () => {
    const start = board(SEED, [B1, TEAPARTY]);
    const { state, events } = attack(start);
    expect(state.phase.kind).toBe("effect:choose");
    const prompt = parkedPrompt(state);
    expect(prompt.candidates).toHaveLength(1);
    expect([prompt.min, prompt.max]).toEqual([1, 1]);
    expect(rows(events, "ATTACK_EFFECT_PREVENTED")).toHaveLength(1);
    const after = answer(state, [benchRef(0)]);
    expect(benchIds(after.state, "p2")).toEqual([TEAPARTY]);
    expect(rows(after.events, "SHUFFLE")).toHaveLength(1);
    expect(rows(after.events, "POKEMON_RETURNED")).toHaveLength(1);
  });

  it("…and when EVERY benched body is shielded, nothing parks, nothing moves, no SHUFFLE", () => {
    const start = board(SEED, [TEAPARTY, TEAPARTY]);
    const { state, events } = attack(start);
    expect(state.phase.kind).not.toBe("effect:choose");
    expect(benchIds(state, "p2")).toEqual([TEAPARTY, TEAPARTY]);
    expect(rows(events, "SHUFFLE")).toHaveLength(0);
    expect(state.rngState).toBe(start.rngState);
    expect(rows(events, "ATTACK_EFFECT_PREVENTED")).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — THE GATE ON A REAL BOARD, on the DECLARED demonstrator (Site B).
// ─────────────────────────────────────────────────────────────────────────────

describe("D541 §6 — the derived gate BLOCKS the attack, and the wrong twin is killable only here", () => {
  it("the demonstrator has NO registry row, which is what makes the derivation observable", () => {
    expect(programFor(CHARMER)).toBeUndefined();
    expect(registryCardIds()).not.toContain(CHARMER);
    const state = board(SEED, [B1, B2, B3]);
    expect(attackGateOf(state, activeOf(state, "p1"), 0)).toEqual({
      kind: "barredIf",
      condition: { kind: "yourPokemonUsedAttackLastTurn", attack: "Angelite" },
    });
    // …and the gate is INDEX-keyed: 'Plain Tap' at index 1 prints no clause.
    expect(attackGateOf(state, activeOf(state, "p1"), 1)).toBeUndefined();
  });

  it("THE ATTACK IS ACTUALLY BLOCKED after Angelite — the gate is enforced, not merely derived", () => {
    const start = board(SEEDS[0], [B1, B2, B3]);
    const parked = attack(start).state;
    const { state: resolved } = answer(parked, [benchRef(0), benchRef(1)]);
    const back = untilTurnOf(resolved, "p1");
    expect(activeOf(back, "p1").usedAttack?.name).toBe("Angelite");
    const again = applyAction(back, { type: "attack", seat: "p1", index: 0 });
    expect(again.ok).toBe(false);
    if (again.ok) throw new Error("expected the gate to refuse");
    expect(again.error.message).toContain("Angelite");
    expect(applyAction(back, { type: "attack", seat: "p1", index: 1 }).ok).toBe(true);
  });

  it("THE SITE-B TWIN BOARD: the stamped body has LEFT the Active Spot, and the gate still bites", () => {
    const start = board(SEEDS[0], [B1, B2, B3]);
    const parked = attack(start).state;
    const { state: resolved } = answer(parked, [benchRef(0), benchRef(1)]);
    const back = untilTurnOf(resolved, "p1");
    const displaced = fuel(setActiveFromDeck(back, "p1", CHARMER), "p1", 1);
    expect(activeOf(displaced, "p1").usedAttack).toBeNull();
    expect(displaced.players.p1.bench.some((b) => b.usedAttack?.name === "Angelite")).toBe(true);
    const blocked = applyAction(displaced, { type: "attack", seat: "p1", index: 0 });
    expect(blocked.ok).toBe(false);
    if (blocked.ok) throw new Error("expected the gate to refuse on the bench board");
    expect(activeOf(displaced, "p1").usedAttack?.name).toBeUndefined();
  });

  it("the clause→gate row is `barredIf` and names the WIDENED subject — read off the module", () => {
    // The polarity is the printed one (*"this attack can't be used"*, the BAN
    // direction) where the two other `condition`-carrying rows in the table are
    // LICENCES, and the condition member is the WIDENED one.
    expect(timingGateFromAttackText(PRINTED)).toEqual({
      kind: "barredIf",
      condition: { kind: "yourPokemonUsedAttackLastTurn", attack: "Angelite" },
    });
    expect(timingGateFromAttackText(CLAUSE)).toEqual(timingGateFromAttackText(PRINTED));
    // …and the BODY alone derives none, so the two halves really are separable.
    expect(timingGateFromAttackText(BODY)).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7 — registry === derived on the three REAL ids (the keep decision's rung).
// ─────────────────────────────────────────────────────────────────────────────

describe("D541 §7 — `SYLVEON_EX_ANGELITE` is KEPT as defence in depth, and the two producers AGREE", () => {
  it("registry === derived for all three ids, by VALUE", () => {
    const derived = timingGateFromAttackText(PRINTED);
    expect(derived).toBeDefined();
    for (const id of SYLVEON_IDS) {
      expect(programFor(id)?.attackGate?.[1], id).toEqual(derived);
      expect(Object.keys(programFor(id)?.attackGate ?? {}), id).toEqual(["1"]);
    }
  });
});

describe("D541 §8 — the parked op IS persisted, and `MATCH_RECORD_VERSION` HOLDS at 30 ( held at THIS slice; 31 since D547; 32 since D548; 33 since D549; 34 since D552; 35 since D556; 36 since D564; 37 since D570; 38 since D575; 39 since D576; 40 since D577; 41 since D579; 42 since D583; 43 since D621; 44 since D630; 45 since D636; 46 since D637; 47 since D640; 48 since D643; 49 since D646)", () => {
  it("THE FIRST DOOR: `phase.cont.pendingOp` carries the op as a LITERAL byte string", () => {
    const { state } = attack(board(SEED, [B1, B2, B3]));
    if (state.phase.kind !== "effect:choose") throw new Error("expected a park");
    expect(roundTrip(state.phase.cont.pendingOp)).toEqual(PROGRAM[0]);
    expect(JSON.stringify(state)).toContain('{"op":"returnBenchedChosen","count":2}');
  });

  it("THE SECOND DOOR, SCOPED HONESTLY (D423): `cont.rest` is EMPTY on THIS program", () => {
    const { state } = attack(board(SEED, [B1, B2, B3]));
    if (state.phase.kind !== "effect:choose") throw new Error("expected a park");
    expect(state.phase.cont.rest).toEqual([]);
  });

  it("A FRESH PARKED RECORD STRINGIFIES WITH THE NEW INHABITANT AND RESUMES TO THE SAME BOARD", () => {
    const { state } = attack(board(SEED, [B1, B2, B3]));
    const wire = JSON.stringify(state);
    expect(wire).toContain("returnBenchedChosen");
    const revived = JSON.parse(wire) as GameState;
    expect(revived.phase.kind).toBe("effect:choose");
    const { state: fromWire } = answer(revived, [benchRef(0), benchRef(1)]);
    const { state: fromLive } = answer(state, [benchRef(0), benchRef(1)]);
    expect(benchIds(fromWire, "p2")).toEqual([B3]);
    expect(JSON.stringify(fromWire)).toBe(JSON.stringify(fromLive));
  });

  it("A PRE-SLICE v30 BYTE STRING ROUND-TRIPS AND STILL RESUMES — the other D450 direction", () => {
    const { state } = attack(board(SEED, [B1, B2, B3]));
    if (state.phase.kind !== "effect:choose") throw new Error("expected a park");
    const preSlice = JSON.parse(
      JSON.stringify(state)
        .split('{"op":"returnBenchedChosen","count":2}')
        .join('{"op":"returnBenchedRest","keep":1}'),
    ) as GameState;
    expect(JSON.stringify(preSlice)).toContain('{"op":"returnBenchedRest","keep":1}');
    expect(JSON.stringify(preSlice)).not.toContain("returnBenchedChosen");
    const resumed = applyAction(preSlice, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [benchRef(0), benchRef(1)] },
    });
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) throw new Error("the pre-slice byte string failed to resume");
    // The SIBLING's reading: the answer names the bodies that STAY, so B3 is the one
    // that leaves. A build that confused the two ops would return the complement.
    expect(benchIds(resumed.state, "p2")).toEqual([B1, B2]);
  });

  it("on a NON-PARKING board the byte is NOWHERE in the record", () => {
    // The ONLY non-parking board is the ZERO-candidate one (§4): §8.6 CLAMPS a short
    // bench rather than cancelling on it, so `[B1]` parks with `min === max === 1`.
    const { state } = attack(board(SEED, []));
    expect(state.phase.kind).not.toBe("effect:choose");
    expect(JSON.stringify(state)).not.toContain("returnBenchedChosen");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §9 — THE VERSION AND BYTE PINS.
// ─────────────────────────────────────────────────────────────────────────────

describe("D541 §9 — the version tax and the byte pins", () => {
  it("…and the caption NAMES THE CLAMPED NUMBER, not the printed one — `snipeNote`'s rule", () => {
    const one = attack(board(SEED, [B1])).state;
    expect(parkedPrompt(one).note).toBe(
      "Choose 1 of your opponent's Benched Pokémon to shuffle into their deck.",
    );
    // …and it is still the PRINTED number wherever the board can answer it.
    expect(parkedPrompt(attack(board(SEED, [B1, B2, B3])).state).note).toBe(NOTE);
  });
});
