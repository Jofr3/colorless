import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import { meAttackCorpus } from "./censusAttackCorpusMe";
import { deriveAttackDamageMultiplier, deriveAttackDamagePenalty, deriveAttackEffect } from "./effects";
import type { GameAction, GameEvent, GameState, Seat } from "./index";
import { applyAction, createGame, engineVersion } from "./index";
import {
  FIXTURE_POOL,
  attachBenchFromDeck,
  attachFromDeck,
  attachToolFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  handFromDeck,
  itemTrainer,
  mustApply,
  setActiveFromDeck,
  setBenchDamage,
  setDamage,
  typedEnergy,
} from "./testFixtures";

// ── 🆕🆕🆕 D607 — WP28a: THE FIRST HALF OF THE SCALING COUNT SOURCES ──────────────────────────────
//
// 8 printed attack texts / 14 `me` printings, all attacks, no registry key. Three NEW nullary
// `DamageCountSource` members, one evaluator arm each — `energyInPlayBothSides` (Delphox ×2),
// `toolsInPlayBothSides` (Bronzong), `basicEnergyTypesOnYourBoard` (Sylveon ex ×3) — and four texts on
// SHIPPED members: Beedrill ex ×2 and Paldean Tauros (`pokemonInPlay`, two new body-map keys), Raticate
// ×2 (`damageCountersOnYourBench`, the "Rattata" key on a widened anchor), Tinkaton (`energyOnOpponent`
// on the penalty fold) and Beautifly ×2 (`cardsInOpponentHand`, the comma-joined reveal and an
// "Energy card" noun). Every id and text off the LOCAL D1, 2026-10-08, `legal_standard = 1`; no id
// was referenced in the tree before this slice (Delphox's two carry an Ability key since D591).

const ENERGIZED_STORM = "This attack does 30 damage for each Energy attached to all Pokémon.";
const TOOL_DROP = "This attack does 40 damage for each Pokémon Tool attached to all Pokémon.";
const COLORFUL_HARMONY = "This attack does 50 damage for each type of Basic Energy attached to all of your Pokémon.";
const RUMBLING_BEES = "This attack does 110 damage for each of your Beedrill and Beedrill ex in play.";
const RAGING_CHARGE =
  'This attack does 40 damage for each of your Pokémon that has "Tauros" in its name that has any damage counters on it.';
const INCISORS = "This attack does 40 damage for each damage counter on all of your Benched Rattata.";
const WINDUP_SWING = "This attack does 60 less damage for each Energy attached to your opponent's Active Pokémon.";
const ENERGY_STRAW =
  "Your opponent reveals their hand, and this attack does 80 damage for each Energy card you find there.";

/** [attack text, the `me` printing ids that print it]. */
const SENTENCES: readonly (readonly [string, readonly string[]])[] = [
  [ENERGIZED_STORM, ["mep-074", "me04-013"]],
  [TOOL_DROP, ["me02-072"]],
  [COLORFUL_HARMONY, ["mep-100", "30th-071", "30th-153"]],
  [RUMBLING_BEES, ["me04-003", "me04-098"]],
  [RAGING_CHARGE, ["me02-048"]],
  [INCISORS, ["me03-061", "me03-099"]],
  [WINDUP_SWING, ["me01-098"]],
  [ENERGY_STRAW, ["me02.5-013", "me02.5-219"]],
];

/** WP28's other half (WP28b), named: each needs vocabulary beyond this slice. [🆕🆕🆕 D623 (D539): five are built at D623 — Kyogre, Igglybuff, Pikachu, Armarouge ×2, Gourgeist ex ×2; Doublade ×3 and Okidogi are dropped and named there.] */
const WP28B: readonly (readonly [string, number])[] = [
  [
    "Reveal any number of Honedge, Doublade, and Aegislash from your hand, and this attack does 60 damage for each card you revealed in this way.",
    3,
  ],
  ["This attack does 20 damage for each Basic {W} Energy card in your discard pile. Then, shuffle those cards into your deck.", 1],
  ["This attack does 30 damage for each of your Benched Pokémon that has a maximum HP of 30.", 1],
  // 🆕🆕🆕 D612 — the `<em>` is normalised away (WP06); the clean sentence is still unread. [🆕🆕🆕 D623 (D539): WITHDRAWN — Pika Chain is read at D623, on the body-map key "Pikachu and Pikachu ex".]
  ["This attack does 40 damage for each of your Pikachu and Pikachu ex in play.", 1],
  ["This attack does 40 more damage for each of your Benched Pokémon that has any {R} Energy attached.", 2],
  ["This attack does 50 more damage for each of your Benched Pokémon that has any damage counters on it.", 2],
  ["This attack does 60 more damage for each Prize card your opponent took during their last turn.", 1],
];

describe("D607 §1 — the texts: 8 attack sentences / 14 printings", () => {
  it("each is a row of the committed `me` corpus at its printing count, none printed in legal `sv`, each now read", () => {
    const me = new Map(meAttackCorpus().map(([n, text]) => [text, n]));
    const sv = new Set(legalAttackCorpus().map(([, text]) => text));
    for (const [text, ids] of SENTENCES) {
      expect([text, me.get(text)]).toEqual([text, ids.length]);
      expect(sv.has(text), text).toBe(false);
      expect(resolvedByAnyReader(text), text).toBe(true);
    }
    expect(SENTENCES.flatMap(([, ids]) => ids)).toHaveLength(14);
  });

  it("WP28b stays unbuilt: 7 texts / 11 printings, named (🆕🆕🆕 D623 (D539): WITHDRAWN — five are built at D623; Doublade ×3 and Okidogi stay unbuilt)", () => {
    const me = new Map(meAttackCorpus().map(([n, text]) => [text, n]));
    // 🆕🆕🆕 D623 — the two texts still unread; the other five are `scalingCountsMeD623.test.ts`'s.
    const stillUnbuilt = new Set([WP28B[0]?.[0], WP28B[6]?.[0]]);
    for (const [text, n] of WP28B) {
      expect([text, me.get(text)]).toEqual([text, n]);
      expect(resolvedByAnyReader(text), text).toBe(!stillUnbuilt.has(text));
    }
    expect(WP28B.reduce((sum, [, n]) => sum + n, 0)).toBe(11);
  });
});

describe("D607 §2 — the readings", () => {
  it("three new members, each on its own literal `×` anchor", () => {
    expect(deriveAttackDamageMultiplier(ENERGIZED_STORM)).toEqual({ per: 30, count: { kind: "energyInPlayBothSides" } });
    expect(deriveAttackDamageMultiplier(TOOL_DROP)).toEqual({ per: 40, count: { kind: "toolsInPlayBothSides" } });
    expect(deriveAttackDamageMultiplier(COLORFUL_HARMONY)).toEqual({
      per: 50,
      count: { kind: "basicEnergyTypesOnYourBoard" },
    });
    // The "of your" siblings keep their shipped one-board members.
    expect(
      deriveAttackDamageMultiplier("This attack does 40 damage for each Pokémon Tool attached to all of your Pokémon."),
    ).toEqual({ per: 40, count: { kind: "toolsOnYourBoard" } });
    expect(deriveAttackDamageMultiplier("This attack does 30 damage for each Energy attached to all of your Pokémon.")).toEqual({
      per: 30,
      count: { kind: "energyOnSelf", zone: "board", energyType: null },
    });
    // The printed-zero guard on each.
    for (const zero of [
      "This attack does 0 damage for each Energy attached to all Pokémon.",
      "This attack does 0 damage for each Pokémon Tool attached to all Pokémon.",
      "This attack does 0 damage for each type of Basic Energy attached to all of your Pokémon.",
    ]) {
      expect(deriveAttackDamageMultiplier(zero), zero).toBeNull();
    }
  });

  it("four texts on shipped members", () => {
    expect(deriveAttackDamageMultiplier(RUMBLING_BEES)).toEqual({
      per: 110,
      count: {
        kind: "pokemonInPlay",
        seat: "you",
        filter: {
          kind: "anyOf",
          filters: [
            { kind: "byName", name: "Beedrill" },
            { kind: "byName", name: "Beedrill ex" },
          ],
        },
      },
    });
    expect(deriveAttackDamageMultiplier(RAGING_CHARGE)).toEqual({
      per: 40,
      count: {
        kind: "pokemonInPlay",
        seat: "you",
        filter: { kind: "pokemonNameContaining", fragment: "Tauros" },
        damagedOnly: true,
      },
    });
    expect(deriveAttackDamageMultiplier(INCISORS)).toEqual({
      per: 40,
      count: { kind: "damageCountersOnYourBench", filter: { kind: "byName", name: "Rattata" } },
    });
    expect(deriveAttackDamagePenalty(WINDUP_SWING)).toEqual({
      per: 60,
      count: { kind: "energyOnOpponent", zone: "active", energyType: null },
    });
    expect(deriveAttackDamageMultiplier(WINDUP_SWING)).toBeNull();
    expect(deriveAttackDamageMultiplier(ENERGY_STRAW)).toEqual({
      per: 80,
      count: { kind: "cardsInOpponentHand", filter: { kind: "anyEnergy" } },
    });
    expect(deriveAttackEffect(ENERGY_STRAW)).toEqual([{ op: "revealOpponentHand" }]);
  });

  it("the widened anchors keep their old readings and their old refusals", () => {
    // The bare "Benched Pokémon." stays on the unfiltered member.
    expect(
      deriveAttackDamageMultiplier("This attack does 10 damage for each damage counter on all of your Benched Pokémon."),
    ).toEqual({ per: 10, count: { kind: "damageCountersOnYourBench" } });
    // An unmapped bench noun is still refused.
    expect(
      deriveAttackDamageMultiplier("This attack does 10 damage for each damage counter on all of your Benched Raticate."),
    ).toBeNull();
    // The period-joined reveal still reads (the `sv` Trainer-card row).
    expect(
      deriveAttackDamageMultiplier(
        "Your opponent reveals their hand. This attack does 50 damage for each Trainer card you find there.",
      ),
    ).toEqual({ per: 50, count: { kind: "cardsInOpponentHand", filter: { kind: "trainerCard" } } });
    // An unmapped hand noun refuses BOTH halves (no reveal without its fold).
    const unmapped = "Your opponent reveals their hand, and this attack does 80 damage for each Item card you find there.";
    expect(deriveAttackDamageMultiplier(unmapped)).toBeNull();
    expect(deriveAttackEffect(unmapped)).toBeNull();
  });
});

// ── ON A BOARD ──

const FILLER = "d607-filler";
const TOOL = "d607-tool";
const MEGA_BEEDRILL = "d607-mega-beedrill";
const BEEDRILL = "d607-beedrill";
const RATTATA = "d607-rattata";
const TAUROS = "d607-tauros";
const FIRE = "d607-fire";
const WATER = "d607-water";
const PSY = "d607-psychic";
const GRASS = "d607-grass";
const METAL = "d607-metal";
const FIGHT = "d607-fighting";

const mon = (id: string, name: string, hp: number, type: string, attacks: Card["attacks"], extra: Partial<Card> = {}) =>
  battler(id, { name, hp, types: [type], retreat: 2, attacks, ...extra });
const TAP: Card["attacks"] = [{ cost: ["Colorless"], name: "Tap", damage: 10 }];

const LOCAL: Record<string, Card> = {
  "me04-013": mon(
    "me04-013",
    "Delphox",
    160,
    "Fire",
    [{ cost: ["Fire", "Fire"], name: "Energized Storm", damage: "30×", effect: ENERGIZED_STORM }],
    { stage: "Stage2", evolveFrom: "Braixen" },
  ),
  "me02-072": mon(
    "me02-072",
    "Bronzong",
    140,
    "Metal",
    [
      { cost: ["Colorless"], name: "Triple Draw", effect: "Draw 3 cards." },
      { cost: ["Colorless", "Colorless", "Colorless"], name: "Tool Drop", damage: "40×", effect: TOOL_DROP },
    ],
    { stage: "Stage1", evolveFrom: "Bronzor" },
  ),
  "mep-100": mon(
    "mep-100",
    "Sylveon ex",
    270,
    "Psychic",
    [{ cost: ["Psychic", "Colorless", "Colorless"], name: "Colorful Harmony", damage: "50×", effect: COLORFUL_HARMONY }],
    { stage: "Stage1", evolveFrom: "Eevee" },
  ),
  "me04-003": mon(
    "me04-003",
    "Beedrill ex",
    310,
    "Grass",
    [{ cost: ["Grass"], name: "Rumbling Bees", damage: "110×", effect: RUMBLING_BEES }],
    { stage: "Stage2", evolveFrom: "Kakuna" },
  ),
  "me02-048": mon("me02-048", "Paldean Tauros", 130, "Fighting", [
    { cost: ["Fighting"], name: "Raging Charge", damage: "40×", effect: RAGING_CHARGE },
    { cost: ["Fighting", "Fighting"], name: "Double-Edge", damage: 70, effect: "This Pokémon also does 20 damage to itself." },
  ]),
  "me03-061": mon(
    "me03-061",
    "Raticate",
    90,
    "Colorless",
    [
      {
        cost: ["Colorless"],
        name: "Scrape Off",
        damage: 20,
        effect: "Before doing damage, discard all Pokémon Tools from your opponent's Active Pokémon.",
      },
      { cost: ["Colorless"], name: "Retaliatory Incisors", damage: "40×", effect: INCISORS },
    ],
    { stage: "Stage1", evolveFrom: "Rattata" },
  ),
  "me01-098": mon(
    "me01-098",
    "Tinkaton",
    160,
    "Metal",
    [{ cost: ["Metal"], name: "Windup Swing", damage: "240-", effect: WINDUP_SWING }],
    { stage: "Stage2", evolveFrom: "Tinkatuff" },
  ),
  "me02.5-013": mon(
    "me02.5-013",
    "Beautifly",
    130,
    "Grass",
    [
      { cost: ["Grass"], name: "Stun Spore", damage: 40, effect: "Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed." },
      { cost: ["Grass"], name: "Energy Straw", damage: "80×", effect: ENERGY_STRAW },
    ],
    { stage: "Stage2", evolveFrom: "Silcoon" },
  ),
  [FILLER]: mon(FILLER, "D607 Filler", 400, "Colorless", TAP),
  [MEGA_BEEDRILL]: mon(MEGA_BEEDRILL, "Mega Beedrill ex", 350, "Grass", TAP, { stage: "Stage2", evolveFrom: "Kakuna" }),
  [BEEDRILL]: mon(BEEDRILL, "Beedrill", 140, "Grass", TAP, { stage: "Stage2", evolveFrom: "Kakuna" }),
  [RATTATA]: mon(RATTATA, "Rattata", 60, "Colorless", TAP),
  [TAUROS]: mon(TAUROS, "Tauros", 130, "Colorless", TAP),
  [TOOL]: { ...itemTrainer(TOOL), trainerType: "Tool", name: "D607 Tool" },
  [FIRE]: typedEnergy(FIRE, "Fire"),
  [WATER]: typedEnergy(WATER, "Water"),
  [PSY]: typedEnergy(PSY, "Psychic"),
  [GRASS]: typedEnergy(GRASS, "Grass"),
  [METAL]: typedEnergy(METAL, "Metal"),
  [FIGHT]: typedEnergy(FIGHT, "Fighting"),
};
const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL };
const DECK = deckOf({
  "me04-013": 1,
  "me02-072": 1,
  "mep-100": 1,
  "me04-003": 1,
  "me02-048": 2,
  "me03-061": 2,
  "me01-098": 1,
  "me02.5-013": 1,
  [FILLER]: 6,
  [MEGA_BEEDRILL]: 1,
  [BEEDRILL]: 2,
  [RATTATA]: 2,
  [TAUROS]: 1,
  [TOOL]: 4,
  [FIRE]: 4,
  [WATER]: 3,
  [PSY]: 3,
  [GRASS]: 3,
  [METAL]: 3,
  [FIGHT]: 2,
  "fix-blend": 1,
  "fix-energy": 15,
});
const BOARD_IDS = new Set([...Object.keys(LOCAL).filter((id) => id !== FILLER), "fix-blend"]);

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

/** Setup, then P1's own FIRST turn (P2 went first and passed); both hands back into the decks. */
function p1Turn(): GameState {
  const created = createGame({ seed: 6070, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
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

/** P1's Active is `attacker` with `energy` attached; P2's Active is a Filler. Both Benches empty. */
function table(attacker: string, energy: readonly (readonly [string, number])[]): GameState {
  let state = p1Turn();
  for (const s of ["p1", "p2"] as const) state = unprize(clearBench(setActiveFromDeck(state, s, FILLER), s), s);
  state = clearBench(setActiveFromDeck(state, "p1", attacker), "p1");
  for (const [id, n] of energy) state = attachFromDeck(state, "p1", id, n);
  return state;
}

const attack = (index: number, seat: Seat = "p1"): GameAction => ({ type: "attack", seat, index });
const of = <T extends GameEvent["type"]>(events: readonly GameEvent[], type: T) =>
  events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
const dealtRows = (state: GameState, index: number) => of(mustApply(state, attack(index)).events, "DAMAGE_DEALT");
const dealt = (state: GameState, index: number) => dealtRows(state, index)[0]?.dealt;

describe("D607 §3 — the three new members on a board", () => {
  it("Energized Storm counts every Energy card on BOTH boards: 2 + 1 (yours) + 2 (theirs) = 5 → 150", () => {
    let state = table("me04-013", [[FIRE, 2]]);
    state = attachBenchFromDeck(benchFromDeck(state, "p1", FILLER), "p1", 0, WATER, 1);
    expect(dealt(state, 0)).toBe(90); // own board only: 3
    state = attachFromDeck(state, "p2", "fix-energy", 1);
    state = attachBenchFromDeck(benchFromDeck(state, "p2", FILLER), "p2", 0, "fix-blend", 1);
    expect(dealt(state, 0)).toBe(150);
  });

  it("Tool Drop counts every Tool on BOTH boards: 1 (yours) + 2 (theirs) = 3 → 120; none → no DAMAGE_DEALT", () => {
    const bare = table("me02-072", [["fix-energy", 3]]);
    expect(dealtRows(bare, 1)).toEqual([]);
    let state = attachToolFromDeck(bare, "p1", "active", TOOL);
    expect(dealt(state, 1)).toBe(40);
    state = attachToolFromDeck(state, "p2", "active", TOOL);
    state = attachToolFromDeck(benchFromDeck(state, "p2", FILLER), "p2", 0, TOOL);
    expect(dealt(state, 1)).toBe(120);
  });

  it("Colorful Harmony counts DIFFERENT Basic Energy types on YOUR board only", () => {
    // {P} ×2 on the Active: one type.
    let state = table("mep-100", [[PSY, 2], ["fix-energy", 1]]);
    expect(dealt(state, 0)).toBe(50);
    // A Special providing Fire and Water, and an unparsed Basic (Colorless), add no type.
    state = attachFromDeck(state, "p1", "fix-blend", 1);
    expect(dealt(state, 0)).toBe(50);
    // A Benched {R} and a second {P}: two types.
    state = attachBenchFromDeck(benchFromDeck(state, "p1", FILLER), "p1", 0, FIRE, 1);
    state = attachBenchFromDeck(state, "p1", 0, PSY, 1);
    expect(dealt(state, 0)).toBe(100);
    // The opponent's {G} and {M} are not "your Pokémon".
    state = attachFromDeck(state, "p2", GRASS, 1);
    state = attachFromDeck(state, "p2", METAL, 1);
    expect(dealt(state, 0)).toBe(100);
    // A second Benched body with {W}: three.
    state = attachBenchFromDeck(benchFromDeck(state, "p1", FILLER), "p1", 1, WATER, 1);
    expect(dealt(state, 0)).toBe(150);
  });
});

describe("D607 §4 — the four texts on shipped members, on a board", () => {
  it("Rumbling Bees counts YOUR Beedrill and Beedrill ex by exact name — not Mega Beedrill ex, not theirs", () => {
    let state = table("me04-003", [[GRASS, 1]]);
    expect(dealt(state, 0)).toBe(110); // itself
    state = benchFromDeck(state, "p1", BEEDRILL);
    state = benchFromDeck(state, "p1", MEGA_BEEDRILL);
    state = benchFromDeck(state, "p2", BEEDRILL);
    expect(dealt(state, 0)).toBe(220);
  });

  it("Raging Charge counts YOUR damaged Pokémon with \"Tauros\" in the name", () => {
    let state = table("me02-048", [[FIGHT, 1]]);
    expect(dealtRows(state, 0)).toEqual([]); // undamaged itself: 0
    state = setDamage(state, "p1", 10);
    state = setBenchDamage(benchFromDeck(state, "p1", TAUROS), "p1", 0, 20); // a damaged plain "Tauros"
    state = benchFromDeck(state, "p1", "me02-048"); // undamaged
    state = setBenchDamage(benchFromDeck(state, "p1", RATTATA), "p1", 2, 30); // damaged, no "Tauros"
    state = setBenchDamage(benchFromDeck(state, "p2", TAUROS), "p2", 0, 30); // theirs
    expect(dealt(state, 0)).toBe(80);
  });

  it("Retaliatory Incisors counts the counters on YOUR Benched Rattata only", () => {
    let state = table("me03-061", [["fix-energy", 1]]);
    state = setDamage(state, "p1", 50); // the Active's own counters are not Benched Rattata
    state = setBenchDamage(benchFromDeck(state, "p1", RATTATA), "p1", 0, 30);
    state = setBenchDamage(benchFromDeck(state, "p1", RATTATA), "p1", 1, 20);
    state = setBenchDamage(benchFromDeck(state, "p1", "me03-061"), "p1", 2, 40); // a Raticate
    state = setBenchDamage(benchFromDeck(state, "p2", RATTATA), "p2", 0, 30); // theirs
    expect(dealt(state, 1)).toBe(200);
  });

  it("Windup Swing does 60 less for each Energy on THEIR Active: 240 → 120 → 0", () => {
    let state = table("me01-098", [[METAL, 3]]);
    expect(dealt(state, 0)).toBe(240); // your own Energy is not counted
    state = attachFromDeck(state, "p2", "fix-energy", 2);
    state = attachBenchFromDeck(benchFromDeck(state, "p2", FILLER), "p2", 0, FIRE, 2); // Benched: not counted
    expect(dealt(state, 0)).toBe(120);
    state = attachFromDeck(state, "p2", "fix-energy", 3);
    expect(dealtRows(state, 0).map((r) => r.dealt).reduce((a, b) => a + b, 0)).toBe(0);
    expect(mustApply(state, attack(0)).state.players.p2.active?.damage).toBe(0);
  });

  it("Energy Straw reveals the opponent's hand and counts every Energy card in it", () => {
    let state = table("me02.5-013", [[GRASS, 1]]);
    let out = mustApply(state, attack(1));
    expect(of(out.events, "DAMAGE_DEALT")).toEqual([]);
    expect(of(out.events, "HAND_REVEALED")[0]?.seat).toBe("p2");
    state = handFromDeck(state, "p2", FIRE, 1);
    state = handFromDeck(state, "p2", "fix-blend", 1);
    state = handFromDeck(state, "p2", "fix-energy", 1);
    state = handFromDeck(state, "p2", FILLER, 1);
    out = mustApply(state, attack(1));
    expect(of(out.events, "DAMAGE_DEALT")[0]?.dealt).toBe(240);
    expect(of(out.events, "HAND_REVEALED")[0]?.uids).toHaveLength(4);
  });
});

describe("D607 §5 — the version", () => {
  it("the engine version moved with the behaviour", () => {
    expect(engineVersion).toBe("0.506.0");
  });
});
