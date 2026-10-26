import manifest from "../package.json" with { type: "json" };
import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { deriveAttackEffect } from "./effects";
import type { EffectOp } from "./effectTypes";
import type { GameEvent } from "./events";
import { engineVersion, programFor } from "./index";
import type { GameState, Seat } from "./index";
import type { EffectContext } from "./effectPrompt";
import { runProgram } from "./interpreter";
import {
  FIXTURE_POOL,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  handFromDeck,
  mustApply,
  setActiveFromDeck,
  driveSetup,
  roundTrip,
} from "./testFixtures";
import { BENCH_MAX, otherSeat } from "./types";

const TONGUE_PULL_TEXT =
  "Your opponent reveals their hand. Put up to 2 Basic Pokémon you find there onto your opponent's Bench.";

function lickitung(id: string): Card {
  return battler(id, {
    name: "Lickitung",
    hp: 90,
    retreat: 2,
    types: ["Colorless"],
    attacks: [
      { cost: ["Colorless"], name: "Tongue Pull", effect: TONGUE_PULL_TEXT },
      { cost: ["Colorless", "Colorless", "Colorless"], name: "Strength", damage: 50 },
    ],
  });
}

/** A Stage 1 in the opponent's HAND — the fixture pool's Evolutions are all in
    play or over the HP bar, and without one the `basicPokemon` filter's stage
    conjunct is never the reason anything is refused. */
function handStage1(id: string): Card {
  return { ...battler(id, { hp: 60, retreat: 1 }), stage: "Stage1", evolveFrom: "fix-basic-1" };
}

const LOCAL_CARDS: Record<string, Card> = {
  "sv05-124": lickitung("sv05-124"),
  "sv05-180": lickitung("sv05-180"),
  "pull-stage1": handStage1("pull-stage1"),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

const PULL_DECK = deckOf({
  "sv05-124": 4,
  "sv05-180": 4,
  "fix-victim": 8,
  "fix-basic-1": 12,
  "pull-stage1": 4,
  "fix-item": 4,
  "fix-energy": 24,
});

function localSetup(seed: number, first: Seat): GameState {
  return driveSetup(seed, { p1: PULL_DECK, p2: PULL_DECK }, { pool: POOL, first });
}

/** Every uid in the seat's hand goes back under their deck. */
function emptyHand(state: GameState, seat: Seat): GameState {
  const side = state.players[seat];
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: { ...side, hand: [], deck: [...side.deck, ...side.hand] },
    },
  };
}

function board(
  seed: number,
  hand: readonly (readonly [string, number])[],
  benched: readonly string[] = [],
  activeId = "sv05-124",
): GameState {
  // p2 goes FIRST and ends their turn, so p1's attack is on turn 2 — §4 refuses a
  // going-first attack on turn 1 and the whole file drives the printed ATTACK.
  let state = localSetup(seed, "p2");
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", activeId);
  state = clearBench(state, "p1");
  state = benchFromDeck(state, "p1", "fix-basic-1");
  const victim = otherSeat("p1");
  state = clearBench(state, victim);
  for (const id of benched) state = benchFromDeck(state, victim, id);
  state = emptyHand(state, victim);
  for (const [id, n] of hand) state = handFromDeck(state, victim, id, n);
  return state;
}

function runOps(state: GameState, ops: readonly EffectOp[], seat: Seat) {
  const events: GameEvent[] = [];
  const ctx: EffectContext = { seat, sourceUid: state.players[seat].active?.stack[0] ?? "" };
  const out = runProgram(state, ops, ctx, {}, events);
  return { out, events, state: out.state, parked: out.kind === "parked" };
}

/** The `chooseCards` prompt out of a `RunResult`, or a loud throw. */
function promptOf(run: ReturnType<typeof runOps>) {
  if (run.out.kind !== "parked" || run.out.prompt.kind !== "chooseCards") {
    throw new Error(`expected a chooseCards park, got ${run.out.kind}`);
  }
  return run.out.prompt;
}

/** The parked `chooseCards` prompt on a real PHASE, or a loud throw. */
function cardsPrompt(state: GameState) {
  const phase = state.phase;
  if (phase.kind !== "effect:choose" || phase.prompt.kind !== "chooseCards") {
    throw new Error(`expected a chooseCards park, got ${phase.kind}`);
  }
  return phase.prompt;
}

function pull(
  seed: number,
  hand: readonly (readonly [string, number])[],
  benched: readonly string[] = [],
  activeId = "sv05-124",
): GameState {
  const state = board(seed, hand, benched, activeId);
  // {C} — one Energy of any type pays the printed cost.
  const paid = attachFromDeck(state, "p1", "fix-energy", 1);
  return mustApply(paid, { type: "attack", seat: "p1", index: 0 }).state;
}

function benchIds(state: GameState, seat: Seat): string[] {
  return state.players[seat].bench.map(
    (p) => state.cardIdByUid[p.stack[p.stack.length - 1] ?? ""] ?? "?",
  );
}

const TONGUE_PULL_OPS: readonly EffectOp[] = [
  { op: "bottomFromOpponentHand", filter: { kind: "basicPokemon" }, dest: "bench", upTo: 2 },
];

const SEEDS = [7, 19, 52, 88, 101] as const;

describe("D297 — the printed sentence, as ops", () => {
  it("derives to ONE op with `upTo: 2`, a bare `basicPokemon` filter and the bench dest", () => {
    expect(deriveAttackEffect(TONGUE_PULL_TEXT)).toEqual(TONGUE_PULL_OPS);
  });

  it("NO `maxHp` RIDER — Mandibuzz's 70 is Mandibuzz's word, not this sentence's", () => {
    const ops = deriveAttackEffect(TONGUE_PULL_TEXT);
    const first = ops?.[0];
    if (first === undefined || first.op !== "bottomFromOpponentHand") throw new Error("no op");
    expect(first.filter).toEqual({ kind: "basicPokemon" });
    expect(first.filter?.kind === "basicPokemon" ? first.filter.maxHp : "n/a").toBeUndefined();
  });

  it("BOTH catalog printings carry the SAME text, so ONE anchor reads both", () => {
    for (const id of ["sv05-124", "sv05-180"]) {
      const attacks = POOL[id]?.attacks ?? [];
      expect(attacks[0]?.name, id).toBe("Tongue Pull");
      expect(attacks[0]?.effect, id).toBe(TONGUE_PULL_TEXT);
      // The printed cost and index, re-queried rather than assumed: the handoff
      // before last predicted "NOT index 0" and was wrong.
      expect(attacks[0]?.cost, id).toEqual(["Colorless"]);
      expect(attacks[1]?.name, id).toBe("Strength");
      expect(deriveAttackEffect(attacks[0]?.effect ?? ""), id).toEqual(TONGUE_PULL_OPS);
    }
  });

  it("authors NO registry row — the column moves by a DERIVER arm alone", () => {
    for (const id of ["sv05-124", "sv05-180"]) {
      expect(programFor(id), id).toBeUndefined();
    }
  });

  it("reads the U+2019 spelling identically — and NO printing of it exists", () => {
    const curly = TONGUE_PULL_TEXT.replaceAll("'", "’");
    expect(curly).not.toBe(TONGUE_PULL_TEXT);
    expect(deriveAttackEffect(curly)).toEqual(TONGUE_PULL_OPS);
  });

  it("anchors WHOLE — a leading or trailing clause is refused, both directions", () => {
    expect(deriveAttackEffect(`If heads, ${TONGUE_PULL_TEXT}`)).toBeNull();
    expect(deriveAttackEffect(`${TONGUE_PULL_TEXT} Draw a card.`)).toBeNull();
  });

  it("the printed number is a CAPTURE with a guard, not a welded 2", () => {
    // Both ends of the guard, and the guard's ceiling is the BENCH's (§4) rather
    // than the attach family's 10 — this number sizes a Bench.
    for (const n of [1, 2, 3, BENCH_MAX]) {
      const text = TONGUE_PULL_TEXT.replace("up to 2", `up to ${n}`);
      expect(deriveAttackEffect(text), `up to ${n}`).toEqual([
        { op: "bottomFromOpponentHand", filter: { kind: "basicPokemon" }, dest: "bench", upTo: n },
      ]);
    }
    // A printed 0 would derive to a park nobody can answer; a printed 6 asks for
    // more bodies than a Bench holds. Both land on the loud skipped path.
    expect(deriveAttackEffect(TONGUE_PULL_TEXT.replace("up to 2", "up to 0"))).toBeNull();
    expect(
      deriveAttackEffect(TONGUE_PULL_TEXT.replace("up to 2", `up to ${BENCH_MAX + 1}`)),
    ).toBeNull();
  });

  it("the NEIGHBOURING sentence in the same family is still a DIFFERENT anchor", () => {
    // The punctuation argument, driven: Ortega/Purrloin's joined clause and this
    // one are two patterns, and neither reads the other's string.
    const joined =
      "Your opponent reveals their hand, and you choose a card you find there and put it on the bottom of their deck.";
    expect(deriveAttackEffect(joined)).toEqual([{ op: "bottomFromOpponentHand" }]);
    // The imperative form with the OTHER family's destination is nobody's sentence.
    expect(
      deriveAttackEffect(
        "Your opponent reveals their hand. Put up to 2 Basic Pokémon you find there onto your Bench.",
      ),
    ).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. THE ATTRIBUTION CONTROL — the unmarked op still means what it meant.
// ─────────────────────────────────────────────────────────────────────────────

describe("the ABSENT `upTo` is the M5 op, unchanged in every respect", () => {
  it("a lone candidate with NO `upTo` still AUTO-RESOLVES — the shortcut survives", () => {
    const state = board(SEEDS[0], [["fix-victim", 1]]);
    const out = runOps(state, [{ op: "bottomFromOpponentHand" }], "p1");
    expect(out.parked).toBe(false);
    expect(out.state.players.p2.hand).toEqual([]);
    expect(out.events.some((e) => e.type === "CARD_TO_BOTTOM_OF_DECK")).toBe(true);
  });

  it("and its park is still `min: 1, max: 1` when two classes are offered", () => {
    const state = board(SEEDS[1], [
      ["fix-victim", 1],
      ["fix-basic-1", 1],
    ]);
    const run = runOps(state, [{ op: "bottomFromOpponentHand" }], "p1");
    expect(run.parked).toBe(true);
    const prompt = promptOf(run);
    expect([prompt.min, prompt.max]).toEqual([1, 1]);
  });

  it('`dest: "bench"` with NO `upTo` is D294\'s Mandibuzz, byte for byte', () => {
    const state = board(SEEDS[2], [["fix-victim", 1]]);
    const out = runOps(state, [{ op: "bottomFromOpponentHand", dest: "bench" }], "p1");
    expect(out.parked).toBe(false);
    expect(benchIds(out.state, "p2")).toEqual(["fix-victim"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. THE CAP — the flagged doubt, DRIVEN on BOTH boards.
// ─────────────────────────────────────────────────────────────────────────────

describe("the interchangeable collapse, on the board the doubt did not name", () => {
  it("TWO COPIES OF ONE PRINTED BASIC offer TWO candidates under `upTo: 2`", () => {
    const state = pull(SEEDS[0], [["fix-victim", 2]]);
    const prompt = cardsPrompt(state);
    expect(prompt.candidates).toHaveLength(2);
    expect(prompt.candidates.map((u) => state.cardIdByUid[u])).toEqual([
      "fix-victim",
      "fix-victim",
    ]);
  });

  it("and BOTH of them can actually land — the second copy is reachable", () => {
    const state = pull(SEEDS[0], [["fix-victim", 2]]);
    const uids = cardsPrompt(state).candidates;
    const done = mustApply(state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [...uids] },
    }).state;
    expect(benchIds(done, "p2")).toEqual(["fix-victim", "fix-victim"]);
    for (const uid of uids) expect(done.players.p2.hand).not.toContain(uid);
  });

  it("TWO DIFFERENT BASICS offer two candidates WITH OR WITHOUT the cap — the fixture the doubt used shows NOTHING", () => {
    const twoKinds = [
      ["fix-victim", 1],
      ["fix-basic-1", 1],
    ] as const;
    const withCap = pull(SEEDS[1], twoKinds);
    const withoutCap = runOps(
      board(SEEDS[1], twoKinds),
      [{ op: "bottomFromOpponentHand", filter: { kind: "basicPokemon" }, dest: "bench" }],
      "p1",
    );
    expect(cardsPrompt(withCap).candidates).toHaveLength(2);
    expect(promptOf(withoutCap).candidates).toHaveLength(2);
  });

  it("the cap is `upTo` and NOT unbounded — THREE copies still offer only TWO", () => {
    // `interchangeableCandidates`' rule exactly: keep as many as the pick could
    // possibly want, and no more. A third identical copy is a third spelling of an
    // answer already on the table.
    const state = pull(SEEDS[2], [["fix-victim", 3]]);
    expect(cardsPrompt(state).candidates).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. THE DECLINE — "up to" means the controller may say no.
// ─────────────────────────────────────────────────────────────────────────────

describe('the printed "up to" is declinable, and a LONE candidate is still asked', () => {
  it("ONE candidate under `upTo` PARKS — the auto-resolve does not fire", () => {
    // The sharpest line in the diff. Under the old arm this board resolved inline
    // and put a Basic on the opponent's Bench with nobody asked.
    const state = pull(SEEDS[3], [["fix-victim", 1]]);
    const prompt = cardsPrompt(state);
    expect(prompt.candidates).toHaveLength(1);
    expect(prompt.min).toBe(0);
  });

  it("and answering with NO cards leaves the board untouched", () => {
    const state = pull(SEEDS[3], [["fix-victim", 1]]);
    const offered = cardsPrompt(state).candidates[0];
    if (offered === undefined) throw new Error("empty offer");
    const done = mustApply(state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [] },
    }).state;
    expect(done.players.p2.bench).toEqual([]);
    // The declined card is STILL IN HAND — the whole point of a decline, and the
    // assertion is on the uid rather than the count because the turn ends here and
    // p2 draws for it.
    expect(done.players.p2.hand).toContain(offered);
  });

  it("taking ONE of two offered is a legal answer too — `min: 0`, `max: 2`", () => {
    const state = pull(SEEDS[4], [
      ["fix-victim", 1],
      ["fix-basic-1", 1],
    ]);
    const prompt = cardsPrompt(state);
    expect([prompt.min, prompt.max]).toEqual([0, 2]);
    const first = prompt.candidates[0];
    if (first === undefined) throw new Error("empty offer");
    const done = mustApply(state, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [first] },
    }).state;
    expect(done.players.p2.bench).toHaveLength(1);
    expect(done.players.p2.hand).not.toContain(first);
    const other = prompt.candidates[1];
    if (other === undefined) throw new Error("expected two candidates");
    expect(done.players.p2.hand).toContain(other);
  });

  it("an EMPTY match still whiffs silently — the reveal happened, the pick did not", () => {
    // A hand with no Basic at all: the reveal rides the action, the offer is empty
    // and there is nothing to decline. The whiff is NOT the decline.
    const state = pull(SEEDS[0], [
      ["fix-item", 2],
      ["pull-stage1", 1],
    ]);
    expect(state.phase.kind).not.toBe("effect:choose");
    expect(state.players.p2.bench).toEqual([]);
    // Nothing left the hand. (The count is 4, not 3: the attack ended the turn and
    // p2 drew — which is exactly why every hand assertion in this file names uids.)
    expect(state.players.p2.hand.filter((u) => state.cardIdByUid[u] === "fix-item")).toHaveLength(
      2,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. THE FILTER and THE BENCH CEILING.
// ─────────────────────────────────────────────────────────────────────────────

describe("the filter reads the OPPONENT's hand, and the Bench caps the ask", () => {
  it("a Stage 1 in hand is refused by the STAGE — the noun is 'Basic Pokémon'", () => {
    const state = pull(SEEDS[1], [
      ["pull-stage1", 1],
      ["fix-victim", 1],
    ]);
    expect(cardsPrompt(state).candidates.map((u) => state.cardIdByUid[u])).toEqual(["fix-victim"]);
  });

  it("a bench with ONE slot left asks for at most ONE, not two", () => {
    // searchDeck's and discardPileRetrieval's clamp, taken at the same place and
    // for the same reason: never ask a question whose second answer cannot land.
    const benched = ["fix-basic-1", "fix-basic-1", "fix-basic-1", "fix-basic-1"];
    const state = pull(SEEDS[2], [["fix-victim", 2]], benched);
    expect(state.players.p2.bench).toHaveLength(BENCH_MAX - 1);
    const prompt = cardsPrompt(state);
    expect(prompt.max).toBe(1);
    expect(prompt.min).toBe(0);
  });

  it("a FULL opponent bench offers nothing at all — D294's whiff, unchanged", () => {
    const full = ["fix-basic-1", "fix-basic-1", "fix-basic-1", "fix-basic-1", "fix-basic-1"];
    const state = pull(SEEDS[3], [["fix-victim", 2]], full);
    expect(state.phase.kind).not.toBe("effect:choose");
    expect(state.players.p2.bench).toHaveLength(BENCH_MAX);
    expect(
      state.players.p2.hand.filter((u) => state.cardIdByUid[u] === "fix-victim").length,
    ).toBeGreaterThanOrEqual(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. THE PROMPT NOTE — a round trip to the printed text.
// ─────────────────────────────────────────────────────────────────────────────

describe("the prompt note is the CARD's sentence, character for character", () => {
  it("the note round-trips to the catalog string", () => {
    // The check `effects.ts` cannot run and this file can: the note is built from
    // the op's fields and the filter's PLURAL noun, and it lands exactly on the
    // text the anchor above matches. A drift in either would show up here.
    const state = pull(SEEDS[4], [["fix-victim", 2]]);
    expect(cardsPrompt(state).note).toBe(TONGUE_PULL_TEXT);
  });

  it("and the unmarked op's note is still Mandibuzz's SINGULAR joined clause", () => {
    const state = board(SEEDS[4], [
      ["fix-victim", 1],
      ["fix-basic-1", 1],
    ]);
    const run = runOps(
      state,
      [{ op: "bottomFromOpponentHand", filter: { kind: "basicPokemon" }, dest: "bench" }],
      "p1",
    );
    expect(promptOf(run).note).toBe(
      "Your opponent reveals their hand, and you put a Basic Pokémon you find there onto your opponent's Bench.",
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. END TO END — the printed attack, declared and paid for.
// ─────────────────────────────────────────────────────────────────────────────

describe("Tongue Pull as an ATTACK, from the action down", () => {
  it("the attack at INDEX 0 parks the choose — {C} is the whole cost", () => {
    const prompt = cardsPrompt(pull(SEEDS[0], [["fix-victim", 2]]));
    expect(prompt.candidates).toHaveLength(2);
    expect([prompt.min, prompt.max]).toEqual([0, 2]);
    expect(prompt.dest).toBe("bench");
  });

  it("resolving it benches BOTH copies on the OPPONENT's side of the table", () => {
    const parked = pull(SEEDS[0], [["fix-victim", 2]]);
    const uids = cardsPrompt(parked).candidates;
    const done = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [...uids] },
    }).state;
    expect(benchIds(done, "p2")).toEqual(["fix-victim", "fix-victim"]);
    // The ACTOR's own bench is untouched — the destination crosses a seat, which
    // is the one thing about this op a reader of its NAME cannot know.
    expect(benchIds(done, "p1")).toEqual(["fix-basic-1"]);
  });

  it("the SECOND printing plays identically — one sentence, two ids", () => {
    // The reprint is not a second authoring, and here it is not even a second
    // registry object: both ids reach the same anchor through their own text.
    const a = cardsPrompt(pull(SEEDS[1], [["fix-victim", 2]], [], "sv05-124"));
    const b = cardsPrompt(pull(SEEDS[1], [["fix-victim", 2]], [], "sv05-180"));
    expect(b.note).toBe(a.note);
    expect(b.candidates).toHaveLength(a.candidates.length);
    expect([b.min, b.max]).toEqual([a.min, a.max]);
  });

  it("the SECOND attack on the same body is plain damage — index 1 is untouched", () => {
    const attacks = POOL["sv05-124"]?.attacks ?? [];
    expect(attacks).toHaveLength(2);
    expect(attacks[1]?.effect).toBeUndefined();
    expect(attacks[1]?.damage).toBe(50);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. MATCH_RECORD_VERSION — the NO-BUMP, driven in BOTH directions.
// ─────────────────────────────────────────────────────────────────────────────

describe("MATCH_RECORD_VERSION stays 16 — and it is DRIVEN, not asserted", () => {
  function parked(): GameState {
    return pull(SEEDS[0], [["fix-victim", 2]]);
  }

  it("the persisted continuation's op carries EXACTLY these keys", () => {
    const phase = parked().phase;
    if (phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const revived = JSON.parse(JSON.stringify(phase)) as {
      cont: { pendingOp: EffectOp; rest: EffectOp[] };
    };
    expect(Object.keys(revived.cont.pendingOp).sort()).toEqual(["dest", "filter", "op", "upTo"]);
    expect(revived.cont.rest).toEqual([]);
  });

  it("FORWARD: a version-16 record with NO `upTo` replays as the mandatory single pick", () => {
    const state = board(SEEDS[1], [["fix-victim", 2]]);
    const run = runOps(state, [{ op: "bottomFromOpponentHand", dest: "bench" }], "p1");
    expect(run.parked).toBe(false);
    expect(run.state.players.p2.bench).toHaveLength(1);
    expect(run.state.players.p2.hand).toHaveLength(1);
  });

  it("BACKWARD: the parked prompt round-trips through JSON unchanged", () => {
    const before = parked();
    const revived = roundTrip(before);
    expect(revived.phase).toEqual(before.phase);
    const uids = cardsPrompt(revived).candidates;
    const done = mustApply(revived, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: [...uids] },
    }).state;
    expect(done.players.p2.bench).toHaveLength(2);
  });

  it("no `GameState` field, no new `GameEvent` TYPE, no new error code", () => {
    // What moved: ONE optional field on ONE existing op, which an old continuation
    // cannot carry and does not need. The prompt shape is unchanged — `min`/`max`
    // have been on `chooseCards` since the search family.
    const state = pull(SEEDS[0], [["fix-victim", 2]]);
    const keys = Object.keys(state).sort();
    expect(keys).toContain("phase");
    expect(keys).not.toContain("benchPuts");
    const prompt = cardsPrompt(state);
    expect(Object.keys(prompt).sort()).toEqual([
      "candidates",
      "dest",
      "kind",
      "max",
      "min",
      "note",
    ]);
  });
});

describe("the engine version", () => {
  it("moved PAST 0.207.0 with the new op field, and the two files agree", () => {
    expect(manifest.version).toBe(engineVersion);
  });
});
