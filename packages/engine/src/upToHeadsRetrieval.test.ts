import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import manifest from "../package.json" with { type: "json" };
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import {
  deriveAttackBonusConsequent,
  deriveAttackCancelRequirement,
  deriveAttackCoinFlip,
  deriveAttackCopy,
  deriveAttackDamageBonus,
  deriveAttackDamageMultiplier,
  deriveAttackDamagePenalty,
  deriveAttackDamageSuppression,
  deriveAttackDiscardScaledBoost,
  deriveAttackEffect,
  deriveAttackOptionalBoost,
  deriveAttackOptionalCostBoost,
  deriveAttackPreDamage,
  deriveAttackRequirement,
  splitAttackCancelClause,
  splitAttackGateClause,
  splitAttackRequirementClause,
  splitAttackTrailingClause,
} from "./effects";
import type { AttackCoinFlip } from "./effects";
import { applyAction, createGame, engineVersion } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import { logFromEvents } from "./log";
import { redactGame } from "./redact";
import { flipCoin } from "./rng";
import type { CoinFace } from "./rng";
import {
  FIXTURE_POOL,
  activeUid,
  attachFromDeck,
  battler,
  clearBench,
  deckOf,
  discardFromDeck,
  firstBasicInHand,
  must,
  mustApply,
  setActiveFromDeck,
  types,
} from "./testFixtures";

// 0.411.0 → 0.412.0 — 🆕🆕🆕 D525: THE HEADS COUNT READ AS AN "UP TO" CEILING BY ONE OP — ZERO
// VOCABULARY, A SEVENTH `AttackCoinFlip` MEMBER.
//
// *"Flip 3 coins. Put a number of cards up to the number of heads from your discard pile into your
// hand."* — `censusAttackCorpus.ts` **FILE LINE 219** (`legalAttackCorpus()` index 166), **1 sentence
// / 2 legal printings** (Oinkologne; `index.ts` and `effects.ts` name sv03-184 for ONE of them, and
// neither id is in `catalogManifest` / `FIXTURE_POOL` — the demonstrator below is DECLARED, no id is
// invented, D425), claimed by `deriveAttackCoinFlip` through ONE new anchor
// (`ATTACK_COIN_RETRIEVAL_UP_TO_HEADS`) as the SEVENTH member of the union:
//
//   { kind: "retrievalUpToHeads", flips: { kind: "printed", count: 3 },
//     filter: { kind: "anyCard" }, dest: "hand" }
//
// and spent at `attack.ts`'s fold into ONE shipped op — `discardPileRetrieval { filter, dest, max:
// heads }` — appended to the program when heads > 0. The interpreter's own "up to" reading of that
// op does the rest: `chooseCards { min 0, max: H, dest: "hand" }` over the public pile when it holds
// a card, `done` when it is empty. ZERO new op / filter / prompt / event vocabulary; the only new
// TYPE is the member, which is derived from text at the attack site and NEVER persisted (what
// reaches the continuation is the shipped op with a `number` max), so `MATCH_RECORD_VERSION` HOLDS
// at 30 (§4 drives it in three directions).
//
// 🛑 **THE DESIGN, TAKEN: ONE `max: H` PARK.** Rejected: H declinable `max: 1` parks through a
// zero-member `programPerHeads` (H prompts and H record parks for ONE printed question), and a
// generic `programMaxHeads` substituting `'max' in op` at runtime (type-loose; the attach twin at
// corpus FILE LINE 215 is a DIFFERENT op, `attachEnergyFrom`, and stays refused — D442/D448's
// one-printing rule; §1 holds it as the control).
//
// 🛑 **THE REFUSAL ON RECORD HAD A FALSE PREMISE.** `derivedDiscardRetrieval.test.ts` /
// `derivedDiscardAttach.test.ts` / the D234 blocks in `effects.ts` called this *"the SAME unanswered
// `attack.ts` fold question"*: the fold chain answers it (`programPerHeads` has appended to `program`
// since D130), and this slice spends the answer. Annotated in place, never deleted (D178/D442).

/** Corpus FILE LINE 219, byte for byte. Asserted off the corpus in §1, never retyped elsewhere. */
const PRINTED =
  "Flip 3 coins. Put a number of cards up to the number of heads from your discard pile into your hand.";
/** The same skeleton at a different printed count — the digit is CAPTURED, not pinned. Constructed. */
const at = (n: number): string => PRINTED.replace("Flip 3 coins", `Flip ${n} coins`);
/** Corpus FILE LINE 215 (census output line 271), 1 legal printing — the attach TWIN, a DIFFERENT op
    (`attachEnergyFrom`), refused by every reader: THE CONTROL.
    🆕🆕🆕 **D528 — BUILT, and the control INVERTED (D418's second half): the twin now derives on the
    SAME reader as the OTHER member** — `programPerHeads` over ONE copy of D358's discard-spread op,
    NOT `retrievalUpToHeads` — so what the old claim caught ("this anchor does not span the attach
    verb") is kept as `deriveAttackCoinFlip(ATTACH_TWIN).kind !== "retrievalUpToHeads"`, and the
    positive reading is asserted in `headsCeilingDiscardAttach.test.ts`. */
const ATTACH_TWIN =
  "Flip 3 coins. Attach a number of Basic {L} Energy cards up to the number of heads from your discard pile to your Benched Pokémon in any way you like.";
/** The REPEAT spelling of the same count — the `programPerHeads` reading this slice rejected. Constructed;
    nothing reads it. */
const REPEAT = "Flip 3 coins. For each heads, put a card from your discard pile into your hand.";

/** THE READING, spelled once. */
const reading = (count: number): AttackCoinFlip => ({
  kind: "retrievalUpToHeads",
  flips: { kind: "printed", count },
  filter: { kind: "anyCard" },
  dest: "hand",
});
const READING = reading(3);

const READERS = [
  deriveAttackBonusConsequent,
  deriveAttackCancelRequirement,
  deriveAttackCoinFlip,
  deriveAttackDamageBonus,
  deriveAttackDamageMultiplier,
  deriveAttackDamagePenalty,
  deriveAttackDamageSuppression,
  deriveAttackDiscardScaledBoost,
  deriveAttackEffect,
  deriveAttackOptionalBoost,
  deriveAttackOptionalCostBoost,
  deriveAttackPreDamage,
  // 🆕🆕🆕 D573 — THE FOURTEENTH, the copy-attack reader. Spliced before the last entry (D419).
  deriveAttackCopy,
  deriveAttackRequirement,
];
const SPLITTERS = [
  splitAttackCancelClause,
  splitAttackGateClause,
  splitAttackRequirementClause,
  splitAttackTrailingClause,
];

const units = (rows: readonly (readonly [number, string])[]) => rows.reduce((s, [n]) => s + n, 0);
const claims = (re: RegExp): readonly [number, number, readonly string[]] => {
  const rows = legalAttackCorpus().filter(([, s]) => re.test(s));
  return [rows.length, units(rows), rows.map(([, s]) => s)];
};

// ─────────────────────────────────────────────────────────────────────────────
// The demonstrator — a FILE-LOCAL pool and its own deck (D414/D452/D520/D522/D523/D524).
// ─────────────────────────────────────────────────────────────────────────────

/** DECLARED, not read: the printings' base and cost are unresolvable here (no D1, no
    `FIXTURE_POOL` id). 30 keeps the base and the Weak hit (60) distinguishable. */
const BASE = 30;
const PLAIN = "fix-energy";
const WALL = "d525-wall";

const RETRIEVAL_CARDS: Record<string, Card> = {
  "d525-forager": battler("d525-forager", {
    name: "D525 Forager",
    types: ["Colorless"],
    hp: 130,
    retreat: 2,
    attacks: [
      /** index 0 — FILE LINE 219 verbatim, with a DECLARED base and cost. */
      { cost: ["Colorless"], name: "Salvage Toss", damage: BASE, effect: PRINTED },
      /** index 1 — the control: no effect, no flip, no program. */
      { cost: ["Colorless"], name: "Plain Jab", damage: BASE },
      /** index 2 — the SAME sentence under a DECLARED "+" marker the member does NOT explain
          (`coinExplainsModifier`'s fourth exception): the loud row must survive the member. */
      { cost: ["Colorless"], name: "Marked Salvage Toss", damage: "30+", effect: PRINTED },
    ],
  }),
  /** The defender — 400 HP, no W/R. */
  [WALL]: battler(WALL, { name: "D525 Wall", types: ["Colorless"], hp: 400 }),
  /** The Weak defender — 400 HP, Weak ×2 to the attacker's Colorless: the base is W/R-scaled as any
      flat base is; the member itself neither drops nor scales it. */
  "d525-weakwall": battler("d525-weakwall", {
    name: "D525 Weak Wall",
    types: ["Colorless"],
    hp: 400,
    weaknesses: [{ type: "Colorless", value: "×2" }],
  }),
};

const RETRIEVAL_POOL: Record<string, Card> = { ...FIXTURE_POOL, ...RETRIEVAL_CARDS };

/** Its own deck (D270), 60 counted before the first run: 12 + 12 + 8 + 28. */
const RETRIEVAL_DECK = deckOf({
  "d525-forager": 12,
  [WALL]: 12,
  "d525-weakwall": 8,
  [PLAIN]: 28,
});

/** The opening shuffle only — the three flips are driven off a SURGERED `rngState` (below), so the
    seed never decides a face. Stated (D523 (8)). */
const SEED = 11;

function openTable(seed: number, first: Seat): GameState {
  const created = createGame({
    seed,
    decks: { p1: RETRIEVAL_DECK, p2: RETRIEVAL_DECK },
    cardPool: RETRIEVAL_POOL,
  });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let table = created.state;
  if (table.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  table = must(applyAction(table, { type: "chooseFirstPlayer", seat: table.phase.coinWinner, first }));
  while (table.phase.kind === "setup:drawExtra") {
    const drawing = table.phase;
    const owing = (["p1", "p2"] as const).find((s) => !drawing.decided[s]);
    if (owing === undefined) throw new Error("setup:drawExtra with every seat decided");
    table = must(applyAction(table, { type: "setupDrawExtra", seat: owing, count: drawing.owed[owing] }));
  }
  for (const seat of ["p1", "p2"] as const) {
    table = must(applyAction(table, { type: "setupPlaceActive", seat, uid: firstBasicInHand(table, seat) }));
  }
  for (const seat of ["p1", "p2"] as const) {
    table = must(applyAction(table, { type: "setupReady", seat }));
  }
  return table;
}

/** `perTailsSelfDiscard.test.ts`'s idiom: the smallest `rngState` whose next `faces.length` draws are
    exactly `faces`, in order. Derived from `flipCoin`, never hardcoded. */
function rngForFaces(faces: readonly CoinFace[]): number {
  for (let candidate = 1; candidate < 200_000; candidate += 1) {
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

const HHH: readonly CoinFace[] = ["heads", "heads", "heads"];
const HTT: readonly CoinFace[] = ["heads", "tails", "tails"];
const HHT: readonly CoinFace[] = ["heads", "heads", "tails"];
const TTT: readonly CoinFace[] = ["tails", "tails", "tails"];

/** The default pile: 2 Colorless Basic + 2 walls — two KINDS so a pick is a choice among names, and
    FOUR candidates so no board reaches `parkOrForce`'s one-candidate auto-resolve (D416). */
const DEFAULT_PILE: Record<string, number> = { [PLAIN]: 2, [WALL]: 2 };

type Board = {
  /** The three faces, in flip order. */
  readonly faces: readonly CoinFace[];
  /** P1's discard pile, seeded from the deck (`opRecord.test.ts`'s `withDiscard` idiom over
      `discardFromDeck`). Default 2 + 2; `{}` is the empty pile. */
  readonly pile?: Record<string, number>;
  /** The Weak defender instead of the plain wall. */
  readonly weak?: boolean;
};

/** p1 owns TURN 2 with the attacker Active holding ONE Colorless Basic (the {C} cost); P2 went first.
    P1's discard is `pile`; the rng is surgered so the attack's three flips draw `faces`. */
function table(board: Board): GameState {
  let state = openTable(SEED, "p2");
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  if (state.turn !== 2) throw new Error(`expected turn 2, got ${String(state.turn)}`);
  state = setActiveFromDeck(state, "p1", "d525-forager");
  state = setActiveFromDeck(state, "p2", board.weak === true ? "d525-weakwall" : WALL);
  state = clearBench(state, "p1");
  state = clearBench(state, "p2");
  if (state.players.p1.discard.length !== 0) {
    throw new Error(`P1's discard is not empty before seeding: ${state.players.p1.discard.length}`);
  }
  for (const [id, count] of Object.entries(board.pile ?? DEFAULT_PILE)) {
    state = discardFromDeck(state, "p1", id, count);
  }
  state = attachFromDeck(state, "p1", PLAIN, 1);
  return { ...state, rngState: rngForFaces(board.faces) };
}

type Swing = { before: GameState; after: GameState; events: GameEvent[] };

function swing(board: Board, index = 0): Swing {
  const before = table(board);
  const { state: after, events } = mustApply(before, { type: "attack", seat: "p1", index });
  return { before, after, events };
}

function cardsPrompt(state: GameState) {
  if (state.phase.kind !== "effect:choose") throw new Error(`expected a park, got ${state.phase.kind}`);
  if (state.phase.prompt.kind !== "chooseCards") {
    throw new Error(`expected chooseCards, got ${state.phase.prompt.kind}`);
  }
  return state.phase.prompt;
}

/** `opRecord.test.ts`'s idiom: answer the parked chooseCards. */
const pick = (state: GameState, uids: readonly string[]) =>
  mustApply(state, { type: "resolveEffect", seat: "p1", choice: { kind: "cards", uids: [...uids] } });

const NAMES = { p1: "P1", p2: "P2" } as const;
const rows = (events: readonly GameEvent[], state: GameState): string[] =>
  logFromEvents(events, { names: NAMES, state, elapsed: "+00:09" }).map((entry) =>
    entry.kind === "turn" ? `— turn ${entry.turn} —` : entry.segments.map((s) => s.text).join(""),
  );

function retrievedRows(events: readonly GameEvent[]) {
  return events.filter(
    (e): e is Extract<GameEvent, { type: "DISCARD_RETRIEVED" }> => e.type === "DISCARD_RETRIEVED",
  );
}
function dealtRows(events: readonly GameEvent[]) {
  return events.filter((e): e is Extract<GameEvent, { type: "DAMAGE_DEALT" }> => e.type === "DAMAGE_DEALT");
}
function flipRows(events: readonly GameEvent[]) {
  return events.filter(
    (e): e is Extract<GameEvent, { type: "ATTACK_EFFECT_COIN_FLIP" }> => e.type === "ATTACK_EFFECT_COIN_FLIP",
  );
}
function skippedRows(events: readonly GameEvent[]) {
  return events.filter(
    (e): e is Extract<GameEvent, { type: "ATTACK_EFFECT_SKIPPED" }> => e.type === "ATTACK_EFFECT_SKIPPED",
  );
}
/** `rngState` after exactly `n` `flipCoin` steps from `from`. */
function stepped(from: number, n: number): number {
  let rng = from;
  for (let i = 0; i < n; i += 1) rng = flipCoin(rng)[1];
  return rng;
}

// ─────────────────────────────────────────────────────────────────────────────
// §1 — derivation: the exact reading, the captured count, both anchor ends, the one-token
// near-misses, the attach twin as the control, the only claimant, the census identity.
// ─────────────────────────────────────────────────────────────────────────────

describe("D525 §1 — the printed row derives to EXACTLY the seventh member: printed 3, anyCard, hand", () => {
  it("🛑 file line 219 derives to the reading — kind, `flips: printed 3`, `filter: anyCard`, `dest: hand`, and NOTHING else (`D525-arm-filter-copies-the-neighbour` / `-arm-dest-copies-d523`)", () => {
    expect(deriveAttackCoinFlip(PRINTED)).toEqual(READING);
    const got = deriveAttackCoinFlip(PRINTED);
    if (got === null) throw new Error("the row derived null");
    expect(Object.keys(got).sort()).toEqual(["dest", "filter", "flips", "kind"]);
    expect(got.kind).toBe("retrievalUpToHeads");
    // No `ops`, no `max`, no `per`, no `face`: the member carries the op's payload MINUS the count.
    expect("ops" in got).toBe(false);
    expect("max" in got).toBe(false);
    expect("per" in got).toBe(false);
  });

  it("🛑 the count is CAPTURED, not pinned — 2, 4 and 10 derive at 2, 4 and 10; `Flip 1 coins.` and `Flip 11 coins.` derive null (`D525-anchor-guard-admits-one-flip` / `-anchor-guard-loses-the-ceiling`)", () => {
    expect(deriveAttackCoinFlip(at(2))).toEqual(reading(2));
    expect(deriveAttackCoinFlip(at(4))).toEqual(reading(4));
    expect(deriveAttackCoinFlip(at(10))).toEqual(reading(10));
    // The family's guards: "coins" is plural (the one-flip form is "Flip a coin."), and the digits are
    // third-party text bounded by MAX_PRINTED_FLIPS = 10.
    expect(deriveAttackCoinFlip(at(1))).toBeNull();
    expect(deriveAttackCoinFlip(at(0))).toBeNull();
    expect(deriveAttackCoinFlip(at(11))).toBeNull();
    for (const s of [at(1), at(0), at(11)]) expect(resolvedByAnyReader(s), s).toBe(false);
    for (const s of [at(2), at(4), at(10), at(1), at(0), at(11)]) {
      expect(legalAttackCorpus().some(([, t]) => t === s), s).toBe(false);
    }
  });

  it("🛑 the anchor is WHOLE-SENTENCE at BOTH ends — a prefixed print and a suffixed print each derive null on every reader (D520 (3); `D525-anchor-loses-the-head` / `-tail`)", () => {
    const prefixed = `Draw a card. ${PRINTED}`;
    const suffixed = `${PRINTED} Draw a card.`;
    expect(legalAttackCorpus().some(([, s]) => s === prefixed || s === suffixed)).toBe(false);
    expect(deriveAttackCoinFlip(prefixed)).toBeNull();
    expect(deriveAttackCoinFlip(suffixed)).toBeNull();
    expect(resolvedByAnyReader(prefixed)).toBe(false);
    expect(resolvedByAnyReader(suffixed)).toBe(false);
  });

  it("🛑 one-token near-misses, all null on EVERY reader — the repeat spelling, the deck, `Attach`, `coin`, `Energy cards`, the opponent's pile", () => {
    const controls: Record<string, string> = {
      "`For each heads,` — the REPEAT reading this slice rejected (a `programPerHeads` over a parking op)":
        REPEAT,
      "`into your deck` for `into your hand` — the destination is a literal (D523's twin shuffles a printed count)":
        "Flip 3 coins. Put a number of cards up to the number of heads from your discard pile into your deck.",
      "`Attach` for `Put` — the verb is a literal (the attach twin is a different op)":
        "Flip 3 coins. Attach a number of cards up to the number of heads from your discard pile into your hand.",
      "`coin` for `coins` — the plural is the family's own guard":
        "Flip 3 coin. Put a number of cards up to the number of heads from your discard pile into your hand.",
      "`Energy cards` for `cards` — the noun is FIXED in the anchor, not captured":
        "Flip 3 coins. Put a number of Energy cards up to the number of heads from your discard pile into your hand.",
      "`your opponent's discard pile` for `your discard pile` — the zone's owner is a literal":
        "Flip 3 coins. Put a number of cards up to the number of heads from your opponent's discard pile into your hand.",
    };
    for (const [why, s] of Object.entries(controls)) {
      expect(s, why).not.toBe(PRINTED);
      expect(deriveAttackCoinFlip(s), why).toBeNull();
      expect(resolvedByAnyReader(s), why).toBe(false);
      expect(legalAttackCorpus().some(([, t]) => t === s), why).toBe(false);
    }
  });

  it("🛑 THE CONTROL, INVERTED AT D528: the attach twin (corpus FILE LINE 215, 1 printing, `attachEnergyFrom`) now DERIVES on this reader — as `programPerHeads` over ONE copy of D358's op, NOT as `retrievalUpToHeads` — twelve readers and four splitters still null on it, and BOTH ceilings derive", () => {
    expect(legalAttackCorpus().filter(([, s]) => s === ATTACH_TWIN)).toEqual([[1, ATTACH_TWIN]]);
    // 🆕🆕🆕 D528 — was `toBeNull()` on every reader and `resolvedByAnyReader` false (the twin was the
    // suite's control from D525 to D527). What the old claim caught — THIS anchor does not span the
    // attach verb, and the retrieval member is not the twin's — is kept below as the member's kind.
    for (const reader of READERS) {
      if (reader === deriveAttackCoinFlip) continue;
      expect(reader(ATTACH_TWIN), reader.name).toBeNull();
    }
    for (const splitter of SPLITTERS) expect(splitter(ATTACH_TWIN), splitter.name).toBeNull();
    const twin = deriveAttackCoinFlip(ATTACH_TWIN);
    expect(twin).not.toBeNull();
    expect(twin?.kind).toBe("programPerHeads");
    expect(twin?.kind).not.toBe("retrievalUpToHeads");
    if (twin?.kind !== "programPerHeads") throw new Error("the twin is not programPerHeads");
    expect(twin.flips).toEqual({ kind: "printed", count: 3 });
    expect(twin.face).toBe("heads");
    expect(twin.ops).toEqual([
      { op: "attachEnergyFrom", source: "discard", energyType: "Lightning", benchOnly: true, declinable: true },
    ]);
    expect(resolvedByAnyReader(ATTACH_TWIN)).toBe(true);
    // …and the two "up to the number of heads" ceilings in the column are exactly these two rows,
    // BOTH of which now derive on this reader — on DIFFERENT members (`perHeadsConsequent.test.ts`'s
    // ceilings rung, read from this side).
    const ceilings = legalAttackCorpus().filter(([, s]) => s.includes("up to the number of heads"));
    expect(ceilings.map(([, s]) => s).sort()).toEqual([ATTACH_TWIN, PRINTED].sort());
    expect(ceilings.filter(([, s]) => deriveAttackCoinFlip(s) !== null).map(([, s]) => s).sort()).toEqual(
      [ATTACH_TWIN, PRINTED].sort(),
    );
    expect(ceilings.map(([, s]) => deriveAttackCoinFlip(s)?.kind).sort()).toEqual(["programPerHeads", "retrievalUpToHeads"]);
    // The retrieval member is on EXACTLY the retrieval row — the twin never reaches it.
    expect(legalAttackCorpus().filter(([, s]) => deriveAttackCoinFlip(s)?.kind === "retrievalUpToHeads")).toEqual([[2, PRINTED]]);
  });

  it("🛑 `deriveAttackCoinFlip` is the ONLY claimant — twelve readers and four splitters are null — and the reader surface is still THIRTEEN", () => {
    for (const reader of READERS) {
      if (reader === deriveAttackCoinFlip) continue;
      expect(reader(PRINTED), reader.name).toBeNull();
    }
    for (const splitter of SPLITTERS) expect(splitter(PRINTED), splitter.name).toBeNull();
    expect(deriveAttackCoinFlip(PRINTED)).not.toBeNull();
    expect(attackReaderSurface()).toHaveLength(14 /* 🆕🆕🆕 D573: 13 → 14, + deriveAttackCopy */);
    expect(attackReaderSurface()).toContain("deriveAttackCoinFlip");
    expect(READERS.map((read) => read.name).sort()).toEqual(attackReaderSurface());
  });

  it("🛑 the sentence is the CORPUS's bytes at exactly TWO printings, at index 166, it is RESOLVED, and the raw file line IS 219", () => {
    const corpus = legalAttackCorpus();
    expect(corpus.filter(([, s]) => s === PRINTED)).toEqual([[2, PRINTED]]);
    expect(corpus.findIndex(([, s]) => s === PRINTED)).toBe(166);
    expect(resolvedByAnyReader(PRINTED)).toBe(true);
    const raw = Object.entries(RAW).find(([k]) => k.endsWith("/censusAttackCorpus.ts"))?.[1] ?? "";
    expect(raw.split("\n")[218]).toBe(`2 ${PRINTED}`);
    expect(raw.split("\n")[214]).toBe(`1 ${ATTACH_TWIN}`);
    // The apostrophe-free sentence: no `['’]` slot exists for the anchor to class (D136/D137).
    expect(PRINTED).not.toContain("'");
    expect(PRINTED).not.toContain("’");
  });

  it("🛑 the anchor's claimed set over all 640 rows is EXACTLY {file line 219} — 1 sentence / 2 printings — and the member appears on exactly that row", () => {
    const [n, u, claimed] = claims(
      /^Flip (\d+) coins\. Put a number of cards up to the number of heads from your discard pile into your hand\.$/,
    );
    expect([n, u]).toEqual([1, 2]);
    expect(claimed).toEqual([PRINTED]);
    expect(legalAttackCorpus()).toHaveLength(640);
    const members = legalAttackCorpus().filter(([, s]) => deriveAttackCoinFlip(s)?.kind === "retrievalUpToHeads");
    expect(members).toEqual([[2, PRINTED]]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — the executor: the park at H, the pick, the singular caption, zero heads, the empty pile, the
// decline, the base beside the park, the rng, the replay, the redacted view, the control, Weakness,
// the marker.
// ─────────────────────────────────────────────────────────────────────────────

describe("D525 §2 — H heads park ONE `chooseCards{min 0, max H, dest hand}` over the public pile; zero heads and an empty pile park nothing", () => {
  it("🛑 the board is what it says: P1's attacker is Active with one Colorless Basic, P2's wall is Active, both benches empty, P1's pile is 2 + 2, turn 2", () => {
    const before = table({ faces: HHH });
    expect(before.players.p1.active?.energy).toHaveLength(1);
    expect(before.cardIdByUid[activeUid(before, "p1")]).toBe("d525-forager");
    expect(before.cardIdByUid[activeUid(before, "p2")]).toBe(WALL);
    expect(before.players.p1.bench).toHaveLength(0);
    expect(before.players.p2.bench).toHaveLength(0);
    expect(before.players.p1.discard).toHaveLength(4);
    expect(before.players.p1.discard.map((uid) => before.cardIdByUid[uid]).sort()).toEqual(
      [PLAIN, PLAIN, WALL, WALL].sort(),
    );
    expect(before.turn).toBe(2);
    expect(RETRIEVAL_CARDS["d525-forager"]?.attacks?.[0]?.effect).toBe(PRINTED);
    expect(RETRIEVAL_CARDS["d525-forager"]?.attacks?.[0]?.damage).toBe(BASE);
    expect(RETRIEVAL_CARDS["d525-forager"]?.attacks?.[1]?.effect).toBeUndefined();
  });

  it("🛑 (i) 3 heads → ONE park: `effect:choose` / `chooseCards { min 0, max 3, dest \"hand\" }`, the candidates are the WHOLE public pile in pile order, the note MEASURED, the base 30 ALREADY dealt (`DAMAGE_DEALT` precedes `EFFECT_PENDING`), the turn NOT ended (`D525-fold-max-is-the-flip-count` sees 3 here and 1 in (iv))", () => {
    const { before, after, events } = swing({ faces: HHH });
    expect(after.phase.kind).toBe("effect:choose");
    expect(after.phase.kind === "effect:choose" && after.phase.seat).toBe("p1");
    const prompt = cardsPrompt(after);
    expect(prompt.min).toBe(0);
    expect(prompt.max).toBe(3);
    expect(prompt.dest).toBe("hand");
    expect(prompt.candidates).toEqual(before.players.p1.discard);
    expect(prompt.candidates).toHaveLength(4);
    // MEASURED, not assumed: `retrieveNote(anyCard, "hand", 3, false)`.
    expect(prompt.note).toBe("Put up to 3 cards from your discard pile into your hand.");
    expect(flipRows(events).map((e) => e.result)).toEqual(HHH);
    // The base is dealt in FULL beside the park — the member keeps the printed base (`scaledBase`
    // has no term for it): DAMAGE_DEALT lands BEFORE the park opens.
    expect(dealtRows(events)).toHaveLength(1);
    expect(dealtRows(events)[0]).toMatchObject({ seat: "p2", by: "p1", uid: activeUid(before, "p2"), dealt: BASE });
    expect(after.players.p2.active?.damage).toBe(BASE);
    expect(types(events).indexOf("DAMAGE_DEALT")).toBeLessThan(types(events).indexOf("EFFECT_PENDING"));
    expect(types(events)).not.toContain("TURN_ENDED");
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(retrievedRows(events)).toHaveLength(0);
    // Nothing moved at the park.
    expect(after.players.p1.hand).toEqual(before.players.p1.hand);
    expect(after.players.p1.discard).toEqual(before.players.p1.discard);
    // The continuation holds the SHIPPED op with `max: 3` — the one place H lives.
    if (after.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(after.phase.cont.pendingOp).toEqual({
      op: "discardPileRetrieval",
      filter: { kind: "anyCard" },
      dest: "hand",
      max: 3,
    });
    expect(after.phase.cont.rest).toEqual([]);
  });

  it("🛑 (ii) pick 2 of the 3 → both uids to P1's HAND, the pile −2, `DISCARD_RETRIEVED { dest: \"hand\" }` with exactly those uids, the log row MEASURED, the turn ends (D491)", () => {
    const { after: parked } = swing({ faces: HHH });
    const offered = cardsPrompt(parked).candidates;
    const chosen = [offered[0], offered[2]].filter((u): u is string => u !== undefined);
    expect(chosen).toHaveLength(2);
    const { state, events } = pick(parked, chosen);
    expect(state.players.p1.hand).toHaveLength(parked.players.p1.hand.length + 2);
    for (const uid of chosen) expect(state.players.p1.hand).toContain(uid);
    expect(state.players.p1.discard).toHaveLength(2);
    for (const uid of chosen) expect(state.players.p1.discard).not.toContain(uid);
    const retrieved = retrievedRows(events);
    expect(retrieved).toHaveLength(1);
    expect(retrieved[0]).toMatchObject({ seat: "p1", dest: "hand" });
    expect([...(retrieved[0]?.uids ?? [])].sort()).toEqual([...chosen].sort());
    expect(dealtRows(events)).toHaveLength(0); // the base was dealt BEFORE the park, not again
    expect(state.players.p2.active?.damage).toBe(BASE);
    expect(types(events)).toContain("TURN_ENDED");
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(state.phase).toEqual({ kind: "turn:action", seat: "p2" });
    expect(state.turn).toBe(3);
    // MEASURED: `log.ts`'s DISCARD_RETRIEVED row for the hand destination.
    const lines = rows(events, state);
    expect(lines).toContain("took 2 cards from their discard pile");
    expect(lines).toContain("ended their turn");
  });

  it("🛑 (iii) pick all 3 → the hand +3, one card left in the pile; the pick names a wall and an Energy alike (`anyCard`, not `anyEnergy` — `D525-arm-filter-copies-the-neighbour`)", () => {
    const { after: parked } = swing({ faces: HHH });
    const offered = cardsPrompt(parked).candidates;
    const walls = offered.filter((uid) => parked.cardIdByUid[uid] === WALL);
    const energies = offered.filter((uid) => parked.cardIdByUid[uid] === PLAIN);
    expect(walls).toHaveLength(2);
    expect(energies).toHaveLength(2);
    const chosen = [...walls, ...energies.slice(0, 1)];
    const { state, events } = pick(parked, chosen);
    expect(state.players.p1.hand).toHaveLength(parked.players.p1.hand.length + 3);
    expect(state.players.p1.discard).toHaveLength(1);
    expect(retrievedRows(events)[0]?.uids).toHaveLength(3);
    expect(rows(events, state)).toContain("took 3 cards from their discard pile");
  });

  it("🛑 (iv) 1 head → `max 1`, the SINGULAR caption MEASURED, the pick moves ONE card and the row reads \"took 1 card\"", () => {
    const { after, events } = swing({ faces: HTT });
    expect(flipRows(events).map((e) => e.result)).toEqual(HTT);
    const prompt = cardsPrompt(after);
    expect(prompt.max).toBe(1);
    expect(prompt.min).toBe(0);
    expect(prompt.candidates).toHaveLength(4);
    // MEASURED, not assumed: `retrieveNoun(anyCard).singular` is "a card".
    expect(prompt.note).toBe("Put a card from your discard pile into your hand.");
    const [only] = prompt.candidates;
    if (only === undefined) throw new Error("no candidate");
    const { state, events: resumed } = pick(after, [only]);
    expect(state.players.p1.hand).toHaveLength(after.players.p1.hand.length + 1);
    expect(state.players.p1.hand).toContain(only);
    expect(retrievedRows(resumed).map((e) => e.uids)).toEqual([[only]]);
    expect(rows(resumed, state)).toContain("took 1 card from their discard pile");
    expect(state.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("🛑 (v) 2 heads → `max 2`; picking ONE (under the ceiling) is legal — `min 0` is the printed \"up to\"", () => {
    const { after } = swing({ faces: HHT });
    const prompt = cardsPrompt(after);
    expect(prompt.max).toBe(2);
    expect(prompt.note).toBe("Put up to 2 cards from your discard pile into your hand.");
    const [only] = prompt.candidates;
    if (only === undefined) throw new Error("no candidate");
    const { state } = pick(after, [only]);
    expect(state.players.p1.hand).toHaveLength(after.players.p1.hand.length + 1);
    expect(state.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("🛑 (vi) 0 heads → NO park: three tails rows, the base 30 dealt, the hand and pile UNCHANGED, the turn ends, no `ATTACK_EFFECT_SKIPPED` (`D525-fold-appends-a-zero-max-op` asks whether this ending is observable)", () => {
    const { before, after, events } = swing({ faces: TTT });
    expect(flipRows(events).map((e) => e.result)).toEqual(TTT);
    expect(after.phase.kind).not.toBe("effect:choose");
    expect(after.phase).toEqual({ kind: "turn:action", seat: "p2" });
    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(retrievedRows(events)).toHaveLength(0);
    expect(dealtRows(events)).toHaveLength(1);
    expect(after.players.p2.active?.damage).toBe(BASE);
    expect(after.players.p1.hand).toEqual(before.players.p1.hand);
    expect(after.players.p1.discard).toEqual(before.players.p1.discard);
    expect(types(events)).toContain("TURN_ENDED");
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(types(events)).toEqual([
      "ATTACK_DECLARED",
      "ATTACK_EFFECT_COIN_FLIP",
      "ATTACK_EFFECT_COIN_FLIP",
      "ATTACK_EFFECT_COIN_FLIP",
      "DAMAGE_DEALT",
      "TURN_ENDED",
      "TURN_STARTED",
      "CARDS_DRAWN",
    ]);
  });

  it("🛑 (vii) 2 heads over an EMPTY pile → NO park (the interpreter's whiff is `done`), the base dealt, the turn ends", () => {
    const { before, after, events } = swing({ faces: HHT, pile: {} });
    expect(before.players.p1.discard).toHaveLength(0);
    expect(flipRows(events).map((e) => e.result)).toEqual(HHT);
    expect(after.phase).toEqual({ kind: "turn:action", seat: "p2" });
    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(retrievedRows(events)).toHaveLength(0);
    expect(after.players.p2.active?.damage).toBe(BASE);
    expect(after.players.p1.hand).toEqual(before.players.p1.hand);
    expect(types(events)).toContain("TURN_ENDED");
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("🛑 (viii) DECLINE (choose []) → nothing moves, no `DISCARD_RETRIEVED`, the base stands at 30, the turn ends", () => {
    const { after: parked } = swing({ faces: HHH });
    const { state, events } = pick(parked, []);
    expect(state.players.p1.hand).toEqual(parked.players.p1.hand);
    expect(state.players.p1.discard).toEqual(parked.players.p1.discard);
    expect(retrievedRows(events)).toHaveLength(0);
    expect(dealtRows(events)).toHaveLength(0);
    expect(state.players.p2.active?.damage).toBe(BASE);
    expect(types(events)).toContain("TURN_ENDED");
    expect(state.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("🛑 (ix) `rngState` advances EXACTLY three `flipCoin` steps and the log carries ONE `ATTACK_EFFECT_COIN_FLIP` row per coin, on every face pattern (`D525-printed-flips-reads-one-flip`)", () => {
    for (const faces of [HHH, HTT, HHT, TTT]) {
      const { before, after, events } = swing({ faces });
      expect(after.rngState, faces.join("-")).toBe(stepped(before.rngState, 3));
      expect(after.rngState, faces.join("-")).not.toBe(stepped(before.rngState, 1));
      expect(after.rngState, faces.join("-")).not.toBe(before.rngState);
      expect(flipRows(events), faces.join("-")).toHaveLength(3);
      expect(flipRows(events).map((e) => e.result), faces.join("-")).toEqual(faces);
      for (const row of flipRows(events)) expect(row.seat).toBe("p1");
    }
  });

  it("🛑 (x) replays identically from one `rngState` — the same parked board and the same events twice", () => {
    const a = swing({ faces: HHT });
    const b = swing({ faces: HHT });
    expect(b.before.rngState).toBe(a.before.rngState);
    expect(b.after).toEqual(a.after);
    expect(b.events).toEqual(a.events);
  });

  it("🛑 (xi) the OPPONENT's redacted view: the prompt is NOT theirs (`prompt: null`) but `board.opponent.discard` names every candidate — the pile is public; P1's own view carries the prompt with the four names", () => {
    const { after: parked } = swing({ faces: HHH });
    const theirs = redactGame(parked, "p2");
    expect(theirs.phase).toEqual({ kind: "effect:choose", prompt: null });
    expect(theirs.board.opponent.discard.map((c) => c.name).sort()).toEqual(
      [PLAIN, PLAIN, "D525 Wall", "D525 Wall"].sort(),
    );
    const mine = redactGame(parked, "p1");
    if (mine.phase.kind !== "effect:choose" || mine.phase.prompt?.kind !== "chooseCards") {
      throw new Error("P1's view does not carry the chooseCards prompt");
    }
    expect(mine.phase.prompt.candidates.map((c) => c.name).sort()).toEqual(
      [PLAIN, PLAIN, "D525 Wall", "D525 Wall"].sort(),
    );
    expect(mine.phase.prompt.max).toBe(3);
    expect(mine.board.you.discard).toHaveLength(4);
  });

  it("🛑 (xii) the index-1 control: no flip, no park, no `DISCARD_RETRIEVED`, 30 dealt, `rngState` UNMOVED, the turn ends", () => {
    const { before, after, events } = swing({ faces: HHH }, 1);
    expect(flipRows(events)).toHaveLength(0);
    expect(after.rngState).toBe(before.rngState);
    expect(after.phase).toEqual({ kind: "turn:action", seat: "p2" });
    expect(retrievedRows(events)).toHaveLength(0);
    expect(after.players.p2.active?.damage).toBe(BASE);
    expect(after.players.p1.hand).toEqual(before.players.p1.hand);
    expect(after.players.p1.discard).toEqual(before.players.p1.discard);
  });

  it("🛑 (xiii) a Weak defender pays 60 — the base is UNSCALED by the member (no `scaledBase` term: the printed 30 is dealt, then W/R) — and the park still opens at `max 3`", () => {
    const { after, events } = swing({ faces: HHH, weak: true });
    expect(after.cardIdByUid[activeUid(after, "p2")]).toBe("d525-weakwall");
    expect(dealtRows(events)[0]?.dealt).toBe(BASE * 2);
    expect(after.players.p2.active?.damage).toBe(BASE * 2);
    expect(cardsPrompt(after).max).toBe(3);
  });

  it("🛑 (xiv) the DECLARED \"30+\" print at index 2: the member explains NO printed marker, so the loud `ATTACK_EFFECT_SKIPPED { damageModifier: \"+\" }` row SURVIVES the member while the effect text itself is simulated (`effect: null`) — and the park still opens (`D525-modifier-claimed-by-the-member`)", () => {
    const { after, events } = swing({ faces: HHH }, 2);
    const skipped = skippedRows(events);
    expect(skipped).toHaveLength(1);
    expect(skipped[0]).toMatchObject({ seat: "p1", attack: "Marked Salvage Toss", damageModifier: "+", effect: null });
    expect(cardsPrompt(after).max).toBe(3);
    expect(after.players.p2.active?.damage).toBe(BASE);
    // The control: the unmarked print at index 0 emits NO skip row on the same board.
    expect(skippedRows(swing({ faces: HHH }, 0).events)).toHaveLength(0);
  });

  it("🛑 the park is the program's ONLY park on every board — after the pick the phase is `turn:action` for P2, never `effect:choose` again", () => {
    for (const faces of [HHH, HTT, HHT]) {
      const { after } = swing({ faces });
      const [only] = cardsPrompt(after).candidates;
      if (only === undefined) throw new Error("no candidate");
      const { state } = pick(after, [only]);
      expect(state.phase, faces.join("-")).toEqual({ kind: "turn:action", seat: "p2" });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — the census figures, with their units.
// ─────────────────────────────────────────────────────────────────────────────

describe("D525 §3 — the census moved in exactly ONE summand, by 1 sentence / 2 printings", () => {
  it("🛑 the reader arm reads 552 sentences / 1,594 printings, and the row is IN it", () => {
    // 🆕🆕🆕 D525's OWN literals, annotated in-slice so the next sweep sees them (D523 (4)/D524 (4)):
    // the reader arm 551/1592 → 552/1594, the `without` pair 550/1591 → 551/1592 — corpus FILE LINE
    // 219, ⚠️ sentence step 1 / PRINTING STEP 2 (two legal printings — the two chains step by
    // DIFFERENT amounts, D431/D419).
    const resolved = legalAttackCorpus().filter(([, s]) => resolvedByAnyReader(s));
    // 🆕🆕🆕 D526 +1 sentence / +1 printing (THE THREE-TIER HEADS LADDER — corpus FILE LINE 218, *"Flip 3 coins. If 1 of them is heads, this attack does 20 more damage. If 2 of them are heads, this attack does 50 more damage. If all of them are heads, this attack does 80 more damage."*,
    // 1 legal printing, claimed by `deriveAttackCoinFlip` as the eighth member `bonusLadder`, spent at `attack.ts`'s existing damage fold as an
    // exclusive three-tier table, ZERO new vocabulary; the sentence and printing steps AGREE at 1): 552/1594 → 553/1595, and the own-row
    // `without` pair re-derived BY HAND as resolved minus this suite's row (D525 (5)). Stepped by hand again (outside the annotated-chain sweep's shape).
    // 🆕🆕🆕 D527 +1 sentence / +1 printing (THE DYNAMIC-max HAND SEARCH — corpus FILE LINE 454, *"Search your deck for a number of cards up to the number of your Benched Pokémon and put them into your hand. Then, shuffle your deck."*,
    // 1 legal printing, claimed by `deriveAttackEffect` through `ATTACK_HAND_SEARCH_BENCH_COUNT` as the sibling's two-op shape with `max: "yourBenchCount"`, resolved at the park against the
    // attacker's Bench at step time, ZERO new vocabulary, one persisted-field widening with `MATCH_RECORD_VERSION` HELD at 30; the sentence and printing steps AGREE at 1): 553/1595 → 554/1596, and the own-row
    // `without` pair re-derived BY HAND as resolved minus this suite's row (D525 (5)). Stepped by hand again (outside the annotated-chain sweep's shape).
    // 🆕🆕🆕 **D530 +1 sentence / +1 printing — THE TARGET-COUNTER-SCALED BENCH SNIPE — A FOURTH `damageChosen` RIDER, `perDamageCounterOnTarget`, READ PER REF AT THE ANSWER** — `censusAttackCorpus.ts` **FILE LINE 551** (`legalAttackCorpus()` index 498), *"This attack does 20 damage to 1 of your opponent's Benched Pokémon for each damage counter on that Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)"*, **1 sentence / 1 legal printing** (no id on this checkout, D425), claimed by `deriveAttackEffect` through ONE new anchor (`BENCHED_SNIPE_TARGET_COUNTERS`, beside `BENCHED_SNIPE_TAKEN_PRIZES`, disjoint by TAIL) as arm 6b′ — a READER move: reader arm 555/1597 → 556/1598, raw residue 85/135 → 84/134; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.415.0 → 0.416.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1.
    // 🆕🆕🆕 D528 +1 sentence / +1 printing (THE HEADS-CEILINGED DISCARD-TO-BENCH ENERGY ATTACH — THE ATTACH TWIN OF D525, ZERO VOCABULARY, NO NEW `AttackCoinFlip` MEMBER — corpus FILE LINE 215, *"Flip 3 coins. Attach a number of Basic {L} Energy cards up to the number of heads from your discard pile to your Benched Pokémon in any way you like."*, 1 legal printing, claimed by `deriveAttackCoinFlip` as `programPerHeads` over ONE copy of D358's discard-spread op, H declinable parks at the existing fold, ZERO new vocabulary, no fold/interpreter bytes; the sentence and printing steps AGREE at 1): 554/1596 → 555/1597. Stepped by hand (outside the annotated-chain sweep's shape).
    expect([resolved.length, units(resolved)]).toEqual([600, 1663]);  // (🆕🆕🆕 **D579 +1 sentence / +1 printing — THE CENSUS CLOSE-OUT** — Koraidon `sv08-116` "Unrelenting Onslaught", claimed WHOLE by `deriveAttackDamageBonus` through one `CONDITIONAL_DAMAGE_CLAUSES` literal; Walking Wake `sv06-063` is a REGISTRY row and moves no reader figure.) (🆕🆕🆕 **D575 +6 sentences / +6 printings — THE MRV-38 ATTACK SLICE** — `deriveAttackEffect`'s six new whole-sentence anchors claim `censusAttackCorpus.ts` file lines 177 (Hypno "Daydream"), 181 (Miraidon "C.O.D.E.: Protect"), 182 (Iron Moth "Anachronism Repulsor"), 346 (N's Sigilyph "Victory Symbol"), 394 (Team Rocket's Blipbug "Searching Eyes") and 690 (Glimmora "Corrosive Shards", the compound claimed WHOLE) — one printing each, so the sentence and printing steps AGREE. A READER move.) (🆕🆕🆕 **D574 +3 sentences / +5 printings — THE COPY-FAMILY REMAINDER + SABLEYE** — `deriveAttackCopy`'s two RESOLVE-TIME anchors claim `censusAttackCorpus.ts` file lines 434 and 131 WHOLE (Haughty Order ×3, Seek Inspiration) and `deriveAttackEffect`'s new anchor claims file line 649 (Sableye "Damage Collection"). Alakazam (686) composes through the TRAILING seam and Malamar (489) is a REGISTRY row — neither is a reader move. A READER move; the sentence step (3) and the printing step (5) DISAGREE, so each site was classified by its unit.) (🆕🆕🆕 **D573 +4 sentences / +9 printings — THE COPY-ATTACK SUBSTITUTION** — `deriveAttackCopy`, the FOURTEENTH reader, claims `censusAttackCorpus.ts` file lines 77, 78, 80 and 245 WHOLE: Night Joker ×4, Foul Play ×2 + Metronome, Gemstone Mimicry, Try to Imitate. A READER move; the sentence step (4) and the printing step (9) DISAGREE, so each site was classified by its unit.) (🆕🆕🆕 **D569 +4 sentences / +6 printings — THE PARADOX BANNER READERS** — Koraidon `sv05-119`/`svp-091` "Primordial Beatdown" (`IN_PLAY_BODY_NOUNS` "Ancient Pokémon"), Roaring Moon `sv05-109`/`sv08.5-065` "Vengeance Fletching" (`DISCARD_PILE_NOUNS` "Ancient card"), Iron Valiant `sv05-080` "Majestic Sword" and Slither Wing `sv06.5-026` "Iron Smasher" (two literal `CONDITIONAL_DAMAGE_CLAUSES` rows), all over `banners.ts`' widened table (582/1636 → 586/1642)) (🆕🆕🆕 **D568 +2 sentences / +2 printings — THE TWO TERA CLAUSES, NOW THAT THE BANNER HAS A WRITER** — Ho-Oh `sv08-019` "Shining Blaze" (*"If you have any Tera Pokémon on your Bench, this attack does 100 more damage."*) and Regigigas `sv08.5-086` "Jewel Breaker" (*"If your opponent's Active Pokémon is a Tera Pokémon, this attack does 230 more damage."*), one legal printing each, two literal `CONDITIONAL_DAMAGE_CLAUSES` rows over `banners.ts` (580/1634 → 582/1636)) (🆕🆕🆕 **D552 +2 sentences / +2 printings — THE PRE-DAMAGE SELF ATTACH BEHIND A MULTIPLIER HEAD, AND THE WEAKNESS RETYPE** — `censusAttackCorpus.ts` **file lines 569 and 629** (leading count column `1` each; card ids UNRESOLVED on this checkout — measured, never invented, D425): `:569` claimed WHOLE by `deriveAttackDiscardScaledBoost`'s THIRD member `selfHandAttach` (attach-then-damage inside the program), `:629` by `deriveAttackEffect` through ONE new anchor `DEFENDER_WEAKNESS_RETYPED` as ONE new op `retypeDefenderWeakness` — a READER move: reader arm 578/1632 → 580/1634, raw residue 62/100 → 60/98, `BUILT.attack` 1688 → 1690; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.435.0 → 0.436.0, `MATCH_RECORD_VERSION` 33 → 34. ⚠️ THE SENTENCE STEP (2) AND THE PRINTING STEP (2) AGREE this slice — the case where a copied number is right BY ACCIDENT, so every site was classified by the quantity its D550 note names (D426/D451). THIS SITE: reader arm 578/1632 → 580/1634.)  // (🆕🆕🆕 **D550 +1 sentence / +1 printing — THE OPPONENT-FLIPPED PER-TAILS SNIPE ON THE OPPONENT'S BENCH COUNT** — `censusAttackCorpus.ts` **file line 669** (leading count column `1`; card id UNRESOLVED on this checkout — measured, never invented, D425), claimed WHOLE by `deriveAttackCoinFlip` (a NINTH member `opponentPerTails` over a NULLARY `AttackFlipCount.opponentBench`) AND by `deriveAttackDamageSuppression`'s THIRD compound arm off ONE anchor, `ATTACK_OPPONENT_BENCH_TAILS` — a READER move: reader arm 577/1631 → 578/1632, raw residue 63/101 → 62/100, `BUILT.attack` 1687 → 1688, PHRASE-24 1/1 → 0/0; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.434.0 → 0.435.0, `MATCH_RECORD_VERSION` HOLDS at 33. ⚠️ THE SENTENCE STEP (1) AND THE PRINTING STEP (1) AGREE this slice — the case where a copied number is right BY ACCIDENT, so every site was classified by the quantity its D549 note names (D426/D451). THIS SITE: reader arm 577/1631 → 578/1632.)  // (🆕🆕🆕 **D549 +4 sentences / +4 printings — THE DEFENDER'S NEXT-TURN MARKS AND THE SIDE-WIDE ATTACK LOCK** — `censusAttackCorpus.ts` **file lines 171, 149, 169 and 170** (leading count column `1` each; card ids UNRESOLVED on this checkout — measured, never invented, D425), claimed WHOLE by `deriveAttackEffect` alone through FOUR new anchors as THREE new ops (`taxDefender`, `bountyDefender`, `lockSideAttacks`) — a READER move: reader arm 573/1627 → 577/1631, raw residue 67/105 → 63/101, `BUILT.attack` 1683 → 1687; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.433.0 → 0.434.0, `MATCH_RECORD_VERSION` 32 → 33. ⚠️ THE SENTENCE STEP (4) AND THE PRINTING STEP (4) AGREE this slice — the case where a copied number is right BY ACCIDENT, so every site was classified by the quantity its D548 note names (D426/D451). THIS SITE: reader arm 573/1627 → 577/1631.)  // (🆕🆕🆕 **D548 +1 sentence / +2 printings — CRESCENT PURGE, THE FACE-UP PRIZE** — `censusAttackCorpus.ts` **file line 664**, Cresselia `sv06.5-021` "Crescent Purge", claimed WHOLE by `deriveAttackOptionalCostBoost`'s FIFTH cost row (`turnPrizeFaceUp` behind `yourFaceDownPrizeRemains`); engine 0.432.0 → 0.433.0, `MATCH_RECORD_VERSION` 31 → 32. ⚠️ THE SENTENCE STEP (1) AND THE PRINTING STEP (2) DIFFER. THIS SITE: reader arm 572/1625 → 573/1627.)  // (🆕🆕🆕 **D547 +2 sentences / +4 printings — THE FLIP-TO-ATTACK LOCK AND THE NEXT-TURN VULNERABILITY** — `censusAttackCorpus.ts` **file lines 176 and 150** (leading count column `2` each), *“During your opponent's next turn, if the Defending Pokémon tries to use an attack, your opponent flips a coin. If tails, that attack doesn't happen.”* (TWO sentences in ONE row) and *“During your next turn, the Defending Pokémon takes 50 more damage from attacks (after applying Weakness and Resistance).”*, **2 rows / 4 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so both suites ride file-local declared `d547-*` demonstrators), claimed WHOLE by `deriveAttackEffect` through TWO new anchors (`DEFENDER_FLIP_ATTACK_LOCK`, `DEFENDER_VULNERABLE_NEXT_TURN`) as TWO new ops (`flipLockAttack`, `exposeDefender`) on TWO new REQUIRED `InPlayPokemon` fields — a READER move: reader arm 570/1621 → 572/1625, raw residue 70/111 → 68/107, `BUILT.attack` 1677 → 1681; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.431.0 → 0.432.0, `MATCH_RECORD_VERSION` 30 → 31. ⚠️ **THE SENTENCE STEP (2) AND THE PRINTING STEP (4) DIFFER**, so no copied number is right by accident; every site was classified by the quantity its D546 note names (D426/D451). THIS SITE: reader arm 570/1621 → 572/1625.)  // (🆕🆕🆕 **D546 +2 sentences / +2 printings — THE ALL-ATTACKS NEXT-TURN BUFF** — `censusAttackCorpus.ts` **file lines 76 and 148** (leading count column `1` each), *“During your next turn, attacks used by this Pokémon do 120 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance).”* and the same sentence at 100 behind *“Both Active Pokémon are now Asleep.”*, **2 sentences / 2 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so the suite rides file-local declared `d546-*` demonstrators), claimed WHOLE by `deriveAttackEffect` through ONE new whole-sentence anchor (`SELF_EVERY_ATTACK_BOOST`, ONE `['’]` slot, an optional Sleep prefix) as `attack: null` on the SHIPPED `boostAttack` op — no new `EffectOp` member, no new `InPlayPokemon` field — a READER move: reader arm 568/1619 → 570/1621, raw residue 72/113 → 70/111, `BUILT.attack` 1675 → 1677; registry 10/16, gate 9/19, trailing 11/21, `SPLIT_ATTACK_UNITS` 19 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED (19 READ at `censusAtHead.test.ts:8169`); engine 0.430.0 → 0.431.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP ARE BOTH 2 — THE ONE SHAPE WHERE A COPIED NUMBER IS RIGHT BY ACCIDENT**, so every site was measured by the quantity it pins, not copied (D426/D451). THIS SITE: reader arm 568/1619 → 570/1621.)  // (🆕🆕🆕 **D544 +1 sentence / +2 printings — THE NAMED ATTACK'S BASE DAMAGE, OVERRIDDEN FOR ONE WINDOW** — `censusAttackCorpus.ts` **file line 166** (leading count column `2`), *“During your next turn, this Pokémon's Hyper Fang attack's base damage is 240.”*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so the suite rides the file-local declared demonstrator `d544-fang`), claimed WHOLE by `deriveAttackEffect` through ONE new whole-sentence anchor (`SELF_ATTACK_BASE_SET`, TWO `['’]` slots, name and number CAPTURED) as a `base: true` RIDER on the SHIPPED `boostAttack` op — no new `EffectOp` member, no new `InPlayPokemon` field — a READER move: reader arm 567/1617 → 568/1619, raw residue 73/115 → 72/113, `BUILT.attack` 1671 → 1673; registry 10/16, gate 7/17, trailing 11/21, `SPLIT_ATTACK_UNITS` 17 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED (17 READ at `censusAtHead.test.ts:8159` — the “14” in D543's annotation beside this one has been stale since D541 moved the constant); engine 0.428.0 → 0.429.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — THEY DISAGREE**, so no number may be copied from one kind of site into another (D426/D451). THIS SITE: reader arm 567/1617 → 568/1619.)  // (🆕🆕🆕 **D543 +1 sentence / +2 printings — THE CHOSEN POKÉMON TOOL DISCARD AT THE PROGRAM TAIL** — `censusAttackCorpus.ts` **file line 136** (leading count column `2`), *“Discard up to 2 Pokémon Tools from your opponent's Pokémon.”*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrator `d543-stripper`), claimed WHOLE by `deriveAttackEffect` through ONE new whole-sentence anchor (`ATTACK_DISCARD_TOOLS_UP_TO`, ONE `['’]` slot at index 48, count CAPTURED) as ONE new `EffectOp` member `discardTools{count}` parking on ONE new `EffectPrompt` kind — a READER move: reader arm 566/1615 → 567/1617, raw residue 74/117 → 73/115, `BUILT.attack` 1669 → 1671; registry 10/16, gate 7/17, trailing 11/21, `SPLIT_ATTACK_UNITS` 14 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED; engine 0.427.0 → 0.428.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — THEY DISAGREE**, so no number may be copied from one kind of site into another (D426/D451). THIS SITE: reader arm 566/1615 → 567/1617.)  // (🆕🆕🆕 **D542 +1 sentence / +1 printing — THE OPPONENT-CHOSEN HAND SHUFFLE** — `censusAttackCorpus.ts` **file line 665** (`legalAttackCorpus()` index 612, leading count column `1`), *“Your opponent chooses 3 cards from their hand and shuffles those cards into their deck.”*, **1 sentence / 1 legal printing**, claimed WHOLE by `deriveAttackEffect` through ONE new anchor and ONE new arm returning a COMPOSITION of two shipped ops — so it leaves through the RAW READER summand and the registry / gate-split / trailing-split summands all stand still. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1, WHICH IS THE ONE CASE WHERE A COPIED NUMBER IS RIGHT BY ACCIDENT — so THIS SITE WAS MEASURED rather than inherited from its neighbour** (D426/D451).)  (🆕🆕🆕 **D540 +1 sentence / +1 printing — THE DEVOLUTION WITH A PICK IN IT, AND THE `/[Dd]evolv/` FAMILY CLOSES** — `censusAttackCorpus.ts` **row 87** (`legalAttackCorpus()` index 34, leading count column `1`), *"Devolve 1 of your opponent's evolved Pokémon by putting the highest Stage Evolution card on it into your opponent's hand."*, **1 sentence / 1 legal printing** (no card id resolves on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrators `d540-*`), claimed by `deriveAttackEffect` through ONE new anchor `DEVOLVE_CHOSEN_TO_HAND` and arm 41-ter into ONE new FIELD-FREE `EffectOp` member `devolveChosen` — a READER move: reader arm 564/1613 → 565/1614, raw residue 76/119 → 75/118, `BUILT.attack` 1664 → 1665, residue 49/68 → 48/67; registry 10/16, gate 6/14, trailing 11/21, `SPLIT_ATTACK_UNITS` 14, `COMPOUND_ATTACK_UNITS` 21 and `attackReaderSurface()` 13 UNMOVED; engine 0.424.0 → 0.425.0, `MATCH_RECORD_VERSION` HELD at 30 (D125's widening at a persisted address — and this op DOES park, so a record really can hold it, which is why the version claim rests on the widening and not on parking). ⚠️ THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 1 — they AGREE for the first time in six slices, which is the one case where a copied number would be right by accident, so every site was measured.)  // (🆕🆕🆕 **D539 +1 sentence / +2 printings — THE NAMED-BODY MULTIPLIER WITH A NAMED-BODY OWN-SIDE SPREAD BEHIND IT** — `censusAttackCorpus.ts` **FILE LINE 595** (`legalAttackCorpus()` index 542), *"This attack does 50 damage for each of your Drifloon and Drifblim in play. This attack also does 30 damage to each of your Drifloon and Drifblim. (Don't apply Weakness and Resistance for Benched Pokémon.)"*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrators `d539-*`), claimed by TWO readers off ONE `effect` string through ONE new whole-compound anchor carrying a `\2` BACKREFERENCE (`NAMED_BODIES_MULTIPLY_SPREAD`) — `deriveAttackDamageMultiplier` for the × fold and `deriveAttackEffect` for `damageChosen` with the FOURTH `target` member `yourAny` and `count: "all"`, plus the NINTH `IN_PLAY_BODY_NOUNS` exact key — a READER move: reader arm 563/1611 → 564/1613, raw residue 77/121 → 76/119, `BUILT.attack` 1662 → 1664; registry 10/16, gate 6/14, trailing 11/21, `SPLIT_ATTACK_UNITS` 14, `COMPOUND_ATTACK_UNITS` 21 and `attackReaderSurface()` 13 UNMOVED; engine 0.423.0 → 0.424.0, `MATCH_RECORD_VERSION` HELD at 30 (a WIDENING at a persisted address, D125's free case — and `count: "all"` NEVER PARKS, so no record that can exist holds the new value). ⚠️ THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — they disagree for the FIFTH slice running (D535 1-vs-2, D536 1-vs-3, D537 1-vs-2, D538 1-vs-3), so a pass that copied one number into the other kind of site would be wrong in half of them. THIS SITE: 563/1611 → 564/1613.)  // (🆕🆕🆕 **D538 +1 sentence / +3 printings — THE COUNTER PLACEMENT WHOSE AMOUNT IS A PAYLOAD AND WHOSE TAIL SHUFFLES THE VERY CARDS IT COUNTED** — `censusAttackCorpus.ts` **FILE LINE 412** (`legalAttackCorpus()` index 359), *"Put 2 damage counters on 1 of your opponent's Pokémon for each Basic {G} Energy card in your discard pile. Then, shuffle those Energy cards into your deck."*, **1 sentence / 3 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrator `d538-pile-sniper`), claimed by `deriveAttackEffect` through ONE new whole-sentence TWO-capture anchor (`COUNTER_PUT_SCALED_BY_PILE`, declared with the counter-put family, ONE `['’]` slot) as arm **23b-bis** emitting THREE ops — `damageChosen{perDiscardPileCard}` + `discardPileRetrieval{max:"all"}` + `shuffleDeck`, with ONE `CardFilter` object shared by the first two — a READER move: reader arm 562/1608 → 563/1611, raw residue 78/124 → 77/121, `BUILT.attack` 1659 → 1662; registry 10/16, gate 6/14, trailing 11/21, `SPLIT_ATTACK_UNITS` 14 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED; engine 0.422.0 → 0.423.0, `MATCH_RECORD_VERSION` HELD at 30 (a NEW OPTIONAL KEY is D125's WIDENING and `max: "all"` is a PURE ADDITION to a value domain — and BOTH bytes are written into the record, through `phase.cont.pendingOp` and `phase.cont.rest` respectively). ⚠️ THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 3 — they disagree for the FOURTH slice running (D535 1-vs-2, D536 1-vs-3, D537 1-vs-2), so a pass that copied one number into the other kind of site would be wrong in half of them. THIS SITE: 562/1608 → 563/1611.)  // (🆕🆕🆕 **D537 +1 sentence / +2 printings — KEEP THREE, SHUFFLE THE REST: THE ONLY SENTENCE IN THIS CORPUS WHOSE PICK NAMES THE BODIES THAT *STAY* — ONE NEW `EffectOp` MEMBER `returnBenchedRest` AND ONE INTERPRETER WRITER** — `censusAttackCorpus.ts` **FILE LINE 84** (`legalAttackCorpus()` index 31), *"Choose 3 of your opponent's Benched Pokémon. If you do, shuffle all of your opponent's Benched Pokémon that you didn't choose, and all cards attached to those Pokémon, into their deck."*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrator `d537-bencher`), claimed by `deriveAttackEffect` through ONE new ONE-capture whole-sentence anchor (`CHOOSE_KEEP_SHUFFLE_REST`, beside `RETURN_BENCHED`, THREE `['’]` slots — two possessives AND the contraction in "didn't") as arm **42-bis** emitting ONE `returnBenchedRest{keep:3}` — a READER move: reader arm 561/1606 → 562/1608, raw residue 79/126 → 78/124, `BUILT.attack` 1657 → 1659; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.421.0 → 0.422.0, `MATCH_RECORD_VERSION` HELD at 30 (a new op MEMBER is D125's WIDENING — and this op PARKS, so the byte IS written into `phase.cont.pendingOp`). ⚠️ THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — they disagree for the third slice running (D535 1-vs-2, D536 1-vs-3), so a pass that copied one number into the other kind of site would be wrong in half of them. THIS SITE: 561/1606 → 562/1608.)  // (🆕🆕🆕 **D536 +1 sentence / +3 printings — THE BODY THAT LEAVES PLAY WITHOUT BEING KNOCKED OUT — ONE NEW FIELD-FREE `EffectOp` MEMBER `discardDefender` AND ONE INTERPRETER WRITER** — `censusAttackCorpus.ts` **FILE LINE 100** (`legalAttackCorpus()` index 47), *"Discard a Team Rocket's Energy from this Pokémon. If you do, discard your opponent's Active Pokémon and all attached cards."*, **1 sentence / 3 legal printings** (Moltres ex `sv10-031`/`-208`/`-229` — the ids ARE resolved on this checkout and are used as ids; the printed BASE DAMAGE is NOT, so it is driven on the file-local declared demonstrator `d536-moltres`, D425), claimed by `deriveAttackEffect` through ONE new ZERO-capture anchor (`TR_ENERGY_COST_THEN_DISCARD_DEFENDER`, beside `HAND_COST_THEN_OPPONENT_DISCARD`) as `discardEnergy{from:"yourActive", filter:{byName "Team Rocket's Energy"}, recordAs:"discarded"}` gated through the FIRST shipped `recordGate{slot:"discarded"}` into the new `discardDefender` — a READER move: reader arm 560/1603 → 561/1606, raw residue 80/129 → 79/126, `BUILT.attack` 1654 → 1657; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.420.0 → 0.421.0, `MATCH_RECORD_VERSION` HELD at 30 (a new op MEMBER is D125's WIDENING; the op never parks and is FIELD-FREE). ⚠️ THE SENTENCE STEP AND THE PRINTING STEP DISAGREE AT 1 AND 3 — harder than D535's 1-and-2, so a pass that copied one number into the other kind of site would be wrong in half of them. THIS SITE: 560/1603 → 561/1606.)  // (🆕🆕🆕 **D535 +1 sentence / +2 printings — THE PICK-WITH-REPLACEMENT SNIPE — ZERO NEW VOCABULARY: SIX `damageChosen` OPS AT `count: 1`, THE LITERAL `CHOSEN_ANY_TARGET` ALREADY AUTHORS** — `censusAttackCorpus.ts` **FILE LINE 81** (`legalAttackCorpus()` index 28), *"Choose 1 of your opponent's Pokémon 6 times. (You can choose the same Pokémon more than once.) For each time you chose a Pokémon, do 20 damage to it. This damage isn't affected by Weakness or Resistance."*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — no D1, no catalog sqlite — stated unresolved, never invented, D425), claimed by `deriveAttackEffect` through ONE new TWO-capture anchor (`ATTACK_PICK_WITH_REPLACEMENT_SNIPE`, beside `CHOSEN_ANY_TARGET`) as SIX `damageChosen{target:"opponentAny", amount:20, count:1, source:"attack", deals, ignoreWR}` parks — a READER move: reader arm 559/1601 → 560/1603, raw residue 81/131 → 80/129; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.419.0 → 0.420.0, `MATCH_RECORD_VERSION` HELD at 30 (D237's POPULATION change — the op literal already ships, so the serialized alphabet does not grow). ⚠️ THE SENTENCE STEP AND THE PRINTING STEP DISAGREE AT 1 AND 2 — the legal column prints this sentence TWICE.)  // (🆕🆕🆕 **D534 +1 sentence / +1 printing — THE ONE-CARD LOOK AT THE OPPONENT's DECK WITH A PRINTED SHUFFLE — `shuffleDeck` GAINS THE OPTIONAL KEY `whose: "opponent"` and `reorderTop` PARKS A ONE-CARD WINDOW WHEN ITS TWO ARMS DIFFER** — `censusAttackCorpus.ts` **FILE LINE 401**, *"Look at the top card of your opponent's deck. You may have your opponent shuffle their deck."*, **1 sentence / 1 legal printing** (Inkay `sv06.5-033`; no id on this checkout, D425), claimed by `deriveAttackEffect` through ONE new zero-capture anchor (`ATTACK_OPPONENT_TOP_LOOK_SHUFFLE`, beside `ATTACK_REORDER_TOP`) as `reorderTop{n:1, side:"opponent", otherwise:[shuffleDeck{whose:"opponent"}]}` — a READER move: reader arm 558/1600 → 559/1601, raw residue 82/132 → 81/131; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.418.0 → 0.419.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1.)  // (🆕🆕🆕 **D532 +1 sentence / +1 printing — THE CROSS-SEAT DISCARD-PILE ATTACH — `attachEnergyFrom` GAINS THE OPTIONAL KEY `whose: "opponent"` (on the op AND on `AttachTargetRiders`, read through ONE resolver)** — `censusAttackCorpus.ts` **FILE LINE 70** (`legalAttackCorpus()` index 17), *"Attach up to 3 Energy cards from your opponent's discard pile to their Pokémon in any way you like."*, **1 sentence / 1 legal printing** (Grafaiai `sv08-121`; no id on this checkout, D425), claimed by `deriveAttackEffect` through ONE new zero-capture anchor (`ATTACK_OPPONENT_DISCARD_ATTACH`, beside the factory-built `DISCARD_ATTACH`) as D360's spread ONE KEY OVER — a READER move: reader arm 557/1599 → 558/1600, raw residue 83/133 → 82/132; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.417.0 → 0.418.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1.)  // (🆕🆕🆕 **D531 +1 sentence / +1 printing — THE BOARD-TYPED HAND SEARCH — `searchDeck` GAINS THE PARK-TIME RIDER `typedAsAttachedBasicEnergy`** — `censusAttackCorpus.ts` **FILE LINE 483** (`legalAttackCorpus()` index 430), *"Search your deck for up to 5 Pokémon that are the same type as any Basic Energy attached to this Pokémon, reveal them, and put them into your hand. Then, shuffle your deck."*, **1 sentence / 1 legal printing** (sv07-065 per the retired D231 deferral; no id on this checkout, D425), claimed by `deriveAttackEffect` through ONE new zero-capture anchor (`ATTACK_HAND_SEARCH_TYPED_AS_ATTACHED`, beside `ATTACK_HAND_SEARCH_BENCH_COUNT`) whose rider the park resolves against the SOURCE body's attached Basic Energy — a READER move: reader arm 556/1598 → 557/1599, raw residue 84/134 → 83/133; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.416.0 → 0.417.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1.)
    expect(resolved.map(([, s]) => s)).toContain(PRINTED);
    // …and the step is THIS sentence and nothing else: remove it and the pair is D524's.
    const without = resolved.filter(([, s]) => s !== PRINTED);
    // 🆕🆕🆕 **D530 +1 sentence / +1 printing (the own-row `without` pair: resolved − that suite's row) — THE TARGET-COUNTER-SCALED BENCH SNIPE — A FOURTH `damageChosen` RIDER, `perDamageCounterOnTarget`, READ PER REF AT THE ANSWER** — `censusAttackCorpus.ts` **FILE LINE 551** (`legalAttackCorpus()` index 498), *"This attack does 20 damage to 1 of your opponent's Benched Pokémon for each damage counter on that Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)"*, **1 sentence / 1 legal printing** (no id on this checkout, D425), claimed by `deriveAttackEffect` through ONE new anchor (`BENCHED_SNIPE_TARGET_COUNTERS`, beside `BENCHED_SNIPE_TAKEN_PRIZES`, disjoint by TAIL) as arm 6b′ — a READER move: reader arm 555/1597 → 556/1598, raw residue 85/135 → 84/134; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.415.0 → 0.416.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1.
    // 🆕🆕🆕 D528 +1 sentence / +1 printing (THE HEADS-CEILINGED DISCARD-TO-BENCH ENERGY ATTACH — THE ATTACH TWIN OF D525, ZERO VOCABULARY, NO NEW `AttackCoinFlip` MEMBER — corpus FILE LINE 215, *"Flip 3 coins. Attach a number of Basic {L} Energy cards up to the number of heads from your discard pile to your Benched Pokémon in any way you like."*, 1 legal printing, claimed by `deriveAttackCoinFlip` as `programPerHeads` over ONE copy of D358's discard-spread op, H declinable parks at the existing fold, ZERO new vocabulary, no fold/interpreter bytes; the sentence and printing steps AGREE at 1): 553/1594 → 554/1595 (own-row `without` pair, re-derived by hand as resolved − this suite's row). Stepped by hand (outside the annotated-chain sweep's shape).
    expect([without.length, units(without)]).toEqual([599, 1661]);  // (🆕🆕🆕 **D579 +1 sentence / +1 printing — THE CENSUS CLOSE-OUT** — Koraidon `sv08-116` "Unrelenting Onslaught", claimed WHOLE by `deriveAttackDamageBonus` through one `CONDITIONAL_DAMAGE_CLAUSES` literal; Walking Wake `sv06-063` is a REGISTRY row and moves no reader figure.) (🆕🆕🆕 **D575 +6 sentences / +6 printings — THE MRV-38 ATTACK SLICE** — `deriveAttackEffect`'s six new whole-sentence anchors claim `censusAttackCorpus.ts` file lines 177 (Hypno "Daydream"), 181 (Miraidon "C.O.D.E.: Protect"), 182 (Iron Moth "Anachronism Repulsor"), 346 (N's Sigilyph "Victory Symbol"), 394 (Team Rocket's Blipbug "Searching Eyes") and 690 (Glimmora "Corrosive Shards", the compound claimed WHOLE) — one printing each, so the sentence and printing steps AGREE. A READER move.) (🆕🆕🆕 **D574 +3 sentences / +5 printings — THE COPY-FAMILY REMAINDER + SABLEYE** — `deriveAttackCopy`'s two RESOLVE-TIME anchors claim `censusAttackCorpus.ts` file lines 434 and 131 WHOLE (Haughty Order ×3, Seek Inspiration) and `deriveAttackEffect`'s new anchor claims file line 649 (Sableye "Damage Collection"). Alakazam (686) composes through the TRAILING seam and Malamar (489) is a REGISTRY row — neither is a reader move. A READER move; the sentence step (3) and the printing step (5) DISAGREE, so each site was classified by its unit.) (🆕🆕🆕 **D573 +4 sentences / +9 printings — THE COPY-ATTACK SUBSTITUTION** — `deriveAttackCopy`, the FOURTEENTH reader, claims `censusAttackCorpus.ts` file lines 77, 78, 80 and 245 WHOLE: Night Joker ×4, Foul Play ×2 + Metronome, Gemstone Mimicry, Try to Imitate. A READER move; the sentence step (4) and the printing step (9) DISAGREE, so each site was classified by its unit.) (🆕🆕🆕 **D569 +4 sentences / +6 printings — THE PARADOX BANNER READERS** (Koraidon ×2 "Primordial Beatdown", Roaring Moon ×2 "Vengeance Fletching", Iron Valiant "Majestic Sword", Slither Wing "Iron Smasher" — two noun rows and two literal clause rows over `banners.ts`); this suite's own row is unmoved.) (🆕🆕🆕 **D568 +2 sentences / +2 printings — THE TWO TERA CLAUSES** (Ho-Oh `sv08-019`, Regigigas `sv08.5-086`), two literal rows over `banners.ts`; this suite's own row is unmoved.) (🆕🆕🆕 **D552 +2 sentences / +2 printings — THE PRE-DAMAGE SELF ATTACH BEHIND A MULTIPLIER HEAD, AND THE WEAKNESS RETYPE** — `censusAttackCorpus.ts` **file lines 569 and 629** (leading count column `1` each; card ids UNRESOLVED on this checkout — measured, never invented, D425): `:569` claimed WHOLE by `deriveAttackDiscardScaledBoost`'s THIRD member `selfHandAttach` (attach-then-damage inside the program), `:629` by `deriveAttackEffect` through ONE new anchor `DEFENDER_WEAKNESS_RETYPED` as ONE new op `retypeDefenderWeakness` — a READER move: reader arm 578/1632 → 580/1634, raw residue 62/100 → 60/98, `BUILT.attack` 1688 → 1690; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.435.0 → 0.436.0, `MATCH_RECORD_VERSION` 33 → 34. ⚠️ THE SENTENCE STEP (2) AND THE PRINTING STEP (2) AGREE this slice — the case where a copied number is right BY ACCIDENT, so every site was classified by the quantity its D550 note names (D426/D451). THIS SITE: the `without` pair (resolved MINUS this suite's own TWO printings) 577/1630 → 579/1632.)  // (🆕🆕🆕 **D550 +1 sentence / +1 printing — THE OPPONENT-FLIPPED PER-TAILS SNIPE ON THE OPPONENT'S BENCH COUNT** — `censusAttackCorpus.ts` **file line 669** (leading count column `1`; card id UNRESOLVED on this checkout — measured, never invented, D425), claimed WHOLE by `deriveAttackCoinFlip` (a NINTH member `opponentPerTails` over a NULLARY `AttackFlipCount.opponentBench`) AND by `deriveAttackDamageSuppression`'s THIRD compound arm off ONE anchor, `ATTACK_OPPONENT_BENCH_TAILS` — a READER move: reader arm 577/1631 → 578/1632, raw residue 63/101 → 62/100, `BUILT.attack` 1687 → 1688, PHRASE-24 1/1 → 0/0; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.434.0 → 0.435.0, `MATCH_RECORD_VERSION` HOLDS at 33. ⚠️ THE SENTENCE STEP (1) AND THE PRINTING STEP (1) AGREE this slice — the case where a copied number is right BY ACCIDENT, so every site was classified by the quantity its D549 note names (D426/D451). THIS SITE: the `without` pair (resolved MINUS this suite's own TWO printings) 576/1629 → 577/1630.)  // (🆕🆕🆕 **D549 +4 sentences / +4 printings — THE DEFENDER'S NEXT-TURN MARKS AND THE SIDE-WIDE ATTACK LOCK** — `censusAttackCorpus.ts` **file lines 171, 149, 169 and 170** (leading count column `1` each; card ids UNRESOLVED on this checkout — measured, never invented, D425), claimed WHOLE by `deriveAttackEffect` alone through FOUR new anchors as THREE new ops (`taxDefender`, `bountyDefender`, `lockSideAttacks`) — a READER move: reader arm 573/1627 → 577/1631, raw residue 67/105 → 63/101, `BUILT.attack` 1683 → 1687; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.433.0 → 0.434.0, `MATCH_RECORD_VERSION` 32 → 33. ⚠️ THE SENTENCE STEP (4) AND THE PRINTING STEP (4) AGREE this slice — the case where a copied number is right BY ACCIDENT, so every site was classified by the quantity its D548 note names (D426/D451). THIS SITE: the `without` pair (resolved MINUS this suite's own TWO printings) 572/1625 → 576/1629.)  // (🆕🆕🆕 **D548 +1 sentence / +2 printings — CRESCENT PURGE, THE FACE-UP PRIZE** — `censusAttackCorpus.ts` **file line 664**, Cresselia `sv06.5-021` "Crescent Purge", claimed WHOLE by `deriveAttackOptionalCostBoost`'s FIFTH cost row (`turnPrizeFaceUp` behind `yourFaceDownPrizeRemains`); engine 0.432.0 → 0.433.0, `MATCH_RECORD_VERSION` 31 → 32. ⚠️ THE SENTENCE STEP (1) AND THE PRINTING STEP (2) DIFFER. THIS SITE: the `without` pair (resolved MINUS this suite's own TWO printings) 571/1623 → 572/1625.)  // (🆕🆕🆕 **D547 +2 sentences / +4 printings — THE FLIP-TO-ATTACK LOCK AND THE NEXT-TURN VULNERABILITY** — `censusAttackCorpus.ts` **file lines 176 and 150** (leading count column `2` each), *“During your opponent's next turn, if the Defending Pokémon tries to use an attack, your opponent flips a coin. If tails, that attack doesn't happen.”* (TWO sentences in ONE row) and *“During your next turn, the Defending Pokémon takes 50 more damage from attacks (after applying Weakness and Resistance).”*, **2 rows / 4 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so both suites ride file-local declared `d547-*` demonstrators), claimed WHOLE by `deriveAttackEffect` through TWO new anchors (`DEFENDER_FLIP_ATTACK_LOCK`, `DEFENDER_VULNERABLE_NEXT_TURN`) as TWO new ops (`flipLockAttack`, `exposeDefender`) on TWO new REQUIRED `InPlayPokemon` fields — a READER move: reader arm 570/1621 → 572/1625, raw residue 70/111 → 68/107, `BUILT.attack` 1677 → 1681; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.431.0 → 0.432.0, `MATCH_RECORD_VERSION` 30 → 31. ⚠️ **THE SENTENCE STEP (2) AND THE PRINTING STEP (4) DIFFER**, so no copied number is right by accident; every site was classified by the quantity its D546 note names (D426/D451). THIS SITE: the `without` pair (resolved MINUS this suite's own TWO printings) 569/1619 → 571/1623.)  // (🆕🆕🆕 **D546 +2 sentences / +2 printings — THE ALL-ATTACKS NEXT-TURN BUFF** — `censusAttackCorpus.ts` **file lines 76 and 148** (leading count column `1` each), *“During your next turn, attacks used by this Pokémon do 120 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance).”* and the same sentence at 100 behind *“Both Active Pokémon are now Asleep.”*, **2 sentences / 2 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so the suite rides file-local declared `d546-*` demonstrators), claimed WHOLE by `deriveAttackEffect` through ONE new whole-sentence anchor (`SELF_EVERY_ATTACK_BOOST`, ONE `['’]` slot, an optional Sleep prefix) as `attack: null` on the SHIPPED `boostAttack` op — no new `EffectOp` member, no new `InPlayPokemon` field — a READER move: reader arm 568/1619 → 570/1621, raw residue 72/113 → 70/111, `BUILT.attack` 1675 → 1677; registry 10/16, gate 9/19, trailing 11/21, `SPLIT_ATTACK_UNITS` 19 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED (19 READ at `censusAtHead.test.ts:8169`); engine 0.430.0 → 0.431.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP ARE BOTH 2 — THE ONE SHAPE WHERE A COPIED NUMBER IS RIGHT BY ACCIDENT**, so every site was measured by the quantity it pins, not copied (D426/D451). THIS SITE: the `without` pair (resolved MINUS this suite's own TWO printings) 567/1617 → 569/1619.)  // (🆕🆕🆕 **D544 +1 sentence / +2 printings — THE NAMED ATTACK'S BASE DAMAGE, OVERRIDDEN FOR ONE WINDOW** — `censusAttackCorpus.ts` **file line 166** (leading count column `2`), *“During your next turn, this Pokémon's Hyper Fang attack's base damage is 240.”*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so the suite rides the file-local declared demonstrator `d544-fang`), claimed WHOLE by `deriveAttackEffect` through ONE new whole-sentence anchor (`SELF_ATTACK_BASE_SET`, TWO `['’]` slots, name and number CAPTURED) as a `base: true` RIDER on the SHIPPED `boostAttack` op — no new `EffectOp` member, no new `InPlayPokemon` field — a READER move: reader arm 567/1617 → 568/1619, raw residue 73/115 → 72/113, `BUILT.attack` 1671 → 1673; registry 10/16, gate 7/17, trailing 11/21, `SPLIT_ATTACK_UNITS` 17 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED (17 READ at `censusAtHead.test.ts:8159` — the “14” in D543's annotation beside this one has been stale since D541 moved the constant); engine 0.428.0 → 0.429.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — THEY DISAGREE**, so no number may be copied from one kind of site into another (D426/D451). THIS SITE: the `without` pair (resolved MINUS this suite's own TWO printings) 566/1615 → 567/1617, RE-DERIVED BY HAND (D525(5)).)  // (🆕🆕🆕 **D543 +1 sentence / +2 printings — THE CHOSEN POKÉMON TOOL DISCARD AT THE PROGRAM TAIL** — `censusAttackCorpus.ts` **file line 136** (leading count column `2`), *“Discard up to 2 Pokémon Tools from your opponent's Pokémon.”*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrator `d543-stripper`), claimed WHOLE by `deriveAttackEffect` through ONE new whole-sentence anchor (`ATTACK_DISCARD_TOOLS_UP_TO`, ONE `['’]` slot at index 48, count CAPTURED) as ONE new `EffectOp` member `discardTools{count}` parking on ONE new `EffectPrompt` kind — a READER move: reader arm 566/1615 → 567/1617, raw residue 74/117 → 73/115, `BUILT.attack` 1669 → 1671; registry 10/16, gate 7/17, trailing 11/21, `SPLIT_ATTACK_UNITS` 14 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED; engine 0.427.0 → 0.428.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — THEY DISAGREE**, so no number may be copied from one kind of site into another (D426/D451). THIS SITE: the `without` pair (resolved MINUS this suite's own TWO printings) 565/1613 → 566/1615, RE-DERIVED BY HAND (D525(5)).)  // (🆕🆕🆕 **D542 +1 sentence / +1 printing — THE OPPONENT-CHOSEN HAND SHUFFLE** — `censusAttackCorpus.ts` **file line 665** (`legalAttackCorpus()` index 612, leading count column `1`), *“Your opponent chooses 3 cards from their hand and shuffles those cards into their deck.”*, **1 sentence / 1 legal printing**, claimed WHOLE by `deriveAttackEffect` through ONE new anchor and ONE new arm returning a COMPOSITION of two shipped ops — so it leaves through the RAW READER summand and the registry / gate-split / trailing-split summands all stand still. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1, WHICH IS THE ONE CASE WHERE A COPIED NUMBER IS RIGHT BY ACCIDENT — so THIS SITE WAS MEASURED rather than inherited from its neighbour** (D426/D451).)  (🆕🆕🆕 **D540 +1 sentence / +1 printing — THE DEVOLUTION WITH A PICK IN IT, AND THE `/[Dd]evolv/` FAMILY CLOSES** — `censusAttackCorpus.ts` **row 87** (`legalAttackCorpus()` index 34), *"Devolve 1 of your opponent's evolved Pokémon by putting the highest Stage Evolution card on it into your opponent's hand."*, **1 sentence / 1 legal printing**, claimed by `deriveAttackEffect` through ONE new anchor `DEVOLVE_CHOSEN_TO_HAND` and arm 41-ter into ONE new FIELD-FREE `EffectOp` member `devolveChosen`. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 for the first time in six slices — the one case where a copied number is right by accident, so THIS SITE was measured off the live failure and never copied from a neighbour.)  // (🆕🆕🆕 **D539 +1 sentence / +2 printings — THE NAMED-BODY MULTIPLIER WITH A NAMED-BODY OWN-SIDE SPREAD BEHIND IT** — `censusAttackCorpus.ts` **FILE LINE 595** (`legalAttackCorpus()` index 542), *"This attack does 50 damage for each of your Drifloon and Drifblim in play. This attack also does 30 damage to each of your Drifloon and Drifblim. (Don't apply Weakness and Resistance for Benched Pokémon.)"*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrators `d539-*`), claimed by TWO readers off ONE `effect` string through ONE new whole-compound anchor carrying a `\2` BACKREFERENCE (`NAMED_BODIES_MULTIPLY_SPREAD`) — `deriveAttackDamageMultiplier` for the × fold and `deriveAttackEffect` for `damageChosen` with the FOURTH `target` member `yourAny` and `count: "all"`, plus the NINTH `IN_PLAY_BODY_NOUNS` exact key — a READER move: reader arm 563/1611 → 564/1613, raw residue 77/121 → 76/119, `BUILT.attack` 1662 → 1664; registry 10/16, gate 6/14, trailing 11/21, `SPLIT_ATTACK_UNITS` 14, `COMPOUND_ATTACK_UNITS` 21 and `attackReaderSurface()` 13 UNMOVED; engine 0.423.0 → 0.424.0, `MATCH_RECORD_VERSION` HELD at 30 (a WIDENING at a persisted address, D125's free case — and `count: "all"` NEVER PARKS). ⚠️ THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — they disagree for the FIFTH slice running (D535 1-vs-2, D536 1-vs-3, D537 1-vs-2, D538 1-vs-3). THIS SITE: 562/1609 → 563/1611.)  // (🆕🆕🆕 **D538 +1 sentence / +3 printings — THE COUNTER PLACEMENT WHOSE AMOUNT IS A PAYLOAD AND WHOSE TAIL SHUFFLES THE VERY CARDS IT COUNTED** — `censusAttackCorpus.ts` **FILE LINE 412** (`legalAttackCorpus()` index 359), *"Put 2 damage counters on 1 of your opponent's Pokémon for each Basic {G} Energy card in your discard pile. Then, shuffle those Energy cards into your deck."*, **1 sentence / 3 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrator `d538-pile-sniper`), claimed by `deriveAttackEffect` through ONE new whole-sentence TWO-capture anchor (`COUNTER_PUT_SCALED_BY_PILE`, declared with the counter-put family, ONE `['’]` slot) as arm **23b-bis** emitting THREE ops — `damageChosen{perDiscardPileCard}` + `discardPileRetrieval{max:"all"}` + `shuffleDeck`, with ONE `CardFilter` object shared by the first two — a READER move: reader arm 562/1608 → 563/1611, raw residue 78/124 → 77/121, `BUILT.attack` 1659 → 1662; registry 10/16, gate 6/14, trailing 11/21, `SPLIT_ATTACK_UNITS` 14 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED; engine 0.422.0 → 0.423.0, `MATCH_RECORD_VERSION` HELD at 30 (a NEW OPTIONAL KEY is D125's WIDENING and `max: "all"` is a PURE ADDITION to a value domain — and BOTH bytes are written into the record, through `phase.cont.pendingOp` and `phase.cont.rest` respectively). ⚠️ THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 3 — they disagree for the FOURTH slice running (D535 1-vs-2, D536 1-vs-3, D537 1-vs-2), so a pass that copied one number into the other kind of site would be wrong in half of them. THIS SITE: ⚠️ THE OWN-ROW `without` PAIR, RE-DERIVED BY HAND as resolved − this suite's OWN row (D525 (5)) — 561/1606 → 562/1609.)  // (🆕🆕🆕 **D537 +1 sentence / +2 printings — KEEP THREE, SHUFFLE THE REST: THE ONLY SENTENCE IN THIS CORPUS WHOSE PICK NAMES THE BODIES THAT *STAY* — ONE NEW `EffectOp` MEMBER `returnBenchedRest` AND ONE INTERPRETER WRITER** — `censusAttackCorpus.ts` **FILE LINE 84** (`legalAttackCorpus()` index 31), *"Choose 3 of your opponent's Benched Pokémon. If you do, shuffle all of your opponent's Benched Pokémon that you didn't choose, and all cards attached to those Pokémon, into their deck."*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrator `d537-bencher`), claimed by `deriveAttackEffect` through ONE new ONE-capture whole-sentence anchor (`CHOOSE_KEEP_SHUFFLE_REST`, beside `RETURN_BENCHED`, THREE `['’]` slots — two possessives AND the contraction in "didn't") as arm **42-bis** emitting ONE `returnBenchedRest{keep:3}` — a READER move: reader arm 561/1606 → 562/1608, raw residue 79/126 → 78/124, `BUILT.attack` 1657 → 1659; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.421.0 → 0.422.0, `MATCH_RECORD_VERSION` HELD at 30 (a new op MEMBER is D125's WIDENING — and this op PARKS, so the byte IS written into `phase.cont.pendingOp`). ⚠️ THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — they disagree for the third slice running (D535 1-vs-2, D536 1-vs-3), so a pass that copied one number into the other kind of site would be wrong in half of them. THIS SITE: 560/1604 → 561/1606.)  // (🆕🆕🆕 **D536 +1 sentence / +3 printings — THE BODY THAT LEAVES PLAY WITHOUT BEING KNOCKED OUT — ONE NEW FIELD-FREE `EffectOp` MEMBER `discardDefender` AND ONE INTERPRETER WRITER** — `censusAttackCorpus.ts` **FILE LINE 100** (`legalAttackCorpus()` index 47), *"Discard a Team Rocket's Energy from this Pokémon. If you do, discard your opponent's Active Pokémon and all attached cards."*, **1 sentence / 3 legal printings** (Moltres ex `sv10-031`/`-208`/`-229` — the ids ARE resolved on this checkout and are used as ids; the printed BASE DAMAGE is NOT, so it is driven on the file-local declared demonstrator `d536-moltres`, D425), claimed by `deriveAttackEffect` through ONE new ZERO-capture anchor (`TR_ENERGY_COST_THEN_DISCARD_DEFENDER`, beside `HAND_COST_THEN_OPPONENT_DISCARD`) as `discardEnergy{from:"yourActive", filter:{byName "Team Rocket's Energy"}, recordAs:"discarded"}` gated through the FIRST shipped `recordGate{slot:"discarded"}` into the new `discardDefender` — a READER move: reader arm 560/1603 → 561/1606, raw residue 80/129 → 79/126, `BUILT.attack` 1654 → 1657; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.420.0 → 0.421.0, `MATCH_RECORD_VERSION` HELD at 30 (a new op MEMBER is D125's WIDENING; the op never parks and is FIELD-FREE). ⚠️ THE SENTENCE STEP AND THE PRINTING STEP DISAGREE AT 1 AND 3 — harder than D535's 1-and-2, so a pass that copied one number into the other kind of site would be wrong in half of them. THIS SITE: 559/1601 → 560/1604.)  // (🆕🆕🆕 **D535 +1 sentence / +2 printings — THE PICK-WITH-REPLACEMENT SNIPE — ZERO NEW VOCABULARY: SIX `damageChosen` OPS AT `count: 1`, THE LITERAL `CHOSEN_ANY_TARGET` ALREADY AUTHORS** — `censusAttackCorpus.ts` **FILE LINE 81** (`legalAttackCorpus()` index 28), *"Choose 1 of your opponent's Pokémon 6 times. (You can choose the same Pokémon more than once.) For each time you chose a Pokémon, do 20 damage to it. This damage isn't affected by Weakness or Resistance."*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — no D1, no catalog sqlite — stated unresolved, never invented, D425), claimed by `deriveAttackEffect` through ONE new TWO-capture anchor (`ATTACK_PICK_WITH_REPLACEMENT_SNIPE`, beside `CHOSEN_ANY_TARGET`) as SIX `damageChosen{target:"opponentAny", amount:20, count:1, source:"attack", deals, ignoreWR}` parks — a READER move: reader arm 559/1601 → 560/1603, raw residue 81/131 → 80/129; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.419.0 → 0.420.0, `MATCH_RECORD_VERSION` HELD at 30 (D237's POPULATION change — the op literal already ships, so the serialized alphabet does not grow). ⚠️ THE SENTENCE STEP AND THE PRINTING STEP DISAGREE AT 1 AND 2 — the legal column prints this sentence TWICE.)  // (🆕🆕🆕 **D534 +1 sentence / +1 printing — THE ONE-CARD LOOK AT THE OPPONENT's DECK WITH A PRINTED SHUFFLE — `shuffleDeck` GAINS THE OPTIONAL KEY `whose: "opponent"` and `reorderTop` PARKS A ONE-CARD WINDOW WHEN ITS TWO ARMS DIFFER** — `censusAttackCorpus.ts` **FILE LINE 401**, *"Look at the top card of your opponent's deck. You may have your opponent shuffle their deck."*, **1 sentence / 1 legal printing** (Inkay `sv06.5-033`; no id on this checkout, D425), claimed by `deriveAttackEffect` through ONE new zero-capture anchor (`ATTACK_OPPONENT_TOP_LOOK_SHUFFLE`, beside `ATTACK_REORDER_TOP`) as `reorderTop{n:1, side:"opponent", otherwise:[shuffleDeck{whose:"opponent"}]}` — a READER move: reader arm 558/1600 → 559/1601, raw residue 82/132 → 81/131; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.418.0 → 0.419.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1.)  // (🆕🆕🆕 **D532 +1 sentence / +1 printing (the own-row `without` pair: resolved − that suite's row) — THE CROSS-SEAT DISCARD-PILE ATTACH — `attachEnergyFrom` GAINS THE OPTIONAL KEY `whose: "opponent"` (on the op AND on `AttachTargetRiders`, read through ONE resolver)** — `censusAttackCorpus.ts` **FILE LINE 70** (`legalAttackCorpus()` index 17), *"Attach up to 3 Energy cards from your opponent's discard pile to their Pokémon in any way you like."*, **1 sentence / 1 legal printing** (Grafaiai `sv08-121`; no id on this checkout, D425), claimed by `deriveAttackEffect` through ONE new zero-capture anchor (`ATTACK_OPPONENT_DISCARD_ATTACH`, beside the factory-built `DISCARD_ATTACH`) as D360's spread ONE KEY OVER — a READER move: reader arm 557/1599 → 558/1600, raw residue 83/133 → 82/132; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.417.0 → 0.418.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1.)  // (🆕🆕🆕 **D531 +1 sentence / +1 printing (the own-row `without` pair: resolved − that suite's row) — THE BOARD-TYPED HAND SEARCH — `searchDeck` GAINS THE PARK-TIME RIDER `typedAsAttachedBasicEnergy`** — `censusAttackCorpus.ts` **FILE LINE 483** (`legalAttackCorpus()` index 430), *"Search your deck for up to 5 Pokémon that are the same type as any Basic Energy attached to this Pokémon, reveal them, and put them into your hand. Then, shuffle your deck."*, **1 sentence / 1 legal printing** (sv07-065 per the retired D231 deferral; no id on this checkout, D425), claimed by `deriveAttackEffect` through ONE new zero-capture anchor (`ATTACK_HAND_SEARCH_TYPED_AS_ATTACHED`, beside `ATTACK_HAND_SEARCH_BENCH_COUNT`) whose rider the park resolves against the SOURCE body's attached Basic Energy — a READER move: reader arm 556/1598 → 557/1599, raw residue 84/134 → 83/133; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.416.0 → 0.417.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1.)
  });

  it("🛑 the RAW reader-only residue fell by exactly 1 sentence / 2 printings — 88 / 138 — and the row left it", () => {
    // 🆕🆕🆕 D525's OWN literal (corpus FILE LINE 219, see §3's first rung): 89/140 → 88/138.
    const unbuilt = legalAttackCorpus().filter(([, s]) => !resolvedByAnyReader(s));
    // 🆕🆕🆕 D526 −1 sentence / −1 printing (corpus FILE LINE 218, see §3's first rung; the two steps agree at 1): 88/138 → 87/137.
    // 🆕🆕🆕 D527 −1 sentence / −1 printing (corpus FILE LINE 454, see the reader-arm rung above; the two steps agree at 1): 87/137 → 86/136.
    // 🆕🆕🆕 **D530 −1 sentence / −1 printing — THE TARGET-COUNTER-SCALED BENCH SNIPE — A FOURTH `damageChosen` RIDER, `perDamageCounterOnTarget`, READ PER REF AT THE ANSWER** — `censusAttackCorpus.ts` **FILE LINE 551** (`legalAttackCorpus()` index 498), *"This attack does 20 damage to 1 of your opponent's Benched Pokémon for each damage counter on that Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)"*, **1 sentence / 1 legal printing** (no id on this checkout, D425), claimed by `deriveAttackEffect` through ONE new anchor (`BENCHED_SNIPE_TARGET_COUNTERS`, beside `BENCHED_SNIPE_TAKEN_PRIZES`, disjoint by TAIL) as arm 6b′ — a READER move: reader arm 555/1597 → 556/1598, raw residue 85/135 → 84/134; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.415.0 → 0.416.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1.
    // 🆕🆕🆕 D528 −1 sentence / −1 printing (THE HEADS-CEILINGED DISCARD-TO-BENCH ENERGY ATTACH — THE ATTACH TWIN OF D525, ZERO VOCABULARY, NO NEW `AttackCoinFlip` MEMBER — corpus FILE LINE 215, *"Flip 3 coins. Attach a number of Basic {L} Energy cards up to the number of heads from your discard pile to your Benched Pokémon in any way you like."*, 1 legal printing, claimed by `deriveAttackCoinFlip` as `programPerHeads` over ONE copy of D358's discard-spread op, H declinable parks at the existing fold, ZERO new vocabulary, no fold/interpreter bytes; the sentence and printing steps AGREE at 1): 86/136 → 85/135. Stepped by hand (outside the annotated-chain sweep's shape).
    expect([unbuilt.length, units(unbuilt)]).toEqual([40, 69]);  // (🆕🆕🆕 **D579 −1 sentence / −1 printing — THE CENSUS CLOSE-OUT** leaves the raw residue: Koraidon `sv08-116`, claimed WHOLE by a reader; Walking Wake `sv06-063` (a registry row) STAYS raw — measured 40/69.) (🆕🆕🆕 **D575 −6 sentences / −6 printings — THE MRV-38 ATTACK SLICE** leave the raw residue: file lines 177, 181, 182, 346, 394 and 690, each claimed WHOLE by a new `deriveAttackEffect` anchor (Glimmora's compound included, so it does not stay raw the way D574's Alakazam did) — measured 41/70, as the D575 judge predicted.) (🆕🆕🆕 **D574 −3 sentences / −5 printings — THE COPY-FAMILY REMAINDER + SABLEYE** leave the raw residue (file lines 434, 131 and 649, claimed whole by readers); Alakazam (686, composed on the trailing seam) and Malamar (489, a registry row) STAY in the raw reader-only residue — measured 47/76 where the D574 judge predicted 46/75.) (🆕🆕🆕 **D573 −4 sentences / −9 printings — THE COPY-ATTACK SUBSTITUTION** leaves the residue: `deriveAttackCopy` claims file lines 77, 78, 80 and 245 whole; Haughty Order and Seek Inspiration stay.) (🆕🆕🆕 **D569 −4 sentences / −6 printings — THE PARADOX BANNER READERS LEFT THE RAW RESIDUE** — Koraidon ×2, Roaring Moon ×2, Iron Valiant, Slither Wing; the reader rung's +4/+6 seen from the other side (58/96 → 54/90)) (🆕🆕🆕 **D568 −2 sentences / −2 printings — THE TWO TERA CLAUSES LEFT THE RAW RESIDUE** — Ho-Oh `sv08-019` and Regigigas `sv08.5-086`, the reader rung's +2/+2 seen from the other side (60/98 → 58/96)) (🆕🆕🆕 **D552 +2 sentences / +2 printings — THE PRE-DAMAGE SELF ATTACH BEHIND A MULTIPLIER HEAD, AND THE WEAKNESS RETYPE** — `censusAttackCorpus.ts` **file lines 569 and 629** (leading count column `1` each; card ids UNRESOLVED on this checkout — measured, never invented, D425): `:569` claimed WHOLE by `deriveAttackDiscardScaledBoost`'s THIRD member `selfHandAttach` (attach-then-damage inside the program), `:629` by `deriveAttackEffect` through ONE new anchor `DEFENDER_WEAKNESS_RETYPED` as ONE new op `retypeDefenderWeakness` — a READER move: reader arm 578/1632 → 580/1634, raw residue 62/100 → 60/98, `BUILT.attack` 1688 → 1690; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.435.0 → 0.436.0, `MATCH_RECORD_VERSION` 33 → 34. ⚠️ THE SENTENCE STEP (2) AND THE PRINTING STEP (2) AGREE this slice — the case where a copied number is right BY ACCIDENT, so every site was classified by the quantity its D550 note names (D426/D451). THIS SITE: raw reader-only residue 62/100 → 60/98.)  // (🆕🆕🆕 **D550 +1 sentence / +1 printing — THE OPPONENT-FLIPPED PER-TAILS SNIPE ON THE OPPONENT'S BENCH COUNT** — `censusAttackCorpus.ts` **file line 669** (leading count column `1`; card id UNRESOLVED on this checkout — measured, never invented, D425), claimed WHOLE by `deriveAttackCoinFlip` (a NINTH member `opponentPerTails` over a NULLARY `AttackFlipCount.opponentBench`) AND by `deriveAttackDamageSuppression`'s THIRD compound arm off ONE anchor, `ATTACK_OPPONENT_BENCH_TAILS` — a READER move: reader arm 577/1631 → 578/1632, raw residue 63/101 → 62/100, `BUILT.attack` 1687 → 1688, PHRASE-24 1/1 → 0/0; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.434.0 → 0.435.0, `MATCH_RECORD_VERSION` HOLDS at 33. ⚠️ THE SENTENCE STEP (1) AND THE PRINTING STEP (1) AGREE this slice — the case where a copied number is right BY ACCIDENT, so every site was classified by the quantity its D549 note names (D426/D451). THIS SITE: raw reader-only residue 63/101 → 62/100.)  // (🆕🆕🆕 **D549 +4 sentences / +4 printings — THE DEFENDER'S NEXT-TURN MARKS AND THE SIDE-WIDE ATTACK LOCK** — `censusAttackCorpus.ts` **file lines 171, 149, 169 and 170** (leading count column `1` each; card ids UNRESOLVED on this checkout — measured, never invented, D425), claimed WHOLE by `deriveAttackEffect` alone through FOUR new anchors as THREE new ops (`taxDefender`, `bountyDefender`, `lockSideAttacks`) — a READER move: reader arm 573/1627 → 577/1631, raw residue 67/105 → 63/101, `BUILT.attack` 1683 → 1687; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.433.0 → 0.434.0, `MATCH_RECORD_VERSION` 32 → 33. ⚠️ THE SENTENCE STEP (4) AND THE PRINTING STEP (4) AGREE this slice — the case where a copied number is right BY ACCIDENT, so every site was classified by the quantity its D548 note names (D426/D451). THIS SITE: raw reader-only residue 67/105 → 63/101.)  // (🆕🆕🆕 **D548 +1 sentence / +2 printings — CRESCENT PURGE, THE FACE-UP PRIZE** — `censusAttackCorpus.ts` **file line 664**, Cresselia `sv06.5-021` "Crescent Purge", claimed WHOLE by `deriveAttackOptionalCostBoost`'s FIFTH cost row (`turnPrizeFaceUp` behind `yourFaceDownPrizeRemains`); engine 0.432.0 → 0.433.0, `MATCH_RECORD_VERSION` 31 → 32. ⚠️ THE SENTENCE STEP (1) AND THE PRINTING STEP (2) DIFFER. THIS SITE: raw reader-only residue 68/107 → 67/105.)  // (🆕🆕🆕 **D547 +2 sentences / +4 printings — THE FLIP-TO-ATTACK LOCK AND THE NEXT-TURN VULNERABILITY** — `censusAttackCorpus.ts` **file lines 176 and 150** (leading count column `2` each), *“During your opponent's next turn, if the Defending Pokémon tries to use an attack, your opponent flips a coin. If tails, that attack doesn't happen.”* (TWO sentences in ONE row) and *“During your next turn, the Defending Pokémon takes 50 more damage from attacks (after applying Weakness and Resistance).”*, **2 rows / 4 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so both suites ride file-local declared `d547-*` demonstrators), claimed WHOLE by `deriveAttackEffect` through TWO new anchors (`DEFENDER_FLIP_ATTACK_LOCK`, `DEFENDER_VULNERABLE_NEXT_TURN`) as TWO new ops (`flipLockAttack`, `exposeDefender`) on TWO new REQUIRED `InPlayPokemon` fields — a READER move: reader arm 570/1621 → 572/1625, raw residue 70/111 → 68/107, `BUILT.attack` 1677 → 1681; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.431.0 → 0.432.0, `MATCH_RECORD_VERSION` 30 → 31. ⚠️ **THE SENTENCE STEP (2) AND THE PRINTING STEP (4) DIFFER**, so no copied number is right by accident; every site was classified by the quantity its D546 note names (D426/D451). THIS SITE: raw reader-only residue 70/111 → 68/107.)  // (🆕🆕🆕 **D546 +2 sentences / +2 printings — THE ALL-ATTACKS NEXT-TURN BUFF** — `censusAttackCorpus.ts` **file lines 76 and 148** (leading count column `1` each), *“During your next turn, attacks used by this Pokémon do 120 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance).”* and the same sentence at 100 behind *“Both Active Pokémon are now Asleep.”*, **2 sentences / 2 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so the suite rides file-local declared `d546-*` demonstrators), claimed WHOLE by `deriveAttackEffect` through ONE new whole-sentence anchor (`SELF_EVERY_ATTACK_BOOST`, ONE `['’]` slot, an optional Sleep prefix) as `attack: null` on the SHIPPED `boostAttack` op — no new `EffectOp` member, no new `InPlayPokemon` field — a READER move: reader arm 568/1619 → 570/1621, raw residue 72/113 → 70/111, `BUILT.attack` 1675 → 1677; registry 10/16, gate 9/19, trailing 11/21, `SPLIT_ATTACK_UNITS` 19 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED (19 READ at `censusAtHead.test.ts:8169`); engine 0.430.0 → 0.431.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP ARE BOTH 2 — THE ONE SHAPE WHERE A COPIED NUMBER IS RIGHT BY ACCIDENT**, so every site was measured by the quantity it pins, not copied (D426/D451). THIS SITE: raw reader-only residue 72/113 → 70/111.)  // (🆕🆕🆕 **D544 +1 sentence / +2 printings — THE NAMED ATTACK'S BASE DAMAGE, OVERRIDDEN FOR ONE WINDOW** — `censusAttackCorpus.ts` **file line 166** (leading count column `2`), *“During your next turn, this Pokémon's Hyper Fang attack's base damage is 240.”*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so the suite rides the file-local declared demonstrator `d544-fang`), claimed WHOLE by `deriveAttackEffect` through ONE new whole-sentence anchor (`SELF_ATTACK_BASE_SET`, TWO `['’]` slots, name and number CAPTURED) as a `base: true` RIDER on the SHIPPED `boostAttack` op — no new `EffectOp` member, no new `InPlayPokemon` field — a READER move: reader arm 567/1617 → 568/1619, raw residue 73/115 → 72/113, `BUILT.attack` 1671 → 1673; registry 10/16, gate 7/17, trailing 11/21, `SPLIT_ATTACK_UNITS` 17 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED (17 READ at `censusAtHead.test.ts:8159` — the “14” in D543's annotation beside this one has been stale since D541 moved the constant); engine 0.428.0 → 0.429.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — THEY DISAGREE**, so no number may be copied from one kind of site into another (D426/D451). THIS SITE: raw reader-only residue 73/115 → 72/113.)  // (🆕🆕🆕 **D543 +1 sentence / +2 printings — THE CHOSEN POKÉMON TOOL DISCARD AT THE PROGRAM TAIL** — `censusAttackCorpus.ts` **file line 136** (leading count column `2`), *“Discard up to 2 Pokémon Tools from your opponent's Pokémon.”*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrator `d543-stripper`), claimed WHOLE by `deriveAttackEffect` through ONE new whole-sentence anchor (`ATTACK_DISCARD_TOOLS_UP_TO`, ONE `['’]` slot at index 48, count CAPTURED) as ONE new `EffectOp` member `discardTools{count}` parking on ONE new `EffectPrompt` kind — a READER move: reader arm 566/1615 → 567/1617, raw residue 74/117 → 73/115, `BUILT.attack` 1669 → 1671; registry 10/16, gate 7/17, trailing 11/21, `SPLIT_ATTACK_UNITS` 14 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED; engine 0.427.0 → 0.428.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — THEY DISAGREE**, so no number may be copied from one kind of site into another (D426/D451). THIS SITE: raw reader-only residue 74/117 → 73/115.)  // (🆕🆕🆕 **D542 +1 sentence / +1 printing — THE OPPONENT-CHOSEN HAND SHUFFLE** — `censusAttackCorpus.ts` **file line 665** (`legalAttackCorpus()` index 612, leading count column `1`), *“Your opponent chooses 3 cards from their hand and shuffles those cards into their deck.”*, **1 sentence / 1 legal printing**, claimed WHOLE by `deriveAttackEffect` through ONE new anchor and ONE new arm returning a COMPOSITION of two shipped ops — so it leaves through the RAW READER summand and the registry / gate-split / trailing-split summands all stand still. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1, WHICH IS THE ONE CASE WHERE A COPIED NUMBER IS RIGHT BY ACCIDENT — so THIS SITE WAS MEASURED rather than inherited from its neighbour** (D426/D451).)  (🆕🆕🆕 **D540 +1 sentence / +1 printing — THE DEVOLUTION WITH A PICK IN IT, AND THE `/[Dd]evolv/` FAMILY CLOSES** — `censusAttackCorpus.ts` **row 87** (`legalAttackCorpus()` index 34, leading count column `1`), *"Devolve 1 of your opponent's evolved Pokémon by putting the highest Stage Evolution card on it into your opponent's hand."*, **1 sentence / 1 legal printing** (no card id resolves on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrators `d540-*`), claimed by `deriveAttackEffect` through ONE new anchor `DEVOLVE_CHOSEN_TO_HAND` and arm 41-ter into ONE new FIELD-FREE `EffectOp` member `devolveChosen` — a READER move: reader arm 564/1613 → 565/1614, raw residue 76/119 → 75/118, `BUILT.attack` 1664 → 1665, residue 49/68 → 48/67; registry 10/16, gate 6/14, trailing 11/21, `SPLIT_ATTACK_UNITS` 14, `COMPOUND_ATTACK_UNITS` 21 and `attackReaderSurface()` 13 UNMOVED; engine 0.424.0 → 0.425.0, `MATCH_RECORD_VERSION` HELD at 30 (D125's widening at a persisted address — and this op DOES park, so a record really can hold it, which is why the version claim rests on the widening and not on parking). ⚠️ THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 1 — they AGREE for the first time in six slices, which is the one case where a copied number would be right by accident, so every site was measured.)  // (🆕🆕🆕 **D539 +1 sentence / +2 printings — THE NAMED-BODY MULTIPLIER WITH A NAMED-BODY OWN-SIDE SPREAD BEHIND IT** — `censusAttackCorpus.ts` **FILE LINE 595** (`legalAttackCorpus()` index 542), *"This attack does 50 damage for each of your Drifloon and Drifblim in play. This attack also does 30 damage to each of your Drifloon and Drifblim. (Don't apply Weakness and Resistance for Benched Pokémon.)"*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrators `d539-*`), claimed by TWO readers off ONE `effect` string through ONE new whole-compound anchor carrying a `\2` BACKREFERENCE (`NAMED_BODIES_MULTIPLY_SPREAD`) — `deriveAttackDamageMultiplier` for the × fold and `deriveAttackEffect` for `damageChosen` with the FOURTH `target` member `yourAny` and `count: "all"`, plus the NINTH `IN_PLAY_BODY_NOUNS` exact key — a READER move: reader arm 563/1611 → 564/1613, raw residue 77/121 → 76/119, `BUILT.attack` 1662 → 1664; registry 10/16, gate 6/14, trailing 11/21, `SPLIT_ATTACK_UNITS` 14, `COMPOUND_ATTACK_UNITS` 21 and `attackReaderSurface()` 13 UNMOVED; engine 0.423.0 → 0.424.0, `MATCH_RECORD_VERSION` HELD at 30 (a WIDENING at a persisted address, D125's free case — and `count: "all"` NEVER PARKS, so no record that can exist holds the new value). ⚠️ THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — they disagree for the FIFTH slice running (D535 1-vs-2, D536 1-vs-3, D537 1-vs-2, D538 1-vs-3), so a pass that copied one number into the other kind of site would be wrong in half of them. THIS SITE: 77/121 → 76/119.)  // (🆕🆕🆕 **D538 −1 sentence / −3 printings — THE COUNTER PLACEMENT WHOSE AMOUNT IS A PAYLOAD AND WHOSE TAIL SHUFFLES THE VERY CARDS IT COUNTED** — `censusAttackCorpus.ts` **FILE LINE 412** (`legalAttackCorpus()` index 359), *"Put 2 damage counters on 1 of your opponent's Pokémon for each Basic {G} Energy card in your discard pile. Then, shuffle those Energy cards into your deck."*, **1 sentence / 3 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrator `d538-pile-sniper`), claimed by `deriveAttackEffect` through ONE new whole-sentence TWO-capture anchor (`COUNTER_PUT_SCALED_BY_PILE`, declared with the counter-put family, ONE `['’]` slot) as arm **23b-bis** emitting THREE ops — `damageChosen{perDiscardPileCard}` + `discardPileRetrieval{max:"all"}` + `shuffleDeck`, with ONE `CardFilter` object shared by the first two — a READER move: reader arm 562/1608 → 563/1611, raw residue 78/124 → 77/121, `BUILT.attack` 1659 → 1662; registry 10/16, gate 6/14, trailing 11/21, `SPLIT_ATTACK_UNITS` 14 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED; engine 0.422.0 → 0.423.0, `MATCH_RECORD_VERSION` HELD at 30 (a NEW OPTIONAL KEY is D125's WIDENING and `max: "all"` is a PURE ADDITION to a value domain — and BOTH bytes are written into the record, through `phase.cont.pendingOp` and `phase.cont.rest` respectively). ⚠️ THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 3 — they disagree for the FOURTH slice running (D535 1-vs-2, D536 1-vs-3, D537 1-vs-2), so a pass that copied one number into the other kind of site would be wrong in half of them. THIS SITE: 78/124 → 77/121.)  // (🆕🆕🆕 **D537 −1 sentence / −2 printings — KEEP THREE, SHUFFLE THE REST: THE ONLY SENTENCE IN THIS CORPUS WHOSE PICK NAMES THE BODIES THAT *STAY* — ONE NEW `EffectOp` MEMBER `returnBenchedRest` AND ONE INTERPRETER WRITER** — `censusAttackCorpus.ts` **FILE LINE 84** (`legalAttackCorpus()` index 31), *"Choose 3 of your opponent's Benched Pokémon. If you do, shuffle all of your opponent's Benched Pokémon that you didn't choose, and all cards attached to those Pokémon, into their deck."*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrator `d537-bencher`), claimed by `deriveAttackEffect` through ONE new ONE-capture whole-sentence anchor (`CHOOSE_KEEP_SHUFFLE_REST`, beside `RETURN_BENCHED`, THREE `['’]` slots — two possessives AND the contraction in "didn't") as arm **42-bis** emitting ONE `returnBenchedRest{keep:3}` — a READER move: reader arm 561/1606 → 562/1608, raw residue 79/126 → 78/124, `BUILT.attack` 1657 → 1659; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.421.0 → 0.422.0, `MATCH_RECORD_VERSION` HELD at 30 (a new op MEMBER is D125's WIDENING — and this op PARKS, so the byte IS written into `phase.cont.pendingOp`). ⚠️ THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — they disagree for the third slice running (D535 1-vs-2, D536 1-vs-3), so a pass that copied one number into the other kind of site would be wrong in half of them. THIS SITE: 79/126 → 78/124.)  // (🆕🆕🆕 **D536 −1 sentence / −3 printings — THE BODY THAT LEAVES PLAY WITHOUT BEING KNOCKED OUT — ONE NEW FIELD-FREE `EffectOp` MEMBER `discardDefender` AND ONE INTERPRETER WRITER** — `censusAttackCorpus.ts` **FILE LINE 100** (`legalAttackCorpus()` index 47), *"Discard a Team Rocket's Energy from this Pokémon. If you do, discard your opponent's Active Pokémon and all attached cards."*, **1 sentence / 3 legal printings** (Moltres ex `sv10-031`/`-208`/`-229` — the ids ARE resolved on this checkout and are used as ids; the printed BASE DAMAGE is NOT, so it is driven on the file-local declared demonstrator `d536-moltres`, D425), claimed by `deriveAttackEffect` through ONE new ZERO-capture anchor (`TR_ENERGY_COST_THEN_DISCARD_DEFENDER`, beside `HAND_COST_THEN_OPPONENT_DISCARD`) as `discardEnergy{from:"yourActive", filter:{byName "Team Rocket's Energy"}, recordAs:"discarded"}` gated through the FIRST shipped `recordGate{slot:"discarded"}` into the new `discardDefender` — a READER move: reader arm 560/1603 → 561/1606, raw residue 80/129 → 79/126, `BUILT.attack` 1654 → 1657; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.420.0 → 0.421.0, `MATCH_RECORD_VERSION` HELD at 30 (a new op MEMBER is D125's WIDENING; the op never parks and is FIELD-FREE). ⚠️ THE SENTENCE STEP AND THE PRINTING STEP DISAGREE AT 1 AND 3 — harder than D535's 1-and-2, so a pass that copied one number into the other kind of site would be wrong in half of them. THIS SITE: 80/129 → 79/126.)  // (🆕🆕🆕 **D535 −1 sentence / −2 printings — THE PICK-WITH-REPLACEMENT SNIPE — ZERO NEW VOCABULARY: SIX `damageChosen` OPS AT `count: 1`, THE LITERAL `CHOSEN_ANY_TARGET` ALREADY AUTHORS** — `censusAttackCorpus.ts` **FILE LINE 81** (`legalAttackCorpus()` index 28), *"Choose 1 of your opponent's Pokémon 6 times. (You can choose the same Pokémon more than once.) For each time you chose a Pokémon, do 20 damage to it. This damage isn't affected by Weakness or Resistance."*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — no D1, no catalog sqlite — stated unresolved, never invented, D425), claimed by `deriveAttackEffect` through ONE new TWO-capture anchor (`ATTACK_PICK_WITH_REPLACEMENT_SNIPE`, beside `CHOSEN_ANY_TARGET`) as SIX `damageChosen{target:"opponentAny", amount:20, count:1, source:"attack", deals, ignoreWR}` parks — a READER move: reader arm 559/1601 → 560/1603, raw residue 81/131 → 80/129; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.419.0 → 0.420.0, `MATCH_RECORD_VERSION` HELD at 30 (D237's POPULATION change — the op literal already ships, so the serialized alphabet does not grow). ⚠️ THE SENTENCE STEP AND THE PRINTING STEP DISAGREE AT 1 AND 2 — the legal column prints this sentence TWICE.)  // (🆕🆕🆕 **D534 −1 sentence / −1 printing — THE ONE-CARD LOOK AT THE OPPONENT's DECK WITH A PRINTED SHUFFLE — `shuffleDeck` GAINS THE OPTIONAL KEY `whose: "opponent"` and `reorderTop` PARKS A ONE-CARD WINDOW WHEN ITS TWO ARMS DIFFER** — `censusAttackCorpus.ts` **FILE LINE 401**, *"Look at the top card of your opponent's deck. You may have your opponent shuffle their deck."*, **1 sentence / 1 legal printing** (Inkay `sv06.5-033`; no id on this checkout, D425), claimed by `deriveAttackEffect` through ONE new zero-capture anchor (`ATTACK_OPPONENT_TOP_LOOK_SHUFFLE`, beside `ATTACK_REORDER_TOP`) as `reorderTop{n:1, side:"opponent", otherwise:[shuffleDeck{whose:"opponent"}]}` — a READER move: reader arm 558/1600 → 559/1601, raw residue 82/132 → 81/131; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.418.0 → 0.419.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1.)  // (🆕🆕🆕 **D532 −1 sentence / −1 printing — THE CROSS-SEAT DISCARD-PILE ATTACH — `attachEnergyFrom` GAINS THE OPTIONAL KEY `whose: "opponent"` (on the op AND on `AttachTargetRiders`, read through ONE resolver)** — `censusAttackCorpus.ts` **FILE LINE 70** (`legalAttackCorpus()` index 17), *"Attach up to 3 Energy cards from your opponent's discard pile to their Pokémon in any way you like."*, **1 sentence / 1 legal printing** (Grafaiai `sv08-121`; no id on this checkout, D425), claimed by `deriveAttackEffect` through ONE new zero-capture anchor (`ATTACK_OPPONENT_DISCARD_ATTACH`, beside the factory-built `DISCARD_ATTACH`) as D360's spread ONE KEY OVER — a READER move: reader arm 557/1599 → 558/1600, raw residue 83/133 → 82/132; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.417.0 → 0.418.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1.)  // (🆕🆕🆕 **D531 −1 sentence / −1 printing — THE BOARD-TYPED HAND SEARCH — `searchDeck` GAINS THE PARK-TIME RIDER `typedAsAttachedBasicEnergy`** — `censusAttackCorpus.ts` **FILE LINE 483** (`legalAttackCorpus()` index 430), *"Search your deck for up to 5 Pokémon that are the same type as any Basic Energy attached to this Pokémon, reveal them, and put them into your hand. Then, shuffle your deck."*, **1 sentence / 1 legal printing** (sv07-065 per the retired D231 deferral; no id on this checkout, D425), claimed by `deriveAttackEffect` through ONE new zero-capture anchor (`ATTACK_HAND_SEARCH_TYPED_AS_ATTACHED`, beside `ATTACK_HAND_SEARCH_BENCH_COUNT`) whose rider the park resolves against the SOURCE body's attached Basic Energy — a READER move: reader arm 556/1598 → 557/1599, raw residue 84/134 → 83/133; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.416.0 → 0.417.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1.)
    expect(unbuilt.map(([, s]) => s)).not.toContain(PRINTED);
    // 🆕🆕🆕 D528 — was `toContain(ATTACH_TWIN)`: the twin LEFT the residue when it was built (corpus FILE
    // LINE 215, `headsCeilingDiscardAttach.test.ts`). Re-pointed, not deleted (D418).
    expect(unbuilt.map(([, s]) => s)).not.toContain(ATTACH_TWIN);
    // The parts add up to the whole quoted in the same case.
    const all = legalAttackCorpus();
    // 🆕🆕🆕 **D530 +1 sentence — THE TARGET-COUNTER-SCALED BENCH SNIPE — A FOURTH `damageChosen` RIDER, `perDamageCounterOnTarget`, READ PER REF AT THE ANSWER** — `censusAttackCorpus.ts` **FILE LINE 551** (`legalAttackCorpus()` index 498), *"This attack does 20 damage to 1 of your opponent's Benched Pokémon for each damage counter on that Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)"*, **1 sentence / 1 legal printing** (no id on this checkout, D425), claimed by `deriveAttackEffect` through ONE new anchor (`BENCHED_SNIPE_TARGET_COUNTERS`, beside `BENCHED_SNIPE_TAKEN_PRIZES`, disjoint by TAIL) as arm 6b′ — a READER move: reader arm 555/1597 → 556/1598, raw residue 85/135 → 84/134; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.415.0 → 0.416.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1.
    // 🆕🆕🆕 D528 +1 sentence (THE HEADS-CEILINGED DISCARD-TO-BENCH ENERGY ATTACH — THE ATTACH TWIN OF D525, ZERO VOCABULARY, NO NEW `AttackCoinFlip` MEMBER — corpus FILE LINE 215, *"Flip 3 coins. Attach a number of Basic {L} Energy cards up to the number of heads from your discard pile to your Benched Pokémon in any way you like."*, 1 legal printing, claimed by `deriveAttackCoinFlip` as `programPerHeads` over ONE copy of D358's discard-spread op, H declinable parks at the existing fold, ZERO new vocabulary, no fold/interpreter bytes; the sentence and printing steps AGREE at 1): 554 → 555. Stepped by hand (outside the annotated-chain sweep's shape).
    expect(unbuilt.length + 600).toBe(all.length);  // (🆕🆕🆕 **D579 599 → 600** — the reader summand gains Koraidon `sv08-116`; the sum still closes on the 640-sentence column.) (🆕🆕🆕 **D575 +6 sentences / +6 printings — THE MRV-38 ATTACK SLICE** — `deriveAttackEffect`'s six new whole-sentence anchors claim `censusAttackCorpus.ts` file lines 177 (Hypno "Daydream"), 181 (Miraidon "C.O.D.E.: Protect"), 182 (Iron Moth "Anachronism Repulsor"), 346 (N's Sigilyph "Victory Symbol"), 394 (Team Rocket's Blipbug "Searching Eyes") and 690 (Glimmora "Corrosive Shards", the compound claimed WHOLE) — one printing each, so the sentence and printing steps AGREE. A READER move.) (🆕🆕🆕 **D574 +3 sentences / +5 printings — THE COPY-FAMILY REMAINDER + SABLEYE** — `deriveAttackCopy`'s two RESOLVE-TIME anchors claim `censusAttackCorpus.ts` file lines 434 and 131 WHOLE (Haughty Order ×3, Seek Inspiration) and `deriveAttackEffect`'s new anchor claims file line 649 (Sableye "Damage Collection"). Alakazam (686) composes through the TRAILING seam and Malamar (489) is a REGISTRY row — neither is a reader move. A READER move; the sentence step (3) and the printing step (5) DISAGREE, so each site was classified by its unit.) (🆕🆕🆕 **D573 +4 sentences / +9 printings — THE COPY-ATTACK SUBSTITUTION** — `deriveAttackCopy`, the FOURTEENTH reader, claims `censusAttackCorpus.ts` file lines 77, 78, 80 and 245 WHOLE: Night Joker ×4, Foul Play ×2 + Metronome, Gemstone Mimicry, Try to Imitate. A READER move; the sentence step (4) and the printing step (9) DISAGREE, so each site was classified by its unit.) (🆕🆕🆕 **D569 +4 sentences — THE PARADOX BANNER READERS** (Koraidon ×2, Roaring Moon ×2, Iron Valiant, Slither Wing); the offset gains four.) (🆕🆕🆕 **D568 +2 sentences / +2 printings — THE TWO TERA CLAUSES** (Ho-Oh `sv08-019`, Regigigas `sv08.5-086`), two literal rows over `banners.ts`; this suite's own row is unmoved.) (🆕🆕🆕 **D552 +2 sentences / +2 printings — THE PRE-DAMAGE SELF ATTACH BEHIND A MULTIPLIER HEAD, AND THE WEAKNESS RETYPE** — `censusAttackCorpus.ts` **file lines 569 and 629** (leading count column `1` each; card ids UNRESOLVED on this checkout — measured, never invented, D425): `:569` claimed WHOLE by `deriveAttackDiscardScaledBoost`'s THIRD member `selfHandAttach` (attach-then-damage inside the program), `:629` by `deriveAttackEffect` through ONE new anchor `DEFENDER_WEAKNESS_RETYPED` as ONE new op `retypeDefenderWeakness` — a READER move: reader arm 578/1632 → 580/1634, raw residue 62/100 → 60/98, `BUILT.attack` 1688 → 1690; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.435.0 → 0.436.0, `MATCH_RECORD_VERSION` 33 → 34. ⚠️ THE SENTENCE STEP (2) AND THE PRINTING STEP (2) AGREE this slice — the case where a copied number is right BY ACCIDENT, so every site was classified by the quantity its D550 note names (D426/D451). THIS SITE: the partition summand 578 → 580.)  // (🆕🆕🆕 **D550 +1 sentence / +1 printing — THE OPPONENT-FLIPPED PER-TAILS SNIPE ON THE OPPONENT'S BENCH COUNT** — `censusAttackCorpus.ts` **file line 669** (leading count column `1`; card id UNRESOLVED on this checkout — measured, never invented, D425), claimed WHOLE by `deriveAttackCoinFlip` (a NINTH member `opponentPerTails` over a NULLARY `AttackFlipCount.opponentBench`) AND by `deriveAttackDamageSuppression`'s THIRD compound arm off ONE anchor, `ATTACK_OPPONENT_BENCH_TAILS` — a READER move: reader arm 577/1631 → 578/1632, raw residue 63/101 → 62/100, `BUILT.attack` 1687 → 1688, PHRASE-24 1/1 → 0/0; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.434.0 → 0.435.0, `MATCH_RECORD_VERSION` HOLDS at 33. ⚠️ THE SENTENCE STEP (1) AND THE PRINTING STEP (1) AGREE this slice — the case where a copied number is right BY ACCIDENT, so every site was classified by the quantity its D549 note names (D426/D451). THIS SITE: the partition summand 577 → 578.)  // (🆕🆕🆕 **D549 +4 sentences / +4 printings — THE DEFENDER'S NEXT-TURN MARKS AND THE SIDE-WIDE ATTACK LOCK** — `censusAttackCorpus.ts` **file lines 171, 149, 169 and 170** (leading count column `1` each; card ids UNRESOLVED on this checkout — measured, never invented, D425), claimed WHOLE by `deriveAttackEffect` alone through FOUR new anchors as THREE new ops (`taxDefender`, `bountyDefender`, `lockSideAttacks`) — a READER move: reader arm 573/1627 → 577/1631, raw residue 67/105 → 63/101, `BUILT.attack` 1683 → 1687; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.433.0 → 0.434.0, `MATCH_RECORD_VERSION` 32 → 33. ⚠️ THE SENTENCE STEP (4) AND THE PRINTING STEP (4) AGREE this slice — the case where a copied number is right BY ACCIDENT, so every site was classified by the quantity its D548 note names (D426/D451). THIS SITE: the partition summand 573 → 577.)  // (🆕🆕🆕 **D548 +1 sentence / +2 printings — CRESCENT PURGE, THE FACE-UP PRIZE** — `censusAttackCorpus.ts` **file line 664**, Cresselia `sv06.5-021` "Crescent Purge", claimed WHOLE by `deriveAttackOptionalCostBoost`'s FIFTH cost row (`turnPrizeFaceUp` behind `yourFaceDownPrizeRemains`); engine 0.432.0 → 0.433.0, `MATCH_RECORD_VERSION` 31 → 32. ⚠️ THE SENTENCE STEP (1) AND THE PRINTING STEP (2) DIFFER. THIS SITE: the partition summand 572 → 573.)  // (🆕🆕🆕 **D547 +2 sentences / +4 printings — THE FLIP-TO-ATTACK LOCK AND THE NEXT-TURN VULNERABILITY** — `censusAttackCorpus.ts` **file lines 176 and 150** (leading count column `2` each), *“During your opponent's next turn, if the Defending Pokémon tries to use an attack, your opponent flips a coin. If tails, that attack doesn't happen.”* (TWO sentences in ONE row) and *“During your next turn, the Defending Pokémon takes 50 more damage from attacks (after applying Weakness and Resistance).”*, **2 rows / 4 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so both suites ride file-local declared `d547-*` demonstrators), claimed WHOLE by `deriveAttackEffect` through TWO new anchors (`DEFENDER_FLIP_ATTACK_LOCK`, `DEFENDER_VULNERABLE_NEXT_TURN`) as TWO new ops (`flipLockAttack`, `exposeDefender`) on TWO new REQUIRED `InPlayPokemon` fields — a READER move: reader arm 570/1621 → 572/1625, raw residue 70/111 → 68/107, `BUILT.attack` 1677 → 1681; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.431.0 → 0.432.0, `MATCH_RECORD_VERSION` 30 → 31. ⚠️ **THE SENTENCE STEP (2) AND THE PRINTING STEP (4) DIFFER**, so no copied number is right by accident; every site was classified by the quantity its D546 note names (D426/D451). THIS SITE: the partition summand 570 → 572 (unbuilt + resolved = 640).)  // (🆕🆕🆕 **D546 +2 sentences / +2 printings — THE ALL-ATTACKS NEXT-TURN BUFF** — `censusAttackCorpus.ts` **file lines 76 and 148** (leading count column `1` each), *“During your next turn, attacks used by this Pokémon do 120 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance).”* and the same sentence at 100 behind *“Both Active Pokémon are now Asleep.”*, **2 sentences / 2 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so the suite rides file-local declared `d546-*` demonstrators), claimed WHOLE by `deriveAttackEffect` through ONE new whole-sentence anchor (`SELF_EVERY_ATTACK_BOOST`, ONE `['’]` slot, an optional Sleep prefix) as `attack: null` on the SHIPPED `boostAttack` op — no new `EffectOp` member, no new `InPlayPokemon` field — a READER move: reader arm 568/1619 → 570/1621, raw residue 72/113 → 70/111, `BUILT.attack` 1675 → 1677; registry 10/16, gate 9/19, trailing 11/21, `SPLIT_ATTACK_UNITS` 19 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED (19 READ at `censusAtHead.test.ts:8169`); engine 0.430.0 → 0.431.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP ARE BOTH 2 — THE ONE SHAPE WHERE A COPIED NUMBER IS RIGHT BY ACCIDENT**, so every site was measured by the quantity it pins, not copied (D426/D451). THIS SITE: the partition summand 568 → 570 (unbuilt + resolved = 640).)  // (🆕🆕🆕 **D544 +1 sentence / +2 printings — THE NAMED ATTACK'S BASE DAMAGE, OVERRIDDEN FOR ONE WINDOW** — `censusAttackCorpus.ts` **file line 166** (leading count column `2`), *“During your next turn, this Pokémon's Hyper Fang attack's base damage is 240.”*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so the suite rides the file-local declared demonstrator `d544-fang`), claimed WHOLE by `deriveAttackEffect` through ONE new whole-sentence anchor (`SELF_ATTACK_BASE_SET`, TWO `['’]` slots, name and number CAPTURED) as a `base: true` RIDER on the SHIPPED `boostAttack` op — no new `EffectOp` member, no new `InPlayPokemon` field — a READER move: reader arm 567/1617 → 568/1619, raw residue 73/115 → 72/113, `BUILT.attack` 1671 → 1673; registry 10/16, gate 7/17, trailing 11/21, `SPLIT_ATTACK_UNITS` 17 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED (17 READ at `censusAtHead.test.ts:8159` — the “14” in D543's annotation beside this one has been stale since D541 moved the constant); engine 0.428.0 → 0.429.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — THEY DISAGREE**, so no number may be copied from one kind of site into another (D426/D451). THIS SITE: the partition summand 567 → 568 (unbuilt + resolved = 640).)  // (🆕🆕🆕 **D543 +1 sentence / +2 printings — THE CHOSEN POKÉMON TOOL DISCARD AT THE PROGRAM TAIL** — `censusAttackCorpus.ts` **file line 136** (leading count column `2`), *“Discard up to 2 Pokémon Tools from your opponent's Pokémon.”*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrator `d543-stripper`), claimed WHOLE by `deriveAttackEffect` through ONE new whole-sentence anchor (`ATTACK_DISCARD_TOOLS_UP_TO`, ONE `['’]` slot at index 48, count CAPTURED) as ONE new `EffectOp` member `discardTools{count}` parking on ONE new `EffectPrompt` kind — a READER move: reader arm 566/1615 → 567/1617, raw residue 74/117 → 73/115, `BUILT.attack` 1669 → 1671; registry 10/16, gate 7/17, trailing 11/21, `SPLIT_ATTACK_UNITS` 14 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED; engine 0.427.0 → 0.428.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — THEY DISAGREE**, so no number may be copied from one kind of site into another (D426/D451). THIS SITE: the partition summand 566 → 567 (unbuilt + resolved = 640).)  // (🆕🆕🆕 **D542 +1 sentence / +1 printing — THE OPPONENT-CHOSEN HAND SHUFFLE** — `censusAttackCorpus.ts` **file line 665** (`legalAttackCorpus()` index 612, leading count column `1`), *“Your opponent chooses 3 cards from their hand and shuffles those cards into their deck.”*, **1 sentence / 1 legal printing**, claimed WHOLE by `deriveAttackEffect` through ONE new anchor and ONE new arm returning a COMPOSITION of two shipped ops — so it leaves through the RAW READER summand and the registry / gate-split / trailing-split summands all stand still. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1, WHICH IS THE ONE CASE WHERE A COPIED NUMBER IS RIGHT BY ACCIDENT — so THIS SITE WAS MEASURED rather than inherited from its neighbour** (D426/D451).)  (🆕🆕🆕 **D540 +1 sentence / +1 printing — THE DEVOLUTION WITH A PICK IN IT, AND THE `/[Dd]evolv/` FAMILY CLOSES** — `censusAttackCorpus.ts` **row 87** (`legalAttackCorpus()` index 34), *"Devolve 1 of your opponent's evolved Pokémon by putting the highest Stage Evolution card on it into your opponent's hand."*, **1 sentence / 1 legal printing**, claimed by `deriveAttackEffect` through ONE new anchor `DEVOLVE_CHOSEN_TO_HAND` and arm 41-ter into ONE new FIELD-FREE `EffectOp` member `devolveChosen`. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 for the first time in six slices — the one case where a copied number is right by accident, so THIS SITE was measured off the live failure and never copied from a neighbour.)  // (🆕🆕🆕 **D539 +1 sentence — THE NAMED-BODY MULTIPLIER WITH A NAMED-BODY OWN-SIDE SPREAD BEHIND IT** — `censusAttackCorpus.ts` **FILE LINE 595** (`legalAttackCorpus()` index 542), *"This attack does 50 damage for each of your Drifloon and Drifblim in play. This attack also does 30 damage to each of your Drifloon and Drifblim. (Don't apply Weakness and Resistance for Benched Pokémon.)"*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrators `d539-*`), claimed by TWO readers off ONE `effect` string through ONE new whole-compound anchor carrying a `\2` BACKREFERENCE (`NAMED_BODIES_MULTIPLY_SPREAD`) — `deriveAttackDamageMultiplier` for the × fold and `deriveAttackEffect` for `damageChosen` with the FOURTH `target` member `yourAny` and `count: "all"`, plus the NINTH `IN_PLAY_BODY_NOUNS` exact key — a READER move: reader arm 563/1611 → 564/1613, raw residue 77/121 → 76/119, `BUILT.attack` 1662 → 1664; registry 10/16, gate 6/14, trailing 11/21, `SPLIT_ATTACK_UNITS` 14, `COMPOUND_ATTACK_UNITS` 21 and `attackReaderSurface()` 13 UNMOVED; engine 0.423.0 → 0.424.0, `MATCH_RECORD_VERSION` HELD at 30 (a WIDENING at a persisted address, D125's free case — and `count: "all"` NEVER PARKS). ⚠️ THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — they disagree for the FIFTH slice running (D535 1-vs-2, D536 1-vs-3, D537 1-vs-2, D538 1-vs-3). THIS SITE: a LIVE ADDEND at the FRONT (D461's table: the tell is the left-hand side), 563 → 564.)  // (🆕🆕🆕 **D538 +1 sentence — THE COUNTER PLACEMENT WHOSE AMOUNT IS A PAYLOAD AND WHOSE TAIL SHUFFLES THE VERY CARDS IT COUNTED** — `censusAttackCorpus.ts` **FILE LINE 412** (`legalAttackCorpus()` index 359), *"Put 2 damage counters on 1 of your opponent's Pokémon for each Basic {G} Energy card in your discard pile. Then, shuffle those Energy cards into your deck."*, **1 sentence / 3 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrator `d538-pile-sniper`), claimed by `deriveAttackEffect` through ONE new whole-sentence TWO-capture anchor (`COUNTER_PUT_SCALED_BY_PILE`, declared with the counter-put family, ONE `['’]` slot) as arm **23b-bis** emitting THREE ops — `damageChosen{perDiscardPileCard}` + `discardPileRetrieval{max:"all"}` + `shuffleDeck`, with ONE `CardFilter` object shared by the first two — a READER move: reader arm 562/1608 → 563/1611, raw residue 78/124 → 77/121, `BUILT.attack` 1659 → 1662; registry 10/16, gate 6/14, trailing 11/21, `SPLIT_ATTACK_UNITS` 14 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED; engine 0.422.0 → 0.423.0, `MATCH_RECORD_VERSION` HELD at 30 (a NEW OPTIONAL KEY is D125's WIDENING and `max: "all"` is a PURE ADDITION to a value domain — and BOTH bytes are written into the record, through `phase.cont.pendingOp` and `phase.cont.rest` respectively). ⚠️ THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 3 — they disagree for the FOURTH slice running (D535 1-vs-2, D536 1-vs-3, D537 1-vs-2), so a pass that copied one number into the other kind of site would be wrong in half of them. THIS SITE: ⚠️ A TAIL A NUMERIC READER CANNOT SEE, STEPPED BY HAND (D426) — + 562 → + 563. SENTENCES, so the step is 1.)  // (🆕🆕🆕 **D537 +1 sentence — KEEP THREE, SHUFFLE THE REST: THE ONLY SENTENCE IN THIS CORPUS WHOSE PICK NAMES THE BODIES THAT *STAY* — ONE NEW `EffectOp` MEMBER `returnBenchedRest` AND ONE INTERPRETER WRITER** — `censusAttackCorpus.ts` **FILE LINE 84** (`legalAttackCorpus()` index 31), *"Choose 3 of your opponent's Benched Pokémon. If you do, shuffle all of your opponent's Benched Pokémon that you didn't choose, and all cards attached to those Pokémon, into their deck."*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrator `d537-bencher`), claimed by `deriveAttackEffect` through ONE new ONE-capture whole-sentence anchor (`CHOOSE_KEEP_SHUFFLE_REST`, beside `RETURN_BENCHED`, THREE `['’]` slots — two possessives AND the contraction in "didn't") as arm **42-bis** emitting ONE `returnBenchedRest{keep:3}` — a READER move: reader arm 561/1606 → 562/1608, raw residue 79/126 → 78/124, `BUILT.attack` 1657 → 1659; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.421.0 → 0.422.0, `MATCH_RECORD_VERSION` HELD at 30 (a new op MEMBER is D125's WIDENING — and this op PARKS, so the byte IS written into `phase.cont.pendingOp`). ⚠️ THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — they disagree for the third slice running (D535 1-vs-2, D536 1-vs-3), so a pass that copied one number into the other kind of site would be wrong in half of them. THIS SITE: ⚠️ A FROZEN TAIL A NUMERIC READER CANNOT SEE, STEPPED BY HAND (D426) — 561 → 562.)  // (🆕🆕🆕 **D536 +1 sentence — THE BODY THAT LEAVES PLAY WITHOUT BEING KNOCKED OUT — ONE NEW FIELD-FREE `EffectOp` MEMBER `discardDefender` AND ONE INTERPRETER WRITER** — `censusAttackCorpus.ts` **FILE LINE 100** (`legalAttackCorpus()` index 47), *"Discard a Team Rocket's Energy from this Pokémon. If you do, discard your opponent's Active Pokémon and all attached cards."*, **1 sentence / 3 legal printings** (Moltres ex `sv10-031`/`-208`/`-229`), claimed by `deriveAttackEffect` through arm 44c over ONE new zero-capture anchor `TR_ENERGY_COST_THEN_DISCARD_DEFENDER` — a READER move: reader arm 560/1603 → 561/1606, raw residue 80/129 → 79/126, `BUILT.attack` 1654 → 1657; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.420.0 → 0.421.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 3 — they disagree HARDER than D535's 1-vs-2. THIS SITE: 561 → 562.)  // (🆕🆕🆕 **D535 +1 sentence / +2 printings — THE PICK-WITH-REPLACEMENT SNIPE — ZERO NEW VOCABULARY: SIX `damageChosen` OPS AT `count: 1`, THE LITERAL `CHOSEN_ANY_TARGET` ALREADY AUTHORS** — `censusAttackCorpus.ts` **FILE LINE 81** (`legalAttackCorpus()` index 28), *"Choose 1 of your opponent's Pokémon 6 times. (You can choose the same Pokémon more than once.) For each time you chose a Pokémon, do 20 damage to it. This damage isn't affected by Weakness or Resistance."*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — no D1, no catalog sqlite — stated unresolved, never invented, D425), claimed by `deriveAttackEffect` through ONE new TWO-capture anchor (`ATTACK_PICK_WITH_REPLACEMENT_SNIPE`, beside `CHOSEN_ANY_TARGET`) as SIX `damageChosen{target:"opponentAny", amount:20, count:1, source:"attack", deals, ignoreWR}` parks — a READER move: reader arm 559/1601 → 560/1603, raw residue 81/131 → 80/129; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.419.0 → 0.420.0, `MATCH_RECORD_VERSION` HELD at 30 (D237's POPULATION change — the op literal already ships, so the serialized alphabet does not grow). ⚠️ THE SENTENCE STEP AND THE PRINTING STEP DISAGREE AT 1 AND 2 — the legal column prints this sentence TWICE.)  // (🆕🆕🆕 **D534 +1 sentence / +1 printing — THE ONE-CARD LOOK AT THE OPPONENT's DECK WITH A PRINTED SHUFFLE — `shuffleDeck` GAINS THE OPTIONAL KEY `whose: "opponent"` and `reorderTop` PARKS A ONE-CARD WINDOW WHEN ITS TWO ARMS DIFFER** — `censusAttackCorpus.ts` **FILE LINE 401**, *"Look at the top card of your opponent's deck. You may have your opponent shuffle their deck."*, **1 sentence / 1 legal printing** (Inkay `sv06.5-033`; no id on this checkout, D425), claimed by `deriveAttackEffect` through ONE new zero-capture anchor (`ATTACK_OPPONENT_TOP_LOOK_SHUFFLE`, beside `ATTACK_REORDER_TOP`) as `reorderTop{n:1, side:"opponent", otherwise:[shuffleDeck{whose:"opponent"}]}` — a READER move: reader arm 558/1600 → 559/1601, raw residue 82/132 → 81/131; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.418.0 → 0.419.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1.)  // (🆕🆕🆕 **D532 +1 sentence — THE CROSS-SEAT DISCARD-PILE ATTACH — `attachEnergyFrom` GAINS THE OPTIONAL KEY `whose: "opponent"` (on the op AND on `AttachTargetRiders`, read through ONE resolver)** — `censusAttackCorpus.ts` **FILE LINE 70** (`legalAttackCorpus()` index 17), *"Attach up to 3 Energy cards from your opponent's discard pile to their Pokémon in any way you like."*, **1 sentence / 1 legal printing** (Grafaiai `sv08-121`; no id on this checkout, D425), claimed by `deriveAttackEffect` through ONE new zero-capture anchor (`ATTACK_OPPONENT_DISCARD_ATTACH`, beside the factory-built `DISCARD_ATTACH`) as D360's spread ONE KEY OVER — a READER move: reader arm 557/1599 → 558/1600, raw residue 83/133 → 82/132; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.417.0 → 0.418.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1.)  // (🆕🆕🆕 **D531 +1 sentence — THE BOARD-TYPED HAND SEARCH — `searchDeck` GAINS THE PARK-TIME RIDER `typedAsAttachedBasicEnergy`** — `censusAttackCorpus.ts` **FILE LINE 483** (`legalAttackCorpus()` index 430), *"Search your deck for up to 5 Pokémon that are the same type as any Basic Energy attached to this Pokémon, reveal them, and put them into your hand. Then, shuffle your deck."*, **1 sentence / 1 legal printing** (sv07-065 per the retired D231 deferral; no id on this checkout, D425), claimed by `deriveAttackEffect` through ONE new zero-capture anchor (`ATTACK_HAND_SEARCH_TYPED_AS_ATTACHED`, beside `ATTACK_HAND_SEARCH_BENCH_COUNT`) whose rider the park resolves against the SOURCE body's attached Basic Energy — a READER move: reader arm 556/1598 → 557/1599, raw residue 84/134 → 83/133; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.416.0 → 0.417.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1.)
    // 🆕🆕🆕 **D530 +1 printing — THE TARGET-COUNTER-SCALED BENCH SNIPE — A FOURTH `damageChosen` RIDER, `perDamageCounterOnTarget`, READ PER REF AT THE ANSWER** — `censusAttackCorpus.ts` **FILE LINE 551** (`legalAttackCorpus()` index 498), *"This attack does 20 damage to 1 of your opponent's Benched Pokémon for each damage counter on that Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)"*, **1 sentence / 1 legal printing** (no id on this checkout, D425), claimed by `deriveAttackEffect` through ONE new anchor (`BENCHED_SNIPE_TARGET_COUNTERS`, beside `BENCHED_SNIPE_TAKEN_PRIZES`, disjoint by TAIL) as arm 6b′ — a READER move: reader arm 555/1597 → 556/1598, raw residue 85/135 → 84/134; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.415.0 → 0.416.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1.
    // 🆕🆕🆕 D528 +1 printing (THE HEADS-CEILINGED DISCARD-TO-BENCH ENERGY ATTACH — THE ATTACH TWIN OF D525, ZERO VOCABULARY, NO NEW `AttackCoinFlip` MEMBER — corpus FILE LINE 215, *"Flip 3 coins. Attach a number of Basic {L} Energy cards up to the number of heads from your discard pile to your Benched Pokémon in any way you like."*, 1 legal printing, claimed by `deriveAttackCoinFlip` as `programPerHeads` over ONE copy of D358's discard-spread op, H declinable parks at the existing fold, ZERO new vocabulary, no fold/interpreter bytes; the sentence and printing steps AGREE at 1): 1596 → 1597. Stepped by hand (outside the annotated-chain sweep's shape).
    expect(units(unbuilt) + 1663).toBe(units(all));  // (🆕🆕🆕 **D579 1662 → 1663** — the reader summand gains Koraidon `sv08-116`'s one printing; the sum still closes on the 1,732-printing column.) (🆕🆕🆕 **D575 +6 sentences / +6 printings — THE MRV-38 ATTACK SLICE** — `deriveAttackEffect`'s six new whole-sentence anchors claim `censusAttackCorpus.ts` file lines 177 (Hypno "Daydream"), 181 (Miraidon "C.O.D.E.: Protect"), 182 (Iron Moth "Anachronism Repulsor"), 346 (N's Sigilyph "Victory Symbol"), 394 (Team Rocket's Blipbug "Searching Eyes") and 690 (Glimmora "Corrosive Shards", the compound claimed WHOLE) — one printing each, so the sentence and printing steps AGREE. A READER move.) (🆕🆕🆕 **D574 +3 sentences / +5 printings — THE COPY-FAMILY REMAINDER + SABLEYE** — `deriveAttackCopy`'s two RESOLVE-TIME anchors claim `censusAttackCorpus.ts` file lines 434 and 131 WHOLE (Haughty Order ×3, Seek Inspiration) and `deriveAttackEffect`'s new anchor claims file line 649 (Sableye "Damage Collection"). Alakazam (686) composes through the TRAILING seam and Malamar (489) is a REGISTRY row — neither is a reader move. A READER move; the sentence step (3) and the printing step (5) DISAGREE, so each site was classified by its unit.) (🆕🆕🆕 **D573 +4 sentences / +9 printings — THE COPY-ATTACK SUBSTITUTION** — `deriveAttackCopy`, the FOURTEENTH reader, claims `censusAttackCorpus.ts` file lines 77, 78, 80 and 245 WHOLE: Night Joker ×4, Foul Play ×2 + Metronome, Gemstone Mimicry, Try to Imitate. A READER move; the sentence step (4) and the printing step (9) DISAGREE, so each site was classified by its unit.) (🆕🆕🆕 **D569 +6 printings — THE PARADOX BANNER READERS** (Koraidon ×2, Roaring Moon ×2, Iron Valiant, Slither Wing); the offset gains six.) (🆕🆕🆕 **D568 +2 printings — THE TWO TERA CLAUSES** (Ho-Oh `sv08-019`, Regigigas `sv08.5-086`); the offset gains two.) (🆕🆕🆕 **D552 +2 sentences / +2 printings — THE PRE-DAMAGE SELF ATTACH BEHIND A MULTIPLIER HEAD, AND THE WEAKNESS RETYPE** — `censusAttackCorpus.ts` **file lines 569 and 629** (leading count column `1` each; card ids UNRESOLVED on this checkout — measured, never invented, D425): `:569` claimed WHOLE by `deriveAttackDiscardScaledBoost`'s THIRD member `selfHandAttach` (attach-then-damage inside the program), `:629` by `deriveAttackEffect` through ONE new anchor `DEFENDER_WEAKNESS_RETYPED` as ONE new op `retypeDefenderWeakness` — a READER move: reader arm 578/1632 → 580/1634, raw residue 62/100 → 60/98, `BUILT.attack` 1688 → 1690; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.435.0 → 0.436.0, `MATCH_RECORD_VERSION` 33 → 34. ⚠️ THE SENTENCE STEP (2) AND THE PRINTING STEP (2) AGREE this slice — the case where a copied number is right BY ACCIDENT, so every site was classified by the quantity its D550 note names (D426/D451). THIS SITE: the PRINTINGS partition summand 1632 → 1634.)  // (🆕🆕🆕 **D550 +1 sentence / +1 printing — THE OPPONENT-FLIPPED PER-TAILS SNIPE ON THE OPPONENT'S BENCH COUNT** — `censusAttackCorpus.ts` **file line 669** (leading count column `1`; card id UNRESOLVED on this checkout — measured, never invented, D425), claimed WHOLE by `deriveAttackCoinFlip` (a NINTH member `opponentPerTails` over a NULLARY `AttackFlipCount.opponentBench`) AND by `deriveAttackDamageSuppression`'s THIRD compound arm off ONE anchor, `ATTACK_OPPONENT_BENCH_TAILS` — a READER move: reader arm 577/1631 → 578/1632, raw residue 63/101 → 62/100, `BUILT.attack` 1687 → 1688, PHRASE-24 1/1 → 0/0; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.434.0 → 0.435.0, `MATCH_RECORD_VERSION` HOLDS at 33. ⚠️ THE SENTENCE STEP (1) AND THE PRINTING STEP (1) AGREE this slice — the case where a copied number is right BY ACCIDENT, so every site was classified by the quantity its D549 note names (D426/D451). THIS SITE: the PRINTINGS partition summand 1631 → 1632.)  // (🆕🆕🆕 **D549 +4 sentences / +4 printings — THE DEFENDER'S NEXT-TURN MARKS AND THE SIDE-WIDE ATTACK LOCK** — `censusAttackCorpus.ts` **file lines 171, 149, 169 and 170** (leading count column `1` each; card ids UNRESOLVED on this checkout — measured, never invented, D425), claimed WHOLE by `deriveAttackEffect` alone through FOUR new anchors as THREE new ops (`taxDefender`, `bountyDefender`, `lockSideAttacks`) — a READER move: reader arm 573/1627 → 577/1631, raw residue 67/105 → 63/101, `BUILT.attack` 1683 → 1687; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.433.0 → 0.434.0, `MATCH_RECORD_VERSION` 32 → 33. ⚠️ THE SENTENCE STEP (4) AND THE PRINTING STEP (4) AGREE this slice — the case where a copied number is right BY ACCIDENT, so every site was classified by the quantity its D548 note names (D426/D451). THIS SITE: the PRINTINGS partition summand 1627 → 1631.)  // (🆕🆕🆕 **D548 +1 sentence / +2 printings — CRESCENT PURGE, THE FACE-UP PRIZE** — `censusAttackCorpus.ts` **file line 664**, Cresselia `sv06.5-021` "Crescent Purge", claimed WHOLE by `deriveAttackOptionalCostBoost`'s FIFTH cost row (`turnPrizeFaceUp` behind `yourFaceDownPrizeRemains`); engine 0.432.0 → 0.433.0, `MATCH_RECORD_VERSION` 31 → 32. ⚠️ THE SENTENCE STEP (1) AND THE PRINTING STEP (2) DIFFER. THIS SITE: the PRINTINGS partition summand 1625 → 1627.)  // (🆕🆕🆕 **D547 +2 sentences / +4 printings — THE FLIP-TO-ATTACK LOCK AND THE NEXT-TURN VULNERABILITY** — `censusAttackCorpus.ts` **file lines 176 and 150** (leading count column `2` each), *“During your opponent's next turn, if the Defending Pokémon tries to use an attack, your opponent flips a coin. If tails, that attack doesn't happen.”* (TWO sentences in ONE row) and *“During your next turn, the Defending Pokémon takes 50 more damage from attacks (after applying Weakness and Resistance).”*, **2 rows / 4 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so both suites ride file-local declared `d547-*` demonstrators), claimed WHOLE by `deriveAttackEffect` through TWO new anchors (`DEFENDER_FLIP_ATTACK_LOCK`, `DEFENDER_VULNERABLE_NEXT_TURN`) as TWO new ops (`flipLockAttack`, `exposeDefender`) on TWO new REQUIRED `InPlayPokemon` fields — a READER move: reader arm 570/1621 → 572/1625, raw residue 70/111 → 68/107, `BUILT.attack` 1677 → 1681; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.431.0 → 0.432.0, `MATCH_RECORD_VERSION` 30 → 31. ⚠️ **THE SENTENCE STEP (2) AND THE PRINTING STEP (4) DIFFER**, so no copied number is right by accident; every site was classified by the quantity its D546 note names (D426/D451). THIS SITE: the PRINTINGS partition summand 1621 → 1625 (unbuilt + resolved = 1,732).)  // (🆕🆕🆕 **D546 +2 sentences / +2 printings — THE ALL-ATTACKS NEXT-TURN BUFF** — `censusAttackCorpus.ts` **file lines 76 and 148** (leading count column `1` each), *“During your next turn, attacks used by this Pokémon do 120 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance).”* and the same sentence at 100 behind *“Both Active Pokémon are now Asleep.”*, **2 sentences / 2 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so the suite rides file-local declared `d546-*` demonstrators), claimed WHOLE by `deriveAttackEffect` through ONE new whole-sentence anchor (`SELF_EVERY_ATTACK_BOOST`, ONE `['’]` slot, an optional Sleep prefix) as `attack: null` on the SHIPPED `boostAttack` op — no new `EffectOp` member, no new `InPlayPokemon` field — a READER move: reader arm 568/1619 → 570/1621, raw residue 72/113 → 70/111, `BUILT.attack` 1675 → 1677; registry 10/16, gate 9/19, trailing 11/21, `SPLIT_ATTACK_UNITS` 19 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED (19 READ at `censusAtHead.test.ts:8169`); engine 0.430.0 → 0.431.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP ARE BOTH 2 — THE ONE SHAPE WHERE A COPIED NUMBER IS RIGHT BY ACCIDENT**, so every site was measured by the quantity it pins, not copied (D426/D451). THIS SITE: the PRINTINGS partition summand 1619 → 1621 (unbuilt + resolved = 1,732).)  // (🆕🆕🆕 **D544 +1 sentence / +2 printings — THE NAMED ATTACK'S BASE DAMAGE, OVERRIDDEN FOR ONE WINDOW** — `censusAttackCorpus.ts` **file line 166** (leading count column `2`), *“During your next turn, this Pokémon's Hyper Fang attack's base damage is 240.”*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so the suite rides the file-local declared demonstrator `d544-fang`), claimed WHOLE by `deriveAttackEffect` through ONE new whole-sentence anchor (`SELF_ATTACK_BASE_SET`, TWO `['’]` slots, name and number CAPTURED) as a `base: true` RIDER on the SHIPPED `boostAttack` op — no new `EffectOp` member, no new `InPlayPokemon` field — a READER move: reader arm 567/1617 → 568/1619, raw residue 73/115 → 72/113, `BUILT.attack` 1671 → 1673; registry 10/16, gate 7/17, trailing 11/21, `SPLIT_ATTACK_UNITS` 17 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED (17 READ at `censusAtHead.test.ts:8159` — the “14” in D543's annotation beside this one has been stale since D541 moved the constant); engine 0.428.0 → 0.429.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — THEY DISAGREE**, so no number may be copied from one kind of site into another (D426/D451). THIS SITE: the PRINTINGS partition summand 1617 → 1619 (unbuilt + resolved = 1,732).)  // (🆕🆕🆕 **D543 +1 sentence / +2 printings — THE CHOSEN POKÉMON TOOL DISCARD AT THE PROGRAM TAIL** — `censusAttackCorpus.ts` **file line 136** (leading count column `2`), *“Discard up to 2 Pokémon Tools from your opponent's Pokémon.”*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrator `d543-stripper`), claimed WHOLE by `deriveAttackEffect` through ONE new whole-sentence anchor (`ATTACK_DISCARD_TOOLS_UP_TO`, ONE `['’]` slot at index 48, count CAPTURED) as ONE new `EffectOp` member `discardTools{count}` parking on ONE new `EffectPrompt` kind — a READER move: reader arm 566/1615 → 567/1617, raw residue 74/117 → 73/115, `BUILT.attack` 1669 → 1671; registry 10/16, gate 7/17, trailing 11/21, `SPLIT_ATTACK_UNITS` 14 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED; engine 0.427.0 → 0.428.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — THEY DISAGREE**, so no number may be copied from one kind of site into another (D426/D451). THIS SITE: the PRINTINGS partition summand 1615 → 1617 (unbuilt + resolved = 1,732).)  // (🆕🆕🆕 **D542 +1 sentence / +1 printing — THE OPPONENT-CHOSEN HAND SHUFFLE** — `censusAttackCorpus.ts` **file line 665** (`legalAttackCorpus()` index 612, leading count column `1`), *“Your opponent chooses 3 cards from their hand and shuffles those cards into their deck.”*, **1 sentence / 1 legal printing**, claimed WHOLE by `deriveAttackEffect` through ONE new anchor and ONE new arm returning a COMPOSITION of two shipped ops — so it leaves through the RAW READER summand and the registry / gate-split / trailing-split summands all stand still. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1, WHICH IS THE ONE CASE WHERE A COPIED NUMBER IS RIGHT BY ACCIDENT — so THIS SITE WAS MEASURED rather than inherited from its neighbour** (D426/D451).)  (🆕🆕🆕 **D540 +1 sentence / +1 printing — THE DEVOLUTION WITH A PICK IN IT, AND THE `/[Dd]evolv/` FAMILY CLOSES** — `censusAttackCorpus.ts` **row 87** (`legalAttackCorpus()` index 34), *"Devolve 1 of your opponent's evolved Pokémon by putting the highest Stage Evolution card on it into your opponent's hand."*, **1 sentence / 1 legal printing**, claimed by `deriveAttackEffect` through ONE new anchor `DEVOLVE_CHOSEN_TO_HAND` and arm 41-ter into ONE new FIELD-FREE `EffectOp` member `devolveChosen`. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 for the first time in six slices — the one case where a copied number is right by accident, so THIS SITE was measured off the live failure and never copied from a neighbour.)  🆕🆕🆕 **D539 +2 printings — THE NAMED-BODY MULTIPLIER WITH A NAMED-BODY OWN-SIDE SPREAD BEHIND IT** — `censusAttackCorpus.ts` **FILE LINE 595** (`legalAttackCorpus()` index 542), *"This attack does 50 damage for each of your Drifloon and Drifblim in play. This attack also does 30 damage to each of your Drifloon and Drifblim. (Don't apply Weakness and Resistance for Benched Pokémon.)"*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrators `d539-*`), claimed by TWO readers off ONE `effect` string through ONE new whole-compound anchor carrying a `\2` BACKREFERENCE (`NAMED_BODIES_MULTIPLY_SPREAD`) — `deriveAttackDamageMultiplier` for the × fold and `deriveAttackEffect` for `damageChosen` with the FOURTH `target` member `yourAny` and `count: "all"`, plus the NINTH `IN_PLAY_BODY_NOUNS` exact key — a READER move: reader arm 563/1611 → 564/1613, raw residue 77/121 → 76/119, `BUILT.attack` 1662 → 1664; registry 10/16, gate 6/14, trailing 11/21, `SPLIT_ATTACK_UNITS` 14, `COMPOUND_ATTACK_UNITS` 21 and `attackReaderSurface()` 13 UNMOVED; engine 0.423.0 → 0.424.0, `MATCH_RECORD_VERSION` HELD at 30 (a WIDENING at a persisted address, D125's free case — and `count: "all"` NEVER PARKS). ⚠️ THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — they disagree for the FIFTH slice running (D535 1-vs-2, D536 1-vs-3, D537 1-vs-2, D538 1-vs-3). THIS SITE: a LIVE ADDEND at the FRONT (D461's table: the tell is the left-hand side), 1611 → 1613.)  // (🆕🆕🆕 **D538 +3 printings — THE COUNTER PLACEMENT WHOSE AMOUNT IS A PAYLOAD AND WHOSE TAIL SHUFFLES THE VERY CARDS IT COUNTED** — `censusAttackCorpus.ts` **FILE LINE 412** (`legalAttackCorpus()` index 359), *"Put 2 damage counters on 1 of your opponent's Pokémon for each Basic {G} Energy card in your discard pile. Then, shuffle those Energy cards into your deck."*, **1 sentence / 3 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrator `d538-pile-sniper`), claimed by `deriveAttackEffect` through ONE new whole-sentence TWO-capture anchor (`COUNTER_PUT_SCALED_BY_PILE`, declared with the counter-put family, ONE `['’]` slot) as arm **23b-bis** emitting THREE ops — `damageChosen{perDiscardPileCard}` + `discardPileRetrieval{max:"all"}` + `shuffleDeck`, with ONE `CardFilter` object shared by the first two — a READER move: reader arm 562/1608 → 563/1611, raw residue 78/124 → 77/121, `BUILT.attack` 1659 → 1662; registry 10/16, gate 6/14, trailing 11/21, `SPLIT_ATTACK_UNITS` 14 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED; engine 0.422.0 → 0.423.0, `MATCH_RECORD_VERSION` HELD at 30 (a NEW OPTIONAL KEY is D125's WIDENING and `max: "all"` is a PURE ADDITION to a value domain — and BOTH bytes are written into the record, through `phase.cont.pendingOp` and `phase.cont.rest` respectively). ⚠️ THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 3 — they disagree for the FOURTH slice running (D535 1-vs-2, D536 1-vs-3, D537 1-vs-2), so a pass that copied one number into the other kind of site would be wrong in half of them. THIS SITE: ⚠️ A TAIL A NUMERIC READER CANNOT SEE, STEPPED BY HAND (D426) — + 1608 → + 1611. 🛑 PRINTINGS, SO THE STEP IS **3** AND NOT 1 — this is the exact site D537's automated pass got wrong by assuming the sentence step.)  // (🆕🆕🆕 **D537 +1 sentence — KEEP THREE, SHUFFLE THE REST: THE ONLY SENTENCE IN THIS CORPUS WHOSE PICK NAMES THE BODIES THAT *STAY* — ONE NEW `EffectOp` MEMBER `returnBenchedRest` AND ONE INTERPRETER WRITER** — `censusAttackCorpus.ts` **FILE LINE 84** (`legalAttackCorpus()` index 31), *"Choose 3 of your opponent's Benched Pokémon. If you do, shuffle all of your opponent's Benched Pokémon that you didn't choose, and all cards attached to those Pokémon, into their deck."*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrator `d537-bencher`), claimed by `deriveAttackEffect` through ONE new ONE-capture whole-sentence anchor (`CHOOSE_KEEP_SHUFFLE_REST`, beside `RETURN_BENCHED`, THREE `['’]` slots — two possessives AND the contraction in "didn't") as arm **42-bis** emitting ONE `returnBenchedRest{keep:3}` — a READER move: reader arm 561/1606 → 562/1608, raw residue 79/126 → 78/124, `BUILT.attack` 1657 → 1659; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.421.0 → 0.422.0, `MATCH_RECORD_VERSION` HELD at 30 (a new op MEMBER is D125's WIDENING — and this op PARKS, so the byte IS written into `phase.cont.pendingOp`). ⚠️ THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — they disagree for the third slice running (D535 1-vs-2, D536 1-vs-3), so a pass that copied one number into the other kind of site would be wrong in half of them. THIS SITE: ⚠️ A FROZEN TAIL A NUMERIC READER CANNOT SEE, STEPPED BY HAND (D426) — 1606 → 1608.)  // (🆕🆕🆕 **D536 +3 printings — THE BODY THAT LEAVES PLAY WITHOUT BEING KNOCKED OUT** — `censusAttackCorpus.ts` **FILE LINE 100** (`legalAttackCorpus()` index 47), *"Discard a Team Rocket's Energy from this Pokémon. If you do, discard your opponent's Active Pokémon and all attached cards."*, **1 sentence / 3 legal printings** (Moltres ex `sv10-031`/`-208`/`-229`), claimed by `deriveAttackEffect` through arm 44c over ONE new FIELD-FREE `EffectOp` member `discardDefender` — a READER move: reader arm 560/1603 → 561/1606, raw residue 80/129 → 79/126, `BUILT.attack` 1654 → 1657; engine 0.420.0 → 0.421.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THIS IS A PRINTING-SIDE TERM, SO IT CARRIES `+ 3` WHERE THE SENTENCE-SIDE TERM ABOVE CARRIES `+ 1`** — the two steps DISAGREE, harder than D535's 1-vs-2. THIS SITE: 1603 → 1606.)  // (🆕🆕🆕 **D535 +1 sentence / +2 printings — THE PICK-WITH-REPLACEMENT SNIPE — ZERO NEW VOCABULARY: SIX `damageChosen` OPS AT `count: 1`, THE LITERAL `CHOSEN_ANY_TARGET` ALREADY AUTHORS** — `censusAttackCorpus.ts` **FILE LINE 81** (`legalAttackCorpus()` index 28), *"Choose 1 of your opponent's Pokémon 6 times. (You can choose the same Pokémon more than once.) For each time you chose a Pokémon, do 20 damage to it. This damage isn't affected by Weakness or Resistance."*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — no D1, no catalog sqlite — stated unresolved, never invented, D425), claimed by `deriveAttackEffect` through ONE new TWO-capture anchor (`ATTACK_PICK_WITH_REPLACEMENT_SNIPE`, beside `CHOSEN_ANY_TARGET`) as SIX `damageChosen{target:"opponentAny", amount:20, count:1, source:"attack", deals, ignoreWR}` parks — a READER move: reader arm 559/1601 → 560/1603, raw residue 81/131 → 80/129; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.419.0 → 0.420.0, `MATCH_RECORD_VERSION` HELD at 30 (D237's POPULATION change — the op literal already ships, so the serialized alphabet does not grow). ⚠️ THE SENTENCE STEP AND THE PRINTING STEP DISAGREE AT 1 AND 2 — the legal column prints this sentence TWICE.)  // (🆕🆕🆕 **D534 +1 sentence / +1 printing — THE ONE-CARD LOOK AT THE OPPONENT's DECK WITH A PRINTED SHUFFLE — `shuffleDeck` GAINS THE OPTIONAL KEY `whose: "opponent"` and `reorderTop` PARKS A ONE-CARD WINDOW WHEN ITS TWO ARMS DIFFER** — `censusAttackCorpus.ts` **FILE LINE 401**, *"Look at the top card of your opponent's deck. You may have your opponent shuffle their deck."*, **1 sentence / 1 legal printing** (Inkay `sv06.5-033`; no id on this checkout, D425), claimed by `deriveAttackEffect` through ONE new zero-capture anchor (`ATTACK_OPPONENT_TOP_LOOK_SHUFFLE`, beside `ATTACK_REORDER_TOP`) as `reorderTop{n:1, side:"opponent", otherwise:[shuffleDeck{whose:"opponent"}]}` — a READER move: reader arm 558/1600 → 559/1601, raw residue 82/132 → 81/131; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.418.0 → 0.419.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1.)  // (🆕🆕🆕 **D532 +1 printing — THE CROSS-SEAT DISCARD-PILE ATTACH — `attachEnergyFrom` GAINS THE OPTIONAL KEY `whose: "opponent"` (on the op AND on `AttachTargetRiders`, read through ONE resolver)** — `censusAttackCorpus.ts` **FILE LINE 70** (`legalAttackCorpus()` index 17), *"Attach up to 3 Energy cards from your opponent's discard pile to their Pokémon in any way you like."*, **1 sentence / 1 legal printing** (Grafaiai `sv08-121`; no id on this checkout, D425), claimed by `deriveAttackEffect` through ONE new zero-capture anchor (`ATTACK_OPPONENT_DISCARD_ATTACH`, beside the factory-built `DISCARD_ATTACH`) as D360's spread ONE KEY OVER — a READER move: reader arm 557/1599 → 558/1600, raw residue 83/133 → 82/132; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.417.0 → 0.418.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1.)  // (🆕🆕🆕 **D531 +1 printing — THE BOARD-TYPED HAND SEARCH — `searchDeck` GAINS THE PARK-TIME RIDER `typedAsAttachedBasicEnergy`** — `censusAttackCorpus.ts` **FILE LINE 483** (`legalAttackCorpus()` index 430), *"Search your deck for up to 5 Pokémon that are the same type as any Basic Energy attached to this Pokémon, reveal them, and put them into your hand. Then, shuffle your deck."*, **1 sentence / 1 legal printing** (sv07-065 per the retired D231 deferral; no id on this checkout, D425), claimed by `deriveAttackEffect` through ONE new zero-capture anchor (`ATTACK_HAND_SEARCH_TYPED_AS_ATTACHED`, beside `ATTACK_HAND_SEARCH_BENCH_COUNT`) whose rider the park resolves against the SOURCE body's attached Basic Energy — a READER move: reader arm 556/1598 → 557/1599, raw residue 84/134 → 83/133; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.416.0 → 0.417.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1.)
    expect([all.length, units(all)]).toEqual([640, 1732]);
  });

  it("🛑 the move is READER-keyed: no gate clause, no trailing split, no cancel split, no requirement split claims the row", () => {
    expect(splitAttackGateClause(PRINTED)).toBeNull();
    expect(splitAttackTrailingClause(PRINTED)).toBeNull();
    expect(splitAttackCancelClause(PRINTED)).toBeNull();
    expect(splitAttackRequirementClause(PRINTED)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — the version, the heading, the corrected prose, and what stands still.
// ─────────────────────────────────────────────────────────────────────────────

const RAW: Record<string, string> = (
  import.meta as unknown as {
    glob(
      pattern: string,
      options: { query: "?raw"; import: "default"; eager: true },
    ): Record<string, string>;
  }
).glob("./{censusAttackCorpus,index,effects,attack}.ts", { query: "?raw", import: "default", eager: true });

describe("D525 §4 — the version steps, the heading is written, the prose is corrected, and what stands still", () => {
  it("engineVersion and `manifest.version` agree, and the bump is owed for BEHAVIOUR", () => {
    // ⚠️ The version is NOT spelled in this `it(…)` title (D460's fourth class).
    expect(engineVersion).toBe("0.501.0");
    expect(manifest.version).toBe(engineVersion);
  });

  it("🛑 the changelog heading for this bump is present in `index.ts`, labelled with its decision", () => {
    const index = Object.entries(RAW).find(([k]) => k.endsWith("/index.ts"))?.[1] ?? "";
    expect(index.length).toBeGreaterThan(1_000_000);
    expect(index).toContain("engineVersion 0.411.0 → **0.412.0** (D525");
  });

  it("🛑 the prose is corrected IN PLACE (D178/D442): the D452 block, the D234 residue blocks and `index.ts`'s D130 paragraph now say the row is BUILT; the anchor, the member and the fold are byte for byte what this suite drove", () => {
    const effects = Object.entries(RAW).find(([k]) => k.endsWith("/effects.ts"))?.[1] ?? "";
    expect(effects).toContain(
      "const ATTACK_COIN_RETRIEVAL_UP_TO_HEADS =\n  /^Flip (\\d+) coins\\. Put a number of cards up to the number of heads from your discard pile into your hand\\.$/;",
    );
    expect(effects).toContain('| { kind: "retrievalUpToHeads"; flips: AttackFlipCount; filter: CardFilter; dest: "hand" }');
    expect(effects).toContain("D525 — BUILT: the heads COUNT as an \"up to\" ceiling");
    expect(effects).toContain("D525 — THE PREMISE WAS FALSE");
    const attack = Object.entries(RAW).find(([k]) => k.endsWith("/attack.ts"))?.[1] ?? "";
    expect(attack).toContain('} else if (coinFlip.kind === "retrievalUpToHeads") {');
    expect(attack).toContain('{ op: "discardPileRetrieval", filter: coinFlip.filter, dest: coinFlip.dest, max: heads }');
    expect(attack).toContain('coinFlip.kind !== "retrievalUpToHeads";');
    const index = Object.entries(RAW).find(([k]) => k.endsWith("/index.ts"))?.[1] ?? "";
    expect(index).toContain("D525 — BUILT: Oinkologne's ceiling");
  });

  it("🛑 `MATCH_RECORD_VERSION` HOLDS at 30 — DRIVEN in three directions: the parked board round-trips and resumes from its bytes; the continuation's alphabet is the SHIPPED op with a `number` max; a record whose `max` is LOST refuses the pick a live one accepts", () => {
    // The member is never serialized (`AttackCoinFlip` reaches no record — it is derived from text at
    // the attack site and spent at the fold), so what a v30 record holds after this slice is
    // `discardPileRetrieval { filter: anyCard, dest: "hand", max: <number> }` — bytes D237's hand
    // retrieval has produced since it shipped, with `chooseCards` on top.
    expect(JSON.parse(JSON.stringify(READING))).toEqual(READING);
    const { after: parked } = swing({ faces: HHH });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const offered = cardsPrompt(parked).candidates;
    const chosen = [offered[1], offered[3]].filter((u): u is string => u !== undefined);
    expect(chosen).toHaveLength(2);

    // DIRECTION 1 — FORWARD. Round-trip the PARKED board through JSON and resume from the bytes.
    const persisted = JSON.parse(JSON.stringify(parked)) as GameState;
    expect(persisted).toEqual(parked);
    const live = pick(parked, chosen);
    const replayed = pick(persisted, chosen);
    expect(replayed.events).toEqual(live.events);
    expect(replayed.state).toEqual(live.state);

    // DIRECTION 2 — THE ALPHABET, as a LITERAL rather than as a diff (D279): the continuation's key
    // set and the pending op's FULL JSON, which is the same string the shipped D237 reader emits for
    // the printed "up to 3" spelling with the number written in.
    expect(Object.keys(parked.phase.cont).sort()).toEqual(["ctx", "pendingOp", "rest"]);
    const shipped = '{"op":"discardPileRetrieval","filter":{"kind":"anyCard"},"dest":"hand","max":3}';
    expect(JSON.stringify(parked.phase.cont.pendingOp)).toBe(shipped);
    expect(parked.phase.cont.rest).toEqual([]);
    expect(JSON.stringify(deriveAttackEffect("Put up to 3 cards from your discard pile into your hand.")?.[0])).toBe(
      shipped,
    );

    // DIRECTION 3 — LOSS. H lives ONLY in the record's `max`: a persisted board whose prompt and
    // pending op lost two of the three heads refuses the two-card pick the live board accepts.
    const lossy = JSON.parse(JSON.stringify(parked)) as GameState;
    if (lossy.phase.kind !== "effect:choose" || lossy.phase.prompt.kind !== "chooseCards") {
      throw new Error("expected a chooseCards park");
    }
    (lossy.phase.prompt as { max: number }).max = 1;
    (lossy.phase.cont.pendingOp as { max: number }).max = 1;
    const truncated = applyAction(lossy, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "cards", uids: chosen },
    });
    expect(truncated.ok).toBe(false);
    if (truncated.ok) throw new Error("the truncated record accepted a pick above its ceiling");
    expect(truncated.error.code).toBe("BAD_EFFECT_CHOICE");
    expect(live.state.players.p1.hand).toHaveLength(parked.players.p1.hand.length + 2);
  });

  it("🛑 the demonstrator is FILE-LOCAL — zero `FIXTURE_POOL` ids, the deck is 60, the Energy is the shared pool's Colorless Basic", () => {
    expect(Object.keys(RETRIEVAL_CARDS).every((id) => FIXTURE_POOL[id] === undefined)).toBe(true);
    expect(RETRIEVAL_DECK).toHaveLength(60);
    expect(FIXTURE_POOL[PLAIN]?.name).toBe(PLAIN);
    expect(FIXTURE_POOL["sv03-184"]).toBeUndefined();
  });
});
