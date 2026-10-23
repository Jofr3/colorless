import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { applyAction, effectiveRetreatCost, programFor } from "./index";
import type { GameState, Seat } from "./index";
import {
  FIXTURE_POOL,
  attachFromDeck,
  battler,
  benchFromDeck,
  deckOf,
  deepFreeze,
  handUid,
  mustApply,
  setActiveFromDeck,
  types,
  findEvent,
  driveSetup,
} from "./testFixtures";

const LANDED = [
  {
    program: "Poison Point",
    fixture: "fix-poisonpoint",
    ids: ["sv05-008", "sv05-009", "sv10.5b-056", "sv10.5b-134"],
    legal: 4,
    ops: "D99's onDamagedByAttack trigger + applyStatus — Armarouge's program, one StatusName over",
  },
  {
    program: "Trade (N's Zoroark ex)",
    fixture: "fix-trade",
    ids: ["sv09-098", "sv09-175", "sv09-185", "sv09-189"],
    legal: 4,
    ops: "payFromHand {to:'discard'} + drawCards 2 — the Tinkaton shape exactly",
  },
  {
    program: "Metal Bridge (Archaludon)",
    fixture: "fix-metalbridge",
    ids: ["sv07-107", "sv07-155", "sv08.5-070"],
    legal: 3,
    ops: "noRetreatCostAura {requiresEnergyType:'Metal'} — Clefable ex's Lunar Zone as pure data",
  },
] as const;

type Bought =
  | { readonly kind: "abilityOp"; readonly op: Record<string, unknown> }
  | { readonly kind: "programFlag"; readonly field: "trainerFirstTurnExempt" }
  | { readonly kind: "trainerOp"; readonly op: Record<string, unknown> };
const PAID = [
  {
    program: "Teal Dance (Teal Mask Ogerpon ex)",
    paidBy: "D221",
    ids: [
      "svp-166",
      "sv06-025",
      "sv06-190",
      "sv06-211",
      "sv06-221",
      "sv08.5-012",
      "sv08.5-145",
      "sv08.5-177",
    ],
    legal: 8,
    bought: {
      kind: "abilityOp",
      op: { op: "attachEnergyFrom", toSelf: true, recordAs: "moved" },
    } as Bought,
    // "Once during your turn, you may attach a Basic {G} Energy card from your
    // hand to THIS POKÉMON. If you attached Energy to a Pokémon in this way,
    // draw a card."
    needed:
      "TWO new fields on `attachEnergyFrom`. (1) A SELF target: the op's riders are `targetType`/`basicOnly`, and both pick out a CLASS of the controller's own Pokémon — with two {G} bodies in play, `targetType:'Grass'` lets the player attach to the wrong one, and 'this Pokémon' is a UID question (`ctx.sourceUid`, the way `moveEnergy`'s `koedActiveToToolHolder` route pins its destination). (2) A `recordAs` slot: the op records NOTHING today, so the §9.2 `recordGate` the second sentence needs has nothing to read. The census lists both as already existing; neither does.",
  },
  {
    program: "Flashing Draw (Iono's Kilowattrel)",
    paidBy: "D222",
    ids: ["svp-182", "sv09-055", "sv09-163"],
    legal: 3,
    bought: { kind: "abilityOp", op: { op: "discardEnergy", from: "self" } } as Bought,
    needed:
      "a `from: 'self'` member on `discardEnergy`. The ones that exist are `opponentActive` / `opponentChosen` / `yourActive` / `yours` (+ the `opponentEach` sweep), and `yourActive` means 'this Pokémon' only inside an ATTACK, where the actor IS the Active. This Ability carries NO Active clause, so a BENCHED Kilowattrel would pay the cost off whichever body happens to be Active — and would be USABLE on a board where the Kilowattrel itself holds no {L} at all. Adding `activeOnly: true` to make `yourActive` correct would be inventing a printed clause the card does not have.",
  },
  {
    program: "Carmine",
    paidBy: "D223",
    ids: ["sv06-145", "sv06-204", "sv06-217", "sv08.5-103"],
    legal: 4,
    bought: { kind: "programFlag", field: "trainerFirstTurnExempt" } as Bought,
    needs:
      "⚠️ A CENSUS CLAIM THAT IS FLATLY WRONG, AND THE MOST EXPENSIVE ONE TO HAVE TRUSTED. The census says the first-turn clause is 'INERT — the engine has no going-first Supporter lock for it to lift'. The lock EXISTS and has since M4: cardplay.ts's Supporter branch returns `FIRST_TURN_SUPPORTER` on `state.turn === 1`. Carmine's entire first sentence is an EXEMPTION from exactly that rule, so `trainer: [discardHand, drawCards 5]` would be REFUSED on the one turn the card is printed to be legal on — the card would be strictly worse than unbuilt. It needs a `CardProgram` flag read at that gate: a new FIELD on an existing mechanism, i.e. Tier 2.",
  },
  {
    program: "N's Plan",
    paidBy: "D226",
    ids: ["sv10.5b-083", "sv10.5b-163", "sv10.5b-170"],
    legal: 3,
    bought: {
      kind: "trainerOp",
      op: { op: "moveEnergy", route: "benchToActive", anySource: true, max: 2 },
    } as Bought,
    needs:
      "a relaxation of `moveEnergy`'s SINGLE-SOURCE coupling. Every authored member so far prints 'from 1 of your Pokémon' (Energy Switch, Poppy, Armarouge, Exp. Share), and cardplay.ts's validator enforces it verbatim — 'every Energy must come from the same Pokémon'. N's Plan prints 'from your Benched POKÉMON', plural: one Energy off each of two benched bodies is a legal paper play and a rejected wire message here. A silent narrowing on a common line is a behavioural bug, not an approximation.",
  },
] as const;

const DROPPED: readonly {
  readonly program: string;
  readonly ids: readonly string[];
  readonly legal: number;
  readonly needs: string;
}[] = [];

const LOCAL_CARDS: Record<string, Card> = {
  /** fix-poisonpoint — a defender carrying the Poison Point trigger. No attacks:
      it only ever gets hit. */
  "fix-poisonpoint": battler("fix-poisonpoint", {
    name: "fix-poisonpoint",
    hp: 140,
    retreat: 1,
    abilities: [
      {
        type: "Ability",
        name: "Poison Point",
        effect:
          "If this Pokémon is in the Active Spot and is damaged by an attack from your opponent's Pokémon (even if this Pokémon is Knocked Out), the Attacking Pokémon is now Poisoned.",
      },
    ],
  }),
  /** fix-trade — the discard-a-card-then-draw-2 activated Ability. */
  "fix-trade": battler("fix-trade", {
    name: "fix-trade",
    hp: 200,
    retreat: 1,
    abilities: [
      {
        type: "Ability",
        name: "Trade",
        effect:
          "You must discard a card from your hand in order to use this Ability. Once during your turn, you may draw 2 cards.",
      },
    ],
  }),
  /** fix-metalbridge — the {M}-gated free-retreat aura. Retreat 2, so its own
      cost is visibly zeroed; METAL-typed, so it is also its own aura target. */
  "fix-metalbridge": battler("fix-metalbridge", {
    name: "fix-metalbridge",
    types: ["Metal"],
    hp: 150,
    retreat: 2,
    abilities: [
      {
        type: "Ability",
        name: "Metal Bridge",
        effect: "All of your Pokémon that have {M} Energy attached have no Retreat Cost.",
      },
    ],
  }),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const DECK = deckOf({
  "fix-attacker": 6, // Bite ({C}, 30) idx 0; Yawn (no damage) idx 2
  "fix-poisonpoint": 4,
  "fix-trade": 4,
  "fix-metalbridge": 4,
  "fix-retreat2": 4, // retreat 2, no Ability — the aura's third-party target
  "sv01-180": 2, // Nemona ("Draw 3 cards.") — the FIRST_TURN_SUPPORTER witness
  "fix-bigbody": 18, // 200 HP DOMINANT Basic — mulligan-free setup + promote target
  "fix-metal-energy": 8,
  "fix-energy": 10,
});

const bite = { type: "attack", seat: "p1", index: 0 } as const;
const yawn = { type: "attack", seat: "p1", index: 2 } as const;
const useTrade = {
  type: "useAbility",
  seat: "p1",
  target: { spot: "active" },
  abilityName: "Trade",
} as const;

function localSetup(seed: number, first: Seat): GameState {
  return driveSetup(seed, { p1: DECK, p2: DECK }, { pool: POOL, first });
}

/** Setup, then open P1's turn (P2 went first and passed). */
function board(seed: number): GameState {
  return mustApply(localSetup(seed, "p2"), { type: "endTurn", seat: "p2" }).state;
}

/** P1 fields fix-attacker with one {C} attached (pays Bite); P2 fields `defender`. */
function fight(seed: number, defender: string): GameState {
  let state = setActiveFromDeck(board(seed), "p1", "fix-attacker");
  state = attachFromDeck(state, "p1", "fix-energy", 1);
  return setActiveFromDeck(state, "p2", defender);
}

/** P1's Active's Retreat Cost under every continuous modifier in play. */
function activeCost(state: GameState): number {
  const active = state.players.p1.active;
  if (active === null) throw new Error("p1 has no Active");
  return effectiveRetreatCost(state, active);
}

describe("D190 — the registry-only programs that LANDED", () => {
  it("registers all 11 Standard-legal printings, one shared object per program", () => {
    for (const { program, ids, fixture, legal } of LANDED) {
      expect(ids, `${program}: id list disagrees with its measured legal count`).toHaveLength(
        legal,
      );
      const first = programFor(ids[0] as string);
      expect(first, `${program}: ${ids[0]} has no program`).toBeDefined();
      for (const id of ids) expect(programFor(id), `${id} left ${program}`).toBe(first);
      expect(programFor(fixture), `${fixture} is not ${program}`).toBe(first);
    }
    expect(LANDED.reduce((n, l) => n + l.legal, 0)).toBe(11);
  });

  it("authors the three programs EXACTLY, ops named", () => {
    expect(programFor("sv05-008")?.triggered).toEqual([
      {
        name: "Poison Point",
        trigger: "onDamagedByAttack",
        activeOnly: true,
        program: [{ op: "applyStatus", target: "attacker", status: "poisoned" }],
      },
    ]);
    expect(programFor("sv09-098")?.abilities).toEqual([
      {
        name: "Trade",
        oncePerTurn: true,
        activeOnly: false,
        program: [
          { op: "payFromHand", count: 1, to: "discard" },
          { op: "drawCards", count: 2 },
        ],
      },
    ]);
    expect(programFor("sv07-107")?.passive).toEqual({
      noRetreatCostAura: { requiresEnergyType: "Metal" },
    });
  });

  it("does NOT share an object with the near-twin each was modelled on", () => {
    expect(programFor("sv05-008")).not.toBe(programFor("sv03-044"));
    expect(programFor("sv09-098")).not.toBe(programFor("sv02-105"));
    expect(programFor("sv07-107")).not.toBe(programFor("sv03-082"));
    expect(programFor("sv05-008")?.triggered?.[0]?.program).not.toEqual(
      programFor("sv03-044")?.triggered?.[0]?.program,
    );
    expect(programFor("sv02-105")?.abilities?.[0]?.program).not.toEqual(
      programFor("sv09-098")?.abilities?.[0]?.program,
    );
    expect(programFor("sv03-082")?.passive).toEqual({
      noRetreatCostAura: { requiresEnergyType: "Psychic" },
    });
  });
});

describe("Poison Point — driven through the real engine", () => {
  it("POISONS the Attacking Pokémon when the holder is damaged in the Active Spot", () => {
    const state = fight(1, "fix-poisonpoint");
    deepFreeze(state);
    const { state: after, events } = mustApply(state, bite);
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ seat: "p2", dealt: 30 });
    expect(findEvent(events, "ABILITY_TRIGGERED")).toMatchObject({
      seat: "p2",
      ability: "Poison Point",
    });
    // POISONED, not Burned — the one token that separates this from sv03-044,
    // and the only thing a copy-paste of Scorching Armor would get wrong.
    expect(findEvent(events, "STATUS_APPLIED")).toMatchObject({ seat: "p1", status: "poisoned" });
    expect(after.players.p1.active?.conditions.poisonDamage).toBeGreaterThan(0);
    expect(after.players.p1.active?.conditions.burned).toBe(false);
    // Order: the reaction folds immediately behind the damage it reacts to.
    const order = types(events);
    expect(order.indexOf("DAMAGE_DEALT")).toBeLessThan(order.indexOf("ABILITY_TRIGGERED"));
    expect(order.indexOf("ABILITY_TRIGGERED")).toBeLessThan(order.indexOf("STATUS_APPLIED"));
  });

  it("does NOT fire on a 0-damage attack — 'damaged by an attack' means damage was dealt", () => {
    const state = fight(2, "fix-poisonpoint");
    deepFreeze(state);
    const { state: after, events } = mustApply(state, yawn);
    expect(types(events)).not.toContain("DAMAGE_DEALT");
    expect(
      events.find((e) => e.type === "ABILITY_TRIGGERED" && e.ability === "Poison Point"),
    ).toBeUndefined();
    expect(after.players.p1.active?.conditions.poisonDamage).toBe(0);
  });

  it("does NOT fire from the BENCH — `activeOnly` carries the printed clause", () => {
    let state = fight(3, "fix-bigbody");
    state = benchFromDeck(state, "p2", "fix-poisonpoint");
    deepFreeze(state);
    const { state: after, events } = mustApply(state, bite);
    expect(findEvent(events, "DAMAGE_DEALT")).toMatchObject({ seat: "p2", dealt: 30 });
    expect(
      events.find((e) => e.type === "ABILITY_TRIGGERED" && e.ability === "Poison Point"),
    ).toBeUndefined();
    expect(after.players.p1.active?.conditions.poisonDamage).toBe(0);
  });
});

describe("Trade — driven through the real engine", () => {
  it("parks on the hand cost, pays it to the DISCARD, then draws exactly 2", () => {
    const state = setActiveFromDeck(board(4), "p1", "fix-trade");
    const handBefore = state.players.p1.hand.length;
    deepFreeze(state);
    const { state: parked } = mustApply(state, useTrade);
    // The cost is the program's FIRST op and "a card" has no filter, so a mixed
    // hand always asks — this parks rather than auto-paying.
    expect(parked.phase.kind).toBe("effect:choose");
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    if (parked.phase.prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    expect(parked.phase.prompt.min).toBe(1);
    expect(parked.phase.prompt.max).toBe(1);
    const pick = parked.phase.prompt.candidates[0] as string;
    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [pick] },
    });
    expect(findEvent(events, "HAND_COST_PAID")?.uids).toEqual([pick]);
    // TWO, not Tinkaton's three — the one number a copied program gets wrong.
    expect(findEvent(events, "CARDS_DRAWN")?.uids).toHaveLength(2);
    expect(done.players.p1.discard).toContain(pick);
    expect(done.players.p1.hand).toHaveLength(handBefore - 1 + 2);
  });

  it("is ONCE PER TURN — a second use in the same turn is refused", () => {
    let state = setActiveFromDeck(board(5), "p1", "fix-trade");
    const { state: parked } = mustApply(state, useTrade);
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    if (parked.phase.prompt.kind !== "chooseCards") throw new Error("expected chooseCards");
    state = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [parked.phase.prompt.candidates[0] as string] },
    }).state;
    const again = applyAction(state, useTrade);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.code).toBe("ABILITY_ALREADY_USED");
  });

  it("is REFUSED with an empty hand — the cost gates the USE (cardplay `handCostUnmet`)", () => {
    // The doctrine the AbilityProgram doc block states: there is no `cost` FIELD,
    // the cost is the first op — and `useAbility` still refuses the use when it
    // cannot be paid, rather than running the draw for free.
    const state = setActiveFromDeck(board(6), "p1", "fix-trade");
    const emptied: GameState = {
      ...state,
      players: {
        ...state.players,
        p1: {
          ...state.players.p1,
          deck: [...state.players.p1.deck, ...state.players.p1.hand],
          hand: [],
        },
      },
    };
    const refused = applyAction(emptied, useTrade);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.code).toBe("ABILITY_COST_UNMET");
  });
});

describe("Metal Bridge — driven through the real engine", () => {
  it("frees a {M}-carrying Pokémon and NOT a {C}-carrying one — the clause is per target", () => {
    // fix-retreat2 in the Active spot (retreat 2, no Ability of its own), with
    // the aura source on the BENCH. Colorless attached: the per-target clause is
    // unsatisfied and the printed cost stands.
    let colorless = setActiveFromDeck(board(7), "p1", "fix-retreat2");
    colorless = benchFromDeck(colorless, "p1", "fix-metalbridge");
    colorless = attachFromDeck(colorless, "p1", "fix-energy", 1);
    expect(activeCost(colorless)).toBe(2);

    // The SAME board with a {M} instead: the aura reaches it and the cost is 0.
    let metal = setActiveFromDeck(board(7), "p1", "fix-retreat2");
    metal = benchFromDeck(metal, "p1", "fix-metalbridge");
    metal = attachFromDeck(metal, "p1", "fix-metal-energy", 1);
    expect(activeCost(metal)).toBe(0);

    // …and with NO aura source anywhere, the {M} on its own buys nothing.
    let sourceless = setActiveFromDeck(board(7), "p1", "fix-retreat2");
    sourceless = benchFromDeck(sourceless, "p1", "fix-bigbody");
    sourceless = attachFromDeck(sourceless, "p1", "fix-metal-energy", 1);
    expect(activeCost(sourceless)).toBe(2);
  });

  it("the RETREAT ACTION honours it — a freed Active retreats paying nothing", () => {
    let state = setActiveFromDeck(board(8), "p1", "fix-retreat2");
    state = benchFromDeck(state, "p1", "fix-metalbridge");
    state = attachFromDeck(state, "p1", "fix-metal-energy", 1);
    const retreating = state.players.p1.active?.stack.at(-1);
    const energy = state.players.p1.active?.energy;
    const discardBefore = state.players.p1.discard;
    deepFreeze(state);

    const { state: done, events } = mustApply(state, {
      type: "retreat",
      seat: "p1",
      discardEnergy: [],
      promoteBenchIndex: 0,
    });
    expect(types(events)).toContain("RETREATED");
    // The {M} rode along on the retreating body — nothing was paid.
    const benched = done.players.p1.bench.find((p) => p.stack.at(-1) === retreating);
    expect(benched?.energy).toEqual(energy);
    expect(done.players.p1.discard).toEqual(discardBefore);
  });

  it("without the aura the same free retreat is REJECTED (RETREAT_COST_MISMATCH)", () => {
    // The negative that makes the case above mean something: identical action,
    // identical board minus the source, and the engine charges the printed 2.
    let state = setActiveFromDeck(board(8), "p1", "fix-retreat2");
    state = benchFromDeck(state, "p1", "fix-bigbody");
    state = attachFromDeck(state, "p1", "fix-metal-energy", 1);
    const rejected = applyAction(state, {
      type: "retreat",
      seat: "p1",
      discardEnergy: [],
      promoteBenchIndex: 0,
    });
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.error.code).toBe("RETREAT_COST_MISMATCH");
  });

  it("is SELF-INCLUSIVE and LIVE-READ — the source frees itself only while it holds {M}", () => {
    const bare = setActiveFromDeck(board(9), "p1", "fix-metalbridge");
    expect(activeCost(bare)).toBe(2);
    expect(activeCost(attachFromDeck(bare, "p1", "fix-metal-energy", 1))).toBe(0);
    // A Colorless on the source does not satisfy its own clause either.
    expect(activeCost(attachFromDeck(bare, "p1", "fix-energy", 2))).toBe(2);
  });

  it("is OWN-BOARD — an opponent's Metal Bridge frees nothing of yours", () => {
    let state = setActiveFromDeck(board(10), "p1", "fix-retreat2");
    state = attachFromDeck(state, "p1", "fix-metal-energy", 1);
    state = benchFromDeck(state, "p2", "fix-metalbridge");
    expect(activeCost(state)).toBe(2);
  });
});

describe("the FOUR the census priced as Tier 1 that are NOT — and why (all 4 now PAID)", () => {
  it("the four that were PAID are built, by exactly the pieces their rows predicted", () => {
    for (const { program, ids, legal, bought } of PAID) {
      expect(ids, `${program}: id list disagrees with its measured legal count`).toHaveLength(
        legal,
      );
      const first = programFor(ids[0]);
      expect(first, `${program}: ${ids[0]} has no program`).toBeDefined();
      for (const id of ids) expect(programFor(id), `${id} left ${program}`).toBe(first);
      switch (bought.kind) {
        case "abilityOp":
          expect(
            first?.abilities?.[0]?.program?.[0],
            `${program}: the op its row predicted is gone`,
          ).toMatchObject(bought.op);
          break;
        case "programFlag":
          expect(first?.[bought.field], `${program}: the flag its row predicted is gone`).toBe(
            true,
          );
          break;
        case "trainerOp":
          expect(first?.trainer?.[0], `${program}: the op its row predicted is gone`).toMatchObject(
            bought.op,
          );
          break;
      }
    }
    expect(PAID.reduce((n, p) => n + p.legal, 0)).toBe(18);
  });

  it("has NOTHING left unbuilt — the table is empty, and that is asserted, not looped", () => {
    expect(DROPPED).toHaveLength(0);
    for (const { program, ids, legal } of DROPPED) {
      expect(ids, `${program}: id list disagrees with its measured legal count`).toHaveLength(
        legal,
      );
      for (const id of ids) {
        expect(
          programFor(id),
          `${id} (${program}) was landed despite needing engine code that does not exist`,
        ).toBeUndefined();
      }
    }
    expect(DROPPED.reduce((n, d) => n + d.legal, 0)).toBe(0);
    expect(PAID.reduce((n, p) => n + p.legal, 0) + DROPPED.reduce((n, d) => n + d.legal, 0)).toBe(
      18,
    );
  });

  it("Carmine's blocker was REAL — the lock still FIRES for an UNEXEMPTED Supporter", () => {
    const state = localSetup(11, "p1"); // P1 goes first, so this IS turn 1
    expect(state.turn).toBe(1);
    expect(state.firstPlayer).toBe("p1");
    const withNemona = handFromDeckLocal(state, "p1", "sv01-180");
    const uid = handUid(withNemona, "p1", "sv01-180");
    const refused = applyAction(withNemona, { type: "playTrainer", seat: "p1", uid });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.code).toBe("FIRST_TURN_SUPPORTER");

    // …and the SAME Supporter on turn 2 (the going-second seat's first turn) is
    // fine, so the refusal above is the first-turn rule and not an unplayable card.
    const turn2 = mustApply(state, { type: "endTurn", seat: "p1" }).state;
    expect(turn2.turn).toBe(2);
    const armed = handFromDeckLocal(turn2, "p2", "sv01-180");
    const ok = applyAction(armed, {
      type: "playTrainer",
      seat: "p2",
      uid: handUid(armed, "p2", "sv01-180"),
    });
    expect(ok.ok).toBe(true);
  });
});

/** `handFromDeck` for the local pool — identical surgery, no pool dependency,
    inlined only because the shared helper is not parameterised by deck source in
    a way this file needs. Moves one copy of `cardId` from deck to hand. */
function handFromDeckLocal(state: GameState, seat: Seat, cardId: string): GameState {
  const side = state.players[seat];
  const uid = side.deck.find((u) => state.cardIdByUid[u] === cardId);
  if (uid === undefined) throw new Error(`${seat} deck has no ${cardId}`);
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: { ...side, deck: side.deck.filter((u) => u !== uid), hand: [...side.hand, uid] },
    },
  };
}
