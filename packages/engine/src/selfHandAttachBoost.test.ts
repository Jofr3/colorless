import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import * as effects from "./effects";
import {
  deriveAttackDamageMultiplier,
  deriveAttackDiscardScaledBoost,
  deriveAttackEffect,
  deriveAttackPreDamage,
  discardScaledBoostProgram,
  splitAttackTrailingClause,
} from "./effects";
import type { EffectOp } from "./effects";
import { applyAction, createGame, engineVersion } from "./index";
import type { GameEvent, GameState, PokemonRef, Seat } from "./index";
import { runProgram } from "./interpreter";
import { FIXTURE_POOL, battler, deckOf, typedEnergy } from "./testFixtures";
import { makeInPlay } from "./types";

// 0.435.0 → 0.436.0 — 🆕🆕🆕 D552: THE PRE-DAMAGE SELF ATTACH BEHIND A MULTIPLIER HEAD.
//
// ── THE PRINTED SENTENCE ─────────────────────────────────────────────────────
//   `censusAttackCorpus.ts` FILE LINE 569 (leading count column 1) — "This attack does 30
//     damage for each {W} Energy attached to this Pokémon. Before doing damage, you may
//     attach any number of Basic {W} Energy cards from your hand to this Pokémon."
//                                                                       **1 printing**
//
// D503 REFUSED IT, AND ITS REFUSAL WAS A MEASUREMENT OF ONE ROUTE: the shipped pre-damage
// hook runs after the §8.5 scaling fold is fixed and cannot park, so an attach there is never
// counted. D552 builds it by ORDER rather than by that hook — D402/D403's shape: the hit is
// dealt from INSIDE the program, AFTER the attach parks and resolves:
//
//   [ { op: "attachFromHand", filter: Basic {W}, toSelf: true, recordAs: "moved" },
//     { op: "damageDefender", base: <head at declaration>, per: 30, count: "moved" } ]
//
// so the dealt number is `30 × (W at declaration + W attached)` — the head multiplier on the
// POST-attach board, as ONE §8.5 pass (Weakness and Resistance once, on the sum).
//
// ── THE :569 RULINGS A1–A3 (docs/decisions.md D552; :629's are R1–R5) ─────────────────────────────────────
//   A1 — attach-then-damage inside the program; `base` is the DECLARATION-TIME head.
//   A2 — the printed marker is ASSUMED "30×" (the demonstrator declares it): for this member
//        the printed base is UNUSED, so only a "+" marker on the real card would change it.
//   A3 — the hit is dealt from inside the program (DAMAGE_DEALT after the attach, through
//        `snipeActive`), D402/D403's fidelity; the NAMED boost (D155) is not folded there —
//        pre-existing, stated rather than fixed here.
//
// ⚠️ **THE REAL CARD IS UNMEASURED.** No REAL card id resolves: no `registry.ts` or
// `catalogManifest.ts` row prints the sentence (`git grep`). Its only `testFixtures.ts`
// carrier is the DECLARED sweep fixture `fix-tideattach` (index 0), added by this slice for
// the `FIXTURE_POOL` sweeps and unused here; the board rides a FILE-LOCAL DECLARED
// `d552-tide` (D425) in its own 60-card deck (D270), `damage: "30×"`.

/** THE SENTENCE — §1 asserts it IS a corpus row, never trusting the literal. */
const PRINTED =
  "This attack does 30 damage for each {W} Energy attached to this Pokémon. Before doing damage, you may attach any number of Basic {W} Energy cards from your hand to this Pokémon.";
const HEAD = "This attack does 30 damage for each {W} Energy attached to this Pokémon.";
const TAIL =
  "Before doing damage, you may attach any number of Basic {W} Energy cards from your hand to this Pokémon.";
const MEMBER = { kind: "selfHandAttach", per: 30, energyType: "Water" } as const;

type Reader = (text: string) => unknown;
/** Every reader that claims `text`, BY NAME, off the module surface (D417/D418). */
function claimants(text: string): string[] {
  return attackReaderSurface().filter((name) => {
    const read = (effects as unknown as Record<string, Reader | undefined>)[name];
    if (read === undefined) throw new Error(`reader surface names a missing export: ${name}`);
    return read(text) !== null;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// §1 — the sentence and the reader.
// ─────────────────────────────────────────────────────────────────────────────

describe("D552 §1 — the sentence is claimed WHOLE by ONE reader, and the halves stay where they were", () => {
  it("is a corpus row, ONCE, at ONE printing", () => {
    const rows = legalAttackCorpus().filter(([, s]) => s === PRINTED);
    expect(rows.map(([n]) => n)).toEqual([1]);
    expect(`${HEAD} ${TAIL}`).toBe(PRINTED);
  });

  it("🛑 `deriveAttackDiscardScaledBoost` owns it by VALUE, and it is the ONLY claimant of the thirteen", () => {
    expect(attackReaderSurface()).toHaveLength(13);
    expect(deriveAttackDiscardScaledBoost(PRINTED)).toEqual(MEMBER);
    expect(claimants(PRINTED)).toEqual(["deriveAttackDiscardScaledBoost"]);
    expect(resolvedByAnyReader(PRINTED)).toBe(true);
    // No splitter composes it — the whole-sentence anchor is the only route in.
    expect(splitAttackTrailingClause(PRINTED)).toBeNull();
  });

  it("🛑 NEGATIVE CONTROLS: the multiplier, `deriveAttackEffect` and `deriveAttackPreDamage` still refuse the WHOLE", () => {
    expect(deriveAttackDamageMultiplier(PRINTED)).toBeNull();
    expect(deriveAttackEffect(PRINTED)).toBeNull();
    expect(deriveAttackPreDamage(PRINTED)).toBeNull();
    // …the HEAD alone is still the multiplier's, byte for byte (D438: name the owner).
    expect(claimants(HEAD)).toEqual(["deriveAttackDamageMultiplier"]);
    expect(deriveAttackDamageMultiplier(HEAD)).toEqual({
      per: 30,
      count: { kind: "energyOnSelf", energyType: "Water" },
    });
  });

  it("🛑 THE TAIL TRIPWIRE STAYS: no reader claims the printed tail alone (D503 §4)", () => {
    expect(deriveAttackEffect(TAIL)).toBeNull();
    expect(claimants(TAIL)).toEqual([]);
  });

  it("the amount is CAPTURED and guarded `>= 1`; the `{W}` is LITERAL (one printing, D121)", () => {
    expect(deriveAttackDiscardScaledBoost(PRINTED.replace("does 30 damage", "does 40 damage"))).toEqual({
      ...MEMBER,
      per: 40,
    });
    expect(deriveAttackDiscardScaledBoost(PRINTED.replace("does 30 damage", "does 1 damage"))).toEqual({
      ...MEMBER,
      per: 1,
    });
    expect(deriveAttackDiscardScaledBoost(PRINTED.replace("does 30 damage", "does 0 damage"))).toBeNull();
    expect(deriveAttackDiscardScaledBoost(PRINTED.replaceAll("{W}", "{R}"))).toBeNull();
  });

  it("the anchor is WHOLE-SENTENCE — leading text, trailing text, case and the period", () => {
    expect(deriveAttackDiscardScaledBoost(PRINTED)).not.toBeNull();
    for (const text of [
      `Flip a coin. ${PRINTED}`,
      `${PRINTED} Then, shuffle your deck.`,
      PRINTED.toLowerCase(),
      PRINTED.slice(0, -1),
      // …the DESTINATION alone.
      PRINTED.replace("from your hand to this Pokémon.", "from your hand to your Pokémon in any way you like."),
      // …the ZONE alone.
      PRINTED.replace("from your hand", "from your discard pile"),
    ]) {
      expect(deriveAttackDiscardScaledBoost(text), text).toBeNull();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — the program, and its ORDER.
// ─────────────────────────────────────────────────────────────────────────────

describe("D552 §2 — attach, THEN damage, and the damage reads what the attach filed", () => {
  it("🛑 the assembled program, pinned by value — `base` is whatever the caller hands in", () => {
    expect(discardScaledBoostProgram(MEMBER, 60)).toEqual([
      {
        op: "attachFromHand",
        filter: { kind: "basicEnergy", energyType: "Water" },
        toSelf: true,
        recordAs: "moved",
      },
      { op: "damageDefender", base: 60, per: 30, count: "moved" },
    ]);
  });

  it("the D247 four-printing program is BYTE-IDENTICAL — neither new key is spelled there (D104)", () => {
    const bare = deriveAttackEffect(
      "You may attach any number of Basic Energy cards from your hand to your Pokémon in any way you like.",
    );
    expect(bare).toEqual([{ op: "attachFromHand", filter: { kind: "basicEnergy" } }]);
    expect(Object.keys(bare?.[0] ?? {}).sort()).toEqual(["filter", "op"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE BOARD. A file-local pool (D414/D452): the board's cards are local; the slice's one
// `FIXTURE_POOL` addition, `fix-tideattach`, is a sweep carrier this suite does not use.
// ─────────────────────────────────────────────────────────────────────────────

/** The declared demonstrator (D425): a {W} body printing the sentence, "30×" (R2's
    assumption, declared), and the HEAD alone at index 1 — the shipped multiplier, used to
    evaluate the head on a board by the engine's own path. */
const TIDE = "d552-tide";
const WALL = "d552-wall";
/** ×2 AND −30 to {W}: the target on which one hit and two hits differ. */
const WEAK_RESISTANT = "d552-weak-resistant";
const BODY = "d552-body";
const WATER = "d552-water";
const FIRE = "d552-fire";

const SURGE = 0;
const HEAD_ONLY = 1;

const LOCAL_CARDS: Record<string, Card> = {
  [TIDE]: battler(TIDE, {
    name: "D552 Tide",
    hp: 300,
    retreat: 1,
    types: ["Water"],
    attacks: [
      { cost: ["Colorless"], name: "Surge", effect: PRINTED, damage: "30×" },
      { cost: ["Colorless"], name: "Swell", effect: HEAD, damage: "30×" },
    ],
  }),
  [WALL]: battler(WALL, { name: "D552 Wall", hp: 900, retreat: 1, types: ["Fire"] }),
  [WEAK_RESISTANT]: battler(WEAK_RESISTANT, {
    name: "D552 Weak Resistant",
    hp: 900,
    retreat: 1,
    types: ["Fire"],
    weaknesses: [{ type: "Water", value: "×2" }],
    resistances: [{ type: "Water", value: "-30" }],
  }),
  [BODY]: battler(BODY, { name: "D552 Body", hp: 60, types: ["Water"] }),
  [WATER]: typedEnergy(WATER, "Water"),
  [FIRE]: typedEnergy(FIRE, "Fire"),
};

const CARD_POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

/** SIXTY cards (D270). `fix-special` is FIXTURE_POOL's Special Energy — a non-Basic the
    offer must exclude. */
const LOCAL_DECK = deckOf({
  [TIDE]: 6,
  [WALL]: 4,
  [WEAK_RESISTANT]: 4,
  [BODY]: 12,
  [WATER]: 24,
  [FIRE]: 6,
  "fix-special": 4,
});

function ok(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.state;
}

function act(state: GameState, action: Parameters<typeof applyAction>[1]) {
  const outcome = applyAction(state, action);
  if (!outcome.ok) {
    throw new Error(`${action.type} rejected: ${outcome.error.code}: ${outcome.error.message}`);
  }
  return { state: outcome.state, events: [...outcome.events] };
}

function firstBasic(state: GameState, side: Seat): string {
  const uid = state.players[side].hand.find((held) => {
    const card = CARD_POOL[state.cardIdByUid[held] ?? ""];
    return card?.category === "Pokemon" && card.stage === "Basic";
  });
  if (uid === undefined) throw new Error(`${side} was dealt no Basic`);
  return uid;
}

/** Setup against the LOCAL pool, P2's turn ended, so P1 is on `turn:action`. */
function table(seed: number): GameState {
  const created = createGame({ seed, decks: { p1: LOCAL_DECK, p2: LOCAL_DECK }, cardPool: CARD_POOL });
  if (!created.ok) throw new Error(`createGame: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = ok(applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first: "p2" }));
  while (state.phase.kind === "setup:drawExtra") {
    const pending = state.phase;
    const seat = (["p1", "p2"] as const).find((s) => !pending.decided[s]);
    if (seat === undefined) throw new Error("setup:drawExtra with every seat decided");
    state = ok(applyAction(state, { type: "setupDrawExtra", seat, count: pending.owed[seat] }));
  }
  for (const side of ["p1", "p2"] as const) {
    state = ok(applyAction(state, { type: "setupPlaceActive", seat: side, uid: firstBasic(state, side) }));
  }
  for (const side of ["p1", "p2"] as const) state = ok(applyAction(state, { type: "setupReady", seat: side }));
  return act(state, { type: "endTurn", seat: "p2" }).state;
}

function takeFromDeck(state: GameState, seat: Seat, cardId: string): [GameState, string] {
  const side = state.players[seat];
  const uid = side.deck.find((held) => state.cardIdByUid[held] === cardId);
  if (uid === undefined) throw new Error(`${seat}'s deck has no ${cardId}`);
  return [
    { ...state, players: { ...state.players, [seat]: { ...side, deck: side.deck.filter((u) => u !== uid) } } },
    uid,
  ];
}

/** `cardId` out of the deck into the Active Spot, an EMPTY Bench, and the dealt hand sent
    back to the bottom of the deck — so every hand card a case asserts on was placed by it. */
function field(state: GameState, seat: Seat, cardId: string): GameState {
  const [next, uid] = takeFromDeck(state, seat, cardId);
  const side = next.players[seat];
  return {
    ...next,
    players: {
      ...next.players,
      [seat]: {
        ...side,
        deck: [...side.deck, ...side.hand],
        active: makeInPlay(uid, next.turn),
        bench: [],
        hand: [],
      },
    },
  };
}

function attachN(state: GameState, seat: Seat, cardId: string, count: number): GameState {
  let next = state;
  for (let n = 0; n < count; n += 1) {
    const [taken, uid] = takeFromDeck(next, seat, cardId);
    const side = taken.players[seat];
    const active = side.active;
    if (active === null) throw new Error(`${seat} has no Active`);
    next = {
      ...taken,
      players: { ...taken.players, [seat]: { ...side, active: { ...active, energy: [...active.energy, uid] } } },
    };
  }
  return next;
}

function handN(state: GameState, seat: Seat, cardId: string, count: number): GameState {
  let next = state;
  for (let n = 0; n < count; n += 1) {
    const [taken, uid] = takeFromDeck(next, seat, cardId);
    const side = taken.players[seat];
    next = { ...taken, players: { ...taken.players, [seat]: { ...side, hand: [...side.hand, uid] } } };
  }
  return next;
}

function benchN(state: GameState, seat: Seat, cardId: string, count: number): GameState {
  let next = state;
  for (let n = 0; n < count; n += 1) {
    const [taken, uid] = takeFromDeck(next, seat, cardId);
    const side = taken.players[seat];
    next = {
      ...taken,
      players: { ...taken.players, [seat]: { ...side, bench: [...side.bench, makeInPlay(uid, taken.turn)] } },
    };
  }
  return next;
}

/** THE BOARD: P1's `d552-tide` with `onSelf` {W} attached (one of them pays the {C}
    cost), a hand of `water` Basic {W} plus two decoys that must NOT be offered (a Basic
    {R} and `fix-special`), two Benched bodies that must NOT be targets; P2's `target`. */
function board(
  seed: number,
  {
    onSelf = 2,
    water = 5,
    target = WALL,
    fireOnSelf = 0,
  }: { onSelf?: number; water?: number; target?: string; fireOnSelf?: number } = {},
): GameState {
  let state = table(seed);
  state = attachN(field(state, "p1", TIDE), "p1", WATER, onSelf);
  state = attachN(state, "p1", FIRE, fireOnSelf);
  state = benchN(state, "p1", BODY, 2);
  state = handN(state, "p1", WATER, water);
  state = handN(state, "p1", FIRE, 1);
  state = handN(state, "p1", "fix-special", 1);
  return field(state, "p2", target);
}

const surge = { type: "attack", seat: "p1", index: SURGE } as const;

function rowsOf<T extends GameEvent["type"]>(
  events: readonly GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
}

function parked(state: GameState) {
  if (state.phase.kind !== "effect:choose") throw new Error(`expected effect:choose, got ${state.phase.kind}`);
  const prompt = state.phase.prompt;
  if (prompt.kind !== "attachCards") throw new Error(`expected attachCards, got ${prompt.kind}`);
  return { phase: state.phase, prompt };
}

const SELF: PokemonRef = { seat: "p1", spot: { spot: "active" } };

function resolve(state: GameState, uids: readonly string[]) {
  return act(state, {
    type: "resolveEffect",
    seat: "p1",
    choice: { kind: "attachCards", assignments: uids.map((uid) => ({ uid, to: SELF })) },
  });
}

const dealtTo = (state: GameState, seat: Seat): number => state.players[seat].active?.damage ?? 0;

// ─────────────────────────────────────────────────────────────────────────────
// §3 — the offer.
// ─────────────────────────────────────────────────────────────────────────────

describe("D552 §3 — the offer is THIS Pokémon and the hand's Basic {W}, nothing else", () => {
  it("🛑 it PARKS, the sole target is the attacker, and Bench bodies are NOT offered", () => {
    const { state } = act(board(1), surge);
    const { prompt } = parked(state);
    expect(prompt.targets).toEqual([SELF]);
    expect(state.players.p1.bench).toHaveLength(2);
  });

  it("🛑 the candidates are exactly the hand's Basic {W} — the Basic {R} and the Special Energy are excluded", () => {
    const start = board(1);
    const { state } = act(start, surge);
    const { prompt } = parked(state);
    const hand = start.players.p1.hand;
    const water = hand.filter((uid) => start.cardIdByUid[uid] === WATER);
    expect(water).toHaveLength(5);
    expect([...prompt.candidates].sort()).toEqual([...water].sort());
    expect(prompt.max).toBe(5);
    for (const uid of hand.filter((u) => start.cardIdByUid[u] !== WATER)) {
      expect(prompt.candidates).not.toContain(uid);
    }
  });

  it("the caption says 'to this Pokémon' and drops 'in any way you like'", () => {
    const { state } = act(board(1), surge);
    expect(parked(state).prompt.note).toBe("Attach any number of Basic Water Energy cards from your hand to this Pokémon.");
  });

  it("🛑 NOTHING is dealt before the answer — the base is not dealt pre-program as well", () => {
    const { state, events } = act(board(1), surge);
    parked(state);
    expect(rowsOf(events, "DAMAGE_DEALT")).toEqual([]);
    expect(dealtTo(state, "p2")).toBe(0);
    expect(rowsOf(events, "ATTACK_EFFECT_SKIPPED")).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — the number.
// ─────────────────────────────────────────────────────────────────────────────

describe("D552 §4 — 30 × (W at declaration + W attached), dealt ONCE", () => {
  it("🛑 2 {W} on self + attach 5 → 210 (D503's figure), and the Energy stays attached", () => {
    const { state } = act(board(1), surge);
    const { prompt } = parked(state);
    const done = resolve(state, prompt.candidates);
    expect(dealtTo(done.state, "p2")).toBe(210);
    expect(rowsOf(done.events, "DAMAGE_DEALT").map((e) => e.dealt)).toEqual([210]);
    expect(done.state.players.p1.active?.energy).toHaveLength(7);
  });

  it("🛑 …and 210 IS the shipped head multiplier evaluated on the POST-attach board", () => {
    // The head is attack index 1 (`HEAD` alone, "30×" — `deriveAttackDamageMultiplier`'s
    // own path). Same seed, the same five {W} moved onto the body by hand BEFORE declaring.
    let state = board(1);
    const water = state.players.p1.hand.filter((uid) => state.cardIdByUid[uid] === WATER);
    const side = state.players.p1;
    const active = side.active;
    if (active === null) throw new Error("no Active");
    state = {
      ...state,
      players: {
        ...state.players,
        p1: {
          ...side,
          hand: side.hand.filter((u) => !water.includes(u)),
          active: { ...active, energy: [...active.energy, ...water] },
        },
      },
    };
    const head = act(state, { type: "attack", seat: "p1", index: HEAD_ONLY });
    expect(dealtTo(head.state, "p2")).toBe(210);
  });

  it("each partial answer counts ONLY what was attached — 0, 1, 3", () => {
    for (const take of [0, 1, 3]) {
      const { state } = act(board(1), surge);
      const { prompt } = parked(state);
      const done = resolve(state, prompt.candidates.slice(0, take));
      expect(dealtTo(done.state, "p2"), `take ${take}`).toBe(30 * (2 + take));
    }
  });

  it("🛑 DECLINE → 60, the declaration-time head, with nothing moved", () => {
    const { state } = act(board(1), surge);
    const done = resolve(state, []);
    expect(dealtTo(done.state, "p2")).toBe(60);
    expect(done.state.players.p1.active?.energy).toHaveLength(2);
    expect(rowsOf(done.events, "ENERGY_ATTACHED")).toEqual([]);
  });

  it("🛑 EMPTY HAND of Basic {W} → 60 with NO park", () => {
    const { state, events } = act(board(1, { water: 0 }), surge);
    expect(state.phase.kind).not.toBe("effect:choose");
    expect(dealtTo(state, "p2")).toBe(60);
    expect(rowsOf(events, "DAMAGE_DEALT").map((e) => e.dealt)).toEqual([60]);
  });

  it("the declaration-time count is READ, not assumed — 1 on self + attach 2 → 90; 3 on self + decline → 90", () => {
    {
      const { state } = act(board(2, { onSelf: 1 }), surge);
      const done = resolve(state, parked(state).prompt.candidates.slice(0, 2));
      expect(dealtTo(done.state, "p2")).toBe(90);
    }
    {
      const { state } = act(board(2, { onSelf: 3 }), surge);
      const done = resolve(state, []);
      expect(dealtTo(done.state, "p2")).toBe(90);
    }
  });

  it("🛑 the declaration-time head counts {W} ONLY — a {R} on the attacker is not a term: 2 {W} + 1 {R}, attach 1 → 90", () => {
    const { state } = act(board(1, { fireOnSelf: 1 }), surge);
    const done = resolve(state, parked(state).prompt.candidates.slice(0, 1));
    expect(done.state.players.p1.active?.energy).toHaveLength(4);
    expect(dealtTo(done.state, "p2")).toBe(90);
  });

  it("🛑 Weakness AND Resistance are applied ONCE, to the sum — (60 + 30) × 2 − 30 = 150, not two hits (120)", () => {
    const { state } = act(board(1, { target: WEAK_RESISTANT }), surge);
    const done = resolve(state, parked(state).prompt.candidates.slice(0, 1));
    expect(rowsOf(done.events, "DAMAGE_DEALT").map((e) => e.dealt)).toEqual([150]);
    expect(dealtTo(done.state, "p2")).toBe(150);
  });

  it("🛑 ENERGY_ATTACHED comes BEFORE DAMAGE_DEALT", () => {
    const { state } = act(board(1), surge);
    const done = resolve(state, parked(state).prompt.candidates.slice(0, 2));
    const types = done.events.map((e) => e.type);
    const lastAttach = types.lastIndexOf("ENERGY_ATTACHED");
    const hit = types.indexOf("DAMAGE_DEALT");
    expect(lastAttach).toBeGreaterThanOrEqual(0);
    expect(hit).toBeGreaterThan(lastAttach);
    expect(rowsOf(done.events, "ENERGY_ATTACHED")).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — the record, the persisted park and the rollback.
// ─────────────────────────────────────────────────────────────────────────────

describe("D552 §5 — the parked record round-trips byte-equal, and a rollback DROPS a live damage term", () => {
  it("🛑 the park's address is `phase.cont.pendingOp` + `rest`, and it carries both new keys and the declaration-time base", () => {
    const { state } = act(board(1), surge);
    const { phase } = parked(state);
    expect(phase.cont.pendingOp).toEqual({
      op: "attachFromHand",
      filter: { kind: "basicEnergy", energyType: "Water" },
      toSelf: true,
      recordAs: "moved",
    });
    expect(phase.cont.rest[0]).toEqual({ op: "damageDefender", base: 60, per: 30, count: "moved" });
  });

  it("🛑 a record parked mid-attach round-trips BYTE-EQUAL and resolves identically", () => {
    const { state } = act(board(1), surge);
    const wire = JSON.stringify(state);
    const revived = JSON.parse(wire) as GameState;
    expect(JSON.stringify(revived)).toBe(wire);
    const uids = parked(state).prompt.candidates;
    const a = resolve(state, uids);
    const b = resolve(revived, uids);
    expect(JSON.stringify(b.state)).toBe(JSON.stringify(a.state));
    expect(dealtTo(b.state, "p2")).toBe(210);
  });

  it("🛑 ROLLBACK, DRIVEN: the v33 apply arm (no `recordMoved`) deals 60 while the five Energy stay attached", () => {
    // HEAD's (9f4ec316) `attachFromHand` apply arm is
    //   `attachFromZoneApply(state, choice.assignments, "hand", ctx, events).state`
    // — it never files `recordAs`. On a v34 record parked here, that deploy therefore
    // attaches and files NOTHING, and the `damageDefender` in `rest` counts an empty
    // slot. Driven through THIS engine by removing the key the v33 arm ignores: the
    // parked op without `recordAs` is exactly what that arm computes. A dropped LIVE
    // damage term (150 of 210), detectable in the bytes and NOT inert on the board —
    // D456's second clause fails, so `MATCH_RECORD_VERSION` 33 → 34 (THE SEVENTH
    // POSITION, apps/api/src/lobby/match.ts). The red-capable proof inside the engine is
    // the mutant `D552-hand-apply-drops-the-record`.
    const { state } = act(board(1), surge);
    const { phase } = parked(state);
    const { recordAs: _dropped, ...v33Op } = phase.cont.pendingOp as Extract<EffectOp, { op: "attachFromHand" }>;
    const rollback: GameState = { ...state, phase: { ...phase, cont: { ...phase.cont, pendingOp: v33Op } } };
    const done = resolve(rollback, phase.prompt.kind === "attachCards" ? phase.prompt.candidates : []);
    expect(done.state.players.p1.active?.energy).toHaveLength(7);
    expect(dealtTo(done.state, "p2")).toBe(60);
    expect(engineVersion).toBe("0.453.0");
  });

  it("the dead end FILES AN EMPTY ANSWER — no source body means no target, and the slot is overwritten", () => {
    // `runProgram` with NO `sourceUid` (a Trainer context): the `toSelf` target set is
    // empty, so the op dead-ends — and a stale `moved` from an earlier writer must not
    // survive it into the count.
    const start = board(1);
    const program = discardScaledBoostProgram(MEMBER, 60);
    const events: GameEvent[] = [];
    const record = { moved: ["stale-a", "stale-b"] };
    const run = runProgram(start, program, { seat: "p1" }, events, record);
    expect(run.kind).toBe("done");
    expect(record.moved).toEqual([]);
    expect(rowsOf(events, "DAMAGE_DEALT").map((e) => e.dealt)).toEqual([60]);
  });

  it("⚠️ CONSTRUCTED: a `recordGate` on `moved` behind the hand attach gets its clause (`recordSlotOf` enrols the op)", () => {
    // No printing pairs the attach with an "If you do," consequent (D206's silent omission
    // is what this pins). The program is CONSTRUCTED and labelled so (D440).
    const start = board(1);
    const tide = start.players.p1.active;
    if (tide === null) throw new Error("no Active");
    const program: EffectOp[] = [
      { op: "attachFromHand", filter: { kind: "basicEnergy", energyType: "Water" }, toSelf: true, recordAs: "moved" },
      // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
      { op: "recordGate", slot: "moved", then: [{ op: "drawCards", count: 1 }] },
    ];
    const run = runProgram(start, program, { seat: "p1", sourceUid: tide.stack[tide.stack.length - 1] }, []);
    if (run.kind !== "parked") throw new Error("expected a park");
    expect(run.prompt.kind === "attachCards" ? run.prompt.note : "").toBe(
      "Attach any number of Basic Water Energy cards from your hand to this Pokémon. If you do, draw a card.",
    );
  });
});
