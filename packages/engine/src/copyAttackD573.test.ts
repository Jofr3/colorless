import type { Card } from "@luminous/schema";
import { redactedEffectPromptSchema } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import { COPY_FAMILY_MARKER, deriveAttackCopy, deriveAttackEffect, isResolvedAttackCopy } from "./effects";
import type { EffectOp } from "./effects";
import type { GameEvent } from "./events";
import { settleProgram } from "./flow";
import { applyAction, createGame, engineVersion } from "./index";
import type { GameAction, GameState, Seat } from "./index";
import { resumeProgram } from "./interpreter";
import type { EffectChoice } from "./interpreter";
import { type LogContext, formatElapsed, logFromEvents } from "./log";
import { redactGame } from "./redact";
import { programFor } from "./registry";
import { flipCoin } from "./rng";
import type { CoinFace } from "./rng";
import {
  FIXTURE_POOL,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  setActiveFromDeck,
  typedEnergy,
} from "./testFixtures";
import type { InPlayPokemon } from "./types";

// ── 🆕🆕🆕 D573 — THE COPY-ATTACK SUBSTITUTION: NINE PRINTINGS, FOUR TEXTS ──
//
//   N's Zoroark ex   sv09-098 / -175 / -185 / -189   "Night Joker"       — 1 of your Benched N's Pokémon's attacks
//   Zoroark          sv10.5w-062 / -143              "Foul Play"         — 1 of your opponent's Active Pokémon's attacks
//   Clefable         sv06-079                        "Metronome"         — the same sentence
//   TR's Mimikyu     sv10-087                        "Gemstone Mimicry"  — …Active TERA Pokémon's attacks
//   Ethan's Sudowoodo sv10-093                       "Try to Imitate"    — Flip a coin. If heads, …Active Pokémon's attacks
//
// Every copier is driven on its REAL id on a LOCAL `cardPool` (D275) in the suite's OWN deck (D270).
// Texts, stats and costs off tcgdex (the audit's card JSON), 2026-10-03. The copy is SUBSTITUTED at
// declaration: attack.ts re-enters `attack()` with the copied attack as an override. Rulings
// R-CP1..9 (R-CP3/5/8/9 ⚠️ UNRULED; R-CP4 only in "not offered" vs "offered and fails" — the clause
// itself BINDS THE COPIER, §3b; R-CP9 a copied name-keyed lock / boost binds nothing, §3c):
// docs/decisions.md D573.

const NIGHT_JOKER_IDS = ["sv09-098", "sv09-175", "sv09-185", "sv09-189"] as const;
const ZOROARK = ["sv10.5w-062", "sv10.5w-143"] as const;
const CLEFABLE = "sv06-079";
const MIMIKYU = "sv10-087";
const SUDOWOODO = "sv10-093";
const PERSIAN = "sv10-150";
const GREAT_TUSK = "sv05-097";
const FARIGIRAF = "sv05-108";
const WUGTRIO = "sv05-060";
const N_ONE = "d573t-n-one";
const N_TWO = "d573t-n-two";
const N_BASIC_EX = "d573t-n-basic-ex";
const N_GATED = "d573t-n-gated";
const ZORUA = "d573t-zorua";
const TARGET = "d573t-target";
const SOLO = "d573t-solo";
const BLANK = "d573t-blank";
const GATED = "d573t-gated";
const UNREAD = "d573t-unread";
const WEAK_DARK = "d573t-weak-dark";
const FILLER = "d573t-filler";
const DARK = "d573t-dark";
const PSYCHIC = "d573t-psychic";
const COLORLESS = "fix-energy";

const NIGHT_JOKER = "Choose 1 of your Benched N's Pokémon's attacks and use it as this attack.";
const FOUL_PLAY = "Choose 1 of your opponent's Active Pokémon's attacks and use it as this attack.";
const GEMSTONE = "Choose 1 of your opponent's Active Tera Pokémon's attacks and use it as this attack.";
const TRY_TO_IMITATE =
  "Flip a coin. If heads, choose 1 of your opponent's Active Pokémon's attacks and use it as this attack.";
const HAUGHTY_ORDER =
  "Reveal the top 10 cards of your opponent's deck. You may choose an attack from a Pokémon you find there and use it as this attack. Shuffle the revealed cards into your opponent's deck.";
const SEEK_INSPIRATION =
  "Discard the top card of your deck, and if that card is a Pokémon that doesn't have a Rule Box, choose 1 of its attacks and use it as this attack. (Pokémon ex, Pokémon V, etc. have Rule Boxes.)";
const CRUEL_SLASH_TEXT = "Your opponent's Active Pokémon is now Confused.";
const MIND_JACK_TEXT = "This attack does 30 damage for each of your opponent's Benched Pokémon.";
/** A REAL gate clause (`ATTACK_GATE_CLAUSES` row 1) in front of a REAL built body (corpus FILE LINE 335). */
const GATED_TEXT =
  "If you go second, you can't use this attack during your first turn. This attack does 30 damage for each of your Benched Pokémon.";
/** A REAL corpus sentence no reader claims (asserted live in §3, D480) — the anti-laundering witness.
    🆕🆕🆕 D575 — RE-POINTED (never deleted, D418): it held Hypno `sv06.5-017` "Daydream" (*"During your
    opponent's next turn, if they attach an Energy card from their hand to the Defending Pokémon, their
    turn ends."*, corpus FILE LINE 177), which D575 BUILDS (`markHandAttach { endsTurn }`). It now holds
    Walking Wake `sv06-063` "Undulating Slice" — a residue sentence D575 leaves unbuilt, VERIFIED before
    choosing (D532): `readersClaiming` is [] and the row is in the legal column.
    (🆕🆕🆕 D579 (D539): "a residue sentence D575 leaves unbuilt" is WITHDRAWN — Walking Wake `sv06-063` is BUILT at D579 as a REGISTRY row keyed by id (`UNDULATING_SLICE`); no READER claims the sentence, so `readersClaiming` is still [] and a card carrying it on any other id still takes the loud path — the witness holds on a re-stated premise.) */
const UNREAD_TEXT =
  "Put up to 9 damage counters on this Pokémon. This attack does 20 damage for each damage counter you placed in this way.";

/** 🆕🆕🆕 D573 second review — three REAL corpus sentences that LOCK or BOOST an attack BY NAME on
    "this Pokémon" (Scyther sv05-001 Slashing Strike; Gouging Fire ex sv05-038/-188/-204/-214/svp-144
    Blaze Blitz; Meloetta ex sv10.5b-044/-159/-167 Echoed Voice), carried on CONSTRUCTED 900-HP holders
    so a copy never Knocks Out its source (§3c, R-CP9). Membership asserted live there (D480). */
const SLASHER = "d573t-slasher";
const BLITZER = "d573t-blitzer";
const ECHOER = "d573t-echoer";
const SLASHING_TEXT = "During your next turn, this Pokémon can't use Slashing Strike.";
const BLITZ_TEXT = "This Pokémon can't use Blaze Blitz again until it leaves the Active Spot.";
const ECHO_TEXT =
  "During your next turn, this Pokémon's Echoed Voice attack does 80 more damage (before applying Weakness and Resistance).";

const LOCAL_CARDS: Record<string, Card> = {
  ...Object.fromEntries(
    NIGHT_JOKER_IDS.map((id) => [
      id,
      battler(id, {
        name: "N's Zoroark ex",
        stage: "Stage1",
        evolveFrom: "N's Zorua",
        types: ["Darkness"],
        hp: 280,
        retreat: 2,
        weaknesses: [{ type: "Grass", value: "×2" }],
        abilities: [
          {
            type: "Ability",
            name: "Trade",
            effect: "You must discard a card from your hand in order to use this Ability. Once during your turn, you may draw 2 cards.",
          },
        ],
        attacks: [{ cost: ["Darkness", "Darkness"], name: "Night Joker", effect: NIGHT_JOKER }],
      }),
    ]),
  ),
  ...Object.fromEntries(
    ZOROARK.map((id) => [
      id,
      battler(id, {
        name: "Zoroark",
        stage: "Stage1",
        evolveFrom: "Zorua",
        types: ["Darkness"],
        hp: 120,
        retreat: 1,
        attacks: [
          { cost: ["Darkness"], name: "Mind Jack", damage: "30×", effect: MIND_JACK_TEXT },
          { cost: ["Colorless", "Colorless", "Colorless"], name: "Foul Play", effect: FOUL_PLAY },
        ],
      }),
    ]),
  ),
  [CLEFABLE]: battler(CLEFABLE, {
    name: "Clefable",
    stage: "Stage1",
    evolveFrom: "Clefairy",
    types: ["Psychic"],
    hp: 120,
    retreat: 2,
    weaknesses: [{ type: "Metal", value: "×2" }],
    attacks: [
      { cost: ["Colorless", "Colorless"], name: "Metronome", effect: FOUL_PLAY },
      { cost: ["Psychic", "Colorless", "Colorless"], name: "Magical Shot", damage: 100 },
    ],
  }),
  [MIMIKYU]: battler(MIMIKYU, {
    name: "Team Rocket's Mimikyu",
    types: ["Psychic"],
    hp: 60,
    retreat: 0,
    weaknesses: [{ type: "Darkness", value: "×2" }],
    attacks: [{ cost: ["Psychic", "Colorless"], name: "Gemstone Mimicry", effect: GEMSTONE }],
  }),
  [SUDOWOODO]: battler(SUDOWOODO, {
    name: "Ethan's Sudowoodo",
    types: ["Fighting"],
    hp: 110,
    retreat: 1,
    weaknesses: [{ type: "Grass", value: "×2" }],
    attacks: [
      { cost: ["Fighting"], name: "Impound", damage: 20, effect: "During your opponent's next turn, the Defending Pokémon can't retreat." },
      { cost: ["Colorless", "Colorless"], name: "Try to Imitate", effect: TRY_TO_IMITATE },
    ],
  }),
  [PERSIAN]: battler(PERSIAN, {
    name: "Team Rocket's Persian ex",
    stage: "Stage1",
    evolveFrom: "Team Rocket's Meowth",
    types: ["Colorless"],
    hp: 260,
    retreat: 2,
    weaknesses: [{ type: "Fighting", value: "×2" }],
    attacks: [
      { cost: ["Colorless", "Colorless"], name: "Haughty Order", effect: HAUGHTY_ORDER },
      { cost: ["Colorless", "Colorless", "Colorless"], name: "Cruel Slash", damage: 140, effect: CRUEL_SLASH_TEXT },
    ],
  }),
  [GREAT_TUSK]: battler(GREAT_TUSK, {
    name: "Great Tusk",
    types: ["Fighting"],
    hp: 140,
    retreat: 3,
    weaknesses: [{ type: "Psychic", value: "×2" }],
    attacks: [
      {
        cost: ["Colorless", "Colorless"],
        name: "Land Collapse",
        effect:
          "Discard the top card of your opponent's deck. If you played an Ancient Supporter card from your hand during this turn, discard 3 more cards in this way.",
      },
      { cost: ["Fighting", "Fighting", "Colorless", "Colorless"], name: "Giant Tusk", damage: 160 },
    ],
  }),
  [FARIGIRAF]: battler(FARIGIRAF, {
    name: "Farigiraf ex",
    stage: "Stage1",
    evolveFrom: "Girafarig",
    types: ["Darkness"],
    hp: 260,
    retreat: 2,
    weaknesses: [{ type: "Grass", value: "×2" }],
    abilities: [
      { type: "Ability", name: "Armor Tail", effect: "Prevent all damage done to this Pokémon by attacks from your opponent's Basic Pokémon ex." },
    ],
    attacks: [
      {
        cost: ["Psychic", "Colorless", "Colorless"],
        name: "Dirty Beam",
        damage: 160,
        effect:
          "This attack also does 30 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      },
    ],
  }),
  [WUGTRIO]: battler(WUGTRIO, {
    name: "Wugtrio ex",
    stage: "Stage1",
    evolveFrom: "Wiglett",
    types: ["Lightning"],
    hp: 250,
    retreat: 1,
    weaknesses: [{ type: "Fighting", value: "×2" }],
    attacks: [
      {
        cost: ["Water"],
        name: "Tricolor Pump",
        effect:
          "Discard up to 3 Energy cards from your hand. This attack does 60 damage to 1 of your opponent's Pokémon for each Energy card you discarded in this way. (Don't apply Weakness and Resistance for Benched Pokémon.)",
      },
      { cost: ["Water", "Water"], name: "Numbing Hold", damage: 120, effect: "During your opponent's next turn, the Defending Pokémon can't retreat." },
    ],
  }),
  [N_ONE]: battler(N_ONE, {
    name: "N's Darmanitan",
    types: ["Fire"],
    hp: 140,
    retreat: 2,
    attacks: [{ cost: ["Fire", "Fire", "Fire"], name: "Flare Burst", damage: 50 }],
  }),
  [N_TWO]: battler(N_TWO, {
    name: "N's Klinklang",
    types: ["Metal"],
    hp: 150,
    retreat: 2,
    attacks: [
      { cost: ["Metal"], name: "Gear Hit", damage: 30 },
      { cost: ["Metal", "Metal"], name: "Gear Slam", damage: 70 },
    ],
  }),
  [N_BASIC_EX]: battler(N_BASIC_EX, {
    name: "N's Testmon ex",
    types: ["Dragon"],
    hp: 230,
    retreat: 2,
    attacks: [{ cost: ["Colorless"], name: "Test Blast", damage: 90 }],
  }),
  // 🆕🆕🆕 D573 review — an N's body whose index 0 prints the GATED clause and index 1 does not:
  // the R-CP4 witness on Night Joker's own Bench, where "you" is one player under any reading.
  [N_GATED]: battler(N_GATED, {
    name: "N's Gatemon",
    types: ["Colorless"],
    hp: 150,
    retreat: 1,
    attacks: [
      { cost: ["Colorless"], name: "Gated Count", damage: "30×", effect: GATED_TEXT },
      { cost: ["Colorless"], name: "Gate Tap", damage: 20 },
    ],
  }),
  [ZORUA]: battler(ZORUA, {
    name: "Zorua",
    types: ["Darkness"],
    hp: 70,
    retreat: 1,
    attacks: [{ cost: ["Colorless"], name: "Scratch", damage: 20 }],
  }),
  [TARGET]: battler(TARGET, {
    name: "D573 Target",
    types: ["Colorless"],
    hp: 400,
    retreat: 1,
    attacks: [
      { cost: ["Colorless"], name: "Poke", damage: 10 },
      { cost: ["Colorless", "Colorless"], name: "Smash", damage: 60 },
    ],
  }),
  [SOLO]: battler(SOLO, {
    name: "D573 Solo",
    types: ["Colorless"],
    hp: 400,
    retreat: 1,
    attacks: [{ cost: ["Colorless", "Colorless"], name: "Smash", damage: 60 }],
  }),
  [BLANK]: battler(BLANK, { name: "D573 Blank", types: ["Colorless"], hp: 400, retreat: 1 }),
  [GATED]: battler(GATED, {
    name: "D573 Gated",
    types: ["Colorless"],
    hp: 400,
    retreat: 1,
    attacks: [{ cost: ["Colorless"], name: "Gated Count", damage: "30×", effect: GATED_TEXT }],
  }),
  [UNREAD]: battler(UNREAD, {
    name: "D573 Unread",
    types: ["Colorless"],
    hp: 400,
    retreat: 1,
    attacks: [{ cost: ["Colorless"], name: "Unread Bind", damage: 10, effect: UNREAD_TEXT }],
  }),
  [WEAK_DARK]: battler(WEAK_DARK, {
    name: "D573 Weak to Darkness",
    types: ["Psychic"],
    hp: 400,
    retreat: 1,
    weaknesses: [{ type: "Darkness", value: "×2" }],
    attacks: [{ cost: ["Psychic"], name: "Smash", damage: 60 }],
  }),
  [FILLER]: battler(FILLER, {
    name: "D573 Filler",
    types: ["Colorless"],
    hp: 900,
    retreat: 1,
    attacks: [{ cost: [], name: "Tap", damage: 10 }],
  }),
  [SLASHER]: battler(SLASHER, {
    name: "D573 Slasher",
    types: ["Grass"],
    hp: 900,
    retreat: 1,
    attacks: [
      { cost: ["Colorless"], name: "Cut Up", damage: 10 },
      { cost: ["Colorless", "Colorless"], name: "Slashing Strike", damage: 60, effect: SLASHING_TEXT },
    ],
  }),
  [BLITZER]: battler(BLITZER, {
    name: "D573 Blitzer",
    types: ["Fire"],
    hp: 900,
    retreat: 1,
    attacks: [
      { cost: ["Colorless"], name: "Heat Blast", damage: 60 },
      { cost: ["Colorless", "Colorless"], name: "Blaze Blitz", damage: 260, effect: BLITZ_TEXT },
    ],
  }),
  [ECHOER]: battler(ECHOER, {
    name: "D573 Echoer",
    types: ["Psychic"],
    hp: 900,
    retreat: 1,
    attacks: [{ cost: ["Colorless"], name: "Echoed Voice", damage: 30, effect: ECHO_TEXT }],
  }),
  [DARK]: typedEnergy(DARK, "Darkness"),
  [PSYCHIC]: typedEnergy(PSYCHIC, "Psychic"),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

/** Its OWN deck (D270), 60 by construction. */
const DECK = deckOf({
  [NIGHT_JOKER_IDS[0]]: 1,
  [NIGHT_JOKER_IDS[1]]: 1,
  [NIGHT_JOKER_IDS[2]]: 1,
  [NIGHT_JOKER_IDS[3]]: 1,
  [ZOROARK[0]]: 1,
  [ZOROARK[1]]: 1,
  [CLEFABLE]: 1,
  [MIMIKYU]: 1,
  [SUDOWOODO]: 1,
  [PERSIAN]: 1,
  [GREAT_TUSK]: 1,
  [FARIGIRAF]: 1,
  [WUGTRIO]: 1,
  [N_ONE]: 2,
  [N_TWO]: 2,
  [N_BASIC_EX]: 1,
  [N_GATED]: 1,
  [ZORUA]: 1,
  [TARGET]: 1,
  [SOLO]: 1,
  [BLANK]: 1,
  [GATED]: 1,
  [UNREAD]: 1,
  [WEAK_DARK]: 1,
  [FILLER]: 14,
  [DARK]: 6,
  [PSYCHIC]: 3,
  [COLORLESS]: 11,
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

/** p1's NEXT turn (turn 4): p1 and then p2 pass. On `table`'s boards p1 went SECOND and is on its
    FIRST turn (turn 2), where the GATED clause bars its attack; two passes later it does not. */
function later(state: GameState): GameState {
  const passed = must(applyAction(state, { type: "endTurn", seat: "p1" }));
  return must(applyAction(passed, { type: "endTurn", seat: "p2" }));
}

/** TEST SURGERY — the seat's hand back into its deck. */
function emptyHand(state: GameState, seat: Seat): GameState {
  const side = state.players[seat];
  return { ...state, players: { ...state.players, [seat]: { ...side, deck: [...side.deck, ...side.hand], hand: [] } } };
}

/** TEST SURGERY — one copy of `id` into `seat`'s DECK (swapped out of the Prizes when needed). */
function ensureInDeck(state: GameState, seat: Seat, id: string): GameState {
  const side = state.players[seat];
  if (side.deck.some((u) => state.cardIdByUid[u] === id)) return state;
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

/** TEST SURGERY — attach deck copies of each id in `ids` to the body. */
function attach(state: GameState, seat: Seat, spot: Spot, ids: readonly string[]): GameState {
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

/** p1's turn 2: p1 `active` + `bench`, p2 `oppActive` + `oppBench`. Hands emptied into the decks. */
function table(
  active: string,
  bench: readonly string[] = [],
  oppActive: string = FILLER,
  oppBench: readonly string[] = [],
  seed = 5731,
): GameState {
  let state = emptyHand(emptyHand(opened(seed), "p1"), "p2");
  state = setActiveFromDeck(ensureInDeck(state, "p1", active), "p1", active);
  state = setActiveFromDeck(ensureInDeck(state, "p2", oppActive), "p2", oppActive);
  state = clearBench(clearBench(state, "p1"), "p2");
  for (const id of bench) state = benchFromDeck(ensureInDeck(state, "p1", id), "p1", id);
  for (const id of oppBench) state = benchFromDeck(ensureInDeck(state, "p2", id), "p2", id);
  return state;
}

/** Each copier: its printed attack index and the Energy that pays its printed cost. */
type Copier = { id: string; index: number; name: string; energy: readonly string[] };
const COPIERS: Record<string, Copier> = {
  ...Object.fromEntries(
    NIGHT_JOKER_IDS.map((id) => [id, { id, index: 0, name: "Night Joker", energy: [DARK, DARK] }]),
  ),
  ...Object.fromEntries(
    ZOROARK.map((id) => [id, { id, index: 1, name: "Foul Play", energy: [COLORLESS, COLORLESS, COLORLESS] }]),
  ),
  [CLEFABLE]: { id: CLEFABLE, index: 0, name: "Metronome", energy: [COLORLESS, COLORLESS] },
  [MIMIKYU]: { id: MIMIKYU, index: 0, name: "Gemstone Mimicry", energy: [PSYCHIC, COLORLESS] },
  [SUDOWOODO]: { id: SUDOWOODO, index: 1, name: "Try to Imitate", energy: [COLORLESS, COLORLESS] },
};

function copierOf(id: string): Copier {
  const c = COPIERS[id];
  if (c === undefined) throw new Error(`no copier ${id}`);
  return c;
}

/** The copier Active with its cost paid, on `table`'s board. */
function armed(copier: string, bench: readonly string[] = [], oppActive: string = FILLER, oppBench: readonly string[] = []): GameState {
  return attach(table(copier, bench, oppActive, oppBench), "p1", "active", copierOf(copier).energy);
}

/** TEST SURGERY — the next `faces.length` coins come up as `faces`, by searching rngState (flipCoin is a pure step). */
function withFaces(state: GameState, faces: readonly CoinFace[]): GameState {
  for (let seed = state.rngState; seed < state.rngState + 100_000; seed += 1) {
    let r = seed;
    let ok = true;
    for (const face of faces) {
      const [drawn, nextR] = flipCoin(r);
      if (drawn !== face) {
        ok = false;
        break;
      }
      r = nextR;
    }
    if (ok) return { ...state, rngState: seed };
  }
  throw new Error("no rngState found");
}

function all<T extends GameEvent["type"]>(events: readonly GameEvent[], type: T): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

const types = (events: readonly GameEvent[]): string[] => events.map((e) => e.type);

function render(events: GameEvent[], state: GameState): string[] {
  const ctx: LogContext = { names: NAMES, state, elapsed: formatElapsed(0) };
  return logFromEvents(events, ctx).flatMap((entry) =>
    entry.kind === "turn" ? [] : [`${entry.who}: ${entry.segments.map((s) => s.text).join("")}`],
  );
}

const declare = (copier: string): GameAction => ({ type: "attack", seat: "p1", index: copierOf(copier).index });
const pickAttack = (index: number): GameAction =>
  ({ type: "resolveEffect", seat: "p1", choice: { kind: "attack", index } }) as GameAction;
const pickBench = (index: number): GameAction =>
  ({ type: "resolveEffect", seat: "p1", choice: { kind: "pokemon", ref: { seat: "p1", spot: { spot: "bench", index } } } }) as GameAction;

function prompt(state: GameState) {
  if (state.phase.kind !== "effect:choose") throw new Error(`expected effect:choose, got ${state.phase.kind}`);
  return state.phase.prompt;
}

/** The damage the p2 Active carries (the attack's main hit, every board here starts it at 0). */
const oppActiveDamage = (state: GameState): number => bodyAt(state, "p2", "active").damage;

/** Whether p1's turn ended: the turn passed to p2 (or a KO decision is parked on p1). */
const turnPassed = (state: GameState): boolean => state.phase.kind === "turn:action" && state.phase.seat === "p2";

const OPPONENT_COPIERS = [...ZOROARK, CLEFABLE] as const;

describe("D573 §1 — the reader: four whole-sentence anchors, nine printings, and the copy-family bound", () => {
  it("claims exactly the four sentences, with their shapes", () => {
    expect(deriveAttackCopy(FOUL_PLAY)).toEqual({ from: "opponentActive" });
    expect(deriveAttackCopy(GEMSTONE)).toEqual({ from: "opponentActiveTera" });
    expect(deriveAttackCopy(NIGHT_JOKER)).toEqual({ from: "benchOwner", owner: "N" });
    expect(deriveAttackCopy(TRY_TO_IMITATE)).toEqual({ from: "opponentActive", flip: true });
  });

  it("🛑 ~~refuses the two mid-attack-park members (they stay BLOCKED)~~ (🆕🆕🆕 D574: claims them as RESOLVE-TIME kinds) and refuses every one-token near miss", () => {
    // 🆕🆕🆕 D574 — INVERTED (D539): the two mid-attack-park members are BUILT
    // (`copyRemainderBundleD574.test.ts`), as the second KIND — never as one of these four sources.
    expect(deriveAttackCopy(HAUGHTY_ORDER)).toEqual({ from: "opponentDeckTop", count: 10, may: true });
    expect(deriveAttackCopy(SEEK_INSPIRATION)).toEqual({ from: "ownDeckTopMill", count: 1 });
    expect(deriveAttackCopy("Choose 1 of your Benched Pokémon's attacks and use it as this attack.")).toBeNull();
    expect(deriveAttackCopy("Choose 1 of your opponent's Benched Pokémon's attacks and use it as this attack.")).toBeNull();
    expect(deriveAttackCopy("choose 1 of your opponent's Active Pokémon's attacks and use it as this attack.")).toBeNull();
    expect(deriveAttackCopy(`${FOUL_PLAY} Then, shuffle your deck.`)).toBeNull();
    expect(deriveAttackCopy("Flip a coin. If tails, choose 1 of your opponent's Active Pokémon's attacks and use it as this attack.")).toBeNull();
    // A typographic apostrophe is the same printed sentence (D136/D137) on EVERY slot.
    expect(deriveAttackCopy(FOUL_PLAY.split("'").join("’"))).toEqual({ from: "opponentActive" });
    expect(deriveAttackCopy(NIGHT_JOKER.split("'").join("’"))).toEqual({ from: "benchOwner", owner: "N" });
    // The deriver returns no PROGRAM: `deriveAttackEffect` keeps refusing every copy sentence.
    for (const text of [FOUL_PLAY, GEMSTONE, NIGHT_JOKER, TRY_TO_IMITATE]) expect(deriveAttackEffect(text)).toBeNull();
  });

  it("the corpus: 4 sentences / 9 legal printings claimed at DECLARATION; the marker spans all 6 family sentences / 13 printings", () => {
    const corpus = legalAttackCorpus();
    // 🆕🆕🆕 D574 — narrowed to the DECLARATION-TIME kinds (this suite's four): the reader claims all
    // six family sentences now, and the two RESOLVE-TIME ones are `copyRemainderBundleD574.test.ts`'s.
    const claimed = corpus.filter(([, s]) => {
      const copy = deriveAttackCopy(s);
      return copy !== null && !isResolvedAttackCopy(copy);
    });
    expect(claimed.map(([n, s]) => [n, s]).sort()).toEqual(
      [
        [1, GEMSTONE],
        [1, TRY_TO_IMITATE],
        [3, FOUL_PLAY],
        [4, NIGHT_JOKER],
      ].sort(),
    );
    expect(claimed.reduce((n, [c]) => n + c, 0)).toBe(9);
    const family = corpus.filter(([, s]) => COPY_FAMILY_MARKER.test(s));
    expect([family.length, family.reduce((n, [c]) => n + c, 0)]).toEqual([6, 13]);
    // …and the two left are exactly the two this slice does not build.
    // 🆕🆕🆕 D574 — INVERTED (D539): they are left by THIS suite's kinds only; D574 claims both as
    // RESOLVE-TIME kinds, so the family has NO unclaimed member and both resolve now.
    expect(
      family
        .filter(([, s]) => {
          const copy = deriveAttackCopy(s);
          return copy === null || isResolvedAttackCopy(copy);
        })
        .map(([n, s]) => [n, s])
        .sort(),
    ).toEqual(
      [
        [1, SEEK_INSPIRATION],
        [3, HAUGHTY_ORDER],
      ].sort(),
    );
    expect(family.filter(([, s]) => deriveAttackCopy(s) === null)).toEqual([]);
    for (const [, s] of claimed) expect(resolvedByAnyReader(s)).toBe(true);
    expect(resolvedByAnyReader(HAUGHTY_ORDER)).toBe(true);
    expect(resolvedByAnyReader(SEEK_INSPIRATION)).toBe(true);
  });

  it("is on the ATTACK READER SURFACE by its prefix — 13 → 14", () => {
    expect(attackReaderSurface()).toContain("deriveAttackCopy");
    expect(attackReaderSurface()).toHaveLength(14);
  });

  it("every copier's REAL printing carries no registry attack row at the copy index (the reader is the whole build)", () => {
    for (const c of Object.values(COPIERS)) expect(programFor(c.id)?.attack?.[c.index]).toBeUndefined();
  });
});

describe("D573 §2 — every printing on a board with 0, 1 and 2+ candidates", () => {
  for (const id of OPPONENT_COPIERS) {
    const c = copierOf(id);
    it(`${id} ${c.name}: 0 candidates (an Active with no attacks) — declared, nothing resolves, the turn ends`, () => {
      const { state, events } = run(armed(id, [], BLANK), declare(id));
      expect(all(events, "ATTACK_DECLARED")).toEqual([
        { type: "ATTACK_DECLARED", seat: "p1", uid: expect.any(String), attack: c.name, index: c.index },
      ]);
      expect(types(events)).not.toContain("EFFECT_PENDING");
      expect(types(events)).not.toContain("DAMAGE_DEALT");
      expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
      expect(turnPassed(state)).toBe(true);
    });
    it(`${id} ${c.name}: 1 candidate — FORCED, no park, the copied damage lands`, () => {
      const { state, events } = run(armed(id, [], SOLO), declare(id));
      expect(types(events)).not.toContain("EFFECT_PENDING");
      expect(all(events, "ATTACK_DECLARED")[0]).toMatchObject({ attack: c.name, as: "Smash" });
      expect(oppActiveDamage(state)).toBe(60);
      expect(turnPassed(state)).toBe(true);
    });
    it(`${id} ${c.name}: 2 candidates — PARKS chooseAttack over the opponent's attacks, then resolves the pick`, () => {
      const parked = run(armed(id, [], TARGET), declare(id));
      expect(parked.events.map((e) => e.type)).toEqual(["EFFECT_PENDING"]);
      expect(prompt(parked.state)).toMatchObject({
        kind: "chooseAttack",
        candidates: [
          { index: 0, name: "Poke" },
          { index: 1, name: "Smash" },
        ],
      });
      const { state, events } = run(parked.state, pickAttack(1));
      expect(all(events, "ATTACK_DECLARED")[0]).toMatchObject({ attack: c.name, as: "Smash", index: c.index });
      expect(oppActiveDamage(state)).toBe(60);
      expect(turnPassed(state)).toBe(true);
    });
  }

  it(`${MIMIKYU} Gemstone Mimicry: 0 candidates (a NON-Tera Active) — nothing resolves`, () => {
    const { state, events } = run(armed(MIMIKYU, [], SOLO), declare(MIMIKYU));
    expect(types(events)).not.toContain("DAMAGE_DEALT");
    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(all(events, "ATTACK_DECLARED")[0]).not.toHaveProperty("as");
    expect(oppActiveDamage(state)).toBe(0);
    expect(turnPassed(state)).toBe(true);
  });
  it(`${MIMIKYU} Gemstone Mimicry: 1 candidate (Tera Farigiraf ex, one attack) — forced: 160, and Armor Tail does not stop a non-ex`, () => {
    const { state, events } = run(armed(MIMIKYU, [], FARIGIRAF), declare(MIMIKYU));
    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(all(events, "ATTACK_DECLARED")[0]).toMatchObject({ attack: "Gemstone Mimicry", as: "Dirty Beam" });
    expect(oppActiveDamage(state)).toBe(160);
  });
  it(`${MIMIKYU} Gemstone Mimicry: 2 candidates (Tera Wugtrio ex) — parks, then the pick resolves`, () => {
    const parked = run(armed(MIMIKYU, [], WUGTRIO), declare(MIMIKYU));
    expect(prompt(parked.state)).toMatchObject({
      kind: "chooseAttack",
      candidates: [
        { index: 0, name: "Tricolor Pump" },
        { index: 1, name: "Numbing Hold" },
      ],
    });
    const { state } = run(parked.state, pickAttack(1));
    expect(oppActiveDamage(state)).toBe(120);
  });

  it(`${SUDOWOODO} Try to Imitate: 0 candidates — the coin is still flipped, nothing resolves`, () => {
    const { state, events } = run(withFaces(armed(SUDOWOODO, [], BLANK), ["heads"]), declare(SUDOWOODO));
    expect(all(events, "ATTACK_EFFECT_COIN_FLIP")).toEqual([{ type: "ATTACK_EFFECT_COIN_FLIP", seat: "p1", result: "heads" }]);
    expect(types(events)).not.toContain("DAMAGE_DEALT");
    expect(turnPassed(state)).toBe(true);
  });
  it(`${SUDOWOODO} Try to Imitate: 1 candidate, HEADS — forced, the copied attack resolves`, () => {
    const { state, events } = run(withFaces(armed(SUDOWOODO, [], SOLO), ["heads"]), declare(SUDOWOODO));
    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(all(events, "ATTACK_DECLARED")[0]).toMatchObject({ attack: "Try to Imitate", as: "Smash" });
    expect(oppActiveDamage(state)).toBe(60);
  });
  it(`${SUDOWOODO} Try to Imitate: 2 candidates — the PICK is parked before the coin (R-CP8), then heads resolves it`, () => {
    const before = withFaces(armed(SUDOWOODO, [], TARGET), ["heads"]);
    const parked = run(before, declare(SUDOWOODO));
    expect(parked.state.rngState).toBe(before.rngState);
    expect(types(parked.events)).toEqual(["EFFECT_PENDING"]);
    const { state, events } = run(parked.state, pickAttack(1));
    expect(all(events, "ATTACK_EFFECT_COIN_FLIP")).toHaveLength(1);
    expect(oppActiveDamage(state)).toBe(60);
  });

  for (const id of NIGHT_JOKER_IDS) {
    it(`${id} Night Joker: 0 candidates (no Benched N's Pokémon with a usable attack) — nothing resolves`, () => {
      // Zorua is not an N's Pokémon; a Benched N's Zoroark ex has only a copy attack (R-CP3).
      const other = NIGHT_JOKER_IDS.find((x) => x !== id) as string;
      const { state, events } = run(armed(id, [ZORUA, other], SOLO), declare(id));
      expect(types(events)).not.toContain("EFFECT_PENDING");
      expect(types(events)).not.toContain("DAMAGE_DEALT");
      expect(turnPassed(state)).toBe(true);
    });
    it(`${id} Night Joker: 1 candidate (one N's body, one attack) — forced; the copied cost is ignored (R-CP1)`, () => {
      const { state, events } = run(armed(id, [ZORUA, N_ONE], SOLO), declare(id));
      expect(types(events)).not.toContain("EFFECT_PENDING");
      expect(all(events, "ATTACK_DECLARED")[0]).toMatchObject({ attack: "Night Joker", as: "Flare Burst" });
      expect(oppActiveDamage(state)).toBe(50);
    });
    it(`${id} Night Joker: 2 candidates on one body — chooseAttack on THAT body (sourceRef), then the pick`, () => {
      const parked = run(armed(id, [ZORUA, N_TWO], SOLO), declare(id));
      expect(prompt(parked.state)).toMatchObject({
        kind: "chooseAttack",
        candidates: [
          { index: 0, name: "Gear Hit" },
          { index: 1, name: "Gear Slam" },
        ],
      });
      const phase = parked.state.phase;
      if (phase.kind !== "effect:choose") throw new Error("expected a park");
      expect(phase.cont.pendingOp).toEqual({
        op: "useAttackAs",
        from: "benchOwner",
        owner: "N",
        index: 0,
        sourceRef: { spot: "bench", index: 1 },
      });
      const { state } = run(parked.state, pickAttack(1));
      expect(oppActiveDamage(state)).toBe(70);
    });
  }
});

describe("D573 §3 — the four substitution sites, each with a board that tells the copy from the copier", () => {
  it("🛑 SITE 4 — a copied REGISTRY-authored attack runs the SOURCE card's program (Great Tusk Land Collapse mills 1)", () => {
    expect(programFor(GREAT_TUSK)?.attack?.[0]).toBeDefined();
    const parked = run(armed(ZOROARK[0], [], GREAT_TUSK), declare(ZOROARK[0]));
    expect(prompt(parked.state)).toMatchObject({ kind: "chooseAttack" });
    const deckBefore = parked.state.players.p2.deck.length;
    const discardBefore = parked.state.players.p2.discard.length;
    const { state, events } = run(parked.state, pickAttack(0));
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(state.players.p2.discard.length).toBe(discardBefore + 1);
    // p2's deck lost the milled card, then p2 drew for its own turn.
    expect(state.players.p2.deck.length).toBe(deckBefore - 2);
  });

  it("🛑 SITES 1 + 2 — a copied DERIVED attack applies the SOURCE damage box AND the source effect (Cruel Slash: 140, Confused)", () => {
    const { state, events } = run(armed(ZOROARK[1], [], PERSIAN), declare(ZOROARK[1]));
    // R-CP3's bound: Haughty Order is a copy-family attack, so Cruel Slash is the only candidate and it is FORCED.
    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(all(events, "ATTACK_DECLARED")[0]).toMatchObject({ attack: "Foul Play", as: "Cruel Slash" });
    expect(all(events, "DAMAGE_DEALT")[0]).toMatchObject({ base: 140, dealt: 140 });
    expect(bodyAt(state, "p2", "active").conditions.rotation).toBe("confused");
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("🛑 SITE 1's modifier — a copied `30×` multiplier reads the COPIER's side (Mind Jack counts the copier's opponent's Bench)", () => {
    const { state, events } = run(armed(ZOROARK[0], [], ZOROARK[1], [FILLER, FILLER]), declare(ZOROARK[0]));
    // Foul Play against a Foul Play Zoroark offers only Mind Jack: forced.
    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(all(events, "ATTACK_DECLARED")[0]).toMatchObject({ as: "Mind Jack" });
    expect(oppActiveDamage(state)).toBe(60);
  });

  // 🆕🆕🆕 D573 review — this rung FIRST ran on p1's FIRST turn (p1 went second), the one board
  // where the printed clause BARS the attack, and asserted 90: green only because of its board,
  // and enshrining a deleted rule. It now runs a turn LATER, where the clause bars nothing; the
  // barred board is §3b's.
  it("🛑 SITE 3 — a copied attack carrying a TIMING clause is split on the SOURCE, where it is printed (R-CP4): on a turn it does not bar, the body resolves, nothing is skipped", () => {
    const { state, events } = run(later(armed(ZOROARK[0], [FILLER, FILLER, FILLER], GATED)), declare(ZOROARK[0]));
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(all(events, "ATTACK_DECLARED")[0]).toMatchObject({ as: "Gated Count" });
    // "your Benched Pokémon" is the COPIER's (R-CP2): 3 × 30.
    expect(oppActiveDamage(state)).toBe(90);
  });

  it("🛑 the ANTI-LAUNDERING rung — a copied UNBUILT sentence reports ITSELF: ATTACK_EFFECT_SKIPPED carries the COPIED text", () => {
    expect(resolvedByAnyReader(UNREAD_TEXT)).toBe(false);
    expect(legalAttackCorpus().some(([, s]) => s === UNREAD_TEXT)).toBe(true);
    const { events } = run(armed(ZOROARK[0], [], UNREAD), declare(ZOROARK[0]));
    expect(all(events, "ATTACK_EFFECT_SKIPPED")).toEqual([
      { type: "ATTACK_EFFECT_SKIPPED", seat: "p1", attack: "Foul Play", effect: UNREAD_TEXT, damageModifier: null },
    ]);
    // The printed 10 still applied.
    expect(all(events, "DAMAGE_DEALT")[0]).toMatchObject({ base: 10 });
  });

  it("R-CP1 — the COPIED attack's cost is ignored: Metronome on {C}{C} uses Giant Tusk's {F}{F}{C}{C} 160", () => {
    const parked = run(armed(CLEFABLE, [], GREAT_TUSK), declare(CLEFABLE));
    const { events } = run(parked.state, pickAttack(1));
    expect(all(events, "ATTACK_DECLARED")[0]).toMatchObject({ attack: "Metronome", as: "Giant Tusk" });
    // Great Tusk is weak to Psychic ×2 — and Clefable IS Psychic (R-CP2): 160 → 320, a Knock Out.
    expect(all(events, "DAMAGE_DEALT")[0]).toMatchObject({ base: 160, dealt: 320 });
    expect(types(events)).toContain("KNOCKED_OUT");
  });

  it("🛑 R-CP2 — Weakness reads the COPIER's type: Darkness Zoroark doubles, Psychic Clefable does not", () => {
    const dark = run(armed(ZOROARK[0], [], WEAK_DARK), declare(ZOROARK[0]));
    expect(all(dark.events, "DAMAGE_DEALT")[0]).toMatchObject({ base: 60, dealt: 120 });
    const psychic = run(armed(CLEFABLE, [], WEAK_DARK), declare(CLEFABLE));
    expect(all(psychic.events, "DAMAGE_DEALT")[0]).toMatchObject({ base: 60, dealt: 60 });
  });

  it("🛑 R-CP2 — the defender's PREVENTION reads the COPIER: Armor Tail stops N's Testmon ex itself, not N's Zoroark ex copying it", () => {
    // Control: the Basic ex SOURCE attacking directly is prevented.
    const direct = run(attach(table(N_BASIC_EX, [], FARIGIRAF), "p1", "active", [COLORLESS]), {
      type: "attack",
      seat: "p1",
      index: 0,
    });
    expect(oppActiveDamage(direct.state)).toBe(0);
    // The copy: the copier is a STAGE 1 ex, so Armor Tail does not apply.
    const copied = run(armed(NIGHT_JOKER_IDS[0], [N_BASIC_EX], FARIGIRAF), declare(NIGHT_JOKER_IDS[0]));
    expect(all(copied.events, "ATTACK_DECLARED")[0]).toMatchObject({ as: "Test Blast" });
    expect(oppActiveDamage(copied.state)).toBe(90);
  });

  it("R-CP7 — `usedAttack` stamps the COPIER's name; the log names both", () => {
    const { state, events } = run(armed(ZOROARK[1], [], PERSIAN), declare(ZOROARK[1]));
    expect(bodyAt(state, "p1", "active").usedAttack).toMatchObject({ name: "Foul Play" });
    expect(render(events, state)).toContain("p1: Zoroark used Foul Play (as Cruel Slash)");
    // …and an ordinary declaration renders as it always did (the key is absent, D135).
    const plain = run(attach(table(ZOROARK[1]), "p1", "active", [DARK]), { type: "attack", seat: "p1", index: 0 });
    expect(all(plain.events, "ATTACK_DECLARED")[0]).not.toHaveProperty("as");
    expect(render(plain.events, plain.state)).toContain("p1: Zoroark used Mind Jack");
  });
});

// 🆕🆕🆕 D573 review — the first build split a copied clause off (SITE 3) and enforced it NOWHERE.
describe("D573 §3b — R-CP4: a copied timing clause BINDS THE COPIER (looked up on the source, asked for the copier's seat)", () => {
  it("🛑 control — the gated attack used DIRECTLY on p1's first turn (p1 went second) is ATTACK_PREVENTED", () => {
    // Seed 5732: on the suite's 5731 the deck's one Gated copy is in neither p1's deck nor its Prizes.
    const direct = attach(table(GATED, [], FILLER, [], 5732), "p1", "active", [COLORLESS]);
    expect(refused(direct, { type: "attack", seat: "p1", index: 0 }).code).toBe("ATTACK_PREVENTED");
  });

  it("🛑 Foul Play cannot copy it on that turn: it is not a candidate, so the copy is EMPTY — declared, no `as`, no damage, no skip", () => {
    const { state, events } = run(armed(ZOROARK[0], [FILLER, FILLER, FILLER], GATED), declare(ZOROARK[0]));
    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(all(events, "ATTACK_DECLARED")).toEqual([
      { type: "ATTACK_DECLARED", seat: "p1", uid: expect.any(String), attack: "Foul Play", index: 1 },
    ]);
    expect(types(events)).not.toContain("DAMAGE_DEALT");
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(oppActiveDamage(state)).toBe(0);
    expect(turnPassed(state)).toBe(true);
  });

  it("🛑 Night Joker off its OWN Benched N's body: the barred attack is not offered (the other is FORCED); a turn later both are", () => {
    const direct = attach(table(N_GATED), "p1", "active", [COLORLESS]);
    expect(refused(direct, { type: "attack", seat: "p1", index: 0 }).code).toBe("ATTACK_PREVENTED");
    const first = run(armed(NIGHT_JOKER_IDS[0], [N_GATED], SOLO), declare(NIGHT_JOKER_IDS[0]));
    expect(types(first.events)).not.toContain("EFFECT_PENDING");
    expect(all(first.events, "ATTACK_DECLARED")[0]).toMatchObject({ attack: "Night Joker", as: "Gate Tap" });
    expect(oppActiveDamage(first.state)).toBe(20);
    const parked = run(later(armed(NIGHT_JOKER_IDS[0], [N_GATED], SOLO)), declare(NIGHT_JOKER_IDS[0]));
    expect(prompt(parked.state)).toMatchObject({
      kind: "chooseAttack",
      candidates: [
        { index: 0, name: "Gated Count" },
        { index: 1, name: "Gate Tap" },
      ],
    });
    const { state, events } = run(parked.state, pickAttack(0));
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(all(events, "ATTACK_DECLARED")[0]).toMatchObject({ as: "Gated Count" });
    // "your Benched Pokémon" is the COPIER's Bench: N's Gatemon alone, 1 × 30.
    expect(oppActiveDamage(state)).toBe(30);
  });
});

/** TEST SURGERY — the body's top card becomes `id`, a LOCAL card in no deck (so the suite's 60 and
    every seed's shuffle stay byte-identical), entered into the game's `cardPool` alongside. */
function retyped(state: GameState, seat: Seat, spot: Spot, id: string): GameState {
  const uid = bodyAt(state, seat, spot).stack.at(-1);
  const card = POOL[id];
  if (uid === undefined || card === undefined) throw new Error(`no top card at ${seat} ${String(spot)} / no ${id}`);
  return { ...state, cardPool: { ...state.cardPool, [id]: card }, cardIdByUid: { ...state.cardIdByUid, [uid]: id } };
}

/** p2 passes its turn, back to p1. */
const p2Passes = (state: GameState): GameState => must(applyAction(state, { type: "endTurn", seat: "p2" }));

// 🆕🆕🆕 D573 second review — a COPIED self-lock / self-boost that NAMES the source attack. Its
// installer (interpreter.ts `preventAttackUse` and the boost installer) resolves the printed name
// against the HOLDER's own card, and the holder is the COPIER (R-CP2), which prints no attack of that
// name — so it installs NOTHING, silently, and the sentence is not skipped. Before D573 that was a
// constructed case ("unreachable off every printing — all name their own attack"); a copy REACHES it
// off real printings. R-CP9 (⚠️ UNRULED, decisions.md D573) reads it as the rules answer under the
// name-reference reading: the copier has no attack by that name, so the lock binds nothing and the
// boost pays nothing. Each rung pairs the copy with the SOURCE used directly (the installer works).
describe("D573 §3c — R-CP9 (⚠️ UNRULED): a copied lock or boost that NAMES the source attack binds nothing", () => {
  it("the three sentences are REAL legal corpus sentences, each claimed by a reader (so a copy reaches them)", () => {
    for (const text of [SLASHING_TEXT, BLITZ_TEXT, ECHO_TEXT]) {
      expect(legalAttackCorpus().some(([, s]) => s === text)).toBe(true);
      expect(resolvedByAnyReader(text)).toBe(true);
    }
  });

  it("control — the SOURCE using Slashing Strike directly installs its lock", () => {
    const board = retyped(armed(ZOROARK[0]), "p1", "active", SLASHER);
    const { state, events } = run(board, { type: "attack", seat: "p1", index: 1 });
    expect(all(events, "ATTACK_LOCKED")).toHaveLength(1);
    expect(bodyAt(state, "p1", "active").lockedAttacks).toHaveLength(1);
  });

  it("🛑 Foul Play copying Slashing Strike: 60, NO lock, nothing skipped — and Foul Play copies it AGAIN next turn", () => {
    const board = retyped(armed(ZOROARK[0]), "p2", "active", SLASHER);
    const parked = run(board, declare(ZOROARK[0]));
    const { state, events } = run(parked.state, pickAttack(1));
    expect(all(events, "ATTACK_DECLARED")[0]).toMatchObject({ attack: "Foul Play", as: "Slashing Strike" });
    expect(all(events, "DAMAGE_DEALT")[0]).toMatchObject({ base: 60 });
    expect(types(events)).not.toContain("ATTACK_LOCKED");
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(bodyAt(state, "p1", "active").lockedAttacks).toEqual([]);
    const again = run(run(p2Passes(state), declare(ZOROARK[0])).state, pickAttack(1));
    expect(all(again.events, "ATTACK_DECLARED")[0]).toMatchObject({ as: "Slashing Strike" });
    expect(oppActiveDamage(again.state)).toBe(120);
  });

  it("🛑 Foul Play copying Blaze Blitz (until it leaves the Active Spot): 260 every turn, no bar", () => {
    const board = retyped(armed(ZOROARK[0]), "p2", "active", BLITZER);
    const first = run(run(board, declare(ZOROARK[0])).state, pickAttack(1));
    expect(all(first.events, "ATTACK_DECLARED")[0]).toMatchObject({ as: "Blaze Blitz" });
    expect(types(first.events)).not.toContain("ATTACK_LOCKED");
    expect(types(first.events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(bodyAt(first.state, "p1", "active").lockedAttacks).toEqual([]);
    const again = run(run(p2Passes(first.state), declare(ZOROARK[0])).state, pickAttack(1));
    expect(all(again.events, "DAMAGE_DEALT")[0]).toMatchObject({ base: 260 });
  });

  it("control — the SOURCE using Echoed Voice directly records its next-turn boost", () => {
    const board = retyped(armed(ZOROARK[0]), "p1", "active", ECHOER);
    const { state } = run(board, { type: "attack", seat: "p1", index: 0 });
    expect(bodyAt(state, "p1", "active").boostedAttack).toMatchObject({ attackIndex: 0, amount: 80 });
  });

  it("🛑 Foul Play copying Echoed Voice: 30, NO boost recorded, and the next turn's copy is 30 again", () => {
    const board = retyped(armed(ZOROARK[0]), "p2", "active", ECHOER);
    const first = run(board, declare(ZOROARK[0]));
    expect(all(first.events, "ATTACK_DECLARED")[0]).toMatchObject({ as: "Echoed Voice" });
    expect(types(first.events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(bodyAt(first.state, "p1", "active").boostedAttack).toBeNull();
    const again = run(p2Passes(first.state), declare(ZOROARK[0]));
    expect(all(again.events, "DAMAGE_DEALT")[0]).toMatchObject({ base: 30 });
  });
});

describe("D573 §4 — the bounds and the empty readings", () => {
  it("🛑 R-CP3 — Foul Play against Persian ex offers ONLY Cruel Slash (Haughty Order is a copy): forced, no park", () => {
    const { events } = run(armed(ZOROARK[0], [], PERSIAN), declare(ZOROARK[0]));
    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(all(events, "ATTACK_DECLARED")[0]).toMatchObject({ as: "Cruel Slash" });
  });

  it("🛑 R-CP3 — Foul Play against a Foul Play Zoroark offers ONLY Mind Jack", () => {
    const { events } = run(armed(CLEFABLE, [], ZOROARK[0]), declare(CLEFABLE));
    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(all(events, "ATTACK_DECLARED")[0]).toMatchObject({ attack: "Metronome", as: "Mind Jack" });
  });

  it("🛑 Gemstone Mimicry against a NON-Tera Active does nothing — even one carrying two attacks", () => {
    const { state, events } = run(armed(MIMIKYU, [], TARGET), declare(MIMIKYU));
    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(oppActiveDamage(state)).toBe(0);
  });

  it("🛑 Try to Imitate on TAILS does nothing (forced and parked boards alike)", () => {
    const forced = run(withFaces(armed(SUDOWOODO, [], SOLO), ["tails"]), declare(SUDOWOODO));
    expect(all(forced.events, "ATTACK_EFFECT_COIN_FLIP")[0]).toMatchObject({ result: "tails" });
    expect(oppActiveDamage(forced.state)).toBe(0);
    // 🆕🆕🆕 D573 review — tails COPIED NOTHING, so `as` is ABSENT (events.ts) and the log does not
    // say the attack became Smash. (The first build asserted `as: "Smash"` here.)
    expect(all(forced.events, "ATTACK_DECLARED")[0]).not.toHaveProperty("as");
    const lines = render(forced.events, forced.state);
    expect(lines).toContain("p1: Ethan's Sudowoodo used Try to Imitate");
    expect(lines.some((l) => l.includes("(as "))).toBe(false);
    const parked = run(withFaces(armed(SUDOWOODO, [], TARGET), ["tails"]), declare(SUDOWOODO));
    const { state, events } = run(parked.state, pickAttack(1));
    expect(all(events, "ATTACK_DECLARED")[0]).not.toHaveProperty("as");
    expect(oppActiveDamage(state)).toBe(0);
    expect(turnPassed(state)).toBe(true);
  });

  it("🛑 a CONFUSED tails resolves no copy — and Try to Imitate spends no second coin", () => {
    const confuse = (s: GameState) =>
      withBody(s, "p1", "active", (p) => ({ ...p, conditions: { ...p.conditions, rotation: "confused" } }));
    const foul = run(withFaces(confuse(armed(ZOROARK[0], [], SOLO)), ["tails"]), declare(ZOROARK[0]));
    expect(all(foul.events, "ATTACK_FAILED")[0]).toMatchObject({ reason: "confusion" });
    expect(oppActiveDamage(foul.state)).toBe(0);
    // Nothing resolved, so nothing was copied: no `as` (D573 review, events.ts).
    expect(all(foul.events, "ATTACK_DECLARED")[0]).not.toHaveProperty("as");
    const imitate = run(withFaces(confuse(armed(SUDOWOODO, [], SOLO)), ["tails"]), declare(SUDOWOODO));
    expect(all(imitate.events, "CONFUSION_CHECK")).toHaveLength(1);
    expect(all(imitate.events, "ATTACK_EFFECT_COIN_FLIP")).toHaveLength(0);
    expect(oppActiveDamage(imitate.state)).toBe(0);
  });

  it("🛑 Night Joker with 2+ N's bodies: choosePokemon (only eligible bodies) → chooseAttack → the pick", () => {
    const parked = run(armed(NIGHT_JOKER_IDS[0], [ZORUA, N_ONE, NIGHT_JOKER_IDS[1], N_TWO], SOLO), declare(NIGHT_JOKER_IDS[0]));
    expect(prompt(parked.state)).toMatchObject({
      kind: "choosePokemon",
      candidates: [
        { seat: "p1", spot: { spot: "bench", index: 1 } },
        { seat: "p1", spot: { spot: "bench", index: 3 } },
      ],
    });
    // Zorua (bench 0) is not N's; the Benched N's Zoroark ex (bench 2) has no eligible attack.
    expect(refused(parked.state, pickBench(0)).code).toBe("BAD_EFFECT_CHOICE");
    expect(refused(parked.state, pickBench(2)).code).toBe("BAD_EFFECT_CHOICE");
    const second = run(parked.state, pickBench(3));
    expect(types(second.events)).toEqual(["EFFECT_PENDING"]);
    expect(prompt(second.state)).toMatchObject({ kind: "chooseAttack", candidates: [{ index: 0 }, { index: 1 }] });
    const { state, events } = run(second.state, pickAttack(0));
    expect(all(events, "ATTACK_DECLARED")[0]).toMatchObject({ attack: "Night Joker", as: "Gear Hit" });
    expect(oppActiveDamage(state)).toBe(30);
  });

  it("Night Joker's body pick FORCES the attack when that body has one", () => {
    const parked = run(armed(NIGHT_JOKER_IDS[0], [N_ONE, N_TWO], SOLO), declare(NIGHT_JOKER_IDS[0]));
    const { state, events } = run(parked.state, pickBench(0));
    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(all(events, "ATTACK_DECLARED")[0]).toMatchObject({ as: "Flare Burst" });
    expect(oppActiveDamage(state)).toBe(50);
  });

  it("an attack index the prompt did not offer is refused, and the park stands", () => {
    const parked = run(armed(ZOROARK[0], [], TARGET), declare(ZOROARK[0]));
    expect(refused(parked.state, pickAttack(2)).code).toBe("BAD_EFFECT_CHOICE");
    expect(refused(parked.state, { type: "endTurn", seat: "p1" }).code).toBeDefined();
  });

  it("🛑 the answer RE-VALIDATES the copier: another uid in the Active spot (even another Foul Play) is PHASE_DESYNC", () => {
    const parked = run(armed(ZOROARK[0], [ZOROARK[1]], TARGET), declare(ZOROARK[0]));
    const side = parked.state.players.p1;
    const swapped: GameState = {
      ...parked.state,
      players: {
        ...parked.state.players,
        p1: { ...side, active: bodyAt(parked.state, "p1", 0), bench: [bodyAt(parked.state, "p1", "active")] },
      },
    };
    expect(refused(swapped, pickAttack(1)).code).toBe("PHASE_DESYNC");
  });

  it("🛑 every declaration gate runs AGAIN on the copier at the answer: a cost no longer met is refused", () => {
    const parked = run(armed(ZOROARK[0], [], TARGET), declare(ZOROARK[0]));
    const stripped = withBody(parked.state, "p1", "active", (p) => ({ ...p, energy: p.energy.slice(1) }));
    expect(refused(stripped, pickAttack(1)).code).toBe("ATTACK_COST_UNMET");
  });
});

describe("D573 §5 — the park: inert, serialisable, and inert under a 0.456 rollback", () => {
  const parkedBoard = () => run(armed(ZOROARK[0], [], TARGET), declare(ZOROARK[0]));

  it("🛑 the park leaves the state byte-identical except `phase`; its only event is EFFECT_PENDING", () => {
    const before = armed(ZOROARK[0], [], TARGET);
    const parked = run(before, declare(ZOROARK[0]));
    expect(parked.events).toEqual([{ type: "EFFECT_PENDING", seat: "p1", note: expect.any(String) }]);
    const { phase: _a, ...restBefore } = before;
    const { phase: _b, ...restAfter } = parked.state;
    expect(JSON.stringify(restAfter)).toBe(JSON.stringify(restBefore));
    expect(parked.state.phase).toMatchObject({ kind: "effect:choose", seat: "p1" });
    expect(parked.state.phase).not.toHaveProperty("resumeTail");
    expect(parked.state.phase).not.toHaveProperty("endsTurn");
    expect(parked.state.phase).not.toHaveProperty("answerer");
  });

  it("the parked prompts are WIRE-legal (redacted for the answering seat)", () => {
    const wire = redactGame(parkedBoard().state, "p1").phase;
    if (wire.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(redactedEffectPromptSchema.parse(wire.prompt)).toMatchObject({ kind: "chooseAttack" });
    const nj = run(armed(NIGHT_JOKER_IDS[0], [N_ONE, N_TWO], SOLO), declare(NIGHT_JOKER_IDS[0]));
    const njWire = redactGame(nj.state, "p1").phase;
    if (njWire.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(redactedEffectPromptSchema.parse(njWire.prompt)).toMatchObject({ kind: "choosePokemon" });
  });

  it("🛑 a JSON round-trip of the parked state resolves identically", () => {
    const parked = parkedBoard();
    const revived = JSON.parse(JSON.stringify(parked.state)) as GameState;
    const direct = run(parked.state, pickAttack(1));
    const viaJson = run(revived, pickAttack(1));
    expect(JSON.stringify(viaJson.state)).toBe(JSON.stringify(direct.state));
    expect(viaJson.events).toEqual(direct.events);
  });

  it("🛑 THE ROLLBACK READING (0.456's path: no route, `applyChoice` default, then `settleProgram`) is INERT", () => {
    const parked = parkedBoard().state;
    const phase = parked.phase;
    if (phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect((phase.cont.pendingOp as EffectOp).op).toBe("useAttackAs");
    const events: GameEvent[] = [];
    const choice: EffectChoice = { kind: "attack", index: 1 };
    const rolled = settleProgram(resumeProgram(parked, phase.cont, choice, events), phase.seat, events, {
      resumeTail: phase.resumeTail === true,
      endsTurn: phase.endsTurn === true,
    });
    if (!rolled.ok) throw new Error("the rollback reading failed");
    expect(rolled.state.phase).toEqual({ kind: "turn:action", seat: "p1" });
    expect(JSON.stringify(rolled.state.players)).toBe(JSON.stringify(parked.players));
    expect(rolled.state.rngState).toBe(parked.rngState);
    expect(types(rolled.events)).not.toContain("ATTACK_DECLARED");
    expect(rolled.events).toEqual([]);
    expect(bodyAt(rolled.state, "p1", "active").usedAttack).toBeNull();
    // …and the player may simply declare again (the turn was never spent).
    expect(run(rolled.state, declare(ZOROARK[0])).events.map((e) => e.type)).toEqual(["EFFECT_PENDING"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("D573 §6 — the version", () => {
  it("the engine is 0.550.0", () => {
    expect(engineVersion).toBe("0.550.0");
  });
});
