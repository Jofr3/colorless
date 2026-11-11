import manifest from "../package.json" with { type: "json" };
import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { matchesFilter } from "./cards";
import type { CardFilter } from "./effectTypes";
import { applyAction, conditionHolds, conditionNote, engineVersion, programFor } from "./index";
import type { GameState, Seat } from "./index";
import {
  FIXTURE_POOL,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  handFromDeck,
  must,
  setActiveFromDeck,
  driveSetup,
  roundTrip,
} from "./testFixtures";
import { isFirstTurnOf } from "./types";

const FAN_CALL_TEXT =
  "Once during your first turn, you may search your deck for up to 3 {C} Pokémon with 100 HP or less, reveal them, and put them into your hand. Then, shuffle your deck. You can't use more than 1 Fan Call Ability during your turn.";

function fanRotom(id: string): Card {
  return battler(id, {
    name: "Fan Rotom",
    hp: 70,
    retreat: 1,
    types: ["Colorless"],
    abilities: [{ type: "Ability", name: "Fan Call", effect: FAN_CALL_TEXT }],
  });
}

const LOCAL_CARDS: Record<string, Card> = {
  "sv07-118": fanRotom("sv07-118"),
  "sv08.5-085": fanRotom("sv08.5-085"),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const FAN_DECK = deckOf({
  "sv07-118": 4,
  "sv08.5-085": 4,
  "fix-basic-1": 4,
  "fix-victim": 4,
  "fix-stage1": 4,
  "fix-tough": 4,
  "fix-zero-hp": 2,
  "fix-psychic-1": 4,
  "fix-energy": 30,
});

function localSetup(seed: number, first: Seat): GameState {
  return driveSetup(seed, { p1: FAN_DECK, p2: FAN_DECK }, { pool: POOL, first });
}

function board(seed: number, first: Seat, seat: Seat, activeId = "sv07-118"): GameState {
  let state = localSetup(seed, first);
  state = setActiveFromDeck(state, seat, activeId);
  state = clearBench(state, seat);
  state = benchFromDeck(state, seat, "fix-basic-1");
  return state;
}

function passTurns(state: GameState, count: number): GameState {
  let next = state;
  for (let i = 0; i < count; i += 1) {
    if (next.phase.kind !== "turn:action") throw new Error(`stuck in ${next.phase.kind}`);
    next = must(applyAction(next, { type: "endTurn", seat: next.phase.seat }));
  }
  return next;
}

const ACTIVE = { spot: "active" } as const;
const BENCH_0 = { spot: "bench", index: 0 } as const;
const BENCH_1 = { spot: "bench", index: 1 } as const;

function useFanCall(
  state: GameState,
  seat: Seat,
  target: typeof ACTIVE | typeof BENCH_0 | typeof BENCH_1,
) {
  return applyAction(state, { type: "useAbility", seat, target, abilityName: "Fan Call" });
}

/** The parked `chooseCards` prompt, or a loud throw. */
function cardsPrompt(state: GameState) {
  const phase = state.phase;
  if (phase.kind !== "effect:choose" || phase.prompt.kind !== "chooseCards") {
    throw new Error(`expected a chooseCards park, got ${phase.kind}`);
  }
  return phase.prompt;
}

/** The distinct catalog ids a park is offering. */
function offeredIds(state: GameState): string[] {
  return [
    ...new Set(
      cardsPrompt(state).candidates.map((uid) => state.cardIdByUid[uid] ?? "<no catalog id>"),
    ),
  ].sort();
}

const SEEDS = [4, 19, 38, 57, 88] as const;

// ─────────────────────────────────────────────────────────────────────────────
// 1. The registry rows — the printed sentence, as data.
// ─────────────────────────────────────────────────────────────────────────────

describe("Fan Rotom — the two printings as registry data", () => {
  it("both ids resolve to ONE program carrying all four printed clauses", () => {
    for (const id of ["sv07-118", "sv08.5-085"]) {
      const ability = programFor(id)?.abilities?.[0];
      expect(ability?.name, id).toBe("Fan Call");
      expect(ability?.oncePerTurn, id).toBe("sharedByName");
      expect(ability?.playableIf, id).toEqual({ kind: "yourFirstTurn" });
      // No "in the Active Spot" clause is printed, which is also what makes the
      // benched-copy board in §6 reachable.
      expect(ability?.activeOnly, id).toBe(false);
      expect(ability?.program, id).toEqual([
        {
          op: "searchDeck",
          filter: { kind: "typedPokemon", pokemonType: "Colorless", maxHp: 100 },
          dest: "hand",
          max: 3,
          reveal: true,
        },
        { op: "shuffleDeck" },
      ]);
    }
  });

  it("the two printings share ONE program object — a reprint is not a second authoring", () => {
    expect(programFor("sv08.5-085")).toBe(programFor("sv07-118"));
  });

  it("no `trainerPlayableIf` was authored — this gate is on the ABILITY surface", () => {
    expect(programFor("sv07-118")?.trainerPlayableIf).toBeUndefined();
  });

  it("the filter carries NO `stage` — the printed noun has no stage word", () => {
    const ability = programFor("sv07-118")?.abilities?.[0];
    const op = ability?.program?.[0];
    expect(op?.op).toBe("searchDeck");
    expect(op?.op === "searchDeck" ? op.filter : undefined).not.toHaveProperty("stage");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. `isFirstTurnOf` — the derived read, at the unit.
// ─────────────────────────────────────────────────────────────────────────────

describe("isFirstTurnOf — the per-seat turn ORDINAL, derived and not stored", () => {
  /** A bare state carrying only the two fields the reader consults. Deliberately
      NOT a driven board: this is the arithmetic, and the arithmetic is total. */
  const at = (turn: number, firstPlayer: Seat | null) =>
    ({ turn, firstPlayer }) as unknown as GameState;

  it("turn 1 is the FIRST player's first turn and NOBODY else's", () => {
    expect(isFirstTurnOf(at(1, "p1"), "p1")).toBe(true);
    expect(isFirstTurnOf(at(1, "p1"), "p2")).toBe(false);
  });

  it("turn 2 is the SECOND player's first turn — the whole point of the reader", () => {
    // THE CASE `state.turn === 1` GETS WRONG. A build that read the turn number
    // alone would refuse the going-second seat's Ability on the only turn it is
    // printed for, and no board with p1 acting could ever show it.
    expect(isFirstTurnOf(at(2, "p1"), "p2")).toBe(true);
    expect(isFirstTurnOf(at(2, "p1"), "p1")).toBe(false);
  });

  it("MIRRORS when p2 goes first — the ordinal is per SEAT, not per seat NAME", () => {
    expect(isFirstTurnOf(at(1, "p2"), "p2")).toBe(true);
    expect(isFirstTurnOf(at(1, "p2"), "p1")).toBe(false);
    expect(isFirstTurnOf(at(2, "p2"), "p1")).toBe(true);
    expect(isFirstTurnOf(at(2, "p2"), "p2")).toBe(false);
  });

  it("is FALSE for both seats from turn 3 onward — it is an ORDINAL, not 'early'", () => {
    for (const turn of [3, 4, 5, 12]) {
      expect(isFirstTurnOf(at(turn, "p1"), "p1"), `turn ${turn}`).toBe(false);
      expect(isFirstTurnOf(at(turn, "p1"), "p2"), `turn ${turn}`).toBe(false);
    }
  });

  it("is FALSE during setup, with no null guard spelled", () => {
    // `firstPlayer` is null ONLY while `turn` is still 0, so the `? 2` branch
    // compares `0 === 2` and answers FALSE without a guard. A spelled-out
    // `firstPlayer !== null` would be a conjunct no board can make false.
    expect(isFirstTurnOf(at(0, null), "p1")).toBe(false);
    expect(isFirstTurnOf(at(0, null), "p2")).toBe(false);
  });

  it("§4's evolve ban and the printed gate ask the SAME function on a REAL board", () => {
    let state = localSetup(SEEDS[0], "p1");
    for (const turn of [1, 2, 3, 4]) {
      expect(state.turn, "the board really is on this turn").toBe(turn);
      for (const seat of ["p1", "p2"] as const) {
        const derived = isFirstTurnOf(state, seat);
        expect(conditionHolds(state, seat, { kind: "yourFirstTurn" }), `${seat}@${turn}`).toBe(
          derived,
        );
      }
      state = passTurns(state, 1);
    }
  });

  it("§4's EVOLVE BAN fires on exactly the turns the new gate opens on", () => {
    let state = localSetup(SEEDS[1], "p1");
    for (const turn of [1, 2, 3, 4]) {
      expect(state.turn).toBe(turn);
      const phase = state.phase;
      if (phase.kind !== "turn:action") throw new Error(`stuck in ${phase.kind}`);
      const seat = phase.seat;
      // A body that has been in play since setup (turnPlayed 0) plus its
      // Evolution in hand, so nothing but §4 can stand in the way.
      let board = setActiveFromDeck(state, seat, "fix-basic-1");
      board = handFromDeck(board, seat, "fix-stage1", 1);
      const uid = board.players[seat].hand.find((u) => board.cardIdByUid[u] === "fix-stage1");
      if (uid === undefined) throw new Error("fix-stage1 never reached the hand");
      const attempt = applyAction(board, { type: "evolve", seat, uid, target: ACTIVE });
      const banned = !attempt.ok && attempt.error.code === "FIRST_TURN_EVOLVE";
      expect(banned, `${seat}@${turn}`).toBe(isFirstTurnOf(board, seat));
      // …and the card gate answers identically on the very same board.
      expect(conditionHolds(board, seat, { kind: "yourFirstTurn" }), `${seat}@${turn}`).toBe(
        banned,
      );
      // Anti-vacuity: off the ban the evolution really does go through, so
      // "banned" is not just "this board never evolves".
      if (!banned) expect(attempt.ok, `${seat}@${turn}`).toBe(true);
      state = passTurns(state, 1);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. The `BoardCondition` member — `conditionHolds` and `conditionNote`.
// ─────────────────────────────────────────────────────────────────────────────

describe("BoardCondition.yourFirstTurn — the fifth turn-reading member", () => {
  const COND = { kind: "yourFirstTurn" } as const;

  it("holds for exactly ONE seat on turn 1 and the OTHER on turn 2", () => {
    for (const first of ["p1", "p2"] as const) {
      const second = first === "p1" ? "p2" : "p1";
      const turn1 = localSetup(SEEDS[1], first);
      expect(conditionHolds(turn1, first, COND)).toBe(true);
      expect(conditionHolds(turn1, second, COND)).toBe(false);
      const turn2 = passTurns(turn1, 1);
      expect(conditionHolds(turn2, second, COND)).toBe(true);
      expect(conditionHolds(turn2, first, COND)).toBe(false);
    }
  });

  it("is FALSE for BOTH seats once turn 3 opens", () => {
    const turn3 = passTurns(localSetup(SEEDS[1], "p1"), 2);
    expect(turn3.turn).toBe(3);
    for (const seat of ["p1", "p2"] as const) expect(conditionHolds(turn3, seat, COND)).toBe(false);
  });

  it("captions itself in the printed vocabulary", () => {
    expect(conditionNote(COND)).toBe("it is your first turn");
    expect(conditionNote(COND)).not.toBe(
      conditionNote({ kind: "yourPokemonKoedOnOpponentsLastTurn" }),
    );
  });
});

describe("CardFilter.typedPokemon.maxHp — the printed HP threshold", () => {
  const FAN: CardFilter = { kind: "typedPokemon", pokemonType: "Colorless", maxHp: 100 };
  const BARE: CardFilter = { kind: "typedPokemon", pokemonType: "Colorless" };

  it("ADMITS a {C} body at or under the threshold, at any stage", () => {
    expect(matchesFilter(FIXTURE_POOL["fix-basic-1"], FAN)).toBe(true); // 60, Basic
    expect(matchesFilter(FIXTURE_POOL["fix-victim"], FAN)).toBe(true); // 30, Basic
    expect(matchesFilter(FIXTURE_POOL["fix-stage1"], FAN)).toBe(true); // 90, Stage 1
    expect(matchesFilter(LOCAL_CARDS["sv07-118"], FAN)).toBe(true); // 70, the card itself
  });

  it("REFUSES a {C} body OVER the threshold — the rider is the whole point", () => {
    expect(matchesFilter(FIXTURE_POOL["fix-tough"], FAN)).toBe(false); // 120
    expect(matchesFilter(FIXTURE_POOL["fix-bigbody"], FAN)).toBe(false); // 200
    // …and it is a `<=`, not a `<`: "100 HP or less" includes 100 exactly.
    expect(matchesFilter(battler("t-exactly-100", { hp: 100, types: ["Colorless"] }), FAN)).toBe(
      true,
    );
    expect(matchesFilter(battler("t-just-over", { hp: 110, types: ["Colorless"] }), FAN)).toBe(
      false,
    );
  });

  it("REFUSES a NULL HP rather than admitting it — `null <= 100` is TRUE in JS", () => {
    expect(matchesFilter(FIXTURE_POOL["fix-zero-hp"], FAN)).toBe(false);
    // …and the SAME card passes the bare filter, so the refusal is the rider's
    // and not the type conjunct's.
    expect(matchesFilter(FIXTURE_POOL["fix-zero-hp"], BARE)).toBe(true);
  });

  it("REFUSES an off-type body under the threshold — the type conjunct is still live", () => {
    expect(matchesFilter(FIXTURE_POOL["fix-psychic-1"], FAN)).toBe(false); // 60 {P}
    expect(matchesFilter(FIXTURE_POOL["fix-grass-basic"], FAN)).toBe(false); // 60 {G}
  });

  it("ADMITS a DUAL-type body — the read is `.includes`, not `types[0]`", () => {
    const dual = battler("t-dual-c", { hp: 90, types: ["Water", "Colorless"] });
    expect(matchesFilter(dual, FAN)).toBe(true);
    expect(
      matchesFilter(battler("t-dual-big", { hp: 130, types: ["Water", "Colorless"] }), FAN),
    ).toBe(false);
  });

  it("is OPTIONAL — the bare member is UNCHANGED, which is what makes it a widening", () => {
    expect(matchesFilter(FIXTURE_POOL["fix-tough"], BARE)).toBe(true); // 120
    expect(matchesFilter(FIXTURE_POOL["fix-bigbody"], BARE)).toBe(true); // 200
  });

  it("leaves `basicPokemon.maxHp` alone — two members, one reading", () => {
    const basic: CardFilter = { kind: "basicPokemon", maxHp: 100 };
    expect(matchesFilter(FIXTURE_POOL["fix-basic-1"], basic)).toBe(true);
    expect(matchesFilter(FIXTURE_POOL["fix-stage1"], basic)).toBe(false);
    expect(matchesFilter(FIXTURE_POOL["fix-stage1"], FAN)).toBe(true);
    expect(matchesFilter(FIXTURE_POOL["fix-tough"], basic)).toBe(false); // 120
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. The park — the caption and the offer, which must agree.
// ─────────────────────────────────────────────────────────────────────────────

describe("the Fan Call park — `retrieveNoun` and the candidate set", () => {
  it("captions the offer with the printed THRESHOLD, not with the bare noun", () => {
    const parked = must(useFanCall(board(SEEDS[2], "p1", "p1"), "p1", ACTIVE));
    expect(cardsPrompt(parked).note).toBe(
      "Search your deck for up to 3 Colorless Pokémon with 100 HP or less into your hand.",
    );
  });

  it("OFFERS exactly the bodies the filter admits — the caption's own claim", () => {
    const parked = must(useFanCall(board(SEEDS[2], "p1", "p1"), "p1", ACTIVE));
    expect(offeredIds(parked)).toEqual([
      "fix-basic-1",
      "fix-stage1",
      "fix-victim",
      "sv07-118",
      "sv08.5-085",
    ]);
  });

  it("puts up to 3 chosen cards into the HAND and shuffles the deck", () => {
    const before = board(SEEDS[2], "p1", "p1");
    const handBefore = before.players.p1.hand.length;
    const deckBefore = before.players.p1.deck.length;
    const parked = must(useFanCall(before, "p1", ACTIVE));
    const picks = cardsPrompt(parked).candidates.slice(0, 3);
    expect(picks.length).toBe(3);
    const after = must(
      applyAction(parked, {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "cards", uids: picks },
      }),
    );
    expect(after.phase.kind).toBe("turn:action");
    expect(after.players.p1.hand.length).toBe(handBefore + 3);
    expect(after.players.p1.deck.length).toBe(deckBefore - 3);
    for (const uid of picks) expect(after.players.p1.hand).toContain(uid);
    // "up to 3" — the park's own `min: 0` is what makes taking FEWER legal.
    const none = must(
      applyAction(parked, {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "cards", uids: [] },
      }),
    );
    expect(none.players.p1.hand.length).toBe(handBefore);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. The board — the ordinal gate and the name lock, driven from BOTH seats.
// ─────────────────────────────────────────────────────────────────────────────

describe("Fan Call on a real board", () => {
  it("the FIRST player may use it on turn 1", () => {
    for (const seed of SEEDS) {
      const state = board(seed, "p1", "p1");
      expect(state.turn).toBe(1);
      expect(useFanCall(state, "p1", ACTIVE).ok, `seed ${seed}`).toBe(true);
    }
  });

  it("the SECOND player may use it on TURN 2 — the board `state.turn === 1` fails", () => {
    for (const seed of SEEDS) {
      const turn2 = passTurns(board(seed, "p1", "p2"), 1);
      expect(turn2.turn).toBe(2);
      expect(turn2.phase.kind === "turn:action" && turn2.phase.seat).toBe("p2");
      expect(useFanCall(turn2, "p2", ACTIVE).ok, `seed ${seed}`).toBe(true);
    }
  });

  it("and may NOT use it on turn 1, which is the OPPONENT's first turn", () => {
    const state = board(SEEDS[0], "p1", "p2");
    const rejected = useFanCall(state, "p2", ACTIVE);
    expect(rejected.ok).toBe(false);
  });

  it("REFUSES it on the seat's SECOND turn, naming the printed clause", () => {
    const turn3 = passTurns(board(SEEDS[0], "p1", "p1"), 2);
    expect(turn3.turn).toBe(3);
    const rejected = useFanCall(turn3, "p1", ACTIVE);
    expect(rejected.ok).toBe(false);
    if (rejected.ok) throw new Error("expected a refusal");
    expect(rejected.error.code).toBe("ABILITY_CONDITION_NOT_MET");
    expect(rejected.error.message).toContain("it is your first turn");
  });

  it("REFUSES it on turn 4 for the going-SECOND seat too", () => {
    const turn4 = passTurns(board(SEEDS[0], "p1", "p2"), 3);
    expect(turn4.turn).toBe(4);
    const rejected = useFanCall(turn4, "p2", ACTIVE);
    expect(rejected.ok).toBe(false);
  });

  it("the cross-copy lock: TWO DISTINCT printings share ONE use per turn", () => {
    let state = board(SEEDS[3], "p1", "p1");
    state = benchFromDeck(state, "p1", "sv08.5-085");
    const parked = must(useFanCall(state, "p1", ACTIVE));
    const resolved = must(
      applyAction(parked, {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "cards", uids: [] },
      }),
    );
    const second = useFanCall(resolved, "p1", BENCH_1);
    expect(second.ok).toBe(false);
    if (second.ok) throw new Error("expected a refusal");
    expect(second.error.code).toBe("ABILITY_ALREADY_USED");
  });

  it("an already-used Ability reports the LOCK, not the gate — the refusal ORDER", () => {
    const state = board(SEEDS[3], "p1", "p1");
    const parked = must(useFanCall(state, "p1", ACTIVE));
    const resolved = must(
      applyAction(parked, {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "cards", uids: [] },
      }),
    );
    const again = useFanCall(resolved, "p1", ACTIVE);
    expect(again.ok).toBe(false);
    if (again.ok) throw new Error("expected a refusal");
    expect(again.error.code).toBe("ABILITY_ALREADY_USED");
  });

  it("a BENCHED Fan Rotom may use it — no `activeOnly` is printed", () => {
    let state = localSetup(SEEDS[4], "p1");
    state = setActiveFromDeck(state, "p1", "fix-basic-1");
    state = clearBench(state, "p1");
    state = benchFromDeck(state, "p1", "sv07-118");
    state = benchFromDeck(state, "p1", "fix-victim");
    expect(useFanCall(state, "p1", BENCH_0).ok).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. The record boundary — DRIVEN, not argued.
// ─────────────────────────────────────────────────────────────────────────────

describe("MATCH_RECORD_VERSION stays 14", () => {
  it("a v14-shaped park — a `searchDeck` with NO `maxHp` — replays BENIGNLY", () => {
    const parked = must(useFanCall(board(SEEDS[2], "p1", "p1"), "p1", ACTIVE));
    const roundTripped = roundTrip(parked);
    expect(cardsPrompt(roundTripped).candidates.length).toBeGreaterThan(0);

    const legacy = JSON.parse(
      JSON.stringify(parked).replaceAll('"maxHp":100', '"unused":0'),
    ) as GameState;
    expect(cardsPrompt(legacy).note).toBe(cardsPrompt(parked).note);
    expect(cardsPrompt(legacy).candidates).toEqual(cardsPrompt(parked).candidates);
    // …and answering it still works, which is what "replays" means.
    const resumed = must(
      applyAction(legacy, {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "cards", uids: cardsPrompt(legacy).candidates.slice(0, 1) },
      }),
    );
    expect(resumed.phase.kind).toBe("turn:action");
  });

  it("a v14 GAMESTATE is missing nothing — the gate reads fields v14 already had", () => {
    // The direction a new `GameState` field would have broken. `turn` and
    // `firstPlayer` are on every persisted version, so a v14 snapshot answers
    // the new condition with no migration, no default and no `?? 0`.
    const state = board(SEEDS[0], "p1", "p1");
    const legacy = roundTrip(state);
    expect(conditionHolds(legacy, "p1", { kind: "yourFirstTurn" })).toBe(true);
    expect(useFanCall(legacy, "p1", ACTIVE).ok).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. The version debt — found on the way past, and GUARDED rather than fixed.
// ─────────────────────────────────────────────────────────────────────────────

describe("engineVersion and the package manifest are ONE number", () => {
  it("the constant IS the manifest's version", () => {
    expect(engineVersion).toBe(manifest.version);
  });

  it("and it is a real semver triple, so neither side can satisfy the tie with junk", () => {
    expect(engineVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
