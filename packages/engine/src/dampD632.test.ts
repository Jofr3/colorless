import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import manifest from "../package.json" with { type: "json" };
import { disabledAbilityUids, hasSelfKnockOutAbility } from "./continuous";
import { applyAction, createGame, engineVersion } from "./index";
import type { GameState, Seat } from "./index";
import { programFor, registryCardIds } from "./registry";
import { FIXTURE_POOL, battler, benchFromDeck, clearBench, deckOf, setActiveFromDeck, typedEnergy } from "./testFixtures";

// ── 🆕🆕🆕 D632 — D1, DAMP: 2 TEXTS / 5 `me` PRINTINGS ──
//
// Psyduck `me02.5-039` / `-226` and Golduck `me02.5-040`: *"Pokémon in play (both yours and your opponent's) lose any
// Ability that requires the Pokémon using it to Knock Out itself."* Psyduck `mep-007` and Golduck `mep-008`:
// *"Pokémon in play (both yours and your opponent's) lose all Abilities that require those Pokémon to be Knocked
// Out."* Two NEW objects (one per wording) on the NEW `disableAbilities.selfKnockOutAbility`; the mep wording is
// read as the same class (R-DMP1 ⚠️ UNRULED). Every id and text off the LOCAL D1
// (`apps/api/.wrangler/…/8437d866….sqlite`), 2026-10-10, `legal_standard = 1`. Before this slice the ids appeared
// only in D598's unkeyed pin. Driven on a LOCAL `cardPool` (D275) in the suite's OWN 60-card deck (D270).
//
// THE CLASS, MEASURED ON THE LOCAL D1 (every `abilities_json` effect naming a Knock Out, both corpora, 2026-10-10):
// only three printed texts make their user Knock Itself Out — Cursed Blast at 5 (Dusclops `sv06.5-019` / `-069`,
// `sv08.5-036`) and at 13 (Dusknoir `sv06.5-020` / `-070`, `sv08.5-037`) and Overvolt Discharge (Magneton `svp-153`
// / `-159`, `sv08-059`): 9 printings, all legal, all built on `knockOutSelf`. Forretress ex "Exploding Energy"
// (`sv02-005` / `-230`, `sv04.5-002` / `-212`) prints the class too, but none of its 4 printings is legal and it
// is not built. `me` prints no member. Every other Knock Out wording answers a Knock Out (Fainting Spell, Final
// Chain, Photon Cord, Fragile Husk, Shadowy Concealment, the "(even if this Pokémon is Knocked Out)" recoils, …)
// or survives one (Tenacious Body, Sturdy, Resolute Heart): none is used by Knocking Out its user.

const DAMP_ITSELF_TEXT =
  "Pokémon in play (both yours and your opponent's) lose any Ability that requires the Pokémon using it to Knock Out itself.";
const DAMP_REQUIRE_TEXT =
  "Pokémon in play (both yours and your opponent's) lose all Abilities that require those Pokémon to be Knocked Out.";
const CURSED_5_TEXT =
  "Once during your turn, you may put 5 damage counters on 1 of your opponent's Pokémon. If you use this Ability, this Pokémon is Knocked Out.";
const CURSED_13_TEXT =
  "Once during your turn, you may put 13 damage counters on 1 of your opponent's Pokémon. If you use this Ability, this Pokémon is Knocked Out.";
const OVERVOLT_TEXT =
  "Once during your turn, you may attach up to 3 Basic Energy cards from your discard pile to your {L} Pokémon in any way you like. If you use this Ability, this Pokémon is Knocked Out.";

const ITSELF = ["me02.5-039", "me02.5-040", "me02.5-226"] as const; // Psyduck, Golduck, Psyduck
const REQUIRE = ["mep-007", "mep-008"] as const; // Psyduck, Golduck
const DAMP_IDS = [...ITSELF, ...REQUIRE] as const;
const PSYDUCK = "me02.5-039";
const PSYDUCK_MEP = "mep-007";

const DUSCLOPS_IDS = ["sv06.5-019", "sv06.5-069", "sv08.5-036"] as const;
const DUSKNOIR_IDS = ["sv06.5-020", "sv06.5-070", "sv08.5-037"] as const;
const MAGNETON_IDS = ["svp-153", "svp-159", "sv08-059"] as const;
const SELF_KO_IDS = [...DUSCLOPS_IDS, ...DUSKNOIR_IDS, ...MAGNETON_IDS] as const;
const DUSCLOPS = "sv06.5-019";
const DUSKNOIR = "sv06.5-020";
const MAGNETON = "sv08-059";
const FORRETRESS_EX = ["sv02-005", "sv02-230", "sv04.5-002", "sv04.5-212"] as const;

const GENGAR_EX = "30th-090"; // "Fainting Spell" — an Ability that ANSWERS a Knock Out (R-DMP1's control)
const FLUTTER = "sv05-078"; // "Midnight Fluttering" — a lock that reaches an opposing Active Psyduck
const WALL = "d632-wall";
const L = "d632-lightning";

const psyduck = (id: string, text: string): Card =>
  battler(id, {
    name: "Psyduck",
    hp: 70,
    types: ["Water"],
    retreat: 1,
    weaknesses: [{ type: "Lightning", value: "×2" }],
    abilities: [{ type: "Ability", name: "Damp", effect: text }],
    attacks: [{ cost: ["Colorless", "Colorless"], name: id.startsWith("mep") ? "Collision" : "Ram", damage: 20 }],
  } as Partial<Card>);
const golduck = (id: string, text: string): Card =>
  battler(id, {
    name: "Golduck",
    stage: "Stage1",
    evolveFrom: "Psyduck",
    hp: 120,
    types: ["Water"],
    retreat: 1,
    weaknesses: [{ type: "Lightning", value: "×2" }],
    abilities: [{ type: "Ability", name: "Damp", effect: text }],
    attacks: [
      {
        cost: ["Colorless", "Colorless", "Colorless"],
        name: "Hydro Pump",
        damage: "60+",
        effect: "This attack does 20 more damage for each {W} Energy attached to this Pokémon.",
      },
    ],
  } as Partial<Card>);

const LOCAL_CARDS: Record<string, Card> = {
  "me02.5-039": psyduck("me02.5-039", DAMP_ITSELF_TEXT),
  "me02.5-040": golduck("me02.5-040", DAMP_ITSELF_TEXT),
  "me02.5-226": psyduck("me02.5-226", DAMP_ITSELF_TEXT),
  "mep-007": psyduck("mep-007", DAMP_REQUIRE_TEXT),
  "mep-008": golduck("mep-008", DAMP_REQUIRE_TEXT),
  [DUSCLOPS]: battler(DUSCLOPS, {
    name: "Dusclops",
    stage: "Stage1",
    evolveFrom: "Duskull",
    hp: 90,
    types: ["Psychic"],
    retreat: 2,
    abilities: [{ type: "Ability", name: "Cursed Blast", effect: CURSED_5_TEXT }],
    attacks: [{ cost: ["Psychic", "Psychic"], name: "Will-O-Wisp", damage: 50 }],
  } as Partial<Card>),
  [DUSKNOIR]: battler(DUSKNOIR, {
    name: "Dusknoir",
    stage: "Stage2",
    evolveFrom: "Dusclops",
    hp: 160,
    types: ["Psychic"],
    retreat: 3,
    abilities: [{ type: "Ability", name: "Cursed Blast", effect: CURSED_13_TEXT }],
    attacks: [
      {
        cost: ["Psychic", "Psychic", "Colorless"],
        name: "Shadow Bind",
        damage: 150,
        effect: "During your opponent's next turn, the Defending Pokémon can't retreat.",
      },
    ],
  } as Partial<Card>),
  [MAGNETON]: battler(MAGNETON, {
    name: "Magneton",
    stage: "Stage1",
    evolveFrom: "Magnemite",
    hp: 100,
    types: ["Lightning"],
    retreat: 1,
    abilities: [{ type: "Ability", name: "Overvolt Discharge", effect: OVERVOLT_TEXT }],
    attacks: [{ cost: ["Lightning", "Colorless"], name: "Electric Ball", damage: 40 }],
  } as Partial<Card>),
  [GENGAR_EX]: battler(GENGAR_EX, {
    name: "Gengar ex",
    hp: 280,
    types: ["Darkness"],
    retreat: 2,
    suffix: "ex",
    abilities: [
      {
        type: "Ability",
        name: "Fainting Spell",
        effect:
          "If this Pokémon is Knocked Out by damage from an attack from your opponent's Pokémon, flip a coin. If heads, the Attacking Pokémon is Knocked Out.",
      },
    ],
    attacks: [
      { cost: ["Darkness", "Darkness"], name: "Chaotic Pain", effect: "Place 13 damage counters on 1 of your opponent's Pokémon." },
    ],
  } as Partial<Card>),
  [FLUTTER]: battler(FLUTTER, {
    name: "Flutter Mane",
    hp: 90,
    types: ["Psychic"],
    abilities: [
      {
        type: "Ability",
        name: "Midnight Fluttering",
        effect:
          "As long as this Pokémon is in the Active Spot, your opponent's Active Pokémon has no Abilities, except for Midnight Fluttering.",
      },
    ],
    attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
  } as Partial<Card>),
  [WALL]: battler(WALL, { name: "D632 Wall", types: ["Colorless"], hp: 300 }),
  [L]: typedEnergy(L, "Lightning"),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

/** Its OWN deck (D270), 60 by construction. */
const DECK = deckOf({
  "me02.5-039": 2,
  "me02.5-040": 2,
  "me02.5-226": 2,
  "mep-007": 2,
  "mep-008": 2,
  [DUSCLOPS]: 3,
  [DUSKNOIR]: 3,
  [MAGNETON]: 2,
  [GENGAR_EX]: 2,
  [FLUTTER]: 2,
  [WALL]: 20,
  [L]: 18,
});

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

/** Setup with p1 going first; returns p1's first turn, both hands back into the decks. */
function opened(): GameState {
  const created = createGame({ seed: 6320, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first: "p1" }));
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
  for (const s of ["p1", "p2"] as const) {
    const side = state.players[s];
    state = { ...state, players: { ...state.players, [s]: { ...side, hand: [], deck: [...side.deck, ...side.hand] } } };
  }
  return state;
}

/** p1's first turn: each side's Active first, then its Bench, EXACTLY the ids named. */
function table(spec: { p1: readonly string[]; p2: readonly string[] }): GameState {
  let state = opened();
  for (const seat of ["p1", "p2"] as const) state = clearBench(setActiveFromDeck(state, seat, WALL), seat);
  for (const seat of ["p1", "p2"] as const) {
    const ids = spec[seat];
    state = clearBench(setActiveFromDeck(state, seat, ids[0] ?? WALL), seat);
    for (const id of ids.slice(1)) state = benchFromDeck(state, seat, id);
  }
  return state;
}

function uidAt(state: GameState, seat: Seat, index: number | "active"): string {
  const side = state.players[seat];
  const body = index === "active" ? side.active : side.bench[index];
  const uid = body?.stack.at(-1);
  if (uid === undefined) throw new Error(`${seat} has no body at ${index}`);
  return uid;
}

function use(state: GameState, index: number | "active", abilityName: string) {
  const target = index === "active" ? ({ spot: "active" } as const) : ({ spot: "bench", index } as const);
  return applyAction(state, { type: "useAbility", seat: "p1", target, abilityName });
}

const asCard = (id: string): Card => ({ id }) as Card;

describe("D632 §1 — the five registry rows on two objects", () => {
  it("each wording is ONE object; the two wordings are two objects of the same shape", () => {
    const itself = programFor(ITSELF[0]);
    const require = programFor(REQUIRE[0]);
    for (const id of ITSELF) expect(programFor(id), id).toBe(itself);
    for (const id of REQUIRE) expect(programFor(id), id).toBe(require);
    expect(itself).not.toBe(require);
    for (const program of [itself, require]) {
      expect(program).toEqual({ passive: { disableAbilities: { side: "both", selfKnockOutAbility: true } } });
    }
  });

  it("the fixtures carry the printed texts, one Ability named Damp each", () => {
    for (const id of ITSELF) expect(LOCAL_CARDS[id]?.abilities, id).toEqual([{ type: "Ability", name: "Damp", effect: DAMP_ITSELF_TEXT }]);
    for (const id of REQUIRE) expect(LOCAL_CARDS[id]?.abilities, id).toEqual([{ type: "Ability", name: "Damp", effect: DAMP_REQUIRE_TEXT }]);
  });
});

describe("D632 §2 — the class, measured over the registry", () => {
  it("`hasSelfKnockOutAbility` holds for EXACTLY the 9 Cursed Blast / Overvolt Discharge keys", () => {
    expect(registryCardIds().filter((id) => hasSelfKnockOutAbility(asCard(id))).sort()).toEqual([...SELF_KO_IDS].sort());
  });

  it("no `knockOutSelf` sits deeper, or in a `triggered` or `passive` program, anywhere in the registry", () => {
    const anywhere = registryCardIds().filter((id) => {
      const program = programFor(id);
      return JSON.stringify([program?.abilities, program?.triggered, program?.passive]).includes('"op":"knockOutSelf"');
    });
    expect(anywhere.sort()).toEqual([...SELF_KO_IDS].sort());
  });

  it("🛑 the lock is by BODY, which is exact: each holder of the class prints that ONE Ability and nothing else", () => {
    for (const id of SELF_KO_IDS) {
      expect(Object.keys(programFor(id) ?? {}), id).toEqual(["abilities"]);
      expect(programFor(id)?.abilities, id).toHaveLength(1);
    }
  });

  it("Forretress ex \"Exploding Energy\" prints the class but is not built (not legal)", () => {
    for (const id of FORRETRESS_EX) expect(programFor(id), id).toBeUndefined();
  });

  it("R-DMP1: an Ability that ANSWERS a Knock Out, or survives one, is not in the class", () => {
    for (const id of [
      "30th-090", // Gengar ex "Fainting Spell"
      "me02.5-143", // Pecharunt "Final Chain"
      "me05-028", // Miraidon "Photon Cord"
      "me01-061", // Shedinja "Fragile Husk"
      "me02-056", // Mega Gengar ex "Shadowy Concealment"
      "me02.5-116", // Mega Hawlucha ex "Tenacious Body"
      "me02.5-068", // Hop's Pincurchin ex "Counterattack Quills"
    ]) {
      expect(programFor(id), id).toBeDefined();
      expect(hasSelfKnockOutAbility(asCard(id)), id).toBe(false);
    }
    // And no Damp printing is in its own class.
    for (const id of DAMP_IDS) expect(hasSelfKnockOutAbility(asCard(id)), id).toBe(false);
  });
});

describe("D632 §3 — Damp on a board", () => {
  it("with no Damp in play nothing is locked", () => {
    const state = table({ p1: [DUSCLOPS, DUSKNOIR, MAGNETON], p2: [WALL, DUSCLOPS] });
    expect(disabledAbilityUids(state)).toEqual(new Set());
  });

  it("an Active Damp locks every self-Knock-Out body on BOTH sides, and nothing else", () => {
    const state = table({ p1: [PSYDUCK, DUSKNOIR, MAGNETON, GENGAR_EX], p2: [WALL, DUSCLOPS, GENGAR_EX] });
    expect(disabledAbilityUids(state)).toEqual(
      new Set([uidAt(state, "p1", 0), uidAt(state, "p1", 1), uidAt(state, "p2", 0)]),
    );
  });

  it("each of the five printings locks from the BENCH, on its own side and the other", () => {
    for (const id of DAMP_IDS) {
      const state = table({ p1: [WALL, id, DUSCLOPS], p2: [DUSKNOIR, GENGAR_EX] });
      expect(disabledAbilityUids(state), id).toEqual(new Set([uidAt(state, "p1", 1), uidAt(state, "p2", "active")]));
    }
  });

  it("the mep wording (R-DMP1) leaves Fainting Spell on: Gengar ex keeps its Ability", () => {
    const state = table({ p1: [PSYDUCK_MEP, GENGAR_EX], p2: [GENGAR_EX, DUSCLOPS] });
    const locked = disabledAbilityUids(state);
    expect(locked.has(uidAt(state, "p1", 0))).toBe(false);
    expect(locked.has(uidAt(state, "p2", "active"))).toBe(false);
    expect(locked.has(uidAt(state, "p2", 0))).toBe(true);
  });
});

describe("D632 §4 — through the §9 gate: Cursed Blast and Overvolt Discharge are refused", () => {
  it("Cursed Blast is refused ABILITY_DISABLED under each wording, and accepted without Damp", () => {
    for (const damp of [PSYDUCK, PSYDUCK_MEP]) {
      const locked = use(table({ p1: [damp, DUSCLOPS], p2: [WALL] }), 0, "Cursed Blast");
      expect(locked.ok, damp).toBe(false);
      if (!locked.ok) expect(locked.error.code, damp).toBe("ABILITY_DISABLED");
    }
    const free = use(table({ p1: [WALL, DUSCLOPS], p2: [WALL] }), 0, "Cursed Blast");
    expect(free.ok).toBe(true);
  });

  it("an OPPONENT's Damp refuses your Dusknoir too (both sides)", () => {
    const result = use(table({ p1: [DUSKNOIR], p2: [WALL, "me02.5-226"] }), "active", "Cursed Blast");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("ABILITY_DISABLED");
  });

  it("Overvolt Discharge is refused ABILITY_DISABLED under Golduck's Damp", () => {
    for (const damp of ["me02.5-040", "mep-008"]) {
      const result = use(table({ p1: [MAGNETON, damp], p2: [WALL] }), "active", "Overvolt Discharge");
      expect(result.ok, damp).toBe(false);
      if (!result.ok) expect(result.error.code, damp).toBe("ABILITY_DISABLED");
    }
  });
});

describe("D632 §5 — Damp in the stratified lock pass (R-LK2)", () => {
  it("an Active Flutter Mane silences the opposing Active Psyduck, so Damp is OFF and Cursed Blast is accepted", () => {
    const state = table({ p1: [PSYDUCK, DUSCLOPS], p2: [FLUTTER] });
    expect(disabledAbilityUids(state)).toEqual(new Set([uidAt(state, "p1", "active")]));
    expect(use(state, 0, "Cursed Blast").ok).toBe(true);
  });

  it("the same board with Flutter Mane BENCHED: Midnight Fluttering is off, so Damp locks", () => {
    const state = table({ p1: [PSYDUCK, DUSCLOPS], p2: [WALL, FLUTTER] });
    expect(disabledAbilityUids(state)).toEqual(new Set([uidAt(state, "p1", 0)]));
  });

  it("a benched Psyduck is out of Flutter Mane's reach: Damp stays ON beside a silenced Active", () => {
    const state = table({ p1: [GENGAR_EX, PSYDUCK, DUSCLOPS], p2: [FLUTTER] });
    expect(disabledAbilityUids(state)).toEqual(new Set([uidAt(state, "p1", "active"), uidAt(state, "p1", 1)]));
  });
});

describe("D632 §6 — the version", () => {
  it("is built at engine 0.534.0, in BOTH places", () => {
    expect(engineVersion).toBe("0.534.0");
    expect(manifest.version).toBe("0.534.0");
  });
});
