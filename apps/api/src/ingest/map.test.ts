// Mapping tests run on the committed verbatim tcgdex fixtures (see
// packages/schema/src/tcgdex/__fixtures__): each payload is parsed with the
// real Zod schema first, so these tests cover schema→row end to end.

import { tcgdexCardSchema, tcgdexSerieSchema, tcgdexSetSchema } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import cardEnergyBasic from "../../../../packages/schema/src/tcgdex/__fixtures__/card-energy-basic-sve-002.json";
import cardEnergySpecial from "../../../../packages/schema/src/tcgdex/__fixtures__/card-energy-special-sv02-191.json";
import cardEnergyNormalTag from "../../../../packages/schema/src/tcgdex/__fixtures__/card-energy-special-normal-tag-sv10.5b-086.json";
import cardPokemonAbility from "../../../../packages/schema/src/tcgdex/__fixtures__/card-pokemon-ability-sv01-081.json";
import cardTrainerFossil from "../../../../packages/schema/src/tcgdex/__fixtures__/card-trainer-fossil-sv07-129.json";
import cardTrainer from "../../../../packages/schema/src/tcgdex/__fixtures__/card-trainer-sv01-181.json";
import cardTrainerTm from "../../../../packages/schema/src/tcgdex/__fixtures__/card-trainer-tm-sv08-188.json";
import serieFull from "../../../../packages/schema/src/tcgdex/__fixtures__/serie-full-sv.json";
import setFull from "../../../../packages/schema/src/tcgdex/__fixtures__/set-full-sv01.json";
import { energyTypeOf, mapCard, mapSerie, mapSet, printKey, weaklessLegalPokemon } from "./map";
import { WEAK_RES_SUPPLEMENT } from "./weakResSupplement";

describe("mapSerie", () => {
  it("maps the full sv serie, keeping the extensionless origin logo URL", () => {
    const serie = tcgdexSerieSchema.parse(serieFull);
    expect(mapSerie(serie)).toEqual({
      id: "sv",
      name: "Scarlet & Violet",
      releaseDate: "2023-03-31",
      logoUrl: "https://assets.tcgdex.net/en/sv/sv01/logo",
    });
  });

  it("nulls the optional fields when absent", () => {
    const serie = tcgdexSerieSchema.parse({ id: "misc", name: "Miscellaneous", sets: [] });
    expect(mapSerie(serie)).toEqual({
      id: "misc",
      name: "Miscellaneous",
      releaseDate: null,
      logoUrl: null,
    });
  });
});

describe("mapSet", () => {
  it("maps the full sv01 set onto the sets row", () => {
    const set = tcgdexSetSchema.parse(setFull);
    expect(mapSet(set)).toEqual({
      id: "sv01",
      serieId: "sv",
      name: "Scarlet & Violet",
      logoUrl: "https://assets.tcgdex.net/en/sv/sv01/logo",
      symbolUrl: "https://assets.tcgdex.net/univ/sv/sv01/symbol",
      releaseDate: "2023-03-31",
      countTotal: 258,
      countOfficial: 198,
      legalStandard: false,
      legalExpanded: true,
      tcgOnline: null,
      abbreviation: "SVI",
    });
  });
});

describe("mapCard", () => {
  it("maps a Pokémon: battle fields filled, Trainer/Energy fields null", () => {
    const card = tcgdexCardSchema.parse(cardPokemonAbility);
    expect(mapCard(card)).toEqual({
      id: "sv01-081",
      setId: "sv01",
      localId: "081",
      name: "Miraidon ex",
      category: "Pokemon",
      illustrator: "5ban Graphics",
      rarity: "Double rare",
      regulationMark: "G",
      hp: 220,
      stage: "Basic",
      // D197 — this fixture is a "Miraidon ex", and the payload has carried
      // `"suffix":"ex"` all along; ingest simply dropped it. Persisting it is
      // what lets an EX/Mega selection become a server param instead of a
      // client-side re-derivation off the card NAME.
      suffix: "ex",
      evolveFrom: null,
      typesJson: ["Lightning"],
      retreat: 1,
      abilitiesJson: [
        {
          type: "Ability",
          name: "Tandem Unit",
          effect:
            "Once during your turn, you may search your deck for up to 2 Basic {L} Pokémon and put them onto your Bench. Then, shuffle your deck.",
        },
      ],
      attacksJson: [
        {
          cost: ["Lightning", "Lightning", "Colorless"],
          name: "Photon Blaster",
          effect: "During your next turn, this Pokémon can't attack.",
          damage: 220,
        },
      ],
      weaknessesJson: [{ type: "Fighting", value: "×2" }],
      resistancesJson: null,
      trainerType: null,
      energyType: null,
      effect: null,
      legalStandard: false,
      legalExpanded: true,
      printKey: expect.any(String),
      legalStandardEffective: false,
      legalExpandedEffective: true,
      variantsJson: {
        firstEdition: false,
        holo: false,
        normal: false,
        reverse: false,
        wPromo: false,
      },
      imageUrl: "https://assets.tcgdex.net/en/sv/sv01/081",
      updated: card.updated ?? null,
    });
  });

  it("maps a Trainer: effect/trainerType filled, Pokémon fields null", () => {
    const card = tcgdexCardSchema.parse(cardTrainer);
    const row = mapCard(card);
    expect(row.category).toBe("Trainer");
    expect(row.trainerType).toBe("Item");
    expect(row.effect).toMatch(/^Search your deck for a Basic Pokémon/);
    expect(row.energyType).toBeNull();
    expect(row.hp).toBeNull();
    expect(row.typesJson).toBeNull();
    expect(row.attacksJson).toBeNull();
    expect(row.abilitiesJson).toBeNull();
    expect(row.suffix).toBeNull(); // Pokémon-only, like stage (🆕 D581: not like hp — a fossil Trainer keeps its printed hp)
    expect(row.imageUrl).toBe("https://assets.tcgdex.net/en/sv/sv01/181");
  });

  // 🆕 D581 — the Trainer branch keeps a printed Pokémon face (map.ts header).
  it("maps a fossil Trainer: hp and the printed Ability kept, the rest of the Pokémon face null", () => {
    const row = mapCard(tcgdexCardSchema.parse(cardTrainerFossil));
    expect(row.category).toBe("Trainer");
    expect(row.trainerType).toBe("Item");
    expect(row.hp).toBe(60);
    expect(row.abilitiesJson).toEqual([
      {
        type: "Ability",
        name: "Protective Cover",
        effect:
          "Prevent all effects of attacks used by your opponent's Pokémon done to this Pokémon. (Damage is not an effect.)",
      },
    ]);
    expect(row.attacksJson).toBeNull();
    // Not printed on the Trainer, so still null: the face's type, stage and
    // retreat are the RULE text's ("a 60-HP Basic {C} Pokémon … can't retreat").
    expect(row.typesJson).toBeNull();
    expect(row.stage).toBeNull();
    expect(row.retreat).toBeNull();
    expect(row.effect).toMatch(/^Play this card as if it were a 60-HP Basic \{C\} Pokémon\./);
  });

  it("maps a Technical Machine: the printed attack kept, no hp, no Ability", () => {
    const row = mapCard(tcgdexCardSchema.parse(cardTrainerTm));
    expect(row.trainerType).toBe("Tool");
    expect(row.attacksJson).toEqual([
      {
        cost: ["Grass", "Water", "Psychic"],
        name: "Fluorite",
        effect: "Discard all Energy from this Pokémon, and heal all damage from each of your Tera Pokémon.",
      },
    ]);
    expect(row.hp).toBeNull();
    expect(row.abilitiesJson).toBeNull();
  });

  it("maps a basic Energy: energyType filled, no effect, no image", () => {
    const card = tcgdexCardSchema.parse(cardEnergyBasic);
    const row = mapCard(card);
    expect(row.category).toBe("Energy");
    expect(row.energyType).toBe("Normal");
    expect(row.effect).toBeNull();
    expect(row.trainerType).toBeNull();
    expect(row.imageUrl).toBeNull();
    expect(row.legalStandard).toBe(true);
    expect(row.legalExpanded).toBe(true);
    expect(row.variantsJson).toEqual({
      firstEdition: false,
      holo: false,
      normal: true,
      reverse: true,
      wPromo: false,
    });
  });

  it("maps a special Energy with rules text", () => {
    const card = tcgdexCardSchema.parse(cardEnergySpecial);
    const row = mapCard(card);
    expect(row.category).toBe("Energy");
    expect(row.effect).not.toBeNull();
  });

  // 🆕🆕🆕 D583 — tcgdex tags 14 legal Special Energies "Normal" (every `me` one; `sv` Reversal,
  // Prism, Ignition). The verbatim Prism Energy payload (fetched 2026-10-07) is one of them.
  it("writes \"Special\" for a Normal-tagged Energy that prints rules text (Prism Energy sv10.5b-086)", () => {
    const card = tcgdexCardSchema.parse(cardEnergyNormalTag);
    expect(card.category === "Energy" ? card.energyType : null).toBe("Normal");
    const row = mapCard(card);
    expect(row.energyType).toBe("Special");
    expect(row.effect).toContain("provides every type of Energy");
    // A Special tagged Special is unchanged.
    expect(mapCard(tcgdexCardSchema.parse(cardEnergySpecial)).energyType).toBe("Special");
  });

  // 🆕 D612 — every printed text goes through the engine's `normalizeCardText` (map.ts header).
  // The raw texts are LOCAL D1 rows as tcgdex served them before the D612 re-ingest.
  it("writes tcgdex's markup in the `sv` spelling: attacks, Abilities and a Trainer's effect", () => {
    const base = tcgdexCardSchema.parse(cardPokemonAbility);
    if (base.category !== "Pokemon") throw new Error("fixture is a Pokémon");
    const row = mapCard({
      ...base,
      abilities: [{ type: "Ability", name: "Nighttime Byway", effect: "Your Active Pokémon's Retreat Cost is ColorlessColorless less." }],
      attacks: [
        { cost: ["Colorless"], name: "Tackle", damage: 10 },
        {
          cost: ["Water"],
          name: "Hydro Pump",
          effect:
            'This attack does 30 more damage for each <span class="energy-symbol Water" title="Water">Water</span> Energy attached to this Pokémon. <em>(Hi.)</em>',
        },
        { cost: ["Fire"], name: "Inferno X", effect: "Discard any amount of [R] Energy from among your Pokémon." },
      ],
    });
    expect(row.abilitiesJson).toEqual([
      { type: "Ability", name: "Nighttime Byway", effect: "Your Active Pokémon's Retreat Cost is {C}{C} less." },
    ]);
    expect(row.attacksJson).toEqual([
      { cost: ["Colorless"], name: "Tackle", damage: 10 },
      { cost: ["Water"], name: "Hydro Pump", effect: "This attack does 30 more damage for each {W} Energy attached to this Pokémon. (Hi.)" },
      { cost: ["Fire"], name: "Inferno X", effect: "Discard any amount of {R} Energy from among your Pokémon." },
    ]);
    const trainer = tcgdexCardSchema.parse(cardTrainer);
    if (trainer.category !== "Trainer") throw new Error("fixture is a Trainer");
    expect(mapCard({ ...trainer, effect: "Attach a Basic Fire Energy card." }).effect).toBe("Attach a Basic {R} Energy card.");
    // A clean `sv` row maps byte for byte as before.
    expect(mapCard(base).attacksJson).toEqual(base.attacks);
    expect(mapCard(base).abilitiesJson).toEqual(base.abilities);
  });

  // 🆕 D612 — the other two write sites: an Energy's rules text and a Trainer's printed attack. No
  // Energy or Technical Machine row in the LOCAL D1 carries markup today; these texts are the
  // verbatim fixtures with one tcgdex spelling spliced in, so a revert of either site to raw is seen.
  it("writes an Energy's rules text and a Trainer's printed attack in the `sv` spelling", () => {
    const energy = tcgdexCardSchema.parse(cardEnergySpecial);
    if (energy.category !== "Energy") throw new Error("fixture is an Energy");
    expect(mapCard({ ...energy, effect: "This card provides ColorlessColorless Energy." }).effect).toBe(
      "This card provides {C}{C} Energy.",
    );
    const tm = tcgdexCardSchema.parse(cardTrainerTm);
    if (tm.category !== "Trainer") throw new Error("fixture is a Trainer");
    const attacks = (tm.attacks ?? []).map((attack) => ({ ...attack, effect: `${attack.effect} <em>(Hi.)</em>` }));
    expect(mapCard({ ...tm, attacks }).attacksJson).toEqual([
      {
        cost: ["Grass", "Water", "Psychic"],
        name: "Fluorite",
        effect: "Discard all Energy from this Pokémon, and heal all damage from each of your Tera Pokémon. (Hi.)",
      },
    ]);
  });

  it("energyTypeOf: no text keeps the tag; blank text is no text; a sentinel is still NULL", () => {
    expect(energyTypeOf("Normal", undefined)).toBe("Normal");
    expect(energyTypeOf("Normal", "")).toBe("Normal");
    expect(energyTypeOf("Normal", " \n ")).toBe("Normal");
    expect(energyTypeOf("Normal", "Rules.")).toBe("Special");
    expect(energyTypeOf("Special", undefined)).toBe("Special");
    expect(energyTypeOf("None", "Rules.")).toBeNull();
    expect(energyTypeOf(undefined, undefined)).toBeNull();
  });

  it("normalises upstream 'None' sentinels to NULL instead of storing them", () => {
    // The `mfb` set's payload shape (D194): upstream spells "this card has
    // no rarity / no regulation mark" as the literal STRING "None", which
    // `?? null` happily writes through. Overlaid on the real sv01-181
    // Trainer fixture so the rest of the mapping stays honest.
    const card = tcgdexCardSchema.parse({
      ...(cardTrainer as Record<string, unknown>),
      rarity: "None",
      regulationMark: "None",
    });
    const row = mapCard(card);
    expect(row.rarity).toBeNull();
    expect(row.regulationMark).toBeNull();
    // Untouched: the sentinel guard is not a general string filter.
    expect(row.trainerType).toBe("Item");
    expect(row.illustrator).not.toBeNull();
  });

  // D197 — `suffix` joins the sentinel-normalised VOCABULARY columns rather
  // than the prose ones: it is a small closed set destined for a facet list,
  // so a literal "None" would land in the rail as a dead chip exactly the way
  // rarity's did (D194). Cheaper to guard at ingest than to discover later.
  it("normalises a 'None' suffix to NULL, and an absent one too", () => {
    const sentinel = mapCard(
      tcgdexCardSchema.parse({ ...(cardPokemonAbility as Record<string, unknown>), suffix: "None" }),
    );
    expect(sentinel.suffix).toBeNull();

    const { suffix: _suffix, ...withoutSuffix } = cardPokemonAbility as Record<string, unknown>;
    expect(mapCard(tcgdexCardSchema.parse(withoutSuffix)).suffix).toBeNull();
  });

  it("defaults a missing upstream `legal` block to false/false", () => {
    const { legal: _legal, ...withoutLegal } = tcgdexCardSchema.parse(cardEnergyBasic);
    const card = tcgdexCardSchema.parse(withoutLegal);
    const row = mapCard(card);
    expect(row.legalStandard).toBe(false);
    expect(row.legalExpanded).toBe(false);
  });
});

describe("printKey", () => {
  const base = mapCard(tcgdexCardSchema.parse(cardPokemonAbility));
  it("ignores everything that differs between reprints", () => {
    const reprint = {
      ...base,
      id: "sv08.5-999",
      setId: "sv08.5",
      localId: "999",
      rarity: "Rare",
      illustrator: "Someone Else",
      regulationMark: "I",
      legalStandard: true,
      legalExpanded: true,
      imageUrl: null,
      updated: null,
      variantsJson: null,
      name: `  ${base.name.toUpperCase()}  `,
    };
    expect(printKey(reprint)).toBe(printKey(base));
  });
  it("separates prints whose rules differ", () => {
    expect(printKey({ ...base, hp: (base.hp ?? 0) + 10 })).not.toBe(printKey(base));
    expect(printKey({ ...base, attacksJson: [] })).not.toBe(printKey(base));
    expect(printKey({ ...base, category: "Trainer" })).not.toBe(printKey(base));
  });
  it("is 16 hex characters and seeds the effective flags with the print's own", () => {
    expect(base.printKey).toMatch(/^[0-9a-f]{16}$/);
    expect(base.legalStandardEffective).toBe(base.legalStandard);
    expect(base.legalExpandedEffective).toBe(base.legalExpanded);
  });
});

describe("Weakness / Resistance supplement (card revision B39)", () => {
  // The Miraidon ex fixture with its id moved into White Flare and tcgdex's two
  // fields dropped — the shape every sv10.5w / sv10.5b payload arrives in.
  function bare(id: string, overrides: Record<string, unknown> = {}) {
    const { weaknesses: _w, resistances: _r, ...rest } = cardPokemonAbility as Record<string, unknown>;
    return tcgdexCardSchema.parse({ ...rest, id, legal: { standard: true, expanded: true }, ...overrides });
  }

  it("fills both fields from the table when tcgdex sends neither", () => {
    const row = mapCard(bare("sv10.5w-063"));
    expect(row.weaknessesJson).toEqual([{ type: "Lightning", value: "×2" }]);
    expect(row.resistancesJson).toEqual([{ type: "Fighting", value: "-30" }]);
  });

  it("leaves resistance null for an entry that prints none", () => {
    const row = mapCard(bare("sv10.5w-001"));
    expect(row.weaknessesJson).toEqual([{ type: "Fire", value: "×2" }]);
    expect(row.resistancesJson).toBeNull();
  });

  it("lets upstream win when tcgdex sends either field", () => {
    const sent = [{ type: "Water", value: "×2" }];
    expect(mapCard(bare("sv10.5w-063", { weaknesses: sent })).weaknessesJson).toEqual(sent);
    expect(mapCard(bare("sv10.5w-063", { weaknesses: sent })).resistancesJson).toBeNull();
  });

  it("feeds the print key, so a patched print is not keyed as a weakless one", () => {
    const patched = mapCard(bare("sv10.5w-063"));
    expect(patched.printKey).not.toBe(printKey({ ...patched, weaknessesJson: null, resistancesJson: null }));
  });

  it("leaves an id outside the table null", () => {
    const row = mapCard(bare("mfb-1"));
    expect(row.weaknessesJson).toBeNull();
    expect(row.resistancesJson).toBeNull();
  });

  it("flags a legal non-Dragon Pokémon with no Weakness, and nothing else", () => {
    const flagged = mapCard(bare("mfb-1"));
    const dragon = { ...flagged, id: "x-dragon", typesJson: ["Dragon"] };
    const notLegal = { ...flagged, id: "x-rotated", legalStandard: false };
    const patched = mapCard(bare("sv10.5w-063"));
    const trainer = mapCard(tcgdexCardSchema.parse(cardTrainer));
    expect(weaklessLegalPokemon([flagged, dragon, notLegal, patched, trainer])).toEqual(["mfb-1"]);
  });

  it("holds only well-formed entries", () => {
    const types = new Set(["Grass", "Fire", "Water", "Lightning", "Psychic", "Fighting", "Darkness", "Metal", "Colorless"]);
    const ids = Object.keys(WEAK_RES_SUPPLEMENT);
    expect(ids).toHaveLength(345);
    for (const [id, entry] of Object.entries(WEAK_RES_SUPPLEMENT)) {
      expect(id, id).toMatch(/^(sv10\.5w|sv10\.5b|svp)-\d{3}$/);
      expect(entry.weaknesses, id).toHaveLength(1);
      for (const w of entry.weaknesses) {
        expect(types.has(w.type), id).toBe(true);
        expect(w.value, id).toBe("×2");
      }
      for (const r of entry.resistances ?? []) {
        expect(types.has(r.type), id).toBe(true);
        expect(r.value, id).toBe("-30");
      }
      expect(entry.from, id).toMatch(/^[PTJMXS]+$/);
    }
  });
});
