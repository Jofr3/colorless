import { describe, expect, it } from "vitest";
import { CATALOG_MANIFEST as M } from "./catalogManifest";
import { programFor } from "./registry";
import { FIXTURE_POOL } from "./testFixtures";

const REAL_ID = /^(sv|swsh|me\d|mep-|mee-|30th)/;

const realFixtureIds = Object.keys(FIXTURE_POOL)
  .filter((id) => REAL_ID.test(id))
  .sort();

const NO_CATALOG_ROW: Record<string, string> = {};

const INCOMPLETE: Record<
  string,
  { attacks?: string[]; abilities?: string[]; invented?: string[]; reindexed?: true; why: string }
> = {
  "sv01-005": {
    attacks: ["Light Punch"],
    why: "Cacnea — registry passive 'Counterattack Quills'; a defender only, never pays an attack.",
  },
  "sv01-006": { attacks: ["Spike Shot"], why: "Cacturne — Cacnea's twin, same reason." },
  "sv03-112": {
    attacks: ["Rumble"],
    why: "Stunfisk — registry passive 'Custom Trap' (the Tool-gated recoil); a defender only.",
  },
  "sv03-044": {
    attacks: ["Steam Artillery"],
    why: "Armarouge — registry `onDamagedByAttack` trigger 'Scorching Armor'; a defender only.",
  },
  "sv03-120": {
    attacks: ["Falling Press"],
    why: "Klawf ex — registry `onDamagedByAttack` trigger 'Counterattacking Pincer'; declared in its doc block ('No `attacks`: it is always the DEFENDER').",
  },
  "sv02-097": {
    abilities: ["Safeguard"],
    why: "Mimikyu — declared in its doc block: Safeguard is authored in the REGISTRY, keyed by id, which makes this the sharpest zero-registry-ROW witness (`programFor` is defined, `.attack` is not). D151 called this the LIVE case; it is documented, and its residual cost is that a `FIXTURE_POOL` sweep for the printed sentence cannot see it.",
  },
  // — the always-on damage-reduction / debuff passives: registry rows, tanky bodies
  //   fielded to be HIT.
  "sv02-150": {
    attacks: ["Nosequake"],
    abilities: ["Bronze Body"],
    why: "Copperajah ex — registry passive (−30 after W/R); a tanky body fielded to absorb an attack.",
  },
  "sv01-121": {
    attacks: ["Mega Kick"],
    abilities: ["Exoskeleton"],
    why: "Stonjourner — registry passive (−20 after W/R); same shape as Copperajah ex.",
  },
  "sv03-082": {
    attacks: ["Wondrous Moon"],
    why: "Clefable ex — registry passive 'Lunar Zone' (the `noRetreatCostAura` source); a retreat test, never an attack one.",
  },
  // — the activated / triggered Ability cast (M4 slices 6–9): real ids so
  //   `programFor` finds the program, simplified bodies so surgery can place them.
  "sv01-023": {
    attacks: ["Solar Beam"],
    abilities: ["Enriching Oil"],
    why: "Arboliva — registry `onEvolve` trigger; declared in the slice's section comment (stages/evolveFrom simplified to the fixture line).",
  },
  "sv02-170": {
    attacks: ["United Wings"],
    abilities: ["Insta-Flock"],
    why: "Flamigo — registry `onPlayToBench` trigger; same section comment.",
  },
  "sv02-123": {
    attacks: ["Knocking Hammer"],
    abilities: ["Blessed Salt"],
    why: "Garganacl — registry `betweenTurns` trigger; a Basic here so it sits without an evolution.",
  },
  "sv03-012": {
    attacks: ["Lock Up"],
    abilities: ["Forest Miasma"],
    why: "Trevenant — registry `betweenTurns` trigger; a Basic for the same reason.",
  },
  "sv01-118": {
    attacks: ["Wing Attack"],
    abilities: ["Flying Entry"],
    why: "Hawlucha — registry `onPlayToBench` trigger (the snipe cast).",
  },
  "sv02-015": {
    attacks: ["Scratching Nails"],
    abilities: ["Bouquet Magic"],
    why: "Meowscarada ex — registry activated Ability; a Basic HERE though the print is a Stage 2 (declared in its doc block).",
  },
  "sv02-126": {
    attacks: ["Poison Petals"],
    why: "Glimmora — registry `onKnockOut` trigger; 30 HP so one Bite Knocks it Out, which is the whole point.",
  },
  "sv03-143": {
    abilities: ["Special Eater"],
    why: "Mawile — declared in its doc block: 'the Ability lives in the registry, so the card needs no `abilities` here'.",
  },
  "sv01-054": {
    attacks: ["Hydro Kick"],
    abilities: ["Energy Carnival"],
    why: "Quaquaval — registry activated Ability (attachEnergyFrom); declared in the slice's section comment.",
  },
  "sv02-060": {
    attacks: ["Buster Tail"],
    abilities: ["Super Cold"],
    why: "Baxcalibur — Quaquaval's twin, same section comment.",
  },
  "sv01-086": {
    abilities: ["Psychic Embrace"],
    why: "Gardevoir ex — registry activated Ability with the counter/KO riders; same section comment. Its printed attack 'Miracle Force' is CARRIED since D177 (it is the ATTACK half of the `clearStatus` family).",
  },
  "sv01-228": {
    abilities: ["Psychic Embrace"],
    why: "Gardevoir ex (Ultra Rare) — the sv01-086 reprint, same registry row (`GARDEVOIR_EX`) keyed by id; carries its printed 'Miracle Force' so the text-keyed deriver claim is drivable on a reprint.",
  },
  "sv01-245": {
    abilities: ["Psychic Embrace"],
    why: "Gardevoir ex (Special illustration rare) — the second sv01-086 reprint, same reason.",
  },
  "sv01-145": {
    abilities: ["Busybody Nurse"],
    why: "Blissey — registry activated Ability (D177's `clearStatus`, `activeOnly: false` so a benched Blissey nurses the Active); the Mawile/Armarouge shape, `programFor` finds the program so an `abilities` array here would be inert. Its printed attack 'Happy Cyclone' rides along at its PRINTED index 0.",
  },
  "sv01-125": {
    attacks: ["Wild Impact"],
    abilities: ["Dino Cry"],
    why: "Koraidon ex — registry activated Ability with `endsTurn`; the attach is the test.",
  },
  "sv01-041": {
    abilities: ["Fire Off"],
    why: "Armarouge sv01-041 — declared in its doc block: the Ability is the registry's, and 'its printed attack rides along because a fixture Pokémon that cannot attack makes an awkward Active'.",
  },
  "sv02-140": {
    abilities: ["Tri Howl"],
    why: "Hydreigon — same declaration, and Tri Howl is usable from the Bench so the suites need it in both spots.",
  },
  "sv01-142": {
    abilities: ["Rumbling Engine"],
    why: "Revavroom — registry activated Ability (the payment-ORDER witness).",
  },
  "sv01-151": {
    abilities: ["Nest Stash"],
    why: "Skwovet — registry activated Ability; its printed attack is a plain 20 kept so an Active Skwovet cannot put an unrelated effect into an Ability test.",
  },
  "sv03-125": {
    abilities: ["Infernal Reign"],
    why: "Charizard ex — registry `onEvolve` trigger; its doc block declares `evolveFrom` as the ONE deviation and is the block that names a false verbatim banner as a defect.",
  },
  "sv03-061": {
    attacks: ["Tail Smack"],
    why: "Finizen — declared: 'NO ATTACKS are carried … giving it an attack would only invite a case to use the wrong one'. It exists to be retreated in and evolved.",
  },
  "swsh10.5-010": {
    abilities: ["Burn Brightly"],
    why: "Charizard — declared in its own doc block as 'A THIRD simplification, beyond the two the header declares', with the reason: 'Burn Brightly' is a PROVISION modifier and `continuous.ts unitsOf` has no hook for a Pokémon Ability that changes what attached Energy provides. The declaration predates any catalog that could check it and is exact.",
  },
  "swsh10.5-018": {
    abilities: ["Pump Shot"],
    why: "Radiant Blastoise — the registry-authored-Ability cast (`RADIANT_BLASTOISE`, keyed by id), same shape as Mawile sv03-143 and Armarouge sv01-041: `programFor` finds the program, so the printed `abilities` array would be inert. Its printed attack 'Torrential Cannon' rides along at its PRINTED index 0 and is D154's fifth per-attack-lock printing.",
  },
};

const CATALOG_STATE_LIST: readonly { rows: number; sets: number; population: string }[] = [
  {
    rows: M.rows,
    sets: M.setRows,
    population:
      "the file on disk today (🆕 D581: the whole `sv` serie, the `me` serie and `swsh10.5`)",
  },
  {
    rows: M.sixSet.rows,
    sets: M.sixSet.sets.length,
    population:
      "the six-set slice (🆕 D581) — the catalog D160 restored and every census comment before D581 measured: the re-ingest restored the state D112 measured, not a new one",
  },
  {
    rows: M.history.shrunken.rows,
    sets: M.history.shrunken.setCount,
    population: `the catalog during the ${M.history.set} outage (${M.history.firstMissing} → ${M.history.restored}), which every census dated 2026-08-03 queried`,
  },
];

const CATALOG_STATES: ReadonlyMap<number, number> = new Map(
  CATALOG_STATE_LIST.map((s) => [s.rows, s.sets]),
);

describe("the manifest is internally consistent", () => {
  it("the per-set counts sum to the row count — the SCOPE and the TOTAL are one query apart", () => {
    const summed = Object.values(M.sets).reduce((a, b) => a + b, 0);
    expect(summed).toBe(M.rows);
    expect([...M.sixSet.sets].sort()).toEqual([
      "sv01",
      "sv02",
      "sv03",
      "sv06.5",
      "sve",
      "swsh10.5",
    ]);
    expect(M.sixSet.sets.reduce((sum, set) => sum + (M.sets[set] ?? 0), 0)).toBe(M.sixSet.rows);
    expect(M.sixSet.rows).toBe(978);
    expect(Object.keys(M.sets).length).toBe(30);
    expect(
      Object.keys(M.sets).filter((set) => !/^(sv|me|mee$|mep$|30th|mfb$|swsh10\.5$)/.test(set)),
    ).toEqual([]);
  });

  it("the category split sums to the row count, and names all three categories", () => {
    expect(Object.values(M.categories).reduce((a, b) => a + b, 0)).toBe(M.rows);
    expect(Object.keys(M.categories).sort()).toEqual(["Energy", "Pokemon", "Trainer"]);
  });

  it("distinct names are FEWER than rows — a card is a printing, not a species", () => {
    expect(M.distinctNames).toBeLessThan(M.rows);
  });

  it("the three text columns each have their own count, and `any` is their union", () => {
    const { effect, attacksJson, abilitiesJson, any } = M.textColumns;
    expect(any).toBeGreaterThanOrEqual(Math.max(effect, attacksJson, abilitiesJson));
    expect(any).toBeLessThanOrEqual(effect + attacksJson + abilitiesJson);
    expect(any).toBeLessThanOrEqual(M.rows);
    const trainerRowsWithAttacks = Object.values(M.trainerFaces).filter(
      (f) => (f.attacks ?? []).length > 0,
    ).length;
    expect(trainerRowsWithAttacks).toBe(7);
    expect(attacksJson - trainerRowsWithAttacks + M.pokemonWithoutAttacks.length).toBe(
      M.categories.Pokemon,
    );
    expect([...M.pokemonWithoutAttacks]).toEqual(["30th-c-009", "30th-c-019", "swsh10.5-053"]);
    expect(M.sixSet.textColumns.attacksJson + 1).toBe(M.sixSet.categories.Pokemon);
  });

  it("records WHICH file it measured, and when that file was last written", () => {
    expect(M.source.path).toContain("miniflare-D1DatabaseObject");
    expect(M.source.bytes).toBeGreaterThan(0);
    // Not the generation date: the catalog is ingest output and does not drift on
    // its own, so the sqlite's mtime is the honest provenance for every number.
    expect(new Date(M.source.mtime).getTime()).toBeGreaterThan(0);
  });

  it("D137's apostrophe premise holds: ZERO curly apostrophes in the whole catalog", () => {
    expect(M.curlyApostropheAnywhere).toBe(0);
    expect(M.straightApostropheInAttacks).toBeGreaterThan(0);
  });
});

describe("(c) every real-card fixture is either in the catalog or declared absent", () => {
  it("classifies every real fixture id, and the generator agrees with this suite", () => {
    const classified = [...Object.keys(M.printed), ...M.absent].sort();
    expect(classified).toEqual(realFixtureIds);
  });

  it("every absent id carries a REASON, and no reason is dead", () => {
    expect(Object.keys(NO_CATALOG_ROW).sort()).toEqual([...M.absent].sort());
    for (const [id, why] of Object.entries(NO_CATALOG_ROW)) {
      expect(why.length, `${id} needs a real reason`).toBeGreaterThan(20);
    }
  });
});

describe("(a) no fixture NAME is wrong", () => {
  it("every fixture with a catalog row carries the printed name — or is a Trainer named by its id", () => {
    const idNamed: string[] = [];
    for (const [id, printed] of Object.entries(M.printed)) {
      const fixture = FIXTURE_POOL[id];
      if (fixture === undefined) throw new Error(`manifest row with no fixture: ${id}`);
      if (fixture.name === printed.name) continue;
      // The ONE systemic exception, and it is a rule rather than a list: the
      // `trainerCard` / `itemTrainer` helpers name a Trainer by its own id,
      // because `programFor` keys on the id and no Trainer rule reads a name.
      expect(fixture.name, `${id} (${printed.name}) has a WRONG name`).toBe(id);
      idNamed.push(id);
    }
    // …and that exception may never reach a Pokémon, whose name IS read (evolution
    // matching, `byName` search, the aura's `exemptAbilityNamed`).
    for (const id of idNamed) expect(FIXTURE_POOL[id]?.category).toBe("Trainer");
    expect(idNamed.length).toBeGreaterThan(0);
  });

  const TYPES_DIVERGE: Record<string, string> = {};

  it("every fixture with a catalog row carries the printed TYPES, or declares why not", () => {
    const diverged: string[] = [];
    for (const [id, printed] of Object.entries(M.printed)) {
      const fixture = FIXTURE_POOL[id];
      if (fixture === undefined) throw new Error(`manifest row with no fixture: ${id}`);
      // Trainers and Energy print no types and the helpers give them none.
      if (printed.types.length === 0) {
        expect(fixture.types ?? [], `${id} prints no types`).toEqual([]);
        continue;
      }
      if (JSON.stringify(fixture.types ?? []) === JSON.stringify(printed.types)) continue;
      diverged.push(id);
      expect(
        TYPES_DIVERGE[id],
        `${id} (${printed.name}) carries ${JSON.stringify(fixture.types)} where the card prints ${JSON.stringify(printed.types)} — declare it or fix it`,
      ).toBeDefined();
    }
    // Total in BOTH directions: a declaration for a fixture that no longer
    // diverges is as dead as an undeclared divergence is silent.
    expect(diverged.sort()).toEqual(Object.keys(TYPES_DIVERGE).sort());
    // …and PINNED EMPTY on top of that, so a sixth divergence cannot be absorbed
    // by declaring it — the table above is empty and must stay so.
    expect(diverged).toEqual([]);
    for (const why of Object.values(TYPES_DIVERGE)) expect(why.length).toBeGreaterThan(30);
    // The sweep read a real population — an empty `printed` satisfies the loop.
    expect(Object.values(M.printed).filter((p) => p.types.length > 0).length).toBeGreaterThan(100);
  });
});

describe("(b) a fixture may omit a printed attack or Ability only with a stated reason", () => {
  function diffOf(id: string) {
    const printed = M.printed[id];
    const fixture = FIXTURE_POOL[id];
    if (printed === undefined || fixture === undefined) throw new Error(`no row for ${id}`);
    const fixtureAttacks = (fixture.attacks ?? []).map((a) => a.name);
    const fixtureAbilities = (fixture.abilities ?? []).map((a) => a.name);
    return {
      attacks: printed.attacks.filter((n) => !fixtureAttacks.includes(n)),
      abilities: printed.abilities.filter((n) => !fixtureAbilities.includes(n)),
      invented: fixtureAttacks.filter((n) => !printed.attacks.includes(n)),
      reindexed: fixtureAttacks.some((n, i) => printed.attacks[i] !== n),
    };
  }

  it("every incomplete fixture is declared, and every declaration is exact", () => {
    for (const id of Object.keys(M.printed)) {
      const d = diffOf(id);
      const declared = INCOMPLETE[id];
      const complete =
        !d.attacks.length && !d.abilities.length && !d.invented.length && !d.reindexed;
      if (complete) {
        expect(declared, `${id} is complete — remove its INCOMPLETE entry`).toBeUndefined();
        continue;
      }
      expect(
        declared,
        `${id} (${M.printed[id]?.name}) omits ${JSON.stringify(d)} and is NOT declared`,
      ).toBeDefined();
      expect(declared?.attacks ?? [], `${id} attacks`).toEqual(d.attacks);
      expect(declared?.abilities ?? [], `${id} abilities`).toEqual(d.abilities);
      expect(declared?.invented ?? [], `${id} invented`).toEqual(d.invented);
      expect(declared?.reindexed === true, `${id} reindexed`).toBe(d.reindexed);
    }
  });

  it("no declaration is dead — every id in the table still names a real fixture with a row", () => {
    for (const id of Object.keys(INCOMPLETE)) {
      expect(
        M.printed[id],
        `${id} has no catalog row — it cannot be an INCOMPLETE entry`,
      ).toBeDefined();
      expect(FIXTURE_POOL[id], `${id} is no longer a fixture`).toBeDefined();
    }
  });

  it("every declaration carries a REASON, not a bare suppression", () => {
    for (const [id, entry] of Object.entries(INCOMPLETE)) {
      expect(entry.why.length, `${id} needs a real reason`).toBeGreaterThan(30);
    }
  });

  const OMISSION_BUDGET = { rows: 32, attackNames: 19, abilityNames: 24 } as const;

  const FROZEN: readonly string[] = [
    "sv01-005",
    "sv01-006",
    "sv01-023",
    "sv01-041",
    "sv01-054",
    "sv01-086",
    "sv01-118",
    "sv01-121",
    "sv01-125",
    "sv01-142",
    "sv01-145",
    "sv01-151",
    "sv01-228",
    "sv01-245",
    "sv02-015",
    "sv02-060",
    "sv02-097",
    "sv02-123",
    "sv02-126",
    "sv02-140",
    "sv02-150",
    "sv02-170",
    "sv03-012",
    "sv03-044",
    "sv03-061",
    "sv03-082",
    "sv03-112",
    "sv03-120",
    "sv03-125",
    "sv03-143",
    "swsh10.5-010",
    "swsh10.5-018",
  ];

  const ABILITY_NOT_NAMED_IN_REGISTRY: Record<string, string> = {
    "sv01-121":
      "Stonjourner 'Exoskeleton' — a registry `passive` (damageReductionAfterWR 20), and PassiveEffects carries no name. Checked one level weaker below: the program exists and is a passive.",
    "sv02-097":
      "Mimikyu 'Safeguard' — a registry `passive` (the ex/V damage prevention). Same reason: the passive shape has no name field to match the print against.",
    "sv02-150":
      "Copperajah ex 'Bronze Body' — a registry `passive` (damageReductionAfterWR 30). Same reason as Stonjourner, and the two are each other's twin.",
    "swsh10.5-010":
      "Charizard 'Burn Brightly' — NO registry program at all, and the fixture's own doc block says why: it is a PROVISION modifier and `continuous.ts unitsOf` has no hook for a Pokémon Ability that changes what attached Energy provides.",
  };

  /** (1, attack side) The attack-omitting rows whose card carries NO registry
      program at all — the one place "the fixture drops its attack because the
      REGISTRY is the subject of the body" is not a checkable claim. */
  const ATTACK_OMITTED_WITH_NO_PROGRAM: Record<string, string> = {
    "sv03-061":
      "Finizen — a pre-evolution with no registry row by design. Its declaration is the one in the table that is honestly about the SUITES ('it exists to be retreated in and evolved'), and it is the single row this case cannot justify from the registry.",
  };

  it("(2) the table's KEY SET is pinned — a 34th row is a two-site edit a reviewer sees", () => {
    expect(Object.keys(INCOMPLETE).sort()).toEqual([...FROZEN].sort());
    expect(FROZEN.length).toBe(OMISSION_BUDGET.rows);
  });

  it("(3) the pool's TOTAL omissions are budgeted, and the budget is DERIVED — the table cannot pay for it", () => {
    const ids = Object.keys(M.printed);
    let rows = 0;
    let attackNames = 0;
    let abilityNames = 0;
    const invented: string[] = [];
    for (const id of ids) {
      const d = diffOf(id);
      if (!d.attacks.length && !d.abilities.length && !d.invented.length && !d.reindexed) continue;
      rows++;
      attackNames += d.attacks.length;
      abilityNames += d.abilities.length;
      if (d.invented.length) invented.push(id);
    }
    expect(rows, `INCOMPLETE rows moved from ${OMISSION_BUDGET.rows} to ${rows}`).toBe(
      OMISSION_BUDGET.rows,
    );
    expect(
      attackNames,
      `the pool now omits ${attackNames} printed attack names, not ${OMISSION_BUDGET.attackNames}. UP means a fixture dropped an attack — declaring it does not pay for this number, only carrying the attack does. DOWN means a fixture was FIXED: lower the budget.`,
    ).toBe(OMISSION_BUDGET.attackNames);
    expect(
      abilityNames,
      `the pool now omits ${abilityNames} printed Ability names, not ${OMISSION_BUDGET.abilityNames} — same rule.`,
    ).toBe(OMISSION_BUDGET.abilityNames);
    expect(invented).toEqual([]);
    // The sweep read a real population — an empty `M.printed` satisfies every line
    // above, including the zeroes.
    expect(ids.length).toBeGreaterThan(100);
  });

  it("(1) every omitted ABILITY name is one the REGISTRY authors under that name", () => {
    const unauthored: string[] = [];
    let checked = 0;
    for (const id of Object.keys(M.printed)) {
      const d = diffOf(id);
      if (d.abilities.length === 0) continue;
      const program = programFor(id);
      const authored = [
        ...(program?.abilities ?? []).map((a) => a.name),
        ...(program?.triggered ?? []).map((a) => a.name),
      ];
      for (const name of d.abilities) {
        if (authored.includes(name)) {
          checked++;
          continue;
        }
        unauthored.push(id);
        expect(
          ABILITY_NOT_NAMED_IN_REGISTRY[id],
          `${id} (${M.printed[id]?.name}) omits printed Ability "${name}" and the registry authors no program under that name — carry the Ability or say why it cannot be checked`,
        ).toBeDefined();
      }
    }
    expect([...new Set(unauthored)].sort()).toEqual(
      Object.keys(ABILITY_NOT_NAMED_IN_REGISTRY).sort(),
    );
    expect(checked).toBeGreaterThan(0);
    for (const [id, why] of Object.entries(ABILITY_NOT_NAMED_IN_REGISTRY)) {
      expect(why.length, `${id} needs a real reason`).toBeGreaterThan(30);
    }
    // …and the three `passive` ones are checked one level weaker rather than not
    // at all: the card must carry a registry passive, which is the datum that
    // exists. The two with no program are named above and excluded here.
    for (const id of Object.keys(ABILITY_NOT_NAMED_IN_REGISTRY)) {
      const program = programFor(id);
      if (program === undefined) {
        expect(
          ABILITY_NOT_NAMED_IN_REGISTRY[id],
          `${id} has no registry program and must say so`,
        ).toContain("NO registry program");
        continue;
      }
      expect(
        program.passive,
        `${id} declares an unnameable Ability but carries no passive`,
      ).toBeDefined();
    }
  });

  it("(1, attack side) an omitted ATTACK is a WHOLLY attackless body on a card the registry drives", () => {
    const partial: string[] = [];
    const noProgram: string[] = [];
    let checked = 0;
    for (const id of Object.keys(M.printed)) {
      const d = diffOf(id);
      if (d.attacks.length === 0) continue;
      const carried = (FIXTURE_POOL[id]?.attacks ?? []).length;
      if (carried > 0)
        partial.push(
          `${id} carries ${carried} of its printed attacks and drops ${JSON.stringify(d.attacks)}`,
        );
      const program = programFor(id);
      if (program === undefined) {
        noProgram.push(id);
        expect(
          ATTACK_OMITTED_WITH_NO_PROGRAM[id],
          `${id} (${M.printed[id]?.name}) drops a printed attack and the registry drives nothing on it — carry the attack or say why`,
        ).toBeDefined();
        continue;
      }
      const drives =
        (program.abilities?.length ?? 0) > 0 ||
        (program.triggered?.length ?? 0) > 0 ||
        program.passive !== undefined;
      expect(
        drives,
        `${id} has a registry program that authors no Ability, trigger or passive`,
      ).toBe(true);
      checked++;
    }
    // A fixture may drop ALL of a card's attacks or NONE of them. Never some.
    expect(partial).toEqual([]);
    expect(noProgram.sort()).toEqual(Object.keys(ATTACK_OMITTED_WITH_NO_PROGRAM).sort());
    for (const [id, why] of Object.entries(ATTACK_OMITTED_WITH_NO_PROGRAM)) {
      expect(why.length, `${id} needs a real reason`).toBeGreaterThan(30);
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe("(d) a fixture attack sits at its PRINTED index unless the shift is declared", () => {
  it("no fixture is reindexed, and the table agrees", () => {
    const shifted = Object.keys(M.printed).filter((id) => {
      const names = (FIXTURE_POOL[id]?.attacks ?? []).map((a) => a.name);
      return names.some((n, i) => M.printed[id]?.attacks[i] !== n);
    });
    const declared = Object.entries(INCOMPLETE)
      .filter(([, e]) => e.reindexed === true)
      .map(([id]) => id);
    expect(shifted.sort()).toEqual(declared.sort());
    expect(shifted).toEqual([]);
  });

  it("a registry-authored attack index always points at the attack the card prints there", () => {
    let checked = 0;
    for (const id of Object.keys(M.printed)) {
      const authored = programFor(id)?.attack;
      if (authored === undefined) continue;
      const fixture = FIXTURE_POOL[id];
      const printed = M.printed[id];
      for (const key of Object.keys(authored)) {
        const index = Number(key);
        const carried = (fixture?.attacks ?? [])[index];
        expect(
          carried,
          `${id} authors attack ${index} and the fixture has none there`,
        ).toBeDefined();
        expect(
          printed?.attacks[index],
          `${id} authors attack ${index} and the card prints none there`,
        ).toBeDefined();
        expect(carried?.name, `${id} attack ${index}`).toBe(printed?.attacks[index]);
        checked++;
      }
    }
    // The sweep read something — an empty registry would satisfy the loop above.
    expect(checked).toBeGreaterThan(0);
  });
});

describe("(e) every catalog count in the engine sources is MEASURED and SCOPED", () => {
  it("no two catalog states agree on ROWS and disagree on SETS — the collision the Map would swallow", () => {
    const owed = new Map<number, { sets: number; population: string }>();
    for (const state of CATALOG_STATE_LIST) {
      const seen = owed.get(state.rows);
      if (seen === undefined) {
        owed.set(state.rows, state);
        continue;
      }
      expect(
        state.sets,
        `two catalog states claim ${state.rows} rows with different set counts — "${seen.population}" owes ${seen.sets}, "${state.population}" owes ${state.sets}`,
      ).toBe(seen.sets);
    }
    // …and the derived lookup must not have lost a state to that collapse.
    expect(CATALOG_STATES.size).toBe(owed.size);
    expect(CATALOG_STATES.size).toBe(3);
    for (const sets of CATALOG_STATES.values()) expect(sets).toBeGreaterThan(0);
  });
});

describe("the set the catalog LOST AND GOT BACK is recorded as HISTORY", () => {
  it("the restored set reconciles the shrunken catalog on FOUR independent axes", () => {
    const { contributes, shrunken } = M.history;
    const six = M.sixSet;
    expect(six.rows - contributes.rows).toBe(shrunken.rows);
    expect(six.legalStandardZero - contributes.legalStandardZero).toBe(shrunken.legalStandardZero);
    expect(six.textColumns.attacksJson - contributes.rowsWithAttacks).toBe(
      shrunken.rowsWithAttacks,
    );
    expect(six.straightApostropheInAttacks - contributes.straightApostropheInAttacks).toBe(
      shrunken.straightApostropheInAttacks,
    );
    expect(six.sets.length - 1).toBe(shrunken.setCount);
  });

  it("the set is back in `cards`, `sets` AND `series` — a structural restore, not a filter", () => {
    expect(M.sets[M.history.set]).toBe(M.history.contributes.rows);
    expect(M.serieRows).toBe(3);
    expect(M.setRows).toBe(Object.keys(M.sets).length);
  });

  it("NO fixture is without a catalog row — the twelve became checkable at D160", () => {
    expect([...M.absent]).toEqual([]);
    expect(Object.keys(M.printed).length).toBe(
      Object.keys(FIXTURE_POOL).filter((id) => REAL_ID.test(id)).length,
    );
  });

  it("names the decisions whose censuses ran against the SHRUNKEN catalog", () => {
    expect(M.history.censusedInTheGap.length).toBeGreaterThan(0);
    expect([...M.history.censusedInTheGap]).toContain("D159");
    expect(M.history.lastSeen < M.history.firstMissing).toBe(true);
    expect(M.history.firstMissing <= M.history.restored).toBe(true);
  });
});
