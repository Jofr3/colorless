import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import { meAttackCorpus } from "./censusAttackCorpusMe";
import {
  deriveAttackDamageBonus,
  deriveAttackEffect,
  deriveAttackOptionalBoost,
  deriveAttackOptionalCostBoost,
  splitAttackGateClause,
  splitAttackTrailingClause,
} from "./effects";
import type { GameAction, GameEvent, GameState, Seat } from "./index";
import { applyAction, createGame, engineVersion } from "./index";
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

// ── 🆕🆕🆕 D589 — WP08: MEGA GRENINJA EX AND THE OPTIONAL-COST FAMILY ──
//
// 5 printed texts / 14 `me` units (9 printings): four attack sentences claimed by
// `deriveAttackOptionalCostBoost` through a third skeleton (*"… and have this attack do N more
// damage."*) over four new cost rows, plus Mega Greninja ex's "Mortal Shuriken" on Meowscarada ex
// `sv02-015`'s `payFromHand` + `damageChosen` shape. Every id and text measured on the LOCAL D1
// (`apps/api/.wrangler/…/8437d866….sqlite`), 2026-10-07, `legal_standard = 1`; no id was referenced
// anywhere in the tree before this slice. No `me` row is a fixture, so the printed bytes are carried
// HERE and §1 pins each against the committed `me` corpus.

const METALLIC_HAMMER = "You may discard 3 {M} Energy from this Pokémon and have this attack do 150 more damage.";
const RIOTOUS_BLASTING = "You may discard all Energy from this Pokémon and have this attack do 130 more damage.";
const NINJA_SPINNER =
  "You may put a {W} Energy attached to this Pokémon into your hand and have this attack do 80 more damage.";
const CHRONO_BURST =
  "You may shuffle all Energy attached to this Pokémon into your deck and have this attack do 80 more damage.";
const MORTAL_SHURIKEN_TEXT =
  "Once during your turn, if this Pokémon is in the Active Spot, you may discard a Basic {W} Energy card from your hand in order to use this Ability. Place 6 damage counters on 1 of your opponent's Pokémon.";

/** [text, the `me` printing ids that print it]. */
const SENTENCES: readonly (readonly [string, readonly string[]])[] = [
  [METALLIC_HAMMER, ["me04-061"]],
  [RIOTOUS_BLASTING, ["me01-050", "me01-158"]],
  [NINJA_SPINNER, ["mep-081", "me04-022", "me04-100", "me04-116", "me04-122"]],
  [CHRONO_BURST, ["me01-095"]],
];
const GRENINJA = ["mep-081", "me04-022", "me04-100", "me04-116", "me04-122"] as const;

describe("D589 §1 — the texts: 4 attack sentences / 9 printings, plus Mortal Shuriken ×5", () => {
  it("each sentence is a row of the committed `me` corpus at its printing count, and none is printed in `sv`", () => {
    const me = new Map(meAttackCorpus().map(([n, text]) => [text, n]));
    const sv = new Set(legalAttackCorpus().map(([, text]) => text));
    for (const [text, ids] of SENTENCES) {
      expect([text, me.get(text)]).toEqual([text, ids.length]);
      expect(sv.has(text), text).toBe(false);
    }
    expect(SENTENCES.flatMap(([, ids]) => ids)).toHaveLength(9);
  });

  it("every sentence resolves, through `deriveAttackOptionalCostBoost` and no sibling", () => {
    for (const [text] of SENTENCES) {
      expect(resolvedByAnyReader(text), text).toBe(true);
      expect(deriveAttackOptionalCostBoost(text), text).not.toBeNull();
      expect(deriveAttackEffect(text), text).toBeNull();
      expect(deriveAttackOptionalBoost(text), text).toBeNull();
      expect(deriveAttackDamageBonus(text), text).toBeNull();
      expect(splitAttackGateClause(text), text).toBeNull();
      expect(splitAttackTrailingClause(text), text).toBeNull();
    }
  });

  it("the skeleton's claimed set over the `sv` and `me` corpora is exactly these four", () => {
    const skeleton = /^You may (.+) and have this attack do (\d+) more damage\.$/;
    const claimed = [...legalAttackCorpus(), ...meAttackCorpus()].filter(([, text]) => skeleton.test(text));
    expect(claimed.map(([, text]) => text).sort()).toEqual(SENTENCES.map(([text]) => text).sort());
  });
});

describe("D589 §2 — the readings: shipped ops behind a necessary-and-sufficient gate", () => {
  it("Metallic Hammer: 3 Energy providing {M} off the Active, gated on 3 such cards attached", () => {
    expect(deriveAttackOptionalCostBoost(METALLIC_HAMMER)).toEqual({
      cond: { kind: "yourActiveEnergyAtLeast", count: 3, energy: "Metal" },
      ops: [{ op: "discardEnergy", from: "yourActive", filter: { kind: "providesEnergy", energyType: "Metal" }, count: 3 }],
      payoff: { kind: "moreDamage", bonus: 150 },
    });
  });

  it("Riotous Blasting: every Energy off the Active to the discard, gated on one attached", () => {
    expect(deriveAttackOptionalCostBoost(RIOTOUS_BLASTING)).toEqual({
      cond: { kind: "yourActiveEnergyAtLeast", count: 1 },
      ops: [{ op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" }, count: "all" }],
      payoff: { kind: "moreDamage", bonus: 130 },
    });
  });

  it("Ninja Spinner: one Energy providing {W} to the hand, gated on one attached AND the hand move being allowed (D572)", () => {
    expect(deriveAttackOptionalCostBoost(NINJA_SPINNER)).toEqual({
      cond: {
        kind: "allOf",
        conditions: [
          { kind: "yourActiveEnergyAtLeast", count: 1, energy: "Water" },
          { kind: "yourInPlayToHandAllowed" },
        ],
      },
      ops: [{ op: "discardEnergy", from: "yourActive", filter: { kind: "providesEnergy", energyType: "Water" }, to: "hand" }],
      payoff: { kind: "moreDamage", bonus: 80 },
    });
  });

  it("Chrono Burst: D383's deck return at `all`, then the shuffle the verb names", () => {
    expect(deriveAttackOptionalCostBoost(CHRONO_BURST)).toEqual({
      cond: { kind: "yourActiveEnergyAtLeast", count: 1 },
      ops: [
        { op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" }, count: "all", to: "deck" },
        { op: "shuffleDeck" },
      ],
      payoff: { kind: "moreDamage", bonus: 80 },
    });
  });

  it("the captures are read: another digit, type and bonus derive at their own values", () => {
    const other = METALLIC_HAMMER.replace("3 {M}", "2 {R}").replace("150", "60");
    expect(deriveAttackOptionalCostBoost(other)).toEqual({
      cond: { kind: "yourActiveEnergyAtLeast", count: 2, energy: "Fire" },
      ops: [{ op: "discardEnergy", from: "yourActive", filter: { kind: "providesEnergy", energyType: "Fire" }, count: 2 }],
      payoff: { kind: "moreDamage", bonus: 60 },
    });
    const grass = deriveAttackOptionalCostBoost(NINJA_SPINNER.replace("{W}", "{G}"));
    expect(grass?.ops).toEqual([
      { op: "discardEnergy", from: "yourActive", filter: { kind: "providesEnergy", energyType: "Grass" }, to: "hand" },
    ]);
  });

  it("table composition: D383's shuffle row and D385's hand row derive under the new skeleton too", () => {
    expect(
      deriveAttackOptionalCostBoost(
        "You may shuffle 3 Energy attached to this Pokémon into your deck and have this attack do 50 more damage.",
      ),
    ).toEqual({
      cond: { kind: "yourActiveEnergyAtLeast", count: 3 },
      ops: [
        { op: "discardEnergy", from: "yourActive", filter: { kind: "anyEnergy" }, count: 3, to: "deck" },
        { op: "shuffleDeck" },
      ],
      payoff: { kind: "moreDamage", bonus: 50 },
    });
    expect(deriveAttackOptionalCostBoost("You may discard your hand and have this attack do 30 more damage.")).toEqual({
      cond: { kind: "yourHandNotEmpty" },
      ops: [{ op: "discardHand" }],
      payoff: { kind: "moreDamage", bonus: 30 },
    });
  });

  it("the near misses stay null, one token apart each", () => {
    const controls: Record<string, string> = {
      "a printed 0 bonus": RIOTOUS_BLASTING.replace("130", "0"),
      "a printed 0 count": METALLIC_HAMMER.replace("3 {M}", "0 {M}"),
      "an unmapped brace code": METALLIC_HAMMER.replace("{M}", "{X}"),
      "`does` for `do`": RIOTOUS_BLASTING.replace("attack do", "attack does"),
      "an untyped `an Energy` to the hand": NINJA_SPINNER.replace("a {W} Energy", "an Energy"),
      "two {W} to the hand": NINJA_SPINNER.replace("a {W} Energy", "2 {W} Energy"),
      "`all` shuffled into the hand": CHRONO_BURST.replace("into your deck", "into your hand"),
      "the opponent's Active for this Pokémon": RIOTOUS_BLASTING.replace("this Pokémon", "your opponent's Active Pokémon"),
      "a rider on the cost": RIOTOUS_BLASTING.replace("this Pokémon and", "this Pokémon and draw a card and"),
      "a rider on the to-hand cost": NINJA_SPINNER.replace("into your hand", "into your hand and draw a card"),
      "a rider on the typed discard": METALLIC_HAMMER.replace("this Pokémon and", "this Pokémon and draw a card and"),
      "a rider on the shuffle-all cost": CHRONO_BURST.replace("into your deck", "into your deck and draw a card"),
      "a prefixed sentence": `Draw a card. ${RIOTOUS_BLASTING}`,
      "a suffixed sentence": `${RIOTOUS_BLASTING} Draw a card.`,
    };
    for (const [why, text] of Object.entries(controls)) {
      expect(deriveAttackOptionalCostBoost(text), why).toBeNull();
      expect(resolvedByAnyReader(text), why).toBe(false);
    }
  });

  it("Mortal Shuriken ×5: ONE object, Meowscarada ex's shape at {W}, 60, `opponentAny`, Active only; no attack key", () => {
    expect(programFor(GRENINJA[0])).toEqual({
      abilities: [
        {
          name: "Mortal Shuriken",
          oncePerTurn: true,
          activeOnly: true,
          program: [
            { op: "payFromHand", count: 1, to: "discard", filter: { kind: "basicEnergy", energyType: "Water" } },
            { op: "damageChosen", target: "opponentAny", amount: 60, count: 1, source: "ability" },
          ],
        },
      ],
    });
    for (const id of GRENINJA) expect(programFor(id), id).toBe(programFor(GRENINJA[0]));
    const bouquet = programFor("sv02-015")?.abilities?.[0]?.program;
    expect(bouquet?.[0]).toEqual({ op: "payFromHand", count: 1, to: "discard", filter: { kind: "basicEnergy", energyType: "Grass" } });
    expect(MORTAL_SHURIKEN_TEXT.startsWith("Once during your turn, if this Pokémon is in the Active Spot")).toBe(true);
  });
});

// ── ON A BOARD ──

const FILLER = "d589-filler";
const WATER_WEAK = "d589-water-weak";
const W = "d589-water";
const M = "d589-metal";
const L = "d589-lightning";

const mon = (id: string, name: string, hp: number, type: string, attacks: Card["attacks"], extra: Partial<Card> = {}) =>
  battler(id, { name, hp, types: [type], retreat: 2, attacks, ...extra });

const LOCAL: Record<string, Card> = {
  "me04-061": mon(
    "me04-061",
    "Metagross",
    180,
    "Metal",
    [
      {
        cost: ["Metal"],
        name: "Bounce Back",
        damage: 60,
        effect: "Switch out your opponent's Active Pokémon to the Bench. (Your opponent chooses the new Active Pokémon.)",
      },
      { cost: ["Metal", "Metal", "Metal", "Colorless"], name: "Metallic Hammer", damage: "150+", effect: METALLIC_HAMMER },
    ],
    { stage: "Stage2", evolveFrom: "Metang" },
  ),
  "me01-050": mon(
    "me01-050",
    "Mega Manectric ex",
    330,
    "Lightning",
    [
      {
        cost: ["Lightning", "Lightning"],
        name: "Flash Ray",
        damage: 120,
        effect: "During your opponent's next turn, prevent all damage done to this Pokémon by attacks from Basic Pokémon.",
      },
      { cost: ["Lightning", "Lightning", "Lightning"], name: "Riotous Blasting", damage: "200+", effect: RIOTOUS_BLASTING },
    ],
    { stage: "Stage1", evolveFrom: "Electrike", suffix: "ex" } as Partial<Card>,
  ),
  "mep-081": mon(
    "mep-081",
    "Mega Greninja ex",
    350,
    "Water",
    [{ cost: ["Water", "Water"], name: "Ninja Spinner", damage: "120+", effect: NINJA_SPINNER }],
    {
      stage: "Stage2",
      evolveFrom: "Frogadier",
      suffix: "ex",
      abilities: [{ type: "Ability", name: "Mortal Shuriken", effect: MORTAL_SHURIKEN_TEXT }],
    } as Partial<Card>,
  ),
  "me01-095": mon("me01-095", "Dialga", 140, "Metal", [
    { cost: ["Metal"], name: "Beam", damage: 30 },
    { cost: ["Metal", "Metal", "Colorless"], name: "Chrono Burst", damage: "80+", effect: CHRONO_BURST },
  ]),
  [FILLER]: mon(FILLER, "D589 Filler", 400, "Colorless", [{ cost: ["Colorless"], name: "Tap", damage: 10 }]),
  [WATER_WEAK]: mon(WATER_WEAK, "D589 Water-weak", 400, "Colorless", [{ cost: ["Colorless"], name: "Tap", damage: 10 }], {
    weaknesses: [{ type: "Water", value: "×2" }],
  }),
  [W]: typedEnergy(W, "Water"),
  [M]: typedEnergy(M, "Metal"),
  [L]: typedEnergy(L, "Lightning"),
};
const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL };
const DECK = deckOf({
  "me04-061": 1,
  "me01-050": 1,
  "mep-081": 2,
  "me01-095": 1,
  [FILLER]: 12,
  [WATER_WEAK]: 2,
  [W]: 12,
  [M]: 10,
  [L]: 8,
  "fix-energy": 11,
});

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

/** Setup, then P1's own turn (P2 went first and passed); both hands back into the decks. */
function p1Turn(): GameState {
  const created = createGame({ seed: 5893, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
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

/** TEST SURGERY — every copy of `id` that sits in `seat`'s Prizes swapped with a deck card. */
function unprize(state: GameState, seat: Seat, id: string): GameState {
  const side = state.players[seat];
  let deck = [...side.deck];
  const prizes = side.prizes.map((u) => {
    if (state.cardIdByUid[u] !== id) return u;
    const swap = deck.find((d) => state.cardIdByUid[d] !== id);
    if (swap === undefined) throw new Error("no swap card");
    deck = [...deck.filter((d) => d !== swap), u];
    return swap;
  });
  return { ...state, players: { ...state.players, [seat]: { ...side, prizes, deck } } };
}

/** P1's Active is `attacker` with `energy` attached; P2's Active is `defender` with one Filler benched. */
function table(attacker: string, energy: readonly (readonly [string, number])[], defender = FILLER): GameState {
  let state = p1Turn();
  for (const s of ["p1", "p2"] as const) {
    state = clearBench(setActiveFromDeck(state, s, FILLER), s);
    for (const id of [attacker, defender, FILLER, "mep-081", W]) state = unprize(state, s, id);
  }
  state = clearBench(setActiveFromDeck(state, "p1", attacker), "p1");
  for (const [id, n] of energy) state = attachFromDeck(state, "p1", id, n);
  state = clearBench(setActiveFromDeck(state, "p2", defender), "p2");
  return benchFromDeck(state, "p2", FILLER);
}

/** `seat`'s hand set to `ids` pulled from its deck. */
function handOf(state: GameState, seat: Seat, ids: readonly string[]): GameState {
  const side = state.players[seat];
  let deck = [...side.hand, ...side.deck];
  const hand: string[] = [];
  for (const id of ids) {
    const uid = deck.find((u) => state.cardIdByUid[u] === id);
    if (uid === undefined) throw new Error(`${seat} deck has no more ${id}`);
    hand.push(uid);
    deck = deck.filter((u) => u !== uid);
  }
  return { ...state, players: { ...state.players, [seat]: { ...side, hand, deck } } };
}

const attack = (index: number): GameAction => ({ type: "attack", seat: "p1", index });
const say = (state: GameState, yes: boolean) =>
  mustApply(state, { type: "resolveEffect", seat: "p1", choice: { kind: "confirm", yes } });
const of = <T extends GameEvent["type"]>(events: readonly GameEvent[], type: T) =>
  events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
const ids = (state: GameState, uids: readonly string[]) => uids.map((u) => state.cardIdByUid[u]);
const attached = (state: GameState) => ids(state, state.players.p1.active?.energy ?? []);

/** Declare `index`, expect the confirm, answer it. */
function swing(state: GameState, index: number, yes: boolean) {
  const parked = mustApply(state, attack(index)).state;
  if (parked.phase.kind !== "effect:choose" || parked.phase.prompt.kind !== "confirm") {
    throw new Error(`expected a confirm, got ${parked.phase.kind}`);
  }
  return say(parked, yes);
}

describe("D589 §3 — Metallic Hammer: discard 3 {M} for +150", () => {
  const board = () => table("me04-061", [[M, 3], ["fix-energy", 1]]);

  it("yes: 150 + 150, exactly the three {M} discarded, the other Energy stays", () => {
    const result = swing(board(), 1, true);
    expect(of(result.events, "DAMAGE_DEALT")[0]?.dealt).toBe(300);
    expect(attached(result.state)).toEqual(["fix-energy"]);
    expect(ids(result.state, result.state.players.p1.discard).filter((id) => id === M)).toHaveLength(3);
  });

  it("no: the printed 150 and nothing discarded", () => {
    const result = swing(board(), 1, false);
    expect(of(result.events, "DAMAGE_DEALT")[0]?.dealt).toBe(150);
    expect(attached(result.state)).toHaveLength(4);
  });
});

describe("D589 §4 — Riotous Blasting: discard all Energy for +130", () => {
  const board = () => table("me01-050", [[L, 3], ["fix-energy", 1]]);

  it("yes: 200 + 130, every Energy to the discard pile", () => {
    const result = swing(board(), 1, true);
    expect(of(result.events, "DAMAGE_DEALT")[0]?.dealt).toBe(330);
    expect(attached(result.state)).toEqual([]);
    expect(ids(result.state, result.state.players.p1.discard).sort()).toEqual([L, L, L, "fix-energy"].sort());
  });

  it("no: the printed 200 and every Energy kept", () => {
    const result = swing(board(), 1, false);
    expect(of(result.events, "DAMAGE_DEALT")[0]?.dealt).toBe(200);
    expect(attached(result.state)).toHaveLength(4);
  });
});

describe("D589 §5 — Ninja Spinner: one {W} to the hand for +80", () => {
  const board = () => table("mep-081", [[W, 2], ["fix-energy", 1]]);

  it("yes: 120 + 80, one {W} into the hand, the rest stays attached", () => {
    // Two interchangeable {W}: the fungible pick collapses, so the yes resolves without a second park.
    const result = swing(board(), 0, true);
    expect(result.state.phase.kind).not.toBe("effect:choose");
    expect(of(result.events, "DAMAGE_DEALT")[0]?.dealt).toBe(200);
    expect(attached(result.state).sort()).toEqual([W, "fix-energy"].sort());
    expect(ids(result.state, result.state.players.p1.hand)).toEqual([W]);
    expect(of(result.events, "ENERGY_DISCARDED")[0]?.to).toBe("hand");
  });

  it("no: the printed 120 and the hand untouched", () => {
    const result = swing(board(), 0, false);
    expect(of(result.events, "DAMAGE_DEALT")[0]?.dealt).toBe(120);
    expect(result.state.players.p1.hand).toEqual([]);
    expect(attached(result.state)).toHaveLength(3);
  });
});

describe("D589 §6 — Chrono Burst: shuffle all Energy into the deck for +80", () => {
  const board = () => table("me01-095", [[M, 2], ["fix-energy", 1]]);

  it("yes: 80 + 80, the three Energy in the deck (not the discard pile), and the deck shuffled", () => {
    const before = board();
    const result = swing(before, 1, true);
    expect(of(result.events, "DAMAGE_DEALT")[0]?.dealt).toBe(160);
    expect(attached(result.state)).toEqual([]);
    expect(result.state.players.p1.deck.length).toBe(before.players.p1.deck.length + 3);
    expect(ids(result.state, result.state.players.p1.discard)).toEqual([]);
    expect(of(result.events, "SHUFFLE").map((e) => e.seat)).toContain("p1");
  });

  it("no: the printed 80, the Energy stays, no shuffle", () => {
    const before = board();
    const result = swing(before, 1, false);
    expect(of(result.events, "DAMAGE_DEALT")[0]?.dealt).toBe(80);
    expect(attached(result.state)).toHaveLength(3);
    expect(result.state.players.p1.deck.length).toBe(before.players.p1.deck.length);
  });
});

describe("D589 §7 — Mortal Shuriken: discard a Basic {W} from hand, 6 counters on 1 of the opponent's Pokémon", () => {
  const use = (state: GameState, spot: { spot: "active" } | { spot: "bench"; index: number } = { spot: "active" }) =>
    applyAction(state, { type: "useAbility", seat: "p1", target: spot, abilityName: "Mortal Shuriken" });
  const pick = (state: GameState, ref: { seat: Seat; spot: { spot: "active" } | { spot: "bench"; index: number } }) =>
    mustApply(state, { type: "resolveEffect", seat: "p1", choice: { kind: "pokemonMulti", refs: [ref] } } as GameAction);
  const board = (defender = FILLER) => handOf(table("mep-081", [[W, 2]], defender), "p1", [W, "fix-energy"]);

  it("on the Active: the {W} is discarded and 60 lands on the chosen Benched body", () => {
    const used = use(board());
    if (!used.ok) throw new Error(used.error.code);
    const result = pick(used.state, { seat: "p2", spot: { spot: "bench", index: 0 } });
    expect(result.state.players.p2.bench[0]?.damage).toBe(60);
    expect(result.state.players.p2.active?.damage).toBe(0);
    expect(ids(result.state, result.state.players.p1.hand)).toEqual(["fix-energy"]);
    expect(ids(result.state, result.state.players.p1.discard)).toEqual([W]);
  });

  it("the opponent's Active is a legal target, and placed counters ignore its Weakness to {W}", () => {
    const used = use(board(WATER_WEAK));
    if (!used.ok) throw new Error(used.error.code);
    const result = pick(used.state, { seat: "p2", spot: { spot: "active" } });
    expect(result.state.players.p2.active?.damage).toBe(60);
    expect(of(result.events, "COUNTERS_PLACED").map((e) => [e.amount, e.source])).toEqual([[60, "ability"]]);
  });

  it("once per turn", () => {
    const used = use(handOf(table("mep-081", [[W, 2]]), "p1", [W, W]));
    if (!used.ok) throw new Error(used.error.code);
    const after = pick(used.state, { seat: "p2", spot: { spot: "active" } }).state;
    const again = use(after);
    expect(again.ok ? "ok" : again.error.code).toBe("ABILITY_ALREADY_USED");
  });

  it("refused from the Bench (the printed Active Spot clause)", () => {
    const state = handOf(benchFromDeck(table(FILLER, []), "p1", "mep-081"), "p1", [W]);
    const result = use(state, { spot: "bench", index: 0 });
    expect(result.ok ? "ok" : result.error.code).toBe("ABILITY_ACTIVE_ONLY");
  });

  it("refused with no Basic {W} Energy card in hand (the cost is unpayable)", () => {
    const state = handOf(table("mep-081", [[W, 2]]), "p1", ["fix-energy", M]);
    const result = use(state);
    expect(result.ok).toBe(false);
    expect(state.players.p1.hand).toHaveLength(2);
  });
});

describe("D589 §8 — the version", () => {
  it("is built at engine 0.483.0", () => {
    expect(engineVersion).toBe("0.483.0");
  });
});
