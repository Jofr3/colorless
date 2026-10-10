import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import { meAttackCorpus } from "./censusAttackCorpusMe";
import { attackMenuOf, passivesOf } from "./continuous";
import { bonusConsequentProgram, deriveAttackBonusConsequent, deriveAttackDamageMultiplier } from "./effects";
import type { GameEvent } from "./events";
import { applyAction, createGame, engineVersion } from "./index";
import type { GameState, InPlayPokemon, Seat } from "./index";
import { programFor } from "./registry";
import {
  FIXTURE_POOL,
  attachFromDeck,
  attachToolFromDeck,
  battler,
  clearBench,
  deckOf,
  mustApply,
  setActiveFromDeck,
  trainerCard,
  typedEnergy,
} from "./testFixtures";

// ── 🆕🆕🆕 D620 — WP10 (PRIZES YOU HAVE TAKEN + MEGA MAWILE ex) + WP26 (TOOLS) ──
//
// 8 printed texts / 14 `me` units on 12 printings. WP10: the NEW `DamageCountSource.yourPrizesTaken` (Luxray
// "Incessant Onslaught", Fuecoco ex ×2 "Cheerful Flame", Mega Mawile ex ×2 "Gobble Down") and the NEW
// `AttackBonusConsequent.baseOverride` (Mega Mawile ex ×2 "Huge Bite"). WP26: Light Ball (Maximum Belt's
// row, a named holder), Punk Helmet ×2 (Rocky Helmet's row, the NEW `damageAttacker.holderType`), Team
// Rocket's Hypnotizer (Lucky Helmet's stage, Scorching Armor's program behind `yourActiveOwner`), Core
// Memory (the NEW `toolAttacksHolder`) and Tremendous Bomb ×2 (the NEW `damageAttackerActiveThenDiscardIf`).
// Every id and text off the LOCAL D1 (`apps/api/.wrangler/…/8437d866….sqlite`), 2026-10-09,
// `legal_standard = 1`. Dropped and named: Adversity Policy `me04-074` (a Weakness gate, a new
// `BoardCondition` member). [🆕🆕🆕 D626 (D539): Adversity Policy BUILT at D626 (K1, the new
// `yourActiveWeakToOpponentActiveType`).] Driven on a LOCAL `cardPool` (D275) in the suite's OWN 60-card deck (D270).

const ONSLAUGHT = "This attack does 70 damage for each Prize card you have taken.";
const GOBBLE = "This attack does 80 damage for each Prize card you have taken.";
const HUGE_BITE =
  "If your opponent's Active Pokémon already has any damage counters on it, this attack's base damage is 30.";
const LIGHT_BALL_TEXT =
  "Attacks used by the Pikachu ex this card is attached to do 50 more damage to your opponent's Active Pokémon ex (before applying Weakness and Resistance).";
const PUNK_TEXT =
  "If the {D} Pokémon this card is attached to is in the Active Spot and is damaged by an attack from your opponent's Pokémon (even if this Pokémon is Knocked Out), place 4 damage counters on the Attacking Pokémon.";
const HYPNO_TEXT =
  "If the Team Rocket's Pokémon this card is attached to is in the Active Spot and is damaged by an attack from your opponent's Pokémon (even if this Team Rocket's Pokémon is Knocked Out), the Attacking Pokémon is now Asleep.";
const CORE_TEXT =
  "The Mega Zygarde ex this card is attached to can use the attack on this card. (You still need the necessary Energy to use this attack.)";
const BOMB_TEXT =
  "If the Pokémon this card is attached to isn't a Mega Evolution Pokémon ex, is in the Active Spot, and takes 240 or more damage from an attack from your opponent's Mega Evolution Pokémon ex (even if this Pokémon is Knocked Out), place 12 damage counters on the Attacking Pokémon. If you placed any damage counters in this way, discard this card.";

const MAWILE = ["me01-094", "me01-162"] as const;
const LUXRAY = "me03-028";
const FUECOCO = ["30th-015", "30th-147"] as const;
const LIGHT_BALL = "me02.5-191";
const PUNK = ["me02-092", "me02-121"] as const;
const HYPNO = "me02.5-206";
const CORE = "me03-070";
const BOMB = ["me05-082", "me05-113"] as const;
const ZYGARDE = "me03-047";
const ADVERSITY = "me04-074";

const ATK = "d620-attacker";
const MEGA = "d620-mega";
const PIKACHU = "d620-pikachu";
const WALL = "d620-wall";
const WALL_EX = "d620-wall-ex";
const WEAK = "d620-weak";
const DARK = "d620-dark";
const ROCKET = "d620-rocket";
const MEGA_WALL = "d620-mega-wall";
const FRAIL = "d620-frail";
const M = "d620-metal";
const F = "d620-fighting";
const L = "d620-lightning";

// The test attackers' attacks: every cost is ONE {C}.
const BLAST = 0; // 120
const BIG = 1; // 240
const SHORT = 2; // 230
const ARROW = 3; // 240 to a chosen opposing Pokémon — `snipeActive` → `reactToAttackDamage` on the Active
const ATTACKS = [
  { cost: ["Colorless"], name: "Blast", damage: 120 },
  { cost: ["Colorless"], name: "Big", damage: 240 },
  { cost: ["Colorless"], name: "Short", damage: 230 },
  {
    cost: ["Colorless"],
    name: "Arrow",
    effect:
      "This attack does 240 damage to 1 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
  },
];

const tool = (id: string, name: string, effect: string, extra: Partial<Card> = {}): Card => ({
  ...trainerCard(id, "Tool", effect),
  name,
  ...extra,
});
const body = (id: string, name: string, type: string, extra: Partial<Card> = {}): Card =>
  battler(id, { name, types: [type], hp: 300, ...extra } as Partial<Card>);

const LOCAL_CARDS: Record<string, Card> = {
  [MAWILE[0]]: battler(MAWILE[0], {
    name: "Mega Mawile ex",
    hp: 270,
    types: ["Metal"],
    retreat: 2,
    weaknesses: [{ type: "Fire", value: "×2" }],
    attacks: [
      { cost: ["Metal", "Metal"], name: "Gobble Down", damage: "80×", effect: GOBBLE },
      { cost: ["Metal", "Metal", "Colorless"], name: "Huge Bite", damage: 260, effect: HUGE_BITE },
    ],
  } as Partial<Card>),
  [LUXRAY]: battler(LUXRAY, {
    name: "Luxray",
    stage: "Stage2",
    evolveFrom: "Luxio",
    hp: 150,
    types: ["Lightning"],
    retreat: 0,
    attacks: [
      { cost: ["Lightning", "Colorless"], name: "Incessant Onslaught", damage: "70×", effect: ONSLAUGHT },
      { cost: ["Lightning", "Colorless", "Colorless"], name: "Strong Volt", damage: 200, effect: "Discard 2 Energy from this Pokémon." },
    ],
  } as Partial<Card>),
  [LIGHT_BALL]: tool(LIGHT_BALL, "Light Ball", LIGHT_BALL_TEXT),
  [PUNK[0]]: tool(PUNK[0], "Punk Helmet", PUNK_TEXT),
  [HYPNO]: tool(HYPNO, "Team Rocket's Hypnotizer", HYPNO_TEXT),
  [CORE]: tool(CORE, "Core Memory", CORE_TEXT, {
    attacks: [
      {
        cost: ["Fighting", "Fighting", "Fighting", "Fighting"],
        name: "Geobuster",
        damage: 350,
        effect: "Discard all Energy from this Pokémon.",
      },
    ],
  } as Partial<Card>),
  [BOMB[0]]: tool(BOMB[0], "Tremendous Bomb", BOMB_TEXT),
  [ZYGARDE]: battler(ZYGARDE, {
    name: "Mega Zygarde ex",
    hp: 310,
    types: ["Fighting"],
    retreat: 2,
    weaknesses: [{ type: "Grass", value: "×2" }],
    attacks: [
      {
        cost: ["Fighting", "Fighting", "Fighting"],
        name: "Gaia Wave",
        damage: 200,
        effect:
          "During your opponent's next turn, this Pokémon takes 30 less damage from attacks (after applying Weakness and Resistance).",
      },
      {
        cost: ["Fighting", "Fighting", "Fighting", "Fighting", "Fighting"],
        name: "Nullifying Zero",
        effect:
          "For each of your opponent's Pokémon, flip a coin. If heads, this attack does 150 damage to that Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      },
    ],
  } as Partial<Card>),
  [ATK]: body(ATK, "D620 Attacker", "Colorless", { hp: 340, attacks: ATTACKS } as Partial<Card>),
  [MEGA]: body(MEGA, "Mega D620 ex", "Colorless", { hp: 340, attacks: ATTACKS } as Partial<Card>),
  [PIKACHU]: body(PIKACHU, "Pikachu ex", "Lightning", { hp: 200, attacks: ATTACKS } as Partial<Card>),
  [WALL]: body(WALL, "D620 Wall", "Colorless", { hp: 400 } as Partial<Card>),
  [WALL_EX]: body(WALL_EX, "D620 Wall ex", "Colorless", { hp: 400 } as Partial<Card>),
  [WEAK]: body(WEAK, "D620 Weak", "Colorless", { weaknesses: [{ type: "Metal", value: "×2" }] } as Partial<Card>),
  [DARK]: body(DARK, "D620 Dark", "Darkness"),
  [ROCKET]: body(ROCKET, "Team Rocket's D620", "Darkness"),
  [MEGA_WALL]: body(MEGA_WALL, "Mega D620 Wall ex", "Colorless", { hp: 400 } as Partial<Card>),
  [FRAIL]: body(FRAIL, "D620 Frail", "Colorless", { hp: 200 } as Partial<Card>),
  [M]: typedEnergy(M, "Metal"),
  [F]: typedEnergy(F, "Fighting"),
  [L]: typedEnergy(L, "Lightning"),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

/** Its OWN deck (D270), 60 by construction. */
const DECK = deckOf({
  [MAWILE[0]]: 1,
  [LUXRAY]: 1,
  [LIGHT_BALL]: 1,
  [PUNK[0]]: 1,
  [HYPNO]: 1,
  [CORE]: 1,
  [BOMB[0]]: 1,
  [ZYGARDE]: 1,
  [ATK]: 1,
  [MEGA]: 1,
  [PIKACHU]: 1,
  [WALL]: 20,
  [WALL_EX]: 1,
  [WEAK]: 1,
  [DARK]: 1,
  [ROCKET]: 1,
  [MEGA_WALL]: 1,
  [FRAIL]: 1,
  [M]: 3,
  [F]: 4,
  [L]: 1,
  "fix-energy": 15,
});

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

/** Setup with p2 going first; returns p1's turn 2 after p2 passed, both hands back into the decks. */
function opened(): GameState {
  const created = createGame({ seed: 6200, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
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
    state = { ...state, players: { ...state.players, [s]: { ...side, hand: [], deck: [...side.deck, ...side.hand] } } };
  }
  return state;
}

/** TEST SURGERY — one copy of `id` into `seat`'s DECK (swapped out of the Prizes for a WALL when it is
    prized). Every uid stays in exactly one zone. */
function ensureInDeck(state: GameState, seat: Seat, id: string): GameState {
  const side = state.players[seat];
  if (side.deck.some((u) => state.cardIdByUid[u] === id)) return state;
  const prized = side.prizes.find((u) => state.cardIdByUid[u] === id);
  const swap = side.deck.find((u) => !side.prizes.includes(u) && state.cardIdByUid[u] === WALL);
  if (prized === undefined || swap === undefined) throw new Error(`${seat} has no ${id} to seat`);
  const next = {
    ...side,
    prizes: side.prizes.map((u) => (u === prized ? swap : u)),
    deck: [...side.deck.filter((u) => u !== swap), prized],
  };
  return { ...state, players: { ...state.players, [seat]: next } };
}

/** p1's turn 2: `attacker` (holding `attackerTool`, with `energy`) against `defender` (holding
    `defenderTool`, with `damage` on it); both Benches empty. */
function table(opts: {
  attacker?: string;
  attackerTool?: string;
  energy?: readonly (readonly [string, number])[];
  defender?: string;
  defenderTool?: string;
  damage?: number;
}): GameState {
  let state = opened();
  for (const s of ["p1", "p2"] as const) state = clearBench(setActiveFromDeck(state, s, WALL), s);
  const atk = opts.attacker ?? ATK;
  state = setActiveFromDeck(ensureInDeck(state, "p1", atk), "p1", atk);
  const def = opts.defender ?? WALL;
  state = setActiveFromDeck(ensureInDeck(state, "p2", def), "p2", def);
  state = clearBench(clearBench(state, "p1"), "p2");
  if (opts.attackerTool !== undefined) {
    state = attachToolFromDeck(ensureInDeck(state, "p1", opts.attackerTool), "p1", "active", opts.attackerTool);
  }
  if (opts.defenderTool !== undefined) {
    state = attachToolFromDeck(ensureInDeck(state, "p2", opts.defenderTool), "p2", "active", opts.defenderTool);
  }
  for (const [id, n] of opts.energy ?? [["fix-energy", 1]]) state = attachFromDeck(state, "p1", id, n);
  if (opts.damage !== undefined) {
    const p2 = state.players.p2;
    state = { ...state, players: { ...state.players, p2: { ...p2, active: { ...(p2.active as InPlayPokemon), damage: opts.damage } } } };
  }
  return state;
}

/** TEST SURGERY — `seat` has taken `n` Prizes: `n` cards from its Prize pile into its hand. */
function took(state: GameState, seat: Seat, n: number): GameState {
  const side = state.players[seat];
  const moved = side.prizes.slice(0, n);
  return {
    ...state,
    players: { ...state.players, [seat]: { ...side, prizes: side.prizes.slice(n), hand: [...side.hand, ...moved] } },
  };
}

const swing = (state: GameState, index: number) => mustApply(state, { type: "attack", seat: "p1", index });
const of = <T extends GameEvent["type"]>(events: readonly GameEvent[], type: T) =>
  events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
const activeDamage = (state: GameState, seat: Seat = "p2") => state.players[seat].active?.damage;
const toolIds = (state: GameState, seat: Seat) =>
  (state.players[seat].active?.tools ?? []).map((u) => state.cardIdByUid[u]);
const discardIds = (state: GameState, seat: Seat) => state.players[seat].discard.map((u) => state.cardIdByUid[u]);

// ────────────────────────────────────────────────────────────────────────────
describe("D620 §1 — the prints, the registry rows and the readings", () => {
  it("the five Tool objects, one per printed text, on the 7 `me` ids", () => {
    expect(programFor(LIGHT_BALL)).toEqual({
      passive: {
        damageBonusBeforeWRIfTarget: { amount: 50, targetSuffix: "ex", holder: { kind: "byName", name: "Pikachu ex" } },
      },
    });
    expect(programFor(PUNK[0])).toEqual({ passive: { damageAttacker: { amount: 40, holderType: "Darkness" } } });
    expect(programFor(PUNK[1])).toBe(programFor(PUNK[0]));
    expect(programFor(HYPNO)).toEqual({
      triggered: [
        {
          name: "Team Rocket's Hypnotizer",
          trigger: "onDamagedByAttack",
          program: [
            {
              op: "conditionGate",
              cond: { kind: "yourActiveOwner", owner: "Team Rocket" },
              // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable.
              then: [{ op: "applyStatus", target: "defender", status: "asleep" }],
            },
          ],
        },
      ],
    });
    expect(programFor(CORE)).toEqual({ toolAttacks: true, toolAttacksHolder: { kind: "byName", name: "Mega Zygarde ex" } });
    expect(programFor(BOMB[0])).toEqual({
      passive: {
        damageAttackerActiveThenDiscardIf: {
          amount: 120,
          minDamage: 240,
          attacker: { kind: "megaEvolutionEx" },
          holderNot: { kind: "megaEvolutionEx" },
        },
      },
    });
    expect(programFor(BOMB[1])).toBe(programFor(BOMB[0]));
    // WP10's attack texts are reader rows: no registry key.
    for (const id of [...MAWILE, LUXRAY, ...FUECOCO]) expect(programFor(id), id).toBeUndefined();
  });

  it("WP10's three attack texts: rows of the `me` corpus (3 / 2 / 2 printings), none printed in Standard `sv` (Aegislash ex `sv04-135` / `-230` is Expanded-only), each now read", () => {
    const me = new Map(meAttackCorpus().map(([n, text]) => [text, n]));
    const sv = new Set(legalAttackCorpus().map(([, text]) => text));
    for (const [text, n] of [
      [ONSLAUGHT, 3],
      [GOBBLE, 2],
      [HUGE_BITE, 2],
    ] as const) {
      expect([text, me.get(text)]).toEqual([text, n]);
      expect(sv.has(text), text).toBe(false);
      expect(resolvedByAnyReader(text), text).toBe(true);
    }
    expect(deriveAttackDamageMultiplier(ONSLAUGHT)).toEqual({ per: 70, count: { kind: "yourPrizesTaken" } });
    expect(deriveAttackDamageMultiplier(GOBBLE)).toEqual({ per: 80, count: { kind: "yourPrizesTaken" } });
    expect(deriveAttackBonusConsequent(HUGE_BITE)).toEqual({
      decider: { kind: "boardCondition", cond: { kind: "opponentActiveDamaged" } },
      bonus: 0,
      ops: [],
      baseOverride: 30,
    });
  });

  it("Huge Bite's program: 30 on a damaged defender, the printed 260 otherwise", () => {
    const reading = deriveAttackBonusConsequent(HUGE_BITE);
    if (reading === null) throw new Error("Huge Bite unread");
    expect(bonusConsequentProgram(reading, 260)).toEqual([
      {
        op: "conditionGate",
        cond: { kind: "opponentActiveDamaged" },
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable.
        then: [{ op: "damageDefender", amount: 30 }],
        otherwise: [{ op: "damageDefender", amount: 260 }],
      },
    ]);
  });

  it("the near misses stay unread: the additive twin, a printed 0, an unmapped clause", () => {
    for (const near of [
      "This attack does 70 more damage for each Prize card you have taken.",
      "This attack does 0 damage for each Prize card you have taken.",
      "If your opponent's Active Pokémon already has any damage counters on it, this attack's base damage is 0.",
      "If your opponent's Bench is full, this attack's base damage is 30.",
    ]) {
      expect(resolvedByAnyReader(near), near).toBe(false);
    }
  });

  it("Adversity Policy is dropped: unkeyed (🆕🆕🆕 D626 (D539): WITHDRAWN — built at D626, K1, `koTriggerRestMeD626.test.ts`)", () => {
    expect(Object.keys(programFor(ADVERSITY) ?? {})).toEqual(["triggered"]);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D620 §2 — \"for each Prize card you have taken\": the ATTACKER's own taken Prizes", () => {
  const mawile = () => table({ attacker: MAWILE[0], energy: [[M, 2]] });

  it("🛑 Gobble Down: 80 × the Prizes p1 has taken — 0, 2 and 4", () => {
    expect(activeDamage(swing(mawile(), 0).state)).toBe(0);
    expect(activeDamage(swing(took(mawile(), "p1", 2), 0).state)).toBe(160);
    expect(activeDamage(swing(took(mawile(), "p1", 4), 0).state)).toBe(320);
  });

  it("🛑 the OPPONENT's taken Prizes do not count (the seat is the attacker's)", () => {
    expect(activeDamage(swing(took(mawile(), "p2", 3), 0).state)).toBe(0);
    expect(activeDamage(swing(took(took(mawile(), "p2", 3), "p1", 1), 0).state)).toBe(80);
  });

  it("🛑 Incessant Onslaught: 70 × taken — 3 and 0", () => {
    const luxray = () => table({ attacker: LUXRAY, energy: [[L, 1], ["fix-energy", 1]] });
    expect(activeDamage(swing(took(luxray(), "p1", 3), 0).state)).toBe(210);
    expect(activeDamage(swing(took(luxray(), "p1", 0), 0).state)).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D620 §3 — Mega Mawile ex \"Huge Bite\": the base damage is 30 on a damaged defender", () => {
  const bite = (defender: string, damage?: number) =>
    table({ attacker: MAWILE[0], energy: [[M, 2], ["fix-energy", 1]], defender, damage });

  it("🛑 an undamaged defender takes the printed 260; a damaged one takes 30", () => {
    expect(activeDamage(swing(bite(WALL), 1).state)).toBe(260);
    expect(activeDamage(swing(bite(WALL, 10), 1).state)).toBe(10 + 30);
  });

  it("🛑 the override is the BASE: Weakness still doubles it (30 × 2, and 260 × 2 → KO)", () => {
    expect(activeDamage(swing(bite(WEAK, 10), 1).state)).toBe(10 + 60);
    const { events } = swing(bite(WEAK), 1);
    expect(of(events, "DAMAGE_DEALT").map((e) => e.dealt)).toEqual([520]);
    expect(of(events, "KNOCKED_OUT")).toHaveLength(1);
  });

  it("one hit, one DAMAGE_DEALT row", () => {
    expect(of(swing(bite(WALL, 10), 1).events, "DAMAGE_DEALT")).toHaveLength(1);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D620 §4 — Light Ball: a Pikachu ex holder does 50 more to an opposing Active ex", () => {
  it("🛑 Pikachu ex holder vs an ex: 170; vs a non-ex: 120", () => {
    expect(activeDamage(swing(table({ attacker: PIKACHU, attackerTool: LIGHT_BALL, defender: WALL_EX }), BLAST).state)).toBe(170);
    expect(activeDamage(swing(table({ attacker: PIKACHU, attackerTool: LIGHT_BALL }), BLAST).state)).toBe(120);
  });

  it("🛑 THE HOLDER CLAUSE — on any other holder it does nothing", () => {
    expect(activeDamage(swing(table({ attackerTool: LIGHT_BALL, defender: WALL_EX }), BLAST).state)).toBe(120);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D620 §5 — Punk Helmet: a {D} Active holder damaged puts 4 counters on the attacker", () => {
  it("🛑 a {D} holder: 40 on the attacker, one `counterattack` row", () => {
    const { state, events } = swing(table({ defender: DARK, defenderTool: PUNK[0] }), BLAST);
    expect(activeDamage(state, "p1")).toBe(40);
    expect(of(events, "COUNTERS_PLACED").map((e) => [e.amount, e.source])).toEqual([[40, "counterattack"]]);
  });

  it("🛑 THE HOLDER GATE — a non-{D} holder retaliates for nothing (and the fold carries 0)", () => {
    const state = table({ defender: WALL, defenderTool: PUNK[0] });
    expect(passivesOf(state, state.players.p2.active as InPlayPokemon).damageAttacker).toBe(0);
    expect(activeDamage(swing(state, BLAST).state, "p1")).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D620 §6 — Team Rocket's Hypnotizer: a Team Rocket's Active holder damaged puts the attacker to sleep", () => {
  // The attack ends p1's turn, so the Checkup's wake-up flip follows: the rung reads the application row.
  const slept = (events: readonly GameEvent[]) =>
    of(events, "STATUS_APPLIED").filter((e) => e.seat === "p1" && e.status === "asleep");

  it("🛑 a Team Rocket's holder: the attacker is now Asleep (one `STATUS_APPLIED` row on p1)", () => {
    expect(slept(swing(table({ defender: ROCKET, defenderTool: HYPNO }), BLAST).events)).toHaveLength(1);
  });

  it("🛑 THE HOLDER GATE — any other holder: no Sleep", () => {
    const { state, events } = swing(table({ defender: DARK, defenderTool: HYPNO }), BLAST);
    expect(slept(events)).toEqual([]);
    expect(state.players.p1.active?.conditions.rotation).toBe("none");
  });

  it("\"even if Knocked Out\": a lethal hit on the holder still puts the attacker to sleep", () => {
    const state = table({ defender: ROCKET, defenderTool: HYPNO, damage: 200 });
    const done = swing(state, BLAST).state;
    expect(done.players.p1.active?.conditions.rotation).toBe("asleep");
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D620 §7 — Core Memory: only a Mega Zygarde ex holder can use \"Geobuster\"", () => {
  const menu = (state: GameState) =>
    attackMenuOf(state, "p1", state.players.p1.active as InPlayPokemon).map((r) => `${r.attack.name}/${r.origin}`);

  it("🛑 a Mega Zygarde ex holder lists it after its two printed attacks; any other holder does not", () => {
    expect(menu(table({ attacker: ZYGARDE, attackerTool: CORE }))).toEqual([
      "Gaia Wave/printed",
      "Nullifying Zero/printed",
      "Geobuster/tool",
    ]);
    expect(menu(table({ attacker: ATK, attackerTool: CORE }))).toEqual([
      "Blast/printed",
      "Big/printed",
      "Short/printed",
      "Arrow/printed",
    ]);
  });

  it("🛑 Geobuster: 350 to the defender, then all Energy from Mega Zygarde ex discarded", () => {
    const state = table({ attacker: ZYGARDE, attackerTool: CORE, energy: [[F, 4]] });
    const done = swing(state, 2).state;
    expect(activeDamage(done)).toBe(350);
    expect(done.players.p1.active?.energy).toEqual([]);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// R-TRB1 ⚠️ UNRULED — "takes 240 or more damage from an attack" is read on ONE hit's `dealt` (after Weakness,
// Resistance and reductions, before the KO clamp), never summed across two hits of one attack.
describe("D620 §8 — Tremendous Bomb: 240+ from an opposing Mega ex on a non-Mega holder", () => {
  it("🛑 a Mega ex attacker dealing 240: 12 counters on it, then the Bomb is discarded", () => {
    const { state, events } = swing(table({ attacker: MEGA, defenderTool: BOMB[0] }), BIG);
    expect(activeDamage(state, "p1")).toBe(120);
    expect(of(events, "COUNTERS_PLACED").map((e) => [e.amount, e.source])).toEqual([[120, "counterattack"]]);
    expect(toolIds(state, "p2")).toEqual([]);
    expect(discardIds(state, "p2")).toContain(BOMB[0]);
  });

  it("🛑 230 is under the threshold: nothing, and the Bomb stays", () => {
    const state = swing(table({ attacker: MEGA, defenderTool: BOMB[0] }), SHORT).state;
    expect(activeDamage(state, "p1")).toBe(0);
    expect(toolIds(state, "p2")).toEqual([BOMB[0]]);
  });

  it("🛑 a non-Mega attacker dealing 240: nothing", () => {
    const state = swing(table({ attacker: ATK, defenderTool: BOMB[0] }), BIG).state;
    expect(activeDamage(state, "p1")).toBe(0);
    expect(toolIds(state, "p2")).toEqual([BOMB[0]]);
  });

  it("🛑 a Mega ex HOLDER: nothing", () => {
    const state = swing(table({ attacker: MEGA, defender: MEGA_WALL, defenderTool: BOMB[0] }), BIG).state;
    expect(activeDamage(state, "p1")).toBe(0);
    expect(toolIds(state, "p2")).toEqual([BOMB[0]]);
  });

  it("🛑 the re-homed Active hit (`snipeActive` → `reactToAttackDamage`): 240 on the picked Bomb holder bombs the attacker", () => {
    // The Active is the only candidate (empty Bench), so the snipe lands without a prompt.
    const { state, events } = swing(table({ attacker: MEGA, defenderTool: BOMB[0] }), ARROW);
    expect(of(events, "DAMAGE_DEALT")).toHaveLength(1);
    expect(activeDamage(state)).toBe(240);
    expect(activeDamage(state, "p1")).toBe(120);
    expect(toolIds(state, "p2")).toEqual([]);
  });

  it("\"even if this Pokémon is Knocked Out\": a 200-HP holder taking 240 still bombs the attacker", () => {
    const { state } = swing(table({ attacker: MEGA, defender: FRAIL, defenderTool: BOMB[0] }), BIG);
    expect(activeDamage(state, "p1")).toBe(120);
  });
});

describe("D620 §9 — the version", () => {
  it("is built at engine 0.519.0", () => {
    expect(engineVersion).toBe("0.519.0");
  });
});
