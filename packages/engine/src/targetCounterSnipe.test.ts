import type { Card } from "@colorless/schema";
import { describe, expect, it } from "vitest";
import { programPlayable } from "./cardplay";
import { legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import {
  deriveAttackDamageBonus,
  deriveAttackDamageMultiplier,
  deriveAttackEffect,
  splitAttackCancelClause,
  splitAttackGateClause,
  splitAttackRequirementClause,
  splitAttackTrailingClause,
  ATTACK_READERS,
} from "./effects";
import type { EffectOp } from "./effectTypes";
import { applyAction } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import type { PokemonRef } from "./effectPrompt";
import {
  FIXTURE_POOL,
  activeUid,
  attachFromDeck,
  battler,
  benchFromDeck,
  benchTopUid,
  clearBench,
  deckOf,
  mustApply,
  setActiveFromDeck,
  setBenchDamage,
  types,
  driveSetup,
  roundTrip,
} from "./testFixtures";

const PRINTED =
  "This attack does 20 damage to 1 of your opponent's Benched Pokémon for each damage counter on that Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";
/** The same skeleton at a different printed amount — the amount is CAPTURED, not pinned. Constructed. */
const at = (n: number): string => PRINTED.replace("does 20 damage", `does ${n} damage`);
/** The FLAT sibling this anchor must NOT be confused with — the un-scaled `1 of` snipe arm 6c reads
    (`ALSO_BENCHED_SNIPE`, `(?:also )?`). Constructed at this amount (the column prints other amounts). */
const FLAT =
  "This attack does 20 damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";
const WINDOW_SIBLING =
  "This attack also does 60 damage to 1 of your opponent's Benched Pokémon that has any damage counters on it. (Don't apply Weakness and Resistance for Benched Pokémon.)";
/** The Prize sibling — Wo-Chien ex "Covetous Ivy", arm 6b: the SAME head with the OTHER tail. */
const PRIZE_SIBLING =
  "This attack does 40 damage to 1 of your opponent's Benched Pokémon for each Prize card your opponent has taken.";
const SELF_COUNTERS = "This attack does 20 damage for each damage counter on this Pokémon.";

/** THE PROGRAM, spelled once — key order as arm 6b′ emits it. */
const PROGRAM: readonly EffectOp[] = [
  {
    op: "damageChosen",
    target: "opponentBench",
    amount: 20,
    count: 1,
    source: "attack",
    deals: true,
    perDamageCounterOnTarget: true,
  },
];
const program = (amount: number): readonly EffectOp[] => [
  { ...(PROGRAM[0] as EffectOp), amount } as EffectOp,
];

const READERS = ATTACK_READERS.map(({ read }) => read);
const SPLITTERS = [
  splitAttackCancelClause,
  splitAttackGateClause,
  splitAttackRequirementClause,
  splitAttackTrailingClause,
];

const units = (rows: readonly (readonly [number, string])[]) => rows.reduce((s, [n]) => s + n, 0);

/** The anchor, re-spelled HERE as the whole-sentence claim it makes over the column (§1's claimed-set
    rung) — the ASCII-apostrophe form, which is what the column prints. */
const ANCHOR =
  /^This attack does (\d+) damage to 1 of your opponent['’]s Benched Pokémon for each damage counter on that Pokémon\.(?: \(Don['’]t apply Weakness and Resistance for Benched Pokémon\.\))?$/;

const SNIPER = "d530-sniper";
const PLAIN = "fix-energy";
/** P2's Active — 400 HP, no W/R, never a candidate. */
const WALL = "d530-wall";
/** P2's Bench body — 300 HP Colorless, no Weakness: 140 lands without a KO. */
const PAL = "d530-pal";
/** P2's OTHER Bench body — 300 HP with ×2 LIGHTNING Weakness (the attacker is {L}): the §8.5 control,
    a Bench target that W/R must NOT touch. */
const WEAK = "d530-weak";
/** The control's printed base. */
const JAB = 30;

const SNIPE_CARDS: Record<string, Card> = {
  [SNIPER]: battler(SNIPER, {
    name: "D530 Sniper",
    types: ["Lightning"],
    hp: 130,
    retreat: 2,
    attacks: [
      /** index 0 — PRINTED verbatim, with a DECLARED cost and NO base. */
      { cost: ["Colorless"], name: "Counter Snipe", effect: PRINTED },
      /** index 1 — the control: a flat hit on the Active, no effect, no program. */
      { cost: ["Colorless"], name: "Plain Jab", damage: JAB },
    ],
  }),
  [WALL]: battler(WALL, { name: "D530 Wall", types: ["Colorless"], hp: 400 }),
  [PAL]: battler(PAL, { name: "D530 Pal", types: ["Colorless"], hp: 300 }),
  [WEAK]: battler(WEAK, {
    name: "D530 Weakling",
    types: ["Water"],
    hp: 300,
    weaknesses: [{ type: "Lightning", value: "×2" }],
  }),
};

const SNIPE_POOL: Record<string, Card> = { ...FIXTURE_POOL, ...SNIPE_CARDS };

const SNIPE_DECK = deckOf({
  [SNIPER]: 8,
  [WALL]: 8,
  [PAL]: 12,
  [WEAK]: 4,
  [PLAIN]: 28,
});

const SEED = 7;

function openTable(seed: number, first: Seat): GameState {
  return driveSetup(seed, { p1: SNIPE_DECK, p2: SNIPE_DECK }, { pool: SNIPE_POOL, first });
}

type Body = { readonly id: string; readonly damage: number };
const pal = (damage: number): Body => ({ id: PAL, damage });
const weak = (damage: number): Body => ({ id: WEAK, damage });

function table(bench: readonly Body[]): GameState {
  let state = openTable(SEED, "p2");
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  if (state.turn !== 2) throw new Error(`expected turn 2, got ${String(state.turn)}`);
  state = setActiveFromDeck(state, "p1", SNIPER);
  state = setActiveFromDeck(state, "p2", WALL);
  state = clearBench(state, "p1");
  state = clearBench(state, "p2");
  bench.forEach((body, i) => {
    state = benchFromDeck(state, "p2", body.id);
    state = setBenchDamage(state, "p2", i, body.damage);
  });
  state = attachFromDeck(state, "p1", PLAIN, 1);
  return state;
}

type Swing = { before: GameState; after: GameState; events: GameEvent[] };

function swing(bench: readonly Body[], index = 0): Swing {
  const before = table(bench);
  const { state: after, events } = mustApply(before, { type: "attack", seat: "p1", index });
  return { before, after, events };
}

function multiPrompt(state: GameState) {
  if (state.phase.kind !== "effect:choose")
    throw new Error(`expected a park, got ${state.phase.kind}`);
  if (state.phase.prompt.kind !== "choosePokemonMulti") {
    throw new Error(`expected choosePokemonMulti, got ${state.phase.prompt.kind}`);
  }
  return state.phase.prompt;
}
function continuation(state: GameState) {
  if (state.phase.kind !== "effect:choose") throw new Error("expected a park");
  return state.phase.cont;
}
const benchRef = (index: number): PokemonRef => ({ seat: "p2", spot: { spot: "bench", index } });
const activeRef: PokemonRef = { seat: "p2", spot: { spot: "active" } };

/** Answer the parked choosePokemonMulti with ONE body. */
const pick = (state: GameState, ref: PokemonRef, seat: Seat = "p1") =>
  mustApply(state, { type: "resolveEffect", seat, choice: { kind: "pokemonMulti", refs: [ref] } });

function dealtRows(events: readonly GameEvent[]) {
  return events.filter(
    (e): e is Extract<GameEvent, { type: "DAMAGE_DEALT" }> => e.type === "DAMAGE_DEALT",
  );
}
const benchDamage = (state: GameState) => state.players.p2.bench.map((b) => b.damage);

const CAPTION =
  "Choose 1 of your opponent's Benched Pokémon (20 damage for each damage counter on it).";

// ─────────────────────────────────────────────────────────────────────────────
// §1 — reading: the exact program, the captured amount, the near-misses, the siblings, the claimed set.
// ─────────────────────────────────────────────────────────────────────────────

describe("D530 §1 — file line 551 derives to EXACTLY the count-1 opponentBench snipe with `perDamageCounterOnTarget`", () => {
  it("the row derives to the program byte for byte, with EXACTLY these seven keys (`D530-arm-drops-the-rider`)", () => {
    expect(deriveAttackEffect(PRINTED)).toEqual(PROGRAM);
    const got = deriveAttackEffect(PRINTED);
    if (got === null) throw new Error("the row derived null");
    expect(got).toHaveLength(1);
    expect(Object.keys(got[0] ?? {}).sort()).toEqual([
      "amount",
      "count",
      "deals",
      "op",
      "perDamageCounterOnTarget",
      "source",
      "target",
    ]);
    const op = got[0] as Record<string, unknown>;
    expect(op.perDamageCounterOnTarget).toBe(true);
    // The sibling riders are ABSENT, not false — an absent key and `false` would be two spellings.
    for (const absent of [
      "perTakenPrize",
      "perEnergyOnSelf",
      "perRecorded",
      "damagedOnly",
      "ignoreWR",
      "filter",
      "optional",
    ]) {
      expect(absent in op, absent).toBe(false);
    }
    const curly = PRINTED.replace("opponent's", "opponent’s").replace("Don't", "Don’t");
    expect(curly).not.toBe(PRINTED);
    expect(deriveAttackEffect(curly)).toEqual(PROGRAM);
    expect(legalAttackCorpus().some(([, s]) => s === curly)).toBe(false);
  });

  it("the amount is CAPTURED, not pinned — 10, 30 and 50 derive at 10, 30 and 50; a printed 0 stays on the LOUD path (`D530-arm-admits-a-printed-zero`)", () => {
    expect(deriveAttackEffect(at(10))).toEqual(program(10));
    expect(deriveAttackEffect(at(30))).toEqual(program(30));
    expect(deriveAttackEffect(at(50))).toEqual(program(50));
    expect(deriveAttackEffect(at(0))).toBeNull();
    expect(resolvedByAnyReader(at(0))).toBe(false);
    // The one-character control: the same sentence at 1 derives.
    expect(deriveAttackEffect(at(1))).toEqual(program(1));
    for (const s of [at(10), at(30), at(50), at(0), at(1)]) {
      expect(
        legalAttackCorpus().some(([, t]) => t === s),
        s,
      ).toBe(false);
    }
  });

  it("`deriveAttackEffect` is the ONLY claimant — twelve readers and four splitters are null — and the reader surface is still THIRTEEN", () => {
    for (const reader of READERS) {
      if (reader === deriveAttackEffect) continue;
      expect(reader(PRINTED), reader.name).toBeNull();
    }
    for (const splitter of SPLITTERS) expect(splitter(PRINTED), splitter.name).toBeNull();
    expect(deriveAttackEffect(PRINTED)).not.toBeNull();
    expect(resolvedByAnyReader(PRINTED)).toBe(true);
  });

  it("the anchor is WHOLE-SENTENCE at BOTH ends: both prints are null on every reader and splitter but the SUFFIXED trailing split (`D530-anchor-loses-the-head` / `-tail`)", () => {
    const prefixed = `Draw a card. ${PRINTED}`;
    const suffixed = `${PRINTED} Draw a card.`;
    for (const s of [prefixed, suffixed]) {
      expect(
        legalAttackCorpus().some(([, t]) => t === s),
        s,
      ).toBe(false);
      for (const reader of READERS)
        expect(reader(s), `${reader.name} on ${s.slice(0, 12)}…`).toBeNull();
      for (const splitter of SPLITTERS) {
        if (s === suffixed && splitter === splitAttackTrailingClause) continue;
        expect(splitter(s), `${splitter.name} on ${s.slice(0, 12)}…`).toBeNull();
      }
      expect(resolvedByAnyReader(s), s).toBe(false);
    }
    expect(splitAttackTrailingClause(suffixed)).toEqual({ head: PRINTED, tail: "Draw a card." });
  });

  it("the single-axis near-misses: `2 of` and `on this Pokémon` are null on EVERY reader, and `Pokémon` without `Benched` reads at `opponentAny` (D608)", () => {
    const twoOf = PRINTED.replace("to 1 of", "to 2 of");
    const unbenched = PRINTED.replace("Benched Pokémon for", "Pokémon for");
    const onThis = PRINTED.replace("on that Pokémon", "on this Pokémon");
    expect(legalAttackCorpus().some(([, t]) => t === unbenched)).toBe(false);
    expect(deriveAttackEffect(unbenched)).toEqual([
      {
        op: "damageChosen",
        target: "opponentAny",
        amount: 20,
        count: 1,
        source: "attack",
        deals: true,
        perDamageCounterOnTarget: true,
      },
    ]);
    for (const s of [twoOf, onThis]) {
      expect(s).not.toBe(PRINTED);
      expect(
        legalAttackCorpus().some(([, t]) => t === s),
        s,
      ).toBe(false);
      for (const reader of READERS)
        expect(reader(s), `${reader.name}: ${s.slice(24, 60)}`).toBeNull();
      expect(resolvedByAnyReader(s), s).toBe(false);
    }
    // The literal `1 of` is what keeps a count-2 per-target fold UNPRINTED and UNREACHABLE from the
    // deriver — the per-ref fold in the interpreter is what keeps a registry-authored one honest.
    expect(deriveAttackEffect(twoOf)).toBeNull();
  });

  it("the D465-family spelling of the SAME multiplier on the ATTACKER stays on ITS reader — an INEQUALITY, not a null (it is a printed row, 7 legal printings)", () => {
    const rows = new Map(legalAttackCorpus().map(([n, s]) => [s, n]));
    expect(rows.get(SELF_COUNTERS)).toBe(7);
    expect(resolvedByAnyReader(SELF_COUNTERS)).toBe(true);
    // Not THIS reader: the head is "does N damage for each", not "does N damage to 1 of".
    expect(deriveAttackEffect(SELF_COUNTERS)).toBeNull();
    expect(deriveAttackDamageMultiplier(SELF_COUNTERS)).toEqual({
      per: 20,
      count: { kind: "damageCountersOnSelf" },
    });
    expect(deriveAttackDamageMultiplier(PRINTED)).toBeNull();
    expect(deriveAttackDamageBonus(PRINTED)).toBeNull();
  });

  it("the three SIBLINGS on the same noun phrase each keep their OWN op — inequality rungs in every direction (D418's second half)", () => {
    // The FLAT `1 of` snipe (arm 6c): the same seven keys minus the rider, and NOT this program.
    expect(deriveAttackEffect(FLAT)).toEqual([
      {
        op: "damageChosen",
        target: "opponentBench",
        amount: 20,
        count: 1,
        source: "attack",
        deals: true,
      },
    ]);
    expect(deriveAttackEffect(FLAT)).not.toEqual(PROGRAM);
    const rows = new Map(legalAttackCorpus().map(([n, s]) => [s, n]));
    expect(rows.get(WINDOW_SIBLING)).toBe(3);
    expect(deriveAttackEffect(WINDOW_SIBLING)).toEqual([
      {
        op: "damageChosen",
        target: "opponentBench",
        amount: 60,
        count: 1,
        source: "attack",
        deals: true,
        damagedOnly: true,
      },
    ]);
    expect(deriveAttackEffect(WINDOW_SIBLING)?.[0]).not.toHaveProperty("perDamageCounterOnTarget");
    // Covetous Ivy (arm 6b): the OTHER tail, the OTHER rider.
    expect(deriveAttackEffect(PRIZE_SIBLING)).toEqual([
      {
        op: "damageChosen",
        target: "opponentBench",
        amount: 40,
        count: 1,
        source: "attack",
        deals: true,
        perTakenPrize: true,
      },
    ]);
    expect(deriveAttackEffect(PRIZE_SIBLING)?.[0]).not.toHaveProperty("perDamageCounterOnTarget");
    expect(deriveAttackEffect(PRINTED)?.[0]).not.toHaveProperty("perTakenPrize");
    expect(deriveAttackEffect(PRINTED)?.[0]).not.toHaveProperty("damagedOnly");
  });

  it("the anchor's claimed set over the legal column is EXACTLY [the row], at `legalAttackCorpus()` index 498 / 1 printing", () => {
    const claimed = legalAttackCorpus().filter(([, s]) => ANCHOR.test(s));
    expect(claimed).toEqual([[1, PRINTED]]);
    expect(legalAttackCorpus().findIndex(([, s]) => s === PRINTED)).toBe(498);
    expect(legalAttackCorpus()[498]).toEqual([1, PRINTED]);
  });
});

describe("D530 §2 — the census moved in exactly ONE summand, by 1 sentence / 1 printing", () => {
  it("the reader arm reads 556 sentences / 1,598 printings, and the row is IN it", () => {
    const resolved = legalAttackCorpus().filter(([, s]) => resolvedByAnyReader(s));
    expect(resolved.map(([, s]) => s)).toContain(PRINTED);
    const without = resolved.filter(([, s]) => s !== PRINTED);
    expect([resolved.length - without.length, units(resolved) - units(without)]).toEqual([1, 1]);
  });

  it("the RAW reader-only residue fell by exactly 1 sentence / 1 printing — 84 / 134 — and the row left it", () => {
    const unbuilt = legalAttackCorpus().filter(([, s]) => !resolvedByAnyReader(s));
    expect(unbuilt.map(([, s]) => s)).not.toContain(PRINTED);
  });

  it("the move is READER-keyed: no gate clause, no trailing split, no cancel split, no requirement split claims the row itself", () => {
    expect(splitAttackGateClause(PRINTED)).toBeNull();
    expect(splitAttackTrailingClause(PRINTED)).toBeNull();
    expect(splitAttackCancelClause(PRINTED)).toBeNull();
    expect(splitAttackRequirementClause(PRINTED)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — the persisted address: a WIDENING, `MATCH_RECORD_VERSION` HELD at 30, driven over v30 bytes.
// ─────────────────────────────────────────────────────────────────────────────

describe("D530 §3 — a new optional rider on a PERSISTED op, and the record version does not move", () => {
  it("the version PREDICTION, driven over the SERIALIZED BYTES in three directions (scaledAnySnipe §3's shape)", () => {
    const preSlice = [
      '{"op":"damageChosen","target":"opponentBench","amount":40,"count":1,"source":"attack","deals":true,"perTakenPrize":true}',
      '{"op":"damageChosen","target":"opponentBench","amount":60,"count":1,"source":"attack","deals":true,"damagedOnly":true}',
    ];
    for (const bytes of preSlice) {
      const revived = JSON.parse(bytes) as EffectOp;
      expect(JSON.stringify(revived)).toBe(bytes); // no key gained, none lost, order kept
    }
    expect(deriveAttackEffect(PRIZE_SIBLING)?.[0]).toEqual(JSON.parse(preSlice[0] as string));
    expect(deriveAttackEffect(WINDOW_SIBLING)?.[0]).toEqual(JSON.parse(preSlice[1] as string));

    // DIRECTION 2 — the NEW value cannot appear in any record an older deploy wrote, and this deploy
    // round-trips it byte for byte.
    const fresh = deriveAttackEffect(PRINTED)?.[0];
    expect(JSON.stringify(fresh)).toBe(
      '{"op":"damageChosen","target":"opponentBench","amount":20,"count":1,"source":"attack","deals":true,"perDamageCounterOnTarget":true}',
    );
    expect(roundTrip(fresh)).toEqual(fresh);

    const dropped = JSON.parse(
      JSON.stringify(fresh, (k, v) => (k === "perDamageCounterOnTarget" ? undefined : v)),
    ) as EffectOp;
    expect(dropped).toEqual(deriveAttackEffect(FLAT)?.[0]);
    expect(dropped).not.toEqual(fresh);
  });

  it("the parked `pendingOp`'s key set, sorted, carries the rider — and nothing else new", () => {
    const parked = swing([pal(30), pal(70)]).after;
    const cont = continuation(parked);
    expect(Object.keys(cont.pendingOp).sort()).toEqual([
      "amount",
      "count",
      "deals",
      "op",
      "perDamageCounterOnTarget",
      "source",
      "target",
    ]);
    expect(Object.keys(cont).sort()).toEqual(["ctx", "pendingOp", "rest"]);
    expect(JSON.stringify(cont.pendingOp)).toBe(JSON.stringify(PROGRAM[0]));
    expect(cont.rest).toEqual([]);
  });
});

describe("D530 §4 — the pick reads the CHOSEN body's counters: 3 → 60, 7 → 140, on one op, one board", () => {
  it("the board is what it says: P1's sniper is Active with one Colorless Basic, P2's wall is Active at 0, P2's Bench is Pal(30) and Pal(70), turn 2", () => {
    const before = table([pal(30), pal(70)]);
    expect(before.players.p1.active?.energy).toHaveLength(1);
    expect(before.cardIdByUid[activeUid(before, "p1")]).toBe(SNIPER);
    expect(before.cardIdByUid[activeUid(before, "p2")]).toBe(WALL);
    expect(before.players.p2.active?.damage).toBe(0);
    expect(before.players.p1.bench).toHaveLength(0);
    expect(before.players.p2.bench.map((b) => before.cardIdByUid[b.stack[0] ?? ""])).toEqual([
      PAL,
      PAL,
    ]);
    expect(benchDamage(before)).toEqual([30, 70]);
    expect(before.turn).toBe(2);
    expect(table([]).players.p2.bench).toHaveLength(0);
  });

  it("(i) a two-body Bench PARKS: `effect:choose` / `choosePokemonMulti { the two Bench refs, min 1, max 1, declinable false }`, the Active NOT a candidate, the caption quoting the printed RULE (no number × N), NO damage yet, no flip, the turn NOT ended (`D530-caption-drops-the-rule`)", () => {
    const { before, after, events } = swing([pal(30), pal(70)]);
    expect(after.phase.kind).toBe("effect:choose");
    expect(after.phase.kind === "effect:choose" && after.phase.seat).toBe("p1");
    const prompt = multiPrompt(after);
    expect(prompt).toEqual({
      kind: "choosePokemonMulti",
      candidates: [benchRef(0), benchRef(1)],
      min: 1,
      max: 1,
      declinable: false,
      note: CAPTION,
    });
    expect(prompt.candidates.some((ref) => ref.spot.spot === "active")).toBe(false);
    expect(prompt.note).not.toContain(" each)");
    expect(prompt.note).not.toContain("60");
    expect(prompt.note).not.toContain("140");
    expect(dealtRows(events)).toHaveLength(0);
    expect(types(events)).toEqual(["ATTACK_DECLARED", "EFFECT_PENDING"]);
    expect(benchDamage(after)).toEqual([30, 70]);
    expect(after.players.p2.active?.damage).toBe(0);
    expect(after.rngState).toBe(before.rngState);
    expect(continuation(after).pendingOp).toEqual(PROGRAM[0]);
  });

  it("(ii) answer index 0 (3 counters) → 60 dealt to THAT body ONLY: one `DAMAGE_DEALT { base 60, dealt 60 }` on its uid, the other body UNMOVED, the turn ends (`D530-fold-ignores-the-target` / `-answer-passes-no-ref`)", () => {
    const { after: parked } = swing([pal(30), pal(70)]);
    const { state, events } = pick(parked, benchRef(0));
    expect(dealtRows(events)).toHaveLength(1);
    expect(dealtRows(events)[0]).toMatchObject({
      seat: "p2",
      by: "p1",
      uid: benchTopUid(parked, "p2", 0),
      base: 60,
      dealt: 60,
    });
    expect(benchDamage(state)).toEqual([90, 70]);
    expect(state.players.p2.active?.damage).toBe(0);
    expect(types(events)).toEqual(["DAMAGE_DEALT", "TURN_ENDED", "TURN_STARTED", "CARDS_DRAWN"]);
    expect(state.phase).toEqual({ kind: "turn:action", seat: "p2" });
  });

  it("(iii) answer index 1 (7 counters) → 140 dealt to THAT body ONLY — the same op, the same board, a DIFFERENT number: the multiplier is the TARGET's", () => {
    const { after: parked } = swing([pal(30), pal(70)]);
    const { state, events } = pick(parked, benchRef(1));
    expect(dealtRows(events)).toHaveLength(1);
    expect(dealtRows(events)[0]).toMatchObject({
      uid: benchTopUid(parked, "p2", 1),
      base: 140,
      dealt: 140,
    });
    expect(benchDamage(state)).toEqual([30, 210]);
    const floored = pick(swing([pal(65), pal(70)]).after, benchRef(0));
    expect(dealtRows(floored.events)[0]).toMatchObject({ base: 120, dealt: 120 });
    expect(benchDamage(floored.state)).toEqual([185, 70]);
  });

  it("(iv) a ONE-body Bench is FORCED — no park, no phase, 20 × its counters dealt inline, the turn ends (`D530-forced-branch-passes-the-flat-amount`)", () => {
    const { after, events } = swing([pal(70)]);
    expect(after.phase).toEqual({ kind: "turn:action", seat: "p2" });
    expect(dealtRows(events)).toHaveLength(1);
    expect(dealtRows(events)[0]).toMatchObject({
      uid: benchTopUid(after, "p2", 0),
      base: 140,
      dealt: 140,
    });
    expect(benchDamage(after)).toEqual([210]);
    expect(types(events)).toEqual([
      "ATTACK_DECLARED",
      "DAMAGE_DEALT",
      "TURN_ENDED",
      "TURN_STARTED",
      "CARDS_DRAWN",
    ]);
    // A second one-body board at a different count, so 140 is not confusable with a constant.
    const three = swing([pal(30)]);
    expect(dealtRows(three.events)[0]).toMatchObject({ base: 60, dealt: 60 });
    expect(benchDamage(three.after)).toEqual([90]);
  });

  it("(v) THE DECIDED DISCREPANCY: a one-body Bench at 0 counters is still forced — NO `DAMAGE_DEALT`, no park, no `ATTACK_EFFECT_SKIPPED`, the body UNMOVED, the turn ends; and on a two-body Bench the undamaged body is STILL a candidate and choosing it deals nothing", () => {
    const { after, events } = swing([pal(0)]);
    expect(after.phase).toEqual({ kind: "turn:action", seat: "p2" });
    expect(dealtRows(events)).toHaveLength(0);
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(types(events)).not.toContain("EFFECT_PENDING");
    expect(types(events)).toEqual(["ATTACK_DECLARED", "TURN_ENDED", "TURN_STARTED", "CARDS_DRAWN"]);
    expect(benchDamage(after)).toEqual([0]);
    const { after: parked } = swing([pal(0), pal(30)]);
    expect(multiPrompt(parked).candidates).toEqual([benchRef(0), benchRef(1)]);
    const zero = pick(parked, benchRef(0));
    expect(dealtRows(zero.events)).toHaveLength(0);
    expect(types(zero.events)).toEqual(["TURN_ENDED", "TURN_STARTED", "CARDS_DRAWN"]);
    expect(benchDamage(zero.state)).toEqual([0, 30]);
    const thirty = pick(parked, benchRef(1));
    expect(dealtRows(thirty.events)[0]).toMatchObject({ base: 60, dealt: 60 });
    expect(benchDamage(thirty.state)).toEqual([0, 90]);
  });

  it("(vi) an EMPTY opponent Bench is a silent no-op — no park, no damage, no skip, the turn ends", () => {
    const { after, events } = swing([]);
    expect(after.phase).toEqual({ kind: "turn:action", seat: "p2" });
    expect(dealtRows(events)).toHaveLength(0);
    expect(types(events)).toEqual(["ATTACK_DECLARED", "TURN_ENDED", "TURN_STARTED", "CARDS_DRAWN"]);
    expect(after.players.p2.active?.damage).toBe(0);
  });

  it("(vii) the refusals at the park: the Active's ref, TWO refs, an empty pick, and the wrong seat are all refused and the board is UNMOVED", () => {
    const { after: parked } = swing([pal(30), pal(70)]);
    const refuse = (refs: PokemonRef[], seat: Seat = "p1") =>
      applyAction(parked, { type: "resolveEffect", seat, choice: { kind: "pokemonMulti", refs } });
    expect(refuse([activeRef]).ok).toBe(false);
    expect(refuse([benchRef(0), benchRef(1)]).ok).toBe(false);
    expect(refuse([]).ok).toBe(false);
    expect(refuse([benchRef(0)], "p2").ok).toBe(false);
    expect(refuse([{ seat: "p1", spot: { spot: "active" } }]).ok).toBe(false);
    expect(benchDamage(parked)).toEqual([30, 70]);
    expect(parked.phase.kind).toBe("effect:choose");
  });

  it("(viii) §8.5 — a Bench target's ×2 Weakness to the {L} attacker is NOT applied: the Weakling at 3 counters takes 60, not 120", () => {
    const { after: parked } = swing([weak(30), pal(70)]);
    const { state, events } = pick(parked, benchRef(0));
    expect(state.cardIdByUid[benchTopUid(parked, "p2", 0)]).toBe(WEAK);
    expect(dealtRows(events)).toHaveLength(1);
    expect(dealtRows(events)[0]).toMatchObject({ base: 60, dealt: 60 });
    expect(benchDamage(state)).toEqual([90, 70]);
    // …and the Weakness is REAL on this body: the control's flat jab on the same card as ACTIVE doubles.
    let control = table([]);
    control = setActiveFromDeck(control, "p2", WEAK);
    control = clearBench(control, "p2");
    const jab = mustApply(control, { type: "attack", seat: "p1", index: 1 });
    expect(dealtRows(jab.events)[0]).toMatchObject({ base: JAB, dealt: JAB * 2 });
  });

  it("(ix) `rngState` is UNTOUCHED through the park and the pick — nothing on this board flips", () => {
    const { before, after } = swing([pal(30), pal(70)]);
    expect(after.rngState).toBe(before.rngState);
    expect(pick(after, benchRef(1)).state.rngState).toBe(before.rngState);
    const forced = swing([pal(70)]);
    expect(forced.after.rngState).toBe(forced.before.rngState);
  });

  it("(x) replays identically — the same parked board and events twice; the parked state JSON round-trips BYTE-EQUAL and resumes from its bytes to the same 140", () => {
    const a = swing([pal(30), pal(70)]);
    const b = swing([pal(30), pal(70)]);
    expect(b.after).toEqual(a.after);
    expect(b.events).toEqual(a.events);
    const persisted = roundTrip(a.after);
    expect(persisted).toEqual(a.after);
    expect(JSON.stringify(persisted)).toBe(JSON.stringify(a.after));
    const live = pick(a.after, benchRef(1));
    const replayed = pick(persisted, benchRef(1));
    expect(replayed.events).toEqual(live.events);
    expect(replayed.state).toEqual(live.state);
    expect(dealtRows(replayed.events)[0]).toMatchObject({ base: 140, dealt: 140 });
  });

  it("(xi) the index-1 control: the flat jab on the Active, no park, no Bench damage, `rngState` UNMOVED, the turn ends", () => {
    const { before, after, events } = swing([pal(30), pal(70)], 1);
    expect(after.phase).toEqual({ kind: "turn:action", seat: "p2" });
    expect(after.rngState).toBe(before.rngState);
    expect(types(events)).toEqual([
      "ATTACK_DECLARED",
      "DAMAGE_DEALT",
      "TURN_ENDED",
      "TURN_STARTED",
      "CARDS_DRAWN",
    ]);
    expect(dealtRows(events)[0]).toMatchObject({
      uid: activeUid(before, "p2"),
      base: JAB,
      dealt: JAB,
    });
    expect(benchDamage(after)).toEqual([30, 70]);
  });

  it("never mutates the state it was given (purity — through the park and the pick)", () => {
    const before = table([pal(30), pal(70)]);
    const frozen = JSON.stringify(before);
    const { state: parked } = mustApply(before, { type: "attack", seat: "p1", index: 0 });
    expect(JSON.stringify(before)).toBe(frozen);
    const parkedBytes = JSON.stringify(parked);
    pick(parked, benchRef(1));
    expect(JSON.stringify(parked)).toBe(parkedBytes);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — `programPlayable` is UNCHANGED: the grey-out reads `snipeTargets` only.
// ─────────────────────────────────────────────────────────────────────────────

describe("D530 §5 — the grey-out funnel reads only `snipeTargets`: a damage-free Bench is still playable, an empty one is not", () => {
  it("`programPlayable` is TRUE over two undamaged bodies (the card does not narrow to damaged ones) and FALSE over an empty Bench — the rider changes neither answer", () => {
    expect(programPlayable(table([pal(0), pal(0)]), PROGRAM, "p1")).toBe(true);
    expect(programPlayable(table([pal(30), pal(70)]), PROGRAM, "p1")).toBe(true);
    expect(programPlayable(table([]), PROGRAM, "p1")).toBe(false);
    // The FLAT sibling answers identically on every board — the funnel cannot see the rider.
    const flat = deriveAttackEffect(FLAT);
    if (flat === null) throw new Error("the flat sibling derived null");
    for (const bench of [[pal(0), pal(0)], [pal(30), pal(70)], []] as const) {
      expect(programPlayable(table(bench), flat, "p1")).toBe(
        programPlayable(table(bench), PROGRAM, "p1"),
      );
    }
  });
});
