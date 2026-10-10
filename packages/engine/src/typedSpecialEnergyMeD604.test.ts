import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { isSpecialEnergy } from "./cards";
import {
  effectiveMaxHp,
  effectiveRetreatCost,
  energyFreesRetreat,
  energyRulesApply,
  passivesOf,
  unitsProvidedBy,
} from "./continuous";
import type { GameAction, GameEvent, GameState, Seat } from "./index";
import { applyAction, createGame, engineVersion } from "./index";
import { programFor } from "./registry";
import {
  FIXTURE_POOL,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  setActiveFromDeck,
  specialEnergy,
} from "./testFixtures";
import type { InPlayPokemon, PokemonTarget } from "./types";

// ── 🆕🆕🆕 D604 — WP18: THE MEGA EVOLUTION TYPED SPECIAL ENERGIES ──
//
// The 8 unbuilt `me` Special Energies, one printing each, on eight new `energy` objects. Every id and
// text measured on the LOCAL D1 (`apps/api/.wrangler/…/8437d866….sqlite`), 2026-10-08, `legal_standard
// = 1`, `energy_type = 'Normal'` on each (D583: `isSpecialEnergy` reads the printed text). Each provides
// its printed type on ANY holder; its one rule applies only on a holder of that type (the NEW
// `EnergyProgram.holderType`, continuous.ts `energyRulesApply`, R-TE1). New: `energyFreesRetreat`,
// `EnergyOnAttach.benchSearch` (R-TP1) and `returnAfterAttackDiscard: "hand"` (R-NF1).

const GROWING = "me03-086";
const ROCKY = "me03-087";
const TELEPATHIC = "me03-088";
const BUBBLY = "me04-084";
const MAGNETIC = "me04-085";
const NITRO = "me04-086";
const SHADOWY = "me05-083";
const VOLTAIC = "me05-084";

/** [id, name, printed type, the LOCAL D1 `effect` verbatim]. */
const ENERGIES: readonly (readonly [string, string, string, string])[] = [
  [GROWING, "Growing Grass Energy", "Grass", "As long as this card is attached to a Pokémon, it provides {G} Energy.\nThe {G} Pokémon this card is attached to gets +20 HP."],
  [ROCKY, "Rocky Fighting Energy", "Fighting", "As long as this card is attached to a Pokémon, it provides {F} Energy.\nPrevent all effects of attacks used by your opponent's Pokémon done to the {F} Pokémon this card is attached to. (Existing effects are not removed. Damage is not an effect.)"],
  [TELEPATHIC, "Telepathic Psychic Energy", "Psychic", "As long as this card is attached to a Pokémon, it provides {P} Energy.\nWhen you attach this card from your hand to a {P} Pokémon, search your deck for up to 2 Basic {P} Pokémon and put them onto your Bench. Then, shuffle your deck."],
  [BUBBLY, "Bubbly Water Energy", "Water", "As long as this card is attached to a Pokémon, it provides {W} Energy.\n\nThe {W} Pokémon this card is attached to recovers from all Special Conditions and can't be affected by any Special Conditions."],
  [MAGNETIC, "Magnetic Metal Energy", "Metal", "As long as this card is attached to a Pokémon, it provides {M} Energy.\n\nThe {M} Pokémon this card is attached to has no Retreat Cost."],
  [NITRO, "Nitro Fire Energy", "Fire", "As long as this card is attached to a Pokémon, it provides {R} Energy.\n\nIf this card is discarded by an effect of an attack used by the {R} Pokémon this card is attached to, put this card into your hand after attack damage and effects."],
  [SHADOWY, "Shadowy Darkness Energy", "Darkness", "As long as this card is attached to a Pokémon, it provides {D} Energy.\n\nAs long as the {D} Pokémon this card is attached to is on your Bench, prevent all damage done to it by attacks from your opponent's Pokémon."],
  [VOLTAIC, "Voltaic Lightning Energy", "Lightning", "As long as this card is attached to a Pokémon, it provides {L} Energy.\n\nAttacks used by the {L} Pokémon this card is attached to do 20 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance)."],
];

const ALL_FIVE = ["asleep", "burned", "confused", "paralyzed", "poisoned"];

describe("D604 §1 — the programs: eight objects over 8 printings", () => {
  it("each printing is keyed on its own object", () => {
    expect(new Set(ENERGIES.map(([id]) => programFor(id))).size).toBe(8);
    for (const [id] of ENERGIES) expect(Object.keys(programFor(id) ?? {}), id).toEqual(["energy"]);
  });

  it("each provides its printed type and is gated on a holder of that type", () => {
    for (const [id, , type] of ENERGIES) {
      expect(programFor(id)?.energy?.provides, id).toEqual([type]);
      expect(programFor(id)?.energy?.holderType, id).toBe(type);
    }
  });

  it("the eight rules, each on a shipped shape or one of the two new pieces", () => {
    expect(programFor(GROWING)?.energy?.passive).toEqual({ hpBonus: { amount: 20 } });
    expect(programFor(ROCKY)?.energy?.passive).toEqual(programFor("sv05-161")?.energy?.passive); // Mist Energy
    expect(programFor(TELEPATHIC)?.energy?.onAttach).toEqual({
      kind: "benchSearch",
      filter: { kind: "typedPokemon", pokemonType: "Psychic", stage: "basic" },
      max: 2,
    });
    expect(programFor(BUBBLY)?.energy?.passive).toEqual({ statusRecovery: ALL_FIVE, statusImmunities: ALL_FIVE });
    expect(programFor(MAGNETIC)?.energy?.passive).toEqual({ noRetreatCostSelf: {} });
    expect(programFor(NITRO)?.energy?.returnAfterAttackDiscard).toBe("hand");
    expect(programFor(SHADOWY)?.energy?.passive).toEqual({ preventDamageWhileBenched: true });
    expect(programFor(VOLTAIC)?.energy?.passive).toEqual({ damageBonusBeforeWR: 20 });
  });

  it("the catalog faces are Special Energy (D583), whatever tcgdex tags them", () => {
    for (const [id, name, , effect] of ENERGIES) expect(isSpecialEnergy(face(id, name, effect)), id).toBe(true);
  });
});

// ── ON A BOARD ──

const G_MON = "d604-grass";
const F_MON = "d604-fighting";
const P_MON = "d604-psychic";
const P_TWO = "d604-psychic-two";
const P_STAGE1 = "d604-psychic-stage1";
const W_MON = "d604-water";
const M_MON = "d604-metal";
const R_FLING = "d604-fire-fling";
const C_FLING = "d604-colorless-fling";
const L_ZAP = "d604-lightning-zap";
const C_ZAP = "d604-colorless-zap";
const D_MON = "d604-dark";
const FOE = "d604-foe"; // p2's attacker: Confuse (index 0), a Bench spread (index 1)
const FILLER = "d604-filler";
const GENGAR = "sv05-104"; // Gengar ex "Gnawing Curse" — the REAL id (its program is keyed by id)

const FLING = "Discard an Energy from this Pokémon.";
const CONFUSE = "Your opponent's Active Pokémon is now Confused.";
const SPREAD =
  "This attack also does 10 damage to each of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";

/** The catalog face exactly as tcgdex hands it (D583): a Special Energy tagged "Normal". */
function face(id: string, name: string, effect: string): Card {
  return { ...specialEnergy(id, name, effect), energyType: "Normal" };
}
const mon = (id: string, type: string, over: Partial<Card> = {}): Card =>
  battler(id, { name: id, hp: 100, types: [type], retreat: 2, ...over } as Partial<Card>);

const LOCAL: Record<string, Card> = {
  ...Object.fromEntries(ENERGIES.map(([id, name, , effect]) => [id, face(id, name, effect)])),
  [G_MON]: mon(G_MON, "Grass"),
  [F_MON]: mon(F_MON, "Fighting"),
  [P_MON]: mon(P_MON, "Psychic"),
  [P_TWO]: mon(P_TWO, "Psychic"),
  [P_STAGE1]: mon(P_STAGE1, "Psychic", { stage: "Stage1", evolveFrom: "Nobody" } as Partial<Card>),
  [W_MON]: mon(W_MON, "Water"),
  [M_MON]: mon(M_MON, "Metal"),
  [R_FLING]: mon(R_FLING, "Fire", { attacks: [{ cost: [], name: "Fling", damage: 30, effect: FLING }] } as Partial<Card>),
  [C_FLING]: mon(C_FLING, "Colorless", {
    attacks: [{ cost: [], name: "Fling", damage: 30, effect: FLING }],
  } as Partial<Card>),
  [L_ZAP]: mon(L_ZAP, "Lightning", { attacks: [{ cost: [], name: "Zap", damage: 30 }] } as Partial<Card>),
  [C_ZAP]: mon(C_ZAP, "Colorless", { attacks: [{ cost: [], name: "Zap", damage: 30 }] } as Partial<Card>),
  [D_MON]: mon(D_MON, "Darkness"),
  [FOE]: mon(FOE, "Colorless", {
    hp: 300,
    attacks: [
      { cost: [], name: "Daze", damage: 10, effect: CONFUSE },
      { cost: [], name: "Ripple", damage: 10, effect: SPREAD },
    ],
  } as Partial<Card>),
  [FILLER]: mon(FILLER, "Colorless", { hp: 300, attacks: [{ cost: [], name: "Tap", damage: 10 }] } as Partial<Card>),
  [GENGAR]: mon(GENGAR, "Darkness", {
    name: "Gengar ex",
    hp: 310,
    abilities: [
      {
        type: "Ability",
        name: "Gnawing Curse",
        effect:
          "Whenever your opponent attaches an Energy card from their hand to 1 of their Pokémon, put 2 damage counters on that Pokémon.",
      },
    ],
  } as Partial<Card>),
};
const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL };
const DECK = deckOf({
  ...Object.fromEntries(ENERGIES.map(([id]) => [id, 2])),
  [G_MON]: 1,
  [F_MON]: 1,
  [P_MON]: 2,
  [P_TWO]: 1,
  [P_STAGE1]: 1,
  [W_MON]: 1,
  [M_MON]: 1,
  [R_FLING]: 1,
  [C_FLING]: 1,
  [L_ZAP]: 1,
  [C_ZAP]: 1,
  [D_MON]: 2,
  [FOE]: 2,
  [FILLER]: 21,
  [GENGAR]: 1,
  "fix-energy": 6,
});

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}
function ok(result: ReturnType<typeof applyAction>) {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result;
}

/** Setup (P2 first), then P1's second turn; both hands back into the decks and the Prizes swapped out
    for deck filler, so every named card is findable (D603's `p1Turn`). */
function p1Turn(): GameState {
  const created = createGame({ seed: 6041, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
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
  state = must(applyAction(state, { type: "endTurn", seat: "p1" }));
  state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
  for (const s of ["p1", "p2"] as const) {
    const side = state.players[s];
    let deck = [...side.deck, ...side.hand];
    const prizes = side.prizes.map((u) => {
      if ([FILLER, "fix-energy"].includes(state.cardIdByUid[u] as string)) return u;
      const swap = deck.find((d) => [FILLER, "fix-energy"].includes(state.cardIdByUid[d] as string));
      if (swap === undefined) throw new Error("no swap card");
      deck = [...deck.filter((d) => d !== swap), u];
      return swap;
    });
    state = { ...state, players: { ...state.players, [s]: { ...side, hand: [], prizes, deck } } };
  }
  return state;
}

/** P1: `active` carrying `energy`, `bench` and exactly `hand`; P2: `foe` (FOE by default). */
function table(opts: {
  active: string;
  energy?: readonly string[];
  bench?: readonly string[];
  hand?: readonly string[];
  foe?: string;
}): GameState {
  let state = p1Turn();
  state = clearBench(setActiveFromDeck(state, "p1", opts.active), "p1");
  state = clearBench(setActiveFromDeck(state, "p2", opts.foe ?? FOE), "p2");
  for (const id of opts.energy ?? []) state = attachFromDeck(state, "p1", id, 1);
  for (const id of opts.bench ?? []) state = benchFromDeck(state, "p1", id);
  const side = state.players.p1;
  let deck = [...side.deck];
  const hand: string[] = [];
  for (const id of opts.hand ?? []) {
    const uid = deck.find((u) => state.cardIdByUid[u] === id);
    if (uid === undefined) throw new Error(`p1 deck has no ${id}`);
    hand.push(uid);
    deck = deck.filter((u) => u !== uid);
  }
  return { ...state, players: { ...state.players, p1: { ...side, hand, deck } } } as GameState;
}

/** TEST SURGERY — p1's Benched body `index` carries one `energyId` off the deck. */
function attachToBench(state: GameState, index: number, energyId: string): GameState {
  const side = state.players.p1;
  const uid = side.deck.find((u) => state.cardIdByUid[u] === energyId);
  if (uid === undefined) throw new Error(`p1 deck has no ${energyId}`);
  const bench = side.bench.map((b, i) => (i === index ? { ...b, energy: [...b.energy, uid] } : b));
  return { ...state, players: { ...state.players, p1: { ...side, bench, deck: side.deck.filter((u) => u !== uid) } } };
}

const active = (state: GameState, seat: Seat = "p1"): InPlayPokemon => {
  const body = state.players[seat].active;
  if (body === null) throw new Error(`no ${seat} Active`);
  return body;
};
const uidOf = (state: GameState, id: string): string => {
  const uid = state.players.p1.hand.find((u) => state.cardIdByUid[u] === id);
  if (uid === undefined) throw new Error(`no ${id} in hand`);
  return uid;
};
const attachFromHand = (state: GameState, id: string, target: PokemonTarget) =>
  applyAction(state, { type: "attachEnergy", seat: "p1", uid: uidOf(state, id), target } as GameAction);
const of = <T extends GameEvent["type"]>(events: readonly GameEvent[], type: T) =>
  events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
const foeAttacks = (state: GameState, index: number) => {
  const passed = must(applyAction(state, { type: "endTurn", seat: "p1" }));
  return ok(applyAction(passed, { type: "attack", seat: "p2", index }));
};

describe("D604 §2 — provision is never gated: each provides its type on any holder", () => {
  it("on a {C} holder each of the eight provides its printed type", () => {
    for (const [id, , type] of ENERGIES) {
      const state = table({ active: FILLER, energy: [id] });
      const body = active(state);
      expect(unitsProvidedBy(state, body, body.energy[0] as string), id).toEqual([type]);
    }
  });

  it("`energyRulesApply` answers the holder's type: true on its own type, false on {C}, true for an untyped program", () => {
    const own = table({ active: G_MON, energy: [GROWING] });
    const other = table({ active: FILLER, energy: [GROWING] });
    expect(energyRulesApply(own, active(own), programFor(GROWING)?.energy)).toBe(true);
    expect(energyRulesApply(other, active(other), programFor(GROWING)?.energy)).toBe(false);
    expect(energyRulesApply(other, active(other), programFor("sv05-161")?.energy)).toBe(true); // Mist: no type
  });
});

describe("D604 §3 — Growing Grass Energy: the {G} holder gets +20 HP", () => {
  it("+20 on a {G} holder, nothing on a {C} one", () => {
    const own = table({ active: G_MON, energy: [GROWING] });
    expect(effectiveMaxHp(own, active(own))).toBe(120);
    const other = table({ active: FILLER, energy: [GROWING] });
    expect(effectiveMaxHp(other, active(other))).toBe(300);
  });
});

describe("D604 §4 — Rocky Fighting Energy: the {F} holder is shielded from attack effects, not damage", () => {
  it("a {F} Active is not Confused and still takes the damage; a {C} Active is Confused", () => {
    const shielded = foeAttacks(table({ active: F_MON, energy: [ROCKY] }), 0).state;
    expect(active(shielded).conditions.rotation).toBe("none");
    expect(active(shielded).damage).toBe(10);
    const bare = foeAttacks(table({ active: FILLER, energy: [ROCKY] }), 0).state;
    expect(active(bare).conditions.rotation).toBe("confused");
  });
});

describe("D604 §5 — Telepathic Psychic Energy: attached from hand to a {P}, up to 2 Basic {P} to the Bench (R-TP1)", () => {
  it("onto a {P} Active: parks the pick, offering only the Basic {P} Pokémon in the deck", () => {
    const state = table({ active: P_MON, hand: [TELEPATHIC] });
    const parked = ok(attachFromHand(state, TELEPATHIC, { spot: "active" })).state;
    expect(parked.phase.kind).toBe("effect:choose");
    if (parked.phase.kind !== "effect:choose") return;
    const prompt = parked.phase.prompt as unknown as { kind: string; candidates: string[]; max: number; min: number };
    expect([prompt.kind, prompt.min, prompt.max]).toEqual(["chooseCards", 0, 2]);
    expect(new Set(prompt.candidates.map((u) => parked.cardIdByUid[u]))).toEqual(new Set([P_MON, P_TWO]));
    expect(active(parked).energy.map((u) => parked.cardIdByUid[u])).toEqual([TELEPATHIC]);
  });

  it("the pick lands on the Bench, the deck is shuffled and the turn resumes", () => {
    const state = table({ active: P_MON, hand: [TELEPATHIC] });
    const parked = ok(attachFromHand(state, TELEPATHIC, { spot: "active" })).state;
    if (parked.phase.kind !== "effect:choose") throw new Error("expected a park");
    const prompt = parked.phase.prompt as unknown as { candidates: string[] };
    const done = ok(
      applyAction(parked, {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "cards", uids: prompt.candidates.slice(0, 2) },
      } as GameAction),
    );
    expect(done.state.players.p1.bench.map((b) => done.state.cardIdByUid[b.stack.at(-1) as string]).sort()).toEqual(
      [P_MON, P_TWO].sort(),
    );
    expect(of(done.events, "SHUFFLE").length).toBeGreaterThan(0);
    expect(done.state.phase.kind).toBe("turn:action");
  });

  it("an opposing Gnawing Curse lands first, then the search still parks (R-TP1: the search is the attach's last step)", () => {
    let state = table({ active: P_MON, hand: [TELEPATHIC] });
    state = benchFromDeck(state, "p2", GENGAR);
    const parked = ok(attachFromHand(state, TELEPATHIC, { spot: "active" }));
    expect(active(parked.state).damage).toBe(20);
    expect(parked.state.phase.kind).toBe("effect:choose");
    const kinds = parked.events.map((e) => e.type);
    expect(kinds).toContain("ABILITY_TRIGGERED");
    expect(kinds.indexOf("EFFECT_PENDING")).toBeGreaterThan(kinds.indexOf("ABILITY_TRIGGERED"));
  });

  it("onto a {C} Active: no search — the attach completes at once", () => {
    const state = table({ active: FILLER, hand: [TELEPATHIC] });
    const attached = ok(attachFromHand(state, TELEPATHIC, { spot: "active" })).state;
    expect(attached.phase.kind).toBe("turn:action");
    expect(attached.players.p1.bench).toEqual([]);
  });
});

describe("D604 §6 — Bubbly Water Energy: the {W} holder recovers from and is immune to all five", () => {
  it("attached from hand to a Confused, Poisoned {W} Active, it recovers on the spot", () => {
    let state = table({ active: W_MON, hand: [BUBBLY] });
    const sick = { ...active(state), conditions: { ...active(state).conditions, rotation: "confused" as const, poisonDamage: 10 } };
    state = { ...state, players: { ...state.players, p1: { ...state.players.p1, active: sick } } };
    const attached = ok(attachFromHand(state, BUBBLY, { spot: "active" })).state;
    expect([active(attached).conditions.rotation, active(attached).conditions.poisonDamage]).toEqual(["none", 0]);
  });

  it("a {W} Active is not Confused by an attack; a {C} one is", () => {
    const shielded = foeAttacks(table({ active: W_MON, energy: [BUBBLY] }), 0).state;
    expect(active(shielded).conditions.rotation).toBe("none");
    expect(passivesOf(shielded, active(shielded)).statusImmunities).toEqual(ALL_FIVE);
    const bare = foeAttacks(table({ active: FILLER, energy: [BUBBLY] }), 0).state;
    expect(active(bare).conditions.rotation).toBe("confused");
  });
});

describe("D604 §7 — Magnetic Metal Energy: the {M} holder has no Retreat Cost", () => {
  it("0 on a {M} holder; the printed 2 on a {C} one", () => {
    const own = table({ active: M_MON, energy: [MAGNETIC] });
    expect([energyFreesRetreat(own, active(own)), effectiveRetreatCost(own, active(own))]).toEqual([true, 0]);
    const other = table({ active: FILLER, energy: [MAGNETIC] });
    expect([energyFreesRetreat(other, active(other)), effectiveRetreatCost(other, active(other))]).toEqual([false, 2]);
  });

  it("the {M} Active retreats paying nothing", () => {
    const state = table({ active: M_MON, energy: [MAGNETIC], bench: [FILLER] });
    const retreated = must(applyAction(state, { type: "retreat", seat: "p1", discardEnergy: [], promoteBenchIndex: 0 }));
    expect(retreated.cardIdByUid[active(retreated).stack.at(-1) as string]).toBe(FILLER);
  });
});

describe("D604 §8 — Nitro Fire Energy: discarded by its {R} holder's attack, into the hand afterwards (R-NF1)", () => {
  it("a {R} attacker's 'Discard an Energy from this Pokémon.': the card ends in the hand, announced after the discard", () => {
    const state = table({ active: R_FLING, energy: [NITRO] });
    const nitro = active(state).energy[0] as string;
    const attacked = ok(applyAction(state, { type: "attack", seat: "p1", index: 0 }));
    expect(attacked.state.players.p1.hand).toContain(nitro);
    expect(attacked.state.players.p1.discard).not.toContain(nitro);
    expect(active(attacked.state).energy).toEqual([]);
    const kinds = attacked.events.map((e) => e.type);
    expect(kinds.indexOf("DISCARD_RETRIEVED")).toBeGreaterThan(kinds.indexOf("ENERGY_DISCARDED"));
    expect(of(attacked.events, "DISCARD_RETRIEVED")).toEqual([{ type: "DISCARD_RETRIEVED", seat: "p1", dest: "hand", uids: [nitro] }]);
  });

  it("a {C} attacker's discard: the card stays in the discard pile", () => {
    const state = table({ active: C_FLING, energy: [NITRO] });
    const nitro = active(state).energy[0] as string;
    const attacked = ok(applyAction(state, { type: "attack", seat: "p1", index: 0 }));
    expect(attacked.state.players.p1.discard).toContain(nitro);
    expect(attacked.state.players.p1.hand).not.toContain(nitro);
  });
});

describe("D604 §9 — Shadowy Darkness Energy: the Benched {D} holder takes no damage from the opponent's attacks", () => {
  it("a spread skips the Benched {D} holder and hits the Benched {C} one", () => {
    let state = table({ active: FILLER, bench: [D_MON, FILLER] });
    state = attachToBench(attachToBench(state, 0, SHADOWY), 1, SHADOWY);
    const hit = foeAttacks(state, 1).state;
    expect(hit.players.p1.bench.map((b) => b.damage)).toEqual([0, 10]);
  });

  it("the fold: on the Bench only, and only on a {D} holder", () => {
    let state = table({ active: D_MON, energy: [SHADOWY], bench: [D_MON] });
    state = attachToBench(state, 0, SHADOWY);
    expect(passivesOf(state, active(state)).preventDamageWhileBenched).toBe(false);
    expect(passivesOf(state, state.players.p1.bench[0] as InPlayPokemon).preventDamageWhileBenched).toBe(true);
  });
});

describe("D604 §10 — Voltaic Lightning Energy: the {L} holder's attacks do 20 more to the opponent's Active", () => {
  it("30 + 20 from a {L} attacker; 30 from a {C} one", () => {
    const dealt = (attacker: string) =>
      of(ok(applyAction(table({ active: attacker, energy: [VOLTAIC] }), { type: "attack", seat: "p1", index: 0 })).events, "DAMAGE_DEALT")[0]?.dealt;
    expect(dealt(L_ZAP)).toBe(50);
    expect(dealt(C_ZAP)).toBe(30);
  });
});

describe("D604 §11 — the version", () => {
  it("is built at engine 0.520.0", () => {
    expect(engineVersion).toBe("0.520.0");
  });
});
