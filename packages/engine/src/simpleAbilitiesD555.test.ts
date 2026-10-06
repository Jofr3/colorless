import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { applyAction, createGame, handCostAction } from "./index";
import type { EffectOp, GameAction, GameEvent, GameState, PokemonRef, Seat } from "./index";
import { programFor } from "./registry";
import {
  completeSetup,
  FIXTURE_POOL,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  expectErr,
  mustApply,
  setActiveFromDeck,
  setDamage,
  trainerCard,
  typedEnergy,
  types,
} from "./testFixtures";

// ── 🆕🆕🆕 D555 B — THE ZERO-VOCABULARY ABILITIES, 11 PRINTINGS / 7 TEXTS / 7 OBJECTS ──
//
//   Volcarona               sv10.5b-016 / -100   "Torrid Scales"        discard a Basic {R}: Burn
//   Archeops                sv10.5w-051 / -132   "Ancient Wing"         Active only: devolve 1 to hand
//   Meowstic                sv08-085             "Beckoning Tail"       discard a Chill Teaser Toy: gust
//   Samurott                sv10.5w-023 / -107   "Torrential Whirlpool" switch; if you do, switch out
//   Team Rocket's Tyranitar sv10-096             "Sand Stream"          Checkup, Active: 2 counters each Basic
//   Chien-Pao               sv08-056, svp-152    "Snow Sink"            bench from hand: may discard a Stadium
//   Ambipom                 sv06-138             "Wicked Tail"          on evolve: 2 coins, random card → deck
//
// ZERO new vocabulary: four activated rows (`abilities`) and three triggered rows
// (`triggered`), every op, filter, timing and flag already shipped. Real ids on a
// LOCAL `cardPool` (D275), no `fix-*` demonstrator. ⚠️ SAID OUT LOUD (D243): every body
// keeps its PRINTED stage on the fixture and is SEATED by surgery as a one-card stack,
// except Ambipom, which is EVOLVED by a real `evolve` action (the trigger is the
// point). Texts off tcgdex, 2026-09-25.

const TORRID_TEXT =
  "You must discard a Basic {R} Energy card from your hand in order to use this Ability. Once during your turn, you may make your opponent's Active Pokémon Burned.";
const WING_TEXT =
  "Once during your turn, if this Pokémon is in the Active Spot, you may devolve 1 of your opponent's evolved Pokémon by putting the highest Stage Evolution card on it into your opponent's hand.";
const TAIL_TEXT =
  "You must discard a Chill Teaser Toy card from your hand in order to use this Ability. Once during your turn, you may switch in 1 of your opponent's Benched Pokémon to the Active Spot.";
const WHIRLPOOL_TEXT =
  "Once during your turn, you may switch your Active Pokémon with 1 of your Benched Pokémon. If you do, switch out your opponent's Active Pokémon to the Bench. (Your opponent chooses the new Active Pokémon.)";
const SAND_TEXT =
  "During Pokémon Checkup, if this Pokémon is in the Active Spot, put 2 damage counters on each of your opponent's Basic Pokémon.";
const SNOW_TEXT =
  "When you play this Pokémon from your hand onto your Bench during your turn, you may discard a Stadium in play.";
const WICKED_TEXT =
  "When you play this Pokémon from your hand to evolve 1 of your Pokémon during your turn, you may flip 2 coins. For each heads, choose a random card from your opponent's hand. Your opponent reveals those cards and shuffles them into their deck.";

const VOLCARONA = ["sv10.5b-016", "sv10.5b-100"] as const;
const ARCHEOPS = ["sv10.5w-051", "sv10.5w-132"] as const;
const MEOWSTIC = ["sv08-085"] as const;
const SAMUROTT = ["sv10.5w-023", "sv10.5w-107"] as const;
const TYRANITAR = ["sv10-096"] as const;
const CHIEN_PAO = ["sv08-056", "svp-152"] as const;
const AMBIPOM = ["sv06-138"] as const;

const FILLER = "d555b-filler";
const STAGE1 = "d555b-stage1";
const AIPOM = "d555b-aipom";
const FIRE = "d555b-fire";
const WATER = "d555b-water";
const TOY = "sv08-166"; // Chill Teaser Toy — the REAL id, its own registry program (D295)
const NEST_BALL = "sv01-181";
const BEACH_COURT = "sv01-167";

function body(
  id: string,
  name: string,
  stage: string,
  evolveFrom: string | undefined,
  ability: string,
  effect: string,
  attack: string,
): Card {
  return battler(id, {
    name,
    hp: 150,
    stage,
    ...(evolveFrom === undefined ? {} : { evolveFrom }),
    retreat: 2,
    types: ["Colorless"],
    abilities: [{ type: "Ability", name: ability, effect }],
    attacks: [{ cost: ["Colorless"], name: attack, damage: 10 }],
  });
}

function bodies(
  ids: readonly string[],
  ...rest: [string, string, string | undefined, string, string, string]
): Record<string, Card> {
  return Object.fromEntries(ids.map((id) => [id, body(id, ...rest)]));
}

const LOCAL_CARDS: Record<string, Card> = {
  ...bodies(VOLCARONA, "Volcarona", "Stage1", "Larvesta", "Torrid Scales", TORRID_TEXT, "Fire Wing"),
  ...bodies(ARCHEOPS, "Archeops", "Stage2", "Archen", "Ancient Wing", WING_TEXT, "Rock Throw"),
  ...bodies(MEOWSTIC, "Meowstic", "Stage1", "Espurr", "Beckoning Tail", TAIL_TEXT, "Psyshot"),
  ...bodies(SAMUROTT, "Samurott", "Stage2", "Dewott", "Torrential Whirlpool", WHIRLPOOL_TEXT, "Energized Slash"),
  ...bodies(
    TYRANITAR,
    "Team Rocket's Tyranitar",
    "Stage2",
    "Team Rocket's Pupitar",
    "Sand Stream",
    SAND_TEXT,
    "Demolition Tackle",
  ),
  ...bodies(CHIEN_PAO, "Chien-Pao", "Basic", undefined, "Snow Sink", SNOW_TEXT, "Icicle Loop"),
  ...bodies(AMBIPOM, "Ambipom", "Stage1", "Aipom", "Wicked Tail", WICKED_TEXT, "Gentle Slap"),
  [FILLER]: battler(FILLER, {
    name: "D555 Filler",
    hp: 200,
    retreat: 1,
    types: ["Colorless"],
    attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
  }),
  [STAGE1]: battler(STAGE1, {
    name: "D555 Stage One",
    hp: 200,
    stage: "Stage1",
    evolveFrom: "D555 Filler",
    types: ["Colorless"],
  }),
  [AIPOM]: battler(AIPOM, { name: "Aipom", hp: 70, types: ["Colorless"] }),
  [FIRE]: typedEnergy(FIRE, "Fire"),
  [WATER]: typedEnergy(WATER, "Water"),
  [TOY]: {
    ...trainerCard(
      TOY,
      "Item",
      "You can use this card only if you go second, and only during your first turn.\n\nPut an Energy attached to 1 of your opponent's Pokémon into their hand.",
    ),
    name: "Chill Teaser Toy",
  },
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

/** 60 cards, two or more of every body so a Prize row never holds the only copy. */
const DECK = deckOf({
  [VOLCARONA[0]]: 2,
  [VOLCARONA[1]]: 1,
  [ARCHEOPS[0]]: 2,
  [ARCHEOPS[1]]: 1,
  [MEOWSTIC[0]]: 2,
  [SAMUROTT[0]]: 2,
  [SAMUROTT[1]]: 1,
  [TYRANITAR[0]]: 2,
  [CHIEN_PAO[0]]: 2,
  [CHIEN_PAO[1]]: 2,
  [AMBIPOM[0]]: 2,
  [AIPOM]: 2,
  [FILLER]: 16,
  [STAGE1]: 4,
  [FIRE]: 5,
  [WATER]: 4,
  [TOY]: 3,
  [NEST_BALL]: 3,
  [BEACH_COURT]: 4,
});

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

/** Setup with `first` going first; returns the board at the start of turn 1. */
function opened(first: Seat, seed: number): GameState {
  const created = createGame({ seed, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first }));
  state = completeSetup(state);
  return state;
}

/** TEST SURGERY — make sure a copy of `id` sits in `seat`'s DECK, pulling one back
    from the hand or (swapped for the deck's bottom card) from the Prizes when the
    shuffle put every copy there. Every uid stays in exactly one zone. */
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

const seatActive = (state: GameState, seat: Seat, id: string) =>
  setActiveFromDeck(ensureInDeck(state, seat, id), seat, id);
const seatBench = (state: GameState, seat: Seat, id: string) => benchFromDeck(ensureInDeck(state, seat, id), seat, id);

/** p1 on its own (unrestricted) turn 2 — p2 went first and passed — with `active`
    Active, `bench` benched in order, and a FILLER Active and `oppBench` for p2. */
function table(
  active: string,
  bench: readonly string[] = [],
  oppBench: readonly string[] = [],
  seed = 5551,
): GameState {
  let state = must(applyAction(opened("p2", seed), { type: "endTurn", seat: "p2" }));
  state = seatActive(state, "p1", active);
  state = seatActive(state, "p2", FILLER);
  state = clearBench(state, "p1");
  state = clearBench(state, "p2");
  for (const id of bench) state = seatBench(state, "p1", id);
  for (const id of oppBench) state = seatBench(state, "p2", id);
  return state;
}

/** TEST SURGERY — `seat`'s hand becomes EXACTLY one card per entry of `ids`: the old
    hand goes to the bottom of the deck, then each id is pulled from the deck (or, when
    every copy was prized, swapped out of the Prizes for the deck's bottom card). */
function setHand(state: GameState, seat: Seat, ids: readonly string[]): GameState {
  const side = state.players[seat];
  let deck = [...side.deck, ...side.hand];
  let prizes = [...side.prizes];
  const hand: string[] = [];
  for (const id of ids) {
    const uid = deck.find((u) => state.cardIdByUid[u] === id);
    if (uid !== undefined) {
      deck = deck.filter((u) => u !== uid);
      hand.push(uid);
      continue;
    }
    const prized = prizes.find((u) => state.cardIdByUid[u] === id);
    const swap = deck[deck.length - 1];
    if (prized === undefined || swap === undefined) throw new Error(`${seat} has no more ${id}`);
    prizes = prizes.map((u) => (u === prized ? swap : u));
    deck = deck.slice(0, -1);
    hand.push(prized);
  }
  return { ...state, players: { ...state.players, [seat]: { ...side, hand, deck, prizes } } };
}

/** TEST SURGERY — put `id` (from `seat`'s deck) on top of the body at `spot`, as an
    evolution would, so the body is an EVOLVED Pokémon (stack length 2). */
function evolveBySurgery(prior: GameState, seat: Seat, spot: "active" | number, id: string): GameState {
  const state = ensureInDeck(prior, seat, id);
  const side = state.players[seat];
  const uid = side.deck.find((u) => state.cardIdByUid[u] === id);
  if (uid === undefined) throw new Error(`${seat} deck has no ${id}`);
  const deck = side.deck.filter((u) => u !== uid);
  if (spot === "active") {
    const active = side.active;
    if (active === null) throw new Error("no Active");
    return {
      ...state,
      players: { ...state.players, [seat]: { ...side, deck, active: { ...active, stack: [...active.stack, uid] } } },
    };
  }
  const bench = side.bench.map((p, i) => (i === spot ? { ...p, stack: [...p.stack, uid] } : p));
  return { ...state, players: { ...state.players, [seat]: { ...side, deck, bench } } };
}

/** TEST SURGERY — a Beach Court from `owner`'s deck into the Stadium zone. */
function stadiumOf(prior: GameState, owner: Seat): GameState {
  const state = ensureInDeck(prior, owner, BEACH_COURT);
  const side = state.players[owner];
  const uid = side.deck.find((u) => state.cardIdByUid[u] === BEACH_COURT);
  if (uid === undefined) throw new Error(`${owner} deck has no Beach Court`);
  return {
    ...state,
    stadium: { uid, owner },
    players: { ...state.players, [owner]: { ...side, deck: side.deck.filter((u) => u !== uid) } },
  };
}

function use(abilityName: string, index: number | "active" = "active", seat: Seat = "p1"): GameAction {
  return {
    type: "useAbility",
    seat,
    target: index === "active" ? { spot: "active" } : { spot: "bench", index },
    abilityName,
  };
}

function all<T extends GameEvent["type"]>(
  events: readonly GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

function parkOf(state: GameState) {
  if (state.phase.kind !== "effect:choose")
    throw new Error(`expected effect:choose, got ${state.phase.kind}`);
  return state.phase.prompt;
}

const P2_BENCH = (index: number): PokemonRef => ({ seat: "p2", spot: { spot: "bench", index } });
const idOf = (state: GameState, uid: string | undefined) => (uid === undefined ? undefined : state.cardIdByUid[uid]);
const topOf = (stack: readonly string[] | undefined) => stack?.[stack.length - 1];

// ────────────────────────────────────────────────────────────────────────────
describe("D555 B §1 — the print, and the registry rows that map it", () => {
  const ACTIVATED: readonly [ids: readonly string[], name: string, text: string, activeOnly: boolean, program: EffectOp[]][] = [
    [
      VOLCARONA,
      "Torrid Scales",
      TORRID_TEXT,
      false,
      [
        { op: "payFromHand", count: 1, to: "discard", filter: { kind: "basicEnergy", energyType: "Fire" } },
        { op: "applyStatus", target: "defender", status: "burned" },
      ],
    ],
    [ARCHEOPS, "Ancient Wing", WING_TEXT, true, [{ op: "devolveChosen" }]],
    [
      MEOWSTIC,
      "Beckoning Tail",
      TAIL_TEXT,
      false,
      [
        {
          op: "payFromHand",
          count: 1,
          to: "discard",
          filter: { kind: "byName", name: "Chill Teaser Toy", cardNoun: true },
        },
        { op: "gust" },
      ],
    ],
    [
      SAMUROTT,
      "Torrential Whirlpool",
      WHIRLPOOL_TEXT,
      false,
      [
        { op: "switchActive", recordAs: "moved" },
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable.
        { op: "recordGate", slot: "moved", then: [{ op: "opponentSwitchOut" }] },
      ],
    ],
  ];

  for (const [ids, name, text, activeOnly, program] of ACTIVATED) {
    it(`${name}: pinned by toEqual — ONE activated Ability, once per turn, no \`attack\` key, reprints share the object`, () => {
      const first = programFor(ids[0] as string);
      expect(first).toEqual({ abilities: [{ name, oncePerTurn: true, activeOnly, program }] });
      expect(Object.keys(first ?? {})).toEqual(["abilities"]);
      for (const id of ids) {
        expect(programFor(id)).toBe(first);
        expect(POOL[id]?.abilities?.[0]?.name).toBe(name);
        expect(POOL[id]?.abilities?.[0]?.effect).toBe(text);
      }
      // The Active-Spot clause is printed exactly where `activeOnly` is set.
      expect(text.includes("if this Pokémon is in the Active Spot")).toBe(activeOnly);
    });
  }

  it("Torrential Whirlpool is Interjet's program byte for byte, on its own object", () => {
    // Iron Bundle `sv06-062`'s derived attack program (effects.ts) — the same two ops.
    expect(JSON.stringify(programFor(SAMUROTT[0])?.abilities?.[0]?.program)).toBe(
      JSON.stringify([
        { op: "switchActive", recordAs: "moved" },
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable.
        { op: "recordGate", slot: "moved", then: [{ op: "opponentSwitchOut" }] },
      ]),
    );
  });

  const TRIGGERED: readonly [ids: readonly string[], row: unknown, text: string][] = [
    [
      TYRANITAR,
      {
        name: "Sand Stream",
        trigger: "betweenTurns",
        activeOnly: true,
        program: [
          { op: "counterEachAll", amount: 20, filter: { kind: "basicPokemon" }, side: "opponent", source: "ability" },
        ],
      },
      SAND_TEXT,
    ],
    [
      CHIEN_PAO,
      {
        name: "Snow Sink",
        trigger: "onPlayToBench",
        optional: true,
        program: [
          {
            op: "conditionGate",
            cond: { kind: "stadiumInPlay" },
            // biome-ignore lint/suspicious/noThenProperty: `then` is the effect gate's step list, not a thenable.
            then: [
              {
                op: "optional",
                note: "You may discard a Stadium in play.",
                // biome-ignore lint/suspicious/noThenProperty: `then` is the effect gate's step list, not a thenable.
                then: [{ op: "discardStadium" }],
              },
            ],
          },
        ],
      },
      SNOW_TEXT,
    ],
    [
      AMBIPOM,
      {
        name: "Wicked Tail",
        trigger: "onEvolve",
        optional: true,
        program: [
          // biome-ignore lint/suspicious/noThenProperty: `then` is the effect gate's step list, not a thenable.
          { op: "coinFlipGate", then: [{ op: "randomFromOpponentHand", to: "deck" }] },
          // biome-ignore lint/suspicious/noThenProperty: `then` is the effect gate's step list, not a thenable.
          { op: "coinFlipGate", then: [{ op: "randomFromOpponentHand", to: "deck" }] },
        ],
      },
      WICKED_TEXT,
    ],
  ];

  for (const [ids, row, text] of TRIGGERED) {
    it(`${(row as { name: string }).name}: pinned by toEqual — ONE triggered Ability, no \`attack\` key, reprints share the object`, () => {
      const first = programFor(ids[0] as string);
      expect(first).toEqual({ triggered: [row] });
      expect(Object.keys(first ?? {})).toEqual(["triggered"]);
      for (const id of ids) {
        expect(programFor(id)).toBe(first);
        expect(POOL[id]?.abilities?.[0]?.effect).toBe(text);
      }
    });
  }

  it("Sand Stream keeps TREVENANT's key order — trigger, activeOnly, program", () => {
    expect(Object.keys(programFor(TYRANITAR[0])?.triggered?.[0] ?? {})).toEqual([
      "name",
      "trigger",
      "activeOnly",
      "program",
    ]);
  });

  it("seven texts, seven DISTINCT objects (D199)", () => {
    const firsts = [VOLCARONA, ARCHEOPS, MEOWSTIC, SAMUROTT, TYRANITAR, CHIEN_PAO, AMBIPOM].map((ids) =>
      programFor(ids[0] as string),
    );
    expect(new Set(firsts).size).toBe(7);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D555 B §2 — Torrid Scales: discard a Basic {R} Energy card, Burn the opponent's Active", () => {
  it("is refused ABILITY_COST_UNMET without a Basic {R} Energy card in hand", () => {
    const state = setHand(table(FILLER, [VOLCARONA[0]]), "p1", [WATER, FILLER]);
    const result = applyAction(state, use("Torrid Scales", 0));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe("ABILITY_COST_UNMET");
    expect(result.error.message).toBe(
      "Torrid Scales can only be used if you discard a Basic Fire Energy card from your hand (§9)",
    );
  });

  it("is usable from the BENCH: pays the Fire Energy card and Burns the opponent's Active", () => {
    const before = setHand(table(FILLER, [VOLCARONA[0]]), "p1", [WATER, FIRE]);
    const fire = before.players.p1.hand[1] as string;
    const { state, events } = mustApply(before, use("Torrid Scales", 0));
    expect(types(events)[0]).toBe("ABILITY_USED");
    expect(state.phase.kind).toBe("turn:action");
    expect(state.players.p2.active?.conditions.burned).toBe(true);
    expect(state.players.p1.active?.conditions.burned).toBe(false);
    expect(state.players.p1.discard).toContain(fire);
    expect(state.players.p1.hand).toEqual([before.players.p1.hand[0]]);
  });

  it("once per turn: a second use by the same body is refused ABILITY_ALREADY_USED", () => {
    const before = setHand(table(VOLCARONA[1]), "p1", [FIRE, FIRE]);
    const once = mustApply(before, use("Torrid Scales")).state;
    expectErr(once, use("Torrid Scales"), "ABILITY_ALREADY_USED");
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D555 B §3 — Ancient Wing: Active only, devolve 1 of the opponent's evolved Pokémon", () => {
  it("is refused ABILITY_ACTIVE_ONLY off the Active Spot", () => {
    const state = evolveBySurgery(table(FILLER, [ARCHEOPS[0]]), "p2", "active", STAGE1);
    expectErr(state, use("Ancient Wing", 0), "ABILITY_ACTIVE_ONLY");
  });

  it("a lone evolved target is FORCED: its top Evolution card goes to the OPPONENT's hand", () => {
    const before = evolveBySurgery(table(ARCHEOPS[0]), "p2", "active", STAGE1);
    const [basic, top] = before.players.p2.active?.stack ?? [];
    const { state } = mustApply(before, use("Ancient Wing"));
    expect(state.phase.kind).toBe("turn:action");
    expect(state.players.p2.active?.stack).toEqual([basic]);
    expect(state.players.p2.hand).toEqual([...before.players.p2.hand, top]);
  });

  it("two evolved targets PARK on the printed caption, and the pick is the controller's", () => {
    let before = table(ARCHEOPS[1], [], [FILLER]);
    before = evolveBySurgery(evolveBySurgery(before, "p2", "active", STAGE1), "p2", 0, STAGE1);
    const parked = mustApply(before, use("Ancient Wing")).state;
    const prompt = parkOf(parked);
    if (prompt.kind !== "choosePokemon") throw new Error(`expected choosePokemon, got ${prompt.kind}`);
    expect(prompt.candidates).toHaveLength(2);
    expect(prompt.note).toBe(
      "Devolve 1 of your opponent's evolved Pokémon by putting the highest Stage Evolution card on it into your opponent's hand.",
    );
    const done = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon", ref: P2_BENCH(0) },
    }).state;
    expect(done.players.p2.bench[0]?.stack).toHaveLength(1);
    expect(done.players.p2.active?.stack).toHaveLength(2);
  });

  it("🛑 UNRULED (D555 R4, D553 R1): with no evolved target it is USED, whiffs, and SPENDS the use", () => {
    const before = table(ARCHEOPS[0]);
    const { state, events } = mustApply(before, use("Ancient Wing"));
    expect(types(events)).toEqual(["ABILITY_USED"]);
    expect(state.players.p2).toEqual(before.players.p2);
    expectErr(state, use("Ancient Wing"), "ABILITY_ALREADY_USED");
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D555 B §4 — Beckoning Tail: discard a Chill Teaser Toy card, gust", () => {
  it("is refused without a Chill Teaser Toy in hand, and the cost reads as printed", () => {
    const state = setHand(table(MEOWSTIC[0], [], [FILLER]), "p1", [FIRE, NEST_BALL]);
    const result = applyAction(state, use("Beckoning Tail"));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe("ABILITY_COST_UNMET");
    const cost = programFor(MEOWSTIC[0])?.abilities?.[0]?.program[0];
    if (cost?.op !== "payFromHand") throw new Error("expected the payFromHand head");
    const action = handCostAction(cost, false);
    expect(`${action.charAt(0).toUpperCase()}${action.slice(1)}.`).toBe(
      "Discard a Chill Teaser Toy card from your hand.",
    );
    expect(result.error.message).toBe(`Beckoning Tail can only be used if you ${action} (§9)`);
  });

  it("is refused NO_LEGAL_TARGET into an EMPTY opponent Bench, even holding the Toy", () => {
    const state = setHand(table(MEOWSTIC[0]), "p1", [TOY]);
    expectErr(state, use("Beckoning Tail"), "NO_LEGAL_TARGET");
  });

  it("pays the Toy and switches the chosen Benched Pokémon into the opponent's Active Spot", () => {
    const before = setHand(table(FILLER, [MEOWSTIC[0]], [FILLER, STAGE1]), "p1", [TOY, FIRE]);
    const toy = before.players.p1.hand[0] as string;
    const parked = mustApply(before, use("Beckoning Tail", 0)).state;
    const prompt = parkOf(parked);
    if (prompt.kind !== "choosePokemon") throw new Error(`expected choosePokemon, got ${prompt.kind}`);
    const done = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon", ref: P2_BENCH(1) },
    }).state;
    expect(idOf(done, topOf(done.players.p2.active?.stack))).toBe(STAGE1);
    expect(done.players.p1.discard).toContain(toy);
    expect(done.players.p1.hand).toEqual([before.players.p1.hand[1]]);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D555 B §5 — Torrential Whirlpool: switch; if you do, the OPPONENT switches out", () => {
  it("is refused NO_LEGAL_TARGET with its own Bench empty (`switchActive` gates the use)", () => {
    expectErr(table(SAMUROTT[0], [], [FILLER, FILLER]), use("Torrential Whirlpool"), "NO_LEGAL_TARGET");
  });

  it("with the opponent's Bench EMPTY the self-switch still happens and the opponent is never asked", () => {
    const before = table(SAMUROTT[0], [FILLER]);
    const { state, events } = mustApply(before, use("Torrential Whirlpool"));
    expect(state.phase).toEqual({ kind: "turn:action", seat: "p1" });
    expect(idOf(state, topOf(state.players.p1.active?.stack))).toBe(FILLER);
    expect(idOf(state, topOf(state.players.p1.bench[0]?.stack))).toBe(SAMUROTT[0]);
    expect(all(events, "POKEMON_SWITCHED").map((e) => e.seat)).toEqual(["p1"]);
    expect(state.players.p2.active).toEqual(before.players.p2.active);
  });

  it("otherwise it PARKS with the OPPONENT as answerer, and their pick becomes their Active", () => {
    const before = table(SAMUROTT[1], [FILLER], [FILLER, STAGE1]);
    const parked = mustApply(before, use("Torrential Whirlpool")).state;
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(parked.phase.answerer).toBe("p2");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "choosePokemon") throw new Error(`expected choosePokemon, got ${prompt.kind}`);
    expect(prompt.candidates).toEqual([P2_BENCH(0), P2_BENCH(1)]);
    const answer: GameAction = {
      type: "resolveEffect",
      seat: "p2",
      choice: { kind: "pokemon", ref: P2_BENCH(1) },
    };
    expect(applyAction(parked, { ...answer, seat: "p1" } as GameAction).ok).toBe(false);
    const done = mustApply(parked, answer).state;
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p1" });
    expect(idOf(done, topOf(done.players.p2.active?.stack))).toBe(STAGE1);
    expect(idOf(done, topOf(done.players.p1.active?.stack))).toBe(FILLER);
  });

  it("the park round-trips through JSON: the revived state answers identically", () => {
    const parked = mustApply(table(SAMUROTT[0], [FILLER], [FILLER, STAGE1]), use("Torrential Whirlpool")).state;
    const revived = JSON.parse(JSON.stringify(parked)) as GameState;
    expect(revived).toEqual(parked);
    const answer: GameAction = {
      type: "resolveEffect",
      seat: "p2",
      choice: { kind: "pokemon", ref: P2_BENCH(0) },
    };
    expect(mustApply(revived, answer).state).toEqual(mustApply(parked, answer).state);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D555 B §6 — Sand Stream: at every Checkup, while Active, 2 counters on each opposing Basic", () => {
  /** Tyranitar Active (or benched) for p1 beside a filler; p2 a filler Active with a
      Basic and a surgery-seated STAGE 1 on its Bench. */
  function sandTable(active: boolean): GameState {
    const state = active ? table(TYRANITAR[0], [FILLER], [FILLER, STAGE1]) : table(FILLER, [TYRANITAR[0]], [FILLER, STAGE1]);
    return state;
  }
  const damageOf = (state: GameState, seat: Seat) => [
    state.players[seat].active?.damage,
    ...state.players[seat].bench.map((p) => p.damage),
  ];

  it("while Active: 20 on each of the OPPONENT's Basics, the Stage 1 excluded, its own side untouched", () => {
    const { state, events } = mustApply(sandTable(true), { type: "endTurn", seat: "p1" });
    expect(damageOf(state, "p2")).toEqual([20, 20, 0]);
    expect(damageOf(state, "p1")).toEqual([0, 0]);
    const placed = all(events, "COUNTERS_PLACED");
    expect(placed.map((e) => [e.seat, e.amount, e.source])).toEqual([
      ["p2", 20, "ability"],
      ["p2", 20, "ability"],
    ]);
  });

  it("from the Bench it does nothing", () => {
    const { state, events } = mustApply(sandTable(false), { type: "endTurn", seat: "p1" });
    expect(damageOf(state, "p2")).toEqual([0, 0, 0]);
    expect(all(events, "COUNTERS_PLACED")).toHaveLength(0);
  });

  it("it fires at BOTH Checkups — the controller's and the opponent's (D555 R5)", () => {
    let state = mustApply(sandTable(true), { type: "endTurn", seat: "p1" }).state;
    state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
    expect(damageOf(state, "p2")).toEqual([40, 40, 0]);
  });

  it("the Checkup's own Knock Out sweep resolves a lethal placement", () => {
    const before = setDamage(sandTable(true), "p2", 190);
    const koUid = topOf(before.players.p2.active?.stack);
    const { state, events } = mustApply(before, { type: "endTurn", seat: "p1" });
    expect(all(events, "KNOCKED_OUT").map((e) => [e.seat, e.uid])).toEqual([["p2", koUid]]);
    expect(state.players.p2.discard).toContain(koUid);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D555 B §7 — Snow Sink: benched from hand, you MAY discard a Stadium in play", () => {
  function bench(prep: (s: GameState) => GameState = (s) => s, id: string = CHIEN_PAO[0]) {
    const before = prep(setHand(table(FILLER), "p1", [id, FIRE]));
    const uid = before.players.p1.hand[0] as string;
    return { before, ...mustApply(before, { type: "playBasicToBench", seat: "p1", uid }) };
  }
  const answer = (yes: boolean): GameAction => ({
    type: "resolveEffect",
    seat: "p1",
    choice: { kind: "confirm", yes },
  });

  it("with NO Stadium in play nothing is asked", () => {
    const { state } = bench();
    expect(state.phase).toEqual({ kind: "turn:action", seat: "p1" });
    expect(state.players.p1.bench).toHaveLength(1);
  });

  it("with a Stadium in play it ASKS, under its own caption", () => {
    const { state } = bench((s) => stadiumOf(s, "p2"));
    const prompt = parkOf(state);
    expect(prompt).toMatchObject({ kind: "confirm", note: "You may discard a Stadium in play." });
  });

  it("declining keeps the Stadium", () => {
    const { before, state } = bench((s) => stadiumOf(s, "p2"));
    const done = mustApply(state, answer(false)).state;
    expect(done.stadium).toEqual(before.stadium);
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p1" });
  });

  it("confirming discards the OPPONENT's Stadium into its owner's pile", () => {
    const { before, state } = bench((s) => stadiumOf(s, "p2"));
    const { state: done, events } = mustApply(state, answer(true));
    const uid = before.stadium?.uid as string;
    expect(done.stadium).toBeNull();
    expect(done.players.p2.discard).toEqual([...before.players.p2.discard, uid]);
    expect(all(events, "STADIUM_DISCARDED").map((e) => [e.seat, e.uid])).toEqual([["p2", uid]]);
  });

  it("…and YOUR OWN Stadium too: \"a Stadium in play\" is either player's (D555 R2)", () => {
    const { before, state } = bench((s) => stadiumOf(s, "p1"), CHIEN_PAO[1]);
    const done = mustApply(state, answer(true)).state;
    expect(done.stadium).toBeNull();
    expect(done.players.p1.discard).toContain(before.stadium?.uid);
  });

  it("it does NOT fire when the card reaches the Bench other than from hand (Nest Ball)", () => {
    const before = stadiumOf(setHand(table(FILLER), "p1", [NEST_BALL]), "p2");
    const parked = mustApply(before, { type: "playTrainer", seat: "p1", uid: before.players.p1.hand[0] as string }).state;
    const prompt = parkOf(parked);
    if (prompt.kind !== "chooseCards") throw new Error(`expected chooseCards, got ${prompt.kind}`);
    const chienPao = prompt.candidates.find((u) => CHIEN_PAO.includes(parked.cardIdByUid[u] as (typeof CHIEN_PAO)[number]));
    if (chienPao === undefined) throw new Error("no Chien-Pao on offer");
    const done = mustApply(parked, { type: "resolveEffect", seat: "p1", choice: { kind: "cards", uids: [chienPao] } }).state;
    expect(done.players.p1.bench.map((p) => topOf(p.stack))).toEqual([chienPao]);
    expect(done.phase).toEqual({ kind: "turn:action", seat: "p1" });
    expect(done.stadium).toEqual(before.stadium);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D555 B §8 — Wicked Tail: on evolve, 2 coins, a random opponent hand card per heads → their deck", () => {
  /** p1 on its turn 3 (it went first), a FILLER Active, Aipom benched, Ambipom in hand;
      p2 holds exactly `oppHand`. Evolves the Aipom. */
  function wicked(seed: number, oppHand: readonly string[] = [FILLER, FIRE, WATER, NEST_BALL]) {
    let state = opened("p1", seed);
    state = must(applyAction(state, { type: "endTurn", seat: "p1" }));
    state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
    state = seatActive(state, "p1", FILLER);
    state = clearBench(state, "p1");
    state = seatBench(state, "p1", AIPOM);
    state = setHand(state, "p1", [AMBIPOM[0]]);
    const before = setHand(state, "p2", oppHand);
    const uid = before.players.p1.hand[0] as string;
    const result = mustApply(before, { type: "evolve", seat: "p1", uid, target: { spot: "bench", index: 0 } });
    const flips = all(result.events, "ATTACK_EFFECT_COIN_FLIP").map((e) => e.result);
    return { before, uid, flips, ...result };
  }
  const SEEDS = Array.from({ length: 40 }, (_, i) => 5600 + i);
  const runs = SEEDS.map((seed) => ({ seed, ...wicked(seed) }));
  const outcome = (flips: readonly string[]) => flips.join("/");

  it("TWO independent flips: every seed flips exactly twice, and all four outcomes occur", () => {
    for (const run of runs) expect(run.flips, `seed ${run.seed}`).toHaveLength(2);
    expect(new Set(runs.map((r) => outcome(r.flips)))).toEqual(
      new Set(["heads/heads", "heads/tails", "tails/heads", "tails/tails"]),
    );
  });

  it("each heads takes exactly one random card; tails takes none", () => {
    for (const run of runs) {
      const heads = run.flips.filter((f) => f === "heads").length;
      expect(all(run.events, "RANDOM_CARD_TAKEN"), `seed ${run.seed}`).toHaveLength(heads);
      expect(run.state.players.p2.hand, `seed ${run.seed}`).toHaveLength(4 - heads);
    }
  });

  it("heads/heads takes 2 DISTINCT cards into the opponent's DECK, shuffled, the hand shrinking between picks", () => {
    const run = runs.find((r) => outcome(r.flips) === "heads/heads");
    if (run === undefined) throw new Error("no heads/heads seed");
    const taken = all(run.events, "RANDOM_CARD_TAKEN");
    expect(taken.map((e) => [e.seat, e.actor, e.to])).toEqual([
      ["p2", "p1", "deck"],
      ["p2", "p1", "deck"],
    ]);
    const [a, b] = taken.map((e) => e.uid);
    expect(a).not.toBe(b);
    for (const uid of [a, b]) {
      expect(run.before.players.p2.hand).toContain(uid);
      expect(run.state.players.p2.deck).toContain(uid);
      expect(run.state.players.p2.hand).not.toContain(uid);
    }
    expect(all(run.events, "SHUFFLE").map((e) => e.seat)).toEqual(["p2", "p2"]);
    expect(run.state.players.p2.deck).toHaveLength(run.before.players.p2.deck.length + 2);
  });

  it("an EMPTY opponent hand whiffs silently — the coins are flipped, nothing moves", () => {
    // The seed is re-scanned on the EMPTY board: a take draws from `rngState`, so the
    // second coin of an empty-hand run is not the second coin of a full-hand one.
    const empty = SEEDS.map((seed) => wicked(seed, [])).find((r) => outcome(r.flips) === "heads/heads");
    if (empty === undefined) throw new Error("no heads/heads seed on the empty board");
    expect(all(empty.events, "RANDOM_CARD_TAKEN")).toHaveLength(0);
    expect(empty.state.players.p2.deck).toEqual(empty.before.players.p2.deck);
    expect(empty.state.phase).toEqual({ kind: "turn:action", seat: "p1" });
  });

  it("it does NOT fire on a plain Bench play — the timing is the evolve", () => {
    let state = setHand(table(FILLER, [AMBIPOM[0]]), "p1", [AIPOM]);
    state = setHand(state, "p2", [FILLER, FIRE]);
    const { state: after, events } = mustApply(state, {
      type: "playBasicToBench",
      seat: "p1",
      uid: state.players.p1.hand[0] as string,
    });
    expect(all(events, "ATTACK_EFFECT_COIN_FLIP")).toHaveLength(0);
    expect(all(events, "RANDOM_CARD_TAKEN")).toHaveLength(0);
    expect(after.players.p2.hand).toEqual(state.players.p2.hand);
  });
});
