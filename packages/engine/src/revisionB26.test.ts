import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { conditionHolds } from "./boardCondition";
import { applyAction, createGame } from "./index";
import type { GameState } from "./index";
import {
  FIXTURE_POOL,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  completeSetup,
  deckOf,
  handFromDeck,
  handToDeck,
  handUid,
  must,
  mustApply,
  setActiveFromDeck,
  trainerCard,
} from "./testFixtures";
import { koedDuringOpponentsLastTurn, koedMarksOnOpponentsLastTurn } from "./types";

const REVENGE = (n: number) =>
  `If any of your Pokémon were Knocked Out by damage from an attack during your opponent's last turn, this attack does ${n} more damage.`;

const HOLDERS = [
  { id: "30th-091", name: "Umbreon", index: 0, attack: "Retaliate", base: 30, extra: 100 },
  {
    id: "me02.5-121",
    name: "Koraidon ex",
    index: 0,
    attack: "Orichalcum Fang",
    base: 50,
    extra: 120,
  },
  { id: "me02-066", name: "Krookodile", index: 0, attack: "Vengeful Fang", base: 60, extra: 160 },
  { id: "sv06-019", name: "Iron Leaves", index: 1, attack: "Avenging Edge", base: 100, extra: 60 },
  { id: "sv10.5w-054", name: "Terrakion", index: 0, attack: "Retaliate", base: 50, extra: 80 },
  { id: "sv10.5w-135", name: "Terrakion", index: 0, attack: "Retaliate", base: 50, extra: 80 },
  { id: "30th-005", name: "Tropius", index: 0, attack: "Rally Back", base: 30, extra: 90 },
  { id: "sv06-125", name: "Revavroom", index: 0, attack: "Rally Back", base: 30, extra: 90 },
  { id: "sv09-057", name: "Alolan Marowak", index: 0, attack: "Retaliate", base: 30, extra: 90 },
] as const;

const DUSCLOPS = "sv06.5-019";
const CURSED_BLAST =
  "Once during your turn, you may put 5 damage counters on 1 of your opponent's Pokémon. If you use this Ability, this Pokémon is Knocked Out.";
const STAMP = "sv06-165";
const STAMP_TEXT =
  "You can use this card only if any of your Pokémon were Knocked Out during your opponent's last turn.\n\nEach player shuffles their hand into their deck. Then, you draw 5 cards, and your opponent draws 2 cards.";
const FEZANDIPITI = "sv06.5-038";
const FLIP_THE_SCRIPT =
  "Once during your turn, if any of your Pokémon were Knocked Out during your opponent's last turn, you may draw 3 cards. You can't use more than 1 Flip the Script Ability each turn.";
const VICTIM = "b26-victim";
const HITTER = "b26-hitter";
const WALL = "b26-wall";

const holderFace = (h: (typeof HOLDERS)[number]): Card => {
  const revenge = {
    cost: ["Colorless"],
    name: h.attack,
    effect: REVENGE(h.extra),
    damage: `${h.base}+`,
  };
  const other = { cost: ["Colorless", "Colorless", "Colorless"], name: "B26 Other", damage: 10 };
  return battler(h.id, {
    name: h.name,
    hp: 200,
    weaknesses: [],
    resistances: [],
    attacks: h.index === 0 ? [revenge, other] : [other, revenge],
  });
};

const LOCAL: Record<string, Card> = {
  ...Object.fromEntries(HOLDERS.map((h) => [h.id, holderFace(h)])),
  [DUSCLOPS]: battler(DUSCLOPS, {
    name: "Dusclops",
    hp: 90,
    stage: "Stage1",
    evolveFrom: "Duskull",
    types: ["Psychic"],
    abilities: [{ type: "Ability", name: "Cursed Blast", effect: CURSED_BLAST }],
    attacks: [{ cost: ["Psychic", "Psychic"], name: "Will-O-Wisp", damage: 50 }],
  }),
  [FEZANDIPITI]: battler(FEZANDIPITI, {
    name: "Fezandipiti ex",
    hp: 210,
    abilities: [{ type: "Ability", name: "Flip the Script", effect: FLIP_THE_SCRIPT }],
    attacks: [{ cost: ["Darkness", "Colorless", "Colorless"], name: "Cruel Arrow", damage: 0 }],
  }),
  [STAMP]: { ...trainerCard(STAMP, "Item", STAMP_TEXT), name: "Unfair Stamp" },
  // P1's Active on turn 2 — one 30-damage hit from gone.
  [VICTIM]: battler(VICTIM, { name: "B26 Victim", hp: 30, weaknesses: [], resistances: [] }),
  // P2's turn-2 attacker: a plain 30 to the Active, nothing else.
  [HITTER]: battler(HITTER, {
    name: "B26 Hitter",
    hp: 400,
    weaknesses: [],
    resistances: [],
    attacks: [{ cost: ["Colorless"], name: "B26 Hit", damage: 30 }],
  }),
  // P2's Active on turn 3 — big enough that no bonus Knocks it Out, so its damage is the reading.
  [WALL]: battler(WALL, { name: "B26 Wall", hp: 900, weaknesses: [], resistances: [] }),
};
const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL };

/** Its own 60-card deck per holder: four copies of the holder, so one is always left in the deck. */
const deckFor = (holder: string) =>
  deckOf({
    [holder]: 4,
    [DUSCLOPS]: 3,
    [FEZANDIPITI]: 2,
    [STAMP]: 2,
    [VICTIM]: 3,
    [HITTER]: 2,
    [WALL]: 2,
    "fix-basic-1": 6,
    "fix-energy": 36,
  });

/** TEST SURGERY — bench one copy of `id` from P1's deck (hand copies are shuffled back first). */
const benchP1 = (state: GameState, id: string) =>
  benchFromDeck(handToDeck(state, "p1", id), "p1", id);

function setup(holder: string, seed = 5): GameState {
  const deck = deckFor(holder);
  const created = createGame({ seed, decks: { p1: deck, p2: deck }, cardPool: POOL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  return completeSetup(created.state, { first: "p1" });
}

/** Take every Prize owed and promote bench[0], until a seat holds a turn again. */
function settle(state: GameState): GameState {
  let next = state;
  for (let guard = 0; guard < 12; guard += 1) {
    if (next.phase.kind === "ko:takePrizes") {
      const { seat, count } = next.phase;
      next = must(
        applyAction(next, {
          type: "takePrizes",
          seat,
          prizeIndices: Array.from({ length: count }, (_, i) => i),
        }),
      );
      continue;
    }
    if (next.phase.kind === "ko:promote") {
      next = must(applyAction(next, { type: "promote", seat: next.phase.seat, benchIndex: 0 }));
      continue;
    }
    return next;
  }
  throw new Error("KO stages never settled");
}

/** Turn 2: P2's Hitter Knocks Out P1's Active Victim BY ATTACK DAMAGE; P1 promotes `holder` (bench[0])
    and it is P1's turn 3, with Dusclops (and Fezandipiti ex) on the Bench and a 900-HP Wall as P2's
    Active. `holder` carries one Energy for its {C} cost. */
function revengeBoard(holder: string, seed = 5): GameState {
  let state = must(applyAction(setup(holder, seed), { type: "endTurn", seat: "p1" })); // P2's turn 2
  state = setActiveFromDeck(state, "p2", HITTER);
  state = attachFromDeck(state, "p2", "fix-energy", 1);
  state = setActiveFromDeck(state, "p1", VICTIM);
  state = clearBench(state, "p1");
  for (const id of [holder, DUSCLOPS, FEZANDIPITI]) state = benchP1(state, id);
  state = settle(mustApply(state, { type: "attack", seat: "p2", index: 0 }).state);
  if (state.phase.kind !== "turn:action" || state.phase.seat !== "p1" || state.turn !== 3) {
    throw new Error(`expected P1's turn 3, got ${state.phase.kind} on turn ${state.turn}`);
  }
  state = attachFromDeck(state, "p1", "fix-energy", 1);
  state = setActiveFromDeck(state, "p2", WALL);
  return state;
}

/** P1 uses benched Dusclops' "Cursed Blast" on P2's Active: 5 counters there, Dusclops Knocked Out
    (its OWN seat's Pokémon, on its OWN turn, not by an attack). Settled back to P1's turn 3. */
function cursedBlast(state: GameState): GameState {
  const bench = state.players.p1.bench.findIndex(
    (p) => state.cardIdByUid[p.stack.at(-1) ?? ""] === DUSCLOPS,
  );
  if (bench < 0) throw new Error("no Dusclops on P1's Bench");
  let next = mustApply(state, {
    type: "useAbility",
    seat: "p1",
    target: { spot: "bench", index: bench },
    abilityName: "Cursed Blast",
  }).state;
  for (let guard = 0; guard < 6 && next.phase.kind === "effect:choose"; guard += 1) {
    next = mustApply(next, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [{ seat: "p2", spot: { spot: "active" } }] },
    }).state;
  }
  next = settle(next);
  if (next.players.p1.bench.some((p) => next.cardIdByUid[p.stack.at(-1) ?? ""] === DUSCLOPS)) {
    throw new Error("Cursed Blast did not Knock Out Dusclops");
  }
  if (next.phase.kind !== "turn:action" || next.phase.seat !== "p1" || next.turn !== 3) {
    throw new Error(`expected P1's turn 3 after Cursed Blast, got ${next.phase.kind}`);
  }
  return next;
}

/** The damage P1's Active attack (printed index `index`) puts on P2's Active. */
function dealt(state: GameState, index: number): number {
  const before = state.players.p2.active?.damage ?? 0;
  const after = mustApply(state, { type: "attack", seat: "p1", index }).state;
  return (after.players.p2.active?.damage ?? 0) - before;
}

const BY_ATTACK = { kind: "yourPokemonKoedOnOpponentsLastTurn", byAttack: true } as const;
const BARE = { kind: "yourPokemonKoedOnOpponentsLastTurn" } as const;

describe("B26 — a self-Knock-Out on your own turn does not erase your opponent's last turn", () => {
  it.each(HOLDERS)(
    "$name $attack ($id): +$extra after the opponent's attack Knock Out, with and without a Cursed Blast first",
    (h) => {
      const board = revengeBoard(h.id);
      // The control: the opponent's attack Knock Out alone opens the window.
      expect(dealt(board, h.index)).toBe(h.base + h.extra);
      const blasted = cursedBlast(board);
      expect(conditionHolds(blasted, "p1", BY_ATTACK)).toBe(true);
      expect(dealt(blasted, h.index)).toBe(h.base + h.extra);
    },
  );

  it("keeps the opponent's-turn stamp and mark — the own-turn Knock Out is not written over them", () => {
    const board = revengeBoard("sv06-019");
    expect(board.lastKoTurn.p1).toBe(2);
    const blasted = cursedBlast(board);
    expect(blasted.lastKoTurn.p1).toBe(2);
    expect(koedDuringOpponentsLastTurn(blasted, "p1")).toBe(true);
    expect(koedMarksOnOpponentsLastTurn(blasted, "p1").map((m) => [m.name, m.byAttack])).toEqual([
      ["B26 Victim", true],
    ]);
    // P2 lost nothing on any turn of this board.
    expect(blasted.lastKoTurn.p2).toBeNull();
  });

  it("the bare gate holds too: Unfair Stamp is playable and Flip the Script draws 3 after a Cursed Blast", () => {
    const blasted = cursedBlast(revengeBoard("sv06-019"));
    expect(conditionHolds(blasted, "p1", BARE)).toBe(true);
    // Unfair Stamp `sv06-165`.
    const withStamp = handFromDeck(handToDeck(blasted, "p1", STAMP), "p1", STAMP, 1);
    const stamped = applyAction(withStamp, {
      type: "playTrainer",
      seat: "p1",
      uid: handUid(withStamp, "p1", STAMP),
    });
    expect(stamped.ok).toBe(true);
    // Fezandipiti ex "Flip the Script" `sv06.5-038`, benched.
    const fez = blasted.players.p1.bench.findIndex(
      (p) => blasted.cardIdByUid[p.stack.at(-1) ?? ""] === FEZANDIPITI,
    );
    expect(fez).toBeGreaterThanOrEqual(0);
    const handBefore = blasted.players.p1.hand.length;
    const flipped = mustApply(blasted, {
      type: "useAbility",
      seat: "p1",
      target: { spot: "bench", index: fez },
      abilityName: "Flip the Script",
    }).state;
    expect(flipped.players.p1.hand.length).toBe(handBefore + 3);
  });

  it("a Cursed Blast on its own does not open the window on P1's NEXT turn", () => {
    // P1's turn 3: no opponent Knock Out on turn 2 this time — only P1's own Dusclops on turn 3.
    let state = must(applyAction(setup("sv06-019"), { type: "endTurn", seat: "p1" }));
    state = clearBench(state, "p1");
    for (const id of ["sv06-019", DUSCLOPS]) state = benchP1(state, id);
    state = must(applyAction(state, { type: "endTurn", seat: "p2" })); // P1's turn 3
    state = setActiveFromDeck(state, "p2", WALL);
    state = cursedBlast(state);
    expect(conditionHolds(state, "p1", BARE)).toBe(false);
    state = must(applyAction(state, { type: "endTurn", seat: "p1" })); // P2's turn 4
    state = must(applyAction(state, { type: "endTurn", seat: "p2" })); // P1's turn 5
    expect(state.turn).toBe(5);
    expect(conditionHolds(state, "p1", BARE)).toBe(false);
    expect(conditionHolds(state, "p1", BY_ATTACK)).toBe(false);
  });
});
