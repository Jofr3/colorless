import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { meAttackCorpus } from "./censusAttackCorpusMe";
import type { GameAction, GameState, InPlayPokemon, Seat } from "./index";
import { applyAction, createGame, engineVersion } from "./index";
import { programFor } from "./registry";
import {
  FIXTURE_POOL,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  setActiveFromDeck,
  typedEnergy,
} from "./testFixtures";

// ── 🆕🆕🆕 D591 — WP20a: THE `me` ACTIVATED ABILITIES (the Flapping trio and the draw engines) ──
//
// 11 printed texts / 19 `me` printings on seven new registry objects, all on shipped vocabulary
// (`drawCards`, `drawCards who: "eachPlayer"`, `attachEnergyFrom` `toSelf` from the hand,
// `payFromHand`, `drawUntilHandSize`, `playableIf` with `allOf` / `yourNamedPokemonInPlay`, and
// Flip the Script's `oncePerTurn: "sharedByName"`). Every id and text measured on the LOCAL D1
// (`apps/api/.wrangler/…/8437d866….sqlite`), 2026-10-08, `legal_standard = 1`; no id was
// referenced anywhere in the tree before this slice. The `30th` faces spell the Energy type as a
// word ("Basic Fire Energy card") where the `mep` faces print "{R}": the same sentence, one object.
// [🆕🆕🆕 D612: the ingest now writes the word form as "{R}" too (cardText.ts, WP06).]
// No `me` row is a fixture, so the printed faces are carried HERE.

const RUN_ERRAND =
  "Once during your turn, if this Pokémon is in the Active Spot, you may use this Ability. Draw 2 cards. You can't use more than 1 Run Errand Ability each turn.";
const ALLURING_WINGS =
  "Once during your turn, if this Pokémon is in the Active Spot, you may use this Ability. Each player draws a card.";
const flapping = (a: string, b: string, energy: string) =>
  `Once during your turn, if you have ${a} and ${b} in play, you may use this Ability. Attach a Basic ${energy} Energy card from your hand to this Pokémon.`;
const LUNAR_CYCLE =
  "Once during your turn, if you have Solrock in play, you may discard a Basic {F} Energy card from your hand in order to use this Ability. Draw 3 cards. You can't use more than 1 Lunar Cycle Ability each turn.";
const flaringMagic = (energy: string) =>
  `Once during your turn, you may discard a Basic ${energy} Energy card from your hand in order to use this Ability. Draw cards until you have 7 cards in your hand.`;

const KANGASKHAN = ["me01-104", "me01-164", "me01-182", "mep-025"] as const;
const FROSMOTH = "me02.5-053";
const MOLTRES = ["mep-096", "30th-011", "30th-130"] as const;
const ZAPDOS = ["mep-098", "30th-055", "30th-133"] as const;
const ARTICUNO = ["mep-097", "30th-018", "30th-132"] as const;
const LUNATONE = ["me01-074", "mep-004", "me02.5-105"] as const;
const DELPHOX = ["me04-013", "mep-074"] as const;

type Lock = true | "sharedByName";
/** [Ability name, the keyed printings, the printed lock, `activeOnly`]. */
const ABILITIES: readonly (readonly [string, readonly string[], Lock, boolean])[] = [
  ["Run Errand", KANGASKHAN, "sharedByName", true],
  ["Alluring Wings", [FROSMOTH], true, true],
  ["Fiery Flapping", MOLTRES, true, false],
  ["Flash-Pop Flapping", ZAPDOS, true, false],
  ["Frosty Flapping", ARTICUNO, true, false],
  ["Lunar Cycle", LUNATONE, "sharedByName", false],
  ["Flaring Magic", DELPHOX, true, false],
];

const abilityOf = (id: string) => programFor(id)?.abilities?.[0];

describe("D591 §1 — the programs: seven objects over 19 printings", () => {
  it("every keyed printing carries ONE activated Ability under its printed name, one object per text", () => {
    expect(ABILITIES.flatMap(([, ids]) => ids)).toHaveLength(19);
    for (const [name, ids, lock, activeOnly] of ABILITIES) {
      for (const id of ids) {
        expect(Object.keys(programFor(id) ?? {}), id).toEqual(["abilities"]);
        expect(programFor(id)?.abilities, id).toHaveLength(1);
        expect(abilityOf(id), id).toMatchObject({ name, oncePerTurn: lock, activeOnly });
        expect(programFor(id), id).toBe(programFor(ids[0] as string));
      }
    }
    expect(new Set(ABILITIES.map(([, ids]) => programFor(ids[0] as string))).size).toBe(7);
  });

  it('the name lock is exactly where the card prints "You can\'t use more than 1 … Ability each turn"', () => {
    const printed: Record<string, string> = {
      "Run Errand": RUN_ERRAND,
      "Alluring Wings": ALLURING_WINGS,
      "Fiery Flapping": flapping("Articuno", "Zapdos", "{R}"),
      "Flash-Pop Flapping": flapping("Moltres", "Articuno", "{L}"),
      "Frosty Flapping": flapping("Moltres", "Zapdos", "{W}"),
      "Lunar Cycle": LUNAR_CYCLE,
      "Flaring Magic": flaringMagic("{R}"),
    };
    for (const [name, , lock] of ABILITIES) {
      const text = printed[name] as string;
      expect([name, text.includes(`You can't use more than 1 ${name} Ability each turn.`)]).toEqual(
        [name, lock === "sharedByName"],
      );
      expect([name, text.includes("if this Pokémon is in the Active Spot")]).toEqual([
        name,
        abilityOf(ABILITIES.find(([n]) => n === name)?.[1][0] as string)?.activeOnly,
      ]);
    }
  });

  it("the draw engines: Run Errand, Alluring Wings, Lunar Cycle, Flaring Magic", () => {
    expect(abilityOf(KANGASKHAN[0])?.program).toEqual([{ op: "drawCards", count: 2 }]);
    expect(abilityOf(KANGASKHAN[0])?.playableIf).toBeUndefined();
    expect(abilityOf(FROSMOTH)?.program).toEqual([
      { op: "drawCards", count: 1, who: "eachPlayer" },
    ]);
    // Alluring Wings is Chandelure's "Alluring Light" program behind the Active Spot clause.
    expect(abilityOf(FROSMOTH)?.program).toEqual(programFor("sv06-038")?.abilities?.[0]?.program);
    expect(abilityOf(LUNATONE[0])?.playableIf).toEqual({
      kind: "yourNamedPokemonInPlay",
      name: "Solrock",
    });
    expect(abilityOf(LUNATONE[0])?.program).toEqual([
      {
        op: "payFromHand",
        count: 1,
        to: "discard",
        filter: { kind: "basicEnergy", energyType: "Fighting" },
      },
      { op: "drawCards", count: 3 },
    ]);
    expect(abilityOf(DELPHOX[0])?.playableIf).toBeUndefined();
    expect(abilityOf(DELPHOX[0])?.program).toEqual([
      {
        op: "payFromHand",
        count: 1,
        to: "discard",
        filter: { kind: "basicEnergy", energyType: "Fire" },
      },
      { op: "drawUntilHandSize", size: 7 },
    ]);
  });

  it("the Flapping trio: both partners by exact name, a Basic Energy of the printed type from the hand to itself", () => {
    for (const [id, partners, energyType] of [
      [MOLTRES[0], ["Articuno", "Zapdos"], "Fire"],
      [ZAPDOS[0], ["Moltres", "Articuno"], "Lightning"],
      [ARTICUNO[0], ["Moltres", "Zapdos"], "Water"],
    ] as const) {
      expect(abilityOf(id)?.playableIf, id).toEqual({
        kind: "allOf",
        conditions: partners.map((name) => ({ kind: "yourNamedPokemonInPlay", name })),
      });
      expect(abilityOf(id)?.program, id).toEqual([
        { op: "attachEnergyFrom", source: "hand", energyType, toSelf: true },
      ]);
    }
  });

  it("no printed attack is registry-keyed (each keeps deriving)", () => {
    for (const [, ids] of ABILITIES)
      for (const id of ids) expect(programFor(id)?.attack, id).toBeUndefined();
  });
});

// ── ON A BOARD ──

const FILLER = "d591-filler"; // a {C} Basic, 300 HP
const SOLROCK = "d591-solrock";
const ZAPDOS_EX = "d591-zapdos-ex";
const R = "d591-fire";
const L = "d591-lightning";
const W = "d591-water";
const F = "d591-fighting";

const body = (id: string, name: string, ability: string, text: string, over: Partial<Card>): Card =>
  battler(id, {
    name,
    retreat: 1,
    abilities: [{ type: "Ability", name: ability, effect: text }],
    ...over,
  } as Partial<Card>);

const kangaskhan = (id: string) =>
  body(id, "Mega Kangaskhan ex", "Run Errand", RUN_ERRAND, {
    hp: 300,
    types: ["Colorless"],
    attacks: [
      {
        cost: ["Colorless", "Colorless", "Colorless"],
        name: "Rapid-Fire Combo",
        damage: "200+",
        effect: "Flip a coin until you get tails. This attack does 50 more damage for each heads.",
      },
    ],
  });
const moltres = (id: string, energy: string) =>
  body(id, "Moltres", "Fiery Flapping", flapping("Articuno", "Zapdos", energy), {
    hp: 120,
    types: ["Fire"],
    attacks: [
      {
        cost: ["Fire", "Fire", "Colorless"],
        name: "Fire Spin",
        damage: 130,
        effect: "Discard 2 Energy from this Pokémon.",
      },
    ],
  });
const zapdos = (id: string, energy: string) =>
  body(id, "Zapdos", "Flash-Pop Flapping", flapping("Moltres", "Articuno", energy), {
    hp: 120,
    types: ["Lightning"],
    attacks: [
      {
        cost: ["Lightning", "Lightning", "Lightning", "Colorless"],
        name: "Thundering Lightning",
        damage: 210,
        effect: "This Pokémon also does 60 damage to itself.",
      },
    ],
  });
const articuno = (id: string, energy: string) =>
  body(id, "Articuno", "Frosty Flapping", flapping("Moltres", "Zapdos", energy), {
    hp: 120,
    types: ["Water"],
    attacks: [
      {
        cost: ["Water", "Water", "Colorless"],
        name: "Hail",
        effect:
          "This attack does 30 damage to each of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      },
    ],
  });
const lunatone = (id: string) =>
  body(id, "Lunatone", "Lunar Cycle", LUNAR_CYCLE, {
    hp: 110,
    types: ["Fighting"],
    attacks: [{ cost: ["Fighting", "Fighting"], name: "Power Gem", damage: 50 }],
  });
const delphox = (id: string, energy: string) =>
  body(id, "Delphox", "Flaring Magic", flaringMagic(energy), {
    stage: "Stage2",
    evolveFrom: "Braixen",
    hp: 160,
    types: ["Fire"],
    retreat: 2,
    attacks: [
      {
        cost: ["Fire", "Fire"],
        name: "Energized Storm",
        damage: "30×",
        effect: "This attack does 30 damage for each Energy attached to all Pokémon.",
      },
    ],
  });

const LOCAL: Record<string, Card> = {
  [KANGASKHAN[0]]: kangaskhan(KANGASKHAN[0]),
  [KANGASKHAN[3]]: kangaskhan(KANGASKHAN[3]),
  [FROSMOTH]: body(FROSMOTH, "Frosmoth", "Alluring Wings", ALLURING_WINGS, {
    stage: "Stage1",
    evolveFrom: "Snom",
    hp: 110,
    types: ["Water"],
    retreat: 2,
    attacks: [
      {
        cost: ["Water", "Water"],
        name: "Cold Cyclone",
        damage: 90,
        effect: "Move a {W} Energy from this Pokémon to 1 of your Benched Pokémon.",
      },
    ],
  }),
  [MOLTRES[0]]: moltres(MOLTRES[0], "{R}"),
  [MOLTRES[1]]: moltres(MOLTRES[1], "Fire"),
  [ZAPDOS[0]]: zapdos(ZAPDOS[0], "{L}"),
  [ZAPDOS[1]]: zapdos(ZAPDOS[1], "Lightning"),
  [ARTICUNO[0]]: articuno(ARTICUNO[0], "{W}"),
  [ARTICUNO[1]]: articuno(ARTICUNO[1], "Water"),
  [LUNATONE[0]]: lunatone(LUNATONE[0]),
  [LUNATONE[1]]: lunatone(LUNATONE[1]),
  [DELPHOX[0]]: delphox(DELPHOX[0], "{R}"),
  [DELPHOX[1]]: delphox(DELPHOX[1], "Fire"),
  [FILLER]: battler(FILLER, { name: "D591 Filler", hp: 300, types: ["Colorless"], retreat: 1 }),
  [SOLROCK]: battler(SOLROCK, { name: "Solrock", hp: 110, types: ["Fighting"], retreat: 1 }),
  [ZAPDOS_EX]: battler(ZAPDOS_EX, { name: "Zapdos ex", hp: 200, types: ["Lightning"], retreat: 1 }),
  [R]: typedEnergy(R, "Fire"),
  [L]: typedEnergy(L, "Lightning"),
  [W]: typedEnergy(W, "Water"),
  [F]: typedEnergy(F, "Fighting"),
};
const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL };
const DECK = deckOf({
  [KANGASKHAN[0]]: 1,
  [KANGASKHAN[3]]: 1,
  [FROSMOTH]: 1,
  [MOLTRES[0]]: 1,
  [MOLTRES[1]]: 1,
  [ZAPDOS[0]]: 1,
  [ZAPDOS[1]]: 1,
  [ARTICUNO[0]]: 1,
  [ARTICUNO[1]]: 1,
  [LUNATONE[0]]: 1,
  [LUNATONE[1]]: 1,
  [DELPHOX[0]]: 1,
  [DELPHOX[1]]: 1,
  [SOLROCK]: 1,
  [ZAPDOS_EX]: 1,
  [FILLER]: 12,
  [R]: 6,
  [L]: 6,
  [W]: 6,
  [F]: 6,
  "fix-energy": 9,
});

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

/** Setup (P2 first), then P1's turn 4; both hands back into the decks and the Prizes swapped out
    for deck filler, so every named card is findable (D590's `p1Turn`). */
function p1Turn(): GameState {
  const created = createGame({ seed: 5911, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(
    applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first: "p2" }),
  );
  while (state.phase.kind === "setup:drawExtra") {
    const phase = state.phase;
    const s = (["p1", "p2"] as const).find((x) => !phase.decided[x]);
    if (s === undefined) throw new Error("setup:drawExtra with every seat decided");
    state = must(applyAction(state, { type: "setupDrawExtra", seat: s, count: phase.owed[s] }));
  }
  for (const s of ["p1", "p2"] as const) {
    const uid = state.players[s].hand.find(
      (h) => POOL[state.cardIdByUid[h] ?? ""]?.stage === "Basic",
    );
    if (uid === undefined) throw new Error(`no Basic in ${s}'s hand`);
    state = must(applyAction(state, { type: "setupPlaceActive", seat: s, uid }));
  }
  for (const s of ["p1", "p2"] as const)
    state = must(applyAction(state, { type: "setupReady", seat: s }));
  state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
  state = must(applyAction(state, { type: "endTurn", seat: "p1" }));
  state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
  for (const s of ["p1", "p2"] as const) {
    const side = state.players[s];
    let deck = [...side.deck, ...side.hand];
    const prizes = side.prizes.map((u) => {
      if ([FILLER, "fix-energy"].includes(state.cardIdByUid[u] as string)) return u;
      const swap = deck.find((d) =>
        [FILLER, "fix-energy"].includes(state.cardIdByUid[d] as string),
      );
      if (swap === undefined) throw new Error("no swap card");
      deck = [...deck.filter((d) => d !== swap), u];
      return swap;
    });
    state = { ...state, players: { ...state.players, [s]: { ...side, hand: [], prizes, deck } } };
  }
  return state;
}

/** P1: `active` (a FILLER by default) and `bench`; P2: a FILLER; P1's hand is exactly `hand`. */
function table(opts: { active?: string; bench?: readonly string[]; hand: readonly string[] }) {
  let state = p1Turn();
  state = clearBench(setActiveFromDeck(state, "p1", opts.active ?? FILLER), "p1");
  state = clearBench(setActiveFromDeck(state, "p2", FILLER), "p2");
  for (const id of opts.bench ?? []) state = benchFromDeck(state, "p1", id);
  const side = state.players.p1;
  let deck = [...side.deck];
  const hand: string[] = [];
  for (const id of opts.hand) {
    const uid = deck.find((u) => state.cardIdByUid[u] === id);
    if (uid === undefined) throw new Error(`p1 deck has no ${id}`);
    hand.push(uid);
    deck = deck.filter((u) => u !== uid);
  }
  return { ...state, players: { ...state.players, p1: { ...side, hand, deck } } } as GameState;
}

const ACTIVE = { spot: "active" } as const;
const bench = (index: number) => ({ spot: "bench", index }) as const;
const use = (
  state: GameState,
  abilityName: string,
  target: typeof ACTIVE | ReturnType<typeof bench>,
  seat: Seat = "p1",
) => applyAction(state, { type: "useAbility", seat, target, abilityName } as GameAction);
const used = (
  state: GameState,
  abilityName: string,
  target: typeof ACTIVE | ReturnType<typeof bench>,
) => must(use(state, abilityName, target));
function refusal(result: ReturnType<typeof applyAction>): string {
  if (result.ok) throw new Error("expected a refusal");
  return result.error.code;
}
const ids = (state: GameState, uids: readonly string[]) => uids.map((u) => state.cardIdByUid[u]);
const energyOn = (state: GameState, p: InPlayPokemon | null | undefined) =>
  p === null || p === undefined ? [] : ids(state, p.energy);

describe("D591 §2 — Run Errand: draw 2 from the Active Spot, one Run Errand per turn", () => {
  it("the Active Kangaskhan draws 2 and stamps the NAME-keyed allowance", () => {
    const state = table({ active: KANGASKHAN[0], hand: [] });
    const deck = state.players.p1.deck.length;
    const after = used(state, "Run Errand", ACTIVE);
    expect(after.players.p1.hand).toHaveLength(2);
    expect(after.players.p1.deck).toHaveLength(deck - 2);
    expect(after.allowances.abilitiesUsed).toEqual(["*:Run Errand"]);
  });

  it("a Benched Kangaskhan is refused (the Active Spot clause)", () => {
    const state = table({ bench: [KANGASKHAN[0]], hand: [] });
    expect(refusal(use(state, "Run Errand", bench(0)))).toBe("ABILITY_ACTIVE_ONLY");
  });

  it("🛑 a SECOND Kangaskhan (another printing) switched into the Active Spot the same turn is refused", () => {
    let state = used(table({ active: KANGASKHAN[0], hand: [] }), "Run Errand", ACTIVE);
    state = setActiveFromDeck(state, "p1", KANGASKHAN[3]); // the first one is displaced to the Bench
    expect(state.cardIdByUid[state.players.p1.active?.stack.at(-1) ?? ""]).toBe(KANGASKHAN[3]);
    expect(refusal(use(state, "Run Errand", ACTIVE))).toBe("ABILITY_ALREADY_USED");
  });

  it("the refusal is the lock: the same second Kangaskhan draws on a fresh turn's board", () => {
    const state = table({ active: KANGASKHAN[3], hand: [] });
    expect(used(state, "Run Errand", ACTIVE).players.p1.hand).toHaveLength(2);
  });
});

describe("D591 §3 — Alluring Wings: each player draws a card, from the Active Spot", () => {
  it("both seats draw one, the controller first", () => {
    const state = table({ active: FROSMOTH, hand: [] });
    const result = use(state, "Alluring Wings", ACTIVE);
    if (!result.ok) throw new Error(result.error.code);
    expect(result.state.players.p1.hand).toHaveLength(1);
    expect(result.state.players.p2.hand).toHaveLength(1);
    const drawn = result.events
      .filter((e) => e.type === "CARDS_DRAWN")
      .map((e) => (e as { seat: Seat }).seat);
    expect(drawn).toEqual(["p1", "p2"]);
    expect(result.state.allowances.abilitiesUsed).toEqual([
      `${state.players.p1.active?.stack.at(-1)}:Alluring Wings`,
    ]);
  });

  it("from the Bench it is refused", () => {
    const state = table({ bench: [FROSMOTH], hand: [] });
    expect(refusal(use(state, "Alluring Wings", bench(0)))).toBe("ABILITY_ACTIVE_ONLY");
  });
});

/** [the printing, its `30th` copy, the Ability, partner A, partner B, own Energy, another Energy]. */
const TRIO = [
  [MOLTRES[0], MOLTRES[1], "Fiery Flapping", ARTICUNO[0], ZAPDOS[0], R, W],
  [ZAPDOS[0], ZAPDOS[1], "Flash-Pop Flapping", MOLTRES[0], ARTICUNO[0], L, R],
  [ARTICUNO[0], ARTICUNO[1], "Frosty Flapping", MOLTRES[0], ZAPDOS[0], W, L],
] as const;

describe("D591 §4 — the Flapping trio: both partners in play, a Basic Energy of the printed type to itself", () => {
  for (const [self, copy, name, a, b, own, other] of TRIO) {
    it(`${name}: partner A Active, partner B Benched — the Energy lands on the user, nothing asks`, () => {
      const state = table({ active: a, bench: [b, self], hand: [own, other] });
      const after = used(state, name, bench(1));
      expect(after.phase.kind).toBe("turn:action");
      expect(energyOn(after, after.players.p1.bench[1])).toEqual([own]);
      expect(energyOn(after, after.players.p1.bench[0])).toEqual([]);
      expect(energyOn(after, after.players.p1.active)).toEqual([]);
      expect(ids(after, after.players.p1.hand)).toEqual([other]);
    });

    it(`${name}: refused with one partner missing (and a "Zapdos ex" is not a Zapdos)`, () => {
      expect(refusal(use(table({ active: a, bench: [self], hand: [own] }), name, bench(0)))).toBe(
        "ABILITY_CONDITION_NOT_MET",
      );
      expect(refusal(use(table({ active: b, bench: [self], hand: [own] }), name, bench(0)))).toBe(
        "ABILITY_CONDITION_NOT_MET",
      );
      if ((b as string) === ZAPDOS[0]) {
        const state = table({ active: a, bench: [ZAPDOS_EX, self], hand: [own] });
        expect(refusal(use(state, name, bench(1)))).toBe("ABILITY_CONDITION_NOT_MET");
      }
    });

    it(`${name}: refused with only another type's Basic Energy in hand`, () => {
      const state = table({ active: a, bench: [b, self], hand: [other] });
      expect(refusal(use(state, name, bench(1)))).toBe("NO_LEGAL_TARGET");
    });

    it(`${name}: once per Pokémon — the same body is refused, its \`30th\` copy still attaches`, () => {
      let state = table({ active: a, bench: [b, self, copy], hand: [own, own] });
      state = used(state, name, bench(1));
      expect(refusal(use(state, name, bench(1)))).toBe("ABILITY_ALREADY_USED");
      state = used(state, name, bench(2));
      expect(energyOn(state, state.players.p1.bench[2])).toEqual([own]);
      expect(state.players.p1.hand).toEqual([]);
    });
  }
});

describe("D591 §5 — Lunar Cycle: Solrock in play, a Basic {F} Energy paid, draw 3, one Lunar Cycle per turn", () => {
  it("pays the {F} Energy and draws 3", () => {
    const state = table({ active: SOLROCK, bench: [LUNATONE[0]], hand: [F, R] });
    const deck = state.players.p1.deck.length;
    const after = used(state, "Lunar Cycle", bench(0));
    expect(after.phase.kind).toBe("turn:action");
    expect(ids(after, after.players.p1.discard)).toEqual([F]);
    expect(after.players.p1.hand).toHaveLength(1 + 3);
    expect(after.players.p1.deck).toHaveLength(deck - 3);
  });

  it("refused without Solrock, and without a Basic {F} Energy card in hand", () => {
    const noSolrock = table({ bench: [LUNATONE[0]], hand: [F] });
    expect(refusal(use(noSolrock, "Lunar Cycle", bench(0)))).toBe("ABILITY_CONDITION_NOT_MET");
    const noCost = table({ active: SOLROCK, bench: [LUNATONE[0]], hand: [R] });
    expect(refusal(use(noCost, "Lunar Cycle", bench(0)))).toBe("ABILITY_COST_UNMET");
  });

  it("🛑 a second Lunatone (another printing) is refused the same turn", () => {
    let state = table({ active: SOLROCK, bench: [LUNATONE[0], LUNATONE[1]], hand: [F, F] });
    state = used(state, "Lunar Cycle", bench(0));
    expect(state.allowances.abilitiesUsed).toEqual(["*:Lunar Cycle"]);
    expect(refusal(use(state, "Lunar Cycle", bench(1)))).toBe("ABILITY_ALREADY_USED");
  });
});

describe("D591 §6 — Flaring Magic: a Basic {R} Energy paid, draw until 7, once per Pokémon", () => {
  it("pays first, then draws to 7 (the hand after the payment)", () => {
    const state = table({ bench: [DELPHOX[0]], hand: [R, W, W] });
    const deck = state.players.p1.deck.length;
    const after = used(state, "Flaring Magic", bench(0));
    expect(ids(after, after.players.p1.discard)).toEqual([R]);
    expect(after.players.p1.hand).toHaveLength(7);
    expect(after.players.p1.deck).toHaveLength(deck - 5);
  });

  it("refused without a Basic {R} Energy card in hand", () => {
    const state = table({ bench: [DELPHOX[0]], hand: [W, L] });
    expect(refusal(use(state, "Flaring Magic", bench(0)))).toBe("ABILITY_COST_UNMET");
  });

  it("two Delphox are two uses; the same one twice is refused", () => {
    let state = table({ bench: [DELPHOX[0], DELPHOX[1]], hand: [R, R, W] });
    state = used(state, "Flaring Magic", bench(0));
    expect(state.players.p1.hand).toHaveLength(7);
    expect(refusal(use(state, "Flaring Magic", bench(0)))).toBe("ABILITY_ALREADY_USED");
    state = used(state, "Flaring Magic", bench(1));
    expect(ids(state, state.players.p1.discard)).toEqual([R, R]);
    expect(state.players.p1.hand).toHaveLength(7);
  });
});

describe("D591 §7 — the printed attacks these keys carry, and the version", () => {
  it("the attacks left unbuilt are Delphox's, Frosmoth's and the `30th` Hail's markup — five printings (🆕🆕🆕 D607: Delphox's is built — WP28a; three left; 🆕🆕🆕 D612: Hail's is built — WP06; one left; 🆕🆕🆕 D615: Frosmoth's is built — WP31a; none left)", () => {
    const me = new Map(meAttackCorpus().map(([n, text]) => [text, n]));
    expect(me.get("This attack does 30 damage for each Energy attached to all Pokémon.")).toBe(2);
    expect(me.get("Move a {W} Energy from this Pokémon to 1 of your Benched Pokémon.")).toBe(1);
    // 🆕🆕🆕 D612 — the `<em>` is normalised away (WP06): the two `30th` Hail printings join the clean
    // sentence's row (1 → 3), which a reader builds.
    expect(
      me.get(
        "This attack does 30 damage to each of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      ),
    ).toBe(3);
  });

  it("is built at engine 0.543.0", () => {
    expect(engineVersion).toBe("0.543.0");
  });
});
