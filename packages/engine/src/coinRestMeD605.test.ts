import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import { meAttackCorpus } from "./censusAttackCorpusMe";
import { deriveAttackCoinFlip, deriveAttackEffect } from "./effects";
import type { GameAction, GameEvent, GameState } from "./index";
import { applyAction, createGame, engineVersion } from "./index";
import type { PokemonRef } from "./interpreter";
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

// ── 🆕🆕🆕 D605 — WP34: COIN (THE REST) ──
//
// 5 printed attack texts / 12 `me` printings. Three new pieces: a flip count by name in play
// (`AttackFlipCount.pokemonInPlay` over `byName` for Maushold; `damageChosen.perHeadsInPlay` for
// Tauros), a per-target flip spread (`damageChosen.flipEach`, Mega Zygarde ex) and "choose a Special
// Condition" (four labelled `optional` confirms behind the coin gate, Grafaiai). Mega Audino ex is the
// bare search-and-attach sentence repeated per heads. Every id and text measured on the LOCAL D1,
// 2026-10-08, `legal_standard = 1`; no id was referenced in the engine before this slice. Dropped and
// named: Watchog `me04-071` / `-097` (a revealed-hand pick shuffled into the deck — a new
// `bottomFromOpponentHand.dest`) and Ditto `mep-106` / `30th-115` (a deck Pokémon swapped in for the
// attacker) — §2 keeps them unbuilt. [🆕🆕🆕 D634 (D539): Watchog is BUILT at D634 (C1, the new
// `bottomFromOpponentHand.dest: "deck"`); only Ditto stays unbuilt.] [🆕🆕🆕 D641 (D539): Ditto BUILT at D641 (W1,
// `switchWithDeckChosen`); §2's pin is inverted.]

const T = {
  together:
    "Choose 1 of your opponent's Pokémon and flip a coin for each of your Pokémon in play that has \"Tauros\" in its name. This attack does 50 damage to the chosen Pokémon for each heads. (Don't apply Weakness and Resistance for Benched Pokémon.)",
  zero: "For each of your opponent's Pokémon, flip a coin. If heads, this attack does 150 damage to that Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
  gnaw: "Flip a coin for each Maushold you have in play. For each heads, discard the top 2 cards of your opponent's deck.",
  waltz:
    "Flip 3 coins. For each heads, search your deck for up to 2 Basic Energy cards and attach them to your Pokémon in any way you like. Then, shuffle your deck.",
  paint:
    "Flip a coin. If heads, choose a Special Condition. Your opponent's Active Pokémon is now affected by that Special Condition.",
} as const;

/** [text, legal `me` printings, the ids]. */
const ROWS: readonly (readonly [string, number, readonly string[]])[] = [
  [T.together, 2, ["me04-069", "me04-096"]],
  [T.zero, 5, ["mep-071", "me03-047", "me03-104", "me03-120", "me03-124"]],
  [T.gnaw, 2, ["30th-125", "30th-146"]],
  [T.waltz, 2, ["me02.5-172", "me02.5-253"]],
  [T.paint, 1, ["me01-092"]],
];

const DROPPED: Record<string, string> = {
  "Watchog — the revealed-hand pick goes INTO THE DECK (`bottomFromOpponentHand.dest` has no shuffle member)":
    "Flip 3 coins. If any of them are heads, your opponent reveals their hand. For each heads, choose a card you find there and shuffle it into your opponent's deck.",
  "Ditto — a deck Pokémon switched in for the attacker, everything kept (no op; 🆕🆕🆕 D641: BUILT)":
    "Flip a coin. If heads, search your deck for a Pokémon and switch it with this Pokémon. Any attached cards, damage counters, Special Conditions, turns in play, and any other effects remain on the new Pokémon. If you switched a Pokémon in this way, put this card into your deck. Then, shuffle your deck.",
};

const PAINT_NOTE =
  "Choose a Special Condition. Your opponent's Active Pokémon is now affected by that Special Condition.";

describe("D605 §1 — the five sentences and their programs", () => {
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
    expect(ROWS.reduce((sum, [, n]) => sum + n, 0)).toBe(12);
  });

  it("Target Together and Nullifying Zero are `damageChosen` with the two new riders", () => {
    expect(deriveAttackEffect(T.together)).toEqual([
      {
        op: "damageChosen",
        target: "opponentAny",
        amount: 50,
        count: 1,
        source: "attack",
        deals: true,
        perHeadsInPlay: { kind: "pokemonNameContaining", fragment: "Tauros" },
      },
    ]);
    expect(deriveAttackEffect(T.zero)).toEqual([
      { op: "damageChosen", target: "opponentAny", amount: 150, count: "all", source: "attack", deals: true, flipEach: true },
    ]);
    for (const text of [T.together, T.zero, T.paint]) expect(deriveAttackCoinFlip(text), text).toBeNull();
  });

  it("Gnaw Together and Kaleidowaltz are `programPerHeads` over the shipped ops", () => {
    expect(deriveAttackCoinFlip(T.gnaw)).toEqual({
      kind: "programPerHeads",
      flips: { kind: "pokemonInPlay", filter: { kind: "byName", name: "Maushold" } },
      ops: deriveAttackEffect("Discard the top 2 cards of your opponent's deck."),
      face: "heads",
    });
    expect(deriveAttackCoinFlip(T.waltz)).toEqual({
      kind: "programPerHeads",
      flips: { kind: "printed", count: 3 },
      ops: deriveAttackEffect(
        "Search your deck for up to 2 Basic Energy cards and attach them to your Pokémon in any way you like. Then, shuffle your deck.",
      ),
      face: "heads",
    });
    for (const text of [T.gnaw, T.waltz]) expect(deriveAttackEffect(text), text).toBeNull();
  });

  it("Miraculous Paint: the coin gate over four labelled confirms, one condition per answer path", () => {
    const program = deriveAttackEffect(T.paint);
    expect(program).toHaveLength(1);
    const gate = program?.[0];
    if (gate?.op !== "coinFlipGate") throw new Error("expected a coin gate");
    expect(gate.coins).toBeUndefined();
    const paths: string[][] = [];
    const walk = (ops: readonly unknown[], labels: string[]) => {
      const op = ops[0] as { op: string; status?: string; note?: string; then?: unknown[]; otherwise?: unknown[]; labels?: { yes: string; no: string } };
      if (op.op === "applyStatus") {
        expect(ops).toHaveLength(1);
        paths.push([...labels, op.status as string]);
        return;
      }
      expect(op.op).toBe("optional");
      expect(op.note).toBe(PAINT_NOTE);
      walk(op.then ?? [], [...labels, `yes:${op.labels?.yes}`]);
      walk(op.otherwise ?? [], [...labels, `no:${op.labels?.no}`]);
    };
    walk(gate.then, []);
    expect(paths).toEqual([
      ["yes:Asleep", "asleep"],
      ["no:Burned, Confused, Paralyzed or Poisoned", "yes:Burned", "burned"],
      ["no:Burned, Confused, Paralyzed or Poisoned", "no:Confused, Paralyzed or Poisoned", "yes:Confused", "confused"],
      [
        "no:Burned, Confused, Paralyzed or Poisoned",
        "no:Confused, Paralyzed or Poisoned",
        "no:Paralyzed or Poisoned",
        "yes:Paralyzed",
        "paralyzed",
      ],
      [
        "no:Burned, Confused, Paralyzed or Poisoned",
        "no:Confused, Paralyzed or Poisoned",
        "no:Paralyzed or Poisoned",
        "no:Poisoned",
        "poisoned",
      ],
    ]);
    // Every status applies to the Defending Pokémon.
    expect(JSON.stringify(program).match(/"target":"defender"/g)).toHaveLength(5);
  });

  it("the typographic apostrophe reads the same", () => {
    for (const text of [T.together, T.zero]) {
      expect(deriveAttackEffect(text.replaceAll("'", "’")), text).toEqual(deriveAttackEffect(text));
    }
    expect(deriveAttackCoinFlip(T.gnaw.replaceAll("'", "’"))).toEqual(deriveAttackCoinFlip(T.gnaw));
  });
});

describe("D605 §2 — near misses and the dropped texts stay unbuilt", () => {
  it("a class noun, a zero, a one-coin plural, a stray suffix", () => {
    const nulls: string[] = [
      T.gnaw.replace("each Maushold", "each Pokémon"),
      T.gnaw.replace("top 2 cards", "top 0 cards"),
      T.gnaw.replace("you have in play", "your opponent has in play"),
      T.waltz.replace("Flip 3 coins", "Flip 1 coins"),
      T.waltz.replace("Flip 3 coins", "Flip 11 coins"),
      T.waltz.replace("up to 2", "up to 0"),
      `${T.waltz} Draw a card.`,
    ];
    for (const text of nulls) {
      expect(deriveAttackCoinFlip(text), text).toBeNull();
      expect(deriveAttackEffect(text), text).toBeNull();
    }
    const effectNulls: string[] = [
      T.together.replace("50 damage", "0 damage"),
      T.zero.replace("150 damage", "0 damage"),
      T.zero.replace(" (Don't apply Weakness and Resistance for Benched Pokémon.)", ""),
      T.together.replace("Choose 1", "Choose 2"),
      T.paint.replace("Flip a coin. If heads", "Flip a coin. If tails"),
    ];
    for (const text of effectNulls) expect(deriveAttackEffect(text), text).toBeNull();
  });

  it("arm 46b with the sixth row: 3 heads × 6 consequents = 18 crossings build, exactly 6 are printed", () => {
    // 🆕🆕🆕 D634 (D539): these are D605's six rows; the table has EIGHT now (Challenging Delivery,
    // Reversing Gust) — `coinRestMeD634.test.ts` §2 pins the 24 crossings and 8 printed.
    const heads = ["Flip a coin. If heads, ", "Flip 2 coins. If both of them are heads, ", "Flip 3 coins. If all of them are heads, "];
    const printedGates = [
      "Flip 2 coins. If both of them are heads, heal all damage from 1 of your Pokémon.",
      "Flip 3 coins. If all of them are heads, Knock Out 1 of your opponent's Pokémon.",
      "Flip a coin. If heads, during your opponent's next turn, the Defending Pokémon can't retreat.",
      "Flip a coin. If heads, search your deck for a card and put it into your hand. Then, shuffle your deck.",
      "Flip a coin. If heads, switch 1 of your opponent's Benched Pokémon with their Active Pokémon.",
      T.paint,
    ];
    const tails = printedGates.map((s) => s.slice(s.indexOf(", ") + 2));
    const printed = new Set([...legalAttackCorpus(), ...meAttackCorpus()].map(([, text]) => text));
    const crossings = heads.flatMap((h) => tails.map((c) => h + c));
    expect(crossings).toHaveLength(18);
    for (const text of crossings) expect(deriveAttackEffect(text)?.[0]?.op, text).toBe("coinFlipGate");
    expect(crossings.filter((text) => printed.has(text)).sort()).toEqual([...printedGates].sort());
  });

  it("Watchog and Ditto are unbuilt (🆕🆕🆕 D634: Watchog is built at D634; Ditto stays unbuilt; 🆕🆕🆕 D641: Ditto is built at D641)", () => {
    const me = new Set(meAttackCorpus().map(([, text]) => text));
    for (const [why, text] of Object.entries(DROPPED)) {
      // 🆕🆕🆕 D634 (D539): Watchog is reader-built at D634 (C1).
      // 🆕🆕🆕 D641 (D539): and Ditto at D641 (W1, `switchWithDeckChosen`) — both are built now.
      expect(resolvedByAnyReader(text), why).toBe(true);
      expect(me.has(text), why).toBe(true);
    }
  });
});

// ── ON A BOARD ──

const TAUROS = "me04-069";
const TAUROS_2 = "me04-096";
const ZYGARDE = "me03-047";
const MAUSHOLD = "30th-125";
const MAUSHOLD_2 = "30th-146";
const AUDINO = "me02.5-172";
const GRAFAIAI = "me01-092";
const PALDEAN = "d605-paldean"; // "Paldean Tauros" — has "Tauros" in its name
const MAUSHOLD_EX = "d605-maushold-ex"; // "Maushold ex" — NOT a Maushold
const FILLER = "d605-filler"; // a {C} Basic, 400 HP, no Weakness
const WEAK = "d605-weak"; // a {C} Basic, 400 HP, Weakness {C} ×2
const FIRE = "d605-fire";

const attacker = (id: string, name: string, attack: string, text: string, damage?: number): Card =>
  battler(id, {
    name,
    hp: 300,
    types: ["Colorless"],
    retreat: 1,
    attacks: [{ cost: ["Colorless"], name: attack, ...(damage === undefined ? {} : { damage }), effect: text }],
  } as Partial<Card>);
const body = (id: string, name: string, weak = false): Card =>
  battler(id, {
    name,
    hp: 400,
    types: ["Colorless"],
    retreat: 1,
    weaknesses: weak ? [{ type: "Colorless", value: "×2" }] : null,
  } as Partial<Card>);

const LOCAL: Record<string, Card> = {
  [TAUROS]: attacker(TAUROS, "Tauros", "Target Together", T.together),
  [TAUROS_2]: attacker(TAUROS_2, "Tauros", "Target Together", T.together),
  [ZYGARDE]: attacker(ZYGARDE, "Mega Zygarde ex", "Nullifying Zero", T.zero),
  [MAUSHOLD]: attacker(MAUSHOLD, "Maushold", "Gnaw Together", T.gnaw),
  [MAUSHOLD_2]: attacker(MAUSHOLD_2, "Maushold", "Gnaw Together", T.gnaw),
  [AUDINO]: attacker(AUDINO, "Mega Audino ex", "Kaleidowaltz", T.waltz),
  [GRAFAIAI]: attacker(GRAFAIAI, "Grafaiai", "Miraculous Paint", T.paint, 90),
  [PALDEAN]: body(PALDEAN, "Paldean Tauros"),
  [MAUSHOLD_EX]: body(MAUSHOLD_EX, "Maushold ex"),
  [FILLER]: body(FILLER, "D605 Filler"),
  [WEAK]: body(WEAK, "D605 Weak", true),
  [FIRE]: typedEnergy(FIRE, "Fire"),
};
const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL };
const DECK = deckOf({
  [TAUROS]: 1,
  [TAUROS_2]: 1,
  [ZYGARDE]: 1,
  [MAUSHOLD]: 1,
  [MAUSHOLD_2]: 1,
  [AUDINO]: 1,
  [GRAFAIAI]: 1,
  [PALDEAN]: 1,
  [MAUSHOLD_EX]: 1,
  [FILLER]: 16,
  [WEAK]: 3,
  [FIRE]: 6,
  "fix-energy": 26,
});

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

/** Setup (P2 first), then P1's turn 4 with both hands back in the decks (D595's idiom). */
function p1Turn(): GameState {
  const created = createGame({ seed: 6051, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
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
/** `rngState` after `n` flips from `start` (the flips advance the board's rng exactly that far). */
function rngAfter(start: number, n: number): number {
  let rng = start;
  for (let i = 0; i < n; i += 1) rng = flipCoin(rng)[1];
  return rng;
}
const H: CoinFace = "heads";
const X: CoinFace = "tails";

/** P1 attacks with `active` (one Colorless Energy) and benches `ownBench`; P2 has `oppActive` and `oppBench`. */
function table(
  active: string,
  faces: readonly CoinFace[],
  opts: { ownBench?: readonly string[]; oppActive?: string; oppBench?: readonly string[] } = {},
): GameState {
  let state = p1Turn();
  state = clearBench(setActiveFromDeck(state, "p1", active), "p1");
  state = clearBench(setActiveFromDeck(state, "p2", opts.oppActive ?? FILLER), "p2");
  for (const id of opts.ownBench ?? []) state = benchFromDeck(state, "p1", id);
  for (const id of opts.oppBench ?? []) state = benchFromDeck(state, "p2", id);
  const side = state.players.p1;
  const energy = side.deck.find((u) => state.cardIdByUid[u] === "fix-energy") as string;
  state = {
    ...state,
    players: {
      ...state.players,
      p1: {
        ...side,
        deck: side.deck.filter((u) => u !== energy),
        active: side.active === null ? null : { ...side.active, energy: [energy] },
      },
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
const P2_ACTIVE: PokemonRef = { seat: "p2", spot: { spot: "active" } };
const P2_BENCH = (index: number): PokemonRef => ({ seat: "p2", spot: { spot: "bench", index } });

describe("D605 §3 — Target Together on a board: pick first, then one coin per Tauros", () => {
  const board = (faces: readonly CoinFace[]) =>
    table(TAUROS, faces, { ownBench: [TAUROS_2, PALDEAN, FILLER], oppActive: WEAK, oppBench: [WEAK] });

  it("the pick parks BEFORE any coin; the caption quotes the rule", () => {
    const parked = attack(board([H, H, H]));
    expect(flips(parked.events)).toEqual([]);
    const prompt = promptOf(parked.state);
    expect(prompt).toMatchObject({
      kind: "choosePokemonMulti",
      min: 1,
      max: 1,
      note: "Choose 1 of your opponent's Pokémon (50 damage for each heads).",
    });
    expect((prompt as { candidates: PokemonRef[] }).candidates).toEqual([P2_ACTIVE, P2_BENCH(0)]);
  });

  it("three Tauros-named bodies flip three coins (the attacker, Tauros, Paldean Tauros; not the Filler); a Benched pick takes 50 × heads flat", () => {
    const start = board([H, X, H]);
    const done = resolve(attack(start).state, { kind: "pokemonMulti", refs: [P2_BENCH(0)] });
    expect(flips(done.events)).toEqual([H, X, H]);
    expect(done.state.rngState).toBe(rngAfter(start.rngState, 3));
    expect(done.state.players.p2.bench[0]?.damage).toBe(100); // Weakness not applied on the Bench
    expect(done.state.players.p2.active?.damage).toBe(0);
  });

  it("an Active pick takes 50 × heads with Weakness", () => {
    const done = resolve(attack(board([H, X, X])).state, { kind: "pokemonMulti", refs: [P2_ACTIVE] });
    expect(done.state.players.p2.active?.damage).toBe(100); // 50 × 1, ×2
  });

  it("no heads places nothing", () => {
    const done = resolve(attack(board([X, X, X])).state, { kind: "pokemonMulti", refs: [P2_BENCH(0)] });
    expect(flips(done.events)).toEqual([X, X, X]);
    expect(done.state.players.p2.bench[0]?.damage).toBe(0);
  });

  it("an empty opposing Bench forces the pick and flips at once; a lone Tauros flips once", () => {
    const start = table(TAUROS, [H], { oppActive: FILLER });
    const { state: after, events } = attack(start);
    expect(flips(events)).toEqual([H]);
    expect(after.rngState).toBe(rngAfter(start.rngState, 1));
    expect(after.players.p2.active?.damage).toBe(50);
  });

  it("the parked op survives a JSON round trip and resolves the same (the key rides `pendingOp`)", () => {
    const parked = attack(board([H, H, X])).state;
    if (parked.phase.kind !== "effect:choose") throw new Error("expected a park");
    expect(JSON.stringify(parked.phase.cont.pendingOp)).toContain('"perHeadsInPlay":{"kind":"pokemonNameContaining","fragment":"Tauros"}');
    const revived = JSON.parse(JSON.stringify(parked)) as GameState;
    const a = resolve(parked, { kind: "pokemonMulti", refs: [P2_BENCH(0)] });
    const b = resolve(revived, { kind: "pokemonMulti", refs: [P2_BENCH(0)] });
    expect(b.state).toEqual(a.state);
    expect(a.state.players.p2.bench[0]?.damage).toBe(100);
  });
});

describe("D605 §4 — Nullifying Zero on a board: one coin per opposing Pokémon", () => {
  it("every coin before any damage; heads targets take 150 (the Active with Weakness, the Bench flat)", () => {
    const state = table(ZYGARDE, [H, X, H], { oppActive: WEAK, oppBench: [WEAK, WEAK] });
    const { state: after, events } = attack(state);
    expect(flips(events)).toEqual([H, X, H]);
    const firstHit = events.findIndex((e) => e.type === "DAMAGE_DEALT");
    const lastFlip = events.map((e) => e.type).lastIndexOf("ATTACK_EFFECT_COIN_FLIP");
    expect(lastFlip).toBeLessThan(firstHit);
    expect(after.players.p2.active?.damage).toBe(300);
    expect(after.players.p2.bench.map((b) => b.damage)).toEqual([0, 150]);
    expect(after.rngState).toBe(rngAfter(state.rngState, 3));
    expect(after.phase.kind).not.toBe("effect:choose");
  });

  it("all tails damages nothing; a lone Active flips one coin", () => {
    const { state: missed } = attack(table(ZYGARDE, [X, X], { oppBench: [FILLER] }));
    expect(missed.players.p2.active?.damage).toBe(0);
    expect(missed.players.p2.bench[0]?.damage).toBe(0);
    const { state: lone, events } = attack(table(ZYGARDE, [H]));
    expect(flips(events)).toEqual([H]);
    expect(lone.players.p2.active?.damage).toBe(150);
  });
});

describe("D605 §5 — Gnaw Together on a board: one coin per Maushold in play", () => {
  it("the attacker and a Benched Maushold flip two coins; Maushold ex and a Filler do not count", () => {
    const state = table(MAUSHOLD, [H, H], { ownBench: [MAUSHOLD_2, MAUSHOLD_EX, FILLER] });
    const { state: after, events } = attack(state);
    expect(flips(events)).toEqual([H, H]);
    expect(after.players.p2.discard).toEqual(state.players.p2.deck.slice(0, 4));
  });

  it("one heads mills two; a lone Maushold flips once", () => {
    const state = table(MAUSHOLD, [H, X], { ownBench: [MAUSHOLD_2] });
    expect(attack(state).state.players.p2.discard).toEqual(state.players.p2.deck.slice(0, 2));
    const lone = table(MAUSHOLD, [X]);
    const { state: after, events } = attack(lone);
    expect(flips(events)).toEqual([X]);
    expect(after.players.p2.discard).toEqual([]);
  });
});

describe("D605 §6 — Kaleidowaltz on a board: a search of up to 2 Basic Energy per heads", () => {
  it("two heads, two searches, each attaching up to 2 Basic Energy to any of your Pokémon", () => {
    const state = table(AUDINO, [H, X, H], { ownBench: [FILLER] });
    const first = attack(state);
    expect(flips(first.events)).toEqual([H, X, H]);
    const prompt = promptOf(first.state) as { kind: string; candidates: string[]; max: number };
    expect(prompt).toMatchObject({ kind: "attachCards", max: 2 });
    const fires = first.state.players.p1.deck.filter((u) => first.state.cardIdByUid[u] === FIRE);
    const second = resolve(first.state, {
      kind: "attachCards",
      assignments: [
        { uid: fires[0], to: { seat: "p1", spot: { spot: "active" } } },
        { uid: fires[1], to: { seat: "p1", spot: { spot: "bench", index: 0 } } },
      ],
    });
    expect(promptOf(second.state)).toMatchObject({ kind: "attachCards", max: 2 });
    const done = resolve(second.state, {
      kind: "attachCards",
      assignments: [{ uid: fires[2], to: { seat: "p1", spot: { spot: "bench", index: 0 } } }],
    });
    expect(done.state.players.p1.active?.energy).toHaveLength(2);
    expect(done.state.players.p1.bench[0]?.energy).toEqual([fires[1], fires[2]]);
    expect(of(done.events, "SHUFFLE").length).toBeGreaterThan(0);
  });

  it("no heads searches nothing", () => {
    const state = table(AUDINO, [X, X, X]);
    const { state: after } = attack(state);
    expect(after.phase.kind).not.toBe("effect:choose");
    expect(after.players.p1.active?.energy).toHaveLength(1);
  });
});

describe("D605 §7 — Miraculous Paint on a board: heads asks for a Special Condition", () => {
  const paint = (faces: readonly CoinFace[]) => attack(table(GRAFAIAI, faces));
  const answer = (state: GameState, yes: boolean) => resolve(state, { kind: "confirm", yes });
  const applied = (events: readonly GameEvent[]) => of(events, "STATUS_APPLIED").map((e) => [e.seat, e.status]);

  it("90 damage, then the first confirm names Asleep against the other four", () => {
    const parked = paint([H]);
    expect(of(parked.events, "DAMAGE_DEALT")[0]?.dealt).toBe(90);
    expect(promptOf(parked.state)).toEqual({
      kind: "confirm",
      note: PAINT_NOTE,
      labels: { yes: "Asleep", no: "Burned, Confused, Paralyzed or Poisoned" },
    });
    expect(applied(answer(parked.state, true).events)).toEqual([["p2", "asleep"]]);
  });

  it("each answer path applies exactly the named condition", () => {
    let state = paint([H]).state;
    state = answer(state, false).state;
    expect(promptOf(state)).toMatchObject({ labels: { yes: "Burned", no: "Confused, Paralyzed or Poisoned" } });
    expect(applied(answer(state, true).events)).toEqual([["p2", "burned"]]);
    state = answer(state, false).state;
    expect(applied(answer(state, true).events)).toEqual([["p2", "confused"]]);
    state = answer(state, false).state;
    expect(promptOf(state)).toMatchObject({ labels: { yes: "Paralyzed", no: "Poisoned" } });
    const paralyzed = answer(state, true);
    expect(applied(paralyzed.events)).toEqual([["p2", "paralyzed"]]);
    expect(paralyzed.state.players.p2.active?.conditions.rotation).toBe("paralyzed");
    const poisoned = answer(state, false);
    expect(applied(poisoned.events)).toEqual([["p2", "poisoned"]]);
  });

  it("tails asks nothing", () => {
    const { state: after, events } = paint([X]);
    expect(after.phase.kind).not.toBe("effect:choose");
    expect(applied(events)).toEqual([]);
  });
});

describe("D605 §8 — the version", () => {
  it("is built at engine 0.555.0", () => {
    expect(engineVersion).toBe("0.555.0");
  });
});
