import { describe, expect, it } from "vitest";
import {
  energyProvidesOf,
  hpOf,
  parseAttackDamage,
  pokemonSuffixOf,
  prizeValueOf,
  resistanceOf,
  weaknessOf,
} from "./index";
import { basicEnergy, battler, typedEnergy } from "./testFixtures";

// Unit coverage for the card accessors' PARSERS — the name/value formats the
// catalog actually contains (the integration suites pin the same rules
// through full attacks in attack.test.ts).

describe("energyProvidesOf (§6.3)", () => {
  it("derives the type from the name, tolerating the 'Basic ' prefix", () => {
    expect(energyProvidesOf(typedEnergy("e", "Fire"))).toBe("Fire");
    // Real prints spell it both ways: sv06.5-098/099 are "Basic Darkness
    // Energy" / "Basic Metal Energy" (energyType "Normal", types NULL) — a
    // greedy parse would capture "Basic Darkness" and demote it to Colorless,
    // leaving typed costs permanently unpayable.
    expect(
      energyProvidesOf({ ...typedEnergy("e", "Darkness"), name: "Basic Darkness Energy" }),
    ).toBe("Darkness");
    expect(energyProvidesOf({ ...typedEnergy("e", "Metal"), name: "Basic Metal Energy" })).toBe(
      "Metal",
    );
  });

  it("knows the retired Fairy type — its prints are still in the pool", () => {
    expect(energyProvidesOf(typedEnergy("e", "Fairy"))).toBe("Fairy");
  });

  it("falls back to Colorless for special energy and unknown names", () => {
    expect(energyProvidesOf(basicEnergy("fix-energy"))).toBe("Colorless"); // no " Energy" suffix
    expect(energyProvidesOf({ ...typedEnergy("e", "Fire"), energyType: "Special" })).toBe(
      "Colorless",
    );
    expect(energyProvidesOf(typedEnergy("e", "Rainbow"))).toBe("Colorless"); // not a basic type
    // No Basic Dragon Energy exists (§6.1) — the vocabulary excludes it.
    expect(energyProvidesOf(typedEnergy("e", "Dragon"))).toBe("Colorless");
  });
});

describe("weakness/resistance parsing (§8.5)", () => {
  const fire = battler("atk", { types: ["Fire"] });
  const weak = (value: string | undefined) =>
    weaknessOf(fire, battler("def", { weaknesses: [{ type: "Fire", value }] }));
  const resist = (value: string | undefined) =>
    resistanceOf(fire, battler("def", { resistances: [{ type: "Fire", value }] }));

  it("parses ×N and the old-era additive +N weakness", () => {
    expect(weak("×2")).toEqual({ op: "multiply", amount: 2 });
    expect(weak("x3")).toEqual({ op: "multiply", amount: 3 });
    expect(weak("+20")).toEqual({ op: "add", amount: 20 }); // the dp5-4 print
  });

  it("parses -N/−N resistance (ASCII and unicode minus)", () => {
    expect(resist("-30")).toEqual({ op: "subtract", amount: 30 });
    expect(resist("−20")).toEqual({ op: "subtract", amount: 20 });
  });

  it("reads genuinely unknown garble as the modern defaults (×2 / −30)", () => {
    expect(weak("??")).toEqual({ op: "multiply", amount: 2 });
    expect(weak(undefined)).toEqual({ op: "multiply", amount: 2 });
    expect(resist("?")).toEqual({ op: "subtract", amount: 30 });
  });

  it("stays null when no entry names an attacker type", () => {
    expect(
      weaknessOf(fire, battler("def", { weaknesses: [{ type: "Water", value: "×2" }] })),
    ).toBeNull();
    expect(resistanceOf(fire, battler("def", {}))).toBeNull();
  });
});

describe("hpOf", () => {
  it("reads a non-positive printed hp as the same data gap as null", () => {
    expect(hpOf(battler("z", { hp: 0 }))).toBeNull();
    expect(hpOf(battler("z", { hp: -10 }))).toBeNull();
    expect(hpOf(battler("z", { hp: 60 }))).toBe(60);
    expect(hpOf(basicEnergy("e"))).toBeNull();
  });
});

describe("parseAttackDamage", () => {
  it("splits numbers, marker strings and absent damage", () => {
    expect(parseAttackDamage(30)).toEqual({ base: 30, modifier: null });
    expect(parseAttackDamage("60+")).toEqual({ base: 60, modifier: "+" });
    expect(parseAttackDamage("?")).toEqual({ base: 0, modifier: "?" });
    expect(parseAttackDamage(undefined)).toEqual({ base: 0, modifier: null });
  });

  it("still splits a damage string with an interior newline", () => {
    // The fallback must be TOTAL: "30\n×" flags a modifier rather than
    // silently parsing as 0 damage.
    expect(parseAttackDamage("30\n×")).toEqual({ base: 30, modifier: "×" });
  });
});

describe("pokemonSuffixOf", () => {
  it("reads the printed rule-box suffix off the NAME (the datum ingest keeps)", () => {
    // tcgdex's dedicated `suffix` field is dropped at ingest, but the marker is
    // also part of the printed name — which IS persisted.
    expect(pokemonSuffixOf(battler("x", { name: "Mewtwo V" }))).toBe("V");
    expect(pokemonSuffixOf(battler("x", { name: "Mewtwo VMAX" }))).toBe("VMAX");
    expect(pokemonSuffixOf(battler("x", { name: "Arceus VSTAR" }))).toBe("VSTAR");
    expect(pokemonSuffixOf(battler("x", { name: "Charizard ex" }))).toBe("ex");
    expect(pokemonSuffixOf(battler("x", { name: "Pikachu GX" }))).toBe("GX");
  });

  it("matches LITERALLY — each suffix is its own, and a plain body is null", () => {
    // The distinction Choice Belt draws: it boosts a V, never a VMAX/VSTAR.
    // Case and word-boundary matter, so "Vaporeon" is not a V and the
    // capital-E "EX" of the old print is not the modern lowercase "ex".
    expect(pokemonSuffixOf(battler("x", { name: "Vaporeon" }))).toBeNull();
    expect(pokemonSuffixOf(battler("x", { name: "Mew" }))).toBeNull();
    expect(pokemonSuffixOf(battler("x", { name: "Gardevoir EX" }))).toBeNull();
    // Non-Pokémon never carry one, whatever their name ends in.
    expect(pokemonSuffixOf(basicEnergy("e"))).toBeNull();
  });
});

describe("prizeValueOf (§8.1)", () => {
  it("owes 3 Prizes for a VMAX, 2 for any other rule box, 1 for a plain body", () => {
    // The class rides pokemonSuffixOf — the rule-box marker the NAME still
    // carries — so no persisted `suffix` column is needed to value a KO.
    expect(prizeValueOf(battler("x", { name: "Fixmon VMAX" }))).toBe(3);
    expect(prizeValueOf(battler("x", { name: "Mewtwo V" }))).toBe(2);
    expect(prizeValueOf(battler("x", { name: "Arceus VSTAR" }))).toBe(2);
    expect(prizeValueOf(battler("x", { name: "Charizard ex" }))).toBe(2);
    expect(prizeValueOf(battler("x", { name: "Pikachu GX" }))).toBe(2);
    expect(prizeValueOf(battler("x", { name: "Vaporeon" }))).toBe(1);
  });

  it("owes 1 for a non-Pokémon (Trainers/Energy are never KO'd, but the total stays safe)", () => {
    expect(prizeValueOf(basicEnergy("e"))).toBe(1);
  });
});
