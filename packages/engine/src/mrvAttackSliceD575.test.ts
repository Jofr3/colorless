import type { Card } from "@luminous/schema";
import { redactedGameOverReasonSchema, redactedGameSchema } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import { attackBlockOf, liveHandAttachMark } from "./continuous";
import { deriveAttackEffect } from "./effects";
import { runProgram } from "./interpreter";
import type { GameEvent } from "./events";
import { applyAction, createGame, engineVersion } from "./index";
import type { GameAction, GameState, Seat } from "./index";
import { type LogContext, formatElapsed, logFromEvents } from "./log";
import { redactGame } from "./redact";
import { FIXTURE_POOL, battler, benchFromDeck, clearBench, deckOf, setActiveFromDeck, setPrizes, typedEnergy } from "./testFixtures";
import type { InPlayPokemon } from "./types";

// ── 🆕🆕🆕 D575 — THE MRV-38 ATTACK SLICE: SIX PRINTINGS, SIX TEXTS, `MATCH_RECORD_VERSION` 37 → 38 ──
//
//   Iron Moth              sv06.5-009  "Anachronism Repulsor" (1) — prevent damage from Ancient Pokémon (R-IM1)
//   Miraidon               sv08-069    "C.O.D.E.: Protect"    (0) — every Future Pokémon, from Pokémon ex,
//                                                                    ends when it leaves the Active (R-MI1/2)
//   Glimmora               sv08-115    "Corrosive Shards"     (0) — Poisoned, and no hand attach to it (R-GL1)
//   Hypno                  sv06.5-017  "Daydream"             (0) — a hand attach to it ENDS the turn (R-HY1/2)
//   Team Rocket's Blipbug  sv10-015    "Searching Eyes"       (0) — look at 1 face-down Prize (R-BL1/2)
//   N's Sigilyph           sv09-064    "Victory Symbol"       (1) — at exactly 1 Prize, you win (R-VS1)
//
// Every card is driven on its REAL id on a LOCAL `cardPool` (D275) in the suite's OWN deck (D270). Texts,
// stats and legality off tcgdex (the audit's card JSON), 2026-10-04. The banners are `banners.ts`'s, by
// printing id: Sandy Shocks `sv05-098` is Ancient, Iron Treads `sv05-118` is Future, Iron Moth and Miraidon
// are Future. Readings R-IM1, R-MI1, R-MI2, R-GL1, R-HY1, R-HY2, R-BL1, R-BL2, R-VS1 (all ⚠️ UNRULED):
// docs/decisions.md D575.

const IRON_MOTH = "sv06.5-009";
const MIRAIDON = "sv08-069";
const GLIMMORA = "sv08-115";
const HYPNO = "sv06.5-017";
const BLIPBUG = "sv10-015";
const SIGILYPH = "sv09-064";
const SANDY_SHOCKS = "sv05-098";
const IRON_TREADS = "sv05-118";
const QUAQUAVAL = "sv01-054";
const OGERPON = "sv06-025";
const DROWZEE = "sv06.5-016";
const V_HITTER = "d575t-vhitter";
/** Gengar ex "Gnawing Curse" — the attach-WATCHED trigger (registry, by printing id) that sends Hypno's turn
    end down the mid-turn Knock Out sweep's tail (R-HY2's "behind any parked prize pick"). */
const GENGAR = "sv05-104";
const BOSS = "sv02-172";
const SWITCH = "sv01-194";
const HITTER = "d575t-hitter";
const EX_SPREADER = "d575t-exspreader";
const SPREADER = "d575t-spreader";
const FILLER = "d575t-filler";
const FIRE = "d575t-fire";
const LIGHTNING = "d575t-lightning";
const PSYCHIC = "d575t-psychic";
const FIGHTING = "d575t-fighting";
const GRASS = "d575t-grass";
const COLORLESS = "fix-energy";

const REPULSOR = "During your opponent's next turn, prevent all damage done to this Pokémon by attacks from Ancient Pokémon.";
const PROTECT =
  "During your opponent's next turn, prevent all damage done to each of your Future Pokémon by attacks from Pokémon ex. If this Pokémon is no longer your Active Pokémon, this effect ends.";
const SHARDS =
  "Your opponent's Active Pokémon is now Poisoned. During your opponent's next turn, Energy cards can't be attached from your opponent's hand to that Pokémon.";
const DAYDREAM =
  "During your opponent's next turn, if they attach an Energy card from their hand to the Defending Pokémon, their turn ends.";
const SEARCHING_EYES = "Look at 1 of your opponent's face-down Prize cards.";
const VICTORY_SYMBOL = "If you use this attack when you have exactly 1 Prize card remaining, you win this game.";
const SPINNING_TAIL =
  "This attack does 30 damage to each of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";

const LOCAL_CARDS: Record<string, Card> = {
  [IRON_MOTH]: battler(IRON_MOTH, {
    name: "Iron Moth",
    types: ["Fire"],
    hp: 120,
    retreat: 2,
    weaknesses: [{ type: "Water", value: "×2" }],
    attacks: [
      {
        cost: ["Colorless", "Colorless"],
        name: "Suction",
        damage: 30,
        effect: "Heal from this Pokémon the same amount of damage you did to your opponent's Active Pokémon.",
      },
      { cost: ["Fire", "Fire", "Colorless"], name: "Anachronism Repulsor", damage: 120, effect: REPULSOR },
    ],
  }),
  [MIRAIDON]: battler(MIRAIDON, {
    name: "Miraidon",
    types: ["Lightning"],
    hp: 120,
    retreat: 1,
    weaknesses: [{ type: "Fighting", value: "×2" }],
    attacks: [
      { cost: ["Lightning", "Colorless"], name: "C.O.D.E.: Protect", damage: 40, effect: PROTECT },
      { cost: ["Lightning", "Colorless", "Colorless"], name: "Thunder Claws", damage: 100 },
    ],
  }),
  [GLIMMORA]: battler(GLIMMORA, {
    name: "Glimmora",
    stage: "Stage1",
    evolveFrom: "Glimmet",
    types: ["Fighting"],
    hp: 130,
    retreat: 2,
    weaknesses: [{ type: "Grass", value: "×2" }],
    attacks: [
      { cost: ["Colorless"], name: "Corrosive Shards", damage: 20, effect: SHARDS },
      { cost: ["Fighting", "Colorless"], name: "Rock Throw", damage: 60 },
    ],
  }),
  [HYPNO]: battler(HYPNO, {
    name: "Hypno",
    stage: "Stage1",
    evolveFrom: "Drowzee",
    types: ["Psychic"],
    hp: 110,
    retreat: 2,
    weaknesses: [{ type: "Darkness", value: "×2" }],
    resistances: [{ type: "Fighting", value: "-30" }],
    attacks: [{ cost: ["Psychic", "Colorless"], name: "Daydream", damage: 80, effect: DAYDREAM }],
  }),
  [BLIPBUG]: battler(BLIPBUG, {
    name: "Team Rocket's Blipbug",
    types: ["Grass"],
    hp: 60,
    retreat: 1,
    weaknesses: [{ type: "Fire", value: "×2" }],
    attacks: [{ cost: ["Colorless"], name: "Searching Eyes", effect: SEARCHING_EYES }],
  }),
  [SIGILYPH]: battler(SIGILYPH, {
    name: "N's Sigilyph",
    types: ["Psychic"],
    hp: 110,
    retreat: 1,
    weaknesses: [{ type: "Lightning", value: "×2" }],
    resistances: [{ type: "Fighting", value: "-30" }],
    attacks: [
      { cost: ["Psychic"], name: "Psychic Sphere", damage: 20 },
      { cost: ["Psychic", "Colorless", "Colorless"], name: "Victory Symbol", effect: VICTORY_SYMBOL },
    ],
  }),
  [SANDY_SHOCKS]: battler(SANDY_SHOCKS, {
    name: "Sandy Shocks",
    types: ["Fighting"],
    hp: 120,
    retreat: 2,
    weaknesses: [{ type: "Grass", value: "×2" }],
    attacks: [
      {
        cost: ["Fighting"],
        name: "Magnetic Burst",
        damage: "20+",
        effect:
          "If you have 3 or more Energy in play, this attack does 70 more damage. This attack's damage isn't affected by Weakness.",
      },
      { cost: ["Fighting", "Colorless"], name: "Power Gem", damage: 60 },
    ],
  }),
  [IRON_TREADS]: battler(IRON_TREADS, {
    name: "Iron Treads",
    types: ["Metal"],
    hp: 130,
    retreat: 2,
    weaknesses: [{ type: "Fire", value: "×2" }],
    attacks: [{ cost: ["Metal", "Colorless"], name: "Wheel Pass", damage: 60 }],
  }),
  [QUAQUAVAL]: battler(QUAQUAVAL, {
    name: "Quaquaval",
    types: ["Water"],
    hp: 170,
    retreat: 2,
    abilities: [
      {
        type: "Ability",
        name: "Energy Carnival",
        effect: "Once during your turn, you may attach a Basic Energy card from your hand to 1 of your Pokémon.",
      },
    ],
  }),
  [OGERPON]: battler(OGERPON, {
    name: "Teal Mask Ogerpon ex",
    types: ["Grass"],
    hp: 210,
    retreat: 1,
    abilities: [
      {
        type: "Ability",
        name: "Teal Dance",
        effect:
          "Once during your turn, you may attach a Basic {G} Energy card from your hand to this Pokémon. If you attached Energy to a Pokémon in this way, draw a card.",
      },
    ],
    attacks: [
      {
        cost: ["Grass", "Grass", "Grass"],
        name: "Myriad Leaf Shower",
        damage: "30+",
        effect: "This attack does 30 more damage for each Energy attached to both Active Pokémon.",
      },
    ],
  }),
  [GENGAR]: battler(GENGAR, {
    name: "Gengar ex",
    hp: 310,
    retreat: 2,
    types: ["Darkness"],
    stage: "Stage2",
    evolveFrom: "Haunter",
    abilities: [
      {
        type: "Ability",
        name: "Gnawing Curse",
        effect:
          "Whenever your opponent attaches an Energy card from their hand to 1 of their Pokémon, put 2 damage counters on that Pokémon.",
      },
    ],
  }),
  [DROWZEE]: battler(DROWZEE, {
    name: "Drowzee",
    types: ["Psychic"],
    hp: 70,
    retreat: 2,
    weaknesses: [{ type: "Darkness", value: "×2" }],
    attacks: [{ cost: ["Psychic"], name: "Eerie Gaze", damage: 10 }],
  }),
  [V_HITTER]: battler(V_HITTER, {
    name: "D575 Hitter V",
    hp: 900,
    types: ["Colorless"],
    attacks: [{ cost: [], name: "Spinning Tail", effect: SPINNING_TAIL }],
  }),
  [HITTER]: battler(HITTER, {
    name: "D575 Hitter",
    hp: 900,
    types: ["Colorless"],
    attacks: [{ cost: [], name: "Crush", damage: 60 }],
  }),
  [EX_SPREADER]: battler(EX_SPREADER, {
    name: "D575 Spreader ex",
    hp: 900,
    types: ["Colorless"],
    attacks: [
      { cost: [], name: "Spinning Tail", effect: SPINNING_TAIL },
      { cost: [], name: "Crush", damage: 60 },
    ],
  }),
  [SPREADER]: battler(SPREADER, {
    name: "D575 Spreader",
    hp: 900,
    types: ["Colorless"],
    attacks: [{ cost: [], name: "Spinning Tail", effect: SPINNING_TAIL }],
  }),
  [FILLER]: battler(FILLER, {
    name: "D575 Filler",
    hp: 900,
    retreat: 1,
    types: ["Colorless"],
    attacks: [{ cost: [], name: "Tap", damage: 10 }],
  }),
  [FIRE]: typedEnergy(FIRE, "Fire"),
  [LIGHTNING]: typedEnergy(LIGHTNING, "Lightning"),
  [PSYCHIC]: typedEnergy(PSYCHIC, "Psychic"),
  [FIGHTING]: typedEnergy(FIGHTING, "Fighting"),
  [GRASS]: typedEnergy(GRASS, "Grass"),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

/** Its OWN deck (D270), 60 by construction. */
const DECK = deckOf({
  [IRON_MOTH]: 1,
  [MIRAIDON]: 1,
  [GLIMMORA]: 1,
  [HYPNO]: 1,
  [BLIPBUG]: 1,
  [SIGILYPH]: 1,
  [SANDY_SHOCKS]: 1,
  [IRON_TREADS]: 2,
  [QUAQUAVAL]: 1,
  [OGERPON]: 1,
  [DROWZEE]: 1,
  [GENGAR]: 1,
  [V_HITTER]: 1,
  [BOSS]: 1,
  [SWITCH]: 1,
  [HITTER]: 1,
  [EX_SPREADER]: 1,
  [SPREADER]: 1,
  [FILLER]: 13,
  [FIRE]: 4,
  [LIGHTNING]: 4,
  [PSYCHIC]: 4,
  [FIGHTING]: 4,
  [GRASS]: 2,
  [COLORLESS]: 10,
});

const NAMES: Record<Seat, string> = { p1: "Ember", p2: "Tide" };

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
  if (result.ok) throw new Error(`${action.type} was accepted`);
  return { code: result.error.code, message: result.error.message };
}

/** Setup with p2 going first; returns p1's turn 2 after p2 passed. */
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

/** TEST SURGERY — every uid of `seat`'s hand back into the deck, the hand then EXACTLY `ids` (from the deck,
    or swapped out of the Prizes — D572's helper). */
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
    const swap = deck.find((u) => !ids.includes(state.cardIdByUid[u] ?? ""));
    if (prized === undefined || swap === undefined) throw new Error(`${seat} has no more ${id}`);
    prizes = prizes.map((u) => (u === prized ? swap : u));
    deck = deck.filter((u) => u !== swap);
    hand.push(prized);
  }
  return { ...state, players: { ...state.players, [seat]: { ...side, hand, deck, prizes } } };
}

/** TEST SURGERY — one copy of `id` into `seat`'s DECK (from the hand, or swapped out of the Prizes). */
function ensureInDeck(state: GameState, seat: Seat, id: string): GameState {
  const side = state.players[seat];
  if (side.deck.some((u) => state.cardIdByUid[u] === id)) return state;
  const held = side.hand.find((u) => state.cardIdByUid[u] === id);
  if (held !== undefined) {
    const next = { ...side, hand: side.hand.filter((u) => u !== held), deck: [...side.deck, held] };
    return { ...state, players: { ...state.players, [seat]: next } };
  }
  const prized = side.prizes.find((u) => state.cardIdByUid[u] === id);
  const swap = side.deck.find((u) => state.cardIdByUid[u] !== id);
  if (prized === undefined || swap === undefined) throw new Error(`${seat} has no ${id} to seat`);
  const next = {
    ...side,
    prizes: side.prizes.map((u) => (u === prized ? swap : u)),
    deck: [...side.deck.filter((u) => u !== swap), prized],
  };
  return { ...state, players: { ...state.players, [seat]: next } };
}

/** p1's turn 2: p1 `active` + `bench`, p2 `oppActive` + `oppBench`. Hands emptied into the decks. */
function table(
  active: string,
  bench: readonly string[] = [],
  oppActive: string = FILLER,
  oppBench: readonly string[] = [],
  seed = 5753,
): GameState {
  let state = setHand(setHand(opened(seed), "p1", []), "p2", []);
  state = setActiveFromDeck(ensureInDeck(state, "p1", active), "p1", active);
  state = setActiveFromDeck(ensureInDeck(state, "p2", oppActive), "p2", oppActive);
  state = clearBench(clearBench(state, "p1"), "p2");
  for (const id of bench) state = benchFromDeck(ensureInDeck(state, "p1", id), "p1", id);
  for (const id of oppBench) state = benchFromDeck(ensureInDeck(state, "p2", id), "p2", id);
  return state;
}

type Spot = "active" | number;

function bodyAt(state: GameState, seat: Seat, spot: Spot): InPlayPokemon {
  const side = state.players[seat];
  const p = spot === "active" ? side.active : side.bench[spot];
  if (p === null || p === undefined) throw new Error(`no body at ${seat} ${String(spot)}`);
  return p;
}

function withBody(state: GameState, seat: Seat, spot: Spot, f: (p: InPlayPokemon) => InPlayPokemon): GameState {
  const side = state.players[seat];
  const next =
    spot === "active"
      ? { ...side, active: f(bodyAt(state, seat, "active")) }
      : { ...side, bench: side.bench.map((p, i) => (i === spot ? f(p) : p)) };
  return { ...state, players: { ...state.players, [seat]: next } };
}

/** TEST SURGERY — attach deck copies of `ids` to the body, in order. */
function attach(state: GameState, seat: Seat, spot: Spot, ...ids: string[]): GameState {
  let next = state;
  for (const id of ids) {
    next = ensureInDeck(next, seat, id);
    const side = next.players[seat];
    const uid = side.deck.find((u) => next.cardIdByUid[u] === id);
    if (uid === undefined) throw new Error(`no ${id} in the deck`);
    next = { ...next, players: { ...next.players, [seat]: { ...side, deck: side.deck.filter((u) => u !== uid) } } };
    next = withBody(next, seat, spot, (p) => ({ ...p, energy: [...p.energy, uid] }));
  }
  return next;
}

function all<T extends GameEvent["type"]>(events: readonly GameEvent[], type: T): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

const top = (p: InPlayPokemon): string => p.stack[p.stack.length - 1] as string;

function render(events: GameEvent[], state: GameState): string[] {
  const ctx: LogContext = { names: NAMES, state, elapsed: formatElapsed(0) };
  return logFromEvents(events, ctx).flatMap((entry) =>
    entry.kind === "turn" ? [] : [`${entry.who}: ${entry.segments.map((s) => s.text).join("")}`],
  );
}

const attack = (seat: Seat, index: number): GameAction => ({ type: "attack", seat, index }) as GameAction;

function prompt(state: GameState) {
  if (state.phase.kind !== "effect:choose") throw new Error(`expected effect:choose, got ${state.phase.kind}`);
  return state.phase.prompt;
}

/** The p2 hand surgery for p2's own turn: the hand becomes EXACTLY `ids`. */
const p2Hand = (state: GameState, ids: readonly string[]): GameState => setHand(state, "p2", ids);
const handUidOf = (state: GameState, seat: Seat, id: string): string => {
  const uid = state.players[seat].hand.find((u) => state.cardIdByUid[u] === id);
  if (uid === undefined) throw new Error(`${seat} holds no ${id}`);
  return uid;
};

// ─────────────────────────────────────────────────────────────────────────────
// §1 — the six sentences: corpus bytes, one printing each, each claimed WHOLE.
// ─────────────────────────────────────────────────────────────────────────────
describe("D575 §1 — the six printed sentences, measured", () => {
  const rows = new Map(legalAttackCorpus().map(([n, s]) => [s, n]));
  it("🛑 every sentence is a corpus row of ONE legal printing, and the only one of its text", () => {
    for (const text of [REPULSOR, PROTECT, SHARDS, DAYDREAM, SEARCHING_EYES, VICTORY_SYMBOL]) {
      expect(rows.get(text), text).toBe(1);
      expect(resolvedByAnyReader(text), text).toBe(true);
    }
  });

  it("🛑 each derives to its program, claimed WHOLE by `deriveAttackEffect`", () => {
    expect(deriveAttackEffect(REPULSOR)).toEqual([{ op: "preventDamage", fromClass: { stage: "ancient" } }]);
    expect(deriveAttackEffect(PROTECT)).toEqual([
      { op: "installSideAttackBlock", banner: "Future", fromClass: { stage: "ex" } },
    ]);
    expect(deriveAttackEffect(SHARDS)).toEqual([
      { op: "applyStatus", target: "defender", status: "poisoned" },
      { op: "markHandAttach", barred: true },
    ]);
    expect(deriveAttackEffect(DAYDREAM)).toEqual([{ op: "markHandAttach", endsTurn: true }]);
    expect(deriveAttackEffect(SEARCHING_EYES)).toEqual([{ op: "lookAtPrize", side: "opponent" }]);
    expect(deriveAttackEffect(VICTORY_SYMBOL)).toEqual([
      {
        op: "conditionGate",
        cond: { kind: "yourPrizesRemaining", counts: [1] },
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: [{ op: "winGame" }],
      },
    ]);
  });

  it("the anchors are WHOLE-sentence: one word off is refused, and the curly apostrophe is admitted", () => {
    expect(deriveAttackEffect(REPULSOR.replace("Ancient", "Future"))).toBeNull();
    expect(deriveAttackEffect(PROTECT.replace("Pokémon ex", "Pokémon V"))).toBeNull();
    expect(deriveAttackEffect(DAYDREAM.replace(" their turn ends.", ""))).toBeNull();
    expect(deriveAttackEffect(VICTORY_SYMBOL.replace("exactly 1", "exactly 2"))).toBeNull();
    expect(deriveAttackEffect(SEARCHING_EYES.replace("opponent's", "opponent’s"))).toEqual([
      { op: "lookAtPrize", side: "opponent" },
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — Iron Moth "Anachronism Repulsor": the `"ancient"` attacker class (R-IM1).
// ─────────────────────────────────────────────────────────────────────────────
describe("D575 §2 — Iron Moth: prevent all damage from ANCIENT Pokémon, next turn", () => {
  /** p1's Iron Moth uses Anachronism Repulsor on a 900-HP Filler; on p2's turn `attacker` (benched until
      then) is swapped into the Active Spot by surgery and energised. */
  function repulsed(attacker: string, ...energy: string[]): GameState {
    const state = attach(table(IRON_MOTH, [], FILLER, [attacker]), "p1", "active", FIRE, FIRE, COLORLESS);
    const after = run(state, attack("p1", 1)).state;
    expect(after.phase).toMatchObject({ kind: "turn:action", seat: "p2" });
    const side = after.players.p2;
    const swapped: GameState = {
      ...after,
      players: { ...after.players, p2: { ...side, active: side.bench[0] ?? null, bench: [side.active as InPlayPokemon] } },
    };
    return attach(swapped, "p2", "active", ...energy);
  }

  it("🛑 an ANCIENT attacker (Sandy Shocks, by printing id) does NOTHING to Iron Moth on the opponent's next turn", () => {
    const state = repulsed(SANDY_SHOCKS, FIGHTING, COLORLESS);
    const block = bodyAt(state, "p1", "active").attackBlock;
    expect(block).toEqual({ turn: state.turn, effects: false, fromClass: { stage: "ancient" }, maxDamage: undefined });
    const { state: hit } = run(state, attack("p2", 1));
    expect(bodyAt(hit, "p1", "active").damage).toBe(0);
  });

  it("🛑 a NON-Ancient attacker hits at full damage — the class NARROWS the block", () => {
    const { state: hit } = run(repulsed(HITTER), attack("p2", 0));
    expect(bodyAt(hit, "p1", "active").damage).toBe(60);
  });

  it("the class is read through `bannerOf` at damage time, and the row names it", () => {
    const live = repulsed(SANDY_SHOCKS);
    const moth = bodyAt(live, "p1", "active");
    const shocks = POOL[SANDY_SHOCKS] as Card;
    const hitter = POOL[HITTER] as Card;
    expect(attackBlockOf(live, moth, shocks, 60)).not.toBeNull();
    expect(attackBlockOf(live, moth, hitter, 60)).toBeNull();
    const state = attach(table(IRON_MOTH, [], FILLER), "p1", "active", FIRE, FIRE, COLORLESS);
    const { state: after, events } = run(state, attack("p1", 1));
    expect(render(events, after)).toContain(
      "p1: Iron Moth is protected from damage from Ancient Pokémon's attacks during your opponent's next turn",
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — Miraidon "C.O.D.E.: Protect": the side-wide block (R-MI1 / R-MI2).
// ─────────────────────────────────────────────────────────────────────────────
describe("D575 §3 — Miraidon: every Future Pokémon, from Pokémon ex, while Miraidon stays Active", () => {
  /** p1's Miraidon (Future) Active with Iron Treads (Future) and a non-Future Filler benched; p2 `attacker`. */
  function protectedSide(attacker: string = EX_SPREADER): GameState {
    const state = attach(table(MIRAIDON, [IRON_TREADS, FILLER], attacker, [FILLER]), "p1", "active", LIGHTNING, COLORLESS);
    const after = run(state, attack("p1", 0)).state;
    expect(after.phase).toMatchObject({ kind: "turn:action", seat: "p2" });
    return after;
  }

  it("🛑 a Pokémon ex's spread does NOTHING to either Future body and full damage to the other", () => {
    const state = protectedSide();
    expect(state.players.p1.sideAttackBlock).toEqual({
      turn: state.turn,
      sourceUid: top(bodyAt(state, "p1", "active")),
      banner: "Future",
      fromClass: { stage: "ex" },
    });
    const { state: hit } = run(state, attack("p2", 0));
    expect(bodyAt(hit, "p1", "active").damage).toBe(0); // Miraidon — Future
    expect(bodyAt(hit, "p1", 0).damage).toBe(0); // Iron Treads — Future
    expect(bodyAt(hit, "p1", 1).damage).toBe(30); // the Filler — no banner
  });

  it("🛑 a NON-ex attacker's spread hits every body — the class narrows the block", () => {
    const { state: hit } = run(protectedSide(SPREADER), attack("p2", 0));
    expect(bodyAt(hit, "p1", "active").damage).toBe(30);
    expect(bodyAt(hit, "p1", 0).damage).toBe(30);
    expect(bodyAt(hit, "p1", 1).damage).toBe(30);
  });

  it("🛑 R-MI2 — the Future set is read LIVE: a Future body benched AFTER the install is covered", () => {
    let state = protectedSide();
    // Surgery on p2's turn: a second Iron Treads joins p1's Bench after the install.
    state = benchFromDeck(ensureInDeck(state, "p1", IRON_TREADS), "p1", IRON_TREADS);
    const { state: hit } = run(state, attack("p2", 0));
    expect(bodyAt(hit, "p1", 2).damage).toBe(0);
  });

  /** p2 plays Boss's Orders on the protected side and drags up the Filler (bench index 1): Miraidon goes
      to the Bench. Returns the board and EVERY event the gust emitted (the play and the pick). */
  function gusted(from: GameState): { state: GameState; events: GameEvent[] } {
    let state = p2Hand(from, [BOSS]);
    const played = run(state, { type: "playTrainer", seat: "p2", uid: handUidOf(state, "p2", BOSS) });
    state = played.state;
    const events = [...played.events];
    // Two benched candidates, so the pick PARKS — asserted, not assumed (an `if` here would let a
    // board that never asked skip the whole gust).
    expect(prompt(state).kind).toBe("choosePokemon");
    const picked = run(state, {
      type: "resolveEffect",
      seat: "p2",
      choice: { kind: "pokemon", ref: { seat: "p1", spot: { spot: "bench", index: 1 } } },
    } as GameAction);
    events.push(...picked.events);
    return { state: picked.state, events };
  }

  it("🛑 R-MI1 — a GUST ends it: Boss's Orders drags Miraidon to the Bench, the record is CLEARED, the row says so", () => {
    const before = protectedSide();
    const miraidonUid = top(bodyAt(before, "p1", "active"));
    const { state, events } = gusted(before);
    expect(state.cardIdByUid[top(bodyAt(state, "p1", "active"))]).toBe(FILLER);
    expect(state.players.p1.sideAttackBlock).toBeNull();
    // The END is an event and a row, named off the record's SOURCE (switchInto's `SIDE_ATTACK_BLOCK_ENDED`).
    expect(all(events, "SIDE_ATTACK_BLOCK_ENDED")).toEqual([
      { type: "SIDE_ATTACK_BLOCK_ENDED", seat: "p1", uid: miraidonUid },
    ]);
    expect(render(events, state)).toContain("p1: Miraidon left the Active Spot — its protection ended");
    const { state: hit } = run(state, attack("p2", 0));
    // Every p1 body takes the ex's 30 now — the Future ones included.
    for (const body of [hit.players.p1.active, ...hit.players.p1.bench]) expect(body?.damage).toBe(30);
  });

  it("🛑 R-MI1 — and it STAYS ended when Miraidon is re-promoted (a read-time check alone would revive it)", () => {
    let state = gusted(protectedSide()).state;
    // TEST SURGERY — Miraidon back into the Active Spot (the record was cleared, so nothing to revive).
    const benchIndex = state.players.p1.bench.findIndex((b) => state.cardIdByUid[top(b)] === MIRAIDON);
    const side = state.players.p1;
    const miraidon = side.bench[benchIndex] as InPlayPokemon;
    state = {
      ...state,
      players: {
        ...state.players,
        p1: {
          ...side,
          active: miraidon,
          bench: [...side.bench.filter((_, i) => i !== benchIndex), side.active as InPlayPokemon],
        },
      },
    };
    expect(state.players.p1.sideAttackBlock).toBeNull();
    expect(bodyAt(run(state, attack("p2", 0)).state, "p1", "active").damage).toBe(30);
  });

  it("🛑 \"Pokémon ex\" is EXACTLY the printed class — a Pokémon V's spread is NOT refused (never `isExOrV`, never `hasRuleBox`)", () => {
    const { state: hit } = run(protectedSide(V_HITTER), attack("p2", 0));
    expect(bodyAt(hit, "p1", "active").damage).toBe(30);
    expect(bodyAt(hit, "p1", 0).damage).toBe(30);
  });

  it("the read-time half: a record whose SOURCE is no longer the Active answers nothing (a Knock Out, a bounce)", () => {
    const state = protectedSide();
    const record = state.players.p1.sideAttackBlock;
    if (record === null) throw new Error("no record");
    const moved: GameState = {
      ...state,
      players: { ...state.players, p1: { ...state.players.p1, sideAttackBlock: { ...record, sourceUid: "elsewhere" } } },
    };
    const exSpreader = POOL[EX_SPREADER] as Card;
    expect(attackBlockOf(moved, bodyAt(moved, "p1", 0), exSpreader, 30)).toBeNull();
    expect(attackBlockOf(state, bodyAt(state, "p1", 0), exSpreader, 30)).not.toBeNull();
  });

  it("the install and the end are rows, named off the record", () => {
    const state = attach(table(MIRAIDON, [IRON_TREADS, FILLER], EX_SPREADER, [FILLER]), "p1", "active", LIGHTNING, COLORLESS);
    const { state: after, events } = run(state, attack("p1", 0));
    expect(render(events, after)).toContain(
      "p1: Future Pokémon are protected from damage from Pokémon ex's attacks during the opponent's next turn, while Miraidon stays in the Active Spot",
    );
    // …and the END row, from the gust that walks the source out of the Active Spot.
    const ended = gusted(after);
    expect(render(ended.events, ended.state)).toContain("p1: Miraidon left the Active Spot — its protection ended");
  });

  it("an EXPIRED record is cleared SILENTLY when its source leaves the Active — nothing ended, so no row", () => {
    const live = protectedSide();
    const record = live.players.p1.sideAttackBlock;
    if (record === null) throw new Error("no record");
    // TEST SURGERY — the window already passed (the stamp names an earlier turn).
    const expired: GameState = {
      ...live,
      players: { ...live.players, p1: { ...live.players.p1, sideAttackBlock: { ...record, turn: live.turn - 2 } } },
    };
    const { state, events } = gusted(expired);
    expect(state.players.p1.sideAttackBlock).toBeNull();
    expect(all(events, "SIDE_ATTACK_BLOCK_ENDED")).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — Glimmora "Corrosive Shards": Poisoned, and the hand-attach BAR (R-GL1).
// ─────────────────────────────────────────────────────────────────────────────
describe("D575 §4 — Glimmora: no Energy from hand to that Pokémon, next turn", () => {
  function shattered(oppBench: readonly string[] = [FILLER]): GameState {
    const state = attach(table(GLIMMORA, [], FILLER, oppBench), "p1", "active", COLORLESS);
    const after = run(state, attack("p1", 0)).state;
    expect(after.phase).toMatchObject({ kind: "turn:action", seat: "p2" });
    return after;
  }

  it("🛑 the Defending Pokémon is Poisoned AND marked for the victim's own turn", () => {
    const state = shattered();
    const victim = bodyAt(state, "p2", "active");
    expect(victim.conditions.poisonDamage).toBeGreaterThan(0);
    expect(victim.handAttachMark).toEqual({ turn: state.turn, barred: true, endsTurn: false, tripped: false });
    expect(liveHandAttachMark(state, victim)).not.toBeNull();
  });

  it("🛑 the ATTACH ACTION to it is refused with its own code, and the §6.2 allowance is NOT spent", () => {
    const state = p2Hand(shattered(), [COLORLESS, COLORLESS]);
    const energy = handUidOf(state, "p2", COLORLESS);
    const no = refused(state, { type: "attachEnergy", seat: "p2", uid: energy, target: { spot: "active" } });
    expect(no.code).toBe("ENERGY_ATTACH_BARRED");
    expect(state.allowances.energyAttached).toBe(false);
    // …another body takes it freely.
    const { state: ok } = run(state, { type: "attachEnergy", seat: "p2", uid: energy, target: { spot: "bench", index: 0 } });
    expect(bodyAt(ok, "p2", 0).energy).toContain(energy);
  });

  it("🛑 R-GL1 — an EFFECT's hand attach skips the barred body (Quaquaval \"Energy Carnival\")", () => {
    let state = p2Hand(shattered([QUAQUAVAL]), [COLORLESS]);
    const energy = handUidOf(state, "p2", COLORLESS);
    state = run(state, {
      type: "useAbility",
      seat: "p2",
      target: { spot: "bench", index: 0 },
      abilityName: "Energy Carnival",
    } as GameAction).state;
    // One legal target left (Quaquaval itself), so the attach is FORCED onto it — never the Active.
    expect(bodyAt(state, "p2", "active").energy).not.toContain(energy);
    expect(bodyAt(state, "p2", 0).energy).toContain(energy);
  });

  it("🛑 R-GL1 — and a `toSelf` hand attach onto the barred body itself attaches NOTHING (Teal Mask Ogerpon ex \"Teal Dance\")", () => {
    let state = attach(table(GLIMMORA, [], OGERPON, [FILLER]), "p1", "active", COLORLESS);
    state = p2Hand(run(state, attack("p1", 0)).state, [GRASS]);
    const energy = handUidOf(state, "p2", GRASS);
    const handBefore = state.players.p2.hand.length;
    const { state: after, events } = run(state, {
      type: "useAbility",
      seat: "p2",
      target: { spot: "active" },
      abilityName: "Teal Dance",
    } as GameAction);
    expect(bodyAt(after, "p2", "active").energy).not.toContain(energy);
    // "If you attached Energy … in this way, draw a card." — nothing attached, nothing drawn.
    expect(all(events, "ENERGY_ATTACHED")).toEqual([]);
    expect(after.players.p2.hand.length).toBe(handBefore);
  });

  it("§10 — a Switch walks the marked body out: the mark is SHED, and the benched body takes Energy again", () => {
    let state = p2Hand(shattered(), [SWITCH, COLORLESS]);
    state = run(state, { type: "playTrainer", seat: "p2", uid: handUidOf(state, "p2", SWITCH) }).state;
    expect(bodyAt(state, "p2", 0).handAttachMark).toBeNull();
    const energy = handUidOf(state, "p2", COLORLESS);
    const { state: ok } = run(state, { type: "attachEnergy", seat: "p2", uid: energy, target: { spot: "bench", index: 0 } });
    expect(bodyAt(ok, "p2", 0).energy).toContain(energy);
  });

  it("§10 — DEVOLVE (`devolvedBodyOf`) sheds the mark too: the marked Hypno devolves to Drowzee, unmarked", () => {
    let state = table(GLIMMORA, [], HYPNO, [FILLER]);
    // TEST SURGERY — a Drowzee UNDER p2's Hypno (an evolution stack).
    state = ensureInDeck(state, "p2", DROWZEE);
    const drowzee = state.players.p2.deck.find((u) => state.cardIdByUid[u] === DROWZEE) as string;
    state = {
      ...state,
      players: { ...state.players, p2: { ...state.players.p2, deck: state.players.p2.deck.filter((u) => u !== drowzee) } },
    };
    state = withBody(state, "p2", "active", (p) => ({ ...p, stack: [drowzee, ...p.stack] }));
    state = run(attach(state, "p1", "active", COLORLESS), attack("p1", 0)).state;
    expect(liveHandAttachMark(state, bodyAt(state, "p2", "active"))?.barred).toBe(true);
    const events: GameEvent[] = [];
    const devolved = runProgram(state, [{ op: "devolveEach" }], { seat: "p1" }, events);
    if (devolved.kind !== "done") throw new Error("devolveEach parked");
    const body = bodyAt(devolved.state, "p2", "active");
    expect(devolved.state.cardIdByUid[top(body)]).toBe(DROWZEE);
    expect(body.handAttachMark).toBeNull();
  });

  it("the mark is a row, victim-voiced", () => {
    const state = attach(table(GLIMMORA, [], FILLER), "p1", "active", COLORLESS);
    const { state: after, events } = run(state, attack("p1", 0));
    expect(render(events, after)).toContain(
      "p2: D575 Filler can't have Energy cards attached from hand during its owner's next turn",
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — Hypno "Daydream": a hand attach to the Defending Pokémon ENDS the turn (R-HY1 / R-HY2).
// ─────────────────────────────────────────────────────────────────────────────
describe("D575 §5 — Hypno: attaching from hand to the Defending Pokémon ends the turn", () => {
  function dreamt(oppBench: readonly string[] = [FILLER]): GameState {
    const state = attach(table(HYPNO, [], FILLER, oppBench), "p1", "active", PSYCHIC, COLORLESS);
    const after = run(state, attack("p1", 0)).state;
    expect(after.phase).toMatchObject({ kind: "turn:action", seat: "p2" });
    return after;
  }

  it("🛑 the attach LANDS, then the turn ENDS — after the attach, through the staged tail (R-HY2)", () => {
    const state = p2Hand(dreamt(), [COLORLESS]);
    const energy = handUidOf(state, "p2", COLORLESS);
    const { state: after, events } = run(state, {
      type: "attachEnergy",
      seat: "p2",
      uid: energy,
      target: { spot: "active" },
    });
    expect(bodyAt(after, "p2", "active").energy).toContain(energy);
    const types = events.map((e) => e.type);
    expect(types.indexOf("ENERGY_ATTACHED")).toBeLessThan(types.indexOf("TURN_ENDED"));
    expect(all(events, "TURN_ENDED")).toHaveLength(1);
    expect(all(events, "TURN_ENDED")[0]).toMatchObject({ type: "TURN_ENDED", seat: "p2" });
    expect(after.phase).toMatchObject({ kind: "turn:action", seat: "p1" });
  });

  it("🛑 an attach to ANOTHER body does not end the turn — the mark is on the Defending Pokémon", () => {
    const state = p2Hand(dreamt(), [COLORLESS]);
    const energy = handUidOf(state, "p2", COLORLESS);
    const { state: after, events } = run(state, {
      type: "attachEnergy",
      seat: "p2",
      uid: energy,
      target: { spot: "bench", index: 0 },
    });
    expect(all(events, "TURN_ENDED")).toEqual([]);
    expect(after.phase).toMatchObject({ kind: "turn:action", seat: "p2" });
  });

  it("🛑 R-HY1 — an EFFECT's hand attach onto it ends the turn too, when the program settles", () => {
    let state = p2Hand(dreamt([QUAQUAVAL]), [COLORLESS]);
    const energy = handUidOf(state, "p2", COLORLESS);
    state = run(state, {
      type: "useAbility",
      seat: "p2",
      target: { spot: "bench", index: 0 },
      abilityName: "Energy Carnival",
    } as GameAction).state;
    // Two targets (the Active and Quaquaval): the pick parks; take the marked Active.
    expect(prompt(state).kind).toBe("choosePokemon");
    const { state: after, events } = run(state, {
      type: "resolveEffect",
      seat: "p2",
      choice: { kind: "pokemon", ref: { seat: "p2", spot: { spot: "active" } } },
    } as GameAction);
    expect(bodyAt(after, "p2", "active").energy).toContain(energy);
    expect(all(events, "TURN_ENDED")).toHaveLength(1);
    expect(all(events, "TURN_ENDED")[0]).toMatchObject({ type: "TURN_ENDED", seat: "p2" });
    expect(after.phase).toMatchObject({ kind: "turn:action", seat: "p1" });
  });

  it("🛑 R-HY1 — a `toSelf` hand attach onto the Defending Pokémon (Teal Dance) ends the turn AFTER its draw", () => {
    let state = attach(table(HYPNO, [], OGERPON, [FILLER]), "p1", "active", PSYCHIC, COLORLESS);
    state = p2Hand(run(state, attack("p1", 0)).state, [GRASS]);
    const energy = handUidOf(state, "p2", GRASS);
    const { state: after, events } = run(state, {
      type: "useAbility",
      seat: "p2",
      target: { spot: "active" },
      abilityName: "Teal Dance",
    } as GameAction);
    expect(bodyAt(after, "p2", "active").energy).toContain(energy);
    const types = events.map((e) => e.type);
    expect(types.indexOf("CARDS_DRAWN")).toBeLessThan(types.indexOf("TURN_ENDED"));
    expect(after.phase).toMatchObject({ kind: "turn:action", seat: "p1" });
  });

  it("🛑 R-HY2 — a WATCHED trigger fires on the attach (Gengar ex \"Gnawing Curse\"): the counters land, THEN the turn ends", () => {
    // The opponent-direction watched sweep sends the attach down `resolveMidTurnKnockOuts` — its
    // tail is Hypno's turn end in place of `resumeTurn`, even when nothing is Knocked Out.
    let state = attach(table(HYPNO, [GENGAR], FILLER, [FILLER]), "p1", "active", PSYCHIC, COLORLESS);
    state = p2Hand(run(state, attack("p1", 0)).state, [COLORLESS]);
    const energy = handUidOf(state, "p2", COLORLESS);
    const before = bodyAt(state, "p2", "active").damage;
    const { state: after, events } = run(state, {
      type: "attachEnergy",
      seat: "p2",
      uid: energy,
      target: { spot: "active" },
    });
    expect(bodyAt(after, "p2", "active").energy).toContain(energy);
    expect(bodyAt(after, "p2", "active").damage).toBe(before + 20);
    const types = events.map((e) => e.type);
    expect(types.indexOf("ENERGY_ATTACHED")).toBeLessThan(types.indexOf("TURN_ENDED"));
    expect(all(events, "TURN_ENDED")).toEqual([expect.objectContaining({ type: "TURN_ENDED", seat: "p2" })]);
    expect(after.phase).toMatchObject({ kind: "turn:action", seat: "p1" });
  });

  it("🛑 R-HY2 — and when the counters Knock it Out, the turn ends BEHIND the parked prize pick and the promotion", () => {
    let state = attach(table(HYPNO, [GENGAR], FILLER, [FILLER, FILLER]), "p1", "active", PSYCHIC, COLORLESS);
    state = p2Hand(run(state, attack("p1", 0)).state, [COLORLESS]);
    // TEST SURGERY — the Defending Pokémon one Gnawing Curse from its 900 HP.
    state = withBody(state, "p2", "active", (p) => ({ ...p, damage: 890 }));
    const energy = handUidOf(state, "p2", COLORLESS);
    const attached = run(state, { type: "attachEnergy", seat: "p2", uid: energy, target: { spot: "active" } });
    // The sweep PARKS p1's prize pick (six face-down, one owed) — the turn has NOT ended yet.
    expect(attached.state.phase).toMatchObject({ kind: "ko:takePrizes", seat: "p1", count: 1 });
    expect(all(attached.events, "TURN_ENDED")).toEqual([]);
    const taken = run(attached.state, { type: "takePrizes", seat: "p1", prizeIndices: [0] } as GameAction);
    // Two benched bodies, so p2's promotion parks too — still p2's turn, still not ended.
    expect(all(taken.events, "TURN_ENDED")).toEqual([]);
    expect(taken.state.phase.kind).not.toBe("turn:action");
    const promoted = run(taken.state, { type: "promote", seat: "p2", benchIndex: 0 } as GameAction);
    // …and only now the tail runs: the turn passes to p1.
    expect(all(promoted.events, "TURN_ENDED")).toEqual([expect.objectContaining({ type: "TURN_ENDED", seat: "p2" })]);
    expect(promoted.state.phase).toMatchObject({ kind: "turn:action", seat: "p1" });
  });

  it("…and the same Ability onto the OTHER body leaves the turn running", () => {
    let state = p2Hand(dreamt([QUAQUAVAL]), [COLORLESS]);
    state = run(state, {
      type: "useAbility",
      seat: "p2",
      target: { spot: "bench", index: 0 },
      abilityName: "Energy Carnival",
    } as GameAction).state;
    const { state: after, events } = run(state, {
      type: "resolveEffect",
      seat: "p2",
      choice: { kind: "pokemon", ref: { seat: "p2", spot: { spot: "bench", index: 0 } } },
    } as GameAction);
    expect(all(events, "TURN_ENDED")).toEqual([]);
    expect(after.phase).toMatchObject({ kind: "turn:action", seat: "p2" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — Team Rocket's Blipbug "Searching Eyes": the BLIND pick and the PRIVATE look (R-BL1 / R-BL2).
// ─────────────────────────────────────────────────────────────────────────────
describe("D575 §6 — Blipbug: look at 1 of the opponent's face-down Prize cards", () => {
  const eyes = (prizes = 6): GameState =>
    setPrizes(attach(table(BLIPBUG, [], FILLER), "p1", "active", COLORLESS), "p2", prizes);

  it("🛑 two or more face-down: the attacker picks a SLOT, blind, on the shipped `choosePrize` park", () => {
    const { state } = run(eyes(), attack("p1", 0));
    expect(prompt(state)).toEqual({
      kind: "choosePrize",
      indices: [0, 1, 2, 3, 4, 5],
      note: "Choose 1 of your opponent's face-down Prize cards to look at.",
    });
    // The OPPONENT's wire carries no prompt at all (the answerer gate).
    const theirs = redactGame(state, "p2").phase;
    expect("prompt" in theirs ? theirs.prompt : null).toBeNull();
  });

  it("🛑 the slot buys the LOOK: a one-card `orderCards` park the redactor resolves for the ATTACKER alone", () => {
    let state = run(eyes(), attack("p1", 0)).state;
    const prizeUid = state.players.p2.prizes[2] as string;
    const answered = run(state, { type: "resolveEffect", seat: "p1", choice: { kind: "prize", index: 2 } } as GameAction);
    state = answered.state;
    expect(prompt(state)).toEqual({
      kind: "orderCards",
      candidates: [prizeUid],
      note: "You looked at this face-down Prize card. Put it back face down.",
    });
    const mine = redactGame(state, "p1").phase;
    if (mine.kind !== "effect:choose" || !("prompt" in mine) || mine.prompt === null) throw new Error("no prompt");
    expect(JSON.stringify(mine.prompt)).toContain(state.cardIdByUid[prizeUid] as string);
    const theirs = redactGame(state, "p2").phase;
    expect("prompt" in theirs ? theirs.prompt : null).toBeNull();
    // The public row names the SLOT, never the card (R-BL2).
    expect(all(answered.events, "PRIZE_LOOKED_AT")).toEqual([{ type: "PRIZE_LOOKED_AT", seat: "p2", actor: "p1", index: 2 }]);
    const rows = render(answered.events, state);
    expect(rows).toContain("p1: looked at Tide's face-down Prize 3");
    const name = POOL[state.cardIdByUid[prizeUid] as string]?.name as string;
    expect(rows.some((r) => r.includes(name) && r.includes("Prize"))).toBe(false);
  });

  it("🛑 putting it back changes nothing, and the turn passes", () => {
    let state = run(eyes(), attack("p1", 0)).state;
    const before = [...state.players.p2.prizes];
    state = run(state, { type: "resolveEffect", seat: "p1", choice: { kind: "prize", index: 4 } } as GameAction).state;
    const uid = before[4] as string;
    const { state: after } = run(state, { type: "resolveEffect", seat: "p1", choice: { kind: "orderCards", uids: [uid] } } as GameAction);
    expect(after.players.p2.prizes).toEqual(before);
    expect(after.players.p2.faceUpPrizes).toEqual([]);
    expect(after.phase).toMatchObject({ kind: "turn:action", seat: "p2" });
  });

  it("one face-down Prize: no blind question — straight to the look; zero: a silent no-op", () => {
    const one = run(eyes(1), attack("p1", 0));
    expect(prompt(one.state).kind).toBe("orderCards");
    expect(all(one.events, "PRIZE_LOOKED_AT")).toHaveLength(1);
    const none = run(eyes(0), attack("p1", 0));
    expect(all(none.events, "PRIZE_LOOKED_AT")).toEqual([]);
    expect(none.state.phase.kind).not.toBe("effect:choose");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7 — N's Sigilyph "Victory Symbol": the printed win (R-VS1).
// ─────────────────────────────────────────────────────────────────────────────
describe("D575 §7 — N's Sigilyph: at exactly 1 Prize card remaining, you win", () => {
  const symbol = (prizes: number): GameState =>
    setPrizes(attach(table(SIGILYPH, [], FILLER), "p1", "active", PSYCHIC, COLORLESS, COLORLESS), "p1", prizes);

  it("🛑 at 1 Prize: the game ENDS on the attack, through `finishGame`, by the NEW reason `cardEffect`", () => {
    const { state, events } = run(symbol(1), attack("p1", 1));
    expect(state.phase).toEqual({ kind: "gameOver", outcome: { result: "win", winner: "p1", reason: "cardEffect" } });
    expect(all(events, "GAME_OVER")).toEqual([
      { type: "GAME_OVER", outcome: { result: "win", winner: "p1", reason: "cardEffect" } },
    ]);
    // Nothing else resolves: no TURN_ENDED, nothing pending.
    expect(all(events, "TURN_ENDED")).toEqual([]);
    expect(state.pending).toEqual([]);
    // The wire carries the reason, and the WIDENED schema admits it: each viewer's redacted
    // outcome names `cardEffect`, and the WHOLE redacted game parses through the widened
    // `redactedGameSchema` (an old client's z.enum would reject it — hence client-first).
    for (const [viewer, winner] of [
      ["p1", "you"],
      ["p2", "opponent"],
    ] as const) {
      const wire = redactGame(state, viewer);
      expect(wire.phase.kind).toBe("gameOver");
      expect(wire.outcome).toEqual({ result: "win", winner, reason: "cardEffect" });
      expect(redactedGameSchema.parse(wire).outcome).toEqual({ result: "win", winner, reason: "cardEffect" });
    }
    expect(redactedGameOverReasonSchema.parse("cardEffect")).toBe("cardEffect");
  });

  it("🛑 at 2 Prizes (and at 6): nothing — the attack does no damage and the turn passes", () => {
    for (const prizes of [2, 6]) {
      const { state, events } = run(symbol(prizes), attack("p1", 1));
      expect(all(events, "GAME_OVER")).toEqual([]);
      expect(state.phase).toMatchObject({ kind: "turn:action", seat: "p2" });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §8 — THE ELEVENTH POSITION (`MATCH_RECORD_VERSION` 37 → 38), driven.
// ─────────────────────────────────────────────────────────────────────────────
describe("D575 §8 — the persisted addresses, and THE FIFTH POSITION's optional test, run on each", () => {
  it("🛑 the side key and the body mark round-trip through JSON and still bite", () => {
    const protectedState = (() => {
      const s = attach(table(MIRAIDON, [IRON_TREADS], EX_SPREADER), "p1", "active", LIGHTNING, COLORLESS);
      return run(s, attack("p1", 0)).state;
    })();
    const revived = JSON.parse(JSON.stringify(protectedState)) as GameState;
    expect(revived.players.p1.sideAttackBlock).toEqual(protectedState.players.p1.sideAttackBlock);
    expect(bodyAt(run(revived, attack("p2", 0)).state, "p1", 0).damage).toBe(0);
  });

  it("🛑 (i) `PlayerSide.sideAttackBlock` OPTIONAL — a 0.458 rollback ignores it and DROPS a live protection (NOT inert)", () => {
    const s = attach(table(MIRAIDON, [IRON_TREADS], EX_SPREADER), "p1", "active", LIGHTNING, COLORLESS);
    const live = run(s, attack("p1", 0)).state;
    // 0.458 never reads the key: this engine with the key at its fresh value is that reading.
    const rolled: GameState = { ...live, players: { ...live.players, p1: { ...live.players.p1, sideAttackBlock: null } } };
    expect(bodyAt(run(live, attack("p2", 0)).state, "p1", 0).damage).toBe(0);
    expect(bodyAt(run(rolled, attack("p2", 0)).state, "p1", 0).damage).toBe(30);
  });

  it("🛑 (ii) `InPlayPokemon.handAttachMark` OPTIONAL — a 0.458 rollback ignores it and GRANTS a barred attach (NOT inert)", () => {
    const s = attach(table(GLIMMORA, [], FILLER, [FILLER]), "p1", "active", COLORLESS);
    const live = p2Hand(run(s, attack("p1", 0)).state, [COLORLESS]);
    const rolled = withBody(live, "p2", "active", (p) => ({ ...p, handAttachMark: null }));
    const energy = handUidOf(live, "p2", COLORLESS);
    const act: GameAction = { type: "attachEnergy", seat: "p2", uid: energy, target: { spot: "active" } };
    expect(refused(live, act).code).toBe("ENERGY_ATTACH_BARRED");
    expect(bodyAt(run(rolled, act).state, "p2", "active").energy).toContain(energy);
  });

  it("🛑 (ii-b) the SAME mark's Daydream half — a 0.458 rollback ignores it and KEEPS a turn the print ends (NOT inert)", () => {
    const s = attach(table(HYPNO, [], FILLER, [FILLER]), "p1", "active", PSYCHIC, COLORLESS);
    const live = p2Hand(run(s, attack("p1", 0)).state, [COLORLESS]);
    const rolled = withBody(live, "p2", "active", (p) => ({ ...p, handAttachMark: null }));
    const energy = handUidOf(live, "p2", COLORLESS);
    const act: GameAction = { type: "attachEnergy", seat: "p2", uid: energy, target: { spot: "active" } };
    expect(run(live, act).state.phase).toMatchObject({ kind: "turn:action", seat: "p1" });
    const kept = run(rolled, act);
    expect(all(kept.events, "TURN_ENDED")).toEqual([]);
    expect(kept.state.phase).toMatchObject({ kind: "turn:action", seat: "p2" });
  });

  it("🛑 (iii) `AttackerClass.stage` WIDENED — a member the stage switch has no arm for FALLS OUT and reads as NO block", () => {
    // 0.458's `attackerMatchesStage` is THIS switch minus the two D575 arms: `switch (stage) { case
    // "basic": … }`, no default. A v38 `"ancient"` record under it falls out, answers `undefined`
    // (falsy), and the block refuses nothing — D569 (e)'s finding, and why the member could only land
    // behind a bump. What is DRIVEN here is that fall-out, through THIS build's real `attackBlockOf`
    // (the switch's shape is the part 0.458 shares): a stage word this build has no arm for — the
    // position a v38 member occupies in 0.458 — reads as NO block, while the same record with the
    // member this build DOES read refuses the Ancient attacker. A `default: return true` (the silent
    // widening) or a defensive "unknown stage protects" arm turns the first assertion red.
    const live = (() => {
      const s0 = attach(table(IRON_MOTH, [], FILLER, [SANDY_SHOCKS]), "p1", "active", FIRE, FIRE, COLORLESS);
      return run(s0, attack("p1", 1)).state;
    })();
    const moth = bodyAt(live, "p1", "active");
    const block = moth.attackBlock;
    if (block === null) throw new Error("no block");
    expect(block.fromClass).toEqual({ stage: "ancient" });
    const shocks = POOL[SANDY_SHOCKS] as Card;
    expect(attackBlockOf(live, moth, shocks, 60)).not.toBeNull();
    // The member this build has no arm for, in the slot a v38 `"ancient"` occupies under 0.458.
    const unread = { ...block, fromClass: { stage: "a-member-this-switch-never-heard-of" } } as unknown as typeof block;
    expect(attackBlockOf(live, { ...moth, attackBlock: unread }, shocks, 60)).toBeNull();
  });

  it("🛑 (iv) the `GameOverReason` widening rides the bump, and an OLD client's enum REJECTS it — client first", () => {
    // The 0.458 client's enum is this one minus the new member (zod's `exclude`, so no list is retyped).
    const old = redactedGameOverReasonSchema.exclude(["cardEffect"]);
    expect([...old.options].sort()).toEqual(["conceded", "deckOut", "noPokemon", "prizesTaken"]);
    expect(old.safeParse("cardEffect").success).toBe(false);
    expect(redactedGameOverReasonSchema.safeParse("cardEffect").success).toBe(true);
  });

  it("the engine is 0.492.0", () => {
    expect(engineVersion).toBe("0.492.0");
  });
});
