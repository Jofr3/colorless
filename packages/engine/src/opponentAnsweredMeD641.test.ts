import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import { meAttackCorpus } from "./censusAttackCorpusMe";
import { deriveAttackEffect } from "./effects";
import type { GameAction, GameEvent, GameState, Seat } from "./index";
import { applyAction, createGame, engineVersion } from "./index";
import { programFor } from "./registry";
import { flipCoin } from "./rng";
import {
  FIXTURE_POOL,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  handFromDeck,
  mustApply,
  setActiveFromDeck,
  setDamage,
  setPrizes,
  trainerCard,
  typedEnergy,
} from "./testFixtures";

// ── 🆕🆕🆕 D641 — W1 + Y1b: EFFECTS THE OPPONENT ANSWERS, AND DECK SWAP / REVEAL ──────────────────────────────────
//
// 4 printed texts / 7 printings, every id and text off the LOCAL D1, 2026-10-10, `legal_standard = 1`; before this
// slice no program named any of them (Ditto's text was flipGatedOp.test.ts's unmapped near miss, Delibird's the
// D615 / D616 / D624 drop, Bug Out and Lt. Surge's Bargain only backlog prose).
//
//   Ditto ×2 "Surprisingly Transform" — `coinFlipGate` over the NEW `switchWithDeckChosen` (R-DIT1).
//   Sizzlipede "Bug Out"              — the NEW `revealDeckBottomCount` + the shipped `damageDefender` (R-BUG1).
//   Delibird "Pleasing Present"       — two `attachFromHand { max: 3 }`, the opponent's first and answered by
//                                       them (`whose`, R-PP1).
//   Lt. Surge's Bargain ×3            — `optional { askOpponent }` over the NEW `eachPlayerTakesPrize`, or draw 4
//                                       (R-LSB1).

const TRANSFORM =
  "Flip a coin. If heads, search your deck for a Pokémon and switch it with this Pokémon. Any attached cards, damage counters, Special Conditions, turns in play, and any other effects remain on the new Pokémon. If you switched a Pokémon in this way, put this card into your deck. Then, shuffle your deck.";
const BUG_OUT =
  "Reveal the bottom 7 cards of your deck, and this attack does 50 damage for each Pokémon you find there that has the Bug Out attack. Then, shuffle any revealed Pokémon back into your deck. Discard the other cards.";
const PRESENT =
  "Each player may attach up to 3 Basic Energy cards from their hand to their Pokémon in any way they like. Your opponent does this first.";
const BARGAIN =
  "Ask your opponent if each player may take a Prize card. If yes, each player takes a Prize card. If no, you draw 4 cards.";

/** [attack text, the printing ids that print it]. */
const SENTENCES: readonly (readonly [string, readonly string[]])[] = [
  [TRANSFORM, ["mep-106", "30th-115"]],
  [BUG_OUT, ["me05-009"]],
  [PRESENT, ["me04-018"]],
];
const BARGAIN_IDS = ["me01-120", "me01-170", "me01-185"] as const;

describe("D641 §1 — the texts", () => {
  it("3 attack sentences / 4 printings, each a row of the committed `me` corpus, none printed in legal `sv`, each now read", () => {
    const me = new Map(meAttackCorpus().map(([n, text]) => [text, n]));
    const sv = new Set(legalAttackCorpus().map(([, text]) => text));
    for (const [text, ids] of SENTENCES) {
      expect([text, me.get(text)]).toEqual([text, ids.length]);
      expect(sv.has(text), text).toBe(false);
      expect(resolvedByAnyReader(text), text).toBe(true);
      for (const id of ids) expect(programFor(id), id).toBeUndefined();
    }
  });

  it("Lt. Surge's Bargain ×3 share ONE registry object: the opponent-answered labelled confirm", () => {
    const [first, ...rest] = BARGAIN_IDS.map((id) => programFor(id));
    for (const program of rest) expect(program).toBe(first);
    expect(first?.trainer).toEqual([
      {
        op: "optional",
        note: "Your opponent played Lt. Surge's Bargain: may each player take a Prize card? If you say no, they draw 4 cards.",
        askOpponent: true,
        // biome-ignore lint/suspicious/noThenProperty: the effect contract's gated-step list.
        then: [{ op: "eachPlayerTakesPrize" }],
        otherwise: [{ op: "drawCards", count: 4 }],
        labels: { yes: "Yes: each player takes a Prize card", no: "No: they draw 4 cards" },
      },
    ]);
  });
});

describe("D641 §2 — the readings", () => {
  it("Surprisingly Transform: the coin over the chosen deck swap; near misses refused", () => {
    expect(deriveAttackEffect(TRANSFORM)).toEqual([
      {
        op: "coinFlipGate",
        // biome-ignore lint/suspicious/noThenProperty: the effect contract's gated-step list.
        then: [{ op: "switchWithDeckChosen", filter: { kind: "anyPokemon" } }],
      },
    ]);
    expect(deriveAttackEffect(TRANSFORM.replace("Flip a coin. If heads, s", "S"))).toBeNull();
    expect(deriveAttackEffect(TRANSFORM.replace(" Then, shuffle your deck.", ""))).toBeNull();
  });

  it("Bug Out: the bottom-7 reveal filing the named-attack Pokémon, then 50 per filed card", () => {
    expect(deriveAttackEffect(BUG_OUT)).toEqual([
      { op: "revealDeckBottomCount", n: 7, filter: { kind: "attackNamePokemon", attack: "Bug Out" }, recordAs: "revealed" },
      { op: "damageDefender", per: 50, count: "revealed" },
    ]);
    expect(deriveAttackEffect(BUG_OUT.replace("bottom 7", "top 7"))).toBeNull();
    expect(deriveAttackEffect(BUG_OUT.replace("bottom 7", "bottom 0"))).toBeNull();
    expect(deriveAttackEffect(BUG_OUT.replace(" Discard the other cards.", ""))).toBeNull();
  });

  it("Pleasing Present: two capped hand attaches, the opponent's first", () => {
    expect(deriveAttackEffect(PRESENT)).toEqual([
      { op: "attachFromHand", filter: { kind: "basicEnergy" }, max: 3, whose: "opponent" },
      { op: "attachFromHand", filter: { kind: "basicEnergy" }, max: 3 },
    ]);
    expect(deriveAttackEffect(PRESENT.replace(" Your opponent does this first.", ""))).toBeNull();
    expect(deriveAttackEffect(PRESENT.replace("up to 3", "up to 0"))).toBeNull();
  });
});

// ── ON A BOARD ──

const FILLER = "d641-filler";
const BUG = "d641-bug"; // a Pokémon that prints "Bug Out"
const STAGE2 = "d641-stage2"; // a Stage 2 with less HP than Ditto's damage
const W = "d641-water";
const DITTO = "mep-106";
const SIZZ = "me05-009";
const DELI = "me04-018";
const SURGE = "me01-120";

const mon = (id: string, name: string, hp: number, attacks: Card["attacks"], extra: Partial<Card> = {}) =>
  battler(id, { name, hp, types: ["Colorless"], retreat: 2, attacks, ...extra });
const TAP: Card["attacks"] = [{ cost: ["Colorless"], name: "Tap", damage: 10 }];

const LOCAL: Record<string, Card> = {
  [DITTO]: mon(DITTO, "Ditto", 70, [{ cost: ["Colorless", "Colorless"], name: "Surprisingly Transform", effect: TRANSFORM }]),
  "30th-115": mon("30th-115", "Ditto", 70, [
    { cost: ["Colorless", "Colorless"], name: "Surprisingly Transform", effect: TRANSFORM },
  ]),
  [SIZZ]: mon(SIZZ, "Sizzlipede", 80, [
    { cost: ["Fire"], name: "Controlled Burn", effect: "Discard the top card of your opponent's deck." },
    { cost: ["Colorless", "Colorless", "Colorless"], name: "Bug Out", damage: "50×", effect: BUG_OUT },
  ]),
  [DELI]: mon(DELI, "Delibird", 90, [
    { cost: ["Colorless"], name: "Pleasing Present", effect: PRESENT },
    { cost: ["Colorless", "Colorless"], name: "Flap", damage: 40 },
  ]),
  [SURGE]: { ...trainerCard(SURGE, "Supporter", BARGAIN), name: "Lt. Surge's Bargain" },
  [FILLER]: mon(FILLER, "D641 Filler", 400, TAP),
  [BUG]: mon(BUG, "D641 Bug", 60, [{ cost: ["Colorless"], name: "Bug Out", damage: "50×", effect: BUG_OUT }]),
  [STAGE2]: mon(STAGE2, "D641 Brittle", 30, TAP, { stage: "Stage2", evolveFrom: "D641 Middle" }),
  [W]: typedEnergy(W, "Water"),
};
const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL };
const DECK = deckOf({
  [DITTO]: 2,
  [SIZZ]: 2,
  [DELI]: 1,
  [SURGE]: 2,
  [FILLER]: 10,
  [BUG]: 4,
  [STAGE2]: 2,
  "fix-tool": 3,
  [W]: 10,
  "fix-energy": 24,
});

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

/** Setup, then P1's own FIRST turn (P2 went first and passed); both hands back into the decks; six `fix-energy`
    Prizes each. */
function p1Turn(): GameState {
  const created = createGame({ seed: 6410, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
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
    const pile = [...side.deck, ...side.hand, ...side.prizes];
    const prizes = pile.filter((u) => state.cardIdByUid[u] === "fix-energy").slice(0, 6);
    state = {
      ...state,
      players: { ...state.players, [s]: { ...side, hand: [], prizes, deck: pile.filter((u) => !prizes.includes(u)) } },
    };
  }
  return state;
}

/** P1's Active is `attacker` with `energy` ({C} fixtures); P2's Active is a Filler with `bench`. */
function table(attacker: string, energy: number, bench: readonly string[] = []): GameState {
  let state = p1Turn();
  state = clearBench(setActiveFromDeck(state, "p1", attacker), "p1");
  state = attachFromDeck(state, "p1", "fix-energy", energy);
  state = clearBench(setActiveFromDeck(state, "p2", FILLER), "p2");
  for (const id of bench) state = benchFromDeck(state, "p2", id);
  return state;
}

function cursorFor(face: "heads" | "tails"): number {
  for (let n = 1; n < 1000; n++) if (flipCoin(n)[0] === face) return n;
  throw new Error("no cursor");
}

const attack = (index: number): GameAction => ({ type: "attack", seat: "p1", index });
const resolve = (seat: Seat, choice: unknown): GameAction => ({ type: "resolveEffect", seat, choice }) as GameAction;
const of = <T extends GameEvent["type"]>(events: readonly GameEvent[], type: T) =>
  events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
const idsOf = (state: GameState, uids: readonly string[]) => uids.map((u) => state.cardIdByUid[u]);
function phaseOf(state: GameState) {
  if (state.phase.kind !== "effect:choose") throw new Error(`expected effect:choose, got ${state.phase.kind}`);
  return state.phase;
}
/** The bottom of P1's deck rearranged so its last cards are `ids` (in order), each pulled from the deck. */
function bottomOf(state: GameState, ids: readonly string[]): GameState {
  const side = state.players.p1;
  let rest = [...side.deck];
  const tail: string[] = [];
  for (const id of ids) {
    const uid = rest.find((u) => state.cardIdByUid[u] === id);
    if (uid === undefined) throw new Error(`no ${id} in the deck`);
    rest = rest.filter((u) => u !== uid);
    tail.push(uid);
  }
  return { ...state, players: { ...state.players, p1: { ...side, deck: [...rest, ...tail] } } };
}

describe("D641 §3 — Ditto: heads, a chosen deck Pokémon switched in, Ditto into the deck (R-DIT1)", () => {
  const heads = (state: GameState) => ({ ...state, rngState: cursorFor("heads") });

  it("heads parks a declinable pick of one over the deck's Pokémon, one row per card", () => {
    const parked = mustApply(heads(table(DITTO, 2)), attack(0)).state;
    const phase = phaseOf(parked);
    expect(phase.answerer).toBeUndefined();
    expect(phase.prompt).toMatchObject({ kind: "chooseCards", min: 0, max: 1, dest: "swap" });
    if (phase.prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    const ids = idsOf(parked, phase.prompt.candidates);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(ids)).toEqual(new Set([DITTO, SIZZ, DELI, FILLER, BUG, STAGE2]));
  });

  it("the answer switches the card in place: damage, Energy and turns in play ride along; Ditto goes into the deck", () => {
    const start = setDamage(heads(table(DITTO, 2)), "p1", 20);
    const before = start.players.p1.active;
    const parked = mustApply(start, attack(0)).state;
    const phase = phaseOf(parked);
    if (phase.prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    const filler = phase.prompt.candidates.find((u) => parked.cardIdByUid[u] === FILLER) as string;
    const done = mustApply(parked, resolve("p1", { kind: "cards", uids: [filler] }));
    const after = done.state.players.p1.active;
    expect(after?.stack).toEqual([filler]);
    expect(after?.damage).toBe(20);
    expect(after?.energy).toEqual(before?.energy);
    expect(after?.turnPlayed).toBe(before?.turnPlayed);
    expect(done.state.players.p1.deck).toContain(before?.stack[0]);
    expect(done.state.players.p1.deck).not.toContain(filler);
    expect(of(done.events, "POKEMON_SWAPPED_FROM_DECK").map((e) => [e.fromUid, e.toUid])).toEqual([
      [before?.stack[0], filler],
    ]);
    expect(of(done.events, "SHUFFLE").filter((e) => e.seat === "p1")).toHaveLength(1);
    expect(done.state.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("declining still shuffles, and Ditto stays", () => {
    const start = heads(table(DITTO, 2));
    const top = start.players.p1.active?.stack;
    const done = mustApply(mustApply(start, attack(0)).state, resolve("p1", { kind: "cards", uids: [] }));
    expect(done.state.players.p1.active?.stack).toEqual(top);
    expect(of(done.events, "POKEMON_SWAPPED_FROM_DECK")).toEqual([]);
    expect(of(done.events, "SHUFFLE").filter((e) => e.seat === "p1")).toHaveLength(1);
  });

  it("tails does nothing: no prompt, no shuffle", () => {
    const start = { ...table(DITTO, 2), rngState: cursorFor("tails") };
    const done = mustApply(start, attack(0));
    expect(done.state.players.p1.active?.stack).toEqual(start.players.p1.active?.stack);
    expect(of(done.events, "SHUFFLE")).toEqual([]);
    expect(done.state.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("a swapped-in card whose HP the damage already reaches is Knocked Out at the attack's sweep", () => {
    const start = setDamage(heads(table(DITTO, 2)), "p1", 40);
    const parked = mustApply(start, attack(0)).state;
    const phase = phaseOf(parked);
    if (phase.prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    const brittle = phase.prompt.candidates.find((u) => parked.cardIdByUid[u] === STAGE2) as string;
    const done = mustApply(parked, resolve("p1", { kind: "cards", uids: [brittle] }));
    expect(of(done.events, "KNOCKED_OUT").map((e) => [e.seat, done.state.cardIdByUid[e.uid]])).toEqual([["p1", STAGE2]]);
  });
});

describe("D641 §4 — Bug Out: 50 per Bug Out Pokémon in the bottom 7; Pokémon back, the rest discarded (R-BUG1)", () => {
  it("two Bug Out Pokémon and a plain one in the window: 100 damage, 4 non-Pokémon discarded, 3 kept and shuffled", () => {
    const start = bottomOf(table(SIZZ, 3), [BUG, W, FILLER, "fix-energy", BUG, "fix-tool", W]);
    const deckBefore = start.players.p1.deck.length;
    const done = mustApply(start, attack(1));
    expect(done.state.players.p2.active?.damage).toBe(100);
    const shed = of(done.events, "DECK_BOTTOM_DISCARDED");
    expect(shed).toHaveLength(1);
    expect(idsOf(done.state, shed[0]?.uids ?? []).sort()).toEqual([W, W, "fix-energy", "fix-tool"].sort());
    expect(done.state.players.p1.deck.length).toBe(deckBefore - 4);
    expect(done.state.players.p1.discard.length).toBe(4);
    expect(of(done.events, "SHUFFLE").filter((e) => e.seat === "p1")).toHaveLength(1);
    // The deck really is shuffled: not the old order minus the discarded cards.
    const gone = new Set(shed[0]?.uids ?? []);
    expect(done.state.players.p1.deck).not.toEqual(start.players.p1.deck.filter((u) => !gone.has(u)));
  });

  it("no Bug Out Pokémon in the window: no damage, and the Pokémon there still stay", () => {
    const start = bottomOf(table(SIZZ, 3), [FILLER, W, W, W, W, W, W]);
    const done = mustApply(start, attack(1));
    expect(done.state.players.p2.active?.damage).toBe(0);
    expect(of(done.events, "DAMAGE_DEALT")).toEqual([]);
    expect(idsOf(done.state, of(done.events, "DECK_BOTTOM_DISCARDED")[0]?.uids ?? [])).toEqual([W, W, W, W, W, W]);
  });

  it("a short deck reveals what it has: 2 cards, one Bug Out Pokémon, 50", () => {
    let start = bottomOf(table(SIZZ, 3), [W, BUG]);
    const side = start.players.p1;
    start = { ...start, players: { ...start.players, p1: { ...side, deck: side.deck.slice(-2) } } };
    const done = mustApply(start, attack(1));
    expect(done.state.players.p2.active?.damage).toBe(50);
    expect(idsOf(done.state, done.state.players.p1.deck)).toEqual([BUG]);
  });
});

describe("D641 §5 — Pleasing Present: the opponent attaches first, then you, each up to 3 Basic Energy (R-PP1)", () => {
  const present = () => {
    let state = handFromDeck(handFromDeck(table(DELI, 1, [FILLER]), "p2", W, 4), "p2", "fix-tool", 1);
    state = handFromDeck(state, "p1", W, 2);
    return state;
  };

  it("the first prompt is the OPPONENT's: their own Basic Energy in hand, their own board, up to 3", () => {
    const parked = mustApply(present(), attack(0)).state;
    const phase = phaseOf(parked);
    expect([phase.seat, phase.answerer]).toEqual(["p1", "p2"]);
    expect(phase.prompt).toMatchObject({ kind: "attachCards", max: 3 });
    if (phase.prompt.kind !== "attachCards") throw new Error("expected attachCards");
    expect(idsOf(parked, phase.prompt.candidates)).toEqual([W, W, W, W]);
    expect(phase.prompt.targets.map((t) => t.seat)).toEqual(["p2", "p2"]);
    expect(phase.prompt.note).toBe(
      "Attach up to 3 Basic Energy cards from your hand to your Pokémon in any way you like.",
    );
    // The controller cannot answer it.
    const wrong = applyAction(parked, resolve("p1", { kind: "attachCards", assignments: [] }));
    expect(wrong.ok ? "applied" : wrong.error.code).toBe("WRONG_SEAT");
  });

  it("the opponent's answer lands on their board out of their hand; then the controller's own prompt", () => {
    const parked = mustApply(present(), attack(0)).state;
    const first = phaseOf(parked);
    if (first.prompt.kind !== "attachCards") throw new Error("expected attachCards");
    const [a, b] = first.prompt.candidates as [string, string];
    const active = { seat: "p2", spot: { spot: "active" } } as const;
    const bench0 = { seat: "p2", spot: { spot: "bench", index: 0 } } as const;
    const step = mustApply(
      parked,
      resolve("p2", { kind: "attachCards", assignments: [{ uid: a, to: active }, { uid: b, to: bench0 }] }),
    );
    expect(step.state.players.p2.active?.energy).toContain(a);
    expect(step.state.players.p2.bench[0]?.energy).toContain(b);
    expect(step.state.players.p2.hand).not.toContain(a);
    expect(of(step.events, "ENERGY_ATTACHED").map((e) => e.seat)).toEqual(["p2", "p2"]);
    const second = phaseOf(step.state);
    expect(second.answerer).toBeUndefined();
    if (second.prompt.kind !== "attachCards") throw new Error("expected attachCards");
    expect(second.prompt.max).toBe(2);
    expect(second.prompt.targets.map((t) => t.seat)).toEqual(["p1"]);
    const [mine] = second.prompt.candidates as [string];
    const done = mustApply(
      step.state,
      resolve("p1", { kind: "attachCards", assignments: [{ uid: mine, to: { seat: "p1", spot: { spot: "active" } } }] }),
    );
    expect(done.state.players.p1.active?.energy).toContain(mine);
    expect(done.state.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("an answer over the cap is refused; a decline is legal", () => {
    const parked = mustApply(present(), attack(0)).state;
    const first = phaseOf(parked);
    if (first.prompt.kind !== "attachCards") throw new Error("expected attachCards");
    const active = { seat: "p2", spot: { spot: "active" } } as const;
    const four = first.prompt.candidates.map((uid) => ({ uid, to: active }));
    const over = applyAction(parked, resolve("p2", { kind: "attachCards", assignments: four }));
    expect(over.ok ? "applied" : over.error.code).toBe("BAD_EFFECT_CHOICE");
    const declined = mustApply(parked, resolve("p2", { kind: "attachCards", assignments: [] }));
    expect(phaseOf(declined.state).answerer).toBeUndefined();
  });

  it("an opponent with no Basic Energy in hand is not asked: the controller's prompt is the first", () => {
    const state = handFromDeck(table(DELI, 1), "p1", W, 1);
    const phase = phaseOf(mustApply(state, attack(0)).state);
    expect(phase.answerer).toBeUndefined();
    if (phase.prompt.kind !== "attachCards") throw new Error("expected attachCards");
    expect(phase.prompt.targets.map((t) => t.seat)).toEqual(["p1"]);
  });
});

describe("D641 §6 — Lt. Surge's Bargain: the opponent answers (R-LSB1)", () => {
  const played = (state: GameState) => {
    const staged = handFromDeck(state, "p1", SURGE, 1);
    const uid = staged.players.p1.hand.find((u) => staged.cardIdByUid[u] === SURGE) as string;
    return mustApply(staged, { type: "playTrainer", seat: "p1", uid });
  };

  it("parks a labelled confirm answered by the OPPONENT; the controller cannot answer it", () => {
    const parked = played(table(FILLER, 0)).state;
    const phase = phaseOf(parked);
    expect([phase.seat, phase.answerer]).toEqual(["p1", "p2"]);
    expect(phase.prompt).toEqual({
      kind: "confirm",
      note: "Your opponent played Lt. Surge's Bargain: may each player take a Prize card? If you say no, they draw 4 cards.",
      labels: { yes: "Yes: each player takes a Prize card", no: "No: they draw 4 cards" },
    });
    const wrong = applyAction(parked, resolve("p1", { kind: "confirm", yes: true }));
    expect(wrong.ok ? "applied" : wrong.error.code).toBe("WRONG_SEAT");
  });

  it("no: the CONTROLLER draws 4 and keeps the turn", () => {
    const parked = played(table(FILLER, 0));
    const done = mustApply(parked.state, resolve("p2", { kind: "confirm", yes: false }));
    expect(done.state.players.p1.hand).toHaveLength(4);
    expect(done.state.players.p2.hand).toHaveLength(0);
    expect(done.state.players.p1.prizes).toHaveLength(6);
    expect(done.state.phase).toEqual({ kind: "turn:action", seat: "p1" });
  });

  it("yes: the controller picks a Prize first, then the opponent, then the turn resumes", () => {
    const parked = played(table(FILLER, 0)).state;
    const yes = mustApply(parked, resolve("p2", { kind: "confirm", yes: true }));
    expect(yes.state.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: 1 });
    const mine = mustApply(yes.state, { type: "takePrizes", seat: "p1", prizeIndices: [0] });
    expect(mine.state.phase).toEqual({ kind: "ko:takePrizes", seat: "p2", count: 1 });
    const theirs = mustApply(mine.state, { type: "takePrizes", seat: "p2", prizeIndices: [2] });
    expect(theirs.state.phase).toEqual({ kind: "turn:action", seat: "p1" });
    expect([theirs.state.players.p1.prizes.length, theirs.state.players.p2.prizes.length]).toEqual([5, 5]);
    expect([theirs.state.players.p1.hand.length, theirs.state.players.p2.hand.length]).toEqual([1, 1]);
  });

  it("the controller's last Prize wins outright (their stage is first); the opponent's last alone wins for them", () => {
    const mineLast = mustApply(played(setPrizes(table(FILLER, 0), "p1", 1)).state, resolve("p2", { kind: "confirm", yes: true }));
    expect(mineLast.state.phase).toMatchObject({ kind: "gameOver", outcome: { result: "win", winner: "p1" } });
    const theirsLast = mustApply(
      played(setPrizes(table(FILLER, 0), "p2", 1)).state,
      resolve("p2", { kind: "confirm", yes: true }),
    );
    expect(theirsLast.state.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: 1 });
    const over = mustApply(theirsLast.state, { type: "takePrizes", seat: "p1", prizeIndices: [0] });
    expect(over.state.phase).toMatchObject({ kind: "gameOver", outcome: { result: "win", winner: "p2" } });
  });

  it("R-LSB1: both last Prizes in the one sentence are the §14 tie", () => {
    const both = setPrizes(setPrizes(table(FILLER, 0), "p1", 1), "p2", 1);
    const done = mustApply(played(both).state, resolve("p2", { kind: "confirm", yes: true }));
    expect(done.state.phase).toMatchObject({ kind: "gameOver", outcome: { result: "tie" } });
  });
});

describe("D641 §7 — the version", () => {
  it("is built at engine 0.544.0", () => {
    expect(engineVersion).toBe("0.544.0");
  });
});
