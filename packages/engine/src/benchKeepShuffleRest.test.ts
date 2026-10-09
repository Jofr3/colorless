import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import manifest from "../package.json" with { type: "json" };
import { legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import { deriveAttackEffect } from "./effects";
import type { EffectOp } from "./effects";
import { applyAction, createGame, engineVersion } from "./index";
import type { GameEvent, GameState, PokemonRef, Seat } from "./index";
import { shuffle } from "./rng";
import {
  FIXTURE_POOL,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  setActiveFromDeck,
} from "./testFixtures";
import { stackUids } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// 🆕🆕🆕 D537 — KEEP THREE, SHUFFLE THE REST: THE ONLY SENTENCE IN THIS CORPUS
// WHOSE PICK NAMES THE BODIES THAT *STAY*.
//
// `censusAttackCorpus.ts` **FILE LINE 84** — *"Choose 3 of your opponent's Benched
// Pokémon. If you do, shuffle all of your opponent's Benched Pokémon that you didn't
// choose, and all cards attached to those Pokémon, into their deck."* — **1 sentence
// / 2 legal printings** (`legalAttackCorpus()` index 31, leading count column `2`).
//
// ⚠️ **NO CARD ID IS RESOLVED FOR THIS SENTENCE ON THIS CHECKOUT**, and that was
// MEASURED rather than assumed: `git grep -F "Benched Pokémon that you didn"` over the
// whole repo at HEAD returns the corpus row and ONE refusal row in
// `counterPutChosen.test.ts`, and nothing anywhere — `index.ts`'s D373 name-only block
// included — claims an id or a name for it. So the whole suite rides a FILE-LOCAL
// DECLARED demonstrator, `d537-bencher` (D425, conventions.md:765: state unresolved,
// never invent), in D534's `d534-inkay` / D535's `d535-sniper` / D536's `d536-moltres`
// shape. ⚠️ **A REACHABILITY ARGUMENT BUILT ON A POPULATION GOES STALE LIKE A COUNT**
// (D536's sharpest finding, whose falsifier was sitting in `index.ts` all along), which
// is why the grep is recorded here beside the declaration rather than in a commit body.
//
// engine 0.421.0 → 0.422.0. ONE new whole-sentence anchor (`CHOOSE_KEEP_SHUFFLE_REST`,
// beside `RETURN_BENCHED`), ONE new arm (42-bis), ONE new `EffectOp` member
// (`returnBenchedRest`), ONE new interpreter writer, one `stepOp` case, one
// `applyChoice` case and one note function.
//
// 🛑 **THE MEMBER IS NOT AN OPTIONAL `keep` RIDER ON `returnBenched`, AND THAT IS
// D421's EXACT FAILURE MODE** (conventions.md:506-517, restated at :1193-1204): a build
// that DROPPED an optional `keep` would not do nothing — `returnBenched` shuffles the
// body the answer NAMES, so the degraded program shuffles the CHOSEN THREE away and
// leaves the rest. An INVERTED but entirely plausible board, silent in every log row.
// §4 is the rung that names the inversion and `D537-returns-the-chosen-not-the-rest` is
// the mutant that proves the decision was MADE.
//
// 🛑 **`MATCH_RECORD_VERSION` HELD AT 30, ON D125's WIDENING AND ON NOTHING ELSE.** A
// new `EffectOp` MEMBER widens a persisted union: no v30 deploy could author the byte
// `{"op":"returnBenchedRest","keep":3}`, because no v30 deploy had the member, and every
// byte a v30 deploy DID write still means exactly what it meant. ⚠️ **AND THIS OP
// PARKS**, so that byte really is written into the persisted record — §7 MEASURES which
// door it goes through rather than arguing it, because *"it never parks, so it is not
// persisted"* was false of D536's op and would be false here twice over.
// ─────────────────────────────────────────────────────────────────────────────

/** The printed sentence, read off the corpus in §1 and used as a constant everywhere
    else. Retyped ONCE, here, and §1's first rung is what proves the bytes agree. */
const PRINTED =
  "Choose 3 of your opponent's Benched Pokémon. If you do, shuffle all of your opponent's Benched Pokémon that you didn't choose, and all cards attached to those Pokémon, into their deck.";

const PROGRAM: EffectOp[] = [{ op: "returnBenchedRest", keep: 3 }];

/** The printed prompt caption, pinned byte for byte in §9. */
const NOTE = "Choose 3 of your opponent's Benched Pokémon to leave in play.";

const BENCHER = "d537-bencher";
const WALL = "d537-wall";
const B1 = "d537-b1";
const B2 = "d537-b2";
const B3 = "d537-b3";
const B4 = "d537-b4";
const B5 = "d537-b5";
/** The evolution §5's stack rung puts UNDER a benched body. */
const STAGE1 = "d537-stage1";
/** The BENCH-GATED §11 shield — Poltchageist "Curious Tea Party"
    (`preventDamageAndEffectsWhileBenched`), the one prevent in this pool that fires on
    a BENCHED body and therefore the only one this op can meet. */
const TEAPARTY = "fix-teaparty";
const TOOL = "fix-tool";
const ENERGY = "fix-energy";

const bencher = (id: string, name: string, hp: number): Card =>
  battler(id, {
    name,
    hp,
    retreat: 1,
    types: ["Colorless"],
    attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
  });

const LOCAL_CARDS: Record<string, Card> = {
  [BENCHER]: battler(BENCHER, {
    name: "D537 Bencher",
    hp: 260,
    retreat: 1,
    types: ["Colorless"],
    attacks: [
      // ⚠️ 10 IS THIS FILE'S DECLARATION AND NOT A PRINTING'S — no id is resolved for
      // this sentence (D425). Nothing this suite asserts is about the number; it is
      // non-zero only so the attack leaves a visible mark that is NOT this op's.
      { cost: ["Colorless"], name: "Bench Sweep", damage: 10, effect: PRINTED },
      // THE CONTROL, one index over: same attacker, same cost, same declared 10 and NO
      // effect text — so every §3 "no park AND no board change" verdict is a claim
      // about the op rather than about the board.
      { cost: ["Colorless"], name: "Plain Tap", damage: 10 },
    ],
  }),
  [WALL]: bencher(WALL, "D537 Wall", 330),
  [B1]: bencher(B1, "D537 B1", 200),
  [B2]: bencher(B2, "D537 B2", 200),
  [B3]: bencher(B3, "D537 B3", 200),
  [B4]: bencher(B4, "D537 B4", 200),
  [B5]: bencher(B5, "D537 B5", 200),
  [STAGE1]: battler(STAGE1, {
    name: "D537 Stage 1",
    hp: 140,
    retreat: 1,
    stage: "Stage 1",
    evolveFrom: "D537 B2",
    types: ["Colorless"],
    attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
  }),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

// 4 + 4 + 4*5 + 2 + 4 + 2 + 24 = 60.
const DECK = deckOf({
  [BENCHER]: 4,
  [WALL]: 4,
  [B1]: 4,
  [B2]: 4,
  [B3]: 4,
  [B4]: 4,
  [B5]: 4,
  [STAGE1]: 2,
  [TEAPARTY]: 4,
  [TOOL]: 2,
  [ENERGY]: 24,
});

const RAW: Record<string, string> = (
  import.meta as unknown as {
    glob(
      pattern: string | readonly string[],
      options: { query: "?raw"; import: "default"; eager: true },
    ): Record<string, string>;
  }
).glob(
  ["./{censusAttackCorpus,effects,interpreter,cardplay,redact}.ts", "../../../apps/api/src/lobby/match.ts"],
  { query: "?raw", import: "default", eager: true },
);
const raw = (suffix: string): string =>
  Object.entries(RAW).find(([k]) => k.endsWith(suffix))?.[1] ?? "";

function must(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(`action failed: ${result.error.code} ${result.error.message}`);
  return result.state;
}

function firstBasicInHand(state: GameState, seat: Seat): string {
  const uid = state.players[seat].hand.find((h) => {
    const card = POOL[state.cardIdByUid[h] ?? ""];
    return card?.category === "Pokemon" && card.stage === "Basic";
  });
  if (uid === undefined) throw new Error(`no Basic in ${seat}'s hand`);
  return uid;
}

function localSetup(seed: number): GameState {
  const created = createGame({ seed, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(
    applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first: "p2" }),
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

/** TEST SURGERY — attach one `cardId` off `seat`'s deck onto the benched body at
    `index`, as ENERGY or as a TOOL. */
function attachToBench(
  state: GameState,
  seat: Seat,
  index: number,
  cardId: string,
  as: "energy" | "tools",
): GameState {
  const side = state.players[seat];
  const body = side.bench[index];
  if (body === undefined) throw new Error(`${seat} has no bench[${index}]`);
  const uid = side.deck.find((u) => state.cardIdByUid[u] === cardId);
  if (uid === undefined) throw new Error(`${seat}'s deck lacks ${cardId}`);
  const grown = { ...body, [as]: [...body[as], uid] };
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: {
        ...side,
        bench: [...side.bench.slice(0, index), grown, ...side.bench.slice(index + 1)],
        deck: side.deck.filter((u) => u !== uid),
      },
    },
  };
}

/** TEST SURGERY — push one `cardId` UNDER the benched body at `index` as the bottom of
    its evolution stack, which is what §2's pile order puts FIRST. */
function underBench(state: GameState, seat: Seat, index: number, cardId: string): GameState {
  const side = state.players[seat];
  const body = side.bench[index];
  if (body === undefined) throw new Error(`${seat} has no bench[${index}]`);
  const uid = side.deck.find((u) => state.cardIdByUid[u] === cardId);
  if (uid === undefined) throw new Error(`${seat}'s deck lacks ${cardId}`);
  const grown = { ...body, stack: [uid, ...body.stack] };
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: {
        ...side,
        bench: [...side.bench.slice(0, index), grown, ...side.bench.slice(index + 1)],
        deck: side.deck.filter((u) => u !== uid),
      },
    },
  };
}

/** TEST SURGERY — drop the benched body at `index` off the board entirely, leaving its
    cards nowhere. Used ONCE, in §8, to build the board `applyChoice`'s trust level is
    about: a wire answer whose body has since left play. */
function dropBench(state: GameState, seat: Seat, index: number): GameState {
  const side = state.players[seat];
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: { ...side, bench: [...side.bench.slice(0, index), ...side.bench.slice(index + 1)] },
    },
  };
}

/** TEST SURGERY — attach `count` copies of `fix-energy` off `seat`'s deck onto its
    Active, so the printed cost is payable. */
function fuel(state: GameState, seat: Seat, count: number): GameState {
  let next = state;
  for (let i = 0; i < count; i++) {
    const side = next.players[seat];
    const body = side.active;
    if (body === null) throw new Error(`${seat} has no Active`);
    const uid = side.deck.find((u) => next.cardIdByUid[u] === ENERGY);
    if (uid === undefined) throw new Error(`${seat}'s deck lacks ${ENERGY}`);
    next = {
      ...next,
      players: {
        ...next.players,
        [seat]: {
          ...side,
          active: { ...body, energy: [...body.energy, uid] },
          deck: side.deck.filter((u) => u !== uid),
        },
      },
    };
  }
  return next;
}

/** p1's turn; `d537-bencher` Active; p2's Active is `WALL` and its Bench is exactly
    `bench`, in the order given. */
function board(seed: number, bench: readonly string[]): GameState {
  let state = localSetup(seed);
  state = setActiveFromDeck(state, "p2", WALL);
  state = clearBench(state, "p2");
  for (const id of bench) state = benchFromDeck(state, "p2", id);
  state = must(applyAction(state, { type: "endTurn", seat: "p2" }));
  state = setActiveFromDeck(state, "p1", BENCHER);
  state = clearBench(state, "p1");
  state = benchFromDeck(state, "p1", B1);
  return fuel(state, "p1", 1);
}

function attack(state: GameState, index = 0): { state: GameState; events: readonly GameEvent[] } {
  const result = applyAction(state, { type: "attack", seat: "p1", index });
  if (!result.ok) throw new Error(`attack failed: ${result.error.code} ${result.error.message}`);
  return { state: result.state, events: result.events };
}

function answer(
  state: GameState,
  refs: readonly PokemonRef[],
): { state: GameState; events: readonly GameEvent[] } {
  const result = applyAction(state, {
    type: "resolveEffect",
    seat: "p1",
    choice: { kind: "pokemonMulti", refs: [...refs] },
  });
  if (!result.ok) throw new Error(`answer refused: ${result.error.code} ${result.error.message}`);
  return { state: result.state, events: result.events };
}

const SEED = 137;
const benchIds = (state: GameState, seat: Seat): string[] =>
  state.players[seat].bench.map((b) => state.cardIdByUid[b.stack[b.stack.length - 1] ?? ""] ?? "?");
const benchRef = (index: number): PokemonRef => ({ seat: "p2", spot: { spot: "bench", index } });
const rows = (events: readonly GameEvent[], type: string) => events.filter((e) => e.type === type);
/** ⚠️ **AN ATTACK ENDS THE TURN [🆕🆕🆕 D570 (D539): except a FIRST attack under Festival Lead with Festival Grounds in play, which no board here builds]**, so every board this suite measures AFTER the answer
    has already run p2's turn tail — and that tail DRAWS ONE CARD off the very deck this
    op just shuffled into. The pile this op writes is therefore `deck ∪ hand`, and
    asserting on `deck` alone would be a rung whose colour depends on which card the
    shuffle happened to leave on top. The op's own `SHUFFLE` row and the `POKEMON_RETURNED`
    payload are what pin the destination; this pins the PILE. */
const libraryOf = (state: GameState, seat: Seat): string[] => [
  ...state.players[seat].deck,
  ...state.players[seat].hand,
];
/** The TOP card of a benched body — what `POKEMON_RETURNED.uid` names (`topUid`), which
    is NOT `stackUids`' last element (that is the last Tool). */
const topOfBench = (state: GameState, seat: Seat, index: number): string => {
  const body = state.players[seat].bench[index];
  if (body === undefined) throw new Error(`no ${seat} bench[${index}]`);
  const uid = body.stack[body.stack.length - 1];
  if (uid === undefined) throw new Error(`empty stack at ${seat} bench[${index}]`);
  return uid;
};

/** The whole benched body at `index`, or a loud throw — the one place this file resolves
    a bench slot, so no assertion operator is needed anywhere below. */
function bodyAt(state: GameState, seat: Seat, index: number) {
  const body = state.players[seat].bench[index];
  if (body === undefined) throw new Error(`no ${seat} bench[${index}]`);
  return body;
}

/** The parked prompt, or a loud throw. */
function parkedPrompt(state: GameState) {
  if (state.phase.kind !== "effect:choose") throw new Error(`not parked: ${state.phase.kind}`);
  const prompt = state.phase.prompt;
  if (prompt.kind !== "choosePokemonMulti") throw new Error(`wrong prompt: ${prompt.kind}`);
  return prompt;
}

// ─────────────────────────────────────────────────────────────────────────────
// §1 — THE CENSUS ROW AND THE ANCHOR.
// ─────────────────────────────────────────────────────────────────────────────

describe("D537 §1 — the corpus row, read off the census rather than retyped", () => {
  it("🛑 the row is READ by index and by units, never retyped (D183/D456)", () => {
    const corpus = legalAttackCorpus();
    const row = corpus[31];
    expect(row?.[1]).toBe(PRINTED);
    // The LEADING COUNT COLUMN is the printing count, and it is the unit the census
    // delta is measured in — 1 sentence, 2 legal printings.
    expect(row?.[0]).toBe(2);
    // EXACTLY ONE row carries this string: the sentence is the key of the census delta,
    // so a duplicate would double-count the printings under one build.
    expect(corpus.filter(([, s]) => s === PRINTED)).toEqual([[2, PRINTED]]);
  });

  it("🛑 the sentence is READ by `resolvedByAnyReader` at head — the census delta's own predicate", () => {
    expect(resolvedByAnyReader(PRINTED)).toBe(true);
  });

  it("🛑 THREE apostrophe slots, not two — COUNTED off the printed bytes", () => {
    // D536's anchor had two possessives; this one has two possessives AND the
    // contraction in "didn't". The count is pinned so a future re-read of the sentence
    // cannot quietly lose a slot.
    expect((PRINTED.match(/'/g) ?? []).length).toBe(3);
    expect(PRINTED.split("opponent's")).toHaveLength(3);
    expect(PRINTED).toContain("didn't choose");
  });

  it("🛑 SLOT 1 (the first possessive) curls alone, and derives IDENTICALLY", () => {
    const curly = PRINTED.replace("opponent's", "opponent’s");
    expect(curly).not.toBe(PRINTED);
    expect((curly.match(/'/g) ?? []).length).toBe(2);
    // EQUALITY, never merely non-null: a non-null check passes on a reader that folded
    // the sentence into some other row.
    expect(deriveAttackEffect(curly)).toEqual(deriveAttackEffect(PRINTED));
  });

  it("🛑 SLOT 2 (the second possessive) curls alone, and derives IDENTICALLY", () => {
    const head = PRINTED.indexOf("opponent's") + "opponent's".length;
    const curly = `${PRINTED.slice(0, head)}${PRINTED.slice(head).replace("opponent's", "opponent’s")}`;
    expect(curly).not.toBe(PRINTED);
    expect((curly.match(/'/g) ?? []).length).toBe(2);
    expect(curly).toContain("opponent's Benched Pokémon. If you do");
    expect(curly).toContain("opponent’s Benched Pokémon that you didn't");
    expect(deriveAttackEffect(curly)).toEqual(deriveAttackEffect(PRINTED));
  });

  it("🛑 SLOT 3 (the CONTRACTION in `didn't`) curls alone, and derives IDENTICALLY", () => {
    const curly = PRINTED.replace("didn't", "didn’t");
    expect(curly).not.toBe(PRINTED);
    expect((curly.match(/'/g) ?? []).length).toBe(2);
    expect(deriveAttackEffect(curly)).toEqual(deriveAttackEffect(PRINTED));
  });

  it("🛑 …and ALL THREE curled together derive identically too", () => {
    const curly = PRINTED.replaceAll("'", "’");
    expect((curly.match(/'/g) ?? []).length).toBe(0);
    expect((curly.match(/’/g) ?? []).length).toBe(3);
    expect(deriveAttackEffect(curly)).toEqual(deriveAttackEffect(PRINTED));
  });

  it("a NON-BREAKING SPACE anywhere in the sentence is NOT this sentence", () => {
    const nbsp = PRINTED.replace("Choose 3", "Choose 3");
    expect(nbsp).not.toBe(PRINTED);
    expect(deriveAttackEffect(nbsp)).toBeNull();
  });

  it("the LOOKALIKE `Pokemon` is not `Pokémon` — on any of the three occurrences", () => {
    expect(PRINTED.split("Pokémon")).toHaveLength(4);
    expect(deriveAttackEffect(PRINTED.replaceAll("Pokémon", "Pokemon"))).toBeNull();
    expect(deriveAttackEffect(PRINTED.replace("Benched Pokémon.", "Benched Pokemon."))).toBeNull();
  });

  it("the HEAD is anchored — a printed prefix refuses", () => {
    expect(deriveAttackEffect(`You may ${PRINTED[0]?.toLowerCase()}${PRINTED.slice(1)}`)).toBeNull();
    expect(deriveAttackEffect(`Flip a coin. If heads, ${PRINTED}`)).toBeNull();
  });

  it("the TAIL is anchored — a printed suffix refuses", () => {
    expect(deriveAttackEffect(`${PRINTED} Then, shuffle your deck.`)).toBeNull();
    expect(deriveAttackEffect(PRINTED.replace("into their deck.", "into their hand."))).toBeNull();
    expect(deriveAttackEffect(PRINTED.replace(/\.$/, ""))).toBeNull();
  });

  it("CASE is load-bearing in both directions — no `/i`", () => {
    expect(deriveAttackEffect(PRINTED.toLowerCase())).toBeNull();
    expect(deriveAttackEffect(PRINTED.toUpperCase())).toBeNull();
    expect(deriveAttackEffect(`c${PRINTED.slice(1)}`)).toBeNull();
    expect(deriveAttackEffect(PRINTED.replace("If you do", "if you do"))).toBeNull();
  });

  it("🛑 NEAR MISS 1 — `COUNTER_PUT_ON_CHOSEN_OPPONENTS`, in BOTH directions", () => {
    // It SHARES the first word and is refused by the TAIL, which is why both anchors
    // are whole-sentence `^…$`.
    const PUT = "Choose 2 of your opponent's Pokémon and put 3 damage counters on each of them.";
    // …it does not derive to THIS op…
    expect(deriveAttackEffect(PUT)).toEqual([
      { op: "damageChosen", target: "opponentAny", amount: 30, count: 2, source: "attack" },
    ]);
    // …and THIS sentence does not derive to THAT one.
    expect(deriveAttackEffect(PRINTED)).toEqual(PROGRAM);
    // And the neighbour is a real catalog row, not a constructed one.
    expect(legalAttackCorpus().some(([, s]) => s === PUT)).toBe(true);
  });

  it("🛑 NEAR MISS 2 — corpus line 82 (Angelite), THE INVERSION, in BOTH directions", () => {
    // Angelite's pick names the bodies that LEAVE; this sentence's names the bodies
    // that STAY. Same opening, opposite mechanism — the sharpest miss in the corpus.
    const ANGELITE =
      "Choose 2 of your opponent's Benched Pokémon. Shuffle those Pokémon and all attached cards into your opponent's deck. If 1 of your Pokémon used Angelite during your last turn, this attack can't be used.";
    expect(legalAttackCorpus().some(([, s]) => s === ANGELITE)).toBe(true);
    // Still UNBUILT at D537 — this arm does not quietly eat it.
    expect(deriveAttackEffect(ANGELITE)).toBeNull();
    expect(resolvedByAnyReader(ANGELITE)).toBe(false);
    // …and the other direction: this sentence is not a `returnBenched`.
    expect(deriveAttackEffect(PRINTED)).toEqual(PROGRAM);
  });

  it("🛑 NEAR MISS 3 — arm 42's OWN four sentences, in BOTH directions (the 41-bis ordering argument, RE-MEASURED)", () => {
    // Both anchors are `^…$` and the FIRST WORD differs ("Choose" vs
    // "Shuffle"/"Put"/"Flip"), so neither can claim a string the other matches. Driven
    // rather than asserted, because "the order is free" is a claim about two regexes.
    const FORTY_TWO: readonly [string, EffectOp][] = [
      [
        "Shuffle 1 of your opponent's Benched Pokémon and all attached cards into their deck.",
        { op: "returnBenched", whose: "opponent", dest: "deck" },
      ],
      [
        "Shuffle 1 of your Benched Pokémon and all attached cards into your deck.",
        { op: "returnBenched", whose: "self", dest: "deck" },
      ],
      [
        "Put 1 of your Benched Pokémon and all attached cards into your hand.",
        { op: "returnBenched", whose: "self", dest: "hand" },
      ],
    ];
    for (const [text, op] of FORTY_TWO) {
      expect(deriveAttackEffect(text), text).toEqual([op]);
    }
    const COIN =
      "Flip a coin. If heads, choose 1 of your opponent's Benched Pokémon. Shuffle that Pokémon and all attached cards into their deck.";
    expect((deriveAttackEffect(COIN) ?? [])[0]?.op).toBe("coinFlipGate");
    // …and none of the four is this op.
    for (const [text] of FORTY_TWO) {
      expect(JSON.stringify(deriveAttackEffect(text)), text).not.toContain("returnBenchedRest");
    }
    expect(JSON.stringify(deriveAttackEffect(COIN))).not.toContain("returnBenchedRest");
  });

  it("🛑 ONE all-640 predicate, LOOSER than the anchor, over the whole corpus", () => {
    // The loosest plausible pattern for "the pick names the bodies that stay" — a stem
    // with no surrounding sentence at all. Over the whole `legal_standard = 1` corpus it
    // returns exactly this row, so the family is ONE sentence and the anchor is not
    // hiding a sibling. A LOOSER predicate than the anchor is the point (D428): an
    // anchor-shaped one would be the anchor asserting itself.
    const loose = legalAttackCorpus().filter(([, s]) => /that you didn['’]t choose/.test(s));
    expect(loose).toEqual([[2, PRINTED]]);
    // …and the whole corpus is still 640 sentences, so the predicate ran over all of it.
    expect(legalAttackCorpus()).toHaveLength(640);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — THE ARM AND THE PROGRAM.
// ─────────────────────────────────────────────────────────────────────────────

describe("D537 §2 — arm 42-bis derives ONE op, and the capture is the number KEPT", () => {
  it("🛑 the exact one-op program — a LITERAL `toEqual`, keys and all", () => {
    expect(deriveAttackEffect(PRINTED)).toEqual([{ op: "returnBenchedRest", keep: 3 }]);
    // FIELD SET pinned as a literal: `whose` and `dest` are OMITTED because the single
    // printed sentence fixes opponent/deck, and a field no reader can vary is a field
    // that reads like a choice (D193/D196, D426's "absent IS the printed article").
    const op = (deriveAttackEffect(PRINTED) ?? [])[0] as Record<string, unknown>;
    expect(Object.keys(op).sort()).toEqual(["keep", "op"]);
  });

  it("🛑 the capture is the number KEPT, not the number REMOVED — driven at 1, 2 and 4", () => {
    for (const keep of [1, 2, 4, 12]) {
      const text = PRINTED.replace("Choose 3", `Choose ${keep}`);
      expect(deriveAttackEffect(text), text).toEqual([{ op: "returnBenchedRest", keep }]);
    }
  });

  it("🛑 the `>= 1` FLOOR: a synthetic `Choose 0` is REFUSED, loudly", () => {
    // "Choose 0" names no pick at all, and the complement of an empty pick is the whole
    // Bench under a caption that asked for nothing. Unreadable goes to the loud
    // `ATTACK_EFFECT_SKIPPED` path rather than to a plausible board.
    const zero = PRINTED.replace("Choose 3", "Choose 0");
    expect(zero).not.toBe(PRINTED);
    expect(zero).toMatch(/^Choose 0 of your opponent/);
    expect(deriveAttackEffect(zero)).toBeNull();
  });

  it("the sentence with NO number does not derive — the capture is required", () => {
    expect(deriveAttackEffect(PRINTED.replace("Choose 3 ", "Choose "))).toBeNull();
    expect(deriveAttackEffect(PRINTED.replace("Choose 3", "Choose three"))).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — THE GATE. An empty complement is not a question.
// ─────────────────────────────────────────────────────────────────────────────

describe("D537 §3 — bench ≤ keep asks NOTHING, and the ABSENCE is pinned (D423)", () => {
  for (const bench of [[], [B1], [B1, B2], [B1, B2, B3]] as const) {
    it(`🛑 bench ${bench.length} — no park AND no board change`, () => {
      const start = board(SEED, bench);
      const { state, events } = attack(start);
      // THE ABSENCE OF THE PARK, asserted positively rather than inferred from the
      // board (D423: a true assertion can stand in for a false claim).
      expect(state.phase.kind).not.toBe("effect:choose");
      expect("prompt" in state.phase).toBe(false);
      // …AND no board change: the bench stands, the deck is untouched, and neither the
      // movement row nor the shuffle row was filed.
      expect(benchIds(state, "p2")).toEqual([...bench]);
      // The deck is the start deck MINUS its top card, and that one card is the TURN
      // TAIL's draw rather than anything this op did — an attack ends the turn [🆕🆕🆕 D570 (D539): except a FIRST attack under Festival Lead with Festival Grounds in play, which no board here builds]. The
      // ORDER is untouched, which is the half a stray shuffle would break.
      expect(state.players.p2.deck).toEqual(start.players.p2.deck.slice(1));
      expect(state.rngState).toBe(start.rngState);
      expect(rows(events, "POKEMON_RETURNED")).toHaveLength(0);
      expect(rows(events, "SHUFFLE")).toHaveLength(0);
    });
  }

  it("🛑 bench 3 is the BOUNDARY — `<=`, not `<`: a pick with exactly one legal answer is not asked", () => {
    // At bench === keep the complement is EMPTY, so there is nothing to ask about at
    // all. `parkOrForce`'s M1 no-choice rule states both halves; this op states them
    // in its own gate because its candidate set is not the set the effect lands on.
    const { state } = attack(board(SEED, [B1, B2, B3]));
    expect(state.phase.kind).not.toBe("effect:choose");
    expect(state.players.p2.bench).toHaveLength(3);
  });

  it("🛑 bench 4 PARKS — one body in the complement is still a decision about WHICH three stay", () => {
    const { state } = attack(board(SEED, [B1, B2, B3, B4]));
    const prompt = parkedPrompt(state);
    expect(prompt.candidates).toHaveLength(4);
    expect(prompt.min).toBe(3);
    expect(prompt.max).toBe(3);
    expect(prompt.declinable).toBe(false);
  });

  it("🛑 bench 5 PARKS, and the candidates are the WHOLE opponent bench — UNFILTERED", () => {
    const { state } = attack(board(SEED, [B1, B2, B3, B4, B5]));
    const prompt = parkedPrompt(state);
    expect(prompt.candidates.map((c) => c.spot.spot === "bench" && c.spot.index)).toEqual([
      0, 1, 2, 3, 4,
    ]);
    // Every candidate is on the OPPONENT's seat — the printed possessive, and the
    // single-seat precondition the writer's descending splice depends on.
    expect(new Set(prompt.candidates.map((c) => c.seat))).toEqual(new Set(["p2"]));
  });

  it("the CONTROL: the same attacker's effect-free attack changes nothing either way", () => {
    const start = board(SEED, [B1, B2, B3, B4, B5]);
    const { state, events } = attack(start, 1);
    expect(state.phase.kind).not.toBe("effect:choose");
    expect(benchIds(state, "p2")).toEqual([B1, B2, B3, B4, B5]);
    expect(rows(events, "POKEMON_RETURNED")).toHaveLength(0);
    // …and it DID land, so the board is not simply inert.
    expect(state.players.p2.active?.damage).toBe(10);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — THE HEADLINE INVERSION: the chosen STAY.
// ─────────────────────────────────────────────────────────────────────────────

describe("D537 §4 — the pick names the bodies that STAY, and the COMPLEMENT leaves", () => {
  it("🛑 THE INVERSION: pick {0,1,2} on a 5-bench — those three STAY, the other two leave", () => {
    const start = board(SEED, [B1, B2, B3, B4, B5]);
    const parked = attack(start).state;
    // The UIDS, captured against the PRE-ANSWER bench — the deck already holds three
    // more copies of each card id, so a card-id count would be green either way.
    const leaving = [topOfBench(parked, "p2", 3), topOfBench(parked, "p2", 4)];
    const staying = [0, 1, 2].map((i) => topOfBench(parked, "p2", i));
    const { state } = answer(parked, [benchRef(0), benchRef(1), benchRef(2)]);
    // The CHOSEN are the survivors. A build that dropped the complement — D421's
    // dropped-rider degradation — would leave exactly [B4, B5] here instead.
    expect(benchIds(state, "p2")).toEqual([B1, B2, B3]);
    for (const uid of leaving) expect(libraryOf(state, "p2"), uid).toContain(uid);
    for (const uid of staying) expect(libraryOf(state, "p2"), uid).not.toContain(uid);
  });

  it("🛑 …and the inversion again on a DIFFERENT pick, so the answer is read and not assumed", () => {
    const start = board(SEED, [B1, B2, B3, B4, B5]);
    const parked = attack(start).state;
    const { state } = answer(parked, [benchRef(2), benchRef(3), benchRef(4)]);
    expect(benchIds(state, "p2")).toEqual([B3, B4, B5]);
  });

  it("🛑 the bodies that leave land in the OWNER's deck, never the actor's", () => {
    const start = board(SEED, [B1, B2, B3, B4, B5]);
    const parked = attack(start).state;
    const beforeP1 = libraryOf(parked, "p1").length;
    const beforeP2 = libraryOf(parked, "p2").length;
    const { state } = answer(parked, [benchRef(0), benchRef(1), benchRef(2)]);
    // The ACTOR's library is untouched — `returnBenched`'s "the owner is `ref.seat` and
    // not `ctx.seat`" rule, re-asked for a set-valued op.
    expect(libraryOf(state, "p1")).toHaveLength(beforeP1);
    expect(libraryOf(state, "p2")).toHaveLength(beforeP2 + 2);
    expect(state.players.p2.discard).toHaveLength(0);
  });

  it("bench 4, pick 3 — exactly ONE body leaves", () => {
    const start = board(SEED, [B1, B2, B3, B4]);
    const parked = attack(start).state;
    const { state, events } = answer(parked, [benchRef(0), benchRef(2), benchRef(3)]);
    expect(benchIds(state, "p2")).toEqual([B1, B3, B4]);
    expect(rows(events, "POKEMON_RETURNED")).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — ONE SHUFFLE, ONE RNG DRAW, N EVENTS, AND THE DESCENDING SPLICE.
// ─────────────────────────────────────────────────────────────────────────────

describe("D537 §5 — one printed shuffle is ONE shuffle, and the splice is DESCENDING", () => {
  it("🛑 exactly ONE `SHUFFLE` row and TWO `POKEMON_RETURNED` rows for a two-body complement", () => {
    // A loop over the shipped `returnBenched` would file TWO SHUFFLE rows and take TWO
    // RNG draws for one printed shuffle: the right board with the wrong log, which is
    // exactly D433's false-prevention row all over again.
    const start = board(SEED, [B1, B2, B3, B4, B5]);
    const parked = attack(start).state;
    const { events } = answer(parked, [benchRef(0), benchRef(1), benchRef(2)]);
    expect(rows(events, "SHUFFLE")).toHaveLength(1);
    expect(rows(events, "POKEMON_RETURNED")).toHaveLength(2);
    // The SHUFFLE names the OWNER, not the actor (the shipped writer's rule).
    expect(rows(events, "SHUFFLE").map((e) => (e as { seat: Seat }).seat)).toEqual(["p2"]);
  });

  it("🛑 exactly ONE RNG DRAW — the rngState is the ONE shuffle's, computed rather than remembered", () => {
    const start = board(SEED, [B1, B2, B3, B4, B5]);
    const parked = attack(start).state;
    const leaving = [3, 4].flatMap((i) => stackUids(bodyAt(parked, "p2", i)));
    const expected = shuffle([...parked.players.p2.deck, ...leaving], parked.rngState)[1];
    const { state } = answer(parked, [benchRef(0), benchRef(1), benchRef(2)]);
    // Fisher–Yates consumes `n - 1` draws, so two shuffles of two smaller piles land on
    // a DIFFERENT state than one shuffle of the whole pile. This is the rung a per-ref
    // shuffle cannot pass even where the board happens to agree.
    expect(state.rngState).toBe(expected);
  });

  it("🛑 THE DESCENDING-SPLICE RUNG: a NON-ADJACENT complement on a 5-bench", () => {
    // Pick {0,2,4} → the complement is {1,3}, which is NON-ADJACENT and therefore the
    // board an ASCENDING splice gets wrong: removing index 1 first compacts the bench,
    // and index 3 then names B5 instead of B4.
    const start = board(SEED, [B1, B2, B3, B4, B5]);
    const parked = attack(start).state;
    const { state, events } = answer(parked, [benchRef(0), benchRef(2), benchRef(4)]);
    expect(benchIds(state, "p2")).toEqual([B1, B3, B5]);
    // …and the EVENTS name the bodies that actually left, in board order.
    expect(
      rows(events, "POKEMON_RETURNED").map((e) => state.cardIdByUid[(e as { uid: string }).uid]),
    ).toEqual([B2, B4]);
  });

  it("🛑 …and the complement {0,1} — the ADJACENT-FROM-THE-FRONT board the shipped writer gets wrong", () => {
    // Remove {0,1} with an index splice that never re-reads: A leaves, the bench
    // compacts, and index 1 then removes C rather than B. Driven because the defect is
    // SILENT — the event names a plausible body either way.
    const start = board(SEED, [B1, B2, B3, B4, B5]);
    const parked = attack(start).state;
    const { state } = answer(parked, [benchRef(2), benchRef(3), benchRef(4)]);
    expect(benchIds(state, "p2")).toEqual([B3, B4, B5]);
  });

  it("🛑 …and the complement {1,3} on a 5-bench where the TAIL index would read `undefined`", () => {
    // The other half of the shipped writer's defect: remove {1,3} ascending and
    // `bench[3]` is `undefined` after the first splice, so its own silent guard fires
    // and ONE BODY SURVIVES. Here both leave.
    const start = board(SEED, [B1, B2, B3, B4, B5]);
    const parked = attack(start).state;
    const { state, events } = answer(parked, [benchRef(0), benchRef(2), benchRef(4)]);
    expect(state.players.p2.bench).toHaveLength(3);
    expect(rows(events, "POKEMON_RETURNED")).toHaveLength(2);
  });

  it("🛑 TOOLS and ATTACHED ENERGY ride along — every `stackUids` byte lands in the deck", () => {
    let start = board(SEED, [B1, B2, B3, B4, B5]);
    start = attachToBench(start, "p2", 4, ENERGY, "energy");
    start = attachToBench(start, "p2", 4, TOOL, "tools");
    const parked = attack(start).state;
    const riding = stackUids(bodyAt(parked, "p2", 4));
    expect(riding).toHaveLength(3); // the body, its Energy and its Tool
    const top = topOfBench(parked, "p2", 4);
    const { state, events } = answer(parked, [benchRef(0), benchRef(1), benchRef(2)]);
    for (const uid of riding) expect(libraryOf(state, "p2"), uid).toContain(uid);
    // …and the EVENT carries the whole pile, not just the top card.
    const row = rows(events, "POKEMON_RETURNED").find((e) => (e as { uid: string }).uid === top) as
      | { uids: string[] }
      | undefined;
    expect(row?.uids.slice().sort()).toEqual(riding.slice().sort());
  });

  it("🛑 an EVOLUTION STACK rides along too — the card UNDER the body reaches the deck", () => {
    let start = board(SEED, [B1, B2, B3, B4, B5]);
    start = underBench(start, "p2", 3, STAGE1);
    const parked = attack(start).state;
    const buried = bodyAt(parked, "p2", 3).stack[0];
    if (buried === undefined) throw new Error("no buried card");
    expect(parked.cardIdByUid[buried]).toBe(STAGE1);
    const { state } = answer(parked, [benchRef(0), benchRef(1), benchRef(2)]);
    expect(libraryOf(state, "p2")).toContain(buried);
    expect(state.players.p2.discard).toHaveLength(0);
  });

  it("no §8.1 promotion is owed — the Active is untouched by a bench-only op", () => {
    const start = board(SEED, [B1, B2, B3, B4, B5]);
    const parked = attack(start).state;
    const activeUid = parked.players.p2.active?.stack[0];
    const { state, events } = answer(parked, [benchRef(0), benchRef(1), benchRef(2)]);
    expect(state.players.p2.active?.stack[0]).toBe(activeUid);
    expect(rows(events, "KNOCKED_OUT")).toHaveLength(0);
    expect(state.pending.filter((p) => p.kind === "promote")).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — §11 ON THE COMPLEMENT ONLY (D433 — ask the shield AFTER narrowing).
// ─────────────────────────────────────────────────────────────────────────────

describe("D537 §6 — the shield is asked about the COMPLEMENT and about nothing else", () => {
  it("🛑 a shielded body in the COMPLEMENT files exactly ONE `ATTACK_EFFECT_PREVENTED` and STAYS", () => {
    const start = board(SEED, [B1, B2, B3, TEAPARTY, B5]);
    const parked = attack(start).state;
    const { state, events } = answer(parked, [benchRef(0), benchRef(1), benchRef(2)]);
    expect(rows(events, "ATTACK_EFFECT_PREVENTED")).toHaveLength(1);
    // It stays; the OTHER unchosen body still leaves.
    expect(benchIds(state, "p2")).toEqual([B1, B2, B3, TEAPARTY]);
    expect(rows(events, "POKEMON_RETURNED")).toHaveLength(1);
    // …and ONE shuffle still, for the one body that actually moved.
    expect(rows(events, "SHUFFLE")).toHaveLength(1);
  });

  it("🛑 THE CONTROL THAT PROVES THE ASK HAPPENS AFTER NARROWING: a shielded CHOSEN body files NOTHING", () => {
    // D433: asking §11 over the whole candidate set and filtering afterwards leaves the
    // board IDENTICAL and files a FALSE row about a body the effect could never reach.
    // Every board is the same under both builds; the only casualty is a log row, which
    // is exactly why it survives review.
    const start = board(SEED, [TEAPARTY, B2, B3, B4, B5]);
    const parked = attack(start).state;
    const { state, events } = answer(parked, [benchRef(0), benchRef(1), benchRef(2)]);
    expect(rows(events, "ATTACK_EFFECT_PREVENTED")).toHaveLength(0);
    expect(benchIds(state, "p2")).toEqual([TEAPARTY, B2, B3]);
  });

  it("🛑 the shield is not asked at PARK TIME either — a shielded body is still a CANDIDATE", () => {
    // The pick is not an effect done to the kept bodies, so filtering the candidates
    // would refuse a body on behalf of an effect it will never receive — and would make
    // the printed "choose 3" unanswerable on a 4-bench holding one shielded body.
    const { state } = attack(board(SEED, [TEAPARTY, B2, B3, B4]));
    const prompt = parkedPrompt(state);
    expect(prompt.candidates).toHaveLength(4);
  });

  it("🛑 …and when EVERY unchosen body is shielded, the op moves nothing and files NO shuffle", () => {
    const start = board(SEED, [B1, B2, B3, TEAPARTY]);
    const parked = attack(start).state;
    const { state, events } = answer(parked, [benchRef(0), benchRef(1), benchRef(2)]);
    expect(rows(events, "ATTACK_EFFECT_PREVENTED")).toHaveLength(1);
    expect(rows(events, "POKEMON_RETURNED")).toHaveLength(0);
    // AN EMPTY COMPLEMENT IS NOT AN EMPTY SHUFFLE: the deck must not be re-ordered for
    // a sentence that moved nothing.
    expect(rows(events, "SHUFFLE")).toHaveLength(0);
    expect(state.rngState).toBe(parked.rngState);
    expect(benchIds(state, "p2")).toEqual([B1, B2, B3, TEAPARTY]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7 — THE PERSISTED BYTES (D450's doors), MEASURED IN BOTH DIRECTIONS.
// ─────────────────────────────────────────────────────────────────────────────

describe("D537 §7 — the parked op IS persisted, and `MATCH_RECORD_VERSION` still holds at 30 (🆕🆕🆕 held at THIS slice; 31 since D547; 32 since D548; 33 since D549; 34 since D552; 35 since D556; 36 since D564; 37 since D570; 38 since D575; 39 since D576; 40 since D577; 41 since D579; 42 since D583)", () => {
  it("🛑 THE FIRST DOOR, MEASURED: `phase.cont.pendingOp` carries the op as a LITERAL", () => {
    // 🛑 **DO NOT RE-DERIVE *\"it never parks, so it is not persisted\"*.** This op parks,
    // so the serialized alphabet GROWS: `{\"op\":\"returnBenchedRest\",\"keep\":3}` is a byte
    // string no v30 deploy could ever have authored.
    const { state } = attack(board(SEED, [B1, B2, B3, B4, B5]));
    if (state.phase.kind !== "effect:choose") throw new Error("expected a park");
    expect(JSON.parse(JSON.stringify(state.phase.cont.pendingOp))).toEqual(PROGRAM[0]);
    expect(JSON.stringify(state)).toContain('{"op":"returnBenchedRest","keep":3}');
  });

  it("🛑 THE SECOND DOOR, SCOPED HONESTLY (D423): `cont.rest` is EMPTY on THIS program", () => {
    // D450's second door is `EffectContinuation.rest`, and the honest measurement is
    // that the PRINTED program is a single op, so `rest` is `[]` and the byte reaches
    // the record through `pendingOp` alone. `rest` is typed `EffectOp[]` and would carry
    // this member the moment any program places it behind another park — which is why
    // the version answer rests on D125's WIDENING and never on reachability.
    const { state } = attack(board(SEED, [B1, B2, B3, B4, B5]));
    if (state.phase.kind !== "effect:choose") throw new Error("expected a park");
    expect(state.phase.cont.rest).toEqual([]);
  });

  it("🛑 THE OTHER DIRECTION: on a NON-PARKING board the byte is NOWHERE in the record", () => {
    // The rung goes red both ways: green here on a build that persisted the op
    // unconditionally, and red above on a build that never parked it.
    const { state } = attack(board(SEED, [B1, B2, B3]));
    expect(state.phase.kind).not.toBe("effect:choose");
    expect(JSON.stringify(state)).not.toContain("returnBenchedRest");
  });

  it("🛑 the parked record REPLAYS — the persisted op is applied from `pendingOp` and nothing else", () => {
    const { state } = attack(board(SEED, [B1, B2, B3, B4, B5]));
    const revived = JSON.parse(JSON.stringify(state)) as GameState;
    expect(revived.phase.kind).toBe("effect:choose");
    const { state: done } = answer(revived, [benchRef(0), benchRef(1), benchRef(2)]);
    expect(benchIds(done, "p2")).toEqual([B1, B2, B3]);
  });

  it("🛑 `MATCH_RECORD_VERSION` is 42 (🆕🆕🆕 D583 stepped it 41 → 42; D579 stepped it 40 → 41; D577 stepped it 39 → 40; D576 stepped it 38 → 39; D575 stepped it 37 → 38; D570 stepped it 36 → 37; D564 stepped it 35 → 36; D556 stepped it 34 → 35; D552 stepped it 33 → 34; D549 stepped it 32 → 33; D548 stepped it 31 → 32; D547 stepped it 30 → 31; this slice held it) — read off the raw source, not retyped", () => {
    // 🆕🆕🆕 D547 — the constant this slice held is now 31: D547 added two REQUIRED `InPlayPokemon` fields (apps/api match.ts).
    expect(raw("/match.ts")).toContain("MATCH_RECORD_VERSION = 42");
  });

  it("🛑 the engine version is the CURRENT one in BOTH places (🆕 D538 — 0.422.0 → 0.423.0; the title is de-valued so the version tax is one edit per site, not two)", () => {
    expect(engineVersion).toBe("0.496.0");
    expect(manifest.version).toBe("0.496.0");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §8 — THE WIRE: the trust level, and what `validateChoice` refuses.
// ─────────────────────────────────────────────────────────────────────────────

describe("D537 §8 — the answer is trusted exactly as far as `returnBenched` trusts its ref", () => {
  it("🛑 a wire answer naming a body that has since LEFT PLAY narrows nothing, and does not throw", () => {
    // `returnBenched`'s trust level one arm up, verbatim: the complement is recomputed
    // off the LIVE bench, so a stale ref matches nothing and the writer re-reads every
    // slot it touches. Here bench[4] is dropped while the question is open and the
    // answer still names it.
    const start = board(SEED, [B1, B2, B3, B4, B5]);
    const parked = dropBench(attack(start).state, "p2", 4);
    expect(parked.players.p2.bench).toHaveLength(4);
    const { state, events } = answer(parked, [benchRef(0), benchRef(1), benchRef(4)]);
    // {0,1} are live and kept; {4} is gone; the complement is the live {2,3}.
    expect(benchIds(state, "p2")).toEqual([B1, B2]);
    expect(rows(events, "POKEMON_RETURNED")).toHaveLength(2);
    expect(rows(events, "SHUFFLE")).toHaveLength(1);
  });

  it("🛑 a 2-pick frame is refused with `BAD_EFFECT_CHOICE` — `min` is the printed number", () => {
    const parked = attack(board(SEED, [B1, B2, B3, B4, B5])).state;
    const result = applyAction(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [benchRef(0), benchRef(1)] },
    });
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error.code).toBe("BAD_EFFECT_CHOICE");
  });

  it("🛑 a 4-pick frame is refused with `BAD_EFFECT_CHOICE` — `max` is the printed number too", () => {
    const parked = attack(board(SEED, [B1, B2, B3, B4, B5])).state;
    const result = applyAction(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [0, 1, 2, 3].map(benchRef) },
    });
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error.code).toBe("BAD_EFFECT_CHOICE");
  });

  it("🛑 an EMPTY frame is refused — `declinable` is false, and this sentence prints no `you may`", () => {
    const parked = attack(board(SEED, [B1, B2, B3, B4, B5])).state;
    const result = applyAction(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [] },
    });
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error.code).toBe("BAD_EFFECT_CHOICE");
  });

  it("🛑 a REPEATED ref is refused — `validateChoice`'s distinctness check, RE-ASKED at min === max === 3", () => {
    const parked = attack(board(SEED, [B1, B2, B3, B4, B5])).state;
    const result = applyAction(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [benchRef(0), benchRef(0), benchRef(1)] },
    });
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error.code).toBe("BAD_EFFECT_CHOICE");
  });

  it("🛑 a ref OUTSIDE the offered candidates is refused — membership, on the ACTOR's own bench", () => {
    const parked = attack(board(SEED, [B1, B2, B3, B4, B5])).state;
    const result = applyAction(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: {
        kind: "pokemonMulti",
        refs: [benchRef(0), benchRef(1), { seat: "p1", spot: { spot: "bench", index: 0 } }],
      },
    });
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error.code).toBe("BAD_EFFECT_CHOICE");
  });

  it("🛑 the CONTROLLER answers, not the owner of the bodies — no `decider` on this park", () => {
    // §9.4: "the target is theirs, the choice is yours." This sentence prints no
    // chooser, so nothing inverts it — the call `knockOutChosen` and `damageChosen`'s
    // `opponentAny` arm already make.
    const parked = attack(board(SEED, [B1, B2, B3, B4, B5])).state;
    const refused = applyAction(parked, {
      type: "resolveEffect",
      seat: "p2",
      choice: { kind: "pokemonMulti", refs: [benchRef(0), benchRef(1), benchRef(2)] },
    });
    expect(refused.ok).toBe(false);
    const accepted = applyAction(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [benchRef(0), benchRef(1), benchRef(2)] },
    });
    expect(accepted.ok).toBe(true);
  });

  it("🛑 ZERO NEW PROMPT VOCABULARY — the kind, the validator arm and the redactor are all SHIPPED", () => {
    // RE-ASKED against this file rather than inherited from a brief (D536's overrun
    // class: a claim about another file). `choosePokemonMulti` gains no key here.
    expect(raw("/interpreter.ts")).toContain('kind: "choosePokemonMulti";');
    expect(raw("/cardplay.ts")).toContain('case "choosePokemonMulti":');
    expect(raw("/redact.ts")).toContain('case "choosePokemonMulti":');
    // …and the op adds exactly TWO `case "returnBenchedRest":` labels — `stepOp`'s and
    // `applyChoice`'s. A THIRD would mean somebody answered this question twice.
    expect(raw("/interpreter.ts").split('case "returnBenchedRest":')).toHaveLength(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §9 — THE NOTE, BYTE FOR BYTE (D205/D515).
// ─────────────────────────────────────────────────────────────────────────────

describe("D537 §9 — the caption speaks to the ANSWERER and quotes the PRINTED number", () => {
  it("🛑 the note, byte for byte", () => {
    const { state } = attack(board(SEED, [B1, B2, B3, B4, B5]));
    expect(parkedPrompt(state).note).toBe(NOTE);
  });

  it("🛑 …and it says the pick is what STAYS — the one fact the bare first clause hides", () => {
    // D515's defect, one card over: a caption that degraded to "Shuffle which of your
    // opponent's Benched Pokémon into their deck?" would describe the exact OPPOSITE
    // decision while the answer decides which bodies leave play.
    const { state } = attack(board(SEED, [B1, B2, B3, B4, B5]));
    const note = parkedPrompt(state).note;
    expect(note).toContain("to leave in play");
    expect(note).not.toContain("Shuffle");
    expect(note).not.toContain("into their deck");
  });

  it("🛑 the number in the caption is the PRINTED `keep`, and it is NOT clamped to the board", () => {
    // The prompt's own `min`/`max` are `op.keep` exactly, so a board-clamped caption
    // would contradict the frame it is captioning.
    const four = attack(board(SEED, [B1, B2, B3, B4])).state;
    expect(parkedPrompt(four).note).toBe(NOTE);
    expect(parkedPrompt(four).candidates).toHaveLength(4);
  });

  it("the note is the printed card's own words minus its anaphora — the `returnBenchedNote` rule", () => {
    // The printed first clause verbatim, with the second clause's "that you didn't
    // choose" replaced by the one fact it encodes.
    expect(NOTE.startsWith(PRINTED.slice(0, PRINTED.indexOf(".")))).toBe(true);
  });
});
