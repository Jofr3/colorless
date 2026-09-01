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
  createGame,
  programFor,
  redactGame,
} from "./index";
import { attackTimingBlocked, attackTimingNote } from "./index";
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

// 0.299.0 → 0.300.0 — 🆕🆕 D395: THE ROLLOUT ATTACK-GATE.
//
// Miltank `sv08.5-081` idx **1** "Moomoo Rolling" ({C}{C}, flat `100`):
//   *"You can use this attack only if this Pokémon used Rollout during your last
//    turn."* — **1 legal printing** (`legalAttackCorpus()`), and its own idx 0 is
//   "Rollout" ({C}, 20, NO effect text) — the attack the clause names, printed on
//   the same card one index down.
//
// ── WHAT SHIPS ───────────────────────────────────────────────────────────────
// **ONE registry row** (a bare `CardProgram.attackGate`), **ONE new
// `ATTACK_GATE_CLAUSES` literal** and **ONE reversed branch** in
// `splitAttackGateClause`. ZERO new state, ZERO new `BoardCondition` members,
// ZERO new ops, events, error codes, prompt kinds, readers, regexes or
// `packages/schema` bytes; ZERO `redact.ts` bytes; and **`MATCH_RECORD_VERSION`
// STAYS 25** (§6). D394's `yourActiveUsedAttackLastTurn { attack }` and D281's
// `AttackTimingGate.onlyIf` were both already paid for; the slice is the seam
// between them plus the accounting D282 left unfinished.
//
// ── 🛑 THE SHAPE QUESTION, SETTLED FROM THE CATALOG BEFORE A LINE WAS WRITTEN ──
//
// *"Is `CardProgram.attackGate` DERIVABLE from the printed clause, or does this
// printing owe a REGISTRY ROW?"* — settled **REGISTRY ROW**, by measuring what a
// deriver would buy: **ZERO additional legal printings.** The clause is 1
// printing on 1 id, and the only other gate spellings in the catalog are the 13
// that already carry rows (§1). D180/D187's *"an arm transfers across sets; a row
// does not"* therefore prices a hypothetical reprint and nothing that is printed
// today, while D282's refusal of a generic composer for a family of one prices
// the machinery — and `attackGate` has no deriver seam at all, so building the
// first one is the machinery.
//
// ⚠️ **AND A DERIVER WOULD HAVE COST A GUARD RATHER THAN JUST CODE.** `attack.ts`
// splits the printed text ONLY when a registry row REPRESENTS the clause at THIS
// index. A derived gate makes that two-key check a tautology and re-installs the
// too-loose build `D282-split-fires-without-a-gate` exists to refuse. §5 drives
// the check on an UNGATED twin printing the identical bytes.
//
// ── 🆕🆕 **D444 REVERSED THAT REFUSAL. THE PARAGRAPHS ABOVE ARE KEPT AS WRITTEN;
//    WHAT THEY GOT RIGHT AND WHAT THEY MISSED IS RECORDED HERE.** (conventions.md:
//    annotate provenance, never overwrite it — and never reverse a decision
//    silently.) ─────────────────────────────────────────────────────────────────
//
// **RIGHT, AND STILL TRUE, RE-MEASURED AT D444's HEAD.** A deriver buys **ZERO
// additional `legal_standard = 1` printings**: `splitAttackGateClause` claims 6
// corpus sentences / 14 printings and all 14 are registry-authored (17 registry
// ids carry `attackGate`; the other 3 are Sylveon ex's TRAILING clause). D444
// claims **0 new printings** and says so in its own decision row.
//
// **RIGHT, AND PAID RATHER THAN ARGUED AWAY.** The two-key check IS a tautology
// now — the clause→gate map is TOTAL over `ATTACK_GATE_CLAUSES`, so a split that
// fires implies a gate that exists. `D282-split-fires-without-a-gate` is
// re-declared `survives: equivalent` on exactly that argument, which means the day
// anyone makes the derivation partial the harness reports `STALE-SURVIVOR` and
// fails the run (D427: prefer a declaration a future change breaks loudly).
//
// 🛑 **WHAT BOTH PARAGRAPHS MISSED: THE FAILURE MODE, WHICH WAS SILENT.** Neither
// asked what happens to the RULE on a body with no row — only what happens to the
// SPLIT. MEASURED at D444's head, on §5's own `UNGATED_TWIN` and on a fixture
// printing Terapagos ex's clause byte for byte: `attackGateOf` → `undefined`,
// `attackTimingBlocked` → `undefined`, and the attack **DECLARES SUCCESSFULLY on
// exactly the turn the card forbids it**. The damage half of the same sentence was
// loudly withheld the whole time. **Two halves of one sentence failing in opposite
// directions, and only the loud half was ever driven.**
//
// 🛑 **AND THE ZERO WAS SCOPED WHERE THE ENGINE IS NOT (D413).** "Zero additional
// LEGAL printings" counts `legal_standard = 1`; the builder ships an `expanded`
// format keyed on `legal_expanded` (`src/features/builder/cards.ts` `legalFlag`),
// and `effects.ts`'s own clause-table block records that the pool-wide query
// returns **15** where the legal one returns 13 — the 2 extras being Bombirdier ex
// `sv04-156`/`-234`, which print the BAN clause and carry **no registry row**.
// Two populations, two answers, biting a REFUSAL instead of a census.
//
// ⚠️ **AND THE ONE ARGUMENT FOR A DERIVER IS D394's, WHICH DOES NOT SURVIVE THE
// MOVE.** D394 refused a template over the same open-ended ATTACK NAME because
// its seam (the clause table) is handed a sentence with no card in scope, so
// *"used Surf Back during your last turn"* would resolve to a predicate that
// answers FALSE forever and silently. `attackGateOf` DOES hold the card, so the
// refusal it wanted is available here — which is a real asymmetry and still not
// a population. **The same token is untemplatable in one place and templatable
// in the other, and the difference is what is IN SCOPE, not what is printed.**
//
// ── WHAT THIS SUITE EXISTS TO PIN ────────────────────────────────────────────
//
// 1. 🛑 **THE DEADLOCK BOARD, FIRST.** D281 recorded that all 13 of its printings
//    sit at index 0 and called that *"an accident of today's pool and not a
//    reason"* — so until this row, an INDEX-BLIND read (a per-body flag, or
//    `Object.values(attackGate)[0]`) was green on every assertion in the repo.
//    Miltank is the first board that falsifies it, and it falsifies it TOTALLY:
//    the gate is at index 1 and the attack that SATISFIES the gate is at index 0,
//    so an index-blind build gates "Rollout" and the card can never be used
//    again. §2 asserts idx 0 is live BEFORE it asserts idx 1 is barred.
// 2. 🛑 **THE WINDOW HAS A BACK EDGE.** A gate that opened on "has ever used
//    Rollout" is green on every board anyone naturally writes. §3 drives the
//    board two of the player's own turns later, where the printed *"during your
//    LAST turn"* has closed again.
// 3. 🛑 **THE SPLIT IS ACCOUNTING, NOT COSMETICS.** With the clause left on the
//    front, `ATTACK_EFFECT_SKIPPED` fires naming a sentence the §8 seam enforced
//    in full — D282's own defect with the resolved half being ALL of it. §5
//    asserts the gated declaration emits none AND that the ungated twin still
//    emits one, which is the pre-D282 behaviour byte for byte.
// 4. **§9 DOES NOT REACH THIS FIELD.** The clause is printed as ATTACK text, so a
//    Klefki `sv01-096` Ability-lock must change nothing — the inverse of the rule
//    `PassiveEffects.attackFirstTurnExempt` follows one field over. §4.
// 5. **BOTH PAYABILITY PROJECTIONS AGREE, PER INDEX.** §4.

/** THE PRINTED SENTENCE, byte for byte off the committed corpus. */
const ROLLOUT_GATE =
  "You can use this attack only if this Pokémon used Rollout during your last turn.";

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

const MILTANK = "sv08.5-081";
/** 🛑 THE ATTRIBUTION CONTROL, and the suite is vacuous without it: the SAME two
    attacks and the SAME printed bytes on a body with NO registry row. Every
    "the gate bites" line below passes on a build that refuses all attacks, and
    every "the split fires" line passes on a build that splits on text alone —
    this body is the only thing that tells those apart from the real behaviour. */
const UNGATED_TWIN = "fix-moomoo-ungated";

/** 🆕🆕 **D444 — THE NEAR-MISS BODY, AND IT IS THE CONTROL THE DERIVED GATE OWES.**
    The identical printed SHAPE with one token changed — the quoted attack name —
    and that string is NOT a row of `ATTACK_GATE_CLAUSES`. It exists to say, on a
    board, that D444's derivation is a CLOSED LITERAL TABLE and not the template
    `^You can use this attack only if (.+)\.$` that D394 and D395 both refuse: this
    body derives NO gate, keeps its whole printed string, and stays on the loud
    `ATTACK_EFFECT_SKIPPED` path.

    🛑 **IT IS ALSO THE DISCRIMINATION THE OLD `UNGATED_TWIN` RUNGS PROVIDED (D418).**
    Before D444, §5's twin carried the claim *"the split fires only where the clause
    is REPRESENTED"* — a claim the derivation makes vacuous, because a table clause is
    now always represented. Re-pointing the twin onto *"it is gated too"* would have
    been TRUE and would have dropped that discrimination entirely. This body carries
    it instead, and carries it at the only place it can still fail: a build that
    templated the clause instead of tabling it gates this card FOREVER (its
    "Nuzzle" is never used, so `yourActiveUsedAttackLastTurn` answers false forever)
    — which is the exact failure D395's block calls *"an attack the player can never
    use, which no board in the suite would look wrong on"*. */
const NEAR_MISS_TWIN = "fix-moomoo-near-miss";

/** The near-miss sentence, one token off `ROLLOUT_GATE`: the quoted attack NAME.
    ⚠️ Differs from the anchor on EXACTLY ONE AXIS (D427) — same case, same
    punctuation, same word order — so a green refusal here can only be about the
    name, and not about a rewording the table would have missed anyway. */
const NEAR_MISS_GATE =
  "You can use this attack only if this Pokémon used Nuzzle during your last turn.";

/** Miltank `sv08.5-081`, transcribed WHOLE off the printing (D306/D146: a fixture
    that claims to BE the printing gets every scalar re-read, not only the ones the
    assertions touch) — the 130 HP, the {C} type, the ×2 {F} weakness, the retreat
    2, and BOTH attacks at their printed indices with their printed costs and
    damage. ⚠️ **THE ATTACK ORDER IS THE WHOLE POINT** and is asserted from these
    bytes in §1: the registry authors `{ 1: … }` by hand, and a fixture that put
    "Moomoo Rolling" first would make every assertion in this file green about the
    wrong row. */
function miltank(id: string): Card {
  return battler(id, {
    name: "Miltank",
    hp: 130,
    retreat: 2,
    types: ["Colorless"],
    weaknesses: [{ type: "Fighting", value: "×2" }],
    attacks: [
      { cost: ["Colorless"], name: "Rollout", damage: 20 },
      {
        cost: ["Colorless", "Colorless"],
        name: "Moomoo Rolling",
        damage: 100,
        effect: ROLLOUT_GATE,
      },
    ],
  });
}

const LOCAL_CARDS: Record<string, Card> = {
  [MILTANK]: miltank(MILTANK),
  // Byte-identical to the row above except for the id, which is exactly what
  // makes it a control: the ONLY difference between the two bodies is that one
  // is represented in the registry and the other is not.
  // 🆕🆕 **D444 — AND THAT DIFFERENCE IS NO LONGER OBSERVABLE, WHICH IS THE SLICE.**
  // `attackGateOf` is `registry ?? derived` from this head, so this body now gates
  // itself off its own printed clause. The rungs below say so rather than asserting
  // the old `undefined`, and `NEAR_MISS_TWIN` carries the discrimination they used
  // to carry.
  [UNGATED_TWIN]: miltank(UNGATED_TWIN),
  [NEAR_MISS_TWIN]: battler(NEAR_MISS_TWIN, {
    name: "Miltank",
    hp: 130,
    retreat: 2,
    types: ["Colorless"],
    weaknesses: [{ type: "Fighting", value: "×2" }],
    attacks: [
      { cost: ["Colorless"], name: "Rollout", damage: 20 },
      {
        cost: ["Colorless", "Colorless"],
        name: "Moomoo Rolling",
        damage: 100,
        effect: NEAR_MISS_GATE,
      },
    ],
  }),
};

/** D275's idiom: a LOCAL pool, so nothing lands in `FIXTURE_POOL`. `sv08.5` is
    not one of `CATALOG_MANIFEST`'s six sets, so a shared-pool body would have owed
    a `fix-*` demonstrator key here as well — the key is the SET, not the surface. */
const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

/** The suite's own deck (D270: a seeded suite gets one). `fix-titan` is 340 HP
    with NO attacks, so it survives Rollout's 20 AND Moomoo Rolling's 100 and can
    never take a turn of its own in the middle of a three-turn board — nothing here
    can move a damage number or end a game except the two attacks under test. */
const ROLLOUT_DECK = deckOf({
  [MILTANK]: 4,
  [UNGATED_TWIN]: 4,
  // 🆕🆕 D444 — the near-miss control, and `fix-energy` drops 34 → 30 to keep the
  // 60 honest. ⚠️ THE DECK IS A SHARED FIXTURE ONLY WITHIN THIS FILE (D275's local
  // pool), so no other suite's seeds move (conventions.md, D412's rule).
  [NEAR_MISS_TWIN]: 4,
  "sv01-096": 2, // Klefki — the §9 Ability-lock control
  "fix-titan": 8,
  "fix-basic-1": 8,
  "fix-energy": 30, // Basic {C} — pays both printed costs
});

/** Four seeds, so nothing below rests on one shuffle (D270). */
const SEEDS = [5011, 5021, 5023, 5039] as const;

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
  const created = createGame({ seed, decks: { p1: ROLLOUT_DECK, p2: ROLLOUT_DECK }, cardPool: POOL });
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

/** `seat`'s Active is `activeId` with TWO {C} attached (so every printed cost in
    this pool is payable and a refusal can only ever be a GATE), a body behind it
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
  return attachFromDeck(state, seat, "fix-energy", 2);
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
    going-first player from attacking on turn 1, and a board that hit that ban
    would report `FIRST_TURN_ATTACK` where this file reads `ATTACK_PREVENTED` — a
    refusal for the wrong reason, which is exactly what `declare` returning a CODE
    rather than a boolean exists to catch. Turn 3 is past it for either seat under
    either assignment. */
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
    through this, so a green "the gate refuses" line can never be a refusal for the
    wrong reason (an unpaid cost, a §4 ban, a bad index). */
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

/** Use "Rollout" (idx 0) on `seat`'s turn, then wind the board back round to
    `seat` — the board the gate is printed for. */
function afterRollout(seed: number, first: Seat, seat: Seat, activeId: string): GameState {
  const start = untilTurnOf(board(seed, first, seat, activeId), seat);
  const after = must(applyAction(start, { type: "attack", seat, index: 0 }));
  return untilTurnOf(after, seat, start.turn + 1);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. The census and the catalog claim the row rests on — the gate is at INDEX 1.
// ─────────────────────────────────────────────────────────────────────────────

describe("D395 §1 — the census, and the per-INDEX claim checked against the printing", () => {
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

  it("🛑 the corpus holds the sentence ONCE, and no reader resolves it whole", () => {
    const rows = legalAttackCorpus().filter(([, text]) => text === ROLLOUT_GATE);
    expect(rows.length).toBe(1);
    expect(rows.reduce((sum, [units]) => sum + units, 0)).toBe(1);
    // 🛑 REFUSED WHOLE, which is what makes the gate the ONLY thing accounting for
    // it — if a reader ever takes this string, the split term is double-counting.
    expect(resolvedByAnyReader(ROLLOUT_GATE)).toBe(false);
    // …and the SKELETON is 3 sentences / 4 printings in the corpus, of which the
    // other 2 sentences / 3 printings are D281's LICENCE spelling. So sweeping the
    // clause rather than the sentence does NOT widen this row: it is 1 either way.
    const skeleton = legalAttackCorpus().filter(([, text]) =>
      text.startsWith("You can use this attack only if"),
    );
    expect(skeleton.length).toBe(3);
    expect(skeleton.reduce((sum, [units]) => sum + units, 0)).toBe(4);
  });

  it("🛑 the registry row is at index 1 and carries D394's member UNCHANGED", () => {
    const gate = programFor(MILTANK)?.attackGate;
    expect(gate).toBeDefined();
    // 🛑 THE KEY IS THE ASSERTION. Thirteen gates before this one sit at index 0,
    // so `["0"]` was the only answer any board in the repo could produce.
    expect(Object.keys(gate ?? {})).toEqual(["1"]);
    expect(gate?.[1]).toEqual({
      kind: "onlyIf",
      condition: { kind: "yourActiveUsedAttackLastTurn", attack: "Rollout" },
    });
    // ZERO new state: the condition is byte-for-byte the member D394 shipped, and
    // this row authors no `attack` program, no `abilities` and no `passive`.
    expect(Object.keys(programFor(MILTANK) ?? {})).toEqual(["attackGate"]);
  });

  it("🛑 the gated attack really IS index 1, and the attack its clause NAMES is index 0", () => {
    // 🛑 THE ASSERTION A PER-INDEX FIELD CANNOT DO WITHOUT, and on this card it is
    // sharper than on any of the 13: the two indices are not interchangeable even
    // in principle, because index 0 is the PRECONDITION of index 1.
    const attacks = POOL[MILTANK]?.attacks ?? [];
    expect(attacks).toHaveLength(2);
    expect(attacks[0]?.name).toBe("Rollout");
    expect(attacks[0]?.effect).toBeUndefined();
    expect(attacks[1]?.name).toBe("Moomoo Rolling");
    expect(attacks[1]?.effect).toBe(ROLLOUT_GATE);
    // …and the clause quotes the name printed at index 0, which is what a derived
    // gate would have had to check and a hand-authored row simply gets right.
    expect(ROLLOUT_GATE).toContain(` ${attacks[0]?.name} `);
  });

  it("`attackGateOf` answers index 1 and NOT index 0 — total, and index-keyed", () => {
    const state = board(SEEDS[0], "p1", "p1", MILTANK);
    const body = activeOf(state, "p1");
    expect(attackGateOf(state, body, 1)).toBeDefined();
    expect(attackGateOf(state, body, 0)).toBeUndefined();
    expect(attackGateOf(state, body, 99)).toBeUndefined();
    expect(attackGateOf(state, body, -1)).toBeUndefined();
  });

  // 🆕🆕 **D444 — THE RUNG ABOVE USED TO END `expect(attackGateOf(twin, …, 1))
  // .toBeUndefined()`, AND THAT LINE IS NOW FALSE.** `attackGateOf` became
  // `registry ?? timingGateFromAttackText`, so the twin gates itself off its own
  // printed clause with no registry row anywhere. ⚠️ **RE-POINTED ONTO A SHAPE
  // CLAIM, NOT A BOOLEAN (D438), AND ONTO THREE BODIES RATHER THAN ONE (D418)** —
  // "no registry row" was the old claim's whole content, so replacing it with
  // "the twin is gated" would be true and would test nothing. The triple is what
  // carries it: the registry body and the unregistered body agree EXACTLY, the
  // near-miss body derives NOTHING, and the index is still the address.
  it("🆕🆕 D444 — the UNREGISTERED twin derives the SAME gate, and the NEAR-MISS derives none", () => {
    const registered = board(SEEDS[0], "p1", "p1", MILTANK);
    const twin = board(SEEDS[0], "p1", "p1", UNGATED_TWIN);
    const nearMiss = board(SEEDS[0], "p1", "p1", NEAR_MISS_TWIN);

    // ① THE PRECONDITION, so the pair below cannot be two reads of one row.
    expect(programFor(MILTANK)?.attackGate?.[1]).toBeDefined();
    expect(programFor(UNGATED_TWIN)).toBeUndefined();
    expect(programFor(NEAR_MISS_TWIN)).toBeUndefined();

    // ② THE AGREEMENT, by VALUE and not by "defined": a derivation that answered
    // some other gate would satisfy `toBeDefined()` and bar the wrong turn.
    const authored = attackGateOf(registered, activeOf(registered, "p1"), 1);
    expect(authored).toEqual({
      kind: "onlyIf",
      condition: { kind: "yourActiveUsedAttackLastTurn", attack: "Rollout" },
    });
    expect(attackGateOf(twin, activeOf(twin, "p1"), 1)).toEqual(authored);

    // ③ THE CLOSED TABLE. One token off the anchor — the quoted attack name — and
    // the derivation refuses, because it is a literal lookup and not the template
    // D394/D395 refuse. A templated build answers a gate here that can never open.
    expect(splitAttackGateClause(NEAR_MISS_GATE)).toBeNull();
    expect(attackGateOf(nearMiss, activeOf(nearMiss, "p1"), 1)).toBeUndefined();

    // ④ THE ADDRESS IS STILL THE INDEX, on the body where the registry cannot be
    // supplying it. Idx 0 ("Rollout") prints no effect text, so the derivation has
    // nothing to read there — an `Object.values(…)[0]` or per-BODY build gates the
    // one attack that can ever satisfy the gate, exactly as it would with a row.
    expect(attackGateOf(twin, activeOf(twin, "p1"), 0)).toBeUndefined();
    expect(attackGateOf(twin, activeOf(twin, "p1"), 99)).toBeUndefined();
    expect(attackGateOf(twin, activeOf(twin, "p1"), -1)).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. 🛑 THE DEADLOCK BOARD — asserted BEFORE anything about the gate working.
// ─────────────────────────────────────────────────────────────────────────────

describe("D395 §2 — the board an INDEX-BLIND read locks out of the game", () => {
  it("🛑 idx 0 'Rollout' is LIVE on the very board where idx 1 is barred", () => {
    // 🛑 THE FIRST ASSERTION IN THE FILE IS THE ONE ABOUT THE ROW THE GATE MUST
    // NOT REACH — D278/D279's standing lesson, and here the too-wide direction is
    // not merely a wrong refusal but a DEADLOCK: "Rollout" is the only way to
    // satisfy "Moomoo Rolling"'s gate, so a build that gated both would make the
    // card permanently unusable while every "the gate bites" line stayed green.
    for (const first of ["p1", "p2"] as const) {
      for (const seat of ["p1", "p2"] as const) {
        for (const seed of SEEDS) {
          const state = untilTurnOf(board(seed, first, seat, MILTANK), seat);
          expect(declare(state, seat, 1), `${seed} ${first} ${seat}`).toBe("ATTACK_PREVENTED");
          expect(declare(state, seat, 0), `${seed} ${first} ${seat}`).toBe("OK");
        }
      }
    }
  });

  it("🛑 and the WIRE greys exactly one of the two rows — the per-index projection", () => {
    // The quiet direction: a greyed row is never clicked, so nobody reports it. A
    // body-wide `banned` term is green on the engine half above and wrong here.
    for (const first of ["p1", "p2"] as const) {
      for (const seat of ["p1", "p2"] as const) {
        const state = untilTurnOf(board(SEEDS[0], first, seat, MILTANK), seat);
        expect(wirePlayable(state, seat, 0), `${first} ${seat}`).toBe(true);
        expect(wirePlayable(state, seat, 1), `${first} ${seat}`).toBe(false);
      }
    }
  });

  it("the refusal NAMES the printed clause in the printed polarity", () => {
    const state = untilTurnOf(board(SEEDS[0], "p1", "p1", MILTANK), "p1");
    const result = applyAction(state, { type: "attack", seat: "p1", index: 1 });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected the gate to refuse");
    expect(result.error.message).toContain("Moomoo Rolling");
    expect(result.error.message).toContain(
      "it can only be used if your Active Pokémon used Rollout during your last turn",
    );
    // …and the note comes from the ONE reader that knows the polarity, not from a
    // second switch at the call site (D131).
    const gate = attackTimingBlocked(state, "p1", activeOf(state, "p1"), 1);
    expect(gate).toBeDefined();
    expect(gate === undefined ? "" : attackTimingNote(gate)).toBe(
      "it can only be used if your Active Pokémon used Rollout during your last turn",
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. The gate OPENS, and the window's BACK EDGE closes it again.
// ─────────────────────────────────────────────────────────────────────────────

describe("D395 §3 — the window, driven at both edges", () => {
  it("🛑 opens on the turn AFTER Rollout, from both seats and under both assignments", () => {
    for (const first of ["p1", "p2"] as const) {
      for (const seat of ["p1", "p2"] as const) {
        for (const seed of SEEDS) {
          const state = afterRollout(seed, first, seat, MILTANK);
          expect(declare(state, seat, 1), `${seed} ${first} ${seat}`).toBe("OK");
          expect(wirePlayable(state, seat, 1), `${seed} ${first} ${seat}`).toBe(true);
        }
      }
    }
  });

  it("🛑 CLOSES again one of the player's own turns later — the back edge", () => {
    // The board a "has ever used Rollout" build gets wrong, and every assertion
    // above is green on that build. The printed word is "LAST turn": one own turn
    // further on, the record is two of the player's turns old and the gate bites.
    for (const first of ["p1", "p2"] as const) {
      for (const seat of ["p1", "p2"] as const) {
        const opened = afterRollout(SEEDS[0], first, seat, MILTANK);
        const later = untilTurnOf(opened, seat, opened.turn + 1);
        expect(declare(later, seat, 1), `${first} ${seat}`).toBe("ATTACK_PREVENTED");
        // …and the way back is the printed one: use Rollout again.
        const reopened = untilTurnOf(
          must(applyAction(later, { type: "attack", seat, index: 0 })),
          seat,
          later.turn + 1,
        );
        expect(declare(reopened, seat, 1), `${first} ${seat}`).toBe("OK");
      }
    }
  });

  it("the opened attack really deals its printed 100 — a gate is not a program", () => {
    const state = afterRollout(SEEDS[0], "p1", "p1", MILTANK);
    const before = activeOf(state, "p2").damage;
    const next = must(applyAction(state, { type: "attack", seat: "p1", index: 1 }));
    // `fix-titan` is 340 HP and takes 20 from the Rollout that opened the window,
    // so the total after this hit is 120 and nothing has been Knocked Out.
    expect(before).toBe(20);
    expect(activeOf(next, "p2").damage).toBe(120);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. §9 does not reach this field, and both projections agree per index.
// ─────────────────────────────────────────────────────────────────────────────

describe("D395 §4 — the §9 rule, and the payability mirrors", () => {
  it("🛑 a live Klefki Ability-lock changes NOTHING on either side of the gate", () => {
    // The INVERSE of `PassiveEffects.attackFirstTurnExempt`'s rule and the easiest
    // thing at this seam to get wrong by copying the field one line over: §9 locks
    // ABILITIES, and every clause in `attackGate` is printed as ATTACK text. Driven
    // under a live lock rather than argued.
    for (const seat of ["p1", "p2"] as const) {
      const other = seat === "p1" ? "p2" : "p1";
      const barred = untilTurnOf(board(SEEDS[0], "p1", seat, MILTANK), seat);
      const opened = afterRollout(SEEDS[0], "p1", seat, MILTANK);
      for (const [label, state] of [
        ["barred", barred],
        ["opened", opened],
      ] as const) {
        const locked = benchFromDeck(state, other, "sv01-096");
        // The lock is really live on this board — without this line the two
        // answers agree because nothing is suppressed anywhere.
        expect(locked.players[other].bench.length, label).toBeGreaterThan(
          state.players[other].bench.length,
        );
        expect(declare(locked, seat, 1), `${seat} ${label}`).toBe(declare(state, seat, 1));
        expect(declare(locked, seat, 0), `${seat} ${label}`).toBe(declare(state, seat, 0));
      }
    }
  });

  it("the ENGINE gate and the WIRE projection agree on every row, seat and seed", () => {
    // D223's `needs` string named a field and not its two mirrors, and the failure
    // direction is the quiet one. Swept for AGREEMENT rather than asserted on
    // either side alone.
    let compared = 0;
    let legalRows = 0;
    for (const first of ["p1", "p2"] as const) {
      for (const seat of ["p1", "p2"] as const) {
        for (const seed of SEEDS) {
          for (const state of [
            untilTurnOf(board(seed, first, seat, MILTANK), seat),
            afterRollout(seed, first, seat, MILTANK),
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
// 5. 🛑 THE SPLIT — accounting, and the ungated twin that proves it is a gate.
// ─────────────────────────────────────────────────────────────────────────────

describe("D395 §5 — the clause-only split and the report it silences", () => {
  it("🛑 `splitAttackGateClause` answers `{clause, body: \"\"}` — a MATCH, not a miss", () => {
    // D282's empty-remainder branch returned `null` and its comment named its own
    // expiry date: *"No legal printing is clause-only today (all 13 carry a body),
    // so this is a guard against a future one."* This is that printing.
    expect(splitAttackGateClause(ROLLOUT_GATE)).toEqual({ clause: ROLLOUT_GATE, body: "" });
    // …and the anchor did NOT loosen with it: the clause anywhere but the front is
    // still not a split, which is the property the whole split rests on.
    expect(splitAttackGateClause(`Draw a card. ${ROLLOUT_GATE}`)).toBeNull();
    expect(splitAttackGateClause("")).toBeNull();
  });

  it("🛑 the gated declaration reports NO unsimulated effect — and the TWIN does", () => {
    // 🛑 THE PAIR IS THE ASSERTION. On its own the first half is green on a build
    // that never reports anything; on its own the second is green on a build that
    // always does. Together they say the report is driven by whether the clause is
    // REPRESENTED — which is the two-key check `D282-split-fires-without-a-gate`
    // exists to keep, and the one a derived gate would have dissolved.
    const gated = afterRollout(SEEDS[0], "p1", "p1", MILTANK);
    const skipped = declareEvents(gated, "p1", 1).filter(
      (e) => e.type === "ATTACK_EFFECT_SKIPPED",
    );
    expect(skipped).toEqual([]);

    // 🆕🆕 **D444 — THE SECOND HALF USED TO BE `UNGATED_TWIN`, AND IT HAS MOVED TO
    // `NEAR_MISS_TWIN`.** The twin now derives the same gate the registry authors,
    // so its clause IS accounted for and it correctly emits no report — which is a
    // strictly better board and a strictly worse CONTROL, because "the report is
    // driven by whether the clause is represented" needs a body whose clause is
    // NOT. That is the near-miss: one token off the table, no gate, whole string to
    // the readers, every one refuses it, report fires naming the sentence — the
    // pre-D282 behaviour, byte for byte, on the only body that can still show it.
    const nearMiss = untilTurnOf(board(SEEDS[0], "p1", "p1", NEAR_MISS_TWIN), "p1");
    const nearMissSkipped = declareEvents(nearMiss, "p1", 1).filter(
      (e) => e.type === "ATTACK_EFFECT_SKIPPED",
    );
    expect(nearMissSkipped).toHaveLength(1);
    expect(nearMissSkipped[0]).toMatchObject({ effect: NEAR_MISS_GATE, damageModifier: null });

    // …and the twin, on the same board, emits NONE — the payoff stated beside the
    // control rather than in place of it.
    const twin = untilTurnOf(afterRollout(SEEDS[0], "p1", "p1", UNGATED_TWIN), "p1");
    expect(
      declareEvents(twin, "p1", 1).filter((e) => e.type === "ATTACK_EFFECT_SKIPPED"),
    ).toEqual([]);
  });

  // 🆕🆕 **D444 — THIS RUNG HAS FLIPPED, AND THE FLIP IS THE WHOLE SLICE.** It read
  // *"the twin is UNGATED on the board where the real printing is barred — the text
  // alone gates nothing, and it must not."* That WAS the behaviour and it was a
  // printed rule silently deleted: an unregistered body could declare an attack its
  // own text forbids, on exactly the turn it forbids it, with no report anywhere.
  // Every other unread sentence in this engine fails LOUD. ⚠️ **THE PAIR IS STILL
  // THE ASSERTION** — the near-miss body keeps the "text alone gates nothing" half
  // alive, on the only text that can still show it.
  it("🆕🆕 D444 — the UNREGISTERED twin is BARRED, and the near-miss is not", () => {
    for (const seat of ["p1", "p2"] as const) {
      const barred = untilTurnOf(board(SEEDS[0], "p1", seat, UNGATED_TWIN), seat);
      expect(declare(barred, seat, 1), seat).toBe("ATTACK_PREVENTED");
      expect(wirePlayable(barred, seat, 1), seat).toBe(false);
      // …and it OPENS on the board its own clause opens on, so the bar is a gate
      // and not a refusal of everything (D424: a refusal rung owes an admission).
      const opened = afterRollout(SEEDS[0], "p1", seat, UNGATED_TWIN);
      expect(declare(opened, seat, 1), seat).toBe("OK");
      expect(wirePlayable(opened, seat, 1), seat).toBe(true);

      // THE CONTROL: one token off the table and the declaration seam sees nothing
      // at all — no gate, no bar, on the same board that bars the twin.
      const nearMiss = untilTurnOf(board(SEEDS[0], "p1", seat, NEAR_MISS_TWIN), seat);
      expect(declare(nearMiss, seat, 1), seat).toBe("OK");
      expect(wirePlayable(nearMiss, seat, 1), seat).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. `MATCH_RECORD_VERSION` — the question asked, and the answer driven.
// ─────────────────────────────────────────────────────────────────────────────

describe("D395 §6 — MATCH_RECORD_VERSION stays 25, and the reason is measured", () => {
  it("the slice persists NOTHING — the row is a catalog fact re-read every time", () => {
    // ⚠️ THE CONSTANT ITSELF LIVES IN `apps/api/src/lobby/match.ts` and its tie is
    // held there (`match.test.ts`), so this file cannot import it and does not
    // pretend to. What it CAN do is drive the three reasons the number does not
    // move, which is the half a constant-equality assertion could never give.
    // The three halves of "nothing persists", each read rather than argued:
    // ① the value carries no `EffectOp`, so it cannot ride a parked continuation
    //    into a record (D281's own sweep, re-run on the new row);
    const gate = programFor(MILTANK)?.attackGate?.[1];
    expect(JSON.stringify(gate ?? {}).includes('"op":')).toBe(false);
    // ② the condition it carries is D394's member, whose per-body stamp is ALREADY
    //    persisted at v25 — this slice adds no field to it;
    expect(gate).toEqual({
      kind: "onlyIf",
      condition: { kind: "yourActiveUsedAttackLastTurn", attack: "Rollout" },
    });
    // ③ and the split is a pure function of printed text, so a resumed record
    //    re-derives the same answer from the same catalog bytes.
    expect(splitAttackGateClause(ROLLOUT_GATE)).toEqual(splitAttackGateClause(ROLLOUT_GATE));
  });

  it("no `fix-*` demonstrator reached the shared pool — the census control", () => {
    // D275's idiom, asserted by id in both directions: this suite's two bodies are
    // LOCAL, so `FIXTURE_POOL` is untouched and `registryCardIds()` moves by exactly
    // the ONE real catalog id the registry row is keyed on.
    expect(FIXTURE_POOL[MILTANK]).toBeUndefined();
    expect(FIXTURE_POOL[UNGATED_TWIN]).toBeUndefined();
    expect(programFor(UNGATED_TWIN)).toBeUndefined();
  });
});
