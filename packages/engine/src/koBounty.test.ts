import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import manifest from "../package.json" with { type: "json" };
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import * as effectsModule from "./effects";
import { deriveAttackEffect } from "./effects";
import type { EffectOp } from "./effects";
import type { GameEvent } from "./events";
import { collectKnockOuts } from "./flow";
import { applyAction, createGame, engineVersion } from "./index";
import type { GameState, InPlayPokemon, PokemonRef, Seat } from "./index";
import { runProgram } from "./interpreter";
import { type LogContext, formatElapsed, logFromEvents } from "./log";
import { type CoinFace, flipCoin } from "./rng";
import {
  FIXTURE_POOL,
  activeUid,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  firstBasicInHand,
  handFromDeck,
  handUid,
  must,
  mustApply,
  setActiveFromDeck,
} from "./testFixtures";
import type { KoBounty } from "./types";

// 0.433.0 → 0.434.0 — D549 (B), THE KNOCK OUT BOUNTY:
//
//   "During your next turn, if the Defending Pokémon is Knocked Out, take 2 more Prize
//    cards."
//
// `censusAttackCorpus.ts` FILE LINE 149 (leading count column 1): 1 sentence / 1 legal
// printing — census class SUBST-16 at SUBMAX=12 before this slice. Claimed WHOLE by
// `deriveAttackEffect` through ONE new anchor (`DEFENDER_KO_BOUNTY_NEXT_TURN`, one
// capture, zero `['’]` slots) and ONE new arm (19f'') emitting ONE new op,
// `bountyDefender { amount }`. The installer writes `InPlayPokemon.koBounty = { turn:
// T+2, amount }` on the OPPONENT's Active; flow.ts `koPrizeBonus` pays it AFTER the seat
// bonuses when the dying body was the Active, the record is live, and the batch is NOT
// the Checkup (the new REQUIRED `checkup` flag — R1).
//
// ⚠️ NO CATALOG, REGISTRY OR FIXTURE ID PRINTS THE SENTENCE ON THIS CHECKOUT, AND THAT
// WAS MEASURED (D425, `git grep`). Every board rides file-local DECLARED `d549-*`
// demonstrators in their OWN 60-card deck (D270); the real card is UNMEASURED.
//
// Sections: §1 the derivation · §2 the install · §3 the window, played · §4 the
// sweep's three questions (the unit rungs: window, Checkup, Active — plus ONE PLAYED
// mid-turn Knock Out through `resolveMidTurnKnockOuts`, the review's finding 2) · §5 R1 — a
// Checkup Poison Knock Out does NOT pay, played · §6 a Glimmora-DENIED Knock Out pays
// nothing · §7 the §10 clears · §8 §11 · §9 the merge · §10 the log · §11 the v33
// bytes and the v32 reject.

const S149 =
  "During your next turn, if the Defending Pokémon is Knocked Out, take 2 more Prize cards.";
const P149: readonly EffectOp[] = [{ op: "bountyDefender", amount: 2 }];
const BOUNTY = 2;

const MARK = 0; // {C}, 10 — the installer (:149)
const STRIKE = 1; // {C}, 400 — the Knock Out
const POISON = 2; // {C}, 80, Poisons — the Checkup Knock Out (100 HP: 10 + 80 + 10)

const GLIMMORA = "sv02-126"; // FIXTURE_POOL: 30 HP, "Shattering Crystal" (the prohibition)
/** 🆕 the D549 review's finding 2 — the REAL Dusknoir `sv06.5-020` "Cursed Blast", held
    in this LOCAL pool exactly as `cursedBlast.test.ts` holds it (the registry program
    is keyed on the id, and `sv06.5` is not a `catalogManifest` set, so a shared-pool
    body would have owed a `fix-*` key). It is here for ONE reason: an Ability that
    Knocks the marked Active Out DURING turn 5 through `resolveMidTurnKnockOuts` — the
    `false` call site the unit rungs in §4 never reach. */
const DUSKNOIR = "sv06.5-020";

const LOCAL_CARDS: Record<string, Card> = {
  "d549-marker": battler("d549-marker", {
    types: ["Colorless"],
    hp: 300,
    retreat: 1,
    attacks: [
      { cost: ["Colorless"], name: "Mark", damage: 10, effect: S149 },
      { cost: ["Colorless"], name: "Strike", damage: 400 },
      {
        cost: ["Colorless"],
        name: "Sting",
        damage: 80,
        effect: "Your opponent's Active Pokémon is now Poisoned.",
      },
    ],
  }),
  "d549-mark-victim": battler("d549-mark-victim", {
    types: ["Fighting"],
    hp: 100,
    retreat: 1,
    attacks: [{ cost: ["Colorless"], name: "Jab", damage: 10 }],
  }),
  "d549-mark-victim-evolved": battler("d549-mark-victim-evolved", {
    types: ["Fighting"],
    stage: "Stage1",
    evolveFrom: "d549-mark-victim",
    hp: 100,
    retreat: 1,
  }),
  "d549-mark-bench": battler("d549-mark-bench", { types: ["Fighting"], hp: 300, retreat: 1 }),
  [DUSKNOIR]: battler(DUSKNOIR, {
    name: "Dusknoir",
    stage: "Stage2",
    evolveFrom: "Dusclops",
    hp: 160,
    retreat: 3,
    types: ["Psychic"],
    abilities: [
      {
        type: "Ability",
        name: "Cursed Blast",
        effect:
          "Once during your turn, you may put 13 damage counters on 1 of your opponent's Pokémon. If you placed any damage counters in this way, this Pokémon is Knocked Out.",
      },
    ],
    attacks: [
      {
        cost: ["Psychic", "Psychic", "Colorless"],
        name: "Shadow Bind",
        effect: "During your opponent's next turn, the Defending Pokémon can't retreat.",
        damage: 150,
      },
    ],
  }),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

/** Its OWN deck (D270), 60 by construction. */
const DECK = deckOf({
  "d549-marker": 4,
  "d549-mark-victim": 4,
  "d549-mark-victim-evolved": 2,
  "d549-mark-bench": 6,
  [GLIMMORA]: 2,
  "sv01-194": 4, // Switch — the victim's own switch clear
  "fix-mist-energy": 2, // the §11 shield
  [DUSKNOIR]: 2, // the mid-turn Knock Out (§4's played rung)
  "fix-energy": 34,
});

const NAMES: Record<Seat, string> = { p1: "Ember", p2: "Tide" };
const SEED = 20260950;

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

function all<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

function body(pokemon: InPlayPokemon | null | undefined): InPlayPokemon {
  if (pokemon === null || pokemon === undefined) throw new Error("expected a Pokémon");
  return pokemon;
}

function localSetup(seed: number): GameState {
  const created = createGame({ seed, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(
    applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first: "p1" }),
  );
  while (state.phase.kind === "setup:drawExtra") {
    const phase = state.phase;
    const seat = (["p1", "p2"] as const).find((s) => !phase.decided[s]);
    if (seat === undefined) throw new Error("setup:drawExtra with every seat decided");
    state = must(applyAction(state, { type: "setupDrawExtra", seat, count: phase.owed[seat] }));
  }
  for (const seat of ["p1", "p2"] as const) {
    state = must(
      applyAction(state, { type: "setupPlaceActive", seat, uid: firstBasicInHand(state, seat) }),
    );
  }
  for (const seat of ["p1", "p2"] as const) {
    state = must(applyAction(state, { type: "setupReady", seat }));
  }
  return state;
}

/** P1's turn 3: P1 fields the marker with one Energy; P2 fields `victim` with one
    Energy and one benched body (so a Knock Out promotes rather than ends the game). */
function ready(opts: { victim?: string } = {}): GameState {
  const { victim = "d549-mark-victim" } = opts;
  let state = localSetup(SEED);
  state = mustApply(state, { type: "endTurn", seat: "p1" }).state;
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", "d549-marker");
  state = clearBench(state, "p1");
  state = attachFromDeck(state, "p1", "fix-energy", 1);
  state = benchFromDeck(state, "p1", "d549-mark-bench");
  state = setActiveFromDeck(state, "p2", victim);
  state = clearBench(state, "p2");
  state = attachFromDeck(state, "p2", "fix-energy", 1);
  state = benchFromDeck(state, "p2", "d549-mark-bench");
  return state;
}

const attack = (state: GameState, index: number, seat: Seat = "p1") =>
  mustApply(state, { type: "attack", seat, index });

const pass = (state: GameState, seat: Seat): GameState =>
  must(applyAction(state, { type: "endTurn", seat }));

/** `ready`, then Mark DECLARED on turn 3 — returns P2's turn 4 (the victim's turn). */
function installed(opts: Parameters<typeof ready>[0] = {}) {
  const start = ready(opts);
  const { state, events } = attack(start, MARK);
  if (find(events, "KO_BOUNTY_APPLIED") === undefined) throw new Error("Mark installed nothing");
  return { start, state, events };
}

/** The installer's own next turn — THE window (turn 5). */
const inWindow = (state: GameState): GameState => pass(state, "p2");

function runAs(state: GameState, seat: Seat, program: readonly EffectOp[], events: GameEvent[]) {
  const result = runProgram(state, program, { seat, invokedBy: "attack" }, events);
  if (result.kind !== "done") throw new Error(`expected done, got ${result.kind}`);
  return result.state;
}

function render(events: GameEvent[], state: GameState): { who: string; text: string }[] {
  const ctx: LogContext = { names: NAMES, state, elapsed: formatElapsed(0) };
  return logFromEvents(events, ctx).flatMap((entry) =>
    entry.kind === "turn"
      ? []
      : [{ who: entry.who, text: entry.segments.map((s) => s.text).join("") }],
  );
}

/** The Prize count P1 is OWED by the Knock Out: the parked pick, or what left the row. */
function owed(before: GameState, after: GameState, events: GameEvent[]): number {
  if (after.phase.kind === "ko:takePrizes") return after.phase.count;
  const row = all(events, "PRIZES_OWED")[0];
  if (row !== undefined) return row.count;
  return before.players.p1.prizes.length - after.players.p1.prizes.length;
}

/** The first rng cursor whose next flips come up `faces`, in order. */
function withFaces(state: GameState, faces: readonly CoinFace[]): GameState {
  for (let cursor = 1; cursor < 10_000; cursor++) {
    let rng = cursor;
    let ok = true;
    for (const want of faces) {
      const [face, next] = flipCoin(rng);
      if (face !== want) {
        ok = false;
        break;
      }
      rng = next;
    }
    if (ok) return { ...state, rngState: cursor };
  }
  throw new Error(`no cursor yields ${faces.join(",")}`);
}

/** Surgery: P2's Active lethally damaged (and P2's bench[0], when asked). */
function lethal(state: GameState, opts: { bench?: KoBounty | null } = {}): GameState {
  const side = state.players.p2;
  const active = body(side.active);
  const bench =
    opts.bench === undefined
      ? side.bench
      : side.bench.map((p, i) =>
          i === 0 ? { ...p, damage: 999, koBounty: opts.bench ?? null } : p,
        );
  return {
    ...state,
    players: { ...state.players, p2: { ...side, active: { ...active, damage: 999 }, bench } },
  };
}

/** The takePrizes stage counts one sweep queues for P1. */
function sweptCounts(
  state: GameState,
  checkup: boolean,
): { counts: number[]; events: GameEvent[] } {
  const events: GameEvent[] = [];
  const batch = collectKnockOuts(state, ["p2"], events, checkup);
  if (batch.done !== null) throw new Error("the sweep ended the game");
  const counts = batch.stages.flatMap((s) => (s.kind === "takePrizes" ? [s.count] : []));
  return { counts, events };
}

// ─────────────────────────────────────────────────────────────────────────────
// §1 — the derivation.
// ─────────────────────────────────────────────────────────────────────────────

describe("§1 — the anchor claims the row WHOLE, and only it", () => {
  it("derives ONE op, `bountyDefender { amount: 2 }`", () => {
    expect(deriveAttackEffect(S149)).toEqual(P149);
  });

  it("the corpus row derives off the committed bytes, and it is the ONLY such row", () => {
    const hits = legalAttackCorpus().filter(([, text]) =>
      (deriveAttackEffect(text) ?? []).some((op) => op.op === "bountyDefender"),
    );
    expect(hits).toEqual([[1, S149]]);
  });

  it("claimed by EXACTLY ONE of the 13 readers (`deriveAttackEffect`)", () => {
    expect(resolvedByAnyReader(S149)).toBe(true);
    const claimants = attackReaderSurface().filter((name) => {
      const read = (effectsModule as unknown as Record<string, (t: string) => unknown>)[name];
      return (read?.(S149) ?? null) !== null;
    });
    expect(claimants).toEqual(["deriveAttackEffect"]);
    expect(attackReaderSurface()).toHaveLength(13);
  });

  it("the sentence prints NO apostrophe, so the anchor owns no `['’]` slot", () => {
    expect(/['’]/.test(S149)).toBe(false);
  });

  it("a printed 0 stays LOUD (the `>= 1` floor), and other amounts read", () => {
    expect(deriveAttackEffect(S149.replace("take 2", "take 0"))).toBeNull();
    expect(deriveAttackEffect(S149.replace("take 2", "take 3"))).toEqual([
      { op: "bountyDefender", amount: 3 },
    ]);
  });

  it("refuses every single-axis near-miss", () => {
    const misses = [
      S149.replace("your next turn", "your opponent's next turn"),
      S149.replace("the Defending Pokémon", "this Pokémon"),
      S149.replace("take 2 more", "take 2 fewer"),
      S149.replace("is Knocked Out", "is damaged"),
      // …and the anchor is `^…$`: a sentence in front of it or behind it is not this row.
      `Draw a card. ${S149}`,
      `${S149} Draw a card.`,
    ];
    for (const text of misses) {
      expect(
        (deriveAttackEffect(text) ?? []).some((op) => op.op === "bountyDefender"),
        text,
      ).toBe(false);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — the install.
// ─────────────────────────────────────────────────────────────────────────────

describe("§2 — the install writes `{ turn: T+2, amount }` on the DEFENDER", () => {
  it("stamps the INSTALLER's next turn onto P2's Active, with a row filed under P2", () => {
    const { start, state, events } = installed();
    expect(start.turn).toBe(3);
    expect(body(state.players.p2.active).koBounty).toStrictEqual({ turn: 5, amount: BOUNTY });
    expect(body(state.players.p1.active).koBounty).toBeNull();
    expect(find(events, "KO_BOUNTY_APPLIED")).toEqual({
      type: "KO_BOUNTY_APPLIED",
      seat: "p2",
      uid: activeUid(start, "p2"),
      amount: BOUNTY,
    });
  });

  it("never parks and consumes no rng", () => {
    const start = ready();
    const after = runAs(start, "p1", P149, []);
    expect(after.rngState).toBe(start.rngState);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — the window, PLAYED.
// ─────────────────────────────────────────────────────────────────────────────

describe("§3 — a Knock Out on T+2 pays 1 + 2; on T+4 it pays the face value", () => {
  it("🛑 Strike on turn 5 Knocks the marked Active Out: 3 Prize cards, and a PRIZE_BONUS row", () => {
    const window = inWindow(installed().state);
    expect(window.turn).toBe(5);
    const uid = activeUid(window, "p2");
    const { state, events } = attack(window, STRIKE);
    expect(owed(window, state, events)).toBe(1 + BOUNTY);
    expect(all(events, "PRIZE_BONUS")).toEqual([
      { type: "PRIZE_BONUS", seat: "p2", uid, by: BOUNTY, count: 1 + BOUNTY },
    ]);
    // No Ability announced it: the source was named at install (KO_BOUNTY_APPLIED).
    expect(find(events, "ABILITY_TRIGGERED")).toBeUndefined();
  });

  it("the same Knock Out on turn 7 (the record is stale) pays the face value", () => {
    const later = pass(pass(inWindow(installed().state), "p1"), "p2");
    expect(later.turn).toBe(7);
    expect(body(later.players.p2.active).koBounty).toStrictEqual({ turn: 5, amount: BOUNTY });
    const { state, events } = attack(later, STRIKE);
    expect(owed(later, state, events)).toBe(1);
    expect(find(events, "PRIZE_BONUS")).toBeUndefined();
  });

  it("the unmarked control pays the face value on turn 5", () => {
    const control = pass(pass(ready(), "p1"), "p2");
    const { state, events } = attack(control, STRIKE);
    expect(owed(control, state, events)).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — the sweep's three questions, asked of `collectKnockOuts` directly.
// ─────────────────────────────────────────────────────────────────────────────

describe("§4 — the sweep pays only a LIVE record, on the ACTIVE, outside the Checkup", () => {
  it("dead on T+1 (turn 4), live on T+2 (turn 5) — for ANY cause, not only an attack (R1)", () => {
    const victim = installed().state;
    expect(sweptCounts(lethal(victim), false).counts).toEqual([1]);
    const window = inWindow(victim);
    // No `attackerSeat`: this is exactly the mid-turn sweep's call.
    expect(sweptCounts(lethal(window), false).counts).toEqual([1 + BOUNTY]);
  });

  it("🛑 PLAYED mid-turn: Cursed Blast on turn 5 Knocks the marked Active Out — the bounty PAYS", () => {
    // The D549 review's finding 2: the rung above calls `collectKnockOuts(…, false)` by
    // hand, so it never exercises `resolveMidTurnKnockOuts`' OWN argument. This one
    // does: an Ability (not an attack, not the Checkup) Knocks the marked Active Out on
    // turn 5, and the sweep that pays is the mid-turn one. `D549-midturn-flag-forced-true`
    // flips that call site's `false` to `true` and is killed HERE.
    const window = benchFromDeck(inWindow(installed().state), "p1", DUSKNOIR);
    expect(window.turn).toBe(5);
    const uid = activeUid(window, "p2");
    const index = window.players.p1.bench.length - 1;
    const parked = mustApply(window, {
      type: "useAbility",
      seat: "p1",
      target: { spot: "bench", index },
      abilityName: "Cursed Blast",
    }).state;
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");
    const target = prompt.candidates[0] as PokemonRef;
    expect(target).toMatchObject({ seat: "p2", spot: { spot: "active" } });
    const { state, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [target] },
    });
    // Both bodies went in ONE mid-turn batch: the marked Active and the blaster.
    expect(all(events, "KNOCKED_OUT").map((e) => e.uid)).toContain(uid);
    expect(find(events, "ATTACK_DECLARED")).toBeUndefined();
    expect(all(events, "PRIZE_BONUS")).toEqual([
      { type: "PRIZE_BONUS", seat: "p2", uid, by: BOUNTY, count: 1 + BOUNTY },
    ]);
    const owedToP1 = [
      ...(state.phase.kind === "ko:takePrizes" && state.phase.seat === "p1"
        ? [state.phase.count]
        : []),
      ...state.pending.flatMap((s) =>
        s.kind === "takePrizes" && s.seat === "p1" ? [s.count] : [],
      ),
    ];
    expect(owedToP1).toEqual([1 + BOUNTY]);
    // …and the turn is still P1's own turn 5: a mid-turn Knock Out, not a Checkup one.
    expect(state.turn).toBe(5);
  });

  it("🛑 the Checkup flag: the same lethal board in the Checkup's sweep pays the face value", () => {
    const window = inWindow(installed().state);
    expect(sweptCounts(lethal(window), true).counts).toEqual([1]);
  });

  it("🛑 the ACTIVE: a benched body carrying a live record (constructed) pays the face value", () => {
    // Unreachable off a played line — every route off the Active Spot sheds the record
    // (§7) — so the board is built. The Active is lethal too and pays its own bounty.
    const window = inWindow(installed().state);
    const board = lethal(window, { bench: { turn: 5, amount: BOUNTY } });
    expect(sweptCounts(board, false).counts.sort()).toEqual([1, 1 + BOUNTY]);
    const benchOnly = {
      ...board,
      players: {
        ...board.players,
        p2: { ...board.players.p2, active: { ...body(board.players.p2.active), damage: 0 } },
      },
    };
    expect(sweptCounts(benchOnly, false).counts).toEqual([1]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — R1, PLAYED: the Checkup Knock Out after "your next turn" pays nothing extra.
// ─────────────────────────────────────────────────────────────────────────────

describe("§5 — a Poison Knock Out in the Checkup that ends turn 5 pays the face value", () => {
  it("🛑 Sting leaves the marked body on 10 HP, Poisoned; the Checkup Knocks it Out for 1", () => {
    const window = inWindow(installed().state);
    const uid = activeUid(window, "p2");
    const { state, events } = attack(window, POISON);
    // The attack did NOT Knock it Out: 10 (Mark) + 80 (Sting) = 90 of 100.
    const ko = find(events, "KNOCKED_OUT");
    expect(ko?.uid).toBe(uid);
    // …the Checkup did, with `state.turn` still 5 — the one board the flag decides.
    expect(owed(window, state, events)).toBe(1);
    expect(find(events, "PRIZE_BONUS")).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — a prohibition beats the bounty.
// ─────────────────────────────────────────────────────────────────────────────

describe("§6 — a Glimmora-DENIED Knock Out pays no bounty", () => {
  it("heads: no Prize at all, and no PRIZE_BONUS", () => {
    const window = withFaces(inWindow(installed({ victim: GLIMMORA }).state), ["heads"]);
    expect(body(window.players.p2.active).koBounty).toStrictEqual({ turn: 5, amount: BOUNTY });
    const { state, events } = attack(window, STRIKE);
    expect(find(events, "PRIZE_PREVENTED")).toBeDefined();
    expect(find(events, "PRIZE_BONUS")).toBeUndefined();
    expect(state.phase.kind).not.toBe("ko:takePrizes");
    expect(state.players.p1.prizes).toHaveLength(window.players.p1.prizes.length);
  });

  it("tails (the control): the guard does not deny, and the bounty pays", () => {
    const window = withFaces(inWindow(installed({ victim: GLIMMORA }).state), ["tails"]);
    const { state, events } = attack(window, STRIKE);
    expect(owed(window, state, events)).toBe(1 + BOUNTY);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7 — the §10 clears (R2).
// ─────────────────────────────────────────────────────────────────────────────

describe("§7 — retreat, a Switch, evolution, a forced switch and devolution each clear it", () => {
  function benchedCarrier(state: GameState, uid: string): InPlayPokemon {
    expect(state.players.p2.active?.stack.includes(uid)).toBe(false);
    const benched = state.players.p2.bench.find((p) => p.stack.includes(uid));
    expect(benched).toBeDefined();
    return body(benched);
  }

  it("RETREAT on turn 4 (played): the benched body carries nothing", () => {
    const victim = installed().state;
    const uid = activeUid(victim, "p2");
    const { state } = mustApply(victim, {
      type: "retreat",
      seat: "p2",
      discardEnergy: body(victim.players.p2.active).energy.slice(0, 1),
      promoteBenchIndex: 0,
    });
    expect(benchedCarrier(state, uid).koBounty).toBeNull();
  });

  it("SWITCH on turn 4 (the victim's Item): the switched-out body carries nothing", () => {
    const at = installed().state;
    const victim = at.players.p2.hand.some((u) => at.cardIdByUid[u] === "sv01-194")
      ? at
      : handFromDeck(at, "p2", "sv01-194", 1);
    const uid = activeUid(victim, "p2");
    let state = mustApply(victim, {
      type: "playTrainer",
      seat: "p2",
      uid: handUid(victim, "p2", "sv01-194"),
    }).state;
    if (state.phase.kind === "effect:choose") {
      state = must(
        applyAction(state, {
          type: "resolveEffect",
          seat: "p2",
          choice: { kind: "pokemon", ref: { seat: "p2", spot: { spot: "bench", index: 0 } } },
        }),
      );
    }
    expect(benchedCarrier(state, uid).koBounty).toBeNull();
  });

  it("EVOLVE on turn 4: the evolved card Knocked Out on turn 5 pays the face value", () => {
    const victim = handFromDeck(installed().state, "p2", "d549-mark-victim-evolved", 1);
    const { state } = mustApply(victim, {
      type: "evolve",
      seat: "p2",
      uid: handUid(victim, "p2", "d549-mark-victim-evolved"),
      target: { spot: "active" },
    });
    expect(body(state.players.p2.active).koBounty).toBeNull();
    const window = inWindow(state);
    const struck = attack(window, STRIKE);
    expect(owed(window, struck.state, struck.events)).toBe(1);
  });

  it("FORCED switch (`switchInto` through a gust — the installer's own line, constructed)", () => {
    const window = inWindow(installed().state);
    const uid = activeUid(window, "p2");
    const state = runAs(window, "p1", [{ op: "gust" }], []);
    expect(benchedCarrier(state, uid).koBounty).toBeNull();
  });

  it("DEVOLVE (`devolvedBodyOf`) sheds it too", () => {
    let state = pass(ready(), "p1");
    state = handFromDeck(state, "p2", "d549-mark-victim-evolved", 1);
    state = mustApply(state, {
      type: "evolve",
      seat: "p2",
      uid: handUid(state, "p2", "d549-mark-victim-evolved"),
      target: { spot: "active" },
    }).state;
    state = pass(state, "p2");
    state = runAs(state, "p1", P149, []);
    expect(body(state.players.p2.active).koBounty?.amount).toBe(BOUNTY);
    state = runAs(state, "p1", [{ op: "devolveEach" }], []);
    const devolved = body(state.players.p2.active);
    expect(state.cardIdByUid[devolved.stack.at(-1) ?? ""]).toBe("d549-mark-victim");
    expect(devolved.koBounty).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §8 — §11.
// ─────────────────────────────────────────────────────────────────────────────

describe("§8 — a §11 shield refuses the install", () => {
  it("Mist Energy on the Defending Pokémon: refused, announced, nothing written", () => {
    const start = attachFromDeck(ready(), "p2", "fix-mist-energy", 1);
    const { state, events } = attack(start, MARK);
    expect(find(events, "ATTACK_EFFECT_PREVENTED")?.seat).toBe("p2");
    expect(find(events, "KO_BOUNTY_APPLIED")).toBeUndefined();
    expect(body(state.players.p2.active).koBounty).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §9 — the merge (constructed — two installs on one window need two attacks).
// ─────────────────────────────────────────────────────────────────────────────

describe("§9 — `Math.max` on one window; a smaller or equal re-install is silent", () => {
  it("2 then 1 keeps 2 with no second row; then 3 raises it with a row", () => {
    const once = runAs(ready(), "p1", P149, []);
    const smaller: GameEvent[] = [];
    const twice = runAs(once, "p1", [{ op: "bountyDefender", amount: 1 }], smaller);
    expect(smaller).toEqual([]);
    expect(body(twice.players.p2.active).koBounty).toStrictEqual({ turn: 5, amount: 2 });
    const same: GameEvent[] = [];
    runAs(twice, "p1", P149, same);
    expect(same).toEqual([]);
    const larger: GameEvent[] = [];
    const thrice = runAs(twice, "p1", [{ op: "bountyDefender", amount: 3 }], larger);
    expect(all(larger, "KO_BOUNTY_APPLIED").map((e) => e.amount)).toEqual([3]);
    expect(body(thrice.players.p2.active).koBounty).toStrictEqual({ turn: 5, amount: 3 });
  });

  it("a record from an EARLIER window is replaced, not merged", () => {
    const start = ready();
    const stale = {
      ...start,
      players: {
        ...start.players,
        p2: {
          ...start.players.p2,
          active: { ...body(start.players.p2.active), koBounty: { turn: 1, amount: 9 } },
        },
      },
    };
    const events: GameEvent[] = [];
    const after = runAs(stale, "p1", P149, events);
    expect(body(after.players.p2.active).koBounty).toStrictEqual({ turn: 5, amount: 2 });
    expect(all(events, "KO_BOUNTY_APPLIED")).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §10 — the log.
// ─────────────────────────────────────────────────────────────────────────────

describe("§10 — the rows say what this path keeps true (D421)", () => {
  it("the install row is VICTIM-voiced and names the INSTALLER's turn", () => {
    const { state, events } = installed();
    expect(render(events, state)).toContainEqual({
      who: "p2",
      text: "d549-mark-victim — if it is Knocked Out during your opponent's next turn, your opponent takes 2 more Prize cards",
    });
  });

  it("the paying Knock Out prints the bonus as a SYSTEM row with both numbers", () => {
    const window = inWindow(installed().state);
    const { state, events } = attack(window, STRIKE);
    expect(render(events, state)).toContainEqual({
      who: "system",
      text: "d549-mark-victim — your opponent takes 2 more Prize cards for it (3 instead of 1)",
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §11 — `MATCH_RECORD_VERSION` 32 → 33.
// ─────────────────────────────────────────────────────────────────────────────

describe("§11 — the v33 bytes round-trip, and a v32-shaped body THROWS at its Knock Out (D549)", () => {
  it("🛑 v33: the record is in the serialized state, and a JSON round-trip still pays", () => {
    const window = inWindow(installed().state);
    const bytes = JSON.stringify(window);
    expect(bytes.includes('"koBounty":{"turn":5,"amount":2}')).toBe(true);
    const revived = JSON.parse(bytes) as GameState;
    const { state, events } = attack(revived, STRIKE);
    expect(owed(revived, state, events)).toBe(1 + BOUNTY);
  });

  it("🛑 v32-SHAPED body (the key genuinely ABSENT): the Knock Out THROWS", () => {
    const revived = JSON.parse(JSON.stringify(inWindow(installed().state))) as GameState;
    const target = body(revived.players.p2.active) as Partial<InPlayPokemon>;
    // biome-ignore lint/performance/noDelete: the key must be genuinely ABSENT, which is what a v32 record looks like (D124).
    delete target.koBounty;
    expect("koBounty" in target).toBe(false);
    // `undefined !== null` is TRUE, so the sweep dereferences `.turn` of undefined —
    // D326's throw on the first read of a missing required key, on the Knock Out of
    // ANY Active outside a Checkup. Retiring the record is the only safe answer.
    expect(() => applyAction(revived, { type: "attack", seat: "p1", index: STRIKE })).toThrow(
      TypeError,
    );
  });

  it("the engine version stepped to 0.448.0 in BOTH places", () => {
    expect(engineVersion).toBe("0.448.0");
    expect(manifest.version).toBe("0.448.0");
  });
});
