import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import manifest from "../package.json" with { type: "json" };
import { programPlayable } from "./cardplay";
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import * as effects from "./effects";
import {
  ENERGY_TYPE_BY_CODE,
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
import type { EffectOp } from "./effects";
import { applyAction, engineVersion } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import type { EffectContext, EffectContinuation, EffectPrompt, PokemonRef } from "./interpreter";
import { attachEnergyTargets, attachSeat, runProgram } from "./interpreter";
import { logFromEvents } from "./log";
import { redactGame } from "./redact";
import {
  FIXTURE_POOL,
  activeUid,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  discardFromDeck,
  mustApply,
  setActiveFromDeck,
  types,
  driveSetup,
} from "./testFixtures";

const PRINTED =
  "Attach up to 3 Energy cards from your opponent's discard pile to their Pokémon in any way you like.";
const TWIN =
  "Attach up to 3 Energy cards from your discard pile to your Pokémon in any way you like.";
const OWN_SPREAD =
  "Attach up to 3 Basic Energy cards from your discard pile to your Pokémon in any way you like.";

/** THE PROGRAM, spelled once — three ops, five keys each. */
const ONE_OP = {
  op: "attachEnergyFrom",
  source: "discard",
  anyEnergy: true,
  declinable: true,
  whose: "opponent",
} as const satisfies EffectOp;
const PROGRAM: readonly EffectOp[] = [ONE_OP, ONE_OP, ONE_OP];
const OWN_SPREAD_PROGRAM: readonly EffectOp[] = Array.from({ length: 3 }, () => ({
  op: "attachEnergyFrom",
  source: "discard",
  declinable: true,
}));
/** A v30-legal FLAGLESS op: `PROGRAM[0]` with `whose` dropped — the own pile, the own board. */
const V30_OP: EffectOp = {
  op: "attachEnergyFrom",
  source: "discard",
  anyEnergy: true,
  declinable: true,
};

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
  deriveAttackCopy,
  deriveAttackRequirement,
];
const SPLITTERS = [
  splitAttackCancelClause,
  splitAttackGateClause,
  splitAttackRequirementClause,
  splitAttackTrailingClause,
];

function readersClaiming(text: string): string[] {
  return attackReaderSurface().filter((name) => {
    const read = (effects as unknown as Record<string, (t: string) => unknown>)[name];
    if (read === undefined) throw new Error(`no reader ${name}`);
    return read(text) !== null;
  });
}

const units = (rows: readonly (readonly [number, string])[]) => rows.reduce((s, [n]) => s + n, 0);
const claims = (re: RegExp): readonly [number, number, readonly string[]] => {
  const rows = legalAttackCorpus().filter(([, s]) => re.test(s));
  return [rows.length, units(rows), rows.map(([, s]) => s)];
};

const CODES = Object.keys(ENERGY_TYPE_BY_CODE).join("");
const SOURCE_ZONE = " from your discard pile";
const CLAUSE =
  `(?:(an) Energy card|a Basic (?:\\{([${CODES}])\\} )?Energy card` +
  `|up to (\\d+) Basic (?:\\{([${CODES}])\\} )?Energy cards)` +
  `${SOURCE_ZONE} to ([^.]+)\\.`;
const SIBLING = new RegExp(`^Attach ${CLAUSE}$`);

const BASE = 30;
const GRAFAIAI = "d532-grafaiai";
/** The defender — 400 HP so nothing here Knocks it Out. */
const WALL = "d532-wall";
/** The opponent's Bench bodies (and, in (viii), the attacker's own). */
const BENCHER = "d532-bencher";
/** `FIXTURE_POOL`'s Basics (Colorless, {R}, {W}) and its unauthored Special. */
const C_ENERGY = "fix-energy";
const R_ENERGY = "fix-fire-energy";
const W_ENERGY = "fix-water-energy";
const SPECIAL = "fix-special";
const ITEM = "fix-item";

const ATTACH_CARDS: Record<string, Card> = {
  [GRAFAIAI]: battler(GRAFAIAI, {
    name: "D532 Grafaiai",
    types: ["Darkness"],
    hp: 120,
    retreat: 1,
    attacks: [
      /** index 0 — FILE LINE 70 verbatim, with a DECLARED base and cost. */
      { cost: ["Colorless"], name: "Borrowed Charge", damage: BASE, effect: PRINTED },
      /** index 1 — the DARK twin: the own-seat bare plural, no reader claims it (the LOUD control). */
      { cost: ["Colorless"], name: "Own Charge", damage: BASE, effect: TWIN },
      /** index 2 — no effect, no program. */
      { cost: ["Colorless"], name: "Jab", damage: BASE },
    ],
  }),
  [WALL]: battler(WALL, { name: "D532 Wall", types: ["Colorless"], hp: 400 }),
  [BENCHER]: battler(BENCHER, { name: "D532 Bencher", types: ["Colorless"], hp: 100 }),
};

const ATTACH_POOL: Record<string, Card> = { ...FIXTURE_POOL, ...ATTACH_CARDS };

const ATTACH_DECK = deckOf({
  [GRAFAIAI]: 4,
  [WALL]: 4,
  [BENCHER]: 8,
  [ITEM]: 6,
  [C_ENERGY]: 14,
  [R_ENERGY]: 8,
  [W_ENERGY]: 8,
  [SPECIAL]: 8,
});

const SEED = 7;

function openTable(seed: number): GameState {
  const state = driveSetup(
    seed,
    { p1: ATTACH_DECK, p2: ATTACH_DECK },
    { pool: ATTACH_POOL, first: "p2" },
  );
  // `p2` opens and passes, so `p1` attacks on a turn that carries no first-turn lock.
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

const other = (seat: Seat): Seat => (seat === "p1" ? "p2" : "p1");
const SEATS = ["p1", "p2"] as const;

type Board = {
  readonly attacker?: Seat;
  /** The OPPONENT's discard pile, in pile order. Default two {R} Basics, the Special, an Item. */
  readonly opponentPile?: readonly string[];
  /** The ATTACKER's own discard pile — the pile that must NEVER be read. Default two {W} Basics. */
  readonly ownPile?: readonly string[];
  /** How many Bench bodies the opponent fields. Default 2. */
  readonly opponentBench?: number;
  /** How many Bench bodies the attacker fields — never candidates. Default 0. */
  readonly ownBench?: number;
};

/** The attacker's Active is the demonstrator holding one {C} Basic (pays the cost); the defender's
    Active is the wall; both Benches CLEARED after the Active surgeries, then re-seeded; both piles
    seeded by surgery off the decks. */
function table(board: Board = {}): GameState {
  const attacker = board.attacker ?? "p1";
  const defender = other(attacker);
  let state = openTable(SEED);
  state = setActiveFromDeck(state, attacker, GRAFAIAI);
  state = attachFromDeck(state, attacker, C_ENERGY, 1);
  state = clearBench(state, attacker);
  state = setActiveFromDeck(state, defender, WALL);
  state = clearBench(state, defender);
  for (let i = 0; i < (board.opponentBench ?? 2); i++)
    state = benchFromDeck(state, defender, BENCHER);
  for (let i = 0; i < (board.ownBench ?? 0); i++) state = benchFromDeck(state, attacker, BENCHER);
  for (const id of board.opponentPile ?? [R_ENERGY, R_ENERGY, SPECIAL, ITEM]) {
    state = discardFromDeck(state, defender, id, 1);
  }
  for (const id of board.ownPile ?? [W_ENERGY, W_ENERGY])
    state = discardFromDeck(state, attacker, id, 1);
  if (attacker === "p2") state = mustApply(state, { type: "endTurn", seat: "p1" }).state;
  return state;
}

type Swing = { before: GameState; after: GameState; events: GameEvent[] };

function swing(board: Board = {}, index = 0): Swing {
  const before = table(board);
  const seat = board.attacker ?? "p1";
  const { state: after, events } = mustApply(before, { type: "attack", seat, index });
  return { before, after, events };
}

function pokemonPrompt(state: GameState): Extract<EffectPrompt, { kind: "choosePokemon" }> {
  if (state.phase.kind !== "effect:choose")
    throw new Error(`expected a park, got ${state.phase.kind}`);
  if (state.phase.prompt.kind !== "choosePokemon") {
    throw new Error(`expected choosePokemon, got ${state.phase.prompt.kind}`);
  }
  return state.phase.prompt;
}

function continuation(state: GameState): EffectContinuation {
  if (state.phase.kind !== "effect:choose") throw new Error("expected a park");
  return state.phase.cont;
}

/** The attacker's own `EffectContext` — read off a REAL park rather than hand-spelled. */
function attackCtx(state: GameState, seat: Seat = "p1"): EffectContext {
  return continuation(mustApply(state, { type: "attack", seat, index: 0 }).state).ctx;
}

/** Card ids of a uid list, in order. */
const ids = (state: GameState, uids: readonly string[]): string[] =>
  uids.map((uid) => state.cardIdByUid[uid] ?? "?");
/** The refs `attachEnergyTargets` must offer: Active first, then the bench in index order. */
const boardRefs = (state: GameState, seat: Seat): PokemonRef[] => [
  ...(state.players[seat].active === null ? [] : [{ seat, spot: { spot: "active" as const } }]),
  ...state.players[seat].bench.map((_, index) => ({
    seat,
    spot: { spot: "bench" as const, index },
  })),
];

/** Answer a parked choosePokemon — with a ref, or DECLINE (no ref). */
const pick = (state: GameState, seat: Seat, ref?: PokemonRef) =>
  mustApply(state, {
    type: "resolveEffect",
    seat,
    choice: ref === undefined ? { kind: "pokemon" } : { kind: "pokemon", ref },
  });

function cardPrompt(state: GameState): Extract<EffectPrompt, { kind: "chooseCards" }> {
  if (state.phase.kind !== "effect:choose")
    throw new Error(`expected a park, got ${state.phase.kind}`);
  if (state.phase.prompt.kind !== "chooseCards")
    throw new Error(`expected chooseCards, got ${state.phase.prompt.kind}`);
  return state.phase.prompt;
}
const pickCard = (state: GameState, seat: Seat, uid: string) =>
  mustApply(state, { type: "resolveEffect", seat, choice: { kind: "cards", uids: [uid] } });

const NAMES = { p1: "P1", p2: "P2" } as const;
const rows = (events: readonly GameEvent[], state: GameState): string[] =>
  logFromEvents(events, { names: NAMES, state, elapsed: "+00:09" }).map((entry) =>
    entry.kind === "turn" ? `— turn ${entry.turn} —` : entry.segments.map((s) => s.text).join(""),
  );

function attachedRows(events: readonly GameEvent[]) {
  return events.filter(
    (e): e is Extract<GameEvent, { type: "ENERGY_ATTACHED" }> => e.type === "ENERGY_ATTACHED",
  );
}
function dealtRows(events: readonly GameEvent[]) {
  return events.filter(
    (e): e is Extract<GameEvent, { type: "DAMAGE_DEALT" }> => e.type === "DAMAGE_DEALT",
  );
}

const CAPTION = "Attach the Energy to which of your opponent's Pokémon?";
const OWN_CAPTION = "Attach the Energy to which of your Pokémon?";

describe('D532 §1 — file line 70 derives to EXACTLY three `attachEnergyFrom { discard, anyEnergy, declinable, whose: "opponent" }` ops', () => {
  it("the row derives to the program — THREE ops, FIVE keys each, `count` ABSENT, the key set pinned (`D532-arm-drops-whose` / `-arm-drops-anyEnergy`)", () => {
    expect(deriveAttackEffect(PRINTED)).toEqual(PROGRAM);
    const got = deriveAttackEffect(PRINTED);
    if (got === null) throw new Error("the row derived null");
    expect(got).toHaveLength(3);
    for (const op of got) {
      if (op.op !== "attachEnergyFrom") throw new Error("not an attachEnergyFrom");
      expect(Object.keys(op).sort()).toEqual(["anyEnergy", "declinable", "op", "source", "whose"]);
      expect(op.whose).toBe("opponent");
      expect(op.anyEnergy).toBe(true);
      expect(op.declinable).toBe(true);
      expect(op.source).toBe("discard");
      expect("count" in op).toBe(false);
      expect("toSelf" in op).toBe(false);
      expect("toEach" in op).toBe(false);
      expect("energyType" in op).toBe(false);
      expect("energyName" in op).toBe(false);
      expect("bonusCounters" in op).toBe(false);
      expect("healTarget" in op).toBe(false);
      expect("recordAs" in op).toBe(false);
    }
    expect(got[0]).not.toBe(got[1]);
    expect(deriveAttackEffect(OWN_SPREAD)).toEqual(OWN_SPREAD_PROGRAM);
    expect(deriveAttackEffect(PRINTED)).not.toEqual(deriveAttackEffect(OWN_SPREAD));
    expect(got.map((op) => ({ ...op, whose: undefined, anyEnergy: undefined }))).toEqual(
      OWN_SPREAD_PROGRAM.map((op) => ({ ...op, whose: undefined, anyEnergy: undefined })),
    );
  });

  it("`deriveAttackEffect` is the ONLY claimant — `readersClaiming` is exactly [deriveAttackEffect], twelve readers and four splitters null — and the surface is still THIRTEEN", () => {
    expect(readersClaiming(PRINTED)).toEqual(["deriveAttackEffect"]);
    for (const reader of READERS) {
      if (reader === deriveAttackEffect) continue;
      expect(reader(PRINTED), reader.name).toBeNull();
    }
    for (const splitter of SPLITTERS) expect(splitter(PRINTED), splitter.name).toBeNull();
    expect(resolvedByAnyReader(PRINTED)).toBe(true);
    expect(attackReaderSurface()).toHaveLength(14);
    expect(READERS.map((read) => read.name).sort()).toEqual(attackReaderSurface());
  });

  it('the anchor is WHOLE-SENTENCE at the HEAD: a PREFIXED print is null on every reader — and the TRAILING splitter COMPOSES `{head: "Draw a card.", tail: row}` because BOTH halves are now claimed (measured; D531\'s two-sentence row did not compose) while the census still reads the compound as unresolved (`D532-anchor-loses-the-head`)', () => {
    const prefixed = `Draw a card. ${PRINTED}`;
    expect(legalAttackCorpus().some(([, s]) => s === prefixed)).toBe(false);
    for (const reader of READERS) expect(reader(prefixed), reader.name).toBeNull();
    expect(splitAttackCancelClause(prefixed)).toBeNull();
    expect(splitAttackGateClause(prefixed)).toBeNull();
    expect(splitAttackRequirementClause(prefixed)).toBeNull();
    expect(splitAttackTrailingClause(prefixed)).toEqual({ head: "Draw a card.", tail: PRINTED });
    expect(resolvedByAnyReader(prefixed)).toBe(false);
  });

  it("…and at the TAIL: a SUFFIXED print is null on every reader, and the TRAILING splitter COMPOSES `{head: row, tail}` because the head is now claimed (D526 (5); `D532-anchor-loses-the-tail`)", () => {
    const suffixed = `${PRINTED} Draw a card.`;
    expect(legalAttackCorpus().some(([, s]) => s === suffixed)).toBe(false);
    for (const reader of READERS) expect(reader(suffixed), reader.name).toBeNull();
    expect(resolvedByAnyReader(suffixed)).toBe(false);
    expect(splitAttackCancelClause(suffixed)).toBeNull();
    expect(splitAttackGateClause(suffixed)).toBeNull();
    expect(splitAttackRequirementClause(suffixed)).toBeNull();
    expect(splitAttackTrailingClause(suffixed)).toEqual({ head: PRINTED, tail: "Draw a card." });
  });

  it("one-axis near-misses, all null on EVERY reader — `Basic Energy cards`, the OWN pile to THEIR Pokémon, THEIR pile to YOUR Pokémon, `up to 2`, no `up to`, a lowercase head, no final period — and the OWN-SEAT BARE-PLURAL TWIN, which stays DARK (D489's second axis)", () => {
    const controls: Record<string, string> = {
      "`Basic Energy cards` for `Energy cards` — the bare plural is the literal (and `anyEnergy` is its reading)":
        "Attach up to 3 Basic Energy cards from your opponent's discard pile to their Pokémon in any way you like.",
      "`your discard pile` with `their Pokémon` — the two seat words move TOGETHER or not at all":
        "Attach up to 3 Energy cards from your discard pile to their Pokémon in any way you like.",
      "`your opponent's discard pile` with `your Pokémon` — the cross no card prints":
        "Attach up to 3 Energy cards from your opponent's discard pile to your Pokémon in any way you like.",
      "`up to 2` for `up to 3` — the count is a LITERAL, not a capture (D121: a pool of one)":
        "Attach up to 2 Energy cards from your opponent's discard pile to their Pokémon in any way you like.",
      "no `up to` — the hedge is printed":
        "Attach 3 Energy cards from your opponent's discard pile to their Pokémon in any way you like.",
      "a lowercase head — no /i on the anchor":
        "attach up to 3 Energy cards from your opponent's discard pile to their Pokémon in any way you like.",
      "the final period missing — `\\.$` is the anchor's tail":
        "Attach up to 3 Energy cards from your opponent's discard pile to their Pokémon in any way you like",
      "🛑 THE OWN-SEAT BARE-PLURAL TWIN — DARK: the factory clause spells `(an) Energy card` and `up to N Basic … Energy cards`, never a bare plural, and this slice widened neither":
        TWIN,
    };
    for (const [why, s] of Object.entries(controls)) {
      expect(s, why).not.toBe(PRINTED);
      for (const reader of READERS) expect(reader(s), `${why} — ${reader.name}`).toBeNull();
      expect(readersClaiming(s), why).toEqual([]);
      expect(resolvedByAnyReader(s), why).toBe(false);
      expect(
        legalAttackCorpus().some(([, t]) => t === s),
        why,
      ).toBe(false);
    }
    const curly = PRINTED.replace("'", "’");
    expect(curly).not.toBe(PRINTED);
    expect(deriveAttackEffect(curly)).toEqual(PROGRAM);
    expect(legalAttackCorpus().some(([, t]) => t === curly)).toBe(false);
  });

  it("THE READING RUNG: the SIBLING `DISCARD_ATTACH` (rebuilt from the factory's three segments) REFUSES the row — its zone phrase is not a substring of the print — REFUSES the bare-plural twin (the article weld) and ADMITS the D360 spread; so the row derives on its OWN anchor (keeps derivedDiscardAttach's D418 discrimination)", () => {
    expect(SIBLING.exec(PRINTED)).toBeNull();
    expect(PRINTED.includes(" from your discard pile")).toBe(false);
    expect(PRINTED.includes(" from your opponent's discard pile")).toBe(true);
    expect(SIBLING.exec(TWIN)).toBeNull();
    const m = SIBLING.exec(OWN_SPREAD);
    if (m === null) throw new Error("the sibling anchor does not admit the D360 spread");
    expect(m[3]).toBe("3");
    expect(m[5]).toBe("your Pokémon in any way you like");
    expect(m[1]).toBeUndefined();
    expect(deriveAttackEffect(OWN_SPREAD)).toEqual(OWN_SPREAD_PROGRAM);
    const landorus = "Attach an Energy card from your discard pile to this Pokémon.";
    expect(SIBLING.exec(landorus)?.[1]).toBe("an");
    expect(deriveAttackEffect(landorus)).toEqual([
      { op: "attachEnergyFrom", source: "discard", anyEnergy: true, toSelf: true },
    ]);
  });

  it("the anchor's claimed set over all 640 rows is EXACTLY {file line 70} — 1 sentence / 1 printing; `whose: \"opponent\"` rides ONE derived attack row in the column; the `LIKE '%from your opponent''s discard pile to their%'` census is ONE row", () => {
    const [n, u, claimed] = claims(
      /^Attach up to 3 Energy cards from your opponent['’]s discard pile to their Pokémon in any way you like\.$/,
    );
    expect([n, u]).toEqual([1, 1]);
    expect(claimed).toEqual([PRINTED]);
    const all = legalAttackCorpus();
    expect(all).toHaveLength(640);
    const withWhose = all.filter(([, s]) =>
      (deriveAttackEffect(s) ?? []).some(
        (op) => (op as { whose?: unknown }).whose === "opponent" && op.op === "attachEnergyFrom",
      ),
    );
    expect(withWhose).toEqual([[1, PRINTED]]);
    expect(
      all
        .filter(([, s]) => s.includes("from your opponent's discard pile to their"))
        .map(([, s]) => s),
    ).toEqual([PRINTED]);
    expect(all.some(([, s]) => s === TWIN)).toBe(false);
    expect(all.some(([, s]) => s === OWN_SPREAD)).toBe(false);
    const morpeko =
      "Attach up to 2 Basic Energy cards from your discard pile to your Pokémon in any way you like.";
    expect(all.filter(([, s]) => s === morpeko)).toEqual([[1, morpeko]]);
    expect(deriveAttackEffect(morpeko)).toEqual(OWN_SPREAD_PROGRAM.slice(0, 2));
  });

  it("the fixture pool is FILE-LOCAL — zero `FIXTURE_POOL` ids, the deck is 60, sv08-121 is unresolvable here, and the Energy fixtures are what their names say", () => {
    expect(Object.keys(ATTACH_CARDS).every((id) => FIXTURE_POOL[id] === undefined)).toBe(true);
    expect(ATTACH_DECK).toHaveLength(60);
    expect(FIXTURE_POOL["sv08-121"]).toBeUndefined();
    expect(ATTACH_CARDS[GRAFAIAI]?.attacks?.[0]?.effect).toBe(PRINTED);
    expect(ATTACH_CARDS[GRAFAIAI]?.attacks?.[1]?.effect).toBe(TWIN);
    expect(ATTACH_CARDS[GRAFAIAI]?.attacks?.[2]?.effect).toBeUndefined();
    for (const id of [C_ENERGY, R_ENERGY, W_ENERGY])
      expect(FIXTURE_POOL[id]?.energyType, id).toBe("Normal");
    expect(FIXTURE_POOL[SPECIAL]?.energyType).toBe("Special");
    expect(FIXTURE_POOL[ITEM]?.category).toBe("Trainer");
  });
});

describe("D532 §2 — the census moved in exactly ONE summand, by 1 sentence / 1 printing", () => {
  it("the reader arm reads 558 sentences / 1,600 printings, and the row is IN it", () => {
    const resolved = legalAttackCorpus().filter(([, s]) => resolvedByAnyReader(s));
    expect([resolved.length, units(resolved)]).toEqual([600, 1663]);
    expect(resolved.map(([, s]) => s)).toContain(PRINTED);
    const without = resolved.filter(([, s]) => s !== PRINTED);
    expect([without.length, units(without)]).toEqual([599, 1662]);
  });

  it("the RAW reader-only residue fell by exactly 1 sentence / 1 printing — 82 / 132 — and the row left it", () => {
    const unbuilt = legalAttackCorpus().filter(([, s]) => !resolvedByAnyReader(s));
    expect([unbuilt.length, units(unbuilt)]).toEqual([40, 69]);
    expect(unbuilt.map(([, s]) => s)).not.toContain(PRINTED);
    const all = legalAttackCorpus();
    expect(unbuilt.length + 600).toBe(all.length);
    expect(units(unbuilt) + 1663).toBe(units(all));
    expect([all.length, units(all)]).toEqual([640, 1732]);
  });

  it("the move is READER-keyed: no gate clause, no trailing split, no cancel split, no requirement split claims the row itself", () => {
    expect(splitAttackGateClause(PRINTED)).toBeNull();
    expect(splitAttackTrailingClause(PRINTED)).toBeNull();
    expect(splitAttackCancelClause(PRINTED)).toBeNull();
    expect(splitAttackRequirementClause(PRINTED)).toBeNull();
  });
});

describe("D532 §3 — a new optional key on a PERSISTED op, and the record version does not move", () => {
  it("the version PREDICTION, driven over the SERIALIZED BYTES in three directions", () => {
    const preSlice = [
      '{"op":"attachEnergyFrom","source":"discard","declinable":true}',
      '{"op":"attachEnergyFrom","source":"discard","anyEnergy":true,"toSelf":true}',
    ];
    for (const bytes of preSlice) {
      const revived = JSON.parse(bytes) as EffectOp;
      expect(JSON.stringify(revived)).toBe(bytes);
    }
    expect(deriveAttackEffect(OWN_SPREAD)?.[0]).toEqual(JSON.parse(preSlice[0] as string));
    expect(
      deriveAttackEffect("Attach an Energy card from your discard pile to this Pokémon.")?.[0],
    ).toEqual(JSON.parse(preSlice[1] as string));
    // DIRECTION 2 — the NEW value cannot appear in any record an older deploy wrote, and this deploy
    // round-trips it byte for byte.
    const fresh = deriveAttackEffect(PRINTED)?.[0];
    expect(JSON.stringify(fresh)).toBe(
      '{"op":"attachEnergyFrom","source":"discard","anyEnergy":true,"declinable":true,"whose":"opponent"}',
    );
    expect(JSON.parse(JSON.stringify(fresh))).toEqual(fresh);
    const dropped = JSON.parse(
      JSON.stringify(fresh, (k, v) => (k === "whose" ? undefined : v)),
    ) as EffectOp;
    expect(dropped).toEqual(V30_OP);
    expect(dropped).not.toEqual(fresh);
  });

  it("a v30 FLAGLESS parked op reads back OWN-seat candidates under the OWN caption and its answer drains the OWN pile; the fresh op parks the OPPONENT's refs and drains THEIRS — the LOSS direction ON THE BOARD (`D532-arm-drops-whose` / `-resolver-ignores-whose`)", () => {
    const board = table();
    const ctx = attackCtx(board);
    const v30 = runProgram(board, [V30_OP], ctx, []);
    const fresh = runProgram(board, [ONE_OP], ctx, []);
    if (v30.kind !== "parked" || v30.prompt.kind !== "choosePokemon")
      throw new Error("the v30 op did not park");
    if (fresh.kind !== "parked" || fresh.prompt.kind !== "choosePokemon")
      throw new Error("the fresh op did not park");
    expect(v30.prompt.candidates).toEqual(boardRefs(board, "p1"));
    expect(v30.prompt.candidates.every((ref) => ref.seat === "p1")).toBe(true);
    expect(v30.prompt.note).toBe(OWN_CAPTION);
    expect(v30.cont.pendingOp).toEqual(V30_OP);
    expect(fresh.prompt.candidates).toEqual(boardRefs(board, "p2"));
    expect(fresh.prompt.candidates.every((ref) => ref.seat === "p2")).toBe(true);
    expect(fresh.prompt.note).toBe(CAPTION);
    // The two offers are DISJOINT — no ref is on both boards.
    for (const ref of v30.prompt.candidates)
      expect(fresh.prompt.candidates).not.toContainEqual(ref);
    // The v30 op's ANSWER (resumed through the real board) drains the OWN pile, not the opponent's.
    const ownParked = mustApply(board, { type: "attack", seat: "p1", index: 0 }).state;
    void ownParked;
    const v30Board = {
      ...board,
      phase: {
        kind: "effect:choose" as const,
        seat: "p1" as const,
        prompt: v30.prompt,
        cont: v30.cont,
      },
    };
    const answered = pick(v30Board as GameState, "p1", { seat: "p1", spot: { spot: "active" } });
    expect(ids(answered.state, answered.state.players.p1.discard)).toEqual([W_ENERGY]);
    expect(ids(answered.state, answered.state.players.p2.discard)).toEqual(
      ids(board, board.players.p2.discard),
    );
    expect(ids(answered.state, answered.state.players.p1.active?.energy ?? [])).toEqual([
      C_ENERGY,
      W_ENERGY,
    ]);
    expect(attachedRows(answered.events)).toEqual([
      {
        type: "ENERGY_ATTACHED",
        seat: "p1",
        uid: board.players.p1.discard[0],
        target: { spot: "active" },
      },
    ]);
  });

  it("the parked `pendingOp`'s key set, sorted, carries `whose` — and the continuation's `rest` is the other two ops", () => {
    const parked = swing().after;
    const cont = continuation(parked);
    expect(Object.keys(cont.pendingOp).sort()).toEqual([
      "anyEnergy",
      "declinable",
      "op",
      "source",
      "whose",
    ]);
    expect(JSON.stringify(cont.pendingOp)).toBe(JSON.stringify(ONE_OP));
    expect(cont.rest).toEqual([ONE_OP, ONE_OP]);
    expect(Object.keys(cont).sort()).toEqual(["ctx", "pendingOp", "rest"]);
    expect(cont.ctx.seat).toBe("p1");
  });
});

describe("D532 §4 — the park offers EXACTLY the opponent's in-play Pokémon, and the answer moves the Energy out of THEIR pile onto THEIR body", () => {
  it("the board is what it says, from both seats: the attacker's demonstrator is Active with one {C} Basic, the defender's wall is Active with two Bench bodies, the defender's pile is [{R}, {R}, Special, Item], the attacker's pile is [{W}, {W}]", () => {
    for (const attacker of SEATS) {
      const defender = other(attacker);
      const before = table({ attacker });
      expect(before.phase).toEqual({ kind: "turn:action", seat: attacker });
      expect(before.turn).toBe(attacker === "p1" ? 2 : 3);
      expect(before.cardIdByUid[activeUid(before, attacker)]).toBe(GRAFAIAI);
      expect(ids(before, before.players[attacker].active?.energy ?? [])).toEqual([C_ENERGY]);
      expect(before.cardIdByUid[activeUid(before, defender)]).toBe(WALL);
      expect(
        before.players[defender].bench.map((p) => before.cardIdByUid[p.stack[0] ?? ""]),
      ).toEqual([BENCHER, BENCHER]);
      expect(before.players[attacker].bench).toHaveLength(0);
      expect(ids(before, before.players[defender].discard)).toEqual([
        R_ENERGY,
        R_ENERGY,
        SPECIAL,
        ITEM,
      ]);
      expect(ids(before, before.players[attacker].discard)).toEqual([W_ENERGY, W_ENERGY]);
    }
  });

  it("(i) ONE park from EITHER seat: `choosePokemon { upTo 1 }` over EXACTLY the OPPONENT's refs in Active-then-bench order, every ref carrying the OPPONENT's seat, the caption pinned byte for byte, the base already dealt, nothing moved, the attacker's own bodies NOT offered (`D532-arm-drops-whose` / `-targets-ignore-whose` / `-caption-drops-opponents`)", () => {
    for (const attacker of SEATS) {
      const defender = other(attacker);
      const { before, after, events } = swing({ attacker });
      expect(after.phase.kind).toBe("effect:choose");
      expect(after.phase.kind === "effect:choose" && after.phase.seat).toBe(attacker);
      const prompt = pokemonPrompt(after);
      expect(prompt.candidates).toEqual(boardRefs(before, defender));
      expect(prompt.candidates).toHaveLength(3);
      expect(prompt.candidates.every((ref) => ref.seat === defender)).toBe(true);
      expect(prompt.candidates).not.toContainEqual({ seat: attacker, spot: { spot: "active" } });
      expect(prompt.upTo).toBe(1);
      expect(prompt.note).toBe(CAPTION);
      expect(prompt.note).toContain("your opponent's");
      expect("decider" in after.phase).toBe(false);
      expect(dealtRows(events)).toHaveLength(1);
      expect(dealtRows(events)[0]).toMatchObject({
        seat: defender,
        by: attacker,
        uid: activeUid(before, defender),
        dealt: BASE,
      });
      expect(types(events)).toEqual(["ATTACK_DECLARED", "DAMAGE_DEALT", "EFFECT_PENDING"]);
      expect(attachedRows(events)).toHaveLength(0);
      expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
      // Nothing moved at the park — both piles, both boards.
      expect(after.players[defender].discard).toEqual(before.players[defender].discard);
      expect(after.players[attacker].discard).toEqual(before.players[attacker].discard);
      expect(after.players[defender].active?.energy).toEqual([]);
      expect(continuation(after).pendingOp).toEqual(ONE_OP);
    }
  });

  it("(ii) THREE sequential parks, from EITHER seat: ~~each answer moves the FIRST matching uid of the OPPONENT's pile~~ (card revision B01: while the OPPONENT's pile holds unlike Energy the ATTACKER picks the card — {R}, {R}, then the Special, `anyEnergy`) onto the chosen OPPONENT body; `ENERGY_ATTACHED { seat: attacker, uid, target: chosen spot }`; the Item stays; the attacker's own pile UNTOUCHED; the third answer ends the turn", () => {
    for (const attacker of SEATS) {
      const defender = other(attacker);
      const { before, after } = swing({ attacker });
      const pile = [...before.players[defender].discard];
      const refs = pokemonPrompt(after).candidates;
      const [first, second, third] = refs;
      if (first === undefined || second === undefined || third === undefined)
        throw new Error("fewer than three refs");
      const asked = pick(after, attacker, first);
      expect(types(asked.events)).toEqual(["EFFECT_PENDING"]);
      expect(cardPrompt(asked.state)).toMatchObject({
        candidates: pile.slice(0, 3),
        min: 1,
        max: 1,
        dest: "attach",
      });
      expect(asked.state.phase.kind === "effect:choose" && asked.state.phase.answerer).toBeFalsy();
      const a = pickCard(asked.state, attacker, pile[0] as string);
      expect(types(a.events)).toEqual(["ENERGY_ATTACHED", "EFFECT_PENDING"]);
      expect(attachedRows(a.events)).toEqual([
        { type: "ENERGY_ATTACHED", seat: attacker, uid: pile[0], target: { spot: "active" } },
      ]);
      expect(ids(a.state, a.state.players[defender].active?.energy ?? [])).toEqual([R_ENERGY]);
      expect(ids(a.state, a.state.players[defender].discard)).toEqual([R_ENERGY, SPECIAL, ITEM]);
      expect(a.state.players[attacker].discard).toEqual(before.players[attacker].discard);
      expect(pokemonPrompt(a.state).candidates).toEqual(refs); // the offer is re-derived and identical
      // Park 2 → bench 0 (B01: {R} and the Special are still unlike, so the card is asked again).
      const b = pickCard(pick(a.state, attacker, second).state, attacker, pile[1] as string);
      expect(types(b.events)).toEqual(["ENERGY_ATTACHED", "EFFECT_PENDING"]);
      expect(attachedRows(b.events)).toEqual([
        {
          type: "ENERGY_ATTACHED",
          seat: attacker,
          uid: pile[1],
          target: { spot: "bench", index: 0 },
        },
      ]);
      expect(ids(b.state, b.state.players[defender].bench[0]?.energy ?? [])).toEqual([R_ENERGY]);
      // Park 3 → bench 1, the Special (the bare plural is the whole category), the turn ends.
      const c = pick(b.state, attacker, third);
      expect(types(c.events)).toEqual([
        "ENERGY_ATTACHED",
        "TURN_ENDED",
        "TURN_STARTED",
        "CARDS_DRAWN",
      ]);
      expect(attachedRows(c.events)).toEqual([
        {
          type: "ENERGY_ATTACHED",
          seat: attacker,
          uid: pile[2],
          target: { spot: "bench", index: 1 },
        },
      ]);
      expect(ids(c.state, c.state.players[defender].bench[1]?.energy ?? [])).toEqual([SPECIAL]);
      expect(ids(c.state, c.state.players[defender].discard)).toEqual([ITEM]);
      expect(c.state.players[attacker].discard).toEqual(before.players[attacker].discard);
      expect(ids(c.state, c.state.players[attacker].active?.energy ?? [])).toEqual([C_ENERGY]);
      expect(c.state.phase).toEqual({ kind: "turn:action", seat: defender });
      expect(c.state.players[defender].active?.damage).toBe(BASE);
      expect(dealtRows(c.events)).toHaveLength(0);
    }
  });

  it("(iii) the LOG ROW names the OPPONENT's body through the cross-seat fallback — \"attached Fire Energy → D532 Wall\" under the ATTACKER's row (`D532-log-drops-the-other-seat`)", () => {
    for (const attacker of SEATS) {
      const { after } = swing({ attacker });
      const [first] = pokemonPrompt(after).candidates;
      if (first === undefined) throw new Error("no ref");
      const asked = pick(after, attacker, first).state;
      const { state, events } = pickCard(
        asked,
        attacker,
        cardPrompt(asked).candidates[0] as string,
      );
      const entries = logFromEvents(events, { names: NAMES, state, elapsed: "+00:09" });
      const attached = entries.find(
        (e) => e.kind !== "turn" && e.segments.some((s) => s.text === "attached "),
      );
      if (attached === undefined || attached.kind === "turn")
        throw new Error(`no attach row in ${JSON.stringify(entries)}`);
      expect(attached.who).toBe(attacker);
      expect(attached.segments.map((s) => s.text).join("")).toBe(
        "attached Fire Energy → D532 Wall",
      );
      expect(attached.segments.map((s) => s.text).join("")).not.toContain("a Pokémon");
      expect(rows(events, state)).toContain("attached Fire Energy → D532 Wall");
    }
  });

  it("(iv) DECLINE at each park: no `ENERGY_ATTACHED`, nothing moves, the next op parks; three declines end the turn with BOTH piles and BOTH boards as they were", () => {
    for (const attacker of SEATS) {
      const defender = other(attacker);
      const { before, after } = swing({ attacker });
      const d1 = pick(after, attacker);
      expect(types(d1.events)).toEqual(["EFFECT_PENDING"]);
      expect(pokemonPrompt(d1.state).candidates).toEqual(boardRefs(before, defender));
      const d2 = pick(d1.state, attacker);
      expect(types(d2.events)).toEqual(["EFFECT_PENDING"]);
      const d3 = pick(d2.state, attacker);
      expect(types(d3.events)).toEqual(["TURN_ENDED", "TURN_STARTED", "CARDS_DRAWN"]);
      expect(d3.state.players[defender].discard).toEqual(before.players[defender].discard);
      expect(d3.state.players[attacker].discard).toEqual(before.players[attacker].discard);
      expect(d3.state.players[defender].active?.energy).toEqual([]);
      expect(d3.state.phase).toEqual({ kind: "turn:action", seat: defender });
    }
  });

  it("(v) a SPECIAL Energy ALONE in the opponent's pile IS offered (`anyEnergy` — the bare plural is the whole category): the op parks and the answer moves the Special; the same pile under the own-seat `Basic` sibling's op would not (`D532-arm-drops-anyEnergy`)", () => {
    const { before, after } = swing({ opponentPile: [SPECIAL] });
    expect(ids(before, before.players.p2.discard)).toEqual([SPECIAL]);
    const prompt = pokemonPrompt(after);
    expect(prompt.candidates).toEqual(boardRefs(before, "p2"));
    const [first] = prompt.candidates;
    if (first === undefined) throw new Error("no ref");
    const { state, events } = pick(after, "p1", first);
    expect(attachedRows(events)).toEqual([
      {
        type: "ENERGY_ATTACHED",
        seat: "p1",
        uid: before.players.p2.discard[0],
        target: { spot: "active" },
      },
    ]);
    expect(ids(state, state.players.p2.active?.energy ?? [])).toEqual([SPECIAL]);
    expect(state.players.p2.discard).toEqual([]);
    // The CONTROL: the Basic-only reading (`anyEnergy` absent) on the SAME board and pile whiffs.
    const basicOnly = runProgram(
      before,
      [{ op: "attachEnergyFrom", source: "discard", declinable: true, whose: "opponent" }],
      attackCtx(before),
      [],
    );
    expect(basicOnly.kind).toBe("done");
  });

  it("(vi) an EMPTY opponent pile (an Item alone) is a WHIFF: no park, no `ENERGY_ATTACHED`, NO `ATTACK_EFFECT_SKIPPED` (the program derived), the base dealt, the turn ends — and the attacker's OWN stocked pile does NOT feed it", () => {
    for (const attacker of SEATS) {
      const defender = other(attacker);
      const { before, after, events } = swing({ attacker, opponentPile: [ITEM] });
      expect(ids(before, before.players[attacker].discard)).toEqual([W_ENERGY, W_ENERGY]); // the own pile IS stocked
      expect(after.phase).toEqual({ kind: "turn:action", seat: defender });
      expect(types(events)).toEqual([
        "ATTACK_DECLARED",
        "DAMAGE_DEALT",
        "TURN_ENDED",
        "TURN_STARTED",
        "CARDS_DRAWN",
      ]);
      expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
      expect(attachedRows(events)).toHaveLength(0);
      expect(after.players[attacker].discard).toEqual(before.players[attacker].discard);
      expect(after.players[defender].discard).toEqual(before.players[defender].discard);
      expect(after.players[defender].active?.damage).toBe(BASE);
      expect(after.players[attacker].active?.energy).toEqual(
        before.players[attacker].active?.energy,
      );
    }
  });

  it("(vii) an opponent with ONLY an Active still PARKS (one candidate, `upTo` 1 — the forced arm stays off, D359): the decline is a live answer there", () => {
    const { before, after } = swing({ opponentBench: 0 });
    expect(before.players.p2.bench).toHaveLength(0);
    expect(after.phase.kind).toBe("effect:choose");
    const prompt = pokemonPrompt(after);
    expect(prompt.candidates).toEqual([{ seat: "p2", spot: { spot: "active" } }]);
    expect(prompt.upTo).toBe(1);
    expect(prompt.note).toBe(CAPTION);
    const declined = pick(after, "p1");
    expect(attachedRows(declined.events)).toHaveLength(0);
    expect(declined.state.players.p2.active?.energy).toEqual([]);
  });

  it("(viii) the attacker's OWN bodies are NEVER candidates: with two own Bench bodies the offer is still the opponent's three, and `attachEnergyTargets` / `attachSeat` say so directly (`D532-targets-ignore-whose` / `-resolver-ignores-whose`)", () => {
    const board = table({ ownBench: 2 });
    expect(board.players.p1.bench).toHaveLength(2);
    const { after } = { after: mustApply(board, { type: "attack", seat: "p1", index: 0 }).state };
    const prompt = pokemonPrompt(after);
    expect(prompt.candidates).toEqual(boardRefs(board, "p2"));
    for (const ref of boardRefs(board, "p1")) expect(prompt.candidates).not.toContainEqual(ref);
    // The funnel, asked directly: `seat` is the ACTOR, the refs are the OWNER's.
    expect(attachEnergyTargets(board, "p1", { whose: "opponent" })).toEqual(boardRefs(board, "p2"));
    expect(attachEnergyTargets(board, "p1", {})).toEqual(boardRefs(board, "p1"));
    expect(attachEnergyTargets(board, "p2", { whose: "opponent" })).toEqual(boardRefs(board, "p1"));
    expect(attachEnergyTargets(board, "p1", { whose: "opponent", benchOnly: true })).toEqual(
      boardRefs(board, "p2").slice(1),
    );
    expect(attachSeat({ whose: "opponent" }, "p1")).toBe("p2");
    expect(attachSeat({ whose: "opponent" }, "p2")).toBe("p1");
    expect(attachSeat({}, "p1")).toBe("p1");
    expect(attachSeat({}, "p2")).toBe("p2");
  });

  it("(ix) the refusals at the park: the attacker's OWN Active ref and a Bench index the opponent does not field are `BAD_EFFECT_CHOICE`; a wrong-seat answerer is refused too (`D532-apply-guards-against-the-actor`)", () => {
    const { after } = swing();
    for (const ref of [
      { seat: "p1" as const, spot: { spot: "active" as const } },
      { seat: "p2" as const, spot: { spot: "bench" as const, index: 2 } },
    ]) {
      const refused = applyAction(after, {
        type: "resolveEffect",
        seat: "p1",
        choice: { kind: "pokemon", ref },
      });
      expect(refused.ok).toBe(false);
      if (refused.ok) throw new Error("a non-candidate ref was accepted");
      expect(refused.error.code).toBe("BAD_EFFECT_CHOICE");
    }
    const wrongSeat = applyAction(after, {
      type: "resolveEffect",
      seat: "p2",
      choice: { kind: "pokemon", ref: { seat: "p2", spot: { spot: "active" } } },
    });
    expect(wrongSeat.ok).toBe(false);
    const asked = pick(after, "p1", { seat: "p2", spot: { spot: "active" } }).state;
    const legal = pickCard(asked, "p1", cardPrompt(asked).candidates[0] as string);
    expect(attachedRows(legal.events)).toHaveLength(1);
    expect(ids(legal.state, legal.state.players.p2.active?.energy ?? [])).toEqual([R_ENERGY]);
  });

  it("(x) the redacted views: the OPPONENT's view of the park carries `prompt: null` (they do not answer); the ATTACKER's view carries the foreign-seat candidates and the caption", () => {
    for (const attacker of SEATS) {
      const defender = other(attacker);
      const { after } = swing({ attacker });
      expect(redactGame(after, defender).phase).toEqual({ kind: "effect:choose", prompt: null });
      const mine = redactGame(after, attacker);
      if (mine.phase.kind !== "effect:choose" || mine.phase.prompt?.kind !== "choosePokemon") {
        throw new Error("the attacker's view does not carry the choosePokemon prompt");
      }
      expect(mine.phase.prompt.candidates).toEqual(pokemonPrompt(after).candidates);
      expect(mine.phase.prompt.candidates.every((ref) => ref.seat === defender)).toBe(true);
      expect(mine.phase.prompt.note).toBe(CAPTION);
      expect(mine.phase.prompt.upTo).toBe(1);
    }
  });

  it("(xi) `rngState` is UNTOUCHED through the park and all three answers — nothing here is a coin or a shuffle", () => {
    const { before, after } = swing();
    expect(after.rngState).toBe(before.rngState);
    let state = after;
    for (const ref of pokemonPrompt(after).candidates) {
      state = pick(state, "p1", ref).state;
      if (state.phase.kind === "effect:choose" && state.phase.prompt.kind === "chooseCards") {
        state = pickCard(state, "p1", state.phase.prompt.candidates[0] as string).state;
      }
    }
    expect(state.phase).toEqual({ kind: "turn:action", seat: "p2" });
    expect(state.rngState).toBe(before.rngState);
  });

  it("(xii) replays identically from one seed — the same parked board and the same events twice; and the parked state JSON round-trips BYTE-EQUAL and resumes from its bytes", () => {
    const a = swing();
    const b = swing();
    expect(b.before).toEqual(a.before);
    expect(b.after).toEqual(a.after);
    expect(b.events).toEqual(a.events);
    const persisted = JSON.parse(JSON.stringify(a.after)) as GameState;
    expect(persisted).toEqual(a.after);
    expect(JSON.stringify(persisted)).toBe(JSON.stringify(a.after));
    const [x] = pokemonPrompt(a.after).candidates;
    if (x === undefined) throw new Error("no candidates");
    const live = pick(a.after, "p1", x);
    const replayed = pick(persisted, "p1", x);
    expect(replayed.events).toEqual(live.events);
    expect(replayed.state).toEqual(live.state);
  });

  it("(xiii) the controls on the SAME card: index 1 (the DARK own-seat twin) flags `ATTACK_EFFECT_SKIPPED` and moves nothing from EITHER pile; index 2 (no effect) has no program — both deal the base and end the turn", () => {
    const twin = swing({}, 1);
    expect(types(twin.events)).toEqual([
      "ATTACK_DECLARED",
      "ATTACK_EFFECT_SKIPPED",
      "DAMAGE_DEALT",
      "TURN_ENDED",
      "TURN_STARTED",
      "CARDS_DRAWN",
    ]);
    expect(twin.after.players.p1.discard).toEqual(twin.before.players.p1.discard);
    expect(twin.after.players.p2.discard).toEqual(twin.before.players.p2.discard);
    expect(twin.after.players.p2.active?.damage).toBe(BASE);
    expect(readersClaiming(TWIN)).toEqual([]);
    const jab = swing({}, 2);
    expect(types(jab.events)).toEqual([
      "ATTACK_DECLARED",
      "DAMAGE_DEALT",
      "TURN_ENDED",
      "TURN_STARTED",
      "CARDS_DRAWN",
    ]);
    expect(jab.after.players.p2.discard).toEqual(jab.before.players.p2.discard);
  });

  it("never mutates the state it was given (purity — through the park and the pick)", () => {
    const before = table();
    const snapshot = JSON.stringify(before);
    const { state: parked } = mustApply(before, { type: "attack", seat: "p1", index: 0 });
    const parkedSnapshot = JSON.stringify(parked);
    const [x] = pokemonPrompt(parked).candidates;
    if (x === undefined) throw new Error("no candidates");
    pick(parked, "p1", x);
    expect(JSON.stringify(before)).toBe(snapshot);
    expect(JSON.stringify(parked)).toBe(parkedSnapshot);
  });
});

describe('D532 §5 — the grey-out gate reads the OPPONENT\'s pile for a `whose: "opponent"` program, and the OWN pile for a flagless one', () => {
  it("`programPlayable` is TRUE when the opponent's pile holds an Energy and FALSE when it holds only an Item — while the own pile is stocked either way; the flagless twin answers off the OWN pile on the same boards (`D532-gate-reads-the-actors-pile`)", () => {
    const stocked = table();
    const empty = table({ opponentPile: [ITEM] });
    const ownEmpty = table({ ownPile: [ITEM] });
    for (const board of [stocked, empty, ownEmpty])
      expect(
        ids(board, board.players.p1.discard).some((id) => id !== ITEM),
        "own pile",
      ).toBe(board !== ownEmpty);
    expect(programPlayable(stocked, PROGRAM, "p1", activeUid(stocked, "p1"))).toBe(true);
    expect(programPlayable(empty, PROGRAM, "p1", activeUid(empty, "p1"))).toBe(false);
    expect(programPlayable(ownEmpty, PROGRAM, "p1", activeUid(ownEmpty, "p1"))).toBe(true);
    // The flagless v30 op reads the OWN pile: the opposite answers on `empty` and `ownEmpty`.
    const own: readonly EffectOp[] = [V30_OP, V30_OP, V30_OP];
    expect(programPlayable(stocked, own, "p1", activeUid(stocked, "p1"))).toBe(true);
    expect(programPlayable(empty, own, "p1", activeUid(empty, "p1"))).toBe(true);
    expect(programPlayable(ownEmpty, own, "p1", activeUid(ownEmpty, "p1"))).toBe(false);
    // …and from the other seat.
    const p2 = table({ attacker: "p2", opponentPile: [ITEM] });
    expect(programPlayable(p2, PROGRAM, "p2", activeUid(p2, "p2"))).toBe(false);
    expect(programPlayable(p2, own, "p2", activeUid(p2, "p2"))).toBe(true);
  });
});

describe("D532 §6 — the version steps and the bytes this suite drove are the bytes that shipped", () => {
  it("engineVersion and `manifest.version` agree, and the bump is owed for BEHAVIOUR", () => {
    expect(manifest.version).toBe(engineVersion);
  });
});
