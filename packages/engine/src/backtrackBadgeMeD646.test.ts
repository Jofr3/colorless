import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { coinRedoKey, coinRedoToolOf, spendCoinRedo, toolCardSimulated } from "./continuous";
import { deriveAttackCoinFlip, deriveAttackEffect } from "./effects";
import type { GameAction, GameEvent, GameState } from "./index";
import { applyAction, createGame, engineVersion } from "./index";
import type { PokemonRef } from "./interpreter";
import { programFor } from "./registry";
import { flipCoin } from "./rng";
import type { CoinFace } from "./rng";
import {
  FIXTURE_POOL,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  mustApply,
  setActiveFromDeck,
  trainerCard,
} from "./testFixtures";

// ── 🆕🆕🆕 D646 — BACKTRACK BADGE, THE LAST UNBUILT LEGAL `me` PRINTING ──
//
// Backtrack Badge `me05-074` (Pokémon Tool), text off the LOCAL D1 (`apps/api/.wrangler/…/8437d866….sqlite`),
// 2026-10-11, `legal_standard = 1`. The NEW `PassiveEffects.reflipAttackCoins` (continuous.ts `coinRedoToolOf` /
// `spendCoinRedo`), offered after the attacker's own coins at attack.ts's printed coin flip (the parked op
// `reflipAttackCoins`, `resolveCoinRedo`) and at interpreter.ts's `coinFlipGate` and per-coin `damageChosen` (the
// scheduled op `reflipCoins`). R-BTB1 … R-BTB4 ⚠️ UNRULED. Driven on a LOCAL `cardPool` (D275) in the suite's OWN
// 60-card deck (D270).

const BADGE_TEXT =
  "Once during your turn, after you flip any coins for an attack of the {C} Pokémon this card is attached to, you may ignore all results of those coin flips and begin flipping those coins again.";
const T = {
  fang: "Flip a coin. If tails, this attack does nothing.",
  fury: "Flip 3 coins. This attack does 20 damage for each heads.",
  combo: "Flip a coin until you get tails. This attack does 50 more damage for each heads.",
  slam: "Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed.",
  together:
    "Choose 1 of your opponent's Pokémon and flip a coin for each of your Pokémon in play that has \"Tauros\" in its name. This attack does 50 damage to the chosen Pokémon for each heads. (Don't apply Weakness and Resistance for Benched Pokémon.)",
  zero: "For each of your opponent's Pokémon, flip a coin. If heads, this attack does 150 damage to that Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)",
  opponent:
    "Your opponent flips a coin for each of their Benched Pokémon. This attack does 80 damage to your opponent's Active Pokémon for each tails. This attack's damage isn't affected by Weakness or Resistance.",
} as const;

const BADGE = "me05-074";
const TOWER = "sv06-153"; // Jamming Tower — Pokémon Tools have no effect
const CATCHER = "sv01-187"; // Pokémon Catcher — a Trainer's coin-gated gust
const DUSTOX = "me02.5-015"; // Dustox "Boisterous Wind" — an Ability's coin-gated program (a {C} body here)
const FANG = "d646-fang";
const FURY = "d646-fury";
const COMBO = "d646-combo";
const SLAM = "d646-slam";
const TAUROS = "d646-tauros";
const ZERO = "d646-zero";
const OPP = "d646-opp";
const SPARK = "d646-spark"; // {L}: Hyper Fang on a non-{C} body
const FILLER = "d646-filler";

const attacker = (id: string, name: string, attack: string, text: string, damage?: string, types = ["Colorless"]): Card =>
  battler(id, {
    name,
    hp: 300,
    types,
    retreat: 1,
    attacks: [{ cost: ["Colorless"], name: attack, ...(damage === undefined ? {} : { damage }), effect: text }],
  } as Partial<Card>);

const LOCAL: Record<string, Card> = {
  [BADGE]: { ...trainerCard(BADGE, "Tool", BADGE_TEXT), name: "Backtrack Badge" },
  [TOWER]: { ...trainerCard(TOWER, "Stadium", "Pokémon Tools in play (both yours and your opponent's) have no effect."), name: "Jamming Tower" },
  [CATCHER]: { ...trainerCard(CATCHER, "Item", "Flip a coin. If heads, switch in 1 of your opponent's Benched Pokémon to the Active Spot."), name: "Pokémon Catcher" },
  [FANG]: attacker(FANG, "Watchog", "Hyper Fang", T.fang, "30"),
  [FURY]: attacker(FURY, "Meowth", "Fury Swipes", T.fury, "20×"),
  [COMBO]: attacker(COMBO, "Mega Kangaskhan ex", "Rapid-Fire Combo", T.combo, "50+"),
  [SLAM]: attacker(SLAM, "Lickilicky", "Body Slam", T.slam, "30"),
  [TAUROS]: attacker(TAUROS, "Tauros", "Target Together", T.together),
  [ZERO]: attacker(ZERO, "D646 Zero", "Nullifying Zero", T.zero),
  [OPP]: attacker(OPP, "D646 Coin", "Opposing Coins", T.opponent, "80×"),
  [SPARK]: attacker(SPARK, "D646 Spark", "Hyper Fang", T.fang, "30", ["Lightning"]),
  [DUSTOX]: battler(DUSTOX, {
    name: "Dustox",
    hp: 300,
    types: ["Colorless"],
    retreat: 1,
    abilities: [
      {
        type: "Ability",
        name: "Boisterous Wind",
        effect:
          "Once during your turn, you may use this Ability. Flip a coin. If heads, put an Energy attached to your opponent's Active Pokémon into their hand.",
      },
    ],
  } as Partial<Card>),
  [FILLER]: battler(FILLER, { name: "D646 Filler", hp: 400, types: ["Colorless"], retreat: 1 } as Partial<Card>),
};
const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL };
const DECK = deckOf({
  [BADGE]: 4,
  [TOWER]: 1,
  [CATCHER]: 1,
  [FANG]: 1,
  [FURY]: 1,
  [COMBO]: 1,
  [SLAM]: 1,
  [TAUROS]: 1,
  [ZERO]: 1,
  [OPP]: 1,
  [SPARK]: 1,
  [DUSTOX]: 1,
  [FILLER]: 19,
  "fix-energy": 26,
});

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

/** Setup (P2 first), then P1's turn 4 with both hands back in the decks, every Prize a Filler or an Energy. */
function p1Turn(): GameState {
  const created = createGame({ seed: 6461, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
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
    const plain = (u: string) => [FILLER, "fix-energy"].includes(state.cardIdByUid[u] as string);
    const prizes = side.prizes.map((u) => {
      if (plain(u)) return u;
      const swap = deck.find(plain);
      if (swap === undefined) throw new Error("no swap card");
      deck = [...deck.filter((d) => d !== swap), u];
      return swap;
    });
    state = { ...state, players: { ...state.players, [s]: { ...side, hand: [], prizes, deck } } };
  }
  return state;
}

/** The smallest `rngState` whose next draws are exactly `faces`. */
function rngForFaces(faces: readonly CoinFace[]): number {
  for (let candidate = 1; candidate < 400_000; candidate += 1) {
    let rng = candidate;
    let agrees = true;
    for (const wanted of faces) {
      const [drawn, next] = flipCoin(rng);
      rng = next;
      if (drawn !== wanted) {
        agrees = false;
        break;
      }
    }
    if (agrees) return candidate;
  }
  throw new Error(`no rngState draws ${faces.join(",")}`);
}
function rngAfter(start: number, n: number): number {
  let rng = start;
  for (let i = 0; i < n; i += 1) rng = flipCoin(rng)[1];
  return rng;
}
const H: CoinFace = "heads";
const X: CoinFace = "tails";

type Opts = {
  badge?: boolean;
  ownBench?: readonly string[];
  oppActive?: string;
  oppBench?: readonly string[];
  tower?: boolean;
};

/** P1 attacks with `active` (one Colorless Energy, a Backtrack Badge unless `badge: false`); P2 has `oppActive` and
    `oppBench`; the next coins are `faces`. */
function table(active: string, faces: readonly CoinFace[], opts: Opts = {}): GameState {
  let state = p1Turn();
  state = clearBench(setActiveFromDeck(state, "p1", active), "p1");
  state = clearBench(setActiveFromDeck(state, "p2", opts.oppActive ?? FILLER), "p2");
  for (const id of opts.ownBench ?? []) state = benchFromDeck(state, "p1", id);
  for (const id of opts.oppBench ?? []) state = benchFromDeck(state, "p2", id);
  const side = state.players.p1;
  const energy = side.deck.find((u) => state.cardIdByUid[u] === "fix-energy") as string;
  const badge = side.deck.find((u) => state.cardIdByUid[u] === BADGE) as string;
  const tools = opts.badge === false ? [] : [badge];
  state = {
    ...state,
    players: {
      ...state.players,
      p1: {
        ...side,
        deck: side.deck.filter((u) => u !== energy && !tools.includes(u)),
        active: side.active === null ? null : { ...side.active, energy: [energy], tools },
      },
    },
  };
  if (opts.tower === true) {
    const tower = state.players.p1.deck.find((u) => state.cardIdByUid[u] === TOWER) as string;
    state = {
      ...state,
      players: { ...state.players, p1: { ...state.players.p1, deck: state.players.p1.deck.filter((u) => u !== tower) } },
      stadium: { uid: tower, owner: "p1" },
    };
  }
  return { ...state, rngState: rngForFaces(faces) };
}

const badgeOf = (state: GameState) => state.players.p1.active?.tools[0] as string;
const attack = (state: GameState) => mustApply(state, { type: "attack", seat: "p1", index: 0 });
const of = <K extends GameEvent["type"]>(events: readonly GameEvent[], type: K) =>
  events.filter((e) => e.type === type) as Extract<GameEvent, { type: K }>[];
const flips = (events: readonly GameEvent[]) => of(events, "ATTACK_EFFECT_COIN_FLIP").map((e) => e.result);
const resolve = (state: GameState, choice: unknown) =>
  mustApply(state, { type: "resolveEffect", seat: "p1", choice } as GameAction);
const answer = (state: GameState, yes: boolean) => resolve(state, { kind: "confirm", yes });
function parkOf(state: GameState) {
  if (state.phase.kind !== "effect:choose") throw new Error(`expected a park, got ${state.phase.kind}`);
  return state.phase;
}
const P2_ACTIVE: PokemonRef = { seat: "p2", spot: { spot: "active" } };
const P2_BENCH = (index: number): PokemonRef => ({ seat: "p2", spot: { spot: "bench", index } });

describe("D646 §1 — the print and the registry row", () => {
  it("one `passive` key on a NEW Tool object; the Tool is simulated, so it attaches", () => {
    expect(programFor(BADGE)).toEqual({ passive: { reflipAttackCoins: { name: "Backtrack Badge", holderType: "Colorless" } } });
    expect(toolCardSimulated(POOL[BADGE] as Card)).toBe(true);
    let state = table(FANG, [H], { badge: false });
    const uid = state.players.p1.deck.find((u) => state.cardIdByUid[u] === BADGE) as string;
    state = { ...state, players: { ...state.players, p1: { ...state.players.p1, hand: [uid] } } };
    const attached = mustApply(state, { type: "attachTool", seat: "p1", uid, target: { spot: "active" } });
    expect(attached.state.players.p1.active?.tools).toEqual([uid]);
  });

  it("the attack texts are the shipped readers' (printed coin family, `coinFlipGate`, `damageChosen`)", () => {
    expect(deriveAttackCoinFlip(T.fang)?.kind).toBe("cancelOnTails");
    expect(deriveAttackCoinFlip(T.fury)?.kind).toBe("perHeads");
    expect(deriveAttackCoinFlip(T.combo)?.kind).toBe("bonusOnHeads");
    expect(deriveAttackCoinFlip(T.opponent)?.kind).toBe("opponentPerTails");
    expect(deriveAttackEffect(T.slam)?.[0]?.op).toBe("coinFlipGate");
    expect(deriveAttackEffect(T.together)?.[0]?.op).toBe("damageChosen");
    expect(deriveAttackEffect(T.zero)?.[0]?.op).toBe("damageChosen");
  });

  it("is built at engine 0.540.0", () => {
    expect(engineVersion).toBe("0.540.0");
  });
});

describe("D646 §2 — the printed coin flip (attack.ts): the offer parks before any coin is read", () => {
  it("Hyper Fang: the coin, then the confirm — nothing resolved yet, the epilogue queued", () => {
    const state = table(FANG, [X]);
    const parked = attack(state);
    expect(parked.events.map((e) => e.type)).toEqual(["ATTACK_DECLARED", "ATTACK_EFFECT_COIN_FLIP", "EFFECT_PENDING"]);
    const phase = parkOf(parked.state);
    expect(phase.prompt).toEqual({
      kind: "confirm",
      note: "Backtrack Badge: ignore this coin flip (tails) and flip that coin again?",
      labels: { yes: "Flip again", no: "Keep the results" },
    });
    expect(phase.cont.pendingOp).toEqual({ op: "reflipAttackCoins", toolUid: badgeOf(state), index: 0, faces: [X] });
    expect(phase.resumeTail).toBe(true);
    expect(parked.state.pending.map((p) => p.kind)).toEqual(["attackEpilogue"]);
    expect(parked.state.players.p2.active?.damage).toBe(0);
  });

  it("\"no\": the kept tails cancels the attack — no new coin, no second declaration, the rng unmoved", () => {
    const parked = attack(table(FANG, [X, H])).state;
    const done = answer(parked, false);
    expect(done.events.map((e) => e.type)).not.toContain("ATTACK_DECLARED");
    expect(flips(done.events)).toEqual([]);
    expect(of(done.events, "COINS_REFLIPPED")).toEqual([]);
    expect(of(done.events, "ATTACK_FAILED").map((e) => e.reason)).toEqual(["coinFlip"]);
    expect(done.state.rngState).toBe(parked.rngState);
    expect(done.state.players.p2.active?.damage).toBe(0);
    // One epilogue: the queued one is stripped before the re-entry, so the turn ends exactly once.
    expect(done.state.pending).toEqual([]);
    expect(of(done.events, "TURN_ENDED")).toHaveLength(1);
    expect(done.state.turn).toBe(parked.turn + 1);
  });

  it("\"yes\": COINS_REFLIPPED, one new coin, and the attack resolves on it (heads: 30)", () => {
    const state = table(FANG, [X, H]);
    const parked = attack(state).state;
    const done = answer(parked, true);
    expect(done.events[0]).toEqual({ type: "COINS_REFLIPPED", seat: "p1", uid: badgeOf(state), count: 1 });
    expect(flips(done.events)).toEqual([H]);
    expect(done.state.phase.kind).not.toBe("effect:choose");
    expect(done.state.players.p2.active?.damage).toBe(30);
    expect(done.state.rngState).toBe(rngAfter(state.rngState, 2));
  });

  it("Fury Swipes: all three coins are flipped again (R-BTB3) — kept 20, flipped again 60", () => {
    const keep = answer(attack(table(FURY, [H, X, X, H, H, H])).state, false);
    expect(keep.state.players.p2.active?.damage).toBe(20);
    const again = answer(attack(table(FURY, [H, X, X, H, H, H])).state, true);
    expect(flips(again.events)).toEqual([H, H, H]);
    expect(again.state.players.p2.active?.damage).toBe(60);
  });

  it("Rapid-Fire Combo: \"until tails\" is begun again — kept 50, flipped again (H, H, tails) 150", () => {
    const parked = attack(table(COMBO, [X, H, H, X])).state;
    expect(parkOf(parked).cont.pendingOp).toMatchObject({ faces: [X] });
    expect(answer(parked, false).state.players.p2.active?.damage).toBe(50);
    const again = answer(parked, true);
    expect(flips(again.events)).toEqual([H, H, X]);
    expect(again.state.players.p2.active?.damage).toBe(150);
  });

  it("the park survives a JSON round trip and answers the same", () => {
    const parked = attack(table(FURY, [X, X, X, H, X, H])).state;
    const revived = JSON.parse(JSON.stringify(parked)) as GameState;
    expect(answer(revived, true).state).toEqual(answer(parked, true).state);
    expect(answer(revived, false).state).toEqual(answer(parked, false).state);
  });
});

describe("D646 §3 — no offer", () => {
  const inline = (state: GameState) => {
    const result = attack(state);
    expect(result.state.phase.kind).not.toBe("effect:choose");
    expect(result.state.rngState).toBe(rngAfter(state.rngState, 1));
    return result;
  };

  it("without a Badge; on a non-{C} holder (R-BTB1); under Jamming Tower", () => {
    expect(inline(table(FANG, [H], { badge: false })).state.players.p2.active?.damage).toBe(30);
    expect(inline(table(SPARK, [H])).state.players.p2.active?.damage).toBe(30);
    expect(inline(table(FANG, [H], { tower: true })).state.players.p2.active?.damage).toBe(30);
  });

  it("once during your turn: a Badge whose key is already spent this turn offers nothing", () => {
    const state = table(FANG, [H]);
    const spent = {
      ...state,
      allowances: { ...state.allowances, abilitiesUsed: [coinRedoKey(badgeOf(state), "Backtrack Badge")] },
    };
    expect(coinRedoToolOf(state, state.players.p1.active as never)).toBe(badgeOf(state));
    expect(coinRedoToolOf(spent, spent.players.p1.active as never)).toBeNull();
    inline(spent);
  });

  it("spendCoinRedo writes the key and the row; a uid that is not a Badge spends nothing", () => {
    const state = table(FANG, [H]);
    const events: GameEvent[] = [];
    const spent = spendCoinRedo(state, "p1", badgeOf(state), 2, events);
    expect(spent.allowances.abilitiesUsed).toEqual([`${badgeOf(state)}:Backtrack Badge`]);
    expect(events).toEqual([{ type: "COINS_REFLIPPED", seat: "p1", uid: badgeOf(state), count: 2 }]);
    const energy = state.players.p1.active?.energy[0] as string;
    expect(spendCoinRedo(state, "p1", energy, 1, [])).toBe(state);
  });

  it("R-BTB2: the opponent's coins are not yours to flip again", () => {
    const state = table(OPP, [X], { oppBench: [FILLER] });
    const result = attack(state);
    expect(result.state.phase.kind).not.toBe("effect:choose");
    expect(of(result.events, "ATTACK_EFFECT_COIN_FLIP").map((e) => e.seat)).toEqual(["p2"]);
  });

  it("R-BTB2: the Confusion coin is not offered; the attack's own coin is, and a re-entry flips no second Confusion coin", () => {
    const base = table(FANG, [H, X]);
    const active = base.players.p1.active;
    if (active === null) throw new Error("no Active");
    const confused = {
      ...base,
      players: { ...base.players, p1: { ...base.players.p1, active: { ...active, conditions: { ...active.conditions, rotation: "confused" as const } } } },
    };
    const parked = attack(confused);
    expect(parked.events.map((e) => e.type)).toEqual(["ATTACK_DECLARED", "CONFUSION_CHECK", "ATTACK_EFFECT_COIN_FLIP", "EFFECT_PENDING"]);
    expect(parkOf(parked.state).cont.pendingOp).toMatchObject({ op: "reflipAttackCoins", faces: [X] });
    expect(of(answer(parked.state, false).events, "CONFUSION_CHECK")).toEqual([]);
  });

  it("R-BTB2: a Trainer's coin is not an attack's — Pokémon Catcher under the holder flips inline", () => {
    let state = table(FANG, [X], { oppBench: [FILLER] });
    const catcher = state.players.p1.deck.find((u) => state.cardIdByUid[u] === CATCHER) as string;
    state = { ...state, players: { ...state.players, p1: { ...state.players.p1, hand: [catcher] } } };
    const played = mustApply(state, { type: "playTrainer", seat: "p1", uid: catcher } as GameAction);
    expect(flips(played.events)).toEqual([X]);
    expect(played.state.phase.kind).toBe("turn:action");
  });

  it("R-BTB2: an Ability's coin is not an attack's — Boisterous Wind on a Badge-wearing {C} body flips inline", () => {
    const base = table(DUSTOX, [X]);
    const p2 = base.players.p2;
    const energy = p2.deck.find((u) => base.cardIdByUid[u] === "fix-energy") as string;
    const state = {
      ...base,
      players: {
        ...base.players,
        p2: { ...p2, deck: p2.deck.filter((u) => u !== energy), active: p2.active === null ? null : { ...p2.active, energy: [energy] } },
      },
    };
    const used = mustApply(state, { type: "useAbility", seat: "p1", target: { spot: "active" }, abilityName: "Boisterous Wind" } as GameAction);
    expect(flips(used.events)).toEqual([X]);
    expect(used.state.phase.kind).toBe("turn:action");
    expect(of(used.events, "COINS_REFLIPPED")).toEqual([]);
  });
});

describe("D646 §4 — an attack program's coin (`coinFlipGate`): the offer is the scheduled `reflipCoins` park", () => {
  it("Body Slam: 30 dealt, the coin, then the confirm; \"no\" keeps tails (not Paralyzed)", () => {
    const state = table(SLAM, [X, H]);
    const parked = attack(state);
    expect(parked.state.players.p2.active?.damage).toBe(30);
    expect(flips(parked.events)).toEqual([X]);
    const phase = parkOf(parked.state);
    expect(phase.cont.pendingOp).toMatchObject({ op: "reflipCoins", toolUid: badgeOf(state), faces: [X], retry: { op: "coinFlipGate" } });
    const kept = answer(parked.state, false);
    expect(flips(kept.events)).toEqual([]);
    expect(kept.state.phase.kind).not.toBe("effect:choose");
    expect(kept.state.players.p2.active?.conditions.rotation).toBe("none");
  });

  it("\"yes\": COINS_REFLIPPED, a new coin (heads), Paralyzed; no second offer", () => {
    const state = table(SLAM, [X, H]);
    const again = answer(attack(state).state, true);
    expect(of(again.events, "COINS_REFLIPPED")).toEqual([{ type: "COINS_REFLIPPED", seat: "p1", uid: badgeOf(state), count: 1 }]);
    expect(flips(again.events)).toEqual([H]);
    expect(again.state.phase.kind).not.toBe("effect:choose");
    expect(again.state.players.p2.active?.conditions.rotation).toBe("paralyzed");
  });

  it("the park survives a JSON round trip", () => {
    const parked = attack(table(SLAM, [X, H])).state;
    const revived = JSON.parse(JSON.stringify(parked)) as GameState;
    expect(answer(revived, true).state).toEqual(answer(parked, true).state);
  });
});

describe("D646 §5 — the per-coin hits (`damageChosen`)", () => {
  it("Target Together, forced pick: the coin, the offer; kept tails 0, flipped again heads 50", () => {
    const parked = attack(table(TAUROS, [X, H])).state;
    expect(parkOf(parked).cont.pendingOp).toMatchObject({ op: "reflipCoins", faces: [X], retry: { op: "damageChosen", hitRefs: [P2_ACTIVE] } });
    const kept = answer(parked, false);
    expect(flips(kept.events)).toEqual([]);
    expect(kept.state.phase.kind).not.toBe("effect:choose");
    expect(kept.state.players.p2.active?.damage).toBe(0);
    expect(answer(parked, true).state.players.p2.active?.damage).toBe(50);
  });

  it("Target Together, parked pick: the pick, then the coin and the offer; the re-flip hits the SAME body", () => {
    const picked = resolve(attack(table(TAUROS, [X, H], { oppBench: [FILLER] })).state, { kind: "pokemonMulti", refs: [P2_BENCH(0)] });
    expect(flips(picked.events)).toEqual([X]);
    const again = answer(picked.state, true);
    expect(again.state.players.p2.bench[0]?.damage).toBe(50);
    expect(again.state.players.p2.active?.damage).toBe(0);
  });

  it("Nullifying Zero on a {C} body: every coin flipped again, before any damage", () => {
    const parked = attack(table(ZERO, [X, X, H, H], { oppBench: [FILLER] })).state;
    expect(parkOf(parked).cont.pendingOp).toMatchObject({ faces: [X, X] });
    const kept = answer(parked, false);
    expect(flips(kept.events)).toEqual([]);
    expect(kept.state.phase.kind).not.toBe("effect:choose");
    expect([kept.state.players.p2.active?.damage, kept.state.players.p2.bench[0]?.damage]).toEqual([0, 0]);
    const again = answer(parked, true);
    expect(flips(again.events)).toEqual([H, H]);
    expect([again.state.players.p2.active?.damage, again.state.players.p2.bench[0]?.damage]).toEqual([150, 150]);
  });
});
