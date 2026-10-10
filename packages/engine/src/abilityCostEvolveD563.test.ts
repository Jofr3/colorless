import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { intoPlayOnlyViaOf, passivesOf, providedEnergy } from "./continuous";
import type { GameEvent } from "./events";
import { applyAction, attackCostAt, createGame, engineVersion, redactGame } from "./index";
import type { GameAction, GameState, InPlayPokemon, Seat } from "./index";
import { conditionHolds, conditionNote, evolveAliasLicensed } from "./interpreter";
import { programFor } from "./registry";
import { FIXTURE_POOL, battler, benchFromDeck, clearBench, deckOf, setActiveFromDeck, trainerCard } from "./testFixtures";

// ── 🆕🆕🆕 D563 — TWO OWN-ATTACK COST CLAUSES, AN EVOLVE ALIAS AND A CARD-BORNE PLAY RESTRICTION ──
//
//   Noivern    sv09-128                          "Tuning Echo"  — equal hands: ignore all Energy
//                                                                   in the cost of Frightening Howl
//   Kyurem     sv06.5-047                        "Plasma Bane"  — a "Colress" card in the
//                                                                   opponent's discard: Trifrost for {C}
//   Eevee ex   svp-174 / sv08.5-075 / sv08.5-167  "Rainbow DNA"  — evolves into any Pokémon ex that
//                                                                   evolves from Eevee (from the hand)
//   Palafin ex svp-126 / sv06-061 / sv06-193 / sv08.5-151 "Hero's Spirit" — into play only via
//                                                                   Palafin's Zero to Hero
//
// D545's two cost-clause shapes on the ABILITY seam (`attackCostClause`, through `passivesOf`,
// so a §9 lock restores the print), one alias on the §10 hand match (`evolveAsNamed`) and one
// card-borne refusal (`intoPlayOnlyVia`, off the card — a lock cannot lift it). On the REAL ids,
// on a LOCAL `cardPool` (D275) in the suite's OWN deck (D270). Texts off tcgdex (the audit's
// card JSON), 2026-09-28. Readings R-PB, R-RD, R-PF: docs/decisions.md D563.

const NOIVERN = "sv09-128";
const KYUREM = "sv06.5-047";
const EEVEE_EX = ["svp-174", "sv08.5-075", "sv08.5-167"] as const;
const PALAFIN_EX = ["svp-126", "sv06-061", "sv06-193", "sv08.5-151"] as const;
const PALAFIN = "sv06-060";
const FLUTTER_MANE = "sv05-078";
const COLRESS = "d563c-colress";
const COLRESS_LOWER = "d563c-colress-lower";
const WALL = "d563c-wall";
const EEVEE = "d563c-eevee";
const UMBREON_EX = "d563c-umbreon-ex";
const UMBREON = "d563c-umbreon";
const PIDGEOT_EX = "d563c-pidgeot-ex";
const FINIZEN = "d563c-finizen";
const GROWER = "d563c-grower";
const COLORLESS = "fix-energy";

const TUNING_ECHO =
  "If you have the same number of cards in your hand as your opponent, ignore all Energy in the cost of Frightening Howl used by this Pokémon.";
const PLASMA_BANE =
  'If your opponent has any cards in their discard pile that have "Colress" in the name, this Pokémon can use the Trifrost attack for {C}.';
const RAINBOW_DNA =
  "This Pokémon can evolve into any Pokémon ex that evolves from Eevee if you play it from your hand onto this Pokémon. (This Pokémon can't evolve during your first turn or the turn you play it.)";
const HEROS_SPIRIT = "Put this Pokémon into play only with the effect of Palafin's Zero to Hero Ability.";
const TRIFROST_TEXT =
  "Discard all Energy from this Pokémon. This attack does 110 damage to 3 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";

const HOWL = 0;
const CONTROL_HOWL = 1;
const HOWL_PRINTED = ["Colorless", "Colorless", "Colorless"];
const TRIFROST_PRINTED = ["Water", "Water", "Metal", "Metal", "Colorless"];

const LOCAL_CARDS: Record<string, Card> = {
  [NOIVERN]: battler(NOIVERN, {
    name: "Noivern",
    stage: "Stage1",
    evolveFrom: "Noibat",
    types: ["Colorless"],
    hp: 110,
    abilities: [{ type: "Ability", name: "Tuning Echo", effect: TUNING_ECHO }],
    attacks: [
      {
        cost: HOWL_PRINTED,
        name: "Frightening Howl",
        damage: 110,
        effect: "Your opponent's Active Pokémon is now Confused.",
      },
      // ⚠️ TEST SURGERY — a SECOND attack Noivern does not print, so the clause's NAME key
      // has a board it can be wrong on (the real card has one attack).
      { cost: HOWL_PRINTED, name: "Control Howl", damage: 10 },
    ],
  }),
  [KYUREM]: battler(KYUREM, {
    name: "Kyurem",
    types: ["Dragon"],
    hp: 130,
    retreat: 2,
    abilities: [{ type: "Ability", name: "Plasma Bane", effect: PLASMA_BANE }],
    attacks: [{ cost: TRIFROST_PRINTED, name: "Trifrost", effect: TRIFROST_TEXT }],
  }),
  ...Object.fromEntries(
    EEVEE_EX.map((id) => [
      id,
      battler(id, {
        name: "Eevee ex",
        types: ["Colorless"],
        hp: 200,
        abilities: [{ type: "Ability", name: "Rainbow DNA", effect: RAINBOW_DNA }],
        attacks: [{ cost: ["Fire", "Water", "Lightning"], name: "Coruscating Quartz", damage: 200 }],
      }),
    ]),
  ),
  ...Object.fromEntries(
    PALAFIN_EX.map((id) => [
      id,
      battler(id, {
        name: "Palafin ex",
        stage: "Stage1",
        evolveFrom: "Finizen",
        types: ["Water"],
        hp: 340,
        abilities: [{ type: "Ability", name: "Hero's Spirit", effect: HEROS_SPIRIT }],
        attacks: [
          {
            cost: ["Water"],
            name: "Giga Impact",
            damage: 250,
            effect: "During your next turn, this Pokémon can't attack.",
          },
        ],
      }),
    ]),
  ),
  [PALAFIN]: battler(PALAFIN, {
    name: "Palafin",
    stage: "Stage1",
    evolveFrom: "Finizen",
    types: ["Water"],
    hp: 100,
    attacks: [{ cost: ["Water", "Colorless"], name: "Wave Splash", damage: 30 }],
  }),
  [FLUTTER_MANE]: battler(FLUTTER_MANE, {
    name: "Flutter Mane",
    types: ["Psychic"],
    hp: 90,
    abilities: [
      {
        type: "Ability",
        name: "Midnight Fluttering",
        effect:
          "As long as this Pokémon is in the Active Spot, your opponent's Active Pokémon has no Abilities, except for Midnight Fluttering.",
      },
    ],
  }),
  [COLRESS]: { ...trainerCard(COLRESS, "Supporter", "Colress's text."), name: "Colress's Tenacity" },
  [COLRESS_LOWER]: { ...trainerCard(COLRESS_LOWER, "Item", "Lowercase control."), name: "Lab of colress" },
  [WALL]: battler(WALL, { name: "D563 Wall", types: ["Colorless"], hp: 900 }),
  [EEVEE]: battler(EEVEE, { name: "Eevee", types: ["Colorless"], hp: 60 }),
  [UMBREON_EX]: battler(UMBREON_EX, {
    name: "Umbreon ex",
    stage: "Stage1",
    evolveFrom: "Eevee",
    types: ["Darkness"],
    hp: 280,
  }),
  [UMBREON]: battler(UMBREON, { name: "Umbreon", stage: "Stage1", evolveFrom: "Eevee", types: ["Darkness"], hp: 130 }),
  [PIDGEOT_EX]: battler(PIDGEOT_EX, {
    name: "Pidgeot ex",
    stage: "Stage2",
    evolveFrom: "Pidgeotto",
    types: ["Colorless"],
    hp: 280,
  }),
  [FINIZEN]: battler(FINIZEN, { name: "Finizen", types: ["Water"], hp: 60 }),
  [GROWER]: battler(GROWER, {
    name: "D563 Grower",
    types: ["Colorless"],
    hp: 100,
    attacks: [
      {
        cost: [],
        name: "Grow Up",
        effect:
          "For each of your Benched Pokémon, search your deck for a card that evolves from that Pokémon and put it onto that Pokémon to evolve it. Then, shuffle your deck.",
      },
    ],
  }),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

/** Its OWN deck (D270), 60 by construction. */
const DECK = deckOf({
  [NOIVERN]: 1,
  [KYUREM]: 1,
  [EEVEE_EX[0]]: 1,
  [EEVEE_EX[1]]: 1,
  [EEVEE_EX[2]]: 1,
  [PALAFIN_EX[0]]: 1,
  [PALAFIN_EX[1]]: 1,
  [PALAFIN_EX[2]]: 1,
  [PALAFIN_EX[3]]: 1,
  [PALAFIN]: 1,
  [FLUTTER_MANE]: 1,
  [COLRESS]: 1,
  [COLRESS_LOWER]: 1,
  [WALL]: 19,
  [EEVEE]: 1,
  [UMBREON_EX]: 2,
  [UMBREON]: 1,
  [PIDGEOT_EX]: 1,
  [FINIZEN]: 2,
  [GROWER]: 1,
  [COLORLESS]: 20,
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

function refused(state: GameState, action: GameAction): { code: string; message: string } {
  const result = applyAction(state, action);
  if (result.ok) throw new Error(`expected a refusal of ${action.type}`);
  return result.error;
}

/** Setup with p2 going first; returns p1's turn 2 (p1's FIRST turn — it may attack, not evolve). */
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

/** TEST SURGERY — one copy of `id` into `seat`'s DECK (back from the hand, or swapped out
    of the Prizes for the deck's bottom card). Every uid stays in exactly one zone. */
function ensureInDeck(state: GameState, seat: Seat, id: string): GameState {
  const side = state.players[seat];
  if (side.deck.some((u) => state.cardIdByUid[u] === id)) return state;
  const held = side.hand.find((u) => state.cardIdByUid[u] === id);
  if (held !== undefined) {
    const next = { ...side, hand: side.hand.filter((u) => u !== held), deck: [...side.deck, held] };
    return { ...state, players: { ...state.players, [seat]: next } };
  }
  const prized = side.prizes.find((u) => state.cardIdByUid[u] === id);
  const swap = side.deck[side.deck.length - 1];
  if (prized === undefined || swap === undefined) throw new Error(`${seat} has no ${id} to seat`);
  const next = {
    ...side,
    prizes: side.prizes.map((u) => (u === prized ? swap : u)),
    deck: [...side.deck.slice(0, -1), prized],
  };
  return { ...state, players: { ...state.players, [seat]: next } };
}

/** TEST SURGERY — move one `id` from `seat`'s deck to `zone`; returns its uid. */
function pull(state: GameState, seat: Seat, id: string, zone: "hand" | "discard"): { state: GameState; uid: string } {
  const seated = ensureInDeck(state, seat, id);
  const side = seated.players[seat];
  const uid = side.deck.find((u) => seated.cardIdByUid[u] === id);
  if (uid === undefined) throw new Error(`no ${id}`);
  const next = { ...side, deck: side.deck.filter((u) => u !== uid), [zone]: [...side[zone], uid] };
  return { state: { ...seated, players: { ...seated.players, [seat]: next } }, uid };
}

/** TEST SURGERY — `seat`'s hand made exactly `n` cards (surplus to the deck bottom, shortfall
    drawn off the top). */
function handOf(state: GameState, seat: Seat, n: number): GameState {
  const side = state.players[seat];
  if (side.hand.length >= n) {
    const keep = side.hand.slice(0, n);
    const back = side.hand.slice(n);
    return { ...state, players: { ...state.players, [seat]: { ...side, hand: keep, deck: [...side.deck, ...back] } } };
  }
  const need = n - side.hand.length;
  const drawn = side.deck.slice(0, need);
  return {
    ...state,
    players: { ...state.players, [seat]: { ...side, hand: [...side.hand, ...drawn], deck: side.deck.slice(need) } },
  };
}

/** TEST SURGERY — `count` Colorless Basic Energy from `seat`'s deck onto its Active. */
function energize(state: GameState, seat: Seat, count: number): GameState {
  const side = state.players[seat];
  const uids = side.deck.filter((u) => state.cardIdByUid[u] === COLORLESS).slice(0, count);
  if (uids.length < count) throw new Error("not enough Energy");
  const taken = new Set(uids);
  const active = activeOf(state, seat);
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: { ...side, deck: side.deck.filter((u) => !taken.has(u)), active: { ...active, energy: [...active.energy, ...uids] } },
    },
  };
}

function activeOf(state: GameState, seat: Seat): InPlayPokemon {
  const spot = state.players[seat].active;
  if (spot === null) throw new Error(`${seat} has no Active`);
  return spot;
}

/** p1's turn 2: `attacker` Active with `energy` {C} against `defender`, both Benches empty. */
function table(attacker: string, energy: number, defender = WALL, seed = 5632): GameState {
  let state = opened(seed);
  state = setActiveFromDeck(ensureInDeck(state, "p1", attacker), "p1", attacker);
  state = setActiveFromDeck(ensureInDeck(state, "p2", defender), "p2", defender);
  state = clearBench(clearBench(state, "p1"), "p2");
  return energy > 0 ? energize(state, "p1", energy) : state;
}

/** The two hands made equal (4 / 4) or unequal (4 / 5). */
const equalHands = (state: GameState) => handOf(handOf(state, "p1", 4), "p2", 4);
const unequalHands = (state: GameState) => handOf(handOf(state, "p1", 4), "p2", 5);

function charged(state: GameState, index = 0): readonly string[] {
  const body = activeOf(state, "p1");
  return attackCostAt(state, "p1", body, index, providedEnergy(state, body));
}

function attackRows(state: GameState) {
  const phase = redactGame(state, "p1").phase;
  if (phase.kind !== "turn:action") throw new Error(`expected turn:action, got ${phase.kind}`);
  return phase.attacks;
}

const declare = (state: GameState, index = 0) => applyAction(state, { type: "attack", seat: "p1", index });

/** The D549 attack-installed cost tax, live on p1's Active this turn (TEST SURGERY). */
function taxed(state: GameState): GameState {
  const active = activeOf(state, "p1");
  return { ...state, players: { ...state.players, p1: { ...state.players.p1, active: { ...active, costTaxTurn: state.turn } } } };
}

/** Advance to p1's turn 4 (past §4's first-turn evolve ban). */
function laterTurn(state: GameState): GameState {
  const next = must(applyAction(state, { type: "endTurn", seat: "p1" }));
  return must(applyAction(next, { type: "endTurn", seat: "p2" }));
}

// ─────────────────────────────────────────────────────────────────────────────
// §1 — the registry rows.
// ─────────────────────────────────────────────────────────────────────────────

describe("§1 — five objects on eleven ids, no `attack` key, and the right SEAM for each", () => {
  it("Noivern and Kyurem carry ONE `passive.attackCostClause` each, D545's two shapes", () => {
    expect(engineVersion).toBe("0.527.0");
    expect(programFor(NOIVERN)).toEqual({
      passive: {
        attackCostClause: {
          attack: "Frightening Howl",
          gate: { kind: "costWaivedIf", condition: { kind: "handSizesEqual" } },
        },
      },
    });
    expect(programFor(KYUREM)).toEqual({
      passive: {
        attackCostClause: {
          attack: "Trifrost",
          gate: {
            kind: "alternateCostIf",
            condition: { kind: "opponentDiscardHasNameContaining", fragment: "Colress" },
            cost: ["Colorless"],
          },
        },
      },
    });
  });

  it("the three Eevee ex share ONE `evolveAsNamed` passive", () => {
    const row = programFor(EEVEE_EX[0]);
    for (const id of EEVEE_EX) expect(programFor(id)).toBe(row);
    expect(row).toEqual({ passive: { evolveAsNamed: { name: "Eevee", intoSuffix: "ex" } } });
  });

  it("🛑 the four Palafin ex share ONE card-borne `intoPlayOnlyVia` — NOT a passive", () => {
    const row = programFor(PALAFIN_EX[0]);
    for (const id of PALAFIN_EX) expect(programFor(id)).toBe(row);
    expect(row).toEqual({ intoPlayOnlyVia: "Zero to Hero" });
    expect(row?.passive).toBeUndefined();
    for (const id of PALAFIN_EX) expect(intoPlayOnlyViaOf(POOL[id] as Card)).toBe("Zero to Hero");
    expect(intoPlayOnlyViaOf(POOL[PALAFIN] as Card)).toBeUndefined();
    // 🆕🆕🆕 D565 — ~~`programFor(PALAFIN)` is undefined~~ (D539): Zero to Hero is BUILT, a
    // TRIGGERED row on plain Palafin — and still no `intoPlayOnlyVia` on it.
    expect(programFor(PALAFIN)?.triggered?.map((t) => t.name)).toEqual(["Zero to Hero"]);
  });

  it("no row authors an `attack` or `attackGate` key — every printed attack keeps deriving", () => {
    for (const id of [NOIVERN, KYUREM, ...EEVEE_EX, ...PALAFIN_EX]) {
      expect(programFor(id)?.attack, id).toBeUndefined();
      expect(programFor(id)?.attackGate, id).toBeUndefined();
    }
  });

  it("the fixtures carry each printed Ability VERBATIM", () => {
    expect(POOL[NOIVERN]?.abilities?.[0]?.effect).toBe(TUNING_ECHO);
    expect(POOL[KYUREM]?.abilities?.[0]?.effect).toBe(PLASMA_BANE);
    for (const id of EEVEE_EX) expect(POOL[id]?.abilities?.[0]?.effect).toBe(RAINBOW_DNA);
    for (const id of PALAFIN_EX) expect(POOL[id]?.abilities?.[0]?.effect).toBe(HEROS_SPIRIT);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — Noivern "Tuning Echo".
// ─────────────────────────────────────────────────────────────────────────────

describe("§2 — Noivern: equal hands WAIVE Frightening Howl's cost; unequal hands charge the print", () => {
  it("🛑 equal hands, no Energy: charged `[]` and the attack APPLIES (110 and Confused)", () => {
    const state = equalHands(table(NOIVERN, 0));
    expect(charged(state)).toEqual([]);
    const result = declare(state);
    if (!result.ok) throw new Error(result.error.code);
    expect(result.events.find((e) => e.type === "DAMAGE_DEALT")).toMatchObject({ base: 110 });
  });

  it("🛑 unequal hands, no Energy: charged the printed {C}{C}{C} and §8.2 REJECTS", () => {
    const state = unequalHands(table(NOIVERN, 0));
    expect(charged(state)).toEqual(HOWL_PRINTED);
    expect(refused(state, { type: "attack", seat: "p1", index: HOWL }).code).toBe("ATTACK_COST_UNMET");
  });

  it("unequal hands with {C}{C}{C} attached: the print pays (the control)", () => {
    const state = unequalHands(table(NOIVERN, 3));
    expect(charged(state)).toEqual(HOWL_PRINTED);
    expect(declare(state).ok).toBe(true);
  });

  it("🛑 the clause is keyed by NAME: the body's other attack keeps its printed cost", () => {
    const state = equalHands(table(NOIVERN, 0));
    expect(charged(state, CONTROL_HOWL)).toEqual(HOWL_PRINTED);
    expect(refused(state, { type: "attack", seat: "p1", index: CONTROL_HOWL }).code).toBe("ATTACK_COST_UNMET");
  });

  it("🛑 a §9 lock (Flutter Mane Active) restores the printed cost even with equal hands", () => {
    const state = equalHands(table(NOIVERN, 0, FLUTTER_MANE));
    expect(charged(state)).toEqual(HOWL_PRINTED);
    expect(refused(state, { type: "attack", seat: "p1", index: HOWL }).code).toBe("ATTACK_COST_UNMET");
  });

  it("🛑 WAIVE-LAST: under the D549 cost tax, equal hands still charge `[]`", () => {
    const state = taxed(equalHands(table(NOIVERN, 0)));
    expect(charged(state)).toEqual([]);
    expect(declare(state).ok).toBe(true);
  });

  it("…and unequal hands under the tax charge the print PLUS the tax", () => {
    const state = taxed(unequalHands(table(NOIVERN, 0)));
    expect(charged(state)).toEqual([...HOWL_PRINTED, "Colorless"]);
  });

  it("the wire publishes the charge: `effectiveCost: []` and playable on equal hands", () => {
    const rows = attackRows(equalHands(table(NOIVERN, 0)));
    expect(rows[HOWL]).toMatchObject({ cost: HOWL_PRINTED, effectiveCost: [], playable: true });
    expect(rows[CONTROL_HOWL]?.effectiveCost).toBeUndefined();
    expect(rows[CONTROL_HOWL]?.playable).toBe(false);
  });

  it("…and on unequal hands no `effectiveCost` and not playable", () => {
    const rows = attackRows(unequalHands(table(NOIVERN, 0)));
    expect(rows[HOWL]?.effectiveCost).toBeUndefined();
    expect(rows[HOWL]?.playable).toBe(false);
  });

  it("`passivesOf` folds the clause RAW; the lock empties the list", () => {
    const open = table(NOIVERN, 0);
    expect(passivesOf(open, activeOf(open, "p1")).attackCostClauses).toEqual([
      programFor(NOIVERN)?.passive?.attackCostClause,
    ]);
    const locked = table(NOIVERN, 0, FLUTTER_MANE);
    expect(passivesOf(locked, activeOf(locked, "p1")).attackCostClauses).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — Kyurem "Plasma Bane".
// ─────────────────────────────────────────────────────────────────────────────

describe("§3 — Kyurem: a \"Colress\" card in the OPPONENT's discard makes Trifrost cost {C}", () => {
  it("no Colress anywhere, one {C}: charged the print and §8.2 REJECTS", () => {
    const state = table(KYUREM, 1);
    expect(charged(state)).toEqual(TRIFROST_PRINTED);
    expect(refused(state, { type: "attack", seat: "p1", index: 0 }).code).toBe("ATTACK_COST_UNMET");
  });

  it("🛑 Colress in the OPPONENT's discard, one {C}: charged `[Colorless]` and the attack APPLIES", () => {
    const state = pull(table(KYUREM, 1), "p2", COLRESS, "discard").state;
    expect(charged(state)).toEqual(["Colorless"]);
    const result = declare(state);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.events.some((e) => e.type === "ATTACK_DECLARED")).toBe(true);
  });

  it("🛑 R-PB — Colress in YOUR OWN discard does not satisfy it", () => {
    const state = pull(table(KYUREM, 1), "p1", COLRESS, "discard").state;
    expect(charged(state)).toEqual(TRIFROST_PRINTED);
    expect(refused(state, { type: "attack", seat: "p1", index: 0 }).code).toBe("ATTACK_COST_UNMET");
  });

  it("CASE-SENSITIVE: a \"colress\" in lowercase does not satisfy it", () => {
    const state = pull(table(KYUREM, 1), "p2", COLRESS_LOWER, "discard").state;
    expect(charged(state)).toEqual(TRIFROST_PRINTED);
  });

  it("condition TRUE but NO Energy: the alternate is unpayable, so the PRINT is named (D545)", () => {
    const state = pull(table(KYUREM, 0), "p2", COLRESS, "discard").state;
    expect(charged(state)).toEqual(TRIFROST_PRINTED);
  });

  it("🛑 a §9 lock (Flutter Mane Active) restores the printed cost", () => {
    const state = pull(table(KYUREM, 1, FLUTTER_MANE), "p2", COLRESS, "discard").state;
    expect(charged(state)).toEqual(TRIFROST_PRINTED);
    expect(refused(state, { type: "attack", seat: "p1", index: 0 }).code).toBe("ATTACK_COST_UNMET");
  });

  it("🛑 ALTERNATE-THEN-SURCHARGE: under the D549 tax the alternate is {C}{C} — one {C} is not enough", () => {
    const state = taxed(pull(table(KYUREM, 1), "p2", COLRESS, "discard").state);
    expect(charged(state)).toEqual([...TRIFROST_PRINTED, "Colorless"]);
    expect(refused(state, { type: "attack", seat: "p1", index: 0 }).code).toBe("ATTACK_COST_UNMET");
  });

  it("…and with {C}{C} attached under the tax it is charged `[Colorless, Colorless]`", () => {
    const state = taxed(pull(table(KYUREM, 2), "p2", COLRESS, "discard").state);
    expect(charged(state)).toEqual(["Colorless", "Colorless"]);
    expect(declare(state).ok).toBe(true);
  });

  it("the wire publishes `effectiveCost: [Colorless]`, playable", () => {
    const rows = attackRows(pull(table(KYUREM, 1), "p2", COLRESS, "discard").state);
    expect(rows[0]).toMatchObject({ cost: TRIFROST_PRINTED, effectiveCost: ["Colorless"], playable: true });
  });

  it("the new member: seat-relative, any card kind, and its note is the printed clause", () => {
    const cond = { kind: "opponentDiscardHasNameContaining", fragment: "Colress" } as const;
    const state = pull(table(KYUREM, 1), "p1", COLRESS, "discard").state;
    expect(conditionHolds(state, "p1", cond)).toBe(false);
    expect(conditionHolds(state, "p2", cond)).toBe(true);
    expect(conditionNote(cond)).toBe(
      'your opponent has any cards in their discard pile that have "Colress" in the name',
    );
    // A Pokémon card counts as much as a Trainer ("any cards").
    const kyuremInPile = pull(table(KYUREM, 1), "p2", KYUREM, "discard").state;
    expect(conditionHolds(kyuremInPile, "p1", { kind: "opponentDiscardHasNameContaining", fragment: "Kyu" })).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — Eevee ex "Rainbow DNA".
// ─────────────────────────────────────────────────────────────────────────────

/** p1's turn 4 with `target` Active (played at setup), `hand` put in p1's hand. */
function evolveTable(target: string, handIds: string[], defender = WALL): { state: GameState; uids: string[] } {
  let state = laterTurn(table(target, 0, defender));
  const uids: string[] = [];
  for (const id of handIds) {
    const pulled = pull(state, "p1", id, "hand");
    state = pulled.state;
    uids.push(pulled.uid);
  }
  return { state, uids };
}

const evolveActive = (uid: string): GameAction => ({ type: "evolve", seat: "p1", uid, target: { spot: "active" } });

describe("§4 — Eevee ex: any Pokémon ex that evolves from Eevee, played from the HAND", () => {
  it("🛑 Umbreon ex (evolves from \"Eevee\") evolves an Eevee ex from the hand", () => {
    const { state, uids } = evolveTable(EEVEE_EX[0], [UMBREON_EX]);
    const { state: after, events } = run(state, evolveActive(uids[0] ?? ""));
    expect(events.some((e) => e.type === "POKEMON_EVOLVED")).toBe(true);
    expect(activeOf(after, "p1").stack.at(-1)).toBe(uids[0]);
  });

  it("…on every one of the three printings", () => {
    for (const id of EEVEE_EX) {
      const { state, uids } = evolveTable(id, [UMBREON_EX]);
      expect(applyAction(state, evolveActive(uids[0] ?? "")).ok, id).toBe(true);
    }
  });

  it("…and onto a BENCHED Eevee ex too (the clause names no zone)", () => {
    let { state, uids } = evolveTable(WALL, [UMBREON_EX]);
    state = benchFromDeck(ensureInDeck(state, "p1", EEVEE_EX[1]), "p1", EEVEE_EX[1]);
    const index = state.players.p1.bench.length - 1;
    expect(
      applyAction(state, { type: "evolve", seat: "p1", uid: uids[0] ?? "", target: { spot: "bench", index } }).ok,
    ).toBe(true);
  });

  it("🛑 a NON-ex Umbreon is refused EVOLVE_MISMATCH (the print says \"Pokémon ex\")", () => {
    const { state, uids } = evolveTable(EEVEE_EX[0], [UMBREON]);
    expect(refused(state, evolveActive(uids[0] ?? "")).code).toBe("EVOLVE_MISMATCH");
  });

  it("🛑 a NON-Eevee-line ex (Pidgeot ex, from Pidgeotto) is refused EVOLVE_MISMATCH", () => {
    const { state, uids } = evolveTable(EEVEE_EX[0], [PIDGEOT_EX]);
    expect(refused(state, evolveActive(uids[0] ?? "")).code).toBe("EVOLVE_MISMATCH");
  });

  it("🛑 a LOCKED Eevee ex (Flutter Mane Active) is refused EVOLVE_MISMATCH", () => {
    const { state, uids } = evolveTable(EEVEE_EX[0], [UMBREON_EX], FLUTTER_MANE);
    expect(refused(state, evolveActive(uids[0] ?? "")).code).toBe("EVOLVE_MISMATCH");
  });

  it("a plain Eevee is UNCHANGED: Umbreon ex and Umbreon both evolve it by §10 alone", () => {
    for (const evo of [UMBREON_EX, UMBREON]) {
      const { state, uids } = evolveTable(EEVEE, [evo]);
      expect(applyAction(state, evolveActive(uids[0] ?? "")).ok, evo).toBe(true);
    }
    expect(programFor(EEVEE)).toBeUndefined();
  });

  it("🛑 the timing bans STAND (the reminder text): on p1's FIRST turn it is FIRST_TURN_EVOLVE", () => {
    let state = table(EEVEE_EX[0], 0);
    const pulled = pull(state, "p1", UMBREON_EX, "hand");
    state = pulled.state;
    expect(refused(state, evolveActive(pulled.uid)).code).toBe("FIRST_TURN_EVOLVE");
  });

  it("🛑 …and an Eevee ex put into play THIS turn is EVOLVE_TOO_SOON", () => {
    const { state, uids } = evolveTable(EEVEE_EX[0], [UMBREON_EX]);
    const active = activeOf(state, "p1");
    const fresh = { ...state, players: { ...state.players, p1: { ...state.players.p1, active: { ...active, turnPlayed: state.turn } } } };
    expect(refused(fresh, evolveActive(uids[0] ?? "")).code).toBe("EVOLVE_TOO_SOON");
  });

  it("`evolveAliasLicensed` names exactly the ex that evolves from the alias", () => {
    const { state } = evolveTable(EEVEE_EX[0], []);
    const body = activeOf(state, "p1");
    expect(evolveAliasLicensed(state, body, POOL[UMBREON_EX] as Card)).toBe(true);
    expect(evolveAliasLicensed(state, body, POOL[UMBREON] as Card)).toBe(false);
    expect(evolveAliasLicensed(state, body, POOL[PIDGEOT_EX] as Card)).toBe(false);
    expect(evolveAliasLicensed(state, body, POOL[EEVEE] as Card)).toBe(false);
  });

  it("🛑 R-RD — a DECK evolve is NOT widened: a benched Eevee ex offers no Umbreon ex", () => {
    let { state } = evolveTable(GROWER, []);
    state = benchFromDeck(ensureInDeck(state, "p1", EEVEE_EX[0]), "p1", EEVEE_EX[0]);
    const eeveeUid = state.players.p1.bench[0]?.stack.at(-1);
    const after = run(state, { type: "attack", seat: "p1", index: 0 }).state;
    expect(after.phase.kind).not.toBe("effect:choose");
    expect(after.players.p1.bench[0]?.stack.at(-1)).toBe(eeveeUid);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — Palafin ex "Hero's Spirit".
// ─────────────────────────────────────────────────────────────────────────────

describe("§5 — Palafin ex: into play ONLY via Zero to Hero, which D565 built (R-PF closed)", () => {
  it("🛑 the HAND evolve onto Finizen is refused EVOLVE_ONLY_VIA_ABILITY, naming the Ability", () => {
    for (const id of PALAFIN_EX) {
      const { state, uids } = evolveTable(FINIZEN, [id]);
      const error = refused(state, evolveActive(uids[0] ?? ""));
      expect(error.code, id).toBe("EVOLVE_ONLY_VIA_ABILITY");
      expect(error.message).toBe("Palafin ex can be put into play only with the effect of the Zero to Hero Ability");
    }
  });

  it("the refused card stays in the hand and the Finizen is untouched", () => {
    const { state, uids } = evolveTable(FINIZEN, [PALAFIN_EX[1]]);
    expect(applyAction(state, evolveActive(uids[0] ?? "")).ok).toBe(false);
    expect(state.players.p1.hand).toContain(uids[0]);
    expect(activeOf(state, "p1").stack).toHaveLength(1);
  });

  it("the refusal comes BEFORE the timing bans: on p1's first turn it is still EVOLVE_ONLY_VIA_ABILITY", () => {
    const pulled = pull(table(FINIZEN, 0), "p1", PALAFIN_EX[0], "hand");
    expect(refused(pulled.state, evolveActive(pulled.uid)).code).toBe("EVOLVE_ONLY_VIA_ABILITY");
  });

  it("…but AFTER the §10 name match: onto a non-Finizen it is EVOLVE_MISMATCH", () => {
    const { state, uids } = evolveTable(EEVEE, [PALAFIN_EX[0]]);
    expect(refused(state, evolveActive(uids[0] ?? "")).code).toBe("EVOLVE_MISMATCH");
  });

  it("the CONTROL: plain Palafin `sv06-060` evolves Finizen from the hand, unchanged", () => {
    const { state, uids } = evolveTable(FINIZEN, [PALAFIN]);
    const { state: after } = run(state, evolveActive(uids[0] ?? ""));
    expect(activeOf(after, "p1").stack.at(-1)).toBe(uids[0]);
  });

  it("🛑 a DECK evolve never offers Palafin ex: a benched Finizen with only Palafin ex in the deck whiffs", () => {
    let { state } = evolveTable(GROWER, []);
    state = benchFromDeck(ensureInDeck(state, "p1", FINIZEN), "p1", FINIZEN);
    // Only Palafin ex left in the deck to evolve Finizen: move the plain Palafin out.
    state = pull(state, "p1", PALAFIN, "discard").state;
    const finizenUid = state.players.p1.bench[0]?.stack.at(-1);
    const after = run(state, { type: "attack", seat: "p1", index: 0 }).state;
    expect(after.phase.kind).not.toBe("effect:choose");
    expect(after.players.p1.bench[0]?.stack.at(-1)).toBe(finizenUid);
  });

  it("…and with plain Palafin in the deck too, the offer is Palafin ALONE", () => {
    let { state } = evolveTable(GROWER, []);
    state = benchFromDeck(ensureInDeck(state, "p1", FINIZEN), "p1", FINIZEN);
    state = ensureInDeck(state, "p1", PALAFIN);
    const parked = run(state, { type: "attack", seat: "p1", index: 0 }).state;
    const phase = parked.phase;
    if (phase.kind !== "effect:choose" || phase.prompt.kind !== "chooseCards") {
      throw new Error(`expected a chooseCards park, got ${phase.kind}`);
    }
    const offered = new Set(phase.prompt.candidates.map((uid) => parked.cardIdByUid[uid]));
    expect([...offered]).toEqual([PALAFIN]);
  });

  it("🆕🆕🆕 D565 — R-PF CLOSED: a RETREATING Palafin swaps in a Palafin ex from the deck, in place", () => {
    const { state: evolved0, uids } = evolveTable(FINIZEN, [PALAFIN]);
    let state = run(evolved0, evolveActive(uids[0] ?? "")).state;
    state = benchFromDeck(ensureInDeck(state, "p1", GROWER), "p1", GROWER);
    state = ensureInDeck(energize(state, "p1", 1), "p1", PALAFIN_EX[0]);
    const finizen = activeOf(state, "p1").stack[0];
    const { state: after, events } = run(state, {
      type: "retreat",
      seat: "p1",
      discardEnergy: [...activeOf(state, "p1").energy],
      promoteBenchIndex: 0,
    });
    const swapped = after.players.p1.bench[0];
    expect(swapped?.stack[0]).toBe(finizen);
    expect((PALAFIN_EX as readonly string[]).includes(after.cardIdByUid[swapped?.stack.at(-1) ?? ""] ?? "")).toBe(true);
    expect(after.players.p1.deck).toContain(uids[0]);
    expect(events.some((e) => e.type === "POKEMON_SWAPPED_FROM_DECK")).toBe(true);
    expect(events.some((e) => e.type === "POKEMON_EVOLVED")).toBe(false);
  });

  it("`passivesOf` never sees it: a Palafin ex body folds no key for it (a lock cannot lift it)", () => {
    const state = table(PALAFIN_EX[0], 0);
    const folded = passivesOf(state, activeOf(state, "p1"));
    expect(Object.keys(folded)).not.toContain("intoPlayOnlyVia");
    expect(folded.evolveAsNamed).toEqual([]);
    expect(folded.attackCostClauses).toEqual([]);
  });
});
