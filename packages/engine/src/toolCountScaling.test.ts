import { describe, expect, it } from "vitest";
import { legalAttackCorpus } from "./censusAttackCorpus";
import { countToolsInPlay } from "./continuous";
import {
  deriveAttackDamageBonus,
  deriveAttackDamageMultiplier,
  deriveAttackDamagePenalty,
  deriveAttackEffect,
} from "./effects";
import type { GameEvent, GameState, Seat } from "./index";
import { applyAction, engineVersion, programFor } from "./index";
import {
  FIXTURE_POOL,
  TOOL_COUNT_DECK,
  attachFromDeck,
  attachToolFromDeck,
  benchFromDeck,
  clearBench,
  driveSetup,
  must,
  mustApply,
  setActiveFromDeck,
} from "./testFixtures";

// 0.310.0 → 0.311.0 — 🆕🆕 D406: THE COUNTED TOOL SCALER.
//
//   "This attack does 30 damage for each Pokémon Tool attached to all of your
//    Pokémon."   — 1 sentence, 5 LEGAL printings
//
// THE THIRTEENTH `DamageCountSource`, AND THE FIRST THAT COUNTS NEITHER ENERGY,
// NOR BODIES, NOR DAMAGE COUNTERS. Twelve members over three resources became
// thirteen over four, and the fourth cost no new state at all: `InPlayPokemon.tools`
// has been an ingested, persisted uid array since M4, and `attachTool` (cardplay.ts)
// has always refused anything whose `trainerType` is not "Tool", so the arithmetic
// is `tools.length` summed over a zone with no provision question in it.
//
// ── 🛑 WHAT THIS SUITE EXISTS TO PIN, AND WHY EACH RUNG CAN GO RED ───────────
//
// The evaluator has FOUR ways to be wrong and every one of them is a real
// neighbouring arm rather than a straw:
//
//   ⑴ THE SEAT. The printed word is "all of YOUR Pokémon" and the attack damages
//      the opponent, so the two seats are opposite ends of one swing —
//      `opponentBenchCount` reads `defenderSeat` three cases up in the same
//      `switch`. §3's canonical board wears 3 Tools on the attacker's side and 5
//      on the defender's, so a seat flip reads 150 where the truth is 90.
//   ⑵ THE ZONE. "all of" is §6.3's "in play" — Active **plus** Bench, the same
//      reading `energyOnOpponent`'s `zone: "board"` takes at the other end of the
//      table. The canonical board splits 2 on the Active and 1 on the Bench, so an
//      Active-only read says 60 and a Bench-only one says 30.
//   ⑶ THE RESOURCE. `yourBenchCount` counts BODIES and `energyOnSelf` counts
//      ENERGY, and both are one `case` away. The canonical board holds 2 benched
//      bodies and 1 attached Energy against 3 Tools, so neither can pass for it.
//   ⑷ THE ARITHMETIC. `tools.length` SUMMED, never "how many bodies wear one":
//      §7.4's one-per-body cap is an ATTACH-GATE rule and Revavroom ex sv03-156's
//      "Tune-Up" raises it to 4, so the Active wearing TWO is a real board and a
//      body-tally reads 2 where the truth is 3.
//
// ⚠️ **AND THE BASE IS DROPPED, WHICH IS THE FIFTH THING AND THE ONLY ONE THAT IS
// NOT AN ARM.** The sentence carries no "more" (D145/D167's whole discriminator),
// so it lands on the MULTIPLY fold and `scaledBase`'s existing
// `damageMultiplier !== null` disjunct zeroes the printed `30×`. §4 drives the
// Tool-less board and asserts NO `DAMAGE_DEALT` EVENT AT ALL — a build that kept
// the base would deal 30 there and be green everywhere else in this file.
//
// ⚠️ **THE MEMBER IS MULTIPLY-ONLY, AND THAT IS AN ABSENCE THIS SUITE PINS RATHER
// THAN AN OVERSIGHT.** The "more" twin is not printed anywhere in the legal attack
// column, so `deriveAttackDamageBonus` deliberately gains no arm — the exact mirror
// of `bothActivesEnergyCount`, which is ADD-only because its no-adjective twin is 0
// legal. Two members, two one-reader shapes, opposite folds.

/** The printed sentence, byte for byte off `legalAttackCorpus()` — the committed
    `legal_standard = 1` attack column. `Pokémon` carries the real é (U+00E9) in
    both slots and there is no apostrophe anywhere in it. */
const TOOL_COUNT = "This attack does 30 damage for each Pokémon Tool attached to all of your Pokémon.";

/** The "more" twin. **PRINTED NOWHERE** — the column holds exactly one "for each
    Pokémon Tool" sentence and it is this bare one — so this is an ABSENCE and is
    pinned as such, never an unread printing. */
const UNPRINTED_MORE =
  "This attack does 30 more damage for each Pokémon Tool attached to all of your Pokémon.";
/** The "less" twin, printed nowhere either. */
const UNPRINTED_LESS =
  "This attack does 30 less damage for each Pokémon Tool attached to all of your Pokémon.";
/** The OPPONENT-side zone, printed nowhere — which is why the member carries no
    `side` and the pattern captures no seat. */
const UNPRINTED_OPPONENT =
  "This attack does 30 damage for each Pokémon Tool attached to all of your opponent's Pokémon.";

/** ⚠️ **THE NEAR MISS THAT IS A REAL CATALOG ROW AND A DIFFERENT QUESTION**: the two
    printed EXISTENCE clauses, already built as `BoardCondition`s (D369 and its twin)
    and reached through the 0-or-1 indicator on the ADDITIVE fold. Same noun, one body,
    a boolean rather than a count. */
const OWN_TOOL_EXISTS = "If this Pokémon has a Pokémon Tool attached, this attack does 40 more damage.";
const FOE_TOOL_EXISTS =
  "If your opponent's Active Pokémon has a Pokémon Tool attached, this attack does 80 more damage.";
/** ⚠️ **AND THE LARGEST ONE, WHICH IS THE SAME NOUN DISCARDED RATHER THAN COUNTED** —
    5 legal printings, and blocked on a pre-damage execution point this engine has no
    seam for (`deriveAttackDamageBonus`'s own doc block: the deriver's ops all run
    AFTER damage). It must stay LOUD. */
const TOOL_DISCARD = "Before doing damage, discard all Pokémon Tools from your opponent's Active Pokémon.";

/** ⚠️ **THE NEAR MISS ONE RESOURCE OVER, AND IT CONTRADICTED A CLAIM `effects.ts`
    ALREADY MADE.** `energyOnSelf`'s block said it carries no `zone` because *"the
    pool prints no board-wide spelling of '… attached to all of YOUR Pokémon'"*
    (D196, measured 2026-08-04 against the remote D1). The committed column prints
    one, at 4 legal printings. ✅ **D407 BUILT IT** — `SELF_ENERGY_SCALE` captures its
    tail as a whole printed noun phrase and `energyOnSelf` carries the optional
    `zone`. The constant stays here because the rung below is the one that reddened
    when it landed, which is what a correction written as a GUARD buys over one
    written as a comment. */
const BOARD_WIDE_ENERGY = "This attack does 30 more damage for each {G} Energy attached to all of your Pokémon.";

/** One seed for the whole suite. Nothing here flips a coin and every Active, every
    Benched body and every Tool is placed by surgery, so a seed table would describe
    a shuffle rather than a rule (D143's move, inherited by every member of this
    family since). */
const SEED = 7;

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

/** `by`'s opponent opens and passes, so the attacking seat carries no §4
    first-turn restriction. Both Actives are placed by surgery and BOTH Benches are
    cleared to nothing: every number this suite reads is a POPULATION, so a body the
    setup shuffle happened to place would move the answer silently. One {C} is
    attached to pay the printed cost — and it is also the Energy a Tool count must
    ignore. */
function board(by: Seat = "p1"): GameState {
  const opener = by === "p1" ? "p2" : "p1";
  const foe = opener;
  let state = must(
    applyAction(driveSetup(SEED, { p1: TOOL_COUNT_DECK, p2: TOOL_COUNT_DECK }, { first: opener }), {
      type: "endTurn",
      seat: opener,
    }),
  );
  state = setActiveFromDeck(state, by, "fix-toolscaler");
  state = clearBench(state, by);
  state = attachFromDeck(state, by, "fix-energy", 1);
  state = setActiveFromDeck(state, foe, "fix-bigbody");
  return clearBench(state, foe);
}

/** `bench.length` bodies onto `seat`'s Bench, each wearing `bench[i]` Tools, with
    `active` Tools on the Active. The two lists are independent on purpose: the body
    count and the Tool count must be able to disagree, or ⑶ above is untestable. */
function dress(state: GameState, seat: Seat, active: number, bench: readonly number[]): GameState {
  let next = state;
  for (let i = 0; i < active; i += 1) next = attachToolFromDeck(next, seat, "active", "fix-tool");
  for (const [index, tools] of bench.entries()) {
    next = benchFromDeck(next, seat, "fix-bigbody");
    for (let i = 0; i < tools; i += 1) next = attachToolFromDeck(next, seat, index, "fix-tool");
  }
  return next;
}

function swing(state: GameState, seat: Seat = "p1") {
  return mustApply(state, { type: "attack", seat, index: 0 });
}

/** 🛑 **THE CANONICAL BOARD, AND EVERY WRONG ANSWER ON IT IS A DIFFERENT NUMBER.**
    The attacker wears 2 Tools on its Active and 1 on bench[0] of TWO benched bodies;
    the defender wears 3 on its Active and 2 on its one benched body. So:

      truth (own board, Tools summed)      3 → **90**
      the seat flipped (their board)       5 → 150
      the Active alone                     2 →  60
      the Bench alone                      1 →  30
      bodies WEARING a Tool, own board     2 →  60
      benched BODIES (`yourBenchCount`)    2 →  60
      attached ENERGY (`energyOnSelf`)     1 →  30
      both sides                           8 → 240

    Seven distinct wrong numbers against one right one, on ONE setup. */
function canonical(by: Seat = "p1"): GameState {
  const foe = by === "p1" ? "p2" : "p1";
  const state = dress(board(by), by, 2, [1, 0]);
  return dress(state, foe, 3, [2]);
}

// ─────────────────────────────────────────────────────────────────────────────
// §1 — the printed data and the population.
// ─────────────────────────────────────────────────────────────────────────────

describe("§1 — the printed sentence, its population, and the fixture that carries it", () => {
  it("the column prints it FIVE times, on exactly one record", () => {
    const rows = legalAttackCorpus().filter(([, s]) => s === TOOL_COUNT);
    expect(rows).toHaveLength(1);
    expect(rows.reduce((sum, [n]) => sum + n, 0)).toBe(5);
  });

  it("and prints NO other 'for each Pokémon Tool' sentence at all", () => {
    // The measurement behind "no `side`, no `zone`, no additive twin": if a second
    // spelling existed anywhere in the column this rung names it, and the shape
    // decisions above it would have to be re-argued.
    const family = legalAttackCorpus().filter(([, s]) => s.includes("for each Pokémon Tool"));
    expect(family.map(([, s]) => s)).toEqual([TOOL_COUNT]);
  });

  it("carries fix-toolscaler's WHOLE printed card, `30×` marker included", () => {
    // The whole list, so the fixture cannot be wrong by OMISSION (D156's failure
    // mode). ⚠️ THE TRAILING "×" IS LOAD-BEARING: it is the marker this fold
    // consumes and the one that tells attack.ts to DROP the printed base.
    expect(FIXTURE_POOL["fix-toolscaler"]?.attacks).toEqual([
      {
        cost: ["Colorless"],
        name: "Gear Grind",
        damage: "30×",
        effect: TOOL_COUNT,
      },
    ]);
  });

  it("AUTHORS nothing — the printing is read off the TEXT", () => {
    // A registry-authored program would win over the reader (D8), so this is the
    // claim that says the text path is the one being driven below.
    expect(programFor("fix-toolscaler")).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — the reader, and the four it refuses.
// ─────────────────────────────────────────────────────────────────────────────

describe("§2 — deriveAttackDamageMultiplier: a thirteenth count member on the `×` fold", () => {
  it("reads the printed sentence as toolsOnYourBoard at the printed per-unit", () => {
    expect(deriveAttackDamageMultiplier(TOOL_COUNT)).toEqual({
      per: 30,
      count: { kind: "toolsOnYourBoard" },
    });
  });

  it("🛑 is MULTIPLY-ONLY: the additive and subtractive readers refuse the same sentence", () => {
    // The one-reader shape, and it is the mirror of `bothActivesEnergyCount`'s.
    // Turns red the moment somebody gives `deriveAttackDamageBonus` a matching arm
    // "for symmetry" — which would author a card the catalog does not print.
    expect(deriveAttackDamageBonus(TOOL_COUNT)).toBeNull();
    expect(deriveAttackDamagePenalty(TOOL_COUNT)).toBeNull();
    expect(deriveAttackEffect(TOOL_COUNT)).toBeNull();
  });

  it("🛑 the UNPRINTED twins stay loud on every reader", () => {
    // "more", "less" and the opponent-side zone are ABSENCES, not unread printings.
    for (const text of [UNPRINTED_MORE, UNPRINTED_LESS, UNPRINTED_OPPONENT]) {
      expect(deriveAttackDamageMultiplier(text)).toBeNull();
      expect(deriveAttackDamageBonus(text)).toBeNull();
      expect(deriveAttackDamagePenalty(text)).toBeNull();
      expect(deriveAttackEffect(text)).toBeNull();
    }
  });

  it("the whole-sentence anchor holds at both ends and on the leading capital", () => {
    // The family's stated anchor discipline: no /i, a required trailing period, a
    // capital `This`, and no leading or trailing text. Each of these would be
    // admitted by a search-style pattern.
    expect(deriveAttackDamageMultiplier("this attack does 30 damage for each Pokémon Tool attached to all of your Pokémon.")).toBeNull();
    expect(deriveAttackDamageMultiplier("This attack does 30 damage for each Pokémon Tool attached to all of your Pokémon")).toBeNull();
    expect(deriveAttackDamageMultiplier(`Flip a coin. ${TOOL_COUNT}`)).toBeNull();
    expect(deriveAttackDamageMultiplier(`${TOOL_COUNT} Discard an Energy from this Pokémon.`)).toBeNull();
    // A printed 0 does nothing and stays LOUD — the guard every arm in both
    // families carries.
    expect(
      deriveAttackDamageMultiplier(
        "This attack does 0 damage for each Pokémon Tool attached to all of your Pokémon.",
      ),
    ).toBeNull();
    // …and the capture really is a capture, driven on CONSTRUCTED text that is
    // labelled as constructed rather than presented as a card (D121).
    expect(
      deriveAttackDamageMultiplier(
        "This attack does 20 damage for each Pokémon Tool attached to all of your Pokémon.",
      ),
    ).toEqual({ per: 20, count: { kind: "toolsOnYourBoard" } });
  });

  it("🛑 the REAL catalog near-misses are refused, and each is a different question", () => {
    // The two EXISTENCE clauses are boolean reads of ONE body and are already built
    // as `BoardCondition`s on the ADDITIVE fold; the Tool DISCARD is the same noun
    // removed rather than counted. All three must stay off this pattern.
    for (const text of [OWN_TOOL_EXISTS, FOE_TOOL_EXISTS, TOOL_DISCARD]) {
      expect(deriveAttackDamageMultiplier(text)).toBeNull();
    }
    // The two existence clauses ARE read — by the additive reader, as the 0-or-1
    // indicator — so this is a refusal of THIS pattern rather than of the sentence.
    expect(deriveAttackDamageBonus(OWN_TOOL_EXISTS)).toEqual({
      per: 40,
      count: { kind: "boardCondition", cond: { kind: "yourActiveHasToolAttached" } },
    });
    expect(deriveAttackDamageBonus(FOE_TOOL_EXISTS)).toEqual({
      per: 80,
      count: { kind: "boardCondition", cond: { kind: "opponentActiveHasToolAttached" } },
    });
    // …and the DISCARD is unread by every reader in the family, which is the
    // measurement behind "it needs a seam, not an op".
    expect(deriveAttackDamageBonus(TOOL_DISCARD)).toBeNull();
    expect(deriveAttackEffect(TOOL_DISCARD)).toBeNull();
  });

  it("✅ the BOARD-WIDE ENERGY sentence is BUILT — this rung reddened by name, as designed", () => {
    // 4 legal printings of "… for each {G} Energy attached to all of your Pokémon."
    // — the spelling `energyOnSelf`'s doc block said the pool does not print. It
    // does, and D406 pinned the sentence UNBUILT here precisely so that the
    // successor who gave `energyOnSelf` its zone would redden HERE rather than
    // rediscover the claim a third time. 🆕🆕 **D407 IS THAT SUCCESSOR, AND THIS IS
    // THE RUNG IT TURNED RED**; the population is unchanged and only the reader's
    // answer moved, which is the whole point of writing the correction as a guard.
    // The `×` half stays null — that fold's board-wide own-Energy spelling really
    // is absent from the column (see `boardWideEnergyScaling.test.ts` §2).
    const rows = legalAttackCorpus().filter(([, s]) => s === BOARD_WIDE_ENERGY);
    expect(rows.reduce((sum, [n]) => sum + n, 0)).toBe(4);
    expect(deriveAttackDamageBonus(BOARD_WIDE_ENERGY)).toEqual({
      per: 30,
      count: { kind: "energyOnSelf", zone: "board", energyType: "Grass" },
    });
    expect(deriveAttackDamageMultiplier(BOARD_WIDE_ENERGY)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — the counter, and the board where every wrong answer is a different number.
// ─────────────────────────────────────────────────────────────────────────────

describe("§3 — countToolsInPlay, and the four ways the evaluator could be wrong", () => {
  it("🛑 the canonical board really does separate all eight readings", () => {
    // D214's attribution control, applied to a set of readings rather than to a
    // build artifact: a rung that only exercises boards where the candidate answers
    // AGREE is the vacuous guard this repo keeps rediscovering. Asserted BEFORE any
    // damage is read, so a later drift in the fixture deck cannot quietly collapse
    // two of them onto one number.
    const state = canonical();
    const mine = state.players.p1;
    const theirs = state.players.p2;
    expect(countToolsInPlay(state, "p1")).toBe(3);
    expect(countToolsInPlay(state, "p2")).toBe(5);
    expect(mine.active?.tools).toHaveLength(2);
    expect(mine.bench.reduce((n, p) => n + p.tools.length, 0)).toBe(1);
    expect(mine.bench.filter((p) => p.tools.length > 0)).toHaveLength(1);
    expect(mine.bench).toHaveLength(2);
    expect(mine.active?.energy).toHaveLength(1);
    expect(theirs.active?.tools).toHaveLength(3);
    expect(countToolsInPlay(state, "p1") + countToolsInPlay(state, "p2")).toBe(8);
  });

  it("counts Active PLUS Bench, and an empty board is 0", () => {
    // "In play" is §6.3's Active + Bench and nothing else. The three-way split is
    // driven rather than asserted: 0 everywhere, then the Active alone, then the
    // Bench alone, then both.
    const bare = board();
    expect(countToolsInPlay(bare, "p1")).toBe(0);
    expect(countToolsInPlay(dress(bare, "p1", 2, []), "p1")).toBe(2);
    expect(countToolsInPlay(dress(bare, "p1", 0, [1, 0]), "p1")).toBe(1);
    expect(countToolsInPlay(dress(bare, "p1", 2, [1, 0]), "p1")).toBe(3);
  });

  it("🛑 sums `tools.length` rather than counting the bodies that wear one", () => {
    // §7.4's one-per-body cap is an ATTACH-GATE rule and Revavroom ex sv03-156's
    // "Tune-Up" raises it to 4, so a single body wearing THREE is a real board. A
    // body tally reads 1 here; the truth is 3.
    const state = dress(board(), "p1", 3, []);
    expect(state.players.p1.active?.tools).toHaveLength(3);
    expect(countToolsInPlay(state, "p1")).toBe(3);
  });

  it("ignores attached ENERGY entirely — the resource is the Tool array", () => {
    // `energyOnSelf` is one `case` away in the same switch. Four {C} on the Active
    // and no Tool anywhere: the Energy reading says 4, this one says 0.
    const state = attachFromDeck(board(), "p1", "fix-energy", 3);
    expect(state.players.p1.active?.energy).toHaveLength(4);
    expect(countToolsInPlay(state, "p1")).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — the fold on a real board: `per × count`, and the DROPPED base.
// ─────────────────────────────────────────────────────────────────────────────

describe("§4 — the `×` fold on a live board", () => {
  it("deals 30 × the Tools on the ATTACKER's own board", () => {
    const { events } = swing(canonical());
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ base: 0, scaled: 90, dealt: 90 });
  });

  it("🛑 the PRINTED BASE IS DROPPED: a Tool-less board deals nothing and emits NO DAMAGE_DEALT", () => {
    // The printed `30×` is the PER-UNIT, so a build that kept the base would deal 30
    // here — and would be green on every other rung in this file. `base: 0` above is
    // the same claim from the other side.
    const { events } = swing(board());
    expect(find(events, "DAMAGE_DEALT")).toBeUndefined();
    expect(events.some((e) => e.type === "ATTACK_EFFECT_SKIPPED")).toBe(false);
  });

  it("🛑 the SEAT is the attacker's: the opponent's Tools are invisible", () => {
    // The defender wears 5 and the attacker none. A `defenderSeat` read — the arm
    // `opponentBenchCount` uses three cases up — deals 150 here; the truth is no
    // damage at all.
    const state = dress(board(), "p2", 3, [2]);
    expect(countToolsInPlay(state, "p2")).toBe(5);
    expect(find(swing(state).events, "DAMAGE_DEALT")).toBeUndefined();
  });

  it("🛑 the BENCH counts: Tools behind the Active are not invisible", () => {
    // The Active-only reading — `yourActiveHasToolAttached`'s zone, one abstraction
    // down — deals nothing here; the truth is 60.
    const state = dress(board(), "p1", 0, [1, 1]);
    expect(find(swing(state).events, "DAMAGE_DEALT")).toMatchObject({ scaled: 60, dealt: 60 });
  });

  it("🛑 BODIES are not the resource: two benched Pokémon wearing nothing deal nothing", () => {
    // `yourBenchCount` reads exactly this board as 2 and deals 60. The Tool count
    // reads it as 0.
    const state = dress(board(), "p1", 0, [0, 0]);
    expect(state.players.p1.bench).toHaveLength(2);
    expect(find(swing(state).events, "DAMAGE_DEALT")).toBeUndefined();
  });

  it("the count is READ AT DECLARATION and scales linearly across the whole range", () => {
    // One board per Tool count, so the arm is `per × count` rather than a threshold
    // or a saturating read. The Tools sit two on the Active and the rest on the
    // Bench, so no single zone can produce the sequence on its own.
    for (const [activeTools, benchTools, expected] of [
      [1, [0], 30],
      [2, [0], 60],
      [2, [1], 90],
      [2, [1, 1], 120],
      [2, [2, 1], 150],
    ] as const) {
      const state = dress(board(), "p1", activeTools, benchTools);
      expect(find(swing(state).events, "DAMAGE_DEALT")?.dealt).toBe(expected);
    }
  });

  it("the seats are symmetric — p2 attacking reads p2's board", () => {
    // The evaluator takes `attackerSeat`, so the same board mirrored gives the same
    // number. A hard-coded "p1" would pass every rung above and fail here.
    const { events } = swing(canonical("p2"), "p2");
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ base: 0, scaled: 90, dealt: 90 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — the version pair, driven rather than quoted.
// ─────────────────────────────────────────────────────────────────────────────

describe("§5 — the persisted question, asked and answered", () => {
  it("🛑 MATCH_RECORD_VERSION STAYS 25 — a DamageCountSource is never persisted", () => {
    // Argued from where the member is STORED, not from the file it is declared in:
    // it lives inside a DERIVED `AttackDamageBonus` computed from card text and
    // consumed in the same tick. Nothing parks it, no `EffectOp` carries it, and no
    // `MatchRecord` field holds one — so no v25 record could ever have contained a
    // `DamageCountSource` in the first place.
    // DRIVEN rather than argued, in `selfEnergyScaling.test.ts`'s idiom: the two
    // things that could park are an `EffectOp` and a program, and this sentence
    // produces neither — `deriveAttackEffect` returns null for it, so there is no
    // op to ride `GameState.phase.cont.pendingOp` and nothing new can appear in a
    // saved record at all.
    expect(deriveAttackEffect(TOOL_COUNT)).toBeNull();
    expect(deriveAttackDamageMultiplier(TOOL_COUNT)).not.toBeNull();
    // 🆕🆕 D416 — 0.319.0 → **0.320.0**, moved with the behaviour: THE PARKING KO PAIR (*"Flip a coin. If heads, Knock Out your opponent's Active Basic Pokémon. If tails, Knock Out 1 of your opponent's Benched Basic Pokémon."*, 4 printings, and *"Knock Out 1 of your opponent's Pokémon that has exactly 6 damage counters on it."*, 2 printings — **2 sentences / 6 printings**, both claimed WHOLE by `deriveAttackEffect`) is a WIDENING — ONE new PARKING `EffectOp` (`knockOutChosen`, required `target` plus two optional riders) reached through the EXISTING `choosePokemon` prompt and the EXISTING `KNOCKED_OUT` sweep, ZERO new persisted record fields — so the engine version moves and `MATCH_RECORD_VERSION` STAYS 26 (D307's paragraph: no v26 deploy can author `{ op: "knockOutChosen", … }` into a record THIS deploy reads).
    // 🆕🆕 D417 — 0.320.0 → **0.321.0**, moved with the behaviour: THE TRAILING CANCEL (*"Discard a Stadium in play. If you can't, this attack does nothing."*, Eternatus `sv08-141`, **1 legal printing**) gains a TWELFTH whole-sentence reader, `deriveAttackCancelRequirement` — the anaphoric cancel `deriveAttackRequirement`'s leading `^If` could never see. `MATCH_RECORD_VERSION` **STAYS 26**, asked rather than assumed: the reader returns an EXISTING `BoardCondition` through the EXISTING requirement channel and adds NO persisted field, so no v26 record gains a shape this deploy would not already read.
    expect(engineVersion).toBe("0.379.0");
  });
});
