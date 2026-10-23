import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import {
  applyAction,
  createGame,
  handPlayBarred,
  programFor,
  rareCandyOptions,
  redactGame,
} from "./index";
import type { GameState, Seat } from "./index";
import {
  FIXTURE_POOL,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  deepFreeze,
  handFromDeck,
  handUid,
  setActiveFromDeck,
  setDamage,
  typedEnergy,
  must,
  firstBasicInHand,
} from "./testFixtures";

const RARE_CANDY_TEXT =
  "Choose 1 of your Basic Pokémon in play. If you have a Stage 2 card in your hand that evolves " +
  "from that Pokémon, put that card onto the Basic Pokémon to evolve it, skipping the Stage 1. " +
  "You can't use this card during your first turn or on a Basic Pokémon that was put into play " +
  "this turn.";
const ITEM_LOCK_TEXT =
  "During your opponent's next turn, they can't play any Item cards from their hand.";
const GALVANTULA_TEXT = `Discard all Energy from this Pokémon. ${ITEM_LOCK_TEXT}`;
const SCREAM_TEXT =
  "You can use this attack only if you go second, and only during your first turn. " +
  "Your opponent can't play any Supporter cards from their hand during their next turn.";
const BRONZONG_TEXT =
  "During your opponent's next turn, they can't play any Pokémon from their hand to evolve their Pokémon.";
const DAUNTING_GAZE_TEXT =
  "As long as this Pokémon is in the Active Spot, your opponent can't play any Item cards from their hand.";

const RARE_CANDY = "sv01-191";
const RARE_CANDY_2 = "sv01-256";
const RARE_CANDY_3 = "swsh10.5-069";

/** The STAMPED `"Item"` source (an attack rider). */
const GALVANTULA = "sv07-051";
const BUDEW = "sv08.5-004";
/** The CONTINUOUS `"Item"` source (an Ability). */
const TYRANITAR = "sv09-095";
/** The STAMPED `"Supporter"` source — the CLASS control (§3). */
const SCREAM_TAIL = "sv06-094";
/** The STAMPED `"evolve"` source — the SURFACE control, and the put-vs-play
    asymmetry's other half (§4). */
const BRONZONG = "sv05-069";

/** Potion — a plain Item, so §2 can show the bar reaching the ORDINARY Item path
    on the very same board that refuses the Rare Candy. */
const ITEM = "sv01-188";
/** Professor's Research — the Supporter that must survive an `"Item"` bar. */
const SUPPORTER = "sv01-189";

/** The CONTROL body: same board, same hands, no rider and no Ability. Every
    "the bar bites" line below passes just as happily on a build that refused
    every Rare Candy, and this is the only thing that can tell them apart. */
const PLAIN = "fix-plain-candy";
/** The victim's Active — 340 HP, so Galvantula ex's 180 cannot Knock it Out and
    park the board on `ko:takePrizes`, where every refusal below would be green
    at the PHASE gate instead of at the rule under test. */
const WALL = "fix-candy-wall";

function galvantula(id: string): Card {
  return battler(id, {
    name: "Galvantula ex",
    hp: 260,
    retreat: 1,
    types: ["Lightning"],
    attacks: [
      { cost: ["Colorless", "Colorless"], name: "Fulgurite", damage: 180, effect: GALVANTULA_TEXT },
    ],
  });
}

function budew(id: string): Card {
  return battler(id, {
    name: "Budew",
    hp: 30,
    retreat: 1,
    types: ["Grass"],
    attacks: [{ cost: ["Colorless"], name: "Itchy Pollen", damage: 10, effect: ITEM_LOCK_TEXT }],
  });
}

function screamTail(id: string): Card {
  return battler(id, {
    name: "Scream Tail ex",
    hp: 190,
    retreat: 1,
    types: ["Psychic"],
    attacks: [{ cost: ["Colorless"], name: "Scream", effect: SCREAM_TEXT }],
  });
}

function bronzong(id: string): Card {
  return battler(id, {
    name: "Bronzong",
    hp: 120,
    retreat: 2,
    types: ["Metal"],
    stage: "Stage1",
    attacks: [{ cost: ["Colorless"], name: "Evolution Jammer", damage: 30, effect: BRONZONG_TEXT }],
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

function rareCandyCard(id: string): Card {
  const printed = FIXTURE_POOL[RARE_CANDY];
  if (printed === undefined) throw new Error("FIXTURE_POOL lost sv01-191");
  return { ...printed, id };
}

const LOCAL_CARDS: Record<string, Card> = {
  [RARE_CANDY_2]: rareCandyCard(RARE_CANDY_2),
  [RARE_CANDY_3]: rareCandyCard(RARE_CANDY_3),
  [GALVANTULA]: galvantula(GALVANTULA),
  [BUDEW]: budew(BUDEW),
  [SCREAM_TAIL]: screamTail(SCREAM_TAIL),
  [BRONZONG]: bronzong(BRONZONG),
  [TYRANITAR]: tyranitar(TYRANITAR),
  [PLAIN]: battler(PLAIN, {
    name: "Plain Candy Barrier",
    hp: 200,
    retreat: 1,
    types: ["Colorless"],
    attacks: [{ cost: ["Colorless"], name: "Tackle", damage: 10 }],
  }),
  [WALL]: battler(WALL, {
    name: "Candy Wall",
    hp: 340,
    retreat: 1,
    types: ["Colorless"],
    attacks: [{ cost: ["Colorless"], name: "Nudge", damage: 10 }],
  }),
  /** {C}-payable Energy, local to this suite so `FIXTURE_POOL` stays untouched
      and `catalogManifest.test.ts` stays green. */
  "fix-candy-energy": typedEnergy("fix-candy-energy", "Colorless"),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const CANDY_DECK = deckOf({
  [GALVANTULA]: 3,
  [BUDEW]: 3,
  [SCREAM_TAIL]: 3,
  [BRONZONG]: 3,
  [TYRANITAR]: 4,
  [PLAIN]: 5,
  [WALL]: 4,
  [RARE_CANDY]: 6,
  [RARE_CANDY_2]: 3,
  [RARE_CANDY_3]: 3,
  [ITEM]: 4,
  [SUPPORTER]: 4,
  "fix-basic-1": 4,
  "fix-stage2": 5,
  "fix-stage1": 2,
  "fix-candy-energy": 4,
});

const SEEDS = [8311, 8317, 8329, 8353] as const;

function localSetup(seed: number, first: Seat): GameState {
  const created = createGame({ seed, decks: { p1: CANDY_DECK, p2: CANDY_DECK }, cardPool: POOL });
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
  state = attachFromDeck(state, barrier, "fix-candy-energy", 2);
  for (const seat of ["p1", "p2"] as const) {
    state = handFromDeck(state, seat, RARE_CANDY, 1);
    state = handFromDeck(state, seat, "fix-stage2", 1);
    state = handFromDeck(state, seat, ITEM, 1);
    state = handFromDeck(state, seat, SUPPORTER, 1);
    state = setDamage(state, seat, 10);
  }
  return state;
}

/** Walk to `seat`'s turn, at turn 3 or later so §4's first-turn bans are spent. */
function turnOf(state: GameState, seat: Seat): GameState {
  let next = state;
  for (let i = 0; i < 12; i += 1) {
    if (next.phase.kind !== "turn:action") throw new Error(`stuck in ${next.phase.kind}`);
    if (next.phase.seat === seat && next.turn >= 3) return next;
    next = must(applyAction(next, { type: "endTurn", seat: next.phase.seat }));
  }
  throw new Error(`never reached ${seat}'s turn`);
}

function swing(state: GameState, seat: Seat, index = 0): GameState {
  return must(applyAction(state, { type: "attack", seat, index }));
}

function candy(state: GameState, seat: Seat, candyId = RARE_CANDY): string {
  const uid = handUid(state, seat, candyId);
  const evolutionUid = handUid(state, seat, "fix-stage2");
  const result = applyAction(deepFreeze(state), {
    type: "rareCandy",
    seat,
    uid,
    target: { spot: "bench", index: 0 },
    evolutionUid,
  });
  return result.ok ? "OK" : result.error.code;
}

/** Play an ordinary Trainer and report the code — the class controls. */
function play(state: GameState, seat: Seat, cardId: string): string {
  const uid = handUid(state, seat, cardId);
  const result = applyAction(deepFreeze(state), { type: "playTrainer", seat, uid });
  return result.ok ? "OK" : result.error.code;
}

function wireDisabled(state: GameState, seat: Seat, cardId: string): boolean | undefined {
  const phase = redactGame(state, seat).phase;
  if (phase.kind !== "turn:action") throw new Error(`expected turn:action, got ${phase.kind}`);
  return phase.trainers.find((t) => t.uid === handUid(state, seat, cardId))?.disabled;
}

function wireCandyOptions(state: GameState, seat: Seat): number {
  const phase = redactGame(state, seat).phase;
  if (phase.kind !== "turn:action") throw new Error(`expected turn:action, got ${phase.kind}`);
  return phase.rareCandy.length;
}

describe("D286 §1 — Rare Candy's CLASS, which is the entire argument", () => {
  it('ALL THREE PRINTINGS ARE `trainerType: "Item"` — the fix is keyed on this and nothing else', () => {
    for (const id of [RARE_CANDY, RARE_CANDY_2, RARE_CANDY_3]) {
      const card = POOL[id];
      expect(card, `${id} must resolve on this board's pool`).toBeDefined();
      expect(card?.category, id).toBe("Trainer");
      expect(card?.trainerType, `${id} must be an Item — the whole fix hangs on it`).toBe("Item");
      expect(programFor(id)?.rareCandy, `${id} must carry the Rare Candy marker`).toBe(true);
    }
    expect(POOL[ITEM]?.trainerType).toBe("Item");
    expect(programFor(ITEM)?.rareCandy).toBeUndefined();
  });

  it("the printed sentence says PUT for the Stage 2 and never says PLAY for it", () => {
    expect(RARE_CANDY_TEXT).toContain("put that card onto the Basic Pokémon to evolve it");
    expect(RARE_CANDY_TEXT).toContain("You can't use this card during your first turn");
    expect(RARE_CANDY_TEXT).not.toContain("play that card");
    expect(RARE_CANDY_TEXT).toContain("Basic Pokémon in play");
    expect(RARE_CANDY_TEXT).toContain("put into play this turn");
    expect(RARE_CANDY_TEXT.replaceAll("in play", "").replaceAll("into play", "")).not.toContain(
      "play",
    );
    // …while both Pokémon-surface sentences DO name a play, so the distinction is
    // real on the printed side and not an artefact of this engine's vocabulary.
    expect(BRONZONG_TEXT).toContain("can't play any Pokémon from their hand to evolve");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. THE BAR BITES — through BOTH sources, on EVERY seed and BOTH assignments.
// ─────────────────────────────────────────────────────────────────────────────

describe('D286 §2 — the `"Item"` bar refuses the rareCandy action', () => {
  it("THE STAMPED SOURCE — Galvantula ex's rider stops the victim's Rare Candy", () => {
    for (const seed of SEEDS) {
      for (const first of ["p1", "p2"] as const) {
        for (const barrier of ["p1", "p2"] as const) {
          const victim = barrier === "p1" ? "p2" : "p1";
          const stamped = swing(turnOf(board(seed, first, barrier, GALVANTULA), barrier), barrier);
          const open = turnOf(stamped, victim);
          expect(handPlayBarred(open, victim, "Item", undefined)).toBe(true);
          expect(candy(open, victim)).toBe("HAND_PLAY_BLOCKED");
          // The ORDINARY Item path is refused on the SAME board, which is what
          // makes this one line about Rare Candy rather than about the bar.
          expect(play(open, victim, ITEM)).toBe("HAND_PLAY_BLOCKED");
          const back = turnOf(open, barrier);
          expect(candy(back, barrier)).toBe("OK");
        }
      }
    }
  });

  it("THE CONTINUOUS SOURCE — Tyranitar's Ability stops it with no attack in the game", () => {
    // A fix wired to `stampedBarFor` alone is green on every §2a line and red
    // here; a fix wired to the passive alone is the reverse. Both halves funnel
    // through `handPlayBarred`, and this is what says so.
    for (const seed of SEEDS) {
      for (const first of ["p1", "p2"] as const) {
        for (const barrier of ["p1", "p2"] as const) {
          const victim = barrier === "p1" ? "p2" : "p1";
          const open = turnOf(board(seed, first, barrier, TYRANITAR), victim);
          expect(handPlayBarred(open, victim, "Item", undefined)).toBe(true);
          expect(candy(open, victim)).toBe("HAND_PLAY_BLOCKED");
          expect(candy(turnOf(open, barrier), barrier)).toBe("OK");
        }
      }
    }
  });

  it("THE CONTROL — the SAME boards with a body that bars nothing accept it", () => {
    // Without this the whole suite is green on a build that refused every Rare
    // Candy for any reason at all.
    for (const seed of SEEDS) {
      for (const first of ["p1", "p2"] as const) {
        for (const barrier of ["p1", "p2"] as const) {
          const victim = barrier === "p1" ? "p2" : "p1";
          const open = turnOf(board(seed, first, barrier, PLAIN), victim);
          expect(handPlayBarred(open, victim, "Item", undefined)).toBe(false);
          expect(candy(open, victim)).toBe("OK");
        }
      }
    }
  });

  it("every printing, not just the one the boards drive", () => {
    // The fix reads `Card.trainerType`, so all three reprints must behave alike —
    // and a fixture that only ever drove `sv01-191` could not tell.
    const barred = turnOf(board(SEEDS[0], "p1", "p1", TYRANITAR), "p2");
    const free = turnOf(board(SEEDS[0], "p1", "p1", PLAIN), "p2");
    for (const id of [RARE_CANDY, RARE_CANDY_2, RARE_CANDY_3]) {
      let withCandy = handFromDeck(barred, "p2", id, 1);
      expect(candy(withCandy, "p2", id), id).toBe("HAND_PLAY_BLOCKED");
      withCandy = handFromDeck(free, "p2", id, 1);
      expect(candy(withCandy, "p2", id), id).toBe("OK");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. THE CLASS CONTROL — a `"Supporter"` bar must leave Rare Candy alone.
// ─────────────────────────────────────────────────────────────────────────────

describe('D286 §3 — the bar is the `"Item"` one and ONLY the `"Item"` one', () => {
  it("SCREAM TAIL ex BARS SUPPORTERS AND THE RARE CANDY LANDS", () => {
    for (const seed of SEEDS) {
      const barrier = "p2" as const;
      let open = board(seed, "p1", barrier, SCREAM_TAIL);
      open = must(applyAction(open, { type: "endTurn", seat: "p1" }));
      open = turnOf(swing(open, barrier), "p1");
      expect(handPlayBarred(open, "p1", "Supporter", undefined)).toBe(true);
      expect(handPlayBarred(open, "p1", "Item", undefined)).toBe(false);
      expect(play(open, "p1", SUPPORTER)).toBe("HAND_PLAY_BLOCKED");
      // …and the Item half of the same hand is untouched, Rare Candy included.
      expect(play(open, "p1", ITEM)).toBe("OK");
      expect(candy(open, "p1")).toBe("OK");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. THE PUT-vs-PLAY ASYMMETRY, DRIVEN IN ONE BREATH.
// ─────────────────────────────────────────────────────────────────────────────

describe("D286 §4 — barred by Bronzong you may still Rare Candy; barred by Budew you may not", () => {
  it("THE POKÉMON-SURFACE BAR MISSES IT — *put* is not *play*, and the engine agrees", () => {
    for (const seed of SEEDS) {
      for (const first of ["p1", "p2"] as const) {
        const stamped = swing(turnOf(board(seed, first, "p1", BRONZONG), "p1"), "p1");
        const open = turnOf(stamped, "p2");
        // The evolve surface really is barred on this board — the attribution
        // control, so the OK below cannot be "the stamp never landed".
        expect(handPlayBarred(open, "p2", "Item", undefined)).toBe(false);
        expect(open.handPlayLockedTurn.p2.evolve).toBe(open.turn);
        // …and the Rare Candy goes through anyway.
        expect(candy(open, "p2")).toBe("OK");
      }
    }
  });

  it("AND THE ITEM BAR HITS IT — the same board shape, the other sentence", () => {
    // The other half of the asymmetry, on the same seeds and the same seats, so
    // the pair is a CONTRAST rather than two unrelated facts. Budew stamps the
    // same `"Item"` key Galvantula does off a 10-damage attack.
    for (const seed of SEEDS) {
      for (const first of ["p1", "p2"] as const) {
        const stamped = swing(turnOf(board(seed, first, "p1", BUDEW), "p1"), "p1");
        const open = turnOf(stamped, "p2");
        expect(open.handPlayLockedTurn.p2.Item).toBe(open.turn);
        expect(open.handPlayLockedTurn.p2.evolve).toBeNull();
        expect(candy(open, "p2")).toBe("HAND_PLAY_BLOCKED");
      }
    }
  });
});

describe("D286 §5 — `rareCandyOptions` and the wire agree with `rareCandy`", () => {
  it("`rareCandyOptions` GOES EMPTY UNDER THE BAR — its docstring promises exactly this", () => {
    for (const seed of SEEDS) {
      for (const barrierId of [TYRANITAR, PLAIN]) {
        const open = turnOf(board(seed, "p1", "p1", barrierId), "p2");
        const accepted = candy(open, "p2") === "OK";
        expect(rareCandyOptions(open, "p2").length > 0, `${barrierId}`).toBe(accepted);
        expect(wireCandyOptions(open, "p2") > 0, `${barrierId} on the wire`).toBe(accepted);
      }
    }
  });

  it("THE WIRE ROW IS GREYED EXACTLY WHEN THE ENGINE REFUSES — both directions", () => {
    for (const seed of SEEDS) {
      for (const barrierId of [TYRANITAR, PLAIN]) {
        const open = turnOf(board(seed, "p1", "p1", barrierId), "p2");
        const refused = candy(open, "p2") !== "OK";
        expect(wireDisabled(open, "p2", RARE_CANDY), `${barrierId}`).toBe(refused);
        expect(wireDisabled(open, "p2", ITEM), `${barrierId} item`).toBe(refused);
        expect(wireDisabled(open, "p2", SUPPORTER), `${barrierId} supporter`).toBe(false);
      }
    }
  });

  it("the STAMPED source greys the same two rows — one mirror, both sources", () => {
    for (const seed of SEEDS) {
      const stamped = swing(turnOf(board(seed, "p1", "p1", GALVANTULA), "p1"), "p1");
      const open = turnOf(stamped, "p2");
      expect(wireDisabled(open, "p2", RARE_CANDY)).toBe(true);
      expect(wireDisabled(open, "p2", ITEM)).toBe(true);
      expect(wireDisabled(open, "p2", SUPPORTER)).toBe(false);
      expect(wireCandyOptions(open, "p2")).toBe(0);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. MATCH_RECORD_VERSION — 16, UNCHANGED, AND DRIVEN RATHER THAN ARGUED.
// ─────────────────────────────────────────────────────────────────────────────

describe("D286 §6 — the version does NOT move, and the claim is driven", () => {
  it("A REAL JSON ROUND TRIP CARRIES THE WHOLE ANSWER — the gate is a DERIVED READ", () => {
    for (const seed of SEEDS) {
      // The STAMPED half, whose answer is written down in the record…
      const stamped = swing(turnOf(board(seed, "p1", "p1", BUDEW), "p1"), "p1");
      const open = turnOf(stamped, "p2");
      const reloaded = JSON.parse(JSON.stringify(open)) as GameState;
      expect(handPlayBarred(reloaded, "p2", "Item", undefined)).toBe(true);
      expect(candy(reloaded, "p2")).toBe("HAND_PLAY_BLOCKED");
      // …and the CONTINUOUS half, whose answer is RECOMPUTED from the board.
      const passive = turnOf(board(seed, "p1", "p1", TYRANITAR), "p2");
      const passiveReloaded = JSON.parse(JSON.stringify(passive)) as GameState;
      expect(passiveReloaded.handPlayLockedTurn.p2.Item).toBeNull();
      expect(candy(passiveReloaded, "p2")).toBe("HAND_PLAY_BLOCKED");
    }
  });

  it("AND NOTHING PERSISTED MOVED — the diff, PAIRED with a literal anchor", () => {
    const barred = turnOf(board(SEEDS[0], "p1", "p1", TYRANITAR), "p2");
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
    expect(Object.keys(barred.allowances).sort()).toEqual(Object.keys(free.allowances).sort());
    const bodyKeys = (s: GameState): string[] => Object.keys(s.players.p2.active ?? {}).sort();
    expect(bodyKeys(barred)).toEqual(bodyKeys(free));
  });
});
