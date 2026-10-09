import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import type { EffectOp } from "./effects";
import { deriveAttackEffect } from "./effects";
import {
  applyAction,
  createGame,
  engineVersion,
  programFor,
  redactGame,
} from "./index";
import type { GameEvent, GameState, InPlayPokemon, PokemonRef, Seat } from "./index";
import { type LogContext, logFromEvents } from "./log";
import {
  FIXTURE_POOL,
  attachBenchFromDeck,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  deepFreeze,
  firstBasicInHand,
  handFromDeck,
  handUid,
  must,
  mustApply,
  setActiveFromDeck,
  setBenchDamage,
  setDamage,
  types,
} from "./testFixtures";
import { koByEffectMarker } from "./types";

// 🆕🆕🆕 D540 — THE DEVOLUTION WITH A PICK IN IT, AND THE FAMILY CLOSES.
//
//   "Devolve 1 of your opponent's evolved Pokémon by putting the highest Stage
//    Evolution card on it into your opponent's hand."
//
// **1 sentence / 1 legal printing** — `censusAttackCorpus.ts` row 87.
//
// 🛑 **ONE PRINTING IS ONE PRINTING, AND THE CASE FOR THE ROW IS NOT THE YIELD.**
// Said at the top rather than left to be read out of the census delta: this is the
// smallest yield this engine buys. The three things that carry it are (a) the
// FAMILY CLOSURE — `/[Dd]evolv/` over the whole 640-sentence `legal_standard = 1`
// corpus returns exactly rows 87 and 88, **2 sentences / 4 printings**, and with
// this slice both RESOLVE, with NO Ancient/Future/Tera member in the family, so the
// closure is real and not an artefact of what is off the table; (b) the IN-TREE
// PRESCRIPTION written at D433 — *"The day it is built, the two ops share
// `devolveBody` in interpreter.ts rather than one widening into the other"* — which
// this slice honours as `devolveTargets` + `devolvedBodyOf` and NOTHING else; and
// (c) the near-total reuse: zero new prompt kinds, zero new answer inhabitants, zero
// new readers, zero new error codes, and `attackReaderSurface()` still 13.
//
// 🛑 **THE ONE SITE THE COMPILER CANNOT SEE IS WHAT THIS SUITE EXISTS FOR.**
// `applyChoice`'s `switch` ends in `default: return state;` (*"Synchronous ops never
// park, so never reach the choice path"*), so omitting `case "devolveChosen"` there
// TYPECHECKS GREEN and then silently discards the player's answer: the op parks, the
// prompt is answered, the board comes back unchanged, and no event, no log row and no
// census figure moves. **MEASURED, not argued**: deleting that arm at this head and
// running `bunx tsc -b --force` prints NOTHING, while deleting the `stepOp` arm prints
// `interpreter.ts(1768,4): error TS2366`. §4 is the rung that can see the invisible
// one, and it drives the PARKED ≥ 2 path THROUGH `resolveEffect` on a real board,
// asserting the HOSTS' stacks and the victim's HAND rather than the op's shape (D421).
//
// ⚠️ **IT PARKS, WHICH IS THE ONE PLACE THE SIBLING'S ARGUMENT DOES NOT TRANSFER.**
// `devolveEach`'s doc block ends *"…and the op never parks — so nothing it produces
// reaches `phase.cont`"*. That is TRUE of `devolveEach` and FALSE of this op. §10
// therefore drives the persistence question with `"cont" in phase === true` and a
// `pendingOp` that really is the new inhabitant — the half the sibling's suite could
// not reach — and `MATCH_RECORD_VERSION` still stays **30**, on D125's widening and
// NOT on a claim about parking.
//
// ⚠️ **NO CARD ID RESOLVES FOR THIS SENTENCE ON THIS CHECKOUT AND THAT WAS MEASURED.**
// A whole-repo sweep over the printed bytes finds SIX in-tree sites at HEAD — the
// corpus row, `devolveEach.test.ts`'s `SIBLING`, `bodiesInPlayScaling.test.ts`'s
// `Stage`-vocabulary enumeration, `effects.ts` twice and `index.ts` once — and NO
// catalog row. So this suite rides file-local DECLARED demonstrators `d540-*` (D425),
// in its OWN 60-card deck (D270).
// ⚠️ **AND THE INSTRUMENT IS NAMED EXACTLY.** A literal one-line `git grep -F` over the
// whole sentence reaches only THREE of the six (the corpus row, `devolveEach.test.ts:86`,
// `bodiesInPlayScaling.test.ts:1798`); `effects.ts:7855`, `effects.ts:24873` and
// `index.ts:18519` WRAP the sentence across lines, so they answer to a wrap-tolerant
// fragment instead. Six is the measured COUNT; the one-line grep is not what measured it.

const SENTENCE =
  "Devolve 1 of your opponent's evolved Pokémon by putting the highest Stage Evolution card on it into your opponent's hand.";
/** Corpus row 88 — the family's OTHER member, 3 legal printings, built at D433. Its
    op is the NEIGHBOUR of this one's arm (41-bis / 41-ter) and §2 is the four-cell
    matrix that replaces the first-word argument the two arms used to share. */
const SWEEP_SENTENCE =
  "Devolve each of your opponent's evolved Pokémon by shuffling the highest Stage Evolution card on it into your opponent's deck.";

const PICK = 0; // {C}, NO damage, the sentence — the pure "one body devolves" board
const PLAIN = 1; // {C}, NO damage, NO effect — the one-axis control
const BLOW = 2; // {C}, 60 damage, the sentence — damage AND the pick on one board
const SWEEP = 3; // {C}, NO damage, corpus row 88 — the SIBLING, on the same board

const LOCAL_CARDS: Record<string, Card> = {
  "d540-devolver": battler("d540-devolver", {
    types: ["Colorless"],
    hp: 300,
    retreat: 1,
    attacks: [
      { cost: ["Colorless"], name: "Hand Regression", effect: SENTENCE },
      { cost: ["Colorless"], name: "Plain Call" },
      { cost: ["Colorless"], name: "Regressive Blow", damage: 60, effect: SENTENCE },
      { cost: ["Colorless"], name: "Ancestral Call", effect: SWEEP_SENTENCE },
    ],
  }),
  /** The chain this suite devolves down: 60 / 90 / 140 HP, three distinct numbers so
      no assertion can be satisfied by the wrong body — `devolveEach.test.ts`'s recipe,
      re-declared file-locally rather than shared (D270/D412). */
  "d540-basic": battler("d540-basic", { types: ["Colorless"], hp: 60, retreat: 1 }),
  "d540-s1": battler("d540-s1", {
    types: ["Colorless"],
    hp: 90,
    retreat: 1,
    stage: "Stage1",
    evolveFrom: "d540-basic",
  }),
  "d540-s2": battler("d540-s2", {
    types: ["Colorless"],
    hp: 140,
    retreat: 1,
    stage: "Stage2",
    evolveFrom: "d540-s1",
  }),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

/** Its OWN deck (D270's rule): 4+8+6+6+4+4+8+12+4 = 56 … counted below rather than
    in prose, because a 60-card deck is a `createGame` precondition and a miscount is
    a mulligan storm rather than a red rung.
      • `d540-devolver` — the demonstrator, four indices;
      • `d540-basic` / `-s1` / `-s2` — the 60/90/140 chain, evolved by REAL `evolve`
        actions rather than by stack surgery, so `turnPlayed` and `evolvedTurn` arrive
        the way the engine writes them;
      • `fix-mist-energy` — Mist Energy `sv05-161`'s §11 effects-only shield, the
        cheapest live `preventAttackEffects` in the pool (§8);
      • `fix-titan` (340 HP) / `fix-bigbody` (200 HP) — bench filler nothing here can
        Knock Out, and the promote targets §7 needs;
      • `fix-energy` — Colorless Basic: every printed cost in this deck is {C}. */
const CHOSEN_DECK = deckOf({
  "d540-devolver": 4,
  "d540-basic": 8,
  "d540-s1": 6,
  "d540-s2": 6,
  "fix-mist-energy": 4,
  "fix-titan": 4,
  "fix-bigbody": 8,
  "fix-energy": 16,
  "sv03-197": 4,
});

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

function localSetup(seed: number, first: Seat): GameState {
  const created = createGame({ seed, decks: { p1: CHOSEN_DECK, p2: CHOSEN_DECK }, cardPool: POOL });
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

function pass(state: GameState, seat: Seat): GameState {
  return mustApply(state, { type: "endTurn", seat }).state;
}

/** Evolve `seat`'s body at `target` by drawing the evolution card into hand and
    playing a REAL `evolve` action — never by writing `stack` directly, so every field
    `devolvedBodyOf` sheds arrives the way `evolveOnto` wrote it. */
function evolveInto(
  state: GameState,
  seat: Seat,
  cardId: string,
  target: { spot: "active" } | { spot: "bench"; index: number },
): GameState {
  const held = handFromDeck(state, seat, cardId, 1);
  return mustApply(held, { type: "evolve", seat, uid: handUid(held, seat, cardId), target }).state;
}

interface BoardOpts {
  /** How far up the chain the VICTIM's Active is evolved. 0 = an unevolved Basic. */
  stages: 0 | 1 | 2;
  /** A second, BENCHED body on the victim's board, evolved one step. This is what
      turns the FORCED path into the PARKED one: two candidates ask. */
  benchStages?: 0 | 1;
  damage?: number;
  benchDamage?: number;
  /** Mist Energy onto the victim's BENCHED body (the §8 shield). */
  shieldBench?: boolean;
  /** Mist Energy onto the victim's ACTIVE (§8's other side). */
  shieldActive?: boolean;
  /** Which seat attacks. The other seat is the victim. */
  attacker?: Seat;
  energy?: number;
  /** Give the ATTACKER an evolved benched body too — the control that proves the
      funnel reads "your opponent's" and not "every". */
  attackerEvolves?: boolean;
}

/** ONE board, built by real actions: the ATTACKER opens and passes, the VICTIM evolves
    on each of its own turns, and the attacker declares on the turn after the last
    evolution. `devolveEach.test.ts`'s recipe, re-declared here on `d540-*` cards. */
function armed(seed: number, opts: BoardOpts): GameState {
  const attacker = opts.attacker ?? "p1";
  const victim = attacker === "p1" ? "p2" : "p1";
  let state = localSetup(seed, attacker);
  state = setActiveFromDeck(state, attacker, "d540-devolver");
  state = clearBench(state, attacker);
  state = attachFromDeck(state, attacker, "fix-energy", opts.energy ?? 2);
  if (opts.attackerEvolves === true) state = benchFromDeck(state, attacker, "d540-basic");
  state = setActiveFromDeck(state, victim, "d540-basic");
  state = clearBench(state, victim);
  if (opts.benchStages !== undefined) state = benchFromDeck(state, victim, "d540-basic");
  state = benchFromDeck(state, victim, "fix-titan");
  state = benchFromDeck(state, victim, "fix-bigbody");

  // Turn 1 is the ATTACKER's (§4 forbids its attack anyway) and turn 2 is the VICTIM's
  // OWN first turn, on which §4/§10 forbids evolving — so both are passed before any
  // evolution, and each evolution then costs a full round.
  state = pass(state, attacker);
  state = pass(state, victim);
  const rounds = Math.max(opts.stages, opts.benchStages ?? 0, opts.attackerEvolves === true ? 1 : 0);
  for (let step = 0; step < rounds; step += 1) {
    if (step === 0 && opts.attackerEvolves === true) {
      state = evolveInto(state, attacker, "d540-s1", { spot: "bench", index: 0 });
    }
    state = pass(state, attacker);
    if (step < opts.stages) {
      state = evolveInto(state, victim, step === 0 ? "d540-s1" : "d540-s2", { spot: "active" });
    }
    if (step < (opts.benchStages ?? 0)) {
      state = evolveInto(state, victim, "d540-s1", { spot: "bench", index: 0 });
    }
    state = pass(state, victim);
  }
  if (opts.damage !== undefined) state = setDamage(state, victim, opts.damage);
  if (opts.benchDamage !== undefined) state = setBenchDamage(state, victim, 0, opts.benchDamage);
  if (opts.shieldActive === true) state = attachFromDeck(state, victim, "fix-mist-energy", 1);
  if (opts.shieldBench === true) state = attachBenchFromDeck(state, victim, 0, "fix-mist-energy", 1);
  return state;
}

function strike(state: GameState, seat: Seat, index: number) {
  return mustApply(state, { type: "attack", seat, index });
}

/** Answer the parked `choosePokemon` prompt with `ref`. */
function answer(state: GameState, seat: Seat, ref: PokemonRef) {
  return mustApply(state, { type: "resolveEffect", seat, choice: { kind: "pokemon", ref } });
}

/** The parked prompt, or a throw — so a rung that MEANT to drive the park cannot
    quietly pass against a board that forced instead (D424's live-axis question). */
function parked(state: GameState): {
  candidates: PokemonRef[];
  note: string;
  pendingOp: EffectOp | undefined;
} {
  const phase = state.phase;
  if (phase.kind !== "effect:choose") throw new Error(`expected effect:choose, got ${phase.kind}`);
  const prompt = phase.prompt as { kind: string; candidates?: PokemonRef[]; note?: string };
  if (prompt.kind !== "choosePokemon") throw new Error(`expected choosePokemon, got ${prompt.kind}`);
  return {
    candidates: prompt.candidates ?? [],
    note: prompt.note ?? "",
    pendingOp: (phase.cont as { pendingOp?: EffectOp }).pendingOp,
  };
}

/** Walk the §8.1 stages a Knock Out queues — Prize, then promotion. */
function settle(state: GameState): GameState {
  let next = state;
  for (let guard = 0; guard < 12; guard += 1) {
    if (next.phase.kind === "ko:takePrizes") {
      const { seat, count: owed } = next.phase;
      next = must(
        applyAction(next, {
          type: "takePrizes",
          seat,
          prizeIndices: Array.from({ length: owed }, (_, i) => i),
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

function idOf(state: GameState, uid: string): string | undefined {
  return state.cardIdByUid[uid];
}

const ACTIVE: PokemonRef = { seat: "p2", spot: { spot: "active" } };
const BENCH0: PokemonRef = { seat: "p2", spot: { spot: "bench", index: 0 } };

// ─────────────────────────────────────────────────────────────────────────────
// §1 — THE DERIVATION, off the LIVE module, and the family closure it buys.
// ─────────────────────────────────────────────────────────────────────────────
describe("§1 — the sentence derives to ONE field-free op", () => {
  it("the printed sentence derives to exactly `[{ op: 'devolveChosen' }]`", () => {
    expect(deriveAttackEffect(SENTENCE)).toEqual([{ op: "devolveChosen" }]);
  });

  it("the corpus row is the byte-for-byte string this suite asserts against", () => {
    // D183/D456 — author and assert against the PRINTED bytes, never a paraphrase. The
    // row is looked up in the live corpus rather than quoted from memory, so a
    // re-ingest that curls an apostrophe reddens HERE.
    const rows = legalAttackCorpus().filter(([, text]) => /[Dd]evolv/.test(text));
    // 🛑 THE FAMILY, asserted off the corpus rather than written in prose: the loosest
    // plausible pattern for it is the bare stem, and it returns TWO rows. A third
    // devolve sentence entering the legal column reddens here by construction (D422).
    expect(rows).toHaveLength(2);
    expect(rows.map(([, text]) => text).sort()).toEqual([SENTENCE, SWEEP_SENTENCE].sort());
    expect(rows.find(([, text]) => text === SENTENCE)?.[0]).toBe(1);
    expect(rows.find(([, text]) => text === SWEEP_SENTENCE)?.[0]).toBe(3);
    // …and the PRINTING total, read rather than inferred from the sentence count: the
    // sentence step of this slice is 1 and the printing step is 1, the FIRST slice in
    // six where the two AGREE (D535 1-2, D536 1-3, D537 1-2, D538 1-3, D539 1-2), which
    // is the one situation in which a copied number would be right by accident (D426).
    expect(rows.reduce((sum, [n]) => sum + n, 0)).toBe(4);
  });

  it("🛑 THE FAMILY IS CLOSED — both devolve rows now resolve, and neither is off the table", () => {
    // The whole case for the row. `resolvedByAnyReader` is the census's own predicate,
    // so this is the figure the residue is computed from and not a second opinion.
    expect(resolvedByAnyReader(SENTENCE)).toBe(true);
    expect(resolvedByAnyReader(SWEEP_SENTENCE)).toBe(true);
    // …and NO member of the family is an Ancient/Future/Tera row, which is what makes
    // the closure real rather than an artefact of what is deliberately off the table.
    const rows = legalAttackCorpus().filter(([, text]) => /[Dd]evolv/.test(text));
    expect(rows.filter(([, t]) => /Ancient|Future|Tera /.test(t))).toEqual([]);
    expect(rows.filter(([, t]) => !resolvedByAnyReader(t))).toEqual([]);
  });

  it("the op reaches a real attack program through `programFor`'s fallback", () => {
    // The seam is TEXT-keyed: no registry row is authored, so the program comes off
    // `deriveAttackEffect` at declaration time.
    expect(programFor("d540-devolver")?.attack).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — THE 2×2 ANCHOR-ORDER MATRIX (anchor × string), driven off the live module.
//
//      🛑 WHY THIS SECTION EXISTS AND WHY IT IS A MATRIX. Arm 41-bis shipped with
//      an order-freeness argument that read *"the first WORD differs ('Devolve' vs
//      'Shuffle'/'Put'/'Flip')"*. Arm 41-ter's first word is ALSO "Devolve", so that
//      sentence is FALSE AS WRITTEN for the nearest neighbour pair — and nothing could
//      see it, because a comment carries no assertion and a `git grep -F` over the
//      SENTENCE does not find a withdrawn CLAIM. It is re-pointed in place (D178/D418)
//      and the order-free claim now rests on **TOKEN 2** (`each` vs `1`) plus both
//      anchors being fully `^…$`. That is what this matrix drives.
// ─────────────────────────────────────────────────────────────────────────────
describe("§2 — anchor × string, all four cells", () => {
  it("CELL (each-anchor, row 88) — the sweep anchor claims the sweep sentence", () => {
    expect(deriveAttackEffect(SWEEP_SENTENCE)).toEqual([{ op: "devolveEach" }]);
  });

  it("🛑 CELL (each-anchor, row 87) — the sweep anchor REFUSES this sentence", () => {
    // A REAL measurement and not an inference: arm 41-bis is asked FIRST (41-ter sits
    // immediately below it), so had `DEVOLVE_EACH_TO_DECK` matched row 87 the
    // derivation would read `devolveEach` and this rung would be RED.
    expect(deriveAttackEffect(SENTENCE)?.[0]?.op).toBe("devolveChosen");
    expect(deriveAttackEffect(SENTENCE)?.[0]?.op).not.toBe("devolveEach");
  });

  it("CELL (1-of-anchor, row 87) — this anchor claims this sentence", () => {
    expect(deriveAttackEffect(SENTENCE)).toEqual([{ op: "devolveChosen" }]);
  });

  it("🛑 CELL (1-of-anchor, row 88) — the cell arm ORDER masks, made observable instead", () => {
    // ⚠️ SAID RATHER THAN CLAIMED AS A DIRECT MEASUREMENT. 41-ter is asked SECOND, so a
    // match here would be masked by 41-bis and `deriveAttackEffect(SWEEP_SENTENCE)`
    // cannot distinguish it. The cell is reached by composing TWO measurements the
    // module DOES expose:
    //   (a) 41-ter requires the `putting … hand` TAIL — row 88's tail, spliced onto
    //       this sentence's `1 of` head, derives to NULL;
    //   (b) 41-bis requires the `shuffling … deck` TAIL — this sentence's tail, spliced
    //       onto row 88's `each of` head, derives to NULL.
    // A pattern that required neither tail would build one of the two hybrids. Row 88
    // has this anchor's head on NEITHER token, so it cannot reach 41-ter's pattern.
    const oneOfIntoDeck = SENTENCE.replace(
      "by putting the highest Stage Evolution card on it into your opponent's hand.",
      "by shuffling the highest Stage Evolution card on it into your opponent's deck.",
    );
    const eachIntoHand = SWEEP_SENTENCE.replace(
      "by shuffling the highest Stage Evolution card on it into your opponent's deck.",
      "by putting the highest Stage Evolution card on it into your opponent's hand.",
    );
    expect(oneOfIntoDeck).not.toBe(SENTENCE);
    expect(oneOfIntoDeck).not.toBe(SWEEP_SENTENCE);
    expect(eachIntoHand).not.toBe(SENTENCE);
    expect(eachIntoHand).not.toBe(SWEEP_SENTENCE);
    expect(deriveAttackEffect(oneOfIntoDeck)).toBeNull();
    // 🆕🆕🆕 D615 (D539): ~~`eachIntoHand` derives to NULL~~ — that hybrid is PRINTED (Espeon `30th-069`
    // "Miraculous Shine") and is claimed EARLIER by WP31a's arm 6e-ter (`DEVOLVE_EACH_TO_HAND`) as
    // `devolveEach` with `toHand`, so it can no longer reach 41-bis and leg (b) cannot go red through it.
    expect(eachIntoHand).toBe(
      "Devolve each of your opponent's evolved Pokémon by putting the highest Stage Evolution card on it into your opponent's hand.",
    );
    expect(deriveAttackEffect(eachIntoHand)).toEqual([{ op: "devolveEach", toHand: true }]);
    // (b) re-measured (D615 review M4): row 88's head AND verb with only the destination moved to "hand".
    // 6e-ter refuses it (its verb is "putting"), 41-ter refuses it (`1 of`), so a NULL here is 41-bis
    // refusing a tail that is not its `deck` — killed by `D615-devolve-deck-anchor-loses-destination`.
    const eachShuffledIntoHand = SWEEP_SENTENCE.replace("your opponent's deck.", "your opponent's hand.");
    expect(eachShuffledIntoHand).not.toBe(SWEEP_SENTENCE);
    expect(deriveAttackEffect(eachShuffledIntoHand)).toBeNull();
  });

  it("🛑 TOKEN 2 IS THE AXIS — the two sentences differ there and nowhere in the head", () => {
    // The re-pointed claim, driven rather than re-asserted in prose: the two printed
    // strings agree on token 1 ("Devolve") and disagree on token 2 ("1" vs "each").
    expect(SENTENCE.split(" ")[0]).toBe(SWEEP_SENTENCE.split(" ")[0]);
    expect(SENTENCE.split(" ")[0]).toBe("Devolve");
    expect(SENTENCE.split(" ")[1]).toBe("1");
    expect(SWEEP_SENTENCE.split(" ")[1]).toBe("each");
  });

  const NEAR_MISSES: [string, string][] = [
    ["the OWN side", SENTENCE.replace("1 of your opponent's evolved", "1 of your evolved")],
    ["the DESTINATION", SENTENCE.replace("opponent's hand.", "opponent's deck.")],
    ["the VERB", SENTENCE.replace("by putting", "by shuffling")],
    ["the QUANTIFIER", SENTENCE.replace("Devolve 1 of", "Devolve 2 of")],
    ["the FILTER", SENTENCE.replace("evolved Pokémon", "Pokémon")],
    ["the STAGE WORD", SENTENCE.replace("highest Stage Evolution", "lowest Stage Evolution")],
    // 🛑 A PREFIX THAT KEEPS THE CAPITAL `D`, which is D539(1a)'s lesson paid forward:
    // a leading clause glued on by LOWER-CASING the sentence's first letter refuses for
    // a DIFFERENT reason (the pattern demands a capital "Devolve" wherever it starts)
    // and never exercises the `^` at all.
    ["a LEADING clause, capital KEPT", `Discard an Energy from this Pokémon. ${SENTENCE}`],
    ["a LEADING clause, lower-cased", `If you have any Benched Pokémon, ${SENTENCE[0]?.toLowerCase()}${SENTENCE.slice(1)}`],
    // 🛑 TWO trailing spellings, and only ONE of them exercises the `$`. Stripping the
    // PERIOD (`slice(0, -1)`) makes the string refuse because the anchor's tail demands
    // `hand\.` — a DIFFERENT reason — so the `$`-less pattern would refuse it too and the
    // `$` is never tested. The KEPT-period spelling is the killer: with `$` gone the
    // anchor matches the PREFIX and the engine authors a program for a card whose
    // trailing clause it silently dropped. D539(1a)'s caret lesson, at the other end.
    ["a TRAILING clause, period STRIPPED", `${SENTENCE.slice(0, -1)} Then, draw a card.`],
    ["a TRAILING clause, period KEPT", `${SENTENCE} Then, draw a card.`],
  ];

  for (const [axis, text] of NEAR_MISSES) {
    it(`refuses a string differing only in ${axis}`, () => {
      expect(deriveAttackEffect(text)).toBeNull();
      expect(text).not.toBe(SENTENCE);
    });
  }

  // ── the `['’]` CLASS, one slot at a time ──
  //
  // 🛑 THE CORPUS PRINTS U+0027 AT BOTH SLOTS AND THAT WAS MEASURED (sentence indices 26
  // and 113), so collapsing either class to the straight quote leaves every board green
  // and every census figure still. The class is D137's rule about the SITE of a spelled
  // apostrophe, not about today's bytes — and a rule nothing can see is not a rule, so
  // each slot gets its OWN curly board. Separately, because one rung covering both
  // would be satisfied by whichever half the reader happens to reach (D424).
  const CURLY_SLOT_1 = `${SENTENCE.slice(0, 26)}\u2019${SENTENCE.slice(27)}`;
  const CURLY_SLOT_2 = `${SENTENCE.slice(0, 113)}\u2019${SENTENCE.slice(114)}`;

  it("🛑 SLOT 1 — a CURLED first possessive still derives (the `['’]` class is real)", () => {
    // The index is asserted rather than trusted: a re-ingest that moves the possessive
    // would otherwise curl a letter and leave this rung green for the wrong reason.
    expect(SENTENCE[26]).toBe("'");
    expect(CURLY_SLOT_1).not.toBe(SENTENCE);
    expect(CURLY_SLOT_1).toContain("opponent\u2019s evolved");
    expect(deriveAttackEffect(CURLY_SLOT_1)).toEqual([{ op: "devolveChosen" }]);
  });

  it("🛑 SLOT 2 — a CURLED second possessive still derives", () => {
    expect(SENTENCE[113]).toBe("'");
    expect(CURLY_SLOT_2).not.toBe(SENTENCE);
    expect(CURLY_SLOT_2).toContain("opponent\u2019s hand.");
    expect(deriveAttackEffect(CURLY_SLOT_2)).toEqual([{ op: "devolveChosen" }]);
  });

  it("…and BOTH curled together derives too — the class is on both slots", () => {
    const both = `${CURLY_SLOT_1.slice(0, 113)}\u2019${CURLY_SLOT_1.slice(114)}`;
    expect(both).not.toBe(SENTENCE);
    expect(deriveAttackEffect(both)).toEqual([{ op: "devolveChosen" }]);
  });

  it("🛑 THE CONTROL — the corpus row itself prints U+0027 at BOTH slots", () => {
    // The measurement the two rungs above rest on, taken off the LIVE corpus rather
    // than from this file's constant, so a re-ingest reddens here first.
    const row = legalAttackCorpus().find(([, t]) => t === SENTENCE)?.[1] ?? "";
    expect(row).toBe(SENTENCE);
    expect(row.codePointAt(26)).toBe(0x27);
    expect(row.codePointAt(113)).toBe(0x27);
    expect(row).not.toContain("\u2019");
  });

  it("🛑 THE ADMISSION CONTROL — the reader still says YES to the real sentence", () => {
    // Without this every rung above passes against a reader that refuses everything
    // (D424).
    expect(deriveAttackEffect(SENTENCE)).toEqual([{ op: "devolveChosen" }]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — THE FORCED PATH: one candidate is not a decision (the M1 rule).
// ─────────────────────────────────────────────────────────────────────────────
describe("§3 — a lone evolved body is FORCED, with no prompt at all", () => {
  it("the Active devolves with no `effect:choose` phase and no prompt", () => {
    const before = armed(11, { stages: 1 });
    expect(body(before.players.p2.active).stack).toHaveLength(2);
    const { state, events } = strike(before, "p1", PICK);
    // No park: `parkOrForce`'s one-candidate arm resolves inline, so the attack ran to
    // the turn boundary.
    expect(state.phase.kind).not.toBe("effect:choose");
    const devolved = all(events, "POKEMON_DEVOLVED");
    expect(devolved).toHaveLength(1);
    expect(devolved[0]?.seat).toBe("p2");
    expect(devolved[0]?.actor).toBe("p1");
    expect(devolved[0]?.zone).toBe("hand");
  });

  it("the stack shortens by ONE and the top is the Basic again", () => {
    const { state } = strike(armed(11, { stages: 1 }), "p1", PICK);
    const after = body(state.players.p2.active);
    expect(after.stack).toHaveLength(1);
    expect(idOf(state, must0(after.stack))).toBe("d540-basic");
  });

  it("🛑 the card is in the VICTIM's hand, and NO shuffle fired", () => {
    const before = armed(11, { stages: 1 });
    const top = must0(body(before.players.p2.active).stack.slice(-1));
    const { state, events } = strike(before, "p1", PICK);
    expect(types(events)).not.toContain("SHUFFLE");
    // The victim drew at the top of its own turn, so the two library zones are asked
    // about together where the board is not parked — but the DEVOLVED uid is pinned to
    // the hand specifically.
    expect(state.players.p2.hand).toContain(top);
    expect(state.players.p2.deck).not.toContain(top);
    expect(state.players.p2.discard).not.toContain(top);
  });

  it("🛑 it never touches the ATTACKER's OWN evolved bodies", () => {
    // The control that proves `devolveTargets` reads "your opponent's" and not "every".
    const before = armed(12, { stages: 1, attackerEvolves: true });
    expect(body(before.players.p1.bench[0]).stack).toHaveLength(2);
    const { state, events } = strike(before, "p1", PICK);
    expect(all(events, "POKEMON_DEVOLVED")).toHaveLength(1);
    expect(body(state.players.p1.bench[0]).stack).toHaveLength(2);
    expect(body(state.players.p2.active).stack).toHaveLength(1);
  });

  it("BOTH SEATS — p2 attacking p1 devolves p1's board and fills p1's hand", () => {
    const before = armed(13, { stages: 1, attacker: "p2" });
    const top = must0(body(before.players.p1.active).stack.slice(-1));
    const { state, events } = strike(before, "p2", PICK);
    const devolved = find(events, "POKEMON_DEVOLVED");
    expect(devolved?.seat).toBe("p1");
    expect(devolved?.actor).toBe("p2");
    expect(state.players.p1.hand).toContain(top);
    expect(state.players.p2.hand).not.toContain(top);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 🛑 §4 — THE PARKED ≥ 2 PATH, DRIVEN THROUGH `resolveEffect`.
//
//      THIS IS THE SITE THE COMPILER CANNOT SEE. Deleting `applyChoice`'s
//      `case "devolveChosen"` typechecks GREEN (measured with `tsc -b --force`) and
//      silently discards the answer. Every rung below asserts the HOSTS' STACKS and
//      the VICTIM's HAND on a real board — never the op's shape (D421, and D539's §4
//      lesson).
// ─────────────────────────────────────────────────────────────────────────────
describe("🛑 §4 — two candidates PARK, and the answer really moves the board", () => {
  it("the attack parks on `choosePokemon` with BOTH evolved bodies offered", () => {
    const { state } = strike(armed(21, { stages: 1, benchStages: 1 }), "p1", PICK);
    const { candidates } = parked(state);
    // `oppAnyRefs`' order: the Active first, then the Bench in index order.
    expect(candidates).toEqual([ACTIVE, BENCH0]);
  });

  it("the prompt's note is the PRINTED sentence, possessive included", () => {
    const { state } = strike(armed(21, { stages: 1, benchStages: 1 }), "p1", PICK);
    expect(parked(state).note).toBe(SENTENCE);
  });

  it("🛑 ANSWERING 'the Active' devolves the ACTIVE and leaves the BENCH alone", () => {
    const before = armed(21, { stages: 1, benchStages: 1 });
    const activeTop = must0(body(before.players.p2.active).stack.slice(-1));
    const { state: waiting } = strike(before, "p1", PICK);
    const { state, events } = answer(waiting, "p1", ACTIVE);
    expect(body(state.players.p2.active).stack).toHaveLength(1);
    expect(body(state.players.p2.bench[0]).stack).toHaveLength(2);
    expect(state.players.p2.hand).toContain(activeTop);
    expect(all(events, "POKEMON_DEVOLVED")).toHaveLength(1);
    expect(find(events, "POKEMON_DEVOLVED")?.zone).toBe("hand");
    expect(types(events)).not.toContain("SHUFFLE");
  });

  it("🛑 ANSWERING 'the Bench' devolves the BENCH and leaves the ACTIVE alone", () => {
    const before = armed(21, { stages: 1, benchStages: 1 });
    const benchTop = must0(body(before.players.p2.bench[0]).stack.slice(-1));
    const { state: waiting } = strike(before, "p1", PICK);
    const { state, events } = answer(waiting, "p1", BENCH0);
    expect(body(state.players.p2.bench[0]).stack).toHaveLength(1);
    expect(body(state.players.p2.active).stack).toHaveLength(2);
    expect(state.players.p2.hand).toContain(benchTop);
    expect(all(events, "POKEMON_DEVOLVED")).toHaveLength(1);
  });

  it("🛑 THE TWO ANSWERS PRODUCE DIFFERENT BOARDS — the answer is not discarded", () => {
    // The rung that dies the moment `applyChoice`'s arm is deleted: with the answer
    // dropped BOTH boards come back with two full stacks and these are equal.
    const before = armed(22, { stages: 1, benchStages: 1 });
    const { state: waiting } = strike(before, "p1", PICK);
    const pickActive = answer(waiting, "p1", ACTIVE).state;
    const pickBench = answer(waiting, "p1", BENCH0).state;
    expect(body(pickActive.players.p2.active).stack).toHaveLength(1);
    expect(body(pickBench.players.p2.active).stack).toHaveLength(2);
    expect(body(pickActive.players.p2.bench[0]).stack).toHaveLength(2);
    expect(body(pickBench.players.p2.bench[0]).stack).toHaveLength(1);
    expect(pickActive.players.p2.active).not.toEqual(pickBench.players.p2.active);
  });

  it("🛑 A FORCED DEVOLUTION AND AN ANSWERED ONE ARE THE SAME BOARD", () => {
    // One writer, two entry points — the whole reason `devolveBodyToHand` exists.
    // The forced board offers ONE candidate; the parked board is answered with the
    // SAME spot, and the victim's Active must come out identical.
    const forced = strike(armed(23, { stages: 1 }), "p1", PICK).state;
    const asked = answer(strike(armed(23, { stages: 1, benchStages: 1 }), "p1", PICK).state, "p1", ACTIVE)
      .state;
    expect(body(asked.players.p2.active).stack).toEqual(body(forced.players.p2.active).stack);
    expect(body(asked.players.p2.active).conditions).toEqual(
      body(forced.players.p2.active).conditions,
    );
    expect(body(asked.players.p2.active).evolvedTurn).toBe(
      body(forced.players.p2.active).evolvedTurn,
    );
  });

  it("the parked op is MANDATORY — no `upTo` on the prompt, so a decline is not offered", () => {
    const { state } = strike(armed(21, { stages: 1, benchStages: 1 }), "p1", PICK);
    const phase = state.phase;
    if (phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(Object.keys(phase.prompt)).not.toContain("upTo");
    // …and no `answerer` is filed: the print says neither "You may" nor "(Your
    // opponent chooses …)", so the pick is the ATTACKER's.
    expect((phase as { answerer?: Seat }).answerer).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — THE EMPTY CANDIDATE SET: a silent no-op, every sibling's contract.
// ─────────────────────────────────────────────────────────────────────────────
describe("§5 — an entirely UNEVOLVED opponent board is a silent no-op", () => {
  it("no devolve row, no refusal row, no skip row, no prompt", () => {
    const before = armed(31, { stages: 0 });
    expect(body(before.players.p2.active).stack).toHaveLength(1);
    const { state, events } = strike(before, "p1", PICK);
    expect(types(events)).not.toContain("POKEMON_DEVOLVED");
    expect(types(events)).not.toContain("ATTACK_EFFECT_PREVENTED");
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(types(events)).not.toContain("SHUFFLE");
    expect(state.phase.kind).not.toBe("effect:choose");
  });

  it("🛑 `===` ON THE BODY — `parkOrForce`'s empty arm returns the state it was given", () => {
    // The identity half. `parkOrForce` returns `{ done: state }` for an empty candidate
    // set, so nothing downstream rebuilds the victim's bodies: the OBJECTS survive the
    // attack. A rung on lengths alone would also pass against a writer that rebuilt an
    // identical body, which is not what "silent no-op" means.
    const before = armed(31, { stages: 0 });
    const activeBefore = before.players.p2.active;
    const benchBefore = before.players.p2.bench;
    const { state } = strike(before, "p1", PICK);
    expect(state.players.p2.active).toBe(activeBefore);
    expect(state.players.p2.bench).toBe(benchBefore);
  });

  it("the no-effect control behaves the same — an absent sentence is not a gap", () => {
    const { events } = strike(armed(31, { stages: 1 }), "p1", PLAIN);
    expect(types(events)).not.toContain("POKEMON_DEVOLVED");
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — "the highest Stage Evolution card" is ONE card, not the whole stack.
// ─────────────────────────────────────────────────────────────────────────────
describe("§6 — a Stage 2 devolves to its Stage 1, NOT to its Basic", () => {
  it("the three-card stack becomes a TWO-card stack topped by the Stage 1", () => {
    const before = armed(41, { stages: 2 });
    expect(body(before.players.p2.active).stack).toHaveLength(3);
    const { state } = strike(before, "p1", PICK);
    const after = body(state.players.p2.active);
    expect(after.stack).toHaveLength(2);
    expect(idOf(state, must0(after.stack.slice(-1)))).toBe("d540-s1");
    expect(idOf(state, must0(after.stack))).toBe("d540-basic");
  });

  it("EXACTLY ONE card moved, and it is the Stage 2", () => {
    const before = armed(41, { stages: 2 });
    const stage2 = must0(body(before.players.p2.active).stack.slice(-1));
    const stage1 = must0(body(before.players.p2.active).stack.slice(-2, -1));
    const { state } = strike(before, "p1", PICK);
    expect(state.players.p2.hand).toContain(stage2);
    expect(state.players.p2.hand).not.toContain(stage1);
    expect(idOf(state, stage2)).toBe("d540-s2");
  });

  it("the survivor's HP is the STAGE 1's, which is what the KO check will read", () => {
    const { state } = strike(armed(41, { stages: 2, damage: 50 }), "p1", PICK);
    const after = body(state.players.p2.active);
    // 140 → 90: three distinct numbers in the chain, so this cannot be satisfied by
    // the wrong body.
    expect(POOL[idOf(state, must0(after.stack.slice(-1))) ?? ""]?.hp).toBe(90);
    expect(after.damage).toBe(50);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 🛑 §7 — devolving Knocks Out by lowering the MAXIMUM, with its Prize and promotion.
// ─────────────────────────────────────────────────────────────────────────────
describe("🛑 §7 — the KO by maximum, its cause, its Prize and its promotion", () => {
  it("a 100-damage Stage 2 dropping to a 90 HP Stage 1 is Knocked Out", () => {
    // No damage is dealt and no counter is placed: `isLethallyDamaged` is a
    // `damage >= effectiveMaxHp` STATE check and the maximum moved under it.
    const { state, events } = strike(armed(51, { stages: 2, damage: 100 }), "p1", PICK);
    expect(all(events, "DAMAGE_DEALT")).toHaveLength(0);
    expect(state.phase.kind).toBe("ko:takePrizes");
  });

  it("`lastKoMarks` records `byAttack: false` — the CAUSE is the maximum, not damage", () => {
    // D414's stamp is written by the writer and read by `flow.ts`; the body is gone by
    // the time the epilogue ends, so the marker is observed through the FACT it decides
    // rather than off the board — `devolveEach.test.ts` §6's instrument, on the op that
    // reaches it through a PICK instead of a sweep.
    const { state } = strike(armed(51, { stages: 2, damage: 100 }), "p1", PICK);
    const marks = state.lastKoMarks.p2;
    expect(marks).toHaveLength(1);
    expect(marks[0]?.byAttack).toBe(false);
    expect(state.lastKoTurn.p2).toBe(state.turn);
  });

  it("a devolved SURVIVOR is never marked — the observable half of the same stamp", () => {
    const { state } = strike(armed(51, { stages: 2, damage: 80 }), "p1", PICK);
    expect(body(state.players.p2.active).markers).toEqual([]);
    expect(koByEffectMarker(state.turn)).not.toBe("");
  });

  it("🛑 THE CONTROL — 80 damage on the same board does NOT Knock Out", () => {
    const { state, events } = strike(armed(51, { stages: 2, damage: 80 }), "p1", PICK);
    expect(types(events)).not.toContain("KNOCKED_OUT");
    expect(state.phase.kind).not.toBe("ko:takePrizes");
    expect(body(state.players.p2.active).damage).toBe(80);
  });

  it("the Prize is owed to the ATTACKER and taken, then the victim promotes", () => {
    const { state } = strike(armed(52, { stages: 2, damage: 100 }), "p1", PICK);
    if (state.phase.kind !== "ko:takePrizes") throw new Error("expected ko:takePrizes");
    expect(state.phase.seat).toBe("p1");
    const settled = settle(state);
    expect(settled.players.p1.prizes.filter((p) => p !== null)).toHaveLength(5);
    expect(settled.players.p2.active).not.toBeNull();
  });

  it("🛑 the KO'd stack goes to the DISCARD — but the devolved card is in the HAND", () => {
    // The two zones on one board, which is the pin that a writer sending the shed card
    // to the discard alongside the corpse would fail.
    const before = armed(53, { stages: 2, damage: 100 });
    const stage2 = must0(body(before.players.p2.active).stack.slice(-1));
    const stage1 = must0(body(before.players.p2.active).stack.slice(-2, -1));
    const { state } = strike(before, "p1", PICK);
    const settled = settle(state);
    expect(settled.players.p2.hand).toContain(stage2);
    expect(settled.players.p2.discard).toContain(stage1);
    expect(settled.players.p2.discard).not.toContain(stage2);
  });

  it("a BENCHED body devolved into lethality is Knocked Out with no promotion", () => {
    const before = armed(54, { stages: 0, benchStages: 1, benchDamage: 70 });
    const { state } = strike(before, "p1", PICK);
    // 90 → 60 with 70 on it: lethal the instant the stack shortens.
    expect(state.phase.kind).toBe("ko:takePrizes");
    const settled = settle(state);
    expect(settled.players.p2.active).not.toBeNull();
    expect(body(settled.players.p2.active).stack).toHaveLength(1);
  });

  it("🛑 THE `wasLethal` CONJUNCT — an already-lethal body's KO IS 'by damage'", () => {
    // Index 2 prints 60 damage AND the sentence. 100 on a 140 HP Stage 2 makes the hit
    // lethal BEFORE the writer runs, so this Knock Out really is *"by damage from an
    // attack"* and must NOT be stamped — without this rung the pair above is satisfied
    // by a writer that marks unconditionally (D424's control).
    const { state } = strike(armed(55, { stages: 2, damage: 100 }), "p1", BLOW);
    const marks = state.lastKoMarks.p2;
    expect(marks).toHaveLength(1);
    expect(marks[0]?.byAttack).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 🛑 §8 — §11 REMOVES A BODY FROM THE OFFER, ON BOTH SIDES OF THE RULE.
//      Already-settled at interpreter.ts's `unshieldedRefs` (*"a shielded body must
//      not be OFFERED"*, D259/D416) and asked SECOND, after `devolveTargets`.
// ─────────────────────────────────────────────────────────────────────────────
describe("🛑 §8 — a Mist Energy holder is not OFFERED, and the rest still devolve", () => {
  it("the shielded BENCHED body is dropped from the candidate list", () => {
    const { state, events } = strike(
      armed(61, { stages: 1, benchStages: 1, shieldBench: true }),
      "p1",
      PICK,
    );
    // TWO evolved bodies, ONE shielded — so the offer has ONE candidate and
    // `parkOrForce` FORCES it. That is the observable shape of a FILTER rather than a
    // guard: the op still ran, on the body that was not shielded.
    expect(state.phase.kind).not.toBe("effect:choose");
    expect(find(events, "ATTACK_EFFECT_PREVENTED")).toBeDefined();
    expect(all(events, "POKEMON_DEVOLVED")).toHaveLength(1);
    expect(find(events, "POKEMON_DEVOLVED")?.seat).toBe("p2");
    expect(body(state.players.p2.bench[0]).stack).toHaveLength(2);
    expect(body(state.players.p2.active).stack).toHaveLength(1);
  });

  it("the shielded ACTIVE body is dropped from the candidate list", () => {
    const { state, events } = strike(
      armed(62, { stages: 1, benchStages: 1, shieldActive: true }),
      "p1",
      PICK,
    );
    expect(state.phase.kind).not.toBe("effect:choose");
    expect(find(events, "ATTACK_EFFECT_PREVENTED")).toBeDefined();
    expect(body(state.players.p2.active).stack).toHaveLength(2);
    expect(body(state.players.p2.bench[0]).stack).toHaveLength(1);
  });

  it("🛑 BOTH shielded — the op is a silent no-op with TWO refusals and no prompt", () => {
    const { state, events } = strike(
      armed(63, { stages: 1, benchStages: 1, shieldActive: true, shieldBench: true }),
      "p1",
      PICK,
    );
    expect(all(events, "ATTACK_EFFECT_PREVENTED")).toHaveLength(2);
    expect(types(events)).not.toContain("POKEMON_DEVOLVED");
    expect(state.phase.kind).not.toBe("effect:choose");
  });

  it("🛑 A SHIELDED BODY THAT IS NOT EVOLVED FILES NO REFUSAL AT ALL", () => {
    // The ORDER rung, and it is the whole correctness of the refusal row: the set is
    // narrowed BEFORE §11 is asked, so a Mist-Energy'd BASIC this op was never going to
    // touch does not get an `ATTACK_EFFECT_PREVENTED` announcing an effect that does
    // not exist (D430). Asking the shield first would file one here.
    const { events } = strike(armed(64, { stages: 0, shieldActive: true }), "p1", PICK);
    expect(types(events)).not.toContain("ATTACK_EFFECT_PREVENTED");
    expect(types(events)).not.toContain("POKEMON_DEVOLVED");
  });

  it("🛑 THE ADMISSION CONTROL — the same board UNSHIELDED parks with both bodies", () => {
    const { state } = strike(armed(61, { stages: 1, benchStages: 1 }), "p1", PICK);
    expect(parked(state).candidates).toEqual([ACTIVE, BENCH0]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §9 — THE HAND-COUNT PUBLICATION RUNG.
// ─────────────────────────────────────────────────────────────────────────────
describe("§9 — the hand grows by exactly one, and the uid stays hidden", () => {
  it("🛑 +1 CARD IN HAND, with the victim's own draw controlled OUT", () => {
    // The attack runs on into the turn boundary, so the victim draws once at the top of
    // its own turn. That draw is measured on the PLAIN control and subtracted, rather
    // than assumed — `library()`'s deck-plus-hand trick cannot tell a hand move from a
    // deck move, which is exactly the distinction this slice is about.
    const before = armed(71, { stages: 1, benchStages: 1 });
    const start = before.players.p2.hand.length;
    const control = strike(before, "p1", PLAIN).state.players.p2.hand.length;
    const devolvedTo = answer(strike(before, "p1", PICK).state, "p1", ACTIVE).state.players.p2.hand
      .length;
    expect(control).toBe(start + 1);
    expect(devolvedTo).toBe(control + 1);
  });

  it("the devolved uid is IN the victim's hand and in no other zone", () => {
    const before = armed(71, { stages: 1, benchStages: 1 });
    const top = must0(body(before.players.p2.active).stack.slice(-1));
    const { state } = answer(strike(before, "p1", PICK).state, "p1", ACTIVE);
    expect(state.players.p2.hand).toContain(top);
    expect(state.players.p2.deck).not.toContain(top);
    expect(state.players.p2.discard).not.toContain(top);
    expect(state.players.p2.prizes).not.toContain(top);
    expect(body(state.players.p2.active).stack).not.toContain(top);
  });

  it("🛑 THE UID NEVER APPEARS IN THE OPPONENT'S PROJECTION — only the COUNT moves", () => {
    // `redactedSideOf` already projects an opponent's hand as `hiddenHand(length)`
    // (positional ids, never engine uids), so this slice adds no redaction bytes. The
    // rung is here because that is a MEASUREMENT of a zero-byte file rather than an
    // assumption about one.
    const before = armed(72, { stages: 1, benchStages: 1 });
    const top = must0(body(before.players.p2.active).stack.slice(-1));
    const { state } = answer(strike(before, "p1", PICK).state, "p1", ACTIVE);
    const attackerView = redactGame(state, "p1");
    expect(JSON.stringify(attackerView)).not.toContain(top);
    expect(attackerView.board.opponent.hand.map((c) => c.id)).not.toContain(top);
    expect(attackerView.board.opponent.hand).toHaveLength(state.players.p2.hand.length);
    // …and the victim's OWN view does resolve it, which is the control that keeps the
    // rung above a statement about redaction rather than about an empty hand.
    expect(JSON.stringify(redactGame(state, "p2"))).toContain(top);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 🛑 §10 — `MATCH_RECORD_VERSION` STAYS 30, DRIVEN BOTH D450 DIRECTIONS OVER THE
//      SERIALIZED BYTES. Unlike the sibling, THIS op PARKS — so `"cont" in phase` is
//      TRUE and the record genuinely holds the new inhabitant.
// ─────────────────────────────────────────────────────────────────────────────
describe("🛑 §10 — the persisted `pendingOp`, over the serialized bytes", () => {
  it("🛑 `\"cont\" in phase` IS TRUE and `pendingOp` IS the new inhabitant", () => {
    const { state } = strike(armed(81, { stages: 1, benchStages: 1 }), "p1", PICK);
    const phase = state.phase;
    if (phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect("cont" in phase).toBe(true);
    expect(parked(state).pendingOp).toEqual({ op: "devolveChosen" });
  });

  it("🛑 DIRECTION 1 — the parked op survives a JSON round trip and resolves", () => {
    // The whole board through `JSON.parse(JSON.stringify(...))`: what a `MatchRecord`
    // actually stores, rather than the in-memory object.
    const parkedState = strike(armed(81, { stages: 1, benchStages: 1 }), "p1", PICK).state;
    const bytes = JSON.stringify(parkedState);
    expect(bytes).toContain('"devolveChosen"');
    const revived = JSON.parse(bytes) as GameState;
    const { state, events } = answer(revived, "p1", BENCH0);
    expect(find(events, "POKEMON_DEVOLVED")?.zone).toBe("hand");
    expect(body(state.players.p2.bench[0]).stack).toHaveLength(1);
    expect(body(state.players.p2.active).stack).toHaveLength(2);
  });

  it("🛑 DIRECTION 2 — a v30 OP AT THE SAME ADDRESS STILL MEANS WHAT IT MEANT", () => {
    // D125's widening, driven rather than argued from the type's name (D427). The
    // `pendingOp` byte string is SWAPPED on the SERIALIZED bytes for one a v30 deploy
    // really could have written — D416's `knockOutChosen`, which parks on the same
    // `choosePokemon` prompt over the same `oppAnyRefs` scope and answers with the same
    // `{kind:"pokemon"}` inhabitant — and the drained board is the KNOCK OUT's, with no
    // devolution anywhere: the alphabet grew, and nothing already in it changed meaning.
    const start = armed(82, { stages: 1, benchStages: 1 });
    const stage1 = must0(body(start.players.p2.active).stack.slice(-1));
    const parkedState = strike(start, "p1", PICK).state;
    const bytes = JSON.stringify(parkedState);
    expect(bytes).toContain('{"op":"devolveChosen"}');
    const swapped = JSON.parse(
      bytes.replace('{"op":"devolveChosen"}', '{"op":"knockOutChosen","target":"opponentAny"}'),
    ) as GameState;
    const { state, events } = answer(swapped, "p1", ACTIVE);
    // No devolution anywhere, and NOTHING went to a hand — the old op does what it
    // always did. The body is DOOMED instead, which §8.1 collects into the Prize
    // interrupt, and the WHOLE two-card stack lands in the discard (the pin that a
    // devolution would have broken by leaving one card in the hand).
    expect(types(events)).not.toContain("POKEMON_DEVOLVED");
    expect(state.phase.kind).toBe("ko:takePrizes");
    expect(state.players.p2.hand).not.toContain(stage1);
    expect(state.players.p2.discard).toContain(stage1);
  });

  it("🛑 THE FORCED BOARD PUTS NOTHING IN THE RECORD AT ALL — the carrier door", () => {
    // The op reaches a persisted address ONLY when it parks. On a one-candidate board
    // `parkOrForce` resolves inline, so `"cont" in phase` is FALSE and the serialized
    // state contains the new member nowhere — which is the half `devolveEach`'s suite
    // could assert of EVERY board and this one can assert of only some.
    const { state } = strike(armed(84, { stages: 1 }), "p1", PICK);
    expect("cont" in state.phase).toBe(false);
    expect(JSON.stringify(state)).not.toContain("devolveChosen");
  });

  it("nothing this slice adds is a REQUIRED field on a persisted structure", () => {
    // `stack` has ridden `InPlayPokemon` since M4; `POKEMON_DEVOLVED` is a `GameEvent`,
    // and `GameEvent` is not persisted at all (`MatchRecord` stores the RENDERED
    // `SeatLogEntry[]`), so `zone` is not a persistence question in either direction.
    // A board from BEFORE this slice devolves identically.
    const before = armed(83, { stages: 1 });
    const active = body(before.players.p2.active);
    expect(Object.keys(active)).toContain("stack");
    expect(Object.keys(active)).toContain("markers");
    expect(Object.keys(active)).toContain("evolvedTurn");
    const revived = JSON.parse(JSON.stringify(before)) as GameState;
    const live = strike(before, "p1", PICK);
    const replayed = strike(revived, "p1", PICK);
    expect(types(replayed.events)).toEqual(types(live.events));
    expect(replayed.state.players.p2.active).toEqual(live.state.players.p2.active);
    expect(replayed.state.players.p2.hand).toEqual(live.state.players.p2.hand);
  });

  it("the engine version moved with the behaviour", () => {
    expect(engineVersion).toBe("0.498.0");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §11 — THE LOG ROW, and the `zone` rider that is the only reason the hand move is
//      announced anywhere at all.
// ─────────────────────────────────────────────────────────────────────────────
describe("§11 — the log row names the HAND, and the sweep's row still does not", () => {
  const ctx = (state: GameState): LogContext => ({
    names: { p1: "Ash", p2: "Gary" },
    state,
    elapsed: "+00:10",
  });

  /** The rendered action lines, `who|text` — `devolveEach.test.ts` §3's instrument. */
  function lines(state: GameState, events: GameEvent[]): string[] {
    return logFromEvents(events, ctx(state)).map((entry) =>
      entry.kind === "action"
        ? `${entry.who}|${entry.segments.map((seg) => seg.text).join("")}`
        : "",
    );
  }

  it("the row files under the ACTOR and names the destination HAND", () => {
    const before = armed(91, { stages: 1 });
    const { state, events } = strike(before, "p1", PICK);
    const rendered = lines(state, events).filter((line) => line.includes("devolved"));
    expect(rendered).toHaveLength(1);
    expect(rendered[0]).toBe("p1|devolved Gary's d540-s1 → d540-basic — to Gary's hand");
  });

  it("🛑 THE PAIR — the SWEEP's row names NO zone, byte-identically to before", () => {
    // The rider's default is the deck, so `devolveEach` renders exactly as it did
    // before this slice. Same card, same board, same turn: only the index moves.
    const before = armed(91, { stages: 1 });
    const { state, events } = strike(before, "p1", SWEEP);
    const rendered = lines(state, events).filter((line) => line.includes("devolved"));
    expect(rendered).toHaveLength(1);
    expect(rendered[0]).toBe("p1|devolved Gary's d540-s1 → d540-basic");
    expect(rendered[0]).not.toContain("hand");
    expect(find(events, "POKEMON_DEVOLVED")?.zone).toBeUndefined();
  });

  it("the §12 Special Condition clear is announced with reason 'devolved'", () => {
    // Asleep on the victim's Active, then devolved: the shed is `devolvedBodyOf`'s and
    // the announcement is the writer's.
    const before = armed(92, { stages: 1 });
    const asleep: GameState = {
      ...before,
      players: {
        ...before.players,
        p2: {
          ...before.players.p2,
          active: {
            ...body(before.players.p2.active),
            conditions: { ...body(before.players.p2.active).conditions, rotation: "asleep" },
          },
        },
      },
    };
    const { events } = strike(asleep, "p1", PICK);
    const cleared = find(events, "STATUS_CLEARED");
    expect(cleared?.reason).toBe("devolved");
    expect(cleared?.statuses).toContain("asleep");
  });

  it("a board with NOTHING to clear emits no STATUS_CLEARED at all", () => {
    const { events } = strike(armed(92, { stages: 1 }), "p1", PICK);
    expect(types(events)).not.toContain("STATUS_CLEARED");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §12 — PURITY, and the damage arm on one board with the pick.
// ─────────────────────────────────────────────────────────────────────────────
describe("§12 — the op is a pure reduction", () => {
  it("a DEEP-FROZEN board devolves without throwing", () => {
    const before = deepFreeze(armed(101, { stages: 1, benchStages: 1 }));
    const { state } = strike(before, "p1", PICK);
    const { state: done } = answer(state, "p1", ACTIVE);
    expect(body(done.players.p2.active).stack).toHaveLength(1);
  });

  it("🛑 THE PAIR — the ORIGINAL board is byte-identical afterwards", () => {
    const before = armed(101, { stages: 1, benchStages: 1 });
    const snapshot = JSON.stringify(before);
    const { state } = strike(before, "p1", PICK);
    answer(state, "p1", BENCH0);
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it("DAMAGE AND THE PICK ON ONE BOARD — the 60 lands and the stack still shortens", () => {
    const before = armed(102, { stages: 1, benchStages: 1 });
    const { state: waiting, events: hit } = strike(before, "p1", BLOW);
    // The damage step runs BEFORE the program parks, so the 60 is already on the board
    // while the prompt is open.
    expect(find(hit, "DAMAGE_DEALT")?.damage).toBe(60);
    expect(body(waiting.players.p2.active).damage).toBe(60);
    const { state } = answer(waiting, "p1", ACTIVE);
    // 90 HP Stage 1 → 60 HP Basic with 60 on it: lethal the instant the stack shortens.
    expect(state.phase.kind).toBe("ko:takePrizes");
  });
});

/** A total `[0]`/`at(-1)` read: `noUncheckedIndexedAccess` is on, and a rung that
    silently compared `undefined` to `undefined` would be green for the wrong reason. */
function must0<T>(items: readonly (T | undefined)[]): T {
  const first = items[0];
  if (first === undefined) throw new Error("expected a value");
  return first;
}
