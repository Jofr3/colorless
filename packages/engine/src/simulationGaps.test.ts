import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { legalAttackCorpus } from "./censusAttackCorpus";
import { meAttackCorpus } from "./censusAttackCorpusMe";
import { applyAction, programFor, simulationGaps } from "./index";
import type { GameState } from "./index";
import {
  FIXTURE_POOL,
  attachFromDeck,
  basicEnergy,
  battler,
  clearBench,
  deckOf,
  driveSetup,
  itemTrainer,
  mustApply,
  programmedCardIds,
  setActiveFromDeck,
  specialEnergy,
  trainerCard,
} from "./testFixtures";

const ability = {
  type: "Ability",
  name: "Probe Ability",
  effect: "Once during your turn, you may draw a card.",
};

/** Attack texts no reader claims, taken from Expanded-only printings. */
const UNSIMULATED_ATTACKS = [
  "This attack does 30 damage for each Energy attached to both Active Pokémon.",
  "Put 2 Energy attached to this Pokémon into your hand.",
  "Both Active Pokémon are now Poisoned.",
  "This attack does 10 damage for each {P} Pokémon in your discard pile.",
];

/** A requirement split off, leaving a sentence no effect reader claims; the second is itself a
    requirement, which plays nothing once a clause was split. */
const SPLIT_UNSIMULATED = [
  "If this Pokémon didn't move from the Bench to the Active Spot this turn, this attack does nothing. Both Active Pokémon are now Poisoned.",
  "If this Pokémon didn't move from the Bench to the Active Spot this turn, this attack does nothing. If your opponent's Active Pokémon has no damage counters on it before this attack does damage, this attack does nothing.",
];

const probe = (effect?: string): Card =>
  battler("gap-probe", {
    hp: 300,
    attacks: [
      {
        cost: ["Colorless"],
        name: "Probe",
        damage: 10,
        ...(effect === undefined ? {} : { effect }),
      },
    ],
  });

describe("simulationGaps — what a card prints that the engine cannot play", () => {
  it("flags a Trainer with no program, by the path that plays it", () => {
    expect(simulationGaps(itemTrainer("gap-item"))).toEqual(["trainer"]);
    expect(simulationGaps(trainerCard("gap-supporter", "Supporter", "Draw 2 cards."))).toEqual([
      "trainer",
    ]);
    expect(simulationGaps(trainerCard("gap-stadium", "Stadium", "Each player draws."))).toEqual([
      "trainer",
    ]);
    expect(simulationGaps(trainerCard("gap-tool", "Pokémon Tool", "Rules."))).toEqual(["trainer"]);
    expect(simulationGaps(trainerCard("gap-tool", "Tool", "Rules."))).toEqual(["trainer"]);
  });

  it("passes a Trainer the registry plays, a reprint of one, and an Antique Fossil", () => {
    expect(simulationGaps(trainerCard("sv01-181", "Item", "Nest Ball."))).toEqual([]);
    expect(simulationGaps(trainerCard("sv01-190", "Supporter", "Draw 7."))).toEqual([]);
    expect(simulationGaps(trainerCard("sv01-191", "Item", "Rare Candy."))).toEqual([]);
    const fossil = { ...trainerCard("sv07-129", "Item", "Fossil."), abilities: [ability] };
    expect(simulationGaps(fossil)).toEqual([]);
  });

  it("flags an Ability only when the card has no program beyond its attacks", () => {
    expect(simulationGaps(battler("gap-ability", { abilities: [ability] }))).toEqual(["ability"]);
    expect(simulationGaps(battler("sv02-150", { abilities: [ability] }))).toEqual([]);
    expect(simulationGaps(battler("gap-plain"))).toEqual([]);
  });

  it("flags a Special Energy with no program, including one tagged Normal that prints rules", () => {
    expect(simulationGaps(specialEnergy("gap-energy", "Gap Energy", "Rules."))).toEqual([
      "specialEnergy",
    ]);
    expect(simulationGaps({ ...basicEnergy("gap-tagged"), effect: "Rules." })).toEqual([
      "specialEnergy",
    ]);
    expect(simulationGaps(specialEnergy("sv02-190", "Jet Energy", "Rules."))).toEqual([]);
    expect(simulationGaps(basicEnergy("gap-basic"))).toEqual([]);
  });

  it("flags an attack whose text no reader claims, and passes an authored or derived one", () => {
    expect(simulationGaps(probe())).toEqual([]);
    expect(simulationGaps(probe("Draw a card."))).toEqual([]);
    for (const text of [...UNSIMULATED_ATTACKS, ...SPLIT_UNSIMULATED])
      expect(simulationGaps(probe(text)), text).toEqual(["attack"]);
    const authoredId = programmedCardIds().find((id) => programFor(id)?.attack?.[0] !== undefined);
    expect(authoredId).toBeDefined();
    const text = UNSIMULATED_ATTACKS[0];
    expect(simulationGaps({ ...probe(text), id: authoredId ?? "" })).toEqual([]);
  });

  it("lists every gap a card has, in a fixed order", () => {
    const card = { ...probe(UNSIMULATED_ATTACKS[0]), abilities: [ability] };
    expect(simulationGaps(card)).toEqual(["ability", "attack"]);
  });

  it("flags an Energy the ingest left with no tag and no text, which plays as {C} (COR-P0E)", () => {
    // me06-132/-133/-134 as the catalog stores them: energy_type and effect both NULL.
    for (const [id, name] of [
      ["me06-132", "Bubbly Water Energy"],
      ["me06-133", "Growing Grass Energy"],
      ["me06-134", "Nitro Fire Energy"],
    ] as const) {
      const card: Card = { ...basicEnergy(id), name, energyType: null, effect: null };
      expect(simulationGaps(card), id).toEqual(["specialEnergy"]);
    }
  });

  it("flags a Pokémon the engine cannot put into play as printed (COR-P0E)", () => {
    // Greninja BREAK and Mew VMAX: an evolving stage with no evolveFrom.
    expect(
      simulationGaps(battler("30th-c-009", { name: "Greninja BREAK", stage: "BREAK" })),
    ).toEqual(["play"]);
    expect(simulationGaps(battler("30th-c-026", { name: "Mew VMAX", stage: "VMAX" }))).toEqual([
      "play",
    ]);
    // Dark Tyranitar evolves from a card the catalog does not print.
    const tyranitar = battler("30th-c-006", {
      name: "Dark Tyranitar",
      stage: "Stage2",
      evolveFrom: "Dark Pupitar",
    });
    expect(simulationGaps(tyranitar)).toEqual(["play"]);
    // A LEGEND half and an M Pokémon-EX stored as a Basic.
    for (const id of ["30th-c-019", "30th-c-020"]) {
      expect(simulationGaps(battler(id, { name: "Darkrai & Cresselia LEGEND" })), id).toEqual([
        "play",
      ]);
    }
    expect(simulationGaps(battler("30th-c-023", { name: "M Gardevoir EX" }))).toEqual(["play"]);
    // Controls: a Pokémon-EX Basic, a reachable evolution and a Basic.
    expect(simulationGaps(battler("30th-c-004", { name: "Genesect EX" }))).toEqual([]);
    const evolution = battler("gap-stage1", { stage: "Stage1", evolveFrom: "Fixmon" });
    expect(simulationGaps(evolution)).toEqual([]);
    expect(simulationGaps({ ...evolution, id: "gap-stage2", stage: "Stage2" })).toEqual([]);
    expect(simulationGaps(battler("gap-plain"))).toEqual([]);
  });
});

describe("simulationGaps agrees with the attack the engine runs", () => {
  const POOL: Record<string, Card> = { ...FIXTURE_POOL, "gap-probe": probe() };
  const DECK = deckOf({ "gap-probe": 4, "fix-bigbody": 4, "fix-energy": 52 });

  /** P1's turn: the probe Active with one Energy, facing a 200-HP body. */
  function board(): GameState {
    let state = driveSetup(7, { p1: DECK, p2: DECK }, { pool: POOL, first: "p2" });
    state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
    state = setActiveFromDeck(state, "p1", "gap-probe");
    state = clearBench(state, "p1");
    state = attachFromDeck(state, "p1", "fix-energy", 1);
    state = setActiveFromDeck(state, "p2", "fix-bigbody");
    return clearBench(state, "p2");
  }

  it("flags exactly the attack texts the engine reports as skipped", () => {
    const start = board();
    const texts = [
      ...UNSIMULATED_ATTACKS,
      "Draw a card.",
      ...legalAttackCorpus().map(([, text]) => text),
      ...meAttackCorpus().map(([, text]) => text),
    ];
    const disagree: string[] = [];
    let ran = 0;
    let skipped = 0;
    for (const text of texts) {
      const card = probe(text);
      const result = applyAction(
        { ...start, cardPool: { ...start.cardPool, "gap-probe": card } },
        { type: "attack", seat: "p1", index: 0 },
      );
      if (!result.ok) continue;
      ran++;
      const engineSkips = result.events.some(
        (e) => e.type === "ATTACK_EFFECT_SKIPPED" && e.effect !== null,
      );
      if (engineSkips) skipped++;
      if (engineSkips !== simulationGaps(card).includes("attack")) disagree.push(text);
    }
    expect(disagree).toEqual([]);
    expect(skipped).toBeGreaterThanOrEqual(UNSIMULATED_ATTACKS.length);
    expect(ran).toBeGreaterThan(texts.length / 2);
  });
});
