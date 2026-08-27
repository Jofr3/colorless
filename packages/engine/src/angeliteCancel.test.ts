import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import {
  attackReaderSurface,
  legalAttackCorpus,
  resolvedByAnyReader,
} from "./censusAttackCorpus";
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
  splitAttackGateClause,
} from "./effects";
import type { GameEvent, GameState, InPlayPokemon, Seat } from "./index";
import {
  applyAction,
  attackGateOf,
  attackTimingBlocked,
  attackTimingNote,
  conditionNote,
  createGame,
  programFor,
  redactGame,
} from "./index";
import {
  FIXTURE_POOL,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  deepFreeze,
  setActiveFromDeck,
} from "./testFixtures";

// 0.300.0 → 0.301.0 — 🆕🆕 D396: THE ANGELITE CANCEL.
//
// Sylveon ex `sv08-086` / `sv08.5-041` / `sv08.5-156` idx **1** "Angelite"
// ({W}{L}{P}, NO printed damage):
//   *"Choose 2 of your opponent's Benched Pokémon. Shuffle those Pokémon and all
//    attached cards into your opponent's deck. If 1 of your Pokémon used Angelite
//    during your last turn, this attack can't be used."*
//   — **3 legal printings on ONE byte-identical `attacks_json`**, the biggest
//   single row in the `during your last turn` family.
//
// ── WHAT SHIPS ───────────────────────────────────────────────────────────────
// **ONE `BoardCondition` member** (`yourPokemonUsedAttackLastTurn { attack }`),
// **its two exhaustive-switch arms**, and **ONE registry program on THREE ids**.
// ZERO new state, ops, events, error codes, prompt kinds, choice kinds, readers,
// regexes, clause-table rows, `CardFilter` members, `redact.ts` bytes or
// `packages/schema` bytes; **`MATCH_RECORD_VERSION` STAYS 25** (§6).
//
// ── 🛑 THE CONSEQUENT WAS PRICED WRONG BY THE HANDOFF, AND IT WAS RE-CHECKED ──
//
// D394's handoff called *"this attack can't be used"* a THIRD consequent shape.
// It is the PASSIVE VOICE of D281's `barredIf`, built since 0.195.0 and spelled
// *"…you can't use this attack during your first turn"* on Terapagos ex's seven
// printings: both bar the index while the condition HOLDS. §1 measures both
// spellings on the committed corpus rather than asserting the equivalence.
//
// ── 🛑 THE SHAPE QUESTION, SETTLED FROM THE CATALOG BEFORE A LINE WAS WRITTEN ──
//
// *"Is `1 of your Pokémon` a SECOND MEMBER or a `zone?: "inPlay"` FIELD on D394's
// `yourActiveUsedAttackLastTurn`?"* — settled **MEMBER**, and it is the first
// SUBJECT widening D391's rule (*a comparand is a shape and takes a member; a
// filter the delegate already accepts is a field*) has been asked about. The
// deciding half is the DELEGATE clause, not the comparand one: D391's field was
// cheap because `countAttachedEnergy` had taken exactly that filter since D128,
// while `usedAttackOnYourLastTurn` takes ONE `InPlayPokemon` and cannot take a
// zone — so the walk lives in the arm and a field buys a BRANCH inside it.
//
// ⚠️ **ONE MEASUREMENT POINTED THE OTHER WAY AND IS RECORDED RATHER THAN
// DROPPED**: the note IS one interpolation slot here (*"your Active Pokémon used
// X…"* / *"1 of your Pokémon used X…"* share a skeleton), so D389's *"a second
// SENTENCE, not a second SLOT"* arithmetic — what carried D392 — does NOT
// transfer. It loses to the delegate clause, to the site arithmetic (a member
// edits ZERO of the sibling's 12 executable sites; a field rewrites the
// `conditionHolds` arm whole) and to the polarity argument below.
//
// 🛑 **AND AN OPTIONAL FIELD FAILS IN BOTH DIRECTIONS AT ONCE ON *THIS* FIELD.** A
// row forgetting `zone` silently gets the ACTIVE-only read: under Angelite's
// `barredIf` that is TOO LOOSE (the cancel does not bite and an illegal
// declaration is accepted — §3), under Miltank `sv08.5-081`'s `onlyIf` the
// identical omission would be TOO STRICT. One silent default cannot serve both
// polarities of the field these conditions feed.
//
// ── WHAT THIS SUITE EXISTS TO PIN ────────────────────────────────────────────
//
// 1. 🛑 **THE SUBJECT WIDENING, ON THE BOARD THAT SEPARATES THE TWO READINGS.**
//    §3: Sylveon ex A uses "Angelite" and leaves the Active Spot; Sylveon ex B
//    declares "Angelite" on the next of your turns. The printed clause bars it and
//    an ACTIVE-only read does not. Driven through a REAL `retreat` as well as
//    through surgery, so the board is reachable in play and not only in a fixture.
// 2. 🛑 **THE SECOND NON-ZERO GATE INDEX, ON THE OPPOSITE GEOMETRY TO D395's.**
//    Miltank's gate is at 1 and names index 0; Angelite's gate is at 1 and names
//    index **1** — it bars ITSELF. So an index-blind read fails DIFFERENTLY here:
//    it bars "Magical Charm", the attack the card is otherwise played for. §2.
// 3. 🛑 **NO SPLIT IS AUTHORED, AND THE PROOF IS AN IDENTITY RATHER THAN A
//    DIFFERENCE.** The clause is TRAILING and `splitAttackGateClause` is
//    `^`-anchored; §5 asserts the gated body and its UNGATED twin report the
//    *same* `ATTACK_EFFECT_SKIPPED` — which is D395's assertion inverted, and the
//    honest answer, because all nine readers refuse the stripped body too (§1).
// 4. **§9 DOES NOT REACH THIS FIELD**, and both payability projections agree per
//    index. §4.

/** THE PRINTED SENTENCE, byte for byte off the committed corpus. */
const ANGELITE =
  "Choose 2 of your opponent's Benched Pokémon. Shuffle those Pokémon and all attached cards into your opponent's deck. If 1 of your Pokémon used Angelite during your last turn, this attack can't be used.";

/** The same printed text with the trailing gate clause removed — the string a
    TRAILING splitter would hand the readers. Spelled out here rather than sliced
    off `ANGELITE`, so §1's "every reader refuses it" is a claim about a sentence
    somebody read rather than about a substring an expression produced. */
const ANGELITE_BODY =
  "Choose 2 of your opponent's Benched Pokémon. Shuffle those Pokémon and all attached cards into your opponent's deck.";

/** Index 0's printed text, which DOES resolve (`weakenDefenderAttacks`) — the
    reason the card is played, and the row an index-blind gate takes away. */
const MAGICAL_CHARM =
  "During your opponent's next turn, attacks used by the Defending Pokémon do 100 less damage (before applying Weakness and Resistance).";

/** The nine live readers, run as one — `censusAtHead.test.ts`'s set. */
const READERS: readonly ((text: string) => unknown)[] = [
  deriveAttackEffect,
  deriveAttackDamageBonus,
  deriveAttackDamagePenalty,
  deriveAttackDamageMultiplier,
  deriveAttackCoinFlip,
  deriveAttackRequirement,
  deriveAttackDamageSuppression,
  deriveAttackOptionalBoost,
  // 🆕🆕 D419 — the THREE readers this list never had (D381, D403, D417), written
  // in NAME order rather than in landing order because the guard below diffs a
  // SORTED list against the module surface.
  // ⚠️ SPLICED MID-LIST RATHER THAN APPENDED: mutant `find` strings in
  // `scripts/mutation/mutants.ts` quote an array's LAST entries plus its closing
  // `];`, and appending moves that anchor without a character of it changing —
  // the adjacency class D418 paid for once on `stadiumPresence.test.ts`.
  deriveAttackCancelRequirement,
  deriveAttackDiscardScaledBoost,
  deriveAttackOptionalCostBoost,
  // 🆕🆕 D428 — THE THIRTEENTH, the PRE-DAMAGE Tool discard. ⚠️ SPLICED BEFORE THE
  // LAST ENTRY RATHER THAN APPENDED, D419's rule: mutant `find` strings quote an
  // array's LAST entries plus its closing bracket, and appending moves that anchor
  // without a character of it changing.
  deriveAttackPreDamage,
  deriveAttackBonusConsequent,
];

const SYLVEON = "sv08-086";
const SYLVEON_PRE = "sv08.5-041";
const SYLVEON_SIR = "sv08.5-156";

/** 🛑 THE ATTRIBUTION CONTROL, and the suite is vacuous without it: the SAME two
    attacks and the SAME printed bytes on a body with NO registry row. Every "the
    cancel bites" line below passes on a build that refuses all attacks, and §5's
    "no split fired" line passes on a build that splits nothing anywhere — this
    body is the only thing that tells those apart from the real behaviour. */
const UNGATED_TWIN = "fix-angelite-ungated";

/** Sylveon ex `sv08-086`, transcribed WHOLE off the printing (D306/D146: a fixture
    that claims to BE the printing gets every scalar re-read, not only the ones the
    assertions touch) — the 270 HP, the {P} type, the Stage 1 from Eevee, the ×2 {M}
    weakness, the retreat 2, and BOTH attacks at their printed indices with their
    printed costs, damage and effect text. Re-read field by field off tcgdex on
    2026-08-22, and IDENTICAL on all three ids.

    ⚠️ **THE `ex` RULE BOX IS OMITTED BECAUSE THERE IS NO COLUMN FOR IT**, not
    because it was skipped: tcgdex prints `"suffix": "ex"` and the persisted catalog
    `Card` carries no `suffix` field at all (D207's finding, one banner over) — the
    engine reads the rule box out of the printed NAME, which this fixture carries
    verbatim.

    ⚠️ **INDEX 1 HAS NO `damage` KEY AT ALL**, which is printed rather than
    forgotten: "Angelite" deals none, so every §3 board below can be wound on for
    turns without a Knock Out changing the question. */
function sylveon(id: string): Card {
  return battler(id, {
    name: "Sylveon ex",
    hp: 270,
    stage: "Stage1",
    evolveFrom: "Eevee",
    retreat: 2,
    types: ["Psychic"],
    weaknesses: [{ type: "Metal", value: "×2" }],
    attacks: [
      {
        cost: ["Psychic", "Colorless", "Colorless"],
        name: "Magical Charm",
        damage: 160,
        effect: MAGICAL_CHARM,
      },
      {
        cost: ["Water", "Lightning", "Psychic"],
        name: "Angelite",
        effect: ANGELITE,
      },
    ],
  });
}

const LOCAL_CARDS: Record<string, Card> = {
  [SYLVEON]: sylveon(SYLVEON),
  // Byte-identical to the row above except for the id, which is exactly what makes
  // it a control: the ONLY difference between the two bodies is that one is
  // represented in the registry and the other is not.
  [UNGATED_TWIN]: sylveon(UNGATED_TWIN),
};

/** D275's idiom: a LOCAL pool, so nothing lands in `FIXTURE_POOL`. Neither `sv08`
    nor `sv08.5` is one of `CATALOG_MANIFEST`'s six sets, so a shared-pool body
    would have owed a `fix-*` demonstrator key here as well — the key is the SET,
    not the surface. */
const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

/** The suite's own deck (D270: a seeded suite gets one). `fix-titan` is 340 HP with
    NO attacks, so it survives two "Magical Charm"s and can never take a turn of its
    own — nothing here can move a damage number or end a game except the two attacks
    under test. The three typed Energies pay both printed costs: {P} + {C}{C} for
    index 0 and {W}{L}{P} for index 1, from the same three cards. */
const ANGELITE_DECK = deckOf({
  [SYLVEON]: 8,
  [UNGATED_TWIN]: 6,
  "sv01-096": 2, // Klefki — the §9 Ability-lock control
  "fix-titan": 6,
  "fix-basic-1": 6,
  "fix-water-energy": 11,
  "fix-lightning-energy": 11,
  "fix-psychic-energy": 10,
});

/** Four seeds, so nothing below rests on one shuffle (D270). */
const SEEDS = [6011, 6029, 6037, 6047] as const;

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

/** D275's `localSetup` with the FIRST PLAYER as a parameter, so every assertion
    below can be made from both seats under both assignments. */
function localSetup(seed: number, first: Seat): GameState {
  const created = createGame({
    seed,
    decks: { p1: ANGELITE_DECK, p2: ANGELITE_DECK },
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

/** Give the seat's Active one {W}, one {L} and one {P} — enough for BOTH printed
    costs, so a refusal below can only ever be a GATE. */
function payBoth(state: GameState, seat: Seat): GameState {
  let next = attachFromDeck(state, seat, "fix-water-energy", 1);
  next = attachFromDeck(next, seat, "fix-lightning-energy", 1);
  return attachFromDeck(next, seat, "fix-psychic-energy", 1);
}

/** `seat`'s Active is `activeId` with the three Energies attached, a body behind it
    on the Bench (§14.2 makes an empty Bench a LOSS the moment the Active leaves)
    and `fix-titan` opposite. */
function board(seed: number, first: Seat, seat: Seat, activeId: string): GameState {
  const other = seat === "p1" ? "p2" : "p1";
  let state = localSetup(seed, first);
  state = setActiveFromDeck(state, seat, activeId);
  state = clearBench(state, seat);
  state = benchFromDeck(state, seat, "fix-basic-1");
  state = setActiveFromDeck(state, other, "fix-titan");
  state = clearBench(state, other);
  state = benchFromDeck(state, other, "fix-basic-1");
  return payBoth(state, seat);
}

function activeOf(state: GameState, seat: Seat): InPlayPokemon {
  const active = state.players[seat].active;
  if (active === null) throw new Error(`${seat} has no Active`);
  return active;
}

function passTurns(state: GameState, count: number): GameState {
  let next = state;
  for (let i = 0; i < count; i += 1) {
    if (next.phase.kind !== "turn:action") throw new Error(`stuck in ${next.phase.kind}`);
    next = must(applyAction(next, { type: "endTurn", seat: next.phase.seat }));
  }
  return next;
}

/** Wind the board on until it is `seat`'s turn to act and the counter has reached
    `minTurn`. ⚠️ **THE DEFAULT IS 3 AND IT IS LOAD-BEARING**: §4 bans the
    going-first player from attacking on turn 1, and a board that hit that ban would
    report `FIRST_TURN_ATTACK` where this file reads `ATTACK_PREVENTED` — a refusal
    for the wrong reason, which is exactly what `declare` returning a CODE rather
    than a boolean exists to catch. */
function untilTurnOf(state: GameState, seat: Seat, minTurn = 3): GameState {
  let next = state;
  for (let i = 0; i < 12; i += 1) {
    if (next.phase.kind === "turn:action" && next.phase.seat === seat && next.turn >= minTurn) {
      return next;
    }
    next = passTurns(next, 1);
  }
  throw new Error(`never reached ${seat}'s turn at or after ${minTurn}`);
}

/** Declare `index` and report the error CODE, or "OK". Every gate assertion goes
    through this, so a green "the cancel refuses" line can never be a refusal for
    the wrong reason (an unpaid cost, a §4 ban, a bad index). */
function declare(state: GameState, seat: Seat, index: number): string {
  const result = applyAction(deepFreeze(state), { type: "attack", seat, index });
  return result.ok ? "OK" : result.error.code;
}

function declareEvents(state: GameState, seat: Seat, index: number): readonly GameEvent[] {
  const result = applyAction(state, { type: "attack", seat, index });
  if (!result.ok) throw new Error(`attack rejected: ${result.error.code} ${result.error.message}`);
  return result.events;
}

/** The wire projection's own answer for the same row — the payability mirror. */
function wirePlayable(state: GameState, seat: Seat, index: number): boolean | undefined {
  const phase = redactGame(state, seat).phase;
  if (phase.kind !== "turn:action") throw new Error(`expected turn:action, got ${phase.kind}`);
  return phase.attacks.find((a) => a.index === index)?.playable;
}

/** Use "Angelite" (idx 1) on `seat`'s turn, then wind the board back round to
    `seat` — the board the cancel is printed for. */
function afterAngelite(seed: number, first: Seat, seat: Seat, activeId: string): GameState {
  const start = untilTurnOf(board(seed, first, seat, activeId), seat);
  const after = must(applyAction(start, { type: "attack", seat, index: 1 }));
  return untilTurnOf(after, seat, start.turn + 1);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. The census, the consequent, and the "no split" measurement.
// ─────────────────────────────────────────────────────────────────────────────

describe("D396 §1 — the corpus, the consequent it shares with Terapagos, and the split that buys zero", () => {
  it("🆕🆕 D419 — the hand-kept READERS list IS the module's reader surface", () => {
    // 🛑 THE GUARD THIS FILE NEVER HAD, IN D417's SHAPE AND D418's WORDING. This
    // copy was hand-kept and NOTHING compared it to what `effects.ts` exports, so
    // it could sit short of the module indefinitely — which is precisely the state
    // `censusAtHead.test.ts` was in before D417 and thirty more files were in after
    // D418. A guard in another file guards that file's copy alone.
    //
    // ⚠️ AND THE FIGURES NO LONGER COME OFF THIS LIST AT ALL. Resolution below is
    // computed through `resolvedByAnyReader` IMPORTED from `censusAttackCorpus.ts`,
    // off the MODULE surface, so no edit here can move a census number again. What
    // survives is a DECLARED EXPECTATION, and this rung is its only remaining job.
    expect(READERS.map((read) => read.name).sort()).toEqual(attackReaderSurface());
    // ⚠️ THE COUNT IS PINNED SEPARATELY FROM THE DIFF ABOVE, and the separation is
    // load-bearing: a diff alone stays GREEN when a slice deletes a reader from the
    // module and from this list in the SAME commit, and the figures would then move
    // with nothing naming the cause.
    expect(attackReaderSurface()).toHaveLength(13);
  });

  it("🛑 the corpus holds the sentence ONCE at THREE printings, and no reader takes it", () => {
    const rows = legalAttackCorpus().filter(([, text]) => text === ANGELITE);
    expect(rows.length).toBe(1);
    expect(rows.reduce((sum, [units]) => sum + units, 0)).toBe(3);
    // 🛑 REFUSED WHOLE, which is what makes the gate the only thing accounting for
    // the clause — if a reader ever takes this string, something is double-counting.
    expect(resolvedByAnyReader(ANGELITE)).toBe(false);
  });

  it("🛑 the CONSEQUENT is `barredIf`'s, in the passive voice — both spellings measured", () => {
    // D394's handoff priced *"this attack can't be used"* as a THIRD consequent
    // shape the union does not spell. It is Terapagos ex's clause with the subject
    // and object swapped, and the corpus is where that is settled rather than in
    // prose: two sentences, one shape, and the polarity token serves both.
    const passive = legalAttackCorpus().filter(([, t]) => t.includes("this attack can't be used"));
    expect(passive.length).toBe(1);
    expect(passive.reduce((sum, [units]) => sum + units, 0)).toBe(3);
    const active = legalAttackCorpus().filter(([, t]) => t.includes("you can't use this attack"));
    expect(active.length).toBe(1);
    expect(active.reduce((sum, [units]) => sum + units, 0)).toBe(7);
    // …and the two really are disjoint sentences, so the 3 and the 7 do not overlap.
    expect(passive[0]?.[1]).not.toBe(active[0]?.[1]);
    // The corpus-wide family this row is the biggest member of.
    const family = legalAttackCorpus().filter(([, t]) => t.includes("during your last turn"));
    expect(family.length).toBe(5);
    expect(family.reduce((sum, [units]) => sum + units, 0)).toBe(7);
  });

  it("🛑 NO SPLIT IS AUTHORED, and the reason is that a trailing one would buy ZERO", () => {
    // ① The splitter does not claim this string, and must not: it is a LEADING
    //    clause matcher anchored at `^` by deliberate policy, and Angelite's clause
    //    is TRAILING.
    expect(splitAttackGateClause(ANGELITE)).toBeNull();
    // ② And a trailing stripper would hand the readers THIS, which every one of the
    //    nine refuses — so the census split summand would gain nothing at all and
    //    `ATTACK_EFFECT_SKIPPED` would name this printing either way.
    expect(resolvedByAnyReader(ANGELITE_BODY)).toBe(false);
    expect(splitAttackGateClause(ANGELITE_BODY)).toBeNull();
    // 🛑 THE ATTRIBUTION CONTROL. Without this line the two `false`s above are green
    // on a build where every reader is broken, which is the exact shape D318's
    // finding-one warns about: index 0's printed text on the SAME card DOES resolve.
    expect(resolvedByAnyReader(MAGICAL_CHARM)).toBe(true);
    expect(deriveAttackEffect(MAGICAL_CHARM)).toEqual([
      { op: "weakenDefenderAttacks", amount: 100 },
    ]);
    // ③ …and the gate corpus is UNMOVED at 6 sentences / 14 printings, which is what
    //    says this slice added no `ATTACK_GATE_CLAUSES` row.
    const gated = legalAttackCorpus().filter(([, t]) => splitAttackGateClause(t) !== null);
    expect(gated.length).toBe(6);
    expect(gated.reduce((sum, [units]) => sum + units, 0)).toBe(14);
    expect(gated.some(([, t]) => t === ANGELITE)).toBe(false);
  });

  it("🛑 THREE ids, ONE program object, and the gate is at index 1 — D281's reprint idiom", () => {
    const program = programFor(SYLVEON);
    expect(program).toBeDefined();
    // By OBJECT IDENTITY, not by deep equality: Terapagos ex's treatment, which is
    // what a byte-identical `attacks_json` across a reprint group earns. Illumise
    // and Scream Tail ex print ONE clause on TWO cards and are deliberately two
    // consts; this is one card printed three times.
    expect(programFor(SYLVEON_PRE)).toBe(program);
    expect(programFor(SYLVEON_SIR)).toBe(program);
    // ZERO new state: this row authors no `attack` program, no `abilities`, no
    // `passive` — the whole surface is the gate.
    expect(Object.keys(program ?? {})).toEqual(["attackGate"]);
    // 🛑 THE KEY IS THE ASSERTION, and it is `["1"]` on a card whose OTHER attack is
    // the one the player buys the card for.
    expect(Object.keys(program?.attackGate ?? {})).toEqual(["1"]);
    expect(program?.attackGate?.[1]).toEqual({
      kind: "barredIf",
      condition: { kind: "yourPokemonUsedAttackLastTurn", attack: "Angelite" },
    });
  });

  it("🛑 the clause NAMES the attack it is printed ON — the self-barring geometry", () => {
    // 🛑 THE DIFFERENCE FROM D395, AND IT IS WHAT MAKES THESE THREE PRINTINGS A
    // SECOND TEST OF THE INDEX KEY RATHER THAN A REPEAT OF THE FIRST. Miltank's gate
    // sits at index 1 and names index 0, so an index-blind read produces a DEADLOCK;
    // Angelite's gate sits at index 1 and names index 1, so an index-blind read
    // instead confiscates index 0 — the attack that actually deals damage.
    const attacks = POOL[SYLVEON]?.attacks ?? [];
    expect(attacks).toHaveLength(2);
    expect(attacks[0]?.name).toBe("Magical Charm");
    expect(attacks[0]?.damage).toBe(160);
    expect(attacks[0]?.effect).toBe(MAGICAL_CHARM);
    expect(attacks[1]?.name).toBe("Angelite");
    expect(attacks[1]?.damage).toBeUndefined();
    expect(attacks[1]?.effect).toBe(ANGELITE);
    const gated = programFor(SYLVEON)?.attackGate?.[1];
    const named = gated?.kind === "barredIf" ? gated.condition : undefined;
    expect(named?.kind === "yourPokemonUsedAttackLastTurn" && named.attack).toBe(attacks[1]?.name);
  });

  it("`attackGateOf` answers index 1 and NOT index 0 — total, and index-keyed", () => {
    const state = board(SEEDS[0], "p1", "p1", SYLVEON);
    const body = activeOf(state, "p1");
    expect(attackGateOf(state, body, 1)).toBeDefined();
    expect(attackGateOf(state, body, 0)).toBeUndefined();
    expect(attackGateOf(state, body, 99)).toBeUndefined();
    expect(attackGateOf(state, body, -1)).toBeUndefined();
    const twin = board(SEEDS[0], "p1", "p1", UNGATED_TWIN);
    expect(attackGateOf(twin, activeOf(twin, "p1"), 1)).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. 🛑 THE INDEX — asserted on the row the cancel must NOT reach, first.
// ─────────────────────────────────────────────────────────────────────────────

describe("D396 §2 — the row an INDEX-BLIND read confiscates", () => {
  it("🛑 idx 0 'Magical Charm' is LIVE on the very board where idx 1 is cancelled", () => {
    // 🛑 THE FIRST ASSERTION IN THE FILE ABOUT THE ENGINE IS THE ONE ABOUT THE ROW
    // THE GATE MUST NOT REACH — D278/D279's standing lesson. An index-blind read
    // (`Object.values(attackGate)[0]`, or a per-BODY flag) is green on every "the
    // cancel bites" line below and takes 160 damage a turn away from the card.
    for (const first of ["p1", "p2"] as const) {
      for (const seat of ["p1", "p2"] as const) {
        for (const seed of SEEDS) {
          const state = afterAngelite(seed, first, seat, SYLVEON);
          expect(declare(state, seat, 1), `${seed} ${first} ${seat}`).toBe("ATTACK_PREVENTED");
          expect(declare(state, seat, 0), `${seed} ${first} ${seat}`).toBe("OK");
        }
      }
    }
  });

  it("🛑 …and a row authored at index 0 is the OTHER defect — both rows must stay live fresh", () => {
    // The authoring-side mistake, whose symptom is the mirror of the reader-side
    // one: a gate keyed `0` cancels "Magical Charm" and leaves "Angelite"
    // unconditionally legal. It is told apart from the row above by the FRESH board,
    // where nothing has used Angelite and BOTH rows must be declarable.
    for (const first of ["p1", "p2"] as const) {
      for (const seat of ["p1", "p2"] as const) {
        for (const seed of SEEDS) {
          const state = untilTurnOf(board(seed, first, seat, SYLVEON), seat);
          expect(declare(state, seat, 0), `${seed} ${first} ${seat}`).toBe("OK");
          expect(declare(state, seat, 1), `${seed} ${first} ${seat}`).toBe("OK");
        }
      }
    }
  });

  it("🛑 and the WIRE greys exactly one of the two rows — the per-index projection", () => {
    // The quiet direction: a greyed row is never clicked, so nobody reports it. A
    // body-wide `banned` term is green on the engine half above and wrong here.
    for (const first of ["p1", "p2"] as const) {
      for (const seat of ["p1", "p2"] as const) {
        const state = afterAngelite(SEEDS[0], first, seat, SYLVEON);
        expect(wirePlayable(state, seat, 0), `${first} ${seat}`).toBe(true);
        expect(wirePlayable(state, seat, 1), `${first} ${seat}`).toBe(false);
      }
    }
  });

  it("the refusal NAMES the printed clause in the printed polarity", () => {
    const state = afterAngelite(SEEDS[0], "p1", "p1", SYLVEON);
    const result = applyAction(state, { type: "attack", seat: "p1", index: 1 });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected the cancel to refuse");
    expect(result.error.message).toContain("Angelite");
    expect(result.error.message).toContain(
      "it cannot be used while 1 of your Pokémon used Angelite during your last turn",
    );
    // …and the note comes from the ONE reader that knows the polarity, not from a
    // second switch at the call site (D131).
    const gate = attackTimingBlocked(state, "p1", activeOf(state, "p1"), 1);
    expect(gate).toBeDefined();
    expect(gate === undefined ? "" : attackTimingNote(gate)).toBe(
      "it cannot be used while 1 of your Pokémon used Angelite during your last turn",
    );
    // 🛑 AND THE NOTE IS THE PRINTED CLAUSE WITH NOTHING RESOLVED, which is the
    // family's first — every sibling arm rewrites a "this Pokémon" pronoun (D116)
    // and this printed subject carries none.
    expect(
      conditionNote({ kind: "yourPokemonUsedAttackLastTurn", attack: "Angelite" }),
    ).toBe("1 of your Pokémon used Angelite during your last turn");
    expect(ANGELITE).toContain(
      `If ${conditionNote({ kind: "yourPokemonUsedAttackLastTurn", attack: "Angelite" })},`,
    );
    // …and it is NOT the sibling's note, which is what a `zone?` field defaulting
    // to the Active would have printed on this very board.
    expect(
      conditionNote({ kind: "yourActiveUsedAttackLastTurn", attack: "Angelite" }),
    ).toBe("your Active Pokémon used Angelite during your last turn");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. 🛑 THE SUBJECT WIDENING — the board an ACTIVE-ONLY read gets wrong.
// ─────────────────────────────────────────────────────────────────────────────

describe("D396 §3 — '1 of your Pokémon' is Active PLUS Bench, driven on the board that separates them", () => {
  it("the ACTIVE case, from both seats and under both assignments — the easy half", () => {
    for (const first of ["p1", "p2"] as const) {
      for (const seat of ["p1", "p2"] as const) {
        for (const seed of SEEDS) {
          const state = afterAngelite(seed, first, seat, SYLVEON);
          expect(declare(state, seat, 1), `${seed} ${first} ${seat}`).toBe("ATTACK_PREVENTED");
          expect(wirePlayable(state, seat, 1), `${seed} ${first} ${seat}`).toBe(false);
        }
      }
    }
  });

  it("🛑 THE BENCH CASE — a SECOND Sylveon ex is cancelled by the FIRST one's history", () => {
    // 🛑 THE ASSERTION THIS SLICE EXISTS FOR, and the one an ACTIVE-only reading is
    // green on everywhere else. Sylveon ex A uses "Angelite"; A leaves the Active
    // Spot and Sylveon ex B is promoted; B declares "Angelite" on the next of the
    // player's own turns. The printed clause bars it — A is 1 of your Pokémon and it
    // used Angelite during your last turn — and B's own `usedAttack` is `null`, so
    // `yourActiveUsedAttackLastTurn` answers FALSE and lets the declaration through.
    for (const first of ["p1", "p2"] as const) {
      for (const seat of ["p1", "p2"] as const) {
        for (const seed of SEEDS) {
          const used = afterAngelite(seed, first, seat, SYLVEON);
          // The surgery displaces the stamped body onto the Bench and promotes a
          // FRESH copy — so the only thing carrying the history is a benched body.
          const swapped = payBoth(setActiveFromDeck(used, seat, SYLVEON), seat);
          const promoted = activeOf(swapped, seat);
          expect(promoted.usedAttack, `${seed} ${first} ${seat}`).toBeNull();
          expect(
            swapped.players[seat].bench.some((p) => p.usedAttack?.name === "Angelite"),
            `${seed} ${first} ${seat}`,
          ).toBe(true);
          expect(declare(swapped, seat, 1), `${seed} ${first} ${seat}`).toBe("ATTACK_PREVENTED");
          expect(wirePlayable(swapped, seat, 1), `${seed} ${first} ${seat}`).toBe(false);
          // …and index 0 is STILL live on that board, so the bench term widened the
          // condition and not the gate's reach.
          expect(declare(swapped, seat, 0), `${seed} ${first} ${seat}`).toBe("OK");
        }
      }
    }
  });

  it("🛑 …and the same board reached through a REAL retreat, not surgery", () => {
    // The board above is built with `setActiveFromDeck`, which is test surgery. This
    // one is built out of printed rules only — a §11 retreat paying the printed cost
    // of 2 — so the case is reachable in an actual game and not merely in a fixture.
    for (const seat of ["p1", "p2"] as const) {
      const start = untilTurnOf(board(SEEDS[0], "p1", seat, SYLVEON), seat);
      const withBench = benchFromDeck(start, seat, SYLVEON);
      const attacked = must(applyAction(withBench, { type: "attack", seat, index: 1 }));
      const back = untilTurnOf(attacked, seat, start.turn + 1);
      const paying = activeOf(back, seat).energy.slice(0, 2);
      expect(paying, seat).toHaveLength(2);
      const benchIndex = back.players[seat].bench.findIndex(
        (p) => back.cardIdByUid[p.stack[p.stack.length - 1] ?? ""] === SYLVEON,
      );
      expect(benchIndex, seat).toBeGreaterThanOrEqual(0);
      const retreated = must(
        applyAction(back, {
          type: "retreat",
          seat,
          discardEnergy: [...paying],
          promoteBenchIndex: benchIndex,
        }),
      );
      const ready = payBoth(retreated, seat);
      expect(activeOf(ready, seat).usedAttack, seat).toBeNull();
      expect(declare(ready, seat, 1), seat).toBe("ATTACK_PREVENTED");
      expect(declare(ready, seat, 0), seat).toBe("OK");
    }
  });

  it("🛑 the window has a BACK EDGE — one more of your own turns and the cancel lifts", () => {
    // A cancel that read "has ever used Angelite" is green on every board above. The
    // printed word is "LAST turn": one own turn further on, the record is two of the
    // player's turns old and the attack is legal again — from the BENCHED body too,
    // which is the half a widened member could get wrong on its own.
    for (const first of ["p1", "p2"] as const) {
      for (const seat of ["p1", "p2"] as const) {
        const used = afterAngelite(SEEDS[0], first, seat, SYLVEON);
        const later = untilTurnOf(used, seat, used.turn + 1);
        expect(declare(later, seat, 1), `${first} ${seat}`).toBe("OK");
        const swapped = payBoth(setActiveFromDeck(used, seat, SYLVEON), seat);
        const swappedLater = untilTurnOf(swapped, seat, swapped.turn + 1);
        expect(declare(swappedLater, seat, 1), `${first} ${seat}`).toBe("OK");
      }
    }
  });

  it("🛑 the OPPONENT's Angelite does not cancel yours — the possessive is read", () => {
    // "1 of YOUR Pokémon". A seat-blind walk is green on every board above, because
    // every one of them stamps the asking seat's own body.
    for (const seat of ["p1", "p2"] as const) {
      const other = seat === "p1" ? "p2" : "p1";
      // The opponent gets the Sylveon ex and uses Angelite; the asking seat's own
      // board has never used it.
      let state = localSetup(SEEDS[0], "p1");
      state = setActiveFromDeck(state, other, SYLVEON);
      state = clearBench(state, other);
      state = benchFromDeck(state, other, "fix-basic-1");
      state = setActiveFromDeck(state, seat, SYLVEON);
      state = clearBench(state, seat);
      state = benchFromDeck(state, seat, "fix-basic-1");
      state = payBoth(state, other);
      const theirTurn = untilTurnOf(state, other);
      const afterTheirs = must(applyAction(theirTurn, { type: "attack", seat: other, index: 1 }));
      const mine = payBoth(untilTurnOf(afterTheirs, seat, theirTurn.turn), seat);
      expect(
        afterTheirs.players[other].active?.usedAttack?.name,
        seat,
      ).toBe("Angelite");
      expect(declare(mine, seat, 1), seat).toBe("OK");
    }
  });

  it("🛑 a DIFFERENT attack's history does not cancel Angelite — the NAME is read", () => {
    // Drop the name test and "Magical Charm" cancels "Angelite". Both halves of the
    // helper are load-bearing and they fail on different boards; this is the other.
    for (const seat of ["p1", "p2"] as const) {
      const start = untilTurnOf(board(SEEDS[0], "p1", seat, SYLVEON), seat);
      const charmed = must(applyAction(start, { type: "attack", seat, index: 0 }));
      const back = payBoth(untilTurnOf(charmed, seat, start.turn + 1), seat);
      expect(activeOf(back, seat).usedAttack?.name, seat).toBe("Magical Charm");
      expect(declare(back, seat, 1), seat).toBe("OK");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. §9 does not reach this field, and both projections agree per index.
// ─────────────────────────────────────────────────────────────────────────────

describe("D396 §4 — the §9 rule, and the payability mirrors", () => {
  it("🛑 a live Klefki Ability-lock changes NOTHING on either side of the cancel", () => {
    // The INVERSE of `PassiveEffects.attackFirstTurnExempt`'s rule: §9 locks
    // ABILITIES, and every clause in `attackGate` is printed as ATTACK text. Driven
    // under a live lock rather than argued.
    for (const seat of ["p1", "p2"] as const) {
      const other = seat === "p1" ? "p2" : "p1";
      const fresh = untilTurnOf(board(SEEDS[0], "p1", seat, SYLVEON), seat);
      const cancelled = afterAngelite(SEEDS[0], "p1", seat, SYLVEON);
      for (const [label, state] of [
        ["fresh", fresh],
        ["cancelled", cancelled],
      ] as const) {
        const locked = benchFromDeck(state, other, "sv01-096");
        // The lock is really live on this board — without this line the two answers
        // agree because nothing is suppressed anywhere.
        expect(locked.players[other].bench.length, label).toBeGreaterThan(
          state.players[other].bench.length,
        );
        expect(declare(locked, seat, 1), `${seat} ${label}`).toBe(declare(state, seat, 1));
        expect(declare(locked, seat, 0), `${seat} ${label}`).toBe(declare(state, seat, 0));
      }
    }
  });

  it("the ENGINE gate and the WIRE projection agree on every row, seat and seed", () => {
    // Swept for AGREEMENT rather than asserted on either side alone — the failure
    // direction of a projection that drifts is the quiet one.
    let compared = 0;
    let legalRows = 0;
    for (const first of ["p1", "p2"] as const) {
      for (const seat of ["p1", "p2"] as const) {
        for (const seed of SEEDS) {
          for (const state of [
            untilTurnOf(board(seed, first, seat, SYLVEON), seat),
            afterAngelite(seed, first, seat, SYLVEON),
          ]) {
            for (const index of [0, 1]) {
              const accepted = declare(state, seat, index) === "OK";
              expect(wirePlayable(state, seat, index), `${seed} ${first} ${seat} ${index}`).toBe(
                accepted,
              );
              compared += 1;
              if (accepted) legalRows += 1;
            }
          }
        }
      }
    }
    // THE ATTRIBUTION CONTROLS, both directions: the sweep really ran, and it found
    // live rows as well as refused ones. Without the second, this whole `it` passes
    // on a build that refuses every attack in the game.
    // 2 assignments × 2 seats × 4 seeds × 2 boards × 2 rows.
    expect(compared).toBe(64);
    expect(legalRows).toBeGreaterThan(0);
    expect(legalRows).toBeLessThan(compared);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. 🛑 NO SPLIT — and the proof is an IDENTITY with the ungated twin.
// ─────────────────────────────────────────────────────────────────────────────

describe("D396 §5 — the report, which is the SAME on the gated body and on the twin", () => {
  it("🛑 the gated declaration reports the WHOLE printed sentence — and so does the twin", () => {
    // 🛑 D395's ASSERTION INVERTED, AND ON PURPOSE. There the gated body reported
    // NOTHING and the twin reported the sentence, because a split fired; here both
    // report the same string, because no split is authored and the printed text
    // reaches the readers whole on both bodies. That IDENTITY is the measurement
    // that says "gate only" — a slice that quietly added a trailing stripper would
    // break it in one direction, and a slice that broke the gate would leave it
    // untouched, which is why §2/§3 carry the gate and this carries the accounting.
    const gated = untilTurnOf(board(SEEDS[0], "p1", "p1", SYLVEON), "p1");
    const gatedSkipped = declareEvents(gated, "p1", 1).filter(
      (e) => e.type === "ATTACK_EFFECT_SKIPPED",
    );
    expect(gatedSkipped).toHaveLength(1);
    expect(gatedSkipped[0]).toMatchObject({ effect: ANGELITE, damageModifier: null });

    const twin = untilTurnOf(board(SEEDS[0], "p1", "p1", UNGATED_TWIN), "p1");
    const twinSkipped = declareEvents(twin, "p1", 1).filter(
      (e) => e.type === "ATTACK_EFFECT_SKIPPED",
    );
    expect(twinSkipped).toHaveLength(1);
    expect(twinSkipped[0]).toMatchObject({ effect: ANGELITE, damageModifier: null });
  });

  it("🛑 the twin is UNCANCELLED on the board where the real printing is barred", () => {
    // The control on the DECLARATION seam: the printed TEXT gates nothing, and it
    // must not — only a registry row does. Without this the whole file is green on a
    // build that reads the sentence instead of the program.
    for (const seat of ["p1", "p2"] as const) {
      const state = afterAngelite(SEEDS[0], "p1", seat, UNGATED_TWIN);
      expect(declare(state, seat, 1), seat).toBe("OK");
      expect(wirePlayable(state, seat, 1), seat).toBe(true);
      expect(activeOf(state, seat).usedAttack?.name, seat).toBe("Angelite");
    }
  });

  it("index 0 really resolves its printed op on this card — a gate is not a program", () => {
    const state = untilTurnOf(board(SEEDS[0], "p1", "p1", SYLVEON), "p1");
    const before = activeOf(state, "p2").damage;
    const next = must(applyAction(state, { type: "attack", seat: "p1", index: 0 }));
    expect(before).toBe(0);
    expect(activeOf(next, "p2").damage).toBe(160);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. `MATCH_RECORD_VERSION` — the question asked of all three halves.
// ─────────────────────────────────────────────────────────────────────────────

describe("D396 §6 — MATCH_RECORD_VERSION stays 25, and the reason is measured", () => {
  it("the slice persists NOTHING a v25 record could be missing", () => {
    // ⚠️ THE CONSTANT ITSELF LIVES IN `apps/api/src/lobby/match.ts` and its tie is
    // held there (`match.test.ts`), so this file cannot import it and does not
    // pretend to. What it CAN do is drive the three reasons the number does not
    // move, which is the half a constant-equality assertion could never give.
    // ① the value carries no `EffectOp`, so it cannot ride a parked continuation
    //    into a record (D281's own sweep, re-run on the new row);
    const gate = programFor(SYLVEON)?.attackGate?.[1];
    expect(JSON.stringify(gate ?? {}).includes('"op":')).toBe(false);
    // ② the member is a WIDENING no v25 record can contain, because the only card
    //    that authors it is this one and it is authored in the registry — a catalog
    //    fact re-derived from the board on every read, never written into a record;
    expect(gate).toEqual({
      kind: "barredIf",
      condition: { kind: "yourPokemonUsedAttackLastTurn", attack: "Angelite" },
    });
    // ③ and the stamp it READS has been a REQUIRED `InPlayPokemon` field since
    //    D394's own bump, so a v25 record already carries it on every body.
    const state = afterAngelite(SEEDS[0], "p1", "p1", SYLVEON);
    expect(activeOf(state, "p1").usedAttack).toEqual({ name: "Angelite", turn: state.turn - 2 });
    for (const body of state.players.p1.bench) {
      expect(Object.hasOwn(body, "usedAttack")).toBe(true);
    }
  });

  it("no `fix-*` demonstrator reached the shared pool — the census control", () => {
    // D275's idiom, asserted by id in both directions: this suite's bodies are
    // LOCAL, so `FIXTURE_POOL` is untouched and `registryCardIds()` moves by exactly
    // the THREE real catalog ids the registry row is keyed on.
    for (const id of [SYLVEON, SYLVEON_PRE, SYLVEON_SIR, UNGATED_TWIN]) {
      expect(FIXTURE_POOL[id], id).toBeUndefined();
    }
    expect(programFor(UNGATED_TWIN)).toBeUndefined();
  });
});
