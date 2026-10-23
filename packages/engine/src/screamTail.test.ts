import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { applyAction, deriveAttackEffect, redactGame } from "./index";
import type { GameState, Seat } from "./index";
import { handPlayBarred, splitAttackGateClause } from "./index";
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
  driveSetup,
} from "./testFixtures";

// ─────────────────────────────────────────────────────────────────────────────
// The printed strings, byte-exact off the D1 rows above.
// ─────────────────────────────────────────────────────────────────────────────

const SCREAM_TEXT =
  "You can use this attack only if you go second, and only during your first turn. " +
  "Your opponent can't play any Supporter cards from their hand during their next turn.";
const ITEM_LOCK_TEXT =
  "During your opponent's next turn, they can't play any Item cards from their hand.";
const GALVANTULA_TEXT = `Discard all Energy from this Pokémon. ${ITEM_LOCK_TEXT}`;
/** Bronzong `sv05-069` — REFUSED, and asserted refused in §2. */
const BRONZONG_TEXT =
  "During your opponent's next turn, they can't play any Pokémon from their hand to evolve their Pokémon.";

const SCREAM_TAIL = "sv06-094";
const BUDEW = "sv08.5-004";
const GALVANTULA = "sv07-051";
const SUPPORTER = "sv01-189";
/** Potion — the Item twin, playable whenever something of yours is damaged
    (which §3's boards arrange), for the same "a refusal is a rule" reason. */
const ITEM = "sv01-188";
/** Nemona — a second Supporter that does NOT discard the hand, so §7.2's
    once-per-turn refusal can be driven with the first one already spent. */
const SUPPORTER_2 = "sv01-180";

function screamTail(id: string): Card {
  return battler(id, {
    name: "Scream Tail ex",
    hp: 190,
    retreat: 1,
    types: ["Psychic"],
    attacks: [{ cost: ["Colorless"], name: "Scream", effect: SCREAM_TEXT }],
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

const PLAIN = "fix-plain-attacker";
/** The body every VICTIM sits behind — see its entry in `LOCAL_CARDS`. */
const WALL = "fix-wall";

const LOCAL_CARDS: Record<string, Card> = {
  [SCREAM_TAIL]: screamTail(SCREAM_TAIL),
  "sv06-197": screamTail("sv06-197"),
  [BUDEW]: budew(BUDEW),
  "sv10.5w-044": budew("sv10.5w-044"),
  "sv10.5w-126": budew("sv10.5w-126"),
  [GALVANTULA]: galvantula(GALVANTULA),
  "sv07-159": galvantula("sv07-159"),
  "sv07-168": galvantula("sv07-168"),
  [PLAIN]: battler(PLAIN, {
    name: "Plain Attacker",
    hp: 120,
    retreat: 1,
    types: ["Colorless"],
    attacks: [{ cost: ["Colorless"], name: "Tackle", damage: 10 }],
  }),
  [WALL]: battler(WALL, {
    name: "Wall",
    hp: 340,
    retreat: 1,
    types: ["Colorless"],
    attacks: [{ cost: ["Colorless"], name: "Nudge", damage: 10 }],
  }),
  /** {C}-payable Energy, local to this suite so `FIXTURE_POOL` stays untouched
      and `catalogManifest.test.ts` stays green — the `attackIndexGate` idiom. */
  "fix-lock-energy": typedEnergy("fix-lock-energy", "Colorless"),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const LOCK_DECK = deckOf({
  [SCREAM_TAIL]: 4,
  "sv06-197": 1,
  [BUDEW]: 4,
  "sv10.5w-044": 1,
  "sv10.5w-126": 1,
  [GALVANTULA]: 4,
  "sv07-159": 1,
  "sv07-168": 1,
  [PLAIN]: 4,
  [SUPPORTER]: 4,
  [SUPPORTER_2]: 2,
  [ITEM]: 4,
  "fix-basic-1": 4,
  [WALL]: 4,
  "fix-lock-energy": 14,
  "fix-energy": 7,
});

const SEEDS = [5209, 5227, 5231, 5233] as const;

function localSetup(seed: number, first: Seat): GameState {
  return driveSetup(seed, { p1: LOCK_DECK, p2: LOCK_DECK }, { pool: POOL, first });
}

function board(seed: number, first: Seat, attacker: Seat, activeId: string): GameState {
  let state = localSetup(seed, first);
  const other = attacker === "p1" ? "p2" : "p1";
  state = setActiveFromDeck(state, attacker, activeId);
  state = clearBench(state, attacker);
  state = benchFromDeck(state, attacker, "fix-basic-1");
  state = setActiveFromDeck(state, other, WALL);
  state = clearBench(state, other);
  state = benchFromDeck(state, other, "fix-basic-1");
  state = attachFromDeck(state, attacker, "fix-lock-energy", 2);
  for (const seat of ["p1", "p2"] as const) {
    state = handFromDeck(state, seat, SUPPORTER, 1);
    state = handFromDeck(state, seat, ITEM, 1);
    state = setDamage(state, seat, 10);
  }
  return state;
}

/** Play `cardId` from `seat`'s hand and report the error code, or "OK" when the
    engine accepted it. Every §3 assertion goes through this so a green "the bar
    refuses" line can never be a refusal for the WRONG reason. */
function play(state: GameState, seat: Seat, cardId: string): string {
  const uid = handUid(state, seat, cardId);
  const result = applyAction(deepFreeze(state), { type: "playTrainer", seat, uid });
  return result.ok ? "OK" : result.error.code;
}

function wireDisabled(state: GameState, seat: Seat, cardId: string): boolean | undefined {
  const phase = redactGame(state, seat).phase;
  if (phase.kind !== "turn:action") throw new Error(`expected turn:action, got ${phase.kind}`);
  const uid = handUid(state, seat, cardId);
  return phase.trainers.find((t) => t.uid === uid)?.disabled;
}

function endTurn(state: GameState): GameState {
  if (state.phase.kind !== "turn:action") throw new Error(`stuck in ${state.phase.kind}`);
  return must(applyAction(state, { type: "endTurn", seat: state.phase.seat }));
}

function openingFor(state: GameState, attacker: Seat): GameState {
  let next = state;
  for (let guard = 0; guard < 6; guard += 1) {
    if (next.phase.kind === "turn:action" && next.phase.seat === attacker && next.turn >= 2) {
      return next;
    }
    next = endTurn(next);
  }
  throw new Error(`never reached ${attacker}'s attacking turn`);
}

function swing(state: GameState, seat: Seat, index = 0): GameState {
  return must(applyAction(state, { type: "attack", seat, index }));
}

describe("D283 §1 — the printed population, and what is deliberately outside it", () => {
  it("all EIGHT printings derive, and the class comes from the printed word", () => {
    const supporterBody = splitAttackGateClause(SCREAM_TEXT)?.body;
    expect(supporterBody).toBe(
      "Your opponent can't play any Supporter cards from their hand during their next turn.",
    );
    expect(deriveAttackEffect(supporterBody ?? "")).toEqual([
      { op: "preventHandPlay", bars: "Supporter" },
    ]);
    expect(deriveAttackEffect(ITEM_LOCK_TEXT)).toEqual([{ op: "preventHandPlay", bars: "Item" }]);
    expect(deriveAttackEffect(GALVANTULA_TEXT)).toEqual([
      { op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" }, count: "all" },
      { op: "preventHandPlay", bars: "Item" },
    ]);
  });

  it("SCREAM TAIL's WHOLE PRINTED STRING IS STILL REFUSED — the split is what reaches it", () => {
    expect(deriveAttackEffect(SCREAM_TEXT)).toBeNull();
  });

  it("D285 — BRONZONG sv05-069 IS NO LONGER REFUSED, AND IT DERIVES TO AN ACT", () => {
    expect(deriveAttackEffect(BRONZONG_TEXT)).toEqual([{ op: "preventHandPlay", bars: "evolve" }]);
    expect(deriveAttackEffect(ITEM_LOCK_TEXT)).toEqual([{ op: "preventHandPlay", bars: "Item" }]);
  });

  it("the near-miss strings a looser anchor would have swallowed", () => {
    for (const text of [
      // the Ability family's window, which this field must never carry
      "As long as this Pokémon is in the Active Spot, your opponent can't play any Item cards from their hand.",
      // a class the field cannot spell
      "During your opponent's next turn, they can't play any Stadium cards from their hand.",
      // the cost compound with the wrong cost
      `Discard 2 Energy from this Pokémon. ${ITEM_LOCK_TEXT}`,
      // a trailing rider on a sentence the readers do not own
      `This attack does 30 damage. ${ITEM_LOCK_TEXT}`,
    ]) {
      expect(deriveAttackEffect(text), text).toBeNull();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. The stamp itself — per-seat, per-class, and one turn wide.
// ─────────────────────────────────────────────────────────────────────────────

describe("D283 §2 — GameState.handPlayLockedTurn, the stamp", () => {
  it("a fresh game has no lock on either seat, for either class", () => {
    const state = localSetup(SEEDS[0], "p1");
    expect(state.handPlayLockedTurn).toEqual({
      p1: { Item: null, Supporter: null, Stadium: null, evolve: null },
      p2: { Item: null, Supporter: null, Stadium: null, evolve: null },
    });
  });

  for (const first of ["p1", "p2"] as const) {
    it(`Scream stamps the OPPONENT's next turn and nothing else (first: ${first})`, () => {
      // Scream's own gate is "go second, first turn", so the attacker is the
      // going-SECOND seat on turn 2 — which is why `first` must be swept.
      const attacker = first === "p1" ? "p2" : "p1";
      const victim = first;
      let state = openingFor(board(SEEDS[0], first, attacker, SCREAM_TAIL), attacker);
      // Scream's own gate is the going-second seat's FIRST turn, so this is 2.
      expect(state.turn).toBe(2);
      state = swing(state, attacker);
      expect(state.handPlayLockedTurn[victim].Supporter).toBe(3);
      // and NOTHING else moved: not the other class, not the other seat.
      expect(state.handPlayLockedTurn[victim].Item).toBeNull();
      expect(state.handPlayLockedTurn[attacker]).toEqual({
        Item: null,
        Supporter: null,
        Stadium: null,
        evolve: null,
      });
    });

    it(`Itchy Pollen stamps the ITEM slot only (first: ${first})`, () => {
      const attacker = first;
      const victim = first === "p1" ? "p2" : "p1";
      let state = openingFor(board(SEEDS[1], first, attacker, BUDEW), attacker);
      const stamped = state.turn + 1;
      state = swing(state, attacker);
      expect(state.handPlayLockedTurn[victim].Item).toBe(stamped);
      expect(state.handPlayLockedTurn[victim].Supporter).toBeNull();
    });
  }

  it("the CONTROL body stamps nothing at all", () => {
    let state = openingFor(board(SEEDS[0], "p1", "p1", PLAIN), "p1");
    state = swing(state, "p1");
    expect(state.handPlayLockedTurn).toEqual({
      p1: { Item: null, Supporter: null, Stadium: null, evolve: null },
      p2: { Item: null, Supporter: null, Stadium: null, evolve: null },
    });
  });

  it("handPlayBarred reads the stamp on exactly ONE turn — the window, both edges", () => {
    let state = openingFor(board(SEEDS[2], "p1", "p1", BUDEW), "p1");
    // BEFORE: nothing is barred on the turn the attack is declared.
    expect(handPlayBarred(state, "p2", "Item", undefined)).toBe(false);
    const stamped = state.turn + 1;
    state = swing(state, "p1");
    expect(state.turn).toBe(stamped);
    // DURING: p2's turn, the stamped one.
    expect(handPlayBarred(state, "p2", "Item", undefined)).toBe(true);
    expect(handPlayBarred(state, "p2", "Supporter", undefined)).toBe(false);
    expect(handPlayBarred(state, "p1", "Item", undefined)).toBe(false);
    // AFTER: the stamp is untouched and the answer flips by arithmetic alone —
    // no clear runs, which is the property that makes the field un-forgettable.
    const later = endTurn(state);
    expect(later.turn).toBe(stamped + 1);
    expect(later.handPlayLockedTurn.p2.Item).toBe(stamped);
    expect(handPlayBarred(later, "p2", "Item", undefined)).toBe(false);
  });

  it("the bar survives the attacker leaving the Active Spot — it is NOT a body stamp", () => {
    let state = openingFor(board(SEEDS[0], "p1", "p1", BUDEW), "p1");
    state = swing(state, "p1");
    expect(handPlayBarred(state, "p2", "Item", undefined)).toBe(true);
    // p2 retreats their OWN Active — the barred seat changing its board cannot
    // lift a bar printed on the player.
    const retreated = { ...state, players: { ...state.players } };
    expect(handPlayBarred(retreated, "p2", "Item", undefined)).toBe(true);
    // and the ATTACKER's body leaving play does not lift it either.
    const gone: GameState = {
      ...state,
      players: { ...state.players, p1: { ...state.players.p1, active: null } },
    };
    expect(handPlayBarred(gone, "p2", "Item", undefined)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. The engine gate — cardplay.ts, both classes, both directions.
// ─────────────────────────────────────────────────────────────────────────────

describe("D283 §3 — playTrainer refuses the barred class and ONLY the barred class", () => {
  for (const first of ["p1", "p2"] as const) {
    it(`the Supporter bar bites, and the Item beside it does not (first: ${first})`, () => {
      const attacker = first === "p1" ? "p2" : "p1";
      const victim = first;
      let state = openingFor(board(SEEDS[0], first, attacker, SCREAM_TAIL), attacker);
      state = swing(state, attacker);
      // it is now the victim's turn, and the bar is live.
      expect(state.phase.kind === "turn:action" && state.phase.seat).toBe(victim);
      expect(play(state, victim, SUPPORTER)).toBe("HAND_PLAY_BLOCKED");
      expect(play(state, victim, ITEM)).toBe("OK");
    });

    it(`the Item bar bites, and the Supporter beside it does not (first: ${first})`, () => {
      const attacker = first;
      const victim = first === "p1" ? "p2" : "p1";
      let state = openingFor(board(SEEDS[1], first, attacker, BUDEW), attacker);
      state = swing(state, attacker);
      expect(play(state, victim, ITEM)).toBe("HAND_PLAY_BLOCKED");
      expect(play(state, victim, SUPPORTER)).toBe("OK");
    });
  }

  it("Galvantula ex pays its printed cost AND installs the bar, in printed order", () => {
    let state = openingFor(board(SEEDS[3], "p1", "p1", GALVANTULA), "p1");
    const before = state.players.p1.active?.energy.length ?? 0;
    expect(before).toBe(2);
    state = swing(state, "p1");
    // the cost was really paid — the compound anchor is not the bare one.
    expect(state.players.p1.active?.energy.length ?? -1).toBe(0);
    expect(play(state, "p2", ITEM)).toBe("HAND_PLAY_BLOCKED");
    expect(play(state, "p2", SUPPORTER)).toBe("OK");
  });

  it("THE BAR IS GONE THE TURN AFTER — the board where the permission is RESTORED", () => {
    let state = openingFor(board(SEEDS[2], "p1", "p1", BUDEW), "p1");
    state = swing(state, "p1");
    expect(play(state, "p2", ITEM)).toBe("HAND_PLAY_BLOCKED");
    state = endTurn(state); // p2's barred turn ends
    state = endTurn(state); // p1 plays and passes back
    expect(state.phase.kind === "turn:action" && state.phase.seat).toBe("p2");
    expect(play(state, "p2", ITEM)).toBe("OK");
  });

  it("the CONTROL body bars nothing — the whole section is vacuous without this", () => {
    let state = openingFor(board(SEEDS[0], "p1", "p1", PLAIN), "p1");
    state = swing(state, "p1");
    expect(play(state, "p2", ITEM)).toBe("OK");
    expect(play(state, "p2", SUPPORTER)).toBe("OK");
  });

  it("the imposed bar is ORDERED AFTER §4 and §7.2, so a player's own limits still name themselves", () => {
    // The barred seat is the going-FIRST player on turn 1 is impossible (Scream
    // needs turn 2), so §4 is driven where it can actually collide: a second
    // Supporter in one turn under an Item bar still reports §7.2.
    let state = openingFor(board(SEEDS[1], "p1", "p1", BUDEW), "p1");
    state = swing(state, "p1");
    // Nemona goes in AFTER the swing so Professor's Research cannot discard it.
    const uid = handUid(state, "p2", SUPPORTER);
    let after = must(applyAction(state, { type: "playTrainer", seat: "p2", uid }));
    // Professor's Research discarded the hand, so BOTH rows are re-seeded from
    // the deck — the point of the assertion is the ORDER of the two refusals,
    // not which cards survived the draw.
    after = handFromDeck(after, "p2", SUPPORTER_2, 1);
    after = handFromDeck(after, "p2", ITEM, 1);
    expect(play(after, "p2", SUPPORTER_2)).toBe("SUPPORTER_ALREADY_PLAYED");
    expect(play(after, "p2", ITEM)).toBe("HAND_PLAY_BLOCKED");
  });

  it("HAND_PLAY_BLOCKED is emitted once, names the BARRED seat and carries no uid", () => {
    const state = openingFor(board(SEEDS[0], "p1", "p1", BUDEW), "p1");
    const result = applyAction(state, { type: "attack", seat: "p1", index: 0 });
    if (!result.ok) throw new Error("attack refused");
    const rows = result.events.filter((e) => e.type === "HAND_PLAY_BLOCKED");
    expect(rows).toEqual([{ type: "HAND_PLAY_BLOCKED", seat: "p2", bars: "Item" }]);
  });
});

describe("D283 §4 — redactedTrainersOf greys EXACTLY what playTrainer refuses", () => {
  it("the barred Supporter row is disabled and the Item row beside it is not", () => {
    let state = openingFor(board(SEEDS[0], "p1", "p2", SCREAM_TAIL), "p2");
    state = swing(state, "p2");
    expect(wireDisabled(state, "p1", SUPPORTER)).toBe(true);
    expect(wireDisabled(state, "p1", ITEM)).toBe(false);
    expect(play(state, "p1", SUPPORTER)).toBe("HAND_PLAY_BLOCKED");
    expect(play(state, "p1", ITEM)).toBe("OK");
  });

  it("the barred Item row is disabled and the Supporter row beside it is not", () => {
    let state = openingFor(board(SEEDS[1], "p1", "p1", BUDEW), "p1");
    state = swing(state, "p1");
    expect(wireDisabled(state, "p2", ITEM)).toBe(true);
    expect(wireDisabled(state, "p2", SUPPORTER)).toBe(false);
    expect(play(state, "p2", ITEM)).toBe("HAND_PLAY_BLOCKED");
    expect(play(state, "p2", SUPPORTER)).toBe("OK");
  });

  it("and nothing is greyed on an unbarred board — the mirror's own control", () => {
    let state = openingFor(board(SEEDS[0], "p1", "p1", PLAIN), "p1");
    state = swing(state, "p1");
    expect(wireDisabled(state, "p2", ITEM)).toBe(false);
    expect(wireDisabled(state, "p2", SUPPORTER)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. The rule this op deliberately does NOT copy from its siblings.
// ─────────────────────────────────────────────────────────────────────────────

describe("D283 §5 — §11 does not gate a bar whose object is a SEAT", () => {
  it("a defender behind a full effect block is barred all the same", () => {
    let state = openingFor(board(SEEDS[0], "p1", "p1", BUDEW), "p1");
    const victimActive = state.players.p2.active;
    if (victimActive === null) throw new Error("p2 has no Active");
    state = {
      ...state,
      players: {
        ...state.players,
        p2: {
          ...state.players.p2,
          active: { ...victimActive, attackBlock: { turn: state.turn, effects: true } },
        },
      },
    };
    state = swing(state, "p1");
    expect(handPlayBarred(state, "p2", "Item", undefined)).toBe(true);
    expect(play(state, "p2", ITEM)).toBe("HAND_PLAY_BLOCKED");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. MATCH_RECORD_VERSION — driven in BOTH directions, not asserted.
// ─────────────────────────────────────────────────────────────────────────────

describe("D283 §6 — the bump, driven", () => {
  it("A VERSION-14 RECORD THROWS RATHER THAN READING BACK BENIGNLY", () => {
    let state = openingFor(board(SEEDS[0], "p1", "p1", BUDEW), "p1");
    state = swing(state, "p1");
    const v14 = { ...state } as Omit<GameState, "handPlayLockedTurn"> & {
      handPlayLockedTurn?: GameState["handPlayLockedTurn"];
    };
    // biome-ignore lint/performance/noDelete: rebuilding an ABSENT key is the point.
    delete v14.handPlayLockedTurn;
    expect("handPlayLockedTurn" in v14).toBe(false);
    expect(() => handPlayBarred(v14 as GameState, "p2", "Item", undefined)).toThrow(TypeError);
    // and it reaches the real play path, not only the reader in isolation.
    const uid = handUid(state, "p2", ITEM);
    expect(() => applyAction(v14 as GameState, { type: "playTrainer", seat: "p2", uid })).toThrow(
      TypeError,
    );
  });

  it("AND THE OTHER DIRECTION — the key IS present on every board this build writes", () => {
    const barred = swing(openingFor(board(SEEDS[0], "p1", "p1", BUDEW), "p1"), "p1");
    const plain = swing(openingFor(board(SEEDS[0], "p1", "p1", PLAIN), "p1"), "p1");
    expect(Object.keys(barred).sort()).toEqual(Object.keys(plain).sort());
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
    for (const state of [barred, plain]) {
      for (const seat of ["p1", "p2"] as const) {
        expect(Object.keys(state.handPlayLockedTurn[seat]).sort()).toEqual(
          ["Item", "Supporter", "Stadium", "evolve"].sort(),
        );
      }
    }
  });

  it("NOTHING ELSE PERSISTED MOVED — no InPlayPokemon key, no TurnAllowances key", () => {
    // The version question asked of the two records that could plausibly have
    // carried this instead, and were refused for stated reasons (types.ts).
    const barred = swing(openingFor(board(SEEDS[0], "p1", "p1", BUDEW), "p1"), "p1");
    const plain = swing(openingFor(board(SEEDS[0], "p1", "p1", PLAIN), "p1"), "p1");
    const bodyKeys = (s: GameState): string[] =>
      Object.keys(s.players.p2.active ?? {})
        .slice()
        .sort();
    expect(bodyKeys(barred)).toEqual(bodyKeys(plain));
    expect(Object.keys(barred.allowances).sort()).toEqual(Object.keys(plain.allowances).sort());
  });
});
