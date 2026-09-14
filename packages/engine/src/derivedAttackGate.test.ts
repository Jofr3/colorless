import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { attackReaderSurface, legalAttackCorpus } from "./censusAttackCorpus";
import * as effects from "./effects";
import { splitAttackGateClause, timingGateFromAttackText } from "./effects";
import type { AttackTimingGate, GameState, InPlayPokemon, Seat } from "./index";
import { applyAction, attackGateOf, createGame, engineVersion, programFor } from "./index";
import { attackTimingBlocked, firstTurnAttackBanned, redactGame } from "./index";
// ⚠️ NOT re-exported from the package index (D272) — the whole-pool sweep in §2 is
// the only kind of caller it has, and `attackIndexGate.test.ts` takes the same edge.
import { registryCardIds } from "./registry";
import {
  FIXTURE_POOL,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  deepFreeze,
  setActiveFromDeck,
  typedEnergy,
} from "./testFixtures";

// 0.345.0 → 0.346.0 — 🆕🆕 D444: THE FIRST DERIVED `attackGate`.
//
// ONE new export (`timingGateFromAttackText`, effects.ts), ONE new type
// (`AttackGateClause`), ONE new module-level map (`ATTACK_GATE_CLAUSE_GATES` — the
// SECOND COLUMN of the `ATTACK_GATE_CLAUSES` table that already shipped) and ONE
// changed line in `attackGateOf` (continuous.ts), which becomes
// `registry ?? derived` — D8's precedence, spelled the way `attack.ts` spells
// `authored ?? derived` for `CardProgram.attack`. ZERO new `BoardCondition`
// members, ZERO new ops, events, error codes, prompt kinds, readers, regexes,
// `packages/schema` bytes or `redact.ts` bytes, and **`MATCH_RECORD_VERSION` STAYS
// 29** (§6, driven over serialized bytes in both directions).
//
// ── 🛑 WHAT THIS SLICE IS *NOT*, STATED FIRST BECAUSE THE WORK ORDER SAID IT WAS ─
//
// It does **not** build three unbuilt sentences. **MEASURED at this head**:
// `splitAttackGateClause` claims **6 corpus sentences / 14 printings**, every one of
// them already carries a registry `attackGate`, and 13 of the 14 are already inside
// `BUILT.attack`'s SPLIT summand (`censusAtHead.test.ts`, "the SPLIT half"). The
// three sentences a residue ranking surfaces here —
//
//   7p  "If you go second, you can't use this attack during your first turn. This
//        attack does 30 damage for each of your Benched Pokémon."          (Terapagos ex)
//   2p  "If you go first, you can use this attack during your first turn. Search
//        your deck for a card that evolves from this Pokémon…"             (Exeggcute)
//   1p  "If you go first, you can use this attack during your first turn. Search
//        your deck for up to 2 Basic Pokémon…"                             (Volbeat)
//
// — read as unbuilt ONLY under `!resolvedByAnyReader`, which conventions.md (D422)
// records as the wrong subtraction: it misses a registry row, the gate splitter and
// the trailing splitter. All three are gated, split and resolved today. **THIS
// SLICE CLAIMS 0 NEW PRINTINGS AND SAYS SO IN ITS DECISION ROW.**
//
// ── 🛑 WHAT IT DOES BUILD: A SILENT NON-ENFORCEMENT, AND IT IS THE ONLY SILENT
//    FAILURE IN THIS ENGINE'S COVERAGE STRATEGY ────────────────────────────────
//
// Everywhere else, a printed sentence this engine cannot read fails LOUD —
// `ATTACK_EFFECT_SKIPPED`, naming the string. A printed TIMING CLAUSE on a body
// with no registry row failed the other way. **MEASURED at D443's head**, on a
// fixture printing Terapagos ex's sentence byte for byte:
//
//     attackGateOf(state, active, 0)        → undefined
//     attackTimingBlocked(state, seat, …, 0) → undefined
//     applyAction({type:"attack", …})        → { ok: true }
//
// on TURN 2 as the going-SECOND player — exactly the turn the printed sentence
// forbids. The DAMAGE half of that same sentence was loudly withheld the whole
// time (the fold never ran, the report fired). **Two halves of one sentence failing
// in opposite directions, and only the loud half was ever driven.** §3 is that
// board, now barred.
//
// ── 🛑 THIS REVERSES D395's REFUSAL, AND THE REVERSAL IS ARGUED ───────────────
//
// `rolloutGate.test.ts`'s header settled *"Is `CardProgram.attackGate` DERIVABLE
// from the printed clause?"* as **REGISTRY ROW**, on two grounds. Both were
// re-measured here rather than dismissed, and the annotation is written into that
// file beside the original (conventions.md: annotate provenance, never overwrite
// it; never reverse a decision silently).
//
//   ① *"a deriver buys ZERO additional legal printings"* — **STILL TRUE**, and §2
//      re-derives it live. ⚠️ But it is scoped to `legal_standard = 1` and **the
//      engine is not**: `src/features/builder/cards.ts` ships an `expanded` format
//      keyed on `legal_expanded`, and `effects.ts`'s own clause-table block records
//      that the pool-wide query returns **15** where the legal one returns 13 — the
//      2 extras being Bombirdier ex `sv04-156`/`-234`, printing the BAN clause with
//      **no registry row**. D413's two-populations-two-answers, biting a REFUSAL.
//   ② *"a deriver makes `attack.ts`'s two-key check a tautology"* — **CORRECT, and
//      PAID.** It is a tautology: `ATTACK_GATE_CLAUSE_GATES` is TOTAL over the
//      clause list, so a split that fires implies a gate that exists.
//      `D282-split-fires-without-a-gate` is re-declared `survives: equivalent` on
//      exactly that argument, which makes the day anyone narrows the derivation a
//      `STALE-SURVIVOR` failure rather than a quiet pass (D427).
//
// ── WHAT THIS SUITE EXISTS TO PIN ────────────────────────────────────────────
//
// 1. 🛑 **THE TWO `If you go …` CLAUSES POINT IN OPPOSITE DIRECTIONS AND ONE OF
//    THEM IS A PERMISSION** (§1, §3). *"you can't"* ADDS a restriction (`barredIf`,
//    read by `attackTimingBlocked`); *"you can"* REMOVES the standing §4 ban
//    (`firstTurnExempt`, read by `firstTurnAttackBanned` and by nothing else —
//    `ptcg-rules.md` §4: *"**P1 may NOT attack** on their first turn"*). A build
//    that mapped both to one kind is green on every board anyone writes naturally,
//    because the natural board for each is the turn its own card is about. §3
//    drives both directions on real boards, and §1 drives the four rows against
//    each other by value.
// 2. 🛑 **THE DERIVATION IS A CLOSED TABLE, NOT A TEMPLATE** (§1). D394/D395 refuse
//    `^You can use this attack only if (.+)\.$` because a mis-parsed condition bars
//    a legal attack FOREVER and silently. That refusal is untouched: a near-miss
//    with one token changed derives NOTHING.
// 3. 🛑 **THE INDEX IS STILL THE ADDRESS, WITH NO ROW TO KEY OFF** (§4). This is the
//    failure the design invites: a derived gate has no registry entry, so what is
//    it keyed by? The printed text AT that index — so a two-attack body whose idx 0
//    prints the licence and whose idx 1 prints nothing cannot leak, by construction.
//    Volbeat `sv06-009` is exactly that card and §4 drives an unregistered twin of
//    it, where the registry cannot be masking the answer.
// 4. 🛑 **THE NAME IS OUTSIDE THE `deriveAttack` NAMESPACE, AND THAT IS CHECKED**
//    (§5). `censusAttackCorpus.ts` derives the whole-sentence reader surface off
//    effects.ts by NAME PREFIX. The first draft of this function was called
//    `deriveAttackTimingGate`, enrolled itself as a 13th reader, and — because
//    `resolvedByAnyReader` tests `read(text) !== null` and this function answers
//    `undefined` — made the predicate claim EVERY sentence in the corpus. 22 rungs
//    across 5 files went red in one run. §5 pins the surface at 13 BY NAME.
// 5. **`MATCH_RECORD_VERSION` STAYS 29, DRIVEN OVER BYTES IN BOTH DIRECTIONS** (§6).

// ── the printed clauses, byte for byte off `legalAttackCorpus()` ─────────────

const BAN_TEXT =
  "If you go second, you can't use this attack during your first turn. This attack does 30 damage for each of your Benched Pokémon.";
const LICENCE_TEXT =
  "If you go first, you can use this attack during your first turn. Search your deck for up to 2 Basic Pokémon and put them onto your Bench. Then, shuffle your deck.";
const GATE_TEXT =
  "You can use this attack only if you go second, and only during your first turn. Shuffle 1 of your opponent's Benched Pokémon and all attached cards into their deck.";
const ROLLOUT_TEXT =
  "You can use this attack only if this Pokémon used Rollout during your last turn.";

/** 🛑 THE NEAR-MISS, one token off the BAN clause ("next" for "first"). It differs
    on EXACTLY ONE AXIS (D427), so a green refusal here can only be about that
    token — a near-miss that were also re-worded or re-cased would prove nothing
    about either feature. */
const NEAR_MISS_TEXT =
  "If you go second, you can't use this attack during your next turn. This attack does 30 damage for each of your Benched Pokémon.";

// ── the local pool: FIVE UNREGISTERED bodies (FIXTURE_POOL untouched, D190) ──
//
// 🛑 **EVERY BODY HERE IS UNREGISTERED, AND THAT IS THE WHOLE POINT.** The
// registry wins under `??`, so a board built on a REAL id answers about the row and
// says nothing at all about the derivation. These ids have no `CardProgram`, which
// is asserted in §1 before any of them is driven.

const BAN_BODY = "fix-d444-ban";
const LICENCE_BODY = "fix-d444-licence";
const GATE_BODY = "fix-d444-gate";
const ROLLOUT_BODY = "fix-d444-rollout";
const NEAR_MISS_BODY = "fix-d444-near-miss";
/** The attribution control (D214): the same two costs, no printed clause anywhere.
    Every "the gate bites" line below is green on a build that refuses ALL attacks,
    and this body is the only thing that can tell those apart. */
const PLAIN_BODY = "fix-d444-plain";
const FILLER = "fix-d444-filler";
const ENERGY = "fix-d444-energy";

const LOCAL_CARDS: Record<string, Card> = {
  [BAN_BODY]: battler(BAN_BODY, {
    name: "D444 Ban",
    hp: 230,
    retreat: 2,
    types: ["Colorless"],
    attacks: [
      { cost: ["Colorless", "Colorless"], name: "Unified Beatdown", damage: "30×", effect: BAN_TEXT },
      { cost: ["Colorless", "Colorless"], name: "Crown Opal", damage: 180 },
    ],
  }),
  // 🛑 **THE INDEX BOARD.** Volbeat `sv06-009`'s shape: the licence on idx 0 and a
  // SECOND attack on idx 1 that prints no effect text at all. A per-BODY read
  // licenses "Coordinated Strike" on turn 1 along with the "Quick Sign" the card
  // actually names — D281's named failure, now asked of the DERIVATION.
  [LICENCE_BODY]: battler(LICENCE_BODY, {
    name: "D444 Licence",
    hp: 70,
    retreat: 1,
    types: ["Grass"],
    attacks: [
      { cost: ["Colorless"], name: "Quick Sign", effect: LICENCE_TEXT },
      { cost: ["Colorless", "Colorless"], name: "Coordinated Strike", damage: 20 },
    ],
  }),
  [GATE_BODY]: battler(GATE_BODY, {
    name: "D444 Gate",
    hp: 70,
    retreat: 1,
    types: ["Grass"],
    attacks: [
      { cost: ["Colorless"], name: "Slowing Perfume", effect: GATE_TEXT },
      { cost: ["Colorless", "Colorless"], name: "Glide", damage: 30 },
    ],
  }),
  // Miltank `sv08.5-081`'s shape: the gate at idx **1** and the attack its clause
  // NAMES at idx 0 — the only printed layout on which an index-blind read gates the
  // one attack that can ever satisfy the gate.
  [ROLLOUT_BODY]: battler(ROLLOUT_BODY, {
    name: "D444 Rollout",
    hp: 130,
    retreat: 2,
    types: ["Colorless"],
    attacks: [
      { cost: ["Colorless"], name: "Rollout", damage: 20 },
      { cost: ["Colorless", "Colorless"], name: "Moomoo Rolling", damage: 100, effect: ROLLOUT_TEXT },
    ],
  }),
  [NEAR_MISS_BODY]: battler(NEAR_MISS_BODY, {
    name: "D444 Near Miss",
    hp: 230,
    retreat: 2,
    types: ["Colorless"],
    attacks: [
      {
        cost: ["Colorless", "Colorless"],
        name: "Unified Beatdown",
        damage: "30×",
        effect: NEAR_MISS_TEXT,
      },
      { cost: ["Colorless", "Colorless"], name: "Crown Opal", damage: 180 },
    ],
  }),
  [PLAIN_BODY]: battler(PLAIN_BODY, {
    name: "D444 Plain",
    hp: 230,
    retreat: 2,
    types: ["Colorless"],
    attacks: [
      { cost: ["Colorless"], name: "Plain Sign", damage: 20 },
      { cost: ["Colorless", "Colorless"], name: "Plain Strike", damage: 180 },
    ],
  }),
  [FILLER]: battler(FILLER, {
    name: "D444 Filler",
    hp: 60,
    retreat: 1,
    types: ["Colorless"],
    attacks: [{ cost: ["Colorless"], name: "Tap", damage: 10 }],
  }),
  [ENERGY]: typedEnergy(ENERGY, "Colorless"),
};

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

/** This suite's own deck (D270). `fix-basic-1` is the Basic the licence body's own
    printed bench-search may fetch, so the search resolves rather than whiffing. */
const GATE_DECK = deckOf({
  [BAN_BODY]: 4,
  [LICENCE_BODY]: 4,
  [GATE_BODY]: 4,
  [ROLLOUT_BODY]: 4,
  [NEAR_MISS_BODY]: 4,
  [PLAIN_BODY]: 4,
  [FILLER]: 8,
  "fix-basic-1": 8,
  [ENERGY]: 20,
});

/** Four seeds, so nothing below rests on one shuffle (D270). */
const SEEDS = [6011, 6029, 6037, 6043] as const;

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

/** D275/D277's shape: the FIRST PLAYER is a PARAMETER, because `youGoSecond` and
    `yourFirstTurn` are per-seat facts and a one-assignment board is vacuous on one. */
function localSetup(seed: number, first: Seat): GameState {
  const created = createGame({ seed, decks: { p1: GATE_DECK, p2: GATE_DECK }, cardPool: POOL });
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

/** `seat`'s Active is `activeId` with TWO {C} attached — so every printed cost in
    this pool is payable and a refusal can only ever be a GATE — and a body behind
    it (§14.2 makes an empty Bench a LOSS the moment the Active leaves, and a
    `gameOver` board proves nothing about a gate). `passes` winds the turn counter
    BEFORE the surgery, so no draw or prize step can move what the assertions read. */
function board(
  seed: number,
  first: Seat,
  seat: Seat,
  activeId: string,
  passes = 0,
): GameState {
  let state = localSetup(seed, first);
  for (let i = 0; i < passes; i += 1) {
    if (state.phase.kind !== "turn:action") throw new Error(`stuck in ${state.phase.kind}`);
    state = must(applyAction(state, { type: "endTurn", seat: state.phase.seat }));
  }
  if (state.phase.kind !== "turn:action" || state.phase.seat !== seat) {
    throw new Error(`expected ${seat} on turn, got ${JSON.stringify(state.phase.kind)}`);
  }
  state = setActiveFromDeck(state, seat, activeId);
  state = clearBench(state, seat);
  state = benchFromDeck(state, seat, FILLER);
  return attachFromDeck(state, seat, ENERGY, 2);
}

function activeOf(state: GameState, seat: Seat): InPlayPokemon {
  const active = state.players[seat].active;
  if (active === null) throw new Error(`${seat} has no Active`);
  return active;
}

/** Declare and report the error CODE, or "OK". Every gate assertion goes through
    this rather than through a boolean, so a green "the gate refuses" line can never
    be a refusal for the wrong reason — an unpaid cost, a bad index, or §4's ban
    where the test meant `ATTACK_PREVENTED`. */
function declare(state: GameState, seat: Seat, index: number): string {
  const result = applyAction(deepFreeze(state), { type: "attack", seat, index });
  return result.ok ? "OK" : result.error.code;
}

/** The wire projection's answer for the same row — the payability mirror (D223:
    a field's two mirrors are where a gate change fails quietly). */
function wirePlayable(state: GameState, seat: Seat, index: number): boolean | undefined {
  const phase = redactGame(state, seat).phase;
  if (phase.kind !== "turn:action") throw new Error(`expected turn:action, got ${phase.kind}`);
  return phase.attacks.find((a) => a.index === index)?.playable;
}

const SECOND_PLAYERS_FIRST_TURN = {
  kind: "allOf",
  conditions: [{ kind: "youGoSecond" }, { kind: "yourFirstTurn" }],
};

// ─────────────────────────────────────────────────────────────────────────────
// 1. THE TABLE — the four rows, against each other, and the near-miss.
// ─────────────────────────────────────────────────────────────────────────────

describe("D444 §1 — the clause→gate table, driven row against row", () => {
  it("🛑 the two `If you go …` rows are OPPOSITE, and one of them carries NO condition", () => {
    const ban = timingGateFromAttackText(BAN_TEXT);
    const licence = timingGateFromAttackText(LICENCE_TEXT);
    // 🛑 THE PAIR IS THE ASSERTION. Each half alone is green under a build that
    // mapped BOTH clauses to whichever kind that half names; only the pair can see
    // a swap, and a swap is the mistake an author actually makes here (the two
    // sentences differ by one printed word).
    expect(ban).toEqual({ kind: "barredIf", condition: SECOND_PLAYERS_FIRST_TURN });
    expect(licence).toEqual({ kind: "firstTurnExempt" });
    // …and the LICENCE carries no `condition` KEY AT ALL, not merely a different
    // one: D223/D277/D280 each established independently that *"If you go first"* is
    // DESCRIPTIVE — turn 1 IS the going-first player's turn — so a condition here
    // would be a SECOND reading of §4 (D131).
    expect(licence).not.toHaveProperty("condition");
    expect(ban).toHaveProperty("condition");
  });

  it("🛑 the GATE row is the BAN row's condition at the OTHER polarity — by identity", () => {
    const gate = timingGateFromAttackText(GATE_TEXT);
    expect(gate).toEqual({ kind: "onlyIf", condition: SECOND_PLAYERS_FIRST_TURN });
    // The two polarities are ONE condition and a TOKEN — D281's whole argument for a
    // single field. Asserted by equality of the conditions rather than by reading
    // both literals, so a build that drifted one of them reddens.
    const ban = timingGateFromAttackText(BAN_TEXT) as { condition: unknown };
    expect((gate as { condition: unknown }).condition).toEqual(ban.condition);
    expect((gate as AttackTimingGate).kind).not.toBe((timingGateFromAttackText(BAN_TEXT) as AttackTimingGate).kind);
  });

  it("🛑 the ROLLOUT row derives too, and the attack name is a CONSTANT in a closed row", () => {
    expect(timingGateFromAttackText(ROLLOUT_TEXT)).toEqual({
      kind: "onlyIf",
      condition: { kind: "yourActiveUsedAttackLastTurn", attack: "Rollout" },
    });
    // 🛑 THE REFUSAL D394/D395 WROTE IS UNTOUCHED, and this is what proves it: the
    // same printed SHAPE with the quoted name changed derives NOTHING. A template
    // would answer a gate here — over an attack this body never uses — and bar the
    // card forever, which is the failure direction those refusals name.
    const templated = ROLLOUT_TEXT.replace("Rollout", "Nuzzle");
    expect(templated).not.toBe(ROLLOUT_TEXT);
    expect(timingGateFromAttackText(templated)).toBeUndefined();
  });

  it("the reader is TOTAL and refuses everything that is not a table row", () => {
    expect(timingGateFromAttackText(undefined)).toBeUndefined();
    expect(timingGateFromAttackText("")).toBeUndefined();
    expect(timingGateFromAttackText(NEAR_MISS_TEXT)).toBeUndefined();
    // The clause anywhere but the FRONT is not a split and therefore not a gate —
    // `splitAttackGateClause`'s `^` anchor, inherited whole rather than re-derived.
    expect(timingGateFromAttackText(`Draw a card. ${BAN_TEXT}`)).toBeUndefined();
    // …and a body with no clause at all, which is the overwhelmingly common case.
    expect(timingGateFromAttackText("Draw 2 cards.")).toBeUndefined();
  });

  it("🛑 the map is the SPLITTER's second column — every clause it splits derives a gate", () => {
    // 🛑 THE TOTALITY CLAIM, DERIVED RATHER THAN LISTED. `Record<AttackGateClause, …>`
    // makes it a compile error to add a clause without a gate, but a type says
    // nothing at runtime and nothing about the SPLITTER agreeing with the map. This
    // walks the whole committed corpus and ties the two: split ⟺ gate, no exceptions.
    for (const [, text] of legalAttackCorpus()) {
      const split = splitAttackGateClause(text);
      const gate = timingGateFromAttackText(text);
      expect(split === null, text).toBe(gate === undefined);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. THE POPULATION — 14, all of it registry-authored, and 0 claimed here.
// ─────────────────────────────────────────────────────────────────────────────

describe("D444 §2 — the population, and the honest zero", () => {
  it("🛑 the gate family is 6 sentences / 14 printings, and this slice claims NONE of them", () => {
    const gated = legalAttackCorpus().filter(([, text]) => splitAttackGateClause(text) !== null);
    expect(gated.length).toBe(6);
    expect(gated.reduce((sum, [units]) => sum + units, 0)).toBe(14);
    // …and every one of the six derives, which is what makes the count above the
    // count of what a derivation could ever serve here.
    for (const [, text] of gated) expect(timingGateFromAttackText(text), text).toBeDefined();
  });

  it("🛑 17 registry ids carry `attackGate`, and every DISTINCT value is either derivable or the ONE trailing gate", () => {
    // 🛑 **THE AGREEMENT RUNG, AND IT IS THE GAP THIS SLICE ACTUALLY CLOSES.** Until
    // D444 the clause LIST and the gate VALUES were two independent hand
    // transcriptions of the same four printed sentences with nothing tying them, and
    // D281's own doc block names the polarity confusion as the easiest thing here to
    // get wrong. This is the tie, computed off the LIVE registry.
    const gatedIds = registryCardIds().filter((id) => programFor(id)?.attackGate !== undefined);
    expect(gatedIds.length).toBe(17);

    const derivable = [BAN_TEXT, LICENCE_TEXT, GATE_TEXT, ROLLOUT_TEXT].map((t) =>
      JSON.stringify(timingGateFromAttackText(t)),
    );
    // The ONE registry gate that is NOT a leading-clause row: Sylveon ex
    // `sv08-086`/`sv08.5-041`/`sv08.5-156`, whose *"…this attack can't be used."*
    // is printed at the END of the sentence and belongs to D409's TRAILING splitter.
    // ⚠️ NAMED rather than filtered out silently — it is the reason the two counts
    // (17 registry ids, 14 splitter printings) differ, and a slice that folded it in
    // would be claiming the trailing family too.
    const trailing = JSON.stringify({
      kind: "barredIf",
      condition: { kind: "yourPokemonUsedAttackLastTurn", attack: "Angelite" },
    });

    const distinct = new Set<string>();
    for (const id of gatedIds) {
      for (const gate of Object.values(programFor(id)?.attackGate ?? {})) {
        distinct.add(JSON.stringify(gate));
      }
    }
    expect(distinct.size).toBe(5);
    expect([...distinct].sort()).toEqual([...derivable, trailing].sort());
  });

  it("the six bodies this suite drives are UNREGISTERED — the attribution control", () => {
    // Without this every board below is a read of a registry row wearing a fixture's
    // name, and the derivation could be deleted with the suite still green.
    for (const id of [
      BAN_BODY,
      LICENCE_BODY,
      GATE_BODY,
      ROLLOUT_BODY,
      NEAR_MISS_BODY,
      PLAIN_BODY,
    ]) {
      expect(programFor(id), id).toBeUndefined();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. 🛑 THE BOARDS — the defect, and the permission, in that order.
// ─────────────────────────────────────────────────────────────────────────────

describe("D444 §3 — the derived gate on a board, both directions", () => {
  it("🛑 THE DEFECT: the BAN body is now BARRED on the turn its own text forbids", () => {
    // `passes = 1` with `first = "p1"` lands on TURN 2 with p2 to act — p2's OWN
    // FIRST TURN as the going-SECOND player, the one board the clause names.
    // 🛑 **BEFORE D444 THIS DECLARATION SUCCEEDED.** Measured: `attackGateOf` →
    // undefined, `attackTimingBlocked` → undefined, `applyAction` → ok.
    for (const seed of SEEDS) {
      const state = board(seed, "p1", "p2", BAN_BODY, 1);
      expect(state.turn).toBe(2);
      expect(attackGateOf(state, activeOf(state, "p2"), 0)).toEqual({
        kind: "barredIf",
        condition: SECOND_PLAYERS_FIRST_TURN,
      });
      expect(attackTimingBlocked(state, "p2", activeOf(state, "p2"), 0)).toBeDefined();
      expect(declare(state, "p2", 0), `${seed}`).toBe("ATTACK_PREVENTED");
      expect(wirePlayable(state, "p2", 0), `${seed}`).toBe(false);
    }
  });

  it("…and it OPENS everywhere else, on BOTH SEATS — the admission the refusal owes (D424)", () => {
    // Same body, same seeds. 🛑 **BOTH SEATS, AND THAT IS NOT SYMMETRY FOR ITS OWN
    // SAKE**: the condition is `allOf([youGoSecond, yourFirstTurn])`, and a build
    // that dropped EITHER term is green on a one-seat board. Turn 3 / p1 fails
    // `youGoSecond`; turn 4 / p2 fails `yourFirstTurn` while `youGoSecond` HOLDS —
    // so the second board is the only one that can see the turn term go missing.
    for (const seed of SEEDS) {
      const first = board(seed, "p1", "p1", BAN_BODY, 2);
      expect(first.turn).toBe(3);
      expect(attackTimingBlocked(first, "p1", activeOf(first, "p1"), 0)).toBeUndefined();
      expect(declare(first, "p1", 0), `${seed}`).toBe("OK");
      expect(wirePlayable(first, "p1", 0), `${seed}`).toBe(true);

      const second = board(seed, "p1", "p2", BAN_BODY, 3);
      expect(second.turn).toBe(4);
      expect(attackTimingBlocked(second, "p2", activeOf(second, "p2"), 0)).toBeUndefined();
      expect(declare(second, "p2", 0), `${seed}`).toBe("OK");
      expect(wirePlayable(second, "p2", 0), `${seed}`).toBe(true);
    }
  });

  it("🛑 the NEAR-MISS body is barred NOWHERE — the text alone gates nothing", () => {
    // The control for both rungs above. One token off the table and the declaration
    // seam sees no clause at all, on the very board that bars the BAN body.
    const state = board(SEEDS[0], "p1", "p2", NEAR_MISS_BODY, 1);
    expect(state.turn).toBe(2);
    expect(attackGateOf(state, activeOf(state, "p2"), 0)).toBeUndefined();
    expect(declare(state, "p2", 0)).toBe("OK");
    expect(wirePlayable(state, "p2", 0)).toBe(true);
  });

  it("🛑 THE PERMISSION: the LICENCE body attacks on TURN 1 going first — §4's ban LIFTED", () => {
    // 🛑 THE OTHER DIRECTION, AND THE ONE A SWAPPED MAP FAILS. `ptcg-rules.md` §4:
    // *"P1 may NOT attack on their first turn."* The BAN row and this row are one
    // printed word apart and modify OPPOSITE standing rules; a build that mapped
    // both to `barredIf` bars this attack here, and a build that mapped both to
    // `firstTurnExempt` un-bars the BAN body above.
    for (const seed of SEEDS) {
      const state = board(seed, "p1", "p1", LICENCE_BODY, 0);
      expect(state.turn).toBe(1);
      expect(attackGateOf(state, activeOf(state, "p1"), 0)).toEqual({ kind: "firstTurnExempt" });
      expect(firstTurnAttackBanned(state, activeOf(state, "p1"), 0), `${seed}`).toBe(false);
      // …and `attackTimingBlocked` says NOTHING about it: `firstTurnExempt` is
      // excluded from `BlockingAttackGate` by construction, so the licence can only
      // ever unblock and §4 is its one reader.
      expect(attackTimingBlocked(state, "p1", activeOf(state, "p1"), 0)).toBeUndefined();
      expect(declare(state, "p1", 0), `${seed}`).toBe("OK");
    }
  });

  it("🛑 the PLAIN body is still §4-banned on the same board — the attribution control", () => {
    // Without this, the rung above passes on a build that lifted §4's ban for
    // everybody (D214: a check whose subject is a shared rule needs a control).
    const state = board(SEEDS[0], "p1", "p1", PLAIN_BODY, 0);
    expect(state.turn).toBe(1);
    expect(firstTurnAttackBanned(state, activeOf(state, "p1"), 0)).toBe(true);
    expect(declare(state, "p1", 0)).toBe("FIRST_TURN_ATTACK");
  });

  it("🛑 the GATE body is `onlyIf`: LIVE on the second player's first turn, DEAD after", () => {
    // The third polarity, and the mirror image of the BAN rung — the same condition
    // admitting where the other bars. A build that collapsed the polarity token
    // (`D281-polarity-collapses-to-one-sign`) answers these two boards the wrong way
    // round and is green on neither.
    const live = board(SEEDS[0], "p1", "p2", GATE_BODY, 1);
    expect(live.turn).toBe(2);
    expect(attackGateOf(live, activeOf(live, "p2"), 0)).toEqual({
      kind: "onlyIf",
      condition: SECOND_PLAYERS_FIRST_TURN,
    });
    expect(declare(live, "p2", 0)).toBe("OK");

    const dead = board(SEEDS[0], "p1", "p1", GATE_BODY, 2);
    expect(dead.turn).toBe(3);
    expect(declare(dead, "p1", 0)).toBe("ATTACK_PREVENTED");
    expect(wirePlayable(dead, "p1", 0)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. 🛑 THE INDEX — the failure this design invites, driven.
// ─────────────────────────────────────────────────────────────────────────────

describe("D444 §4 — the address, with no registry row to key off", () => {
  it("🛑 idx 0 is LICENSED and idx 1 is STILL BANNED on the same body, same turn", () => {
    // 🛑 **THE LEAK BOARD, AND IT IS ASSERTED IN THE DENIED DIRECTION FIRST**
    // (D278/D279). A derived gate has no registry entry, so "what is it keyed by" has
    // to be answered from somewhere — and the answer is the printed text AT `index`.
    // Volbeat `sv06-009` is the printed shape: the licence on idx 0, and an idx 1
    // that prints no effect text and must stay §4-banned on turn 1. A per-BODY
    // derivation (or an `Object.values(…)[0]` read) licenses BOTH and is green on
    // every "the licence works" line anyone would naturally write.
    for (const seed of SEEDS) {
      const state = board(seed, "p1", "p1", LICENCE_BODY, 0);
      expect(state.turn).toBe(1);
      // DENIED first.
      expect(attackGateOf(state, activeOf(state, "p1"), 1)).toBeUndefined();
      expect(firstTurnAttackBanned(state, activeOf(state, "p1"), 1), `${seed}`).toBe(true);
      expect(declare(state, "p1", 1), `${seed}`).toBe("FIRST_TURN_ATTACK");
      // …then permitted.
      expect(firstTurnAttackBanned(state, activeOf(state, "p1"), 0), `${seed}`).toBe(false);
      expect(declare(state, "p1", 0), `${seed}`).toBe("OK");
    }
  });

  it("🛑 the ROLLOUT shape: the gate is at idx 1 and idx 0 — the attack it NAMES — is live", () => {
    // Miltank `sv08.5-081`'s layout on an UNREGISTERED body, which is the one place
    // the derivation can be caught reading the wrong index: an index-blind build
    // gates "Rollout", and "Rollout" is the only way to satisfy the gate, so the card
    // can never be used again. `rolloutGate.test.ts` drives the registered twin.
    const state = board(SEEDS[0], "p1", "p1", ROLLOUT_BODY, 2);
    const body = activeOf(state, "p1");
    expect(attackGateOf(state, body, 1)).toEqual({
      kind: "onlyIf",
      condition: { kind: "yourActiveUsedAttackLastTurn", attack: "Rollout" },
    });
    expect(attackGateOf(state, body, 0)).toBeUndefined();
    expect(declare(state, "p1", 0)).toBe("OK");
    expect(declare(state, "p1", 1)).toBe("ATTACK_PREVENTED");
  });

  it("🛑 …and the ROLLOUT window OPENS once idx 0 has been used — the name is the RIGHT one", () => {
    // 🛑 **THE ADMISSION, AND IT IS ALSO THE ONLY BOARD THAT CAN SEE THE QUOTED NAME
    // GO WRONG.** The rung above is green under a derivation that named ANY attack
    // this body never uses — including "Moomoo Rolling", the neighbour printed one
    // index up, which is the mistake an author actually makes. Here the window has
    // to open, and it opens only if the derived condition names "Rollout".
    const start = board(SEEDS[0], "p1", "p1", ROLLOUT_BODY, 2);
    let after = must(applyAction(start, { type: "attack", seat: "p1", index: 0 }));
    for (let i = 0; i < 6 && !(after.phase.kind === "turn:action" && after.phase.seat === "p1" && after.turn > start.turn); i += 1) {
      if (after.phase.kind !== "turn:action") throw new Error(`stuck in ${after.phase.kind}`);
      after = must(applyAction(after, { type: "endTurn", seat: after.phase.seat }));
    }
    expect(after.turn).toBeGreaterThan(start.turn);
    expect(declare(after, "p1", 1)).toBe("OK");
  });

  it("the read stays TOTAL — a missing index and a bogus one both answer undefined", () => {
    const state = board(SEEDS[0], "p1", "p1", BAN_BODY, 2);
    const body = activeOf(state, "p1");
    expect(attackGateOf(state, body, 99)).toBeUndefined();
    expect(attackGateOf(state, body, -1)).toBeUndefined();
    expect(attackGateOf(state, body, 1.5)).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. 🛑 THE NAMESPACE — the mistake this slice made, pinned.
// ─────────────────────────────────────────────────────────────────────────────

describe("D444 §5 — `timingGateFromAttackText` is NOT a whole-sentence reader", () => {
  it("🛑 the reader surface is 13 and this function is not in it", () => {
    // 🛑 **THE FIRST DRAFT WAS CALLED `deriveAttackTimingGate` AND THIS IS WHAT IT
    // COST.** `censusAttackCorpus.ts` derives the surface off effects.ts by the
    // `deriveAttack` NAME PREFIX plus `typeof === "function"`, so the name alone
    // enrolled it — and `resolvedByAnyReader` tests `read(text) !== null`, which
    // `undefined` satisfies, so the predicate claimed EVERY sentence in the corpus.
    // 22 rungs across 5 files went red in one run. **The prefix is a RESERVED
    // namespace meaning "whole-sentence reader, `T | null`", with no type behind the
    // decision — only the name.**
    // ⚠️ **13, MEASURED OFF THE MODULE — AND THIS SLICE FIRST WROTE 12, INHERITED
    // FROM A NEIGHBOURING TEST TITLE THAT STILL READS "the TWELVE readers".**
    // conventions.md: never inherit a suite figure from prose. The count is
    // derived here and pinned SEPARATELY from the membership below, because a diff
    // alone stays green when a reader is deleted from the module and the list
    // together (D417).
    const surface = attackReaderSurface();
    expect(surface).toHaveLength(13);
    expect(surface).not.toContain("timingGateFromAttackText");
    expect(surface).not.toContain("deriveAttackTimingGate");
    for (const name of surface) expect(name.startsWith("deriveAttack"), name).toBe(true);
  });

  it("🛑 …and no effects.ts export outside the surface starts with that prefix", () => {
    // The converse, and it is what makes the rung above more than a spelling check:
    // a future export named `deriveAttackX` is IN the surface whether its author
    // meant it or not, so the only safe statement is that the two sets coincide.
    const prefixed = Object.entries(effects)
      .filter(([name, value]) => name.startsWith("deriveAttack") && typeof value === "function")
      .map(([name]) => name)
      .sort();
    expect(prefixed).toEqual([...attackReaderSurface()].sort());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. `MATCH_RECORD_VERSION` — the question asked at the right address.
// ─────────────────────────────────────────────────────────────────────────────

describe("D444 §6 — `MATCH_RECORD_VERSION` stays 29, driven over bytes both ways", () => {
  it("🛑 no gate byte is in the record at all, and a round-tripped state gates identically", () => {
    // ⚠️ THE CONSTANT LIVES IN `apps/api/src/lobby/match.ts` and its tie is held
    // there (`match.test.ts`), so this file cannot import it and does not pretend to.
    // What it CAN do is drive the reason, which is the half a constant-equality
    // assertion could never give. The rule (match.ts ~:1042) is *does the old byte
    // string still mean what it meant*, so the question is whether an
    // `AttackTimingGate` or a `CardProgram` reaches a persisted address at all.
    //
    // A `MatchRecord` is `{version, seed, startedAt, names, state, log}`. Of this
    // slice's changes:
    //   · `ATTACK_GATE_CLAUSE_GATES` / `timingGateFromAttackText` — module data and a
    //     pure function over CATALOG text. Neither is state.
    //   · `attackGateOf` — a READ, `registry ?? derived`, computed on every call.
    //   · `AttackGateClause` / the narrowed `splitAttackGateClause` return — TYPES,
    //     erased at runtime.
    // ⚠️ **AND D443's FINDING IS CHECKED RATHER THAN WAVED PAST: a RENAME at a
    // persisted address is a bump even where D438's rule would call it free.** The
    // one rename in this slice is `deriveAttackTimingGate` → `timingGateFromAttackText`,
    // a module-local export name that was never written to disk in any deploy — it
    // did not exist at v29's deploy and does not appear in a record.
    const state = board(SEEDS[0], "p1", "p2", BAN_BODY, 1);

    // (a) THE BYTES DO NOT CARRY THE GATE. The whole serialized state is searched
    // for every token the gate vocabulary is spelled in. ⚠️ Searched on the
    // SERIALIZED string rather than by walking fields, because "no field holds it" is
    // a claim about the shape someone remembers and this is a claim about the bytes.
    const bytes = JSON.stringify(state);
    for (const token of [
      "attackGate",
      "barredIf",
      "onlyIf",
      "firstTurnExempt",
      "youGoSecond",
      "yourFirstTurn",
      "yourActiveUsedAttackLastTurn",
    ]) {
      expect(bytes.includes(token), token).toBe(false);
    }

    // (a·2) 🛑 **AND THE ONE BYTE THE DERIVATION READS *IS* IN THE RECORD, AND WAS
    // AT v29 — WHICH IS THE ANSWER TO THE RULE AS THE RULE IS ACTUALLY WORDED.**
    // `GameState` embeds `cardPool`, so the printed effect text this slice reads has
    // been a persisted byte since long before v29. **This deploy reads that byte the
    // same way a v29 deploy did — as printed catalog text — and the byte means
    // exactly what it meant.** What changed is what the ENGINE does with it, which is
    // the engine version's job (0.345.0 → 0.346.0) and not the record's. ⚠️ Asserted
    // rather than argued, because this suite's first draft asserted the opposite —
    // that BAN_TEXT was absent from the record — and was wrong about the bytes.
    expect(state.cardPool[BAN_BODY]?.attacks?.[0]?.effect).toBe(BAN_TEXT);
    expect(bytes.includes(BAN_TEXT)).toBe(true);

    // (b) THE OTHER DIRECTION (D441 — both directions or neither): a state
    // reconstructed FROM those bytes, with no gate in them, still gates identically.
    // That is what "the gate is a catalog fact" means operationally — the answer
    // comes from `cardPool` and `programFor`, so a v29 record replays unchanged.
    const reconstructed: GameState = JSON.parse(bytes) as GameState;
    expect(attackGateOf(reconstructed, activeOf(reconstructed, "p2"), 0)).toEqual(
      attackGateOf(state, activeOf(state, "p2"), 0),
    );
    expect(declare(reconstructed, "p2", 0)).toBe("ATTACK_PREVENTED");
    // …and the round trip is not vacuous: it really did lose every non-JSON value.
    expect(reconstructed).toEqual(JSON.parse(JSON.stringify(state)) as GameState);
  });

  it("the engine version was bumped in the same commit as the behaviour", () => {
    // D208's debt and D275's mutant: `engineVersion` and `packages/engine/package.json`
    // are one fact with two spellings, and the pin is authored HERE rather than
    // inherited (D427 — count your own suite's pin).
    expect(engineVersion).toBe("0.400.0");
  });
});
