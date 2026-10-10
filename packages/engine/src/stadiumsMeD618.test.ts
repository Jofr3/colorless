import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { stadiumLicensesSameTurnEvolve } from "./continuous";
import type { EffectOp } from "./effects";
import type { GameEvent } from "./events";
import { applyAction, createGame, engineVersion } from "./index";
import type { GameAction, GameState, PokemonRef, Seat } from "./index";
import { runProgram } from "./interpreter";
import { redactGame } from "./redact";
import { programFor } from "./registry";
import {
  FIXTURE_POOL,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  expectErr,
  mustApply,
  setActiveFromDeck,
  setBenchDamage,
  setDamage,
  specialEnergy,
  trainerCard,
  typedEnergy,
} from "./testFixtures";

// ── 🆕🆕🆕 D618 — WP25b: THE REST OF THE `me` STADIUMS D606 DROPPED ──
//
// 3 printed texts / 8 `me` printings on three new registry objects: Battle Cage ×2 (the Bench
// damage-counter shield, `StadiumEffects.benchCounterShield`; R-BCG1, R-BCG2), Mystery Garden ×3 (a
// Stadium use with a discard cost, `drawUntilHandSize.per`; R-MYG1) and Forest of Vitality ×3 (the
// Stadium evolution permission, `StadiumEffects.sameTurnEvolution`; R-FOV1). Every id and text measured
// on the LOCAL D1 (`apps/api/.wrangler/…/8437d866….sqlite`), 2026-10-09, `legal_standard = 1`. Dropped
// and named: Dizzying Valley, Fossil Quarry [🆕🆕🆕 D635 (D539): BUILT at D635 (F1)], Risky Ruins, Ange Floette. Driven on a LOCAL `cardPool`
// (D275) in the suite's OWN 60-card deck (D270).

const CAGE_TEXT =
  "Prevent all damage counters from being placed on Benched Pokémon (both yours and your opponent's) by effects of attacks and Abilities from the opponent's Pokémon. (Damage from attacks is still taken.)";
const GARDEN_TEXT =
  "Once during each player's turn, that player may discard an Energy card from their hand in order to draw cards until they have as many cards in their hand as they have {P} Pokémon in play.";
const FOREST_TEXT =
  "Each player's {G} Pokémon can evolve into {G} Pokémon during the turn they play those Pokémon, except during their first turn.";

const CAGE = ["me02-085", "me02-116"] as const;
const GARDEN = ["me01-122", "me01-172", "me02.5-194"] as const;
const FOREST = ["me01-117", "me02.5-188", "me03-109"] as const;

/** [name, the keyed printings, the printed text]. */
const TEXTS: readonly (readonly [string, readonly string[], string])[] = [
  ["Battle Cage", CAGE, CAGE_TEXT],
  ["Mystery Garden", GARDEN, GARDEN_TEXT],
  ["Forest of Vitality", FOREST, FOREST_TEXT],
];

const FILLER = "d618-filler";
const PSY = "d618-psychic";
const ITEM = "d618-item";
const SNIPER = "d618-sniper";
const FOLDER = "d618-folder";
const FILL_UP = "d618-fill-up";
const MOVER = "d618-mover";
const SHUFFLER = "d618-shuffler";
const SPREADER = "d618-spreader";
const DUSKNOIR = "sv06.5-020"; // "Cursed Blast" — 13 counters on 1 of the opponent's Pokémon
const MUNKIDORI = "sv06-095"; // "Adrena-Brain" — move up to 3 counters onto 1 of the opponent's Pokémon
const DUGTRIO = "me02.5-101"; // "Holes" — 2 counters on the opponent's Active that moved to the Bench
const FROSLASS = "sv06-053"; // "Freezing Shroud" — 1 counter on each Pokémon with an Ability, both sides
const MARACTUS = "sv09-008"; // "Exploding Needles" — 6 counters on the Attacking Pokémon on a Knock Out
const SWITCHER = "d618-switcher";
const G_BASIC = "d618-g-basic";
const G_STAGE1 = "d618-g-stage1";
const G_STAGE2 = "d618-g-stage2";
const C_STAGE1 = "d618-c-stage1";
const C_BASIC = "d618-c-basic";
const G_ON_C = "d618-g-on-c";
const D_ENERGY = "d618-darkness";
const P_ENERGY = "d618-psychic-energy";
const SPECIAL = "d618-special";

const SNIPE_TEXT = "Put 3 damage counters on 1 of your opponent's Benched Pokémon.";
const FOLD_TEXT = "Put 2 damage counters on each of your opponent's Pokémon.";
const FILL_TEXT = "Put damage counters on each of your opponent's Benched Pokémon until its remaining HP is 50.";
const MOVE_TEXT = "Move all damage counters from 1 of your Benched Pokémon to 1 of your opponent's Pokémon.";
const SHUFFLE_TEXT =
  "You may move any number of damage counters from your opponent's Pokémon to their other Pokémon in any way you like.";
const SWITCH_TEXT = "Switch this Pokémon with 1 of your Benched Pokémon.";
const SPREAD_TEXT =
  "This attack also does 10 damage to each of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";

const stadiumCard = (id: string, name: string, effect: string): Card => ({
  ...trainerCard(id, "Stadium", effect),
  name,
});
const attacker = (id: string, name: string, effect: string, damage = ""): Card =>
  battler(id, { name, hp: 300, types: ["Colorless"], attacks: [{ name, cost: ["Colorless"], damage, effect }] } as Partial<Card>);
const ability = (id: string, card: string, name: string, effect: string, over: Partial<Card>): Card =>
  battler(id, { name: card, abilities: [{ type: "Ability", name, effect }], ...over } as Partial<Card>);

const LOCAL_CARDS: Record<string, Card> = {
  [CAGE[0]]: stadiumCard(CAGE[0], "Battle Cage", CAGE_TEXT),
  [GARDEN[0]]: stadiumCard(GARDEN[0], "Mystery Garden", GARDEN_TEXT),
  [FOREST[0]]: stadiumCard(FOREST[0], "Forest of Vitality", FOREST_TEXT),
  [FILLER]: battler(FILLER, { name: "D618 Filler", hp: 300, types: ["Colorless"] }),
  [PSY]: battler(PSY, { name: "D618 Psychic", hp: 300, types: ["Psychic"] }),
  [ITEM]: { ...trainerCard(ITEM, "Item", "A test Item."), name: "D618 Item" },
  [SNIPER]: attacker(SNIPER, "D618 Snipe", SNIPE_TEXT),
  [FOLDER]: attacker(FOLDER, "D618 Fold", FOLD_TEXT),
  [FILL_UP]: attacker(FILL_UP, "D618 Fill", FILL_TEXT),
  [MOVER]: attacker(MOVER, "D618 Move", MOVE_TEXT),
  [SHUFFLER]: attacker(SHUFFLER, "D618 Shuffle", SHUFFLE_TEXT),
  [SPREADER]: attacker(SPREADER, "D618 Spread", SPREAD_TEXT, "10"),
  [SWITCHER]: attacker(SWITCHER, "D618 Switch", SWITCH_TEXT, "120"),
  [DUSKNOIR]: ability(DUSKNOIR, "Dusknoir", "Cursed Blast", "Once during your turn, you may put 13 damage counters on 1 of your opponent's Pokémon. If you use this Ability, this Pokémon is Knocked Out.", { stage: "Stage2", hp: 160, types: ["Psychic"], retreat: 3 }),
  [MUNKIDORI]: ability(MUNKIDORI, "Munkidori", "Adrena-Brain", "Once during your turn, if this Pokémon has any {D} Energy attached, you may move up to 3 damage counters from 1 of your Pokémon to 1 of your opponent's Pokémon.", { hp: 110, types: ["Psychic"] }),
  [DUGTRIO]: ability(DUGTRIO, "Team Rocket's Dugtrio", "Holes", "Whenever your opponent's Active Pokémon moves to the Bench during their turn, place 2 damage counters on that Pokémon.", { stage: "Stage1", hp: 100, types: ["Fighting"] }),
  [MARACTUS]: ability(MARACTUS, "Maractus", "Exploding Needles", "If this Pokémon is in the Active Spot and is Knocked Out by damage from an attack from your opponent's Pokémon, put 6 damage counters on the Attacking Pokémon.", { hp: 110, types: ["Grass"], retreat: 2 }),
  [FROSLASS]: ability(FROSLASS, "Froslass", "Freezing Shroud", "During Pokémon Checkup, put 1 damage counter on each Pokémon that has an Ability (both yours and your opponent's), except any Froslass.", { stage: "Stage1", hp: 90, types: ["Water"] }),
  [G_BASIC]: battler(G_BASIC, { name: "D618 Sprout", hp: 70, types: ["Grass"] }),
  [G_STAGE1]: battler(G_STAGE1, { name: "D618 Shrub", stage: "Stage1", evolveFrom: "D618 Sprout", hp: 100, types: ["Grass"] }),
  [G_STAGE2]: battler(G_STAGE2, { name: "D618 Tree", stage: "Stage2", evolveFrom: "D618 Shrub", hp: 150, types: ["Grass"] }),
  [C_STAGE1]: battler(C_STAGE1, { name: "D618 Stump", stage: "Stage1", evolveFrom: "D618 Sprout", hp: 100, types: ["Colorless"] }),
  [C_BASIC]: battler(C_BASIC, { name: "D618 Pebble", hp: 70, types: ["Colorless"] }),
  [G_ON_C]: battler(G_ON_C, { name: "D618 Moss", stage: "Stage1", evolveFrom: "D618 Pebble", hp: 100, types: ["Grass"] }),
  [D_ENERGY]: typedEnergy(D_ENERGY, "Darkness"),
  [P_ENERGY]: typedEnergy(P_ENERGY, "Psychic"),
  [SPECIAL]: specialEnergy(SPECIAL, "D618 Special Energy"),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

/** Its OWN deck (D270), 60 by construction. */
const DECK = deckOf({
  [CAGE[0]]: 1,
  [GARDEN[0]]: 1,
  [FOREST[0]]: 1,
  [FILLER]: 8,
  [PSY]: 5,
  [ITEM]: 4,
  [SNIPER]: 1,
  [FOLDER]: 1,
  [FILL_UP]: 1,
  [MOVER]: 1,
  [SHUFFLER]: 1,
  [SPREADER]: 1,
  [SWITCHER]: 1,
  [DUSKNOIR]: 1,
  [MUNKIDORI]: 1,
  [DUGTRIO]: 1,
  [FROSLASS]: 1,
  [MARACTUS]: 1,
  [G_BASIC]: 3,
  [G_STAGE1]: 2,
  [G_STAGE2]: 1,
  [C_STAGE1]: 1,
  [C_BASIC]: 1,
  [G_ON_C]: 1,
  [D_ENERGY]: 2,
  [P_ENERGY]: 3,
  [SPECIAL]: 2,
  "fix-energy": 12,
});

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

/** Setup with p2 going first; returns p1's turn 2 (p1's FIRST turn) after p2 passed. */
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

/** TEST SURGERY — `id` back into `seat`'s DECK if it sits in the hand or the Prizes. */
function ensureInDeck(state: GameState, seat: Seat, id: string): GameState {
  const side = state.players[seat];
  if (side.deck.some((u) => state.cardIdByUid[u] === id)) return state;
  const held = side.hand.find((u) => state.cardIdByUid[u] === id);
  if (held !== undefined) {
    const next = { ...side, hand: side.hand.filter((u) => u !== held), deck: [...side.deck, held] };
    return { ...state, players: { ...state.players, [seat]: next } };
  }
  const prized = side.prizes.find((u) => state.cardIdByUid[u] === id);
  const swap = side.deck.find((u) => state.cardIdByUid[u] === "fix-energy");
  if (prized === undefined || swap === undefined) throw new Error(`${seat} has no ${id} to seat`);
  const next = {
    ...side,
    prizes: side.prizes.map((u) => (u === prized ? swap : u)),
    deck: [...side.deck.filter((u) => u !== swap), prized],
  };
  return { ...state, players: { ...state.players, [seat]: next } };
}

/** TEST SURGERY — `seat`'s hand becomes EXACTLY one card per entry of `ids`. */
function setHand(state: GameState, seat: Seat, ids: readonly string[]): GameState {
  let next = state;
  for (const id of ids) next = ensureInDeck(next, seat, id);
  const side = next.players[seat];
  let deck = [...side.deck, ...side.hand];
  const hand: string[] = [];
  for (const id of ids) {
    const uid = deck.find((u) => next.cardIdByUid[u] === id);
    if (uid === undefined) throw new Error(`${seat} has no more ${id}`);
    deck = deck.filter((u) => u !== uid);
    hand.push(uid);
  }
  return { ...next, players: { ...next.players, [seat]: { ...side, hand, deck } } };
}

/** `[active, ...bench]` per seat, on p1's turn 2 (both hands emptied into the decks). */
function table(p1: readonly string[], p2: readonly string[] = [FILLER], seed = 6181): GameState {
  let state = opened(seed);
  for (const [seat, ids] of [
    ["p1", p1],
    ["p2", p2],
  ] as const) {
    state = setHand(state, seat, []);
    state = setActiveFromDeck(ensureInDeck(state, seat, ids[0] as string), seat, ids[0] as string);
    state = clearBench(state, seat);
    for (const id of ids.slice(1)) state = benchFromDeck(ensureInDeck(state, seat, id), seat, id);
  }
  return state;
}

/** TEST SURGERY — `id` into the shared Stadium zone, owned by `owner`. */
function stadium(state: GameState, id: string, owner: Seat = "p1"): GameState {
  const ensured = ensureInDeck(state, owner, id);
  const side = ensured.players[owner];
  const uid = side.deck.find((u) => ensured.cardIdByUid[u] === id) as string;
  return {
    ...ensured,
    stadium: { uid, owner },
    players: { ...ensured.players, [owner]: { ...side, deck: side.deck.filter((u) => u !== uid) } },
  };
}

const caged = (state: GameState) => stadium(state, CAGE[0], "p2");
const of = <T extends GameEvent["type"]>(events: readonly GameEvent[], type: T) =>
  events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
const idOf = (state: GameState, uid: string | undefined) => (uid === undefined ? undefined : state.cardIdByUid[uid]);
const damages = (state: GameState, seat: Seat) => [
  state.players[seat].active?.damage ?? -1,
  ...state.players[seat].bench.map((b) => b.damage),
];
function prompt(state: GameState) {
  if (state.phase.kind !== "effect:choose") throw new Error(`expected effect:choose, got ${state.phase.kind}`);
  return state.phase.prompt;
}
const pick = (ref: PokemonRef, take?: number): GameAction => ({
  type: "resolveEffect",
  seat: "p1",
  choice: take === undefined ? { kind: "pokemon", ref } : { kind: "pokemon", ref, take },
});
const multi = (ref: PokemonRef): GameAction => ({
  type: "resolveEffect",
  seat: "p1",
  choice: { kind: "pokemonMulti", refs: [ref] },
});
const benchRef = (seat: Seat, index: number): PokemonRef => ({ seat, spot: { spot: "bench", index } });
const activeRef = (seat: Seat): PokemonRef => ({ seat, spot: { spot: "active" } });
/** p1's Active attacks with its one attack, one Colorless Energy attached. */
const swing = (state: GameState) =>
  mustApply(attachFromDeck(state, "p1", "fix-energy", 1), { type: "attack", seat: "p1", index: 0 });
const useAbility = (state: GameState, target: { spot: "active" } | { spot: "bench"; index: number }, abilityName: string) =>
  mustApply(state, { type: "useAbility", seat: "p1", target, abilityName });

describe("D618 §1 — the programs: three objects over 8 printings", () => {
  it("every printing of a text is on ONE object, three objects in all", () => {
    expect(TEXTS.flatMap(([, ids]) => ids)).toHaveLength(8);
    for (const [name, ids] of TEXTS)
      for (const id of ids) {
        expect(programFor(id), `${name} ${id}`).toBe(programFor(ids[0] as string));
        expect(Object.keys(programFor(id) ?? {}), id).toEqual(["stadium"]);
      }
    expect(new Set(TEXTS.map(([, ids]) => programFor(ids[0] as string))).size).toBe(3);
  });

  it("Battle Cage and Forest of Vitality are continuous fields; Mystery Garden is Revavroom's program with a {P} count", () => {
    expect(programFor(CAGE[0])?.stadium).toEqual({ benchCounterShield: true });
    expect(programFor(FOREST[0])?.stadium).toEqual({ sameTurnEvolution: { type: "Grass" } });
    expect(programFor(GARDEN[0])?.stadium).toEqual({
      ability: {
        label: "Mystery Garden",
        program: [
          { op: "payFromHand", to: "discard", count: 1, filter: { kind: "anyEnergy" } },
          {
            op: "drawUntilHandSize",
            size: 1,
            per: { kind: "pokemonInPlay", seat: "you", filter: { kind: "typedPokemon", pokemonType: "Psychic" } },
          },
        ],
      },
    });
    expect(programFor("sv01-142")?.abilities?.[0]?.program?.[0]).toEqual(
      programFor(GARDEN[0])?.stadium?.ability?.program[0],
    );
  });

  it("the dropped Stadiums stay unkeyed (🆕🆕🆕 D635 (D539): but Fossil Quarry, keyed since D635)", () => {
    // 🆕🆕🆕 D635 (D539) — Fossil Quarry `me05-076` left this list (`fossilQuarryD635.test.ts`).
    for (const id of ["me02-088", "me01-127", "me04-075"]) expect(programFor(id), id).toBeUndefined();
  });
});

describe("D618 §2 — Battle Cage on an attack: no counters land on a Benched Pokémon", () => {
  it("the put-counter snipe: the Benched pick takes 0 under the Cage, 30 without it (R-BCG2: still offered)", () => {
    const board = table([SNIPER], [FILLER, FILLER]);
    expect(damages(swing(caged(board)).state, "p2")).toEqual([0, 0]);
    expect(of(swing(caged(board)).events, "COUNTERS_PLACED")).toEqual([]);
    expect(damages(swing(board).state, "p2")).toEqual([0, 30]);
  });

  it("each of the opponent's Pokémon: the Active takes 20, the Bench 0", () => {
    const board = table([FOLDER], [FILLER, FILLER, PSY]);
    expect(damages(swing(caged(board)).state, "p2")).toEqual([20, 0, 0]);
    expect(damages(swing(board).state, "p2")).toEqual([20, 20, 20]);
  });

  it("until its remaining HP is 50: nothing on the Bench under the Cage", () => {
    const board = table([FILL_UP], [FILLER, FILLER]);
    expect(damages(swing(caged(board)).state, "p2")).toEqual([0, 0]);
    expect(damages(swing(board).state, "p2")).toEqual([0, 250]);
  });

  it("R-BCG1 — a MOVE onto a Benched body is refused whole: the source keeps its counters, no HEALED row", () => {
    let board = setBenchDamage(table([MOVER, FILLER], [FILLER, FILLER]), "p1", 0, 40);
    board = caged(board);
    const { state: parked } = swing(board);
    expect(prompt(parked).kind).toBe("choosePokemon");
    const { state, events } = mustApply(parked, pick(benchRef("p2", 0)));
    expect(damages(state, "p1")).toEqual([0, 40]);
    expect(damages(state, "p2")).toEqual([0, 0]);
    expect(of(events, "HEALED")).toEqual([]);
    const onto = mustApply(parked, pick(activeRef("p2"))).state;
    expect([damages(onto, "p1"), damages(onto, "p2")]).toEqual([
      [0, 0],
      [40, 0],
    ]);
  });

  it("attack DAMAGE to the Bench is still taken (the printed parenthesis)", () => {
    const board = table([SPREADER], [FILLER, FILLER]);
    expect(damages(swing(caged(board)).state, "p2")).toEqual([10, 10]);
  });

  it("the opponent-to-opponent move offers no Benched destination under the Cage", () => {
    const board = setDamage(table([SHUFFLER], [FILLER, FILLER, FILLER]), "p2", 30);
    const { state: parked } = swing(caged(board));
    // the source pick: the damaged Active, which has no destination left — so nothing is offered at all
    expect(parked.phase.kind).not.toBe("effect:choose");
    expect(damages(parked, "p2")).toEqual([30, 0, 0]);
    const { state: open } = swing(board);
    expect(prompt(open).kind).toBe("choosePokemon");
  });

  it("a Benched body damaged on the Bench may still move ONTO the Active", () => {
    const board = setBenchDamage(table([SHUFFLER], [FILLER, FILLER]), "p2", 0, 20);
    const { state: q1 } = swing(caged(board));
    const { state: q2 } = mustApply(q1, pick(benchRef("p2", 0), 2));
    // the lone destination (the Active) is forced
    expect(damages(q2, "p2")).toEqual([20, 0]);
  });
});

describe("D618 §3 — Battle Cage on an Ability", () => {
  it("Cursed Blast on a Benched body places nothing; Dusknoir is still Knocked Out", () => {
    const board = caged(table([FILLER, DUSKNOIR], [FILLER, FILLER]));
    const { state: parked } = useAbility(board, { spot: "bench", index: 0 }, "Cursed Blast");
    const { state, events } = mustApply(parked, multi(benchRef("p2", 0)));
    expect(damages(state, "p2")).toEqual([0, 0]);
    expect(of(events, "KNOCKED_OUT").map((e) => idOf(state, e.uid))).toEqual([DUSKNOIR]);
  });

  it("Cursed Blast on the Active still lands", () => {
    const board = caged(table([FILLER, DUSKNOIR], [FILLER, FILLER]));
    const { state: parked } = useAbility(board, { spot: "bench", index: 0 }, "Cursed Blast");
    expect(damages(mustApply(parked, multi(activeRef("p2"))).state, "p2")).toEqual([130, 0]);
  });

  it("R-BCG1 — Adrena-Brain onto a Benched body moves nothing; onto the Active it moves", () => {
    let board = caged(table([MUNKIDORI], [FILLER, FILLER]));
    board = setDamage(attachFromDeck(board, "p1", D_ENERGY, 1), "p1", 30);
    const { state: parked } = useAbility(board, { spot: "active" }, "Adrena-Brain");
    const refused = mustApply(parked, pick(benchRef("p2", 0), 3));
    expect([damages(refused.state, "p1"), damages(refused.state, "p2")]).toEqual([[30], [0, 0]]);
    expect(of(refused.events, "HEALED")).toEqual([]);
    const moved = mustApply(parked, pick(activeRef("p2"), 3)).state;
    expect([damages(moved, "p1"), damages(moved, "p2")]).toEqual([[0], [30, 0]]);
  });

  it("Holes places nothing on the Active that retreated to the Bench; without the Cage it places 2", () => {
    const retreat = (state: GameState) => {
      const paid = attachFromDeck(state, "p1", "fix-energy", 1);
      const energy = [...(paid.players.p1.active?.energy ?? [])];
      return mustApply(paid, { type: "retreat", seat: "p1", discardEnergy: energy, promoteBenchIndex: 0 });
    };
    const board = table([FILLER, FILLER], [FILLER, DUGTRIO]);
    expect(damages(retreat(caged(board)).state, "p1")).toEqual([0, 0]);
    expect(damages(retreat(board).state, "p1")).toEqual([0, 20]);
  });

  it("Freezing Shroud: the opponent's Benched Ability bodies take nothing, the Active and its OWNER's Bench still do", () => {
    const board = caged(table([DUGTRIO, MUNKIDORI], [FILLER, FROSLASS, DUSKNOIR]));
    const { state } = mustApply(board, { type: "endTurn", seat: "p1" });
    expect(damages(state, "p1")).toEqual([10, 0]);
    expect(damages(state, "p2")).toEqual([0, 0, 10]);
  });

  it("Exploding Needles on an attacker that self-switched to the Bench places nothing; on an Active attacker it lands", () => {
    const board = setDamage(table([SWITCHER, FILLER], [MARACTUS, FILLER]), "p2", 100);
    const knocked = (state: GameState) => {
      const result = swing(state);
      expect(of(result.events, "KNOCKED_OUT").map((e) => idOf(result.state, e.uid))).toEqual([MARACTUS]);
      return result;
    };
    const cagedRun = knocked(caged(board));
    expect(damages(cagedRun.state, "p1")).toEqual([0, 0]);
    expect(of(cagedRun.events, "COUNTERS_PLACED")).toEqual([]);
    expect(damages(knocked(board).state, "p1")).toEqual([0, 60]);
    // a lone attacker cannot switch, stays Active, and takes the 6 counters under the Cage
    const lone = setDamage(table([SWITCHER], [MARACTUS, FILLER]), "p2", 100);
    expect(damages(knocked(caged(lone)).state, "p1")).toEqual([60]);
  });
});

describe("D618 §4 — what Battle Cage does not stop: a Trainer, a source with no invoker, and a player's own effects", () => {
  const FOLD: EffectOp[] = [{ op: "counterEachAll", amount: 20, filter: { kind: "anyPokemon" }, side: "opponent", source: "attack" }];
  const run = (state: GameState, ctx: Parameters<typeof runProgram>[2]) => {
    const result = runProgram(state, FOLD, ctx, []);
    if (result.kind !== "done") throw new Error("expected done");
    return damages(result.state, "p2");
  };

  it("an Item's or a Stadium's (no `invokedBy`) counters land on the Bench; an attack's and an Ability's do not", () => {
    const board = caged(table([FILLER], [FILLER, FILLER]));
    expect(run(board, { seat: "p1", invokedBy: "item" })).toEqual([20, 20]);
    expect(run(board, { seat: "p1" })).toEqual([20, 20]);
    expect(run(board, { seat: "p1", invokedBy: "attack" })).toEqual([20, 0]);
    expect(run(board, { seat: "p1", invokedBy: "ability" })).toEqual([20, 0]);
  });

  it("\"from the opponent's Pokémon\": a program run by the Bench's OWN seat still places", () => {
    const board = caged(table([FILLER], [FILLER, FILLER]));
    const result = runProgram(board, FOLD, { seat: "p2", invokedBy: "attack" }, []);
    if (result.kind !== "done") throw new Error("expected done");
    expect(damages(result.state, "p1")).toEqual([20]);
    const own = runProgram(
      board,
      [{ op: "counterEachAll", amount: 20, filter: { kind: "anyPokemon" }, side: "both", source: "attack" }],
      { seat: "p2", invokedBy: "attack" },
      [],
    );
    if (own.kind !== "done") throw new Error("expected done");
    expect(damages(own.state, "p2")).toEqual([20, 20]);
    expect(damages(own.state, "p1")).toEqual([20]);
  });
});

describe("D618 §5 — Mystery Garden: discard an Energy card, draw until the hand holds your {P} count", () => {
  const garden = (state: GameState) => stadium(state, GARDEN[0]);
  const use = (state: GameState) => mustApply(state, { type: "useStadiumAbility", seat: "p1" });
  const offer = (state: GameState) => {
    const phase = redactGame(state, "p1").phase;
    if (phase.kind !== "turn:action") throw new Error(`expected turn:action, got ${phase.kind}`);
    return phase.stadiumAbility;
  };

  it("three {P} in play, a hand of an Energy and an Item: the lone Energy is paid, two are drawn", () => {
    const board = setHand(garden(table([PSY, PSY, FILLER, PSY], [PSY])), "p1", [P_ENERGY, ITEM]);
    const [energy, item] = board.players.p1.hand as [string, string];
    const top = board.players.p1.deck.slice(0, 2);
    const { state, events } = use(board);
    expect(of(events, "HAND_COST_PAID")).toEqual([{ type: "HAND_COST_PAID", seat: "p1", uids: [energy], to: "discard" }]);
    expect(state.players.p1.hand).toEqual([item, ...top]);
    expect(state.allowances.stadiumAbilityUsed).toBe(true);
    expectErr(state, { type: "useStadiumAbility", seat: "p1" }, "STADIUM_ABILITY_ALREADY_USED");
  });

  it("a Special Energy is an Energy card; two different Energy park the pick, and the parked use round-trips JSON", () => {
    const board = setHand(garden(table([PSY, PSY, PSY, PSY], [FILLER])), "p1", [SPECIAL, P_ENERGY]);
    const { state: parked } = use(board);
    const p = prompt(parked);
    if (p.kind !== "chooseCards") throw new Error(`expected chooseCards, got ${p.kind}`);
    expect(p).toMatchObject({ min: 1, max: 1 });
    const special = board.players.p1.hand[0] as string;
    const answer: GameAction = { type: "resolveEffect", seat: "p1", choice: { kind: "cards", uids: [special] } };
    const revived = JSON.parse(JSON.stringify(parked)) as GameState;
    const { state } = mustApply(revived, answer);
    expect(state).toEqual(mustApply(parked, answer).state);
    expect(state.players.p1.discard.at(-1)).toBe(special);
    expect(state.players.p1.hand).toHaveLength(4);
  });

  it("only YOUR {P} count, by in-play type: the opponent's {P} Pokémon and your non-{P} are not counted", () => {
    const board = setHand(garden(table([FILLER, PSY, FILLER], [PSY, PSY, PSY, PSY])), "p1", [P_ENERGY]);
    const { state } = use(board);
    expect(state.players.p1.hand).toHaveLength(1);
  });

  it("R-MYG1 — the hand already holds as many: the Energy is still discarded and nothing is drawn", () => {
    const board = setHand(garden(table([PSY], [FILLER])), "p1", [P_ENERGY, ITEM, ITEM]);
    const { state, events } = use(board);
    expect(of(events, "HAND_COST_PAID")).toHaveLength(1);
    expect(state.players.p1.hand).toHaveLength(2);
    expect(of(events, "CARDS_DRAWN")).toEqual([]);
  });

  it("no Energy card in hand is REFUSED on the engine and greyed on the wire; the use is not spent", () => {
    const short = setHand(garden(table([PSY, PSY], [FILLER])), "p1", [ITEM]);
    const result = applyAction(short, { type: "useStadiumAbility", seat: "p1" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("PLAY_CONDITION_NOT_MET");
      expect(result.error.message).toBe("Mystery Garden can only be used if you discard an Energy card from your hand (§7.3)");
    }
    expect(offer(short)).toEqual({
      label: "Mystery Garden",
      disabled: true,
      reason: "Only if you discard an Energy card from your hand",
    });
    expect(offer(setHand(short, "p1", [P_ENERGY]))).toEqual({ label: "Mystery Garden", disabled: false, reason: null });
  });
});

describe("D618 §5b — the new `per` member off a board", () => {
  it("`describeBranch` is silent on `drawUntilHandSize.per` (a gate branch holding it gets no caption)", () => {
    const gated = (per: Extract<EffectOp, { op: "drawUntilHandSize" }>["per"]): EffectOp[] => [
      { op: "payFromHand", count: 1, to: "discard", recordAs: "paid" },
      {
        op: "recordGate",
        slot: "paid",
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect gate's step list, not a thenable.
        then: [per === undefined ? { op: "drawUntilHandSize", size: 3 } : { op: "drawUntilHandSize", size: 1, per }],
      },
    ];
    const noteOf = (program: EffectOp[]): string => {
      const state = setHand(table([PSY]), "p1", [ITEM, P_ENERGY]);
      const result = runProgram(state, program, { seat: "p1" }, []);
      if (result.kind !== "parked") throw new Error("expected a park");
      return result.prompt.note;
    };
    expect(noteOf(gated({ kind: "pokemonInPlay", seat: "you", filter: { kind: "typedPokemon", pokemonType: "Psychic" } }))).toBe(
      "Discard a card from your hand.",
    );
    expect(noteOf(gated(undefined))).toBe(
      "Discard a card from your hand. If you do, draw cards until you have 3 cards in your hand.",
    );
  });
});

describe("D618 §6 — Forest of Vitality: {G} into {G} the turn it is played, not on the first turn", () => {
  const forest = (state: GameState) => stadium(state, FOREST[0], "p2");
  /** p1's SECOND turn (turn 4), the board and hand as given. */
  function secondTurn(hand: readonly string[], withForest: boolean, active: string = FILLER): GameState {
    let state = table([active]);
    state = must(applyAction(state, { type: "endTurn", seat: "p1" }));
    state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
    state = setHand(state, "p1", hand);
    return withForest ? forest(state) : state;
  }
  const play = (state: GameState, id: string) => {
    const uid = state.players.p1.hand.find((u) => state.cardIdByUid[u] === id) as string;
    return mustApply(state, { type: "playBasicToBench", seat: "p1", uid }).state;
  };
  const evolve = (state: GameState, id: string, index = 0) => {
    const uid = state.players.p1.hand.find((u) => state.cardIdByUid[u] === id) as string;
    return applyAction(state, { type: "evolve", seat: "p1", uid, target: { spot: "bench", index } });
  };

  it("a {G} Basic played this turn evolves into a {G} Stage 1, then into a {G} Stage 2 (R-FOV1)", () => {
    const board = play(secondTurn([G_BASIC, G_STAGE1, G_STAGE2], true), G_BASIC);
    const once = must(evolve(board, G_STAGE1));
    expect(idOf(once, once.players.p1.bench[0]?.stack.at(-1))).toBe(G_STAGE1);
    const twice = must(evolve(once, G_STAGE2));
    expect(idOf(twice, twice.players.p1.bench[0]?.stack.at(-1))).toBe(G_STAGE2);
  });

  it("without the Forest the same evolve is EVOLVE_TOO_SOON", () => {
    const board = play(secondTurn([G_BASIC, G_STAGE1], false), G_BASIC);
    const result = evolve(board, G_STAGE1);
    expect(result.ok ? null : result.error.code).toBe("EVOLVE_TOO_SOON");
  });

  it("both ends must be {G}: a {G} Basic into a {C} Stage 1, and a {C} Basic into a {G} Stage 1, are refused", () => {
    const intoC = play(secondTurn([G_BASIC, C_STAGE1], true), G_BASIC);
    expect(stadiumLicensesSameTurnEvolve(intoC, intoC.players.p1.bench[0] as never, POOL[C_STAGE1] as Card)).toBe(false);
    const a = evolve(intoC, C_STAGE1);
    expect(a.ok ? null : a.error.code).toBe("EVOLVE_TOO_SOON");
    const fromC = play(secondTurn([C_BASIC, G_ON_C], true), C_BASIC);
    const b = evolve(fromC, G_ON_C);
    expect(b.ok ? null : b.error.code).toBe("EVOLVE_TOO_SOON");
  });

  it("\"except during their first turn\": the Forest does not lift the first-turn ban", () => {
    let state = forest(setHand(table([FILLER]), "p1", [G_BASIC, G_STAGE1]));
    state = play(state, G_BASIC);
    const result = evolve(state, G_STAGE1);
    expect(result.ok ? null : result.error.code).toBe("FIRST_TURN_EVOLVE");
  });

  it("\"each player's\": the opponent's {G} Basic evolves the turn it is played too", () => {
    let state = must(applyAction(table([FILLER]), { type: "endTurn", seat: "p1" }));
    state = forest(setHand(state, "p2", [G_BASIC, G_STAGE1]));
    const basic = state.players.p2.hand[0] as string;
    state = mustApply(state, { type: "playBasicToBench", seat: "p2", uid: basic }).state;
    const stage1 = state.players.p2.hand[0] as string;
    const result = applyAction(state, { type: "evolve", seat: "p2", uid: stage1, target: { spot: "bench", index: 0 } });
    expect(result.ok).toBe(true);
  });
});

describe("D618 §7 — the version", () => {
  it("is built at engine 0.523.0", () => {
    expect(engineVersion).toBe("0.523.0");
  });
});
