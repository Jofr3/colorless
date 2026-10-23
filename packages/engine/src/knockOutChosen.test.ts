import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import type { EffectOp } from "./effects";
import { deriveAttackEffect } from "./effects";
import { applyAction, createGame } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import { conditionHolds, knockOutChosenTargets, runProgram } from "./interpreter";
import {
  FIXTURE_POOL,
  activeUid,
  attachBenchFromDeck,
  attachFromDeck,
  attachToolFromDeck,
  battler,
  benchFromDeck,
  benchTopUid,
  clearBench,
  deckOf,
  deepFreeze,
  firstBasicInHand,
  must,
  mustApply,
  setActiveFromDeck,
  setBenchDamage,
  setDamage,
  types,
} from "./testFixtures";
import { koByEffectMarker } from "./types";

const FLIP_KO_TEXT =
  "Flip a coin. If heads, Knock Out your opponent's Active Basic Pokémon. If tails, Knock Out 1 of your opponent's Benched Basic Pokémon.";
const SIX_COUNTERS_TEXT =
  "Knock Out 1 of your opponent's Pokémon that has exactly 6 damage counters on it.";

const LOCAL_CARDS: Record<string, Card> = {
  "fix-koc-flip": battler("fix-koc-flip", {
    hp: 200,
    attacks: [
      { cost: ["Colorless"], name: "Coin Cull", effect: FLIP_KO_TEXT },
      { cost: ["Colorless"], name: "Plain Bite", damage: 200 },
    ],
  }),
  /** The counter-window demonstrator, built as the SAME control pair and for the
      same reason. Separate from `fix-koc-flip` so a §4 board can never be read as
      a §3 one, and so no board has both sentences reachable at once. */
  "fix-koc-six": battler("fix-koc-six", {
    hp: 200,
    attacks: [
      { cost: ["Colorless"], name: "Counter Cull", effect: SIX_COUNTERS_TEXT },
      { cost: ["Colorless"], name: "Plain Bite", damage: 200 },
    ],
  }),
  /** The victim: a BASIC at 120 HP, no attacks. 120 > 70, so a body parked at the
      SEVEN-counter near-miss is still comfortably alive and its survival is the
      window's doing rather than arithmetic's; 120 < 200 so Plain Bite kills it. */
  "fix-koc-basic": battler("fix-koc-basic", { hp: 120 }),
  /** A SECOND, DISTINGUISHABLE Basic victim — the two-candidate park needs two
      bodies a reader can tell apart in an assertion, and a park is the one ending
      that cannot be reached with one. */
  "fix-koc-basic2": battler("fix-koc-basic2", { hp: 120 }),
  "fix-koc-stage1": battler("fix-koc-stage1", {
    hp: 120,
    stage: "Stage1",
    evolveFrom: "fix-koc-basic",
  }),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const KO_CHOSEN_DECK = deckOf({
  "fix-koc-flip": 4,
  "fix-koc-six": 4,
  "fix-koc-basic": 6,
  "fix-koc-basic2": 4,
  "fix-koc-stage1": 6,
  "fix-mist-energy": 4,
  "sv03-197": 4,
  "fix-titan": 4,
  "fix-bigbody": 10,
  "fix-energy": 14,
});

const COIN_CULL = 0;
const COUNTER_CULL = 0;
const PLAIN_BITE = 1;

const BENCH_BASIC_OP = {
  op: "knockOutChosen",
  target: "opponentBench",
  basicOnly: true,
} as const satisfies Extract<EffectOp, { op: "knockOutChosen" }>;
const ANY_SIX_OP = {
  op: "knockOutChosen",
  target: "opponentAny",
  damageCountersExactly: 6,
} as const satisfies Extract<EffectOp, { op: "knockOutChosen" }>;

const BY_ATTACK = { kind: "yourPokemonKoedOnOpponentsLastTurn", byAttack: true } as const;

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

function localSetup(seed: number, first: Seat): GameState {
  const created = createGame({
    seed,
    decks: { p1: KO_CHOSEN_DECK, p2: KO_CHOSEN_DECK },
    cardPool: POOL,
  });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(
    applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first }),
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

function armed(
  seed: number,
  attacker: string,
  victim: string,
  bench: readonly string[],
): GameState {
  let state = must(applyAction(localSetup(seed, "p2"), { type: "endTurn", seat: "p2" }));
  state = setActiveFromDeck(state, "p1", attacker);
  state = clearBench(state, "p1");
  // P1 keeps ONE benched body: an emptied Active Spot on the attacker's side would
  // end the game rather than the turn, and no case here is about §14.
  state = benchFromDeck(state, "p1", "fix-titan");
  state = attachFromDeck(state, "p1", "fix-energy", 1);
  state = setActiveFromDeck(state, "p2", victim);
  state = clearBench(state, "p2");
  for (const id of bench) state = benchFromDeck(state, "p2", id);
  return state;
}

/** Walk the §8.1 stages a Knock Out queues — Prize, then promotion — and hand back
    the board on the seat-after turn. `knockOutDefender.test.ts`'s `settle`
    verbatim, so the two suites' post-KO boards are comparable. */
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
      const seat = next.phase.seat;
      next = must(applyAction(next, { type: "promote", seat, benchIndex: 0 }));
      continue;
    }
    return next;
  }
  throw new Error("KO stages never settled");
}

/** The parked prompt, or a throw — every §3/§4/§5 park case reads its candidates
    through this, so "it parked" and "it parked on THIS set" are one assertion. */
function parkedOn(state: GameState): { candidates: readonly unknown[]; note: string } {
  if (state.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
  if (state.phase.prompt.kind !== "choosePokemon") throw new Error("expected choosePokemon");
  return { candidates: state.phase.prompt.candidates, note: state.phase.prompt.note };
}

// ─────────────────────────────────────────────────────────────────────────────
// §1 — THE DERIVER. Two programs, asserted as exact equality.
// ─────────────────────────────────────────────────────────────────────────────

describe("§1 the deriver — two sentences, six printings, one parking op", () => {
  it("derives the coin sentence to ONE gate with BOTH arms filled", () => {
    expect(deriveAttackEffect(FLIP_KO_TEXT)).toEqual([
      {
        op: "coinFlipGate",
        // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
        then: [
          {
            op: "conditionGate",
            cond: { kind: "opponentActiveIsBasic" },
            // biome-ignore lint/suspicious/noThenProperty: `then` is the effect contract's gated-step list, not a thenable (arrays are not callable).
            then: [{ op: "knockOutDefender" }],
          },
        ],
        otherwise: [{ op: "knockOutChosen", target: "opponentBench", basicOnly: true }],
      },
    ]);
  });

  it("derives the counter sentence to ONE op scoped to the WHOLE opponent board", () => {
    expect(deriveAttackEffect(SIX_COUNTERS_TEXT)).toEqual([
      { op: "knockOutChosen", target: "opponentAny", damageCountersExactly: 6 },
    ]);
  });

  it("reads the printed counter COUNT rather than a constant, and refuses a printed 0", () => {
    // The pool prints only 6 today, so a hard-coded 6 passes every board in this
    // file and this is the one place it cannot hide.
    expect(deriveAttackEffect(SIX_COUNTERS_TEXT.replace("exactly 6", "exactly 3"))).toEqual([
      { op: "knockOutChosen", target: "opponentAny", damageCountersExactly: 3 },
    ]);
    // …and the `>= 1` guard: a printed 0 is a window that admits every UNDAMAGED
    // body on the opponent's board, which is the loudest way for a Knock Out to be
    // wrong. The loud ATTACK_EFFECT_SKIPPED path is the correct behaviour.
    expect(deriveAttackEffect(SIX_COUNTERS_TEXT.replace("exactly 6", "exactly 0"))).toBeNull();
  });

  it("is anchored end to end — both sentences, both ends", () => {
    for (const text of [FLIP_KO_TEXT, SIX_COUNTERS_TEXT]) {
      expect(deriveAttackEffect(`Flip a coin. If heads, ${text}`)).toBeNull();
      expect(deriveAttackEffect(text.replace(/\.$/, ""))).toBeNull();
      expect(deriveAttackEffect(text.toLowerCase())).toBeNull();
      expect(deriveAttackEffect(`${text} Draw a card.`)).toBeNull();
    }
  });

  it("D136/D137 — both apostrophe spellings derive the SAME program", () => {
    for (const text of [FLIP_KO_TEXT, SIX_COUNTERS_TEXT]) {
      const curly = text.replace(/'/g, "’");
      expect(curly).not.toBe(text);
      expect(deriveAttackEffect(curly)).toEqual(deriveAttackEffect(text));
      expect(deriveAttackEffect(curly)).not.toBeNull();
    }
    // …and ONE possessive folded while the other stays straight, which is the
    // board a single `['’]` in a two-possessive anchor actually produces.
    const mixed = FLIP_KO_TEXT.replace("opponent's Active", "opponent’s Active");
    expect(mixed).toContain("opponent’s Active");
    expect(mixed).toContain("opponent's Benched");
    expect(deriveAttackEffect(mixed)).toEqual(deriveAttackEffect(FLIP_KO_TEXT));
  });

  it("keeps the local fixtures' printed text verbatim — the sentence IS the wiring", () => {
    // On the deriver path a one-character drift does not throw: the card drops onto
    // ATTACK_EFFECT_SKIPPED with no other failure anywhere, so the bytes get pinned.
    expect(LOCAL_CARDS["fix-koc-flip"]?.attacks?.[0]).toEqual({
      cost: ["Colorless"],
      name: "Coin Cull",
      effect: FLIP_KO_TEXT,
    });
    expect(LOCAL_CARDS["fix-koc-six"]?.attacks?.[0]).toEqual({
      cost: ["Colorless"],
      name: "Counter Cull",
      effect: SIX_COUNTERS_TEXT,
    });
    for (const text of [FLIP_KO_TEXT, SIX_COUNTERS_TEXT]) {
      expect(text).toContain("opponent's");
      expect(text).toContain("Pokémon");
      expect(text).not.toContain("’");
    }
  });

  it("the deck is 60 and every id resolves in the LOCAL pool", () => {
    expect(KO_CHOSEN_DECK).toHaveLength(60);
    for (const id of new Set(KO_CHOSEN_DECK)) expect(POOL[id], id).toBeDefined();
    // FIXTURE_POOL is untouched — the local demonstrators exist ONLY here.
    for (const id of Object.keys(LOCAL_CARDS)) expect(FIXTURE_POOL[id], id).toBeUndefined();
  });
});

const TAILS_SEEDS: readonly number[] = [1, 4, 5, 8, 9, 10, 11, 12, 13, 14, 15, 17, 19, 21, 24];
const HEADS_SEEDS: readonly number[] = [2, 3, 6, 7, 16, 18, 20, 22, 23];

function coinFace(seed: number, bench: readonly string[]): "heads" | "tails" {
  const board = armed(seed, "fix-koc-flip", "fix-koc-basic", bench);
  const { events } = mustApply(board, { type: "attack", seat: "p1", index: COIN_CULL });
  const flip = find(events, "ATTACK_EFFECT_COIN_FLIP");
  if (flip === undefined) throw new Error(`seed ${seed} flipped no coin`);
  return flip.result;
}

describe("§2 the coin and the HEADS arm — the Active, and only if it is Basic", () => {
  it("the seed table is MEASURED, and both faces are reachable", () => {
    // Without this the two arms could each be driven on a face nobody checked was
    // the face they got — and a suite in which one arm never runs passes forever.
    const tails: number[] = [];
    const heads: number[] = [];
    for (let seed = 1; seed <= 24; seed += 1) {
      (coinFace(seed, ["fix-koc-basic2"]) === "tails" ? tails : heads).push(seed);
    }
    expect(tails).toEqual([...TAILS_SEEDS]);
    expect(heads).toEqual([...HEADS_SEEDS]);
    expect(TAILS_SEEDS.length).toBeGreaterThan(0);
    expect(HEADS_SEEDS.length).toBeGreaterThan(0);
  });

  it("HEADS Knocks Out a BASIC Active — no damage anywhere in it", () => {
    const before = armed(headsSeed(), "fix-koc-flip", "fix-koc-basic", ["fix-koc-basic2"]);
    const victim = activeUid(before, "p2");
    deepFreeze(before);

    const { state, events } = mustApply(before, { type: "attack", seat: "p1", index: COIN_CULL });

    expect(find(events, "ATTACK_EFFECT_COIN_FLIP")?.result).toBe("heads");
    // The op is not damage and must not pretend to be.
    expect(types(events)).not.toContain("DAMAGE_DEALT");
    expect(types(events)).not.toContain("COUNTERS_PLACED");
    expect(find(events, "KNOCKED_OUT")).toMatchObject({ seat: "p2", uid: victim });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(state.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: 1 });
    // …and the heads arm asked NOTHING: the target is named by the print.
    expect(state.phase.kind).not.toBe("effect:choose");
  });

  it("HEADS against a NON-Basic Active does nothing — and the bench is not a fallback", () => {
    const before = armed(headsSeed(), "fix-koc-flip", "fix-koc-stage1", ["fix-koc-basic2"]);
    const survivor = activeUid(before, "p2");
    const benched = benchTopUid(before, "p2", 0);
    deepFreeze(before);

    const { state, events } = mustApply(before, { type: "attack", seat: "p1", index: COIN_CULL });

    expect(find(events, "ATTACK_EFFECT_COIN_FLIP")?.result).toBe("heads");
    expect(types(events)).not.toContain("KNOCKED_OUT");
    // Not merely un-Knocked-Out — UNTOUCHED. The op marks lethal against
    // `effectiveMaxHp`, so a gate that fired and was undone would leave 120 damage
    // sitting on a 120 HP body.
    expect(state.players.p2.active?.damage).toBe(0);
    expect(state.players.p2.active?.markers).toEqual([]);
    expect(state.players.p2.active?.stack).toContain(survivor);
    expect(state.players.p2.bench[0]?.stack).toContain(benched);
    expect(state.players.p2.bench[0]?.damage).toBe(0);
    expect(state.phase.kind).toBe("turn:action");
    // The attack RESOLVED — a gate answering "no" is not a skipped effect.
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("the ORDINARY attack kills the same Stage 1 — the gate is about the OP, not the body", () => {
    const before = armed(6, "fix-koc-flip", "fix-koc-stage1", ["fix-koc-basic2"]);
    const { state, events } = mustApply(before, { type: "attack", seat: "p1", index: PLAIN_BITE });
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ seat: "p2", dealt: 200 });
    expect(find(events, "KNOCKED_OUT")).toBeDefined();
    expect(state.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: 1 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — A's TAILS arm: `parkOrForce`'s three endings, on the BENCH.
// ─────────────────────────────────────────────────────────────────────────────

describe("§3 the TAILS arm — nothing / forced / parked, over the opponent's BENCH", () => {
  it("an EMPTY opponent Bench is a SILENT no-op — but the coin still flipped", () => {
    const before = armed(tailsSeed(), "fix-koc-flip", "fix-koc-basic", []);
    deepFreeze(before);

    const { state, events } = mustApply(before, { type: "attack", seat: "p1", index: COIN_CULL });

    expect(find(events, "ATTACK_EFFECT_COIN_FLIP")).toEqual({
      type: "ATTACK_EFFECT_COIN_FLIP",
      seat: "p1",
      result: "tails",
    });
    expect(types(events)).not.toContain("KNOCKED_OUT");
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    // Nothing parked, nothing died, and the turn ended normally.
    expect(state.phase.kind).not.toBe("effect:choose");
    expect(state.players.p2.bench).toHaveLength(0);
    expect(state.players.p2.active?.damage).toBe(0);
    expect(state.players.p1.prizes).toHaveLength(6);
  });

  it("ONE candidate is FORCED — no prompt, and it is the BENCHED body", () => {
    const before = armed(tailsSeed(), "fix-koc-flip", "fix-koc-basic", ["fix-koc-basic2"]);
    const active = activeUid(before, "p2");
    const benched = benchTopUid(before, "p2", 0);
    deepFreeze(before);

    const { state, events } = mustApply(before, { type: "attack", seat: "p1", index: COIN_CULL });

    expect(find(events, "ATTACK_EFFECT_COIN_FLIP")?.result).toBe("tails");
    expect(state.phase.kind).not.toBe("effect:choose");
    expect(find(events, "KNOCKED_OUT")).toMatchObject({ seat: "p2", uid: benched });
    expect(state.players.p2.active?.stack).toContain(active);
    expect(state.players.p2.active?.damage).toBe(0);
    expect(state.players.p2.active?.markers).toEqual([]);
    // The Prize is PROMPTED and the LOSING seat owes NO promotion: a benched Knock
    // Out leaves the Active Spot occupied, which is the half §8.1 gets for free.
    expect(state.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: 1 });
    const settled = settle(state);
    expect(settled.players.p1.prizes).toHaveLength(5);
    expect(settled.players.p2.discard).toContain(benched);
    expect(settled.players.p2.bench).toHaveLength(0);
    expect(settled.players.p2.active?.stack).toContain(active);
  });

  it("TWO candidates PARK on `choosePokemon`, and the answer resolves the picked one", () => {
    const before = armed(tailsSeed(), "fix-koc-flip", "fix-koc-basic", [
      "fix-koc-basic",
      "fix-koc-basic2",
    ]);
    const first = benchTopUid(before, "p2", 0);
    const second = benchTopUid(before, "p2", 1);
    deepFreeze(before);

    const { state: parked, events: parkEvents } = mustApply(before, {
      type: "attack",
      seat: "p1",
      index: COIN_CULL,
    });

    const { candidates, note } = parkedOn(parked);
    expect(candidates).toEqual([
      { seat: "p2", spot: { spot: "bench", index: 0 } },
      { seat: "p2", spot: { spot: "bench", index: 1 } },
    ]);
    // The caption names EXACTLY the set the funnel offered, in the card's own word
    // order — a dialog that said anything else would contradict its own validator.
    expect(note).toBe("Knock Out 1 of your opponent's Benched Basic Pokémon.");
    // Nothing has died yet: the epilogue is waiting behind the decision.
    expect(types(parkEvents)).not.toContain("KNOCKED_OUT");
    expect(parked.players.p2.bench).toHaveLength(2);

    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon", ref: { seat: "p2", spot: { spot: "bench", index: 1 } } },
    });

    // The PICKED body died and the other one did not — a park that resolved the
    // wrong ref, or both, passes a "something was Knocked Out" assertion.
    expect(find(events, "KNOCKED_OUT")).toMatchObject({ seat: "p2", uid: second });
    const settled = settle(done);
    expect(settled.players.p2.discard).toContain(second);
    expect(settled.players.p2.discard).not.toContain(first);
    expect(settled.players.p2.bench).toHaveLength(1);
    expect(settled.players.p2.bench[0]?.stack).toContain(first);
  });

  it("`basicOnly` drops a benched EVOLUTION — one candidate left, so it FORCES", () => {
    const before = armed(tailsSeed(), "fix-koc-flip", "fix-koc-basic", [
      "fix-koc-stage1",
      "fix-koc-basic2",
    ]);
    const evolution = benchTopUid(before, "p2", 0);
    const basic = benchTopUid(before, "p2", 1);
    deepFreeze(before);

    const { state, events } = mustApply(before, { type: "attack", seat: "p1", index: COIN_CULL });

    expect(state.phase.kind).not.toBe("effect:choose");
    expect(find(events, "KNOCKED_OUT")).toMatchObject({ seat: "p2", uid: basic });
    const settled = settle(state);
    expect(settled.players.p2.discard).toContain(basic);
    expect(settled.players.p2.bench).toHaveLength(1);
    expect(settled.players.p2.bench[0]?.stack).toContain(evolution);
    expect(settled.players.p2.bench[0]?.damage).toBe(0);
  });

  it("a Bench of NOTHING BUT Evolutions is the ZERO arm again — narrowed to empty", () => {
    const before = armed(tailsSeed(), "fix-koc-flip", "fix-koc-basic", [
      "fix-koc-stage1",
      "fix-koc-stage1",
    ]);
    const { state, events } = mustApply(before, { type: "attack", seat: "p1", index: COIN_CULL });
    expect(find(events, "ATTACK_EFFECT_COIN_FLIP")?.result).toBe("tails");
    expect(types(events)).not.toContain("KNOCKED_OUT");
    expect(state.phase.kind).not.toBe("effect:choose");
    expect(state.players.p2.bench).toHaveLength(2);
    expect(state.players.p2.bench.every((p) => p.damage === 0)).toBe(true);
  });

  it("the FUNNEL itself, asked directly — scope and rider, on one board", () => {
    const board = armed(1, "fix-koc-flip", "fix-koc-basic", ["fix-koc-basic2", "fix-koc-stage1"]);
    expect(knockOutChosenTargets(board, "p1", BENCH_BASIC_OP)).toEqual([
      { seat: "p2", spot: { spot: "bench", index: 0 } },
    ]);
    // Unnarrowed, the SAME scope keeps the Evolution…
    expect(
      knockOutChosenTargets(board, "p1", { op: "knockOutChosen", target: "opponentBench" }),
    ).toHaveLength(2);
    // …and the OTHER scope leads with the Active (`oppAnyRefs`' order, so a forced
    // single-candidate board reads naturally).
    expect(
      knockOutChosenTargets(board, "p1", { op: "knockOutChosen", target: "opponentAny" }),
    ).toEqual([
      { seat: "p2", spot: { spot: "active" } },
      { seat: "p2", spot: { spot: "bench", index: 0 } },
      { seat: "p2", spot: { spot: "bench", index: 1 } },
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — B: the damage-counter window, over the WHOLE opponent board.
// ─────────────────────────────────────────────────────────────────────────────

/** P1 fields the counter demonstrator; P2's Active and Bench take the damage the
    case names (in HP — a counter is ten of it, which is the whole subject here). */
function counterBoard(
  seed: number,
  activeDamage: number,
  bench: readonly { id: string; damage: number }[],
): GameState {
  let state = armed(
    seed,
    "fix-koc-six",
    "fix-koc-basic",
    bench.map((b) => b.id),
  );
  state = setDamage(state, "p2", activeDamage);
  bench.forEach((b, index) => {
    state = setBenchDamage(state, "p2", index, b.damage);
  });
  return state;
}

describe("§4 the counter window — EXACTLY six, and the two near-misses", () => {
  it("sixty HP of damage is SIX counters and is Knocked Out — Active included", () => {
    const before = counterBoard(1, 60, [{ id: "fix-koc-basic2", damage: 0 }]);
    const victim = activeUid(before, "p2");
    deepFreeze(before);

    const { state, events } = mustApply(before, {
      type: "attack",
      seat: "p1",
      index: COUNTER_CULL,
    });

    expect(types(events)).not.toContain("DAMAGE_DEALT");
    expect(find(events, "KNOCKED_OUT")).toMatchObject({ seat: "p2", uid: victim });
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    // One candidate, so no prompt: the M1 rule again, one op over.
    expect(state.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: 1 });
  });

  it("FIVE counters and SEVEN counters are BOTH passed over", () => {
    const before = counterBoard(50, 50, [
      { id: "fix-koc-basic", damage: 70 },
      { id: "fix-koc-basic2", damage: 0 },
    ]);
    deepFreeze(before);

    const { state, events } = mustApply(before, {
      type: "attack",
      seat: "p1",
      index: COUNTER_CULL,
    });

    expect(types(events)).not.toContain("KNOCKED_OUT");
    expect(state.phase.kind).not.toBe("effect:choose");
    // Untouched rather than merely alive — the op marks lethal, so a window that
    // fired and was undone would leave the body's damage at its maximum.
    expect(state.players.p2.active?.damage).toBe(50);
    expect(state.players.p2.bench[0]?.damage).toBe(70);
    expect(state.players.p2.active?.markers).toEqual([]);
    expect(state.players.p2.bench[0]?.markers).toEqual([]);
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("SIXTY-FIVE HP of damage is still SIX counters — the floor, not an equality on HP", () => {
    const before = counterBoard(2, 65, [{ id: "fix-koc-basic2", damage: 0 }]);
    const victim = activeUid(before, "p2");
    const { events } = mustApply(before, { type: "attack", seat: "p1", index: COUNTER_CULL });
    expect(find(events, "KNOCKED_OUT")).toMatchObject({ seat: "p2", uid: victim });
  });

  it("an UNDAMAGED board is the ZERO arm — nothing is offered and nothing dies", () => {
    // Zero counters is not six, and the whole board saying so is what stops the
    // window from being satisfiable by "any damaged body".
    const before = counterBoard(3, 0, [
      { id: "fix-koc-basic", damage: 0 },
      { id: "fix-koc-basic2", damage: 0 },
    ]);
    const { state, events } = mustApply(before, {
      type: "attack",
      seat: "p1",
      index: COUNTER_CULL,
    });
    expect(types(events)).not.toContain("KNOCKED_OUT");
    expect(state.phase.kind).not.toBe("effect:choose");
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("TWO bodies at six counters PARK — Active and Bench in one prompt", () => {
    const before = counterBoard(4, 60, [
      { id: "fix-koc-basic", damage: 60 },
      { id: "fix-koc-basic2", damage: 70 },
    ]);
    const active = activeUid(before, "p2");
    const benched = benchTopUid(before, "p2", 0);
    deepFreeze(before);

    const { state: parked } = mustApply(before, {
      type: "attack",
      seat: "p1",
      index: COUNTER_CULL,
    });

    const { candidates, note } = parkedOn(parked);
    expect(candidates).toEqual([
      { seat: "p2", spot: { spot: "active" } },
      { seat: "p2", spot: { spot: "bench", index: 0 } },
    ]);
    expect(note).toBe(
      "Knock Out 1 of your opponent's Pokémon that has exactly 6 damage counters on it.",
    );

    const { state: done, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon", ref: { seat: "p2", spot: { spot: "bench", index: 0 } } },
    });
    expect(find(events, "KNOCKED_OUT")).toMatchObject({ seat: "p2", uid: benched });
    const settled = settle(done);
    expect(settled.players.p2.discard).toContain(benched);
    expect(settled.players.p2.active?.stack).toContain(active);
    expect(settled.players.p2.active?.damage).toBe(60);
  });

  it("refuses a wire answer that names a body OUTSIDE the offered set", () => {
    // `validateChoice`'s `choosePokemon` arm reads the PROMPT and nothing else,
    // which is what a P4 client is checked by — and it is why the §11 filter at the
    // funnel is sufficient and no second ask is needed on the resolve path.
    const before = counterBoard(4, 60, [
      { id: "fix-koc-basic", damage: 60 },
      { id: "fix-koc-basic2", damage: 70 },
    ]);
    const { state: parked } = mustApply(before, {
      type: "attack",
      seat: "p1",
      index: COUNTER_CULL,
    });
    const rejected = applyAction(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon", ref: { seat: "p2", spot: { spot: "bench", index: 1 } } },
    });
    expect(rejected.ok).toBe(false);
  });

  it("the FUNNEL itself, asked directly — the window is on COUNTERS, not on HP", () => {
    const board = counterBoard(5, 60, [
      { id: "fix-koc-basic", damage: 50 },
      { id: "fix-koc-basic2", damage: 70 },
    ]);
    expect(knockOutChosenTargets(board, "p1", ANY_SIX_OP)).toEqual([
      { seat: "p2", spot: { spot: "active" } },
    ]);
    // The SAME board with the window moved one counter each way picks up exactly
    // one of the two near-misses — so the field is read rather than compared to a
    // constant, at the funnel as well as at the deriver.
    expect(
      knockOutChosenTargets(board, "p1", {
        op: "knockOutChosen",
        target: "opponentAny",
        damageCountersExactly: 5,
      }),
    ).toEqual([{ seat: "p2", spot: { spot: "bench", index: 0 } }]);
    expect(
      knockOutChosenTargets(board, "p1", {
        op: "knockOutChosen",
        target: "opponentAny",
        damageCountersExactly: 7,
      }),
    ).toEqual([{ seat: "p2", spot: { spot: "bench", index: 1 } }]);
    // …and with NO window every body in scope is a candidate, which is the
    // "absent = no narrowing" contract stated as a board.
    expect(
      knockOutChosenTargets(board, "p1", { op: "knockOutChosen", target: "opponentAny" }),
    ).toHaveLength(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — §11. A shielded body is not OFFERED (a FILTER, not a guard).
// ─────────────────────────────────────────────────────────────────────────────

describe("§5 §11 — `unshieldedRefs` filters the CANDIDATES, it does not refuse the op", () => {
  it("a shielded benched Basic is NOT offered — the other one is FORCED instead", () => {
    let before = armed(tailsSeed(), "fix-koc-flip", "fix-koc-basic", [
      "fix-koc-basic",
      "fix-koc-basic2",
    ]);
    before = attachBenchFromDeck(before, "p2", 0, "fix-mist-energy", 1);
    const shielded = benchTopUid(before, "p2", 0);
    const exposed = benchTopUid(before, "p2", 1);
    deepFreeze(before);

    const { state, events } = mustApply(before, { type: "attack", seat: "p1", index: COIN_CULL });

    expect(find(events, "ATTACK_EFFECT_PREVENTED")).toEqual({
      type: "ATTACK_EFFECT_PREVENTED",
      seat: "p2",
      uid: shielded,
    });
    // FORCED, not parked: the shielded body left the candidate set before
    // `parkOrForce` counted it.
    expect(state.phase.kind).not.toBe("effect:choose");
    expect(find(events, "KNOCKED_OUT")).toMatchObject({ seat: "p2", uid: exposed });
    const settled = settle(state);
    expect(settled.players.p2.bench).toHaveLength(1);
    expect(settled.players.p2.bench[0]?.stack).toContain(shielded);
    expect(settled.players.p2.bench[0]?.damage).toBe(0);
    expect(settled.players.p2.bench[0]?.markers).toEqual([]);
  });

  it("THE CONTROL — the SAME board with the Energy removed PARKS with both", () => {
    // Without this the case above is satisfied by a build that cannot offer bench
    // index 0 at all. One card is stripped and nothing else moves.
    const before = armed(tailsSeed(), "fix-koc-flip", "fix-koc-basic", [
      "fix-koc-basic",
      "fix-koc-basic2",
    ]);
    const { state: parked } = mustApply(before, { type: "attack", seat: "p1", index: COIN_CULL });
    expect(parkedOn(parked).candidates).toHaveLength(2);
  });

  it("the ONLY candidate being shielded is the ZERO arm — nothing dies", () => {
    // An emptied candidate set is a whiff, which is the third of `parkOrForce`'s
    // endings reached by the shield rather than by the board.
    let before = armed(tailsSeed(), "fix-koc-flip", "fix-koc-basic", ["fix-koc-basic2"]);
    before = attachBenchFromDeck(before, "p2", 0, "fix-mist-energy", 1);
    const shielded = benchTopUid(before, "p2", 0);
    deepFreeze(before);

    const { state, events } = mustApply(before, { type: "attack", seat: "p1", index: COIN_CULL });

    expect(find(events, "ATTACK_EFFECT_PREVENTED")).toMatchObject({ seat: "p2", uid: shielded });
    expect(types(events)).not.toContain("KNOCKED_OUT");
    expect(state.phase.kind).not.toBe("effect:choose");
    expect(state.players.p2.bench[0]?.damage).toBe(0);
    expect(state.players.p2.bench[0]?.markers).toEqual([]);
  });

  it("…and on the OTHER scope: a shielded ACTIVE at six counters is passed over", () => {
    // The same filter reaching the Active through `opponentAny`, which is the arm
    // `unshieldedRefs` never saw before this op: every earlier candidate-set caller
    // (`gust`, `returnBenched`, `opponentSwitchOut`) offers a BENCH only.
    let before = counterBoard(6, 60, [{ id: "fix-koc-basic", damage: 60 }]);
    before = attachFromDeck(before, "p2", "fix-mist-energy", 1);
    const active = activeUid(before, "p2");
    const benched = benchTopUid(before, "p2", 0);
    deepFreeze(before);

    const { state, events } = mustApply(before, {
      type: "attack",
      seat: "p1",
      index: COUNTER_CULL,
    });

    expect(find(events, "ATTACK_EFFECT_PREVENTED")).toMatchObject({ seat: "p2", uid: active });
    expect(state.phase.kind).not.toBe("effect:choose");
    expect(find(events, "KNOCKED_OUT")).toMatchObject({ seat: "p2", uid: benched });
    expect(state.players.p2.active?.stack).toContain(active);
    expect(state.players.p2.active?.damage).toBe(60);
  });
});

describe("§6 the BENCHED non-damage Knock Out — `flow.ts` needed nothing, driven", () => {
  it("stamps D414's marker on a BENCHED body and marks it lethal where it stands", () => {
    const board = armed(1, "fix-koc-flip", "fix-koc-basic", ["fix-koc-basic2"]);
    const events: GameEvent[] = [];
    const result = runProgram(board, [BENCH_BASIC_OP], { seat: "p1", invokedBy: "attack" }, events);
    const doomed = result.state.players.p2.bench[0];
    expect(doomed?.markers).toEqual([koByEffectMarker(board.turn)]);
    expect(doomed?.damage).toBe(120);
    // …and the ACTIVE beside it is untouched, so the write landed on the bench slot
    // the ref named rather than on the seat's default body.
    expect(result.state.players.p2.active?.damage).toBe(0);
    expect(result.state.players.p2.active?.markers).toEqual([]);
    const twice: GameEvent[] = [];
    const again = runProgram(
      result.state,
      [BENCH_BASIC_OP],
      { seat: "p1", invokedBy: "attack" },
      twice,
    );
    expect(again.state.players.p2.bench[0]?.markers).toEqual([koByEffectMarker(board.turn)]);
  });

  it("…and §8.1 collects it off the BENCH — Prize, discard, no promotion owed", () => {
    const before = armed(tailsSeed(), "fix-koc-flip", "fix-koc-basic", ["fix-koc-basic2"]);
    const active = activeUid(before, "p2");
    const benched = benchTopUid(before, "p2", 0);
    const { state, events } = mustApply(before, { type: "attack", seat: "p1", index: COIN_CULL });
    expect(find(events, "KNOCKED_OUT")).toMatchObject({ seat: "p2", uid: benched });
    expect(state.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: 1 });
    const settled = settle(state);
    expect(settled.players.p1.prizes).toHaveLength(5);
    expect(settled.players.p2.discard).toContain(benched);
    expect(settled.players.p2.active?.stack).toContain(active);
    expect(settled.phase.kind).toBe("turn:action");
  });

  it("`byAttackFor` answers FALSE for it — the revenge clause is not owed", () => {
    const before = armed(tailsSeed(), "fix-koc-flip", "fix-koc-basic", ["fix-koc-basic2"]);
    const after = settle(mustApply(before, { type: "attack", seat: "p1", index: COIN_CULL }).state);
    expect(after.phase.kind).toBe("turn:action");
    expect(conditionHolds(after, "p2", BY_ATTACK)).toBe(false);
  });

  it("…AND ON THE PARKED PATH TOO — the arm a ONE-CANDIDATE BOARD never reaches", () => {
    const before = armed(tailsSeed(), "fix-koc-flip", "fix-koc-basic", [
      "fix-koc-basic",
      "fix-koc-basic2",
    ]);
    const parked = mustApply(before, { type: "attack", seat: "p1", index: COIN_CULL }).state;
    // Two candidates, so this really is the parked arm and not a forced one.
    expect(parkedOn(parked).candidates).toHaveLength(2);
    const { state: done } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon", ref: { seat: "p2", spot: { spot: "bench", index: 1 } } },
    });
    const after = settle(done);
    expect(after.phase.kind).toBe("turn:action");
    expect(conditionHolds(after, "p2", BY_ATTACK)).toBe(false);
  });

  it("THE CONTROL — an ordinary damage Knock Out on the same board DOES owe it", () => {
    // Without this the case above is satisfied by a reader that answers false
    // always. Same deck, same seats, same attacker card — index 1 instead of 0.
    const before = armed(3, "fix-koc-flip", "fix-koc-basic", ["fix-koc-basic2"]);
    const after = settle(
      mustApply(before, { type: "attack", seat: "p1", index: PLAIN_BITE }).state,
    );
    expect(conditionHolds(after, "p2", BY_ATTACK)).toBe(true);
  });

  it("Vengeful Punch on a BENCHED holder pays NO recoil for an effect Knock Out", () => {
    let before = armed(tailsSeed(), "fix-koc-flip", "fix-koc-basic", ["fix-koc-basic2"]);
    before = attachToolFromDeck(before, "p2", 0, "sv03-197");
    deepFreeze(before);
    const { state, events } = mustApply(before, { type: "attack", seat: "p1", index: COIN_CULL });
    expect(find(events, "KNOCKED_OUT")).toBeDefined();
    // The attacker is untouched: 4 counters would be 40 damage on a 200 HP body.
    expect(state.players.p1.active?.damage).toBe(0);
  });

  it("THE CONTROL — the SAME benched Tool holder DOES pay when it dies to damage", () => {
    let before = armed(1, "fix-koc-six", "fix-koc-basic", ["fix-koc-basic2"]);
    before = attachToolFromDeck(before, "p2", 0, "sv03-197");
    before = setBenchDamage(before, "p2", 0, 120);
    deepFreeze(before);
    const { state, events } = mustApply(before, {
      type: "attack",
      seat: "p1",
      index: COUNTER_CULL,
    });
    expect(find(events, "KNOCKED_OUT")).toBeDefined();
    expect(state.players.p1.active?.damage).toBe(40);
  });
});

function tailsSeed(): number {
  const seed = TAILS_SEEDS[0];
  if (seed === undefined) throw new Error("TAILS_SEEDS is empty — re-measure §2's table");
  return seed;
}
function headsSeed(): number {
  const seed = HEADS_SEEDS[0];
  if (seed === undefined) throw new Error("HEADS_SEEDS is empty — re-measure §2's table");
  return seed;
}

/** A marker spelling this file asserts rather than imports blindly: the stamp is
    `koByEffect:<turn>`, and a suite reading `markers` for emptiness (§2, §3, §5)
    is only meaningful while the non-empty form is a real string. */
describe("§7 the marker string", () => {
  it("is D414's turn stamp, unchanged", () => {
    expect(koByEffectMarker(7)).toBe("koByEffect:7");
    expect(koByEffectMarker(7)).not.toBe(koByEffectMarker(8));
  });
});
