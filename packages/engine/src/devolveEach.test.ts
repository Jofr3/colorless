import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import type { EffectOp } from "./effects";
import { deriveAttackEffect } from "./effects";
import {
  ANY_ENERGY,
  applyAction,
  createGame,
  engineVersion,
  programFor,
  providedEnergy,
} from "./index";
import type { GameEvent, GameState, InPlayPokemon, Seat } from "./index";
import { type LogContext, logFromEvents } from "./log";
import {
  FIXTURE_POOL,
  attachBenchFromDeck,
  attachFromDeck,
  attachToolFromDeck,
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

// 🆕🆕 D433 — §10, THE FIRST DEVOLUTION IN THIS ENGINE.
//
//   "Devolve each of your opponent's evolved Pokémon by shuffling the highest
//    Stage Evolution card on it into your opponent's deck."
//
// **1 sentence / 3 legal printings** — `censusAttackCorpus.ts` row 88. ONE anchor
// (`DEVOLVE_EACH_TO_DECK`), ONE arm in `deriveAttackEffect` (41-bis), ONE
// field-free `EffectOp` (`devolveEach`), ONE `stepOp` case, ONE interpreter
// sweep, ONE new event (`POKEMON_DEVOLVED`) with ONE log row, ONE new
// `STATUS_CLEARED` reason (`"devolved"`) with ONE log row, and ONE function MOVED
// (`isLethallyDamaged`, flow.ts → continuous.ts, re-exported).
//
// 🛑 **HAZARD ONE — DEVOLVING CAN KNOCK A POKÉMON OUT, AND NO PRODUCER IN THIS
// ENGINE HAD EVER REACHED THE KO SWEEP THIS WAY.** Every existing route to a
// lethal body either DEALT damage or WROTE damage (`doomBodyAt`). This op writes
// neither: it shortens the evolution stack, `effectiveMaxHp` resolves the new top
// live, and `damage >= maximum` becomes true with the damage total untouched. §8.1
// catches it with no new mechanism (§5 drives the Prize AND the promotion) — but
// the *CAUSE* is not free, and §6 is the whole of that: the printed clause is
// *"Knocked Out **by damage** from an attack"*, read by four built sentences / six
// printings and by Vengeful Punch `sv03-197`. `collectKnockOuts`' own comment
// already rules that a Knock Out caused by *"the maximum MOVING"* is not the
// attack's damage, so a body this op makes lethal carries D414's
// `koByEffect:<turn>` stamp — and, crucially, a body that was ALREADY lethal when
// the op reached it does NOT (§6's `wasLethal` pair).
//
// 🛑 **HAZARD TWO — DEVOLVING REMOVES SPECIAL CONDITIONS, AND THAT IS ONE OF
// FOURTEEN CARRY-OVER DECISIONS.** §7 pins every field of `InPlayPokemon` one by
// one: the eleven §10/§11 bars CLEARED (`switchInto`'s and `clearOnLeavingActive`'s
// exact set), damage / Energy / Tools KEPT, `turnPlayed` and `markers` KEPT, and
// `evolvedTurn` NULLED. The three `evolveOnto` also writes are decided separately
// and the reasons are at the op.
//
// 🛑 **THE LITERAL-VS-TEMPLATE CALL.** The devolve family is TWO rows — the
// pattern is the loosest possible stem, `/[Dd]evolv/`, over all 640 corpus
// sentences, and BOTH hits were read (§1 asserts the count off the live corpus so
// the claim cannot rot). Row 87 varies from row 88 on TWO axes at once —
// cardinality (a PARKED single choice vs a sweep) and destination (hand vs
// deck-plus-shuffle) — so a parameterised op would carry a pool of ONE on both
// fields, which is D121's warrant unmet twice over. Row 87 is left unbuilt and
// used as this suite's loud-path witness (§10).

const SENTENCE =
  "Devolve each of your opponent's evolved Pokémon by shuffling the highest Stage Evolution card on it into your opponent's deck.";
/** Corpus row 87 — the family's OTHER member, 1 legal printing, deliberately
    unbuilt. Not a refusal near-miss (it differs on two axes); the loud-path
    witness (§10) and the literal-vs-template evidence (§1). */
const SIBLING =
  "Devolve 1 of your opponent's evolved Pokémon by putting the highest Stage Evolution card on it into your opponent's hand.";

const CALL = 0; // {C}, NO damage, the sentence — the pure "maximum moved" board
const BLOW = 1; // {C}, 130 damage, the sentence — the already-lethal board (§6)
const PLAIN = 2; // {C}, NO damage, NO effect — the one-axis control
const HAND = 3; // {C}, NO damage, corpus row 87 — the loud ATTACK_EFFECT_SKIPPED witness
const TOLL = 4; // {C}, a PARKING sibling, so §11 has a persisted `cont.rest` to load

/** The chain this suite devolves down: 60 / 90 / 140 HP, three distinct numbers so
    no assertion can be satisfied by the wrong body. The ids are `fix-*` keys with
    no catalog row behind them — the three cards that PRINT row 88 are unresolvable
    in this checkout (no D1) and are stated unresolved rather than invented (D425). */
const LOCAL_CARDS: Record<string, Card> = {
  "fix-devolver": battler("fix-devolver", {
    types: ["Colorless"],
    hp: 300,
    retreat: 1,
    attacks: [
      { cost: ["Colorless"], name: "Ancestral Call", effect: SENTENCE },
      { cost: ["Colorless"], name: "Ancestral Blow", damage: 130, effect: SENTENCE },
      { cost: ["Colorless"], name: "Plain Call" },
      { cost: ["Colorless"], name: "Hand Regression", effect: SIBLING },
      { cost: ["Colorless"], name: "Ancestral Toll", effect: "Discard an Energy from this Pokémon." },
    ],
  }),
  "fix-dev-basic": battler("fix-dev-basic", { types: ["Colorless"], hp: 60, retreat: 1 }),
  "fix-dev-s1": battler("fix-dev-s1", {
    types: ["Colorless"],
    hp: 90,
    retreat: 1,
    stage: "Stage1",
    evolveFrom: "fix-dev-basic",
  }),
  "fix-dev-s2": battler("fix-dev-s2", {
    types: ["Colorless"],
    hp: 140,
    retreat: 1,
    stage: "Stage2",
    evolveFrom: "fix-dev-s1",
  }),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

/** Its OWN deck (D270's rule, and D412's warning about widening a shared one):
    4+8+6+6+4+4+4+8+16 = 60, counted before the first run.
      • `fix-devolver` — the demonstrator, five indices;
      • `fix-dev-basic` / `-s1` / `-s2` — the 60/90/140 chain, evolved by REAL
        `evolve` actions rather than by stack surgery, so `turnPlayed` and
        `evolvedTurn` arrive the way the engine writes them;
      • `sv03-197` Vengeful Punch — the recoil §6 is about, reused rather than
        re-fixtured so this suite and `knockOutDefender.test.ts` argue about one card;
      • `fix-mist-energy` — Mist Energy `sv05-161`'s §11 effects-only shield, the
        cheapest live `preventAttackEffects` in the pool (§13);
      • `fix-titan` (340 HP) / `fix-bigbody` (200 HP) — bench filler nothing here can
        Knock Out, a promote target, and the mulligan-free starter;
      • `fix-energy` — Colorless Basic: every printed cost in this deck is {C};
      • `fix-neo-upper-energy` — Neo Upper Energy `sv05-162` (the alias key for the
        same program), and §14 is the reason: its `promoteOnHolderStage` is the ONE
        shipped mechanism whose doc block already names devolution, and until this
        slice that sentence could not be driven;
      • `fix-fire-energy` — a Basic TYPED Energy, and it is here for exactly one
        reason: §11 needs a PARKED program, and `discardEnergy`'s park only offers a
        decision when the candidates differ as CARDS ("which copy is taken is not a
        decision the game contains"). Three Colorless auto-resolve; two Colorless
        plus a Fire ask. It pays a {C} cost like anything else. */
const DEVOLVE_DECK = deckOf({
  "fix-devolver": 4,
  "fix-dev-basic": 8,
  "fix-dev-s1": 6,
  "fix-dev-s2": 6,
  "sv03-197": 4,
  "fix-mist-energy": 4,
  "fix-titan": 4,
  "fix-bigbody": 8,
  "fix-energy": 12,
  "fix-fire-energy": 2,
  "fix-neo-upper-energy": 2,
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

function count(events: GameEvent[], type: GameEvent["type"]): number {
  return events.filter((e) => e.type === type).length;
}

/** The rows the ATTACK itself produced, cut at the turn boundary. An attack that
    does NOT Knock Out runs straight on into `TURN_ENDED` / the Checkup /
    `TURN_STARTED` / the victim's draw, and none of that is this slice's business —
    while an attack that DOES Knock Out parks before any of it, which is why the
    exact-zone pins in §5 and §9 live on the parked boards. */
function boardEvents(events: GameEvent[]): string[] {
  const names = types(events);
  const tail = names.indexOf("TURN_ENDED");
  return tail === -1 ? names : names.slice(0, tail);
}

/** Where a uid sits on `seat`'s side. The victim DRAWS at the top of its own turn,
    so a card shuffled into a deck can legitimately be in hand one row later — the
    two library zones are asked about together wherever the board is not parked. */
function library(state: GameState, seat: Seat): string[] {
  return [...state.players[seat].deck, ...state.players[seat].hand];
}

function body(pokemon: InPlayPokemon | null | undefined): InPlayPokemon {
  if (pokemon === null || pokemon === undefined) throw new Error("expected a Pokémon");
  return pokemon;
}

function localSetup(seed: number, first: Seat): GameState {
  const created = createGame({ seed, decks: { p1: DEVOLVE_DECK, p2: DEVOLVE_DECK }, cardPool: POOL });
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
    playing a REAL `evolve` action — never by writing `stack` directly, so every
    field §7 asks about arrives the way `evolveOnto` writes it. */
function evolveInto(
  state: GameState,
  seat: Seat,
  cardId: string,
  target: { spot: "active" } | { spot: "bench"; index: number },
): GameState {
  const held = handFromDeck(state, seat, cardId, 1);
  return mustApply(held, {
    type: "evolve",
    seat,
    uid: handUid(held, seat, cardId),
    target,
  }).state;
}

interface BoardOpts {
  /** Neo Upper Energy onto the victim's Active (§14). */
  neo?: boolean;
  /** How far up the chain the VICTIM's Active is evolved. 0 = an unevolved Basic. */
  stages: 0 | 1 | 2;
  /** Damage surgically placed on the victim's Active before the attack. */
  damage?: number;
  /** A second, BENCHED body on the victim's board, evolved one step. */
  benchStages?: 0 | 1;
  benchDamage?: number;
  /** A Tool onto the victim's Active (Vengeful Punch, §6). */
  tool?: string;
  /** Mist Energy onto the victim's BENCHED body (the §11 shield, §13). */
  shieldBench?: boolean;
  /** Which seat attacks. The other seat is the victim. */
  attacker?: Seat;
  energy?: number;
  /** Typed Energy on the attacker, so a singular `discardEnergy` has two DIFFERENT
      cards to choose between and actually parks (§11). */
  fire?: number;
  /** Give the ATTACKER an evolved benched body too — the control that proves the
      sweep reads "your opponent's" and not "every". */
  attackerEvolves?: boolean;
}

/** ONE board, built by real actions: the ATTACKER opens and passes, the VICTIM
    evolves on each of its own turns, and the attacker declares on the turn after
    the last evolution. The victim always fields TWO further benched bodies past
    anything in this deck, so a Knock Out here queues a real PROMPT rather than a
    forced auto-promotion. */
function armed(seed: number, opts: BoardOpts): GameState {
  const attacker = opts.attacker ?? "p1";
  const victim = attacker === "p1" ? "p2" : "p1";
  let state = localSetup(seed, attacker);
  state = setActiveFromDeck(state, attacker, "fix-devolver");
  state = clearBench(state, attacker);
  state = attachFromDeck(state, attacker, "fix-energy", opts.energy ?? 2);
  if (opts.fire !== undefined) state = attachFromDeck(state, attacker, "fix-fire-energy", opts.fire);
  if (opts.attackerEvolves === true) state = benchFromDeck(state, attacker, "fix-dev-basic");
  state = setActiveFromDeck(state, victim, "fix-dev-basic");
  state = clearBench(state, victim);
  if (opts.benchStages !== undefined) state = benchFromDeck(state, victim, "fix-dev-basic");
  state = benchFromDeck(state, victim, "fix-titan");
  state = benchFromDeck(state, victim, "fix-bigbody");

  // Turn 1 is the ATTACKER's (§4 forbids its attack anyway) and turn 2 is the
  // VICTIM's OWN first turn, on which §4/§10 forbids evolving — so both are
  // passed before any evolution, and each evolution then costs a full round. The
  // board ends on the attacker's turn either way.
  state = pass(state, attacker);
  state = pass(state, victim);
  const rounds = Math.max(opts.stages, opts.benchStages ?? 0, opts.attackerEvolves === true ? 1 : 0);
  for (let step = 0; step < rounds; step += 1) {
    if (step === 0 && opts.attackerEvolves === true) {
      state = evolveInto(state, attacker, "fix-dev-s1", { spot: "bench", index: 0 });
    }
    state = pass(state, attacker);
    if (step < opts.stages) {
      state = evolveInto(state, victim, step === 0 ? "fix-dev-s1" : "fix-dev-s2", {
        spot: "active",
      });
    }
    if (step < (opts.benchStages ?? 0)) {
      state = evolveInto(state, victim, "fix-dev-s1", { spot: "bench", index: 0 });
    }
    state = pass(state, victim);
  }
  if (opts.damage !== undefined) state = setDamage(state, victim, opts.damage);
  if (opts.benchDamage !== undefined) state = setBenchDamage(state, victim, 0, opts.benchDamage);
  if (opts.neo === true) state = attachFromDeck(state, victim, "fix-neo-upper-energy", 1);
  if (opts.tool !== undefined) state = attachToolFromDeck(state, victim, "active", opts.tool);
  // The shield goes on the BENCHED body, which is the whole point of §13: a filter
  // over the candidate set rather than a guard over the op.
  if (opts.shieldBench === true) state = attachBenchFromDeck(state, victim, 0, "fix-mist-energy", 1);
  return state;
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

function strike(state: GameState, seat: Seat, index: number) {
  return mustApply(state, { type: "attack", seat, index });
}

function idOf(state: GameState, uid: string): string | undefined {
  return state.cardIdByUid[uid];
}

// ─────────────────────────────────────────────────────────────────────────────
// §1 — THE DERIVATION, and the two-row family the LITERAL call rests on.
// ─────────────────────────────────────────────────────────────────────────────
describe("§1 — the sentence derives to ONE field-free op", () => {
  it("the printed sentence derives to exactly `[{ op: 'devolveEach' }]`", () => {
    expect(deriveAttackEffect(SENTENCE)).toEqual([{ op: "devolveEach" }]);
  });

  it("the corpus row is the byte-for-byte string this suite asserts against", () => {
    // D183 — author and assert against the PRINTED bytes, never a paraphrase. The
    // row is looked up in the live corpus rather than quoted from memory, so a
    // re-ingest that curls an apostrophe reddens HERE rather than silently
    // un-building three printings.
    const rows = legalAttackCorpus().filter(([, text]) => /[Dd]evolv/.test(text));
    // 🛑 THE POPULATION CLAIM THE LITERAL-VS-TEMPLATE CALL RESTS ON, asserted off
    // the corpus rather than written in prose: the loosest plausible pattern for
    // this family is the bare stem, and it returns TWO rows. If a third devolve
    // sentence ever enters the legal column this rung goes RED and the template
    // question is re-opened by construction (D422's rule: a refusal that names its
    // own falsifier).
    expect(rows).toHaveLength(2);
    expect(rows.map(([, text]) => text).sort()).toEqual([SENTENCE, SIBLING].sort());
    // …and the printing counts that make row 88 worth an op and row 87 not.
    expect(rows.find(([, text]) => text === SENTENCE)?.[0]).toBe(3);
    expect(rows.find(([, text]) => text === SIBLING)?.[0]).toBe(1);
  });

  it("the sentence is claimed by a READER and the sibling by NOTHING", () => {
    expect(resolvedByAnyReader(SENTENCE)).toBe(true);
    expect(resolvedByAnyReader(SIBLING)).toBe(false);
  });

  it("the op reaches a real attack program through `programFor`'s fallback", () => {
    // The seam is TEXT-keyed: no registry row is authored for the three printings,
    // so the program comes off `deriveAttackEffect` at declaration time.
    expect(programFor("fix-devolver")?.attack).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — REFUSALS, each differing from the anchor on EXACTLY ONE axis (D427), and
//      the ADMISSION control each one owes (D424).
// ─────────────────────────────────────────────────────────────────────────────
describe("§2 — the anchor refuses on one axis at a time, and still says yes", () => {
  const NEAR_MISSES: [string, string][] = [
    [
      "the OWN side",
      SENTENCE.replace("each of your opponent's evolved", "each of your evolved"),
    ],
    ["the DESTINATION", SENTENCE.replace("opponent's deck.", "opponent's hand.")],
    ["the VERB", SENTENCE.replace("by shuffling", "by putting")],
    ["the QUANTIFIER", SENTENCE.replace("Devolve each of", "Devolve 1 of")],
    ["the FILTER", SENTENCE.replace("evolved Pokémon", "Pokémon")],
    ["the STAGE WORD", SENTENCE.replace("highest Stage Evolution", "lowest Stage Evolution")],
    ["a LEADING clause", `If you have any Benched Pokémon, ${SENTENCE[0]?.toLowerCase()}${SENTENCE.slice(1)}`],
    ["a TRAILING clause", `${SENTENCE.slice(0, -1)} Then, draw a card.`],
  ];

  for (const [axis, text] of NEAR_MISSES) {
    it(`refuses a string differing only in ${axis}`, () => {
      expect(deriveAttackEffect(text)).toBeNull();
      // …and the string really is one edit away, so the refusal is about the axis
      // rather than about a mangled sentence.
      expect(text).not.toBe(SENTENCE);
    });
  }

  it("🛑 THE ADMISSION CONTROL — the reader still says YES to the real sentence", () => {
    // Without this every rung above passes against a reader that refuses
    // everything (D424).
    expect(deriveAttackEffect(SENTENCE)).toEqual([{ op: "devolveEach" }]);
  });

  it("neither anchor can claim the other's sentences — arm order is FREE", () => {
    // Arm 41-bis sits immediately above arm 42 (`RETURN_BENCHED`). Both are `^…$`
    // and their first words differ, so the placement is a refactor rather than a
    // decision — driven rather than asserted in prose.
    const RETURNS = [
      "Shuffle 1 of your opponent's Benched Pokémon and all attached cards into their deck.",
      "Shuffle 1 of your Benched Pokémon and all attached cards into your deck.",
      "Put 1 of your Benched Pokémon and all attached cards into your hand.",
    ];
    for (const text of RETURNS) {
      const program = deriveAttackEffect(text);
      expect(program).not.toBeNull();
      expect(program?.[0]?.op).toBe("returnBenched");
    }
    // …and this sentence does not derive to `returnBenched`.
    expect(deriveAttackEffect(SENTENCE)?.[0]?.op).toBe("devolveEach");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — A STAGE 1 BOARD: the evolution card leaves, the Basic stays.
// ─────────────────────────────────────────────────────────────────────────────
describe("§3 — a Stage 1 devolves to its Basic", () => {
  it("the stack shortens by one and the top is the Basic again", () => {
    const before = armed(3, { stages: 1 });
    const stack = body(before.players.p2.active).stack;
    expect(stack).toHaveLength(2);
    expect(idOf(before, stack[1] as string)).toBe("fix-dev-s1");

    const { state, events } = strike(before, "p1", CALL);
    const after = body(state.players.p2.active);
    expect(after.stack).toHaveLength(1);
    expect(idOf(state, after.stack[0] as string)).toBe("fix-dev-basic");
    expect(after.stack[0]).toBe(stack[0]); // the SAME physical card, not a new one

    const row = find(events, "POKEMON_DEVOLVED");
    expect(row).toEqual({
      type: "POKEMON_DEVOLVED",
      seat: "p2", // the OWNER
      actor: "p1", // the player whose card did it — CARRIED, not derived (D425)
      from: stack[1],
      to: stack[0],
    });
  });

  it("the log row files under the ACTOR and names the owner's card", () => {
    const { state, events } = strike(armed(3, { stages: 1 }), "p1", CALL);
    const ctx: LogContext = { names: { p1: "Ash", p2: "Gary" }, state, elapsed: "+00:10" };
    const rendered = logFromEvents(events, ctx).map((entry) =>
      entry.kind === "action" ? `${entry.who}|${entry.segments.map((seg) => seg.text).join("")}` : "",
    );
    expect(rendered.some((line) => line.startsWith("p1|devolved Gary's fix-dev-s1"))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — A STAGE 2 BOARD: ONE card off the top, not the whole stack.
// ─────────────────────────────────────────────────────────────────────────────
describe("§4 — a Stage 2 devolves to its Stage 1, NOT to its Basic", () => {
  it("the three-card stack becomes a TWO-card stack topped by the Stage 1", () => {
    const before = armed(4, { stages: 2, damage: 80 });
    const stack = body(before.players.p2.active).stack;
    expect(stack).toHaveLength(3);
    expect(stack.map((uid) => idOf(before, uid))).toEqual([
      "fix-dev-basic",
      "fix-dev-s1",
      "fix-dev-s2",
    ]);

    const { state } = strike(before, "p1", CALL);
    const after = body(state.players.p2.active);
    // 🛑 THE DEFECT NO CENSUS CAN SEE: a build that devolved the WHOLE stack leaves
    // ONE card here and passes every "the Pokémon devolved" assertion in §3.
    expect(after.stack).toHaveLength(2);
    expect(after.stack.map((uid) => idOf(state, uid))).toEqual(["fix-dev-basic", "fix-dev-s1"]);
    // …and only the top card left the board for a library zone.
    expect(library(state, "p2")).toContain(stack[2]);
    expect(library(state, "p2")).not.toContain(stack[1]);
    expect(library(state, "p2")).not.toContain(stack[0]);
    expect(state.players.p2.discard).not.toContain(stack[2]);
  });

  it("the survivor's HP is the STAGE 1's, which is what the KO check will read", () => {
    // 80 damage on a 140 HP Stage 2 that becomes a 90 HP Stage 1: alive by 10.
    const { state } = strike(armed(4, { stages: 2, damage: 80 }), "p1", CALL);
    expect(state.players.p2.active?.damage).toBe(80);
    expect(types(strike(armed(4, { stages: 2, damage: 80 }), "p1", CALL).events)).not.toContain(
      "KNOCKED_OUT",
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 🛑 HAZARD ONE — THE KNOCK OUT BY THE MAXIMUM MOVING, with its Prize and its
//      promotion, and the control that does NOT Knock Out.
// ─────────────────────────────────────────────────────────────────────────────
describe("🛑 §5 — devolving Knocks Out with NO damage dealt", () => {
  it("a 100-damage Stage 2 dropping to a 90 HP Stage 1 is Knocked Out", () => {
    const before = armed(5, { stages: 2, damage: 100 });
    expect(before.players.p2.active?.damage).toBe(100);
    const { state, events } = strike(before, "p1", CALL);

    // 🛑 NO DAMAGE WAS DEALT ANYWHERE — the attack prints none and the op places
    // none. The Knock Out is the maximum moving and nothing else.
    expect(types(events)).not.toContain("DAMAGE_DEALT");
    expect(types(events)).not.toContain("COUNTERS_PLACED");
    expect(find(events, "KNOCKED_OUT")).toBeDefined();
    // …and the ORDER: the devolution, its shuffle, then §8.1's collection. The
    // PROMOTION prompt is not here and is not missing — §8.1 queues prizes first
    // and `advance` only reaches the promote stage once the Prize is taken, which
    // the next case drives.
    expect(boardEvents(events)).toEqual([
      "ATTACK_DECLARED",
      "POKEMON_DEVOLVED",
      "SHUFFLE",
      "KNOCKED_OUT",
      "PRIZES_OWED",
    ]);
    expect(state.players.p2.active).toBeNull();
  });

  it("the Prize is owed to the ATTACKER and taken, then the victim promotes", () => {
    const { state } = strike(armed(5, { stages: 2, damage: 100 }), "p1", CALL);
    expect(state.phase).toEqual({ kind: "ko:takePrizes", seat: "p1", count: 1 });
    expect(state.players.p1.prizes).toHaveLength(6);

    const settled = settle(state);
    expect(settled.players.p1.prizes).toHaveLength(5);
    expect(settled.players.p1.hand.length).toBeGreaterThan(0);
    // The promotion really happened, from a bench that really had a choice.
    expect(settled.players.p2.active).not.toBeNull();
    expect(idOf(settled, body(settled.players.p2.active).stack[0] as string)).toBe("fix-titan");
    expect(settled.players.p2.bench).toHaveLength(1);
  });

  it("the KO'd stack goes to the DISCARD — but the devolved card is in the DECK", () => {
    // The two zones the one physical Pokémon splits across, which is the whole
    // shape of this op: the highest Stage was already in the deck when §8.1
    // collected what was left.
    const before = armed(5, { stages: 2, damage: 100 });
    const stack = body(before.players.p2.active).stack;
    const { state } = strike(before, "p1", CALL);
    expect(state.players.p2.deck).toContain(stack[2]);
    expect(state.players.p2.discard).toContain(stack[0]);
    expect(state.players.p2.discard).toContain(stack[1]);
    expect(state.players.p2.discard).not.toContain(stack[2]);
  });

  it("🛑 THE CONTROL — 80 damage on the same board does NOT Knock Out", () => {
    // Without this the case above is satisfied by an op that Knocks Out everything
    // it touches. Same seed, same board, same attack: only the damage total moves.
    const { state, events } = strike(armed(5, { stages: 2, damage: 80 }), "p1", CALL);
    expect(boardEvents(events)).toEqual(["ATTACK_DECLARED", "POKEMON_DEVOLVED", "SHUFFLE"]);
    expect(types(events)).not.toContain("KNOCKED_OUT");
    expect(state.players.p2.active).not.toBeNull();
    expect(state.players.p1.prizes).toHaveLength(6);
  });

  it("a Stage 1 dropping to a 60 HP Basic Knocks Out at 70 and survives at 50", () => {
    // The same hazard one rung down the chain, so the claim is about the mechanism
    // rather than about one pair of numbers.
    const lethal = strike(armed(6, { stages: 1, damage: 70 }), "p1", CALL);
    expect(find(lethal.events, "KNOCKED_OUT")).toBeDefined();
    const alive = strike(armed(6, { stages: 1, damage: 50 }), "p1", CALL);
    expect(types(alive.events)).not.toContain("KNOCKED_OUT");
    expect(alive.state.players.p2.active?.damage).toBe(50);
  });

  it("a BENCHED body devolved into lethality is Knocked Out with no promotion", () => {
    // §8.1's "no gap, no promotion" is a fact about the BENCH, and the sweep reaches
    // benched bodies exactly as it reaches the Active.
    const before = armed(7, { stages: 0, benchStages: 1, benchDamage: 70 });
    const { state, events } = strike(before, "p1", CALL);
    expect(find(events, "KNOCKED_OUT")).toBeDefined();
    expect(types(events)).not.toContain("PROMOTION_REQUIRED");
    expect(state.players.p2.active).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 🛑 THE CAUSE — "Knocked Out BY DAMAGE from an attack", both directions.
// ─────────────────────────────────────────────────────────────────────────────
const PUNCH_HP = programFor("sv03-197")?.passive?.damageAttackerOnKo?.amount ?? 0;

describe("🛑 §6 — a devolve Knock Out is NOT 'by damage', and an already-lethal one IS", () => {
  it("the devolved body carries D414's `koByEffect` marker before §8.1 collects it", () => {
    // The stamp is written by the op and read by `flow.ts`; the body is gone by the
    // time the epilogue ends, so the marker is observed through the FACTS it
    // decides (the two rungs below) rather than off the board. What IS observable
    // on the board is the non-KO case: a devolved survivor is never marked.
    const { state } = strike(armed(8, { stages: 2, damage: 80 }), "p1", CALL);
    expect(body(state.players.p2.active).markers).toEqual([]);
  });

  it("`lastKoMarks` records `byAttack: false` for the maximum-moved Knock Out", () => {
    const { state } = strike(armed(8, { stages: 2, damage: 100 }), "p1", CALL);
    const marks = state.lastKoMarks.p2;
    expect(marks).toHaveLength(1);
    expect(marks[0]?.byAttack).toBe(false);
    expect(state.lastKoTurn.p2).toBe(state.turn);
  });

  it("🛑 THE CONTROL — the SAME board Knocked Out BY DAMAGE reads `byAttack: true`", () => {
    // Index 1 prints 130 damage AND the sentence. 20 damage on the 140 HP Stage 2
    // makes the hit lethal BEFORE the op runs, so this Knock Out really is "by
    // damage from an attack" and must not be stamped. Without this rung the case
    // above is satisfied by an op that marks unconditionally.
    const { state } = strike(armed(9, { stages: 2, damage: 20 }), "p1", BLOW);
    const marks = state.lastKoMarks.p2;
    expect(marks).toHaveLength(1);
    expect(marks[0]?.byAttack).toBe(true);
  });

  it("Vengeful Punch pays NOTHING on the devolve Knock Out…", () => {
    const before = armed(10, { stages: 2, damage: 100, tool: "sv03-197" });
    expect(before.players.p2.active?.tools).toHaveLength(1); // the Tool is really on
    const { state, events } = strike(before, "p1", CALL);
    expect(find(events, "KNOCKED_OUT")).toBeDefined(); // the KO really happened…
    expect(types(events)).not.toContain("COUNTERS_PLACED"); // …and paid nothing
    expect(state.players.p1.active?.damage).toBe(0);
  });

  it("…and still pays its 40 when the SAME holder dies to the attack's damage", () => {
    // 🛑 THE `wasLethal` CONJUNCT, driven. Same Tool, same holder, same op running
    // in the same program: the only difference is that the 130 had already made the
    // body lethal, so the stamp is withheld and the recoil is owed.
    const before = armed(11, { stages: 2, damage: 20, tool: "sv03-197" });
    const { state, events } = strike(before, "p1", BLOW);
    expect(find(events, "KNOCKED_OUT")).toBeDefined();
    expect(find(events, "COUNTERS_PLACED")).toMatchObject({
      seat: "p1",
      amount: PUNCH_HP,
      source: "counterattack",
    });
    expect(state.players.p1.active?.damage).toBe(PUNCH_HP);
    // The number itself, pinned ONCE so the constant cannot quietly become 0 (which
    // would make every "paid nothing" rung above pass vacuously).
    expect(PUNCH_HP).toBe(40);
  });

  it("the marker carries THIS turn, so a stale one does not suppress the recoil", () => {
    // `lethalByEffect` reads `koByEffectMarker(state.turn)`. A body carrying LAST
    // turn's string is not marked for this one — the arithmetic expiry, driven at
    // the site this slice newly writes it from.
    const before = armed(12, { stages: 2, damage: 20, tool: "sv03-197" });
    const stale = koByEffectMarker(before.turn - 1);
    const active = body(before.players.p2.active);
    const seeded: GameState = {
      ...before,
      players: {
        ...before.players,
        p2: { ...before.players.p2, active: { ...active, markers: [stale] } },
      },
    };
    const { events } = strike(seeded, "p1", BLOW);
    expect(find(events, "COUNTERS_PLACED")).toMatchObject({ amount: PUNCH_HP });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7 🛑 HAZARD TWO — every carry-over decision, one field at a time.
// ─────────────────────────────────────────────────────────────────────────────

/** A board whose victim Active carries EVERY §10/§11 bar plus a Special Condition,
    a Tool, Energy and damage — placed by surgery because no legal sequence can put
    all twelve on one body at once (eleven before D434), which is exactly `evolveOnto`'s own reason for
    pinning its unreachable clears by surgery. */
function loaded(seed: number): { before: GameState; turn: number } {
  const base = armed(seed, { stages: 1, damage: 40, tool: "sv03-197" });
  const withEnergy = attachFromDeck(base, "p2", "fix-energy", 2);
  const active = body(withEnergy.players.p2.active);
  const turn = withEnergy.turn;
  const before: GameState = {
    ...withEnergy,
    players: {
      ...withEnergy.players,
      p2: {
        ...withEnergy.players.p2,
        active: {
          ...active,
          conditions: { rotation: "asleep", poisonDamage: 10, burned: true },
          retreatBlocked: true,
          retreatLockedTurn: turn + 2,
          attackBlock: { turn: turn + 1, effects: true },
          attackLockedTurn: turn + 1,
          damageReduction: { turn: turn + 1, amount: 30 },
          noWeaknessTurn: turn + 1,
          // 🆕🆕 D434 — the SCHEDULED counter placement, added when the field joined
          // the durated set. It is UNREACHABLE on this literal by any legal sequence
          // (the schedule's window is the holder's own turn and a devolve arrives on
          // the opponent's), so it is pinned by surgery for the reason the paragraph
          // above already gives about the other ten.
          scheduledEffect: { turn: turn + 1, kind: "counters", amount: 90 },
          attackDamageDebuff: { turn: turn + 1, amount: 20 },
          installedRecoil: { turn: turn + 1, amount: 40 },
          lockedAttacks: [{ turn, attackIndex: 0 }],
          boostedAttack: { turn: turn + 1, attackIndex: 0, amount: 50 },
          markers: ["d433-probe"],
        },
      },
    },
  };
  return { before, turn };
}

describe("🛑 §7 — the carry-over set, decided field by field", () => {
  it("the TWELVE §10/§11 bars are all cleared — the set `switchInto` clears", () => {
    const { before } = loaded(13);
    const { state } = strike(before, "p1", CALL);
    const after = body(state.players.p2.active);
    expect(after.conditions).toEqual({ rotation: "none", poisonDamage: 0, burned: false });
    expect(after.retreatBlocked).toBe(false);
    expect(after.retreatLockedTurn).toBeNull();
    expect(after.attackBlock).toBeNull();
    expect(after.attackLockedTurn).toBeNull();
    expect(after.damageReduction).toBeNull();
    expect(after.noWeaknessTurn).toBeNull();
    expect(after.scheduledEffect).toBeNull(); // 🆕🆕 D434 — eleven bars became twelve
    expect(after.attackDamageDebuff).toBeNull();
    expect(after.installedRecoil).toBeNull();
    expect(after.lockedAttacks).toEqual([]);
    expect(after.boostedAttack).toBeNull();
  });

  it("the Special Condition clear is ANNOUNCED with reason 'devolved'", () => {
    const { before } = loaded(13);
    const { state, events } = strike(before, "p1", CALL);
    const cleared = find(events, "STATUS_CLEARED");
    expect(cleared).toMatchObject({
      seat: "p2",
      reason: "devolved",
      uid: body(state.players.p2.active).stack[0],
    });
    expect(cleared?.statuses.sort()).toEqual(["asleep", "burned", "poisoned"]);
    // …and it FOLLOWS the movement row, exactly as the evolution pair does.
    const order = types(events);
    expect(order.indexOf("STATUS_CLEARED")).toBeGreaterThan(order.indexOf("POKEMON_DEVOLVED"));
  });

  it("a board with NOTHING to clear emits no STATUS_CLEARED at all", () => {
    // The announced-only-when-there-was-something rule, `evolveOnto`'s verbatim.
    const { events } = strike(armed(13, { stages: 1 }), "p1", CALL);
    expect(types(events)).not.toContain("STATUS_CLEARED");
  });

  it("the log renders the clear as 'on devolving', not 'on evolving'", () => {
    const { before } = loaded(13);
    const { state, events } = strike(before, "p1", CALL);
    const lines = logFromEvents(events, {
      names: { p1: "Ash", p2: "Gary" },
      state,
      elapsed: "+00:10",
    }).map((entry) =>
      entry.kind === "action" ? entry.segments.map((seg) => seg.text).join("") : "",
    );
    expect(lines.some((line) => line.includes("on devolving"))).toBe(true);
    expect(lines.some((line) => line.includes("on evolving"))).toBe(false);
  });

  it("DAMAGE, ENERGY and TOOLS carry over — §10's rule read backwards", () => {
    const { before } = loaded(13);
    const beforeActive = body(before.players.p2.active);
    const { state } = strike(before, "p1", CALL);
    const after = body(state.players.p2.active);
    expect(after.damage).toBe(40);
    expect(after.energy).toEqual(beforeActive.energy);
    expect(after.tools).toEqual(beforeActive.tools);
    expect(after.energy.length).toBeGreaterThan(0);
    expect(after.tools).toHaveLength(1);
  });

  it("`turnPlayed` is KEPT — nothing came into play", () => {
    const { before } = loaded(13);
    const kept = body(before.players.p2.active).turnPlayed;
    const { state } = strike(before, "p1", CALL);
    expect(body(state.players.p2.active).turnPlayed).toBe(kept);
    // …and it is NOT this turn, which is what `evolveOnto` would have written.
    expect(body(state.players.p2.active).turnPlayed).not.toBe(state.turn);
  });

  it("`markers` are KEPT — the divergence from `evolveOnto` that would be a defect", () => {
    // `evolveOnto` writes `markers: []`; `switchInto` and `clearOnLeavingActive`
    // keep them. Devolve follows the two that keep, because the only marker in the
    // engine records how a body became LETHAL and clearing it would restore the
    // "by damage" reading for a body §8.1 is about to collect.
    const { before } = loaded(13);
    const { state } = strike(before, "p1", CALL);
    expect(body(state.players.p2.active).markers).toEqual(["d433-probe"]);
  });

  it("`evolvedTurn` is NULLED — the fact belonged to the card that left", () => {
    // The body really did carry a stamp (a real `evolve` action wrote it), and it
    // is gone afterwards. Unreachable as a BEHAVIOUR difference in this catalog —
    // devolution only happens on the opponent's turn, so `=== state.turn` is
    // already false — so it is pinned on the FIELD, exactly as `evolveOnto` pins
    // its own unreachable clears.
    const { before } = loaded(13);
    expect(body(before.players.p2.active).evolvedTurn).not.toBeNull();
    const { state } = strike(before, "p1", CALL);
    expect(body(state.players.p2.active).evolvedTurn).toBeNull();
  });

  it("`promotedTurn`, `healedTurn` and `usedAttack` are untouched", () => {
    // The three fields `evolveOnto` also leaves alone, asserted so the clear set is
    // pinned as a WHOLE rather than field by field on one side only (D432's rule).
    const { before } = loaded(13);
    const beforeActive = body(before.players.p2.active);
    const { state } = strike(before, "p1", CALL);
    const after = body(state.players.p2.active);
    expect(after.promotedTurn).toBe(beforeActive.promotedTurn);
    expect(after.healedTurn).toBe(beforeActive.healedTurn);
    expect(after.usedAttack).toEqual(beforeActive.usedAttack);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §8 — THE SWEEP: Active and Bench, the "evolved" filter, and the no-op.
// ─────────────────────────────────────────────────────────────────────────────
describe("§8 — 'each of your opponent's evolved Pokémon'", () => {
  it("devolves the Active AND a benched body, and SKIPS the unevolved ones", () => {
    const before = armed(14, { stages: 1, benchStages: 1 });
    expect(before.players.p2.bench).toHaveLength(3); // evolved, fix-titan, fix-bigbody
    const { state, events } = strike(before, "p1", CALL);

    const rows = all(events, "POKEMON_DEVOLVED");
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => idOf(state, row.to))).toEqual(["fix-dev-basic", "fix-dev-basic"]);
    // Active first, then bench in index order — `oppAnyRefs`' order.
    expect(body(state.players.p2.active).stack).toHaveLength(1);
    expect(body(state.players.p2.bench[0]).stack).toHaveLength(1);
    // …and the two unevolved bench bodies were not touched.
    expect(body(state.players.p2.bench[1]).stack).toHaveLength(1);
    expect(body(state.players.p2.bench[2]).stack).toHaveLength(1);
    // ONE shuffle for the whole sweep, not one per body.
    expect(count(events, "SHUFFLE")).toBe(1);
  });

  it("🛑 an entirely UNEVOLVED board is a silent no-op", () => {
    const before = armed(15, { stages: 0 });
    const { state, events } = strike(before, "p1", CALL);
    expect(boardEvents(events)).toEqual(["ATTACK_DECLARED"]);
    expect(count(events, "POKEMON_DEVOLVED")).toBe(0);
    // 🛑 NOT EVEN A SHUFFLE. A build that shuffled unconditionally would scramble a
    // deck the printed sentence never touches, and no board assertion above would
    // see it — the deck order is not otherwise pinned anywhere.
    expect(count(events, "SHUFFLE")).toBe(0);
    // …and NOTHING moved: the board and the RNG are where they were. (The victim's
    // own turn-start draw is the only deck movement, hence `library`.)
    expect(library(state, "p2")).toHaveLength(library(before, "p2").length);
    expect(state.players.p2.active).toEqual(before.players.p2.active);
    expect(state.players.p2.bench).toEqual(before.players.p2.bench);
    expect(state.rngState).toBe(before.rngState);
  });

  it("🛑 it never touches the ATTACKER's OWN evolved bodies", () => {
    // "your opponent's" is the whole of the side reading, and a build that swept
    // BOTH boards passes every rung above — the sweep would still devolve the
    // victim, still file its rows, still Knock nothing else out. The attacker
    // fields its own real Stage 1, evolved by a real action on its own turn.
    const before = armed(16, { stages: 1, attackerEvolves: true });
    const own = body(before.players.p1.bench[0]);
    expect(own.stack).toHaveLength(2);
    expect(idOf(before, own.stack[1] as string)).toBe("fix-dev-s1");

    const { state, events } = strike(before, "p1", CALL);
    // The opponent's Active devolved…
    expect(count(events, "POKEMON_DEVOLVED")).toBe(1);
    expect(find(events, "POKEMON_DEVOLVED")?.seat).toBe("p2");
    // …and the attacker's own Stage 1 is untouched, in every zone.
    expect(body(state.players.p1.bench[0]).stack).toEqual(own.stack);
    expect(library(state, "p1")).not.toContain(own.stack[1]);
    expect(count(events, "SHUFFLE")).toBe(1);
    expect(find(events, "SHUFFLE")?.seat).toBe("p2");
  });

  it("BOTH SEATS — p2 attacking p1 devolves p1's board and shuffles p1's deck", () => {
    const before = armed(17, { stages: 2, attacker: "p2" });
    const stack = body(before.players.p1.active).stack;
    expect(stack).toHaveLength(3);
    const { state, events } = strike(before, "p2", CALL);
    expect(find(events, "POKEMON_DEVOLVED")).toMatchObject({ seat: "p1", actor: "p2" });
    expect(find(events, "SHUFFLE")).toEqual({ type: "SHUFFLE", seat: "p1" });
    expect(state.players.p1.deck).toContain(stack[2]);
    expect(state.players.p2.deck).not.toContain(stack[2]);
    expect(body(state.players.p1.active).stack).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §9 — THE DESTINATION: the OWNER's deck, shuffled, once.
// ─────────────────────────────────────────────────────────────────────────────
describe("§9 — the card goes into the OWNER's deck and the deck is shuffled", () => {
  it("the deck grows by exactly one and the RNG advances", () => {
    // ⚠️ A **PARKED** BOARD, DELIBERATELY: the Knock Out stops the reduction at
    // `ko:takePrizes`, before the turn tail hands the victim its own draw. On any
    // board that runs to the tail the deck's length is +1 −1 and the pin would be
    // vacuous — the same reason §4's zone claims ask `library` instead.
    const before = armed(18, { stages: 2, damage: 100 });
    const stack = body(before.players.p2.active).stack;
    const deckBefore = before.players.p2.deck.length;
    const { state, events } = strike(before, "p1", CALL);
    expect(state.phase.kind).toBe("ko:takePrizes");
    expect(state.players.p2.deck).toHaveLength(deckBefore + 1);
    expect(state.players.p2.deck).toContain(stack[2]);
    expect(state.players.p1.deck).toEqual(before.players.p1.deck);
    expect(find(events, "SHUFFLE")).toEqual({ type: "SHUFFLE", seat: "p2" });
    // The shuffle really happened: `rngState` moved, and the order is NOT the old
    // deck with the card appended (which is what a build that skipped `shuffle`
    // and just pushed would produce — and no length assertion could see).
    expect(state.rngState).not.toBe(before.rngState);
    expect(state.players.p2.deck).not.toEqual([...before.players.p2.deck, stack[2]]);
  });

  it("the card is NOT discarded and NOT put in hand", () => {
    // The two destinations the family's OTHER row (the hand) and this one's
    // near-misses name. Parked again, so the hand claim is about the op rather than
    // about a draw.
    const before = armed(18, { stages: 2, damage: 100 });
    const stack = body(before.players.p2.active).stack;
    const { state } = strike(before, "p1", CALL);
    expect(state.players.p2.discard).not.toContain(stack[2]);
    expect(state.players.p2.hand).not.toContain(stack[2]);
  });

  it("TWO devolutions still touch the deck ONCE — one shuffle, one RNG draw", () => {
    const before = armed(19, { stages: 2, damage: 100, benchStages: 1 });
    const { state, events } = strike(before, "p1", CALL);
    expect(state.phase.kind).toBe("ko:takePrizes");
    expect(count(events, "POKEMON_DEVOLVED")).toBe(2);
    expect(count(events, "SHUFFLE")).toBe(1);
    expect(state.players.p2.deck).toHaveLength(before.players.p2.deck.length + 2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §10 — THE COVERAGE CHANNEL: no skip for the built sentence, a LOUD skip for the
//       family's other row.
// ─────────────────────────────────────────────────────────────────────────────
describe("§10 — `ATTACK_EFFECT_SKIPPED`, both directions", () => {
  it("the built sentence emits NO skip", () => {
    const { events } = strike(armed(20, { stages: 1 }), "p1", CALL);
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
  });

  it("🛑 corpus row 87 — the family's OTHER sentence — is still LOUD", () => {
    // The witness that "built" means something. Same card, same board, same turn:
    // only the index moves.
    const { events } = strike(armed(20, { stages: 1 }), "p1", HAND);
    const skipped = find(events, "ATTACK_EFFECT_SKIPPED");
    expect(skipped?.effect).toBe(SIBLING);
  });

  it("the no-effect control emits no skip either — an absent sentence is not a gap", () => {
    const { events } = strike(armed(20, { stages: 1 }), "p1", PLAIN);
    expect(types(events)).not.toContain("ATTACK_EFFECT_SKIPPED");
    expect(types(events)).not.toContain("POKEMON_DEVOLVED");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §11 — `MATCH_RECORD_VERSION` STAYS 27, driven BOTH directions.
// ─────────────────────────────────────────────────────────────────────────────
describe("§11 — the version prediction is DRIVEN, not asserted", () => {
  /** An attack PARKED mid-program on index 4's singular Energy discard, JSON
      round-tripped — the persisted `phase.cont` a v27 deploy would have written.
      This slice's own program never parks, so this sibling attack is the only route
      to the persisted-`EffectOp` question at all. */
  function parkedMidAttack(seed: number): GameState {
    const parked = strike(armed(seed, { stages: 1, energy: 2, fire: 1 }), "p1", TOLL).state;
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    return JSON.parse(JSON.stringify(parked)) as GameState;
  }

  it("🛑 DIRECTION 1 — a v27 `cont.rest` WITHOUT the op still drains", () => {
    const legacy = parkedMidAttack(21);
    const phase = legacy.phase;
    if (phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    expect(phase.cont.rest).toEqual([]);
    const chosen = (phase.prompt as { discardable: { uid: string }[] }).discardable[0]?.uid;
    const drained = mustApply(legacy, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardEnergy", uids: [chosen as string] },
    });
    expect(types(drained.events)).not.toContain("POKEMON_DEVOLVED");
    expect(body(drained.state.players.p2.active).stack).toHaveLength(2);
  });

  it("🛑 DIRECTION 2 — a `cont.rest` CARRYING the new inhabitant devolves on drain", () => {
    // The half that proves the op survives serialisation rather than that the old
    // bytes were merely ignored.
    const carrying = parkedMidAttack(21);
    const phase = carrying.phase;
    if (phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const chosen = (phase.prompt as { discardable: { uid: string }[] }).discardable[0]?.uid;
    const newOp: EffectOp = { op: "devolveEach" };
    (phase as unknown as { cont: { rest: EffectOp[] } }).cont.rest = [newOp];
    const roundTripped = JSON.parse(JSON.stringify(carrying)) as GameState;
    const drained = mustApply(roundTripped, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "discardEnergy", uids: [chosen as string] },
    });
    expect(find(drained.events, "POKEMON_DEVOLVED")).toBeDefined();
    expect(body(drained.state.players.p2.active).stack).toHaveLength(1);
  });

  it("nothing this slice adds is a REQUIRED field on a persisted structure", () => {
    // `stack` has ridden `InPlayPokemon` since M4; `POKEMON_DEVOLVED` is a
    // `GameEvent`, and `GameEvent` is not persisted at all (`MatchRecord` stores the
    // RENDERED `SeatLogEntry[]`). A body from BEFORE this slice — every field this
    // op reads or writes already present — devolves identically.
    const before = armed(22, { stages: 1 });
    const active = body(before.players.p2.active);
    expect(Object.keys(active)).toContain("stack");
    expect(Object.keys(active)).toContain("markers");
    expect(Object.keys(active)).toContain("evolvedTurn");
    const revived = JSON.parse(JSON.stringify(before)) as GameState;
    const live = strike(before, "p1", CALL);
    const replayed = strike(revived, "p1", CALL);
    expect(types(replayed.events)).toEqual(types(live.events));
    expect(replayed.state.players.p2.active).toEqual(live.state.players.p2.active);
    expect(replayed.state.players.p2.deck).toEqual(live.state.players.p2.deck);
  });

  it("the engine version moved with the behaviour", () => {
    expect(engineVersion).toBe("0.379.0");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §12 — PURITY: a frozen board is not mutated.
// ─────────────────────────────────────────────────────────────────────────────
describe("§12 — the op is a pure reduction", () => {
  it("a DEEP-FROZEN board devolves without throwing", () => {
    const before = deepFreeze(armed(23, { stages: 2, damage: 100, benchStages: 1 }));
    const { state, events } = strike(before, "p1", CALL);
    expect(count(events, "POKEMON_DEVOLVED")).toBe(2);
    expect(state.players.p2.active).toBeNull(); // it Knocked Out, on a frozen input
  });

  it("🛑 THE PAIR — the ORIGINAL board is byte-identical afterwards", () => {
    // Without this the case above passes on an op that mutates a board nobody
    // froze deeply enough.
    const before = armed(23, { stages: 2, damage: 100, benchStages: 1 });
    const snapshot = JSON.parse(JSON.stringify(before)) as GameState;
    strike(before, "p1", CALL);
    expect(before).toEqual(snapshot);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §13 — §11 AS A FILTER (D259): one shielded body, not one shielded board.
// ─────────────────────────────────────────────────────────────────────────────
describe("§13 — a Mist Energy holder is skipped, and the rest still devolve", () => {
  it("the shielded BENCHED body keeps its evolution and files one refusal row", () => {
    const before = armed(24, { stages: 1, benchStages: 1, shieldBench: true });
    // The shield is really on the body the case is about.
    const shielded = body(before.players.p2.bench[0]);
    expect(shielded.energy).toHaveLength(1);
    expect(shielded.stack).toHaveLength(2);

    const { state, events } = strike(before, "p1", CALL);
    expect(count(events, "ATTACK_EFFECT_PREVENTED")).toBe(1);
    expect(find(events, "ATTACK_EFFECT_PREVENTED")?.seat).toBe("p2");
    expect(body(state.players.p2.bench[0]).stack).toHaveLength(2); // untouched
  });

  it("🛑 a shielded body that is NOT EVOLVED files no refusal at all", () => {
    // The candidate set is narrowed to EVOLVED bodies BEFORE §11 is asked, which is
    // what every other caller of `unshieldedRefs` does (`gustTargets`,
    // `knockOutChosenTargets`, `discardableEnergies` all hand it a printed set).
    // Asking the shield over the whole board first files an `ATTACK_EFFECT_PREVENTED`
    // row for a body this op was never going to touch — a refusal announcing an
    // effect that does not exist, which is a FALSE log row and not a conservative
    // one. The mutant `D433-shield-asked-before-the-filter` is exactly that build.
    const before = armed(26, { stages: 1, benchStages: 0, shieldBench: true });
    const shielded = body(before.players.p2.bench[0]);
    expect(shielded.energy).toHaveLength(1); // the shield really is attached…
    expect(shielded.stack).toHaveLength(1); // …to a body with nothing to devolve
    const { events } = strike(before, "p1", CALL);
    expect(count(events, "ATTACK_EFFECT_PREVENTED")).toBe(0);
    // …and the Active, which IS evolved and is NOT shielded, still devolves.
    expect(count(events, "POKEMON_DEVOLVED")).toBe(1);
  });

  it("🛑 THE ADMISSION CONTROL — the UNSHIELDED Active on the same board devolves", () => {
    // One shielded Fraxure must not protect the whole board (D259): the refusal is
    // a filter over the candidate set, not a guard over the op.
    const before = armed(24, { stages: 1, benchStages: 1, shieldBench: true });
    const { state, events } = strike(before, "p1", CALL);
    expect(count(events, "POKEMON_DEVOLVED")).toBe(1);
    expect(find(events, "POKEMON_DEVOLVED")?.seat).toBe("p2");
    expect(body(state.players.p2.active).stack).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §14 🛑 D414's RULE — the shipped code that already reasoned about devolution.
// ─────────────────────────────────────────────────────────────────────────────
describe("🛑 §14 — the one shipped mechanism whose doc block already named devolving", () => {
  it("Neo Upper Energy DEMOTES when its holder stops being a Stage 2", () => {
    // 🛑 THE INVARIANT THIS SLICE BREAKS, NAMED IN ONE SENTENCE AND THEN GREPPED
    // FOR (D414): *"an in-play Pokémon's evolution stack only ever GROWS."* The
    // audit over every non-test reader of `stack` found FOUR positional sites —
    // `cards.ts topUid`, `interpreter.ts`'s `stack[length - 2]` (the card evolved
    // FROM), and this op's own two — and every one of them resolves LIVE, so none
    // needed a change. **A clean audit is a finding** (D431), and it has one
    // consequence that was already written down and could not be driven:
    // `registry.ts`'s Neo Upper Energy row says *"evolving a Stage 1 into a Stage 2
    // with this card ALREADY attached upgrades it on the spot — and devolving would
    // demote it"*, then adds that a STAMPED implementation "would pass every static
    // board in this suite and be silently wrong". Nothing could devolve until now,
    // so the second half of that sentence had no board. It has one here.
    const before = armed(25, { stages: 2, neo: true });
    const holder = body(before.players.p2.active);
    expect(holder.stack).toHaveLength(3);
    expect(holder.energy).toHaveLength(1);
    // A Stage 2 holder: the promoted provision, two units of every type.
    expect(providedEnergy(before, holder)).toEqual([ANY_ENERGY, ANY_ENERGY]);

    const { state } = strike(before, "p1", CALL);
    const demoted = body(state.players.p2.active);
    // Same card, same uid, same body — a different top card, and therefore the
    // printed FALLBACK provision, in the same breath.
    expect(demoted.energy).toEqual(holder.energy);
    expect(providedEnergy(state, demoted)).toEqual(["Colorless"]);
  });

  it("🛑 THE CONTROL — the SAME attachment on a body nothing devolves keeps its promotion", () => {
    // Without this the case above is satisfied by a build where the provision is
    // always Colorless, or where the attack strips Energy.
    const before = armed(25, { stages: 2, neo: true });
    const { state } = strike(before, "p1", PLAIN);
    const kept = body(state.players.p2.active);
    expect(kept.stack).toHaveLength(3);
    expect(providedEnergy(state, kept)).toEqual([ANY_ENERGY, ANY_ENERGY]);
  });
});
