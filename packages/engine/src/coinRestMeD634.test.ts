import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import { meAttackCorpus } from "./censusAttackCorpusMe";
import { deriveAttackCoinFlip, deriveAttackEffect } from "./effects";
import type { GameAction, GameEvent, GameState } from "./index";
import { applyAction, createGame, engineVersion } from "./index";
import type { PokemonRef } from "./interpreter";
import { formatElapsed, logFromEvents } from "./log";
import { programFor } from "./registry";
import { flipCoin } from "./rng";
import type { CoinFace } from "./rng";
import {
  FIXTURE_POOL,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  mustApply,
  setActiveFromDeck,
  typedEnergy,
} from "./testFixtures";

// ── 🆕🆕🆕 D634 — C1: THE COIN REST ──
//
// 7 printed attack texts / 8 printings (`me` + `30th`), the coin sentences D595 and D605 dropped. Every
// id and text measured on the LOCAL D1, 2026-10-10, `legal_standard = 1`; before this slice the ids were
// named only by those drop lists. Pieces: `AttackCoinFlip.bonusOnAllHeads` (Hyper Lariat),
// `AttackCoinFlip.deckUpToHeads` (All-You-Can-Grab, Gormandizer, Charge-Up Dash; 0 heads does nothing,
// R-UTH1), two `COIN_GATED_CONSEQUENTS` rows (Challenging Delivery, Basic only under D613; Reversing
// Gust on `returnBenched.includeActive` for the opponent's side) and `bottomFromOpponentHand.dest:
// "deck"` with the `HAND_CARD_SHUFFLED_INTO_DECK` event (Snap Inspection ×2). No `me` row is a fixture,
// so the printed faces used on a board are carried HERE.

const T = {
  lariat: "Flip 2 coins. If both of them are heads, this attack does 100 more damage.",
  delivery:
    "Flip 2 coins. If both of them are heads, search your deck for a Pokémon and put it onto your Bench. Then, shuffle your deck.",
  grab: "Flip a coin until you get tails. Search your deck for a number of cards up to the number of heads and put them into your hand. Then, shuffle your deck.",
  gormandizer:
    "Flip a coin until you get tails. Search your deck for an amount of Basic Energy up to the number of heads and attach it to this Pokémon. Then, shuffle your deck.",
  dash: "Flip a coin until you get tails. Search your deck for an amount of Basic {L} Energy up to the number of heads and attach it to this Pokémon. Then, shuffle your deck.",
  gust: "Flip a coin. If heads, choose 1 of your opponent's Pokémon. Shuffle that Pokémon and all attached cards into their deck.",
  snap: "Flip 3 coins. If any of them are heads, your opponent reveals their hand. For each heads, choose a card you find there and shuffle it into your opponent's deck.",
} as const;

/** [text, legal printings, the ids]. */
const ROWS: readonly (readonly [string, number, readonly string[]])[] = [
  [T.lariat, 1, ["me01-112"]],
  [T.delivery, 1, ["me05-071"]],
  [T.grab, 1, ["me01-099"]],
  [T.gormandizer, 1, ["me03-063"]],
  [T.dash, 1, ["30th-042"]],
  [T.gust, 1, ["me01-015"]],
  [T.snap, 2, ["me04-071", "me04-097"]],
];

describe("D634 §1 — the seven sentences and their programs", () => {
  it("each is the `me` corpus's row at its printing count, none printed in `sv`, none registry-keyed", () => {
    const me = new Map(meAttackCorpus().map(([n, text]) => [text, n]));
    const sv = new Set(legalAttackCorpus().map(([, text]) => text));
    for (const [text, n, ids] of ROWS) {
      expect([text, me.get(text)]).toEqual([text, n]);
      expect(sv.has(text), text).toBe(false);
      expect(resolvedByAnyReader(text), text).toBe(true);
      expect(ids).toHaveLength(n);
      for (const id of ids) expect(programFor(id), id).toBeUndefined();
    }
    expect(ROWS.reduce((sum, [, n]) => sum + n, 0)).toBe(8);
  });

  it("Hyper Lariat is `bonusOnAllHeads` over two printed coins", () => {
    expect(deriveAttackCoinFlip(T.lariat)).toEqual({
      kind: "bonusOnAllHeads",
      flips: { kind: "printed", count: 2 },
      bonus: 100,
    });
    expect(deriveAttackEffect(T.lariat)).toBeNull();
  });

  it("the three until-tails deck searches are `deckUpToHeads`", () => {
    expect(deriveAttackCoinFlip(T.grab)).toEqual({
      kind: "deckUpToHeads",
      flips: { kind: "untilTails" },
      filter: { kind: "anyCard" },
      to: "hand",
    });
    expect(deriveAttackCoinFlip(T.gormandizer)).toEqual({
      kind: "deckUpToHeads",
      flips: { kind: "untilTails" },
      filter: { kind: "basicEnergy" },
      to: "self",
    });
    expect(deriveAttackCoinFlip(T.dash)).toEqual({
      kind: "deckUpToHeads",
      flips: { kind: "untilTails" },
      filter: { kind: "basicEnergy", energyType: "Lightning" },
      to: "self",
    });
    for (const text of [T.grab, T.gormandizer, T.dash]) expect(deriveAttackEffect(text), text).toBeNull();
  });

  it("Challenging Delivery and Reversing Gust are arm 46b rows", () => {
    expect(deriveAttackEffect(T.delivery)).toEqual([
      {
        op: "coinFlipGate",
        coins: 2,
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: [{ op: "searchDeck", filter: { kind: "anyPokemon" }, dest: "bench", max: 1 }, { op: "shuffleDeck" }],
      },
    ]);
    expect(deriveAttackEffect(T.gust)).toEqual([
      {
        op: "coinFlipGate",
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: [{ op: "returnBenched", whose: "opponent", dest: "deck", includeActive: true }],
      },
    ]);
    for (const text of [T.delivery, T.gust]) expect(deriveAttackCoinFlip(text), text).toBeNull();
  });

  it("Snap Inspection is `programPerHeads` over `bottomFromOpponentHand` at `dest: \"deck\"`", () => {
    expect(deriveAttackCoinFlip(T.snap)).toEqual({
      kind: "programPerHeads",
      flips: { kind: "printed", count: 3 },
      ops: [{ op: "bottomFromOpponentHand", dest: "deck" }],
      face: "heads",
    });
    expect(deriveAttackEffect(T.snap)).toBeNull();
    // The curly possessive reads the same.
    expect(deriveAttackCoinFlip(T.snap.replace("opponent's deck", "opponent’s deck"))).toEqual(
      deriveAttackCoinFlip(T.snap),
    );
  });
});

describe("D634 §2 — near misses stay null; arm 46b's crossings", () => {
  it("a coin count the anchor does not pin, a zero bonus, an unmapped code, a one-coin count", () => {
    const nulls = [
      T.lariat.replace("Flip 2 coins. If both of them", "Flip 3 coins. If all of them"),
      T.lariat.replace("100 more", "0 more"),
      T.lariat.replace("both of them are heads", "either of them is heads"),
      T.dash.replace("{L}", "{C}"),
      T.grab.replace("number of heads", "number of tails"),
      T.grab.replace("into your hand", "into your discard pile"),
      T.snap.replace("Flip 3 coins", "Flip 1 coins"),
      T.snap.replace("Flip 3 coins", "Flip 11 coins"),
      T.snap.replace("your opponent's deck", "their discard pile"),
    ];
    for (const text of nulls) {
      expect(deriveAttackCoinFlip(text), text).toBeNull();
      expect(deriveAttackEffect(text), text).toBeNull();
    }
    // The Benched sentence keeps D299's program (no `includeActive`).
    expect(
      deriveAttackEffect(T.gust.replace("opponent's Pokémon", "opponent's Benched Pokémon")),
    ).toEqual([
      // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
      { op: "coinFlipGate", then: [{ op: "returnBenched", whose: "opponent", dest: "deck" }] },
    ]);
  });

  it("arm 46b with eight rows: 3 heads × 8 consequents = 24 crossings build, exactly 8 are printed", () => {
    const heads = ["Flip a coin. If heads, ", "Flip 2 coins. If both of them are heads, ", "Flip 3 coins. If all of them are heads, "];
    const printedGates = [
      "Flip 2 coins. If both of them are heads, heal all damage from 1 of your Pokémon.",
      "Flip 3 coins. If all of them are heads, Knock Out 1 of your opponent's Pokémon.",
      "Flip a coin. If heads, during your opponent's next turn, the Defending Pokémon can't retreat.",
      "Flip a coin. If heads, search your deck for a card and put it into your hand. Then, shuffle your deck.",
      "Flip a coin. If heads, switch 1 of your opponent's Benched Pokémon with their Active Pokémon.",
      "Flip a coin. If heads, choose a Special Condition. Your opponent's Active Pokémon is now affected by that Special Condition.",
      T.delivery,
      T.gust,
    ];
    const tails = printedGates.map((s) => s.slice(s.indexOf(", ") + 2));
    const printed = new Set([...legalAttackCorpus(), ...meAttackCorpus()].map(([, text]) => text));
    const crossings = heads.flatMap((h) => tails.map((c) => h + c));
    expect(crossings).toHaveLength(24);
    for (const text of crossings) expect(deriveAttackEffect(text)?.[0]?.op, text).toBe("coinFlipGate");
    expect(crossings.filter((text) => printed.has(text)).sort()).toEqual([...printedGates].sort());
  });
});

// ── ON A BOARD ──

const BEWEAR = "me01-112";
const BOMBIRDIER = "me05-071";
const GHOLDENGO = "me01-099";
const SNORLAX = "me03-063";
const PIKACHU = "30th-042";
const SHIFTRY = "me01-015";
const WATCHOG = "me04-071";
const FILLER = "d634-filler"; // a {C} Basic, 400 HP, no Weakness
const STAGE1 = "d634-stage1"; // a {C} Stage 1 — not benchable by a class noun
const FIRE = "d634-fire";
const LIGHTNING = "d634-lightning";

const attacker = (id: string, name: string, attack: string, text: string, damage?: number | string): Card =>
  battler(id, {
    name,
    hp: 300,
    types: ["Colorless"],
    retreat: 1,
    attacks: [{ cost: ["Colorless"], name: attack, ...(damage === undefined ? {} : { damage }), effect: text }],
  } as Partial<Card>);

const LOCAL: Record<string, Card> = {
  [BEWEAR]: attacker(BEWEAR, "Bewear", "Hyper Lariat", T.lariat, "100+"),
  [BOMBIRDIER]: attacker(BOMBIRDIER, "Bombirdier", "Challenging Delivery", T.delivery),
  [GHOLDENGO]: attacker(GHOLDENGO, "Gholdengo", "All-You-Can-Grab", T.grab),
  [SNORLAX]: attacker(SNORLAX, "Snorlax", "Gormandizer", T.gormandizer),
  [PIKACHU]: attacker(PIKACHU, "Pikachu", "Charge-Up Dash", T.dash),
  [SHIFTRY]: attacker(SHIFTRY, "Shiftry", "Reversing Gust", T.gust),
  [WATCHOG]: attacker(WATCHOG, "Watchog", "Snap Inspection", T.snap),
  [FILLER]: battler(FILLER, { name: "D634 Filler", hp: 400, types: ["Colorless"], weaknesses: null } as Partial<Card>),
  [STAGE1]: battler(STAGE1, {
    name: "D634 Stage 1",
    hp: 100,
    types: ["Colorless"],
    stage: "Stage1",
    evolveFrom: "D634 Filler",
  } as Partial<Card>),
  [FIRE]: typedEnergy(FIRE, "Fire"),
  [LIGHTNING]: typedEnergy(LIGHTNING, "Lightning"),
};
const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL };
const DECK = deckOf({
  [BEWEAR]: 1,
  [BOMBIRDIER]: 1,
  [GHOLDENGO]: 1,
  [SNORLAX]: 1,
  [PIKACHU]: 1,
  [SHIFTRY]: 1,
  [WATCHOG]: 1,
  [STAGE1]: 2,
  [FILLER]: 20,
  [FIRE]: 6,
  [LIGHTNING]: 6,
  "fix-energy": 19,
});

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

/** Setup (P2 first), then P1's turn 4 with both hands back in the decks (D605's idiom). */
function p1Turn(): GameState {
  const created = createGame({ seed: 6341, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
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
  state = must(applyAction(state, { type: "endTurn", seat: "p1" }));
  state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
  for (const s of ["p1", "p2"] as const) {
    const side = state.players[s];
    // Every Prize is swapped for a Filler or a Colorless Energy, so each named card is findable.
    let deck = [...side.deck, ...side.hand];
    const plain = (u: string) => [FILLER, "fix-energy"].includes(state.cardIdByUid[u] as string);
    const prizes = side.prizes.map((u) => {
      if (plain(u)) return u;
      const swap = deck.find(plain);
      if (swap === undefined) throw new Error("no swap card");
      deck = [...deck.filter((d) => d !== swap), u];
      return swap;
    });
    state = { ...state, players: { ...state.players, [s]: { ...side, hand: [], prizes, deck } } };
  }
  return state;
}

/** The smallest `rngState` whose next draws are exactly `faces`. */
function rngForFaces(faces: readonly CoinFace[]): number {
  for (let candidate = 1; candidate < 200_000; candidate += 1) {
    let rng = candidate;
    let agrees = true;
    for (const wanted of faces) {
      const [drawn, next] = flipCoin(rng);
      rng = next;
      if (drawn !== wanted) {
        agrees = false;
        break;
      }
    }
    if (agrees) return candidate;
  }
  throw new Error(`no rngState draws ${faces.join(",")}`);
}
const H: CoinFace = "heads";
const X: CoinFace = "tails";

/** P1 attacks with `active` (one Colorless Energy); P2 has `oppActive`, `oppBench` and `oppHand` (ids). */
function table(
  active: string,
  faces: readonly CoinFace[],
  opts: { oppActive?: string; oppBench?: readonly string[]; oppHand?: readonly string[] } = {},
): GameState {
  let state = p1Turn();
  state = clearBench(setActiveFromDeck(state, "p1", active), "p1");
  state = clearBench(setActiveFromDeck(state, "p2", opts.oppActive ?? FILLER), "p2");
  for (const id of opts.oppBench ?? []) state = benchFromDeck(state, "p2", id);
  const side = state.players.p1;
  const energy = side.deck.find((u) => state.cardIdByUid[u] === "fix-energy") as string;
  let p2 = state.players.p2;
  for (const id of opts.oppHand ?? []) {
    const uid = p2.deck.find((u) => state.cardIdByUid[u] === id);
    if (uid === undefined) throw new Error(`p2 deck has no ${id}`);
    p2 = { ...p2, deck: p2.deck.filter((u) => u !== uid), hand: [...p2.hand, uid] };
  }
  state = {
    ...state,
    players: {
      p1: {
        ...side,
        deck: side.deck.filter((u) => u !== energy),
        active: side.active === null ? null : { ...side.active, energy: [energy] },
      },
      p2,
    },
  };
  return { ...state, rngState: rngForFaces(faces) };
}

const attack = (state: GameState) => mustApply(state, { type: "attack", seat: "p1", index: 0 });
const of = <K extends GameEvent["type"]>(events: readonly GameEvent[], type: K) =>
  events.filter((e) => e.type === type) as Extract<GameEvent, { type: K }>[];
const flips = (events: readonly GameEvent[]) => of(events, "ATTACK_EFFECT_COIN_FLIP").map((e) => e.result);
const resolve = (state: GameState, choice: unknown) =>
  mustApply(state, { type: "resolveEffect", seat: "p1", choice } as GameAction);
function promptOf(state: GameState) {
  if (state.phase.kind !== "effect:choose") throw new Error(`expected a park, got ${state.phase.kind}`);
  return state.phase.prompt;
}
const idOf = (state: GameState, uid: string) => state.cardIdByUid[uid];
const P2_ACTIVE: PokemonRef = { seat: "p2", spot: { spot: "active" } };
const P2_BENCH = (index: number): PokemonRef => ({ seat: "p2", spot: { spot: "bench", index } });

describe("D634 §3 — Hyper Lariat on a board: 100, +100 only on two heads", () => {
  const dealt = (faces: readonly CoinFace[]) => {
    const { events } = attack(table(BEWEAR, faces));
    expect(flips(events)).toEqual(faces);
    return of(events, "DAMAGE_DEALT")[0]?.dealt;
  };
  it("HH deals 200; HT, TH and TT deal the printed 100", () => {
    expect(dealt([H, H])).toBe(200);
    expect(dealt([H, X])).toBe(100);
    expect(dealt([X, H])).toBe(100);
    expect(dealt([X, X])).toBe(100);
  });
});

describe("D634 §4 — Challenging Delivery on a board: two heads bench a Basic Pokémon", () => {
  it("HH parks a pick over the deck's Basic Pokémon only (no Stage 1, no Energy), benches it and shuffles", () => {
    const start = table(BOMBIRDIER, [H, H]);
    const parked = attack(start);
    const prompt = promptOf(parked.state) as { kind: string; candidates: string[]; max: number };
    expect(prompt).toMatchObject({ kind: "chooseCards", dest: "bench", max: 1 });
    const ids = new Set(prompt.candidates.map((u) => idOf(parked.state, u)));
    expect(ids.has(STAGE1)).toBe(false);
    expect(ids.has(FIRE)).toBe(false);
    expect(ids.has(FILLER)).toBe(true);
    const pick = prompt.candidates.find((u) => idOf(parked.state, u) === FILLER) as string;
    const done = resolve(parked.state, { kind: "cards", uids: [pick] });
    expect(done.state.players.p1.bench.map((b) => b.stack.at(-1))).toEqual([pick]);
    expect(of(done.events, "SHUFFLE").map((e) => e.seat)).toEqual(["p1"]);
  });

  it("HT searches nothing", () => {
    const { state, events } = attack(table(BOMBIRDIER, [H, X]));
    expect(state.phase.kind).not.toBe("effect:choose");
    expect(state.players.p1.bench).toEqual([]);
    expect(of(events, "SHUFFLE")).toEqual([]);
  });
});

describe("D634 §5 — All-You-Can-Grab on a board: up to the heads count into the hand", () => {
  it("H, H, T parks a pick of up to 2 cards; both go to the hand and the deck is shuffled", () => {
    const parked = attack(table(GHOLDENGO, [H, H, X]));
    expect(flips(parked.events)).toEqual([H, H, X]);
    const prompt = promptOf(parked.state) as { kind: string; candidates: string[]; min: number; max: number };
    expect(prompt).toMatchObject({ kind: "chooseCards", dest: "hand", min: 0, max: 2 });
    const picks = prompt.candidates.slice(0, 2);
    const done = resolve(parked.state, { kind: "cards", uids: picks });
    expect(done.state.players.p1.hand).toEqual(picks);
    expect(of(done.events, "SHUFFLE").map((e) => e.seat)).toEqual(["p1"]);
  });

  it("an immediate tails searches nothing and does not shuffle (R-UTH1)", () => {
    const start = table(GHOLDENGO, [X]);
    const { state, events } = attack(start);
    expect(state.phase.kind).not.toBe("effect:choose");
    expect(state.players.p1.hand).toEqual([]);
    expect(state.players.p1.deck).toEqual(start.players.p1.deck);
    expect(of(events, "SHUFFLE")).toEqual([]);
  });
});

describe("D634 §6 — Gormandizer and Charge-Up Dash on a board: up to the heads count onto this Pokémon", () => {
  it("Gormandizer, H, T: one Basic Energy of any type attaches to the attacker, then the shuffle", () => {
    const parked = attack(table(SNORLAX, [H, X]));
    const prompt = promptOf(parked.state) as { kind: string; max: number };
    expect(prompt).toMatchObject({ max: 1 });
    const fire = parked.state.players.p1.deck.find((u) => idOf(parked.state, u) === FIRE) as string;
    const done = resolve(parked.state, {
      kind: "attachCards",
      assignments: [{ uid: fire, to: { seat: "p1", spot: { spot: "active" } } }],
    });
    expect(done.state.players.p1.active?.energy).toHaveLength(2);
    expect(done.state.players.p1.active?.energy).toContain(fire);
    expect(of(done.events, "SHUFFLE").map((e) => e.seat)).toEqual(["p1"]);
  });

  it("Charge-Up Dash offers Lightning Energy only, up to the heads count", () => {
    const parked = attack(table(PIKACHU, [H, H, H, X]));
    const prompt = promptOf(parked.state) as { max: number; candidates?: string[] };
    expect(prompt).toMatchObject({ max: 3 });
    const offered = new Set((prompt.candidates ?? []).map((u) => idOf(parked.state, u)));
    expect([...offered]).toEqual([LIGHTNING]);
  });

  it("an immediate tails attaches nothing and does not shuffle (R-UTH1)", () => {
    const { state, events } = attack(table(SNORLAX, [X]));
    expect(state.phase.kind).not.toBe("effect:choose");
    expect(state.players.p1.active?.energy).toHaveLength(1);
    expect(of(events, "SHUFFLE")).toEqual([]);
  });
});

describe("D634 §7 — Reversing Gust on a board: the opponent's Active is a candidate", () => {
  it("heads parks a pick over the opponent's Active and Bench; the Active goes into their deck and they promote", () => {
    const start = table(SHIFTRY, [H], { oppBench: [FILLER, FILLER] });
    const parked = attack(start);
    const prompt = promptOf(parked.state) as { kind: string; candidates: PokemonRef[]; note: string };
    expect(prompt.candidates).toEqual([P2_ACTIVE, P2_BENCH(0), P2_BENCH(1)]);
    expect(prompt.note).toBe("Shuffle which of your opponent's Pokémon and all attached cards into their deck?");
    const activeUid = start.players.p2.active?.stack[0] as string;
    const done = resolve(parked.state, { kind: "pokemon", ref: P2_ACTIVE });
    expect(of(done.events, "POKEMON_RETURNED")).toMatchObject([{ seat: "p2", uid: activeUid, actor: "p1", dest: "deck" }]);
    expect(done.state.players.p2.deck).toContain(activeUid);
    expect(done.state.players.p2.active).toBeNull();
    expect(done.state.players.p2.bench).toHaveLength(2);
    // The emptied Active Spot is the opponent's to fill (§8.1).
    expect(JSON.stringify(done.state.phase)).toContain("promote");
  });

  it("a Benched pick is D299's shuffle; tails does nothing", () => {
    const start = table(SHIFTRY, [H], { oppBench: [FILLER, FILLER] });
    const benchUid = start.players.p2.bench[1]?.stack[0] as string;
    const done = resolve(attack(start).state, { kind: "pokemon", ref: P2_BENCH(1) });
    expect(done.state.players.p2.deck).toContain(benchUid);
    expect(done.state.players.p2.active).not.toBeNull();
    const tails = attack(table(SHIFTRY, [X], { oppBench: [FILLER] }));
    expect(tails.state.phase.kind).not.toBe("effect:choose");
    expect(of(tails.events, "POKEMON_RETURNED")).toEqual([]);
  });
});

describe("D634 §8 — Snap Inspection on a board: per heads, a revealed card is shuffled into the deck", () => {
  const hand = [FIRE, STAGE1, LIGHTNING];

  it("H, T, H: two picks out of the revealed hand, each shuffled into P2's deck, named in the log", () => {
    const start = table(WATCHOG, [H, X, H], { oppHand: hand });
    const first = attack(start);
    expect(flips(first.events)).toEqual([H, X, H]);
    expect(of(first.events, "HAND_REVEALED")).toHaveLength(1);
    const prompt = promptOf(first.state) as { kind: string; candidates: string[]; min: number; max: number };
    expect(prompt).toMatchObject({
      kind: "chooseCards",
      dest: "deck",
      min: 1,
      max: 1,
      note: "Your opponent reveals their hand. Choose a card you find there and shuffle it into your opponent's deck.",
    });
    const stage1 = start.players.p2.hand[1] as string;
    const second = resolve(first.state, { kind: "cards", uids: [stage1] });
    expect(of(second.events, "HAND_CARD_SHUFFLED_INTO_DECK")).toEqual([
      { type: "HAND_CARD_SHUFFLED_INTO_DECK", seat: "p2", uid: stage1, actor: "p1" },
    ]);
    expect(of(second.events, "SHUFFLE").map((e) => e.seat)).toEqual(["p2"]);
    expect(second.state.players.p2.deck).toContain(stage1);
    // The second heads reveals what is left and asks again.
    expect(of(second.events, "HAND_REVEALED")).toEqual([
      { type: "HAND_REVEALED", seat: "p2", uids: [start.players.p2.hand[0], start.players.p2.hand[2]] },
    ]);
    const fire = start.players.p2.hand[0] as string;
    const done = resolve(second.state, { kind: "cards", uids: [fire] });
    // The attack ends the turn, so P2 has drawn one card on top of the one left.
    expect(done.state.players.p2.hand.slice(0, 1)).toEqual([start.players.p2.hand[2]]);
    expect(done.state.players.p2.hand).toHaveLength(2);
    expect(done.state.players.p2.deck).toContain(fire);
    const rows = logFromEvents(of(done.events, "HAND_CARD_SHUFFLED_INTO_DECK"), {
      names: { p1: "P1", p2: "P2" },
      state: done.state,
      elapsed: formatElapsed(0),
    });
    expect(rows.map((row) => (row.kind === "action" ? [row.who, row.segments.map((x) => x.text).join("")] : null))).toEqual([
      ["p1", "shuffled Fire Energy into P2's deck"],
    ]);
  });

  it("three tails reveals nothing; an empty opponent hand reveals zero and moves nothing", () => {
    const tailsStart = table(WATCHOG, [X, X, X], { oppHand: hand });
    const tails = attack(tailsStart);
    expect(of(tails.events, "HAND_REVEALED")).toEqual([]);
    // The three are kept; the fourth is P2's draw for the turn the attack hands over.
    expect(tails.state.players.p2.hand.slice(0, 3)).toEqual(tailsStart.players.p2.hand);
    const empty = attack(table(WATCHOG, [H, X, X]));
    expect(empty.state.phase.kind).not.toBe("effect:choose");
    expect(of(empty.events, "HAND_CARD_SHUFFLED_INTO_DECK")).toEqual([]);
  });

  it("a one-card hand resolves inline (one class, the M1 rule)", () => {
    const oneStart = table(WATCHOG, [H, X, X], { oppHand: [FIRE] });
    const one = attack(oneStart);
    expect(one.state.phase.kind).not.toBe("effect:choose");
    expect(one.state.players.p2.hand).not.toContain(oneStart.players.p2.hand[0]);
    expect(one.state.players.p2.deck).toContain(oneStart.players.p2.hand[0]);
    expect(of(one.events, "HAND_CARD_SHUFFLED_INTO_DECK")).toHaveLength(1);
  });

  it("the parked board survives a JSON round trip and resumes the same", () => {
    const parked = attack(table(WATCHOG, [H, H, X], { oppHand: hand })).state;
    const revived = JSON.parse(JSON.stringify(parked)) as GameState;
    expect(revived).toEqual(parked);
    const pick = parked.players.p2.hand[0] as string;
    expect(resolve(revived, { kind: "cards", uids: [pick] }).state).toEqual(
      resolve(parked, { kind: "cards", uids: [pick] }).state,
    );
  });
});

describe("D634 §9 — the version", () => {
  it("is built at engine 0.535.0", () => {
    expect(engineVersion).toBe("0.535.0");
  });
});
