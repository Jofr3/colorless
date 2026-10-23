import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { applyAction, createGame, handPlayBarred, programFor, redactGame } from "./index";
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

const MASSIVE_BODY_TEXT =
  "As long as this Pokémon is in the Active Spot, your opponent can't play any Stadium cards from their hand.";
const DAUNTING_GAZE_TEXT =
  "As long as this Pokémon is in the Active Spot, your opponent can't play any Item cards from their hand.";
const ITEM_LOCK_TEXT =
  "During your opponent's next turn, they can't play any Item cards from their hand.";
const GALVANTULA_TEXT = `Discard all Energy from this Pokémon. ${ITEM_LOCK_TEXT}`;

/** The CONTINUOUS `"Stadium"` source — the only sentence that can grey these rows. */
const COPPERAJAH = "sv06.5-042";
const TYRANITAR = "sv09-095";
const GALVANTULA = "sv07-051";

const STADIUM = "sv01-167";
const STADIUM_2 = "sv02-175";
const STADIUM_UNBUILT = "fix-stadium";
/** Potion — a plain Item with a board precondition every fixture satisfies. */
const ITEM = "sv01-188";
/** Professor's Research — the Supporter control. */
const SUPPORTER = "sv01-189";

/** The CONTROL body: same board, same hands, NO Ability and NO attack rider. */
const PLAIN = "fix-plain-wire";
/** The victim's Active — 340 HP, so §4's swing cannot Knock it Out and park the
    board on `ko:takePrizes`, where every refusal below would be the PHASE gate
    wearing the rule's name. */
const WALL = "fix-wire-wall";
/** A {L} Basic Energy, so §4's Galvantula ex can pay its PRINTED cost. */
const LIGHTNING = "fix-wire-lightning";

const LOCAL_CARDS: Record<string, Card> = {
  [COPPERAJAH]: battler(COPPERAJAH, {
    name: "Copperajah",
    hp: 160,
    retreat: 3,
    types: ["Metal"],
    stage: "Stage1",
    evolveFrom: "Cufant",
    abilities: [{ type: "Ability", name: "Massive Body", effect: MASSIVE_BODY_TEXT }],
  }),
  [TYRANITAR]: battler(TYRANITAR, {
    name: "Tyranitar",
    hp: 180,
    retreat: 3,
    types: ["Darkness"],
    stage: "Stage2",
    abilities: [{ type: "Ability", name: "Daunting Gaze", effect: DAUNTING_GAZE_TEXT }],
  }),
  [GALVANTULA]: battler(GALVANTULA, {
    name: "Galvantula ex",
    hp: 260,
    retreat: 1,
    types: ["Lightning"],
    stage: "Basic",
    attacks: [{ name: "Electro Web", cost: ["Lightning"], damage: "180", effect: GALVANTULA_TEXT }],
  }),
  [PLAIN]: battler(PLAIN, {
    name: "Plain Blocker",
    hp: 200,
    retreat: 1,
    types: ["Colorless"],
    stage: "Stage1",
  }),
  [WALL]: battler(WALL, {
    name: "Wire Wall",
    hp: 340,
    retreat: 3,
    types: ["Colorless"],
    stage: "Basic",
  }),
  [LIGHTNING]: {
    ...(FIXTURE_POOL["fix-fire-energy"] as Card),
    id: LIGHTNING,
    name: "Lightning Energy",
  },
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const WIRE_DECK = deckOf({
  [COPPERAJAH]: 4,
  [TYRANITAR]: 3,
  [GALVANTULA]: 3,
  [PLAIN]: 4,
  [WALL]: 4,
  [STADIUM]: 6,
  [STADIUM_2]: 5,
  [STADIUM_UNBUILT]: 5,
  [ITEM]: 5,
  [SUPPORTER]: 5,
  "fix-basic-1": 13,
  [LIGHTNING]: 3,
});

const SEEDS = [8311, 8317, 8329, 8353] as const;

function localSetup(seed: number, first: Seat): GameState {
  const created = createGame({ seed, decks: { p1: WIRE_DECK, p2: WIRE_DECK }, cardPool: POOL });
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

function board(seed: number, first: Seat, barrier: Seat, barrierId: string): GameState {
  let state = localSetup(seed, first);
  const victim = barrier === "p1" ? "p2" : "p1";
  state = setActiveFromDeck(state, barrier, barrierId);
  state = clearBench(state, barrier);
  state = benchFromDeck(state, barrier, "fix-basic-1");
  state = setActiveFromDeck(state, victim, WALL);
  state = clearBench(state, victim);
  state = benchFromDeck(state, victim, "fix-basic-1");
  state = attachFromDeck(state, barrier, LIGHTNING, 1);
  for (const seat of ["p1", "p2"] as const) {
    state = handFromDeck(state, seat, STADIUM, 1);
    state = handFromDeck(state, seat, STADIUM_2, 1);
    state = handFromDeck(state, seat, STADIUM_UNBUILT, 1);
    state = handFromDeck(state, seat, ITEM, 1);
    state = handFromDeck(state, seat, SUPPORTER, 1);
    state = setDamage(state, seat, 10);
  }
  return state;
}

/** Walk the clock so `seat` moves, at turn 3+ so §4's first-turn Supporter ban is
    spent. A bar and its absence are only observable on the barred seat's OWN turn. */
function turnOf(state: GameState, seat: Seat): GameState {
  let next = state;
  for (let i = 0; i < 12; i += 1) {
    if (next.phase.kind !== "turn:action") throw new Error(`stuck in ${next.phase.kind}`);
    if (next.phase.seat === seat && next.turn >= 3) return next;
    next = must(applyAction(next, { type: "endTurn", seat: next.phase.seat }));
  }
  throw new Error(`never reached ${seat}'s turn`);
}

function swing(state: GameState, seat: Seat): GameState {
  return must(applyAction(state, { type: "attack", seat, index: 0 }));
}

function play(state: GameState, seat: Seat, cardId: string): string {
  const uid = handUid(state, seat, cardId);
  const result = applyAction(deepFreeze(state), { type: "playTrainer", seat, uid });
  return result.ok ? "OK" : result.error.code;
}

function playOk(state: GameState, seat: Seat, cardId: string): GameState {
  return must(applyAction(state, { type: "playTrainer", seat, uid: handUid(state, seat, cardId) }));
}

function wireTrainerIds(state: GameState, seat: Seat): string[] {
  const phase = redactGame(state, seat).phase;
  if (phase.kind !== "turn:action") throw new Error(`expected turn:action, got ${phase.kind}`);
  return phase.trainers.map((t) => state.cardIdByUid[t.uid] ?? "?");
}

function wireDisabled(state: GameState, seat: Seat, cardId: string): boolean | undefined {
  const phase = redactGame(state, seat).phase;
  if (phase.kind !== "turn:action") throw new Error(`expected turn:action, got ${phase.kind}`);
  return phase.trainers.find((t) => t.uid === handUid(state, seat, cardId))?.disabled;
}

function wireRow(state: GameState, seat: Seat, cardId: string) {
  const phase = redactGame(state, seat).phase;
  if (phase.kind !== "turn:action") throw new Error(`expected turn:action, got ${phase.kind}`);
  return phase.trainers.find((t) => t.uid === handUid(state, seat, cardId));
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. THE DEAD GUARD, DECOMPOSED — why deleting the line moved nothing.
// ─────────────────────────────────────────────────────────────────────────────

describe("D288 §1 — the skipped line was DEAD CODE, and here is the arithmetic", () => {
  it("EVERY AUTHORED STADIUM HAS `program.stadium` AND NO `program.trainer`", () => {
    const stadiums = Object.values(POOL).filter(
      (c) => c.category === "Trainer" && c.trainerType === "Stadium",
    );
    expect(stadiums.length).toBe(8);
    expect(stadiums.filter((c) => programFor(c.id) !== undefined).length).toBe(7);
    expect(stadiums.filter((c) => programFor(c.id)?.stadium !== undefined).length).toBe(7);
    expect(stadiums.filter((c) => programFor(c.id)?.trainer !== undefined).length).toBe(0);
    const items = Object.values(POOL).filter(
      (c) => c.category === "Trainer" && c.trainerType === "Item",
    );
    expect(items.filter((c) => programFor(c.id)?.trainer !== undefined).length).toBeGreaterThan(0);
  });
});

describe("D288 §2 — the projection emits Stadium rows, and still withholds unbuilt ones", () => {
  it("AN AUTHORED STADIUM GETS A ROW; AN UNAUTHORED ONE STILL GETS NONE", () => {
    for (const seed of SEEDS) {
      const free = turnOf(board(seed, "p1", "p1", PLAIN), "p2");
      expect(wireTrainerIds(free, "p2")).toContain(STADIUM);
      expect(wireTrainerIds(free, "p2")).toContain(STADIUM_2);
      expect(wireTrainerIds(free, "p2")).not.toContain(STADIUM_UNBUILT);
      expect(wireDisabled(free, "p2", STADIUM_UNBUILT)).toBeUndefined();
      expect(play(free, "p2", STADIUM_UNBUILT)).toBe("TRAINER_NOT_SIMULATED");
    }
  });

  it("the row carries the four wire fields and NOTHING else — a diff PAIRED with a literal", () => {
    const free = turnOf(board(SEEDS[0], "p1", "p1", PLAIN), "p2");
    const stadium = wireRow(free, "p2", STADIUM);
    const item = wireRow(free, "p2", ITEM);
    if (stadium === undefined || item === undefined) throw new Error("expected both rows");
    expect(Object.keys(stadium).sort()).toEqual(Object.keys(item).sort());
    expect(Object.keys(stadium).sort()).toEqual(
      ["disabled", "name", "rareCandy", "reason", "uid"].sort(),
    );
    expect(stadium.rareCandy).toBe(false);
    expect(stadium.reason).toBeNull();
    expect(stadium.name).toBe(POOL[STADIUM]?.name);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. THE ENGINE IS THE ORACLE — both directions, barred board AND free board.
// ─────────────────────────────────────────────────────────────────────────────

describe("D288 §3 — the wire row is greyed EXACTLY when the engine refuses", () => {
  it("THE BAR GREYS BOTH STADIUM ROWS, AND `applyAction` IS THE ORACLE", () => {
    for (const seed of SEEDS) {
      for (const barrierId of [COPPERAJAH, PLAIN]) {
        const open = turnOf(board(seed, "p1", "p1", barrierId), "p2");
        for (const stadiumId of [STADIUM, STADIUM_2]) {
          const refused = play(open, "p2", stadiumId) !== "OK";
          expect(wireDisabled(open, "p2", stadiumId), `${barrierId}/${stadiumId}`).toBe(refused);
        }
      }
    }
  });

  it("THE BARRING SEAT'S OWN ROWS STAY LIT — the bar is on the OPPONENT's hand", () => {
    // The same board, the other seat. A mirror reading the ability off the wrong
    // side of the table is green on every line above and red here.
    for (const seed of SEEDS) {
      const own = turnOf(board(seed, "p1", "p1", COPPERAJAH), "p1");
      expect(wireDisabled(own, "p1", STADIUM)).toBe(false);
      expect(play(own, "p1", STADIUM)).toBe("OK");
    }
  });

  it("AN ITEM BAR LEAVES STADIUM ROWS LIT — the CLASS control", () => {
    // Tyranitar's sentence is Copperajah's with one noun changed. A mirror that
    // greyed Stadium rows off `handPlayBarred(…, "Item", undefined)`, or off "is this seat
    // barred at all", passes §3.1 and fails here.
    for (const seed of SEEDS) {
      const items = turnOf(board(seed, "p1", "p1", TYRANITAR), "p2");
      expect(wireDisabled(items, "p2", STADIUM)).toBe(false);
      expect(wireDisabled(items, "p2", STADIUM_2)).toBe(false);
      expect(wireDisabled(items, "p2", ITEM)).toBe(true);
      expect(wireDisabled(items, "p2", SUPPORTER)).toBe(false);
      expect(play(items, "p2", STADIUM)).toBe("OK");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. THE STAMPED SOURCE CANNOT NAME A STADIUM — one funnel, two sources.
// ─────────────────────────────────────────────────────────────────────────────

describe("D288 §4 — a STAMPED Item bar greys Items and leaves Stadiums lit", () => {
  it('a STAMPED ITEM bar leaves the Stadium rows LIT, DRIVEN OFF A REAL ATTACK ( D636 (D539): ~~`StampedHandPlayClass` HAS NO `"Stadium"` MEMBER~~ WITHDRAWN — Scorching Earth stamps it, keyed apart from `Item`)', () => {
    for (const seed of SEEDS) {
      const stamped = swing(turnOf(board(seed, "p1", "p1", GALVANTULA), "p1"), "p1");
      const open = turnOf(stamped, "p2");
      expect(wireDisabled(open, "p2", ITEM)).toBe(true);
      expect(handPlayBarred(open, "p2", "Item", undefined)).toBe(true);
      expect(handPlayBarred(open, "p2", "Stadium", undefined)).toBe(false);
      expect(wireDisabled(open, "p2", STADIUM)).toBe(false);
      expect(play(open, "p2", STADIUM)).toBe("OK");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. §7.3's OWN TWO MECHANICS ON THE WIRE — the allowance and the same name.
// ─────────────────────────────────────────────────────────────────────────────

describe("D288 §5 — the once-per-turn allowance and the same-name rule", () => {
  it("AFTER A STADIUM PLAY, EVERY STADIUM ROW GOES DARK — §7.3's allowance", () => {
    for (const seed of SEEDS) {
      const open = turnOf(board(seed, "p1", "p1", PLAIN), "p2");
      expect(wireDisabled(open, "p2", STADIUM_2)).toBe(false);
      const after = playOk(open, "p2", STADIUM);
      expect(after.allowances.stadiumPlayed).toBe(true);
      expect(wireDisabled(after, "p2", STADIUM_2)).toBe(true);
      expect(play(after, "p2", STADIUM_2)).toBe("STADIUM_ALREADY_PLAYED");
      expect(wireDisabled(after, "p2", ITEM)).toBe(false);
    }
  });

  it("THE SAME NAME CANNOT REPLACE ITSELF, AND THE WIRE READS THE NAME", () => {
    for (const seed of SEEDS) {
      const open = turnOf(board(seed, "p1", "p1", PLAIN), "p2");
      const occupied = playOk(open, "p2", STADIUM);
      const next = turnOf(occupied, "p1");
      expect(next.allowances.stadiumPlayed).toBe(false);
      expect(wireDisabled(next, "p1", STADIUM)).toBe(true);
      expect(play(next, "p1", STADIUM)).toBe("STADIUM_SAME_NAME");
      // The DIFFERENT-named Stadium is lit on the same board — so the greying
      // above is the NAME and not "a Stadium is in play".
      expect(wireDisabled(next, "p1", STADIUM_2)).toBe(false);
      expect(play(next, "p1", STADIUM_2)).toBe("OK");
    }
  });

  it("the bar is ordered ABOVE §7.3's mechanics — a barred seat is barred, not 'already played'", () => {
    for (const seed of SEEDS) {
      const barred = turnOf(board(seed, "p1", "p1", COPPERAJAH), "p2");
      expect(play(barred, "p2", STADIUM_UNBUILT)).toBe("HAND_PLAY_BLOCKED");
      expect(wireDisabled(barred, "p2", STADIUM)).toBe(true);
      expect(play(barred, "p2", STADIUM)).toBe("HAND_PLAY_BLOCKED");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. THE OPPONENT AND THE SPECTATOR — the widening leaks nothing.
// ─────────────────────────────────────────────────────────────────────────────

describe("D288 §6 — the new rows reach ONLY the acting viewer", () => {
  it("THE NON-ACTING VIEWER AND THE SPECTATOR SEE NO TRAINER ROWS AT ALL", () => {
    for (const seed of SEEDS) {
      const open = turnOf(board(seed, "p1", "p1", PLAIN), "p2");
      const opponent = redactGame(open, "p1").phase;
      if (opponent.kind !== "turn:action") throw new Error("expected turn:action");
      expect(opponent.trainers).toEqual([]);
      const spectator = redactGame(open, "p2", true).phase;
      if (spectator.kind !== "turn:action") throw new Error("expected turn:action");
      expect(spectator.trainers).toEqual([]);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. MATCH_RECORD_VERSION — 16, UNCHANGED, DRIVEN BOTH WAYS ON BOTH BOARDS.
// ─────────────────────────────────────────────────────────────────────────────

describe("D288 §7 — the version does NOT move, and the claim is driven", () => {
  it("A v16 RECORD ANSWERS THE NEW QUESTION — a PROJECTION, not a persisted byte", () => {
    for (const seed of SEEDS) {
      const barred = turnOf(board(seed, "p1", "p1", COPPERAJAH), "p2");
      const reloaded = JSON.parse(JSON.stringify(barred)) as GameState;
      expect(wireTrainerIds(reloaded, "p2")).toContain(STADIUM);
      expect(wireDisabled(reloaded, "p2", STADIUM)).toBe(true);
      expect(play(reloaded, "p2", STADIUM)).toBe("HAND_PLAY_BLOCKED");
      const free = turnOf(board(seed, "p1", "p1", PLAIN), "p2");
      const freeReloaded = JSON.parse(JSON.stringify(free)) as GameState;
      expect(wireTrainerIds(freeReloaded, "p2")).toContain(STADIUM);
      expect(wireDisabled(freeReloaded, "p2", STADIUM)).toBe(false);
      expect(play(freeReloaded, "p2", STADIUM)).toBe("OK");
    }
  });

  it("NOTHING PERSISTED MOVED — the diff, PAIRED with the literal key anchors", () => {
    const barred = turnOf(board(SEEDS[0], "p1", "p1", COPPERAJAH), "p2");
    const free = turnOf(board(SEEDS[0], "p1", "p1", PLAIN), "p2");
    expect(Object.keys(barred).sort()).toEqual(Object.keys(free).sort());
    expect(Object.keys(barred).sort()).toEqual(
      [
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
        "recentAttackers",
        "rngState",
        "stadium",
        "turn",
      ].sort(),
    );
    for (const seat of ["p1", "p2"] as const) {
      expect(Object.keys(barred.handPlayLockedTurn[seat]).sort()).toEqual(
        ["Item", "Supporter", "Stadium", "evolve"].sort(),
      );
    }
    const phase = redactGame(barred, "p2").phase;
    expect(Object.keys(phase).sort()).toEqual(
      [
        "abilities",
        "attacks",
        "discardable",
        "kind",
        "rareCandy",
        "retreat",
        "stadiumAbility",
        "trainers",
      ].sort(),
    );
  });
});
