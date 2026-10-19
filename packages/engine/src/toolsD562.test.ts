import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import {
  berryReductionOf,
  deluxeBombOf,
  koSurvivalClamp,
  passivesOf,
  survivalBraceOf,
  toolsInEffect,
} from "./continuous";
import type { GameEvent } from "./events";
import { applyAction, createGame, engineVersion } from "./index";
import type { GameAction, GameState, PokemonRef, Seat } from "./index";
import { type LogContext, formatElapsed, logFromEvents } from "./log";
import { programFor } from "./registry";
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
  setDamage,
  trainerCard,
} from "./testFixtures";
import { damagedByAttackAbility, damagedToolTriggersOf } from "./triggers";
import type { InPlayPokemon } from "./types";

// ── 🆕🆕🆕 D562 — THE CONSUMABLE TOOLS AND THE TWO DAMAGED-REACTING TOOLS ──
//
//   Haban Berry     sv08.5-111  Tool  60 less from an opposing {N} attacker (after W/R), then discard
//   Occa Berry      sv07-140    Tool  … {R} …
//   Payapa Berry    sv07-141    Tool  … {P} …
//   Babiri Berry    sv08-163    Tool  … {M} …
//   Colbur Berry    sv08-168    Tool  … {D} …
//   Passho Berry    sv08-184    Tool  … {W} …
//   Survival Brace  sv06-164    Tool  (ACE SPEC) full HP, KO'd by an OPPONENT's attack: not KO'd, 10 HP left, then discard
//   Deluxe Bomb     sv07-134    Tool  (ACE SPEC) Active, damaged: 12 counters on the attacker, then discard
//   Lucky Helmet    sv06-158    Tool  Active, damaged: draw 2
//   Handheld Fan    sv06-150    Tool  Active, damaged: an Energy from the attacker to its Bench
//
// Every consumable is driven at every §8.5 site that can reach it (attack.ts's main hit,
// interpreter.ts `spreadDamage`, `placeSnipe`'s `deals` arm and `snipeActive`): the Berry BOTH
// WAYS at all four (spent; and kept when a prevention wins, when the hit stopped at damage
// step 2, and — at the three sites that have the flag — when suppression / `ignoreWR` drops
// it; the prevention rungs at `placeSnipe` / `snipeActive` were added in review); the Brace
// answering at all four, under Feint too (R-BF), and refusing at the main hit (not full HP,
// not lethal, Jamming Tower) and on the own-side spread; the Bomb detonating at both recoil
// sites and refusing at the main hit (prevented, Jamming Tower) and on a benched holder. On
// the REAL ids, on a LOCAL `cardPool` (D275) in the suite's OWN 60-card deck (D270). Texts,
// subtypes and legality off tcgdex (the audit's card JSON), 2026-09-27. Jamming Tower and
// Festival Grounds are `stadiumsD562.test.ts`. Readings R-BE, R-BR, R-BF, R-DB, R-LH, R-HF:
// docs/decisions.md D562.

const HABAN = "sv08.5-111";
const OCCA = "sv07-140";
const PAYAPA = "sv07-141";
const BABIRI = "sv08-163";
const COLBUR = "sv08-168";
const PASSHO = "sv08-184";
const BRACE = "sv06-164";
const BOMB = "sv07-134";
const HELMET = "sv06-158";
const FAN = "sv06-150";
const JAMMING = "sv06-153";
const DACHSBUN = "sv01-099";
const KLAWF = "sv03-120";
const KLEFKI = "sv01-096";
const EXP_SHARE = "sv01-174";

const berryText = (code: string) =>
  `If the Pokémon this card is attached to is damaged by an attack from your opponent's {${code}} Pokémon, it takes 60 less damage (after applying Weakness and Resistance), and discard this card.`;
const BRACE_TEXT =
  "If the Pokémon this card is attached to has full HP and would be Knocked Out by damage from an attack from your opponent's Pokémon, it is not Knocked Out, and its remaining HP becomes 10. Then, discard this card.";
const BOMB_TEXT =
  "If the Pokémon this card is attached to is in the Active Spot and is damaged by an attack from your opponent's Pokémon (even if this Pokémon is Knocked Out), put 12 damage counters on the Attacking Pokémon. If you placed any damage counters in this way, discard this card.";
const HELMET_TEXT =
  "If the Pokémon this card is attached to is in the Active Spot and is damaged by an attack from your opponent's Pokémon (even if this Pokémon is Knocked Out), draw 2 cards.";
const FAN_TEXT =
  "If the Pokémon this card is attached to is in the Active Spot and is damaged by an attack from your opponent's Pokémon (even if this Pokémon is Knocked Out), move an Energy from the Attacking Pokémon to 1 of your opponent's Benched Pokémon.";
const JAMMING_TEXT =
  "Pokémon Tools attached to each Pokémon (both yours and your opponent's) have no effect.";

/** The six Berries: id, printed name, printed type code, and the `PokemonType` it keys on. */
const BERRIES = [
  [HABAN, "Haban Berry", "N", "Dragon"],
  [OCCA, "Occa Berry", "R", "Fire"],
  [PAYAPA, "Payapa Berry", "P", "Psychic"],
  [BABIRI, "Babiri Berry", "M", "Metal"],
  [COLBUR, "Colbur Berry", "D", "Darkness"],
  [PASSHO, "Passho Berry", "W", "Water"],
] as const;

const FIRE = "d562t-fire";
const WALL = "d562t-wall";
const BRACED = "d562t-braced";
const TYPED = (type: string) => `d562t-atk-${type.toLowerCase()}`;

// The attacker's attacks, one per §8.5 site (+ the controls). Every cost is ONE {C}, except
// Tap (index 8), which costs nothing so an attacker with NO Energy can swing (Fan's whiff).
const BLAST = 0; // main hit, 120
const SHOCKWAVE = 1; // spreadDamage into the opponent's Bench, 120 each
const PINPOINT = 2; // placeSnipe `deals` arm, 120 to one chosen benched
const ARROW = 3; // opponentAny — snipeActive when the pick is the Active
const SELFSPLASH = 4; // spreadDamage into the attacker's OWN Bench (D425)
const FEINT = 5; // main hit that ignores effects on the opponent's Active (suppressTargetEffects)
const FEINT_SNIPE = 6; // opponentAny ignoreWR (placeSnipe / snipeActive)
const POKE = 7; // main hit, 30
const TAP = 8; // main hit, 120, NO cost
const DOUBLE = 9; // main hit 30, THEN an opponentAny snipe (the Active hit twice by one attack)
const KICK = 10; // main hit 30, then switch the opponent's Active out
const RETREAT_KICK = 11; // main hit 30, then switch the ATTACKER out (the R-HF approximation)

const BENCH_TAIL = " (Don't apply Weakness and Resistance for Benched Pokémon.)";
const ATTACKS = [
  { cost: ["Colorless"], name: "Blast", damage: 120 },
  {
    cost: ["Colorless"],
    name: "Shockwave",
    damage: 10,
    effect: "This attack does 120 damage to each of your opponent's Benched Pokémon.",
  },
  {
    cost: ["Colorless"],
    name: "Pinpoint",
    damage: 10,
    effect: `This attack also does 120 damage to 1 of your opponent's Benched Pokémon.${BENCH_TAIL}`,
  },
  {
    cost: ["Colorless"],
    name: "Arrow",
    effect: `This attack does 120 damage to 1 of your opponent's Pokémon.${BENCH_TAIL}`,
  },
  {
    cost: ["Colorless"],
    name: "Selfsplash",
    damage: 10,
    effect: `This attack also does 120 damage to each of your Benched Pokémon.${BENCH_TAIL}`,
  },
  {
    cost: ["Colorless"],
    name: "Feint",
    damage: 120,
    effect:
      "This attack's damage isn't affected by Weakness or Resistance, or by any effects on your opponent's Active Pokémon.",
  },
  {
    cost: ["Colorless"],
    name: "Feint Snipe",
    effect:
      "This attack does 120 damage to 1 of your opponent's Pokémon. This attack's damage isn't affected by Weakness or Resistance, or by any effects on that Pokémon.",
  },
  { cost: ["Colorless"], name: "Poke", damage: 30 },
  { cost: [], name: "Tap", damage: 120 },
  {
    cost: ["Colorless"],
    name: "Double Arrow",
    damage: 30,
    effect: `This attack does 120 damage to 1 of your opponent's Pokémon.${BENCH_TAIL}`,
  },
  {
    cost: ["Colorless"],
    name: "Kick",
    damage: 30,
    effect:
      "Switch out your opponent's Active Pokémon to the Bench. (Your opponent chooses the new Active Pokémon.)",
  },
  {
    cost: ["Colorless"],
    name: "Retreat Kick",
    damage: 30,
    effect: "Switch this Pokémon with 1 of your Benched Pokémon.",
  },
];

function printed(id: string, name: string, trainerType: string, effect: string): Card {
  return { ...trainerCard(id, trainerType, effect), name };
}

const LOCAL_CARDS: Record<string, Card> = {
  ...Object.fromEntries(
    BERRIES.map(([id, name, code]) => [id, printed(id, name, "Tool", berryText(code))]),
  ),
  // Survival Brace is an ACE SPEC too (tcgdex rarity "ACE SPEC Rare", and it is on
  // GameHud.aceSpecBar's list) — the fixture carries the rarity the catalog does.
  [BRACE]: { ...printed(BRACE, "Survival Brace", "Tool", BRACE_TEXT), rarity: "ACE SPEC Rare" },
  [BOMB]: { ...printed(BOMB, "Deluxe Bomb", "Tool", BOMB_TEXT), rarity: "ACE SPEC Rare" },
  [HELMET]: printed(HELMET, "Lucky Helmet", "Tool", HELMET_TEXT),
  [FAN]: printed(FAN, "Handheld Fan", "Tool", FAN_TEXT),
  [JAMMING]: printed(JAMMING, "Jamming Tower", "Stadium", JAMMING_TEXT),
  [FIRE]: battler(FIRE, { name: "D562 Fire", types: ["Fire"], hp: 340, attacks: ATTACKS }),
  ...Object.fromEntries(
    BERRIES.map(([, , , type]) => [
      TYPED(type),
      battler(TYPED(type), { name: `D562 ${type}`, types: [type], hp: 340, attacks: ATTACKS }),
    ]),
  ),
  [WALL]: battler(WALL, { name: "D562 Wall", types: ["Colorless"], hp: 300 }),
  [BRACED]: battler(BRACED, { name: "D562 Braced", types: ["Colorless"], hp: 120 }),
  [DACHSBUN]: battler(DACHSBUN, {
    name: "Dachsbun",
    types: ["Psychic"],
    hp: 100,
    abilities: [
      {
        type: "Ability",
        name: "Well-Baked Body",
        effect:
          "This Pokémon can't be Burned. Prevent all damage done to this Pokémon by attacks from your opponent's {R} Pokémon.",
      },
    ],
  }),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

/** Its OWN deck (D270), 60 by construction. */
// ⚠️ THREE ACE SPECs (2 Braces + 1 Bomb) where a real deck may hold ONE: this is a FIXTURE
// deck, not a decklist (aceSpecBar.test.ts's precedent) — `createGame` does not police the
// ACE SPEC deck rule, and the second Brace keeps the pulls from running dry.
const DECK = deckOf({
  [HABAN]: 1,
  [OCCA]: 3,
  [PAYAPA]: 1,
  [BABIRI]: 1,
  [COLBUR]: 1,
  [PASSHO]: 1,
  [BRACE]: 2,
  [BOMB]: 1,
  [HELMET]: 2,
  [FAN]: 1,
  [JAMMING]: 1,
  [FIRE]: 2,
  [TYPED("Dragon")]: 1,
  [TYPED("Psychic")]: 1,
  [TYPED("Metal")]: 1,
  [TYPED("Darkness")]: 1,
  [TYPED("Water")]: 1,
  [WALL]: 14,
  [EXP_SHARE]: 1,
  [BRACED]: 3,
  [DACHSBUN]: 1,
  [KLAWF]: 1,
  [KLEFKI]: 1,
  "fix-sturdy": 2,
  "fix-energy": 12,
  "fix-water-energy": 2,
  "fix-mist-energy": 1,
});

const NAMES: Record<Seat, string> = { p1: "Ember", p2: "Tide" };

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

/** Setup with p2 going first; returns p1's (unrestricted) turn 2 after p2 passed. */
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

type Body = { id: string; tool?: string };

/** p1's turn 2: `attacker` (with one {C} unless `bare`) against `defender`, each side's
    Bench EXACTLY the bodies named, each body carrying its Tool. */
function table(opts: {
  attacker?: string;
  defender?: Body;
  bench?: Body[];
  ownBench?: Body[];
  bare?: boolean;
  seed?: number;
}): GameState {
  let state = opened(opts.seed ?? 5621);
  state = setActiveFromDeck(ensureInDeck(state, "p1", opts.attacker ?? FIRE), "p1", opts.attacker ?? FIRE);
  const defender = opts.defender ?? { id: WALL };
  state = setActiveFromDeck(ensureInDeck(state, "p2", defender.id), "p2", defender.id);
  state = clearBench(clearBench(state, "p1"), "p2");
  if (defender.tool !== undefined) {
    state = attachToolFromDeck(ensureInDeck(state, "p2", defender.tool), "p2", "active", defender.tool);
  }
  for (const [seat, bodies] of [
    ["p2", opts.bench ?? []],
    ["p1", opts.ownBench ?? []],
  ] as const) {
    for (const [i, body] of bodies.entries()) {
      state = benchFromDeck(ensureInDeck(state, seat, body.id), seat, body.id);
      if (body.tool !== undefined) {
        state = attachToolFromDeck(ensureInDeck(state, seat, body.tool), seat, i, body.tool);
      }
    }
  }
  return opts.bare === true ? state : attachFromDeck(state, "p1", "fix-energy", 1);
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

/** TEST SURGERY — p1's Active carries an installed −`amount` pre-W/R debuff this turn, so
    every hit it makes stops at the rulebook's damage step 2. */
function debuffed(state: GameState, amount = 200): GameState {
  const active = state.players.p1.active;
  if (active === null) throw new Error("no Active");
  const withDebuff = { ...active, attackDamageDebuff: { amount, turn: state.turn } };
  return { ...state, players: { ...state.players, p1: { ...state.players.p1, active: withDebuff } } };
}

function all<T extends GameEvent["type"]>(
  events: readonly GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}
const idOf = (state: GameState, uid: string | undefined) => state.cardIdByUid[uid ?? ""];
const toolIds = (state: GameState, body: InPlayPokemon | null | undefined) =>
  (body?.tools ?? []).map((u) => idOf(state, u));
const discardIds = (state: GameState, seat: Seat) =>
  state.players[seat].discard.map((u) => idOf(state, u));
const consumed = (events: readonly GameEvent[]) =>
  all(events, "TOOLS_DISCARDED").filter((e) => e.when === "consumed");
const swing = (state: GameState, index: number) => mustApply(state, { type: "attack", seat: "p1", index });

/** Swing a snipe and answer its pick with the body at `spot` on p2's board. */
function snipe(state: GameState, index: number, spot: PokemonRef["spot"]) {
  const { state: parked } = swing(state, index);
  if (parked.phase.kind !== "effect:choose") throw new Error(`expected a pick, got ${parked.phase.kind}`);
  const prompt = parked.phase.prompt;
  if (prompt.kind !== "choosePokemonMulti") throw new Error(`expected choosePokemonMulti, got ${prompt.kind}`);
  const ref = prompt.candidates.find(
    (c) => c.seat === "p2" && JSON.stringify(c.spot) === JSON.stringify(spot),
  );
  if (ref === undefined) throw new Error("the spot is not a candidate");
  return mustApply(parked, { type: "resolveEffect", seat: "p1", choice: { kind: "pokemonMulti", refs: [ref] } });
}
const BENCH0: PokemonRef["spot"] = { spot: "bench", index: 0 };
const ACTIVE: PokemonRef["spot"] = { spot: "active" };

function render(events: readonly GameEvent[], state: GameState): { who: string; text: string }[] {
  const ctx: LogContext = { names: NAMES, state, elapsed: formatElapsed(0) };
  return logFromEvents([...events], ctx).flatMap((entry) =>
    entry.kind === "turn" ? [] : [{ who: entry.who, text: entry.segments.map((s) => s.text).join("") }],
  );
}
/** Klawf ex's parked discard, answered by p2 with the first discardable Energy. */
function klawfAnswer(parked: GameState): GameAction {
  if (parked.phase.kind !== "effect:choose") throw new Error(`expected Klawf's park, got ${parked.phase.kind}`);
  const prompt = parked.phase.prompt;
  if (prompt.kind !== "discardEnergy") throw new Error(`expected discardEnergy, got ${prompt.kind}`);
  return {
    type: "resolveEffect",
    seat: "p2",
    choice: { kind: "discardEnergy", uids: [prompt.discardable[0]?.uid as string] },
  };
}
const effectDraws = (events: readonly GameEvent[], seat: Seat) =>
  all(events, "CARDS_DRAWN").filter((e) => e.seat === seat && e.reason === "effect");

// ────────────────────────────────────────────────────────────────────────────
describe("D562 tools §1 — the prints, and the registry rows that map them", () => {
  it("the six Berries: ONE consumable key each, keyed on the printed TYPE, and nothing else", () => {
    for (const [id, name, , type] of BERRIES) {
      expect(programFor(id), name).toEqual({
        passive: { damageReductionAfterWRFromTypeThenDiscard: { amount: 60, type } },
      });
      expect(POOL[id]?.trainerType, name).toBe("Tool");
    }
  });

  it("Survival Brace, Deluxe Bomb, Lucky Helmet, Handheld Fan", () => {
    expect(programFor(BRACE)).toEqual({ passive: { survivesKoAtFullHpFromOpponentThenDiscard: true } });
    expect(programFor(BOMB)).toEqual({ passive: { damageAttackerActiveThenDiscard: 120 } });
    expect(programFor(HELMET)).toEqual({
      triggered: [
        { name: "Lucky Helmet", trigger: "onDamagedByAttack", program: [{ op: "drawCards", count: 2 }] },
      ],
    });
    expect(programFor(FAN)).toEqual({
      triggered: [
        {
          name: "Handheld Fan",
          trigger: "onDamagedByAttack",
          program: [
            { op: "moveEnergy", filter: { kind: "anyEnergy" }, max: 1, route: "selfToBench", side: "opponent" },
          ],
        },
      ],
    });
  });

  it("🛑 `passivesOf` folds NONE of the three consumable keys — its key set and every pin on it stand still", () => {
    const state = table({ defender: { id: WALL, tool: OCCA }, bench: [{ id: BRACED, tool: BRACE }, { id: WALL, tool: BOMB }] });
    for (const body of [state.players.p2.active, ...state.players.p2.bench]) {
      if (body === null) throw new Error("no body");
      const folded = passivesOf(state, body);
      expect(folded.damageReductionAfterWR).toBe(0);
      expect(folded.survivesKoAtFullHp).toBe(false);
      expect(folded.damageAttacker).toBe(0);
    }
  });

  it("all five attach from hand through the real §7.4 path (a `passive` or a `triggered` key)", () => {
    for (const id of [OCCA, BRACE, BOMB, HELMET, FAN]) {
      let state = table({});
      const side = state.players.p1;
      const uid = [...side.deck, ...side.hand, ...side.prizes].find((u) => state.cardIdByUid[u] === id);
      if (uid === undefined) throw new Error(`no ${id}`);
      state = {
        ...state,
        players: {
          ...state.players,
          p1: {
            ...side,
            deck: side.deck.filter((u) => u !== uid),
            prizes: side.prizes.filter((u) => u !== uid),
            hand: [...side.hand.filter((u) => u !== uid), uid],
          },
        },
      };
      const { state: attached } = mustApply(state, { type: "attachTool", seat: "p1", uid, target: { spot: "active" } });
      expect(toolIds(attached, attached.players.p1.active), id).toEqual([id]);
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D562 tools §2 — the Berry at the MAIN HIT (attack.ts), R-BE", () => {
  it("🛑 Occa vs an opposing {R} attacker: 60 less AFTER W/R, then the Berry is discarded — after the row", () => {
    const { state, events } = swing(table({ defender: { id: WALL, tool: OCCA } }), BLAST);
    const row = all(events, "DAMAGE_DEALT")[0];
    expect(row).toMatchObject({ seat: "p2", dealt: 60, reduction: 60 });
    expect(state.players.p2.active?.damage).toBe(60);
    expect(state.players.p2.active?.tools).toEqual([]);
    expect(discardIds(state, "p2")).toContain(OCCA);
    const spent = consumed(events);
    expect(spent).toHaveLength(1);
    expect(spent[0]).toMatchObject({ seat: "p2", actor: "p2", when: "consumed" });
    expect(idOf(state, spent[0]?.uids[0])).toBe(OCCA);
    expect(idOf(state, spent[0]?.host)).toBe(WALL);
    expect(events.indexOf(row as GameEvent)).toBeLessThan(events.indexOf(spent[0] as GameEvent));
  });

  it("the log row: filed under the OWNER, naming the card and the host, and saying it took effect", () => {
    const { state, events } = swing(table({ defender: { id: WALL, tool: OCCA } }), BLAST);
    expect(render(consumed(events), state)).toEqual([
      { who: "p2", text: "discarded Occa Berry from Tide's D562 Wall after it took effect" },
    ]);
  });

  it("every Berry pays against its OWN printed type (six attackers, six Berries)", () => {
    for (const [id, name, , type] of BERRIES) {
      const attacker = type === "Fire" ? FIRE : TYPED(type);
      const { state, events } = swing(table({ attacker, defender: { id: WALL, tool: id } }), BLAST);
      expect(all(events, "DAMAGE_DEALT")[0]?.dealt, name).toBe(60);
      expect(discardIds(state, "p2"), name).toContain(id);
    }
  });

  it("🛑 a MISMATCHED type: no reduction and the Berry stays (Passho {W} vs a {R} attacker)", () => {
    const { state, events } = swing(table({ defender: { id: WALL, tool: PASSHO } }), BLAST);
    expect(all(events, "DAMAGE_DEALT")[0]).toMatchObject({ dealt: 120 });
    expect(toolIds(state, state.players.p2.active)).toEqual([PASSHO]);
    expect(consumed(events)).toEqual([]);
  });

  it("🛑 R-BE — a hit the Berry takes to 0 is NOT prevented, and the Berry IS spent", () => {
    const { state, events } = swing(table({ defender: { id: WALL, tool: OCCA } }), POKE);
    const row = all(events, "DAMAGE_DEALT")[0];
    expect(row).toMatchObject({ dealt: 0, reduction: 60 });
    expect(row?.prevented).toBeUndefined();
    expect(discardIds(state, "p2")).toContain(OCCA);
  });

  it("🛑 R-BE — a full PREVENTION wins first and the Berry is NOT spent (Dachsbun vs {R})", () => {
    const { state, events } = swing(table({ defender: { id: DACHSBUN, tool: OCCA } }), BLAST);
    expect(all(events, "DAMAGE_DEALT")[0]).toMatchObject({ dealt: 0, prevented: true });
    expect(toolIds(state, state.players.p2.active)).toEqual([OCCA]);
    expect(consumed(events)).toEqual([]);
  });

  it("🛑 R-BE — `suppressTargetEffects` drops the Berry and does NOT spend it (Feint)", () => {
    const { state, events } = swing(table({ defender: { id: WALL, tool: OCCA } }), FEINT);
    expect(all(events, "DAMAGE_DEALT")[0]).toMatchObject({ dealt: 120 });
    expect(all(events, "DAMAGE_DEALT")[0]?.reduction).toBeUndefined();
    expect(toolIds(state, state.players.p2.active)).toEqual([OCCA]);
  });

  it("🛑 a hit STOPPED at damage step 2 (pre-W/R 0) never reaches the Berry — nothing spent", () => {
    const { state, events } = swing(debuffed(table({ defender: { id: WALL, tool: OCCA } })), BLAST);
    expect(all(events, "DAMAGE_DEALT")[0]).toMatchObject({ dealt: 0 });
    expect(toolIds(state, state.players.p2.active)).toEqual([OCCA]);
    expect(consumed(events)).toEqual([]);
  });

  it("🛑 Jamming Tower: the Berry has no effect — 120 lands and the Berry stays", () => {
    const { state, events } = swing(stadium(table({ defender: { id: WALL, tool: OCCA } }), JAMMING), BLAST);
    expect(all(events, "DAMAGE_DEALT")[0]).toMatchObject({ dealt: 120 });
    expect(toolIds(state, state.players.p2.active)).toEqual([OCCA]);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D562 tools §3 — the Berry at the three interpreter sites (no Active clause)", () => {
  it("🛑 spreadDamage: the Berry's holder takes 60, its neighbour 120, and the Berry goes to p2's pile", () => {
    const board = table({ bench: [{ id: WALL, tool: OCCA }, { id: WALL }] });
    const { state, events } = swing(board, SHOCKWAVE);
    expect(state.players.p2.bench.map((b) => b.damage)).toEqual([60, 120]);
    expect(state.players.p2.bench[0]?.tools).toEqual([]);
    expect(discardIds(state, "p2")).toContain(OCCA);
    expect(consumed(events)).toHaveLength(1);
  });

  it("🛑 spreadDamage PREVENTED (a benched Dachsbun vs {R}): the Berry is not spent", () => {
    const { state, events } = swing(table({ bench: [{ id: DACHSBUN, tool: OCCA }] }), SHOCKWAVE);
    expect(state.players.p2.bench[0]?.damage).toBe(0);
    expect(toolIds(state, state.players.p2.bench[0])).toEqual([OCCA]);
    expect(consumed(events)).toEqual([]);
  });

  it("🛑 spreadDamage stopped at step 2 (the debuff eats the splash): the Berry is not spent", () => {
    const { state } = swing(debuffed(table({ bench: [{ id: WALL, tool: OCCA }] })), SHOCKWAVE);
    expect(toolIds(state, state.players.p2.bench[0])).toEqual([OCCA]);
  });

  it("🛑 the OWN-SIDE spread (D425): \"your opponent's\" — no reduction, the Berry stays", () => {
    const { state, events } = swing(table({ ownBench: [{ id: WALL, tool: OCCA }] }), SELFSPLASH);
    expect(state.players.p1.bench[0]?.damage).toBe(120);
    expect(toolIds(state, state.players.p1.bench[0])).toEqual([OCCA]);
    expect(consumed(events)).toEqual([]);
  });

  it("🛑 placeSnipe `deals`: the picked Berry holder takes 60 and the Berry is spent", () => {
    const board = table({ bench: [{ id: WALL, tool: OCCA }, { id: WALL }] });
    const { state, events } = snipe(board, PINPOINT, BENCH0);
    expect(state.players.p2.bench[0]?.damage).toBe(60);
    expect(discardIds(state, "p2")).toContain(OCCA);
    expect(consumed(events)).toHaveLength(1);
  });

  it("🛑 placeSnipe PREVENTED (a benched Dachsbun vs {R}): the Berry is not spent", () => {
    const board = table({ bench: [{ id: DACHSBUN, tool: OCCA }, { id: WALL }] });
    const { state, events } = snipe(board, PINPOINT, BENCH0);
    const shielded = all(events, "DAMAGE_DEALT").filter((e) => e.seat === "p2" && e.prevented === true);
    expect(shielded.map((e) => e.dealt)).toEqual([0]);
    expect(state.players.p2.bench[0]?.damage).toBe(0);
    expect(toolIds(state, state.players.p2.bench[0])).toEqual([OCCA]);
    expect(consumed(events)).toEqual([]);
  });

  it("🛑 placeSnipe under `ignoreWR` (Feint Snipe): the Berry is nulled and NOT spent", () => {
    const board = table({ bench: [{ id: WALL, tool: OCCA }, { id: WALL }] });
    const { state } = snipe(board, FEINT_SNIPE, BENCH0);
    expect(state.players.p2.bench[0]?.damage).toBe(120);
    expect(toolIds(state, state.players.p2.bench[0])).toEqual([OCCA]);
  });

  it("🛑 placeSnipe stopped at step 2: the Berry is not spent", () => {
    const board = debuffed(table({ bench: [{ id: WALL, tool: OCCA }, { id: WALL }] }));
    const { state } = snipe(board, PINPOINT, BENCH0);
    expect(toolIds(state, state.players.p2.bench[0])).toEqual([OCCA]);
  });

  it("🛑 snipeActive: the picked Active takes 60 and the Berry is spent", () => {
    const board = table({ defender: { id: WALL, tool: OCCA }, bench: [{ id: WALL }] });
    const { state, events } = snipe(board, ARROW, ACTIVE);
    expect(state.players.p2.active?.damage).toBe(60);
    expect(state.players.p2.active?.tools).toEqual([]);
    expect(discardIds(state, "p2")).toContain(OCCA);
    expect(consumed(events)).toHaveLength(1);
  });

  it("🛑 snipeActive PREVENTED (an Active Dachsbun vs {R}): the Berry is not spent", () => {
    const board = table({ defender: { id: DACHSBUN, tool: OCCA }, bench: [{ id: WALL }] });
    const { state, events } = snipe(board, ARROW, ACTIVE);
    const shielded = all(events, "DAMAGE_DEALT").filter((e) => e.seat === "p2" && e.prevented === true);
    expect(shielded.map((e) => e.dealt)).toEqual([0]);
    expect(state.players.p2.active?.damage).toBe(0);
    expect(toolIds(state, state.players.p2.active)).toEqual([OCCA]);
    expect(consumed(events)).toEqual([]);
  });

  it("🛑 snipeActive under `ignoreWR`: nulled, NOT spent", () => {
    const board = table({ defender: { id: WALL, tool: OCCA }, bench: [{ id: WALL }] });
    const { state } = snipe(board, FEINT_SNIPE, ACTIVE);
    expect(state.players.p2.active?.damage).toBe(120);
    expect(toolIds(state, state.players.p2.active)).toEqual([OCCA]);
  });

  it("🛑 snipeActive stopped at step 2: not spent", () => {
    const board = debuffed(table({ defender: { id: WALL, tool: OCCA }, bench: [{ id: WALL }] }));
    const { state } = snipe(board, ARROW, ACTIVE);
    expect(toolIds(state, state.players.p2.active)).toEqual([OCCA]);
  });

  it("`berryReductionOf` itself: opposing seat AND matching type, or nothing", () => {
    const state = table({ defender: { id: WALL, tool: OCCA } });
    const holder = state.players.p2.active as InPlayPokemon;
    const fire = POOL[FIRE];
    expect(berryReductionOf(state, holder, fire, "p1").amount).toBe(60);
    expect(berryReductionOf(state, holder, fire, "p2").amount).toBe(0);
    expect(berryReductionOf(state, holder, POOL[WALL], "p1").amount).toBe(0);
    expect(berryReductionOf(state, holder, undefined, "p1").amount).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D562 tools §4 — Survival Brace, R-BR", () => {
  it("🛑 full HP, exactly lethal from an OPPONENT: survives at 10 HP, then the Brace is discarded", () => {
    const board = table({ defender: { id: BRACED, tool: BRACE }, bench: [{ id: WALL }] });
    const { state, events } = swing(board, BLAST);
    const row = all(events, "DAMAGE_DEALT")[0];
    expect(row).toMatchObject({ dealt: 120, damage: 110, survived: true });
    expect(all(events, "KNOCKED_OUT")).toEqual([]);
    expect(state.players.p2.active?.damage).toBe(110);
    expect(state.players.p2.active?.tools).toEqual([]);
    expect(discardIds(state, "p2")).toContain(BRACE);
    const spent = consumed(events);
    expect(spent).toHaveLength(1);
    expect(events.indexOf(row as GameEvent)).toBeLessThan(events.indexOf(spent[0] as GameEvent));
  });

  it("🛑 NOT full HP: the Brace does nothing and the body is Knocked Out", () => {
    const board = setDamage(table({ defender: { id: BRACED, tool: BRACE }, bench: [{ id: WALL }] }), "p2", 10);
    const { events } = swing(board, BLAST);
    expect(all(events, "KNOCKED_OUT")).toHaveLength(1);
    expect(consumed(events)).toEqual([]);
  });

  it("🛑 not lethal: the Brace stays", () => {
    const { state, events } = swing(table({ defender: { id: BRACED, tool: BRACE } }), POKE);
    expect(toolIds(state, state.players.p2.active)).toEqual([BRACE]);
    expect(consumed(events)).toEqual([]);
  });

  it("🛑 spread, placeSnipe and snipeActive all reach it (no Active clause)", () => {
    const spread = swing(table({ bench: [{ id: BRACED, tool: BRACE }] }), SHOCKWAVE);
    expect(spread.state.players.p2.bench[0]?.damage).toBe(110);
    expect(discardIds(spread.state, "p2")).toContain(BRACE);

    const picked = snipe(table({ bench: [{ id: BRACED, tool: BRACE }, { id: WALL }] }), PINPOINT, BENCH0);
    expect(picked.state.players.p2.bench[0]?.damage).toBe(110);
    expect(discardIds(picked.state, "p2")).toContain(BRACE);

    const active = snipe(table({ defender: { id: BRACED, tool: BRACE }, bench: [{ id: WALL }] }), ARROW, ACTIVE);
    expect(active.state.players.p2.active?.damage).toBe(110);
    expect(discardIds(active.state, "p2")).toContain(BRACE);
  });

  it("🛑 \"from your OPPONENT's Pokémon\" — an own-side spread Knocks the Brace holder Out (Sturdy's own twin survives it)", () => {
    const board = table({ ownBench: [{ id: BRACED, tool: BRACE }, { id: "fix-sturdy" }] });
    const { state, events } = swing(board, SELFSPLASH);
    const koed = all(events, "KNOCKED_OUT").map((e) => idOf(state, e.uid));
    expect(koed).toEqual([BRACED]);
    expect(consumed(events)).toEqual([]);
    expect(koSurvivalClamp(board, board.players.p1.bench[0] as InPlayPokemon, 120, "p1")).toBeNull();
    expect(koSurvivalClamp(board, board.players.p1.bench[0] as InPlayPokemon, 120, "p2")).toEqual({
      damage: 110,
      toolUid: board.players.p1.bench[0]?.tools[0],
    });
  });

  it("🛑 R-BR — Sturdy AND a Brace on one body: the clamp fires ONCE (110) and the Brace IS discarded", () => {
    const board = table({ defender: { id: "fix-sturdy", tool: BRACE }, bench: [{ id: WALL }] });
    const { state, events } = swing(board, BLAST);
    expect(all(events, "DAMAGE_DEALT")[0]).toMatchObject({ damage: 110, survived: true });
    expect(discardIds(state, "p2")).toContain(BRACE);
    expect(consumed(events)).toHaveLength(1);
  });

  it("🛑 R-BF — Feint's \"any effects on your opponent's Active Pokémon\" does NOT reach the Brace: 120 lands in full, the body survives at 10 and the Brace is spent", () => {
    const board = table({ defender: { id: BRACED, tool: BRACE }, bench: [{ id: WALL }] });
    const { state, events } = swing(board, FEINT);
    expect(all(events, "DAMAGE_DEALT")[0]).toMatchObject({ dealt: 120, damage: 110, survived: true });
    expect(all(events, "KNOCKED_OUT")).toEqual([]);
    expect(discardIds(state, "p2")).toContain(BRACE);
    expect(consumed(events)).toHaveLength(1);
    // …which is how the Ability twin has read since D208 (the clamp was never gated on
    // `suppressTargetEffects`): Sturdy under Feint survives at 10 too.
    const sturdy = swing(table({ defender: { id: "fix-sturdy" }, bench: [{ id: WALL }] }), FEINT);
    expect(all(sturdy.events, "DAMAGE_DEALT")[0]).toMatchObject({ dealt: 120, damage: 110, survived: true });
    expect(all(sturdy.events, "KNOCKED_OUT")).toEqual([]);
  });

  it("🛑 R-BF at both snipe arms (Feint Snipe's `ignoreWR`): the Brace answers on the Bench and in the Active Spot", () => {
    const picked = snipe(table({ bench: [{ id: BRACED, tool: BRACE }, { id: WALL }] }), FEINT_SNIPE, BENCH0);
    expect(picked.state.players.p2.bench[0]?.damage).toBe(110);
    expect(discardIds(picked.state, "p2")).toContain(BRACE);
    expect(all(picked.events, "KNOCKED_OUT")).toEqual([]);

    const active = snipe(table({ defender: { id: BRACED, tool: BRACE }, bench: [{ id: WALL }] }), FEINT_SNIPE, ACTIVE);
    expect(active.state.players.p2.active?.damage).toBe(110);
    expect(discardIds(active.state, "p2")).toContain(BRACE);
    expect(all(active.events, "KNOCKED_OUT")).toEqual([]);
  });

  it("🛑 a Tool is not an Ability: under Klefki's lock (Sturdy silenced) the Brace still answers", () => {
    // Klefki Active on p2 locks every Basic; the spread reaches both benched bodies.
    const board = table({ defender: { id: KLEFKI }, bench: [{ id: BRACED, tool: BRACE }, { id: "fix-sturdy" }] });
    const { state, events } = swing(board, SHOCKWAVE);
    expect(state.players.p2.bench.map((b) => idOf(state, b.stack.at(-1)))).toEqual([BRACED]);
    expect(state.players.p2.bench[0]?.damage).toBe(110);
    expect(all(events, "KNOCKED_OUT").map((e) => idOf(state, e.uid))).toEqual(["fix-sturdy"]);
  });

  it("🛑 Jamming Tower: the Brace has no effect — the body is Knocked Out", () => {
    const board = stadium(table({ defender: { id: BRACED, tool: BRACE }, bench: [{ id: WALL }] }), JAMMING);
    const { events } = swing(board, BLAST);
    expect(all(events, "KNOCKED_OUT")).toHaveLength(1);
    expect(survivalBraceOf(board, board.players.p2.active as InPlayPokemon, "p1")).toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D562 tools §5 — Deluxe Bomb, R-DB", () => {
  it("🛑 an Active holder damaged by the opponent: 120 on the attacker (its OWN row), then the Bomb is discarded", () => {
    const { state, events } = swing(table({ defender: { id: WALL, tool: BOMB } }), BLAST);
    const rows = all(events, "COUNTERS_PLACED").filter((e) => e.source === "counterattack");
    expect(rows.map((e) => [e.seat, e.amount])).toEqual([["p1", 120]]);
    expect(state.players.p1.active?.damage).toBe(120);
    expect(discardIds(state, "p2")).toContain(BOMB);
    const spent = consumed(events);
    expect(spent).toHaveLength(1);
    expect(events.indexOf(rows[0] as GameEvent)).toBeLessThan(events.indexOf(spent[0] as GameEvent));
  });

  it("🛑 \"even if this Pokémon is Knocked Out\" — a lethal hit still detonates it", () => {
    const { state, events } = swing(table({ defender: { id: BRACED, tool: BOMB }, bench: [{ id: WALL }] }), BLAST);
    expect(all(events, "KNOCKED_OUT")).toHaveLength(1);
    expect(state.players.p1.active?.damage).toBe(120);
  });

  it("🛑 NOT damaged (a prevented hit): no counters, the Bomb stays", () => {
    const { state, events } = swing(table({ defender: { id: DACHSBUN, tool: BOMB } }), BLAST);
    expect(all(events, "COUNTERS_PLACED")).toEqual([]);
    expect(toolIds(state, state.players.p2.active)).toEqual([BOMB]);
  });

  it("🛑 \"in the Active Spot\" — a benched Bomb holder hit by a spread detonates nothing", () => {
    const { state, events } = swing(table({ bench: [{ id: WALL, tool: BOMB }] }), SHOCKWAVE);
    expect(all(events, "COUNTERS_PLACED")).toEqual([]);
    expect(toolIds(state, state.players.p2.bench[0])).toEqual([BOMB]);
  });

  it("🛑 the re-homed Active hit (snipeActive → reactToAttackDamage) detonates it too", () => {
    const board = table({ defender: { id: WALL, tool: BOMB }, bench: [{ id: WALL }] });
    const { state } = snipe(board, ARROW, ACTIVE);
    expect(state.players.p1.active?.damage).toBe(120);
    expect(discardIds(state, "p2")).toContain(BOMB);
  });

  it("🛑 Jamming Tower: no counters, the Bomb stays", () => {
    const { state, events } = swing(stadium(table({ defender: { id: WALL, tool: BOMB } }), JAMMING), BLAST);
    expect(all(events, "COUNTERS_PLACED")).toEqual([]);
    expect(toolIds(state, state.players.p2.active)).toEqual([BOMB]);
  });

  it("`deluxeBombOf` itself: an opposing attacker only", () => {
    const state = table({ defender: { id: WALL, tool: BOMB } });
    const holder = state.players.p2.active as InPlayPokemon;
    expect(deluxeBombOf(state, holder, "p1", 10).amount).toBe(120);
    expect(deluxeBombOf(state, holder, "p2", 10).amount).toBe(0);
  });

  it("the ACE SPEC classification is the CARD's (rarity), not the row's — Deluxe Bomb AND Survival Brace", () => {
    for (const id of [BOMB, BRACE]) {
      expect(POOL[id]?.rarity, id).toBe("ACE SPEC Rare");
      expect(Object.keys(programFor(id) ?? {}), id).toEqual(["passive"]);
    }
    for (const id of [OCCA, HELMET, FAN]) expect(POOL[id]?.rarity, id).not.toBe("ACE SPEC Rare");
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D562 tools §6 — Lucky Helmet: one `damagedTrigger` stage per Tool source, R-LH", () => {
  it("🛑 damaged in the Active Spot: the holder's controller draws 2, with NO ABILITY_TRIGGERED row", () => {
    const { events } = swing(table({ defender: { id: WALL, tool: HELMET } }), BLAST);
    expect(effectDraws(events, "p2").map((e) => e.uids.length)).toEqual([2]);
    expect(all(events, "ABILITY_TRIGGERED")).toEqual([]);
  });

  it("🛑 \"even if this Pokémon is Knocked Out\"", () => {
    const { events } = swing(table({ defender: { id: BRACED, tool: HELMET }, bench: [{ id: WALL }] }), BLAST);
    expect(all(events, "KNOCKED_OUT")).toHaveLength(1);
    expect(effectDraws(events, "p2").map((e) => e.uids.length)).toEqual([2]);
  });

  it("🛑 not damaged (prevented), not Active (a spread), or silenced (Jamming Tower): no draw", () => {
    expect(effectDraws(swing(table({ defender: { id: DACHSBUN, tool: HELMET } }), BLAST).events, "p2")).toEqual([]);
    expect(effectDraws(swing(table({ bench: [{ id: WALL, tool: HELMET }] }), SHOCKWAVE).events, "p2")).toEqual([]);
    const jammed = stadium(table({ defender: { id: WALL, tool: HELMET } }), JAMMING);
    expect(effectDraws(swing(jammed, BLAST).events, "p2")).toEqual([]);
  });

  it("🛑 switched out by the attack's own effect before the stage runs: \"in the Active Spot\" fails, no draw", () => {
    const board = table({ defender: { id: WALL, tool: HELMET }, bench: [{ id: WALL }] });
    const { events } = swing(board, KICK);
    expect(all(events, "DAMAGE_DEALT")[0]).toMatchObject({ dealt: 30 });
    expect(effectDraws(events, "p2")).toEqual([]);
  });

  it("🛑 the re-homed Active hit (snipeActive) seeds the Tool's stage too — AHEAD of the turn's end", () => {
    const board = table({ defender: { id: WALL, tool: HELMET }, bench: [{ id: WALL }] });
    const { events } = snipe(board, ARROW, ACTIVE);
    const drawn = effectDraws(events, "p2");
    expect(drawn.map((e) => e.uids.length)).toEqual([2]);
    const turnStart = events.findIndex((e) => e.type === "CARDS_DRAWN" && e.reason === "turnStart");
    expect(turnStart).toBeGreaterThan(-1);
    expect(events.indexOf(drawn[0] as GameEvent)).toBeLessThan(turnStart);
  });

  it("🛑 the Active damaged TWICE by one attack (main hit, then a snipe) queues the Tool's stage ONCE", () => {
    const board = table({ defender: { id: WALL, tool: HELMET }, bench: [{ id: WALL }] });
    const { events: first } = swing(board, DOUBLE);
    expect(all(first, "DAMAGE_DEALT").map((e) => e.dealt)).toEqual([30]);
    const { events } = snipe(board, DOUBLE, ACTIVE);
    expect(all(events, "DAMAGE_DEALT").map((e) => e.dealt)).toEqual([120]);
    expect(effectDraws(events, "p2").map((e) => e.uids.length)).toEqual([2]);
  });

  it("🛑 R-LH — a PARKING Ability (Klawf ex) runs FIRST and does not strand the Tool's stage behind it", () => {
    let board = table({ defender: { id: KLAWF, tool: HELMET } });
    board = attachFromDeck(board, "p1", "fix-water-energy", 1);
    const { state: parked, events: first } = swing(board, POKE);
    expect(all(first, "ABILITY_TRIGGERED").map((e) => e.ability)).toEqual(["Counterattacking Pincer"]);
    expect(effectDraws(first, "p2")).toEqual([]);
    const helmetUid = parked.players.p2.active?.tools[0] as string;
    expect(parked.pending.map((s) => [s.kind, "uid" in s ? s.uid : undefined])).toEqual([
      ["damagedTrigger", helmetUid],
      ["attackEpilogue", parked.players.p1.active?.stack.at(-1)],
    ]);
    const { events: rest } = mustApply(parked, klawfAnswer(parked));
    expect(effectDraws(rest, "p2").map((e) => e.uids.length)).toEqual([2]);
  });

  it("`damagedToolTriggersOf`: the Active's in-effect Tools only", () => {
    const board = table({ defender: { id: WALL, tool: HELMET }, bench: [{ id: WALL, tool: HELMET }] });
    const activeUid = board.players.p2.active?.stack.at(-1) as string;
    const benchedUid = board.players.p2.bench[0]?.stack.at(-1) as string;
    expect(damagedToolTriggersOf(board, "p2", activeUid).map((e) => e.ability.name)).toEqual(["Lucky Helmet"]);
    expect(damagedToolTriggersOf(board, "p2", benchedUid)).toEqual([]);
    expect(damagedToolTriggersOf(stadium(board, JAMMING), "p2", activeUid)).toEqual([]);
    // Only the `onDamagedByAttack` timing: an Exp. Share (`onAllyActiveKnockOut`) on the
    // damaged Active is not a damaged-reacting Tool.
    const shared = table({ defender: { id: WALL, tool: EXP_SHARE } });
    expect(damagedToolTriggersOf(shared, "p2", shared.players.p2.active?.stack.at(-1) as string)).toEqual([]);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D562 tools §7 — Handheld Fan, R-HF", () => {
  /** p1 Fire (one {C}) vs a Fan-carrying Wall, p1's Bench one Wall. */
  const fanBoard = (opts: { ownBench?: Body[]; bare?: boolean } = {}) =>
    table({ defender: { id: WALL, tool: FAN }, ownBench: opts.ownBench ?? [{ id: WALL }], bare: opts.bare });

  function fanPrompt(state: GameState) {
    if (state.phase.kind !== "effect:choose") throw new Error(`expected the Fan's park, got ${state.phase.kind}`);
    const prompt = state.phase.prompt;
    if (prompt.kind !== "moveEnergy") throw new Error(`expected moveEnergy, got ${prompt.kind}`);
    return prompt;
  }

  it("🛑 the DAMAGED seat moves an Energy off the ATTACKER onto the attacker's Bench", () => {
    const { state: parked } = swing(fanBoard(), BLAST);
    const prompt = fanPrompt(parked);
    const energy = parked.players.p1.active?.energy[0] as string;
    expect(prompt.movable.map((m) => m.uid)).toEqual([energy]);
    expect(prompt.destinations).toEqual([{ seat: "p1", spot: { spot: "bench", index: 0 } }]);
    const { state, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p2",
      choice: { kind: "moveEnergy", picks: [{ uid: energy, dest: { seat: "p1", spot: { spot: "bench", index: 0 } } }] },
    });
    expect(all(events, "ABILITY_TRIGGERED")).toEqual([]);
    expect(state.players.p1.bench[0]?.energy).toContain(energy);
    expect(state.players.p1.active?.energy).not.toContain(energy);
  });

  it("⚠️ R-HF — the printed \"move\" is mandatory, the family's `max: 1` park carries its standing decline", () => {
    const { state: parked } = swing(fanBoard(), BLAST);
    expect(fanPrompt(parked).min ?? 0).toBe(0);
    const { state } = mustApply(parked, { type: "resolveEffect", seat: "p2", choice: { kind: "moveEnergy", picks: [] } });
    expect(state.players.p1.bench[0]?.energy).toEqual([]);
  });

  it("🛑 R-HF — the §11 shield does NOT refuse it: a Tool's move is not an effect of an ATTACK", () => {
    let board = fanBoard();
    board = attachFromDeck(board, "p1", "fix-mist-energy", 1);
    const { state: parked, events } = swing(board, BLAST);
    expect(all(events, "ATTACK_EFFECT_PREVENTED")).toEqual([]);
    expect(fanPrompt(parked).movable).toHaveLength(2);
  });

  it("🛑 whiffs: an attacker with NO Energy, or with NO Bench — no park, the turn ends", () => {
    const bare = swing(fanBoard({ bare: true }), TAP);
    expect(bare.state.phase.kind).not.toBe("effect:choose");
    expect(all(bare.events, "ENERGY_MOVED")).toEqual([]);
    const lonely = swing(fanBoard({ ownBench: [] }), BLAST);
    expect(lonely.state.phase.kind).not.toBe("effect:choose");
    expect(lonely.state.players.p1.active?.energy).toHaveLength(1);
  });

  it("⚠️ R-HF, INHERITED APPROXIMATION — the stage reads the opponent's CURRENT Active, not \"the Attacking Pokémon\"", () => {
    // Klawf ex's since D101: `side: "opponent"` resolves the source when the stage RUNS,
    // after the attack's own program. An attack that damages and then switches its user
    // out hands the Fan the NEW Active, while the Attacking Pokémon, now benched, still
    // holds the {C} the print would have moved. Reversal: record the attacker's uid on the
    // stage (a `PendingStage` SHAPE change, so an MRV decision).
    function kickedOut(state: GameState): { state: GameState; events: GameEvent[] } {
      const swung = swing(state, RETREAT_KICK);
      if (swung.state.phase.kind !== "effect:choose" || swung.state.phase.seat !== "p1") return swung;
      const prompt = swung.state.phase.prompt;
      if (prompt.kind !== "choosePokemonMulti") throw new Error(`expected the switch pick, got ${prompt.kind}`);
      const ref = prompt.candidates[0] as PokemonRef;
      return mustApply(swung.state, { type: "resolveEffect", seat: "p1", choice: { kind: "pokemonMulti", refs: [ref] } });
    }
    // (a) the switched-in body holds no Energy: the Fan whiffs, the benched attacker keeps its {C}.
    const bare = kickedOut(fanBoard());
    expect(bare.state.phase.kind).not.toBe("effect:choose");
    expect(all(bare.events, "ENERGY_MOVED")).toEqual([]);
    expect(idOf(bare.state, bare.state.players.p1.active?.stack.at(-1))).toBe(WALL);
    expect(idOf(bare.state, bare.state.players.p1.bench[0]?.stack.at(-1))).toBe(FIRE);
    expect(bare.state.players.p1.bench[0]?.energy).toHaveLength(1);
    // (b) the switched-in body holds a {W} (test surgery): the Fan PARKS, and offers THAT
    // Energy — off a Pokémon that did not attack — and never the attacker's {C}.
    let board = fanBoard();
    const side = board.players.p1;
    const water = side.deck.find((u) => board.cardIdByUid[u] === "fix-water-energy") as string;
    const sub = side.bench[0] as InPlayPokemon;
    board = {
      ...board,
      players: {
        ...board.players,
        p1: { ...side, deck: side.deck.filter((u) => u !== water), bench: [{ ...sub, energy: [water] }] },
      },
    };
    const attackerEnergy = board.players.p1.active?.energy[0] as string;
    const { state: parked } = kickedOut(board);
    expect(parked.phase.kind === "effect:choose" && parked.phase.seat).toBe("p2");
    const offered = fanPrompt(parked).movable.map((m) => m.uid);
    expect(offered).toEqual([water]);
    expect(offered).not.toContain(attackerEnergy);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D562 tools §8 — `MATCH_RECORD_VERSION` holds at 35, and every 0.445 rollback reading named", () => {
  it("the engine is 0.550.0", () => {
    expect(engineVersion).toBe("0.550.0");
  });

  it("a parked Klawf with a Tool-uid stage queued behind it revives identically through JSON", () => {
    let board = table({ defender: { id: KLAWF, tool: HELMET } });
    board = attachFromDeck(board, "p1", "fix-water-energy", 1);
    const { state: parked } = swing(board, POKE);
    const revived = JSON.parse(JSON.stringify(parked)) as GameState;
    expect(revived).toEqual(parked);
    const answer = klawfAnswer(parked);
    expect(mustApply(revived, answer).state).toEqual(mustApply(parked, answer).state);
  });

  it("⚠️ ROLLBACK — a 0.445 runner resolves a stage through `damagedByAttackAbility` ALONE, which finds no card for a Tool uid: a silent whiff", () => {
    const board = table({ defender: { id: WALL, tool: HELMET } });
    const helmetUid = board.players.p2.active?.tools[0] as string;
    const activeUid = board.players.p2.active?.stack.at(-1) as string;
    expect(damagedByAttackAbility(board, "p2", helmetUid)).toBeUndefined();
    expect(damagedToolTriggersOf(board, "p2", activeUid).map((e) => e.toolUid)).toEqual([helmetUid]);
  });

  it("⚠️ ROLLBACK — the consumable keys are catalog data a 0.445 fold never reads: stripped, the Tools are inert", () => {
    const board = table({ defender: { id: WALL, tool: OCCA }, bench: [{ id: BRACED, tool: BRACE }, { id: WALL, tool: BOMB }] });
    // The 0.445 fold is `passivesOf`, unchanged: it sees none of the three keys (§1), so a
    // 0.445 reader takes the full 120, Knocks the Brace holder Out and places no Bomb
    // counters — and discards nothing, so the Tools stay attached, inert.
    for (const body of [board.players.p2.active, ...board.players.p2.bench]) {
      const folded = passivesOf(board, body as InPlayPokemon);
      expect([folded.damageReductionAfterWR, folded.survivesKoAtFullHp, folded.damageAttacker]).toEqual([0, false, 0]);
    }
    // …while this build's scans DO read them — the difference IS the rollback reading.
    expect(toolsInEffect(board, board.players.p2.active as InPlayPokemon)).toHaveLength(1);
    expect(berryReductionOf(board, board.players.p2.active as InPlayPokemon, POOL[FIRE], "p1").amount).toBe(60);
  });

  it("the new `when: \"consumed\"` rides an UNPERSISTED event — only its rendered row reaches a MatchRecord", () => {
    const { state, events } = swing(table({ defender: { id: WALL, tool: OCCA } }), BLAST);
    const row = render(consumed(events), state)[0];
    expect(JSON.parse(JSON.stringify(row))).toEqual(row);
  });
});
