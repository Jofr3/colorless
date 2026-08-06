import { describe, expect, it } from "vitest";
import { effectiveAttackCost, passivesOf, selfAttackCostDiscount } from "./continuous";
import type { GameState, InPlayPokemon, Seat } from "./index";
import { applyAction, conditionNote, programFor, redactGame } from "./index";
import { attackBarredByAbility, conditionHolds, countOwnerPokemonInPlay } from "./interpreter";
import {
  FIXTURE_POOL,
  ROW14_DECK,
  attachBenchFromDeck,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  driveSetup,
  mustApply,
  setActiveFromDeck,
  setPrizes,
} from "./testFixtures";

// 0.157.0 → 0.158.0 — D242, BACKLOG ROW 14: THE ABILITY COLUMN'S BIGGEST REPRINT
// GROUPS. The first NON-DERIVER row in nine slices, and the first slice since
// D221 to move the doc's non-attack fraction at all.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE RE-DERIVATION — the row's count, and what it got WRONG.
// ─────────────────────────────────────────────────────────────────────────────
//
// The row (`coverage-backlog-legal.md`) says **18 = 0 · 18 · 0**, "the ABILITY
// column's three biggest reprint groups — three registry programs, six legal
// printings each". The query, re-run against the remote D1 `luminous`
// (735f0fb5-cdc3-494d-8b97-74a8ade0124a) on 2026-08-06, GROUPED BY SENTENCE:
//
//   SELECT COUNT(*) AS printings, json_extract(j.value,'$.effect') AS t,
//          group_concat(DISTINCT c.id) AS ids
//     FROM cards c, json_each(c.abilities_json) j
//    WHERE c.legal_standard = 1 AND json_extract(j.value,'$.effect') NOT IN ('')
//    GROUP BY t ORDER BY printings DESC LIMIT 15;
//
// …and the "registry ids subtracted" half was taken LOCALLY by running
// `programFor(id)` over every id in every returned group, which is the same
// method `censusAtHead.test.ts` uses. The full ranked head, with the built/unbuilt
// split measured rather than assumed:
//
//   8  BUILT   "This Pokémon takes 30 less damage from attacks (after applying …)"
//   8  BUILT   "…attach a Basic {G} Energy card from your hand to this Pokémon…draw a card."
//   7  BUILT   "If this Pokémon has full HP and would be Knocked Out…HP becomes 10."
//   7  UNBUILT "If Festival Grounds is in play, this Pokémon may use an attack it has twice…"
//   6  UNBUILT "When you play this Pokémon from your hand onto your Bench…move any amount…"
//   6  UNBUILT "This Pokémon can't attack unless you have 4 or more Team Rocket's Pokémon in play."
//   6  BUILT   "Damage from attacks used by this Pokémon isn't affected by any effects…"
//   6  UNBUILT "Blood Moon used by this Pokémon costs {C} less for each Prize card…"
//   6  UNBUILT "Attacks used by your Future Pokémon, except any Iron Crown ex, do 20 more…"
//   5  UNBUILT "Prevent all damage from attacks done to this Pokémon by your opponent's…"
//   5  UNBUILT "Once during your turn, you may switch 1 of your Benched {D} Pokémon…"
//   5  BUILT   "As often as you like during your turn, you may attach a Basic {L} Energy…"
//
// ✅ **THE COUNT RE-DERIVES TO THE DIGIT FOR THE NINTH ROW RUNNING.** The row's
// three NAMED sentences are 6 + 6 + 6 = **18 printings on 3 sentences**, every one
// of the 18 with `programFor(id) === undefined` before this slice. 18 = 18.
//
// 🛑 **BUT THE ROW'S COMPOSITION CLAIM IS FALSE, AND ITS OWN QUERY FALSIFIES IT —
// THE SECOND TIME THIS PAGE HAS LOST EXACTLY THAT WAY** (row 15's damage-cap arm,
// D239). *"The ABILITY column's three biggest reprint groups"* is not what the
// three named sentences are:
//   • **The biggest UNBUILT ability group is SEVEN, not six** — Festival Grounds
//     (`sv06-018`/`-044`/`-089`/`-170`/`sv08.5-010`/`-020`/`-021`), which the row
//     does not mention at all.
//   • **There are FOUR six-printing unbuilt groups, not three** — the row names
//     three of them and silently drops "Attacks used by your **Future** Pokémon …
//     do 20 more damage" (`svp-146`/…).
// So "the three biggest" would be 7 + 6 + 6 = 19 on a different three sentences.
// 🆕 **A SUPERLATIVE IS A THIRD CLAIM, AFTER THE COUNT AND THE COMPOSITION, AND
// IT IS THE ONE NO `GROUP BY` ON THE ROW'S OWN IDS CAN CHECK** — you have to run
// the query WITHOUT the row's ids in it and look at what is above them. Both new
// groups are measured into `coverage-backlog-legal.md` by this slice.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHAT THIS SLICE TAKES — 12 of the 18, and WHY not 18.
// ─────────────────────────────────────────────────────────────────────────────
//
// 🛑 **THE ROW'S "THREE REGISTRY PROGRAMS, ZERO ENGINE CODE" CLAIM LOSES ON TWO
// OF THE THREE, WHICH IS THE FIFTH TIME THIS PAGE HAS BEEN WRONG ABOUT "ZERO
// ENGINE CODE"** (its own warning, on row 12). Priced by grepping the FUNCTION and
// the FIELD, never the prose:
//
//   • **Team Rocket's "Power Saver"** — the row says *"`preventAttack` + a
//     `BoardCondition` over `ownerPokemon`, both exist"*. **BOTH TOKENS ARE
//     WRONG.** `preventAttack` is an attack-installed OP that stamps
//     `InPlayPokemon.attackLockedTurn` for one turn; this is an ALWAYS-ON printed
//     Ability that clears when the BOARD changes and that a §9 Ability-lock must
//     SILENCE — a different channel, not a different value (D240). And
//     `BoardCondition` had **no** member over `ownerPokemon`: 22 members, none of
//     them a subgroup count (`yourBenchHasNamed` is a Bench-only exact NAME).
//     Cost: 1 union member, 1 `conditionHolds` arm, 1 `conditionNote` arm, 1
//     `PassiveEffects` field, 1 `passivesOf` collector, 1 reader, 3 read sites.
//   • **Bloodmoon Ursaluna's "Seasoned Skill"** — ✅ **THE ONE THAT HOLDS.**
//     D218's `attackCostDiscountPerOpponentPrize` serves it with **zero engine
//     code**, and the assumption that makes that true is flagged and pinned below.
//   • **Iron Leaves ex's on-bench switch** — NOT TAKEN, and it is a whole
//     mechanism rather than a third registry object. Measured out as row **14-R**.
//
// ⚠️ **READ SITES PRICED BY GREP, AND COUNTED HERE RATHER THAN ESTIMATED** (D240's
// rule — its estimate of "four" was five):
//   1. `attack.ts`'s §8 gate — the authority. NON-ZERO.
//   2. `redact.ts`'s `redactedAttacksOf` `banned` — NON-ZERO. 🛑 **AND THE RESUME
//      POINT PREDICTED THE WRONG FUNCTION**: it said `redactedAbilitiesOf`,
//      reasoning that a HUD row-lighting mirror owes a row. It owes **ZERO** —
//      that projection lists ACTIVATED abilities (`programFor(id)?.abilities`), and
//      a `passive` has nothing to activate, so it was never in that list. The
//      sibling `redactedAttacksOf` is the one that owed.
//   3. `GameHud.tsx`'s TurnPanel `disabled` — NON-ZERO (`abilityGateUnmet`).
//   4. `programPlayable` — **ZERO, and said out loud**: it gates §9 ACTIVATION and
//      Trainer play, and neither program here is activated by anyone.
//   5. `preventBlock.test.ts`'s §11 table — **ZERO, and said out loud**: it
//      classifies `EffectOp`s, and this slice adds no op. The first row in six to
//      owe nothing there, measured rather than assumed.
//   6. `log.ts` — **ZERO**: nothing here EMITS. A refused declaration is a rejected
//      action, which never reaches the event stream, and the discount is already
//      carried by `redactedAttack.effectiveCost` (D218).
//   7. `projection.ts` — **ZERO**: the hot-seat playmat renders the board, and the
//      attack panel is `GameHud`'s (site 3).
//   8. `MATCH_RECORD_VERSION` — **NO BUMP, and it is a MEASUREMENT rather than a
//      hope**: nothing here is persisted. Both facts are CATALOG facts re-derived
//      from the board on every read, unlike the two locks they sit beside, which
//      are `InPlayPokemon` fields. A record written yesterday holds today's types
//      byte for byte.

const POWER_SAVER_TEXT =
  "This Pokémon can't attack unless you have 4 or more Team Rocket's Pokémon in play.";
const SEASONED_SKILL_TEXT =
  "Blood Moon used by this Pokémon costs {C} less for each Prize card your opponent has taken.";

const SEED = 91;

/** Setup on P1's turn 3 (two passes past the §4 first-turn ban), both benches
    emptied and both Active spots normalised to the inert `fix-basic-1`, so every
    board below is exactly what its own surgeries put on it — `attackCostDelta`'s
    idiom, and load-bearing for the same reason: three of this deck's Basics carry
    Abilities and one of them is a §9 LOCK that would silence the whole slice if it
    arrived as a starter. */
function board(): GameState {
  let state = driveSetup(SEED, { p1: ROW14_DECK, p2: ROW14_DECK }, { first: "p1" });
  state = mustApply(state, { type: "endTurn", seat: "p1" }).state;
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = clearBench(setActiveFromDeck(state, "p1", "fix-basic-1"), "p1");
  return clearBench(setActiveFromDeck(state, "p2", "fix-basic-1"), "p2");
}

function activeOf(state: GameState, seat: Seat): InPlayPokemon {
  const spot = state.players[seat].active;
  if (spot === null) throw new Error(`${seat} has no Active`);
  return spot;
}

/** P1's Active is the gate holder; `benched` further prefixed bodies beside it. */
function gated(benched: number): GameState {
  let state = clearBench(setActiveFromDeck(board(), "p1", "fix-powersaver"), "p1");
  for (let i = 0; i < benched; i++) state = benchFromDeck(state, "p1", "fix-tr-body");
  return state;
}

/** "Your opponent has taken N Prizes" — their pile is 6 − N (`takenPrizes`). */
function opponentTook(state: GameState, seat: Seat, taken: number): GameState {
  return setPrizes(state, seat, 6 - taken);
}

const POWER_SAVER_COND = {
  kind: "yourOwnerPokemonInPlayAtLeast",
  owner: "Team Rocket",
  count: 4,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// 1. THE REGISTRY ROWS — 12 printings, two objects, and what each is NOT.
// ─────────────────────────────────────────────────────────────────────────────

describe("D242 — the twelve registry rows", () => {
  const POWER_SAVER_IDS = ["svp-205", "svp-216", "sv10-081", "sv10-213", "sv10-231", "sv10-240"];
  const SEASONED_IDS = ["svp-177", "sv06-141", "sv06-202", "sv06-216", "sv06-222", "sv08.5-168"];

  it("authors all SIX Power Saver printings as one passive gate and NOTHING else", () => {
    for (const id of POWER_SAVER_IDS) {
      expect(programFor(id)).toEqual({ passive: { cantAttackUnless: POWER_SAVER_COND } });
      // ⚠️ PASSIVE-ONLY, AND THE ABSENCE IS THE ASSERTION (attackCostDelta's rule):
      // the attack seam reads `programFor(id)?.attack?.[index]` FIRST, so an
      // `attack` map here would silently take over Erasure Ball's derivation.
      expect(programFor(id)?.attack).toBeUndefined();
      // …and it is not an ACTIVATED ability, which is the classification the whole
      // channel argument rests on. A `abilities` entry would put it in
      // `redactedAbilitiesOf`'s list and give the player a button to press.
      expect(programFor(id)?.abilities).toBeUndefined();
    }
    // All six share ONE object (D8's reprint rule), and it is not the sibling's.
    expect(new Set(POWER_SAVER_IDS.map((id) => programFor(id))).size).toBe(1);
    expect(programFor("svp-205")).not.toBe(programFor("svp-177"));
  });

  it("authors all SIX Seasoned Skill printings as D218's discount, at rate 1", () => {
    for (const id of SEASONED_IDS) {
      expect(programFor(id)).toEqual({ passive: { attackCostDiscountPerOpponentPrize: 1 } });
      expect(programFor(id)?.attack).toBeUndefined();
    }
    expect(new Set(SEASONED_IDS.map((id) => programFor(id))).size).toBe(1);
    // ⚠️ THE SAME SHAPE AS RADIANT CHARIZARD'S AND A SEPARATE OBJECT (D199's
    // near-twin rule): equal by value, distinct by identity, so a future edit to
    // one printing's rate cannot silently move the other card.
    expect(programFor("svp-177")).toEqual(programFor("swsh10.5-011"));
    expect(programFor("svp-177")).not.toBe(programFor("swsh10.5-011"));
  });

  it("the fixture demonstrators carry the printed bytes VERBATIM", () => {
    expect(FIXTURE_POOL["fix-powersaver"]?.abilities?.[0]?.effect).toBe(POWER_SAVER_TEXT);
    expect(FIXTURE_POOL["fix-seasoned"]?.abilities?.[0]?.effect).toBe(SEASONED_SKILL_TEXT);
    // The NAMES are the load-bearing field for the gate holder, and the two near
    // misses are named so that the prefix arm can go red for the right reason.
    expect(FIXTURE_POOL["fix-powersaver"]?.name).toBe("Team Rocket's Mewtwo");
    expect(FIXTURE_POOL["fix-tr-body"]?.name).toBe("Team Rocket's Meowth");
    expect(FIXTURE_POOL["fix-tr-energy"]?.name).toBe("Team Rocket's Energy");
    expect(FIXTURE_POOL["fix-not-tr-body"]?.name).toBe("Rival of Team Rocket's Meowth");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. THE COUNT — `countOwnerPokemonInPlay`, and the near-miss table.
// ─────────────────────────────────────────────────────────────────────────────

describe("D242 — counting an owner-prefixed subgroup IN PLAY", () => {
  it("counts the holder ITSELF — the printed words are '4 or more', not '4 other'", () => {
    // ⚠️ THE READING THE WHOLE ROW TURNS ON. At 3 benched the count is FOUR and the
    // gate opens; if the holder did not count itself it would still be barred.
    expect(countOwnerPokemonInPlay(gated(0), "p1", "Team Rocket")).toBe(1);
    expect(countOwnerPokemonInPlay(gated(3), "p1", "Team Rocket")).toBe(4);
  });

  it("counts the ACTIVE SPOT and the BENCH — 'in play' is both", () => {
    // The holder alone reads 1 (Active), and the same board with the holder moved
    // off the Active spot still counts the three on the Bench.
    // Three prefixed bodies on the BENCH and a PLAIN body in the Active Spot: the
    // count is 3, so the Bench is walked. A build that read only the Active
    // answers 0 here and 1 on the board above — two different wrong numbers, so
    // the pair pins the union rather than either half.
    let state = clearBench(board(), "p1");
    for (let i = 0; i < 3; i++) state = benchFromDeck(state, "p1", "fix-tr-body");
    expect(countOwnerPokemonInPlay(state, "p1", "Team Rocket")).toBe(3);
  });

  it("is SEAT-RELATIVE — the opponent's prefixed bodies are invisible", () => {
    // 🛑 THE LAYER THIS CASE NAMES IS THE SEAT INDEX AND NOTHING ELSE (D241's
    // near-miss rule): P2 holds four prefixed bodies and P1 holds one, so a build
    // that read both boards would answer 5 here and a build that read the WRONG
    // board would answer 4 — neither is 1, and no downstream guard is involved.
    let state = gated(0);
    state = setActiveFromDeck(state, "p2", "fix-powersaver");
    for (let i = 0; i < 3; i++) state = benchFromDeck(state, "p2", "fix-tr-body");
    expect(countOwnerPokemonInPlay(state, "p1", "Team Rocket")).toBe(1);
    expect(countOwnerPokemonInPlay(state, "p2", "Team Rocket")).toBe(4);
  });

  it("NEAR MISS — a prefixed SPECIAL ENERGY attached to a prefixed body counts ZERO", () => {
    // 🛑 THE LAYER: `matchesFilter`'s FIRST conjunct, `category === "Pokemon"`.
    // `Team Rocket's Energy` sv10-182 is a real printing of exactly this hazard,
    // and it is ATTACHED to bodies this fold walks — so nothing downstream refuses
    // it. A build with that conjunct deleted answers 4 here, not 1.
    let state = gated(0);
    state = attachFromDeck(state, "p1", "fix-tr-energy", 3);
    expect(activeOf(state, "p1").energy.length).toBe(3);
    expect(countOwnerPokemonInPlay(state, "p1", "Team Rocket")).toBe(1);
  });

  it("NEAR MISS — a name that CONTAINS the prefix without STARTING with it counts ZERO", () => {
    // 🛑 THE LAYER: `startsWith` versus `includes` inside the `ownerPokemon` arm.
    // Three benched "Rival of Team Rocket's Meowth" — an `includes` build answers
    // 4 and opens the gate; nothing else in the pipeline looks at the name at all.
    let state = gated(0);
    for (let i = 0; i < 3; i++) state = benchFromDeck(state, "p1", "fix-not-tr-body");
    expect(state.players.p1.bench.length).toBe(3);
    expect(countOwnerPokemonInPlay(state, "p1", "Team Rocket")).toBe(1);
    expect(countOwnerPokemonInPlay(state, "p1", "Team Rocket")).toBe(1);
  });

  it("NEAR MISS — the prefix is EXACT-CASE, so a lowercased owner counts ZERO", () => {
    // The `owner` string is compared exactly (`hasRuleBox`'s "Radiant " read, one
    // field over). This is the arm's own contract restated from the caller side.
    expect(countOwnerPokemonInPlay(gated(3), "p1", "team rocket")).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. THE CONDITION — one union member, one evaluator arm, one note arm.
// ─────────────────────────────────────────────────────────────────────────────

describe("D242 — `yourOwnerPokemonInPlayAtLeast`", () => {
  it("is a FLOOR and not a set — 4 or more, so 5 holds too", () => {
    // ⚠️ THE DIVERGENCE FROM `opponentPrizesRemaining` (set membership, "exactly"),
    // driven rather than asserted in prose: a `=== count` build passes at 4 and
    // fails here at 5, which is the printed reading of "or more".
    expect(conditionHolds(gated(2), "p1", POWER_SAVER_COND)).toBe(false);
    expect(conditionHolds(gated(3), "p1", POWER_SAVER_COND)).toBe(true);
    expect(conditionHolds(gated(4), "p1", POWER_SAVER_COND)).toBe(true);
  });

  it("round-trips to the printed clause through `conditionNote`", () => {
    expect(conditionNote(POWER_SAVER_COND)).toBe(
      "you have 4 or more Team Rocket's Pokémon in play",
    );
    // The fragment is a SUBSTRING of the printed sentence, apostrophe and all —
    // the family's second full round trip, and the check that the owner string
    // carries its own possessive rather than the renderer adding one.
    expect(POWER_SAVER_TEXT).toContain(conditionNote(POWER_SAVER_COND));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. THE GATE — `attackBarredByAbility`, the §9 channel, and the §8 refusal.
// ─────────────────────────────────────────────────────────────────────────────

describe("D242 — Power Saver, the always-on attack gate", () => {
  it("`passivesOf` COLLECTS the condition raw and unevaluated", () => {
    // The split this field exists under: the fold has no seat, so it collects and
    // the read site evaluates — `damageBonusBeforeWRIf`'s shape verbatim.
    expect(passivesOf(gated(0), activeOf(gated(0), "p1")).cantAttackUnless).toEqual([
      POWER_SAVER_COND,
    ]);
    // A body with no such passive collects an EMPTY list, not undefined — the
    // control that stops `?? []` hiding a wiring break at every read site.
    const plain = board();
    expect(passivesOf(plain, activeOf(plain, "p1")).cantAttackUnless).toEqual([]);
  });

  it("returns the UNMET condition below the floor, and undefined at or above it", () => {
    expect(attackBarredByAbility(gated(2), "p1", activeOf(gated(2), "p1"))).toEqual(
      POWER_SAVER_COND,
    );
    expect(attackBarredByAbility(gated(3), "p1", activeOf(gated(3), "p1"))).toBeUndefined();
    // The attribution control: a body with no gate at all is never barred, so
    // "everything is barred" cannot pass this suite (D214's vacuous-guard shape).
    const plain = board();
    expect(attackBarredByAbility(plain, "p1", activeOf(plain, "p1"))).toBeUndefined();
  });

  it("§8 REFUSES the declaration, names the printed clause, and spends NOTHING", () => {
    const state = gated(2);
    const result = applyAction(state, { type: "attack", seat: "p1", index: 0 });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected the gate to refuse");
    expect(result.error.code).toBe("ATTACK_PREVENTED");
    expect(result.error.message).toContain("you have 4 or more Team Rocket's Pokémon in play");
    // A REJECTION, not an ATTACK_FAILED: the turn does not end and nothing moved.
    expect(state.phase.kind).toBe("turn:action");
  });

  it("§8 refuses EVERY attack index, not just index 0 — it is a fact about the BODY", () => {
    // 🛑 THREE OF EVERY CASE (D241's rule) READ ON THE OTHER AXIS: the fixture has
    // TWO attacks precisely so this can be distinguished from D154's per-attack
    // bar, which would leave index 1 legal.
    const state = gated(2);
    for (const index of [0, 1]) {
      const result = applyAction(state, { type: "attack", seat: "p1", index });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("ATTACK_PREVENTED");
    }
  });

  it("…and the SAME board one prefixed body later lets the attack through", () => {
    // The non-vacuous half. Energy attached so the cost is met and the ONLY thing
    // that changed between the two boards is the count.
    let state = gated(3);
    state = attachFromDeck(state, "p1", "fix-energy", 1);
    const result = applyAction(state, { type: "attack", seat: "p1", index: 0 });
    expect(result.ok).toBe(true);
  });

  it("it sits BEFORE the index check — a bogus index on a gated body reports the GATE", () => {
    // ⚠️ THE PLACEMENT, DRIVEN. `attackLocked`'s argument says a fact about the
    // BODY is answerable before `index` is known; a build that moved this line
    // below the index check returns BAD_ATTACK_INDEX here.
    const result = applyAction(gated(2), { type: "attack", seat: "p1", index: 99 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("ATTACK_PREVENTED");
  });

  it("a §9 ABILITY-LOCK SILENCES the gate — the whole channel argument, driven", () => {
    // 🛑🛑 THE CASE THAT COULD NOT HAVE BEEN FAKED BY A FOURTH WRITER OF
    // `attackLockedTurn`. Power Saver is a printed ABILITY on a BASIC, so Klefki
    // `sv01-096` "Mischievous Lock" really must silence it and hand the Mewtwo its
    // attack back. This works only because the reader goes through `passivesOf`,
    // the §9-SUPPRESSED catalog scan; a stamp on `InPlayPokemon`, or a read of
    // `programFor(id)` at the three payability sites, gets it wrong silently.
    let state = gated(0);
    expect(attackBarredByAbility(state, "p1", activeOf(state, "p1"))).toEqual(POWER_SAVER_COND);
    state = setActiveFromDeck(state, "p2", "sv01-096");
    expect(attackBarredByAbility(state, "p1", activeOf(state, "p1"))).toBeUndefined();
    // …and the §8 gate agrees, which is the point of reading through one function.
    const withEnergy = attachFromDeck(state, "p1", "fix-energy", 1);
    expect(applyAction(withEnergy, { type: "attack", seat: "p1", index: 0 }).ok).toBe(true);
  });

  it("greys EVERY attack row on the WIRE projection, and un-greys them together", () => {
    // Read site 2. `banned` rather than `barred`, so both rows move as one.
    const barredView = redactGame(attachFromDeck(gated(2), "p1", "fix-energy", 2), "p1");
    const barredPhase = barredView.phase;
    if (barredPhase.kind !== "turn:action") throw new Error("expected turn:action");
    expect(barredPhase.attacks.length).toBe(2);
    expect(barredPhase.attacks.every((a) => !a.playable)).toBe(true);
    // The non-vacuous control: the cost was payable all along, so the ONLY reason
    // both rows are dead is the gate — and one more prefixed body revives index 0.
    const openView = redactGame(attachFromDeck(gated(3), "p1", "fix-energy", 2), "p1");
    const openPhase = openView.phase;
    if (openPhase.kind !== "turn:action") throw new Error("expected turn:action");
    expect(openPhase.attacks[0]?.playable).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. SEASONED SKILL — zero engine code, and the assumption that makes it true.
// ─────────────────────────────────────────────────────────────────────────────

describe("D242 — Seasoned Skill, the six printings that cost nothing", () => {
  it("takes one {C} off Blood Moon per Prize the opponent has taken", () => {
    let state = setActiveFromDeck(board(), "p1", "fix-seasoned");
    expect(selfAttackCostDiscount(state, activeOf(state, "p1"))).toBe(0);
    state = opponentTook(state, "p2", 2);
    expect(selfAttackCostDiscount(state, activeOf(state, "p1"))).toBe(2);
    expect(effectiveAttackCost(state, activeOf(state, "p1"), ["Colorless", "Colorless", "Colorless"])).toEqual([
      "Colorless",
    ]);
  });

  it("🛑 FLAGGED ASSUMPTION, PINNED: the UNSCOPED field reaches the SECOND attack too", () => {
    // The printed sentence NAMES one attack ("**Blood Moon** used by this
    // Pokémon"); `attackCostDiscountPerOpponentPrize` is a property of the HOLDER
    // and discounts everything it has. The two readings coincide only while the
    // holder has one attack — which is true of all six legal printings (each has
    // `json_array_length(attacks_json) = 1`, and that attack is named Blood Moon;
    // remote D1, 2026-08-06).
    //
    // ⚠️ THIS CASE IS THE OTHER READING'S ALARM. `fix-seasoned` carries a SECOND
    // attack ("Rough Swing") that the printed sentence does NOT name, and the
    // engine discounts it. That is CORRECT for the field as typed and WRONG for
    // the card as printed — so the day a two-attack printing of this sentence is
    // ingested, this expectation is the thing that has to change, and the cost of
    // the assumption is already written down beside it. Scoping the field today
    // would add an `attack?: string` no printing in the pool can read (D135).
    let state = setActiveFromDeck(board(), "p1", "fix-seasoned");
    state = opponentTook(state, "p2", 1);
    expect(effectiveAttackCost(state, activeOf(state, "p1"), ["Colorless", "Colorless"])).toEqual([
      "Colorless",
    ]);
  });

  it("is §9-suppressible and BENCH-INERT, like every other printed-Ability passive", () => {
    // Same channel as Power Saver, so the same two structural facts hold. A
    // BENCHED holder's passive never reaches the Active's cost seam.
    let state = clearBench(board(), "p1");
    state = benchFromDeck(state, "p1", "fix-seasoned");
    state = opponentTook(state, "p2", 3);
    expect(selfAttackCostDiscount(state, activeOf(state, "p1"))).toBe(0);
    // …and the benched body DOES still carry it, which is the finding rather than
    // an aside: `selfAttackCostDiscount` scans both seats' Active AND Bench,
    // because the printed sentence has no Active clause on either end. What makes
    // it inert is that a benched Pokémon never declares an attack, not the scan.
    const benched = state.players.p1.bench[0];
    if (benched === undefined) throw new Error("no benched body");
    expect(selfAttackCostDiscount(state, benched)).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. THE TWO PROGRAMS DO NOT REACH EACH OTHER.
// ─────────────────────────────────────────────────────────────────────────────

describe("D242 — the two rows are disjoint mechanisms on one seam", () => {
  it("the gate does not discount, and the discount does not gate", () => {
    const gate = gated(0);
    expect(selfAttackCostDiscount(gate, activeOf(gate, "p1"))).toBe(0);
    const discount = setActiveFromDeck(board(), "p1", "fix-seasoned");
    expect(attackBarredByAbility(discount, "p1", activeOf(discount, "p1"))).toBeUndefined();
  });

  it("a gated body's Energy is untouched by the refusal", () => {
    // The §8 gate rejects before anything is spent, which is what makes
    // ATTACK_PREVENTED the right code — checked on the board rather than asserted.
    const state = attachBenchFromDeck(
      benchFromDeck(gated(0), "p1", "fix-tr-body"),
      "p1",
      0,
      "fix-energy",
      1,
    );
    const result = applyAction(state, { type: "attack", seat: "p1", index: 0 });
    expect(result.ok).toBe(false);
    expect(state.players.p1.bench[0]?.energy.length).toBe(1);
  });
});
