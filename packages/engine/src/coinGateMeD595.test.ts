import type { Card } from "@luminous/schema";
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
  discardFromDeck,
  mustApply,
  setActiveFromDeck,
  setBenchDamage,
  typedEnergy,
} from "./testFixtures";

// ── 🆕🆕🆕 D595 — WP13: COIN-GATE COMPOSITIONS ──
//
// 8 printed attack texts / 11 `me` printings, each a coin over a consequent the engine already runs:
// five `deriveAttackEffect` gates (arm 46b — `COIN_GATE_HEAD` over the closed `COIN_GATED_CONSEQUENTS`
// table, D355's `coins` for the two- and three-coin heads) and three `deriveAttackCoinFlip`
// `programPerHeads` arms (Smeargle's untyped attach, the until-tails singular mill, the until-tails
// random hand shuffle). Every id and text measured on the LOCAL D1, 2026-10-08, `legal_standard = 1`;
// no id was referenced in the tree before this slice. No `me` row is a fixture, so the printed faces
// used on a board are carried HERE. Dropped and named (each needs vocabulary beyond WP13's brief):
// Bombirdier `me05-071`, Bewear `me01-112`, Gholdengo `me01-099`, Pikachu `30th-042`, Snorlax
// `me03-063`, Shiftry `me01-015`, Octillery `me04-017` — §2 keeps them null.

const T = {
  bellyful: "Flip 2 coins. If both of them are heads, heal all damage from 1 of your Pokémon.",
  triKinesis: "Flip 3 coins. If all of them are heads, Knock Out 1 of your opponent's Pokémon.",
  clutch: "Flip a coin. If heads, during your opponent's next turn, the Defending Pokémon can't retreat.",
  strolls: "Flip a coin. If heads, search your deck for a card and put it into your hand. Then, shuffle your deck.",
  pull: "Flip a coin. If heads, switch 1 of your opponent's Benched Pokémon with their Active Pokémon.",
  sketch:
    "Flip 3 coins. Attach an amount of Basic Energy up to the number of heads from your discard pile to your Benched Pokémon in any way you like.",
  havoc: "Flip a coin until you get tails. For each heads, discard the top card of your opponent's deck.",
  bite: "Flip a coin until you get tails. For each heads, choose a random card from your opponent's hand. Your opponent reveals those cards and shuffles them into their deck.",
} as const;

/** [text, legal `me` printings, the ids]. */
const ROWS: readonly (readonly [string, number, readonly string[]])[] = [
  [T.bellyful, 1, ["me01-106"]],
  [T.triKinesis, 1, ["me02.5-078"]],
  [T.clutch, 1, ["30th-093"]],
  [T.strolls, 1, ["30th-081"]],
  [T.pull, 1, ["mep-005"]],
  [T.sketch, 1, ["me02-080"]],
  [T.havoc, 3, ["mep-066", "me02.5-100", "me03-045"]],
  [T.bite, 2, ["me01-066", "me01-145"]],
];

/** The seven WP13 texts this slice drops, each on vocabulary the brief does not allow. */
const DROPPED: Record<string, string> = {
  "Bombirdier — the bench search reads 'a Pokémon' as a card NAME; by the standing rule only a Basic goes onto the Bench, which needs a bench-search arm outside the coin reader":
    "Flip 2 coins. If both of them are heads, search your deck for a Pokémon and put it onto your Bench. Then, shuffle your deck.",
  "Bewear — a damage bonus behind a threshold needs a new `AttackCoinFlip` member":
    "Flip 2 coins. If both of them are heads, this attack does 100 more damage.",
  "Gholdengo — a DECK search capped at the heads count (`retrievalUpToHeads` reads the discard pile)":
    "Flip a coin until you get tails. Search your deck for a number of cards up to the number of heads and put them into your hand. Then, shuffle your deck.",
  "Snorlax — a deck-to-self attach capped at the heads count":
    "Flip a coin until you get tails. Search your deck for an amount of Basic Energy up to the number of heads and attach it to this Pokémon. Then, shuffle your deck.",
  "Pikachu — the same, and its D1 row carries tcgdex markup (WP06)":
    "Flip a coin until you get tails. Search your deck for an amount of Basic {L} Energy up to the number of heads and attach it to this Pokémon. Then, shuffle your deck.",
  "Shiftry — the shuffled body may be the Active (`returnBenched` reads the Bench)":
    "Flip a coin. If heads, choose 1 of your opponent's Pokémon. Shuffle that Pokémon and all attached cards into their deck.",
  "Octillery — a two-coin flip lock (`flipLockAttack` is one coin, field-free)":
    "During your opponent's next turn, if the Defending Pokémon tries to use an attack, your opponent flips 2 coins. If either of them is tails, that attack doesn't happen.",
};

describe("D595 §1 — the eight sentences and their programs", () => {
  it("each is the `me` corpus's row at its printing count, none printed in `sv`, none registry-keyed", () => {
    const me = new Map(meAttackCorpus().map(([n, text]) => [text, n]));
    const sv = new Set(legalAttackCorpus().map(([, text]) => text));
    for (const [text, n, ids] of ROWS) {
      expect([text, me.get(text)]).toEqual([text, n]);
      expect(sv.has(text), text).toBe(false);
      expect(resolvedByAnyReader(text), text).toBe(true);
      expect(ids).toHaveLength(n);
      // 🆕🆕🆕 D610 (D539): "none registry-keyed" now means no ATTACK key — Tyrantrum `mep-066` /
      // `me03-045` carry D610's "Tyrannically Gutsy" passive; Wreak Havoc still derives.
      for (const id of ids) expect(programFor(id)?.attack, id).toBeUndefined();
      for (const id of ids)
        expect(Object.keys(programFor(id) ?? {}), id).toEqual(
          ["mep-066", "me03-045"].includes(id) ? ["passive"] : [],
        );
    }
    expect(ROWS.reduce((sum, [, n]) => sum + n, 0)).toBe(11);
  });

  it("the five gates: `coinFlipGate` (coins absent / 2 / 3) over the bare sentence's own program", () => {
    const gate = (coins: number | undefined, bare: string) => {
      const then = deriveAttackEffect(bare);
      expect(then, bare).not.toBeNull();
      return [{ op: "coinFlipGate", ...(coins === undefined ? {} : { coins }), then }];
    };
    expect(deriveAttackEffect(T.bellyful)).toEqual(gate(2, "Heal all damage from 1 of your Pokémon."));
    expect(deriveAttackEffect(T.clutch)).toEqual(
      gate(undefined, "During your opponent's next turn, the Defending Pokémon can't retreat."),
    );
    expect(deriveAttackEffect(T.strolls)).toEqual(
      gate(undefined, "Search your deck for a card and put it into your hand. Then, shuffle your deck."),
    );
    // Pull is Pokémon Catcher's attack sentence in the `me` wording: `ATTACK_FLIP_GUST`'s program.
    expect(deriveAttackEffect(T.pull)).toEqual(
      deriveAttackEffect("Flip a coin. If heads, switch in 1 of your opponent's Benched Pokémon to the Active Spot."),
    );
    // Tri Kinesis: D416's chosen Knock Out over the whole opposing board, no counter window.
    expect(deriveAttackEffect(T.triKinesis)).toEqual([
      // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable.
      { op: "coinFlipGate", coins: 3, then: [{ op: "knockOutChosen", target: "opponentAny" }] },
    ]);
    for (const text of [T.bellyful, T.triKinesis, T.clutch, T.strolls, T.pull]) {
      expect(deriveAttackCoinFlip(text), text).toBeNull();
    }
  });

  it("the three `programPerHeads` arms repeat the shipped twin's op", () => {
    expect(deriveAttackCoinFlip(T.sketch)).toEqual({
      kind: "programPerHeads",
      flips: { kind: "printed", count: 3 },
      ops: deriveAttackEffect(
        "Attach up to 3 Basic Energy cards from your discard pile to your Benched Pokémon in any way you like.",
      )?.slice(0, 1),
      face: "heads",
    });
    expect(deriveAttackCoinFlip(T.havoc)).toEqual({
      kind: "programPerHeads",
      flips: { kind: "untilTails" },
      ops: (
        deriveAttackCoinFlip("Flip 2 coins. For each heads, discard the top card of your opponent's deck.") as {
          ops: unknown;
        }
      ).ops,
      face: "heads",
    });
    expect(deriveAttackCoinFlip(T.bite)).toEqual({
      kind: "programPerHeads",
      flips: { kind: "untilTails" },
      ops: deriveAttackEffect(
        "Choose a random card from your opponent's hand. Your opponent reveals that card and shuffles it into their deck.",
      ),
      face: "heads",
    });
    for (const text of [T.sketch, T.havoc, T.bite]) expect(deriveAttackEffect(text), text).toBeNull();
  });

  it("the typographic apostrophe reads the same", () => {
    for (const text of [T.triKinesis, T.clutch, T.pull]) {
      expect(deriveAttackEffect(text.replaceAll("'", "’")), text).toEqual(deriveAttackEffect(text));
    }
    for (const text of [T.havoc, T.bite]) {
      expect(deriveAttackCoinFlip(text.replaceAll("'", "’")), text).toEqual(deriveAttackCoinFlip(text));
    }
  });
});

describe("D595 §2 — near misses and the dropped texts stay null", () => {
  it("a coin count that disagrees with its head, an unlisted consequent, a stray suffix", () => {
    const controls: Record<string, string> = {
      "two coins, one-coin head": "Flip 2 coins. If heads, heal all damage from 1 of your Pokémon.",
      "one coin, two-coin head": "Flip a coin. If both of them are heads, heal all damage from 1 of your Pokémon.",
      "four coins, all heads": "Flip 4 coins. If all of them are heads, Knock Out 1 of your opponent's Pokémon.",
      "either, not both": "Flip 2 coins. If either of them is heads, heal all damage from 1 of your Pokémon.",
      "tails, not heads": "Flip a coin. If tails, search your deck for a card and put it into your hand. Then, shuffle your deck.",
      "an unlisted consequent": "Flip a coin. If heads, draw a card.",
      "the consequent with a suffix": `${T.pull} Draw a card.`,
      "Knock Out the Bench only": "Flip 3 coins. If all of them are heads, Knock Out 1 of your opponent's Benched Pokémon.",
    };
    for (const [why, text] of Object.entries(controls)) {
      expect(deriveAttackEffect(text), why).toBeNull();
      expect(deriveAttackCoinFlip(text), why).toBeNull();
    }
    expect(deriveAttackCoinFlip(T.sketch.replace("Flip 3 coins", "Flip 1 coins"))).toBeNull();
    expect(deriveAttackCoinFlip(T.sketch.replace("Flip 3 coins", "Flip 11 coins"))).toBeNull();
    expect(deriveAttackCoinFlip(T.havoc.replace("the top card", "the top 2 cards"))).not.toBeNull();
    expect(deriveAttackCoinFlip(T.havoc.replace("your opponent's deck", "your deck"))).toBeNull();
    expect(deriveAttackCoinFlip(T.bite.replace("their deck", "their discard pile"))).toBeNull();
  });

  it("arm 46b is head × consequent: all 15 crossings build, exactly 5 are printed (D131, not D451)", () => {
    // 🆕🆕🆕 D605 (D539): these are D595's five rows; the table has six now (Miraculous Paint) —
    // `coinRestMeD605.test.ts` §2 pins the 18 crossings and 6 printed.
    const heads = ["Flip a coin. If heads, ", "Flip 2 coins. If both of them are heads, ", "Flip 3 coins. If all of them are heads, "];
    const tails = [T.bellyful, T.triKinesis, T.clutch, T.strolls, T.pull].map((s) => s.slice(s.indexOf(", ") + 2));
    const printed = new Set([...legalAttackCorpus(), ...meAttackCorpus()].map(([, text]) => text));
    const crossings = heads.flatMap((h) => tails.map((c) => h + c));
    expect(crossings).toHaveLength(15);
    for (const text of crossings) expect(deriveAttackEffect(text)?.[0]?.op, text).toBe("coinFlipGate");
    expect(crossings.filter((text) => printed.has(text)).sort()).toEqual(
      [T.bellyful, T.triKinesis, T.clutch, T.strolls, T.pull].sort(),
    );
  });

  it("the seven dropped texts are unbuilt", () => {
    const me = new Set(meAttackCorpus().map(([, text]) => text));
    for (const [why, text] of Object.entries(DROPPED)) {
      expect(resolvedByAnyReader(text), why).toBe(false);
      // Pikachu's D1 row prints the {L} as markup, so its corpus line is not this string.
      if (!why.startsWith("Pikachu")) expect(me.has(text), why).toBe(true);
    }
  });
});

// ── ON A BOARD ──

const MILTANK = "me01-106";
const EXEGGUTOR = "me02.5-078";
const HOUNDSTONE = "me01-066";
const TYRANTRUM = "mep-066";
const MURKROW = "30th-093";
const GIMMIGHOUL = "30th-081";
const DRIFLOON = "mep-005";
const SMEARGLE = "me02-080";
const FILLER = "d595-filler"; // a {C} Basic, 300 HP
const WALL = "d595-wall"; // a {C} Basic, 300 HP, told apart from FILLER
const FIRE = "d595-fire";
const WATER = "d595-water";
const SPECIAL = "fix-special";

const attacker = (id: string, name: string, attack: string, text: string, damage?: number): Card =>
  battler(id, {
    name,
    hp: 200,
    types: ["Colorless"],
    retreat: 1,
    attacks: [{ cost: ["Colorless"], name: attack, ...(damage === undefined ? {} : { damage }), effect: text }],
  } as Partial<Card>);

const LOCAL: Record<string, Card> = {
  [MILTANK]: attacker(MILTANK, "Miltank", "Bellyful of Milk", T.bellyful),
  [EXEGGUTOR]: attacker(EXEGGUTOR, "Team Rocket's Exeggutor", "Tri Kinesis", T.triKinesis),
  [HOUNDSTONE]: attacker(HOUNDSTONE, "Houndstone", "Horrifying Bite", T.bite, 30),
  [TYRANTRUM]: attacker(TYRANTRUM, "Tyrantrum", "Wreak Havoc", T.havoc, 160),
  [MURKROW]: attacker(MURKROW, "Murkrow", "Clumsily Clutch", T.clutch, 20),
  [GIMMIGHOUL]: attacker(GIMMIGHOUL, "Gimmighoul", "Strolls So Much", T.strolls),
  [DRIFLOON]: attacker(DRIFLOON, "Drifloon", "Pull", T.pull),
  [SMEARGLE]: attacker(SMEARGLE, "Smeargle", "Energizing Sketch", T.sketch),
  [FILLER]: battler(FILLER, { name: "D595 Filler", hp: 300, types: ["Colorless"], retreat: 1 }),
  [WALL]: battler(WALL, { name: "D595 Wall", hp: 300, types: ["Colorless"], retreat: 1 }),
  [FIRE]: typedEnergy(FIRE, "Fire"),
  [WATER]: typedEnergy(WATER, "Water"),
};
const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL };
const DECK = deckOf({
  [MILTANK]: 1,
  [EXEGGUTOR]: 1,
  [HOUNDSTONE]: 1,
  [TYRANTRUM]: 1,
  [MURKROW]: 1,
  [GIMMIGHOUL]: 1,
  [DRIFLOON]: 1,
  [SMEARGLE]: 1,
  [FILLER]: 16,
  [WALL]: 4,
  [FIRE]: 4,
  [WATER]: 4,
  [SPECIAL]: 4,
  "fix-energy": 20,
});

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

/** Setup (P2 first), then P1's turn 4 with both hands back in the decks (D592's idiom). */
function p1Turn(): GameState {
  const created = createGame({ seed: 5951, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
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

/** The smallest `rngState` whose next draws are exactly `faces` (`headsCeilingDiscardAttach.test.ts`'s idiom). */
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

/** P1 attacks with `active` (one Colorless Energy attached); P2 has a FILLER Active and `oppBench` WALLs. */
function table(active: string, faces: readonly CoinFace[], oppBench = 0, ownBench = 0): GameState {
  let state = p1Turn();
  state = clearBench(setActiveFromDeck(state, "p1", active), "p1");
  state = clearBench(setActiveFromDeck(state, "p2", FILLER), "p2");
  for (let i = 0; i < oppBench; i++) state = benchFromDeck(state, "p2", WALL);
  for (let i = 0; i < ownBench; i++) state = benchFromDeck(state, "p1", FILLER);
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
const idsOf = (state: GameState, uids: readonly string[]) => uids.map((u) => state.cardIdByUid[u]);
const pickBody = (state: GameState, ref: PokemonRef) =>
  mustApply(state, { type: "resolveEffect", seat: "p1", choice: { kind: "pokemon", ref } } as GameAction);
function promptOf(state: GameState) {
  if (state.phase.kind !== "effect:choose") throw new Error(`expected a park, got ${state.phase.kind}`);
  return state.phase.prompt;
}

describe("D595 §3 — the two- and three-coin gates on a board", () => {
  it("Bellyful of Milk: both heads heals ALL damage from the chosen Pokémon", () => {
    let state = table(MILTANK, [H, H], 0, 1);
    state = setBenchDamage(state, "p1", 0, 120);
    const parked = attack(state);
    expect(of(parked.events, "ATTACK_EFFECT_COIN_FLIP").map((e) => e.result)).toEqual([H, H]);
    expect(promptOf(parked.state)).toMatchObject({ kind: "choosePokemon" });
    const done = pickBody(parked.state, { seat: "p1", spot: { spot: "bench", index: 0 } });
    expect(done.state.players.p1.bench[0]?.damage).toBe(0);
  });

  it("Bellyful of Milk: heads then tails heals nothing and asks nothing", () => {
    let state = table(MILTANK, [H, X], 0, 1);
    state = setBenchDamage(state, "p1", 0, 120);
    const { state: after, events } = attack(state);
    expect(of(events, "ATTACK_EFFECT_COIN_FLIP")).toHaveLength(2);
    expect(after.players.p1.bench[0]?.damage).toBe(120);
    expect(after.turn).toBe(state.turn + 1);
  });

  it("Tri Kinesis: three heads Knock Out the chosen Pokémon, Benched or Active; two heads do nothing", () => {
    const parked = attack(table(EXEGGUTOR, [H, H, H], 2));
    const prompt = promptOf(parked.state);
    expect(prompt).toMatchObject({ kind: "choosePokemon" });
    expect((prompt as { candidates: PokemonRef[] }).candidates).toHaveLength(3);
    const done = pickBody(parked.state, { seat: "p2", spot: { spot: "bench", index: 1 } });
    expect(of(done.events, "KNOCKED_OUT")).toHaveLength(1);
    expect(done.state.players.p2.bench).toHaveLength(1);
    expect(idsOf(done.state, done.state.players.p2.discard)).toContain(WALL);

    const { state: after, events } = attack(table(EXEGGUTOR, [H, H, X], 2));
    expect(of(events, "KNOCKED_OUT")).toHaveLength(0);
    expect(after.players.p2.bench).toHaveLength(2);
  });
});

describe("D595 §4 — the one-coin gates on a board", () => {
  it("Clumsily Clutch: heads blocks the Defending Pokémon's retreat (the shipped defender arm); tails does not", () => {
    const state = table(MURKROW, [H]);
    const { state: after, events } = attack(state);
    expect(of(events, "DAMAGE_DEALT")[0]?.dealt).toBe(20);
    expect(of(events, "RETREAT_BLOCKED")).toHaveLength(1);
    expect(after.players.p2.active?.retreatBlocked).toBe(true);
    const { state: missed, events: missedEvents } = attack(table(MURKROW, [X]));
    expect(of(missedEvents, "RETREAT_BLOCKED")).toHaveLength(0);
    expect(missed.players.p2.active?.retreatBlocked ?? false).toBe(false);
  });

  it("Strolls So Much: heads searches the deck for any card, then shuffles", () => {
    const parked = attack(table(GIMMIGHOUL, [H]));
    expect(promptOf(parked.state)).toMatchObject({ kind: "chooseCards" });
    const special = parked.state.players.p1.deck.find((u) => parked.state.cardIdByUid[u] === SPECIAL) as string;
    const done = mustApply(parked.state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [special] },
    } as GameAction);
    expect(done.state.players.p1.hand).toEqual([special]);
    expect(of(done.events, "SHUFFLE").length).toBeGreaterThan(0);
    const { state: missed, events } = attack(table(GIMMIGHOUL, [X]));
    expect(missed.players.p1.hand).toEqual([]);
    expect(of(events, "SHUFFLE")).toHaveLength(0);
  });

  it("Pull: heads drags the attacker's pick from the opponent's Bench into the Active Spot", () => {
    const parked = attack(table(DRIFLOON, [H], 2));
    expect(promptOf(parked.state)).toMatchObject({ kind: "choosePokemon" });
    const done = pickBody(parked.state, { seat: "p2", spot: { spot: "bench", index: 0 } });
    const p2 = done.state.players.p2;
    expect(idsOf(done.state, [p2.active?.stack.at(-1) ?? ""])).toEqual([WALL]);
    expect(p2.bench.map((b) => done.state.cardIdByUid[b.stack.at(-1) ?? ""]).sort()).toEqual([FILLER, WALL]);
  });
});

describe("D595 §5 — the `programPerHeads` arms on a board", () => {
  it("Wreak Havoc: 160 damage, then one card off the top of the opponent's deck per heads", () => {
    const state = table(TYRANTRUM, [H, H, H, X]);
    const { state: after, events } = attack(state);
    expect(of(events, "ATTACK_EFFECT_COIN_FLIP").map((e) => e.result)).toEqual([H, H, H, X]);
    expect(of(events, "DAMAGE_DEALT")[0]?.dealt).toBe(160);
    expect(after.players.p2.discard).toEqual(state.players.p2.deck.slice(0, 3));
    const { state: none } = attack(table(TYRANTRUM, [X]));
    expect(none.players.p2.discard).toEqual([]);
  });

  it("Horrifying Bite: one random card per heads goes from the opponent's hand into their deck; an empty hand ends it", () => {
    let state = table(HOUNDSTONE, [H, H, X]);
    const p2 = state.players.p2;
    const hand = p2.deck.slice(0, 3);
    state = { ...state, players: { ...state.players, p2: { ...p2, hand, deck: p2.deck.slice(3) } } };
    const { state: after, events } = attack(state);
    expect(of(events, "DAMAGE_DEALT")[0]?.dealt).toBe(30);
    const taken = of(events, "RANDOM_CARD_TAKEN");
    expect(taken).toHaveLength(2);
    expect(new Set(taken.map((e) => e.uid)).size).toBe(2);
    for (const e of taken) expect([e.seat, e.to, after.players.p2.deck.includes(e.uid)]).toEqual(["p2", "deck", true]);
    // P2 then draws for its turn, so the hand is 3 - 2 + 1.
    expect(after.players.p2.hand).toHaveLength(2);

    let empty = table(HOUNDSTONE, [H, H, H, X]);
    empty = { ...empty, players: { ...empty.players, p2: { ...empty.players.p2, hand: [] } } };
    expect(of(attack(empty).events, "RANDOM_CARD_TAKEN")).toHaveLength(0);
  });

  it("Energizing Sketch: up to one Basic Energy of ANY type per heads, each to a Benched Pokémon; never a Special", () => {
    let state = table(SMEARGLE, [H, H, X], 0, 2);
    state = discardFromDeck(state, "p1", SPECIAL, 1);
    state = discardFromDeck(state, "p1", FIRE, 1);
    state = discardFromDeck(state, "p1", WATER, 1);
    const first = attack(state);
    expect(promptOf(first.state)).toMatchObject({ kind: "choosePokemon" });
    const second = pickBody(first.state, { seat: "p1", spot: { spot: "bench", index: 0 } });
    expect(promptOf(second.state)).toMatchObject({ kind: "choosePokemon" });
    const done = pickBody(second.state, { seat: "p1", spot: { spot: "bench", index: 1 } });
    const bench = done.state.players.p1.bench.map((b) => idsOf(done.state, b.energy));
    expect(bench.flat().sort()).toEqual([FIRE, WATER]);
    expect(idsOf(done.state, done.state.players.p1.discard)).toEqual([SPECIAL]);

    // Each park is declinable (D358): a decline attaches nothing, and the second heads still asks.
    const declined = mustApply(first.state, { type: "resolveEffect", seat: "p1", choice: { kind: "pokemon" } } as GameAction);
    expect(declined.state.players.p1.bench.every((b) => b.energy.length === 0)).toBe(true);
    expect(promptOf(declined.state)).toMatchObject({ kind: "choosePokemon" });
  });

  it("KNOWN LIMITATION (inherited from the five `sv` discard-attach sentences): the ENERGY is not chosen", () => {
    // `attachEnergyFrom` with no type takes the first Basic Energy in pile order (interpreter.ts
    // `attachableEnergies`, "fungible"); the only park is the target. The print lets the player pick.
    let state = table(SMEARGLE, [H, X, X], 0, 1);
    state = discardFromDeck(state, "p1", FIRE, 1);
    state = discardFromDeck(state, "p1", WATER, 1);
    const pile = idsOf(state, state.players.p1.discard);
    const done = pickBody(attack(state).state, { seat: "p1", spot: { spot: "bench", index: 0 } });
    expect(idsOf(done.state, done.state.players.p1.bench[0]?.energy ?? [])).toEqual([pile[0]]);
  });
});

describe("D595 §6 — the version", () => {
  it("is built at engine 0.493.0", () => {
    expect(engineVersion).toBe("0.493.0");
  });
});
