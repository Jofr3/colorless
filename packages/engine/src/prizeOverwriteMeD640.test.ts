import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import { meAttackCorpus } from "./censusAttackCorpusMe";
import { installedWeaknessRetypeOf, installedWeaknessRewriteOf } from "./continuous";
import { deriveAttackEffect } from "./effects";
import type { GameAction, GameEvent, GameState, InPlayPokemon, Seat } from "./index";
import { applyAction, createGame, engineVersion } from "./index";
import { conditionHolds } from "./interpreter";
import { formatElapsed, type LogContext, logFromEvents } from "./log";
import { programFor } from "./registry";
import {
  FIXTURE_POOL,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  mustApply,
  setActiveFromDeck,
  typedEnergy,
} from "./testFixtures";

// ── 🆕🆕🆕 D640 — Y1a + MRV47, CUT TO OVERWRITING BOLT AND CELEBRATION ────────────────────────────────────────────
//
// 2 attack sentences / 3 `30th` printings newly reader-built; every other text on the 3 cards was already built, so all
// 3 are finished. Every id and text off the LOCAL D1, 2026-10-10, `legal_standard = 1`; before this slice only the
// D633 / D639 drop pins and the census named any of them.
//
//   Overwriting Bolt (Pikachu `30th-040`)       — `retypeDefenderWeakness { type: "Lightning", asTimesTwo }`: the
//                                                 record's NEW `WeaknessRetype.asTimesTwo`, read as a Weakness
//                                                 REWRITE (continuous.ts `installedWeaknessRewriteOf`, R-OWB1).
//   Celebration (Gholdengo `30th-108` / `-142`) — `conditionGate { yourHandExactly 30 }` over `takePrize { count: 2,
//                                                 thenShuffleHand }`: the NEW `PendingStage` `shuffleHandIntoDeck`
//                                                 behind the Prize stage (R-CEL1).
//
// `MATCH_RECORD_VERSION` 46 → 47 (both shapes are persisted; apps/api `prizeStageMigrationD640.test.ts`). NAMED, NOT
// TAKEN: Rotom ex ×3 "Multi Adapter" (Y1a) owes 47 → 48 on its own. [🆕🆕🆕 D643 (D539): BUILT at D643, 47 → 48.]

const BOLT =
  "The Defending Pokémon's Weakness is now {L} until the end of your next turn. (Apply Weakness as ×2.)";
const CELEBRATION =
  "If you have exactly 30 cards in your hand, take 2 Prize cards. If you do, shuffle your hand into your deck.";
const S629 =
  "Until the end of your next turn, the Defending Pokémon's Weakness is now {C}. (The amount of Weakness doesn't change.)";
const SHRED = "This attack's damage isn't affected by any effects on your opponent's Active Pokémon.";
const PICK_OFF =
  "This attack does 30 damage to 1 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";
const FAIRY_ZONE_TEXT =
  "The Weakness of each of your opponent's {N} Pokémon in play is now {P}. (Apply Weakness as ×2.)";

/** [attack text, the `30th` printing ids that print it]. */
const SENTENCES: readonly (readonly [string, readonly string[]])[] = [
  [BOLT, ["30th-040"]],
  [CELEBRATION, ["30th-108", "30th-142"]],
];

describe("D640 §1 — the texts", () => {
  it("2 sentences / 3 printings, each a row of the committed `me` corpus, none printed in legal `sv`, each now read", () => {
    const me = new Map(meAttackCorpus().map(([n, text]) => [text, n]));
    const sv = new Set(legalAttackCorpus().map(([, text]) => text));
    for (const [text, ids] of SENTENCES) {
      expect([text, me.get(text)]).toEqual([text, ids.length]);
      expect(sv.has(text), text).toBe(false);
      expect(resolvedByAnyReader(text), text).toBe(true);
      for (const id of ids) expect(programFor(id), id).toBeUndefined();
    }
    expect(SENTENCES.flatMap(([, ids]) => ids)).toHaveLength(3);
  });

  it("Multi Adapter (Rotom ex ×3) stays unbuilt, named for 47 → 48: no program (🆕🆕🆕 D643 (D539): WITHDRAWN — built at D643, 47 → 48; inverted)", () => {
    // 🆕🆕🆕 D643 (D539) — WITHDRAWN: Rotom ex ×3 is keyed since D643 (`multiAdapterMeD643.test.ts`); inverted.
    for (const id of ["me02-029", "me02-111", "me02-126"]) expect(Object.keys(programFor(id) ?? {}), id).toEqual(["passive"]);
  });
});

describe("D640 §2 — the readings", () => {
  it("Overwriting Bolt: D552's op at the printed {L}, applied as ×2; D552's own sentence keeps no key", () => {
    expect(deriveAttackEffect(BOLT)).toEqual([{ op: "retypeDefenderWeakness", type: "Lightning", asTimesTwo: true }]);
    expect(deriveAttackEffect(S629)).toEqual([{ op: "retypeDefenderWeakness", type: "Colorless" }]);
    expect(deriveAttackEffect(BOLT.replace("{L}", "{R}"))).toBeNull();
    expect(deriveAttackEffect(BOLT.replace(" (Apply Weakness as ×2.)", ""))).toBeNull();
    expect(deriveAttackEffect(BOLT.replace("your next turn", "your opponent's next turn"))).toBeNull();
    expect(deriveAttackEffect(`${BOLT} Draw a card.`)).toBeNull();
  });

  it("Celebration: the hand gate over the 2-Prize take with the shuffle behind it", () => {
    expect(deriveAttackEffect(CELEBRATION)).toEqual([
      {
        op: "conditionGate",
        cond: { kind: "yourHandExactly", count: 30 },
        // biome-ignore lint/suspicious/noThenProperty: the effect contract's gated-step list.
        then: [{ op: "takePrize", count: 2, thenShuffleHand: true }],
      },
    ]);
    expect(deriveAttackEffect(CELEBRATION.replace("30 cards", "29 cards"))).toBeNull();
    expect(deriveAttackEffect(CELEBRATION.replace(" If you do, shuffle your hand into your deck.", ""))).toBeNull();
    expect(deriveAttackEffect(CELEBRATION.replace("take 2 Prize cards", "take 1 Prize card"))).toBeNull();
  });
});

// ── ON A BOARD ──

const FILLER = "d640-filler"; // {C}, no printed Weakness
const FIRE_WEAK = "d640-fire-weak"; // ×2 {R} printed
const DRAGON = "d640-dragon"; // {N}, no printed Weakness — Fairy Zone's target
const VOLT = "d640-volt"; // a {L} attacker
const EMBER = "d640-ember"; // a {R} attacker
const L = "d640-lightning";
const M = "d640-metal";
const STRIKE = 0;
const SNIPE = 1;
const SHRED_HIT = 2;

const TAP: Card["attacks"] = [{ cost: ["Colorless"], name: "Tap", damage: 10 }];
const LOCAL: Record<string, Card> = {
  "30th-040": battler("30th-040", {
    name: "Pikachu",
    hp: 80,
    types: ["Lightning"],
    retreat: 1,
    weaknesses: [{ type: "Fighting", value: "×2" }],
    attacks: [{ cost: ["Lightning"], name: "Overwriting Bolt", damage: 10, effect: BOLT }],
  }),
  "30th-108": battler("30th-108", {
    name: "Gholdengo",
    hp: 130,
    types: ["Metal"],
    stage: "Stage1",
    evolveFrom: "Gimmighoul",
    retreat: 2,
    weaknesses: [{ type: "Fire", value: "×2" }],
    attacks: [
      { cost: ["Metal"], name: "Celebration", effect: CELEBRATION },
      { cost: ["Metal"], name: "Triple Smash", damage: "50×", effect: "Flip 3 coins. This attack does 50 damage for each heads." },
    ],
  }),
  [VOLT]: battler(VOLT, {
    name: "D640 Volt",
    hp: 300,
    types: ["Lightning"],
    attacks: [
      { cost: ["Colorless"], name: "Strike", damage: 50 },
      { cost: ["Colorless"], name: "Pick Off", effect: PICK_OFF },
      { cost: ["Colorless"], name: "Shred", damage: 50, effect: SHRED },
    ],
  }),
  [EMBER]: battler(EMBER, {
    name: "D640 Ember",
    hp: 300,
    types: ["Fire"],
    attacks: [{ cost: ["Colorless"], name: "Strike", damage: 50 }],
  }),
  [FILLER]: battler(FILLER, { name: "D640 Filler", hp: 900, types: ["Colorless"], attacks: TAP }),
  [FIRE_WEAK]: battler(FIRE_WEAK, {
    name: "D640 Fire Weak",
    hp: 900,
    types: ["Grass"],
    weaknesses: [{ type: "Fire", value: "×2" }],
    attacks: TAP,
  }),
  [DRAGON]: battler(DRAGON, { name: "D640 Dragon", hp: 900, types: ["Dragon"], attacks: TAP }),
  "sv09-056": battler("sv09-056", {
    name: "Lillie's Clefairy ex",
    hp: 190,
    types: ["Psychic"],
    abilities: [{ type: "Ability", name: "Fairy Zone", effect: FAIRY_ZONE_TEXT }],
    attacks: TAP,
  }),
  [L]: typedEnergy(L, "Lightning"),
  [M]: typedEnergy(M, "Metal"),
};
const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL };
const DECK = deckOf({
  "30th-040": 1,
  "30th-108": 1,
  [VOLT]: 1,
  [EMBER]: 1,
  [FILLER]: 10,
  [FIRE_WEAK]: 1,
  [DRAGON]: 1,
  "sv09-056": 1,
  [L]: 4,
  [M]: 4,
  "fix-energy": 35,
});
const BOARD_IDS = new Set(Object.keys(LOCAL).filter((id) => id !== FILLER));

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

/** Setup, then P1's own FIRST turn (P2 went first and passed); both hands back into the decks. */
function p1Turn(): GameState {
  const created = createGame({ seed: 6402, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first: "p2" }));
  while (state.phase.kind === "setup:drawExtra") {
    const phase = state.phase;
    const s = (["p1", "p2"] as const).find((x) => !phase.decided[x]);
    if (s === undefined) throw new Error("setup:drawExtra with every seat decided");
    state = must(applyAction(state, { type: "setupDrawExtra", seat: s, count: phase.owed[s] }));
  }
  for (const s of ["p1", "p2"] as const) {
    const uid = state.players[s].hand.find((h) => POOL[state.cardIdByUid[h] ?? ""]?.stage === "Basic");
    if (uid === undefined) throw new Error(`no Basic in ${s}'s hand`);
    state = must(applyAction(state, { type: "setupPlaceActive", seat: s, uid }));
  }
  for (const s of ["p1", "p2"] as const) state = must(applyAction(state, { type: "setupReady", seat: s }));
  state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
  for (const s of ["p1", "p2"] as const) {
    const side = state.players[s];
    state = { ...state, players: { ...state.players, [s]: { ...side, hand: [], deck: [...side.deck, ...side.hand] } } };
  }
  return state;
}

/** TEST SURGERY — every Prize whose id is a board id swapped with a Filler / fix-energy deck card. */
function unprize(state: GameState, seat: Seat): GameState {
  const side = state.players[seat];
  let deck = [...side.deck];
  const prizes = side.prizes.map((u) => {
    if (!BOARD_IDS.has(state.cardIdByUid[u] ?? "")) return u;
    const swap = deck.find((d) => !BOARD_IDS.has(state.cardIdByUid[d] ?? ""));
    if (swap === undefined) throw new Error("no swap card");
    deck = [...deck.filter((d) => d !== swap), u];
    return swap;
  });
  return { ...state, players: { ...state.players, [seat]: { ...side, prizes, deck } } };
}

/** P1's Active is `attacker` with `energy` and `ownBench`; P2's Active is `defender`. */
function table(
  attacker: string,
  energy: readonly (readonly [string, number])[],
  defender: string = FILLER,
  ownBench: readonly string[] = [],
): GameState {
  let state = p1Turn();
  for (const s of ["p1", "p2"] as const) state = unprize(clearBench(setActiveFromDeck(state, s, FILLER), s), s);
  state = clearBench(setActiveFromDeck(state, "p1", attacker), "p1");
  for (const [id, n] of energy) state = attachFromDeck(state, "p1", id, n);
  for (const id of ownBench) state = benchFromDeck(state, "p1", id);
  state = clearBench(setActiveFromDeck(state, "p2", defender), "p2");
  return state;
}

const attack = (index: number, seat: Seat = "p1"): GameAction => ({ type: "attack", seat, index });
const of = <T extends GameEvent["type"]>(events: readonly GameEvent[], type: T) =>
  events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
const dealt = (events: readonly GameEvent[]) => of(events, "DAMAGE_DEALT").map((e) => e.dealt);
const p2Active = (state: GameState): InPlayPokemon => {
  const active = state.players.p2.active;
  if (active === null) throw new Error("no p2 Active");
  return active;
};
/** P2's Active carrying `record` (the turn defaulted to NOW — the window being read). */
const marked = (state: GameState, record: Partial<NonNullable<InPlayPokemon["weaknessRetype"]>> = {}): GameState => {
  const active = p2Active(state);
  const weaknessRetype = { turn: state.turn, type: "Lightning", asTimesTwo: true as const, ...record };
  return { ...state, players: { ...state.players, p2: { ...state.players.p2, active: { ...active, weaknessRetype } } } };
};
const plain = (state: GameState): GameState => {
  const active = p2Active(state);
  const weaknessRetype = { turn: state.turn, type: "Lightning" };
  return { ...state, players: { ...state.players, p2: { ...state.players.p2, active: { ...active, weaknessRetype } } } };
};
const pass = (state: GameState, seat: Seat): GameState => must(applyAction(state, { type: "endTurn", seat }));

function render(events: readonly GameEvent[], state: GameState): { who: string; text: string }[] {
  const ctx: LogContext = { names: { p1: "Ana", p2: "Bo" }, state, elapsed: formatElapsed(0) };
  return logFromEvents(events, ctx).flatMap((entry) =>
    entry.kind === "turn" ? [] : [{ who: entry.who, text: entry.segments.map((s) => s.text).join("") }],
  );
}

describe("D640 §3 — Overwriting Bolt installs the rewrite on the Defending Pokémon", () => {
  it("the record is the installer's next turn, `asTimesTwo`; the row says ×2, not D552's reminder", () => {
    const state = table("30th-040", [[L, 1]]);
    const result = mustApply(state, attack(0));
    expect(dealt(result.events)).toEqual([10]);
    expect(p2Active(result.state).weaknessRetype).toEqual({ turn: state.turn + 2, type: "Lightning", asTimesTwo: true });
    expect(of(result.events, "WEAKNESS_RETYPED")).toEqual([
      { type: "WEAKNESS_RETYPED", seat: "p2", uid: p2Active(state).stack[0], weaknessType: "Lightning", asTimesTwo: true },
    ]);
    expect(render(result.events, result.state).find((r) => r.text.includes("Weakness is now"))).toEqual({
      who: "p2",
      text: "D640 Filler's Weakness is now Lightning until the end of your opponent's next turn (apply Weakness as ×2)",
    });
  });

  it("on the installer's next turn a body with NO printed Weakness is {L}×2: the same 10 is 20", () => {
    let state = mustApply(table("30th-040", [[L, 1]]), attack(0)).state;
    expect(state.phase).toEqual({ kind: "turn:action", seat: "p2" });
    state = pass(state, "p2");
    const again = mustApply(state, attack(0));
    expect(dealt(again.events)).toEqual([20]);
  });

  it("a same-window re-install is silent; a D552 retype of the same type on that window is overwritten", () => {
    const base = table("30th-040", [[L, 1]]);
    const live = mustApply(marked(base, { turn: base.turn + 2 }), attack(0));
    expect(of(live.events, "WEAKNESS_RETYPED")).toEqual([]);
    const active = p2Active(base);
    const retyped = {
      ...base,
      players: {
        ...base.players,
        p2: { ...base.players.p2, active: { ...active, weaknessRetype: { turn: base.turn + 2, type: "Lightning" } } },
      },
    };
    const rewritten = mustApply(retyped, attack(0));
    expect(of(rewritten.events, "WEAKNESS_RETYPED")).toHaveLength(1);
    expect(p2Active(rewritten.state).weaknessRetype).toEqual({ turn: base.turn + 2, type: "Lightning", asTimesTwo: true });
  });
});

describe("D640 §4 — the rewrite at the three Weakness sites", () => {
  it("the readers: the rewrite answers only an `asTimesTwo` record on its own turn; the retype answers both", () => {
    const base = table(VOLT, [["fix-energy", 1]]);
    expect(installedWeaknessRewriteOf(marked(base), p2Active(marked(base)))).toBe("Lightning");
    expect(installedWeaknessRewriteOf(plain(base), p2Active(plain(base)))).toBeNull();
    const stale = marked(base, { turn: base.turn - 2 });
    expect(installedWeaknessRewriteOf(stale, p2Active(stale))).toBeNull();
    expect(installedWeaknessRetypeOf(marked(base), p2Active(marked(base)))).toBe("Lightning");
  });

  it("main hit: {L} 50 on a no-Weakness body is 100; under D552's plain retype it stays 50 (no amount to keep)", () => {
    const base = table(VOLT, [["fix-energy", 1]]);
    expect(dealt(mustApply(marked(base), attack(STRIKE)).events)).toEqual([100]);
    expect(dealt(mustApply(plain(base), attack(STRIKE)).events)).toEqual([50]);
    expect(dealt(mustApply(marked(base, { turn: base.turn - 2 }), attack(STRIKE)).events)).toEqual([50]);
  });

  it("main hit: the printed ×2 {R} is REPLACED — a {R} attacker is no longer weak-matched, a {L} one is", () => {
    const fire = table(EMBER, [["fix-energy", 1]], FIRE_WEAK);
    expect(dealt(mustApply(fire, attack(STRIKE)).events)).toEqual([100]);
    expect(dealt(mustApply(marked(fire), attack(STRIKE)).events)).toEqual([50]);
    const volt = table(VOLT, [["fix-energy", 1]], FIRE_WEAK);
    expect(dealt(mustApply(marked(volt), attack(STRIKE)).events)).toEqual([100]);
  });

  it("R-OWB1: under both the installed rewrite and the attacker's seat Fairy Zone, a {N} body is {L}×2 either way", () => {
    const base = table(VOLT, [["fix-energy", 1]], DRAGON, ["sv09-056"]);
    expect(dealt(mustApply(base, attack(STRIKE)).events)).toEqual([50]);
    expect(dealt(mustApply(marked(base), attack(STRIKE)).events)).toEqual([100]);
  });

  it("main hit: \"isn't affected by any effects on your opponent's Active Pokémon\" drops the installed rewrite (on-target, R-FZ3) → 50", () => {
    const base = table(VOLT, [["fix-energy", 1]]);
    expect(dealt(mustApply(marked(base), attack(STRIKE)).events)).toEqual([100]);
    expect(dealt(mustApply(marked(base), attack(SHRED_HIT)).events)).toEqual([50]);
    expect(dealt(mustApply(base, attack(SHRED_HIT)).events)).toEqual([50]);
  });

  it("the SNIPE site (`snipeActive`), on its own board: a 30 onto the marked Active (the only target) is 60", () => {
    for (const [state, expected] of [
      [marked(table(VOLT, [["fix-energy", 1]])), 60],
      [plain(table(VOLT, [["fix-energy", 1]])), 30],
    ] as const) {
      const done = mustApply(state, attack(SNIPE));
      expect(of(done.events, "DAMAGE_DEALT").map((e) => [e.uid, e.dealt])).toEqual([[p2Active(state).stack[0], expected]]);
    }
  });

  it("Adversity Policy's condition (`yourActiveWeakToOpponentActiveType`) reads the rewrite", () => {
    const cond = { kind: "yourActiveWeakToOpponentActiveType" } as const;
    const base = table(VOLT, [["fix-energy", 1]]);
    expect(conditionHolds(base, "p2", cond)).toBe(false);
    expect(conditionHolds(marked(base), "p2", cond)).toBe(true);
    expect(conditionHolds(plain(base), "p2", cond)).toBe(false);
  });
});

describe("D640 §5 — Celebration: 2 Prizes at exactly 30 in hand, then the hand into the deck", () => {
  /** P1's hand set to exactly `n` cards (pulled off the deck top). */
  const hand = (state: GameState, n: number): GameState => {
    const side = state.players.p1;
    const all = [...side.hand, ...side.deck];
    return { ...state, players: { ...state.players, p1: { ...side, hand: all.slice(0, n), deck: all.slice(n) } } };
  };
  const gholdengo = () => table("30th-108", [[M, 1]]);

  it("30 in hand: the take parks for 2 with the shuffle stage DIRECTLY behind it; picked, the 32 go into the deck", () => {
    const start = hand(gholdengo(), 30);
    const deckBefore = start.players.p1.deck.length;
    const parked = mustApply(start, attack(0));
    expect(parked.state.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: 2 });
    expect(parked.state.pending.slice(0, 2)).toEqual([
      { kind: "takePrizes", seat: "p1", count: 2 },
      { kind: "shuffleHandIntoDeck", seat: "p1" },
    ]);
    expect(of(parked.events, "HAND_SHUFFLED_INTO_DECK")).toEqual([]);
    const prizes = start.players.p1.prizes.slice(0, 2);
    const taken = mustApply(parked.state, { type: "takePrizes", seat: "p1", prizeIndices: [0, 1] });
    expect(of(taken.events, "HAND_SHUFFLED_INTO_DECK")).toEqual([{ type: "HAND_SHUFFLED_INTO_DECK", seat: "p1", count: 32 }]);
    expect(taken.state.players.p1.hand).toEqual([]);
    expect(taken.state.players.p1.prizes).toHaveLength(4);
    expect(taken.state.players.p1.deck).toHaveLength(deckBefore + 32);
    for (const uid of prizes) expect(taken.state.players.p1.deck).toContain(uid);
    // SHUFFLED, not stacked: the rng moved, and the old deck is not left on top in its order with the hand under it.
    expect(taken.state.rngState).not.toEqual(parked.state.rngState);
    expect(taken.state.players.p1.deck.slice(0, deckBefore)).not.toEqual(parked.state.players.p1.deck);
    // The turn ended after the shuffle: P2's turn, and P1's hand stays empty.
    expect(taken.state.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("29 or 31 in hand: nothing at all — no Prize, no shuffle", () => {
    for (const n of [29, 31]) {
      const start = hand(gholdengo(), n);
      const result = mustApply(start, attack(0));
      expect(of(result.events, "PRIZES_OWED")).toEqual([]);
      expect(of(result.events, "HAND_SHUFFLED_INTO_DECK")).toEqual([]);
      expect(result.state.players.p1.hand).toHaveLength(n);
      expect(result.state.players.p1.prizes).toHaveLength(6);
    }
  });

  it("R-CEL1: taking the last 2 Prizes ends the game; the shuffle stage never drains", () => {
    const base = hand(gholdengo(), 30);
    const side = base.players.p1;
    const last = { ...base, players: { ...base.players, p1: { ...side, prizes: side.prizes.slice(0, 2), deck: [...side.deck, ...side.prizes.slice(2)] } } };
    const result = mustApply(last, attack(0));
    expect(result.state.phase.kind).toBe("gameOver");
    expect(of(result.events, "HAND_SHUFFLED_INTO_DECK")).toEqual([]);
    expect(result.state.players.p1.hand).toHaveLength(32);
  });
});

describe("D640 §6 — the version", () => {
  it("is built at engine 0.544.0", () => {
    expect(engineVersion).toBe("0.544.0");
  });
});
