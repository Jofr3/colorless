import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { deriveAttackEffect } from "./effects";
import type { GameAction, GameEvent, GameState, Seat } from "./index";
import { applyAction, createGame, engineVersion } from "./index";
import { conditionHolds } from "./interpreter";
import { programFor } from "./registry";
import { flipCoin } from "./rng";
import {
  FIXTURE_POOL,
  attachFromDeck,
  attachToolFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  mustApply,
  setActiveFromDeck,
  setConditions,
  trainerCard,
  typedEnergy,
} from "./testFixtures";
import { koToolTriggersOf } from "./triggers";

// ── 🆕🆕🆕 D626 — K1: THE REST OF THE KO / DAMAGED TRIGGERS ──
//
// 4 printed texts / 8 `me` printings: Flygon ×3 "Sandy Flapping" (an `onEvolve` row and an `onKnockOut` row
// behind `activeOnly` + `byOpponentAttack`, each behind an inner confirm), Miraidon ×2 "Photon Cord" (the NEW
// `onSelfActiveKnockedOut` on the `koToolTrigger` stage), Gengar ex ×2 "Fainting Spell" (the NEW
// `koAttackerOnCoinFlip`, read by flow.ts `faintingSpells`) and Adversity Policy (a Tool on the
// `onDamagedByAttack` stage behind the NEW `yourActiveWeakToOpponentActiveType`). Every id and text off the
// LOCAL D1 (`apps/api/.wrangler/…/8437d866….sqlite`), 2026-10-09, `legal_standard = 1`. No `me` row is a
// fixture, so the printed bytes are carried HERE and the suite drives a LOCAL `cardPool` (D275).

const SANDY_FLAPPING =
  "Once during your turn, when you play this Pokémon from your hand to evolve 1 of your Pokémon, you may use this Ability. You may also use this Ability if this Pokémon is in the Active Spot and is Knocked Out by damage from an attack from your opponent's Pokémon. Discard the top 2 cards of your opponent's deck.";
const PHOTON_CORD =
  "If this Pokémon is in the Active Spot and is Knocked Out by damage from an attack from your opponent's Pokémon, move up to 2 Basic {L} Energy cards from this Pokémon to 1 of your Benched Pokémon.";
const FAINTING_SPELL =
  "If this Pokémon is Knocked Out by damage from an attack from your opponent's Pokémon, flip a coin. If heads, the Attacking Pokémon is Knocked Out.";
const ADVERSITY_POLICY =
  "If the Pokémon this card is attached to has Weakness to your opponent's Active Pokémon's type, is in the Active Spot, and is damaged by an attack from your opponent's Pokémon (even if this Pokémon is Knocked Out), draw 3 cards.";

const FLYGON = ["mep-016", "me02-053", "me02-101"] as const;
const MIRAIDON = ["mep-082", "me05-028"] as const;
const GENGAR = ["30th-090", "30th-154"] as const;
const POLICY = "me04-074";
/** Mega Clefable ex — "Luminous Wing" (registry `LUMINOUS_WING`, D614): the opponent's Abilities' effects refused. */
const CLEFABLE = "me03-031";
/** Flutter Mane — "Midnight Fluttering": the opposing Active has no Abilities. */
const FLUTTER = "sv05-078";
/** Survival Brace — the full-HP KO-survival Tool (D562). */
const BRACE = "sv06-164";

const VIBRAVA = "d626-vibrava";
const FILLER = "d626-filler"; // {C} Basic, 400 HP
const FOE = "d626-foe"; // a {C} non-ex attacker
const FOE_EX = "d626-foe-ex"; // a {C} ex attacker
const MEGA_FOE = "d626-mega-foe"; // a {C} Mega Evolution Pokémon ex attacker
const SPARK = "d626-spark"; // a {L} attacker
const DUAL = "d626-dual"; // a {W}{L} attacker
const WEAK_L = "d626-weak-l"; // {C}, Weakness {L} ×2, 400 HP
const L = "d626-lightning";
const F = "d626-fighting";
const E = "fix-energy";
const SPARE = "d626-spare";

const SPREAD =
  "This attack also does 200 damage to each of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";
const DOOM = "If your opponent's Active Pokémon is a Basic Pokémon, it is Knocked Out.";

/** 0 Crush 300; 1 Doom (10, then a `knockOutDefender` on a Basic); 2 Wide Splash (10 + 200 to each Benched); 3 Tap 10. */
const MOVES: Card["attacks"] = [
  { cost: ["Colorless"], name: "Crush", damage: 300 },
  { cost: ["Colorless"], name: "Doom", damage: 10, effect: DOOM },
  { cost: ["Colorless"], name: "Wide Splash", damage: 10, effect: SPREAD },
  { cost: ["Colorless"], name: "Tap", damage: 10 },
];
const CRUSH = 0;
const DOOMED = 1;
const WIDE = 2;
const TAP_ATTACK = 3;
const TAP: Card["attacks"] = [{ cost: ["Colorless"], name: "Tap", damage: 10 }];
const ability = (name: string, effect: string) => ({ abilities: [{ type: "Ability", name, effect }] }) as Partial<Card>;
const mon = (id: string, name: string, hp: number, types: string[], attacks: Card["attacks"], extra: Partial<Card> = {}) =>
  battler(id, { name, hp, types, retreat: 1, attacks, ...extra });

const LOCAL: Record<string, Card> = {
  ...Object.fromEntries(
    FLYGON.map((id) => [
      id,
      mon(id, "Flygon", 150, ["Fighting"], [{ cost: ["Fighting", "Fighting"], name: "Cutting Wind", damage: 130 }], {
        stage: "Stage2",
        evolveFrom: "Vibrava",
        ...ability("Sandy Flapping", SANDY_FLAPPING),
      }),
    ]),
  ),
  ...Object.fromEntries(
    MIRAIDON.map((id) => [id, mon(id, "Miraidon", 120, ["Lightning"], TAP, ability("Photon Cord", PHOTON_CORD))]),
  ),
  ...Object.fromEntries(
    GENGAR.map((id) => [id, mon(id, "Gengar ex", 280, ["Darkness"], TAP, ability("Fainting Spell", FAINTING_SPELL))]),
  ),
  [POLICY]: { ...trainerCard(POLICY, "Tool", ADVERSITY_POLICY), name: "Adversity Policy" },
  [CLEFABLE]: mon(CLEFABLE, "Mega Clefable ex", 330, ["Psychic"], MOVES, ability("Luminous Wing", "Prevent all effects of your opponent's Pokémon's Abilities done to this Pokémon.")),
  [FLUTTER]: mon(FLUTTER, "Flutter Mane", 90, ["Psychic"], MOVES, ability("Midnight Fluttering", "As long as this Pokémon is in the Active Spot, your opponent's Active Pokémon has no Abilities, except for Midnight Fluttering.")),
  [BRACE]: {
    ...trainerCard(
      BRACE,
      "Tool",
      "If the Pokémon this card is attached to has full HP and would be Knocked Out by damage from an attack from your opponent's Pokémon, it is not Knocked Out, and its remaining HP becomes 10. Then, discard this card.",
    ),
    name: "Survival Brace",
  },
  [VIBRAVA]: mon(VIBRAVA, "Vibrava", 90, ["Fighting"], TAP, { stage: "Stage1", evolveFrom: "Trapinch" }),
  [FILLER]: mon(FILLER, "D626 Filler", 400, ["Colorless"], TAP),
  [FOE]: mon(FOE, "D626 Foe", 400, ["Colorless"], MOVES),
  [FOE_EX]: mon(FOE_EX, "D626 Foe ex", 400, ["Colorless"], MOVES),
  [MEGA_FOE]: mon(MEGA_FOE, "Mega D626 Foe ex", 400, ["Colorless"], MOVES),
  [SPARK]: mon(SPARK, "D626 Spark", 400, ["Lightning"], MOVES),
  [DUAL]: mon(DUAL, "D626 Dual", 400, ["Water", "Lightning"], MOVES),
  [WEAK_L]: mon(WEAK_L, "D626 Weak", 400, ["Colorless"], TAP, { weaknesses: [{ type: "Lightning", value: "×2" }] }),
  [L]: typedEnergy(L, "Lightning"),
  [F]: typedEnergy(F, "Fighting"),
  [SPARE]: typedEnergy(SPARE, "Metal"),
};
const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL };
const DECK = deckOf({
  [FLYGON[0]]: 1,
  [FLYGON[1]]: 1,
  [FLYGON[2]]: 1,
  [MIRAIDON[0]]: 1,
  [MIRAIDON[1]]: 1,
  [GENGAR[0]]: 1,
  [GENGAR[1]]: 1,
  [POLICY]: 1,
  [CLEFABLE]: 1,
  [FLUTTER]: 1,
  [BRACE]: 1,
  [VIBRAVA]: 1,
  [FILLER]: 10,
  [FOE]: 1,
  [FOE_EX]: 1,
  [MEGA_FOE]: 1,
  [SPARK]: 1,
  [DUAL]: 1,
  [WEAK_L]: 1,
  [L]: 4,
  [F]: 1,
  [E]: 6,
  [SPARE]: 21,
});
const BOARD_IDS = Object.keys(LOCAL)
  .filter((id) => id !== SPARE)
  .concat([E]);

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

/** Setup, then P1's own SECOND turn (P2 went first; every turn passed); both hands back into the decks. */
function p1Turn(): GameState {
  const created = createGame({ seed: 6260, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
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
  // P1's SECOND turn (D590's opening), so a Flygon may be evolved from the hand.
  state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
  state = must(applyAction(state, { type: "endTurn", seat: "p1" }));
  state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
  for (const s of ["p1", "p2"] as const) {
    const side = state.players[s];
    state = { ...state, players: { ...state.players, [s]: { ...side, hand: [], deck: [...side.deck, ...side.hand] } } };
  }
  return state;
}

/** TEST SURGERY — every Prize whose id is a board id swapped with a SPARE from the deck. */
function unprize(state: GameState, seat: Seat): GameState {
  const side = state.players[seat];
  const kept = new Set(BOARD_IDS);
  let deck = [...side.deck];
  const prizes = side.prizes.map((u) => {
    if (!kept.has(state.cardIdByUid[u] ?? "")) return u;
    const swap = deck.find((d) => !kept.has(state.cardIdByUid[d] ?? ""));
    if (swap === undefined) throw new Error("no swap card");
    deck = [...deck.filter((d) => d !== swap), u];
    return swap;
  });
  return { ...state, players: { ...state.players, [seat]: { ...side, prizes, deck } } };
}

/** P1's Active is `attacker` (one {C} attached) over a FILLER; P2's Active is `defender` over `bench`. */
function table(attacker: string, defender: string, bench: readonly string[] = [FILLER]): GameState {
  let state = p1Turn();
  for (const s of ["p1", "p2"] as const) state = unprize(clearBench(setActiveFromDeck(state, s, FILLER), s), s);
  state = clearBench(setActiveFromDeck(state, "p1", attacker), "p1");
  state = benchFromDeck(attachFromDeck(state, "p1", E, 1), "p1", FILLER);
  state = clearBench(setActiveFromDeck(state, "p2", defender), "p2");
  for (const id of bench) state = benchFromDeck(state, "p2", id);
  return state;
}

type Body = NonNullable<GameState["players"]["p1"]["active"]>;
function edit(state: GameState, seat: Seat, where: "active" | number, change: (b: Body) => Body): GameState {
  const side = state.players[seat];
  if (where === "active") {
    if (side.active === null) throw new Error(`no ${seat} Active`);
    return { ...state, players: { ...state.players, [seat]: { ...side, active: change(side.active) } } };
  }
  const bench = side.bench.map((b, i) => (i === where ? change(b) : b));
  return { ...state, players: { ...state.players, [seat]: { ...side, bench } } };
}
const hurt = (state: GameState, seat: Seat, where: "active" | number, damage: number) =>
  edit(state, seat, where, (b) => ({ ...b, damage }));

/** The first rng state whose NEXT flip is `face`. */
function rngFor(face: "heads" | "tails"): number {
  for (let r = 1; ; r += 1) if (flipCoin(r)[0] === face) return r;
}
const seeded = (state: GameState, face: "heads" | "tails") => ({ ...state, rngState: rngFor(face) });

const attack = (index: number): GameAction => ({ type: "attack", seat: "p1", index });
const resolve = (state: GameState, choice: unknown, seat: Seat = "p2") =>
  mustApply(state, { type: "resolveEffect", seat, choice } as GameAction);
const of = <T extends GameEvent["type"]>(events: readonly GameEvent[], type: T) =>
  events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
const top = (state: GameState, seat: Seat) => state.players[seat].active?.stack.at(-1) ?? "";
const ids = (state: GameState, uids: readonly string[]) => uids.map((u) => state.cardIdByUid[u]);
function prompt(state: GameState) {
  if (state.phase.kind !== "effect:choose") throw new Error(`expected effect:choose, got ${state.phase.kind}`);
  return state.phase;
}

/** Answer every prize / promotion interrupt with its first option until the board parks or the turn moves on. */
function drain(start: { state: GameState; events: GameEvent[] }): { state: GameState; events: GameEvent[] } {
  let { state, events } = start;
  for (let i = 0; i < 20; i++) {
    const phase = state.phase;
    if (phase.kind === "ko:takePrizes") {
      const next = mustApply(state, {
        type: "takePrizes",
        seat: phase.seat,
        prizeIndices: Array.from({ length: phase.count }, (_, k) => k),
      });
      state = next.state;
      events = [...events, ...next.events];
    } else if (phase.kind === "ko:promote") {
      const next = mustApply(state, { type: "promote", seat: phase.seat, benchIndex: 0 });
      state = next.state;
      events = [...events, ...next.events];
    } else {
      return { state, events };
    }
  }
  throw new Error("drain did not settle");
}

describe("D626 §1 — the texts and the registry rows", () => {
  it("Flygon ×3: two `Sandy Flapping` rows — `onEvolve`, and `onKnockOut` behind `activeOnly` + `byOpponentAttack` — each a confirm around the reader's mill", () => {
    const mill = deriveAttackEffect("Discard the top 2 cards of your opponent's deck.");
    expect(mill).toEqual([{ op: "discardDeckTop", whose: "opponent", count: 2 }]);
    // biome-ignore lint/suspicious/noThenProperty: `then` is the effect gate's step list, not a thenable.
    const confirm = [{ op: "optional", note: SANDY_FLAPPING, then: mill }];
    for (const id of FLYGON) {
      expect(programFor(id), id).toEqual({
        triggered: [
          { name: "Sandy Flapping", trigger: "onEvolve", optional: true, program: confirm },
          {
            name: "Sandy Flapping",
            trigger: "onKnockOut",
            optional: true,
            activeOnly: true,
            byOpponentAttack: true,
            program: confirm,
          },
        ],
      });
    }
    expect(programFor(FLYGON[1])).toBe(programFor(FLYGON[0]));
  });

  it("Miraidon ×2: `onSelfActiveKnockedOut`, up to 2 Basic {L} from this Pokémon to ONE Benched Pokémon", () => {
    for (const id of MIRAIDON) {
      expect(programFor(id), id).toEqual({
        triggered: [
          {
            name: "Photon Cord",
            trigger: "onSelfActiveKnockedOut",
            program: [
              { op: "moveEnergy", filter: { kind: "basicEnergy", energyType: "Lightning" }, max: 2, route: "selfToBench" },
            ],
          },
        ],
      });
    }
  });

  it("Gengar ex ×2: `koAttackerOnCoinFlip`; Adversity Policy: a damaged-trigger Tool behind the new Weakness gate", () => {
    for (const id of GENGAR) expect(programFor(id), id).toEqual({ passive: { koAttackerOnCoinFlip: "Fainting Spell" } });
    expect(programFor(POLICY)).toEqual({
      triggered: [
        {
          name: "Adversity Policy",
          trigger: "onDamagedByAttack",
          program: [
            {
              op: "conditionGate",
              cond: { kind: "yourActiveWeakToOpponentActiveType" },
              // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable.
              then: [{ op: "drawCards", count: 3 }],
            },
          ],
        },
      ],
    });
  });

  it("out of scope (K2): Spiteful Swirl ×2 and Counterattack Grouping stay unkeyed (🆕🆕🆕 D642 (D539): WITHDRAWN — keyed since D642, the rung is inverted)", () => {
    for (const id of ["me01-087", "me01-148", "30th-022"]) expect(Object.keys(programFor(id) ?? {}), id).toEqual(["passive"]);
  });
});

describe("D626 §2 — Sandy Flapping, the on-evolve half: a confirm, then the opponent mills 2", () => {
  const evolving = () => {
    let state = table(FOE, FILLER);
    state = benchFromDeck(state, "p1", VIBRAVA);
    const side = state.players.p1;
    const uid = side.deck.find((u) => state.cardIdByUid[u] === FLYGON[0]) as string;
    state = { ...state, players: { ...state.players, p1: { ...side, hand: [uid], deck: side.deck.filter((u) => u !== uid) } } };
    return mustApply(state, { type: "evolve", seat: "p1", uid, target: { spot: "bench", index: 1 } });
  };

  it("Flygon onto Vibrava: ABILITY_TRIGGERED, then the confirm carries the whole print; yes mills P2's top 2", () => {
    const parked = evolving();
    expect(of(parked.events, "ABILITY_TRIGGERED").map((e) => e.ability)).toEqual(["Sandy Flapping"]);
    expect(prompt(parked.state).prompt).toStrictEqual({ kind: "confirm", note: SANDY_FLAPPING });
    const deck = parked.state.players.p2.deck;
    const done = resolve(parked.state, { kind: "confirm", yes: true }, "p1").state;
    expect(done.phase.kind).toBe("turn:action");
    expect(done.players.p2.deck).toEqual(deck.slice(2));
    expect(done.players.p2.discard.slice(-2).sort()).toEqual(deck.slice(0, 2).sort());
  });

  it("no: nothing is milled (the printed \"you may\" is a real decline)", () => {
    const parked = evolving();
    const deck = parked.state.players.p2.deck;
    const done = resolve(parked.state, { kind: "confirm", yes: false }, "p1").state;
    expect(done.players.p2.deck).toEqual(deck);
    expect(done.players.p2.discard).toEqual(parked.state.players.p2.discard);
  });
});

describe("D626 §3 — Sandy Flapping, the Knock Out half: Active, by an opponent's attack, after the Prize", () => {
  it("the Active Flygon KO'd by Crush: the koTrigger stage carries only seat and uid, and parks P2's confirm after the Prize", () => {
    const state = table(FOE, FLYGON[0]);
    const flygon = top(state, "p2");
    const afterAttack = mustApply(state, attack(CRUSH)).state;
    expect(afterAttack.pending.slice(0, 3).map((s) => s.kind)).toEqual(["takePrizes", "koTrigger", "promote"]);
    expect(afterAttack.pending[1]).toStrictEqual({ kind: "koTrigger", seat: "p2", uid: flygon });
    const parked = mustApply(afterAttack, { type: "takePrizes", seat: "p1", prizeIndices: [0] });
    expect(of(parked.events, "ABILITY_TRIGGERED")).toEqual([
      { type: "ABILITY_TRIGGERED", seat: "p2", uid: flygon, ability: "Sandy Flapping" },
    ]);
    expect(prompt(parked.state)).toMatchObject({ seat: "p2", prompt: { kind: "confirm", note: SANDY_FLAPPING } });
    const deck = parked.state.players.p1.deck;
    const done = resolve(parked.state, { kind: "confirm", yes: true });
    expect(done.state.players.p1.deck).toEqual(deck.slice(2));
    // The promotion auto-resolves (a Bench of one) and P2's turn begins.
    expect(done.state.phase).toMatchObject({ kind: "turn:action", seat: "p2" });
  });

  it("declined: P1's deck is untouched", () => {
    const parked = mustApply(mustApply(table(FOE, FLYGON[0]), attack(CRUSH)).state, {
      type: "takePrizes",
      seat: "p1",
      prizeIndices: [0],
    }).state;
    const deck = parked.players.p1.deck;
    expect(resolve(parked, { kind: "confirm", yes: false }).state.players.p1.deck).toEqual(deck);
  });

  it("the parked confirm survives a JSON round trip (no new park shape)", () => {
    const parked = mustApply(mustApply(table(FOE, FLYGON[2]), attack(CRUSH)).state, {
      type: "takePrizes",
      seat: "p1",
      prizeIndices: [0],
    }).state;
    const revived = JSON.parse(JSON.stringify(parked)) as GameState;
    const deck = revived.players.p1.deck;
    expect(resolve(revived, { kind: "confirm", yes: true }).state.players.p1.deck).toEqual(deck.slice(2));
  });

  it("a BENCHED Flygon KO'd by the attack's spread: no koTrigger (the `activeOnly` gate)", () => {
    const state = hurt(table(FOE, FILLER, [FLYGON[0], FILLER]), "p2", 0, 0);
    const after = mustApply(state, attack(WIDE)).state;
    expect(after.pending.some((s) => s.kind === "koTrigger")).toBe(false);
  });

  it("a Checkup Knock Out of the Active Flygon is not an attack: no koTrigger", () => {
    let state = setConditions(hurt(table(FOE, FLYGON[0]), "p2", "active", 140), "p2", { poisonDamage: 10 });
    state = mustApply(state, { type: "endTurn", seat: "p1" }).state;
    expect(state.phase.kind).toBe("ko:takePrizes");
    expect(state.pending.some((s) => s.kind === "koTrigger")).toBe(false);
  });

  it("R-SF1: a §9 lock on the dying Flygon (Flutter Mane) does not stop the KO half (R-KO1's un-gated on-KO read)", () => {
    const after = mustApply(table(FLUTTER, FLYGON[0]), attack(CRUSH)).state;
    expect(after.pending.some((s) => s.kind === "koTrigger")).toBe(true);
  });
});

describe("D626 §4 — Photon Cord: the Ability twin of Heavy Baton, before the Knock Out discards the stack", () => {
  /** P2's Active Miraidon with 3 Basic {L} and 1 Basic {F}; `bench` behind it. */
  const miraidon = (attacker = FOE, bench: readonly string[] = [FILLER, FILLER]) => {
    let state = table(attacker, MIRAIDON[0], bench);
    state = attachFromDeck(attachFromDeck(state, "p2", L, 3), "p2", F, 1);
    return state;
  };

  it("KO'd by Crush: ABILITY_TRIGGERED and a park for P2 BEFORE any Prize — the {L} only, up to 2, one Bench destination", () => {
    const state = miraidon();
    const uid = top(state, "p2");
    const lightning = (state.players.p2.active?.energy ?? []).filter((u) => state.cardIdByUid[u] === L);
    const { state: after, events } = mustApply(state, attack(CRUSH));
    expect(of(events, "ABILITY_TRIGGERED")).toEqual([{ type: "ABILITY_TRIGGERED", seat: "p2", uid, ability: "Photon Cord" }]);
    expect(of(events, "KNOCKED_OUT")).toEqual([]);
    const phase = prompt(after);
    expect(phase.seat).toBe("p2");
    if (phase.prompt.kind !== "moveEnergy") throw new Error("expected moveEnergy");
    expect(phase.prompt.movable.map((m) => m.uid).sort()).toEqual([...lightning].sort());
    expect(phase.prompt.max).toBe(2);
    expect(phase.prompt.anyDest).toBeUndefined();
    expect(phase.prompt.destinations).toEqual([
      { seat: "p2", spot: { spot: "bench", index: 0 } },
      { seat: "p2", spot: { spot: "bench", index: 1 } },
    ]);
  });

  it("answered 2 onto bench 1: they land, then the Knock Out takes the rest and P1 takes the Prize", () => {
    const state = miraidon();
    const [a, b] = (state.players.p2.active?.energy ?? []).filter((u) => state.cardIdByUid[u] === L) as [string, string];
    const parked = mustApply(state, attack(CRUSH)).state;
    const dest = { seat: "p2", spot: { spot: "bench", index: 1 } } as const;
    const done = drain(resolve(parked, { kind: "moveEnergy", picks: [{ uid: a, dest }, { uid: b, dest }] }));
    const ko = of(done.events, "KNOCKED_OUT");
    expect(ko).toHaveLength(1);
    expect(ko[0]?.discarded).not.toContain(a);
    expect(ids(done.state, ko[0]?.discarded ?? []).filter((id) => id === L || id === F).sort()).toEqual([F, L]);
    const holder = [done.state.players.p2.active, ...done.state.players.p2.bench].find((p) => p?.energy.includes(a));
    expect(holder?.energy).toEqual(expect.arrayContaining([a, b]));
    expect(done.state.players.p1.prizes).toHaveLength(5);
  });

  it("0 is a legal answer: everything goes down with the body", () => {
    const parked = mustApply(miraidon(), attack(CRUSH)).state;
    const energy = parked.players.p2.active?.energy ?? [];
    const done = drain(resolve(parked, { kind: "moveEnergy", picks: [] }));
    expect(of(done.events, "KNOCKED_OUT")[0]?.discarded).toEqual(expect.arrayContaining([...energy]));
  });

  it("not Knocked Out (Tap): the seeded stage re-asks lethality and nothing triggers", () => {
    const { state, events } = mustApply(miraidon(), attack(TAP_ATTACK));
    expect(state.phase.kind).not.toBe("effect:choose");
    expect(of(events, "ABILITY_TRIGGERED")).toEqual([]);
    expect(state.players.p2.active?.energy).toHaveLength(4);
  });

  it("§9: Flutter Mane's lock on the dying Miraidon — the scan finds nothing, no park", () => {
    const state = miraidon(FLUTTER);
    expect(koToolTriggersOf(state, "p2", top(state, "p2"))).toEqual([]);
    const { state: after, events } = drain(mustApply(state, attack(CRUSH)));
    expect(of(events, "ABILITY_TRIGGERED")).toEqual([]);
    expect(after.phase.kind).not.toBe("effect:choose");
  });

  it("R-PHC1: a `knockOutDefender` doom is not \"by damage\" — no trigger", () => {
    const { state, events } = drain(mustApply(miraidon(), attack(DOOMED)));
    expect(of(events, "ABILITY_TRIGGERED")).toEqual([]);
    expect(of(events, "KNOCKED_OUT")).toHaveLength(1);
    expect(state.phase.kind).not.toBe("effect:choose");
  });

  it("R-PHC1: with no Benched Pokémon nothing moves (no destination, no park)", () => {
    const { state, events } = mustApply(miraidon(FOE, []), attack(CRUSH));
    expect(of(events, "ABILITY_TRIGGERED").map((e) => e.ability)).toEqual(["Photon Cord"]);
    expect(state.phase.kind).not.toBe("effect:choose");
  });

  it("the scan's Ability arm comes first, flagged `fromAbility`, and only on the dying body", () => {
    const state = miraidon();
    const uid = top(state, "p2");
    expect(koToolTriggersOf(state, "p2", uid).map((e) => [e.ability.name, e.toolUid === uid, e.fromAbility])).toEqual([
      ["Photon Cord", true, true],
    ]);
    expect(koToolTriggersOf(state, "p2", "d626-not-the-active")).toEqual([]);
  });

  it("the parked move round-trips through JSON (no new park shape)", () => {
    const parked = JSON.parse(JSON.stringify(mustApply(miraidon(), attack(CRUSH)).state)) as GameState;
    const [a] = (parked.players.p2.active?.energy ?? []).filter((u) => parked.cardIdByUid[u] === L) as [string];
    const dest = { seat: "p2", spot: { spot: "bench", index: 0 } } as const;
    const done = drain(resolve(parked, { kind: "moveEnergy", picks: [{ uid: a, dest }] }));
    expect(done.state.players.p2.bench.some((p) => p.energy.includes(a)) || done.state.players.p2.active?.energy.includes(a)).toBe(
      true,
    );
  });
});

describe("D626 §5 — Fainting Spell: heads Knocks Out the Attacking Pokémon, in the same batch", () => {
  it("heads: the attacker is Knocked Out beside the Gengar ex; each side takes its Prizes (2 for an ex), then both promote", () => {
    const state = seeded(table(FOE_EX, GENGAR[0]), "heads");
    const gengar = top(state, "p2");
    const foe = top(state, "p1");
    const { state: after, events } = mustApply(state, attack(CRUSH));
    expect(of(events, "ABILITY_TRIGGERED")).toEqual([{ type: "ABILITY_TRIGGERED", seat: "p2", uid: gengar, ability: "Fainting Spell" }]);
    expect(of(events, "ABILITY_COIN_FLIP")).toEqual([
      { type: "ABILITY_COIN_FLIP", seat: "p2", uid: gengar, ability: "Fainting Spell", result: "heads" },
    ]);
    expect(of(events, "KNOCKED_OUT").map((e) => e.uid)).toEqual([gengar, foe]);
    expect(after.phase).toMatchObject({ kind: "ko:takePrizes", seat: "p1", count: 2 });
    expect(after.pending.slice(0, 4)).toEqual([
      { kind: "takePrizes", seat: "p1", count: 2 },
      { kind: "takePrizes", seat: "p2", count: 2 },
      { kind: "promote", seat: "p2" },
      { kind: "promote", seat: "p1" },
    ]);
    const done = drain({ state: after, events: [] }).state;
    expect(done.players.p1.prizes).toHaveLength(4);
    expect(done.players.p2.prizes).toHaveLength(4);
  });

  it("the Attacking Pokémon is a Mega Evolution Pokémon ex: the Gengar ex's owner takes 3", () => {
    const after = mustApply(seeded(table(MEGA_FOE, GENGAR[1]), "heads"), attack(CRUSH)).state;
    expect(after.pending[1]).toEqual({ kind: "takePrizes", seat: "p2", count: 3 });
  });

  it("tails: the attacker stands", () => {
    const state = seeded(table(FOE, GENGAR[0]), "tails");
    const { events } = mustApply(state, attack(CRUSH));
    expect(of(events, "ABILITY_COIN_FLIP").map((e) => e.result)).toEqual(["tails"]);
    expect(of(events, "KNOCKED_OUT").map((e) => e.uid)).toEqual([top(state, "p2")]);
  });

  it("a BENCHED Gengar ex KO'd by the spread flips too (Active or Bench, as printed)", () => {
    const state = seeded(hurt(table(FOE, FILLER, [GENGAR[0]]), "p2", 0, 100), "heads");
    const { events } = mustApply(state, attack(WIDE));
    expect(of(events, "ABILITY_COIN_FLIP")).toHaveLength(1);
    expect(of(events, "KNOCKED_OUT").map((e) => e.uid)).toContain(top(state, "p1"));
  });

  it("a Knock Out, not damage: a full-HP attacker wearing Survival Brace is Knocked Out anyway", () => {
    const state = seeded(attachToolFromDeck(table(FOE, GENGAR[0]), "p1", "active", BRACE), "heads");
    const { events } = mustApply(state, attack(CRUSH));
    expect(of(events, "KNOCKED_OUT").map((e) => e.uid)).toContain(top(state, "p1"));
  });

  it("Luminous Wing on the attacker refuses it: ABILITY_EFFECT_PREVENTED, the Mega Clefable ex stands", () => {
    const state = seeded(table(CLEFABLE, GENGAR[0]), "heads");
    const clefable = top(state, "p1");
    const { events } = mustApply(state, attack(CRUSH));
    expect(of(events, "ABILITY_COIN_FLIP").map((e) => e.result)).toEqual(["heads"]);
    expect(of(events, "ABILITY_EFFECT_PREVENTED")).toEqual([{ type: "ABILITY_EFFECT_PREVENTED", seat: "p1", uid: clefable }]);
    expect(of(events, "KNOCKED_OUT").map((e) => e.uid)).toEqual([top(state, "p2")]);
  });

  it("§9: Flutter Mane's lock on the Active Gengar ex — no coin", () => {
    const { events } = mustApply(seeded(table(FLUTTER, GENGAR[0]), "heads"), attack(CRUSH));
    expect(of(events, "ABILITY_COIN_FLIP")).toEqual([]);
  });

  it("a `knockOutDefender` doom is not damage, and a Checkup Knock Out is no attack: no coin", () => {
    expect(of(mustApply(seeded(table(FOE, GENGAR[0]), "heads"), attack(DOOMED)).events, "ABILITY_COIN_FLIP")).toEqual([]);
    let state = setConditions(hurt(seeded(table(FOE, GENGAR[0]), "heads"), "p2", "active", 270), "p2", { poisonDamage: 10 });
    state = mustApply(state, { type: "endTurn", seat: "p1" }).state;
    expect(state.players.p1.active).not.toBeNull();
    expect(state.phase).toMatchObject({ kind: "ko:takePrizes", seat: "p1" });
  });

  it("not Knocked Out: no coin", () => {
    expect(of(mustApply(seeded(table(FOE, GENGAR[0]), "heads"), attack(TAP_ATTACK)).events, "ABILITY_COIN_FLIP")).toEqual([]);
  });
});

describe("D626 §6 — Adversity Policy: a holder Weak to the opponent's Active, damaged in the Active Spot, draws 3", () => {
  const policy = (attacker: string, defender = WEAK_L) =>
    attachToolFromDeck(table(attacker, defender), "p2", "active", POLICY);

  // The attack ends P1's turn, so P2's hand also gains the turn's draw: +1 on every board here.
  it("Weak to {L}, damaged by a {L} attacker: P2 draws 3", () => {
    const state = policy(SPARK);
    const hand = state.players.p2.hand.length;
    expect(mustApply(state, attack(TAP_ATTACK)).state.players.p2.hand).toHaveLength(hand + 3 + 1);
  });

  it("a {C} attacker: no Weakness to its type, no draw", () => {
    const state = policy(FOE);
    const hand = state.players.p2.hand.length;
    expect(mustApply(state, attack(TAP_ATTACK)).state.players.p2.hand).toHaveLength(hand + 1);
  });

  it("R-AP1: a dual-type {W}{L} attacker matches on either type", () => {
    const state = policy(DUAL);
    const hand = state.players.p2.hand.length;
    expect(mustApply(state, attack(TAP_ATTACK)).state.players.p2.hand).toHaveLength(hand + 3 + 1);
  });

  it("even if Knocked Out: the draw lands before the Knock Out", () => {
    const state = hurt(policy(SPARK), "p2", "active", 390);
    const hand = state.players.p2.hand.length;
    const { state: after, events } = mustApply(state, attack(TAP_ATTACK));
    expect(of(events, "KNOCKED_OUT")).toHaveLength(1);
    expect(after.players.p2.hand).toHaveLength(hand + 3);
  });

  it("on a BENCHED holder damaged by the spread: not in the Active Spot, no draw", () => {
    let state = table(SPARK, FILLER, [WEAK_L]);
    state = attachToolFromDeck(state, "p2", 0, POLICY);
    const hand = state.players.p2.hand.length;
    expect(mustApply(state, attack(WIDE)).state.players.p2.hand).toHaveLength(hand + 1);
  });

  it("the condition, by clause: the EFFECTIVE Weakness (retype, the no-Weakness bar), either Spot empty is false", () => {
    const cond = { kind: "yourActiveWeakToOpponentActiveType" } as const;
    const spark = table(SPARK, WEAK_L);
    expect(conditionHolds(spark, "p2", cond)).toBe(true);
    expect(conditionHolds(spark, "p1", cond)).toBe(false);
    expect(conditionHolds(table(FOE, WEAK_L), "p2", cond)).toBe(false);
    // D552 — a retype onto {C} makes the printed ×2 name {C}: the {C} attacker now matches, the {L} one does not.
    const retyped = (s: GameState) => edit(s, "p2", "active", (b) => ({ ...b, weaknessRetype: { type: "Colorless", turn: s.turn } }));
    expect(conditionHolds(retyped(table(FOE, WEAK_L)), "p2", cond)).toBe(true);
    expect(conditionHolds(retyped(spark), "p2", cond)).toBe(false);
    // D432 — an installed "no Weakness" bar answers false.
    expect(conditionHolds(edit(spark, "p2", "active", (b) => ({ ...b, noWeaknessTurn: spark.turn })), "p2", cond)).toBe(false);
    const empty = { ...spark, players: { ...spark.players, p1: { ...spark.players.p1, active: null } } };
    expect(conditionHolds(empty, "p2", cond)).toBe(false);
  });
});

describe("D626 §7 — the version", () => {
  it("is built at engine 0.534.0", () => {
    expect(engineVersion).toBe("0.534.0");
  });
});
