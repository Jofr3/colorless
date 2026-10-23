import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { applyAction, createGame, programFor } from "./index";
import type { GameState, Seat } from "./index";
import {
  FIXTURE_POOL,
  battler,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  deckOf,
  deepFreeze,
  handFromDeck,
  handUid,
  setActiveFromDeck,
  setDamage,
  must,
  firstBasicInHand,
} from "./testFixtures";

// ─────────────────────────────────────────────────────────────────────────────
// The printed strings, byte-exact off the D1 rows.
// ─────────────────────────────────────────────────────────────────────────────

const LAVA_ZONE_TEXT =
  "Whenever your opponent's Active Pokémon moves to the Bench during their turn, their new Active Pokémon is now Burned.";
const GNAWING_CURSE_TEXT =
  "Whenever your opponent attaches an Energy card from their hand to 1 of their Pokémon, put 2 damage counters on that Pokémon.";

const MAGCARGO = "sv05-029";
const DACHSBUN = "sv01-099";
const TING_LU = "sv02-127";
const SWITCH = "sv01-194"; // Item — "Switch your Active Pokémon with 1 of your Benched Pokémon."
const BOSS = "sv02-172"; // Supporter — the gust
/** Retreat cost ZERO, so §2 pays nothing and a `RETREAT_COST_MISMATCH` can never
    be mistaken for an absent trigger. */
const FREE = "fix-basic-0";
const BASIC = "fix-basic-1";
/** A body with NO Ability at all: every "the trigger fired" line below passes
    just as happily on a build that Burns on every bench move. */
const PLAIN = "fix-lava-plain";
const FLUTTER_MANE = "sv05-078";
const FLUTTERING_TEXT =
  "As long as this Pokémon is in the Active Spot, your opponent's Active Pokémon has no Abilities, except for Midnight Fluttering.";

function magcargo(id: string): Card {
  return battler(id, {
    name: "Magcargo",
    hp: 120,
    retreat: 4,
    types: ["Fire"],
    stage: "Stage1",
    evolveFrom: "Slugma",
    abilities: [{ type: "Ability", name: "Lava Zone", effect: LAVA_ZONE_TEXT }],
  });
}

const LOCAL_CARDS: Record<string, Card> = {
  [MAGCARGO]: magcargo(MAGCARGO),
  [PLAIN]: battler(PLAIN, {
    name: "Plain Watcher",
    hp: 200,
    retreat: 1,
    types: ["Fire"],
    attacks: [{ name: "Nothing At All", cost: ["Fire"], damage: "30" }],
  }),
  [FLUTTER_MANE]: battler(FLUTTER_MANE, {
    name: "Flutter Mane",
    hp: 90,
    retreat: 1,
    types: ["Psychic"],
    abilities: [{ type: "Ability", name: "Midnight Fluttering", effect: FLUTTERING_TEXT }],
  }),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const LAVA_DECK = deckOf({
  [MAGCARGO]: 4,
  [PLAIN]: 4,
  [DACHSBUN]: 4,
  [TING_LU]: 4,
  [SWITCH]: 4,
  [BOSS]: 4,
  [FREE]: 16,
  [BASIC]: 12,
  "fix-fire-energy": 8,
});

const FLUTTER_DECK = deckOf({
  [MAGCARGO]: 4,
  [PLAIN]: 4,
  [DACHSBUN]: 4,
  [TING_LU]: 4,
  [SWITCH]: 4,
  [BOSS]: 4,
  [FREE]: 12,
  [FLUTTER_MANE]: 4,
  [BASIC]: 12,
  "fix-fire-energy": 8,
});

const SEEDS = [9041, 9043, 9049] as const;

function localSetup(seed: number, first: Seat, deck: string[] = LAVA_DECK): GameState {
  const created = createGame({ seed, decks: { p1: deck, p2: deck }, cardPool: POOL });
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

function board(
  seed: number,
  first: Seat,
  watcher: Seat,
  watcherIds: readonly string[],
  actorBenched: string = BASIC,
  deck: string[] = LAVA_DECK,
): GameState {
  let state = localSetup(seed, first, deck);
  const actor = watcher === "p1" ? "p2" : "p1";
  state = setActiveFromDeck(state, watcher, watcherIds[0] ?? PLAIN);
  state = clearBench(state, watcher);
  state = benchFromDeck(state, watcher, BASIC);
  for (const id of watcherIds.slice(1)) state = benchFromDeck(state, watcher, id);
  state = setActiveFromDeck(state, actor, FREE);
  state = clearBench(state, actor);
  state = benchFromDeck(state, actor, actorBenched);
  return state;
}

/** Walk the clock so `seat` moves on turn 3 or later — no §4 ban applies to a
    retreat, but a Supporter is barred on the going-first player's first turn and
    the three routes below must be compared on one clock. */
function turnOf(state: GameState, seat: Seat): GameState {
  let next = state;
  for (let i = 0; i < 12; i += 1) {
    if (next.phase.kind !== "turn:action") throw new Error(`stuck in ${next.phase.kind}`);
    if (next.phase.seat === seat && next.turn >= 3) return next;
    next = must(applyAction(next, { type: "endTurn", seat: next.phase.seat }));
  }
  throw new Error(`never reached ${seat}'s turn`);
}

function retreat(state: GameState, seat: Seat): ReturnType<typeof applyAction> {
  return applyAction(deepFreeze(state), {
    type: "retreat",
    seat,
    discardEnergy: [],
    promoteBenchIndex: 0,
  });
}

/** Drain the §8.1 KO interrupt: the KOing seat takes its prizes, the KO'd seat
    promotes (a lone benched body auto-promotes, so only the prize pick parks). */
function drainKo(state: GameState): GameState {
  let next = state;
  for (let i = 0; i < 4; i += 1) {
    const phase = next.phase;
    if (phase.kind === "ko:takePrizes") {
      next = must(
        applyAction(next, {
          type: "takePrizes",
          seat: phase.seat,
          prizeIndices: Array.from({ length: phase.count }, (_, k) => k),
        }),
      );
      continue;
    }
    if (phase.kind === "ko:promote") {
      next = must(applyAction(next, { type: "promote", seat: phase.seat, benchIndex: 0 }));
      continue;
    }
    return next;
  }
  throw new Error(`KO interrupt never drained (${next.phase.kind})`);
}

function playTrainer(state: GameState, seat: Seat, cardId: string): ReturnType<typeof applyAction> {
  const withCard = handFromDeck(state, seat, cardId, 1);
  return applyAction(deepFreeze(withCard), {
    type: "playTrainer",
    seat,
    uid: handUid(withCard, seat, cardId),
  });
}

function burned(state: GameState, seat: Seat): boolean {
  return state.players[seat].active?.conditions.burned === true;
}

function activeId(state: GameState, seat: Seat): string | undefined {
  const uid = state.players[seat].active?.stack.at(-1);
  return uid === undefined ? undefined : state.cardIdByUid[uid];
}

function triggerEvents(result: ReturnType<typeof applyAction>): { seat: Seat; ability: string }[] {
  if (!result.ok) throw new Error("action failed");
  return result.events.flatMap((e) =>
    e.type === "ABILITY_TRIGGERED" ? [{ seat: e.seat, ability: e.ability }] : [],
  );
}

describe("§0 — the printed sentence and its registry row", () => {
  it("the Ability text in this suite's pool is the D1 row, byte for byte", () => {
    expect(POOL[MAGCARGO]?.abilities).toEqual([
      { type: "Ability", name: "Lava Zone", effect: LAVA_ZONE_TEXT },
    ]);
  });

  it("the program is ONE triggered row: the new timing, the watched direction, no stack flag", () => {
    expect(programFor(MAGCARGO)).toEqual({
      triggered: [
        {
          name: "Lava Zone",
          trigger: "onActiveMovedToBench",
          opponentAction: true,
          program: [{ op: "applyStatus", target: "defender", status: "burned" }],
        },
      ],
    });
  });

  it("`doesNotStack` is ABSENT, and the print is the reason — the sentence does not carry the clause", () => {
    const row = programFor(MAGCARGO)?.triggered?.[0];
    expect(row?.doesNotStack).toBeUndefined();
    expect(LAVA_ZONE_TEXT).not.toContain("doesn't stack");
    expect(GNAWING_CURSE_TEXT).not.toContain("doesn't stack");
    expect(programFor("sv05-104")?.triggered?.[0]?.doesNotStack).toBeUndefined();
    expect(programFor("sv10-074")?.triggered?.[0]?.doesNotStack).toBe(true);
  });

  it("the consequent is `defender` and NOT `damageSubject` — the two name different bodies", () => {
    const program = programFor(MAGCARGO)?.triggered?.[0]?.program ?? [];
    expect(program.some((op) => op.op === "damageSubject")).toBe(false);
    expect(program).toEqual([{ op: "applyStatus", target: "defender", status: "burned" }]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 1-3. THE THREE ROUTES A BODY TAKES FROM THE ACTIVE SPOT TO THE BENCH.
// ─────────────────────────────────────────────────────────────────────────────

describe("§1-3 — every Active→Bench route on the actor's own turn Burns the new Active", () => {
  for (const seed of SEEDS) {
    it(`RETREAT fires it (seed ${seed}) — and this route never calls \`switchInto\``, () => {
      const start = turnOf(board(seed, "p1", "p1", [MAGCARGO]), "p2");
      expect(burned(start, "p2")).toBe(false);
      const result = retreat(start, "p2");
      expect(result.ok).toBe(true);
      const next = must(result);
      expect(activeId(next, "p2")).toBe(BASIC);
      expect(burned(next, "p2")).toBe(true);
      expect(triggerEvents(result)).toEqual([{ seat: "p1", ability: "Lava Zone" }]);
    });

    it(`a SWITCH played by the actor fires it (seed ${seed})`, () => {
      const start = turnOf(board(seed, "p1", "p1", [MAGCARGO]), "p2");
      const result = playTrainer(start, "p2", SWITCH);
      expect(result.ok).toBe(true);
      const next = must(result);
      expect(next.phase.kind).toBe("turn:action"); // a one-body bench never parks
      expect(activeId(next, "p2")).toBe(BASIC);
      expect(burned(next, "p2")).toBe(true);
    });
  }

  it("the WATCHER's Magcargo may sit on the BENCH — the sentence prints no Active-Spot clause", () => {
    const start = turnOf(board(SEEDS[0], "p1", "p1", [PLAIN, MAGCARGO]), "p2");
    const next = must(retreat(start, "p2"));
    expect(activeId(start, "p1")).toBe(PLAIN);
    expect(burned(next, "p2")).toBe(true);
  });

  it("a board with NO Magcargo Burns nobody — the control every line above needs", () => {
    for (const seed of SEEDS) {
      const start = turnOf(board(seed, "p1", "p1", [PLAIN]), "p2");
      const result = retreat(start, "p2");
      const next = must(result);
      expect(activeId(next, "p2")).toBe(BASIC);
      expect(burned(next, "p2")).toBe(false);
      expect(triggerEvents(result)).toEqual([]);
    }
  });
});

describe("§4 — a Boss's Orders is the same move on the WRONG turn, and Lava Zone stays silent", () => {
  for (const seed of SEEDS) {
    it(`the watcher gusts the actor's Active to the Bench and nothing Burns (seed ${seed})`, () => {
      const start = turnOf(board(seed, "p1", "p1", [MAGCARGO]), "p1");
      const result = playTrainer(start, "p1", BOSS);
      expect(result.ok).toBe(true);
      const next = must(result);
      expect(next.phase.kind).toBe("turn:action");
      // the gust happened…
      expect(activeId(next, "p2")).toBe(BASIC);
      // …and nobody is Burned.
      expect(burned(next, "p2")).toBe(false);
      expect(burned(next, "p1")).toBe(false);
      expect(triggerEvents(result)).toEqual([]);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. THE DIRECTION — the watcher's own retreat.
// ─────────────────────────────────────────────────────────────────────────────

describe("§5 — the scan direction: Magcargo does not Burn its own side", () => {
  it("the watcher retreats on the watcher's turn and neither seat is Burned", () => {
    for (const seed of SEEDS) {
      // Magcargo sits on p1's BENCH so p1's Active can retreat with it in play.
      // The WATCHER's Active is the retreat-0 body and its Magcargo sits on
      // the Bench, so the watcher can make the very move it is watching for.
      const start = turnOf(board(seed, "p1", "p1", [FREE, MAGCARGO]), "p1");
      const result = retreat(start, "p1");
      const next = must(result);
      expect(activeId(next, "p1")).toBe(BASIC);
      expect(burned(next, "p1")).toBe(false);
      expect(burned(next, "p2")).toBe(false);
      expect(triggerEvents(result)).toEqual([]);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. THE §8.1 PROMOTION IS NOT A BENCH MOVE.
// ─────────────────────────────────────────────────────────────────────────────

describe("§6 — a Knocked Out Active goes to the DISCARD, so nothing moved to the Bench", () => {
  it("the actor's Active is KO'd on the WATCHER's turn and the promoted body is not Burned", () => {
    let state = turnOf(board(SEEDS[0], "p1", "p1", [PLAIN, MAGCARGO]), "p1");
    state = attachFromDeck(state, "p1", "fix-fire-energy", 1);
    state = setDamage(state, "p2", 55); // fix-basic-0 has 60 HP; Plain Watcher hits for 30
    const result = applyAction(deepFreeze(state), { type: "attack", seat: "p1", index: 0 });
    expect(result.ok).toBe(true);
    // The §8.1 interrupt parks on the KOing player's prize pick; drain it, so
    // the assertion below is about the PROMOTED board and not about the park.
    const next = drainKo(must(result));
    // The KO resolved and p2's lone benched body came up.
    expect(activeId(next, "p2")).toBe(BASIC);
    expect(burned(next, "p2")).toBe(false);
    expect(triggerEvents(result).filter((e) => e.ability === "Lava Zone")).toEqual([]);
  });
});

describe("§7 — two Magcargo are TWO firings, and only the log can see it", () => {
  it("two Magcargo emit two ABILITY_TRIGGERED rows on one retreat", () => {
    const start = turnOf(board(SEEDS[0], "p1", "p1", [MAGCARGO, MAGCARGO]), "p2");
    const result = retreat(start, "p2");
    const next = must(result);
    expect(burned(next, "p2")).toBe(true);
    expect(triggerEvents(result)).toEqual([
      { seat: "p1", ability: "Lava Zone" },
      { seat: "p1", ability: "Lava Zone" },
    ]);
  });

  it("the BOARD cannot tell one firing from two — which is why the flag is read off the print", () => {
    const one = must(retreat(turnOf(board(SEEDS[1], "p1", "p1", [MAGCARGO]), "p2"), "p2"));
    const two = must(
      retreat(turnOf(board(SEEDS[1], "p1", "p1", [MAGCARGO, MAGCARGO]), "p2"), "p2"),
    );
    expect(one.players.p2.active?.conditions).toEqual(two.players.p2.active?.conditions);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. §12 — the printed IMMUNITY refuses it, and the fold is what answers.
// ─────────────────────────────────────────────────────────────────────────────

describe("§8 — Dachsbun's “This Pokémon can't be Burned.” refuses the trigger", () => {
  it("a Dachsbun promoted into the Active Spot takes no Burn", () => {
    const start = turnOf(board(SEEDS[0], "p1", "p1", [MAGCARGO], DACHSBUN), "p2");
    const result = retreat(start, "p2");
    const next = must(result);
    expect(activeId(next, "p2")).toBe(DACHSBUN);
    expect(burned(next, "p2")).toBe(false);
    // The Ability still FIRED — the refusal is §12's, at the op, not the scan's.
    expect(triggerEvents(result)).toEqual([{ seat: "p1", ability: "Lava Zone" }]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. §9 — an Ability-lock aura silences it, because Lava Zone IS an Ability.
// ─────────────────────────────────────────────────────────────────────────────

describe("§9 — THE ABILITY-LOCK CASE IS REFUSED, AND THE REFUSAL IS THE RESULT", () => {
  it("the five lock printings are all narrower than this row, checked against the registry", () => {
    expect(programFor("sv01-096")?.passive?.disableAbilities?.stage).toBe("Basic");
    expect(programFor("sv02-089")?.passive?.disableAbilities?.stage).toBe("Basic");
    expect(programFor("sv02-127")?.passive?.disableAbilities?.requiresActive).toBe(true);
    expect(programFor("sv05-078")?.passive?.disableAbilities?.requiresActive).toBe(true);
    expect(programFor("sv05-078")?.passive?.disableAbilities?.side).toBe("opponent");
    expect(programFor("sv08-107")?.passive?.disableAbilities?.stage).toBe("Stage2");
    // …and Magcargo is the Stage 1 the first two cannot name.
    expect(POOL[MAGCARGO]?.stage).toBe("Stage1");
  });

  it("D559 landing — a Flutter Mane PROMOTED into the actor's Active locks an Active Magcargo, so Lava Zone does NOT fire", () => {
    for (const seed of SEEDS) {
      // The control, on the SAME deck and seed: the actor retreats into a plain
      // Basic and Lava Zone fires and Burns — so the refusal below is the lock.
      const control = turnOf(board(seed, "p1", "p1", [MAGCARGO], BASIC, FLUTTER_DECK), "p2");
      const fired = retreat(control, "p2");
      expect(activeId(must(fired), "p2")).toBe(BASIC);
      expect(burned(must(fired), "p2")).toBe(true);
      expect(triggerEvents(fired)).toEqual([{ seat: "p1", ability: "Lava Zone" }]);

      // The lock: the actor retreats INTO Flutter Mane. The post-move board is
      // the one `triggersOf` gates on, and on it Flutter Mane is the opponent's
      // Active, so the watcher's Active Magcargo has no Abilities.
      const start = turnOf(board(seed, "p1", "p1", [MAGCARGO], FLUTTER_MANE, FLUTTER_DECK), "p2");
      expect(activeId(start, "p1")).toBe(MAGCARGO);
      const result = retreat(start, "p2");
      expect(result.ok).toBe(true);
      const next = must(result);
      expect(activeId(next, "p2")).toBe(FLUTTER_MANE);
      expect(burned(next, "p2")).toBe(false);
      expect(triggerEvents(result)).toEqual([]);
    }
  });
});
