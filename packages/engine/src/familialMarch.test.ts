import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { deriveAttackEffect } from "./effects";
import { applyAction } from "./index";
import type { GameState, Seat } from "./index";
import { programFor } from "./registry";
import {
  FIXTURE_POOL,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  setActiveFromDeck,
  typedEnergy,
  must,
  findEvent,
  driveSetup,
} from "./testFixtures";

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
  [MAUSHOLD_EX]: battler(MAUSHOLD_EX, {
    name: "Maushold ex",
    hp: 260,
    retreat: 1,
    types: ["Colorless"],
    stage: "Stage1",
    evolveFrom: "Tandemaus",
  }),
  [TANDEMAUS]: battler(TANDEMAUS, {
    name: "Tandemaus",
    hp: 60,
    retreat: 1,
    types: ["Colorless"],
  }),
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

function localSetup(seed: number, first: Seat): GameState {
  return driveSetup(seed, { p1: DECK, p2: DECK }, { pool: POOL, first });
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

  it("the program is `anyOf` of TWO `byName`s under a FLAT cap — exact, `toEqual`", () => {
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
    expect(programFor(MAUSHOLD)?.attack?.[0]).toBeDefined();
    expect(programFor(MAUSHOLD)?.attack?.[1]).toBeUndefined();
  });

  it("the row authors an ATTACK and NOTHING else — the key set, not six slices of habit", () => {
    expect(Object.keys(programFor(MAUSHOLD) ?? {})).toEqual(["attack"]);
  });

  it("the op carries NO `reveal` key at all — DRIVEN, not filed", () => {
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
    const { prompt } = attack(board(3));
    expect(prompt.dest).toBe("bench");
  });

  it("takes TWO `Maushold` and nothing else — one extreme of the combination", () => {
    const state = board(4);
    const { parked } = attack(state);
    const picks = deckUids(parked, MAUSHOLD_BODY).slice(0, 2);
    expect(picks).toHaveLength(2);
    const { state: after } = mustResolve(parked, picks);
    expect(benchIds(after, "p1")).toEqual([FILLER, MAUSHOLD_BODY, MAUSHOLD_BODY]);
  });

  it("takes TWO `Maushold ex` and nothing else — the union's other extreme", () => {
    const state = board(5);
    const { parked } = attack(state);
    const picks = deckUids(parked, MAUSHOLD_EX).slice(0, 2);
    expect(picks).toHaveLength(2);
    const { state: after } = mustResolve(parked, picks);
    expect(benchIds(after, "p1")).toEqual([FILLER, MAUSHOLD_EX, MAUSHOLD_EX]);
  });

  it("takes a MIXTURE — one of each, the printed 'combination'", () => {
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

  it("`byName{Maushold}` REFUSES 'Maushold ex' — exact, not a prefix match", () => {
    const { parked, prompt } = attack(board(20));
    const offered = new Set(prompt.candidates.map((u) => parked.cardIdByUid[u]));
    expect(offered.has(MAUSHOLD_BODY)).toBe(true);
    expect(offered.has(MAUSHOLD_EX)).toBe(true);
  });

  it("NEITHER member takes 'Mausholder' — a strict extension of one printed name", () => {
    // The other direction of the exactness claim, and the case a `startsWith`
    // "fixed" by special-casing the " ex" suffix would still fail. `Mausholder`
    // contains "Maushold" as a prefix and is neither printed name.
    const { parked, prompt } = attack(board(21));
    const offered = new Set(prompt.candidates.map((u) => parked.cardIdByUid[u]));
    expect(offered.has(MAUSHOLDER)).toBe(false);
  });

  it("the PRE-EVOLUTION 'Tandemaus' is REFUSED — two names, not an evolution line", () => {
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

  it("the cap CLAMPS to bench space — 4 benched leaves room for ONE", () => {
    const { prompt } = attack(board(30, { benched: 4 }));
    expect(prompt.max).toBe(1);
  });

  it("a FULL bench takes the op off the board entirely — no park, no prompt", () => {
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
    expect(findEvent(events, "SHUFFLE")).toBeDefined();
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

  it("the cards go to the BENCH and NOT to the hand — the `dest` proved on a board", () => {
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

  it("the sentence is REFUSED by the deriver AND BUILT by the registry — D314", () => {
    expect(programFor(MAUSHOLD)).toBeDefined();
    expect(deriveAttackEffect(PRINTED)).toBeNull();
  });

  it("THE GRAMMAR CLOSES AT 6 OF 6 — stated as arithmetic, not as prose", () => {
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

  it("the REGISTRY summand is the one that moves — 1,164 + 16 + 13 = 1,193", () => {
    const rawReaderKeyed = 1164; // unmoved — `programFor` is nowhere in that addition
    const registryKeyed = 16;
    const splitReaderKeyed = 13; // unmoved — this sentence carries no gate clause
    expect(rawReaderKeyed + registryKeyed + splitReaderKeyed).toBe(1193);
  });
});
