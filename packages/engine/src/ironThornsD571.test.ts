import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import manifest from "../package.json" with { type: "json" };
import { bannerOf } from "./banners";
import { disabledAbilityUids, passivesOf } from "./continuous";
import { deriveAttackEffect } from "./effects";
import type { GameEvent } from "./events";
import { applyAction, createGame, engineVersion, providedEnergy } from "./index";
import type { GameAction, GameState, Seat } from "./index";
import { runProgram } from "./interpreter";
import type { EffectRecord } from "./interpreter";
import { programFor } from "./registry";
import {
  FIXTURE_POOL,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  setActiveFromDeck,
  specialEnergy,
  trainerCard,
  typedEnergy,
} from "./testFixtures";
import type { InPlayPokemon } from "./types";

// ── 🆕🆕🆕 D571 — PARADOX PART b (IRON THORNS) + THE IGNITION RIDER: 6 PRINTINGS ─────────────────
//
//   Iron Thorns ex   sv06-077 / sv06-196 / sv08.5-032   Ability "Initialization"
//   Iron Thorns      sv05-062 / svp-098                 attack index 0 "Destructo-Press"
//   Ignition Energy  sv10.5w-086                        Special Energy (catalog `energyType "Normal"`)
//
// Initialization is Mischievous Lock's aura with two NEW catalog-only narrowings (`ruleBox`,
// `exemptBanner "Future"`), and it is the first LEGAL lock whose source another legal lock
// reaches — so continuous.ts `disabledAbilityUids` now settles the auras by the STRATIFIED pass
// (R-LK2 ⚠️ UNRULED). Destructo-Press is the NEW non-parking `revealTopDiscardMatching` (R-DP1
// ⚠️ UNRULED: the discard runs before the damage). Ignition is Reversal's "Evolution" provision
// with three Colorless units plus the NEW `discardAtEndOfYourTurn`, paid by flow.ts's `endTurn`
// stage (R-IG1 ⚠️ UNRULED: after Powerglass and Amarys). Driven on REAL ids in a LOCAL `cardPool`
// (D275), card bodies transcribed from the tcgdex card JSON (the audit's, 2026-10-03). Rulings:
// docs/decisions.md D571.

const THORNS_EX = ["sv06-077", "sv06-196", "sv08.5-032"] as const;
const THORNS = ["sv05-062", "svp-098"] as const;
const IGNITION = "sv10.5w-086";
const FLUTTER = "sv05-078"; // Ancient, no Rule Box — Midnight Fluttering
const GASTRODON = "sv08-107"; // Stage 1, no Rule Box — Sticky Bind
const POD = "sv05-158"; // a FUTURE Trainer (Reboot Pod)
const GUIDANCE = "sv05-147"; // an ANCIENT Trainer — the wrong-banner control
const KLEFKI = "sv01-096";
const SPIRITOMB = "sv02-089";
const TING_LU = "sv02-127";
const CHIEN_PAO = "sv02-061"; // Rule Box — the ACTIVATED Ability (Shivery Chill)
const COPPERAJAH = "sv02-150"; // Rule Box — the PASSIVE Ability (Bronze Body, −30)
const KLAWF = "sv03-120"; // Rule Box — the TRIGGERED Ability (Counterattacking Pincer)
const STAGE1 = "fix-stage1";
const FILLER = "d571-filler";
const L = "d571-L";
const C = "fix-energy";

const INITIALIZATION_TEXT =
  "As long as this Pokémon is in the Active Spot, Pokémon with a Rule Box in play (both yours and your opponent's) have no Abilities, except for Future Pokémon. (Pokémon ex, Pokémon V, etc. have Rule Boxes.)";
const DESTRUCTO_TEXT =
  "Reveal the top 5 cards of your deck. This attack does 70 damage for each Future card you find there. Then, discard those Future cards and shuffle the other cards back into your deck.";
const IGNITION_TEXT =
  "If this card is attached to 1 of your Pokémon, discard it at the end of your turn.\n\nAs long as this card is attached to a Pokémon, it provides {C} Energy.\n\nIf this card is attached to an Evolution Pokémon, it provides {C}{C}{C} Energy instead.";

const thornsEx = (id: string): Card =>
  battler(id, {
    name: "Iron Thorns ex",
    hp: 230,
    types: ["Lightning"],
    retreat: 4,
    weaknesses: [{ type: "Fighting", value: "×2" }],
    abilities: [{ type: "Ability", name: "Initialization", effect: INITIALIZATION_TEXT }],
    attacks: [
      {
        cost: ["Lightning", "Colorless", "Colorless"],
        name: "Volt Cyclone",
        damage: 140,
        effect: "Move an Energy from this Pokémon to 1 of your Benched Pokémon.",
      },
    ],
  });
const thorns = (id: string): Card =>
  battler(id, {
    name: "Iron Thorns",
    hp: 140,
    types: ["Lightning"],
    retreat: 3,
    weaknesses: [{ type: "Fighting", value: "×2" }],
    attacks: [
      { cost: ["Lightning", "Colorless"], name: "Destructo-Press", damage: "70×", effect: DESTRUCTO_TEXT },
      { cost: ["Lightning", "Lightning", "Lightning", "Colorless"], name: "Megaton Lariat", damage: 140 },
    ],
  });

const LOCAL_CARDS: Record<string, Card> = {
  ...Object.fromEntries(THORNS_EX.map((id) => [id, thornsEx(id)])),
  ...Object.fromEntries(THORNS.map((id) => [id, thorns(id)])),
  [IGNITION]: { ...specialEnergy(IGNITION, "Ignition Energy", IGNITION_TEXT), energyType: "Normal" },
  [FLUTTER]: battler(FLUTTER, {
    name: "Flutter Mane",
    hp: 90,
    types: ["Psychic"],
    retreat: 1,
    weaknesses: [{ type: "Metal", value: "×2" }],
    abilities: [
      {
        type: "Ability",
        name: "Midnight Fluttering",
        effect:
          "As long as this Pokémon is in the Active Spot, your opponent's Active Pokémon has no Abilities, except for Midnight Fluttering.",
      },
    ],
    attacks: [
      {
        cost: ["Colorless", "Colorless", "Colorless"],
        name: "Hex Hurl",
        damage: 90,
        effect: "Put 2 damage counters on your opponent's Benched Pokémon in any way you like.",
      },
    ],
  }),
  [GASTRODON]: battler(GASTRODON, {
    name: "Gastrodon",
    stage: "Stage1",
    evolveFrom: "Shellos",
    hp: 130,
    retreat: 3,
    types: ["Fighting"],
    weaknesses: [{ type: "Grass", value: "×2" }],
    abilities: [
      {
        type: "Ability",
        name: "Sticky Bind",
        effect:
          "As long as this Pokémon is on your Bench, Benched Stage 2 Pokémon (both yours and your opponent's) have no Abilities.",
      },
    ],
    attacks: [{ cost: ["Fighting", "Colorless", "Colorless"], name: "Mud Shot", damage: 80 }],
  }),
  [POD]: {
    ...trainerCard(POD, "Item", "Attach a Basic Energy card from your discard pile to each of your Future Pokémon."),
    name: "Reboot Pod",
  },
  [GUIDANCE]: {
    ...trainerCard(
      GUIDANCE,
      "Supporter",
      "Look at the top 6 cards of your deck and put 2 of them into your hand. Discard the other cards.",
    ),
    name: "Explorer's Guidance",
  },
  [FILLER]: battler(FILLER, {
    name: "D571 Filler",
    hp: 900,
    types: ["Water"],
    attacks: [{ cost: [], name: "Tap", damage: 10 }],
  }),
  [L]: typedEnergy(L, "Lightning"),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

/** Its OWN deck (D270), 60 by construction. */
const DECK = deckOf({
  [THORNS_EX[0]]: 3,
  [THORNS[0]]: 2,
  [IGNITION]: 3,
  [FLUTTER]: 1,
  [GASTRODON]: 1,
  [POD]: 2,
  [GUIDANCE]: 2,
  [KLEFKI]: 1,
  [SPIRITOMB]: 1,
  [TING_LU]: 1,
  [CHIEN_PAO]: 1,
  [COPPERAJAH]: 2,
  [KLAWF]: 1,
  [STAGE1]: 1,
  "fix-pokemon-v": 1,
  "fix-water-energy": 2,
  [L]: 6,
  [C]: 8,
  [FILLER]: 21,
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

/** p2 went first and passed: p1's turn 2 — p1's FIRST turn. */
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

/** Prized/hand/discarded copies of `id` swapped into the deck until it holds at least `k`. */
function ensureCopies(state: GameState, seat: Seat, id: string, k = 1): GameState {
  let next = state;
  for (;;) {
    const side = next.players[seat];
    if (side.deck.filter((u) => next.cardIdByUid[u] === id).length >= k) return next;
    const loose = [...side.hand, ...side.discard].find((u) => next.cardIdByUid[u] === id);
    if (loose !== undefined) {
      next = {
        ...next,
        players: {
          ...next.players,
          [seat]: {
            ...side,
            hand: side.hand.filter((u) => u !== loose),
            discard: side.discard.filter((u) => u !== loose),
            deck: [...side.deck, loose],
          },
        },
      };
      continue;
    }
    const prized = side.prizes.find((u) => next.cardIdByUid[u] === id);
    if (prized === undefined) throw new Error(`${seat} has fewer than ${k} ${id} to seat`);
    const swap =
      side.deck.find((u) => next.cardIdByUid[u] === FILLER) ?? side.deck.find((u) => next.cardIdByUid[u] !== id);
    if (swap === undefined) throw new Error("no card to swap");
    next = {
      ...next,
      players: {
        ...next.players,
        [seat]: {
          ...side,
          prizes: side.prizes.map((u) => (u === prized ? swap : u)),
          deck: [...side.deck.filter((u) => u !== swap), prized],
        },
      },
    };
  }
}

type Spot = "active" | number;

function bodyAt(state: GameState, seat: Seat, spot: Spot = "active"): InPlayPokemon {
  const side = state.players[seat];
  const p = spot === "active" ? side.active : side.bench[spot];
  if (p === null || p === undefined) throw new Error(`no body at ${seat} ${String(spot)}`);
  return p;
}
function uidOf(state: GameState, seat: Seat, spot: Spot = "active"): string {
  const b = bodyAt(state, seat, spot);
  return b.stack[b.stack.length - 1] as string;
}

function withBody(state: GameState, seat: Seat, spot: Spot, f: (p: InPlayPokemon) => InPlayPokemon): GameState {
  const side = state.players[seat];
  const next =
    spot === "active"
      ? { ...side, active: f(bodyAt(state, seat, "active")) }
      : { ...side, bench: side.bench.map((p, i) => (i === spot ? f(p) : p)) };
  return { ...state, players: { ...state.players, [seat]: next } };
}

/** TEST SURGERY — one copy each of `ids` out of `seat`'s deck onto the body at `spot`. */
function energize(state: GameState, seat: Seat, spot: Spot, ids: readonly string[]): GameState {
  let next = state;
  for (const id of ids) {
    next = ensureCopies(next, seat, id, 1);
    const side = next.players[seat];
    const uid = side.deck.find((u) => next.cardIdByUid[u] === id) as string;
    next = { ...next, players: { ...next.players, [seat]: { ...side, deck: side.deck.filter((u) => u !== uid) } } };
    next = withBody(next, seat, spot, (p) => ({ ...p, energy: [...p.energy, uid] }));
  }
  return next;
}

/** TEST SURGERY — `seat`'s deck re-ordered so `ids` (one copy each, in order) are its top cards. */
function stackTop(state: GameState, seat: Seat, ids: readonly string[]): GameState {
  let next = state;
  for (const id of new Set(ids)) next = ensureCopies(next, seat, id, ids.filter((x) => x === id).length);
  const side = next.players[seat];
  const top: string[] = [];
  let rest = [...side.deck];
  for (const id of ids) {
    const uid = rest.find((u) => next.cardIdByUid[u] === id) as string;
    rest = rest.filter((u) => u !== uid);
    top.push(uid);
  }
  return { ...next, players: { ...next.players, [seat]: { ...side, deck: [...top, ...rest] } } };
}

/** TEST SURGERY — `seat`'s deck cut to exactly `ids` (the rest moved to the discard pile). */
function deckExactly(state: GameState, seat: Seat, ids: readonly string[]): GameState {
  const stacked = stackTop(state, seat, ids);
  const side = stacked.players[seat];
  return {
    ...stacked,
    players: {
      ...stacked.players,
      [seat]: { ...side, deck: side.deck.slice(0, ids.length), discard: [...side.discard, ...side.deck.slice(ids.length)] },
    },
  };
}

/** Both boards laid out by surgery on p1's first turn; both hands and discard piles emptied. */
function table(
  opts: { p1?: string; p1Bench?: readonly string[]; p2?: string; p2Bench?: readonly string[] } = {},
  seed = 5711,
): GameState {
  let state = opened(seed);
  for (const seat of ["p1", "p2"] as const) {
    const side = state.players[seat];
    state = {
      ...state,
      players: { ...state.players, [seat]: { ...side, deck: [...side.deck, ...side.hand, ...side.discard], hand: [], discard: [] } },
    };
  }
  state = setActiveFromDeck(ensureCopies(state, "p1", opts.p1 ?? FILLER), "p1", opts.p1 ?? FILLER);
  state = setActiveFromDeck(ensureCopies(state, "p2", opts.p2 ?? FILLER), "p2", opts.p2 ?? FILLER);
  state = clearBench(clearBench(state, "p1"), "p2");
  for (const id of opts.p1Bench ?? []) state = benchFromDeck(ensureCopies(state, "p1", id), "p1", id);
  for (const id of opts.p2Bench ?? []) state = benchFromDeck(ensureCopies(state, "p2", id), "p2", id);
  return state;
}

function all<T extends GameEvent["type"]>(events: readonly GameEvent[], type: T): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}
const dealt = (events: readonly GameEvent[]): number | undefined => all(events, "DAMAGE_DEALT")[0]?.dealt;
const ids = (state: GameState, uids: readonly string[]) => uids.map((u) => state.cardIdByUid[u]);

/** TEST SURGERY — Team Rocket's Watchtower `sv10-180` stood in the Stadium zone (one deck uid
    re-labelled; `stadiumEffectsOf` reads the id alone — `abilityBundleD559.test.ts` §7's idiom). */
function withWatchtower(state: GameState): GameState {
  const towerUid = state.players.p1.deck[state.players.p1.deck.length - 1];
  if (towerUid === undefined) throw new Error("no deck uid to stand in the Stadium zone");
  return {
    ...state,
    players: { ...state.players, p1: { ...state.players.p1, deck: state.players.p1.deck.slice(0, -1) } },
    cardIdByUid: { ...state.cardIdByUid, [towerUid]: "sv10-180" },
    stadium: { uid: towerUid, owner: "p1" },
  };
}

// ────────────────────────────────────────────────────────────────────────────
describe("D571 §1 — the six registry rows on three objects", () => {
  it("Initialization ×3: ONE object, Mischievous Lock's shape plus `ruleBox` and `exemptBanner \"Future\"`", () => {
    for (const id of THORNS_EX) {
      expect(programFor(id), id).toBe(programFor(THORNS_EX[0]));
      expect(programFor(id)?.passive?.disableAbilities).toEqual({
        side: "both",
        requiresActive: true,
        ruleBox: true,
        exemptBanner: "Future",
      });
      expect(programFor(id)?.attack, id).toBeUndefined(); // Volt Cyclone keeps deriving
      expect(bannerOf(POOL[id] as Card), id).toBe("Future");
    }
  });

  it("Destructo-Press ×2: index 0 only — the reveal-discard op, then 70× the filed count", () => {
    for (const id of THORNS) {
      expect(programFor(id), id).toBe(programFor(THORNS[0]));
      expect(programFor(id)?.attack).toEqual({
        0: [
          { op: "revealTopDiscardMatching", n: 5, filter: { kind: "bannerCard", banner: "Future" }, recordAs: "discarded" },
          { op: "damageDefender", per: 70, count: "discarded" },
        ],
      });
    }
    // The sentence is not read by the deriver — this is a REGISTRY attack (D569's route).
    expect(deriveAttackEffect(DESTRUCTO_TEXT)).toBeNull();
  });

  it("Ignition Energy: {C}, {C}{C}{C} on an Evolution (no riders), discarded at the end of your turn", () => {
    expect(programFor(IGNITION)?.energy).toEqual({
      provides: ["Colorless"],
      promoteOnHolderStage: { stage: "Evolution", units: ["Colorless", "Colorless", "Colorless"] },
      discardAtEndOfYourTurn: true,
    });
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D571 §2 — Initialization's aura, and R-LK2: the stratified lock pass", () => {
  it("an ACTIVE Iron Thorns ex silences every Rule Box body on BOTH sides — except Future ones, and never a non-Rule-Box body", () => {
    const state = table({ p1: THORNS_EX[0], p1Bench: [COPPERAJAH, THORNS_EX[0], FILLER], p2: CHIEN_PAO, p2Bench: [KLAWF, KLEFKI] });
    const locked = disabledAbilityUids(state);
    expect(locked).toEqual(new Set([uidOf(state, "p1", 0), uidOf(state, "p2"), uidOf(state, "p2", 0)]));
    expect(locked.has(uidOf(state, "p1"))).toBe(false); // the source — Future, exempt
    expect(locked.has(uidOf(state, "p1", 1))).toBe(false); // a benched Iron Thorns ex — Future, exempt
    expect(locked.has(uidOf(state, "p1", 2))).toBe(false); // no Rule Box
    expect(locked.has(uidOf(state, "p2", 1))).toBe(false); // Klefki: no Rule Box (and Benched, so no aura of its own)
  });

  it("a BENCHED Iron Thorns ex locks nothing (`requiresActive`)", () => {
    const state = table({ p1: FILLER, p1Bench: [THORNS_EX[0], COPPERAJAH], p2: CHIEN_PAO });
    expect(disabledAbilityUids(state)).toEqual(new Set());
  });

  it("🛑 R-LK2 ONE-WAY: an Active Flutter Mane silences the opposing Active Iron Thorns ex, so Initialization is OFF", () => {
    const state = table({ p1: THORNS_EX[0], p1Bench: [COPPERAJAH], p2: FLUTTER, p2Bench: [CHIEN_PAO] });
    const locked = disabledAbilityUids(state);
    expect(locked.has(uidOf(state, "p1"))).toBe(true); // Midnight Fluttering reaches Iron Thorns ex
    expect(locked.has(uidOf(state, "p2"))).toBe(false); // Flutter Mane has no Rule Box — never reached
    // …and Initialization, its holder silenced by an ON lock, locks nothing:
    expect(locked.has(uidOf(state, "p1", 0))).toBe(false);
    expect(locked.has(uidOf(state, "p2", 0))).toBe(false);
    expect(locked).toEqual(new Set([uidOf(state, "p1")]));
  });

  it("the SAME board with Flutter Mane BENCHED: Midnight Fluttering is off, so Initialization bites", () => {
    const state = table({ p1: THORNS_EX[0], p1Bench: [COPPERAJAH], p2: CHIEN_PAO, p2Bench: [FLUTTER] });
    expect(disabledAbilityUids(state)).toEqual(new Set([uidOf(state, "p1", 0), uidOf(state, "p2")]));
  });

  it("the mirror: two Active Iron Thorns ex are both Future and both exempt — BOTH locks stay ON", () => {
    const state = table({ p1: THORNS_EX[0], p1Bench: [COPPERAJAH], p2: THORNS_EX[0], p2Bench: [CHIEN_PAO] });
    expect(disabledAbilityUids(state)).toEqual(new Set([uidOf(state, "p1", 0), uidOf(state, "p2", 0)]));
  });

  it("Gastrodon never touches Iron Thorns ex (an Active Basic), and Initialization never touches Gastrodon (no Rule Box): both stay ON", () => {
    const state = table({ p1: THORNS_EX[0], p1Bench: [COPPERAJAH], p2: FILLER, p2Bench: [GASTRODON] });
    const locked = disabledAbilityUids(state);
    expect(locked).toEqual(new Set([uidOf(state, "p1", 0)]));
    expect(locked.has(uidOf(state, "p2", 0))).toBe(false);
  });

  it("Team Rocket's Watchtower never touches Iron Thorns ex ({L}, not {C}); Initialization never touches the Stadium", () => {
    const state = withWatchtower(table({ p1: THORNS_EX[0], p1Bench: [COPPERAJAH], p2: STAGE1 }));
    const locked = disabledAbilityUids(state);
    expect(locked.has(uidOf(state, "p1"))).toBe(false);
    expect(locked.has(uidOf(state, "p1", 0))).toBe(true); // Initialization ON
    expect(locked.has(uidOf(state, "p2"))).toBe(true); // a {C} body: the Stadium's lock is live
  });

  it("🛑 Initialization silences an Active Ting-Lu ex (a Rule Box, not Future), so Cursed Land is OFF", () => {
    let state = table({ p1: THORNS_EX[0], p1Bench: [FILLER], p2: TING_LU });
    state = withBody(state, "p1", 0, (p) => ({ ...p, damage: 30 })); // Cursed Land's target, if it were on
    const locked = disabledAbilityUids(state);
    expect(locked.has(uidOf(state, "p2"))).toBe(true);
    expect(locked.has(uidOf(state, "p1", 0))).toBe(false);
    // The control: the same damaged body under an Active Ting-Lu ex with NO Initialization.
    let free = table({ p1: FILLER, p1Bench: [FILLER], p2: TING_LU });
    free = withBody(free, "p1", 0, (p) => ({ ...p, damage: 30 }));
    expect(disabledAbilityUids(free).has(uidOf(free, "p1", 0))).toBe(true);
  });

  it("Klefki silences a Spiritomb (a Basic), and Spiritomb never reaches Klefki — the target set is Klefki's alone", () => {
    // 🆕 (the D571 review): what this rung pins is Spiritomb's OWN silencing and the target set.
    // The OFF verdict on Fettered in Misfortune is NOT observable here or on any board: Klefki's
    // Basic lock contains every Basic V Spiritomb could reach, so the Set is identical whether
    // Spiritomb's aura is ON or OFF — that verdict is named in the docs, never claimed as pinned.
    const state = table({ p1: KLEFKI, p2: FILLER, p2Bench: [SPIRITOMB, "fix-pokemon-v"] });
    const locked = disabledAbilityUids(state);
    expect(locked.has(uidOf(state, "p2", 0))).toBe(true); // Spiritomb silenced
    expect(locked.has(uidOf(state, "p1"))).toBe(false); // Klefki: not a V
    expect(locked.has(uidOf(state, "p2", 1))).toBe(true); // the V, by Klefki
  });

  it("🛑 a MUTUAL pair (Klefki vs Flutter Mane, D559 §7) is a cycle: both stay ON", () => {
    const state = table({ p1: KLEFKI, p1Bench: [FILLER], p2: FLUTTER, p2Bench: [FILLER] });
    const locked = disabledAbilityUids(state);
    expect(locked.has(uidOf(state, "p1"))).toBe(true); // Flutter Mane's lock on Klefki
    expect(locked.has(uidOf(state, "p2"))).toBe(true); // Klefki's lock on Flutter Mane
    expect(locked.has(uidOf(state, "p1", 0))).toBe(true); // …and Klefki still reaches every Basic
    expect(locked.has(uidOf(state, "p2", 0))).toBe(true);
  });

  it("🛑 a lock DOWNSTREAM of a cycle is settled by it (the D571 review's board): Ting-Lu ex vs a damaged Flutter Mane is a source cycle — both ON — so Cursed Land switches a damaged benched Gastrodon OFF and Sticky Bind locks nothing", () => {
    // TEST SURGERY — the benched filler re-labelled `fix-stage2` (Sticky Bind's target; the
    // deck holds none, so the game's pool is given its card too — `topCardOf` reads the pool).
    const relabel = (s0: GameState): GameState => ({
      ...s0,
      cardIdByUid: { ...s0.cardIdByUid, [uidOf(s0, "p1", 0)]: "fix-stage2" },
      cardPool: { ...s0.cardPool, "fix-stage2": POOL["fix-stage2"] as Card },
    });
    let state = relabel(table({ p1: TING_LU, p1Bench: [FILLER], p2: FLUTTER, p2Bench: [GASTRODON] }));
    state = withBody(state, "p2", "active", (p) => ({ ...p, damage: 10 }));
    state = withBody(state, "p2", 0, (p) => ({ ...p, damage: 10 }));
    expect(state.cardPool[state.cardIdByUid[uidOf(state, "p1", 0)] ?? ""]?.stage).toBe("Stage2"); // the surgery took: a Stage 2 on p1's Bench
    const locked = disabledAbilityUids(state);
    expect(locked.has(uidOf(state, "p1"))).toBe(true); // Flutter Mane's lock on Ting-Lu ex (cycle, ON)
    expect(locked.has(uidOf(state, "p2"))).toBe(true); // Cursed Land on the damaged Flutter Mane (cycle, ON)
    expect(locked.has(uidOf(state, "p2", 0))).toBe(true); // Cursed Land on the damaged Gastrodon…
    expect(locked.has(uidOf(state, "p1", 0))).toBe(false); // …so Sticky Bind is OFF: the Stage 2 keeps its Abilities
    expect(locked).toEqual(new Set([uidOf(state, "p1"), uidOf(state, "p2"), uidOf(state, "p2", 0)]));
    // The control: an UNDAMAGED Gastrodon is out of Cursed Land's reach, so Sticky Bind bites.
    let free = relabel(table({ p1: TING_LU, p1Bench: [FILLER], p2: FLUTTER, p2Bench: [GASTRODON] }));
    free = withBody(free, "p2", "active", (p) => ({ ...p, damage: 10 }));
    expect(disabledAbilityUids(free).has(uidOf(free, "p1", 0))).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D571 §3 — Initialization through the §9 gates: a passive, an activated and a triggered Rule Box Ability", () => {
  it("PASSIVE — Copperajah ex's Bronze Body (−30) folds to 0 under Initialization, 30 without", () => {
    const locked = table({ p1: THORNS_EX[0], p2: COPPERAJAH });
    expect(passivesOf(locked, bodyAt(locked, "p2")).damageReductionAfterWR).toBe(0);
    const free = table({ p1: FILLER, p2: COPPERAJAH });
    expect(passivesOf(free, bodyAt(free, "p2")).damageReductionAfterWR).toBe(30);
    // …end to end: Volt Cyclone's printed 140 lands whole on the silenced Copperajah ex.
    const armed = energize(locked, "p1", "active", [L, C, C]);
    expect(dealt(run(armed, { type: "attack", seat: "p1", index: 0 }).events)).toBe(140);
  });

  it("ACTIVATED — a Benched Chien-Pao ex's Shivery Chill refuses ABILITY_DISABLED (checked before the Active-only gate)", () => {
    const use = { type: "useAbility", seat: "p1", target: { spot: "bench", index: 0 }, abilityName: "Shivery Chill" } as const;
    const locked = applyAction(table({ p1: THORNS_EX[0], p1Bench: [CHIEN_PAO] }), use);
    expect(locked.ok ? "accepted" : locked.error.code).toBe("ABILITY_DISABLED");
    const free = applyAction(table({ p1: FILLER, p1Bench: [CHIEN_PAO] }), use);
    expect(free.ok ? "accepted" : free.error.code).toBe("ABILITY_ACTIVE_ONLY");
  });

  it("TRIGGERED — Klawf ex's Counterattacking Pincer never fires under Initialization; it fires without", () => {
    const locked = energize(table({ p1: THORNS_EX[0], p2: KLAWF }), "p1", "active", [L, C, C]);
    const hit = run(locked, { type: "attack", seat: "p1", index: 0 });
    expect(dealt(hit.events)).toBe(140);
    expect(all(hit.events, "ENERGY_DISCARDED")).toEqual([]);
    expect(hit.state.phase.kind).not.toBe("effect:choose");
    // The control: an unlocked attacker carrying one Energy loses it to the Pincer.
    const free = energize(table({ p1: FILLER, p2: KLAWF }), "p1", "active", [C]);
    const struck = run(free, { type: "attack", seat: "p1", index: 0 });
    const parked = struck.state.phase.kind === "effect:choose";
    const discarded = parked
      ? all(
          run(struck.state, {
            type: "resolveEffect",
            seat: "p2",
            choice: { kind: "cards", uids: [bodyAt(struck.state, "p1").energy[0] as string] },
          } as GameAction).events,
          "ENERGY_DISCARDED",
        )
      : all(struck.events, "ENERGY_DISCARDED");
    expect(discarded).toHaveLength(1);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D571 §4 — Destructo-Press: reveal 5, 70× each Future card, discard them, shuffle the rest", () => {
  const armed = (s: GameState) => energize(s, "p1", "active", [L, C]);

  it("🛑 three Future cards in the top 5 (two Pokémon and a TRAINER): 210, the three discarded, the deck shuffled", () => {
    let state = armed(table({ p1: THORNS[0] }));
    // The 6th card is FUTURE too — the window is 5, so it is neither counted nor discarded.
    state = stackTop(state, "p1", [THORNS_EX[0], FILLER, POD, GUIDANCE, THORNS[0], THORNS_EX[0]]);
    const before = state.players.p1.deck;
    const top5 = before.slice(0, 5);
    const { state: done, events } = run(state, { type: "attack", seat: "p1", index: 0 });
    expect(dealt(events)).toBe(210);
    const future = [top5[0], top5[2], top5[4]] as string[];
    expect(all(events, "DECK_TOP_DISCARDED")).toEqual([{ type: "DECK_TOP_DISCARDED", seat: "p1", actor: "p1", uids: future }]);
    expect(done.players.p1.discard).toEqual(future);
    expect(done.players.p1.deck).toHaveLength(before.length - 3);
    expect([...done.players.p1.deck].sort()).toEqual(before.filter((u) => !future.includes(u)).sort());
    // the 6th card (a Future Iron Thorns ex) stayed in the deck
    expect(done.players.p1.deck).toContain(before[5]);
    // R-DP1: the discard and the shuffle land BEFORE the damage
    const order = events.map((e) => e.type).filter((t) => ["DECK_TOP_DISCARDED", "SHUFFLE", "DAMAGE_DEALT"].includes(t));
    expect(order).toEqual(["DECK_TOP_DISCARDED", "SHUFFLE", "DAMAGE_DEALT"]);
    expect(done.rngState).not.toEqual(state.rngState);
  });

  it("the shuffle is REAL: the non-matching remainder does not keep its order", () => {
    let state = armed(table({ p1: THORNS[0] }));
    state = stackTop(state, "p1", [FILLER, FILLER, FILLER, FILLER, FILLER]);
    const before = state.players.p1.deck;
    const { state: done } = run(state, { type: "attack", seat: "p1", index: 0 });
    expect(done.players.p1.deck).toHaveLength(before.length);
    expect(done.players.p1.deck).not.toEqual(before);
    expect([...done.players.p1.deck].sort()).toEqual([...before].sort());
  });

  it("no Future card in the top 5: no damage, nothing discarded, still a shuffle", () => {
    let state = armed(table({ p1: THORNS[0] }));
    state = stackTop(state, "p1", [FILLER, GUIDANCE, C, FILLER, L, THORNS_EX[0]]);
    const { state: done, events } = run(state, { type: "attack", seat: "p1", index: 0 });
    expect(dealt(events) ?? 0).toBe(0);
    expect(all(events, "DECK_TOP_DISCARDED")).toEqual([]);
    expect(all(events, "SHUFFLE")).toHaveLength(1);
    expect(done.players.p1.discard).toEqual([]);
  });

  it("a SHORT deck reveals what it has (clamped): two Future cards, 140, the deck emptied", () => {
    const state = deckExactly(armed(table({ p1: THORNS[0] })), "p1", [POD, THORNS_EX[0]]);
    const { state: done, events } = run(state, { type: "attack", seat: "p1", index: 0 });
    expect(dealt(events)).toBe(140);
    expect(done.players.p1.deck).toEqual([]);
    expect(ids(done, done.players.p1.discard.slice(-2))).toEqual([POD, THORNS_EX[0]]);
  });

  it("🛑 the op files `recordAs` ALWAYS — an EMPTY deck overwrites a stale slot with `[]` (the overwrite rule)", () => {
    const state = deckExactly(table({ p1: THORNS[0] }), "p1", []);
    const record: EffectRecord = { discarded: ["stale-a", "stale-b"] };
    const events: GameEvent[] = [];
    const result = runProgram(
      state,
      [{ op: "revealTopDiscardMatching", n: 5, filter: { kind: "bannerCard", banner: "Future" }, recordAs: "discarded" }],
      { seat: "p1" },
      events,
      record,
    );
    expect(result.kind).toBe("done");
    expect(record.discarded).toEqual([]);
    expect(events).toEqual([]); // an empty deck: nothing revealed, nothing shuffled
  });

  it("the op files the MATCHES, not the window", () => {
    const state = stackTop(table({ p1: THORNS[0] }), "p1", [FILLER, POD, FILLER, FILLER, FILLER]);
    const record: EffectRecord = {};
    const result = runProgram(
      state,
      [{ op: "revealTopDiscardMatching", n: 5, filter: { kind: "bannerCard", banner: "Future" }, recordAs: "discarded" }],
      { seat: "p1" },
      [],
      record,
    );
    expect(result.kind).toBe("done");
    expect(record.discarded).toEqual([state.players.p1.deck[1]]);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D571 §5 — Ignition Energy", () => {
  it("provides {C} on a Basic and {C}{C}{C} on an Evolution Pokémon", () => {
    const basic = energize(table({ p1: FILLER }), "p1", "active", [IGNITION]);
    expect(providedEnergy(basic, bodyAt(basic, "p1"))).toEqual(["Colorless"]);
    const evolved = energize(table({ p1: FILLER, p1Bench: [STAGE1] }), "p1", 0, [IGNITION]);
    expect(providedEnergy(evolved, bodyAt(evolved, "p1", 0))).toEqual(["Colorless", "Colorless", "Colorless"]);
  });

  it("🛑 is discarded at the end of its OWNER's turn — every body, Active then Bench — and nothing else moves", () => {
    let state = table({ p1: FILLER, p1Bench: [FILLER] });
    state = energize(state, "p1", "active", [IGNITION, C]);
    state = energize(state, "p1", 0, [IGNITION]);
    const ign = [bodyAt(state, "p1").energy[0], bodyAt(state, "p1", 0).energy[0]] as string[];
    const kept = bodyAt(state, "p1").energy[1] as string;
    const { state: done, events } = run(state, { type: "endTurn", seat: "p1" });
    expect(all(events, "ENERGY_DISCARDED")).toEqual([
      { type: "ENERGY_DISCARDED", seat: "p1", actor: "p1", uids: [ign[0]], from: { spot: "active" }, host: uidOf(state, "p1") },
      { type: "ENERGY_DISCARDED", seat: "p1", actor: "p1", uids: [ign[1]], from: { spot: "bench", index: 0 }, host: uidOf(state, "p1", 0) },
    ]);
    expect(bodyAt(done, "p1").energy).toEqual([kept]);
    expect(bodyAt(done, "p1", 0).energy).toEqual([]);
    expect(done.players.p1.discard).toEqual(ign);
    // R-IG1: paid inside the `endTurn` stage, before TURN_ENDED.
    const types = events.map((e) => e.type);
    expect(types.indexOf("ENERGY_DISCARDED")).toBeLessThan(types.indexOf("TURN_ENDED"));
  });

  it("🛑 the OPPONENT's Ignition stays put when your turn ends — and goes when THEIR turn does", () => {
    let state = table({ p1: FILLER, p2: FILLER });
    state = energize(state, "p2", "active", [IGNITION]);
    const ign = bodyAt(state, "p2").energy[0] as string;
    const afterP1 = run(state, { type: "endTurn", seat: "p1" });
    expect(all(afterP1.events, "ENERGY_DISCARDED")).toEqual([]);
    expect(bodyAt(afterP1.state, "p2").energy).toEqual([ign]);
    const afterP2 = run(afterP1.state, { type: "endTurn", seat: "p2" });
    expect(all(afterP2.events, "ENERGY_DISCARDED").map((e) => [e.seat, e.uids])).toEqual([["p2", [ign]]]);
    expect(afterP2.state.players.p2.discard).toContain(ign);
  });

  it("an ATTACK-ended turn discards it too (the same `endTurn` stage)", () => {
    const state = energize(table({ p1: FILLER }), "p1", "active", [IGNITION]);
    const { state: done, events } = run(state, { type: "attack", seat: "p1", index: 0 });
    expect(all(events, "ENERGY_DISCARDED")).toHaveLength(1);
    expect(bodyAt(done, "p1").energy).toEqual([]);
  });

  it("R-IG1: after Amarys's hand discard, before TURN_ENDED", () => {
    let state = energize(table({ p1: FILLER }), "p1", "active", [IGNITION]);
    state = stackTop(state, "p1", [FILLER, FILLER, FILLER, FILLER, FILLER]);
    const side = state.players.p1;
    state = {
      ...state,
      players: { ...state.players, p1: { ...side, hand: side.deck.slice(0, 5), deck: side.deck.slice(5) } },
      allowances: { ...state.allowances, endOfTurnHandDiscard: 5 },
    };
    const { events } = run(state, { type: "endTurn", seat: "p1" });
    const types = events.map((e) => e.type);
    const energy = types.indexOf("ENERGY_DISCARDED");
    expect(energy).toBeGreaterThan(-1);
    expect(events.slice(0, energy).some((e) => e.type !== "ENERGY_DISCARDED" && JSON.stringify(e).includes(side.deck[0] as string))).toBe(true);
    expect(energy).toBeLessThan(types.indexOf("TURN_ENDED"));
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("D571 §6 — the version", () => {
  it("the engine is 0.491.0", () => {
    expect(engineVersion).toBe("0.491.0");
    expect(manifest.version).toBe("0.491.0");
  });
});
