import type { Card } from "@luminous/schema";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { matchesFilter, topCardOf } from "./cards";
import { effectiveTypesOf, inPlayCardOf, preventsAttackerType } from "./continuous";
import type { GameEvent } from "./events";
import { applyAction, createGame, engineVersion } from "./index";
import type { GameAction, GameState, Seat } from "./index";
import { attachEnergyTargets, conditionHolds, runProgram } from "./interpreter";
import { programFor, registryCardIds } from "./registry";
import { FIXTURE_POOL, battler, deckOf } from "./testFixtures";
import { type InPlayPokemon, makeInPlay } from "./types";

// ── 🆕🆕🆕 D578 — SCOVILLAIN ex `sv08-037` / `sv08-216` "DOUBLE TYPE" ──
//
// *"As long as this Pokémon is in play, it is {G} and {R} type."* ONE passive key,
// `PassiveEffects.typesInPlay` (`["Grass", "Fire"]`), read by ONE function, continuous.ts
// `inPlayCardOf` — the in-play view of the TOP card every in-play type read now resolves
// through. A §9 lock hands back the printed {R}; the hand, deck and discard stay printed.
// The Watchtower's {C} read stays PRINTED (R-WT1, annotated), exact because no retype names {C}.
//
// The Scovillain ex here is a LOCAL face on the real id: its printed card (types, HP, Weakness,
// "Spicy Rage") plus a test-only second attack "Test Strike" ({}, 50) so the §8.5 arithmetic is
// readable. The defenders are local bodies with the Weakness / Resistance each rung needs.

const SCOVILLAIN = "sv08-037";
const SCOVILLAIN_ALT = "sv08-216";
const CAPSAKID = "d578s-capsakid";
const IRON_THORNS = "sv06-077";
const WEAK_G = "d578s-weak-grass";
const WEAK_R = "d578s-weak-fire";
const WEAK_GR = "d578s-weak-both";
const RES_GR = "d578s-resist-both";
const PLAIN = "d578s-plain";
const FILLER = "d578s-filler";

const scovillainFace = (id: string): Card =>
  battler(id, {
    name: "Scovillain ex",
    stage: "Stage1",
    evolveFrom: "Capsakid",
    hp: 260,
    types: ["Fire"],
    retreat: 2,
    weaknesses: [{ type: "Water", value: "×2" }],
    abilities: [
      { type: "Ability", name: "Double Type", effect: "As long as this Pokémon is in play, it is {G} and {R} type." },
    ],
    attacks: [
      {
        cost: ["Fire", "Fire"],
        name: "Spicy Rage",
        damage: "10+",
        effect: "This attack does 70 more damage for each damage counter on this Pokémon.",
      },
      { cost: [], name: "Test Strike", damage: 50 },
    ],
  });

const defender = (id: string, extra: Partial<Card>): Card =>
  battler(id, { name: id, hp: 900, types: ["Colorless"], attacks: [{ cost: [], name: "Tap", damage: 10 }], ...extra });

const LOCAL_CARDS: Record<string, Card> = {
  [SCOVILLAIN]: scovillainFace(SCOVILLAIN),
  [SCOVILLAIN_ALT]: scovillainFace(SCOVILLAIN_ALT),
  [CAPSAKID]: battler(CAPSAKID, { name: "Capsakid", hp: 70, types: ["Fire"] }),
  // Iron Thorns ex "Initialization" (Active: Rule Box Pokémon have no Abilities, except Future
  // Pokémon) — a LOCAL face with a test-only {G} Weakness, so the lock's effect on §8.5 shows.
  [IRON_THORNS]: defender(IRON_THORNS, {
    name: "Iron Thorns ex",
    hp: 900,
    types: ["Lightning"],
    weaknesses: [{ type: "Grass", value: "×2" }],
    abilities: [
      {
        type: "Ability",
        name: "Initialization",
        effect:
          "As long as this Pokémon is in the Active Spot, Pokémon with a Rule Box in play (both yours and your opponent's) have no Abilities, except for Future Pokémon. (Pokémon ex, Pokémon V, etc. have Rule Boxes.)",
      },
    ],
  }),
  [WEAK_G]: defender(WEAK_G, { weaknesses: [{ type: "Grass", value: "×2" }] }),
  [WEAK_R]: defender(WEAK_R, { weaknesses: [{ type: "Fire", value: "×2" }] }),
  [WEAK_GR]: defender(WEAK_GR, {
    weaknesses: [
      { type: "Grass", value: "×2" },
      { type: "Fire", value: "×2" },
    ],
  }),
  [RES_GR]: defender(RES_GR, {
    resistances: [
      { type: "Grass", value: "-30" },
      { type: "Fire", value: "-30" },
    ],
  }),
  [PLAIN]: defender(PLAIN, {}),
  [FILLER]: defender(FILLER, { retreat: 1 }),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const DECK = deckOf({
  [SCOVILLAIN]: 2,
  [SCOVILLAIN_ALT]: 1,
  [CAPSAKID]: 2,
  [IRON_THORNS]: 1,
  [WEAK_G]: 1,
  [WEAK_R]: 1,
  [WEAK_GR]: 1,
  [RES_GR]: 1,
  [PLAIN]: 2,
  [FILLER]: 28,
  "fix-energy": 20,
});

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

function run(state: GameState, action: GameAction): { state: GameState; events: GameEvent[] } {
  const result = applyAction(state, action);
  if (!result.ok) throw new Error(`${action.type} rejected: ${result.error.code}: ${result.error.message}`);
  return { state: result.state, events: result.events };
}

function opened(seed: number): GameState {
  const created = createGame({ seed, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
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
  return must(applyAction(state, { type: "endTurn", seat: "p2" }));
}

function withSide(state: GameState, seat: Seat, patch: Partial<GameState["players"]["p1"]>): GameState {
  return { ...state, players: { ...state.players, [seat]: { ...state.players[seat], ...patch } } };
}

function pull(state: GameState, seat: Seat, id: string): { state: GameState; uid: string } {
  const side = state.players[seat];
  const is = (u: string) => state.cardIdByUid[u] === id;
  const zone = (["deck", "hand", "prizes"] as const).find((z) => side[z].some(is));
  if (zone === undefined) throw new Error(`${seat} has no ${id}`);
  const uid = side[zone].find(is) ?? "";
  if (zone === "prizes") {
    const swap = side.deck.find((u) => !is(u)) ?? "";
    return {
      uid,
      state: withSide(state, seat, {
        prizes: side.prizes.map((u) => (u === uid ? swap : u)),
        deck: side.deck.filter((u) => u !== swap),
      }),
    };
  }
  return { uid, state: withSide(state, seat, { [zone]: side[zone].filter((u) => u !== uid) }) };
}

interface Spot {
  id: string;
  under?: readonly string[];
  damage?: number;
}

/** p1's turn 2: each seat's Active and Bench built from `Spot`s (an evolved body carries its
    `under` cards beneath the top), every hand emptied back into the deck. */
function table(opts: { p1: Spot; p1Bench?: readonly Spot[]; p2: Spot; p2Bench?: readonly Spot[] }): GameState {
  let state = opened(5781);
  for (const seat of ["p1", "p2"] as const) {
    const side = state.players[seat];
    const back = [
      ...side.hand,
      ...(side.active === null ? [] : [...side.active.stack, ...side.active.energy]),
      ...side.bench.flatMap((p) => [...p.stack, ...p.energy]),
    ];
    state = withSide(state, seat, { hand: [], active: null, bench: [], deck: [...side.deck, ...back] });
  }
  const body = (seat: Seat, spot: Spot): InPlayPokemon => {
    const stack: string[] = [];
    for (const id of [...(spot.under ?? []), spot.id]) {
      const pulled = pull(state, seat, id);
      state = pulled.state;
      stack.push(pulled.uid);
    }
    return { ...makeInPlay(stack[0] ?? "", 0), stack, damage: spot.damage ?? 0 };
  };
  for (const seat of ["p1", "p2"] as const) {
    const active = body(seat, seat === "p1" ? opts.p1 : opts.p2);
    const bench = (seat === "p1" ? (opts.p1Bench ?? []) : (opts.p2Bench ?? [])).map((s) => body(seat, s));
    state = withSide(state, seat, { active, bench });
  }
  return state;
}

function damageRow(events: readonly GameEvent[]): Extract<GameEvent, { type: "DAMAGE_DEALT" }> {
  const row = events.find((e): e is Extract<GameEvent, { type: "DAMAGE_DEALT" }> => e.type === "DAMAGE_DEALT");
  if (row === undefined) throw new Error("no DAMAGE_DEALT");
  return row;
}

const SCOV_SPOT: Spot = { id: SCOVILLAIN, under: [CAPSAKID] };

describe("D578 Scovillain §0 — the version", () => {
  it("is built at engine 0.503.0", () => {
    expect(engineVersion).toBe("0.503.0");
  });
});

describe("D578 Scovillain §1 — the registry row", () => {
  it("both printings carry the ONE object: `typesInPlay` [Grass, Fire], no attack key (Spicy Rage keeps deriving)", () => {
    expect(programFor(SCOVILLAIN)).toEqual({ passive: { typesInPlay: ["Grass", "Fire"] } });
    expect(programFor(SCOVILLAIN_ALT)).toBe(programFor(SCOVILLAIN));
  });

  it("the excluded mark-G printing sv05-022 is NOT registered", () => {
    expect(programFor("sv05-022")).toBeUndefined();
  });
});

describe("D578 Scovillain §2 — `inPlayCardOf`: in play it is {G} and {R}, Active and Bench alike", () => {
  it("the Active and a Benched Scovillain ex both read [Grass, Fire]; the printed card stays [Fire]", () => {
    const state = table({ p1: SCOV_SPOT, p1Bench: [{ id: SCOVILLAIN_ALT, under: [CAPSAKID] }], p2: { id: PLAIN } });
    const active = state.players.p1.active as InPlayPokemon;
    const bench = state.players.p1.bench[0] as InPlayPokemon;
    expect(effectiveTypesOf(state, active)).toEqual(["Grass", "Fire"]);
    expect(effectiveTypesOf(state, bench)).toEqual(["Grass", "Fire"]);
    expect(POOL[SCOVILLAIN]?.types).toEqual(["Fire"]);
    // The view is the card's own in every other field.
    const view = inPlayCardOf(state, active);
    expect(view?.id).toBe(SCOVILLAIN);
    expect(view?.attacks).toEqual(POOL[SCOVILLAIN]?.attacks);
    expect(view?.weaknesses).toEqual(POOL[SCOVILLAIN]?.weaknesses);
  });

  it("a body WITHOUT the key is handed the catalog card itself (identity — every pre-D578 board reads what it read)", () => {
    const state = table({ p1: { id: PLAIN }, p2: { id: WEAK_G } });
    const active = state.players.p1.active as InPlayPokemon;
    expect(inPlayCardOf(state, active)).toBe(topCardOf(state, active));
    expect(effectiveTypesOf(state, active)).toEqual(["Colorless"]);
  });

  it("the HAND card is printed — 'As long as this Pokémon is in play': a {G} filter refuses it", () => {
    expect(matchesFilter(POOL[SCOVILLAIN], { kind: "typedPokemon", pokemonType: "Grass" })).toBe(false);
    expect(matchesFilter(POOL[SCOVILLAIN], { kind: "typedPokemon", pokemonType: "Fire" })).toBe(true);
  });
});

describe("D578 Scovillain §3 — Weakness and Resistance (§8.5): each applies ONCE", () => {
  const strike = (def: string, attacker: Spot = SCOV_SPOT) => {
    const state = table({ p1: attacker, p2: { id: def } });
    return damageRow(run(state, { type: "attack", seat: "p1", index: 1 }).events);
  };

  it("a {G}-Weakness defender takes ×2 from Scovillain ex (the {G} it IS in play)", () => {
    const row = strike(WEAK_G);
    expect(row.weakness).toEqual({ op: "multiply", amount: 2 });
    expect(row.dealt).toBe(100);
  });

  it("a {R}-Weakness defender takes ×2 (the printed type still counts)", () => {
    const row = strike(WEAK_R);
    expect(row.weakness).toEqual({ op: "multiply", amount: 2 });
    expect(row.dealt).toBe(100);
  });

  it("a defender weak to BOTH {G} and {R} takes ×2 ONCE — `weakResModifier` returns on the first match", () => {
    const row = strike(WEAK_GR);
    expect(row.weakness).toEqual({ op: "multiply", amount: 2 });
    expect(row.dealt).toBe(100);
  });

  it("a defender resisting BOTH {G} and {R} takes −30 ONCE", () => {
    const row = strike(RES_GR);
    expect(row.resistance).toEqual({ op: "subtract", amount: 30 });
    expect(row.dealt).toBe(20);
  });

  it("a plain defender takes the printed 50 (control)", () => {
    const row = strike(PLAIN);
    expect(row.weakness).toBeNull();
    expect(row.dealt).toBe(50);
  });
});

describe("D578 Scovillain §4 — the type-keyed reads see {G} and {R}", () => {
  it("`preventsAttackerType` — a {G} shield refuses the in-play Scovillain ex, the printed card passes it", () => {
    const state = table({ p1: SCOV_SPOT, p2: { id: PLAIN } });
    const active = state.players.p1.active as InPlayPokemon;
    expect(preventsAttackerType(["Grass"], inPlayCardOf(state, active))).toBe(true);
    expect(preventsAttackerType(["Fire"], inPlayCardOf(state, active))).toBe(true);
    expect(preventsAttackerType(["Grass"], POOL[SCOVILLAIN])).toBe(false);
  });

  it("`opponentActiveHasType` — the OPPONENT's clause sees a {G} and an {R} Active", () => {
    const state = table({ p1: SCOV_SPOT, p2: { id: PLAIN } });
    expect(conditionHolds(state, "p2", { kind: "opponentActiveHasType", type: "Grass" })).toBe(true);
    expect(conditionHolds(state, "p2", { kind: "opponentActiveHasType", type: "Fire" })).toBe(true);
    expect(conditionHolds(state, "p2", { kind: "opponentActiveHasType", type: "Water" })).toBe(false);
  });

  it("`yourActiveHasType` and `yourBenchHasType` — the holder's own side", () => {
    const state = table({ p1: { id: PLAIN }, p1Bench: [SCOV_SPOT], p2: { id: PLAIN } });
    expect(conditionHolds(state, "p1", { kind: "yourBenchHasType", type: "Grass" })).toBe(true);
    expect(conditionHolds(state, "p1", { kind: "yourActiveHasType", type: "Grass" })).toBe(false);
    const flipped = table({ p1: SCOV_SPOT, p2: { id: PLAIN } });
    expect(conditionHolds(flipped, "p1", { kind: "yourActiveHasType", type: "Grass" })).toBe(true);
  });

  it("a typed IN-PLAY filter — an attach to 'your {G} Pokémon' offers the Benched Scovillain ex", () => {
    const state = table({ p1: { id: PLAIN }, p1Bench: [SCOV_SPOT], p2: { id: PLAIN } });
    expect(attachEnergyTargets(state, "p1", { targetType: "Grass" })).toEqual([{ seat: "p1", spot: { spot: "bench", index: 0 } }]);
    expect(attachEnergyTargets(state, "p1", { targetType: "Water" })).toEqual([]);
  });

  it("a typed heal ('each of your {G} Pokémon') heals the Scovillain ex and not the {C} body", () => {
    const state = table({ p1: { id: PLAIN, damage: 30 }, p1Bench: [{ ...SCOV_SPOT, damage: 40 }], p2: { id: PLAIN } });
    const result = runProgram(state, [{ op: "healEach", amount: 30, pokemonType: "Grass" }], { seat: "p1" }, []);
    expect(result.state.players.p1.bench[0]?.damage).toBe(10);
    expect(result.state.players.p1.active?.damage).toBe(30);
  });
});

describe("D578 Scovillain §5 — a §9 Ability lock hands back the printed {R}", () => {
  it("an opposing Active Iron Thorns ex (Initialization: Rule Box Pokémon have no Abilities) — Scovillain ex is {R} only, Active and Bench", () => {
    const state = table({ p1: SCOV_SPOT, p1Bench: [{ id: SCOVILLAIN_ALT, under: [CAPSAKID] }], p2: { id: IRON_THORNS } });
    expect(effectiveTypesOf(state, state.players.p1.active as InPlayPokemon)).toEqual(["Fire"]);
    expect(effectiveTypesOf(state, state.players.p1.bench[0] as InPlayPokemon)).toEqual(["Fire"]);
    expect(conditionHolds(state, "p2", { kind: "opponentActiveHasType", type: "Grass" })).toBe(false);
  });

  it("…so the locked attacker's hit on a {G}-weak Iron Thorns ex takes NO Weakness (50, not 100)", () => {
    const state = table({ p1: SCOV_SPOT, p2: { id: IRON_THORNS } });
    const row = damageRow(run(state, { type: "attack", seat: "p1", index: 1 }).events);
    expect(row.weakness).toBeNull();
    expect(row.dealt).toBe(50);
  });
});

describe("D578 Scovillain §6 — R-WT1: the Watchtower's {C} read stays PRINTED and stays exact", () => {
  // The printed types of every `typesInPlay` holder, from the audit card JSON (tcgdex,
  // 2026-09-25). A new holder must be added here — with its printed types — before it lands.
  const HOLDER_PRINTED_TYPES: Record<string, readonly string[]> = {
    "sv08-037": ["Fire"],
    "sv08-216": ["Fire"],
    // 🆕🆕🆕 D580 — Iron Treads "Dual Core" ({F}{M} while a Future Booster Energy Capsule is attached).
    "sv05-118": ["Metal"],
    // 🆕🆕🆕 D586 — Carbink "Double Type" ({F}{P}), LOCAL D1 `types_json` ["Fighting"].
    "me02.5-117": ["Fighting"],
    "me02.5-242": ["Fighting"],
  };

  it("every `typesInPlay` value, and every holder's printed types, exclude {C} — a retype can neither add nor remove {C}", () => {
    const holders = registryCardIds().filter((id) => programFor(id)?.passive?.typesInPlay !== undefined);
    expect(holders.sort()).toEqual(Object.keys(HOLDER_PRINTED_TYPES).sort());
    for (const id of holders) {
      expect(programFor(id)?.passive?.typesInPlay).not.toContain("Colorless");
      expect(HOLDER_PRINTED_TYPES[id]).not.toContain("Colorless");
    }
  });
});

// ── §7 — THE ALLOWLIST: every `.types` read and every `matchesFilter` call in engine source ──
//
// Walked off the TypeScript AST (comments and strings cannot match), keyed by
// `kind · file · enclosing function · first argument [· filter]`, each with a verdict:
//   EFFECTIVE — the card was resolved through `inPlayCardOf` (or is a param its callers feed
//               from it), so Scovillain ex reads {G} and {R};
//   PRINTED   — a hand / deck / discard / energy / played card, or the one Watchtower read
//               (R-WT1), or a type-blind filter;
//   TYPE-BLIND — a literal non-type filter on an in-play card (owner, banner, stage, name).
// A NEW read or call fails here until it is classified.

const RAW: Record<string, string> = (
  import.meta as unknown as {
    glob(
      pattern: string | readonly string[],
      options: { query: "?raw"; import: "default"; eager: true },
    ): Record<string, string>;
  }
).glob(["./*.ts", "!./*.test.ts", "!./testFixtures.ts"], { query: "?raw", import: "default", eager: true });

function sites(): string[] {
  const out: string[] = [];
  for (const [path, text] of Object.entries(RAW).sort(([a], [b]) => a.localeCompare(b))) {
    const f = path.replace(/^\.\//, "");
    if (!f.endsWith(".ts") || f.endsWith(".test.ts") || f === "testFixtures.ts") continue;
    const src = ts.createSourceFile(f, text, ts.ScriptTarget.Latest, true);
    const fnName = (n: ts.Node): string => {
      for (let p: ts.Node | undefined = n.parent; p; p = p.parent) {
        if ((ts.isFunctionDeclaration(p) || ts.isMethodDeclaration(p)) && p.name !== undefined) return p.name.getText();
      }
      return "<top>";
    };
    const flat = (n: ts.Node | undefined) => (n === undefined ? "" : n.getText().replace(/\s+/g, " "));
    const visit = (n: ts.Node): void => {
      if (ts.isPropertyAccessExpression(n) && n.name.text === "types") {
        out.push(`types · ${f} · ${fnName(n)} · ${flat(n)}`);
      }
      if (ts.isCallExpression(n) && n.expression.getText() === "matchesFilter") {
        out.push(`filter · ${f} · ${fnName(n)} · ${flat(n.arguments[0])} · ${flat(n.arguments[1])}`);
      }
      ts.forEachChild(n, visit);
    };
    visit(src);
  }
  return out;
}

const E = "EFFECTIVE";
const P = "PRINTED";
const B = "TYPE-BLIND";

const ALLOWLIST: Record<string, string> = {
  // ── `.types` reads ──
  "types · cards.ts · matchesFilter · card.types": `${E} for in-play callers (handed \`inPlayCardOf\`), ${P} for hand/deck/discard callers`,
  "types · cards.ts · weakResModifier · attacker.types": `${E} — both §8.5 callers pass the in-play attacker view`,
  "types · continuous.ts · attackerMatchesClass · attacker.types": `${E} — \`attackBlockOf\` callers pass the in-play attacker`,
  "types · continuous.ts · auraSuppresses · top.types": `${P} — R-WT1: the Watchtower read, under \`disabledAbilityUids\` (no {C} retype exists)`,
  "types · continuous.ts · berryReductionOf · attacker?.types": `${E} — the four §8.5 callers pass the in-play attacker`,
  "types · continuous.ts · effectiveTypesOf · inPlayCardOf(state, pokemon)?.types": `${E} — the projection itself`,
  "types · continuous.ts · passivesOf · holderCard?.types": `${E} — \`holderCard\` is \`inPlayCardOf\` (printed under a §9 lock)`,
  "types · continuous.ts · preventsAttackerType · attacker.types": `${E} — every damage site passes the in-play attacker`,
  "types · continuous.ts · seatWeaknessRewrite · defenderCard.types": `${E} — both Weakness sites pass the in-play defender`,
  // 🆕🆕🆕 D618 — Forest of Vitality: the EVOLUTION card is in the hand (the body's side reads `effectiveTypesOf`).
  "types · continuous.ts · stadiumLicensesSameTurnEvolve · evolution.types": `${P} — the evolution card is in the hand, not in play`,
  "types · continuous.ts · stadiumPoisonExtraCounters · top?.types": `${E} — flow.ts's §13.1 Poison passes \`inPlayCardOf\``,
  "types · continuous.ts · stadiumRetreatDelta · top.types": `${E} — \`effectiveRetreatCost\` passes \`inPlayCardOf\``,
  "types · interpreter.ts · attachEnergyTargets · card?.types": `${E} — \`inPlayCardOf\``,
  "types · interpreter.ts · conditionHolds · inPlayCardOf(state, p)?.types": `${E}`,
  // 🆕🆕🆕 D600 — Sableye's `yourBenchHasStage2OfType`: `benched` is `inPlayCardOf(state, p)`.
  "types · interpreter.ts · conditionHolds · benched.types": `${E}`,
  // 🆕🆕🆕 D603 — WP11's `yourMegaExInPlay` type rider: `card` is `inPlayCardOf(state, body)`.
  "types · interpreter.ts · conditionHolds · card.types": `${E}`,
  "types · interpreter.ts · conditionHolds · (inPlayCardOf(state, spot.active) ?? spot.card).types": `${E}`,
  "types · interpreter.ts · healEach · card?.types": `${E} — \`inPlayCardOf\``,
  // ── `matchesFilter` calls ──
  "filter · attack.ts · benchBodies · inPlayCardOf(state, p) · filter": E,
  "filter · attack.ts · copySources · card · { kind: \"ownerPokemon\", owner }": B,
  "filter · attack.ts · scaledAttackDamage · inPlayCardOf(state, p) · filter": E,
  // 🆕🆕🆕 D613 — the Bench destination's noun test; its callers hand it a deck / discard / hand card.
  "filter · cards.ts · benchMatches · card · filter": `${P} — a card an effect puts onto the Bench, from a pile`,
  "filter · cards.ts · matchesFilter · card · inner": `${E} or ${P} — the caller's card, recursed`,
  "filter · cards.ts · matchesFilter · card · { kind: \"anyPokemon\" }": B,
  "filter · cards.ts · matchesFilter · card · { kind: \"supporter\" }": B,
  "filter · cards.ts · matchesFilter · card · { kind: \"toolCard\" }": B,
  // 🆕🆕🆕 D619 — Sacred Charm / Thick Scale / Thick Fat: the four §8.5 callers pass the in-play attacker view.
  "filter · continuous.ts · attackerGatedReductionOf · attacker · reduction.attacker": `${E} — the four §8.5 callers pass the in-play attacker`,
  // 🆕🆕🆕 D620 — Core Memory's holder gate: its one producer is `byName` (Mega Zygarde ex), blind to type.
  "filter · continuous.ts · attackMenuOf · top · holderGate": B,
  // 🆕🆕🆕 D620 — Tremendous Bomb's two class reads: both cards are `inPlayCardOf`.
  "filter · continuous.ts · gatedBombOf · attackerCard · gated.attacker": E,
  "filter · continuous.ts · gatedBombOf · holderCard · gated.holderNot": E,
  "filter · continuous.ts · auraSuppresses · top · { kind: \"bannerPokemon\", banner: aura.exemptBanner }": B,
  "filter · continuous.ts · basicEnergyUids · cardOfUid(state, uid) · BASIC_ENERGY_CARD": `${P} — an Energy card`,
  "filter · continuous.ts · countEnergyInPlay · inPlayCardOf(state, holder) · filter": E,
  "filter · continuous.ts · energyMayBeAttachedTo · topCardOf(state, holder) · { kind: \"ownerPokemon\", owner }": B,
  "filter · continuous.ts · groupShieldedFromAttackEffects · targetTop · filter": E,
  "filter · continuous.ts · koEnergyRescueUids · cardOfUid(state, uid) · { kind: \"basicEnergy\", energyType }": `${P} — an Energy card`,
  "filter · continuous.ts · koEnergyRescueUids · inPlayCardOf(state, body) · { kind: \"typedPokemon\", pokemonType: rescued }": E,
  "filter · continuous.ts · opposingRetreatSurcharge · targetTop · aura.target": E,
  // 🆕🆕🆕 D606 — Nighttime Mine's `attackCostSurcharge.attacker`: its one producer is `bannerPokemon Tera`
  // (keyed on the printing id, D568), so the read is blind to type.
  "filter · continuous.ts · stadiumFilteredCostSurcharge · top · surcharge.attacker": B,
  "filter · continuous.ts · passivesOf · holderCard · stageFree.beneficiary": E,
  "filter · continuous.ts · passivesOf · holderCard · targeted.holder": E,
  "filter · continuous.ts · pokemonPlayBarredByOpponentActive · card · bar.except": `${P} — the card being PLAYED from the hand`,
  "filter · continuous.ts · pokemonPlayBarredByOpponentActive · card · bar.only": `${P} — the card being PLAYED from the hand`,
  "filter · continuous.ts · seatDamageReduction · damagedCard · aura.beneficiary": E,
  "filter · continuous.ts · seatDamageReduction · topCardOf(state, other) · { kind: \"byName\", name: otherNamed }": B,
  "filter · continuous.ts · seatKoPrizeBonuses · koCard · bonus.koTarget": `${P} — the KO'd card by uid; the one \`koTarget\` is \`basicPokemon\` (type-blind)`,
  // 🆕🆕🆕 D598 — Shadowy Concealment's "your {D} Pokémon": flow.ts `seatPrizeReduction` passes `inPlayCardOf`.
  "filter · continuous.ts · seatKoPrizeReductionOf · koCard · rule.koTarget": `${E} — \`seatPrizeReduction\` passes \`inPlayCardOf\``,
  "filter · continuous.ts · seatPreWRDamageBonus · attackerCard · aura.beneficiary": `${E} — \`attackerPreWRBonus\` passes \`inPlayCardOf\``,
  "filter · continuous.ts · seatPreWRDamageBonus · defenderCard · aura.target": `${E} — the §8.5 callers pass the in-play defender`,
  "filter · continuous.ts · sideAttackBonusThisTurn · defenderCard · bonus.target": `${E} — the §8.5 callers pass the in-play defender`,
  "filter · continuous.ts · stadiumDamageReduction · damagedCard · reduction.beneficiary": E,
  "filter · continuous.ts · stadiumFreesRetreat · top · retreat.filter": `${E} — \`effectiveRetreatCost\`'s \`inPlayCardOf\``,
  "filter · continuous.ts · stadiumPreWRBonus · attackerCard · bonus.attacker": `${E} — via \`seatPreWRDamageBonus\``,
  "filter · continuous.ts · stadiumRetreatDelta · top · retreat.filter": `${E} — \`effectiveRetreatCost\`'s \`inPlayCardOf\``,
  "filter · continuous.ts · toolAnyTypeCostDiscount · holderTop · anyTerm.holder": E,
  "filter · continuous.ts · toolAttackCostDiscount · top · term.holder": E,
  "filter · flow.ts · briarPrizeBonus · cardOfUid(state, attackerUid) · rule.attacker": `${P} — Briar's \`attacker\` is \`bannerPokemon\` Tera (type-blind)`,
  "filter · interpreter.ts · attachableEnergies · card · { kind: \"byName\", name: energyName }": B,
  "filter · interpreter.ts · attachedBasicEnergyTypedFilter · card · { kind: \"basicEnergy\" }": `${P} — an Energy card`,
  "filter · interpreter.ts · attachEnergyTargets · card · { kind: \"bannerPokemon\", banner: riders.targetBanner }": B,
  "filter · interpreter.ts · attachEnergyTargets · card · { kind: \"ownerPokemon\", owner: riders.ownerPokemon }": B,
  "filter · interpreter.ts · attachFromDeckOffer · cardOf(state, uid) · op.filter": `${P} — a deck card`,
  "filter · interpreter.ts · attachFromDiscardOffer · cardOf(state, uid) · op.filter": `${P} — a discard card`,
  "filter · interpreter.ts · attachFromHandOffer · cardOf(state, uid) · op.filter": `${P} — a hand card`,
  "filter · interpreter.ts · attachFromTopOffer · cardOf(state, uid) · op.filter": `${P} — a deck card`,
  "filter · interpreter.ts · bottomFromOpponentHandOffer · cardOf(state, uid) · op.filter": `${P} — a hand card`,
  "filter · interpreter.ts · conditionHolds · activeTop(state, otherSeat(seat))?.card · { kind: \"bannerPokemon\", banner: cond.banner, }": B,
  "filter · interpreter.ts · conditionHolds · cardOfUid(state, playedUid) · { kind: \"bannerCard\", banner: cond.banner }": B,
  // 🆕🆕🆕 D579 — Koraidon "Unrelenting Onslaught"'s banner read over `GameState.recentAttackers`: a
  // banner is keyed by printing id, never by type, and the uid may name a body that has LEFT PLAY.
  "filter · interpreter.ts · conditionHolds · cardOfUid(state, entry.uid) · { kind: \"bannerPokemon\", banner: cond.banner }": B,
  "filter · interpreter.ts · conditionHolds · spot.card · { kind: \"ownerPokemon\", owner: cond.owner }": B,
  "filter · interpreter.ts · conditionHolds · topCardOf(state, body) · { kind: \"bannerPokemon\", banner: cond.banner }": B,
  // 🆕🆕🆕 D603 — `yourMegaExInPlay`'s class read: the D582 NAME predicate, keyed on no type.
  "filter · interpreter.ts · conditionHolds · card · { kind: \"megaEvolutionEx\" }": B,
  "filter · interpreter.ts · countCardsInDiscardPile · cardOfUid(state, uid) · filter": `${P} — a discard card`,
  "filter · interpreter.ts · countCardsInHand · cardOfUid(state, uid) · filter": `${P} — a hand card`,
  "filter · interpreter.ts · discardRetrievalCandidates · cardOf(state, uid) · op.filter": `${P} — a discard card`,
  "filter · interpreter.ts · counterEachAll · card · filter": `${E} — \`inPlayCardOf\``,
  "filter · interpreter.ts · countPokemonInPlay · card · filter": `${E} — \`inPlayCardOf\``,
  "filter · interpreter.ts · eachAttachTopUp · cardOf(given.state, uid) · op.filter": `${P} — a deck / discard card`,
  "filter · interpreter.ts · evolvableOwnRefs · card · { kind: \"typedPokemon\", pokemonType }": `${E} — \`refTopCard\` is \`inPlayCardOf\``,
  "filter · interpreter.ts · filteredRefs · refTopCard(state, ref) · filter": `${E} — \`refTopCard\` is \`inPlayCardOf\``,
  "filter · interpreter.ts · gustTargets · card · { kind: \"basicPokemon\" }": B,
  "filter · interpreter.ts · handCostCandidates · card · op.filter": `${P} — a hand card`,
  "filter · interpreter.ts · healEach · card · { kind: \"basicPokemon\" }": B,
  "filter · interpreter.ts · healEach · card · { kind: \"evolutionPokemon\" }": B,
  "filter · interpreter.ts · healEach · card · { kind: \"bannerPokemon\", banner: op.banner }": B,
  "filter · interpreter.ts · knockOutChosenTargets · card · { kind: \"basicPokemon\" }": B,
  "filter · interpreter.ts · matchesAttached · cardOf(state, uid) · filter": `${P} — an attached Energy / Tool card`,
  "filter · interpreter.ts · oneOfRecordedChoice · found · { kind: \"basicEnergy\" }": `${P} — an Energy card`,
  "filter · interpreter.ts · scoredSlot · cardOfUid(state, uid) · filter": `${P} — a hand / deck card`,
  "filter · interpreter.ts · searchDeckOrElse · card · filter": `${P} — a deck card`,
  "filter · interpreter.ts · snipeTargets · inPlayCardOf(state, pokemon) · narrowing": E,
  "filter · interpreter.ts · stepOp · cardOf(state, uid) · filter": `${P} — deck / hand / discard cards`,
  "filter · interpreter.ts · stepOp · cardOf(state, uid) · g.filter": `${P} — deck cards`,
  "filter · interpreter.ts · stepOp · cardOf(state, uid) · op.filter": `${P} — deck / hand / discard cards`,
  "filter · interpreter.ts · stepOp · cardOfUid(state, uid) · op.filter": `${P} — a revealed deck card`,
  "filter · interpreter.ts · subgroupRefs · refTopCard(state, ref) · { kind: \"ownerPokemon\", owner }": B,
  "filter · interpreter.ts · swapBodies · top · filter": `${E} — \`inPlayCardOf\``,
  "filter · interpreter.ts · swapDiscardCards · card · filter": `${P} — a discard card`,
  "filter · interpreter.ts · switchBenchNarrowing · card · { kind: \"typedPokemon\", pokemonType: op.targetType }": `${E} — \`refTopCard\` is \`inPlayCardOf\``,
};

describe("D578 Scovillain §7 — THE ALLOWLIST: every in-play type read is classified", () => {
  it("every `.types` read and every `matchesFilter` call in engine source has a verdict, and no verdict is stale", () => {
    // Non-vacuous: the glob reached the engine's own modules.
    expect(Object.keys(RAW).some((k) => k.endsWith("/continuous.ts"))).toBe(true);
    const found = [...new Set(sites())].sort();
    const unclassified = found.filter((key) => ALLOWLIST[key] === undefined);
    const stale = Object.keys(ALLOWLIST).filter((key) => !found.includes(key));
    expect(unclassified).toEqual([]);
    expect(stale).toEqual([]);
  });
});
