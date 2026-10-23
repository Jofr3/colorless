import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { applyAction, handPlayBarred, programFor, redactGame } from "./index";
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
  driveSetup,
  roundTrip,
} from "./testFixtures";

const MASSIVE_BODY_TEXT =
  "As long as this Pokémon is in the Active Spot, your opponent can't play any Stadium cards from their hand.";
const DAUNTING_GAZE_TEXT =
  "As long as this Pokémon is in the Active Spot, your opponent can't play any Item cards from their hand.";
/** The STAMPED Item lock's printed rider — §5's proof that the stamp cannot
    name a Stadium is driven off a real attack, not off the type alone. */
const ITEM_LOCK_TEXT =
  "During your opponent's next turn, they can't play any Item cards from their hand.";
const GALVANTULA_TEXT = `Discard all Energy from this Pokémon. ${ITEM_LOCK_TEXT}`;

const COPPERAJAH = "sv06.5-042";
/** The CONTINUOUS `"Item"` source — the CLASS control. Tyranitar's sentence is
    this one with a different noun, so a build that collapsed the class list to
    "any Trainer" is green on §2 and RED on §3. */
const TYRANITAR = "sv09-095";
/** The STAMPED `"Item"` source (an attack rider) — §5's other half. */
const GALVANTULA = "sv07-051";
const TING_LU = "sv02-127";

const STADIUM = "sv01-167";
/** Calamitous Wasteland — a SECOND authored Stadium with a DIFFERENT name, so
    §4 can drive §7.3's once-per-turn allowance without §7.3's same-name rule
    being the reason the second play fails. */
const STADIUM_2 = "sv02-175";
const STADIUM_UNBUILT = "fix-stadium";
/** Potion — a plain Item with a board precondition every fixture satisfies. */
const ITEM = "sv01-188";
/** Professor's Research — the Supporter control. */
const SUPPORTER = "sv01-189";

/** The CONTROL body: same board, same hands, NO Ability and NO attack rider. */
const PLAIN = "fix-plain-stadium";
/** The victim's Active — 340 HP, so Galvantula ex's swing in §5 cannot Knock it
    Out and park the board on `ko:takePrizes`, where every refusal below would be
    green at the PHASE gate instead of at the rule under test. */
const WALL = "fix-stadium-wall";
/** A {L} Basic Energy, so §5's Galvantula ex can pay its PRINTED cost. */
const LIGHTNING = "fix-stadium-lightning";

function copperajah(id: string): Card {
  return battler(id, {
    name: "Copperajah",
    hp: 160,
    retreat: 3,
    types: ["Metal"],
    stage: "Stage1",
    evolveFrom: "Cufant",
    abilities: [{ type: "Ability", name: "Massive Body", effect: MASSIVE_BODY_TEXT }],
  });
}

function tyranitar(id: string): Card {
  return battler(id, {
    name: "Tyranitar",
    hp: 180,
    retreat: 3,
    types: ["Darkness"],
    stage: "Stage2",
    abilities: [{ type: "Ability", name: "Daunting Gaze", effect: DAUNTING_GAZE_TEXT }],
  });
}

function galvantula(id: string): Card {
  return battler(id, {
    name: "Galvantula ex",
    hp: 260,
    retreat: 1,
    types: ["Lightning"],
    stage: "Basic",
    attacks: [{ name: "Electro Web", cost: ["Lightning"], damage: "180", effect: GALVANTULA_TEXT }],
  });
}

const LOCAL_CARDS: Record<string, Card> = {
  [COPPERAJAH]: copperajah(COPPERAJAH),
  [TYRANITAR]: tyranitar(TYRANITAR),
  [GALVANTULA]: galvantula(GALVANTULA),
  [PLAIN]: battler(PLAIN, {
    name: "Plain Blocker",
    hp: 200,
    retreat: 1,
    types: ["Colorless"],
    stage: "Stage1",
  }),
  [WALL]: battler(WALL, {
    name: "Stadium Wall",
    hp: 340,
    retreat: 3,
    types: ["Colorless"],
    stage: "Basic",
  }),
  /** A {L} Basic Energy — the shared `fix-energy` provides Colorless only, and
      Galvantula ex's printed cost is `{L}`. Written as a local card rather than
      by relaxing the cost, so §5's stamp comes off the PRINTED attack. */
  [LIGHTNING]: {
    ...(FIXTURE_POOL["fix-fire-energy"] as Card),
    id: LIGHTNING,
    name: "Lightning Energy",
  },
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const STADIUM_DECK = deckOf({
  [COPPERAJAH]: 4,
  [TYRANITAR]: 3,
  [GALVANTULA]: 3,
  [PLAIN]: 4,
  [WALL]: 4,
  [TING_LU]: 3,
  [STADIUM]: 6,
  [STADIUM_2]: 5,
  [STADIUM_UNBUILT]: 5,
  [ITEM]: 5,
  [SUPPORTER]: 5,
  "fix-basic-1": 10,
  [LIGHTNING]: 3,
});

const SEEDS = [7211, 7219, 7229, 7237] as const;

function localSetup(seed: number, first: Seat): GameState {
  return driveSetup(seed, { p1: STADIUM_DECK, p2: STADIUM_DECK }, { pool: POOL, first });
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
  // §5's swing needs a paid cost; harmless on every other barrier body, and
  // attached to the BARRIER so the victim's board is identical on all of them.
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

/** Play `cardId` for real (the caller asserts it succeeded) — §4 needs a Stadium
    actually IN the zone before the same-name and once-per-turn rules exist. */
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

describe("D287 §1 — the printing, the class list, and the census that priced it", () => {
  it("the fixture carries the PRINTED sentence byte for byte", () => {
    expect(POOL[COPPERAJAH]?.abilities?.[0]?.effect).toBe(MASSIVE_BODY_TEXT);
    expect(MASSIVE_BODY_TEXT.startsWith("As long as this Pokémon is in the Active Spot,")).toBe(
      true,
    );
    expect(MASSIVE_BODY_TEXT.replace("Stadium", "Item")).toBe(DAUNTING_GAZE_TEXT);
  });

  it("THE CLASS LIST IS THE PRINTED ONE, AND THE THREE SENTENCES STAY DISJOINT", () => {
    expect(programFor(COPPERAJAH)?.passive?.preventOpponentHandPlay).toEqual(["Stadium"]);
    expect(programFor(TYRANITAR)?.passive?.preventOpponentHandPlay).toEqual(["Item"]);
    expect(programFor("sv10.5w-045")?.passive?.preventOpponentHandPlay).toEqual(["Item", "Tool"]);
    expect(programFor(COPPERAJAH)).not.toBe(programFor(TYRANITAR));
    expect(programFor(COPPERAJAH)?.passive?.preventOpponentPokemonPlay).toBeUndefined();
  });

  it('`"Stadium"` IS A `HandPlayClass` AND *NOT* A `StampedHandPlayClass` — the seam ( D636 (D539): WITHDRAWN — Scorching Earth stamps it, so the key is present and `null` here; the continuous half still answers)', () => {
    // The type says so and tsc enforces it; what a TEST can drive is the
    // CONSEQUENCE, which is that the persisted record has no key for it. §7
    // drives the round trip; this is the literal anchor beside it.
    const state = turnOf(board(SEEDS[0], "p1", "p1", COPPERAJAH), "p2");
    expect(Object.keys(state.handPlayLockedTurn.p2).sort()).toEqual(
      ["Item", "Supporter", "Stadium", "evolve"].sort(),
    );
    expect(state.handPlayLockedTurn.p2.Stadium).toBeNull();
    expect(handPlayBarred(state, "p2", "Stadium", undefined)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. THE ENGINE GATE — the play is refused, and only for the barred seat.
// ─────────────────────────────────────────────────────────────────────────────

describe("D287 §2 — `playStadium` asks `handPlayBarred`, and the CONTROL says so", () => {
  it("THE BARRED SEAT CANNOT PLAY A STADIUM AND THE CONTROL BOARD CAN", () => {
    for (const seed of SEEDS) {
      for (const first of ["p1", "p2"] as const) {
        const barred = turnOf(board(seed, first, "p1", COPPERAJAH), "p2");
        expect(play(barred, "p2", STADIUM), `${seed}/${first}`).toBe("HAND_PLAY_BLOCKED");
        const free = turnOf(board(seed, first, "p1", PLAIN), "p2");
        expect(play(free, "p2", STADIUM), `${seed}/${first} control`).toBe("OK");
      }
    }
  });

  it('THE BARRING SEAT\'S OWN HAND IS FREE — *"your opponent"*, on one board', () => {
    // The sentence is printed on the holder and names the OTHER seat. A build
    // that barred both seats (or the wrong one) is green on every line above.
    for (const seed of SEEDS) {
      const state = board(seed, "p1", "p1", COPPERAJAH);
      expect(play(turnOf(state, "p2"), "p2", STADIUM)).toBe("HAND_PLAY_BLOCKED");
      expect(play(turnOf(state, "p1"), "p1", STADIUM)).toBe("OK");
    }
  });

  it("the bar is READ FROM THE ACTIVE SPOT — a benched Copperajah bars nothing", () => {
    // *"As long as this Pokémon is in the Active Spot"* — the clause that
    // collapses the holder loop to ONE read. A build that scanned the whole
    // board is green on §2's first line and RED here.
    for (const seed of SEEDS) {
      let state = board(seed, "p1", "p1", PLAIN);
      state = clearBench(state, "p1");
      state = benchFromDeck(state, "p1", COPPERAJAH);
      state = turnOf(state, "p2");
      expect(handPlayBarred(state, "p2", "Stadium", undefined)).toBe(false);
      expect(play(state, "p2", STADIUM)).toBe("OK");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. THE CLASS — Stadium only, and the other three classes are untouched.
// ─────────────────────────────────────────────────────────────────────────────

describe("D287 §3 — the class list is honoured in BOTH directions", () => {
  it("COPPERAJAH BARS STADIUMS AND NOT ITEMS OR SUPPORTERS", () => {
    for (const seed of SEEDS) {
      const state = turnOf(board(seed, "p1", "p1", COPPERAJAH), "p2");
      expect(play(state, "p2", STADIUM)).toBe("HAND_PLAY_BLOCKED");
      expect(play(state, "p2", ITEM)).toBe("OK");
      expect(play(state, "p2", SUPPORTER)).toBe("OK");
      expect(handPlayBarred(state, "p2", "Stadium", undefined)).toBe(true);
      expect(handPlayBarred(state, "p2", "Item", undefined)).toBe(false);
      expect(handPlayBarred(state, "p2", "Supporter", undefined)).toBe(false);
      expect(handPlayBarred(state, "p2", "Tool", undefined)).toBe(false);
    }
  });

  it("AND TYRANITAR BARS ITEMS AND NOT STADIUMS — the same board, inverted", () => {
    for (const seed of SEEDS) {
      const state = turnOf(board(seed, "p1", "p1", TYRANITAR), "p2");
      expect(play(state, "p2", ITEM)).toBe("HAND_PLAY_BLOCKED");
      expect(play(state, "p2", STADIUM)).toBe("OK");
      expect(handPlayBarred(state, "p2", "Stadium", undefined)).toBe(false);
      expect(handPlayBarred(state, "p2", "Item", undefined)).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. THE ORDER — the bar outranks all three of §7.3's own answers.
// ─────────────────────────────────────────────────────────────────────────────

describe("D287 §4 — the gate's PLACEMENT, driven by error code", () => {
  it("THE BAR OUTRANKS THE COVERAGE STRATEGY — an UNBUILT Stadium says the bar", () => {
    // A build with the gate one line lower answers `TRAINER_NOT_SIMULATED` here
    // and is green on every assertion in §2 and §3. The barred seat is told the
    // rule it is actually under, not a fact about this simulator's coverage.
    for (const seed of SEEDS) {
      const barred = turnOf(board(seed, "p1", "p1", COPPERAJAH), "p2");
      expect(play(barred, "p2", STADIUM_UNBUILT)).toBe("HAND_PLAY_BLOCKED");
      // …and with no bar, the coverage strategy is still what answers.
      const free = turnOf(board(seed, "p1", "p1", PLAIN), "p2");
      expect(play(free, "p2", STADIUM_UNBUILT)).toBe("TRAINER_NOT_SIMULATED");
    }
  });

  it("THE BAR OUTRANKS §7.3's ONCE-PER-TURN ALLOWANCE", () => {
    // A barred seat should not learn "only one Stadium play per turn" about a
    // play the rules never let it attempt. Driven on a board where the allowance
    // is GENUINELY SPENT, so both codes are live answers.
    for (const seed of SEEDS) {
      const free = playOk(turnOf(board(seed, "p1", "p1", PLAIN), "p2"), "p2", STADIUM);
      expect(free.allowances.stadiumPlayed).toBe(true);
      expect(play(free, "p2", STADIUM_2)).toBe("STADIUM_ALREADY_PLAYED");
      // The same spent allowance, under the bar: the bar answers first.
      const barred = turnOf(board(seed, "p1", "p1", COPPERAJAH), "p2");
      const spent = { ...barred, allowances: { ...barred.allowances, stadiumPlayed: true } };
      expect(play(spent, "p2", STADIUM_2)).toBe("HAND_PLAY_BLOCKED");
    }
  });

  it("THE BAR OUTRANKS §7.3's SAME-NAME RULE", () => {
    // The third of the three, and the one that needs a Stadium actually IN the
    // shared zone — put there by the BARRING seat, which is the only seat that
    // can still play one.
    for (const seed of SEEDS) {
      const withZone = playOk(turnOf(board(seed, "p1", "p1", COPPERAJAH), "p1"), "p1", STADIUM);
      expect(withZone.stadium).not.toBeNull();
      const barred = turnOf(withZone, "p2");
      expect(play(barred, "p2", STADIUM)).toBe("HAND_PLAY_BLOCKED");
      // …and the same zone with no bar answers the same-name rule instead.
      const openZone = playOk(turnOf(board(seed, "p1", "p1", PLAIN), "p1"), "p1", STADIUM);
      expect(play(turnOf(openZone, "p2"), "p2", STADIUM)).toBe("STADIUM_SAME_NAME");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. THE SOURCES — §9 takes the bar down, and the STAMP can never put it up.
// ─────────────────────────────────────────────────────────────────────────────

describe("D287 §5 — one funnel, two sources, and only one of them can name a Stadium", () => {
  it("§9 — Ting-Lu ex's ability lock takes the bar down and the Stadium lands", () => {
    for (const seed of SEEDS) {
      const barred = turnOf(board(seed, "p1", "p1", COPPERAJAH), "p2");
      expect(play(barred, "p2", STADIUM)).toBe("HAND_PLAY_BLOCKED");
      let lifted = board(seed, "p1", "p1", COPPERAJAH);
      lifted = setActiveFromDeck(lifted, "p2", TING_LU);
      lifted = turnOf(lifted, "p2");
      expect(handPlayBarred(lifted, "p2", "Stadium", undefined)).toBe(false);
      expect(play(lifted, "p2", STADIUM)).toBe("OK");
    }
  });

  it("A STAMPED ITEM LOCK DOES NOT REACH A STADIUM — the split, driven", () => {
    for (const seed of SEEDS) {
      const stamped = swing(turnOf(board(seed, "p1", "p1", GALVANTULA), "p1"), "p1");
      const open = turnOf(stamped, "p2");
      expect(open.handPlayLockedTurn.p2.Item).toBe(open.turn);
      expect(handPlayBarred(open, "p2", "Item", undefined)).toBe(true);
      // …and the Stadium is untouched, from BOTH sources at once.
      expect(handPlayBarred(open, "p2", "Stadium", undefined)).toBe(false);
      expect(play(open, "p2", ITEM)).toBe("HAND_PLAY_BLOCKED");
      expect(play(open, "p2", STADIUM)).toBe("OK");
    }
  });

  it("BOTH SOURCES AT ONCE — and the Stadium bar is still the CONTINUOUS one", () => {
    // The funnel ORs them, so a board carrying a stamped Item lock AND an Active
    // Copperajah bars BOTH classes — and neither term is doing the other's work.
    for (const seed of SEEDS) {
      let state = board(seed, "p1", "p1", GALVANTULA);
      state = swing(turnOf(state, "p1"), "p1");
      state = setActiveFromDeck(state, "p1", COPPERAJAH);
      state = turnOf(state, "p2");
      expect(handPlayBarred(state, "p2", "Item", undefined)).toBe(true);
      expect(handPlayBarred(state, "p2", "Stadium", undefined)).toBe(true);
      expect(play(state, "p2", ITEM)).toBe("HAND_PLAY_BLOCKED");
      expect(play(state, "p2", STADIUM)).toBe("HAND_PLAY_BLOCKED");
      expect(play(state, "p2", SUPPORTER)).toBe("OK");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. THE MIRRORS — one is correct, and the other's ABSENCE is the refusal.
// ─────────────────────────────────────────────────────────────────────────────

describe("D288 §6 — the wire NOW emits the Stadium row, and the bar greys it", () => {
  it("`redactedTrainersOf` EMITS A GREYED STADIUM ROW — D287's refusal, INVERTED", () => {
    for (const seed of SEEDS) {
      const barred = turnOf(board(seed, "p1", "p1", COPPERAJAH), "p2");
      expect(wireTrainerIds(barred, "p2")).toContain(STADIUM);
      expect(wireDisabled(barred, "p2", STADIUM)).toBe(true);
      expect(wireDisabled(barred, "p2", STADIUM_2)).toBe(true);
      const items = turnOf(board(seed, "p1", "p1", TYRANITAR), "p2");
      expect(wireTrainerIds(items, "p2")).toContain(ITEM);
      expect(wireDisabled(items, "p2", ITEM)).toBe(true);
      expect(wireDisabled(items, "p2", SUPPORTER)).toBe(false);
      expect(wireDisabled(items, "p2", STADIUM)).toBe(false);
    }
  });

  it("THE ENGINE IS AUTHORITATIVE ON BOTH TRANSPORTS — the gap costs a click, not a rule", () => {
    for (const seed of SEEDS) {
      const barred = turnOf(board(seed, "p1", "p1", COPPERAJAH), "p2");
      expect(play(barred, "p2", STADIUM)).toBe("HAND_PLAY_BLOCKED");
      expect(play(barred, "p2", STADIUM_2)).toBe("HAND_PLAY_BLOCKED");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. MATCH_RECORD_VERSION — 16, UNCHANGED, AND DRIVEN RATHER THAN ARGUED.
// ─────────────────────────────────────────────────────────────────────────────

describe("D287 §7 — the version does NOT move, and the claim is driven both ways", () => {
  it("A REAL JSON ROUND TRIP CARRIES THE WHOLE ANSWER — the bar is a DERIVED READ", () => {
    for (const seed of SEEDS) {
      const barred = turnOf(board(seed, "p1", "p1", COPPERAJAH), "p2");
      const reloaded = roundTrip(barred);
      expect(reloaded.handPlayLockedTurn.p2.Item).toBeNull();
      expect(handPlayBarred(reloaded, "p2", "Stadium", undefined)).toBe(true);
      expect(play(reloaded, "p2", STADIUM)).toBe("HAND_PLAY_BLOCKED");
      const free = turnOf(board(seed, "p1", "p1", PLAIN), "p2");
      const freeReloaded = roundTrip(free);
      expect(handPlayBarred(freeReloaded, "p2", "Stadium", undefined)).toBe(false);
      expect(play(freeReloaded, "p2", STADIUM)).toBe("OK");
    }
  });

  it("AND NOTHING PERSISTED MOVED — the diff, PAIRED with a literal anchor", () => {
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
      expect(Object.keys(free.handPlayLockedTurn[seat]).sort()).toEqual(
        ["Item", "Supporter", "Stadium", "evolve"].sort(),
      );
    }
  });
});
