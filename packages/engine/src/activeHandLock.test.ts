import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { applyAction, createGame, handPlayBarred, programFor, redactGame } from "./index";
import type { GameState, Seat } from "./index";
import {
  completeSetup,
  FIXTURE_POOL,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  deepFreeze,
  handFromDeck,
  handUid,
  setActiveFromDeck,
  setDamage,
  must,
} from "./testFixtures";

// ─────────────────────────────────────────────────────────────────────────────
// The printed strings, byte-exact off the D1 rows.
// ─────────────────────────────────────────────────────────────────────────────

const DAUNTING_GAZE_TEXT =
  "As long as this Pokémon is in the Active Spot, your opponent can't play any Item cards from their hand.";
const OCEANIC_CURSE_TEXT =
  "As long as this Pokémon is in the Active Spot, your opponent can't play any Item cards or Pokémon Tool cards from their hand.";
/** The three REFUSED sentences, pinned so the refusals stay checkable. */
const MASSIVE_BODY_TEXT =
  "As long as this Pokémon is in the Active Spot, your opponent can't play any Stadium cards from their hand.";
const POTENT_GLARE_TEXT =
  "As long as this Pokémon is in the Active Spot, your opponent can't play any Pokémon that has an Ability from their hand, except for Team Rocket's Pokémon.";
const ACE_NULLIFIER_TEXT =
  "If this Pokémon has a Pokémon Tool attached, your opponent can't play any ACE SPEC cards from their hand.";

const TYRANITAR = "sv09-095";
const JELLICENT = "sv10.5w-045";
const JELLICENT_2 = "sv10.5w-160";
const JELLICENT_3 = "sv10.5w-168";
const COPPERAJAH = "sv06.5-042";
const ARBOK = "sv10-113";
const GENESECT = "sv06.5-040";

const ITEM = "sv01-188";
/** Professor's Research — the Supporter CONTROL. Tyranitar and Jellicent bar
    Items; a build that collapsed the class list to "any Trainer" refuses this. */
const SUPPORTER = "sv01-189";
/** Vitality Band — a Pokémon TOOL with a simulated passive, so `attachTool`'s
    "is it simulated" gate cannot be what refuses it. */
const TOOL = "sv01-197";
/** Bravery Charm — a SECOND Tool, so §3 can attach one after the other without
    §7.4's one-Tool-per-Pokémon cap being the reason a second attempt fails. */
const TOOL_2 = "sv02-173";
const TING_LU = "sv02-127";
/** The CONTROL body: same board, same hands, NO Ability. Every "the bar bites"
    assertion below passes just as happily on a build that refused every Item. */
const PLAIN = "fix-plain-barrier";

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

function jellicent(id: string): Card {
  return battler(id, {
    name: "Jellicent ex",
    hp: 280,
    retreat: 2,
    types: ["Water"],
    stage: "Stage1",
    abilities: [{ type: "Ability", name: "Oceanic Curse", effect: OCEANIC_CURSE_TEXT }],
  });
}

const LOCAL_CARDS: Record<string, Card> = {
  [TYRANITAR]: tyranitar(TYRANITAR),
  [JELLICENT]: jellicent(JELLICENT),
  [JELLICENT_2]: jellicent(JELLICENT_2),
  [JELLICENT_3]: jellicent(JELLICENT_3),
  [PLAIN]: battler(PLAIN, {
    name: "Plain Barrier",
    hp: 200,
    retreat: 1,
    types: ["Colorless"],
    stage: "Stage2",
  }),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const LOCK_DECK = deckOf({
  [TYRANITAR]: 4,
  [JELLICENT]: 4,
  [JELLICENT_2]: 1,
  [JELLICENT_3]: 1,
  [PLAIN]: 4,
  [TING_LU]: 2,
  [ITEM]: 4,
  [SUPPORTER]: 4,
  [TOOL]: 3,
  [TOOL_2]: 2,
  "fix-basic-1": 4,
  "fix-energy": 27,
});

const SEEDS = [6101, 6113, 6121, 6133] as const;

function localSetup(seed: number, first: Seat): GameState {
  const created = createGame({ seed, decks: { p1: LOCK_DECK, p2: LOCK_DECK }, cardPool: POOL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(
    applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first }),
  );
  state = completeSetup(state);
  return state;
}

function board(seed: number, first: Seat, barrier: Seat, barrierId: string): GameState {
  let state = localSetup(seed, first);
  const victim = barrier === "p1" ? "p2" : "p1";
  state = setActiveFromDeck(state, barrier, barrierId);
  state = clearBench(state, barrier);
  state = benchFromDeck(state, barrier, "fix-basic-1");
  state = setActiveFromDeck(state, victim, PLAIN);
  state = clearBench(state, victim);
  state = benchFromDeck(state, victim, "fix-basic-1");
  for (const seat of ["p1", "p2"] as const) {
    state = handFromDeck(state, seat, ITEM, 1);
    state = handFromDeck(state, seat, SUPPORTER, 1);
    state = handFromDeck(state, seat, TOOL, 1);
    state = handFromDeck(state, seat, TOOL_2, 1);
    state = setDamage(state, seat, 10);
  }
  return state;
}

/** Walk the clock so `seat` is the one to move. Both a bar and its absence are
    only observable on the barred player's OWN turn — every other refusal below
    would be the phase gate wearing the rule's name. */
function turnOf(state: GameState, seat: Seat): GameState {
  let next = state;
  for (let i = 0; i < 4; i += 1) {
    if (next.phase.kind !== "turn:action") throw new Error(`stuck in ${next.phase.kind}`);
    if (next.phase.seat === seat) return next;
    next = must(applyAction(next, { type: "endTurn", seat: next.phase.seat }));
  }
  throw new Error(`never reached ${seat}'s turn`);
}

/** Play `cardId` from `seat`'s hand and report the error code, or "OK". Every
    assertion goes through this so a green "the bar refuses" line can never be a
    refusal for the WRONG reason. */
function play(state: GameState, seat: Seat, cardId: string): string {
  const uid = handUid(state, seat, cardId);
  const result = applyAction(deepFreeze(state), { type: "playTrainer", seat, uid });
  return result.ok ? "OK" : result.error.code;
}

/** The §7.4 twin — the read site `playTrainer` cannot reach. */
function attach(
  state: GameState,
  seat: Seat,
  cardId: string,
  spot: "bench" | "active" = "bench",
): string {
  const uid = handUid(state, seat, cardId);
  const target =
    spot === "active" ? ({ spot: "active" } as const) : ({ spot: "bench", index: 0 } as const);
  const result = applyAction(deepFreeze(state), { type: "attachTool", seat, uid, target });
  return result.ok ? "OK" : result.error.code;
}

function wireDisabled(state: GameState, seat: Seat, cardId: string): boolean | undefined {
  const phase = redactGame(state, seat).phase;
  if (phase.kind !== "turn:action") throw new Error(`expected turn:action, got ${phase.kind}`);
  const uid = handUid(state, seat, cardId);
  return phase.trainers.find((t) => t.uid === uid)?.disabled;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. THE CATALOG — five sentences, four built, three refused BY NAME.
// ─────────────────────────────────────────────────────────────────────────────

describe("D284 §1 — the census, and which of it this vocabulary reaches", () => {
  it("the FOUR built printings carry the field, and the class list is the printed one", () => {
    expect(programFor(TYRANITAR)?.passive?.preventOpponentHandPlay).toEqual(["Item"]);
    for (const id of [JELLICENT, JELLICENT_2, JELLICENT_3]) {
      expect(programFor(id)?.passive?.preventOpponentHandPlay, id).toEqual(["Item", "Tool"]);
    }
    expect(programFor(TYRANITAR)?.passive?.preventOpponentHandPlay).not.toContain("Tool");
  });

  it("the three REPRINTS share ONE program object — the reprint idiom, asserted", () => {
    expect(programFor(JELLICENT_2)).toBe(programFor(JELLICENT));
    expect(programFor(JELLICENT_3)).toBe(programFor(JELLICENT));
    expect(programFor(TYRANITAR)).not.toBe(programFor(JELLICENT));
  });

  it("D291 — ALL THREE ONCE-REFUSED PRINTINGS NOW CARRY A PROGRAM, AND EACH ON ITS OWN FIELD", () => {
    expect(programFor(COPPERAJAH)?.passive?.preventOpponentHandPlay).toEqual(["Stadium"]);
    expect(programFor(ARBOK)?.passive?.preventOpponentPokemonPlay).toBeDefined();
    expect(programFor(GENESECT)?.passive?.preventOpponentAceSpecPlayWhileToolAttached).toBe(true);
    expect(programFor(GENESECT)?.passive?.preventOpponentHandPlay).toBeUndefined();
    // The printed noun is pinned so the claim cannot be quietly re-read as a
    // `trainerType` one.
    expect(ACE_NULLIFIER_TEXT).toContain("any ACE SPEC cards from their hand");
  });

  it("GENESECT'S WINDOW IS *NOT* THE ACTIVE SPOT — the inherited claim, corrected", () => {
    expect(ACE_NULLIFIER_TEXT.startsWith("If this Pokémon has a Pokémon Tool attached")).toBe(true);
    expect(ACE_NULLIFIER_TEXT).not.toContain("in the Active Spot");
    for (const text of [
      DAUNTING_GAZE_TEXT,
      OCEANIC_CURSE_TEXT,
      MASSIVE_BODY_TEXT,
      POTENT_GLARE_TEXT,
    ]) {
      expect(text.startsWith("As long as this Pokémon is in the Active Spot,")).toBe(true);
    }
    expect(POOL[TYRANITAR]?.abilities?.[0]?.effect).toBe(DAUNTING_GAZE_TEXT);
    for (const id of [JELLICENT, JELLICENT_2, JELLICENT_3]) {
      expect(POOL[id]?.abilities?.[0]?.effect, id).toBe(OCEANIC_CURSE_TEXT);
    }
  });

  it("the two BUILT sentences differ in exactly the class slot — the anchor's shape", () => {
    expect(OCEANIC_CURSE_TEXT.replace(" or Pokémon Tool cards", "")).toBe(DAUNTING_GAZE_TEXT);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. THE BAR BITES — and the CONTROL that makes the claim mean anything.
// ─────────────────────────────────────────────────────────────────────────────

describe("D284 §2 — the bar, and the control body", () => {
  it("an opposing TYRANITAR in the Active Spot refuses the Item", () => {
    for (const seed of SEEDS) {
      const state = turnOf(board(seed, "p1", "p1", TYRANITAR), "p2");
      expect(play(state, "p2", ITEM)).toBe("HAND_PLAY_BLOCKED");
    }
  });

  it("THE CONTROL — the same board with a body that prints NOTHING lets it through", () => {
    // Without this every assertion in this file is green on a build that refuses
    // every Item on every board.
    for (const seed of SEEDS) {
      const state = turnOf(board(seed, "p1", "p1", PLAIN), "p2");
      expect(play(state, "p2", ITEM)).toBe("OK");
    }
  });

  it("the SUPPORTER is untouched — the class list is read, not collapsed to a flag", () => {
    for (const barrier of [TYRANITAR, JELLICENT] as const) {
      const state = turnOf(board(SEEDS[0], "p1", "p1", barrier), "p2");
      expect(play(state, "p2", SUPPORTER), barrier).toBe("OK");
      expect(play(state, "p2", ITEM), barrier).toBe("HAND_PLAY_BLOCKED");
    }
  });

  it("the predicate answers per CLASS, at the reader, on the same board", () => {
    const state = turnOf(board(SEEDS[0], "p1", "p1", TYRANITAR), "p2");
    expect(handPlayBarred(state, "p2", "Item", undefined)).toBe(true);
    expect(handPlayBarred(state, "p2", "Supporter", undefined)).toBe(false);
    expect(handPlayBarred(state, "p2", "Tool", undefined)).toBe(false);
  });
});

describe("D284 §3 — attachTool, the read site playTrainer cannot reach", () => {
  it("AN OPPOSING JELLICENT ex REFUSES THE TOOL ATTACH", () => {
    for (const seed of SEEDS) {
      const state = turnOf(board(seed, "p1", "p1", JELLICENT), "p2");
      expect(attach(state, "p2", TOOL)).toBe("HAND_PLAY_BLOCKED");
    }
  });

  it("AND TYRANITAR DOES NOT — the one assertion that tells the two sentences apart", () => {
    // A build that ignored the array and barred ["Item","Tool"] for BOTH rows is
    // green on every other line in this file. This is the line it fails.
    for (const seed of SEEDS) {
      const state = turnOf(board(seed, "p1", "p1", TYRANITAR), "p2");
      expect(attach(state, "p2", TOOL)).toBe("OK");
      // …and the Item on the SAME board is still refused, so the Tool landing is
      // not the bar being absent altogether.
      expect(play(state, "p2", ITEM)).toBe("HAND_PLAY_BLOCKED");
    }
  });

  it("the CONTROL body lets the Tool through, so the refusal is the rule and not §7.4", () => {
    const state = turnOf(board(SEEDS[0], "p1", "p1", PLAIN), "p2");
    expect(attach(state, "p2", TOOL)).toBe("OK");
    expect(attach(state, "p2", TOOL_2, "active")).toBe("OK");
  });

  it("the bar is ABOVE §7.4's own mechanics — a barred seat is not told about the slot", () => {
    const open = turnOf(board(SEEDS[0], "p1", "p1", PLAIN), "p2");
    const filled = must(
      applyAction(open, {
        type: "attachTool",
        seat: "p2",
        uid: handUid(open, "p2", TOOL),
        target: { spot: "bench", index: 0 },
      }),
    );
    expect(attach(filled, "p2", TOOL_2)).toBe("TOOL_ALREADY_ATTACHED");
    const barred = turnOf(board(SEEDS[0], "p1", "p1", JELLICENT), "p2");
    const host = barred.players.p2.bench[0];
    if (host === undefined) throw new Error("no benched host");
    const barredFilled: GameState = {
      ...barred,
      players: {
        ...barred.players,
        p2: {
          ...barred.players.p2,
          bench: [
            { ...host, tools: [handUid(barred, "p2", TOOL)] },
            ...barred.players.p2.bench.slice(1),
          ],
        },
      },
    };
    expect(attach(barredFilled, "p2", TOOL_2)).toBe("HAND_PLAY_BLOCKED");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. THE WINDOW — continuous, and ACTIVE-ONLY.
// ─────────────────────────────────────────────────────────────────────────────

describe("D284 §4 — the printed window", () => {
  it("A BENCHED JELLICENT BARS NOTHING — the source clause is read", () => {
    for (const seed of SEEDS) {
      let state = board(seed, "p1", "p1", PLAIN);
      state = benchFromDeck(state, "p1", JELLICENT);
      state = turnOf(state, "p2");
      expect(play(state, "p2", ITEM)).toBe("OK");
      expect(attach(state, "p2", TOOL)).toBe("OK");
    }
  });

  it("the bar is CONTINUOUS, not turn-scoped — it survives the turn boundary", () => {
    let state = turnOf(board(SEEDS[0], "p1", "p1", TYRANITAR), "p2");
    expect(play(state, "p2", ITEM)).toBe("HAND_PLAY_BLOCKED");
    state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
    state = turnOf(state, "p2");
    expect(play(state, "p2", ITEM)).toBe("HAND_PLAY_BLOCKED");
    state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
    state = turnOf(state, "p2");
    expect(play(state, "p2", ITEM)).toBe("HAND_PLAY_BLOCKED");
    const lifted = {
      ...state,
      players: { ...state.players, p1: { ...state.players.p1, active: null } },
    };
    expect(handPlayBarred(lifted, "p2", "Item", undefined)).toBe(false);
  });

  it("NOTHING WAS PERSISTED — the barred board's stamp record is empty on both seats", () => {
    const state = turnOf(board(SEEDS[0], "p1", "p1", JELLICENT), "p2");
    expect(handPlayBarred(state, "p2", "Item", undefined)).toBe(true);
    for (const seat of ["p1", "p2"] as const) {
      expect(state.handPlayLockedTurn[seat]).toEqual({
        Item: null,
        Supporter: null,
        Stadium: null,
        evolve: null,
      });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. THE PERSPECTIVE FLIP — "your opponent", from both seats.
// ─────────────────────────────────────────────────────────────────────────────

describe("D284 §5 — whose hand is barred", () => {
  it("THE BARRING SEAT'S OWN HAND IS FREE — from both seats, under both assignments", () => {
    for (const first of ["p1", "p2"] as const) {
      for (const barrier of ["p1", "p2"] as const) {
        const victim = barrier === "p1" ? "p2" : "p1";
        const seeded = board(SEEDS[0], first, barrier, JELLICENT);
        const label = `${first}/${barrier}`;
        // The holder plays its own Item and attaches its own Tool freely…
        const own = turnOf(seeded, barrier);
        expect(play(own, barrier, ITEM), label).toBe("OK");
        expect(attach(own, barrier, TOOL), label).toBe("OK");
        // …and the seat across the table cannot.
        const other = turnOf(seeded, victim);
        expect(play(other, victim, ITEM), label).toBe("HAND_PLAY_BLOCKED");
        expect(attach(other, victim, TOOL), label).toBe("HAND_PLAY_BLOCKED");
      }
    }
  });

  it("the reader answers per SEAT on one board, with no turn term at all", () => {
    const state = board(SEEDS[0], "p1", "p2", TYRANITAR);
    expect(handPlayBarred(state, "p1", "Item", undefined)).toBe(true);
    expect(handPlayBarred(state, "p2", "Item", undefined)).toBe(false);
  });
});

describe("D284 §6 — the wire mirror agrees with the engine", () => {
  it("the barred Item row is GREYED, and the Supporter beside it is not", () => {
    const state = turnOf(board(SEEDS[0], "p1", "p1", TYRANITAR), "p2");
    expect(wireDisabled(state, "p2", ITEM)).toBe(true);
    expect(wireDisabled(state, "p2", SUPPORTER)).toBe(false);
  });

  it("the CONTROL board greys neither — so the grey is the bar and not the row", () => {
    const state = turnOf(board(SEEDS[0], "p1", "p1", PLAIN), "p2");
    expect(wireDisabled(state, "p2", ITEM)).toBe(false);
    expect(wireDisabled(state, "p2", SUPPORTER)).toBe(false);
  });

  it("the mirror and the engine agree on every row of every board — the sweep", () => {
    for (const barrier of [TYRANITAR, JELLICENT, PLAIN] as const) {
      for (const cardId of [ITEM, SUPPORTER] as const) {
        const state = turnOf(board(SEEDS[1], "p2", "p1", barrier), "p2");
        const label = `${barrier}/${cardId}`;
        const engineSaid = play(state, "p2", cardId) !== "OK";
        expect(wireDisabled(state, "p2", cardId), label).toBe(engineSaid);
      }
    }
  });

  it("THE MIRRORS LIST NO TOOL ROW AT ALL — stated, because it looks like a gap", () => {
    const state = turnOf(board(SEEDS[0], "p1", "p1", JELLICENT), "p2");
    const phase = redactGame(state, "p2").phase;
    if (phase.kind !== "turn:action") throw new Error("expected turn:action");
    const toolUid = handUid(state, "p2", TOOL);
    expect(phase.trainers.find((t) => t.uid === toolUid)).toBeUndefined();
    // …and the engine still refuses it, which is the whole of the feedback.
    expect(attach(state, "p2", TOOL)).toBe("HAND_PLAY_BLOCKED");
  });
});

describe("D284 §7 — Klefki's family takes the bar down", () => {
  function underCursedLand(barrierId: string): GameState {
    let state = board(SEEDS[0], "p1", "p1", barrierId);
    state = setActiveFromDeck(state, "p2", TING_LU);
    state = clearBench(state, "p2");
    state = benchFromDeck(state, "p2", "fix-basic-1");
    state = setDamage(state, "p1", 20);
    state = handFromDeck(state, "p2", ITEM, 1);
    state = handFromDeck(state, "p2", TOOL, 1);
    return turnOf(state, "p2");
  }

  it("A SILENCED TYRANITAR BARS NOTHING — the bar rides passivesOf's §9 rule", () => {
    // A build that read `programFor(top.id)?.passive` at the funnel instead of
    // going through `disabledAbilityUids` is green everywhere else in this file.
    const state = underCursedLand(TYRANITAR);
    expect(handPlayBarred(state, "p2", "Item", undefined)).toBe(false);
    expect(play(state, "p2", ITEM)).toBe("OK");
  });

  it("AND JELLICENT ex IS EXEMPT — so the §9 claim is the lock and not the board", () => {
    // Same board, same damage, same lock. The only difference is the printed
    // suffix, which is what makes the line above a §9 assertion rather than a
    // "this board happens to allow it" assertion.
    const state = underCursedLand(JELLICENT);
    expect(handPlayBarred(state, "p2", "Item", undefined)).toBe(true);
    expect(play(state, "p2", ITEM)).toBe("HAND_PLAY_BLOCKED");
    expect(attach(state, "p2", TOOL)).toBe("HAND_PLAY_BLOCKED");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. MATCH_RECORD_VERSION — the NO-BUMP, driven in both directions.
// ─────────────────────────────────────────────────────────────────────────────

describe("D284 §8 — the version does NOT move, and that is driven", () => {
  it("A BARRED BOARD AND AN UNBARRED ONE ARE THE SAME PERSISTED SHAPE", () => {
    const barred = turnOf(board(SEEDS[0], "p1", "p1", JELLICENT), "p2");
    const plain = turnOf(board(SEEDS[0], "p1", "p1", PLAIN), "p2");
    expect(handPlayBarred(barred, "p2", "Item", undefined)).toBe(true);
    expect(handPlayBarred(plain, "p2", "Item", undefined)).toBe(false);
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
  });

  it('D285 — THE PERSISTED KEYS ARE EXACTLY THREE, AND `"Tool"` IS STILL NOT ONE ( D636 (D539): FOUR — `Stadium` joined; `Tool` still is not one)', () => {
    const barred = turnOf(board(SEEDS[0], "p1", "p1", JELLICENT), "p2");
    for (const seat of ["p1", "p2"] as const) {
      const keys = Object.keys(barred.handPlayLockedTurn[seat]).sort();
      expect(keys).toEqual(["Item", "Supporter", "Stadium", "evolve"].sort());
      expect(keys).not.toContain("Tool");
      expect(keys).not.toContain("bench");
    }
  });

  it("AN OLD RECORD READS BACK IDENTICALLY — a JSON round trip keeps the bar", () => {
    const barred = turnOf(board(SEEDS[0], "p1", "p1", JELLICENT), "p2");
    const round = JSON.parse(JSON.stringify(barred)) as GameState;
    expect(round).toEqual(barred);
    expect(handPlayBarred(round, "p2", "Item", undefined)).toBe(true);
    expect(handPlayBarred(round, "p2", "Tool", undefined)).toBe(true);
    // …and the real play path agrees on the revived record, not just the reader.
    expect(play(round, "p2", ITEM)).toBe("HAND_PLAY_BLOCKED");
  });

  it("NO PERSISTED STRUCTURE MENTIONS THE NEW KEY — the whole-registry sweep", () => {
    // The other half of "it persists nothing": the field is CATALOG data, so it
    // must appear in `programFor` and NOWHERE in a serialized board. A sweep
    // rather than a spot check, because a leak would be one key on one body.
    const barred = turnOf(board(SEEDS[0], "p1", "p1", JELLICENT), "p2");
    const persisted = JSON.stringify({ ...barred, cardPool: undefined });
    expect(persisted).not.toContain("preventOpponentHandPlay");
    expect(JSON.stringify(programFor(JELLICENT))).toContain("preventOpponentHandPlay");
    // And no body grew a key either — the `InPlayPokemon` record this rule was
    // deliberately NOT stamped onto.
    const plain = turnOf(board(SEEDS[0], "p1", "p1", PLAIN), "p2");
    const bodyKeys = (s: GameState): string[] => Object.keys(s.players.p1.active ?? {}).sort();
    expect(bodyKeys(barred)).toEqual(bodyKeys(plain));
    expect(Object.keys(barred.allowances).sort()).toEqual(Object.keys(plain.allowances).sort());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. THE TWO SOURCES COMPOSE — one funnel, two writers, no double-count.
// ─────────────────────────────────────────────────────────────────────────────

describe("D284 §9 — the widened funnel, with both sources live", () => {
  it("the STAMPED source still answers through the same reader", () => {
    const state = turnOf(board(SEEDS[0], "p1", "p1", PLAIN), "p2");
    const stamped: GameState = {
      ...state,
      handPlayLockedTurn: {
        ...state.handPlayLockedTurn,
        p2: { Item: state.turn, Supporter: null, Stadium: null, evolve: null },
      },
    };
    expect(handPlayBarred(stamped, "p2", "Item", undefined)).toBe(true);
    expect(handPlayBarred(stamped, "p2", "Supporter", undefined)).toBe(false);
    expect(play(stamped, "p2", ITEM)).toBe("HAND_PLAY_BLOCKED");
    expect(handPlayBarred(stamped, "p2", "Tool", undefined)).toBe(false);
    expect(attach(stamped, "p2", TOOL)).toBe("OK");
  });

  it("BOTH sources on one board is still one refusal, and lifting one is not lifting both", () => {
    const state = turnOf(board(SEEDS[0], "p1", "p1", TYRANITAR), "p2");
    const both: GameState = {
      ...state,
      handPlayLockedTurn: {
        ...state.handPlayLockedTurn,
        p2: { Item: state.turn, Supporter: state.turn, Stadium: null, evolve: null },
      },
    };
    expect(play(both, "p2", ITEM)).toBe("HAND_PLAY_BLOCKED");
    expect(play(both, "p2", SUPPORTER)).toBe("HAND_PLAY_BLOCKED");
    // Drop the STAMP and the Item is still barred by the body; the Supporter,
    // which only the stamp named, comes back. An OR that had collapsed to either
    // single source fails one of these two lines.
    const passiveOnly: GameState = { ...both, handPlayLockedTurn: state.handPlayLockedTurn };
    expect(play(passiveOnly, "p2", ITEM)).toBe("HAND_PLAY_BLOCKED");
    expect(play(passiveOnly, "p2", SUPPORTER)).toBe("OK");
  });
});
