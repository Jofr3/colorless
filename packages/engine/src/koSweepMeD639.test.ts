import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import { meAttackCorpus } from "./censusAttackCorpusMe";
import { deriveAttackEffect } from "./effects";
import type { GameAction, GameEvent, GameState, Seat } from "./index";
import { applyAction, createGame, engineVersion } from "./index";
import { conditionHolds, conditionNote, doomBodyAt } from "./interpreter";
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
  setBenchDamage,
  setDamage,
  typedEnergy,
} from "./testFixtures";
import { koByEffectMarker } from "./types";

// ── 🆕🆕🆕 D639 — K3 + R1: THE KO-BY-THIS-ATTACK CONSEQUENTS AND THE KO SWEEP ─────────────────────────────────────
//
// 3 attack sentences / 6 printings newly reader-built; every other text on the 6 cards was already built, so all 6
// are finished. Every id and text off the LOCAL D1, 2026-10-10, `legal_standard = 1`; before this slice only
// `koCountersMeD609.test.ts` (Soul Destroyer, Unown) and the playmat mock (Yveltal ex `me03-053`) named any of them.
//
//   Shadowy Side Kick ×2 / Critical Slash — `conditionGate` on the NEW `opponentKnockedOutByDamage` → the shipped
//                                            `preventDamage { effects }` (R-SSK1).
//   Mysterious Signal                     — the NEW `bountyThisAttack`: a THIS-turn `koBounty` (R-MSG1).
//   Soul Destroyer ×2                     — the NEW `knockOutEach { remainingHpAtMost }` (R-SDS1).
//
// DROPPED AND NAMED: Gholdengo `30th-108` / `-142` "Celebration" — `takePrize` queues a `takePrizes` stage behind the
// program, so "If you do, shuffle your hand into your deck" would run before the Prizes reach the hand; ordering it
// after the stage needs a new post-Prize `PendingStage` (persisted state), which this slice does not add.
// [🆕🆕🆕 D640 (D539): BUILT at D640 — `takePrize { count: 2, thenShuffleHand }` and the NEW `shuffleHandIntoDeck`
// stage on 46 → 47; the pin below is inverted.]

const SIDE_KICK =
  "If your opponent's Pokémon is Knocked Out by damage from this attack, during your opponent's next turn, prevent all damage from and effects of attacks done to this Pokémon.";
const SIGNAL = "If your opponent's Pokémon is Knocked Out by damage from this attack, take 1 more Prize card.";
const SOUL_DESTROYER = "Knock Out each of your opponent's Pokémon that has 50 HP or less remaining.";
const CELEBRATION =
  "If you have exactly 30 cards in your hand, take 2 Prize cards. If you do, shuffle your hand into your deck.";

/** [attack text, the `me` printing ids that print it]. */
const SENTENCES: readonly (readonly [string, readonly string[]])[] = [
  [SIDE_KICK, ["me01-080", "me01-146", "me04-026"]],
  [SIGNAL, ["30th-072"]],
  [SOUL_DESTROYER, ["me03-053", "me03-105"]],
];

describe("D639 §1 — the texts", () => {
  it("3 sentences / 6 printings, each a row of the committed `me` corpus, none printed in legal `sv`, each now read", () => {
    const me = new Map(meAttackCorpus().map(([n, text]) => [text, n]));
    const sv = new Set(legalAttackCorpus().map(([, text]) => text));
    for (const [text, ids] of SENTENCES) {
      expect([text, me.get(text)]).toEqual([text, ids.length]);
      expect(sv.has(text), text).toBe(false);
      expect(resolvedByAnyReader(text), text).toBe(true);
      for (const id of ids) expect(programFor(id), id).toBeUndefined();
    }
    expect(SENTENCES.flatMap(([, ids]) => ids)).toHaveLength(6);
  });

  it("Celebration ×2 stays dropped: read by no reader (🆕🆕🆕 D640 (D539): read since D640, still no key)", () => {
    expect(meAttackCorpus().find(([, text]) => text === CELEBRATION)?.[0]).toBe(2);
    expect(resolvedByAnyReader(CELEBRATION)).toBe(true); // 🆕🆕🆕 D640 — inverted: built
    for (const id of ["30th-108", "30th-142"]) expect(programFor(id), id).toBeUndefined();
  });
});

describe("D639 §2 — the readings", () => {
  it("Shadowy Side Kick: the KO gate in front of the shipped effects shield", () => {
    expect(deriveAttackEffect(SIDE_KICK)).toEqual([
      {
        op: "conditionGate",
        cond: { kind: "opponentKnockedOutByDamage" },
        // biome-ignore lint/suspicious/noThenProperty: the effect contract's gated-step list.
        then: [{ op: "preventDamage", effects: true }],
      },
    ]);
    expect(deriveAttackEffect(SIDE_KICK.replace("damage from and effects of attacks", "damage from attacks"))).toBeNull();
    expect(deriveAttackEffect(`${SIDE_KICK} Draw a card.`)).toBeNull();
    expect(conditionNote({ kind: "opponentKnockedOutByDamage" })).toBe(
      "your opponent's Pokémon is Knocked Out by damage from this attack",
    );
  });

  it("Mysterious Signal: `bountyThisAttack` at the printed count, the noun agreeing with it", () => {
    expect(deriveAttackEffect(SIGNAL)).toEqual([{ op: "bountyThisAttack", amount: 1 }]);
    expect(deriveAttackEffect(SIGNAL.replace("1 more Prize card", "2 more Prize cards"))).toEqual([
      { op: "bountyThisAttack", amount: 2 },
    ]);
    expect(deriveAttackEffect(SIGNAL.replace("1 more Prize card", "2 more Prize card"))).toBeNull();
    expect(deriveAttackEffect(SIGNAL.replace("1 more Prize card", "1 more Prize cards"))).toBeNull();
    expect(deriveAttackEffect(SIGNAL.replace("1 more", "0 more"))).toBeNull();
    expect(deriveAttackEffect(SIGNAL.replace("1 more Prize card", "0 more Prize cards"))).toBeNull();
    expect(deriveAttackEffect(`Draw a card. ${SIGNAL}`)).toBeNull();
  });

  it("Soul Destroyer: `knockOutEach` at the printed HP", () => {
    expect(deriveAttackEffect(SOUL_DESTROYER)).toEqual([{ op: "knockOutEach", remainingHpAtMost: 50 }]);
    expect(deriveAttackEffect(SOUL_DESTROYER.replace("50", "30"))).toEqual([
      { op: "knockOutEach", remainingHpAtMost: 30 },
    ]);
    expect(deriveAttackEffect(SOUL_DESTROYER.replace("50", "0"))).toBeNull();
    expect(deriveAttackEffect(SOUL_DESTROYER.replace("your opponent's", "your"))).toBeNull();
    expect(deriveAttackEffect(`${SOUL_DESTROYER} Draw a card.`)).toBeNull();
  });
});

// ── ON A BOARD ──

const FILLER = "d639-filler";
const SMALL = "d639-small";
const F = "d639-fighting";
const P = "d639-psychic";
const D = "d639-darkness";
const W = "d639-water";

const mon = (id: string, name: string, hp: number, type: string, attacks: Card["attacks"], extra: Partial<Card> = {}) =>
  battler(id, { name, hp, types: [type], retreat: 2, attacks, ...extra });
const TAP: Card["attacks"] = [{ cost: ["Colorless"], name: "Tap", damage: 10 }];

const LOCAL: Record<string, Card> = {
  "me01-080": mon("me01-080", "Marshadow", 90, "Fighting", [
    { cost: ["Fighting", "Fighting"], name: "Shadowy Side Kick", damage: 60, effect: SIDE_KICK },
  ]),
  "me04-026": mon(
    "me04-026",
    "Golisopod",
    140,
    "Water",
    [
      { cost: ["Water"], name: "Critical Slash", damage: 30, effect: SIDE_KICK },
      {
        cost: ["Colorless", "Colorless", "Colorless"],
        name: "Boundless Power",
        damage: 150,
        effect: "During your next turn, this Pokémon can't use attacks.",
      },
    ],
    { stage: "Stage1", evolveFrom: "Wimpod" },
  ),
  "30th-072": mon("30th-072", "Unown", 80, "Psychic", [
    { cost: ["Psychic", "Psychic"], name: "Mysterious Signal", damage: 40, effect: SIGNAL },
  ]),
  "me03-053": mon(
    "me03-053",
    "Yveltal ex",
    210,
    "Darkness",
    [
      { cost: ["Darkness", "Darkness", "Colorless"], name: "Soul Destroyer", effect: SOUL_DESTROYER },
      {
        cost: ["Darkness", "Darkness", "Colorless"],
        name: "Dark Strike",
        damage: 210,
        effect: "During your next turn, this Pokémon can't use Dark Strike.",
      },
    ],
  ),
  [FILLER]: mon(FILLER, "D639 Filler", 400, "Colorless", TAP),
  [SMALL]: mon(SMALL, "D639 Small", 60, "Colorless", TAP),
  [F]: typedEnergy(F, "Fighting"),
  [P]: typedEnergy(P, "Psychic"),
  [D]: typedEnergy(D, "Darkness"),
  [W]: typedEnergy(W, "Water"),
};
const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL };
const DECK = deckOf({
  "me01-080": 1,
  "me04-026": 1,
  "30th-072": 1,
  "me03-053": 1,
  [FILLER]: 10,
  [SMALL]: 4,
  "fix-unaware": 2,
  [F]: 4,
  [P]: 4,
  [D]: 4,
  [W]: 4,
  "fix-energy": 24,
});
const BOARD_IDS = new Set([...Object.keys(LOCAL).filter((id) => id !== FILLER), "fix-unaware"]);

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

/** Setup, then P1's own FIRST turn (P2 went first and passed); both hands back into the decks. */
function p1Turn(): GameState {
  const created = createGame({ seed: 6392, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
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

/** P1's Active is `attacker` with `energy` and `ownBench`; P2's Active is `defender` with `bench`. */
function table(
  attacker: string,
  energy: readonly (readonly [string, number])[],
  defender: string = FILLER,
  bench: readonly string[] = [],
  ownBench: readonly string[] = [],
): GameState {
  let state = p1Turn();
  for (const s of ["p1", "p2"] as const) state = unprize(clearBench(setActiveFromDeck(state, s, FILLER), s), s);
  state = clearBench(setActiveFromDeck(state, "p1", attacker), "p1");
  for (const [id, n] of energy) state = attachFromDeck(state, "p1", id, n);
  for (const id of ownBench) state = benchFromDeck(state, "p1", id);
  state = clearBench(setActiveFromDeck(state, "p2", defender), "p2");
  for (const id of bench) state = benchFromDeck(state, "p2", id);
  return state;
}

const attack = (index: number): GameAction => ({ type: "attack", seat: "p1", index });
const of = <T extends GameEvent["type"]>(events: readonly GameEvent[], type: T) =>
  events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
const koIds = (state: GameState, events: readonly GameEvent[]) =>
  of(events, "KNOCKED_OUT").map((e) => [e.seat, state.cardIdByUid[e.uid]]);
const withP2Active = (state: GameState, patch: Partial<NonNullable<GameState["players"]["p2"]["active"]>>) => {
  const side = state.players.p2;
  if (side.active === null) throw new Error("no p2 Active");
  return { ...state, players: { ...state.players, p2: { ...side, active: { ...side.active, ...patch } } } };
};

describe("D639 §3 — the gate member: lethal by damage on the opponent's side, right now", () => {
  const cond = { kind: "opponentKnockedOutByDamage" } as const;

  it("a lethally damaged opponent Active or Benched body holds it for the attacker's seat only", () => {
    const base = table("me01-080", [[F, 2]], SMALL, [SMALL]);
    expect(conditionHolds(base, "p1", cond)).toBe(false);
    expect(conditionHolds(setDamage(base, "p2", 60), "p1", cond)).toBe(true);
    expect(conditionHolds(setDamage(base, "p2", 60), "p2", cond)).toBe(false);
    expect(conditionHolds(setBenchDamage(base, "p2", 0, 60), "p1", cond)).toBe(true);
    expect(conditionHolds(setDamage(base, "p2", 50), "p1", cond)).toBe(false);
  });

  it("a body doomed by an EFFECT this turn (D414's marker) does not hold it", () => {
    const base = table("me01-080", [[F, 2]], SMALL);
    const doomed = doomBodyAt(base, { seat: "p2", spot: { spot: "active" } }, koByEffectMarker(base.turn));
    expect(doomed.players.p2.active?.damage).toBe(60);
    expect(conditionHolds(doomed, "p1", cond)).toBe(false);
    // Last turn's marker is not this turn's: the lethality reads as damage again.
    const stale = withP2Active(setDamage(base, "p2", 60), { markers: [koByEffectMarker(base.turn - 1)] });
    expect(conditionHolds(stale, "p1", cond)).toBe(true);
  });
});

describe("D639 §4 — Shadowy Side Kick / Critical Slash: the shield only on a Knock Out", () => {
  it("the Defending Pokémon is Knocked Out: the attacker carries next turn's effects shield", () => {
    const state = table("me01-080", [[F, 2]], SMALL, [FILLER]);
    const result = mustApply(state, attack(0));
    expect(koIds(result.state, result.events)).toEqual([["p2", SMALL]]);
    expect(result.state.players.p1.active?.attackBlock).toMatchObject({ turn: state.turn + 1, effects: true });
    expect(of(result.events, "ATTACK_BLOCK_APPLIED")).toHaveLength(1);
  });

  it("no Knock Out: no shield", () => {
    const result = mustApply(table("me01-080", [[F, 2]], FILLER), attack(0));
    expect(of(result.events, "KNOCKED_OUT")).toEqual([]);
    expect(result.state.players.p1.active?.attackBlock).toBeNull();
    expect(of(result.events, "ATTACK_BLOCK_APPLIED")).toEqual([]);
  });

  it("Golisopod's Critical Slash is the same sentence: 30 onto 30 remaining Knocks Out, the shield stands", () => {
    const state = setDamage(table("me04-026", [[W, 1]], SMALL, [FILLER]), "p2", 30);
    const result = mustApply(state, attack(0));
    expect(koIds(result.state, result.events)).toEqual([["p2", SMALL]]);
    expect(result.state.players.p1.active?.attackBlock).toMatchObject({ effects: true });
  });

  it("the shield holds on the opponent's next turn: their attack does nothing to it", () => {
    let state = mustApply(table("me01-080", [[F, 2]], SMALL, [FILLER]), attack(0)).state;
    if (state.phase.kind === "ko:takePrizes") {
      const phase = state.phase;
      state = must(applyAction(state, { type: "takePrizes", seat: "p1", prizeIndices: [...Array(phase.count).keys()] }));
    }
    expect(state.phase).toEqual({ kind: "turn:action", seat: "p2" });
    state = attachFromDeck(state, "p2", "fix-energy", 1);
    const hit = mustApply(state, { type: "attack", seat: "p2", index: 0 });
    expect(hit.state.players.p1.active?.damage).toBe(0);
  });
});

describe("D639 §5 — Mysterious Signal: 1 more Prize card for a Knock Out by its damage", () => {
  it("the Defending Pokémon is Knocked Out: a 1-Prize body pays 2, by one PRIZE_BONUS row", () => {
    const state = setDamage(table("30th-072", [[P, 2]], SMALL, [FILLER]), "p2", 20);
    const result = mustApply(state, attack(0));
    expect(koIds(result.state, result.events)).toEqual([["p2", SMALL]]);
    expect(of(result.events, "PRIZE_BONUS").map((e) => [e.by, e.count])).toEqual([[1, 2]]);
    expect(of(result.events, "PRIZES_OWED").map((e) => e.count)).toEqual([2]);
    expect(of(result.events, "KO_BOUNTY_APPLIED")).toEqual([]);
  });

  it("no Knock Out: nothing is stamped and nothing is paid", () => {
    const result = mustApply(table("30th-072", [[P, 2]], FILLER), attack(0));
    expect(result.state.players.p2.active?.koBounty).toBeNull();
    expect(of(result.events, "PRIZE_BONUS")).toEqual([]);
  });

  it("R-MSG1: a live bounty of this turn on the same body is ADDED to; a stale one is replaced", () => {
    const base = setDamage(table("30th-072", [[P, 2]], SMALL, [FILLER]), "p2", 20);
    const live = mustApply(withP2Active(base, { koBounty: { turn: base.turn, amount: 2 } }), attack(0));
    expect(of(live.events, "PRIZE_BONUS").map((e) => [e.by, e.count])).toEqual([[3, 4]]);
    const stale = mustApply(withP2Active(base, { koBounty: { turn: base.turn - 2, amount: 2 } }), attack(0));
    expect(of(stale.events, "PRIZE_BONUS").map((e) => [e.by, e.count])).toEqual([[1, 2]]);
  });

  it("R-MSG1: an effects-only shield (Unaware) does not refuse the extra Prize — the Knock Out is damage", () => {
    const state = setDamage(table("30th-072", [[P, 2]], "fix-unaware", [FILLER]), "p2", 180);
    const result = mustApply(state, attack(0));
    expect(koIds(result.state, result.events)).toEqual([["p2", "fix-unaware"]]);
    expect(of(result.events, "PRIZE_BONUS").map((e) => e.by)).toEqual([1]);
    expect(of(result.events, "ATTACK_EFFECT_PREVENTED")).toEqual([]);
  });

  it("a body already doomed by an effect this turn is not a Knock Out by this attack's damage: no bonus", () => {
    const base = table("30th-072", [[P, 2]], SMALL, [FILLER]);
    const doomed = doomBodyAt(base, { seat: "p2", spot: { spot: "active" } }, koByEffectMarker(base.turn));
    const result = mustApply(doomed, attack(0));
    expect(koIds(result.state, result.events)).toEqual([["p2", SMALL]]);
    expect(of(result.events, "PRIZE_BONUS")).toEqual([]);
  });
});

describe("D639 §6 — Soul Destroyer: each opponent body at 50 HP or less remaining", () => {
  const energy = [
    [D, 2],
    ["fix-energy", 1],
  ] as const;

  it("Active and Bench at exactly 50 remaining are Knocked Out; 60 remaining and the attacker's side are not", () => {
    let state = table("me03-053", energy, SMALL, [FILLER, FILLER, SMALL], [SMALL]);
    state = setBenchDamage(setBenchDamage(setDamage(state, "p2", 10), "p2", 0, 350), "p2", 1, 340);
    state = setBenchDamage(state, "p1", 0, 30);
    const result = mustApply(state, attack(0));
    expect(koIds(result.state, result.events)).toEqual([
      ["p2", SMALL],
      ["p2", FILLER],
    ]);
    expect(result.state.players.p1.bench.map((b) => b.damage)).toEqual([30]);
    // An effect's Knock Out, not damage's (D414's marker): the KO record says so.
    expect(result.state.lastKoMarks.p2.map((m) => m.byAttack)).toEqual([false, false]);
  });

  it("R-SDS1: a §11-shielded body in the window refuses (announced); the rest still fall", () => {
    let state = table("me03-053", energy, SMALL, ["fix-unaware", FILLER]);
    state = setBenchDamage(setBenchDamage(setDamage(state, "p2", 20), "p2", 0, 170), "p2", 1, 360);
    const result = mustApply(state, attack(0));
    expect(koIds(result.state, result.events)).toEqual([
      ["p2", SMALL],
      ["p2", FILLER],
    ]);
    expect(of(result.events, "ATTACK_EFFECT_PREVENTED")).toHaveLength(1);
  });

  it("nobody in the window: nothing happens, no damage is dealt", () => {
    const result = mustApply(table("me03-053", energy, FILLER, [FILLER]), attack(0));
    expect(of(result.events, "KNOCKED_OUT")).toEqual([]);
    expect(of(result.events, "DAMAGE_DEALT")).toEqual([]);
  });
});

describe("D639 §7 — the version", () => {
  it("is built at engine 0.536.0", () => {
    expect(engineVersion).toBe("0.536.0");
  });
});
