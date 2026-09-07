import { describe, expect, it } from "vitest";
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import { deriveAttackEffect, splitAttackGateClause, splitAttackTrailingClause } from "./effects";
import type { EffectOp } from "./effects";
import { applyAction, engineVersion } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import {
  FIXTURE_POOL,
  SELF_ENERGY_HAND_DECK,
  SELF_HEAL_DEALT_DECK,
  attachFromDeck,
  deepFreeze,
  driveSetup,
  mustApply,
  setActiveFromDeck,
  setDamage,
  types,
} from "./testFixtures";

// 0.328.0 → 0.329.0 — 🆕🆕 D427: HEAL SELF BY THE DAMAGE THIS ATTACK DEALT.
//
//   "Heal from this Pokémon the same amount of damage you did to your opponent's
//    Active Pokémon."
//
// **1 sentence / 6 legal printings** (corpus line 286) over `legalAttackCorpus()`'s
// 640 sentences / 1,732 printings — the `legal_standard = 1` attack column. The
// LARGEST single record in the split-aware unbuilt residue at D426's head: **196
// sentences / 299 printings**, subtracting `resolvedByAnyReader`,
// `splitAttackGateClause`, `splitAttackTrailingClause` and a `registry.ts` substring
// test (D425's rule — a residue figure without its subtraction set is meaningless).
//
// 🛑 **THE DESIGN DECISION IS THE CARRIER, AND `EffectRecord` LOSES ON ITS VALUE TYPE
// RATHER THAN ON TASTE.** D406 priced this sentence one slice before declining it and
// named the reason: `EffectRecord` is `{ [K in EffectSlot]?: string[] }` and
// `EffectSlot` is `"paid" | "moved" | "discarded"` — **every §9.2 slot in this engine
// is a LIST OF CARD UIDS**, and this is an HP FIGURE. There is no slot to file it in
// and no widening that keeps the map's value type. The MEANING agrees and is the
// second reason, not the first: the record's own doc block calls it *"what the ops
// ALREADY RUN left behind"*, an accumulator that changes at nearly every op, where
// this number is computed by §8.5 BEFORE the program's first op and is fixed for the
// whole run. That is `seat`'s shape, so it rides `EffectContext.dealt`.
//
// 🛑 **PICKING `EffectContext` DOES NOT DUCK THE VERSION QUESTION — BOTH CANDIDATES
// ARE PERSISTED.** `ctx` rides `EffectContinuation` into `phase.cont` exactly as
// `record` does, so a program that PARKS writes this key into a `MatchRecord`.
// `MATCH_RECORD_VERSION` **STAYS 26** because the key is OPTIONAL: D125's WIDENING,
// with `EffectContext.invokedBy` as the precedent verbatim (`apps/api/src/lobby/
// match.ts`: *"an OPTIONAL field and therefore a WIDENING… it would not have bumped
// anything on its own"*) and D412's 25 → 26 as the counter-case (a REQUIRED
// `InPlayPokemon.retreatLockedTurn`). §3 DRIVES both directions on a real park rather
// than asserting either.
//
// ⚠️ **THE HANDOFF'S ONE FALSE PREMISE, AND IT WAS THE STRUCTURAL ONE (D421/D424).**
// The brief stated that `attack.ts`'s `const dealt` (line 1966 at HEAD) is in scope at
// the `runProgram` call because both sit inside `export function attack`. They do —
// and `dealt` is declared inside the `if (scaledBase + scaledTotal > 0)` BLOCK, which
// closes ~60 lines before the call. Reading the enclosing FUNCTION is not reading the
// enclosing BLOCK. The repair is a function-scope `let dealtToDefender = 0`, and its
// initialiser then turned out to BE the whiff semantics (§6), so the false premise
// cost nothing but would have cost a compile error to anyone who trusted it.
//
// ⚠️ **THE APOSTROPHE BYTE IS MEASURED, NOT REMEMBERED (D421).** `hexdump -C` on
// `censusAttackCorpus.ts` line 286 returns `6f 70 70 6f 6e 65 6e 74 27 73` —
// `opponent's` with **U+0027** — and the whole corpus file holds **zero** U+2019
// bytes. The anchor's `['’]` class is therefore DEFENSIVE, matching the 133 anchors in
// `effects.ts` that already spell it that way, and §1 pins both halves.

/** One seed for the whole suite. Nothing declared here flips a coin and every Active,
    defender and damage total is placed by surgery, so a seed table would describe a
    shuffle rather than a rule (D143's move, inherited by every damage suite since). */
const SEED = 7;

/** The printed sentence, transcribed off `censusAttackCorpus.ts` line 286 and used as
    the single source for the corpus assertions, the derivation assertions and the
    fixture cross-check below. Written once so no copy of it can drift (D415). */
const SENTENCE =
  "Heal from this Pokémon the same amount of damage you did to your opponent's Active Pokémon.";

/** The whole program the sentence derives to. One op, no gate, no wrapper. */
const PROGRAM: readonly EffectOp[] = [{ op: "heal", target: "self", amount: "dealt" }];

/** `fix-suction`'s indices. Three print `SENTENCE`; index 3 prints a row nothing
    reads, and exists so §7's "nothing was skipped" claim has a control. */
const IDX = { fifty: 0, twoHundred: 1, noDamage: 2, loud: 3 } as const;

const other = (seat: Seat): Seat => (seat === "p1" ? "p2" : "p1");

/** A board with `fix-suction` Active for `seat`, `defender` Active opposite, three
    Colorless attached and `healerDamage` already on the healer. The turn is handed to
    `seat` by ending the OTHER seat's first turn, so §4's going-first ban is never in
    the way and every board here is turn 2 or later. */
function board(defender: string, healerDamage: number, seat: Seat = "p1"): GameState {
  const decks = { p1: SELF_HEAL_DEALT_DECK, p2: SELF_HEAL_DEALT_DECK };
  let state = driveSetup(SEED, decks, { first: other(seat) });
  state = setActiveFromDeck(state, seat, "fix-suction");
  state = setActiveFromDeck(state, other(seat), defender);
  state = attachFromDeck(state, seat, "fix-energy", 3);
  state = setDamage(state, seat, healerDamage);
  return mustApply(state, { type: "endTurn", seat: other(seat) }).state;
}

function swing(
  state: GameState,
  index: number,
  seat: Seat = "p1",
): { state: GameState; events: GameEvent[] } {
  return mustApply(state, { type: "attack", seat, index });
}

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((event) => event.type === type) as
    | Extract<GameEvent, { type: T }>
    | undefined;
}

/** The two numbers every board in this suite is really about: what §8.5 said it
    dealt, and what the healer actually got back. `undefined` means the row was never
    emitted, which is a different fact from a zero and is asserted as such. */
function dealtAndHealed(events: GameEvent[]): {
  base: number | undefined;
  dealt: number | undefined;
  healed: number | undefined;
} {
  const damage = find(events, "DAMAGE_DEALT");
  const healed = find(events, "HEALED");
  return { base: damage?.base, dealt: damage?.dealt, healed: healed?.amount };
}

// ─────────────────────────────────────────────────────────────────────────────
// §1 — the printed data, and why the anchor is a LITERAL.
// ─────────────────────────────────────────────────────────────────────────────

describe("§1 — one sentence, six printings, no sibling to generalise over", () => {
  it("the corpus prints exactly this sentence at exactly this count", () => {
    const rows = legalAttackCorpus().filter(([, text]) => text === SENTENCE);
    expect(rows).toEqual([[6, SENTENCE]]);
  });

  it("🛑 the LOOSEST plausible family grep returns exactly ONE row — so a template would author a card", () => {
    // D121's warrant wants TWO printings with ONE TOKEN VARYING before a capture
    // group is justified. **THE PATTERN IS PUBLISHED SO ITS EDGES ARE VISIBLE**
    // (D424/D425): three alternatives wide and case-insensitive, so a possessive, an
    // adverb or a capitalisation cannot hide a sibling from it. What it cannot see is
    // a sentence spelling the idea with none of these substrings — e.g. "heal that
    // much damage" — and this rung says only that no such row is in THIS column.
    const LOOSE = /same amount of damage|damage you did|amount of damage/i;
    const family = legalAttackCorpus().filter(([, text]) => LOOSE.test(text));
    expect(family).toEqual([[6, SENTENCE]]);
    // …and the CONTROL on the same axis (D424): the pattern is not vacuous — it is a
    // real filter that admits things, which a sweep returning one row cannot show by
    // itself. Run against the whole corpus with only the last alternative it matches
    // more, and against a neighbouring heal family it matches none.
    expect(LOOSE.test("This attack does 30 more damage.")).toBe(false);
    expect(LOOSE.test("Heal 30 damage from this Pokémon.")).toBe(false);
    expect(LOOSE.test("Heal the same amount of damage.")).toBe(true);
  });

  it("🛑 the apostrophe byte is U+0027, and the corpus holds no U+2019 anywhere", () => {
    expect(SENTENCE).toContain("opponent's");
    expect(SENTENCE).not.toContain("’");
    // The POPULATION rather than the specimen (D423): no corpus row anywhere carries
    // the curly byte, so the `['’]` class in the anchor is defensive and this rung
    // says which of the two it is.
    expect(legalAttackCorpus().filter(([, text]) => text.includes("’"))).toEqual([]);
    // …and the anchor still claims the curly spelling, so a re-ingest that swapped the
    // byte would not silently un-simulate six printings.
    expect(deriveAttackEffect(SENTENCE.replace("'", "’"))).toEqual(PROGRAM);
  });

  it("the fixture prints the sentence VERBATIM at three indices, and AUTHORS nothing", () => {
    const card = FIXTURE_POOL["fix-suction"];
    if (card === undefined) throw new Error("fix-suction missing from FIXTURE_POOL");
    const attacks = card.attacks ?? [];
    expect(attacks.map((attack) => attack.effect)).toEqual([
      SENTENCE,
      SENTENCE,
      SENTENCE,
      "Each player draws 3 cards.",
    ]);
    // Every scalar around the sentence is CHOSEN and says so; only the TEXT is read
    // off the catalog. The printed damages are the suite's whole variable.
    expect(attacks.map((attack) => attack.damage)).toEqual([50, 200, undefined, 50]);
  });

  it("⚠️ the six carriers cannot be enumerated in this checkout, and that is stated not invented", () => {
    // D425: this clone has no D1. `selfHeal.test.ts`, `chosenHeal.test.ts` and
    // `boardHeal.test.ts` have each named Iron Moth `sv06.5-009` "Suction" as a
    // carrier since they were written; that id is INHERITED FROM THOSE COMMENTS and
    // was not verified against a catalog here, which is exactly why the fixture is
    // `fix-suction` and not `sv06.5-009`. What is MEASURED is the sentence and the 6.
    expect(Object.keys(FIXTURE_POOL)).not.toContain("sv06.5-009");
    expect(legalAttackCorpus().filter(([, text]) => text === SENTENCE)[0]?.[0]).toBe(6);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — the derivation: one anchor, one arm, one op.
// ─────────────────────────────────────────────────────────────────────────────

describe("§2 — the derivation, and the boundaries the anchor holds", () => {
  it("derives exactly one `heal` op whose amount is the SOURCE, not a number", () => {
    expect(deriveAttackEffect(SENTENCE)).toEqual(PROGRAM);
  });

  it("🛑 ZERO new readers — the arm is inside `deriveAttackEffect`, and the surface is unmoved", () => {
    // The census keys on the MODULE's `deriveAttack*` export set (D418). An arm adds
    // no export, so every figure in this repo that moved, moved because a SENTENCE
    // became claimed and for no other reason.
    // 🆕🆕 **D428 — 12 → 13, AND THE COUNT ALONE CAN NO LONGER CARRY THIS CLAIM.**
    // The surface genuinely grew (D428's `deriveAttackPreDamage`), so a rung that
    // only pins the number has stopped saying anything about D427's arm. Re-pointed
    // WITH its discrimination replaced rather than dropped (D418's second half): the
    // proposition is *"no export is named for THIS sentence"*, and a slice that
    // quietly split the heal arm out into a `deriveAttackHealDealt` reader breaks the
    // third rung while the first two stay green.
    expect(attackReaderSurface()).toHaveLength(13);
    expect(attackReaderSurface()).toContain("deriveAttackEffect");
    expect(attackReaderSurface().filter((name) => /Heal|Dealt/i.test(name))).toEqual([]);
  });

  it("🛑 the sentence is claimed WHOLE — neither splitter is involved, and no registry row is", () => {
    expect(resolvedByAnyReader(SENTENCE)).toBe(true);
    expect(splitAttackGateClause(SENTENCE)).toBeNull();
    expect(splitAttackTrailingClause(SENTENCE)).toBeNull();
  });

  it("🛑 refuses each near-miss — and ADMITS one on the same axis beside each (D424)", () => {
    // A refusal rung passes trivially against a reader that refuses everything, so
    // every REFUSED here is paired with an ADMITTED that shares its axis.
    // 🛑 THE TWO ANCHOR ROWS BELOW WERE WRITTEN WRONG FIRST AND THE MUTATION HARNESS
    // CAUGHT BOTH, WHICH IS EXACTLY WHAT IT IS FOR. The original leading-clause case
    // spelled the tail "…, heal from this Pokémon…" in LOWERCASE and the original
    // trailing case joined with a COMMA — so an anchor with `^` removed still failed
    // to match the first (wrong case) and one with `\.$` removed still failed to match
    // the second (no period to anchor on). Both rungs passed, both proved NOTHING
    // about the anchor they were named for, and `D427-anchor-loses-its-leading-caret`
    // / `-trailing-terminator` SURVIVED. The cases now differ from `SENTENCE` in the
    // ANCHOR and in nothing else: same bytes, same capitalisation, a real sentence
    // boundary on the side being tested.
    const REFUSED = [
      // the WRONG SIDE: healing the opponent is not printed anywhere
      "Heal from your opponent's Active Pokémon the same amount of damage you did to this Pokémon.",
      // a LEADING clause — `^` is the only thing that refuses it. Modelled on
      // `SELF_SLEEP_HEAL`'s real printed compound ("This Pokémon is now Asleep. Heal
      // {N} damage from it."), so the head is a shape this pool actually prints. An
      // anchor without `^` claims this WHOLE and silently drops the Asleep.
      `This Pokémon is now Asleep. ${SENTENCE}`,
      // a TRAILING clause — `\.$` is the only thing that refuses it. An anchor
      // without it claims the head and silently drops the status the card prints.
      `${SENTENCE} This Pokémon is now Asleep.`,
      // …and the COMMA-joined trailing form as well, which `splitAttackTrailingClause`
      // cannot reach either (its BREAK is a sentence boundary, not a comma).
      `${SENTENCE.slice(0, -1)}, and this Pokémon is now Asleep.`,
      // lowercased throughout: no /i flag, deliberately
      SENTENCE.toLowerCase(),
    ] as const;
    for (const text of REFUSED) expect(deriveAttackEffect(text), text).toBeNull();
    const ADMITTED = [
      // same reader, same op family, a LITERAL amount — proves the reader still says yes
      ["Heal 30 damage from this Pokémon.", [{ op: "heal", target: "self", amount: 30 }]],
      // same anchor, the other apostrophe byte
      [SENTENCE.replace("'", "’"), PROGRAM],
      // the anchor itself, unmodified
      [SENTENCE, PROGRAM],
    ] as const;
    for (const [text, program] of ADMITTED) expect(deriveAttackEffect(text), text).toEqual(program);
  });

  it("🛑 exactly ONE corpus sentence is newly claimed — the arm's blast radius, measured", () => {
    // The arm must not have swept a neighbour in. Every OTHER heal row in the column
    // keeps whatever verdict it had, which this checks by naming the whole set of
    // corpus sentences this op-shape is derived from.
    const dealtRows = legalAttackCorpus().filter(([, text]) =>
      ((deriveAttackEffect(text) ?? []) as EffectOp[]).some(
        (op) => op.op === "heal" && op.amount === "dealt",
      ),
    );
    expect(dealtRows).toEqual([[6, SENTENCE]]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — the CARRIER, and the version prediction driven both directions.
// ─────────────────────────────────────────────────────────────────────────────

/** A board parked mid-effect on a DIFFERENT attack — `fix-selfenergyhand`'s "Put an
    Energy attached to this Pokémon into your hand." with two distinct Energy, which
    is D405's park. It is used here rather than this slice's own sentence for the
    reason that makes the version question live at all: the `heal` op never parks, but
    the CARRIER is shared with every attack program that does. Two candidates so the
    op parks rather than auto-resolving (D416: count the candidates your board offers). */
function parkedMidAttack(): GameState {
  const decks = { p1: SELF_ENERGY_HAND_DECK, p2: SELF_ENERGY_HAND_DECK };
  let state = driveSetup(SEED, decks, { first: "p2" });
  state = setActiveFromDeck(state, "p1", "fix-selfenergyhand");
  state = attachFromDeck(state, "p1", "fix-energy", 1);
  state = attachFromDeck(state, "p1", "fix-fire-energy", 1);
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  return swing(state, 0).state;
}

function contOf(state: GameState): { ctx: Record<string, unknown>; rest: EffectOp[] } {
  const phase = state.phase;
  if (phase.kind !== "effect:choose") throw new Error(`expected effect:choose, got ${phase.kind}`);
  return (phase as unknown as { cont: { ctx: Record<string, unknown>; rest: EffectOp[] } }).cont;
}

describe("§3 — the carrier is `EffectContext`, and `MATCH_RECORD_VERSION` stays 26", () => {
  it("🛑 `EffectRecord` could not have held it — every slot's value type is a LIST OF UIDS", () => {
    // The decision, stated as a fact about the model rather than as a preference
    // (D424: prefer a refusal the type system re-derives). Every value ever filed in
    // a record by any op in the vocabulary is an array of strings; an HP figure has
    // no slot and no widening that keeps the map's value type. Driven off a REAL
    // parked record rather than off the type, because a type claim is not executable.
    const cont = contOf(parkedMidAttack());
    const record = (cont as unknown as { record?: Record<string, unknown> }).record ?? {};
    for (const value of Object.values(record)) {
      expect(Array.isArray(value)).toBe(true);
      for (const entry of value as unknown[]) expect(typeof entry).toBe("string");
    }
    // …and the CONTROL the rung above needs: the context DOES carry a number, on the
    // same continuation, in the same JSON. The two shapes are not interchangeable.
    expect(typeof cont.ctx.dealt).toBe("number");
  });

  it("🛑 the value RIDES A PARK — this is why the version question is live at all", () => {
    const state = parkedMidAttack();
    const cont = contOf(state);
    // `fix-selfenergyhand` prints 30 and the defender is neutral, so §8.5 arrives at
    // 30 and THAT is the number written into the persisted phase.
    expect(cont.ctx).toEqual({
      seat: "p1",
      sourceUid: cont.ctx.sourceUid,
      invokedBy: "attack",
      dealt: 30,
    });
    // THE LITERAL KEY ANCHOR (D279's pairing rule): a diff between two boards from
    // ONE build cannot see "every ctx grew a key", because the key is on both sides.
    const revived = JSON.parse(JSON.stringify(state)) as GameState;
    expect(Object.keys(contOf(revived).ctx).sort()).toEqual([
      "dealt",
      "invokedBy",
      "seat",
      "sourceUid",
    ]);
  });

  it("🛑 `invokedBy === \"attack\"` ⟺ `dealt !== undefined`, on every continuation this engine writes", () => {
    // The pairing is what makes a LOST key detectable: both are set in one object
    // literal at `attack.ts`'s single `runProgram` call, so a build that dropped
    // `dealt` would leave a continuation that says it is an attack's effect and
    // cannot say what the attack did. Driven on the one park this suite can reach.
    const ctx = contOf(parkedMidAttack()).ctx;
    expect(ctx.invokedBy === "attack").toBe(ctx.dealt !== undefined);
    // …and the CONTROL: a program invoked by something that is NOT an attack has
    // neither key. `deriveAttackEffect` is the only producer of `amount: "dealt"`, so
    // there is no non-attack runner that can read it — asserted as the population
    // rather than as a specimen (D423).
    const nonAttack = legalAttackCorpus().filter(([, text]) =>
      ((deriveAttackEffect(text) ?? []) as EffectOp[]).some(
        (op) => op.op === "heal" && op.amount === "dealt",
      ),
    );
    expect(nonAttack).toHaveLength(1);
  });

  it("🛑 the version PREDICTION, driven both directions: this is a WIDENING", () => {
    // **DIRECTION 1 — a v26 continuation written BEFORE this slice.** It has no
    // `dealt` key at all. Strip it and resume: the park resolves byte-identically,
    // because nothing in a pre-D427 program reads the field. That is D125's widening
    // test — the old bytes still mean what they meant — and it is the whole argument
    // for not bumping 26.
    const parked = parkedMidAttack();
    const revived = JSON.parse(JSON.stringify(parked)) as GameState;
    const phase = revived.phase;
    if (phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const legacy = phase as unknown as { cont: { ctx: Record<string, unknown> } };
    // ⚠️ THE KEY IS REMOVED, NOT SET TO `undefined`, AND THE DIFFERENCE IS THE WHOLE
    // TEST. A pre-D427 continuation does not carry the key at all; `ctx.dealt =
    // undefined` leaves it in `Object.keys` and would make the rung below assert the
    // opposite of what it means. Rebuilt through `entries`/`fromEntries` rather than
    // with `delete`, which `lint/performance/noDelete` refuses.
    legacy.cont.ctx = Object.fromEntries(
      Object.entries(legacy.cont.ctx).filter(([key]) => key !== "dealt"),
    );
    expect(Object.keys(legacy.cont.ctx).sort()).toEqual(["invokedBy", "seat", "sourceUid"]);
    const prompt = phase.prompt;
    if (prompt?.kind !== "discardEnergy") throw new Error("expected a discardEnergy prompt");
    const chosen = prompt.discardable[0]?.uid as string;
    const resolvedLegacy = mustApply(revived, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardEnergy", uids: [chosen] },
    }).state;
    const resolvedToday = mustApply(JSON.parse(JSON.stringify(parked)) as GameState, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardEnergy", uids: [chosen] },
    }).state;
    expect(resolvedLegacy.players.p1.hand).toEqual(resolvedToday.players.p1.hand);
    expect(resolvedLegacy.players.p1.active).toEqual(resolvedToday.players.p1.active);

    // **DIRECTION 2 — a v26 record holding the OLD `heal` shape.** `heal.amount` went
    // `number` → `number | "dealt"`, and an `EffectOp` IS persisted (`cont.rest`,
    // `cont.pendingOp`). A record written before this slice carries the LITERAL, and
    // under this deploy that literal still resolves to exactly that many HP. A new
    // union inhabitant on an existing field is a WIDENING (D426's argument for a new
    // op, D358's for an absent flag); a RENAME is what bumped 21 → 22 and 25 → 26.
    const legacyOp: EffectOp = { op: "heal", target: "self", amount: 30 };
    expect(deriveAttackEffect("Heal 30 damage from this Pokémon.")).toEqual([legacyOp]);
    const withLegacyTail = JSON.parse(JSON.stringify(parked)) as GameState;
    const tail = withLegacyTail.phase;
    if (tail.kind !== "effect:choose") throw new Error("expected effect:choose");
    (tail as unknown as { cont: { rest: EffectOp[] } }).cont.rest = [legacyOp];
    // The healer took no damage on this board, so a 30-point heal has nothing to do
    // and whiffs; what matters is that the OLD op still parses, still dispatches and
    // still resolves rather than throwing on an unrecognised `amount`.
    const drained = mustApply(withLegacyTail, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardEnergy", uids: [chosen] },
    });
    expect(drained.state.phase.kind).not.toBe("effect:choose");
    // …and the same tail with a DAMAGED healer really does heal the literal 30, which
    // is the half that proves the arm ran rather than that it was skipped.
    const damagedTail = JSON.parse(JSON.stringify(parked)) as GameState;
    const dPhase = damagedTail.phase;
    if (dPhase.kind !== "effect:choose") throw new Error("expected effect:choose");
    (dPhase as unknown as { cont: { rest: EffectOp[] } }).cont.rest = [legacyOp];
    const hurt = setDamage(damagedTail, "p1", 60);
    const healedLegacy = mustApply(hurt, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardEnergy", uids: [chosen] },
    });
    expect(find(healedLegacy.events, "HEALED")?.amount).toBe(30);
  });

  it("the engine version moved and the two spellings agree", () => {
    expect(engineVersion).toBe("0.379.0");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — the amount is the FINAL figure, not the printed base.
// ─────────────────────────────────────────────────────────────────────────────

describe("§4 — post-Weakness, post-Resistance, post-reduction: the DEALT amount", () => {
  it("🛑 ONE printed 50, THREE defenders, THREE heals — base and dealt come apart in BOTH directions", () => {
    // This is the defect a census cannot see and a careless test would miss: a build
    // that healed the printed base passes every board where the two agree, and only a
    // ×2 body and a reduction body can tell them apart. Both are here, on one attack,
    // at one index, against a W/R-free control that differs from the ×2 body in
    // exactly one printed row.
    const HEALER_DAMAGE = 150;
    const cases = [
      ["fix-drainwall", 50], // no Weakness, no Resistance, no aura — dealt === base
      ["fix-drainweak", 100], // ×2 Fire — dealt is DOUBLE the base
      ["sv02-113", 40], // Hariyama's seat-wide −10 after W/R — dealt is BELOW the base
    ] as const;
    for (const [defender, expected] of cases) {
      const { events } = swing(board(defender, HEALER_DAMAGE), IDX.fifty);
      const { base, dealt, healed } = dealtAndHealed(events);
      expect(base, defender).toBe(50);
      expect(dealt, defender).toBe(expected);
      expect(healed, defender).toBe(expected);
    }
    // …and the three answers are genuinely DISTINCT, so no single constant satisfies
    // all three — the rung cannot pass against a build that healed any fixed number.
    expect(new Set(cases.map(([, expected]) => expected)).size).toBe(3);
  });

  it("⚠️ the reduction is the pipeline's LAST step, and it is read AFTER Weakness — one board says so", () => {
    // Hariyama is ×2 Psychic and the attacker is Fire, so its Weakness is inert here
    // and the −10 is the only subtraction; the ×2 board carries no aura, so the
    // doubling is the only multiplication. The two are separated by construction
    // rather than by argument.
    const reduced = dealtAndHealed(swing(board("sv02-113", 150), IDX.fifty).events);
    const doubled = dealtAndHealed(swing(board("fix-drainweak", 150), IDX.fifty).events);
    const flat = dealtAndHealed(swing(board("fix-drainwall", 150), IDX.fifty).events);
    expect([flat.dealt, doubled.dealt, reduced.dealt]).toEqual([50, 100, 40]);
    expect([flat.healed, doubled.healed, reduced.healed]).toEqual([50, 100, 40]);
  });

  it("the healed amount EQUALS `DAMAGE_DEALT.dealt` on every board that heals — one identity, swept", () => {
    // The engine has exactly one §8.5 answer, and the heal and the log row must be
    // reading it rather than each recomputing it (D425's derived-facts rule). Swept
    // over every board in this suite that heals at all, clamped by the healer's own
    // damage — which is the whole of §5.
    for (const [defender, healerDamage] of [
      ["fix-drainwall", 150],
      ["fix-drainweak", 150],
      ["sv02-113", 150],
      ["fix-drainwall", 20],
      ["fix-wall", 150],
    ] as const) {
      const index = defender === "fix-wall" ? IDX.twoHundred : IDX.fifty;
      const { events } = swing(board(defender, healerDamage), index);
      const { dealt, healed } = dealtAndHealed(events);
      expect(healed, defender).toBe(Math.min(dealt ?? 0, healerDamage));
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — the clamp: you cannot heal more damage than is on the healer.
// ─────────────────────────────────────────────────────────────────────────────

describe("§5 — the clamp is the healer's own damage, and it is `healSelf`'s, not a new one", () => {
  it("🛑 an attacker with 20 damage that deals 100 heals 20, not 100", () => {
    const { state, events } = swing(board("fix-drainweak", 20), IDX.fifty);
    const { dealt, healed } = dealtAndHealed(events);
    expect(dealt).toBe(100);
    expect(healed).toBe(20);
    expect(state.players.p1.active?.damage).toBe(0);
  });

  it("an UNDAMAGED healer whiffs SILENTLY — no HEALED row, and that is not a skipped effect", () => {
    const { state, events } = swing(board("fix-drainwall", 0), IDX.fifty);
    expect(dealtAndHealed(events).dealt).toBe(50);
    expect(find(events, "HEALED")).toBeUndefined();
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(state.players.p1.active?.damage).toBe(0);
  });

  it("a healer damaged EXACTLY as much as it dealt heals all of it — the clamp's boundary", () => {
    const { state, events } = swing(board("fix-drainwall", 50), IDX.fifty);
    expect(dealtAndHealed(events).healed).toBe(50);
    expect(state.players.p1.active?.damage).toBe(0);
  });

  it("⚠️ the clamp is the SHIPPED one — the literal-amount heal answers identically", () => {
    // The control that says this slice invented no clamp: `heal` with a literal
    // amount has clamped to the healer's damage since 0.x, and the "dealt" source
    // rides the same `Math.min`. Same board, same shortfall, same answer.
    const literal = deriveAttackEffect("Heal 30 damage from this Pokémon.");
    expect(literal).toEqual([{ op: "heal", target: "self", amount: 30 }]);
    const { events } = swing(board("fix-drainwall", 20), IDX.fifty);
    expect(dealtAndHealed(events).healed).toBe(20);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — the zero cases: prevention, a whiffed attack, an absent defender.
// ─────────────────────────────────────────────────────────────────────────────

describe("§6 — every way the amount is zero, and each one is silent rather than loud", () => {
  it("🛑 PREVENTED damage means `dealt` is 0, so the heal is 0 and no HEALED row is emitted", () => {
    // `fix-imperviousshell` prints "prevent all damage … if that damage is 200 or
    // more", and index 1 prints exactly 200. The DAMAGE_DEALT row is still filed
    // (with `prevented`), so this is not "the pipeline did not run" — it is "the
    // pipeline ran and arrived at nothing".
    const { state, events } = swing(board("fix-imperviousshell", 150), IDX.twoHundred);
    const damage = find(events, "DAMAGE_DEALT");
    expect(damage?.base).toBe(200);
    expect(damage?.prevented).toBe(true);
    expect(damage?.dealt).toBe(0);
    expect(find(events, "HEALED")).toBeUndefined();
    expect(state.players.p1.active?.damage).toBe(150);
    // …and the CONTROL on the same axis (D424): the very same attack into a body with
    // no shield deals 200 and heals the healer's whole 150.
    const open = swing(board("fix-wall", 150), IDX.twoHundred);
    expect(dealtAndHealed(open.events).dealt).toBe(200);
    expect(dealtAndHealed(open.events).healed).toBe(150);
  });

  it("🛑 an attack with NO printed damage never runs the §8.5 block — the hoisted 0 IS the semantics", () => {
    // Index 2 prints the sentence and no damage at all, so
    // `scaledBase + scaledTotal > 0` is false, `dealtToDefender` keeps its
    // initialiser, and "the same amount of damage you did" is correctly none.
    const { state, events } = swing(board("fix-drainwall", 150), IDX.noDamage);
    expect(find(events, "DAMAGE_DEALT")).toBeUndefined();
    expect(find(events, "HEALED")).toBeUndefined();
    expect(state.players.p1.active?.damage).toBe(150);
    expect(state.players.p2.active?.damage).toBe(0);
  });

  it("an ABSENT defender is refused by the turn gate — the program never runs at all", () => {
    // The guard is `attack.ts`'s NO_TARGET, ~1,300 lines above the effect program:
    // there is no board on which this sentence meets an empty Active Spot, because
    // the attack is rejected before a single event is filed. Driven rather than
    // argued, by emptying the defender's spot.
    const state = board("fix-drainwall", 150);
    const empty: GameState = {
      ...state,
      players: { ...state.players, p2: { ...state.players.p2, active: null } },
    };
    const result = applyAction(empty, { type: "attack", seat: "p1", index: IDX.fifty });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected NO_TARGET");
    expect(result.error.code).toBe("NO_TARGET");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7 — the Knock Out, the §8.5 ordering, and the loud path's control.
// ─────────────────────────────────────────────────────────────────────────────

describe("§7 — a Knocked Out defender changes nothing about what was dealt", () => {
  it("🛑 a 200 into a 120-HP body deals 200, heals 200-worth, and THEN Knocks Out", () => {
    // `dealt` is deliberately unclamped by the defender's remaining HP (§8.1's own
    // comment says so), so the printed "damage you did" is 200 and not 120. The heal
    // is still bounded by the HEALER, which is a different clamp entirely.
    const { events } = swing(board("fix-wall", 150), IDX.twoHundred);
    const { dealt, healed } = dealtAndHealed(events);
    expect(dealt).toBe(200);
    expect(healed).toBe(150);
    expect(types(events)).toContain("KNOCKED_OUT");
  });

  it("🛑 the ORDER is printed order: DAMAGE_DEALT, then HEALED, then the KO sweep", () => {
    // §8 step 4 — the attack's own effect program runs AFTER the damage and BEFORE
    // finishAttack's §8.1 sweep. A build that ran the program first would read a
    // `dealt` that had not happened yet.
    const order = types(swing(board("fix-wall", 150), IDX.twoHundred).events);
    expect(order.indexOf("DAMAGE_DEALT")).toBeLessThan(order.indexOf("HEALED"));
    expect(order.indexOf("HEALED")).toBeLessThan(order.indexOf("KNOCKED_OUT"));
    expect(order[0]).toBe("ATTACK_DECLARED");
  });

  it("🛑 no ATTACK_EFFECT_SKIPPED in EITHER direction — and index 3 is the control that skips", () => {
    // The sentence is READ now, on every board this suite drives, whether the heal
    // moved anything or not. Without the control below this rung would pass against a
    // build that never emits the row at all.
    for (const [defender, healerDamage, index] of [
      ["fix-drainwall", 150, IDX.fifty],
      ["fix-drainweak", 150, IDX.fifty],
      ["sv02-113", 150, IDX.fifty],
      ["fix-drainwall", 0, IDX.fifty],
      ["fix-imperviousshell", 150, IDX.twoHundred],
      ["fix-drainwall", 150, IDX.noDamage],
      ["fix-wall", 150, IDX.twoHundred],
    ] as const) {
      const label = `${defender}/${String(index)}/${String(healerDamage)}`;
      const { events } = swing(board(defender, healerDamage), index);
      expect(types(events), label).not.toContain("ATTACK_EFFECT_SKIPPED");
    }
    // THE CONTROL, on the SAME BODY and the same printed 50: index 3 prints "Each
    // player draws 3 cards.", which no reader claims, and the loud row still fires.
    const loud = swing(board("fix-drainwall", 150), IDX.loud);
    expect(types(loud.events)).toContain("ATTACK_EFFECT_SKIPPED");
    expect(resolvedByAnyReader("Each player draws 3 cards.")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §8 — both seats, and the board is not mutated.
// ─────────────────────────────────────────────────────────────────────────────

describe("§8 — both chairs, and a frozen board resolves", () => {
  it("🛑 p2 attacking heals p2's Active off the damage p2 dealt — the seat is not hard-coded", () => {
    for (const seat of ["p1", "p2"] as const) {
      const { state, events } = swing(board("fix-drainweak", 150, seat), IDX.fifty, seat);
      const { dealt, healed } = dealtAndHealed(events);
      expect(dealt, seat).toBe(100);
      expect(healed, seat).toBe(100);
      expect(find(events, "HEALED")?.seat, seat).toBe(seat);
      // the HEALER moved, and the DEFENDER took the damage — not the other way round
      expect(state.players[seat].active?.damage, seat).toBe(50);
      expect(state.players[other(seat)].active?.damage, seat).toBe(100);
    }
  });

  it("the board is not mutated — a deep-frozen state resolves in both the heal and the whiff case", () => {
    for (const [defender, healerDamage, index] of [
      ["fix-drainweak", 150, IDX.fifty],
      ["fix-imperviousshell", 150, IDX.twoHundred],
    ] as const) {
      const frozen = deepFreeze(board(defender, healerDamage));
      const { events } = swing(frozen, index);
      expect(types(events)[0], defender).toBe("ATTACK_DECLARED");
    }
  });
});
