import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import manifest from "../package.json" with { type: "json" };
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import {
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
  deriveAttackRequirement,
  splitAttackCancelClause,
  splitAttackGateClause,
  splitAttackRequirementClause,
  splitAttackTrailingClause,
} from "./effects";
import type { AttackCoinFlip, EffectOp } from "./effects";
import { applyAction, createGame, engineVersion } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import type { PokemonRef } from "./interpreter";
import { logFromEvents } from "./log";
import { redactGame } from "./redact";
import { flipCoin } from "./rng";
import type { CoinFace } from "./rng";
import {
  FIXTURE_POOL,
  activeUid,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  discardFromDeck,
  firstBasicInHand,
  must,
  mustApply,
  setActiveFromDeck,
  types,
} from "./testFixtures";

// 0.414.0 → 0.415.0 — 🆕🆕🆕 D528: THE HEADS-CEILINGED DISCARD-TO-BENCH ENERGY ATTACH — THE ATTACH
// TWIN OF D525, ZERO VOCABULARY, NO NEW `AttackCoinFlip` MEMBER.
//
// *"Flip 3 coins. Attach a number of Basic {L} Energy cards up to the number of heads from your
// discard pile to your Benched Pokémon in any way you like."* — `censusAttackCorpus.ts` **FILE LINE
// 215** (`legalAttackCorpus()` index 162), **1 sentence / 1 legal printing** (no catalog id on this
// checkout — the demonstrator below is FILE-LOCAL and DECLARED, no id is invented, D425), claimed by
// `deriveAttackCoinFlip` through ONE new anchor (`ATTACK_COIN_ATTACH_UP_TO_HEADS`) as the SHIPPED
// member `programPerHeads` over ONE copy of D358's shipped discard-spread op:
//
//   { kind: "programPerHeads", flips: { kind: "printed", count: 3 },
//     ops: [{ op: "attachEnergyFrom", source: "discard", energyType: "Lightning",
//             benchOnly: true, declinable: true }],
//     face: "heads" }
//
// The op is BYTE-IDENTICAL to what `attachFromZoneProgram` already emits (twice) for the sibling
// print *"Attach up to 2 Basic {L} Energy cards from your discard pile to your Benched Pokémon in any
// way you like."* (§1 asserts the identity off the deriver, not by retyping). `attack.ts`'s existing
// fold expands the member into H copies (H = heads), and the interpreter parks each copy DECLINABLY
// over the Bench (`benchOnly`) — `parkOrForce` returns `done` on an empty Bench, the op's own guard
// returns `done` when the pile holds no matching Basic Energy, and D359's `upTo` makes a ONE-body
// Bench ask rather than force. ZERO new op / rider / prompt / event / member vocabulary; what reaches
// the continuation is D358's op bytes, so `MATCH_RECORD_VERSION` HOLDS at 30 (§3).
//
// 🛑 **WHY THIS DOES NOT CONTRADICT D525.** D525 rejected H `max: 1` parks for the RETRIEVAL print
// because that print is ONE question (*"put cards into your hand"*) and built ONE `max: H` park.
// The ATTACH print is a DISTRIBUTION (*"to your Benched Pokémon in any way you like"*): each card is
// an independent card+body decision, which D358/D360 already read as N independent declinable parks
// for the printed *"up to N … in any way you like"*. This row is that reading with N = heads —
// the `programPerHeads` expansion IS the distribution.
//
// 🛑 **THE REFUSAL ON RECORD RESTED ON A FIXTURE RULE, NOT A BUILD RULE.** D525's anchor block,
// member block, the D234 residue block and `index.ts` held this row out as *"D442/D448's
// one-printing rule"*. D448 (`conventions.md`, *A one-print fixture makes a filter unfalsifiable*)
// is a FIXTURE rule — paid here by a Basic Water AND a Colorless card in the pile that the type
// filter must never offer (§2); D442 (*Two riders need two rows*) is a MUTANT-ROW rule; neither
// forbids a one-printing build (D527 built line 454 at one). Annotated in place, never deleted
// (D178/D442). `upToHeadsRetrieval.test.ts`'s control rung is INVERTED: the twin derives, on the
// OTHER member, and `retrievalUpToHeads` is NOT its claimant.

/** Corpus FILE LINE 215, byte for byte. Asserted off the corpus in §1, never retyped elsewhere. */
const PRINTED =
  "Flip 3 coins. Attach a number of Basic {L} Energy cards up to the number of heads from your discard pile to your Benched Pokémon in any way you like.";
/** The same skeleton at a different printed count — the digit is CAPTURED, not pinned. Constructed. */
const at = (n: number): string => PRINTED.replace("Flip 3 coins", `Flip ${n} coins`);
/** Corpus FILE LINE 219 (D525), 2 legal printings — the RETRIEVAL twin, ONE verb over. Derives on
    the OTHER member (`retrievalUpToHeads`): THE CONTROL, and it is NOT null. */
const RETRIEVAL_TWIN =
  "Flip 3 coins. Put a number of cards up to the number of heads from your discard pile into your hand.";
/** The printed-digit SIBLING `attachFromZoneProgram` has read since D358/D360 — the `benchOnly` +
    `anyWay` destination row under the SAME {L} code. Its ops are the bytes this member carries;
    asserted off the deriver in §1. ⚠️ CONSTRUCTED: the column prints this row's {F} twin
    (`SIBLING_LEGAL`, 1 legal printing) and NOT the {L} spelling (measured in §1). */
const SIBLING =
  "Attach up to 2 Basic {L} Energy cards from your discard pile to your Benched Pokémon in any way you like.";
/** The LEGAL printing of that sibling — the {F} code, 1 legal printing (`attachDecline.test.ts`'s
    three derived spreads name it). */
const SIBLING_LEGAL =
  "Attach up to 2 Basic {F} Energy cards from your discard pile to your Benched Pokémon in any way you like.";

/** THE OP, spelled once — D358's shipped shape, key order as `attachFromZoneProgram` emits it. */
const OP: Extract<EffectOp, { op: "attachEnergyFrom" }> = {
  op: "attachEnergyFrom",
  source: "discard",
  energyType: "Lightning",
  benchOnly: true,
  declinable: true,
};
/** THE READING, spelled once. */
const reading = (count: number, energyType: "Lightning" | "Fighting" = "Lightning"): AttackCoinFlip => ({
  kind: "programPerHeads",
  flips: { kind: "printed", count },
  ops: [{ ...OP, energyType }],
  face: "heads",
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
// The demonstrator — a FILE-LOCAL pool and its own deck (D414/D452/D520/D522/D523/D524/D525/D526/D527).
// ─────────────────────────────────────────────────────────────────────────────

/** DECLARED, not read: the printing's base and cost are unresolvable here (no D1, no
    `FIXTURE_POOL` id). */
const BASE = 30;
const PLAIN = "fix-energy";
/** The shared pool's typed Basic Energies: the {L} the print names, and the {W} it must NEVER
    offer (D448's fixture rule — the type filter is falsifiable only with a non-{L} card in the pile). */
const LIGHT = "fix-lightning-energy";
const WATER = "fix-water-energy";
const WALL = "d528-wall";
/** The Bench filler — a 60 HP Colorless Basic, benched by surgery in the count each rung names. */
const PAL = "d528-pal";

const CHARGE_CARDS: Record<string, Card> = {
  "d528-charger": battler("d528-charger", {
    name: "D528 Charger",
    types: ["Lightning"],
    hp: 130,
    retreat: 2,
    attacks: [
      /** index 0 — FILE LINE 215 verbatim, with a DECLARED base and cost. */
      { cost: ["Colorless"], name: "Salvage Charge", damage: BASE, effect: PRINTED },
      /** index 1 — the control: no effect, no flip, no program. */
      { cost: ["Colorless"], name: "Plain Jab", damage: BASE },
    ],
  }),
  /** The defender — 400 HP, no W/R. */
  [WALL]: battler(WALL, { name: "D528 Wall", types: ["Colorless"], hp: 400 }),
  [PAL]: battler(PAL, { name: "D528 Pal", types: ["Colorless"], hp: 60 }),
};

const CHARGE_POOL: Record<string, Card> = { ...FIXTURE_POOL, ...CHARGE_CARDS };

/** Its own deck (D270), 60 counted before the first run: 8 + 8 + 12 + 16 + 12 + 4. */
const CHARGE_DECK = deckOf({
  "d528-charger": 8,
  [WALL]: 8,
  [PAL]: 12,
  [PLAIN]: 16,
  [LIGHT]: 12,
  [WATER]: 4,
});

/** The opening shuffle only — the three flips are driven off a SURGERED `rngState` (below), so the
    seed never decides a face. Stated (D523 (8)). */
const SEED = 11;

function openTable(seed: number, first: Seat): GameState {
  const created = createGame({
    seed,
    decks: { p1: CHARGE_DECK, p2: CHARGE_DECK },
    cardPool: CHARGE_POOL,
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

/** `perTailsSelfDiscard.test.ts` / `upToHeadsRetrieval.test.ts`'s idiom: the smallest `rngState`
    whose next `faces.length` draws are exactly `faces`, in order. Derived from `flipCoin`, never
    hardcoded. */
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
const HTH: readonly CoinFace[] = ["heads", "tails", "heads"];
const HTT: readonly CoinFace[] = ["heads", "tails", "tails"];
const TTT: readonly CoinFace[] = ["tails", "tails", "tails"];

/** The default pile, seeded in THIS order: three {L}, ONE {W}, ONE Colorless — three matching cards
    for three heads, plus the two the type filter must never offer (D448). */
const DEFAULT_PILE: Record<string, number> = { [LIGHT]: 3, [WATER]: 1, [PLAIN]: 1 };

type Board = {
  /** The three faces, in flip order. */
  readonly faces: readonly CoinFace[];
  /** P1's discard pile, seeded from the deck (`discardFromDeck`). Default 3 + 1 + 1; `{}` is empty. */
  readonly pile?: Record<string, number>;
  /** P1's Bench count. Default 2. */
  readonly bench?: number;
};

/** p1 owns TURN 2 with the attacker Active holding ONE Colorless Basic (the {C} cost); P2 went first.
    Both Benches are CLEARED after the Active surgeries (`setActiveFromDeck` displaces onto the
    Bench), P1's is refilled by count, P1's discard is `pile`, and the rng is surgered so the
    attack's three flips draw `faces`. */
function table(board: Board): GameState {
  let state = openTable(SEED, "p2");
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  if (state.turn !== 2) throw new Error(`expected turn 2, got ${String(state.turn)}`);
  state = setActiveFromDeck(state, "p1", "d528-charger");
  state = setActiveFromDeck(state, "p2", WALL);
  state = clearBench(state, "p1");
  state = clearBench(state, "p2");
  for (let i = 0; i < (board.bench ?? 2); i += 1) state = benchFromDeck(state, "p1", PAL);
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

function bodyPrompt(state: GameState) {
  if (state.phase.kind !== "effect:choose") throw new Error(`expected a park, got ${state.phase.kind}`);
  if (state.phase.prompt.kind !== "choosePokemon") {
    throw new Error(`expected choosePokemon, got ${state.phase.prompt.kind}`);
  }
  return state.phase.prompt;
}
function continuation(state: GameState) {
  if (state.phase.kind !== "effect:choose") throw new Error("expected a park");
  return state.phase.cont;
}
const benchRef = (index: number): PokemonRef => ({ seat: "p1", spot: { spot: "bench", index } });

/** Answer the parked choosePokemon with a body. */
const pick = (state: GameState, ref: PokemonRef) =>
  mustApply(state, { type: "resolveEffect", seat: "p1", choice: { kind: "pokemon", ref } });
/** D358's decline — the absent `ref`. */
const decline = (state: GameState) =>
  mustApply(state, { type: "resolveEffect", seat: "p1", choice: { kind: "pokemon" } });

const NAMES = { p1: "P1", p2: "P2" } as const;
const rows = (events: readonly GameEvent[], state: GameState): string[] =>
  logFromEvents(events, { names: NAMES, state, elapsed: "+00:09" }).map((entry) =>
    entry.kind === "turn" ? `— turn ${entry.turn} —` : entry.segments.map((s) => s.text).join(""),
  );

function attachedRows(events: readonly GameEvent[]) {
  return events.filter((e): e is Extract<GameEvent, { type: "ENERGY_ATTACHED" }> => e.type === "ENERGY_ATTACHED");
}
function dealtRows(events: readonly GameEvent[]) {
  return events.filter((e): e is Extract<GameEvent, { type: "DAMAGE_DEALT" }> => e.type === "DAMAGE_DEALT");
}
function flipRows(events: readonly GameEvent[]) {
  return events.filter(
    (e): e is Extract<GameEvent, { type: "ATTACK_EFFECT_COIN_FLIP" }> => e.type === "ATTACK_EFFECT_COIN_FLIP",
  );
}
/** `rngState` after exactly `n` `flipCoin` steps from `from`. */
function stepped(from: number, n: number): number {
  let rng = from;
  for (let i = 0; i < n; i += 1) rng = flipCoin(rng)[1];
  return rng;
}
const idsOf = (state: GameState, uids: readonly string[]) => uids.map((uid) => state.cardIdByUid[uid]);
const benchEnergies = (state: GameState) => state.players.p1.bench.map((body) => idsOf(state, body.energy));

/** THE CAPTION, MEASURED ONCE and pinned byte for byte: D358's `parkOrForce` note for an op with
    no `count`, `attachTargetNoun({ benchOnly })`. */
const CAPTION = "Attach the Energy to which of your Benched Pokémon?";

// ─────────────────────────────────────────────────────────────────────────────
// §1 — derivation: the exact reading, the captured count, the only claimant, both anchor ends (the
// trailing splitter COMPOSES on the built head — D426/D526 (5)), the one-token near-misses, the
// retrieval twin as the NON-null control, the sibling's byte identity, the census identity.
// ─────────────────────────────────────────────────────────────────────────────

describe("D528 §1 — file line 215 derives to EXACTLY `programPerHeads` over ONE copy of D358's discard-spread op", () => {
  it("🛑 the row derives to the reading — `programPerHeads`, `flips: printed 3`, ONE op `attachEnergyFrom { discard, Lightning, benchOnly, declinable }`, `face: heads`, and NOTHING else (`D528-arm-loses-the-type` / `-arm-loses-bench-only` / `-arm-loses-declinable` / `-arm-face-is-tails` / `-arm-doubles-the-op` / `-arm-source-is-the-hand`)", () => {
    expect(deriveAttackCoinFlip(PRINTED)).toEqual(READING);
    const got = deriveAttackCoinFlip(PRINTED);
    if (got === null) throw new Error("the row derived null");
    expect(Object.keys(got).sort()).toEqual(["face", "flips", "kind", "ops"]);
    if (got.kind !== "programPerHeads") throw new Error(`kind ${got.kind}`);
    expect(got.face).toBe("heads");
    expect(got.flips).toEqual({ kind: "printed", count: 3 });
    expect(got.ops).toHaveLength(1);
    expect(got.ops[0]).toEqual(OP);
    expect(Object.keys(got.ops[0] ?? {}).sort()).toEqual(["benchOnly", "declinable", "energyType", "op", "source"]);
    // No `count`, no `anyEnergy`, no `toSelf`, no `toEach`: the ceiling is the HEADS COUNT, spent as
    // copies at the fold, never as a `count` on the op.
    for (const absent of ["count", "anyEnergy", "toSelf", "toEach", "healTarget", "energyName"]) {
      expect(absent in (got.ops[0] ?? {}), absent).toBe(false);
    }
    // …and it is NOT the retrieval member: the two twins are two members.
    expect(got.kind).not.toBe("retrievalUpToHeads");
  });

  it("🛑 the count is CAPTURED, not pinned — 2, 4 and 10 derive at 2, 4 and 10; `Flip 1 coins.` and `Flip 11 coins.` derive null; and a constructed `Flip 4 coins … {F} …` derives count 4 / Fighting (`D528-guard-admits-one-flip` / `-guard-loses-the-ceiling` / `-arm-count-pinned-at-three`)", () => {
    expect(deriveAttackCoinFlip(at(2))).toEqual(reading(2));
    expect(deriveAttackCoinFlip(at(4))).toEqual(reading(4));
    expect(deriveAttackCoinFlip(at(10))).toEqual(reading(10));
    // The family's guards: "coins" is plural (the one-flip form is "Flip a coin."), and the digits are
    // third-party text bounded by MAX_PRINTED_FLIPS = 10.
    expect(deriveAttackCoinFlip(at(1))).toBeNull();
    expect(deriveAttackCoinFlip(at(0))).toBeNull();
    expect(deriveAttackCoinFlip(at(11))).toBeNull();
    for (const s of [at(1), at(0), at(11)]) expect(resolvedByAnyReader(s), s).toBe(false);
    // The code is CAPTURED too — resolved through `ENERGY_TYPE_BY_CODE`, not pinned to {L}.
    const fighting = at(4).replace("{L}", "{F}");
    expect(fighting).not.toBe(at(4));
    expect(deriveAttackCoinFlip(fighting)).toEqual(reading(4, "Fighting"));
    for (const s of [at(2), at(4), at(10), at(1), at(0), at(11), fighting]) {
      expect(legalAttackCorpus().some(([, t]) => t === s), s).toBe(false);
    }
  });

  it("🛑 `deriveAttackCoinFlip` is the ONLY claimant — twelve readers and four splitters are null — and the reader surface is still THIRTEEN", () => {
    for (const reader of READERS) {
      if (reader === deriveAttackCoinFlip) continue;
      expect(reader(PRINTED), reader.name).toBeNull();
    }
    for (const splitter of SPLITTERS) expect(splitter(PRINTED), splitter.name).toBeNull();
    expect(deriveAttackCoinFlip(PRINTED)).not.toBeNull();
    expect(resolvedByAnyReader(PRINTED)).toBe(true);
    expect(attackReaderSurface()).toHaveLength(13);
    expect(attackReaderSurface()).toContain("deriveAttackCoinFlip");
    expect(READERS.map((read) => read.name).sort()).toEqual(attackReaderSurface());
  });

  it("🛑 the anchor is WHOLE-SENTENCE at the HEAD: a PREFIXED print is null on every reader and every splitter (D520 (3); `D528-anchor-loses-the-head`)", () => {
    const prefixed = `Draw a card. ${PRINTED}`;
    expect(legalAttackCorpus().some(([, s]) => s === prefixed)).toBe(false);
    for (const reader of READERS) expect(reader(prefixed), reader.name).toBeNull();
    for (const splitter of SPLITTERS) expect(splitter(prefixed), splitter.name).toBeNull();
    expect(resolvedByAnyReader(prefixed)).toBe(false);
  });

  it("🛑 …and at the TAIL: a SUFFIXED print is null on every reader, and the TRAILING splitter COMPOSES `{head: row, tail: \"Draw a card.\"}` because the head is now claimed (D426/D526 (5) — asserted, not asserted away; `D528-anchor-loses-the-tail`)", () => {
    const suffixed = `${PRINTED} Draw a card.`;
    expect(legalAttackCorpus().some(([, s]) => s === suffixed)).toBe(false);
    for (const reader of READERS) expect(reader(suffixed), reader.name).toBeNull();
    expect(deriveAttackCoinFlip(suffixed)).toBeNull();
    expect(deriveAttackEffect(suffixed)).toBeNull();
    expect(resolvedByAnyReader(suffixed)).toBe(false);
    expect(splitAttackCancelClause(suffixed)).toBeNull();
    expect(splitAttackGateClause(suffixed)).toBeNull();
    expect(splitAttackRequirementClause(suffixed)).toBeNull();
    // MEASURED at D528: the splitter composes a CLAIMED head with a trailing clause. On the
    // `$`-dropped mutant the READER swallows the whole string instead, so `deriveAttackCoinFlip
    // (suffixed)` is the rung that goes red.
    expect(splitAttackTrailingClause(suffixed)).toEqual({ head: PRINTED, tail: "Draw a card." });
  });

  it("🛑 one-token near-misses, all null on EVERY reader — `{X}`, `your Pokémon`, `1 of your Benched Pokémon`, `tails`, the hand, the non-Basic noun, `coin`", () => {
    const controls: Record<string, string> = {
      "`{X}` for `{L}` — an unmapped code refuses at the arm (`ENERGY_TYPE_BY_CODE`), as `attachFromZoneProgram` refuses one":
        PRINTED.replace("{L}", "{X}"),
      "`your Pokémon in any way you like` for `your Benched Pokémon in any way you like` — the destination is FIXED in the anchor (`benchOnly`)":
        PRINTED.replace("your Benched Pokémon in any way you like", "your Pokémon in any way you like"),
      "`to 1 of your Benched Pokémon` for the distribution — the `anyWay` row is the anchor's, not a captured destination":
        PRINTED.replace("to your Benched Pokémon in any way you like", "to 1 of your Benched Pokémon"),
      "`up to the number of tails` for `heads` — the face is a literal (`face: \"heads\"` is written at the arm)":
        PRINTED.replace("number of heads", "number of tails"),
      "`from your hand` for `from your discard pile` — the zone is a literal (`source: \"discard\"`)":
        PRINTED.replace("from your discard pile", "from your hand"),
      "`{L} Energy cards` for `Basic {L} Energy cards` — the print names BASIC Energy and the anchor spells it":
        PRINTED.replace("Basic {L} Energy", "{L} Energy"),
      "`coin` for `coins` — the plural is the family's own guard":
        PRINTED.replace("Flip 3 coins", "Flip 3 coin"),
    };
    for (const [why, s] of Object.entries(controls)) {
      expect(s, why).not.toBe(PRINTED);
      for (const reader of READERS) expect(reader(s), `${why} — ${reader.name}`).toBeNull();
      expect(resolvedByAnyReader(s), why).toBe(false);
      expect(legalAttackCorpus().some(([, t]) => t === s), why).toBe(false);
    }
  });

  it("🛑 THE CONTROL IS NOT NULL: the RETRIEVAL twin (corpus FILE LINE 219, `Put a number of cards`) still derives D525's `retrievalUpToHeads` on the SAME reader — two verbs, two members, two anchors (`D528-anchor-claims-the-put-twin` cannot exist: the verb is fixed)", () => {
    expect(deriveAttackCoinFlip(RETRIEVAL_TWIN)?.kind).toBe("retrievalUpToHeads");
    expect(deriveAttackCoinFlip(RETRIEVAL_TWIN)).toEqual({
      kind: "retrievalUpToHeads",
      flips: { kind: "printed", count: 3 },
      filter: { kind: "anyCard" },
      dest: "hand",
    });
    expect(deriveAttackEffect(RETRIEVAL_TWIN)).toBeNull();
    expect(resolvedByAnyReader(RETRIEVAL_TWIN)).toBe(true);
    expect(legalAttackCorpus().filter(([, s]) => s === RETRIEVAL_TWIN)).toEqual([[2, RETRIEVAL_TWIN]]);
    // …and the two "up to the number of heads" ceilings in the column are exactly these two rows,
    // and BOTH now derive on `deriveAttackCoinFlip` — on DIFFERENT members.
    const ceilings = legalAttackCorpus().filter(([, s]) => s.includes("up to the number of heads"));
    expect(ceilings.map(([, s]) => s).sort()).toEqual([PRINTED, RETRIEVAL_TWIN].sort());
    expect(ceilings.map(([, s]) => deriveAttackCoinFlip(s)?.kind).sort()).toEqual(["programPerHeads", "retrievalUpToHeads"]);
    expect(ceilings.every(([, s]) => resolvedByAnyReader(s))).toBe(true);
  });

  it("🛑 the op is BYTE-IDENTICAL to the printed-digit SIBLING's: `attachFromZoneProgram` derives `Attach up to 2 Basic {L} Energy cards … in any way you like.` to TWO copies of exactly this op (asserted off the deriver, never retyped) — and the sibling is `deriveAttackEffect`'s, not this reader's", () => {
    const sibling = deriveAttackEffect(SIBLING);
    expect(sibling).toEqual([OP, OP]);
    expect(JSON.stringify(sibling?.[0])).toBe(JSON.stringify(READING.kind === "programPerHeads" ? READING.ops[0] : null));
    expect(JSON.stringify(sibling?.[0])).toBe(
      '{"op":"attachEnergyFrom","source":"discard","energyType":"Lightning","benchOnly":true,"declinable":true}',
    );
    expect(deriveAttackCoinFlip(SIBLING)).toBeNull();
    // The {L} spelling is a CONSTRUCTION (measured: the column prints the {F} twin, once); the legal
    // {F} sibling derives the same two-copy shape with `Fighting`, and is `deriveAttackEffect`'s too.
    expect(legalAttackCorpus().some(([, s]) => s === SIBLING)).toBe(false);
    expect(legalAttackCorpus().filter(([, s]) => s === SIBLING_LEGAL)).toEqual([[1, SIBLING_LEGAL]]);
    expect(deriveAttackEffect(SIBLING_LEGAL)).toEqual([
      { ...OP, energyType: "Fighting" },
      { ...OP, energyType: "Fighting" },
    ]);
    expect(deriveAttackCoinFlip(SIBLING_LEGAL)).toBeNull();
  });

  it("🛑 the sentence is the CORPUS's bytes at exactly ONE printing, at index 162, it is RESOLVED, and the raw file line IS 215 (219 is the retrieval twin)", () => {
    const corpus = legalAttackCorpus();
    expect(corpus.filter(([, s]) => s === PRINTED)).toEqual([[1, PRINTED]]);
    expect(corpus.findIndex(([, s]) => s === PRINTED)).toBe(162);
    expect(resolvedByAnyReader(PRINTED)).toBe(true);
    const raw = Object.entries(RAW).find(([k]) => k.endsWith("/censusAttackCorpus.ts"))?.[1] ?? "";
    expect(raw.split("\n")[214]).toBe(`1 ${PRINTED}`);
    expect(raw.split("\n")[218]).toBe(`2 ${RETRIEVAL_TWIN}`);
    // The apostrophe-free sentence: no `['’]` slot exists for the anchor to class (D136/D137).
    expect(PRINTED).not.toContain("'");
    expect(PRINTED).not.toContain("’");
  });

  it("🛑 the anchor's claimed set over all 640 rows is EXACTLY {file line 215} — 1 sentence / 1 printing — and the member-over-an-attach appears on exactly that row", () => {
    const [n, u, claimed] = claims(
      /^Flip (\d+) coins\. Attach a number of Basic \{([A-Z])\} Energy cards up to the number of heads from your discard pile to your Benched Pokémon in any way you like\.$/,
    );
    expect([n, u]).toEqual([1, 1]);
    expect(claimed).toEqual([PRINTED]);
    expect(legalAttackCorpus()).toHaveLength(640);
    const attaches = legalAttackCorpus().filter(([, s]) => {
      const coin = deriveAttackCoinFlip(s);
      return coin?.kind === "programPerHeads" && coin.ops.some((op) => op.op === "attachEnergyFrom");
    });
    expect(attaches).toEqual([[1, PRINTED]]);
    // MEASURED: the ceiling phrase is printed on rows 215, 219 and 454 only.
    expect(legalAttackCorpus().filter(([, s]) => s.includes("up to the number of"))).toHaveLength(3);
  });

  it("the fixture pool is FILE-LOCAL — zero `FIXTURE_POOL` ids, the deck is 60, and the typed Energies are the SHARED pool's", () => {
    expect(Object.keys(CHARGE_CARDS).every((id) => FIXTURE_POOL[id] === undefined)).toBe(true);
    expect(CHARGE_DECK).toHaveLength(60);
    expect(FIXTURE_POOL[PLAIN]?.name).toBe(PLAIN);
    expect(FIXTURE_POOL[LIGHT]?.name).toBe("Lightning Energy");
    expect(FIXTURE_POOL[WATER]?.name).toBe("Water Energy");
    expect(CHARGE_CARDS["d528-charger"]?.attacks?.[0]?.effect).toBe(PRINTED);
    expect(CHARGE_CARDS["d528-charger"]?.attacks?.[1]?.effect).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — the executor: H heads → H DECLINABLE parks over the Bench ONLY, each landing one Basic {L}
// from the pile; the caption; the one-{L} pile; the Water and the Colorless never offered; the empty
// Bench; zero heads; the decline; the one-body Bench; the refusals; the rng; the replay; the
// redacted view; the control.
// ─────────────────────────────────────────────────────────────────────────────

describe("D528 §2 — H heads park H sequential `choosePokemon { upTo 1 }` over the Bench, each attaching one Basic {L} from the pile", () => {
  it("🛑 the board is what it says: P1's attacker is Active with one Colorless Basic, P2's wall is Active, P1's Bench is 2 Pals, P1's pile is {L}{L}{L}{W}{C} in that order, turn 2", () => {
    const before = table({ faces: HHH });
    expect(before.players.p1.active?.energy).toHaveLength(1);
    expect(before.cardIdByUid[activeUid(before, "p1")]).toBe("d528-charger");
    expect(before.cardIdByUid[activeUid(before, "p2")]).toBe(WALL);
    expect(before.players.p1.bench).toHaveLength(2);
    expect(before.players.p1.bench.map((b) => before.cardIdByUid[b.stack[0] ?? ""])).toEqual([PAL, PAL]);
    expect(benchEnergies(before)).toEqual([[], []]);
    expect(before.players.p2.bench).toHaveLength(0);
    expect(idsOf(before, before.players.p1.discard)).toEqual([LIGHT, LIGHT, LIGHT, WATER, PLAIN]);
    expect(before.turn).toBe(2);
    expect(table({ faces: HHH, bench: 0 }).players.p1.bench).toHaveLength(0);
    expect(table({ faces: HHH, bench: 5 }).players.p1.bench).toHaveLength(5);
  });

  it("🛑 (i) 3 heads → the FIRST of three parks: `effect:choose` / `choosePokemon { candidates: the two Bench refs, upTo 1 }` — the Active is NOT a candidate — the note MEASURED, the base 30 ALREADY dealt, the continuation holding D358's op with TWO copies in `rest`, the turn NOT ended (`D528-arm-loses-bench-only` sees the Active here; `-arm-doubles-the-op` sees five in `rest`)", () => {
    const { before, after, events } = swing({ faces: HHH });
    expect(after.phase.kind).toBe("effect:choose");
    expect(after.phase.kind === "effect:choose" && after.phase.seat).toBe("p1");
    const prompt = bodyPrompt(after);
    expect(prompt.candidates).toEqual([benchRef(0), benchRef(1)]);
    expect(prompt.candidates.some((ref) => ref.spot.spot === "active")).toBe(false);
    expect(prompt.upTo).toBe(1);
    expect(prompt.note).toBe(CAPTION);
    expect(flipRows(events).map((e) => e.result)).toEqual(HHH);
    expect(dealtRows(events)).toHaveLength(1);
    expect(dealtRows(events)[0]).toMatchObject({ seat: "p2", by: "p1", uid: activeUid(before, "p2"), dealt: BASE });
    expect(after.players.p2.active?.damage).toBe(BASE);
    expect(types(events)).toEqual([
      "ATTACK_DECLARED",
      "ATTACK_EFFECT_COIN_FLIP",
      "ATTACK_EFFECT_COIN_FLIP",
      "ATTACK_EFFECT_COIN_FLIP",
      "DAMAGE_DEALT",
      "EFFECT_PENDING",
    ]);
    expect(attachedRows(events)).toHaveLength(0);
    // Nothing moved at the park.
    expect(after.players.p1.discard).toEqual(before.players.p1.discard);
    expect(benchEnergies(after)).toEqual([[], []]);
    // The continuation holds the SHIPPED op, three times: one pending, two to come.
    expect(continuation(after).pendingOp).toEqual(OP);
    expect(continuation(after).rest).toEqual([OP, OP]);
  });

  it("🛑 (ii) three picks — Pal 0, Pal 1, Pal 0 — land ONE Basic {L} each: `ENERGY_ATTACHED` per pick, the second and third parks re-open with `rest` shrinking, Pal 0 ends with two {L} and Pal 1 with one, the pile keeps EXACTLY the Water and the Colorless (never offered, never attached — D448), the log row MEASURED, the turn ends (`D528-arm-loses-the-type` attaches the Water here)", () => {
    const { after: parked } = swing({ faces: HHH });
    const first = pick(parked, benchRef(0));
    expect(types(first.events)).toEqual(["ENERGY_ATTACHED", "EFFECT_PENDING"]);
    expect(attachedRows(first.events)[0]).toMatchObject({ seat: "p1", target: { spot: "bench", index: 0 } });
    expect(first.state.cardIdByUid[attachedRows(first.events)[0]?.uid ?? ""]).toBe(LIGHT);
    expect(benchEnergies(first.state)).toEqual([[LIGHT], []]);
    expect(idsOf(first.state, first.state.players.p1.discard)).toEqual([LIGHT, LIGHT, WATER, PLAIN]);
    expect(bodyPrompt(first.state).candidates).toEqual([benchRef(0), benchRef(1)]);
    expect(bodyPrompt(first.state).note).toBe(CAPTION);
    expect(continuation(first.state).pendingOp).toEqual(OP);
    expect(continuation(first.state).rest).toEqual([OP]);
    // MEASURED: `log.ts`'s ENERGY_ATTACHED row.
    expect(rows(first.events, first.state)).toContain("attached Lightning Energy → D528 Pal");

    const second = pick(first.state, benchRef(1));
    expect(types(second.events)).toEqual(["ENERGY_ATTACHED", "EFFECT_PENDING"]);
    expect(benchEnergies(second.state)).toEqual([[LIGHT], [LIGHT]]);
    expect(continuation(second.state).rest).toEqual([]);

    const third = pick(second.state, benchRef(0));
    expect(types(third.events)).toEqual(["ENERGY_ATTACHED", "TURN_ENDED", "TURN_STARTED", "CARDS_DRAWN"]);
    expect(benchEnergies(third.state)).toEqual([[LIGHT, LIGHT], [LIGHT]]);
    expect(idsOf(third.state, third.state.players.p1.discard)).toEqual([WATER, PLAIN]);
    expect(third.state.players.p1.active?.energy).toHaveLength(1); // the Active took nothing
    expect(dealtRows(third.events)).toHaveLength(0); // the base was dealt BEFORE the parks, not again
    expect(third.state.players.p2.active?.damage).toBe(BASE);
    expect(third.state.phase).toEqual({ kind: "turn:action", seat: "p2" });
    expect(third.state.turn).toBe(3);
    expect(rows(third.events, third.state)).toContain("attached Lightning Energy → D528 Pal");
    expect(rows(third.events, third.state)).toContain("ended their turn");
  });

  it("🛑 (iii) 2 heads (H T H) → TWO parks: the first park's `rest` holds ONE copy, the second's holds none, and the second pick ends the turn; 1 head (H T T) → ONE park with an empty `rest`, and its pick ends the turn (`D528-arm-face-is-tails` parks ONE on H T H)", () => {
    const two = swing({ faces: HTH });
    expect(flipRows(two.events).map((e) => e.result)).toEqual(HTH);
    expect(bodyPrompt(two.after).upTo).toBe(1);
    expect(continuation(two.after).rest).toEqual([OP]);
    const twoFirst = pick(two.after, benchRef(1));
    expect(types(twoFirst.events)).toEqual(["ENERGY_ATTACHED", "EFFECT_PENDING"]);
    expect(continuation(twoFirst.state).rest).toEqual([]);
    const twoSecond = pick(twoFirst.state, benchRef(1));
    expect(types(twoSecond.events)).toEqual(["ENERGY_ATTACHED", "TURN_ENDED", "TURN_STARTED", "CARDS_DRAWN"]);
    expect(benchEnergies(twoSecond.state)).toEqual([[], [LIGHT, LIGHT]]);
    expect(idsOf(twoSecond.state, twoSecond.state.players.p1.discard)).toEqual([LIGHT, WATER, PLAIN]);

    const one = swing({ faces: HTT });
    expect(flipRows(one.events).map((e) => e.result)).toEqual(HTT);
    expect(continuation(one.after).rest).toEqual([]);
    const oneFirst = pick(one.after, benchRef(0));
    expect(types(oneFirst.events)).toEqual(["ENERGY_ATTACHED", "TURN_ENDED", "TURN_STARTED", "CARDS_DRAWN"]);
    expect(benchEnergies(oneFirst.state)).toEqual([[LIGHT], []]);
    expect(oneFirst.state.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("🛑 (iv) 0 heads → NO park: the program is null, three tails rows, the base 30 dealt, the pile and the Bench UNCHANGED, no `EFFECT_PENDING`, no `ATTACK_EFFECT_SKIPPED`, the turn ends", () => {
    const { before, after, events } = swing({ faces: TTT });
    expect(flipRows(events).map((e) => e.result)).toEqual(TTT);
    expect(after.phase).toEqual({ kind: "turn:action", seat: "p2" });
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
    expect(attachedRows(events)).toHaveLength(0);
    expect(dealtRows(events)).toHaveLength(1);
    expect(after.players.p2.active?.damage).toBe(BASE);
    expect(after.players.p1.discard).toEqual(before.players.p1.discard);
    expect(benchEnergies(after)).toEqual([[], []]);
  });

  it("🛑 (v) a pile holding ONE {L} under 3 heads: the first copy parks and attaches it, the second and third are SILENT no-ops (the op's own guard answers `done` on a pile with no matching Basic Energy) — the Water and the Colorless stay in the pile", () => {
    const { after } = swing({ faces: HHH, pile: { [LIGHT]: 1, [WATER]: 1, [PLAIN]: 1 } });
    expect(bodyPrompt(after).candidates).toEqual([benchRef(0), benchRef(1)]);
    expect(continuation(after).rest).toEqual([OP, OP]);
    const { state, events } = pick(after, benchRef(1));
    expect(types(events)).toEqual(["ENERGY_ATTACHED", "TURN_ENDED", "TURN_STARTED", "CARDS_DRAWN"]);
    expect(benchEnergies(state)).toEqual([[], [LIGHT]]);
    expect(idsOf(state, state.players.p1.discard)).toEqual([WATER, PLAIN]);
    expect(state.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("🛑 (vi) a pile holding NO {L} — the Water and the Colorless only — under 3 heads: NO park at all, nothing attached, both cards still in the pile, the turn ends (D448's fixture rule, falsified: the type filter is what keeps them there; `D528-arm-loses-the-type` parks here)", () => {
    const { before, after, events } = swing({ faces: HHH, pile: { [WATER]: 1, [PLAIN]: 1 } });
    expect(idsOf(before, before.players.p1.discard)).toEqual([WATER, PLAIN]);
    expect(flipRows(events).map((e) => e.result)).toEqual(HHH);
    expect(after.phase).toEqual({ kind: "turn:action", seat: "p2" });
    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(attachedRows(events)).toHaveLength(0);
    expect(idsOf(after, after.players.p1.discard)).toEqual([WATER, PLAIN]);
    expect(benchEnergies(after)).toEqual([[], []]);
    expect(after.players.p2.active?.damage).toBe(BASE);
  });

  it("🛑 (vii) an EMPTY Bench under 3 heads → NO park (`parkOrForce` answers `done` on zero candidates), the pile UNCHANGED, the Active takes NOTHING, the turn ends", () => {
    const { before, after, events } = swing({ faces: HHH, bench: 0 });
    expect(before.players.p1.bench).toHaveLength(0);
    expect(after.phase).toEqual({ kind: "turn:action", seat: "p2" });
    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(attachedRows(events)).toHaveLength(0);
    expect(after.players.p1.discard).toEqual(before.players.p1.discard);
    expect(after.players.p1.active?.energy).toHaveLength(1);
  });

  it("🛑 (viii) DECLINE at copy 1 STILL parks copy 2 (independent decisions, D358): decline → `EFFECT_PENDING` with `rest` shrunk and nothing attached; pick → attached; decline → the turn ends with ONE {L} on the Bench and two still in the pile (`D528-arm-loses-declinable` FORCES on a one-body Bench — see (ix))", () => {
    const { after } = swing({ faces: HHH });
    const first = decline(after);
    expect(types(first.events)).toEqual(["EFFECT_PENDING"]);
    expect(attachedRows(first.events)).toHaveLength(0);
    expect(benchEnergies(first.state)).toEqual([[], []]);
    expect(continuation(first.state).pendingOp).toEqual(OP);
    expect(continuation(first.state).rest).toEqual([OP]);
    const second = pick(first.state, benchRef(1));
    expect(types(second.events)).toEqual(["ENERGY_ATTACHED", "EFFECT_PENDING"]);
    expect(benchEnergies(second.state)).toEqual([[], [LIGHT]]);
    const third = decline(second.state);
    expect(types(third.events)).toEqual(["TURN_ENDED", "TURN_STARTED", "CARDS_DRAWN"]);
    expect(benchEnergies(third.state)).toEqual([[], [LIGHT]]);
    expect(idsOf(third.state, third.state.players.p1.discard)).toEqual([LIGHT, LIGHT, WATER, PLAIN]);
    expect(third.state.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("🛑 (ix) a ONE-body Bench still ASKS (D359's `upTo` moves the forced arm): one candidate, `upTo 1`, and a decline is accepted; a Bench of FIVE offers all five", () => {
    const one = swing({ faces: HHH, bench: 1 });
    expect(one.after.phase.kind).toBe("effect:choose");
    expect(bodyPrompt(one.after).candidates).toEqual([benchRef(0)]);
    expect(bodyPrompt(one.after).upTo).toBe(1);
    const declined = decline(one.after);
    expect(types(declined.events)).toEqual(["EFFECT_PENDING"]);
    expect(benchEnergies(declined.state)).toEqual([[]]);
    const five = swing({ faces: HHH, bench: 5 });
    expect(bodyPrompt(five.after).candidates).toEqual([0, 1, 2, 3, 4].map(benchRef));
  });

  it("🛑 (x) the REFUSALS: the Active's ref, the opponent's ref, a `take` above 1 and the wrong seat are all refused, and the park stands", () => {
    const { after } = swing({ faces: HHH });
    const active = applyAction(after, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon", ref: { seat: "p1", spot: { spot: "active" } } },
    });
    expect(active.ok).toBe(false);
    if (active.ok) throw new Error("the Active was accepted");
    expect(active.error.code).toBe("BAD_EFFECT_CHOICE");
    const theirs = applyAction(after, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon", ref: { seat: "p2", spot: { spot: "active" } } },
    });
    expect(theirs.ok).toBe(false);
    if (theirs.ok) throw new Error("the opponent's body was accepted");
    expect(theirs.error.code).toBe("BAD_EFFECT_CHOICE");
    const over = applyAction(after, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemon", ref: benchRef(0), take: 2 },
    });
    expect(over.ok).toBe(false);
    if (over.ok) throw new Error("a take above the ceiling was accepted");
    expect(over.error.code).toBe("BAD_EFFECT_CHOICE");
    const wrongSeat = applyAction(after, { type: "resolveEffect", seat: "p2", choice: { kind: "pokemon", ref: benchRef(0) } });
    expect(wrongSeat.ok).toBe(false);
    if (wrongSeat.ok) throw new Error("the wrong seat answered");
    expect(wrongSeat.error.code).toBe("WRONG_SEAT");
  });

  it("🛑 (xi) `rngState` advances EXACTLY three `flipCoin` steps and the log carries ONE `ATTACK_EFFECT_COIN_FLIP` row per coin, on every face pattern", () => {
    for (const faces of [HHH, HTH, HTT, TTT]) {
      const { before, after, events } = swing({ faces });
      expect(after.rngState, faces.join("-")).toBe(stepped(before.rngState, 3));
      expect(after.rngState, faces.join("-")).not.toBe(stepped(before.rngState, 1));
      expect(flipRows(events), faces.join("-")).toHaveLength(3);
      expect(flipRows(events).map((e) => e.result), faces.join("-")).toEqual(faces);
      for (const row of flipRows(events)) expect(row.seat).toBe("p1");
    }
  });

  it("🛑 (xii) replays identically from one `rngState` — the same parked board and the same events twice; and the parked state JSON round-trips BYTE-EQUAL and resumes from its bytes", () => {
    const a = swing({ faces: HHH });
    const b = swing({ faces: HHH });
    expect(b.before.rngState).toBe(a.before.rngState);
    expect(b.after).toEqual(a.after);
    expect(b.events).toEqual(a.events);
    const persisted = JSON.parse(JSON.stringify(a.after)) as GameState;
    expect(persisted).toEqual(a.after);
    expect(JSON.stringify(persisted)).toBe(JSON.stringify(a.after));
    const live = pick(a.after, benchRef(1));
    const replayed = pick(persisted, benchRef(1));
    expect(replayed.events).toEqual(live.events);
    expect(replayed.state).toEqual(live.state);
  });

  it("🛑 (xiii) the OPPONENT's redacted view: the prompt is NOT theirs (`prompt: null`), the continuation does not reach them (no `pendingOp`, no `attachEnergyFrom` in their view), and the pile is PUBLIC in both views; P1's own view carries the prompt with the two Bench refs", () => {
    const { after: parked } = swing({ faces: HHH });
    const theirs = redactGame(parked, "p2");
    expect(theirs.phase).toEqual({ kind: "effect:choose", prompt: null });
    const theirBytes = JSON.stringify(theirs);
    expect(theirBytes).not.toContain("pendingOp");
    expect(theirBytes).not.toContain("attachEnergyFrom");
    expect(theirBytes).not.toContain("programPerHeads");
    expect(theirs.board.opponent.discard.map((c) => c.name)).toEqual([
      "Lightning Energy",
      "Lightning Energy",
      "Lightning Energy",
      "Water Energy",
      PLAIN,
    ]);
    const mine = redactGame(parked, "p1");
    if (mine.phase.kind !== "effect:choose" || mine.phase.prompt?.kind !== "choosePokemon") {
      throw new Error("P1's view does not carry the choosePokemon prompt");
    }
    expect(mine.phase.prompt.candidates).toEqual([benchRef(0), benchRef(1)]);
    expect(mine.phase.prompt.upTo).toBe(1);
    expect(mine.phase.prompt.note).toBe(CAPTION);
    expect(mine.board.you.discard).toHaveLength(5);
  });

  it("🛑 (xiv) the index-1 control: no flip, no park, no `ENERGY_ATTACHED`, 30 dealt, `rngState` UNMOVED, the pile UNMOVED, the turn ends", () => {
    const { before, after, events } = swing({ faces: HHH }, 1);
    expect(flipRows(events)).toHaveLength(0);
    expect(after.rngState).toBe(before.rngState);
    expect(after.phase).toEqual({ kind: "turn:action", seat: "p2" });
    expect(types(events)).toEqual(["ATTACK_DECLARED", "DAMAGE_DEALT", "TURN_ENDED", "TURN_STARTED", "CARDS_DRAWN"]);
    expect(attachedRows(events)).toHaveLength(0);
    expect(after.players.p2.active?.damage).toBe(BASE);
    expect(after.players.p1.discard).toEqual(before.players.p1.discard);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — the persisted address: `MATCH_RECORD_VERSION` HOLDS at 30 — what parks is D358's op bytes.
// ─────────────────────────────────────────────────────────────────────────────

describe("D528 §3 — `MATCH_RECORD_VERSION` HOLDS at 30 (🆕🆕🆕 held at THIS slice; 31 since D547; 32 since D548; 33 since D549; 34 since D552; 35 since D556; 36 since D564; 37 since D570): the continuation's alphabet is D358's shipped op, and the member reaches no record", () => {
  it("🛑 the parked `pendingOp`'s key set, sorted, is EXACTLY the shipped sibling's — `benchOnly`, `declinable`, `energyType`, `op`, `source` — and its JSON is the sibling's op byte for byte", () => {
    const parked = swing({ faces: HHH }).after;
    const cont = continuation(parked);
    expect(Object.keys(cont.pendingOp).sort()).toEqual(["benchOnly", "declinable", "energyType", "op", "source"]);
    expect(Object.keys(cont).sort()).toEqual(["ctx", "pendingOp", "rest"]);
    const shipped = JSON.stringify(deriveAttackEffect(SIBLING)?.[0]);
    expect(JSON.stringify(cont.pendingOp)).toBe(shipped);
    expect(cont.rest.map((op) => JSON.stringify(op))).toEqual([shipped, shipped]);
  });

  it("🛑 `AttackCoinFlip` reaches NO record: the parked board's JSON spells neither the member's `kind` nor its `face`/`flips` fields — the reading is derived from text at the attack site and spent at the fold", () => {
    const parked = swing({ faces: HHH }).after;
    const bytes = JSON.stringify(parked);
    expect(bytes).not.toContain("programPerHeads");
    expect(bytes).not.toContain('"face"');
    expect(bytes).not.toContain('"flips"');
    expect(bytes).toContain('"op":"attachEnergyFrom"');
    // …and the member itself is plain data (no functions, no cycles) — round-trippable if it ever were.
    expect(JSON.parse(JSON.stringify(READING))).toEqual(READING);
  });

  it("🛑 `MATCH_RECORD_VERSION` is 37 (🆕🆕🆕 D570 stepped it 36 → 37; D564 stepped it 35 → 36; D556 stepped it 34 → 35; D552 stepped it 33 → 34; D549 stepped it 32 → 33; D548 stepped it 31 → 32; D547 stepped it 30 → 31; this slice held it) in `apps/api` — nothing at a persisted address changed shape", () => {
    const match = Object.entries(RAW).find(([k]) => k.endsWith("/lobby/match.ts"))?.[1] ?? "";
    // 🆕🆕🆕 D547 — the constant this slice held is now 31: D547 added two REQUIRED `InPlayPokemon` fields (apps/api match.ts).
    expect(match).toContain("export const MATCH_RECORD_VERSION = 37;");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — the census figures, with their units, and the version.
// ─────────────────────────────────────────────────────────────────────────────

const RAW: Record<string, string> = (
  import.meta as unknown as {
    glob(
      pattern: string | readonly string[],
      options: { query: "?raw"; import: "default"; eager: true },
    ): Record<string, string>;
  }
).glob(["./{censusAttackCorpus,index,effects,attack}.ts", "../../../apps/api/src/lobby/match.ts"], {
  query: "?raw",
  import: "default",
  eager: true,
});

describe("D528 §4 — the census moved in exactly ONE summand, by 1 sentence / 1 printing; the version steps", () => {
  it("🛑 the reader arm reads 555 sentences / 1,597 printings, and the row is IN it", () => {
    // 🆕🆕🆕 D528's OWN literals, annotated in-slice so the next sweep sees them (D523 (4)/D524 (4)/D525 (5)/D526 (6)/D527 (7)):
    // the reader arm 554/1596 → 555/1597 — corpus FILE LINE 215, ⚠️ sentence step 1 / printing step 1
    // (ONE legal printing — the two chains step by the SAME amount this slice).
    const resolved = legalAttackCorpus().filter(([, s]) => resolvedByAnyReader(s));
    expect([resolved.length, units(resolved)]).toEqual([586, 1642]);  // (🆕🆕🆕 **D569 +4 sentences / +6 printings — THE PARADOX BANNER READERS** — Koraidon `sv05-119`/`svp-091` "Primordial Beatdown" (`IN_PLAY_BODY_NOUNS` "Ancient Pokémon"), Roaring Moon `sv05-109`/`sv08.5-065` "Vengeance Fletching" (`DISCARD_PILE_NOUNS` "Ancient card"), Iron Valiant `sv05-080` "Majestic Sword" and Slither Wing `sv06.5-026` "Iron Smasher" (two literal `CONDITIONAL_DAMAGE_CLAUSES` rows), all over `banners.ts`' widened table (582/1636 → 586/1642)) (🆕🆕🆕 **D568 +2 sentences / +2 printings — THE TWO TERA CLAUSES, NOW THAT THE BANNER HAS A WRITER** — Ho-Oh `sv08-019` "Shining Blaze" (*"If you have any Tera Pokémon on your Bench, this attack does 100 more damage."*) and Regigigas `sv08.5-086` "Jewel Breaker" (*"If your opponent's Active Pokémon is a Tera Pokémon, this attack does 230 more damage."*), one legal printing each, two literal `CONDITIONAL_DAMAGE_CLAUSES` rows over `banners.ts` (580/1634 → 582/1636)) (🆕🆕🆕 **D552 +2 sentences / +2 printings — THE PRE-DAMAGE SELF ATTACH BEHIND A MULTIPLIER HEAD, AND THE WEAKNESS RETYPE** — `censusAttackCorpus.ts` **file lines 569 and 629** (leading count column `1` each; card ids UNRESOLVED on this checkout — measured, never invented, D425): `:569` claimed WHOLE by `deriveAttackDiscardScaledBoost`'s THIRD member `selfHandAttach` (attach-then-damage inside the program), `:629` by `deriveAttackEffect` through ONE new anchor `DEFENDER_WEAKNESS_RETYPED` as ONE new op `retypeDefenderWeakness` — a READER move: reader arm 578/1632 → 580/1634, raw residue 62/100 → 60/98, `BUILT.attack` 1688 → 1690; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.435.0 → 0.436.0, `MATCH_RECORD_VERSION` 33 → 34. ⚠️ THE SENTENCE STEP (2) AND THE PRINTING STEP (2) AGREE this slice — the case where a copied number is right BY ACCIDENT, so every site was classified by the quantity its D550 note names (D426/D451). THIS SITE: reader arm 578/1632 → 580/1634.)  // (🆕🆕🆕 **D550 +1 sentence / +1 printing — THE OPPONENT-FLIPPED PER-TAILS SNIPE ON THE OPPONENT'S BENCH COUNT** — `censusAttackCorpus.ts` **file line 669** (leading count column `1`; card id UNRESOLVED on this checkout — measured, never invented, D425), claimed WHOLE by `deriveAttackCoinFlip` (a NINTH member `opponentPerTails` over a NULLARY `AttackFlipCount.opponentBench`) AND by `deriveAttackDamageSuppression`'s THIRD compound arm off ONE anchor, `ATTACK_OPPONENT_BENCH_TAILS` — a READER move: reader arm 577/1631 → 578/1632, raw residue 63/101 → 62/100, `BUILT.attack` 1687 → 1688, PHRASE-24 1/1 → 0/0; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.434.0 → 0.435.0, `MATCH_RECORD_VERSION` HOLDS at 33. ⚠️ THE SENTENCE STEP (1) AND THE PRINTING STEP (1) AGREE this slice — the case where a copied number is right BY ACCIDENT, so every site was classified by the quantity its D549 note names (D426/D451). THIS SITE: reader arm 577/1631 → 578/1632.)  // (🆕🆕🆕 **D549 +4 sentences / +4 printings — THE DEFENDER'S NEXT-TURN MARKS AND THE SIDE-WIDE ATTACK LOCK** — `censusAttackCorpus.ts` **file lines 171, 149, 169 and 170** (leading count column `1` each; card ids UNRESOLVED on this checkout — measured, never invented, D425), claimed WHOLE by `deriveAttackEffect` alone through FOUR new anchors as THREE new ops (`taxDefender`, `bountyDefender`, `lockSideAttacks`) — a READER move: reader arm 573/1627 → 577/1631, raw residue 67/105 → 63/101, `BUILT.attack` 1683 → 1687; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.433.0 → 0.434.0, `MATCH_RECORD_VERSION` 32 → 33. ⚠️ THE SENTENCE STEP (4) AND THE PRINTING STEP (4) AGREE this slice — the case where a copied number is right BY ACCIDENT, so every site was classified by the quantity its D548 note names (D426/D451). THIS SITE: reader arm 573/1627 → 577/1631.)  // (🆕🆕🆕 **D548 +1 sentence / +2 printings — CRESCENT PURGE, THE FACE-UP PRIZE** — `censusAttackCorpus.ts` **file line 664**, Cresselia `sv06.5-021` "Crescent Purge", claimed WHOLE by `deriveAttackOptionalCostBoost`'s FIFTH cost row (`turnPrizeFaceUp` behind `yourFaceDownPrizeRemains`); engine 0.432.0 → 0.433.0, `MATCH_RECORD_VERSION` 31 → 32. ⚠️ THE SENTENCE STEP (1) AND THE PRINTING STEP (2) DIFFER. THIS SITE: reader arm 572/1625 → 573/1627.)  // (🆕🆕🆕 **D547 +2 sentences / +4 printings — THE FLIP-TO-ATTACK LOCK AND THE NEXT-TURN VULNERABILITY** — `censusAttackCorpus.ts` **file lines 176 and 150** (leading count column `2` each), *“During your opponent's next turn, if the Defending Pokémon tries to use an attack, your opponent flips a coin. If tails, that attack doesn't happen.”* (TWO sentences in ONE row) and *“During your next turn, the Defending Pokémon takes 50 more damage from attacks (after applying Weakness and Resistance).”*, **2 rows / 4 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so both suites ride file-local declared `d547-*` demonstrators), claimed WHOLE by `deriveAttackEffect` through TWO new anchors (`DEFENDER_FLIP_ATTACK_LOCK`, `DEFENDER_VULNERABLE_NEXT_TURN`) as TWO new ops (`flipLockAttack`, `exposeDefender`) on TWO new REQUIRED `InPlayPokemon` fields — a READER move: reader arm 570/1621 → 572/1625, raw residue 70/111 → 68/107, `BUILT.attack` 1677 → 1681; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.431.0 → 0.432.0, `MATCH_RECORD_VERSION` 30 → 31. ⚠️ **THE SENTENCE STEP (2) AND THE PRINTING STEP (4) DIFFER**, so no copied number is right by accident; every site was classified by the quantity its D546 note names (D426/D451). THIS SITE: reader arm 570/1621 → 572/1625.)  // (🆕🆕🆕 **D546 +2 sentences / +2 printings — THE ALL-ATTACKS NEXT-TURN BUFF** — `censusAttackCorpus.ts` **file lines 76 and 148** (leading count column `1` each), *“During your next turn, attacks used by this Pokémon do 120 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance).”* and the same sentence at 100 behind *“Both Active Pokémon are now Asleep.”*, **2 sentences / 2 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so the suite rides file-local declared `d546-*` demonstrators), claimed WHOLE by `deriveAttackEffect` through ONE new whole-sentence anchor (`SELF_EVERY_ATTACK_BOOST`, ONE `['’]` slot, an optional Sleep prefix) as `attack: null` on the SHIPPED `boostAttack` op — no new `EffectOp` member, no new `InPlayPokemon` field — a READER move: reader arm 568/1619 → 570/1621, raw residue 72/113 → 70/111, `BUILT.attack` 1675 → 1677; registry 10/16, gate 9/19, trailing 11/21, `SPLIT_ATTACK_UNITS` 19 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED (19 READ at `censusAtHead.test.ts:8169`); engine 0.430.0 → 0.431.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP ARE BOTH 2 — THE ONE SHAPE WHERE A COPIED NUMBER IS RIGHT BY ACCIDENT**, so every site was measured by the quantity it pins, not copied (D426/D451). THIS SITE: reader arm 568/1619 → 570/1621.)  // (🆕🆕🆕 **D544 +1 sentence / +2 printings — THE NAMED ATTACK'S BASE DAMAGE, OVERRIDDEN FOR ONE WINDOW** — `censusAttackCorpus.ts` **file line 166** (leading count column `2`), *“During your next turn, this Pokémon's Hyper Fang attack's base damage is 240.”*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so the suite rides the file-local declared demonstrator `d544-fang`), claimed WHOLE by `deriveAttackEffect` through ONE new whole-sentence anchor (`SELF_ATTACK_BASE_SET`, TWO `['’]` slots, name and number CAPTURED) as a `base: true` RIDER on the SHIPPED `boostAttack` op — no new `EffectOp` member, no new `InPlayPokemon` field — a READER move: reader arm 567/1617 → 568/1619, raw residue 73/115 → 72/113, `BUILT.attack` 1671 → 1673; registry 10/16, gate 7/17, trailing 11/21, `SPLIT_ATTACK_UNITS` 17 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED (17 READ at `censusAtHead.test.ts:8159` — the “14” in D543's annotation beside this one has been stale since D541 moved the constant); engine 0.428.0 → 0.429.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — THEY DISAGREE**, so no number may be copied from one kind of site into another (D426/D451). THIS SITE: reader arm 567/1617 → 568/1619.)  // (🆕🆕🆕 **D543 +1 sentence / +2 printings — THE CHOSEN POKÉMON TOOL DISCARD AT THE PROGRAM TAIL** — `censusAttackCorpus.ts` **file line 136** (leading count column `2`), *“Discard up to 2 Pokémon Tools from your opponent's Pokémon.”*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrator `d543-stripper`), claimed WHOLE by `deriveAttackEffect` through ONE new whole-sentence anchor (`ATTACK_DISCARD_TOOLS_UP_TO`, ONE `['’]` slot at index 48, count CAPTURED) as ONE new `EffectOp` member `discardTools{count}` parking on ONE new `EffectPrompt` kind — a READER move: reader arm 566/1615 → 567/1617, raw residue 74/117 → 73/115, `BUILT.attack` 1669 → 1671; registry 10/16, gate 7/17, trailing 11/21, `SPLIT_ATTACK_UNITS` 14 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED; engine 0.427.0 → 0.428.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — THEY DISAGREE**, so no number may be copied from one kind of site into another (D426/D451). THIS SITE: reader arm 566/1615 → 567/1617.)  // (🆕🆕🆕 **D542 +1 sentence / +1 printing — THE OPPONENT-CHOSEN HAND SHUFFLE** — `censusAttackCorpus.ts` **file line 665** (`legalAttackCorpus()` index 612, leading count column `1`), *“Your opponent chooses 3 cards from their hand and shuffles those cards into their deck.”*, **1 sentence / 1 legal printing**, claimed WHOLE by `deriveAttackEffect` through ONE new anchor and ONE new arm returning a COMPOSITION of two shipped ops — so it leaves through the RAW READER summand and the registry / gate-split / trailing-split summands all stand still. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1, WHICH IS THE ONE CASE WHERE A COPIED NUMBER IS RIGHT BY ACCIDENT — so THIS SITE WAS MEASURED rather than inherited from its neighbour** (D426/D451).)  (🆕🆕🆕 **D540 +1 sentence / +1 printing — THE DEVOLUTION WITH A PICK IN IT, AND THE `/[Dd]evolv/` FAMILY CLOSES** — `censusAttackCorpus.ts` **row 87** (`legalAttackCorpus()` index 34, leading count column `1`), *"Devolve 1 of your opponent's evolved Pokémon by putting the highest Stage Evolution card on it into your opponent's hand."*, **1 sentence / 1 legal printing** (no card id resolves on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrators `d540-*`), claimed by `deriveAttackEffect` through ONE new anchor `DEVOLVE_CHOSEN_TO_HAND` and arm 41-ter into ONE new FIELD-FREE `EffectOp` member `devolveChosen` — a READER move: reader arm 564/1613 → 565/1614, raw residue 76/119 → 75/118, `BUILT.attack` 1664 → 1665, residue 49/68 → 48/67; registry 10/16, gate 6/14, trailing 11/21, `SPLIT_ATTACK_UNITS` 14, `COMPOUND_ATTACK_UNITS` 21 and `attackReaderSurface()` 13 UNMOVED; engine 0.424.0 → 0.425.0, `MATCH_RECORD_VERSION` HELD at 30 (D125's widening at a persisted address — and this op DOES park, so a record really can hold it, which is why the version claim rests on the widening and not on parking). ⚠️ THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 1 — they AGREE for the first time in six slices, which is the one case where a copied number would be right by accident, so every site was measured.)  // (🆕🆕🆕 **D539 +1 sentence / +2 printings — THE NAMED-BODY MULTIPLIER WITH A NAMED-BODY OWN-SIDE SPREAD BEHIND IT** — `censusAttackCorpus.ts` **FILE LINE 595** (`legalAttackCorpus()` index 542), *"This attack does 50 damage for each of your Drifloon and Drifblim in play. This attack also does 30 damage to each of your Drifloon and Drifblim. (Don't apply Weakness and Resistance for Benched Pokémon.)"*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrators `d539-*`), claimed by TWO readers off ONE `effect` string through ONE new whole-compound anchor carrying a `\2` BACKREFERENCE (`NAMED_BODIES_MULTIPLY_SPREAD`) — `deriveAttackDamageMultiplier` for the × fold and `deriveAttackEffect` for `damageChosen` with the FOURTH `target` member `yourAny` and `count: "all"`, plus the NINTH `IN_PLAY_BODY_NOUNS` exact key — a READER move: reader arm 563/1611 → 564/1613, raw residue 77/121 → 76/119, `BUILT.attack` 1662 → 1664; registry 10/16, gate 6/14, trailing 11/21, `SPLIT_ATTACK_UNITS` 14, `COMPOUND_ATTACK_UNITS` 21 and `attackReaderSurface()` 13 UNMOVED; engine 0.423.0 → 0.424.0, `MATCH_RECORD_VERSION` HELD at 30 (a WIDENING at a persisted address, D125's free case — and `count: "all"` NEVER PARKS, so no record that can exist holds the new value). ⚠️ THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — they disagree for the FIFTH slice running (D535 1-vs-2, D536 1-vs-3, D537 1-vs-2, D538 1-vs-3), so a pass that copied one number into the other kind of site would be wrong in half of them. THIS SITE: 563/1611 → 564/1613.)  // (🆕🆕🆕 **D538 +1 sentence / +3 printings — THE COUNTER PLACEMENT WHOSE AMOUNT IS A PAYLOAD AND WHOSE TAIL SHUFFLES THE VERY CARDS IT COUNTED** — `censusAttackCorpus.ts` **FILE LINE 412** (`legalAttackCorpus()` index 359), *"Put 2 damage counters on 1 of your opponent's Pokémon for each Basic {G} Energy card in your discard pile. Then, shuffle those Energy cards into your deck."*, **1 sentence / 3 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrator `d538-pile-sniper`), claimed by `deriveAttackEffect` through ONE new whole-sentence TWO-capture anchor (`COUNTER_PUT_SCALED_BY_PILE`, declared with the counter-put family, ONE `['’]` slot) as arm **23b-bis** emitting THREE ops — `damageChosen{perDiscardPileCard}` + `discardPileRetrieval{max:"all"}` + `shuffleDeck`, with ONE `CardFilter` object shared by the first two — a READER move: reader arm 562/1608 → 563/1611, raw residue 78/124 → 77/121, `BUILT.attack` 1659 → 1662; registry 10/16, gate 6/14, trailing 11/21, `SPLIT_ATTACK_UNITS` 14 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED; engine 0.422.0 → 0.423.0, `MATCH_RECORD_VERSION` HELD at 30 (a NEW OPTIONAL KEY is D125's WIDENING and `max: "all"` is a PURE ADDITION to a value domain — and BOTH bytes are written into the record, through `phase.cont.pendingOp` and `phase.cont.rest` respectively). ⚠️ THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 3 — they disagree for the FOURTH slice running (D535 1-vs-2, D536 1-vs-3, D537 1-vs-2), so a pass that copied one number into the other kind of site would be wrong in half of them. THIS SITE: 562/1608 → 563/1611.)  // (🆕🆕🆕 **D537 +1 sentence / +2 printings — KEEP THREE, SHUFFLE THE REST: THE ONLY SENTENCE IN THIS CORPUS WHOSE PICK NAMES THE BODIES THAT *STAY* — ONE NEW `EffectOp` MEMBER `returnBenchedRest` AND ONE INTERPRETER WRITER** — `censusAttackCorpus.ts` **FILE LINE 84** (`legalAttackCorpus()` index 31), *"Choose 3 of your opponent's Benched Pokémon. If you do, shuffle all of your opponent's Benched Pokémon that you didn't choose, and all cards attached to those Pokémon, into their deck."*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrator `d537-bencher`), claimed by `deriveAttackEffect` through ONE new ONE-capture whole-sentence anchor (`CHOOSE_KEEP_SHUFFLE_REST`, beside `RETURN_BENCHED`, THREE `['’]` slots — two possessives AND the contraction in "didn't") as arm **42-bis** emitting ONE `returnBenchedRest{keep:3}` — a READER move: reader arm 561/1606 → 562/1608, raw residue 79/126 → 78/124, `BUILT.attack` 1657 → 1659; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.421.0 → 0.422.0, `MATCH_RECORD_VERSION` HELD at 30 (a new op MEMBER is D125's WIDENING — and this op PARKS, so the byte IS written into `phase.cont.pendingOp`). ⚠️ THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — they disagree for the third slice running (D535 1-vs-2, D536 1-vs-3), so a pass that copied one number into the other kind of site would be wrong in half of them. THIS SITE: 561/1606 → 562/1608.)  // (🆕🆕🆕 **D536 +1 sentence / +3 printings — THE BODY THAT LEAVES PLAY WITHOUT BEING KNOCKED OUT — ONE NEW FIELD-FREE `EffectOp` MEMBER `discardDefender` AND ONE INTERPRETER WRITER** — `censusAttackCorpus.ts` **FILE LINE 100** (`legalAttackCorpus()` index 47), *"Discard a Team Rocket's Energy from this Pokémon. If you do, discard your opponent's Active Pokémon and all attached cards."*, **1 sentence / 3 legal printings** (Moltres ex `sv10-031`/`-208`/`-229` — the ids ARE resolved on this checkout and are used as ids; the printed BASE DAMAGE is NOT, so it is driven on the file-local declared demonstrator `d536-moltres`, D425), claimed by `deriveAttackEffect` through ONE new ZERO-capture anchor (`TR_ENERGY_COST_THEN_DISCARD_DEFENDER`, beside `HAND_COST_THEN_OPPONENT_DISCARD`) as `discardEnergy{from:"yourActive", filter:{byName "Team Rocket's Energy"}, recordAs:"discarded"}` gated through the FIRST shipped `recordGate{slot:"discarded"}` into the new `discardDefender` — a READER move: reader arm 560/1603 → 561/1606, raw residue 80/129 → 79/126, `BUILT.attack` 1654 → 1657; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.420.0 → 0.421.0, `MATCH_RECORD_VERSION` HELD at 30 (a new op MEMBER is D125's WIDENING; the op never parks and is FIELD-FREE). ⚠️ THE SENTENCE STEP AND THE PRINTING STEP DISAGREE AT 1 AND 3 — harder than D535's 1-and-2, so a pass that copied one number into the other kind of site would be wrong in half of them. THIS SITE: 560/1603 → 561/1606.)  // (🆕🆕🆕 **D535 +1 sentence / +2 printings — THE PICK-WITH-REPLACEMENT SNIPE — ZERO NEW VOCABULARY: SIX `damageChosen` OPS AT `count: 1`, THE LITERAL `CHOSEN_ANY_TARGET` ALREADY AUTHORS** — `censusAttackCorpus.ts` **FILE LINE 81** (`legalAttackCorpus()` index 28), *"Choose 1 of your opponent's Pokémon 6 times. (You can choose the same Pokémon more than once.) For each time you chose a Pokémon, do 20 damage to it. This damage isn't affected by Weakness or Resistance."*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — no D1, no catalog sqlite — stated unresolved, never invented, D425), claimed by `deriveAttackEffect` through ONE new TWO-capture anchor (`ATTACK_PICK_WITH_REPLACEMENT_SNIPE`, beside `CHOSEN_ANY_TARGET`) as SIX `damageChosen{target:"opponentAny", amount:20, count:1, source:"attack", deals, ignoreWR}` parks — a READER move: reader arm 559/1601 → 560/1603, raw residue 81/131 → 80/129; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.419.0 → 0.420.0, `MATCH_RECORD_VERSION` HELD at 30 (D237's POPULATION change — the op literal already ships, so the serialized alphabet does not grow). ⚠️ THE SENTENCE STEP AND THE PRINTING STEP DISAGREE AT 1 AND 2 — the legal column prints this sentence TWICE.)  // (🆕🆕🆕 **D534 +1 sentence / +1 printing — THE ONE-CARD LOOK AT THE OPPONENT's DECK WITH A PRINTED SHUFFLE — `shuffleDeck` GAINS THE OPTIONAL KEY `whose: "opponent"` and `reorderTop` PARKS A ONE-CARD WINDOW WHEN ITS TWO ARMS DIFFER** — `censusAttackCorpus.ts` **FILE LINE 401**, *"Look at the top card of your opponent's deck. You may have your opponent shuffle their deck."*, **1 sentence / 1 legal printing** (Inkay `sv06.5-033`; no id on this checkout, D425), claimed by `deriveAttackEffect` through ONE new zero-capture anchor (`ATTACK_OPPONENT_TOP_LOOK_SHUFFLE`, beside `ATTACK_REORDER_TOP`) as `reorderTop{n:1, side:"opponent", otherwise:[shuffleDeck{whose:"opponent"}]}` — a READER move: reader arm 558/1600 → 559/1601, raw residue 82/132 → 81/131; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.418.0 → 0.419.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1.)  // (🆕🆕🆕 **D532 +1 sentence / +1 printing — THE CROSS-SEAT DISCARD-PILE ATTACH — `attachEnergyFrom` GAINS THE OPTIONAL KEY `whose: "opponent"` (on the op AND on `AttachTargetRiders`, read through ONE resolver)** — `censusAttackCorpus.ts` **FILE LINE 70** (`legalAttackCorpus()` index 17), *"Attach up to 3 Energy cards from your opponent's discard pile to their Pokémon in any way you like."*, **1 sentence / 1 legal printing** (Grafaiai `sv08-121`; no id on this checkout, D425), claimed by `deriveAttackEffect` through ONE new zero-capture anchor (`ATTACK_OPPONENT_DISCARD_ATTACH`, beside the factory-built `DISCARD_ATTACH`) as D360's spread ONE KEY OVER — a READER move: reader arm 557/1599 → 558/1600, raw residue 83/133 → 82/132; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.417.0 → 0.418.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1.)  // (🆕🆕🆕 **D531 +1 sentence / +1 printing — THE BOARD-TYPED HAND SEARCH — `searchDeck` GAINS THE PARK-TIME RIDER `typedAsAttachedBasicEnergy`** — `censusAttackCorpus.ts` **FILE LINE 483** (`legalAttackCorpus()` index 430), *"Search your deck for up to 5 Pokémon that are the same type as any Basic Energy attached to this Pokémon, reveal them, and put them into your hand. Then, shuffle your deck."*, **1 sentence / 1 legal printing** (sv07-065 per the retired D231 deferral; no id on this checkout, D425), claimed by `deriveAttackEffect` through ONE new zero-capture anchor (`ATTACK_HAND_SEARCH_TYPED_AS_ATTACHED`, beside `ATTACK_HAND_SEARCH_BENCH_COUNT`) whose rider the park resolves against the SOURCE body's attached Basic Energy — a READER move: reader arm 556/1598 → 557/1599, raw residue 84/134 → 83/133; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.416.0 → 0.417.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1.)  // (🆕🆕🆕 **D530 +1 sentence / +1 printing — THE TARGET-COUNTER-SCALED BENCH SNIPE — A FOURTH `damageChosen` RIDER, `perDamageCounterOnTarget`, READ PER REF AT THE ANSWER** — `censusAttackCorpus.ts` **FILE LINE 551** (`legalAttackCorpus()` index 498), *"This attack does 20 damage to 1 of your opponent's Benched Pokémon for each damage counter on that Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)"*, **1 sentence / 1 legal printing** (no id on this checkout, D425), claimed by `deriveAttackEffect` through ONE new anchor (`BENCHED_SNIPE_TARGET_COUNTERS`, beside `BENCHED_SNIPE_TAKEN_PRIZES`, disjoint by TAIL) as arm 6b′ — a READER move: reader arm 555/1597 → 556/1598, raw residue 85/135 → 84/134; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.415.0 → 0.416.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1.)
    expect(resolved.map(([, s]) => s)).toContain(PRINTED);
    // …and the step is THIS sentence and nothing else: remove it and the pair is D527's. ⚠️ THE OWN-ROW
    // `without` PAIR: resolved 555/1597 minus THIS suite's ONE-printing row is 554/1596 (D525 (5)'s trap
    // — the next sweep re-derives this by hand as resolved − its row, never by value).
    const without = resolved.filter(([, s]) => s !== PRINTED);
    expect([without.length, units(without)]).toEqual([585, 1641]);  // (🆕🆕🆕 **D569 +4 sentences / +6 printings — THE PARADOX BANNER READERS** (Koraidon ×2 "Primordial Beatdown", Roaring Moon ×2 "Vengeance Fletching", Iron Valiant "Majestic Sword", Slither Wing "Iron Smasher" — two noun rows and two literal clause rows over `banners.ts`); this suite's own row is unmoved.) (🆕🆕🆕 **D568 +2 sentences / +2 printings — THE TWO TERA CLAUSES** (Ho-Oh `sv08-019`, Regigigas `sv08.5-086`), two literal rows over `banners.ts`; this suite's own row is unmoved.) (🆕🆕🆕 **D552 +2 sentences / +2 printings — THE PRE-DAMAGE SELF ATTACH BEHIND A MULTIPLIER HEAD, AND THE WEAKNESS RETYPE** — `censusAttackCorpus.ts` **file lines 569 and 629** (leading count column `1` each; card ids UNRESOLVED on this checkout — measured, never invented, D425): `:569` claimed WHOLE by `deriveAttackDiscardScaledBoost`'s THIRD member `selfHandAttach` (attach-then-damage inside the program), `:629` by `deriveAttackEffect` through ONE new anchor `DEFENDER_WEAKNESS_RETYPED` as ONE new op `retypeDefenderWeakness` — a READER move: reader arm 578/1632 → 580/1634, raw residue 62/100 → 60/98, `BUILT.attack` 1688 → 1690; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.435.0 → 0.436.0, `MATCH_RECORD_VERSION` 33 → 34. ⚠️ THE SENTENCE STEP (2) AND THE PRINTING STEP (2) AGREE this slice — the case where a copied number is right BY ACCIDENT, so every site was classified by the quantity its D550 note names (D426/D451). THIS SITE: the `without` pair (resolved MINUS this suite's own row) 577/1631 → 579/1633.)  // (🆕🆕🆕 **D550 +1 sentence / +1 printing — THE OPPONENT-FLIPPED PER-TAILS SNIPE ON THE OPPONENT'S BENCH COUNT** — `censusAttackCorpus.ts` **file line 669** (leading count column `1`; card id UNRESOLVED on this checkout — measured, never invented, D425), claimed WHOLE by `deriveAttackCoinFlip` (a NINTH member `opponentPerTails` over a NULLARY `AttackFlipCount.opponentBench`) AND by `deriveAttackDamageSuppression`'s THIRD compound arm off ONE anchor, `ATTACK_OPPONENT_BENCH_TAILS` — a READER move: reader arm 577/1631 → 578/1632, raw residue 63/101 → 62/100, `BUILT.attack` 1687 → 1688, PHRASE-24 1/1 → 0/0; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.434.0 → 0.435.0, `MATCH_RECORD_VERSION` HOLDS at 33. ⚠️ THE SENTENCE STEP (1) AND THE PRINTING STEP (1) AGREE this slice — the case where a copied number is right BY ACCIDENT, so every site was classified by the quantity its D549 note names (D426/D451). THIS SITE: the `without` pair (resolved MINUS this suite's own row) 576/1630 → 577/1631.)  // (🆕🆕🆕 **D549 +4 sentences / +4 printings — THE DEFENDER'S NEXT-TURN MARKS AND THE SIDE-WIDE ATTACK LOCK** — `censusAttackCorpus.ts` **file lines 171, 149, 169 and 170** (leading count column `1` each; card ids UNRESOLVED on this checkout — measured, never invented, D425), claimed WHOLE by `deriveAttackEffect` alone through FOUR new anchors as THREE new ops (`taxDefender`, `bountyDefender`, `lockSideAttacks`) — a READER move: reader arm 573/1627 → 577/1631, raw residue 67/105 → 63/101, `BUILT.attack` 1683 → 1687; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.433.0 → 0.434.0, `MATCH_RECORD_VERSION` 32 → 33. ⚠️ THE SENTENCE STEP (4) AND THE PRINTING STEP (4) AGREE this slice — the case where a copied number is right BY ACCIDENT, so every site was classified by the quantity its D548 note names (D426/D451). THIS SITE: the `without` pair (resolved MINUS this suite's own row) 572/1626 → 576/1630.)  // (🆕🆕🆕 **D548 +1 sentence / +2 printings — CRESCENT PURGE, THE FACE-UP PRIZE** — `censusAttackCorpus.ts` **file line 664**, Cresselia `sv06.5-021` "Crescent Purge", claimed WHOLE by `deriveAttackOptionalCostBoost`'s FIFTH cost row (`turnPrizeFaceUp` behind `yourFaceDownPrizeRemains`); engine 0.432.0 → 0.433.0, `MATCH_RECORD_VERSION` 31 → 32. ⚠️ THE SENTENCE STEP (1) AND THE PRINTING STEP (2) DIFFER. THIS SITE: the `without` pair (resolved MINUS this suite's own row) 571/1624 → 572/1626.)  // (🆕🆕🆕 **D547 +2 sentences / +4 printings — THE FLIP-TO-ATTACK LOCK AND THE NEXT-TURN VULNERABILITY** — `censusAttackCorpus.ts` **file lines 176 and 150** (leading count column `2` each), *“During your opponent's next turn, if the Defending Pokémon tries to use an attack, your opponent flips a coin. If tails, that attack doesn't happen.”* (TWO sentences in ONE row) and *“During your next turn, the Defending Pokémon takes 50 more damage from attacks (after applying Weakness and Resistance).”*, **2 rows / 4 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so both suites ride file-local declared `d547-*` demonstrators), claimed WHOLE by `deriveAttackEffect` through TWO new anchors (`DEFENDER_FLIP_ATTACK_LOCK`, `DEFENDER_VULNERABLE_NEXT_TURN`) as TWO new ops (`flipLockAttack`, `exposeDefender`) on TWO new REQUIRED `InPlayPokemon` fields — a READER move: reader arm 570/1621 → 572/1625, raw residue 70/111 → 68/107, `BUILT.attack` 1677 → 1681; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.431.0 → 0.432.0, `MATCH_RECORD_VERSION` 30 → 31. ⚠️ **THE SENTENCE STEP (2) AND THE PRINTING STEP (4) DIFFER**, so no copied number is right by accident; every site was classified by the quantity its D546 note names (D426/D451). THIS SITE: the `without` pair (resolved MINUS this suite's own row) 569/1620 → 571/1624.)  // (🆕🆕🆕 **D546 +2 sentences / +2 printings — THE ALL-ATTACKS NEXT-TURN BUFF** — `censusAttackCorpus.ts` **file lines 76 and 148** (leading count column `1` each), *“During your next turn, attacks used by this Pokémon do 120 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance).”* and the same sentence at 100 behind *“Both Active Pokémon are now Asleep.”*, **2 sentences / 2 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so the suite rides file-local declared `d546-*` demonstrators), claimed WHOLE by `deriveAttackEffect` through ONE new whole-sentence anchor (`SELF_EVERY_ATTACK_BOOST`, ONE `['’]` slot, an optional Sleep prefix) as `attack: null` on the SHIPPED `boostAttack` op — no new `EffectOp` member, no new `InPlayPokemon` field — a READER move: reader arm 568/1619 → 570/1621, raw residue 72/113 → 70/111, `BUILT.attack` 1675 → 1677; registry 10/16, gate 9/19, trailing 11/21, `SPLIT_ATTACK_UNITS` 19 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED (19 READ at `censusAtHead.test.ts:8169`); engine 0.430.0 → 0.431.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP ARE BOTH 2 — THE ONE SHAPE WHERE A COPIED NUMBER IS RIGHT BY ACCIDENT**, so every site was measured by the quantity it pins, not copied (D426/D451). THIS SITE: the `without` pair (resolved MINUS this suite's own row) 567/1618 → 569/1620.)  // (🆕🆕🆕 **D544 +1 sentence / +2 printings — THE NAMED ATTACK'S BASE DAMAGE, OVERRIDDEN FOR ONE WINDOW** — `censusAttackCorpus.ts` **file line 166** (leading count column `2`), *“During your next turn, this Pokémon's Hyper Fang attack's base damage is 240.”*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so the suite rides the file-local declared demonstrator `d544-fang`), claimed WHOLE by `deriveAttackEffect` through ONE new whole-sentence anchor (`SELF_ATTACK_BASE_SET`, TWO `['’]` slots, name and number CAPTURED) as a `base: true` RIDER on the SHIPPED `boostAttack` op — no new `EffectOp` member, no new `InPlayPokemon` field — a READER move: reader arm 567/1617 → 568/1619, raw residue 73/115 → 72/113, `BUILT.attack` 1671 → 1673; registry 10/16, gate 7/17, trailing 11/21, `SPLIT_ATTACK_UNITS` 17 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED (17 READ at `censusAtHead.test.ts:8159` — the “14” in D543's annotation beside this one has been stale since D541 moved the constant); engine 0.428.0 → 0.429.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — THEY DISAGREE**, so no number may be copied from one kind of site into another (D426/D451). THIS SITE: the `without` pair (resolved MINUS this suite's own row) 566/1616 → 567/1618, RE-DERIVED BY HAND rather than copied (D525(5)).)  // (🆕🆕🆕 **D543 +1 sentence / +2 printings — THE CHOSEN POKÉMON TOOL DISCARD AT THE PROGRAM TAIL** — `censusAttackCorpus.ts` **file line 136** (leading count column `2`), *“Discard up to 2 Pokémon Tools from your opponent's Pokémon.”*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrator `d543-stripper`), claimed WHOLE by `deriveAttackEffect` through ONE new whole-sentence anchor (`ATTACK_DISCARD_TOOLS_UP_TO`, ONE `['’]` slot at index 48, count CAPTURED) as ONE new `EffectOp` member `discardTools{count}` parking on ONE new `EffectPrompt` kind — a READER move: reader arm 566/1615 → 567/1617, raw residue 74/117 → 73/115, `BUILT.attack` 1669 → 1671; registry 10/16, gate 7/17, trailing 11/21, `SPLIT_ATTACK_UNITS` 14 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED; engine 0.427.0 → 0.428.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — THEY DISAGREE**, so no number may be copied from one kind of site into another (D426/D451). THIS SITE: the `without` pair (resolved MINUS this suite's own row) 565/1614 → 566/1616, RE-DERIVED BY HAND rather than copied (D525(5)).)  // (🆕🆕🆕 **D542 +1 sentence / +1 printing — THE OPPONENT-CHOSEN HAND SHUFFLE** — `censusAttackCorpus.ts` **file line 665** (`legalAttackCorpus()` index 612, leading count column `1`), *“Your opponent chooses 3 cards from their hand and shuffles those cards into their deck.”*, **1 sentence / 1 legal printing**, claimed WHOLE by `deriveAttackEffect` through ONE new anchor and ONE new arm returning a COMPOSITION of two shipped ops — so it leaves through the RAW READER summand and the registry / gate-split / trailing-split summands all stand still. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1, WHICH IS THE ONE CASE WHERE A COPIED NUMBER IS RIGHT BY ACCIDENT — so THIS SITE WAS MEASURED rather than inherited from its neighbour** (D426/D451).)  (🆕🆕🆕 **D540 +1 sentence / +1 printing — THE DEVOLUTION WITH A PICK IN IT, AND THE `/[Dd]evolv/` FAMILY CLOSES** — `censusAttackCorpus.ts` **row 87** (`legalAttackCorpus()` index 34), *"Devolve 1 of your opponent's evolved Pokémon by putting the highest Stage Evolution card on it into your opponent's hand."*, **1 sentence / 1 legal printing**, claimed by `deriveAttackEffect` through ONE new anchor `DEVOLVE_CHOSEN_TO_HAND` and arm 41-ter into ONE new FIELD-FREE `EffectOp` member `devolveChosen`. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 for the first time in six slices — the one case where a copied number is right by accident, so THIS SITE was measured off the live failure and never copied from a neighbour.)  // (🆕🆕🆕 **D539 +1 sentence / +2 printings — THE NAMED-BODY MULTIPLIER WITH A NAMED-BODY OWN-SIDE SPREAD BEHIND IT** — `censusAttackCorpus.ts` **FILE LINE 595** (`legalAttackCorpus()` index 542), *"This attack does 50 damage for each of your Drifloon and Drifblim in play. This attack also does 30 damage to each of your Drifloon and Drifblim. (Don't apply Weakness and Resistance for Benched Pokémon.)"*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrators `d539-*`), claimed by TWO readers off ONE `effect` string through ONE new whole-compound anchor carrying a `\2` BACKREFERENCE (`NAMED_BODIES_MULTIPLY_SPREAD`) — `deriveAttackDamageMultiplier` for the × fold and `deriveAttackEffect` for `damageChosen` with the FOURTH `target` member `yourAny` and `count: "all"`, plus the NINTH `IN_PLAY_BODY_NOUNS` exact key — a READER move: reader arm 563/1611 → 564/1613, raw residue 77/121 → 76/119, `BUILT.attack` 1662 → 1664; registry 10/16, gate 6/14, trailing 11/21, `SPLIT_ATTACK_UNITS` 14, `COMPOUND_ATTACK_UNITS` 21 and `attackReaderSurface()` 13 UNMOVED; engine 0.423.0 → 0.424.0, `MATCH_RECORD_VERSION` HELD at 30 (a WIDENING at a persisted address, D125's free case — and `count: "all"` NEVER PARKS). ⚠️ THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — they disagree for the FIFTH slice running (D535 1-vs-2, D536 1-vs-3, D537 1-vs-2, D538 1-vs-3). THIS SITE: 562/1610 → 563/1612.)  // (🆕🆕🆕 **D538 +1 sentence / +3 printings — THE COUNTER PLACEMENT WHOSE AMOUNT IS A PAYLOAD AND WHOSE TAIL SHUFFLES THE VERY CARDS IT COUNTED** — `censusAttackCorpus.ts` **FILE LINE 412** (`legalAttackCorpus()` index 359), *"Put 2 damage counters on 1 of your opponent's Pokémon for each Basic {G} Energy card in your discard pile. Then, shuffle those Energy cards into your deck."*, **1 sentence / 3 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrator `d538-pile-sniper`), claimed by `deriveAttackEffect` through ONE new whole-sentence TWO-capture anchor (`COUNTER_PUT_SCALED_BY_PILE`, declared with the counter-put family, ONE `['’]` slot) as arm **23b-bis** emitting THREE ops — `damageChosen{perDiscardPileCard}` + `discardPileRetrieval{max:"all"}` + `shuffleDeck`, with ONE `CardFilter` object shared by the first two — a READER move: reader arm 562/1608 → 563/1611, raw residue 78/124 → 77/121, `BUILT.attack` 1659 → 1662; registry 10/16, gate 6/14, trailing 11/21, `SPLIT_ATTACK_UNITS` 14 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED; engine 0.422.0 → 0.423.0, `MATCH_RECORD_VERSION` HELD at 30 (a NEW OPTIONAL KEY is D125's WIDENING and `max: "all"` is a PURE ADDITION to a value domain — and BOTH bytes are written into the record, through `phase.cont.pendingOp` and `phase.cont.rest` respectively). ⚠️ THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 3 — they disagree for the FOURTH slice running (D535 1-vs-2, D536 1-vs-3, D537 1-vs-2), so a pass that copied one number into the other kind of site would be wrong in half of them. THIS SITE: ⚠️ THE OWN-ROW `without` PAIR, RE-DERIVED BY HAND as resolved − this suite's OWN row (D525 (5)) and never copied from the resolved pair — 561/1607 → 562/1610.)  // (🆕🆕🆕 **D537 +1 sentence / +2 printings — KEEP THREE, SHUFFLE THE REST: THE ONLY SENTENCE IN THIS CORPUS WHOSE PICK NAMES THE BODIES THAT *STAY* — ONE NEW `EffectOp` MEMBER `returnBenchedRest` AND ONE INTERPRETER WRITER** — `censusAttackCorpus.ts` **FILE LINE 84** (`legalAttackCorpus()` index 31), *"Choose 3 of your opponent's Benched Pokémon. If you do, shuffle all of your opponent's Benched Pokémon that you didn't choose, and all cards attached to those Pokémon, into their deck."*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrator `d537-bencher`), claimed by `deriveAttackEffect` through ONE new ONE-capture whole-sentence anchor (`CHOOSE_KEEP_SHUFFLE_REST`, beside `RETURN_BENCHED`, THREE `['’]` slots — two possessives AND the contraction in "didn't") as arm **42-bis** emitting ONE `returnBenchedRest{keep:3}` — a READER move: reader arm 561/1606 → 562/1608, raw residue 79/126 → 78/124, `BUILT.attack` 1657 → 1659; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.421.0 → 0.422.0, `MATCH_RECORD_VERSION` HELD at 30 (a new op MEMBER is D125's WIDENING — and this op PARKS, so the byte IS written into `phase.cont.pendingOp`). ⚠️ THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — they disagree for the third slice running (D535 1-vs-2, D536 1-vs-3), so a pass that copied one number into the other kind of site would be wrong in half of them. THIS SITE: 560/1605 → 561/1607.)  // (🆕🆕🆕 **D536 +1 sentence / +3 printings — THE BODY THAT LEAVES PLAY WITHOUT BEING KNOCKED OUT — ONE NEW FIELD-FREE `EffectOp` MEMBER `discardDefender` AND ONE INTERPRETER WRITER** — `censusAttackCorpus.ts` **FILE LINE 100** (`legalAttackCorpus()` index 47), *"Discard a Team Rocket's Energy from this Pokémon. If you do, discard your opponent's Active Pokémon and all attached cards."*, **1 sentence / 3 legal printings** (Moltres ex `sv10-031`/`-208`/`-229` — the ids ARE resolved on this checkout and are used as ids; the printed BASE DAMAGE is NOT, so it is driven on the file-local declared demonstrator `d536-moltres`, D425), claimed by `deriveAttackEffect` through ONE new ZERO-capture anchor (`TR_ENERGY_COST_THEN_DISCARD_DEFENDER`, beside `HAND_COST_THEN_OPPONENT_DISCARD`) as `discardEnergy{from:"yourActive", filter:{byName "Team Rocket's Energy"}, recordAs:"discarded"}` gated through the FIRST shipped `recordGate{slot:"discarded"}` into the new `discardDefender` — a READER move: reader arm 560/1603 → 561/1606, raw residue 80/129 → 79/126, `BUILT.attack` 1654 → 1657; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.420.0 → 0.421.0, `MATCH_RECORD_VERSION` HELD at 30 (a new op MEMBER is D125's WIDENING; the op never parks and is FIELD-FREE). ⚠️ THE SENTENCE STEP AND THE PRINTING STEP DISAGREE AT 1 AND 3 — harder than D535's 1-and-2, so a pass that copied one number into the other kind of site would be wrong in half of them. THIS SITE: 559/1602 → 560/1605.)  // (🆕🆕🆕 **D535 +1 sentence / +2 printings — THE PICK-WITH-REPLACEMENT SNIPE — ZERO NEW VOCABULARY: SIX `damageChosen` OPS AT `count: 1`, THE LITERAL `CHOSEN_ANY_TARGET` ALREADY AUTHORS** — `censusAttackCorpus.ts` **FILE LINE 81** (`legalAttackCorpus()` index 28), *"Choose 1 of your opponent's Pokémon 6 times. (You can choose the same Pokémon more than once.) For each time you chose a Pokémon, do 20 damage to it. This damage isn't affected by Weakness or Resistance."*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — no D1, no catalog sqlite — stated unresolved, never invented, D425), claimed by `deriveAttackEffect` through ONE new TWO-capture anchor (`ATTACK_PICK_WITH_REPLACEMENT_SNIPE`, beside `CHOSEN_ANY_TARGET`) as SIX `damageChosen{target:"opponentAny", amount:20, count:1, source:"attack", deals, ignoreWR}` parks — a READER move: reader arm 559/1601 → 560/1603, raw residue 81/131 → 80/129; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.419.0 → 0.420.0, `MATCH_RECORD_VERSION` HELD at 30 (D237's POPULATION change — the op literal already ships, so the serialized alphabet does not grow). ⚠️ THE SENTENCE STEP AND THE PRINTING STEP DISAGREE AT 1 AND 2 — the legal column prints this sentence TWICE.)  // (🆕🆕🆕 **D534 +1 sentence / +1 printing — THE ONE-CARD LOOK AT THE OPPONENT's DECK WITH A PRINTED SHUFFLE — `shuffleDeck` GAINS THE OPTIONAL KEY `whose: "opponent"` and `reorderTop` PARKS A ONE-CARD WINDOW WHEN ITS TWO ARMS DIFFER** — `censusAttackCorpus.ts` **FILE LINE 401**, *"Look at the top card of your opponent's deck. You may have your opponent shuffle their deck."*, **1 sentence / 1 legal printing** (Inkay `sv06.5-033`; no id on this checkout, D425), claimed by `deriveAttackEffect` through ONE new zero-capture anchor (`ATTACK_OPPONENT_TOP_LOOK_SHUFFLE`, beside `ATTACK_REORDER_TOP`) as `reorderTop{n:1, side:"opponent", otherwise:[shuffleDeck{whose:"opponent"}]}` — a READER move: reader arm 558/1600 → 559/1601, raw residue 82/132 → 81/131; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.418.0 → 0.419.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1.)  // (🆕🆕🆕 **D532 +1 sentence / +1 printing (the own-row `without` pair: resolved − that suite's row) — THE CROSS-SEAT DISCARD-PILE ATTACH — `attachEnergyFrom` GAINS THE OPTIONAL KEY `whose: "opponent"` (on the op AND on `AttachTargetRiders`, read through ONE resolver)** — `censusAttackCorpus.ts` **FILE LINE 70** (`legalAttackCorpus()` index 17), *"Attach up to 3 Energy cards from your opponent's discard pile to their Pokémon in any way you like."*, **1 sentence / 1 legal printing** (Grafaiai `sv08-121`; no id on this checkout, D425), claimed by `deriveAttackEffect` through ONE new zero-capture anchor (`ATTACK_OPPONENT_DISCARD_ATTACH`, beside the factory-built `DISCARD_ATTACH`) as D360's spread ONE KEY OVER — a READER move: reader arm 557/1599 → 558/1600, raw residue 83/133 → 82/132; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.417.0 → 0.418.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1.)  // (🆕🆕🆕 **D531 +1 sentence / +1 printing (the own-row `without` pair: resolved − that suite's row) — THE BOARD-TYPED HAND SEARCH — `searchDeck` GAINS THE PARK-TIME RIDER `typedAsAttachedBasicEnergy`** — `censusAttackCorpus.ts` **FILE LINE 483** (`legalAttackCorpus()` index 430), *"Search your deck for up to 5 Pokémon that are the same type as any Basic Energy attached to this Pokémon, reveal them, and put them into your hand. Then, shuffle your deck."*, **1 sentence / 1 legal printing** (sv07-065 per the retired D231 deferral; no id on this checkout, D425), claimed by `deriveAttackEffect` through ONE new zero-capture anchor (`ATTACK_HAND_SEARCH_TYPED_AS_ATTACHED`, beside `ATTACK_HAND_SEARCH_BENCH_COUNT`) whose rider the park resolves against the SOURCE body's attached Basic Energy — a READER move: reader arm 556/1598 → 557/1599, raw residue 84/134 → 83/133; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.416.0 → 0.417.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1.)  // (🆕🆕🆕 **D530 +1 sentence / +1 printing (the own-row `without` pair: resolved − that suite's row) — THE TARGET-COUNTER-SCALED BENCH SNIPE — A FOURTH `damageChosen` RIDER, `perDamageCounterOnTarget`, READ PER REF AT THE ANSWER** — `censusAttackCorpus.ts` **FILE LINE 551** (`legalAttackCorpus()` index 498), *"This attack does 20 damage to 1 of your opponent's Benched Pokémon for each damage counter on that Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)"*, **1 sentence / 1 legal printing** (no id on this checkout, D425), claimed by `deriveAttackEffect` through ONE new anchor (`BENCHED_SNIPE_TARGET_COUNTERS`, beside `BENCHED_SNIPE_TAKEN_PRIZES`, disjoint by TAIL) as arm 6b′ — a READER move: reader arm 555/1597 → 556/1598, raw residue 85/135 → 84/134; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.415.0 → 0.416.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1.)
  });

  it("🛑 the RAW reader-only residue fell by exactly 1 sentence / 1 printing — 85 / 135 — and the row left it", () => {
    // 🆕🆕🆕 D528's OWN literal (corpus FILE LINE 215, see §4's first rung): 86/136 → 85/135.
    const unbuilt = legalAttackCorpus().filter(([, s]) => !resolvedByAnyReader(s));
    expect([unbuilt.length, units(unbuilt)]).toEqual([54, 90]);  // (🆕🆕🆕 **D569 −4 sentences / −6 printings — THE PARADOX BANNER READERS LEFT THE RAW RESIDUE** — Koraidon ×2, Roaring Moon ×2, Iron Valiant, Slither Wing; the reader rung's +4/+6 seen from the other side (58/96 → 54/90)) (🆕🆕🆕 **D568 −2 sentences / −2 printings — THE TWO TERA CLAUSES LEFT THE RAW RESIDUE** — Ho-Oh `sv08-019` and Regigigas `sv08.5-086`, the reader rung's +2/+2 seen from the other side (60/98 → 58/96)) (🆕🆕🆕 **D552 +2 sentences / +2 printings — THE PRE-DAMAGE SELF ATTACH BEHIND A MULTIPLIER HEAD, AND THE WEAKNESS RETYPE** — `censusAttackCorpus.ts` **file lines 569 and 629** (leading count column `1` each; card ids UNRESOLVED on this checkout — measured, never invented, D425): `:569` claimed WHOLE by `deriveAttackDiscardScaledBoost`'s THIRD member `selfHandAttach` (attach-then-damage inside the program), `:629` by `deriveAttackEffect` through ONE new anchor `DEFENDER_WEAKNESS_RETYPED` as ONE new op `retypeDefenderWeakness` — a READER move: reader arm 578/1632 → 580/1634, raw residue 62/100 → 60/98, `BUILT.attack` 1688 → 1690; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.435.0 → 0.436.0, `MATCH_RECORD_VERSION` 33 → 34. ⚠️ THE SENTENCE STEP (2) AND THE PRINTING STEP (2) AGREE this slice — the case where a copied number is right BY ACCIDENT, so every site was classified by the quantity its D550 note names (D426/D451). THIS SITE: raw reader-only residue 62/100 → 60/98.)  // (🆕🆕🆕 **D550 +1 sentence / +1 printing — THE OPPONENT-FLIPPED PER-TAILS SNIPE ON THE OPPONENT'S BENCH COUNT** — `censusAttackCorpus.ts` **file line 669** (leading count column `1`; card id UNRESOLVED on this checkout — measured, never invented, D425), claimed WHOLE by `deriveAttackCoinFlip` (a NINTH member `opponentPerTails` over a NULLARY `AttackFlipCount.opponentBench`) AND by `deriveAttackDamageSuppression`'s THIRD compound arm off ONE anchor, `ATTACK_OPPONENT_BENCH_TAILS` — a READER move: reader arm 577/1631 → 578/1632, raw residue 63/101 → 62/100, `BUILT.attack` 1687 → 1688, PHRASE-24 1/1 → 0/0; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.434.0 → 0.435.0, `MATCH_RECORD_VERSION` HOLDS at 33. ⚠️ THE SENTENCE STEP (1) AND THE PRINTING STEP (1) AGREE this slice — the case where a copied number is right BY ACCIDENT, so every site was classified by the quantity its D549 note names (D426/D451). THIS SITE: raw reader-only residue 63/101 → 62/100.)  // (🆕🆕🆕 **D549 +4 sentences / +4 printings — THE DEFENDER'S NEXT-TURN MARKS AND THE SIDE-WIDE ATTACK LOCK** — `censusAttackCorpus.ts` **file lines 171, 149, 169 and 170** (leading count column `1` each; card ids UNRESOLVED on this checkout — measured, never invented, D425), claimed WHOLE by `deriveAttackEffect` alone through FOUR new anchors as THREE new ops (`taxDefender`, `bountyDefender`, `lockSideAttacks`) — a READER move: reader arm 573/1627 → 577/1631, raw residue 67/105 → 63/101, `BUILT.attack` 1683 → 1687; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.433.0 → 0.434.0, `MATCH_RECORD_VERSION` 32 → 33. ⚠️ THE SENTENCE STEP (4) AND THE PRINTING STEP (4) AGREE this slice — the case where a copied number is right BY ACCIDENT, so every site was classified by the quantity its D548 note names (D426/D451). THIS SITE: raw reader-only residue 67/105 → 63/101.)  // (🆕🆕🆕 **D548 +1 sentence / +2 printings — CRESCENT PURGE, THE FACE-UP PRIZE** — `censusAttackCorpus.ts` **file line 664**, Cresselia `sv06.5-021` "Crescent Purge", claimed WHOLE by `deriveAttackOptionalCostBoost`'s FIFTH cost row (`turnPrizeFaceUp` behind `yourFaceDownPrizeRemains`); engine 0.432.0 → 0.433.0, `MATCH_RECORD_VERSION` 31 → 32. ⚠️ THE SENTENCE STEP (1) AND THE PRINTING STEP (2) DIFFER. THIS SITE: raw reader-only residue 68/107 → 67/105.)  // (🆕🆕🆕 **D547 +2 sentences / +4 printings — THE FLIP-TO-ATTACK LOCK AND THE NEXT-TURN VULNERABILITY** — `censusAttackCorpus.ts` **file lines 176 and 150** (leading count column `2` each), *“During your opponent's next turn, if the Defending Pokémon tries to use an attack, your opponent flips a coin. If tails, that attack doesn't happen.”* (TWO sentences in ONE row) and *“During your next turn, the Defending Pokémon takes 50 more damage from attacks (after applying Weakness and Resistance).”*, **2 rows / 4 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so both suites ride file-local declared `d547-*` demonstrators), claimed WHOLE by `deriveAttackEffect` through TWO new anchors (`DEFENDER_FLIP_ATTACK_LOCK`, `DEFENDER_VULNERABLE_NEXT_TURN`) as TWO new ops (`flipLockAttack`, `exposeDefender`) on TWO new REQUIRED `InPlayPokemon` fields — a READER move: reader arm 570/1621 → 572/1625, raw residue 70/111 → 68/107, `BUILT.attack` 1677 → 1681; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.431.0 → 0.432.0, `MATCH_RECORD_VERSION` 30 → 31. ⚠️ **THE SENTENCE STEP (2) AND THE PRINTING STEP (4) DIFFER**, so no copied number is right by accident; every site was classified by the quantity its D546 note names (D426/D451). THIS SITE: raw reader-only residue 70/111 → 68/107.)  // (🆕🆕🆕 **D546 +2 sentences / +2 printings — THE ALL-ATTACKS NEXT-TURN BUFF** — `censusAttackCorpus.ts` **file lines 76 and 148** (leading count column `1` each), *“During your next turn, attacks used by this Pokémon do 120 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance).”* and the same sentence at 100 behind *“Both Active Pokémon are now Asleep.”*, **2 sentences / 2 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so the suite rides file-local declared `d546-*` demonstrators), claimed WHOLE by `deriveAttackEffect` through ONE new whole-sentence anchor (`SELF_EVERY_ATTACK_BOOST`, ONE `['’]` slot, an optional Sleep prefix) as `attack: null` on the SHIPPED `boostAttack` op — no new `EffectOp` member, no new `InPlayPokemon` field — a READER move: reader arm 568/1619 → 570/1621, raw residue 72/113 → 70/111, `BUILT.attack` 1675 → 1677; registry 10/16, gate 9/19, trailing 11/21, `SPLIT_ATTACK_UNITS` 19 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED (19 READ at `censusAtHead.test.ts:8169`); engine 0.430.0 → 0.431.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP ARE BOTH 2 — THE ONE SHAPE WHERE A COPIED NUMBER IS RIGHT BY ACCIDENT**, so every site was measured by the quantity it pins, not copied (D426/D451). THIS SITE: raw reader-only residue 72/113 → 70/111.)  // (🆕🆕🆕 **D544 +1 sentence / +2 printings — THE NAMED ATTACK'S BASE DAMAGE, OVERRIDDEN FOR ONE WINDOW** — `censusAttackCorpus.ts` **file line 166** (leading count column `2`), *“During your next turn, this Pokémon's Hyper Fang attack's base damage is 240.”*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so the suite rides the file-local declared demonstrator `d544-fang`), claimed WHOLE by `deriveAttackEffect` through ONE new whole-sentence anchor (`SELF_ATTACK_BASE_SET`, TWO `['’]` slots, name and number CAPTURED) as a `base: true` RIDER on the SHIPPED `boostAttack` op — no new `EffectOp` member, no new `InPlayPokemon` field — a READER move: reader arm 567/1617 → 568/1619, raw residue 73/115 → 72/113, `BUILT.attack` 1671 → 1673; registry 10/16, gate 7/17, trailing 11/21, `SPLIT_ATTACK_UNITS` 17 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED (17 READ at `censusAtHead.test.ts:8159` — the “14” in D543's annotation beside this one has been stale since D541 moved the constant); engine 0.428.0 → 0.429.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — THEY DISAGREE**, so no number may be copied from one kind of site into another (D426/D451). THIS SITE: raw reader-only residue 73/115 → 72/113.)  // (🆕🆕🆕 **D543 +1 sentence / +2 printings — THE CHOSEN POKÉMON TOOL DISCARD AT THE PROGRAM TAIL** — `censusAttackCorpus.ts` **file line 136** (leading count column `2`), *“Discard up to 2 Pokémon Tools from your opponent's Pokémon.”*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrator `d543-stripper`), claimed WHOLE by `deriveAttackEffect` through ONE new whole-sentence anchor (`ATTACK_DISCARD_TOOLS_UP_TO`, ONE `['’]` slot at index 48, count CAPTURED) as ONE new `EffectOp` member `discardTools{count}` parking on ONE new `EffectPrompt` kind — a READER move: reader arm 566/1615 → 567/1617, raw residue 74/117 → 73/115, `BUILT.attack` 1669 → 1671; registry 10/16, gate 7/17, trailing 11/21, `SPLIT_ATTACK_UNITS` 14 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED; engine 0.427.0 → 0.428.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — THEY DISAGREE**, so no number may be copied from one kind of site into another (D426/D451). THIS SITE: raw reader-only residue 74/117 → 73/115.)  // (🆕🆕🆕 **D542 +1 sentence / +1 printing — THE OPPONENT-CHOSEN HAND SHUFFLE** — `censusAttackCorpus.ts` **file line 665** (`legalAttackCorpus()` index 612, leading count column `1`), *“Your opponent chooses 3 cards from their hand and shuffles those cards into their deck.”*, **1 sentence / 1 legal printing**, claimed WHOLE by `deriveAttackEffect` through ONE new anchor and ONE new arm returning a COMPOSITION of two shipped ops — so it leaves through the RAW READER summand and the registry / gate-split / trailing-split summands all stand still. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1, WHICH IS THE ONE CASE WHERE A COPIED NUMBER IS RIGHT BY ACCIDENT — so THIS SITE WAS MEASURED rather than inherited from its neighbour** (D426/D451).)  (🆕🆕🆕 **D540 +1 sentence / +1 printing — THE DEVOLUTION WITH A PICK IN IT, AND THE `/[Dd]evolv/` FAMILY CLOSES** — `censusAttackCorpus.ts` **row 87** (`legalAttackCorpus()` index 34, leading count column `1`), *"Devolve 1 of your opponent's evolved Pokémon by putting the highest Stage Evolution card on it into your opponent's hand."*, **1 sentence / 1 legal printing** (no card id resolves on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrators `d540-*`), claimed by `deriveAttackEffect` through ONE new anchor `DEVOLVE_CHOSEN_TO_HAND` and arm 41-ter into ONE new FIELD-FREE `EffectOp` member `devolveChosen` — a READER move: reader arm 564/1613 → 565/1614, raw residue 76/119 → 75/118, `BUILT.attack` 1664 → 1665, residue 49/68 → 48/67; registry 10/16, gate 6/14, trailing 11/21, `SPLIT_ATTACK_UNITS` 14, `COMPOUND_ATTACK_UNITS` 21 and `attackReaderSurface()` 13 UNMOVED; engine 0.424.0 → 0.425.0, `MATCH_RECORD_VERSION` HELD at 30 (D125's widening at a persisted address — and this op DOES park, so a record really can hold it, which is why the version claim rests on the widening and not on parking). ⚠️ THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 1 — they AGREE for the first time in six slices, which is the one case where a copied number would be right by accident, so every site was measured.)  // (🆕🆕🆕 **D539 +1 sentence / +2 printings — THE NAMED-BODY MULTIPLIER WITH A NAMED-BODY OWN-SIDE SPREAD BEHIND IT** — `censusAttackCorpus.ts` **FILE LINE 595** (`legalAttackCorpus()` index 542), *"This attack does 50 damage for each of your Drifloon and Drifblim in play. This attack also does 30 damage to each of your Drifloon and Drifblim. (Don't apply Weakness and Resistance for Benched Pokémon.)"*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrators `d539-*`), claimed by TWO readers off ONE `effect` string through ONE new whole-compound anchor carrying a `\2` BACKREFERENCE (`NAMED_BODIES_MULTIPLY_SPREAD`) — `deriveAttackDamageMultiplier` for the × fold and `deriveAttackEffect` for `damageChosen` with the FOURTH `target` member `yourAny` and `count: "all"`, plus the NINTH `IN_PLAY_BODY_NOUNS` exact key — a READER move: reader arm 563/1611 → 564/1613, raw residue 77/121 → 76/119, `BUILT.attack` 1662 → 1664; registry 10/16, gate 6/14, trailing 11/21, `SPLIT_ATTACK_UNITS` 14, `COMPOUND_ATTACK_UNITS` 21 and `attackReaderSurface()` 13 UNMOVED; engine 0.423.0 → 0.424.0, `MATCH_RECORD_VERSION` HELD at 30 (a WIDENING at a persisted address, D125's free case — and `count: "all"` NEVER PARKS, so no record that can exist holds the new value). ⚠️ THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — they disagree for the FIFTH slice running (D535 1-vs-2, D536 1-vs-3, D537 1-vs-2, D538 1-vs-3), so a pass that copied one number into the other kind of site would be wrong in half of them. THIS SITE: 77/121 → 76/119.)  // (🆕🆕🆕 **D538 −1 sentence / −3 printings — THE COUNTER PLACEMENT WHOSE AMOUNT IS A PAYLOAD AND WHOSE TAIL SHUFFLES THE VERY CARDS IT COUNTED** — `censusAttackCorpus.ts` **FILE LINE 412** (`legalAttackCorpus()` index 359), *"Put 2 damage counters on 1 of your opponent's Pokémon for each Basic {G} Energy card in your discard pile. Then, shuffle those Energy cards into your deck."*, **1 sentence / 3 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrator `d538-pile-sniper`), claimed by `deriveAttackEffect` through ONE new whole-sentence TWO-capture anchor (`COUNTER_PUT_SCALED_BY_PILE`, declared with the counter-put family, ONE `['’]` slot) as arm **23b-bis** emitting THREE ops — `damageChosen{perDiscardPileCard}` + `discardPileRetrieval{max:"all"}` + `shuffleDeck`, with ONE `CardFilter` object shared by the first two — a READER move: reader arm 562/1608 → 563/1611, raw residue 78/124 → 77/121, `BUILT.attack` 1659 → 1662; registry 10/16, gate 6/14, trailing 11/21, `SPLIT_ATTACK_UNITS` 14 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED; engine 0.422.0 → 0.423.0, `MATCH_RECORD_VERSION` HELD at 30 (a NEW OPTIONAL KEY is D125's WIDENING and `max: "all"` is a PURE ADDITION to a value domain — and BOTH bytes are written into the record, through `phase.cont.pendingOp` and `phase.cont.rest` respectively). ⚠️ THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 3 — they disagree for the FOURTH slice running (D535 1-vs-2, D536 1-vs-3, D537 1-vs-2), so a pass that copied one number into the other kind of site would be wrong in half of them. THIS SITE: 78/124 → 77/121.)  // (🆕🆕🆕 **D537 −1 sentence / −2 printings — KEEP THREE, SHUFFLE THE REST: THE ONLY SENTENCE IN THIS CORPUS WHOSE PICK NAMES THE BODIES THAT *STAY* — ONE NEW `EffectOp` MEMBER `returnBenchedRest` AND ONE INTERPRETER WRITER** — `censusAttackCorpus.ts` **FILE LINE 84** (`legalAttackCorpus()` index 31), *"Choose 3 of your opponent's Benched Pokémon. If you do, shuffle all of your opponent's Benched Pokémon that you didn't choose, and all cards attached to those Pokémon, into their deck."*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrator `d537-bencher`), claimed by `deriveAttackEffect` through ONE new ONE-capture whole-sentence anchor (`CHOOSE_KEEP_SHUFFLE_REST`, beside `RETURN_BENCHED`, THREE `['’]` slots — two possessives AND the contraction in "didn't") as arm **42-bis** emitting ONE `returnBenchedRest{keep:3}` — a READER move: reader arm 561/1606 → 562/1608, raw residue 79/126 → 78/124, `BUILT.attack` 1657 → 1659; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.421.0 → 0.422.0, `MATCH_RECORD_VERSION` HELD at 30 (a new op MEMBER is D125's WIDENING — and this op PARKS, so the byte IS written into `phase.cont.pendingOp`). ⚠️ THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — they disagree for the third slice running (D535 1-vs-2, D536 1-vs-3), so a pass that copied one number into the other kind of site would be wrong in half of them. THIS SITE: 79/126 → 78/124.)  // (🆕🆕🆕 **D536 −1 sentence / −3 printings — THE BODY THAT LEAVES PLAY WITHOUT BEING KNOCKED OUT — ONE NEW FIELD-FREE `EffectOp` MEMBER `discardDefender` AND ONE INTERPRETER WRITER** — `censusAttackCorpus.ts` **FILE LINE 100** (`legalAttackCorpus()` index 47), *"Discard a Team Rocket's Energy from this Pokémon. If you do, discard your opponent's Active Pokémon and all attached cards."*, **1 sentence / 3 legal printings** (Moltres ex `sv10-031`/`-208`/`-229` — the ids ARE resolved on this checkout and are used as ids; the printed BASE DAMAGE is NOT, so it is driven on the file-local declared demonstrator `d536-moltres`, D425), claimed by `deriveAttackEffect` through ONE new ZERO-capture anchor (`TR_ENERGY_COST_THEN_DISCARD_DEFENDER`, beside `HAND_COST_THEN_OPPONENT_DISCARD`) as `discardEnergy{from:"yourActive", filter:{byName "Team Rocket's Energy"}, recordAs:"discarded"}` gated through the FIRST shipped `recordGate{slot:"discarded"}` into the new `discardDefender` — a READER move: reader arm 560/1603 → 561/1606, raw residue 80/129 → 79/126, `BUILT.attack` 1654 → 1657; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.420.0 → 0.421.0, `MATCH_RECORD_VERSION` HELD at 30 (a new op MEMBER is D125's WIDENING; the op never parks and is FIELD-FREE). ⚠️ THE SENTENCE STEP AND THE PRINTING STEP DISAGREE AT 1 AND 3 — harder than D535's 1-and-2, so a pass that copied one number into the other kind of site would be wrong in half of them. THIS SITE: 80/129 → 79/126.)  // (🆕🆕🆕 **D535 −1 sentence / −2 printings — THE PICK-WITH-REPLACEMENT SNIPE — ZERO NEW VOCABULARY: SIX `damageChosen` OPS AT `count: 1`, THE LITERAL `CHOSEN_ANY_TARGET` ALREADY AUTHORS** — `censusAttackCorpus.ts` **FILE LINE 81** (`legalAttackCorpus()` index 28), *"Choose 1 of your opponent's Pokémon 6 times. (You can choose the same Pokémon more than once.) For each time you chose a Pokémon, do 20 damage to it. This damage isn't affected by Weakness or Resistance."*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — no D1, no catalog sqlite — stated unresolved, never invented, D425), claimed by `deriveAttackEffect` through ONE new TWO-capture anchor (`ATTACK_PICK_WITH_REPLACEMENT_SNIPE`, beside `CHOSEN_ANY_TARGET`) as SIX `damageChosen{target:"opponentAny", amount:20, count:1, source:"attack", deals, ignoreWR}` parks — a READER move: reader arm 559/1601 → 560/1603, raw residue 81/131 → 80/129; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.419.0 → 0.420.0, `MATCH_RECORD_VERSION` HELD at 30 (D237's POPULATION change — the op literal already ships, so the serialized alphabet does not grow). ⚠️ THE SENTENCE STEP AND THE PRINTING STEP DISAGREE AT 1 AND 2 — the legal column prints this sentence TWICE.)  // (🆕🆕🆕 **D534 −1 sentence / −1 printing — THE ONE-CARD LOOK AT THE OPPONENT's DECK WITH A PRINTED SHUFFLE — `shuffleDeck` GAINS THE OPTIONAL KEY `whose: "opponent"` and `reorderTop` PARKS A ONE-CARD WINDOW WHEN ITS TWO ARMS DIFFER** — `censusAttackCorpus.ts` **FILE LINE 401**, *"Look at the top card of your opponent's deck. You may have your opponent shuffle their deck."*, **1 sentence / 1 legal printing** (Inkay `sv06.5-033`; no id on this checkout, D425), claimed by `deriveAttackEffect` through ONE new zero-capture anchor (`ATTACK_OPPONENT_TOP_LOOK_SHUFFLE`, beside `ATTACK_REORDER_TOP`) as `reorderTop{n:1, side:"opponent", otherwise:[shuffleDeck{whose:"opponent"}]}` — a READER move: reader arm 558/1600 → 559/1601, raw residue 82/132 → 81/131; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.418.0 → 0.419.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1.)  // (🆕🆕🆕 **D532 −1 sentence / −1 printing — THE CROSS-SEAT DISCARD-PILE ATTACH — `attachEnergyFrom` GAINS THE OPTIONAL KEY `whose: "opponent"` (on the op AND on `AttachTargetRiders`, read through ONE resolver)** — `censusAttackCorpus.ts` **FILE LINE 70** (`legalAttackCorpus()` index 17), *"Attach up to 3 Energy cards from your opponent's discard pile to their Pokémon in any way you like."*, **1 sentence / 1 legal printing** (Grafaiai `sv08-121`; no id on this checkout, D425), claimed by `deriveAttackEffect` through ONE new zero-capture anchor (`ATTACK_OPPONENT_DISCARD_ATTACH`, beside the factory-built `DISCARD_ATTACH`) as D360's spread ONE KEY OVER — a READER move: reader arm 557/1599 → 558/1600, raw residue 83/133 → 82/132; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.417.0 → 0.418.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1.)  // (🆕🆕🆕 **D531 −1 sentence / −1 printing — THE BOARD-TYPED HAND SEARCH — `searchDeck` GAINS THE PARK-TIME RIDER `typedAsAttachedBasicEnergy`** — `censusAttackCorpus.ts` **FILE LINE 483** (`legalAttackCorpus()` index 430), *"Search your deck for up to 5 Pokémon that are the same type as any Basic Energy attached to this Pokémon, reveal them, and put them into your hand. Then, shuffle your deck."*, **1 sentence / 1 legal printing** (sv07-065 per the retired D231 deferral; no id on this checkout, D425), claimed by `deriveAttackEffect` through ONE new zero-capture anchor (`ATTACK_HAND_SEARCH_TYPED_AS_ATTACHED`, beside `ATTACK_HAND_SEARCH_BENCH_COUNT`) whose rider the park resolves against the SOURCE body's attached Basic Energy — a READER move: reader arm 556/1598 → 557/1599, raw residue 84/134 → 83/133; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.416.0 → 0.417.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1.)  // (🆕🆕🆕 **D530 −1 sentence / −1 printing — THE TARGET-COUNTER-SCALED BENCH SNIPE — A FOURTH `damageChosen` RIDER, `perDamageCounterOnTarget`, READ PER REF AT THE ANSWER** — `censusAttackCorpus.ts` **FILE LINE 551** (`legalAttackCorpus()` index 498), *"This attack does 20 damage to 1 of your opponent's Benched Pokémon for each damage counter on that Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)"*, **1 sentence / 1 legal printing** (no id on this checkout, D425), claimed by `deriveAttackEffect` through ONE new anchor (`BENCHED_SNIPE_TARGET_COUNTERS`, beside `BENCHED_SNIPE_TAKEN_PRIZES`, disjoint by TAIL) as arm 6b′ — a READER move: reader arm 555/1597 → 556/1598, raw residue 85/135 → 84/134; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.415.0 → 0.416.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1.)
    expect(unbuilt.map(([, s]) => s)).not.toContain(PRINTED);
    expect(unbuilt.map(([, s]) => s)).not.toContain(RETRIEVAL_TWIN);
    // The parts add up to the whole quoted in the same case.
    const all = legalAttackCorpus();
    expect(unbuilt.length + 586).toBe(all.length);  // (🆕🆕🆕 **D569 +4 sentences — THE PARADOX BANNER READERS** (Koraidon ×2, Roaring Moon ×2, Iron Valiant, Slither Wing); the offset gains four.) (🆕🆕🆕 **D568 +2 sentences / +2 printings — THE TWO TERA CLAUSES** (Ho-Oh `sv08-019`, Regigigas `sv08.5-086`), two literal rows over `banners.ts`; this suite's own row is unmoved.) (🆕🆕🆕 **D552 +2 sentences / +2 printings — THE PRE-DAMAGE SELF ATTACH BEHIND A MULTIPLIER HEAD, AND THE WEAKNESS RETYPE** — `censusAttackCorpus.ts` **file lines 569 and 629** (leading count column `1` each; card ids UNRESOLVED on this checkout — measured, never invented, D425): `:569` claimed WHOLE by `deriveAttackDiscardScaledBoost`'s THIRD member `selfHandAttach` (attach-then-damage inside the program), `:629` by `deriveAttackEffect` through ONE new anchor `DEFENDER_WEAKNESS_RETYPED` as ONE new op `retypeDefenderWeakness` — a READER move: reader arm 578/1632 → 580/1634, raw residue 62/100 → 60/98, `BUILT.attack` 1688 → 1690; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.435.0 → 0.436.0, `MATCH_RECORD_VERSION` 33 → 34. ⚠️ THE SENTENCE STEP (2) AND THE PRINTING STEP (2) AGREE this slice — the case where a copied number is right BY ACCIDENT, so every site was classified by the quantity its D550 note names (D426/D451). THIS SITE: the partition summand 578 → 580.)  // (🆕🆕🆕 **D550 +1 sentence / +1 printing — THE OPPONENT-FLIPPED PER-TAILS SNIPE ON THE OPPONENT'S BENCH COUNT** — `censusAttackCorpus.ts` **file line 669** (leading count column `1`; card id UNRESOLVED on this checkout — measured, never invented, D425), claimed WHOLE by `deriveAttackCoinFlip` (a NINTH member `opponentPerTails` over a NULLARY `AttackFlipCount.opponentBench`) AND by `deriveAttackDamageSuppression`'s THIRD compound arm off ONE anchor, `ATTACK_OPPONENT_BENCH_TAILS` — a READER move: reader arm 577/1631 → 578/1632, raw residue 63/101 → 62/100, `BUILT.attack` 1687 → 1688, PHRASE-24 1/1 → 0/0; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.434.0 → 0.435.0, `MATCH_RECORD_VERSION` HOLDS at 33. ⚠️ THE SENTENCE STEP (1) AND THE PRINTING STEP (1) AGREE this slice — the case where a copied number is right BY ACCIDENT, so every site was classified by the quantity its D549 note names (D426/D451). THIS SITE: the partition summand 577 → 578.)  // (🆕🆕🆕 **D549 +4 sentences / +4 printings — THE DEFENDER'S NEXT-TURN MARKS AND THE SIDE-WIDE ATTACK LOCK** — `censusAttackCorpus.ts` **file lines 171, 149, 169 and 170** (leading count column `1` each; card ids UNRESOLVED on this checkout — measured, never invented, D425), claimed WHOLE by `deriveAttackEffect` alone through FOUR new anchors as THREE new ops (`taxDefender`, `bountyDefender`, `lockSideAttacks`) — a READER move: reader arm 573/1627 → 577/1631, raw residue 67/105 → 63/101, `BUILT.attack` 1683 → 1687; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.433.0 → 0.434.0, `MATCH_RECORD_VERSION` 32 → 33. ⚠️ THE SENTENCE STEP (4) AND THE PRINTING STEP (4) AGREE this slice — the case where a copied number is right BY ACCIDENT, so every site was classified by the quantity its D548 note names (D426/D451). THIS SITE: the partition summand 573 → 577.)  // (🆕🆕🆕 **D548 +1 sentence / +2 printings — CRESCENT PURGE, THE FACE-UP PRIZE** — `censusAttackCorpus.ts` **file line 664**, Cresselia `sv06.5-021` "Crescent Purge", claimed WHOLE by `deriveAttackOptionalCostBoost`'s FIFTH cost row (`turnPrizeFaceUp` behind `yourFaceDownPrizeRemains`); engine 0.432.0 → 0.433.0, `MATCH_RECORD_VERSION` 31 → 32. ⚠️ THE SENTENCE STEP (1) AND THE PRINTING STEP (2) DIFFER. THIS SITE: the partition summand 572 → 573.)  // (🆕🆕🆕 **D547 +2 sentences / +4 printings — THE FLIP-TO-ATTACK LOCK AND THE NEXT-TURN VULNERABILITY** — `censusAttackCorpus.ts` **file lines 176 and 150** (leading count column `2` each), *“During your opponent's next turn, if the Defending Pokémon tries to use an attack, your opponent flips a coin. If tails, that attack doesn't happen.”* (TWO sentences in ONE row) and *“During your next turn, the Defending Pokémon takes 50 more damage from attacks (after applying Weakness and Resistance).”*, **2 rows / 4 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so both suites ride file-local declared `d547-*` demonstrators), claimed WHOLE by `deriveAttackEffect` through TWO new anchors (`DEFENDER_FLIP_ATTACK_LOCK`, `DEFENDER_VULNERABLE_NEXT_TURN`) as TWO new ops (`flipLockAttack`, `exposeDefender`) on TWO new REQUIRED `InPlayPokemon` fields — a READER move: reader arm 570/1621 → 572/1625, raw residue 70/111 → 68/107, `BUILT.attack` 1677 → 1681; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.431.0 → 0.432.0, `MATCH_RECORD_VERSION` 30 → 31. ⚠️ **THE SENTENCE STEP (2) AND THE PRINTING STEP (4) DIFFER**, so no copied number is right by accident; every site was classified by the quantity its D546 note names (D426/D451). THIS SITE: the partition summand 570 → 572 (unbuilt + resolved = 640).)  // (🆕🆕🆕 **D546 +2 sentences / +2 printings — THE ALL-ATTACKS NEXT-TURN BUFF** — `censusAttackCorpus.ts` **file lines 76 and 148** (leading count column `1` each), *“During your next turn, attacks used by this Pokémon do 120 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance).”* and the same sentence at 100 behind *“Both Active Pokémon are now Asleep.”*, **2 sentences / 2 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so the suite rides file-local declared `d546-*` demonstrators), claimed WHOLE by `deriveAttackEffect` through ONE new whole-sentence anchor (`SELF_EVERY_ATTACK_BOOST`, ONE `['’]` slot, an optional Sleep prefix) as `attack: null` on the SHIPPED `boostAttack` op — no new `EffectOp` member, no new `InPlayPokemon` field — a READER move: reader arm 568/1619 → 570/1621, raw residue 72/113 → 70/111, `BUILT.attack` 1675 → 1677; registry 10/16, gate 9/19, trailing 11/21, `SPLIT_ATTACK_UNITS` 19 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED (19 READ at `censusAtHead.test.ts:8169`); engine 0.430.0 → 0.431.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP ARE BOTH 2 — THE ONE SHAPE WHERE A COPIED NUMBER IS RIGHT BY ACCIDENT**, so every site was measured by the quantity it pins, not copied (D426/D451). THIS SITE: the partition summand 568 → 570 (unbuilt + resolved = 640).)  // (🆕🆕🆕 **D544 +1 sentence / +2 printings — THE NAMED ATTACK'S BASE DAMAGE, OVERRIDDEN FOR ONE WINDOW** — `censusAttackCorpus.ts` **file line 166** (leading count column `2`), *“During your next turn, this Pokémon's Hyper Fang attack's base damage is 240.”*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so the suite rides the file-local declared demonstrator `d544-fang`), claimed WHOLE by `deriveAttackEffect` through ONE new whole-sentence anchor (`SELF_ATTACK_BASE_SET`, TWO `['’]` slots, name and number CAPTURED) as a `base: true` RIDER on the SHIPPED `boostAttack` op — no new `EffectOp` member, no new `InPlayPokemon` field — a READER move: reader arm 567/1617 → 568/1619, raw residue 73/115 → 72/113, `BUILT.attack` 1671 → 1673; registry 10/16, gate 7/17, trailing 11/21, `SPLIT_ATTACK_UNITS` 17 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED (17 READ at `censusAtHead.test.ts:8159` — the “14” in D543's annotation beside this one has been stale since D541 moved the constant); engine 0.428.0 → 0.429.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — THEY DISAGREE**, so no number may be copied from one kind of site into another (D426/D451). THIS SITE: the partition summand 567 → 568 (unbuilt + resolved = 640).)  // (🆕🆕🆕 **D543 +1 sentence / +2 printings — THE CHOSEN POKÉMON TOOL DISCARD AT THE PROGRAM TAIL** — `censusAttackCorpus.ts` **file line 136** (leading count column `2`), *“Discard up to 2 Pokémon Tools from your opponent's Pokémon.”*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrator `d543-stripper`), claimed WHOLE by `deriveAttackEffect` through ONE new whole-sentence anchor (`ATTACK_DISCARD_TOOLS_UP_TO`, ONE `['’]` slot at index 48, count CAPTURED) as ONE new `EffectOp` member `discardTools{count}` parking on ONE new `EffectPrompt` kind — a READER move: reader arm 566/1615 → 567/1617, raw residue 74/117 → 73/115, `BUILT.attack` 1669 → 1671; registry 10/16, gate 7/17, trailing 11/21, `SPLIT_ATTACK_UNITS` 14 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED; engine 0.427.0 → 0.428.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — THEY DISAGREE**, so no number may be copied from one kind of site into another (D426/D451). THIS SITE: the partition summand 566 → 567 (unbuilt + resolved = 640).)  // (🆕🆕🆕 **D542 +1 sentence / +1 printing — THE OPPONENT-CHOSEN HAND SHUFFLE** — `censusAttackCorpus.ts` **file line 665** (`legalAttackCorpus()` index 612, leading count column `1`), *“Your opponent chooses 3 cards from their hand and shuffles those cards into their deck.”*, **1 sentence / 1 legal printing**, claimed WHOLE by `deriveAttackEffect` through ONE new anchor and ONE new arm returning a COMPOSITION of two shipped ops — so it leaves through the RAW READER summand and the registry / gate-split / trailing-split summands all stand still. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1, WHICH IS THE ONE CASE WHERE A COPIED NUMBER IS RIGHT BY ACCIDENT — so THIS SITE WAS MEASURED rather than inherited from its neighbour** (D426/D451).)  (🆕🆕🆕 **D540 +1 sentence / +1 printing — THE DEVOLUTION WITH A PICK IN IT, AND THE `/[Dd]evolv/` FAMILY CLOSES** — `censusAttackCorpus.ts` **row 87** (`legalAttackCorpus()` index 34), *"Devolve 1 of your opponent's evolved Pokémon by putting the highest Stage Evolution card on it into your opponent's hand."*, **1 sentence / 1 legal printing**, claimed by `deriveAttackEffect` through ONE new anchor `DEVOLVE_CHOSEN_TO_HAND` and arm 41-ter into ONE new FIELD-FREE `EffectOp` member `devolveChosen`. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 for the first time in six slices — the one case where a copied number is right by accident, so THIS SITE was measured off the live failure and never copied from a neighbour.)  // (🆕🆕🆕 **D539 +1 sentence — THE NAMED-BODY MULTIPLIER WITH A NAMED-BODY OWN-SIDE SPREAD BEHIND IT** — `censusAttackCorpus.ts` **FILE LINE 595** (`legalAttackCorpus()` index 542), *"This attack does 50 damage for each of your Drifloon and Drifblim in play. This attack also does 30 damage to each of your Drifloon and Drifblim. (Don't apply Weakness and Resistance for Benched Pokémon.)"*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrators `d539-*`), claimed by TWO readers off ONE `effect` string through ONE new whole-compound anchor carrying a `\2` BACKREFERENCE (`NAMED_BODIES_MULTIPLY_SPREAD`) — `deriveAttackDamageMultiplier` for the × fold and `deriveAttackEffect` for `damageChosen` with the FOURTH `target` member `yourAny` and `count: "all"`, plus the NINTH `IN_PLAY_BODY_NOUNS` exact key — a READER move: reader arm 563/1611 → 564/1613, raw residue 77/121 → 76/119, `BUILT.attack` 1662 → 1664; registry 10/16, gate 6/14, trailing 11/21, `SPLIT_ATTACK_UNITS` 14, `COMPOUND_ATTACK_UNITS` 21 and `attackReaderSurface()` 13 UNMOVED; engine 0.423.0 → 0.424.0, `MATCH_RECORD_VERSION` HELD at 30 (a WIDENING at a persisted address, D125's free case — and `count: "all"` NEVER PARKS). ⚠️ THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — they disagree for the FIFTH slice running (D535 1-vs-2, D536 1-vs-3, D537 1-vs-2, D538 1-vs-3). THIS SITE: a LIVE ADDEND at the FRONT (D461's table: the tell is the left-hand side), 563 → 564.)  // (🆕🆕🆕 **D538 +1 sentence — THE COUNTER PLACEMENT WHOSE AMOUNT IS A PAYLOAD AND WHOSE TAIL SHUFFLES THE VERY CARDS IT COUNTED** — `censusAttackCorpus.ts` **FILE LINE 412** (`legalAttackCorpus()` index 359), *"Put 2 damage counters on 1 of your opponent's Pokémon for each Basic {G} Energy card in your discard pile. Then, shuffle those Energy cards into your deck."*, **1 sentence / 3 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrator `d538-pile-sniper`), claimed by `deriveAttackEffect` through ONE new whole-sentence TWO-capture anchor (`COUNTER_PUT_SCALED_BY_PILE`, declared with the counter-put family, ONE `['’]` slot) as arm **23b-bis** emitting THREE ops — `damageChosen{perDiscardPileCard}` + `discardPileRetrieval{max:"all"}` + `shuffleDeck`, with ONE `CardFilter` object shared by the first two — a READER move: reader arm 562/1608 → 563/1611, raw residue 78/124 → 77/121, `BUILT.attack` 1659 → 1662; registry 10/16, gate 6/14, trailing 11/21, `SPLIT_ATTACK_UNITS` 14 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED; engine 0.422.0 → 0.423.0, `MATCH_RECORD_VERSION` HELD at 30 (a NEW OPTIONAL KEY is D125's WIDENING and `max: "all"` is a PURE ADDITION to a value domain — and BOTH bytes are written into the record, through `phase.cont.pendingOp` and `phase.cont.rest` respectively). ⚠️ THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 3 — they disagree for the FOURTH slice running (D535 1-vs-2, D536 1-vs-3, D537 1-vs-2), so a pass that copied one number into the other kind of site would be wrong in half of them. THIS SITE: ⚠️ A TAIL A NUMERIC READER CANNOT SEE, STEPPED BY HAND (D426) — + 562 → + 563. SENTENCES, so the step is 1.)  // (🆕🆕🆕 **D537 +1 sentence — KEEP THREE, SHUFFLE THE REST: THE ONLY SENTENCE IN THIS CORPUS WHOSE PICK NAMES THE BODIES THAT *STAY* — ONE NEW `EffectOp` MEMBER `returnBenchedRest` AND ONE INTERPRETER WRITER** — `censusAttackCorpus.ts` **FILE LINE 84** (`legalAttackCorpus()` index 31), *"Choose 3 of your opponent's Benched Pokémon. If you do, shuffle all of your opponent's Benched Pokémon that you didn't choose, and all cards attached to those Pokémon, into their deck."*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrator `d537-bencher`), claimed by `deriveAttackEffect` through ONE new ONE-capture whole-sentence anchor (`CHOOSE_KEEP_SHUFFLE_REST`, beside `RETURN_BENCHED`, THREE `['’]` slots — two possessives AND the contraction in "didn't") as arm **42-bis** emitting ONE `returnBenchedRest{keep:3}` — a READER move: reader arm 561/1606 → 562/1608, raw residue 79/126 → 78/124, `BUILT.attack` 1657 → 1659; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.421.0 → 0.422.0, `MATCH_RECORD_VERSION` HELD at 30 (a new op MEMBER is D125's WIDENING — and this op PARKS, so the byte IS written into `phase.cont.pendingOp`). ⚠️ THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — they disagree for the third slice running (D535 1-vs-2, D536 1-vs-3), so a pass that copied one number into the other kind of site would be wrong in half of them. THIS SITE: ⚠️ A FROZEN TAIL A NUMERIC READER CANNOT SEE, STEPPED BY HAND (D426) — 561 → 562.)  // (🆕🆕🆕 **D536 +1 sentence — THE BODY THAT LEAVES PLAY WITHOUT BEING KNOCKED OUT — ONE NEW FIELD-FREE `EffectOp` MEMBER `discardDefender` AND ONE INTERPRETER WRITER** — `censusAttackCorpus.ts` **FILE LINE 100** (`legalAttackCorpus()` index 47), *"Discard a Team Rocket's Energy from this Pokémon. If you do, discard your opponent's Active Pokémon and all attached cards."*, **1 sentence / 3 legal printings** (Moltres ex `sv10-031`/`-208`/`-229`), claimed by `deriveAttackEffect` through arm 44c over ONE new zero-capture anchor `TR_ENERGY_COST_THEN_DISCARD_DEFENDER` — a READER move: reader arm 560/1603 → 561/1606, raw residue 80/129 → 79/126, `BUILT.attack` 1654 → 1657; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.420.0 → 0.421.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 3 — they disagree HARDER than D535's 1-vs-2. THIS SITE: 561 → 562.)  // (🆕🆕🆕 **D535 +1 sentence / +2 printings — THE PICK-WITH-REPLACEMENT SNIPE — ZERO NEW VOCABULARY: SIX `damageChosen` OPS AT `count: 1`, THE LITERAL `CHOSEN_ANY_TARGET` ALREADY AUTHORS** — `censusAttackCorpus.ts` **FILE LINE 81** (`legalAttackCorpus()` index 28), *"Choose 1 of your opponent's Pokémon 6 times. (You can choose the same Pokémon more than once.) For each time you chose a Pokémon, do 20 damage to it. This damage isn't affected by Weakness or Resistance."*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — no D1, no catalog sqlite — stated unresolved, never invented, D425), claimed by `deriveAttackEffect` through ONE new TWO-capture anchor (`ATTACK_PICK_WITH_REPLACEMENT_SNIPE`, beside `CHOSEN_ANY_TARGET`) as SIX `damageChosen{target:"opponentAny", amount:20, count:1, source:"attack", deals, ignoreWR}` parks — a READER move: reader arm 559/1601 → 560/1603, raw residue 81/131 → 80/129; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.419.0 → 0.420.0, `MATCH_RECORD_VERSION` HELD at 30 (D237's POPULATION change — the op literal already ships, so the serialized alphabet does not grow). ⚠️ THE SENTENCE STEP AND THE PRINTING STEP DISAGREE AT 1 AND 2 — the legal column prints this sentence TWICE.)  // (🆕🆕🆕 **D534 +1 sentence / +1 printing — THE ONE-CARD LOOK AT THE OPPONENT's DECK WITH A PRINTED SHUFFLE — `shuffleDeck` GAINS THE OPTIONAL KEY `whose: "opponent"` and `reorderTop` PARKS A ONE-CARD WINDOW WHEN ITS TWO ARMS DIFFER** — `censusAttackCorpus.ts` **FILE LINE 401**, *"Look at the top card of your opponent's deck. You may have your opponent shuffle their deck."*, **1 sentence / 1 legal printing** (Inkay `sv06.5-033`; no id on this checkout, D425), claimed by `deriveAttackEffect` through ONE new zero-capture anchor (`ATTACK_OPPONENT_TOP_LOOK_SHUFFLE`, beside `ATTACK_REORDER_TOP`) as `reorderTop{n:1, side:"opponent", otherwise:[shuffleDeck{whose:"opponent"}]}` — a READER move: reader arm 558/1600 → 559/1601, raw residue 82/132 → 81/131; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.418.0 → 0.419.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1.)  // (🆕🆕🆕 **D532 +1 sentence — THE CROSS-SEAT DISCARD-PILE ATTACH — `attachEnergyFrom` GAINS THE OPTIONAL KEY `whose: "opponent"` (on the op AND on `AttachTargetRiders`, read through ONE resolver)** — `censusAttackCorpus.ts` **FILE LINE 70** (`legalAttackCorpus()` index 17), *"Attach up to 3 Energy cards from your opponent's discard pile to their Pokémon in any way you like."*, **1 sentence / 1 legal printing** (Grafaiai `sv08-121`; no id on this checkout, D425), claimed by `deriveAttackEffect` through ONE new zero-capture anchor (`ATTACK_OPPONENT_DISCARD_ATTACH`, beside the factory-built `DISCARD_ATTACH`) as D360's spread ONE KEY OVER — a READER move: reader arm 557/1599 → 558/1600, raw residue 83/133 → 82/132; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.417.0 → 0.418.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1.)  // (🆕🆕🆕 **D531 +1 sentence — THE BOARD-TYPED HAND SEARCH — `searchDeck` GAINS THE PARK-TIME RIDER `typedAsAttachedBasicEnergy`** — `censusAttackCorpus.ts` **FILE LINE 483** (`legalAttackCorpus()` index 430), *"Search your deck for up to 5 Pokémon that are the same type as any Basic Energy attached to this Pokémon, reveal them, and put them into your hand. Then, shuffle your deck."*, **1 sentence / 1 legal printing** (sv07-065 per the retired D231 deferral; no id on this checkout, D425), claimed by `deriveAttackEffect` through ONE new zero-capture anchor (`ATTACK_HAND_SEARCH_TYPED_AS_ATTACHED`, beside `ATTACK_HAND_SEARCH_BENCH_COUNT`) whose rider the park resolves against the SOURCE body's attached Basic Energy — a READER move: reader arm 556/1598 → 557/1599, raw residue 84/134 → 83/133; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.416.0 → 0.417.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1.)  // (🆕🆕🆕 **D530 +1 sentence — THE TARGET-COUNTER-SCALED BENCH SNIPE — A FOURTH `damageChosen` RIDER, `perDamageCounterOnTarget`, READ PER REF AT THE ANSWER** — `censusAttackCorpus.ts` **FILE LINE 551** (`legalAttackCorpus()` index 498), *"This attack does 20 damage to 1 of your opponent's Benched Pokémon for each damage counter on that Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)"*, **1 sentence / 1 legal printing** (no id on this checkout, D425), claimed by `deriveAttackEffect` through ONE new anchor (`BENCHED_SNIPE_TARGET_COUNTERS`, beside `BENCHED_SNIPE_TAKEN_PRIZES`, disjoint by TAIL) as arm 6b′ — a READER move: reader arm 555/1597 → 556/1598, raw residue 85/135 → 84/134; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.415.0 → 0.416.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1.)
    expect(units(unbuilt) + 1642).toBe(units(all));  // (🆕🆕🆕 **D569 +6 printings — THE PARADOX BANNER READERS** (Koraidon ×2, Roaring Moon ×2, Iron Valiant, Slither Wing); the offset gains six.) (🆕🆕🆕 **D568 +2 printings — THE TWO TERA CLAUSES** (Ho-Oh `sv08-019`, Regigigas `sv08.5-086`); the offset gains two.) (🆕🆕🆕 **D552 +2 sentences / +2 printings — THE PRE-DAMAGE SELF ATTACH BEHIND A MULTIPLIER HEAD, AND THE WEAKNESS RETYPE** — `censusAttackCorpus.ts` **file lines 569 and 629** (leading count column `1` each; card ids UNRESOLVED on this checkout — measured, never invented, D425): `:569` claimed WHOLE by `deriveAttackDiscardScaledBoost`'s THIRD member `selfHandAttach` (attach-then-damage inside the program), `:629` by `deriveAttackEffect` through ONE new anchor `DEFENDER_WEAKNESS_RETYPED` as ONE new op `retypeDefenderWeakness` — a READER move: reader arm 578/1632 → 580/1634, raw residue 62/100 → 60/98, `BUILT.attack` 1688 → 1690; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.435.0 → 0.436.0, `MATCH_RECORD_VERSION` 33 → 34. ⚠️ THE SENTENCE STEP (2) AND THE PRINTING STEP (2) AGREE this slice — the case where a copied number is right BY ACCIDENT, so every site was classified by the quantity its D550 note names (D426/D451). THIS SITE: the PRINTINGS partition summand 1632 → 1634.)  // (🆕🆕🆕 **D550 +1 sentence / +1 printing — THE OPPONENT-FLIPPED PER-TAILS SNIPE ON THE OPPONENT'S BENCH COUNT** — `censusAttackCorpus.ts` **file line 669** (leading count column `1`; card id UNRESOLVED on this checkout — measured, never invented, D425), claimed WHOLE by `deriveAttackCoinFlip` (a NINTH member `opponentPerTails` over a NULLARY `AttackFlipCount.opponentBench`) AND by `deriveAttackDamageSuppression`'s THIRD compound arm off ONE anchor, `ATTACK_OPPONENT_BENCH_TAILS` — a READER move: reader arm 577/1631 → 578/1632, raw residue 63/101 → 62/100, `BUILT.attack` 1687 → 1688, PHRASE-24 1/1 → 0/0; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.434.0 → 0.435.0, `MATCH_RECORD_VERSION` HOLDS at 33. ⚠️ THE SENTENCE STEP (1) AND THE PRINTING STEP (1) AGREE this slice — the case where a copied number is right BY ACCIDENT, so every site was classified by the quantity its D549 note names (D426/D451). THIS SITE: the PRINTINGS partition summand 1631 → 1632.)  // (🆕🆕🆕 **D549 +4 sentences / +4 printings — THE DEFENDER'S NEXT-TURN MARKS AND THE SIDE-WIDE ATTACK LOCK** — `censusAttackCorpus.ts` **file lines 171, 149, 169 and 170** (leading count column `1` each; card ids UNRESOLVED on this checkout — measured, never invented, D425), claimed WHOLE by `deriveAttackEffect` alone through FOUR new anchors as THREE new ops (`taxDefender`, `bountyDefender`, `lockSideAttacks`) — a READER move: reader arm 573/1627 → 577/1631, raw residue 67/105 → 63/101, `BUILT.attack` 1683 → 1687; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.433.0 → 0.434.0, `MATCH_RECORD_VERSION` 32 → 33. ⚠️ THE SENTENCE STEP (4) AND THE PRINTING STEP (4) AGREE this slice — the case where a copied number is right BY ACCIDENT, so every site was classified by the quantity its D548 note names (D426/D451). THIS SITE: the PRINTINGS partition summand 1627 → 1631.)  // (🆕🆕🆕 **D548 +1 sentence / +2 printings — CRESCENT PURGE, THE FACE-UP PRIZE** — `censusAttackCorpus.ts` **file line 664**, Cresselia `sv06.5-021` "Crescent Purge", claimed WHOLE by `deriveAttackOptionalCostBoost`'s FIFTH cost row (`turnPrizeFaceUp` behind `yourFaceDownPrizeRemains`); engine 0.432.0 → 0.433.0, `MATCH_RECORD_VERSION` 31 → 32. ⚠️ THE SENTENCE STEP (1) AND THE PRINTING STEP (2) DIFFER. THIS SITE: the PRINTINGS partition summand 1625 → 1627.)  // (🆕🆕🆕 **D547 +2 sentences / +4 printings — THE FLIP-TO-ATTACK LOCK AND THE NEXT-TURN VULNERABILITY** — `censusAttackCorpus.ts` **file lines 176 and 150** (leading count column `2` each), *“During your opponent's next turn, if the Defending Pokémon tries to use an attack, your opponent flips a coin. If tails, that attack doesn't happen.”* (TWO sentences in ONE row) and *“During your next turn, the Defending Pokémon takes 50 more damage from attacks (after applying Weakness and Resistance).”*, **2 rows / 4 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so both suites ride file-local declared `d547-*` demonstrators), claimed WHOLE by `deriveAttackEffect` through TWO new anchors (`DEFENDER_FLIP_ATTACK_LOCK`, `DEFENDER_VULNERABLE_NEXT_TURN`) as TWO new ops (`flipLockAttack`, `exposeDefender`) on TWO new REQUIRED `InPlayPokemon` fields — a READER move: reader arm 570/1621 → 572/1625, raw residue 70/111 → 68/107, `BUILT.attack` 1677 → 1681; registry 10/16, gate 9/19, trailing 11/21 UNMOVED; engine 0.431.0 → 0.432.0, `MATCH_RECORD_VERSION` 30 → 31. ⚠️ **THE SENTENCE STEP (2) AND THE PRINTING STEP (4) DIFFER**, so no copied number is right by accident; every site was classified by the quantity its D546 note names (D426/D451). THIS SITE: the PRINTINGS partition summand 1621 → 1625 (unbuilt + resolved = 1,732).)  // (🆕🆕🆕 **D546 +2 sentences / +2 printings — THE ALL-ATTACKS NEXT-TURN BUFF** — `censusAttackCorpus.ts` **file lines 76 and 148** (leading count column `1` each), *“During your next turn, attacks used by this Pokémon do 120 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance).”* and the same sentence at 100 behind *“Both Active Pokémon are now Asleep.”*, **2 sentences / 2 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so the suite rides file-local declared `d546-*` demonstrators), claimed WHOLE by `deriveAttackEffect` through ONE new whole-sentence anchor (`SELF_EVERY_ATTACK_BOOST`, ONE `['’]` slot, an optional Sleep prefix) as `attack: null` on the SHIPPED `boostAttack` op — no new `EffectOp` member, no new `InPlayPokemon` field — a READER move: reader arm 568/1619 → 570/1621, raw residue 72/113 → 70/111, `BUILT.attack` 1675 → 1677; registry 10/16, gate 9/19, trailing 11/21, `SPLIT_ATTACK_UNITS` 19 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED (19 READ at `censusAtHead.test.ts:8169`); engine 0.430.0 → 0.431.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP ARE BOTH 2 — THE ONE SHAPE WHERE A COPIED NUMBER IS RIGHT BY ACCIDENT**, so every site was measured by the quantity it pins, not copied (D426/D451). THIS SITE: the PRINTINGS partition summand 1619 → 1621 (unbuilt + resolved = 1,732).)  // (🆕🆕🆕 **D544 +1 sentence / +2 printings — THE NAMED ATTACK'S BASE DAMAGE, OVERRIDDEN FOR ONE WINDOW** — `censusAttackCorpus.ts` **file line 166** (leading count column `2`), *“During your next turn, this Pokémon's Hyper Fang attack's base damage is 240.”*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — measured, never invented, D425 — so the suite rides the file-local declared demonstrator `d544-fang`), claimed WHOLE by `deriveAttackEffect` through ONE new whole-sentence anchor (`SELF_ATTACK_BASE_SET`, TWO `['’]` slots, name and number CAPTURED) as a `base: true` RIDER on the SHIPPED `boostAttack` op — no new `EffectOp` member, no new `InPlayPokemon` field — a READER move: reader arm 567/1617 → 568/1619, raw residue 73/115 → 72/113, `BUILT.attack` 1671 → 1673; registry 10/16, gate 7/17, trailing 11/21, `SPLIT_ATTACK_UNITS` 17 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED (17 READ at `censusAtHead.test.ts:8159` — the “14” in D543's annotation beside this one has been stale since D541 moved the constant); engine 0.428.0 → 0.429.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — THEY DISAGREE**, so no number may be copied from one kind of site into another (D426/D451). THIS SITE: the PRINTINGS partition summand 1617 → 1619 (unbuilt + resolved = 1,732).)  // (🆕🆕🆕 **D543 +1 sentence / +2 printings — THE CHOSEN POKÉMON TOOL DISCARD AT THE PROGRAM TAIL** — `censusAttackCorpus.ts` **file line 136** (leading count column `2`), *“Discard up to 2 Pokémon Tools from your opponent's Pokémon.”*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrator `d543-stripper`), claimed WHOLE by `deriveAttackEffect` through ONE new whole-sentence anchor (`ATTACK_DISCARD_TOOLS_UP_TO`, ONE `['’]` slot at index 48, count CAPTURED) as ONE new `EffectOp` member `discardTools{count}` parking on ONE new `EffectPrompt` kind — a READER move: reader arm 566/1615 → 567/1617, raw residue 74/117 → 73/115, `BUILT.attack` 1669 → 1671; registry 10/16, gate 7/17, trailing 11/21, `SPLIT_ATTACK_UNITS` 14 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED; engine 0.427.0 → 0.428.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — THEY DISAGREE**, so no number may be copied from one kind of site into another (D426/D451). THIS SITE: the PRINTINGS partition summand 1615 → 1617 (unbuilt + resolved = 1,732).)  // (🆕🆕🆕 **D542 +1 sentence / +1 printing — THE OPPONENT-CHOSEN HAND SHUFFLE** — `censusAttackCorpus.ts` **file line 665** (`legalAttackCorpus()` index 612, leading count column `1`), *“Your opponent chooses 3 cards from their hand and shuffles those cards into their deck.”*, **1 sentence / 1 legal printing**, claimed WHOLE by `deriveAttackEffect` through ONE new anchor and ONE new arm returning a COMPOSITION of two shipped ops — so it leaves through the RAW READER summand and the registry / gate-split / trailing-split summands all stand still. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1, WHICH IS THE ONE CASE WHERE A COPIED NUMBER IS RIGHT BY ACCIDENT — so THIS SITE WAS MEASURED rather than inherited from its neighbour** (D426/D451).)  (🆕🆕🆕 **D540 +1 sentence / +1 printing — THE DEVOLUTION WITH A PICK IN IT, AND THE `/[Dd]evolv/` FAMILY CLOSES** — `censusAttackCorpus.ts` **row 87** (`legalAttackCorpus()` index 34), *"Devolve 1 of your opponent's evolved Pokémon by putting the highest Stage Evolution card on it into your opponent's hand."*, **1 sentence / 1 legal printing**, claimed by `deriveAttackEffect` through ONE new anchor `DEVOLVE_CHOSEN_TO_HAND` and arm 41-ter into ONE new FIELD-FREE `EffectOp` member `devolveChosen`. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 for the first time in six slices — the one case where a copied number is right by accident, so THIS SITE was measured off the live failure and never copied from a neighbour.)  🆕🆕🆕 **D539 +2 printings — THE NAMED-BODY MULTIPLIER WITH A NAMED-BODY OWN-SIDE SPREAD BEHIND IT** — `censusAttackCorpus.ts` **FILE LINE 595** (`legalAttackCorpus()` index 542), *"This attack does 50 damage for each of your Drifloon and Drifblim in play. This attack also does 30 damage to each of your Drifloon and Drifblim. (Don't apply Weakness and Resistance for Benched Pokémon.)"*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrators `d539-*`), claimed by TWO readers off ONE `effect` string through ONE new whole-compound anchor carrying a `\2` BACKREFERENCE (`NAMED_BODIES_MULTIPLY_SPREAD`) — `deriveAttackDamageMultiplier` for the × fold and `deriveAttackEffect` for `damageChosen` with the FOURTH `target` member `yourAny` and `count: "all"`, plus the NINTH `IN_PLAY_BODY_NOUNS` exact key — a READER move: reader arm 563/1611 → 564/1613, raw residue 77/121 → 76/119, `BUILT.attack` 1662 → 1664; registry 10/16, gate 6/14, trailing 11/21, `SPLIT_ATTACK_UNITS` 14, `COMPOUND_ATTACK_UNITS` 21 and `attackReaderSurface()` 13 UNMOVED; engine 0.423.0 → 0.424.0, `MATCH_RECORD_VERSION` HELD at 30 (a WIDENING at a persisted address, D125's free case — and `count: "all"` NEVER PARKS). ⚠️ THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — they disagree for the FIFTH slice running (D535 1-vs-2, D536 1-vs-3, D537 1-vs-2, D538 1-vs-3). THIS SITE: a LIVE ADDEND at the FRONT (D461's table: the tell is the left-hand side), 1611 → 1613.)  // (🆕🆕🆕 **D538 +3 printings — THE COUNTER PLACEMENT WHOSE AMOUNT IS A PAYLOAD AND WHOSE TAIL SHUFFLES THE VERY CARDS IT COUNTED** — `censusAttackCorpus.ts` **FILE LINE 412** (`legalAttackCorpus()` index 359), *"Put 2 damage counters on 1 of your opponent's Pokémon for each Basic {G} Energy card in your discard pile. Then, shuffle those Energy cards into your deck."*, **1 sentence / 3 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrator `d538-pile-sniper`), claimed by `deriveAttackEffect` through ONE new whole-sentence TWO-capture anchor (`COUNTER_PUT_SCALED_BY_PILE`, declared with the counter-put family, ONE `['’]` slot) as arm **23b-bis** emitting THREE ops — `damageChosen{perDiscardPileCard}` + `discardPileRetrieval{max:"all"}` + `shuffleDeck`, with ONE `CardFilter` object shared by the first two — a READER move: reader arm 562/1608 → 563/1611, raw residue 78/124 → 77/121, `BUILT.attack` 1659 → 1662; registry 10/16, gate 6/14, trailing 11/21, `SPLIT_ATTACK_UNITS` 14 and `COMPOUND_ATTACK_UNITS` 21 UNMOVED; engine 0.422.0 → 0.423.0, `MATCH_RECORD_VERSION` HELD at 30 (a NEW OPTIONAL KEY is D125's WIDENING and `max: "all"` is a PURE ADDITION to a value domain — and BOTH bytes are written into the record, through `phase.cont.pendingOp` and `phase.cont.rest` respectively). ⚠️ THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 3 — they disagree for the FOURTH slice running (D535 1-vs-2, D536 1-vs-3, D537 1-vs-2), so a pass that copied one number into the other kind of site would be wrong in half of them. THIS SITE: ⚠️ A TAIL A NUMERIC READER CANNOT SEE, STEPPED BY HAND (D426) — + 1608 → + 1611. 🛑 PRINTINGS, SO THE STEP IS **3** AND NOT 1 — this is the exact site D537's automated pass got wrong by assuming the sentence step.)  // (🆕🆕🆕 **D537 +1 sentence — KEEP THREE, SHUFFLE THE REST: THE ONLY SENTENCE IN THIS CORPUS WHOSE PICK NAMES THE BODIES THAT *STAY* — ONE NEW `EffectOp` MEMBER `returnBenchedRest` AND ONE INTERPRETER WRITER** — `censusAttackCorpus.ts` **FILE LINE 84** (`legalAttackCorpus()` index 31), *"Choose 3 of your opponent's Benched Pokémon. If you do, shuffle all of your opponent's Benched Pokémon that you didn't choose, and all cards attached to those Pokémon, into their deck."*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — stated unresolved, never invented, D425 — so the suite rides the file-local declared demonstrator `d537-bencher`), claimed by `deriveAttackEffect` through ONE new ONE-capture whole-sentence anchor (`CHOOSE_KEEP_SHUFFLE_REST`, beside `RETURN_BENCHED`, THREE `['’]` slots — two possessives AND the contraction in "didn't") as arm **42-bis** emitting ONE `returnBenchedRest{keep:3}` — a READER move: reader arm 561/1606 → 562/1608, raw residue 79/126 → 78/124, `BUILT.attack` 1657 → 1659; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.421.0 → 0.422.0, `MATCH_RECORD_VERSION` HELD at 30 (a new op MEMBER is D125's WIDENING — and this op PARKS, so the byte IS written into `phase.cont.pendingOp`). ⚠️ THE SENTENCE STEP IS 1 AND THE PRINTING STEP IS 2 — they disagree for the third slice running (D535 1-vs-2, D536 1-vs-3), so a pass that copied one number into the other kind of site would be wrong in half of them. THIS SITE: ⚠️ A FROZEN TAIL A NUMERIC READER CANNOT SEE, STEPPED BY HAND (D426) — 1606 → 1608.)  // (🆕🆕🆕 **D536 +3 printings — THE BODY THAT LEAVES PLAY WITHOUT BEING KNOCKED OUT** — `censusAttackCorpus.ts` **FILE LINE 100** (`legalAttackCorpus()` index 47), *"Discard a Team Rocket's Energy from this Pokémon. If you do, discard your opponent's Active Pokémon and all attached cards."*, **1 sentence / 3 legal printings** (Moltres ex `sv10-031`/`-208`/`-229`), claimed by `deriveAttackEffect` through arm 44c over ONE new FIELD-FREE `EffectOp` member `discardDefender` — a READER move: reader arm 560/1603 → 561/1606, raw residue 80/129 → 79/126, `BUILT.attack` 1654 → 1657; engine 0.420.0 → 0.421.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ **THIS IS A PRINTING-SIDE TERM, SO IT CARRIES `+ 3` WHERE THE SENTENCE-SIDE TERM ABOVE CARRIES `+ 1`** — the two steps DISAGREE, harder than D535's 1-vs-2. THIS SITE: 1603 → 1606.)  // (🆕🆕🆕 **D535 +1 sentence / +2 printings — THE PICK-WITH-REPLACEMENT SNIPE — ZERO NEW VOCABULARY: SIX `damageChosen` OPS AT `count: 1`, THE LITERAL `CHOSEN_ANY_TARGET` ALREADY AUTHORS** — `censusAttackCorpus.ts` **FILE LINE 81** (`legalAttackCorpus()` index 28), *"Choose 1 of your opponent's Pokémon 6 times. (You can choose the same Pokémon more than once.) For each time you chose a Pokémon, do 20 damage to it. This damage isn't affected by Weakness or Resistance."*, **1 sentence / 2 legal printings** (card ids UNRESOLVED on this checkout — no D1, no catalog sqlite — stated unresolved, never invented, D425), claimed by `deriveAttackEffect` through ONE new TWO-capture anchor (`ATTACK_PICK_WITH_REPLACEMENT_SNIPE`, beside `CHOSEN_ANY_TARGET`) as SIX `damageChosen{target:"opponentAny", amount:20, count:1, source:"attack", deals, ignoreWR}` parks — a READER move: reader arm 559/1601 → 560/1603, raw residue 81/131 → 80/129; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.419.0 → 0.420.0, `MATCH_RECORD_VERSION` HELD at 30 (D237's POPULATION change — the op literal already ships, so the serialized alphabet does not grow). ⚠️ THE SENTENCE STEP AND THE PRINTING STEP DISAGREE AT 1 AND 2 — the legal column prints this sentence TWICE.)  // (🆕🆕🆕 **D534 +1 sentence / +1 printing — THE ONE-CARD LOOK AT THE OPPONENT's DECK WITH A PRINTED SHUFFLE — `shuffleDeck` GAINS THE OPTIONAL KEY `whose: "opponent"` and `reorderTop` PARKS A ONE-CARD WINDOW WHEN ITS TWO ARMS DIFFER** — `censusAttackCorpus.ts` **FILE LINE 401**, *"Look at the top card of your opponent's deck. You may have your opponent shuffle their deck."*, **1 sentence / 1 legal printing** (Inkay `sv06.5-033`; no id on this checkout, D425), claimed by `deriveAttackEffect` through ONE new zero-capture anchor (`ATTACK_OPPONENT_TOP_LOOK_SHUFFLE`, beside `ATTACK_REORDER_TOP`) as `reorderTop{n:1, side:"opponent", otherwise:[shuffleDeck{whose:"opponent"}]}` — a READER move: reader arm 558/1600 → 559/1601, raw residue 82/132 → 81/131; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.418.0 → 0.419.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1.)  // (🆕🆕🆕 **D532 +1 printing — THE CROSS-SEAT DISCARD-PILE ATTACH — `attachEnergyFrom` GAINS THE OPTIONAL KEY `whose: "opponent"` (on the op AND on `AttachTargetRiders`, read through ONE resolver)** — `censusAttackCorpus.ts` **FILE LINE 70** (`legalAttackCorpus()` index 17), *"Attach up to 3 Energy cards from your opponent's discard pile to their Pokémon in any way you like."*, **1 sentence / 1 legal printing** (Grafaiai `sv08-121`; no id on this checkout, D425), claimed by `deriveAttackEffect` through ONE new zero-capture anchor (`ATTACK_OPPONENT_DISCARD_ATTACH`, beside the factory-built `DISCARD_ATTACH`) as D360's spread ONE KEY OVER — a READER move: reader arm 557/1599 → 558/1600, raw residue 83/133 → 82/132; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.417.0 → 0.418.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1.)  // (🆕🆕🆕 **D531 +1 printing — THE BOARD-TYPED HAND SEARCH — `searchDeck` GAINS THE PARK-TIME RIDER `typedAsAttachedBasicEnergy`** — `censusAttackCorpus.ts` **FILE LINE 483** (`legalAttackCorpus()` index 430), *"Search your deck for up to 5 Pokémon that are the same type as any Basic Energy attached to this Pokémon, reveal them, and put them into your hand. Then, shuffle your deck."*, **1 sentence / 1 legal printing** (sv07-065 per the retired D231 deferral; no id on this checkout, D425), claimed by `deriveAttackEffect` through ONE new zero-capture anchor (`ATTACK_HAND_SEARCH_TYPED_AS_ATTACHED`, beside `ATTACK_HAND_SEARCH_BENCH_COUNT`) whose rider the park resolves against the SOURCE body's attached Basic Energy — a READER move: reader arm 556/1598 → 557/1599, raw residue 84/134 → 83/133; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.416.0 → 0.417.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1.)  // (🆕🆕🆕 **D530 +1 printing — THE TARGET-COUNTER-SCALED BENCH SNIPE — A FOURTH `damageChosen` RIDER, `perDamageCounterOnTarget`, READ PER REF AT THE ANSWER** — `censusAttackCorpus.ts` **FILE LINE 551** (`legalAttackCorpus()` index 498), *"This attack does 20 damage to 1 of your opponent's Benched Pokémon for each damage counter on that Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)"*, **1 sentence / 1 legal printing** (no id on this checkout, D425), claimed by `deriveAttackEffect` through ONE new anchor (`BENCHED_SNIPE_TARGET_COUNTERS`, beside `BENCHED_SNIPE_TAKEN_PRIZES`, disjoint by TAIL) as arm 6b′ — a READER move: reader arm 555/1597 → 556/1598, raw residue 85/135 → 84/134; registry 10/16, gate 6/14, trailing 11/21 and `SPLIT_ATTACK_UNITS` 14 UNMOVED; engine 0.415.0 → 0.416.0, `MATCH_RECORD_VERSION` HELD at 30. ⚠️ THE SENTENCE STEP AND THE PRINTING STEP AGREE AT 1 AND 1.)
    expect([all.length, units(all)]).toEqual([640, 1732]);
  });

  it("🛑 the move is READER-keyed: no gate clause, no trailing split, no cancel split, no requirement split claims the row itself", () => {
    expect(splitAttackGateClause(PRINTED)).toBeNull();
    expect(splitAttackTrailingClause(PRINTED)).toBeNull();
    expect(splitAttackCancelClause(PRINTED)).toBeNull();
    expect(splitAttackRequirementClause(PRINTED)).toBeNull();
  });

  it("engineVersion and `manifest.version` agree, and the bump is owed for BEHAVIOUR", () => {
    // ⚠️ The version is NOT spelled in this `it(…)` title (D460's fourth class).
    expect(engineVersion).toBe("0.454.0");
    expect(manifest.version).toBe(engineVersion);
  });

  it("🛑 the changelog heading for this bump is present in `index.ts`, labelled with its decision; the anchor and the arm's op literal are byte for byte what this suite drove; the prose is corrected IN PLACE (D178/D442) and the fold is UNTOUCHED", () => {
    const index = Object.entries(RAW).find(([k]) => k.endsWith("/index.ts"))?.[1] ?? "";
    expect(index.length).toBeGreaterThan(1_000_000);
    expect(index).toContain("engineVersion 0.414.0 → **0.415.0** (D528");
    expect(index).toContain("D528 — THE ATTACH TWIN IS BUILT (0.415.0)");
    const effects = Object.entries(RAW).find(([k]) => k.endsWith("/effects.ts"))?.[1] ?? "";
    expect(effects).toContain(
      "const ATTACK_COIN_ATTACH_UP_TO_HEADS =\n  /^Flip (\\d+) coins\\. Attach a number of Basic \\{([A-Z])\\} Energy cards up to the number of heads from your discard pile to your Benched Pokémon in any way you like\\.$/;",
    );
    expect(effects).toContain(
      '      ops: [{ op: "attachEnergyFrom", source: "discard", energyType: attachType, benchOnly: true, declinable: true }],',
    );
    expect(effects).toContain("D528 — THE ATTACH TWIN IS BUILT, ON ITS OWN ANCHOR BELOW");
    expect(effects).toContain('D528 — THE "Attach" TWIN IS BUILT TOO');
    // NO new member: the union still has D526's nine kinds and this slice added none.
    expect(effects).not.toContain('kind: "attachUpToHeads"');
    // The fold is the SHIPPED `programPerHeads` expansion — no D528 bytes in `attack.ts`.
    const attack = Object.entries(RAW).find(([k]) => k.endsWith("/attack.ts"))?.[1] ?? "";
    expect(attack).toContain("for (let i = 0; i < onPrintedFace; i += 1) repeated.push(...coinFlip.ops);");
    expect(attack).not.toContain("D528");
  });
});
