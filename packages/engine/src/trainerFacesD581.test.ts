import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { attacksOf, hasPrintedAbility, hpOf, matchesFilter } from "./cards";
import { CATALOG_MANIFEST as M } from "./catalogManifest";
import { FOSSIL_IDS, fossilPokemonCard } from "./fossils";
import { programFor } from "./registry";
import { battler, trainerCard } from "./testFixtures";

const COVER = "sv07-129";
const TM = "sv08-188";
const CORE_MEMORY = "me03-070";

function catalogRow(id: string, trainerType: string): Card {
  const face = M.trainerFaces[id];
  if (face === undefined) throw new Error(`no catalog face for ${id}`);
  return {
    ...trainerCard(id, trainerType, "D581 — the rule text is not under test here."),
    name: face.name,
    hp: face.hp,
    abilities: face.abilities,
    attacks: face.attacks,
  };
}

describe("D581 §1 — the catalog's Trainer faces, measured", () => {
  it("20 Trainer rows print a face: 12 an HP, 11 an Ability, 8 an attack", () => {
    const faces = Object.values(M.trainerFaces);
    expect(faces).toHaveLength(20);
    expect(faces.filter((f) => f.hp !== null)).toHaveLength(12);
    expect(faces.filter((f) => (f.abilities ?? []).length > 0)).toHaveLength(11);
    expect(faces.filter((f) => (f.attacks ?? []).length > 0)).toHaveLength(8);
  });

  it("the Standard-legal ones are the four BUILT fossils, TM Fluorite, and five UNBUILT `me` faces ( D620 (D539): four — Core Memory is built at D620) ( D637 (D539): none — the four `me` fossils are built at D637)", () => {
    const legal = Object.entries(M.trainerFaces)
      .filter(([, f]) => f.legal)
      .map(([id]) => id)
      .sort();
    expect(legal).toEqual([
      "me03-068",
      "me03-069",
      "me03-070",
      "me05-072",
      "me05-073",
      "sv07-129",
      "sv07-130",
      "sv08-188",
      "sv10.5b-080",
      "sv10.5w-079",
    ]);
    for (const id of legal) {
      const built = true;
      expect(programFor(id) !== undefined, id).toBe(built || id === CORE_MEMORY);
      // A 60-HP face is a fossil's, and it is a `FOSSIL_IDS` id; Core Memory (no HP) is not.
      expect(FOSSIL_IDS.has(id), id).toBe(M.trainerFaces[id]?.hp === 60);
    }
  });
});

describe("D581 §2 — `attacksOf` asks the category: a Tool's printed attack is not a Pokémon's", () => {
  it("a Technical Machine's catalog row carries its attack, and `attacksOf` reads none off it", () => {
    const tm = catalogRow(TM, "Tool");
    expect(tm.attacks?.map((a) => a.name)).toEqual(["Fluorite"]);
    expect(attacksOf(tm)).toEqual([]);
    expect(attacksOf(catalogRow(CORE_MEMORY, "Tool"))).toEqual([]);
    // A Pokémon's printed list is untouched.
    const body = battler("d581t-body", { attacks: [{ cost: [], name: "Fluorite", damage: 10 }] });
    expect(attacksOf(body).map((a) => a.name)).toEqual(["Fluorite"]);
  });

  it("the `attackNamePokemon` filter finds the Pokémon that prints the attack, never the machine", () => {
    const filter = { kind: "attackNamePokemon", attack: "Fluorite" } as const;
    expect(matchesFilter(catalogRow(TM, "Tool"), filter)).toBe(false);
    expect(
      matchesFilter(
        battler("d581t-body", { attacks: [{ cost: [], name: "Fluorite", damage: 10 }] }),
        filter,
      ),
    ).toBe(true);
  });
});

describe("D581 §3 — `hasPrintedAbility` asks the category: a fossil in the hand is an Item", () => {
  it("the fossil Item carries its catalog Ability and does NOT have one; its in-play face does", () => {
    const item = catalogRow(COVER, "Item");
    expect(item.abilities?.map((a) => a.name)).toEqual(["Protective Cover"]);
    expect(hasPrintedAbility(item)).toBe(false);
    expect(hasPrintedAbility(fossilPokemonCard(item))).toBe(true);
    expect(hasPrintedAbility(undefined)).toBe(false);
  });

  it("the `abilityPokemon` filter (Potent Glare's noun) does not find the fossil in the hand or the deck", () => {
    const filter = { kind: "abilityPokemon" } as const;
    const item = catalogRow(COVER, "Item");
    expect(matchesFilter(item, filter)).toBe(false);
    expect(matchesFilter(fossilPokemonCard(item), filter)).toBe(true);
  });
});

describe("D581 §4 — `hpOf` asks the category: a Trainer's printed HP is not a Pokémon's", () => {
  it("a fossil Item and Snorlax Doll carry their catalog HP and `hpOf` reads null; the in-play face reads 60", () => {
    const item = catalogRow(COVER, "Item");
    expect(item.hp).toBe(60);
    expect(hpOf(item)).toBeNull();
    expect(hpOf(fossilPokemonCard(item))).toBe(60);
    const doll = catalogRow("sv04-175", "Item");
    expect(doll.hp).toBe(120);
    expect(hpOf(doll)).toBeNull();
    // A Pokémon's printed HP is untouched.
    expect(hpOf(battler("d581t-hp", { hp: 70 }))).toBe(70);
  });
});
