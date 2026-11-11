import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import * as effects from "./effects";
import { deriveAttackEffect, splitAttackGateClause, splitAttackTrailingClause } from "./effects";
import { applyAction } from "./index";
import type { EffectOp, GameEvent, GameState, PokemonRef, Seat } from "./index";
import { logFromEvents } from "./log";
import type { LogContext } from "./log";
import { redactGame } from "./redact";
import { programFor } from "./registry";
import {
  FIXTURE_POOL,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  discardFromDeck,
  expectErr,
  must,
  mustApply,
  setActiveFromDeck,
  driveSetup,
  roundTrip,
  programmedCardIds,
} from "./testFixtures";

const SENTENCE =
  "Search your deck for a Basic Pokémon and put it onto your Bench. Then, shuffle your deck. If you put any Pokémon onto your Bench in this way, move an Energy from this Pokémon to the new Benched Pokémon.";

const HEAD =
  "Search your deck for a Basic Pokémon and put it onto your Bench. Then, shuffle your deck.";

/** The §9.2 tail alone. Refused by all thirteen readers and by all four splitters,
    and it must STAY refused — see §2. */
const TAIL =
  "If you put any Pokémon onto your Bench in this way, move an Energy from this Pokémon to the new Benched Pokémon.";

const PROGRAM: readonly EffectOp[] = [
  { op: "searchDeck", filter: { kind: "basicPokemon" }, dest: "bench", max: 1, recordAs: "moved" },
  { op: "shuffleDeck" },
  {
    op: "recordGate",
    slot: "moved",
    ops: [
      {
        op: "moveEnergy",
        filter: { kind: "anyEnergy" },
        max: 1,
        route: "selfToBench",
        destRecorded: "moved",
      },
    ],
  },
];

function units(rows: readonly (readonly [number, string])[]): number {
  return rows.reduce((sum, [n]) => sum + n, 0);
}

function events<T extends GameEvent["type"]>(all: GameEvent[], type: T) {
  return all.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

describe("§1 — the sentence, the corpus row, and D230's refusal paid", () => {
  it("the specimen IS a row of `legalAttackCorpus()`, at the printing count the corpus states", () => {
    const rows = legalAttackCorpus().filter(([, s]) => s === SENTENCE);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.[0]).toBe(1);
    const head = legalAttackCorpus().filter(([, s]) => s === HEAD);
    expect(head).toHaveLength(1);
    expect(head[0]?.[0]).toBe(7);
  });

  it("D230's TWO blockers, re-derived rather than inherited — and both were true", () => {
    const headProgram = deriveAttackEffect(HEAD) ?? [];
    expect(headProgram).toEqual([
      { op: "searchDeck", filter: { kind: "basicPokemon" }, dest: "bench", max: 1 },
      { op: "shuffleDeck" },
    ]);
    expect(Object.hasOwn(headProgram[0] ?? {}, "recordAs")).toBe(false);
    const move = (PROGRAM[2] as Extract<EffectOp, { op: "recordGate" }>).ops[0];
    expect(move).toMatchObject({ op: "moveEnergy", route: "selfToBench", destRecorded: "moved" });
    const sibling =
      deriveAttackEffect("Move an Energy from this Pokémon to 1 of your Benched Pokémon.") ?? [];
    expect(sibling).toEqual([
      { op: "moveEnergy", filter: { kind: "anyEnergy" }, max: 1, route: "selfToBench" },
    ]);
    expect(Object.hasOwn(sibling[0] ?? {}, "destRecorded")).toBe(false);
  });
});

describe("§2 — the reader: ONE claimant, the whole sentence, and the order", () => {
  it("derives to the PROGRAM, field for field", () => {
    expect(deriveAttackEffect(SENTENCE)).toEqual(PROGRAM);
  });

  it("exactly ONE reader claims it, and the other twelve still refuse — by name", () => {
    const mod = effects as unknown as Record<string, (t: string) => unknown>;
    const claimants = attackReaderSurface().filter((name) => mod[name]?.(SENTENCE) !== null);
    expect(claimants).toEqual(["deriveAttackEffect"]);
  });

  it("and NO splitter serves it — the JOIN has no seam, which is why the anchor is whole", () => {
    // The measurement that warrants a whole-sentence anchor over a composition, and
    // it is the reason the 2⁴ lattice in §3 has no built point anywhere.
    expect(splitAttackTrailingClause(SENTENCE)).toBeNull();
    expect(splitAttackGateClause(SENTENCE)).toBeNull();
    expect(deriveAttackEffect(TAIL)).toBeNull();
    expect(resolvedByAnyReader(HEAD)).toBe(true);
  });

  it("THE TAIL STAYS REFUSED, and the reason is TWO anaphors pointing OUT of the clause", () => {
    const wrongHead = `Draw 3 cards. ${TAIL}`;
    expect(deriveAttackEffect(wrongHead)).toBeNull();
    expect(splitAttackTrailingClause(wrongHead)).toBeNull();
    // …and the head of THAT compound really is claimed, so the rung is about the
    // TAIL and not about the head (the splitter's other guard).
    expect(resolvedByAnyReader("Draw 3 cards.")).toBe(true);
    expect(TAIL.includes("in this way")).toBe(true);
    expect(TAIL.includes("the new Benched Pokémon")).toBe(true);
  });

  it("refuses the anchor, punctuation, case and destination rewrites", () => {
    for (const text of [
      // A leading clause — the `$`-only build's hole.
      `Draw a card. ${SENTENCE}`,
      `${SENTENCE} Your opponent draws a card.`,
      SENTENCE.replace("the new Benched Pokémon", "1 of your Benched Pokémon"),
      // The consequent's CASE. The shipped `^Move ` anchor is sentence-initial, so
      // this is the axis that cannot be varied independently of the gate in print.
      SENTENCE.replace(", move an Energy", ", Move an Energy"),
      // The §9.2 CONNECTIVE — a period where the card prints a comma, which would
      // make the tail a sentence and hand it to the splitter.
      SENTENCE.replace("in this way, move", "in this way. Move"),
      // The gate's own quantifier, which is what *"any"* is doing in print.
      SENTENCE.replace("put any Pokémon", "put a Pokémon"),
      // The PLURAL head, which the anchor refuses BY CONSTRUCTION rather than by a
      // guard: N uids under one slot has no reading for a singular definite *"the
      // new Benched Pokémon"*.
      SENTENCE.replace("for a Basic Pokémon and put it", "for up to 2 Basic Pokémon and put them"),
      SENTENCE.replace("a Basic Pokémon", "a Basic {G} Pokémon"),
      SENTENCE.replace("a Basic Pokémon", "a Pikachu"),
      // The trailing period.
      SENTENCE.slice(0, -1),
    ]) {
      expect(deriveAttackEffect(text), text).toBeNull();
    }
  });

  it("the wider noun group would have claimed NOTHING extra — measured over every corpus row", () => {
    const wide = new RegExp(
      "^Search your deck for a (?:Basic Pokémon|Basic \\{[A-Z]\\} Pokémon|[A-Z][a-zé]+)" +
        " and put it onto your Bench\\. Then, shuffle your deck\\." +
        " If you put any Pokémon onto your Bench in this way, move an Energy from this Pokémon" +
        " to the new Benched Pokémon\\.$",
    );
    const claimed = legalAttackCorpus().filter(([, s]) => wide.test(s));
    expect([claimed.length, units(claimed)]).toEqual([1, 1]);
    expect(claimed[0]?.[1]).toBe(SENTENCE);
  });

  it("the ORDER against `ATTACK_BENCH_SEARCH` is LOAD-BEARING for D230's `$` row", () => {
    const program = deriveAttackEffect(SENTENCE) ?? [];
    expect(program).toHaveLength(3);
    expect(program).not.toEqual(deriveAttackEffect(HEAD));
    expect(program.map((o) => o.op)).toEqual(["searchDeck", "shuffleDeck", "recordGate"]);
    // …and the head anchor's own sentence is UNTOUCHED by the new arm, which is the
    // admission that keeps the rung above from passing on a build that broke both.
    expect(deriveAttackEffect(HEAD)).toHaveLength(2);
  });

  it("hands nothing to the four splitters or to the coin reader, and carries no apostrophe", () => {
    expect(effects.splitAttackRequirementClause(SENTENCE)).toBeNull();
    expect(effects.splitAttackCancelClause(SENTENCE)).toBeNull();
    expect(effects.deriveAttackCoinFlip(SENTENCE)).toBeNull();
    expect(SENTENCE.includes("'")).toBe(false);
    expect(SENTENCE.includes("’")).toBe(false);
  });
});

const AXES = {
  head: [HEAD, HEAD],
  gate: [
    "If you put any Pokémon onto your Bench in this way,",
    "If you attached Energy to a Pokémon in this way,",
  ],
  verb: ["move", "Move"],
  dest: ["the new Benched Pokémon", "1 of your Benched Pokémon"],
} as const;

function latticePoint(h: 0 | 1, g: 0 | 1, v: 0 | 1, d: 0 | 1): string {
  return `${AXES.head[h]} ${AXES.gate[g]} ${AXES.verb[v]} an Energy from this Pokémon to ${AXES.dest[d]}.`;
}

const BITS = [0, 1] as const;

describe("§3 — the axis-substitution lattice, both directions", () => {
  it("the WHOLE-SENTENCE 2⁴ table is EMPTY at every weight, including FULL", () => {
    const built: number[] = [0, 0, 0, 0, 0];
    const total: number[] = [0, 0, 0, 0, 0];
    for (const h of BITS)
      for (const g of BITS)
        for (const v of BITS)
          for (const d of BITS) {
            const point = latticePoint(h, g, v, d);
            const weight = h + g + v + d;
            total[weight] = (total[weight] ?? 0) + 1;
            const nowBuilt =
              resolvedByAnyReader(point) || splitAttackTrailingClause(point) !== null;
            const mine = point === SENTENCE;
            if (nowBuilt && !mine) built[weight] = (built[weight] ?? 0) + 1;
          }
    expect(total).toEqual([1, 4, 6, 4, 1]);
    expect(built).toEqual([0, 0, 0, 0, 0]);
    const claimedNow = new Set<string>();
    for (const h of BITS)
      for (const g of BITS)
        for (const v of BITS)
          for (const d of BITS) {
            const point = latticePoint(h, g, v, d);
            if (resolvedByAnyReader(point)) claimedNow.add(point);
          }
    expect([...claimedNow]).toEqual([SENTENCE]);
    expect(
      new Set(
        [...BITS].flatMap((h) =>
          [...BITS].flatMap((g) =>
            [...BITS].flatMap((v) => [...BITS].map((d) => latticePoint(h, g, v, d))),
          ),
        ),
      ).size,
    ).toBe(8);
  });

  it("ALL FOUR axes are INERT on the whole-sentence verdict, and the head one is DEGENERATE", () => {
    expect(AXES.head[0]).toBe(AXES.head[1]);
    let flips = 0;
    for (const h of BITS)
      for (const g of BITS)
        for (const v of BITS)
          for (const d of BITS) {
            const here =
              latticePoint(h, g, v, d) === SENTENCE
                ? false
                : resolvedByAnyReader(latticePoint(h, g, v, d));
            for (const [a, b] of [
              [latticePoint(1, g, v, d), h],
              [latticePoint(h, 1, v, d), g],
              [latticePoint(h, g, 1, d), v],
              [latticePoint(h, g, v, 1), d],
            ] as const) {
              if (b === 1) continue;
              const there = a === SENTENCE ? false : resolvedByAnyReader(a);
              if (here !== there) flips++;
            }
          }
    expect(flips).toBe(0);
  });

  it("the TAIL's own 2³ sub-lattice is the informative one: `0/1 · 0/3 · 0/3 · 1/1`", () => {
    const gate = ["If you put any Pokémon onto your Bench in this way, ", ""] as const;
    const built: number[] = [0, 0, 0, 0];
    const total: number[] = [0, 0, 0, 0];
    for (const g of BITS)
      for (const v of BITS)
        for (const d of BITS) {
          const point = `${gate[g]}${AXES.verb[v]} an Energy from this Pokémon to ${AXES.dest[d]}.`;
          const weight = g + v + d;
          total[weight] = (total[weight] ?? 0) + 1;
          if (resolvedByAnyReader(point)) built[weight] = (built[weight] ?? 0) + 1;
        }
    expect(total).toEqual([1, 3, 3, 1]);
    expect(built).toEqual([0, 0, 0, 1]);
  });

  it("each printed SEGMENT, on its own — and the JOIN is the only refusal left", () => {
    expect(resolvedByAnyReader(HEAD)).toBe(true);
    expect(
      resolvedByAnyReader("Move an Energy from this Pokémon to 1 of your Benched Pokémon."),
    ).toBe(true);
    expect(
      resolvedByAnyReader("move an Energy from this Pokémon to 1 of your Benched Pokémon."),
    ).toBe(false);
    expect(
      resolvedByAnyReader("Move an Energy from this Pokémon to the new Benched Pokémon."),
    ).toBe(false);
    expect(resolvedByAnyReader(AXES.gate[0])).toBe(false);
  });

  it("the §9.2 GATE FAMILY is EIGHT sentences / TEN printings, and this is the seventh", () => {
    const gated = legalAttackCorpus().filter(([, s]) =>
      JSON.stringify(deriveAttackEffect(s) ?? []).includes('"recordGate"'),
    );
    expect([gated.length, units(gated)]).toEqual([9, 13]);
    expect(gated.map(([, s]) => s)).toContain(SENTENCE);
    const searches = gated.filter(([, s]) => s.startsWith("Search your deck"));
    expect([searches.length, units(searches)]).toEqual([2, 4]);
    // …and every one of the seven is claimed WHOLE, by an anchor that welds its own
    // head. That is the absent seam stated as a property of the column.
    for (const [, s] of gated) {
      expect(resolvedByAnyReader(s), s).toBe(true);
      expect(splitAttackTrailingClause(s), s).toBeNull();
    }
  });

  it("the ' in this way' MARKER IS NOT THE BLOCKER — counted on BOTH sides (D447)", () => {
    const marker = legalAttackCorpus().filter(([, s]) => s.includes(" in this way"));
    const builtMarker = marker.filter(([, s]) => resolvedByAnyReader(s));
    expect([marker.length, units(marker)]).toEqual([20, 39]);
    expect([builtMarker.length, units(builtMarker)]).toEqual([18, 36]);
    // …and the COMMA form — a gate clause with a consequent behind it — is 6 / 9 and
    // now entirely built, which is the same fact one literal narrower.
    const comma = legalAttackCorpus().filter(([, s]) => / in this way, /.test(s));
    expect([comma.length, units(comma)]).toEqual([6, 9]);
    expect(comma.every(([, s]) => resolvedByAnyReader(s))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The board.
// ─────────────────────────────────────────────────────────────────────────────

const KISSER: Card = battler("fix-invitingkiss", {
  hp: 90,
  attacks: [
    { name: "Inviting Kiss", cost: ["Colorless"], effect: SENTENCE },
    { name: "Bench Call", cost: ["Colorless"], effect: HEAD },
  ],
});

/** The body the search finds. A distinct id rather than a reused fixture so the
    record's contents are nameable, and 60 HP so nothing here is lethal. */
const FOUND: Card = battler("fix-kissfound", { hp: 60 });

const LOCAL_CARDS: Record<string, Card> = {
  "fix-invitingkiss": KISSER,
  "fix-kissfound": FOUND,
};
const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const KISS_DECK = deckOf({
  "fix-invitingkiss": 8,
  "fix-kissfound": 6,
  "fix-charjabug": 6,
  "fix-bigbody": 10,
  "fix-energy": 22,
  "fix-special": 8,
});

const KISS = 0;
const BENCH_CALL = 1;
const SEED = 11;

function localSetup(seed: number, first: Seat): GameState {
  return driveSetup(seed, { p1: KISS_DECK, p2: KISS_DECK }, { pool: POOL, first });
}

function table({
  ownBench = 1,
  basics = 6,
}: {
  ownBench?: number;
  basics?: number;
} = {}): GameState {
  let state = localSetup(SEED, "p1");
  while (state.turn < 3) {
    if (state.phase.kind !== "turn:action") throw new Error(`stuck in ${state.phase.kind}`);
    state = must(applyAction(state, { type: "endTurn", seat: state.turn % 2 === 1 ? "p1" : "p2" }));
  }
  state = clearBench(setActiveFromDeck(state, "p1", "fix-invitingkiss"), "p1");
  state = setActiveFromDeck(state, "p2", "fix-bigbody");
  state = attachFromDeck(state, "p1", "fix-energy", 1);
  state = attachFromDeck(state, "p1", "fix-special", 1);
  for (let i = 0; i < ownBench; i++) state = benchFromDeck(state, "p1", "fix-bigbody");
  // The candidate set is trimmed rather than grown, so the deck's ORDER (and the
  // shuffle's seed) is untouched by the knob.
  const inDeck = state.players.p1.deck.filter((uid) => state.cardIdByUid[uid] === "fix-kissfound");
  if (inDeck.length > basics) {
    state = discardFromDeck(state, "p1", "fix-kissfound", inDeck.length - basics);
  }
  return state;
}

function swing(state: GameState, index = KISS) {
  return mustApply(state, { type: "attack", seat: "p1", index });
}

function searchPark(state: GameState) {
  if (state.phase.kind !== "effect:choose" || state.phase.prompt.kind !== "chooseCards") {
    throw new Error(`expected a chooseCards park, got ${state.phase.kind}`);
  }
  return state.phase.prompt;
}

function movePark(state: GameState) {
  if (state.phase.kind !== "effect:choose" || state.phase.prompt.kind !== "moveEnergy") {
    throw new Error(`expected a moveEnergy park, got ${state.phase.kind}`);
  }
  return state.phase.prompt;
}

/** Answer the search with one `fix-kissfound`, and hand back the state plus every
    event the whole attack has emitted so far. */
function findOne(state: GameState): { state: GameState; events: GameEvent[]; uid: string } {
  const swung = swing(state);
  const prompt = searchPark(swung.state);
  const uid = prompt.candidates.find((u) => swung.state.cardIdByUid[u] === "fix-kissfound");
  if (uid === undefined) throw new Error("no fix-kissfound among the candidates");
  const answered = mustApply(swung.state, {
    type: "resolveEffect",
    seat: "p1",
    choice: { kind: "cards", uids: [uid] },
  });
  return { state: answered.state, events: [...swung.events, ...answered.events], uid };
}

describe("§4 — the two parks: the search, then the pinned move", () => {
  it("the search parks on `chooseCards`, and the candidate set is BASICS only", () => {
    const prompt = searchPark(swing(table()).state);
    expect(prompt.min).toBe(0);
    expect(prompt.max).toBe(1);
    expect(prompt.dest).toBe("bench");
    const ids = prompt.candidates.map((u) => swing(table()).state.cardIdByUid[u]);
    expect(ids).not.toContain("fix-charjabug");
    expect(ids).toContain("fix-kissfound");
  });

  it("the SECOND park is the move, and its DESTINATION SET IS ONE — the pinned body", () => {
    const found = findOne(table({ ownBench: 1 }));
    const prompt = movePark(found.state);
    expect(found.state.players.p1.bench).toHaveLength(2);
    expect(prompt.destinations).toHaveLength(1);
    // …and it is the body the search benched, named by its SPOT rather than by
    // position in the list.
    const benched = found.state.players.p1.bench.findIndex((b) => b.stack.includes(found.uid));
    expect(benched).toBe(1);
    expect(prompt.destinations[0]).toEqual({ seat: "p1", spot: { spot: "bench", index: benched } });
  });

  it("THE PARK'S ARITY DOES NOT COLLAPSE, and the FLOOR is why", () => {
    const found = findOne(table({ ownBench: 1 }));
    const prompt = movePark(found.state);
    expect(prompt.destinations).toHaveLength(1);
    expect("min" in prompt).toBe(false);
    expect(prompt.max).toBe(1);
    expect(prompt.movable).toHaveLength(2);
    const kinds = prompt.movable.map((m) => found.state.cardIdByUid[m.uid]);
    expect([...kinds].sort()).toEqual(["fix-energy", "fix-special"]);
    // …and the DECLINE really is accepted, which is what "the arity did not collapse"
    // means as a board fact rather than as a reading of the code.
    const declined = mustApply(found.state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "moveEnergy", picks: [] },
    });
    expect(declined.state.phase.kind).not.toBe("effect:choose");
    expect(events(declined.events, "ENERGY_MOVED")).toHaveLength(0);
    expect(declined.state.players.p1.bench[1]?.energy).toEqual([]);
  });

  it("ACCEPTS the pick, and the Energy lands on the body the search benched", () => {
    const found = findOne(table({ ownBench: 1 }));
    const prompt = movePark(found.state);
    const dest = prompt.destinations[0] as PokemonRef;
    const uid = prompt.movable[0]?.uid as string;
    const done = mustApply(found.state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "moveEnergy", picks: [{ uid, dest }] },
    });
    expect(done.state.phase.kind).not.toBe("effect:choose");
    expect(done.state.players.p1.bench[1]?.energy).toEqual([uid]);
    expect(done.state.players.p1.bench[0]?.energy).toEqual([]);
    expect(done.state.players.p1.active?.energy).toHaveLength(1);
    const rows = events(done.events, "ENERGY_MOVED");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      seat: "p1",
      actor: "p1",
      uids: [uid],
      from: { spot: "active" },
      to: { spot: "bench", index: 1 },
    });
  });

  it("A WIRE ANSWER AIMED AT THE OTHER BENCH BODY IS REFUSED", () => {
    const found = findOne(table({ ownBench: 1 }));
    const uid = movePark(found.state).movable[0]?.uid as string;
    expectErr(
      found.state,
      {
        type: "resolveEffect",
        seat: "p1",
        choice: {
          kind: "moveEnergy",
          picks: [{ uid, dest: { seat: "p1", spot: { spot: "bench", index: 0 } } }],
        },
      },
      "BAD_EFFECT_CHOICE",
    );
    // …and the ACTIVE is refused too, which the bench case alone does not prove.
    expectErr(
      found.state,
      {
        type: "resolveEffect",
        seat: "p1",
        choice: {
          kind: "moveEnergy",
          picks: [{ uid, dest: { seat: "p1", spot: { spot: "active" } } }],
        },
      },
      "BAD_EFFECT_CHOICE",
    );
  });

  it("THE ATTRIBUTION CONTROL: the BARE HEAD benches and moves NOTHING", () => {
    const swung = swing(table({ ownBench: 1 }), BENCH_CALL);
    const prompt = searchPark(swung.state);
    const uid = prompt.candidates.find((u) => swung.state.cardIdByUid[u] === "fix-kissfound");
    const done = mustApply(swung.state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [uid as string] },
    });
    expect(done.state.phase.kind).not.toBe("effect:choose");
    expect(done.state.players.p1.bench).toHaveLength(2);
    expect(done.state.players.p1.bench[1]?.energy).toEqual([]);
    expect(done.state.players.p1.active?.energy).toHaveLength(2);
    expect(events(done.events, "ENERGY_MOVED")).toHaveLength(0);
  });

  it("the SEAT control — the opponent's board is never a destination", () => {
    // `moveBoardSeat` answers the CONTROLLER's board for an absent `side`, and the
    // record is filed by the controller's own op, so the narrowing cannot reach
    // across. Both halves matter: the offer AND the wire.
    const found = findOne(table({ ownBench: 1 }));
    const prompt = movePark(found.state);
    expect(prompt.destinations.every((d) => d.seat === "p1")).toBe(true);
    expect(prompt.movable.every((m) => m.from.seat === "p1")).toBe(true);
    const before = found.state.players.p2;
    const uid = prompt.movable[0]?.uid as string;
    const done = mustApply(found.state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "moveEnergy", picks: [{ uid, dest: prompt.destinations[0] as PokemonRef }] },
    });
    expect(done.state.players.p2.active).toEqual(before.active);
    expect(done.state.players.p2.bench).toEqual(before.bench);
  });
});

describe("§5 — the EMPTY-RECORD case: the printed *any* answers NO by itself", () => {
  it("the DECLINED search files `[]`, the gate is false, and nothing else happens", () => {
    const swung = swing(table({ ownBench: 1 }));
    const declined = mustApply(swung.state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [] },
    });
    expect(declined.state.phase.kind).not.toBe("effect:choose");
    expect(declined.state.players.p1.bench).toHaveLength(1);
    expect(declined.state.players.p1.active?.energy).toHaveLength(2);
    expect(events(declined.events, "ENERGY_MOVED")).toHaveLength(0);
    // …and the printed shuffle STILL fires, which is the Nest Ball pattern and the
    // half a "the gate swallowed the program" build would break.
    expect(events(declined.events, "SHUFFLE")).toHaveLength(1);
  });

  it("a search that can find NOTHING is the same silence, one seam earlier", () => {
    // The WHIFF path, reached by emptying the candidate set rather than by a full
    // Bench — so the op returns `{done}` from `stepOp` and never parks at all. The
    // record is filed `[]` there too, and the gate reads it the same way.
    const bare = table({ ownBench: 1, basics: 0 });
    // Every Basic must be gone, not just the intended one — the deck also holds
    // `fix-invitingkiss` and `fix-bigbody`, which ARE Basics, so the honest whiff
    // board removes all of them.
    let state = bare;
    for (const id of ["fix-invitingkiss", "fix-bigbody"]) {
      const n = state.players.p1.deck.filter((u) => state.cardIdByUid[u] === id).length;
      if (n > 0) state = discardFromDeck(state, "p1", id, n);
    }
    const basics = state.players.p1.deck.filter((u) => {
      const card = POOL[state.cardIdByUid[u] ?? ""];
      return card?.category === "Pokemon" && card?.stage === "Basic";
    });
    expect(basics).toHaveLength(0);
    const done = swing(state);
    // No park at all — neither the search's nor the move's.
    expect(done.state.phase.kind).not.toBe("effect:choose");
    expect(done.state.players.p1.bench).toHaveLength(1);
    expect(done.state.players.p1.active?.energy).toHaveLength(2);
    expect(events(done.events, "ENERGY_MOVED")).toHaveLength(0);
    expect(events(done.events, "DECK_SEARCHED")).toHaveLength(0);
    // …and the shuffle still fires on the whiff, exactly as it does on the decline.
    expect(events(done.events, "SHUFFLE")).toHaveLength(1);
  });

  it("and the ADMISSION on the same axis: the gate DOES fire when a body arrives", () => {
    const found = findOne(table({ ownBench: 1 }));
    expect(found.state.phase.kind).toBe("effect:choose");
    expect(movePark(found.state).destinations).toHaveLength(1);
  });

  it("an EMPTY BENCH still parks the move — the pin is not a bench-count test", () => {
    const found = findOne(table({ ownBench: 0 }));
    const prompt = movePark(found.state);
    expect(found.state.players.p1.bench).toHaveLength(1);
    expect(prompt.destinations).toEqual([{ seat: "p1", spot: { spot: "bench", index: 0 } }]);
    expect(prompt.destinations).toHaveLength(1);
  });
});

describe("§6 — the describer and the log rows, RENDERED", () => {
  it("`withConsequence` FIRES, and the caption is the card's printed second half", () => {
    const prompt = searchPark(swing(table({ ownBench: 1 })).state);
    expect(prompt.note).toBe(
      "Search your deck for a Basic Pokémon onto your Bench." +
        " If you put any Pokémon onto your Bench in this way," +
        " move an Energy from this Pokémon to the new Benched Pokémon.",
    );
    expect(prompt.note).toContain("If you put any Pokémon onto your Bench in this way,");
    expect(prompt.note).not.toContain("If you do");
    expect(searchPark(swing(table({ ownBench: 1 }), BENCH_CALL).state).note).toBe(
      "Search your deck for a Basic Pokémon onto your Bench.",
    );
  });

  it("the MOVE park's own heading names the PINNED destination, not `1 of your Benched Pokémon`", () => {
    const found = findOne(table({ ownBench: 1 }));
    expect(movePark(found.state).note).toBe(
      "Move an Energy from this Pokémon to the new Benched Pokémon.",
    );
    expect(movePark(found.state).note).not.toContain("1 of your Benched Pokémon");
  });

  it("the LOG ROWS, RENDERED rather than reasoned about (D456/D499/D501)", () => {
    const found = findOne(table({ ownBench: 1 }));
    const prompt = movePark(found.state);
    const uid = prompt.movable[0]?.uid as string;
    const done = mustApply(found.state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "moveEnergy", picks: [{ uid, dest: prompt.destinations[0] as PokemonRef }] },
    });
    const ctx: LogContext = {
      state: done.state,
      names: { p1: "Ash", p2: "Gary" },
      elapsed: "+00:00",
    };
    const text = logFromEvents([...found.events, ...done.events], ctx)
      .map((row) => (row.kind === "action" ? row.segments.map((seg) => seg.text).join("") : ""))
      .filter((line) => /searched|shuffled|moved/.test(line));
    expect(text).toEqual([
      "searched their deck — benched 1 Pokémon",
      "shuffled their deck",
      "moved 1 energy from fix-invitingkiss to fix-kissfound",
    ]);
  });

  it("the DECLARED SURVIVOR's POPULATION, made executable (D465/D477)", () => {
    const walk = (ops: readonly unknown[]): Record<string, unknown>[] => {
      const out: Record<string, unknown>[] = [];
      for (const o of ops as Record<string, unknown>[]) {
        out.push(o);
        for (const key of ["ops", "otherwise"]) {
          const nested = o[key];
          if (Array.isArray(nested)) out.push(...walk(nested));
        }
      }
      return out;
    };
    const all: Record<string, unknown>[] = [];
    for (const [, text] of legalAttackCorpus()) all.push(...walk(deriveAttackEffect(text) ?? []));
    for (const id of programmedCardIds()) {
      const program = programFor(id);
      if (program === undefined) continue;
      for (const value of Object.values(program as Record<string, unknown>)) {
        if (Array.isArray(value)) all.push(...walk(value));
        else if (value !== null && typeof value === "object") {
          for (const inner of Object.values(value as Record<string, unknown>)) {
            if (Array.isArray(inner)) all.push(...walk(inner));
          }
        }
      }
    }
    const searches = all.filter((o) => o.op === "searchDeck");
    const recording = searches.filter((o) => o.recordAs !== undefined);
    expect(searches.length).toBe(151);
    const gatedOrBench = recording.filter((o) => o.dest === "bench");
    expect(gatedOrBench).toHaveLength(1);
    expect(gatedOrBench[0]?.dest).toBe("bench");
    const crispin = programFor("sv07-133");
    const nonBench = recording.filter((o) => o.dest !== "bench");
    expect(nonBench).toHaveLength(4);
    for (const o of nonBench) expect(o).toBe(crispin?.trainer?.[0]);
    expect(JSON.stringify(crispin)).not.toContain('"recordGate"');
    expect([...new Set(searches.map((o) => o.dest))].sort()).toEqual([
      "bench",
      "deckTop",
      "discard",
      "hand",
    ]);
  });

  it("the wire prompt carries no new key — the rider rides the OP alone", () => {
    const found = findOne(table({ ownBench: 1 }));
    const wire = redactGame(found.state, "p1");
    if (wire.phase.kind !== "effect:choose") throw new Error("expected a wire park");
    const prompt = wire.phase.prompt;
    if (prompt === null || prompt.kind !== "moveEnergy") {
      throw new Error("expected a wire moveEnergy prompt");
    }
    expect(Object.keys(prompt).sort()).toEqual(["destinations", "kind", "max", "movable", "note"]);
    expect("destRecorded" in prompt).toBe(false);
    expect(prompt.destinations).toHaveLength(1);
  });
});

describe("§7 — the persisted shape: `MATCH_RECORD_VERSION` stays 30", () => {
  it("THE ADDRESS, NAMED FIRST — and there are TWO doors, not one", () => {
    const live = swing(table({ ownBench: 1 })).state;
    if (live.phase.kind !== "effect:choose") throw new Error("expected a park");
    const bytes = JSON.parse(JSON.stringify(live.phase.cont)) as {
      pendingOp: Record<string, unknown>;
      rest: Record<string, unknown>[];
      record?: unknown;
    };
    expect(bytes.pendingOp.op).toBe("searchDeck");
    expect(bytes.pendingOp.recordAs).toBe("moved"); // door one, IN the bytes
    expect(bytes.rest.map((o) => o.op)).toEqual(["shuffleDeck", "recordGate"]);
    const gate = bytes.rest[1] as { ops: Record<string, unknown>[] };
    expect(gate.ops[0]?.destRecorded).toBe("moved");
    expect(Object.keys(bytes.pendingOp).sort()).toEqual([
      "dest",
      "filter",
      "max",
      "op",
      "recordAs",
    ]);
    expect(Object.keys(gate.ops[0] ?? {}).sort()).toEqual([
      "destRecorded",
      "filter",
      "max",
      "op",
      "route",
    ]);
  });

  it("A v30 `searchDeck` PARK — no `recordAs` — RESUMES EXACTLY AS IT DID", () => {
    const swung = swing(table({ ownBench: 1 }), BENCH_CALL);
    const v30: GameState = roundTrip(swung.state);
    if (v30.phase.kind !== "effect:choose") throw new Error("expected a park");
    expect(Object.keys(v30.phase.cont.pendingOp).sort()).toEqual(["dest", "filter", "max", "op"]);
    expect("record" in v30.phase.cont).toBe(false);
    const uid = searchPark(v30).candidates.find((u) => v30.cardIdByUid[u] === "fix-kissfound");
    const done = mustApply(v30, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [uid as string] },
    });
    expect(done.state.players.p1.bench).toHaveLength(2);
    expect(done.state.phase.kind).not.toBe("effect:choose");
  });

  it("AND THE OTHER DIRECTION: the keys DELETED by hand answer a DIFFERENT NUMBER", () => {
    const live = swing(table({ ownBench: 1 })).state;
    const bytes: GameState = roundTrip(live);
    if (bytes.phase.kind !== "effect:choose") throw new Error("expected a park");
    const { recordAs: _filed, ...v30Search } = bytes.phase.cont.pendingOp as unknown as Record<
      string,
      unknown
    >;
    const gate = bytes.phase.cont.rest[1] as unknown as { ops: Record<string, unknown>[] };
    const { destRecorded: _pin, ...v30Move } = (gate.ops[0] ?? {}) as Record<string, unknown>;
    const stripped: GameState = {
      ...bytes,
      phase: {
        ...bytes.phase,
        cont: {
          ...bytes.phase.cont,
          pendingOp: v30Search as unknown as EffectOp,
          rest: [
            bytes.phase.cont.rest[0] as EffectOp,
            { ...gate, ops: [v30Move] } as unknown as EffectOp,
          ],
        },
      },
    };
    const uid = searchPark(stripped).candidates.find(
      (u) => stripped.cardIdByUid[u] === "fix-kissfound",
    );
    const old = mustApply(stripped, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [uid as string] },
    });
    // The old answer is still ACCEPTED — nothing throws, nothing corrupts.
    expect(old.state.players.p1.bench).toHaveLength(2);
    // …and it answers a different number.
    expect(old.state.phase.kind).not.toBe("effect:choose");
    expect(old.state.players.p1.bench[1]?.energy).toEqual([]);
    expect(old.state.players.p1.active?.energy).toHaveLength(2);
    expect(events(old.events, "ENERGY_MOVED")).toHaveLength(0);
    // THE POSITIVE CONTROL on the same board: with the keys, the second park exists
    // and one Energy moves.
    const found = findOne(table({ ownBench: 1 }));
    expect(movePark(found.state).destinations).toHaveLength(1);
    expect(found.state.players.p1.bench[1]?.energy).toEqual([]);
  });

  it("the running §9.2 record reaches the bytes as an EXISTING optional field", () => {
    // `EffectContinuation.record?` has shipped since §9.2 and `carriedRecord` spreads
    // it rather than assigning, so a program that never touches the record parks into
    // the exact phase shape it always did. This one DOES touch it, at the second park.
    const found = findOne(table({ ownBench: 1 }));
    if (found.state.phase.kind !== "effect:choose") throw new Error("expected a park");
    const cont = found.state.phase.cont;
    expect(Object.keys(cont).sort()).toEqual(["ctx", "pendingOp", "record", "rest"]);
    expect(cont.record).toEqual({ moved: [found.uid] });
    const bare = swing(table({ ownBench: 1 }), BENCH_CALL).state;
    if (bare.phase.kind !== "effect:choose") throw new Error("expected a park");
    expect(Object.keys(bare.phase.cont).sort()).toEqual(["ctx", "pendingOp", "rest"]);
  });
});

describe("§8 — the census this row moves, and the summands it does not", () => {
  it("the resolving corpus gains ONE sentence and ONE printing", () => {
    const resolved = legalAttackCorpus().filter(([, s]) => resolvedByAnyReader(s));
    const without = resolved.filter(([, s]) => s !== SENTENCE);
    expect([resolved.length - without.length, units(resolved) - units(without)]).toEqual([1, 1]);
  });

  it("the move is READER-keyed — no registry row, no splitter, no gate clause", () => {
    expect(splitAttackGateClause(SENTENCE)).toBeNull();
    expect(splitAttackTrailingClause(SENTENCE)).toBeNull();
    expect(effects.splitAttackRequirementClause(SENTENCE)).toBeNull();
    expect(effects.splitAttackCancelClause(SENTENCE)).toBeNull();
  });

  it("A CENSUS STAYING GREEN UNDER A WRONG BUILD IS THE FINDING, NOT A GAP", () => {
    expect(resolvedByAnyReader(SENTENCE)).toBe(true);
    const program = deriveAttackEffect(SENTENCE) ?? [];
    const copy = JSON.parse(JSON.stringify(program)) as Record<string, unknown>[];
    const gate = copy[2] as { ops: Record<string, unknown>[] };
    const { destRecorded: _pin, ...unpinnedMove } = (gate.ops[0] ?? {}) as Record<string, unknown>;
    const unpinned = [copy[0], copy[1], { ...gate, ops: [unpinnedMove] }];
    expect(unpinned).not.toEqual(program);
    expect(JSON.stringify(unpinned)).not.toContain("destRecorded");
  });
});
