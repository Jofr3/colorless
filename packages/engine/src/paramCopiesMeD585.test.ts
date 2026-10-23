import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import type { GameAction, GameEvent, GameState, Seat } from "./index";
import { applyAction, createGame } from "./index";
import { programFor } from "./registry";
import {
  FIXTURE_POOL,
  attachBenchFromDeck,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  expectErr,
  handFromDeck,
  mustApply,
  setActiveFromDeck,
  must,
} from "./testFixtures";

/** [me ids, twin id, printed Ability name, me text, twin text, edits]. Each edit is [twin
    phrase, me phrase]; applied in order, they turn the twin's text into the `me` text. */
const FACES: readonly (readonly [
  readonly string[],
  string,
  string,
  string,
  string,
  readonly (readonly [string, string])[],
])[] = [
  [
    ["me03-024", "me03-092"],
    "sv10.5b-063",
    "Tundra Wall",
    "All of your Pokémon that have any {W} Energy attached take 50 less damage from attacks from your opponent's Pokémon (after applying Weakness and Resistance). The effect of Tundra Wall doesn't stack.",
    "All of your Pokémon that have any {M} Energy attached take 20 less damage from attacks from your opponent's Pokémon (after applying Weakness and Resistance).",
    [
      ["{M}", "{W}"],
      ["take 20 less", "take 50 less"],
      ["Resistance).", "Resistance). The effect of Tundra Wall doesn't stack."],
    ],
  ],
  [
    ["me03-019"],
    "sv01-041",
    "Wash Out",
    "As often as you like during your turn, you may use this Ability. Move a {W} Energy from 1 of your Benched Pokémon to your Active Pokémon.",
    "As often as you like during your turn, you may move a {R} Energy from 1 of your Benched Pokémon to your Active Pokémon.",
    [["you may move a {R}", "you may use this Ability. Move a {W}"]],
  ],
  [
    ["me01-084", "me01-147"],
    "sv08-021",
    "Powerful a-Salt",
    "Attacks used by your {F} Pokémon do 30 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance).",
    "Attacks used by your Evolution {R} Pokémon do 10 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance).",
    [["your Evolution {R} Pokémon do 10", "your {F} Pokémon do 30"]],
  ],
  [
    ["me02.5-135", "me02.5-270", "me02.5-285"],
    "sv01-005",
    "Counterattacking Crest",
    "If this Pokémon is in the Active Spot and is damaged by an attack from your opponent's Pokémon (even if this Pokémon is Knocked Out), place 5 damage counters on the Attacking Pokémon.",
    "If this Pokémon is in the Active Spot and is damaged by an attack from your opponent's Pokémon (even if this Pokémon is Knocked Out), put 3 damage counters on the Attacking Pokémon.",
    [["put 3", "place 5"]],
  ],
  [
    ["mep-065", "me03-043"],
    "sv01-054",
    "Stone Arms",
    "Once during your turn, you may use this Ability. Attach a Basic {F} Energy card from your hand to 1 of your {F} Pokémon.",
    "Once during your turn, you may attach a Basic Energy card from your hand to 1 of your Pokémon.",
    [
      ["you may attach a Basic Energy", "you may use this Ability. Attach a Basic {F} Energy"],
      ["1 of your Pokémon.", "1 of your {F} Pokémon."],
    ],
  ],
  [
    ["me03-036"],
    "sv02-061",
    "Scent Collection",
    "Once during your turn, you may use this Ability. Search your deck for up to 2 Basic {P} Energy cards, reveal them, and put them into your hand. Then, shuffle your deck.",
    "Once during your turn, if this Pokémon is in the Active Spot, you may search your deck for up to 2 Basic {W} Energy cards, reveal them, and put them into your hand. Then, shuffle your deck.",
    [
      ["if this Pokémon is in the Active Spot, you may search", "you may use this Ability. Search"],
      ["Basic {W}", "Basic {P}"],
    ],
  ],
  [
    ["me02.5-152", "me02.5-271", "me02.5-290", "me02.5-295", "mep-091"],
    "sv10.5w-023",
    "Sky Transport",
    "Once during your turn, you may use this Ability. Switch your Active Pokémon with 1 of your Benched Pokémon.",
    "Once during your turn, you may switch your Active Pokémon with 1 of your Benched Pokémon. If you do, switch out your opponent's Active Pokémon to the Bench. (Your opponent chooses the new Active Pokémon.)",
    [
      [
        "you may switch your Active Pokémon with 1 of your Benched Pokémon. If you do, switch out your opponent's Active Pokémon to the Bench. (Your opponent chooses the new Active Pokémon.)",
        "you may use this Ability. Switch your Active Pokémon with 1 of your Benched Pokémon.",
      ],
    ],
  ],
  [
    ["me04-029", "me04-090", "mep-075"],
    "sv09-128",
    "Synchro Pulse",
    "If you have the same number of cards in your hand as your opponent, attacks used by this Pokémon do 80 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance).",
    "If you have the same number of cards in your hand as your opponent, ignore all Energy in the cost of Frightening Howl used by this Pokémon.",
    [
      [
        "ignore all Energy in the cost of Frightening Howl used by this Pokémon.",
        "attacks used by this Pokémon do 80 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance).",
      ],
    ],
  ],
];

const ME_IDS = FACES.flatMap(([ids]) => ids);

/** Every Ability name a program carries — what the log shows (`name` / `ability` strings). */
function programAbilityNames(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) for (const x of v) programAbilityNames(x, out);
  else if (v !== null && typeof v === "object")
    for (const [k, x] of Object.entries(v)) {
      if ((k === "name" || k === "ability") && typeof x === "string") out.push(x);
      programAbilityNames(x, out);
    }
  return out;
}

describe("D585 §1 — the faces: 19 `me` printings / 8 texts, each rebuilt from its twin's", () => {
  it("8 texts / 19 printings, no id twice, none already keyed before D585's block", () => {
    expect(FACES).toHaveLength(8);
    expect(ME_IDS).toHaveLength(19);
    expect(new Set(ME_IDS).size).toBe(19);
  });

  it("every `me` text IS its twin's through the stated edits (each edit's left side is printed)", () => {
    for (const [ids, twin, name, meText, twinText, edits] of FACES) {
      let built = twinText;
      for (const [from, to] of edits) {
        expect(built, `${twin}: "${from}"`).toContain(from);
        built = built.split(from).join(to);
      }
      expect(built, `${ids.join(" / ")} (${name}) ~ ${twin}`).toBe(meText);
    }
  });
});

describe("D585 §2 — the registry: one NEW object per text, the twin's op or field at the printed value", () => {
  it("every printing of a text shares ONE object, distinct from its twin's", () => {
    for (const [ids, twin] of FACES) {
      const program = programFor(ids[0] as string);
      expect(program, ids[0]).toBeDefined();
      for (const id of ids) expect(programFor(id), id).toBe(program);
      expect(program, twin).not.toBe(programFor(twin));
    }
  });

  it("the passives: the twin's field, at the printed type, amount, rider and condition", () => {
    expect(programFor("me03-024")).toEqual({
      passive: {
        seatDamageReductionAfterWR: {
          amount: 50,
          beneficiaryHasEnergy: "Water",
          noStack: "Tundra Wall",
        },
      },
    });
    expect(programFor("sv10.5b-063")).toEqual({
      passive: { seatDamageReductionAfterWR: { amount: 20, beneficiaryHasEnergy: "Metal" } },
    });
    expect(programFor("me01-084")).toEqual({
      passive: {
        seatDamageBonusBeforeWR: {
          amount: 30,
          beneficiary: { kind: "typedPokemon", pokemonType: "Fighting" },
        },
      },
    });
    expect(programFor("sv08-021")).toEqual({
      passive: {
        seatDamageBonusBeforeWR: {
          amount: 10,
          beneficiary: { kind: "typedPokemon", pokemonType: "Fire", stage: "evolution" },
        },
      },
    });
    expect(programFor("me02.5-135")).toEqual({ passive: { damageAttacker: { amount: 50 } } });
    expect(programFor("sv01-005")).toEqual({ passive: { damageAttacker: { amount: 30 } } });
    expect(programFor("me04-029")).toEqual({
      passive: { damageBonusBeforeWRIf: { amount: 80, cond: { kind: "handSizesEqual" } } },
    });
  });

  it("the activated Abilities: the twin's program under the printed name, with the printed type", () => {
    const swap = (v: unknown, pairs: readonly (readonly [string, string])[]) =>
      pairs.reduce((json, [a, b]) => json.split(a).join(b), JSON.stringify(v));
    // Wash Out = Fire Off with {W} for {R}.
    expect(
      swap(programFor("me03-019"), [
        ["Wash Out", "Fire Off"],
        ['"Water"', '"Fire"'],
      ]),
    ).toBe(JSON.stringify(programFor("sv01-041")));
    // Stone Arms = Energy Carnival with the printed {F} on the card and on the target.
    expect(programFor("mep-065")).toEqual({
      abilities: [
        {
          name: "Stone Arms",
          oncePerTurn: true,
          activeOnly: false,
          program: [
            {
              op: "attachEnergyFrom",
              source: "hand",
              energyType: "Fighting",
              targetType: "Fighting",
            },
          ],
        },
      ],
    });
    expect(programFor("sv01-054")?.abilities?.[0]?.program).toEqual([
      { op: "attachEnergyFrom", source: "hand" },
    ]);
    // Scent Collection = Shivery Chill with {P} for {W}, from any spot.
    const chill = programFor("sv02-061")?.abilities?.[0];
    expect(programFor("me03-036")).toEqual({
      abilities: [
        {
          ...chill,
          name: "Scent Collection",
          activeOnly: false,
          program: JSON.parse(JSON.stringify(chill?.program).split('"Water"').join('"Psychic"')),
        },
      ],
    });
    expect(chill?.activeOnly).toBe(true);
    // Sky Transport = Torrential Whirlpool's first op, without the "If you do" record.
    expect(programFor("me02.5-152")).toEqual({
      abilities: [
        {
          name: "Sky Transport",
          oncePerTurn: true,
          activeOnly: false,
          program: [{ op: "switchActive" }],
        },
      ],
    });
    expect(programFor("sv10.5w-023")?.abilities?.[0]?.program[0]).toEqual({
      op: "switchActive",
      recordAs: "moved",
    });
  });

  it("every keyed program names ONLY the Ability its `me` printing prints (passives name none)", () => {
    const activated = new Set(["Wash Out", "Stone Arms", "Scent Collection", "Sky Transport"]);
    for (const [ids, , name] of FACES)
      for (const id of ids)
        expect(programAbilityNames(programFor(id)), id).toEqual(activated.has(name) ? [name] : []);
  });
});

// ── ON A BOARD: each program at its printed parameter, against a control ──

const ATTACKER = "d585-attacker";
const FILLER = "d585-filler";
const KLINKLANG = "sv10.5b-063";

function body(
  id: string,
  name: string,
  hp: number,
  stage: string,
  type: string,
  extra: Partial<Card>,
): Card {
  return battler(id, { name, hp, stage, types: [type], retreat: 2, ...extra });
}

const text = (id: string) => FACES.find(([ids]) => ids.includes(id))?.[3] ?? "";
const ability = (id: string, name: string): Partial<Card> => ({
  abilities: [{ type: "Ability", name, effect: text(id) }],
});

const LOCAL: Record<string, Card> = {
  "me03-024": body(
    "me03-024",
    "Aurorus",
    170,
    "Stage2",
    "Water",
    ability("me03-024", "Tundra Wall"),
  ),
  [KLINKLANG]: body(KLINKLANG, "Klinklang", 150, "Stage2", "Metal", {
    abilities: [{ type: "Ability", name: "Gear Coating", effect: FACES[0]?.[4] ?? "" }],
  }),
  "me03-019": body("me03-019", "Dewgong", 130, "Stage1", "Water", ability("me03-019", "Wash Out")),
  "me01-084": body(
    "me01-084",
    "Garganacl",
    180,
    "Stage2",
    "Fighting",
    ability("me01-084", "Powerful a-Salt"),
  ),
  "me02.5-135": body(
    "me02.5-135",
    "Mega Scrafty ex",
    330,
    "Stage1",
    "Darkness",
    ability("me02.5-135", "Counterattacking Crest"),
  ),
  "mep-065": body("mep-065", "Barbaracle", 130, "Stage1", "Fighting", {
    ...ability("mep-065", "Stone Arms"),
    attacks: [{ cost: ["Fighting", "Fighting", "Colorless"], name: "Hammer In", damage: 80 }],
  }),
  "me03-036": body(
    "me03-036",
    "Aromatisse",
    120,
    "Stage1",
    "Psychic",
    ability("me03-036", "Scent Collection"),
  ),
  "me02.5-152": body(
    "me02.5-152",
    "Mega Dragonite ex",
    370,
    "Stage2",
    "Dragon",
    ability("me02.5-152", "Sky Transport"),
  ),
  "me04-029": body("me04-029", "Ampharos", 160, "Stage2", "Lightning", {
    ...ability("me04-029", "Synchro Pulse"),
    attacks: [
      {
        cost: ["Lightning", "Colorless"],
        name: "Flashing Bolt",
        damage: 140,
        effect: "During your next turn, this Pokémon can't use Flashing Bolt.",
      },
    ],
  }),
  [FILLER]: battler(FILLER, {
    name: "D585 Filler",
    hp: 400,
    types: ["Colorless"],
    attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
  }),
  [ATTACKER]: battler(ATTACKER, {
    name: "D585 Attacker",
    hp: 400,
    types: ["Colorless"],
    attacks: [{ cost: ["Colorless"], name: "Smash", damage: 100 }],
  }),
};
const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL };
const DECK = deckOf({
  "me03-024": 3,
  [KLINKLANG]: 3,
  "me03-019": 2,
  "me01-084": 2,
  "me02.5-135": 2,
  "mep-065": 2,
  "me03-036": 2,
  "me02.5-152": 2,
  "me04-029": 2,
  [ATTACKER]: 3,
  [FILLER]: 13,
  "fix-energy": 3,
  "fix-water-energy": 5,
  "fix-metal-energy": 2,
  "fix-fire-energy": 2,
  "fix-fighting-energy": 5,
  "fix-psychic-energy": 4,
  "fix-lightning-energy": 3,
});

/** Setup, then P1's own turn (P2 went first and passed). Every card the boards below pull is
    returned to the deck first, so the surgery never depends on the deal. */
function p1Turn(): GameState {
  const created = createGame({ seed: 5853, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(
    applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first: "p2" }),
  );
  while (state.phase.kind === "setup:drawExtra") {
    const phase = state.phase;
    const s = (["p1", "p2"] as const).find((x) => !phase.decided[x]);
    if (s === undefined) throw new Error("setup:drawExtra with every seat decided");
    state = must(applyAction(state, { type: "setupDrawExtra", seat: s, count: phase.owed[s] }));
  }
  for (const s of ["p1", "p2"] as const) {
    const uid = state.players[s].hand.find(
      (h) => POOL[state.cardIdByUid[h] ?? ""]?.stage === "Basic",
    );
    if (uid === undefined) throw new Error(`no Basic in ${s}'s hand`);
    state = must(applyAction(state, { type: "setupPlaceActive", seat: s, uid }));
  }
  for (const s of ["p1", "p2"] as const)
    state = must(applyAction(state, { type: "setupReady", seat: s }));
  state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
  // The whole hand back into the deck (its bottom), both seats: the boards pull what they use.
  for (const s of ["p1", "p2"] as const) {
    const side = state.players[s];
    state = {
      ...state,
      players: { ...state.players, [s]: { ...side, hand: [], deck: [...side.deck, ...side.hand] } },
    };
  }
  return state;
}

/** `seat`'s hand set to exactly `n` cards off the top of its deck. */
function handOf(state: GameState, seat: Seat, n: number): GameState {
  const side = state.players[seat];
  const all = [...side.hand, ...side.deck];
  return {
    ...state,
    players: { ...state.players, [seat]: { ...side, hand: all.slice(0, n), deck: all.slice(n) } },
  };
}

function all<T extends GameEvent["type"]>(
  events: readonly GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

function idOf(state: GameState, uid: string | undefined): string | undefined {
  return uid === undefined ? undefined : state.cardIdByUid[uid];
}

const SMASH = { type: "attack", seat: "p1", index: 0 } as const;

/** P1's Active is the 100-damage attacker; P2's Active is `defender`, P2's Bench is `bench`. */
function smashInto(
  defender: string,
  bench: readonly string[],
  defenderEnergy: readonly string[],
): GameState {
  let state = setActiveFromDeck(p1Turn(), "p1", ATTACKER);
  state = attachFromDeck(state, "p1", "fix-energy", 1);
  state = clearBench(setActiveFromDeck(state, "p2", defender), "p2");
  for (const e of defenderEnergy) state = attachFromDeck(state, "p2", e, 1);
  for (const id of bench) state = benchFromDeck(state, "p2", id);
  return state;
}

const dealt = (state: GameState) => all(mustApply(state, SMASH).events, "DAMAGE_DEALT")[0]?.dealt;

describe("D585 §3 — Tundra Wall: 50 less for a body with {W} attached, and it doesn't stack", () => {
  it("a benched Aurorus shields the {W} Active by 50; a body without {W} takes the full 100", () => {
    expect(dealt(smashInto(FILLER, ["me03-024"], ["fix-water-energy"]))).toBe(50);
    expect(dealt(smashInto(FILLER, ["me03-024"], ["fix-fire-energy"]))).toBe(100);
    expect(dealt(smashInto(FILLER, [], ["fix-water-energy"]))).toBe(100);
  });

  it("two Aurorus pay 50, not 100 (the printed no-stack); Aurorus + Klinklang on {W}+{M} pay 50 + 20", () => {
    expect(dealt(smashInto(FILLER, ["me03-024", "me03-024"], ["fix-water-energy"]))).toBe(50);
    expect(
      dealt(smashInto(FILLER, ["me03-024", KLINKLANG], ["fix-water-energy", "fix-metal-energy"])),
    ).toBe(30);
    // Klinklang's own field stacks (no rider): the control for the ledger.
    expect(dealt(smashInto(FILLER, [KLINKLANG, KLINKLANG], ["fix-metal-energy"]))).toBe(60);
  });

  it('the Active Aurorus itself, with {W} attached, is one of "all of your Pokémon"', () => {
    expect(dealt(smashInto("me03-024", [], ["fix-water-energy"]))).toBe(50);
  });
});

describe("D585 §4 — Counterattacking Crest: 5 damage counters on the Attacking Pokémon", () => {
  it("the attacker takes 50 for Smash into an Active Mega Scrafty ex (a Filler control: 0)", () => {
    expect(mustApply(smashInto("me02.5-135", [], []), SMASH).state.players.p1.active?.damage).toBe(
      50,
    );
    expect(mustApply(smashInto(FILLER, [], []), SMASH).state.players.p1.active?.damage).toBe(0);
  });

  it('a BENCHED Mega Scrafty ex does nothing ("If this Pokémon is in the Active Spot")', () => {
    expect(
      mustApply(smashInto(FILLER, ["me02.5-135"], []), SMASH).state.players.p1.active?.damage,
    ).toBe(0);
  });
});

describe("D585 §5 — Powerful a-Salt: +30 for your {F} Pokémon's attacks", () => {
  function hammer(withGarganacl: boolean): GameState {
    let state = clearBench(setActiveFromDeck(p1Turn(), "p1", "mep-065"), "p1");
    state = attachFromDeck(state, "p1", "fix-fighting-energy", 3);
    if (withGarganacl) state = benchFromDeck(state, "p1", "me01-084");
    return clearBench(setActiveFromDeck(state, "p2", FILLER), "p2");
  }
  const HAMMER_IN = { type: "attack", seat: "p1", index: 0 } as const;

  it("Barbaracle's Hammer In does 80 + 30 with a benched Garganacl, 80 without", () => {
    expect(all(mustApply(hammer(true), HAMMER_IN).events, "DAMAGE_DEALT")[0]?.dealt).toBe(110);
    expect(all(mustApply(hammer(false), HAMMER_IN).events, "DAMAGE_DEALT")[0]?.dealt).toBe(80);
  });

  it("a Colorless attacker gets nothing from it (the beneficiary is the {F} attacker)", () => {
    let state = clearBench(setActiveFromDeck(p1Turn(), "p1", ATTACKER), "p1");
    state = benchFromDeck(attachFromDeck(state, "p1", "fix-energy", 1), "p1", "me01-084");
    state = clearBench(setActiveFromDeck(state, "p2", FILLER), "p2");
    expect(dealt(state)).toBe(100);
  });
});

describe("D585 §6 — Synchro Pulse: +80 while the two hands are the same size", () => {
  function bolt(p1Hand: number, p2Hand: number): GameState {
    let state = clearBench(setActiveFromDeck(p1Turn(), "p1", "me04-029"), "p1");
    state = attachFromDeck(state, "p1", "fix-lightning-energy", 2);
    state = clearBench(setActiveFromDeck(state, "p2", FILLER), "p2");
    return handOf(handOf(state, "p1", p1Hand), "p2", p2Hand);
  }
  const FLASHING_BOLT = { type: "attack", seat: "p1", index: 0 } as const;

  it("equal hands: 140 + 80; one card apart either way: 140", () => {
    expect(all(mustApply(bolt(4, 4), FLASHING_BOLT).events, "DAMAGE_DEALT")[0]?.dealt).toBe(220);
    expect(all(mustApply(bolt(0, 0), FLASHING_BOLT).events, "DAMAGE_DEALT")[0]?.dealt).toBe(220);
    expect(all(mustApply(bolt(4, 5), FLASHING_BOLT).events, "DAMAGE_DEALT")[0]?.dealt).toBe(140);
    expect(all(mustApply(bolt(5, 4), FLASHING_BOLT).events, "DAMAGE_DEALT")[0]?.dealt).toBe(140);
  });

  it('only "this Pokémon": a benched Ampharos gives the attacker nothing', () => {
    let state = clearBench(setActiveFromDeck(p1Turn(), "p1", ATTACKER), "p1");
    state = benchFromDeck(attachFromDeck(state, "p1", "fix-energy", 1), "p1", "me04-029");
    state = clearBench(setActiveFromDeck(state, "p2", FILLER), "p2");
    expect(dealt(handOf(handOf(state, "p1", 3), "p2", 3))).toBe(100);
  });
});

function use(
  target: { spot: "active" } | { spot: "bench"; index: number },
  abilityName: string,
): GameAction {
  return { type: "useAbility", seat: "p1", target, abilityName };
}

describe("D585 §7 — Wash Out: a {W} Energy from the Bench to the Active, as often as you like", () => {
  function washBoard(): GameState {
    let state = clearBench(setActiveFromDeck(p1Turn(), "p1", FILLER), "p1");
    state = benchFromDeck(state, "p1", "me03-019");
    state = attachBenchFromDeck(state, "p1", 0, "fix-water-energy", 2);
    state = attachBenchFromDeck(state, "p1", 0, "fix-fire-energy", 1);
    return state;
  }
  const washOut = use({ spot: "bench", index: 0 }, "Wash Out");

  function moveOne(state: GameState): GameState {
    const parked = mustApply(state, washOut).state;
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "moveEnergy") throw new Error(`expected moveEnergy, got ${prompt.kind}`);
    expect(prompt.destinations).toEqual([{ seat: "p1", spot: { spot: "active" } }]);
    const offered = prompt.movable.map((m) => idOf(parked, m.uid));
    expect(
      offered.every((id) => id === "fix-water-energy"),
      `${offered}`,
    ).toBe(true);
    const uid = prompt.movable[0]?.uid as string;
    const done = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: {
        kind: "moveEnergy",
        picks: [{ uid, dest: { seat: "p1", spot: { spot: "active" } } }],
      },
    }).state;
    expect(done.players.p1.active?.energy).toContain(uid);
    return done;
  }

  it("moves only {W} (the {R} stays), twice in one turn, then has nothing to move", () => {
    const twice = moveOne(moveOne(washBoard()));
    expect(twice.players.p1.active?.energy.map((u) => idOf(twice, u))).toEqual([
      "fix-water-energy",
      "fix-water-energy",
    ]);
    expect(twice.players.p1.bench[0]?.energy.map((u) => idOf(twice, u))).toEqual([
      "fix-fire-energy",
    ]);
    expectErr(twice, washOut, "NO_LEGAL_TARGET");
  });

  it('"Fire Off" is no such Ability on Dewgong', () => {
    expectErr(washBoard(), use({ spot: "bench", index: 0 }, "Fire Off"), "NO_SUCH_ABILITY");
  });
});

describe("D585 §8 — Stone Arms: a Basic {F} Energy from hand to 1 of your {F} Pokémon, once", () => {
  function stoneBoard(): GameState {
    let state = clearBench(setActiveFromDeck(p1Turn(), "p1", "mep-065"), "p1");
    state = benchFromDeck(state, "p1", FILLER);
    state = benchFromDeck(state, "p1", "me01-084");
    state = handFromDeck(state, "p1", "fix-water-energy", 1);
    return handFromDeck(state, "p1", "fix-fighting-energy", 1);
  }
  const stoneArms = use({ spot: "active" }, "Stone Arms");

  it("offers the {F} bodies only, attaches the {F} card, and is used once per turn", () => {
    const parked = mustApply(stoneBoard(), stoneArms).state;
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "choosePokemon")
      throw new Error(`expected choosePokemon, got ${prompt.kind}`);
    expect(prompt.candidates).toEqual([
      { seat: "p1", spot: { spot: "active" } },
      { seat: "p1", spot: { spot: "bench", index: 1 } },
    ]);
    const { state, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon", ref: { seat: "p1", spot: { spot: "bench", index: 1 } } },
    });
    expect(all(events, "ENERGY_ATTACHED").map((e) => idOf(state, e.uid))).toEqual([
      "fix-fighting-energy",
    ]);
    expect(state.players.p1.bench[1]?.energy.map((u) => idOf(state, u))).toEqual([
      "fix-fighting-energy",
    ]);
    expect(state.players.p1.hand.map((u) => idOf(state, u))).toEqual(["fix-water-energy"]);
    expectErr(
      handFromDeck(state, "p1", "fix-fighting-energy", 1),
      stoneArms,
      "ABILITY_ALREADY_USED",
    );
  });

  it("with no Basic {F} Energy in hand it does nothing (the {W} card is not offered)", () => {
    let state = stoneBoard();
    const side = state.players.p1;
    const fighting = side.hand.filter((u) => idOf(state, u) === "fix-fighting-energy");
    state = {
      ...state,
      players: {
        ...state.players,
        p1: {
          ...side,
          hand: side.hand.filter((u) => !fighting.includes(u)),
          deck: [...side.deck, ...fighting],
        },
      },
    };
    expect(state.players.p1.hand.map((u) => idOf(state, u))).toEqual(["fix-water-energy"]);
    expectErr(state, stoneArms, "NO_LEGAL_TARGET");
  });
});

describe("D585 §9 — Scent Collection: up to 2 Basic {P} Energy from the deck, from the Bench", () => {
  it("offers only Basic {P} Energy, takes 2 into the hand, shuffles; once per turn", () => {
    let state = clearBench(setActiveFromDeck(p1Turn(), "p1", FILLER), "p1");
    state = benchFromDeck(state, "p1", "me03-036");
    const scent = use({ spot: "bench", index: 0 }, "Scent Collection");
    const parked = mustApply(state, scent).state;
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "chooseCards") throw new Error(`expected chooseCards, got ${prompt.kind}`);
    expect(prompt).toMatchObject({ max: 2, dest: "hand" });
    const offered = (prompt.candidates as string[]).map((u) => idOf(parked, u));
    expect(new Set(offered)).toEqual(new Set(["fix-psychic-energy"]));
    const inDeck = state.players.p1.deck.filter((u) => idOf(state, u) === "fix-psychic-energy");
    expect(offered).toHaveLength(inDeck.length);
    expect(inDeck.length).toBeGreaterThan(2);
    const picks = (prompt.candidates as string[]).slice(0, 2);
    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: picks },
    });
    for (const uid of picks) expect(done.players.p1.hand).toContain(uid);
    expect(events.some((e) => e.type === "SHUFFLE")).toBe(true);
    expectErr(done, scent, "ABILITY_ALREADY_USED");
  });
});

describe("D585 §10 — Sky Transport: switch your Active with 1 of your Benched Pokémon, once", () => {
  it("from the Active Spot: Dragonite goes to the Bench, the benched body comes up", () => {
    let state = clearBench(setActiveFromDeck(p1Turn(), "p1", "me02.5-152"), "p1");
    state = benchFromDeck(state, "p1", FILLER);
    const sky = use({ spot: "active" }, "Sky Transport");
    const { state: done, events } = mustApply(state, sky);
    expect(all(events, "ABILITY_USED").map((e) => e.ability)).toEqual(["Sky Transport"]);
    expect(idOf(done, done.players.p1.active?.stack.at(-1))).toBe(FILLER);
    expect(idOf(done, done.players.p1.bench[0]?.stack.at(-1))).toBe("me02.5-152");
    expectErr(done, use({ spot: "bench", index: 0 }, "Sky Transport"), "ABILITY_ALREADY_USED");
  });

  it("is refused with an empty Bench (nothing to switch with)", () => {
    const state = clearBench(setActiveFromDeck(p1Turn(), "p1", "me02.5-152"), "p1");
    expectErr(state, use({ spot: "active" }, "Sky Transport"), "NO_LEGAL_TARGET");
  });
});
