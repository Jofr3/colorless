import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { effectiveRetreatCost, passivesOf } from "./continuous";
import type { GameAction, GameEvent, GameState, PokemonRef, Seat } from "./index";
import { applyAction, createGame, engineVersion } from "./index";
import { formatElapsed, logFromEvents } from "./log";
import { programFor } from "./registry";
import {
  FIXTURE_POOL,
  attachFromDeck,
  attachToolFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  deepFreeze,
  handFromDeck,
  handUid,
  setActiveFromDeck,
  setConditions,
  setDamage,
  typedEnergy,
} from "./testFixtures";

// ── 🆕🆕🆕 D614 — WP37b: THE ABILITY-EFFECT SHIELD ──
//
// Mega Clefable ex `mep-072`, `me03-031` / `-103` / `-119` "Luminous Wing" (LOCAL D1, 2026-10-09,
// `legal_standard = 1`): one registry object, `passive.preventAbilityEffects`. A Pokémon Ability's program
// carries `EffectContext.invokedBy: "ability"` and the §11 funnel refuses its effects on the holder; the
// Ability share of a recoil on the Attacking Pokémon and Magma Surge's extra Burn counters are refused too.
// Two new readings, both ⚠️ UNRULED: R-LW1 (§8, continuous Ability auras are not refused) and R-LW2 (§7, an
// Ability lock on the holder switches the shield off).

const LUMINOUS_WING = "Prevent all effects of your opponent's Pokémon's Abilities done to this Pokémon.";
const SHOOTING_MOONS =
  "You may discard up to 4 Energy cards from your hand, and this attack does 40 more damage for each card you discarded in this way.";
const CLEFABLE = ["mep-072", "me03-031", "me03-103", "me03-119"] as const;
const CLEF = "me03-031";

const DUSKNOIR = "sv06.5-020"; // "Cursed Blast" — 13 counters on 1 of the opponent's Pokémon, then KO itself
const MUNKIDORI = "sv06-095"; // "Adrena-Brain" — move up to 3 counters onto 1 of the opponent's Pokémon
const GENGAR = "sv05-104"; // "Gnawing Curse" — 2 counters on the body the opponent attaches to
const DUGTRIO = "me02.5-101"; // "Holes" — 2 counters on the opponent's Active that moved to the Bench
const FROSLASS = "sv06-053"; // "Freezing Shroud" — 1 counter on each Pokémon with an Ability, both sides
const HAWLUCHA = "sv01-118"; // "Flying Entry" — 1 counter on each of 2 of the opponent's Benched Pokémon
const ROSELIA = "sv05-008"; // "Poison Point" — the Attacking Pokémon is now Poisoned
const KLAWF = "sv03-120"; // "Counterattacking Pincer" — discard an Energy from the Attacking Pokémon
const SCRAFTY = "me02.5-135"; // "Counterattacking Crest" — 5 counters on the Attacking Pokémon
const MARACTUS = "sv09-008"; // "Exploding Needles" — 6 counters on the Attacking Pokémon on a Knock Out
const MAGMORTAR = "sv09-021"; // "Magma Surge" — 3 more counters on the opponent's Burned Pokémon
const SPIDOPS = "sv01-019"; // "Trap Territory" — the opponent's Active's Retreat Cost is {C} more
const FLUTTER = "sv05-078"; // "Midnight Fluttering" — the opponent's Active has no Abilities
const ROCKY_HELMET = "sv01-193"; // Tool — 2 counters on the Attacking Pokémon
const POISONER = "d614-poisoner"; // a test attacker whose attack's effect is a Poison
const FILLER = "fix-basic-0";
const P = "d614-psychic";
const D = "d614-darkness";

const ability = (id: string, card: string, name: string, effect: string, over: Partial<Card>): Card =>
  battler(id, { name: card, abilities: [{ type: "Ability", name, effect }], ...over } as Partial<Card>);

const LOCAL: Record<string, Card> = {
  [CLEF]: battler(CLEF, {
    name: "Mega Clefable ex",
    stage: "Stage1",
    evolveFrom: "Clefairy",
    hp: 320,
    types: ["Psychic"],
    retreat: 1,
    abilities: [{ type: "Ability", name: "Luminous Wing", effect: LUMINOUS_WING }],
    attacks: [
      { name: "Shooting Moons", cost: ["Psychic", "Psychic"], damage: "120+", effect: SHOOTING_MOONS },
      // A test-only second row with no effect text: attack.ts's own main hit. (Shooting Moons is
      // re-homed into `damageDefender`, so its hit is interpreter.ts `snipeActive`'s.)
      { name: "D614 Hit", cost: ["Colorless"], damage: 30 },
    ],
  } as Partial<Card>),
  [DUSKNOIR]: ability(DUSKNOIR, "Dusknoir", "Cursed Blast", "Once during your turn, you may put 13 damage counters on 1 of your opponent's Pokémon. If you use this Ability, this Pokémon is Knocked Out.", { stage: "Stage2", hp: 160, types: ["Psychic"], retreat: 3 }),
  [MUNKIDORI]: ability(MUNKIDORI, "Munkidori", "Adrena-Brain", "Once during your turn, if this Pokémon has any {D} Energy attached, you may move up to 3 damage counters from 1 of your Pokémon to 1 of your opponent's Pokémon.", { hp: 110, types: ["Psychic"] }),
  [GENGAR]: ability(GENGAR, "Gengar ex", "Gnawing Curse", "Whenever your opponent attaches an Energy card from their hand to 1 of their Pokémon, put 2 damage counters on that Pokémon.", { stage: "Stage2", hp: 310, types: ["Darkness"], retreat: 2 }),
  [DUGTRIO]: ability(DUGTRIO, "Team Rocket's Dugtrio", "Holes", "Whenever your opponent's Active Pokémon moves to the Bench during their turn, place 2 damage counters on that Pokémon.", { stage: "Stage1", hp: 100, types: ["Fighting"] }),
  [FROSLASS]: ability(FROSLASS, "Froslass", "Freezing Shroud", "During Pokémon Checkup, put 1 damage counter on each Pokémon that has an Ability (both yours and your opponent's), except any Froslass.", { stage: "Stage1", hp: 90, types: ["Water"] }),
  [HAWLUCHA]: ability(HAWLUCHA, "Hawlucha", "Flying Entry", "When you play this Pokémon from your hand onto your Bench during your turn, you may choose 2 of your opponent's Benched Pokémon and put 1 damage counter on each of them.", { hp: 70, types: ["Fighting"] }),
  [ROSELIA]: ability(ROSELIA, "Roselia", "Poison Point", "If this Pokémon is in the Active Spot and is damaged by an attack from your opponent's Pokémon (even if this Pokémon is Knocked Out), the Attacking Pokémon is now Poisoned.", { hp: 60, types: ["Grass"] }),
  [KLAWF]: ability(KLAWF, "Klawf ex", "Counterattacking Pincer", "If this Pokémon is in the Active Spot and is damaged by an attack from your opponent's Pokémon (even if this Pokémon is Knocked Out), discard an Energy from the Attacking Pokémon.", { hp: 220, types: ["Fighting"], retreat: 3 }),
  [SCRAFTY]: ability(SCRAFTY, "Mega Scrafty ex", "Counterattacking Crest", "If this Pokémon is in the Active Spot and is damaged by an attack from your opponent's Pokémon (even if this Pokémon is Knocked Out), place 5 damage counters on the Attacking Pokémon.", { stage: "Stage1", hp: 330, types: ["Darkness"], retreat: 2 }),
  [MARACTUS]: ability(MARACTUS, "Maractus", "Exploding Needles", "If this Pokémon is in the Active Spot and is Knocked Out by damage from an attack from your opponent's Pokémon, put 6 damage counters on the Attacking Pokémon.", { hp: 110, types: ["Grass"], retreat: 2 }),
  [MAGMORTAR]: ability(MAGMORTAR, "Magmortar", "Magma Surge", "During Pokémon Checkup, put 3 more damage counters on your opponent's Burned Pokémon.", { stage: "Stage1", hp: 130, types: ["Fire"], retreat: 2 }),
  [SPIDOPS]: ability(SPIDOPS, "Spidops ex", "Trap Territory", "Your opponent's Active Pokémon's Retreat Cost is {C} more.", { stage: "Stage1", hp: 260, types: ["Grass"], retreat: 2 }),
  [FLUTTER]: ability(FLUTTER, "Flutter Mane", "Midnight Fluttering", "As long as this Pokémon is in the Active Spot, your opponent's Active Pokémon has no Abilities, except for Midnight Fluttering.", { hp: 90, types: ["Psychic"] }),
  [POISONER]: battler(POISONER, {
    hp: 200,
    attacks: [{ name: "D614 Poison", cost: ["Colorless"], damage: 10, effect: "Your opponent's Active Pokémon is now Poisoned." }],
  } as Partial<Card>),
  [P]: typedEnergy(P, "Psychic"),
  [D]: typedEnergy(D, "Darkness"),
};
const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL };
const DECK = deckOf({
  [CLEF]: 3,
  [DUSKNOIR]: 1,
  [MUNKIDORI]: 1,
  [GENGAR]: 1,
  [DUGTRIO]: 1,
  [FROSLASS]: 1,
  [HAWLUCHA]: 1,
  [ROSELIA]: 2,
  [KLAWF]: 1,
  [SCRAFTY]: 1,
  [MARACTUS]: 1,
  [MAGMORTAR]: 1,
  [SPIDOPS]: 1,
  [FLUTTER]: 1,
  [POISONER]: 1,
  [ROCKY_HELMET]: 1,
  [FILLER]: 15,
  [P]: 16,
  [D]: 10,
});
const BOARD_IDS = new Set(Object.keys(LOCAL).concat(ROCKY_HELMET));

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
  const created = createGame({ seed: 6141, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
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

/** Both boards from the deck: `[active, ...bench]` per seat. */
function table(p1: readonly string[], p2: readonly string[]): GameState {
  let state = p1Turn();
  for (const [seat, ids] of [
    ["p1", p1],
    ["p2", p2],
  ] as const) {
    state = clearBench(setActiveFromDeck(state, seat, ids[0] as string), seat);
    for (const id of ids.slice(1)) state = benchFromDeck(state, seat, id);
  }
  return state;
}

const of = <T extends GameEvent["type"]>(events: readonly GameEvent[], type: T) =>
  events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
const prevented = (state: GameState, events: readonly GameEvent[]) =>
  of(events, "ABILITY_EFFECT_PREVENTED").map((e) => [e.seat, state.cardIdByUid[e.uid]]);
const damages = (state: GameState, seat: Seat) => [
  state.players[seat].active?.damage ?? -1,
  ...state.players[seat].bench.map((b) => b.damage),
];
const useAbility = (target: { spot: "active" } | { spot: "bench"; index: number }, abilityName: string) =>
  ({ type: "useAbility", seat: "p1", target, abilityName }) as GameAction;
const attack = (index: number): GameAction => ({ type: "attack", seat: "p1", index });
function choosePrompt(state: GameState): { candidates: PokemonRef[] } {
  if (state.phase.kind !== "effect:choose") throw new Error(`expected effect:choose, got ${state.phase.kind}`);
  return state.phase.prompt as unknown as { candidates: PokemonRef[] };
}

describe("D614 §1 — the program: one object over 4 printings", () => {
  it("every Mega Clefable ex id is the ONE passive object, `preventAbilityEffects` alone", () => {
    for (const id of CLEFABLE) {
      expect(programFor(id), id).toEqual({ passive: { preventAbilityEffects: true } });
      expect(programFor(id), id).toBe(programFor(CLEFABLE[0]));
    }
  });

  it("the fold reads it off the holder's Ability; the attack channel's flag is not set", () => {
    const state = table([CLEF], [FILLER]);
    const fold = passivesOf(state, state.players.p1.active as NonNullable<GameState["players"]["p1"]["active"]>);
    expect([fold.preventAbilityEffects, fold.preventAttackEffects]).toEqual([true, false]);
  });
});

describe("D614 §2 — an activated Ability's counters: Cursed Blast and Adrena-Brain", () => {
  it("Cursed Blast cannot choose Luminous Wing: the other body is forced, and the refusal is announced", () => {
    const state = table([FILLER, DUSKNOIR], [CLEF, SCRAFTY]);
    const result = run(state, useAbility({ spot: "bench", index: 0 }, "Cursed Blast"));
    expect(result.state.phase.kind).not.toBe("effect:choose");
    expect(damages(result.state, "p2")).toEqual([0, 130]);
    expect(prevented(result.state, result.events)).toEqual([["p2", CLEF]]);
  });

  it("with Luminous Wing alone it is still usable, places nothing, and Dusknoir is Knocked Out", () => {
    const result = run(table([FILLER, DUSKNOIR], [CLEF]), useAbility({ spot: "bench", index: 0 }, "Cursed Blast"));
    expect(damages(result.state, "p2")).toEqual([0]);
    expect(of(result.events, "KNOCKED_OUT").map((e) => [e.seat, result.state.cardIdByUid[e.uid]])).toEqual([
      ["p1", DUSKNOIR],
    ]);
  });

  it("an unshielded body takes the 13 counters (the control)", () => {
    const result = run(table([FILLER, DUSKNOIR], [SCRAFTY]), useAbility({ spot: "bench", index: 0 }, "Cursed Blast"));
    expect(damages(result.state, "p2")).toEqual([130]);
    expect(of(result.events, "ABILITY_EFFECT_PREVENTED")).toEqual([]);
  });

  it("Adrena-Brain offers every opponent body but Luminous Wing", () => {
    let state = table([MUNKIDORI], [CLEF, FILLER, CLEF]);
    state = setDamage(attachFromDeck(state, "p1", D, 1), "p1", 30);
    const parked = run(state, useAbility({ spot: "active" }, "Adrena-Brain"));
    expect(choosePrompt(parked.state).candidates).toEqual([{ seat: "p2", spot: { spot: "bench", index: 0 } }]);
    expect(prevented(parked.state, parked.events)).toEqual([
      ["p2", CLEF],
      ["p2", CLEF],
    ]);
  });
});

describe("D614 §3 — triggered Abilities: Holes, Gnawing Curse, Flying Entry", () => {
  it("Holes places nothing on a Luminous Wing body that retreats; another body takes 2", () => {
    const retreat = (state: GameState) =>
      run(state, { type: "retreat", seat: "p1", discardEnergy: [...(state.players.p1.active?.energy ?? [])], promoteBenchIndex: 0 });
    const shielded = retreat(attachFromDeck(table([CLEF, FILLER], [FILLER, DUGTRIO]), "p1", P, 1));
    expect(damages(shielded.state, "p1")).toEqual([0, 0]);
    expect(prevented(shielded.state, shielded.events)).toEqual([["p1", CLEF]]);
    const bare = retreat(table([FILLER, CLEF], [FILLER, DUGTRIO]));
    expect(damages(bare.state, "p1")).toEqual([0, 20]);
  });

  it("Gnawing Curse places nothing on a Luminous Wing body (Active or Benched); a Filler takes 2", () => {
    const attach = (state: GameState, target: { spot: "active" } | { spot: "bench"; index: number }) => {
      const withCard = handFromDeck(state, "p1", P, 1);
      return run(withCard, { type: "attachEnergy", seat: "p1", uid: handUid(withCard, "p1", P), target });
    };
    const base = table([CLEF, CLEF, FILLER], [FILLER, GENGAR]);
    const active = attach(base, { spot: "active" });
    expect(damages(active.state, "p1")).toEqual([0, 0, 0]);
    expect(prevented(active.state, active.events)).toEqual([["p1", CLEF]]);
    expect(damages(attach(base, { spot: "bench", index: 0 }).state, "p1")).toEqual([0, 0, 0]);
    expect(damages(attach(base, { spot: "bench", index: 1 }).state, "p1")).toEqual([0, 0, 20]);
  });

  it("Flying Entry's pick leaves out a Benched Luminous Wing body", () => {
    const state = handFromDeck(table([FILLER], [FILLER, CLEF, FILLER, FILLER]), "p1", HAWLUCHA, 1);
    const parked = run(state, { type: "playBasicToBench", seat: "p1", uid: handUid(state, "p1", HAWLUCHA) });
    expect(choosePrompt(parked.state).candidates.map((ref) => ref.spot)).toEqual([
      { spot: "bench", index: 1 },
      { spot: "bench", index: 2 },
    ]);
    expect(prevented(parked.state, parked.events)).toEqual([["p2", CLEF]]);
  });
});

describe("D614 §4 — the Pokémon Checkup: Freezing Shroud and Magma Surge", () => {
  it("the opponent's Freezing Shroud skips Luminous Wing; its OWNER's Froslass does not (\"your opponent's\")", () => {
    const state = table([CLEF, ROSELIA], [FILLER, FROSLASS, CLEF]);
    const ended = run(state, { type: "endTurn", seat: "p1" });
    expect(damages(ended.state, "p1")).toEqual([0, 10]);
    expect(damages(ended.state, "p2")).toEqual([0, 0, 10]);
    expect(prevented(ended.state, ended.events)).toEqual([["p1", CLEF]]);
  });

  it("Magma Surge's 3 more counters are refused on a Burned Luminous Wing body; the rulebook's 2 land", () => {
    const burn = (id: string) =>
      run(setConditions(table([id], [FILLER, MAGMORTAR]), "p1", { burned: true }), { type: "endTurn", seat: "p1" });
    const shielded = burn(CLEF);
    expect(of(shielded.events, "COUNTERS_PLACED").filter((e) => e.source === "burn").map((e) => e.amount)).toEqual([20]);
    expect(prevented(shielded.state, shielded.events)).toEqual([["p1", CLEF]]);
    const bare = burn(FILLER);
    expect(of(bare.events, "COUNTERS_PLACED").filter((e) => e.source === "burn").map((e) => e.amount)).toEqual([50]);
  });
});

describe("D614 §5 — reactions to Clefable's attack: Poison Point and the recoils", () => {
  const swing = (defender: string, index = 0, extra: (s: GameState) => GameState = (s) => s) =>
    run(extra(attachFromDeck(table([CLEF], [defender]), "p1", P, 2)), attack(index));

  it("Poison Point does not Poison it", () => {
    const result = swing(ROSELIA);
    expect(result.state.players.p1.active?.conditions.poisonDamage).toBe(0);
    expect(prevented(result.state, result.events)).toEqual([["p1", CLEF]]);
  });

  it("Counterattacking Pincer discards none of its Energy (the `discardEnergy` filter)", () => {
    const result = swing(KLAWF);
    expect(result.state.players.p1.active?.energy).toHaveLength(2);
    expect(prevented(result.state, result.events)).toEqual([["p1", CLEF]]);
    const bare = run(attachFromDeck(table([POISONER], [KLAWF]), "p1", P, 1), attack(0));
    expect(bare.state.players.p1.active?.energy).toHaveLength(0);
  });

  it("Counterattacking Crest places nothing on it; a Rocky Helmet's 2 counters still land", () => {
    const bare = swing(SCRAFTY);
    expect(bare.state.players.p1.active?.damage).toBe(0);
    expect(prevented(bare.state, bare.events)).toEqual([["p1", CLEF]]);
    const helmet = swing(SCRAFTY, 0, (s) => attachToolFromDeck(s, "p2", "active", ROCKY_HELMET));
    expect(helmet.state.players.p1.active?.damage).toBe(20);
  });

  it("attack.ts's own main hit (an effect-free row) refuses the same Ability share", () => {
    const result = swing(SCRAFTY, 1);
    expect(result.state.players.p2.active?.damage).toBe(30);
    expect(result.state.players.p1.active?.damage).toBe(0);
    expect(prevented(result.state, result.events)).toEqual([["p1", CLEF]]);
  });

  it("Exploding Needles places nothing on it when Maractus is Knocked Out", () => {
    const result = swing(MARACTUS);
    expect(of(result.events, "KNOCKED_OUT").map((e) => result.state.cardIdByUid[e.uid])).toEqual([MARACTUS]);
    expect(result.state.players.p1.active?.damage).toBe(0);
    expect(prevented(result.state, result.events)).toEqual([["p1", CLEF]]);
  });

  it("the controls: an unshielded attacker takes Crest's 50 and Needles' 60", () => {
    const hit = (defender: string) =>
      run(attachFromDeck(table([POISONER], [defender]), "p1", P, 1), attack(0)).state.players.p1.active?.damage;
    expect(hit(SCRAFTY)).toBe(50);
    const needles = run(
      attachFromDeck(setDamage(table([POISONER], [MARACTUS]), "p2", 100), "p1", P, 1),
      attack(0),
    );
    expect(needles.state.players.p1.active?.damage).toBe(60);
  });
});

describe("D614 §6 — what the shield does not refuse: attacks, and its own side", () => {
  it("an attack's Poison lands (this is the Ability channel only)", () => {
    const result = run(attachFromDeck(table([POISONER], [CLEF]), "p1", P, 1), attack(0));
    expect(result.state.players.p2.active?.conditions.poisonDamage).toBeGreaterThan(0);
    expect(of(result.events, "ABILITY_EFFECT_PREVENTED")).toEqual([]);
  });

  it("an Ability of the shielded body's own side is not refused: Freezing Shroud's owner's Clefable (§4)", () => {
    const ended = run(table([FILLER], [FILLER, FROSLASS, CLEF]), { type: "endTurn", seat: "p1" });
    expect(damages(ended.state, "p2")).toEqual([0, 0, 10]);
    expect(of(ended.events, "ABILITY_EFFECT_PREVENTED")).toEqual([]);
  });
});

describe("D614 §7 — R-LW2 ⚠️ UNRULED: an Ability lock on the holder switches the shield off", () => {
  it("under Flutter Mane's Midnight Fluttering the Active Clefable takes Cursed Blast's counters", () => {
    const result = run(table([FLUTTER, DUSKNOIR], [CLEF]), useAbility({ spot: "bench", index: 0 }, "Cursed Blast"));
    expect(damages(result.state, "p2")).toEqual([130]);
    expect(of(result.events, "ABILITY_EFFECT_PREVENTED")).toEqual([]);
  });
});

describe("D614 §8 — R-LW1 ⚠️ UNRULED: a continuous Ability aura is not refused", () => {
  it("Trap Territory still adds {C} to its Retreat Cost", () => {
    const state = table([CLEF], [FILLER, SPIDOPS]);
    const active = state.players.p1.active as NonNullable<GameState["players"]["p1"]["active"]>;
    expect(effectiveRetreatCost(state, active)).toBe(2);
  });
});

describe("D614 §9 — the log row, the attack, and the version", () => {
  it("ABILITY_EFFECT_PREVENTED renders on the shielded body's seat", () => {
    const result = run(table([FILLER, DUSKNOIR], [CLEF, FILLER]), useAbility({ spot: "bench", index: 0 }, "Cursed Blast"));
    const rows = of(result.events, "ABILITY_EFFECT_PREVENTED");
    const log = logFromEvents(rows, { names: { p1: "P1", p2: "P2" }, state: result.state, elapsed: formatElapsed(0) });
    expect(JSON.stringify(log)).toContain("Mega Clefable ex");
    expect(JSON.stringify(log)).toContain("prevented the effect of the Ability");
  });

  it("the printed attack text is the one this file's Clefable carries", () => {
    expect(LOCAL[CLEF]?.attacks?.[0]?.effect).toBe(SHOOTING_MOONS);
  });

  it("is built at engine 0.550.0", () => {
    expect(engineVersion).toBe("0.550.0");
  });
});
