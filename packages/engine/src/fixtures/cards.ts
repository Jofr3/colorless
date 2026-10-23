import type { Card } from "@colorless/schema";
import { CATALOG_MANIFEST } from "../catalogManifest";

export const blank: Omit<Card, "id" | "name" | "category"> = {
  setId: "fix",
  localId: "0",
  image: null,
  illustrator: null,
  rarity: null,
  regulationMark: null,
  hp: null,
  stage: null,
  evolveFrom: null,
  types: null,
  retreat: null,
  abilities: null,
  attacks: null,
  weaknesses: null,
  resistances: null,
  trainerType: null,
  energyType: null,
  effect: null,
  legal: { standard: true, expanded: true },
  variants: null,
};

export function basicPokemon(id: string, retreat: number): Card {
  return {
    ...blank,
    id,
    name: id,
    category: "Pokemon",
    stage: "Basic",
    hp: 60,
    types: ["Colorless"],
    retreat,
  };
}

export function basicEnergy(id: string): Card {
  return { ...blank, id, name: id, category: "Energy", energyType: "Normal" };
}

export function typedEnergy(id: string, type: string): Card {
  return { ...blank, id, name: `${type} Energy`, category: "Energy", energyType: "Normal" };
}

export function itemTrainer(id: string): Card {
  return { ...blank, id, name: id, category: "Trainer", trainerType: "Item" };
}

export function specialEnergy(id: string, name: string, effect?: string): Card {
  return {
    ...blank,
    id,
    name,
    category: "Energy",
    energyType: "Special",
    ...(effect === undefined ? {} : { effect }),
  };
}

/** A Trainer of a given type. Used with the REAL catalog ids the M4 registry
    authors (sv01-189, …) so `programFor(id)` finds the program — the `effect`
    text is cosmetic here (the registry keys on the id, not the text). */
export function trainerCard(id: string, trainerType: string, effect: string): Card {
  return { ...blank, id, name: id, category: "Trainer", trainerType, effect };
}

function printedTypesOf(id: string): string[] {
  return CATALOG_MANIFEST.printed[id]?.types ?? ["Colorless"];
}

export function battler(id: string, overrides: Partial<Card> = {}): Card {
  return {
    ...blank,
    id,
    name: id,
    category: "Pokemon",
    stage: "Basic",
    hp: 60,
    types: printedTypesOf(id),
    retreat: 1,
    ...overrides,
  };
}
