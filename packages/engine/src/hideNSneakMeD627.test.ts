import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import { meAttackCorpus } from "./censusAttackCorpusMe";
import { passivesOf } from "./continuous";
import { deriveAttackDamageBonus, deriveAttackEffect, normaliseMeWording } from "./effects";
import type { GameAction, GameEvent, GameState, PokemonRef, Seat } from "./index";
import { applyAction, createGame, engineVersion } from "./index";
import { conditionHolds, conditionNote } from "./interpreter";
import { programFor } from "./registry";
import {
  FIXTURE_POOL,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  deepFreeze,
  discardFromDeck,
  itemTrainer,
  setActiveFromDeck,
  setBenchDamage,
  setDamage,
  typedEnergy,
} from "./testFixtures";

// ── 🆕🆕🆕 D627 — H1: THE HIDE 'N' SNEAK ARCHETYPE ─────────────────────────────────────────────────────
//
// 4 `me` Pokémon print the Ability "Hide 'n' Sneak" (Poltchageist `me05-005`, Sinistcha `me05-006`, Shuppet
// `me05-033`, Banette `me05-034`), and four attack texts read it (LOCAL D1, 2026-10-10, `legal_standard = 1`):
//
//   Hide 'n' Sneak ×4   — one registry object, `passive { preventAttackEffects, preventAbilityEffects }` (both shipped).
//   Vengeful Anchor ×3  — Dhelmise `mep-084`, `me05-039` / `-091`: +140 behind the NEW `BoardCondition`
//                         `yourDiscardPokemonWithAbilityNamedAtLeast` at 4 (a `CONDITIONAL_DAMAGE_CLAUSES` row).
//   Matcha Spin         — Sinistcha: the member at 6, a `conditionGate` around arm 23e's counter fold.
//   Furtive Drop        — Poltchageist: the singular "Place 1 damage counter on your opponent's Active Pokémon."
//   Spiritual End       — Spiritomb `me05-035`: the member at 13, then D530's `perDamageCounterOnTarget` on a
//                         2-pick placement (3 more per counter: the quadruple). R-SPE1 ⚠️ UNRULED.
//
// R-HNS1 ⚠️ UNRULED: the count reads the PRINTED Ability names on the Pokémon faces in your discard pile; a
// Trainer face (an Antique fossil) never counts; no in-play Ability lock reaches a discarded card.

const HIDE_N_SNEAK =
  "Prevent all effects of your opponent's Pokémon's attacks and Abilities done to this Pokémon. (Damage is not an effect.)";
const VENGEFUL_ANCHOR =
  "If you have 4 or more Pokémon that have the Hide 'n' Sneak Ability in your discard pile, this attack does 140 more damage.";
const MATCHA_SPIN =
  "If you have 6 or more Pokémon that have the Hide 'n' Sneak Ability in your discard pile, place 4 damage counters on each of your opponent's Pokémon.";
const FURTIVE_DROP = "Place 1 damage counter on your opponent's Active Pokémon.";
const SPIRITUAL_END =
  "If you have 13 or more Pokémon that have the Hide 'n' Sneak Ability in your discard pile, choose 2 of your opponent's Pokémon and quadruple the number of damage counters on each of them.";
const PHANTOM_DIVE = "Put 6 damage counters on your opponent's Benched Pokémon in any way you like.";

const HOLDERS = ["me05-005", "me05-006", "me05-033", "me05-034"] as const;
const SENTENCES: readonly (readonly [string, readonly string[]])[] = [
  [VENGEFUL_ANCHOR, ["mep-084", "me05-039", "me05-091"]],
  [MATCHA_SPIN, ["me05-006"]],
  [FURTIVE_DROP, ["me05-005"]],
  [SPIRITUAL_END, ["me05-035"]],
];

const gate = (count: number) =>
  ({ kind: "yourDiscardPokemonWithAbilityNamedAtLeast", ability: "Hide 'n' Sneak", count }) as const;

describe("D627 §1 — the texts and the program", () => {
  it("4 attack sentences / 6 printings, each a row of the committed `me` corpus, none in legal `sv`, each now read", () => {
    const me = new Map(meAttackCorpus().map(([n, text]) => [text, n]));
    const sv = new Set(legalAttackCorpus().map(([, text]) => text));
    for (const [text, ids] of SENTENCES) {
      expect([text, me.get(text)]).toEqual([text, ids.length]);
      expect(sv.has(text), text).toBe(false);
      expect(resolvedByAnyReader(text), text).toBe(true);
    }
    expect(SENTENCES.flatMap(([, ids]) => ids)).toHaveLength(6);
    for (const id of ["mep-084", "me05-039", "me05-091", "me05-035"]) expect(programFor(id), id).toBeUndefined();
  });

  it("the four Hide 'n' Sneak ids are ONE passive object with both shields", () => {
    for (const id of HOLDERS) {
      expect(programFor(id), id).toEqual({ passive: { preventAttackEffects: true, preventAbilityEffects: true } });
      expect(programFor(id), id).toBe(programFor(HOLDERS[0]));
    }
  });
});

describe("D627 §2 — the readings", () => {
  it("Vengeful Anchor: +140 behind the member at 4", () => {
    expect(deriveAttackDamageBonus(VENGEFUL_ANCHOR)).toEqual({ per: 140, count: { kind: "boardCondition", cond: gate(4) } });
    // A threshold no row prints stays unread (literal rows, not a template).
    expect(deriveAttackDamageBonus(VENGEFUL_ANCHOR.replace("4 or more", "5 or more"))).toBeNull();
    // The curly apostrophe is folded by the clause lookup.
    expect(deriveAttackDamageBonus(VENGEFUL_ANCHOR.replaceAll("'", "’"))).toEqual(deriveAttackDamageBonus(VENGEFUL_ANCHOR));
  });

  it("Matcha Spin: a gate at 6 around the opponent-side counter fold", () => {
    expect(deriveAttackEffect(MATCHA_SPIN)).toEqual([
      {
        op: "conditionGate",
        cond: gate(6),
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect gate's step list, not a thenable.
        then: [{ op: "counterEachAll", amount: 40, filter: { kind: "anyPokemon" }, side: "opponent", source: "attack" }],
      },
    ]);
    expect(deriveAttackEffect(MATCHA_SPIN.replace("6 or more", "7 or more"))).toBeNull();
    expect(deriveAttackEffect(MATCHA_SPIN.replace("your opponent's Pokémon.", "your Pokémon."))).toBeNull();
    expect(deriveAttackEffect(MATCHA_SPIN.replace("place 4", "place 0"))).toBeNull();
  });

  it("Spiritual End: a gate at 13 around a 2-pick placement of 3 more per counter", () => {
    expect(deriveAttackEffect(SPIRITUAL_END)).toEqual([
      {
        op: "conditionGate",
        cond: gate(13),
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect gate's step list, not a thenable.
        then: [
          { op: "damageChosen", target: "opponentAny", amount: 30, count: 2, source: "attack", perDamageCounterOnTarget: true },
        ],
      },
    ]);
    expect(deriveAttackEffect(SPIRITUAL_END.replace("quadruple", "triple"))).toBeNull();
    expect(deriveAttackEffect(SPIRITUAL_END.replace("13 or more", "12 or more"))).toBeNull();
  });

  it("Furtive Drop: the singular put on the Active, number agreement kept; the plural unchanged", () => {
    expect(normaliseMeWording(FURTIVE_DROP)).toBe("Put 1 damage counter on your opponent's Active Pokémon.");
    expect(deriveAttackEffect(FURTIVE_DROP)).toEqual([{ op: "damageActive", amount: 10, source: "attack" }]);
    expect(deriveAttackEffect("Put 3 damage counters on your opponent's Active Pokémon.")).toEqual([
      { op: "damageActive", amount: 30, source: "attack" },
    ]);
    expect(deriveAttackEffect("Put 2 damage counter on your opponent's Active Pokémon.")).toBeNull();
    expect(deriveAttackEffect("Put 1 damage counters on your opponent's Active Pokémon.")).toEqual([
      { op: "damageActive", amount: 10, source: "attack" },
    ]);
    expect(deriveAttackEffect("Put 0 damage counters on your opponent's Active Pokémon.")).toBeNull();
  });

  it("the note is the printed clause", () => {
    expect(conditionNote(gate(4))).toBe(
      "you have 4 or more Pokémon that have the Hide 'n' Sneak Ability in your discard pile",
    );
  });
});

// ── ON A BOARD ──

const POLT = "me05-005";
const SINI = "me05-006";
const SHUP = "me05-033";
const BAN = "me05-034";
const SPIRIT = "me05-035";
const DHEL = "me05-039";
const DRAG = "d627-phantom-diver";
const DUSKNOIR = "sv06.5-020"; // "Cursed Blast" — 13 counters on 1 of the opponent's Pokémon (an Ability)
const FLUTTER = "sv05-078"; // "Midnight Fluttering" — the opponent's Active has no Abilities
const FOSSIL = "d627-fossil"; // a Trainer face printing the Ability (an Antique fossil's shape)
const CURLY = "d627-curly"; // a Pokémon face printing the name with U+2019
const FILLER = "d627-filler";
const WEAK = "d627-weak";
const P = "d627-psychic";

const hns = [{ type: "Ability", name: "Hide 'n' Sneak", effect: HIDE_N_SNEAK }];
const mon = (id: string, over: Partial<Card>): Card => battler(id, { types: ["Psychic"], ...over } as Partial<Card>);
const LOCAL: Record<string, Card> = {
  [POLT]: mon(POLT, {
    name: "Poltchageist",
    hp: 30,
    types: ["Grass"],
    abilities: hns,
    attacks: [{ name: "Furtive Drop", cost: ["Colorless"], effect: FURTIVE_DROP }],
  } as Partial<Card>),
  [SINI]: mon(SINI, {
    name: "Sinistcha",
    hp: 60,
    types: ["Grass"],
    stage: "Stage1",
    evolveFrom: "Poltchageist",
    abilities: hns,
    attacks: [{ name: "Matcha Spin", cost: ["Colorless"], effect: MATCHA_SPIN }],
  } as Partial<Card>),
  [SHUP]: mon(SHUP, {
    name: "Shuppet",
    hp: 50,
    abilities: hns,
    attacks: [{ name: "Hang Down", cost: ["Psychic"], damage: 10 }],
  } as Partial<Card>),
  [BAN]: mon(BAN, {
    name: "Banette",
    hp: 80,
    stage: "Stage1",
    evolveFrom: "Shuppet",
    abilities: hns,
    attacks: [
      {
        name: "Puppet Pull",
        cost: ["Psychic"],
        damage: 80,
        effect: "You may search your deck for a card and put it into your hand. Then, shuffle your deck.",
      },
    ],
  } as Partial<Card>),
  [SPIRIT]: mon(SPIRIT, {
    name: "Spiritomb",
    hp: 60,
    attacks: [{ name: "Spiritual End", cost: ["Psychic"], effect: SPIRITUAL_END }],
  } as Partial<Card>),
  [DHEL]: mon(DHEL, {
    name: "Dhelmise",
    hp: 140,
    attacks: [{ name: "Vengeful Anchor", cost: ["Psychic"], damage: "30+", effect: VENGEFUL_ANCHOR }],
  } as Partial<Card>),
  [DRAG]: mon(DRAG, {
    name: "D627 Phantom Diver",
    hp: 320,
    attacks: [{ name: "Phantom Dive", cost: ["Colorless"], damage: 200, effect: PHANTOM_DIVE }],
  } as Partial<Card>),
  [DUSKNOIR]: mon(DUSKNOIR, {
    name: "Dusknoir",
    stage: "Stage2",
    hp: 160,
    retreat: 3,
    abilities: [
      {
        type: "Ability",
        name: "Cursed Blast",
        effect:
          "Once during your turn, you may put 13 damage counters on 1 of your opponent's Pokémon. If you use this Ability, this Pokémon is Knocked Out.",
      },
    ],
  } as Partial<Card>),
  [FLUTTER]: mon(FLUTTER, {
    name: "Flutter Mane",
    hp: 90,
    abilities: [
      {
        type: "Ability",
        name: "Midnight Fluttering",
        effect:
          "As long as this Pokémon is in the Active Spot, your opponent's Active Pokémon has no Abilities, except for Midnight Fluttering.",
      },
    ],
    attacks: [{ name: "Furtive Drop", cost: ["Colorless"], effect: FURTIVE_DROP }],
  } as Partial<Card>),
  [FOSSIL]: { ...itemTrainer(FOSSIL), name: "D627 Fossil", abilities: hns } as Card,
  [CURLY]: mon(CURLY, {
    name: "D627 Curly",
    abilities: [{ type: "Ability", name: "Hide ’n’ Sneak", effect: HIDE_N_SNEAK }],
  } as Partial<Card>),
  [FILLER]: mon(FILLER, { name: "D627 Filler", hp: 400, types: ["Colorless"] } as Partial<Card>),
  [WEAK]: mon(WEAK, {
    name: "D627 Weak",
    hp: 400,
    types: ["Colorless"],
    weaknesses: [{ type: "Psychic", value: "×2" }],
  } as Partial<Card>),
  [P]: typedEnergy(P, "Psychic"),
};
const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL };
const DECK = deckOf({
  [POLT]: 6,
  [SINI]: 2,
  [SHUP]: 8,
  [BAN]: 2,
  [SPIRIT]: 1,
  [DHEL]: 1,
  [DRAG]: 1,
  [DUSKNOIR]: 1,
  [FLUTTER]: 1,
  [FOSSIL]: 2,
  [CURLY]: 1,
  [FILLER]: 6,
  [WEAK]: 1,
  [P]: 27,
});
const BOARD_IDS = new Set(Object.keys(LOCAL).filter((id) => id !== P));

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}
function run(state: GameState, action: GameAction): { state: GameState; events: GameEvent[] } {
  const result = applyAction(deepFreeze(state), action);
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return { state: result.state, events: result.events };
}

/** Setup with p2 first; P1's own first turn, both hands back into the decks, board cards out of the Prizes. */
function p1Turn(): GameState {
  const created = createGame({ seed: 6271, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
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
    let deck = [...side.deck, ...side.hand];
    const prizes = side.prizes.map((u) => {
      if (!BOARD_IDS.has(state.cardIdByUid[u] ?? "")) return u;
      const swap = deck.find((d) => !BOARD_IDS.has(state.cardIdByUid[d] ?? ""));
      if (swap === undefined) throw new Error("no swap card");
      deck = [...deck.filter((d) => d !== swap), u];
      return swap;
    });
    state = { ...state, players: { ...state.players, [s]: { ...side, hand: [], prizes, deck } } };
  }
  return state;
}

/** Both boards from the deck (`[active, ...bench]` per seat), `energy` Psychic on P1's Active, and P1's
    discard pile seeded from its deck. */
function table(
  p1: readonly string[],
  p2: readonly string[],
  discard: readonly (readonly [string, number])[] = [],
  energy = 1,
): GameState {
  let state = p1Turn();
  for (const [seat, ids] of [
    ["p1", p1],
    ["p2", p2],
  ] as const) {
    state = clearBench(setActiveFromDeck(state, seat, ids[0] as string), seat);
    for (const id of ids.slice(1)) state = benchFromDeck(state, seat, id);
  }
  for (const [id, n] of discard) state = discardFromDeck(state, "p1", id, n);
  return attachFromDeck(state, "p1", P, energy);
}

const attack = (index = 0): GameAction => ({ type: "attack", seat: "p1", index });
const of = <T extends GameEvent["type"]>(events: readonly GameEvent[], type: T) =>
  events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
const damages = (state: GameState, seat: Seat = "p2") => [
  state.players[seat].active?.damage ?? -1,
  ...state.players[seat].bench.map((b) => b.damage),
];
const prevented = (state: GameState, events: readonly GameEvent[], type: "ATTACK_EFFECT_PREVENTED" | "ABILITY_EFFECT_PREVENTED") =>
  of(events, type).map((e) => [e.seat, state.cardIdByUid[e.uid]]);
const bench = (index: number, seat: Seat = "p2"): PokemonRef => ({ seat, spot: { spot: "bench", index } });
const ACTIVE: PokemonRef = { seat: "p2", spot: { spot: "active" } };

describe("D627 §3 — the count (R-HNS1)", () => {
  const holds = (discard: readonly (readonly [string, number])[], count: number) =>
    conditionHolds(table([FILLER], [FILLER], discard), "p1", gate(count));

  it("counts each Pokémon face in YOUR pile that prints the Ability; `>=`", () => {
    expect(holds([[SHUP, 3]], 4)).toBe(false);
    expect(holds([[SHUP, 4]], 4)).toBe(true);
    expect(holds([[SHUP, 2], [POLT, 2], [BAN, 1]], 5)).toBe(true);
    expect(holds([[SHUP, 8], [POLT, 5]], 13)).toBe(true);
    expect(holds([[SHUP, 8], [POLT, 4]], 13)).toBe(false);
  });

  it("a Trainer face printing the Ability, another Ability and a non-Ability Pokémon never count", () => {
    expect(holds([[SHUP, 3], [FOSSIL, 2]], 4)).toBe(false);
    expect(holds([[SHUP, 3], [DUSKNOIR, 1], [SPIRIT, 1], [P, 3]], 4)).toBe(false);
  });

  it("a printed curly apostrophe is folded", () => {
    expect(holds([[SHUP, 3], [CURLY, 1]], 4)).toBe(true);
  });

  it("the OPPONENT's pile does not count", () => {
    let state = table([FILLER], [FILLER]);
    state = discardFromDeck(state, "p2", SHUP, 6);
    expect(conditionHolds(state, "p1", gate(4))).toBe(false);
    expect(conditionHolds(state, "p2", gate(4))).toBe(true);
  });

  it("an Ability lock on the board does not change the count (no discarded card is in play)", () => {
    const state = table([FLUTTER], [SHUP], [[SHUP, 4]]);
    expect(conditionHolds(state, "p1", gate(4))).toBe(true);
  });
});

describe("D627 §4 — Hide 'n' Sneak: attack and Ability effects refused, damage lands", () => {
  it("the fold sets both shields on the holder", () => {
    const state = table([FILLER], [SHUP]);
    const fold = passivesOf(state, state.players.p2.active as NonNullable<GameState["players"]["p2"]["active"]>);
    expect([fold.preventAttackEffects, fold.preventAbilityEffects]).toEqual([true, true]);
  });

  it("Furtive Drop on an Active holder places nothing, announced; on a Filler it places 1", () => {
    const shielded = run(table([POLT], [SHUP]), attack());
    expect(damages(shielded.state)).toEqual([0]);
    expect(prevented(shielded.state, shielded.events, "ATTACK_EFFECT_PREVENTED")).toEqual([["p2", SHUP]]);
    const open = run(table([POLT], [FILLER]), attack());
    expect(damages(open.state)).toEqual([10]);
    expect(of(open.events, "COUNTERS_PLACED").map((e) => e.amount)).toEqual([10]);
  });

  it("damage is not an effect: Hang Down and Vengeful Anchor's 30 land on a holder", () => {
    expect(damages(run(table([SHUP], [BAN]), attack()).state)).toEqual([10]);
    expect(damages(run(table([DHEL], [SINI]), attack()).state)).toEqual([30]);
  });

  it("Phantom Dive's placed counters on a Benched holder are refused, a row each; the other body takes its share", () => {
    let { state, events } = run(table([DRAG], [FILLER, SHUP, FILLER]), attack());
    for (let pick = 0; state.phase.kind === "effect:choose"; pick++) {
      const next = run(state, {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "pokemonMulti", refs: [bench(pick % 2)] },
      } as GameAction);
      state = next.state;
      events = [...events, ...next.events];
    }
    expect(damages(state)).toEqual([200, 0, 30]);
    expect(prevented(state, events, "ATTACK_EFFECT_PREVENTED")).toEqual([
      ["p2", SHUP],
      ["p2", SHUP],
      ["p2", SHUP],
    ]);
  });

  it("an opponent's Ability effect is refused: Cursed Blast is forced onto the other body", () => {
    const state = table([FILLER, DUSKNOIR], [SHUP, FILLER]);
    const result = run(state, {
      type: "useAbility",
      seat: "p1",
      target: { spot: "bench", index: 0 },
      abilityName: "Cursed Blast",
    } as GameAction);
    expect(result.state.phase.kind).not.toBe("effect:choose");
    expect(damages(result.state)).toEqual([0, 130]);
    expect(prevented(result.state, result.events, "ABILITY_EFFECT_PREVENTED")).toEqual([["p2", SHUP]]);
  });

  it("R-LW2 inherited: under Midnight Fluttering the Active holder has no Ability, so Furtive Drop lands", () => {
    const locked = run(table([FLUTTER], [SHUP]), attack());
    expect(damages(locked.state)).toEqual([10]);
    expect(of(locked.events, "ATTACK_EFFECT_PREVENTED")).toEqual([]);
  });
});

describe("D627 §5 — Vengeful Anchor: +140 at 4 or more", () => {
  it("3 in the pile: 30; 4: 170", () => {
    expect(damages(run(table([DHEL], [FILLER], [[SHUP, 3]]), attack()).state)).toEqual([30]);
    expect(damages(run(table([DHEL], [FILLER], [[SHUP, 3], [POLT, 1]]), attack()).state)).toEqual([170]);
  });

  it("the bonus is before Weakness: 170 × 2 against a {P}-weak Active", () => {
    expect(damages(run(table([DHEL], [WEAK], [[SHUP, 4]]), attack()).state)).toEqual([340]);
  });

  it("two fossils beside 3 holders do not pay it", () => {
    expect(damages(run(table([DHEL], [FILLER], [[SHUP, 3], [FOSSIL, 2]]), attack()).state)).toEqual([30]);
  });
});

describe("D627 §6 — Matcha Spin: 4 counters on each of the opponent's Pokémon at 6 or more", () => {
  it("5 in the pile: nothing", () => {
    const result = run(table([SINI], [FILLER, FILLER], [[SHUP, 5]]), attack());
    expect(damages(result.state)).toEqual([0, 0]);
    expect(of(result.events, "COUNTERS_PLACED")).toEqual([]);
  });

  it("6: 40 on each body — placed, no Weakness — and a holder refuses its share", () => {
    const result = run(table([SINI], [WEAK, SHUP, FILLER], [[SHUP, 4], [POLT, 2]]), attack());
    expect(damages(result.state)).toEqual([40, 0, 40]);
    expect(prevented(result.state, result.events, "ATTACK_EFFECT_PREVENTED")).toEqual([["p2", SHUP]]);
    expect(damages(result.state, "p1")).toEqual([0]);
  });
});

describe("D627 §7 — Spiritual End: quadruple the counters on 2 of the opponent's Pokémon at 13 or more (R-SPE1)", () => {
  const THIRTEEN: readonly (readonly [string, number])[] = [
    [SHUP, 8],
    [POLT, 5],
  ];
  const loaded = (state: GameState) => setBenchDamage(setBenchDamage(setDamage(state, "p2", 30), "p2", 0, 20), "p2", 1, 10);

  it("12 in the pile: nothing", () => {
    const result = run(loaded(table([SPIRIT], [FILLER, FILLER, FILLER], [[SHUP, 8], [POLT, 4]])), attack());
    expect(result.state.phase.kind).not.toBe("effect:choose");
    expect(damages(result.state)).toEqual([30, 20, 10]);
  });

  it("13 with 3 bodies: the pick parks for exactly 2, captioned in counters, and each chosen body quadruples", () => {
    const parked = run(loaded(table([SPIRIT], [WEAK, FILLER, FILLER], THIRTEEN)), attack());
    if (parked.state.phase.kind !== "effect:choose") throw new Error("expected a park");
    const prompt = parked.state.phase.prompt as unknown as { kind: string; min: number; max: number; note: string };
    expect([prompt.kind, prompt.min, prompt.max]).toEqual(["choosePokemonMulti", 2, 2]);
    expect(prompt.note).toBe("Choose 2 of your opponent's Pokémon (3 damage counters for each damage counter on it).");
    const done = run(parked.state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [ACTIVE, bench(1)] },
    } as GameAction);
    // 30 → 120 on the {P}-weak Active (placed: no Weakness), 10 → 40; the unpicked 20 stays.
    expect(damages(done.state)).toEqual([120, 20, 40]);
    expect(of(done.events, "COUNTERS_PLACED").map((e) => e.amount)).toEqual([90, 30]);
  });

  it("with 2 bodies or fewer every body is taken, no prompt; an undamaged body takes nothing", () => {
    let state = setBenchDamage(setDamage(table([SPIRIT], [FILLER, FILLER], THIRTEEN), "p2", 0), "p2", 0, 50);
    const result = run(state, attack());
    expect(result.state.phase.kind).not.toBe("effect:choose");
    expect(damages(result.state)).toEqual([0, 200]);
    state = table([SPIRIT], [FILLER], THIRTEEN);
    expect(damages(run(setDamage(state, "p2", 20), attack()).state)).toEqual([80]);
  });

  it("an effects shield refuses the placement: a Hide 'n' Sneak holder keeps its counters", () => {
    const state = setBenchDamage(setDamage(table([SPIRIT], [FILLER, SHUP], THIRTEEN), "p2", 10), "p2", 0, 20);
    const result = run(state, attack());
    expect(damages(result.state)).toEqual([40, 20]);
    expect(prevented(result.state, result.events, "ATTACK_EFFECT_PREVENTED")).toEqual([["p2", SHUP]]);
  });
});

describe("D627 §8 — the version", () => {
  it("the engine version moved with the behaviour", () => {
    expect(engineVersion).toBe("0.541.0");
  });
});
