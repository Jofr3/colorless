import { describe, expect, it } from "vitest";
import { benchShieldedFromDamage, benchShieldedFromEffects } from "./continuous";
import { programFor } from "./index";
import type { GameEvent, GameState, PokemonRef } from "./index";
import {
  FIXTURE_POOL,
  FLOWER_CURTAIN_DECK,
  attachFromDeck,
  benchFromDeck,
  clearBench,
  deepFreeze,
  driveSetup,
  mustApply,
  setActiveFromDeck,
} from "./testFixtures";

// 0.171.0 → 0.172.0 — Shaymin `sv10-010`/`-185` "Flower Curtain" (P3-M5 long tail,
// D256, backlog row 15-A):
// "Prevent all damage done to your Benched Pokémon that don't have a Rule Box by
//  attacks from your opponent's Pokémon. (Pokémon ex, Pokémon V, etc. have Rule
//  Boxes.)"
//
// ✅ THE CENSUS, RE-RUN AT THIS COMMIT rather than transcribed from the handoff.
// Remote D1 `luminous` (735f0fb5-cdc3-494d-8b97-74a8ade0124a), `abilities_json`,
// `legal_standard = 1`, GROUPED BY SENTENCE, `LIKE '%prevent all damage%'`:
//
//   5  …by your opponent's Pokémon that have an Ability.          BUILT D251
//   3  …from your opponent's Tera Pokémon…                        UNBUILDABLE
//   3  …by attacks from your opponent's Pokémon ex.               BUILT D255
//   3  As long as this Pokémon is on your Bench, …                BUILT D253
//   2  …that have any Special Energy attached.                    BUILT D252
//   2  …to your Benched Pokémon that don't have a Rule Box…       ◀ THIS SLICE
//   2  …by attacks from your opponent's Basic Pokémon ex.         BUILT D255
//   1  …done to your Benched Pokémon.                             BUILT D254
//   1  …if that damage is 200 or more.                            row 15-B
//
// **22 printings on 9 sentences, UNCHANGED from D255**, and this row is the 2 — the
// narrow `%benched pok%rule box%` query returns the same 2 ids, so the row's
// POPULATION is confirmed and not just its phrase (D255's lesson: a phrase census
// that does not name its column is a census of the phrase). The 376-unit
// `programFor` join returns **142 at the parent commit and 144 here**; neither
// figure is an increment. After this slice the residue is **4 printings on 2
// sentences**, three of them the permanently unbuildable TERA group and the last
// being row 15-B (Drednaw `sv07-044`) alone.
//
// ✅ THE SHAPE CALL WAS WRITTEN DOWN BEFORE THE BUILD AND IT HELD, WHICH IS THE
// FIRST TIME IN THIS FAMILY THE FOLD/SCAN QUESTION HAS BEEN ANSWERED IN ADVANCE.
// D253's line: a gate naming the HOLDER folds into `passivesOf`, a gate naming the
// ATTACKER pays a predicate call per site, and a rule about a body that is NEITHER
// cannot ride the fold at all. The protected body here is "your Benched Pokémon
// that don't have a Rule Box" and the holder is Shaymin, so this is D254's side of
// the line — and `benchShieldedFromDamage` has been the SOLE FUNNEL at all four
// damage arms since D159. **ZERO new read-site disjuncts, ZERO signature changes,
// ZERO new predicates.** The whole cost is one boolean field, one conjunct pair
// inside one loop, and one hoisted `hasRuleBox` call.
//
// 🛑 THE THREE FIELDS ON THIS ONE SCAN NOW FORM A 3-VECTOR ON WHICH NO TWO AGREE,
// WHICH IS WHY THIS IS A THIRD FIELD AND NOT A RIDER:
//
//   field                            SOURCE       HALF             TARGET
//   preventBenchDamageWhileActive    own Active   damage           your Bench
//   preventBenchDamageAndEffects     (none)       damage+effects   your Bench
//   preventBenchDamageNoRuleBox      (none)       damage           your Bench ∧ no RB
//
// It takes Rabsca's absent source clause and Thundurus's damage-only half and adds
// the first TARGET conjunct anyone in this family has printed. Both merge
// directions are driven below on boards this pool can actually build.
//
// 🛑 AND THE PRINTED PARENTHETICAL IS REMINDER TEXT THAT WOULD HAVE BUILT THE WRONG
// PREDICATE IF READ AS A RULE. "(Pokémon ex, Pokémon V, etc. have Rule Boxes.)"
// names exactly the pair `isExOrV` matches — and `cards.ts hasRuleBox` is WIDER
// (VMAX/VSTAR/GX and the "Radiant " name prefix), which is what the "etc." is
// admitting. D255's one-character trap, arriving from the opposite direction: there
// the risk was reading `isExOrV` where the print said ex alone; here it is reading
// the bracket where the print says "Rule Box". Asserted below on a VMAX.
//
// 🛑 THE FOUR READ SITES AND THEIR LIVE/DEAD SPLIT, ASSERTED RATHER THAN ASSUMED —
// D254's 2-live/2-dead split inherited verbatim, and for the same clause:
//   • attack.ts main hit          — DEAD (defender is the ACTIVE, §8)
//   • interpreter.ts spread       — LIVE  (maps `side.bench`)
//   • interpreter.ts placeSnipe   — LIVE  (maps `side.bench`), the ONE site where
//                                          `scope` is observable
//   • interpreter.ts snipeActive  — DEAD (`target.active`)
// `attackEffectRefused` is not a read site for this field AT ALL: the sentence has
// no effects half, so `benchShieldedFromEffects` must answer FALSE for it on a
// board where the damage half answers TRUE. That pair is the discriminator and is
// driven below.
//
// ⚠️ FIXTURE DIVERGENCE: `fix-flowercurtain` is 220 HP where Shaymin is 70, for
// `fix-spherical`'s reason verbatim — every arm must be drivable twice without a KO
// ending the match mid-suite, and nothing this aura reads consults the holder's HP.
// It is a Basic, as Shaymin is, and it has NO Rule Box, which is load-bearing: the
// self-shield board exists only because the holder is inside its own target set.

const bite = { type: "attack", seat: "p1", index: 0 } as const; // {C}, 30 — the ACTIVE hit
const spread = { type: "attack", seat: "p1", index: 1 } as const; // 20 to each Benched
const yawn = { type: "attack", seat: "p1", index: 4 } as const; // Asleep — an effect op
const joust = { type: "attack", seat: "p1", index: 0 } as const; // Klefki — {C}, 10

const PEBBLE_TOSS = 2; // 40 to 1 of your opponent's Pokémon
const FEINT_ATTACK = 3; // 50 to 1, `ignoreWR` — the scope-observable arm

const SENTENCE =
  "Prevent all damage done to your Benched Pokémon that don't have a Rule Box by attacks from your opponent's Pokémon. (Pokémon ex, Pokémon V, etc. have Rule Boxes.)";

function types(events: GameEvent[]): string[] {
  return events.map((e) => e.type);
}

function idOf(state: GameState, uid: string | undefined): string | undefined {
  return uid === undefined ? undefined : state.cardIdByUid[uid];
}

function cardIdAt(state: GameState, p: { stack: string[] }): string | undefined {
  return idOf(state, p.stack.at(-1));
}

/** Find a P2 body on the BENCH by card id. Setup auto-benches the dominant
    `fix-bigbody`, so nothing here may assume `bench[0]` (D252's helper, re-keyed
    for the fourth time). */
function onBench(state: GameState, cardId: string) {
  return state.players.p2.bench.find((p) => cardIdAt(state, p) === cardId);
}

/** THE CASE BOARD, AND THE ONE NEITHER EARLIER FIELD CAN BUILD: the holder standing
    on P2's BENCH between a benched teammate WITHOUT a Rule Box (`fix-titan`) and one
    WITH one (`fix-exbasic`, printed "Fixbase ex"), with a plain body Active.

    🛑 THE WHOLE SLICE IS THE DIFFERENCE BETWEEN THOSE TWO BENCH SQUARES. Both are
    "your Benched Pokémon"; both are hit by the same attack from the same attacker
    under the same holder; and the printed conjunct separates them. A build that
    reused `preventBenchDamageAndEffects` would shield BOTH and pass every other
    board in this file.

    `clearBench` first so the Bench is exactly these three — the spread arm below
    counts `DAMAGE_DEALT` events per body, and an auto-benched extra would make the
    count board-dependent rather than stated. */
function holderBenched(attackerId = "fix-shellcracker"): GameState {
  let state = driveSetup(1, { p1: FLOWER_CURTAIN_DECK, p2: FLOWER_CURTAIN_DECK }, { first: "p2" });
  state = setActiveFromDeck(state, "p2", "fix-bigbody");
  state = clearBench(state, "p2");
  state = benchFromDeck(state, "p2", "fix-flowercurtain");
  state = benchFromDeck(state, "p2", "fix-titan");
  state = benchFromDeck(state, "p2", "fix-exbasic");
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", attackerId);
  return attachFromDeck(state, "p1", "fix-energy", 1);
}

/** THE SECOND CASE BOARD: the holder in P2's ACTIVE spot, shielding a Bench it is
    not standing on. Shaymin prints no source clause, so this must answer exactly as
    `holderBenched` does for the two teammates — a build that moved the source clause
    to "Bench" instead of leaving it absent would pass the board above and fail here. */
function holderActive(): GameState {
  let state = driveSetup(1, { p1: FLOWER_CURTAIN_DECK, p2: FLOWER_CURTAIN_DECK }, { first: "p2" });
  state = setActiveFromDeck(state, "p2", "fix-flowercurtain");
  state = clearBench(state, "p2");
  state = benchFromDeck(state, "p2", "fix-titan");
  state = benchFromDeck(state, "p2", "fix-exbasic");
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", "fix-shellcracker");
  return attachFromDeck(state, "p1", "fix-energy", 1);
}

/** THE LEAK BOARD: Thundurus Active over the SAME two benched bodies, and NO Shaymin
    anywhere. Its sentence prints no Rule-Box conjunct, so it must shield the benched
    ex too. This is the board that catches a build which hoisted the new conjunct out
    of its own disjunct and into the shared path. */
function thundurusActive(): GameState {
  let state = driveSetup(1, { p1: FLOWER_CURTAIN_DECK, p2: FLOWER_CURTAIN_DECK }, { first: "p2" });
  state = setActiveFromDeck(state, "p2", "sv03-070");
  state = clearBench(state, "p2");
  state = benchFromDeck(state, "p2", "fix-titan");
  state = benchFromDeck(state, "p2", "fix-exbasic");
  state = mustApply(state, { type: "endTurn", seat: "p2" }).state;
  state = setActiveFromDeck(state, "p1", "fix-shellcracker");
  return attachFromDeck(state, "p1", "fix-energy", 1);
}

/** Declare a chosen-target attack and resolve the prompt onto the P2 body whose card
    id is `cardId` (or onto the Active). An `opponentAny` snipe with more than one
    candidate PARKS in `effect:choose` — the two-step is the shape, not an accident
    of this board (D251's helper, reused for the sixth slice running). */
function snipeAt(state: GameState, index: number, spot: "active" | string) {
  const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index });
  if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
  const prompt = parked.phase.prompt;
  if (prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");
  const wanted =
    spot === "active"
      ? prompt.candidates.find((c) => c.spot.spot === "active")
      : prompt.candidates.find((c) => {
          if (c.spot.spot !== "bench") return false;
          const body = parked.players.p2.bench[c.spot.index];
          return body !== undefined && cardIdAt(parked, body) === spot;
        });
  if (wanted === undefined) throw new Error(`no ${spot} candidate`);
  return mustApply(parked, {
    type: "resolveEffect",
    seat: "p1",
    choice: { kind: "pokemonMulti", refs: [wanted as PokemonRef] },
  });
}

describe("Flower Curtain — the registry data row", () => {
  it("authors BOTH printings as a bare preventBenchDamageNoRuleBox passive", () => {
    for (const id of ["sv10-010", "sv10-185"]) {
      expect(programFor(id)?.passive, id).toEqual({ preventBenchDamageNoRuleBox: true });
    }
  });

  // ⚠️ ONE OBJECT SHARED BY BOTH IDS, which is the claim the count is actually
  // making: two printings of ONE card. A second object would leave `BUILT.ability`
  // at the same number while quietly making a reprint into a separate program.
  it("is ONE program object shared by the two ids", () => {
    expect(programFor("sv10-185")).toBe(programFor("sv10-010"));
  });

  // A claim about `BUILT.attack`, not a detail: Shaymin's printed attack belongs to
  // the seven text readers, and authoring a row here would move a column this slice
  // reports as UNCHANGED for the eleventh time running.
  it("authors NO attack program on either printing", () => {
    for (const id of ["sv10-010", "sv10-185"]) {
      expect(programFor(id)?.attack, id).toBeUndefined();
    }
  });

  // 🛑 THE MERGE THIS FIELD REFUSES, ASSERTED IN ALL THREE DIRECTIONS. Folding it
  // into Rabsca's field would hand Shaymin a bench-wide status immunity it does not
  // print; folding it into Thundurus's would hand it an Active-only source; and
  // folding either INTO it would strip their Bench protection off every Pokémon ex.
  it("is a THIRD field, disjoint from both fields already on this scan", () => {
    const shaymin = programFor("sv10-010")?.passive;
    expect(shaymin?.preventBenchDamageAndEffects).toBeUndefined();
    expect(shaymin?.preventBenchDamageWhileActive).toBeUndefined();
    expect(programFor("sv03-070")?.passive?.preventBenchDamageNoRuleBox).toBeUndefined();
    expect(programFor("sv05-024")?.passive?.preventBenchDamageNoRuleBox).toBeUndefined();
  });

  // ⚠️ AND IT IS NOT D253's HOLDER-ZONE FIELD EITHER, the same near-miss D254
  // recorded: `preventDamageAndEffectsWhileBenched` is a HOLDER rule `passivesOf`
  // folds, this is a TARGET rule only a scan can reach.
  it("does not touch D253's holder-zone field, and D253's does not touch this one", () => {
    expect(programFor("sv10-010")?.passive?.preventDamageAndEffectsWhileBenched).toBeUndefined();
    for (const id of ["sv06-020", "sv06-171", "sv10-048"]) {
      expect(programFor(id)?.passive?.preventBenchDamageNoRuleBox, id).toBeUndefined();
    }
  });

  it("authors nothing on the sibling prevention rows", () => {
    for (const id of ["sv02-097", "sv01-099", "sv07-038", "sv06.5-060", "sv08.5-040"]) {
      expect(programFor(id)?.passive?.preventBenchDamageNoRuleBox, id).toBeUndefined();
    }
  });

  // D145's move: discover the fixture demonstrator from the registry rather than
  // naming it, so a second fixture added without a case fails HERE.
  it("has exactly ONE fixture demonstrator in the pool", () => {
    const holders = Object.keys(FIXTURE_POOL).filter(
      (id) => programFor(id)?.passive?.preventBenchDamageNoRuleBox === true,
    );
    expect(holders).toEqual(["fix-flowercurtain"]);
    expect(programFor("fix-flowercurtain")).toBe(programFor("sv10-010"));
  });
});

describe("benchShieldedFromDamage — the TARGET conjunct, which is the whole slice", () => {
  // 🛑 THE DISCRIMINATOR. One board, one holder, two benched bodies, two answers,
  // and the ONLY thing separating them is `hasRuleBox` on the body being protected.
  it("shields a benched body with NO Rule Box and REFUSES one with a Rule Box", () => {
    const state = holderBenched();
    const titan = onBench(state, "fix-titan");
    const ex = onBench(state, "fix-exbasic");
    if (titan === undefined || ex === undefined) throw new Error("board");
    expect(benchShieldedFromDamage(state, titan, "all")).toBe(true);
    expect(benchShieldedFromDamage(state, ex, "all")).toBe(false);
  });

  // The SELF-INCLUSIVE read, and it exists only because Shaymin has no Rule Box:
  // the holder is inside its own target set exactly when the conjunct admits it.
  it("a BENCHED holder shields ITSELF — it has no Rule Box either", () => {
    const state = holderBenched();
    const holder = onBench(state, "fix-flowercurtain");
    if (holder === undefined) throw new Error("board");
    expect(benchShieldedFromDamage(state, holder, "all")).toBe(true);
  });

  it("an ACTIVE holder shields the same Bench — no source clause is printed", () => {
    const state = holderActive();
    const titan = onBench(state, "fix-titan");
    const ex = onBench(state, "fix-exbasic");
    if (titan === undefined || ex === undefined) throw new Error("board");
    expect(benchShieldedFromDamage(state, titan, "all")).toBe(true);
    expect(benchShieldedFromDamage(state, ex, "all")).toBe(false);
  });

  // The TARGET clause all three sentences share: "your BENCHED Pokémon". An Active
  // body is out whichever field is granting, and a Rule Box cannot change that.
  it("TARGET clause: an ACTIVE body is never shielded, Rule Box or not", () => {
    const state = holderActive();
    const active = state.players.p2.active;
    if (active === null) throw new Error("board");
    expect(benchShieldedFromDamage(state, active, "all")).toBe(false);
  });

  // 🛑 THE LEAK GUARD, AND THE ONE ASSERTION THAT CANNOT BE MADE FROM SHAYMIN'S OWN
  // BOARDS. Thundurus prints NO Rule-Box conjunct, so its field must still shield a
  // benched Pokémon ex. A build that hoisted the new conjunct out of its disjunct
  // and into the shared path would be green on every Shaymin board above and would
  // silently take Thundurus's protection off half the Bench.
  it("Thundurus's field still shields a benched Pokémon ex — the conjunct did NOT leak", () => {
    const state = thundurusActive();
    const titan = onBench(state, "fix-titan");
    const ex = onBench(state, "fix-exbasic");
    if (titan === undefined || ex === undefined) throw new Error("board");
    expect(benchShieldedFromDamage(state, titan, "all")).toBe(true);
    expect(benchShieldedFromDamage(state, ex, "all")).toBe(true);
  });

  // 🛑 THE `scope` SPLIT, INHERITED RATHER THAN REBUILT. `benchShieldGranted` applies
  // Feint Attack per SOURCE for every field uniformly, which D254 wrote so that a
  // third field could not get it wrong by omission — this is the slice that collects.
  it("scope 'othersOnly' drops the holder's own contribution and keeps its teammate's", () => {
    const state = holderBenched();
    const holder = onBench(state, "fix-flowercurtain");
    const titan = onBench(state, "fix-titan");
    if (holder === undefined || titan === undefined) throw new Error("board");
    expect(benchShieldedFromDamage(state, holder, "othersOnly")).toBe(false);
    expect(benchShieldedFromDamage(state, titan, "othersOnly")).toBe(true);
  });

  // OWN-SIDE, the single line that separates this member from `opposingAttackDebuff`.
  it("is OWN-SIDE: the opponent's Bench is untouched by it", () => {
    let state = holderBenched();
    state = clearBench(state, "p1");
    state = benchFromDeck(state, "p1", "fix-titan");
    const acrossTheTable = state.players.p1.bench[0];
    if (acrossTheTable === undefined) throw new Error("board");
    expect(benchShieldedFromDamage(state, acrossTheTable, "all")).toBe(false);
  });

  it("an EMPTY Active Spot does not end the scan — a benched source still shields", () => {
    const state = holderBenched();
    const titan = onBench(state, "fix-titan");
    if (titan === undefined) throw new Error("board");
    const empty: GameState = {
      ...state,
      players: { ...state.players, p2: { ...state.players.p2, active: null } },
    };
    expect(benchShieldedFromDamage(empty, titan, "all")).toBe(true);
  });

  it("…and with no source in play at all it reads FALSE rather than throwing", () => {
    const state = thundurusActive();
    const titan = onBench(state, "fix-titan");
    if (titan === undefined) throw new Error("board");
    const empty: GameState = {
      ...state,
      players: { ...state.players, p2: { ...state.players.p2, active: null } },
    };
    expect(benchShieldedFromDamage(empty, titan, "all")).toBe(false);
  });
});

describe("the predicate is `hasRuleBox` and NOT the printed parenthetical", () => {
  // 🛑 THE BRACKET TRAP, DRIVEN. "(Pokémon ex, Pokémon V, etc. have Rule Boxes.)"
  // names exactly `isExOrV`'s pair; `hasRuleBox` is wider by VMAX/VSTAR/GX and the
  // "Radiant " name prefix, and the "etc." is the print admitting it. A benched VMAX
  // is the single board that separates the two readings — it has a Rule Box, it is
  // NOT ex-or-V, and it must NOT be shielded.
  it("a benched VMAX is REFUSED, where a literal reading of the bracket would shield it", () => {
    let state = holderBenched();
    state = benchFromDeck(state, "p2", "fix-attacker-vmax");
    const vmax = onBench(state, "fix-attacker-vmax");
    if (vmax === undefined) throw new Error("board");
    expect(benchShieldedFromDamage(state, vmax, "all")).toBe(false);
  });

  // ⚠️ AND THE FIXTURE THE ASSERTION ABOVE RESTS ON, pinned by NAME: `hasRuleBox`
  // reads the printed name, so a fixture rename would turn the board above into a
  // vacuous pass rather than a failure.
  it("the VMAX fixture really is named as one, which is what the read consults", () => {
    expect(FIXTURE_POOL["fix-attacker-vmax"]?.name?.endsWith(" VMAX")).toBe(true);
    expect(FIXTURE_POOL["fix-exbasic"]?.name?.endsWith(" ex")).toBe(true);
    expect(FIXTURE_POOL["fix-titan"]?.name?.endsWith(" ex")).toBe(false);
    expect(FIXTURE_POOL["fix-flowercurtain"]?.name?.endsWith(" ex")).toBe(false);
  });
});

describe("benchShieldedFromEffects — the half this sentence does NOT print", () => {
  // 🛑 THE OTHER DISCRIMINATOR, AND THE ONE THAT PROVES THE FIELD IS NOT RABSCA'S.
  // Two calls, one board, opposite answers: "Prevent all damage done to…" has no
  // effects half, so a widening that let this field reach the effects site would
  // hand two legal printings a bench-wide status immunity they do not print.
  it("Shaymin's field answers TRUE for damage and FALSE for effects", () => {
    const state = holderBenched();
    const titan = onBench(state, "fix-titan");
    if (titan === undefined) throw new Error("board");
    expect(benchShieldedFromDamage(state, titan, "all")).toBe(true);
    expect(benchShieldedFromEffects(state, titan)).toBe(false);
  });

  it("…and it refuses the effects half for the holder itself too", () => {
    const state = holderBenched();
    const holder = onBench(state, "fix-flowercurtain");
    if (holder === undefined) throw new Error("board");
    expect(benchShieldedFromEffects(state, holder)).toBe(false);
  });
});

describe("the LIVE read sites — the two arms that reach a Bench", () => {
  it("spread: the splash is nulled on the two plain bodies and LANDS on the ex", () => {
    const state = holderBenched();
    deepFreeze(state);
    const { state: done, events } = mustApply(state, spread);

    expect(done.players.p2.active?.damage).toBe(30);
    expect(onBench(done, "fix-titan")?.damage).toBe(0);
    expect(onBench(done, "fix-flowercurtain")?.damage).toBe(0);
    // 🛑 THE SAME ATTACK, THE SAME BENCH, THE SAME HOLDER — and 20 lands here.
    expect(onBench(done, "fix-exbasic")?.damage).toBe(20);

    // ⚠️ A PREVENTED BENCH HIT STILL EMITS `DAMAGE_DEALT`, WITH A ZERO — the arm
    // pushes the event unconditionally and `dealt` is what the prevention zeroes. So
    // the CLAIM is in the `prevented` flag and not in the event count: exactly TWO
    // of the three benched bodies carry it, which is a stronger statement than "the
    // bench took 0" because it distinguishes a prevention from a hit that computed
    // zero and from an arm that skipped the body entirely.
    const dealt = events.filter((e) => e.type === "DAMAGE_DEALT");
    expect(dealt).toHaveLength(1 + done.players.p2.bench.length);
    expect(dealt.filter((e) => e.prevented === true)).toHaveLength(2);
  });

  // ⚠️ THE SAME BOARD WITHOUT THE HOLDER, so "0" above is a prevention and not an
  // attack that never landed.
  it("…and with NO holder on the Bench the same spread lands 20 on each", () => {
    const state = thundurusActive();
    const noHolder = setActiveFromDeck(state, "p2", "fix-bigbody");
    const { state: done } = mustApply(noHolder, spread);
    expect(onBench(done, "fix-titan")?.damage).toBe(20);
    expect(onBench(done, "fix-exbasic")?.damage).toBe(20);
  });

  it("placeSnipe: a benched teammate with no Rule Box is shielded", () => {
    const state = holderBenched();
    deepFreeze(state);
    const { state: done } = snipeAt(state, PEBBLE_TOSS, "fix-titan");
    expect(onBench(done, "fix-titan")?.damage).toBe(0);
  });

  it("placeSnipe: the benched HOLDER shields itself", () => {
    const state = holderBenched();
    deepFreeze(state);
    const { state: done } = snipeAt(state, PEBBLE_TOSS, "fix-flowercurtain");
    expect(onBench(done, "fix-flowercurtain")?.damage).toBe(0);
  });

  it("placeSnipe: the benched ex takes its 40 under the same holder", () => {
    const state = holderBenched();
    deepFreeze(state);
    const { state: done } = snipeAt(state, PEBBLE_TOSS, "fix-exbasic");
    expect(onBench(done, "fix-exbasic")?.damage).toBe(40);
  });
});

describe("Feint Attack — the ONE site where `scope` is observable", () => {
  it("a sniped HOLDER loses its own shield and takes the 50", () => {
    const state = holderBenched();
    deepFreeze(state);
    const { state: done } = snipeAt(state, FEINT_ATTACK, "fix-flowercurtain");
    expect(onBench(done, "fix-flowercurtain")?.damage).toBe(50);
  });

  it("…and a sniped TEAMMATE keeps it, on the SAME board and the same attack", () => {
    const state = holderBenched();
    deepFreeze(state);
    const { state: done } = snipeAt(state, FEINT_ATTACK, "fix-titan");
    expect(onBench(done, "fix-titan")?.damage).toBe(0);
  });

  it("an ACTIVE holder's shield survives Feint Attack — the source is another body", () => {
    const state = holderActive();
    deepFreeze(state);
    const { state: done } = snipeAt(state, FEINT_ATTACK, "fix-titan");
    expect(onBench(done, "fix-titan")?.damage).toBe(0);
  });
});

describe("the DEAD read sites — guarded for totality, asserted rather than assumed", () => {
  it("attack.ts main hit: the defending ACTIVE takes its 30 with a holder benched", () => {
    const state = holderBenched();
    deepFreeze(state);
    const { state: done } = mustApply(state, bite);
    expect(done.players.p2.active?.damage).toBe(30);
  });

  it("snipeActive: a chosen ACTIVE target takes its 40 with a holder benched", () => {
    const state = holderBenched();
    deepFreeze(state);
    const { state: done } = snipeAt(state, PEBBLE_TOSS, "active");
    expect(done.players.p2.active?.damage).toBe(40);
  });

  // ⚠️ NOT A READ SITE FOR THIS FIELD AT ALL — twice over. `attackEffectRefused`
  // resolves `state.players[seat].active`, so its target clause is false here; and
  // this sentence prints no effects half, so even a benched-aimed op would not be
  // refused by it. Yawn lands.
  it("attackEffectRefused: the Active is put to Sleep, and no refusal is emitted", () => {
    const state = holderBenched();
    deepFreeze(state);
    const { state: done, events } = mustApply(state, yawn);
    expect(done.players.p2.active?.conditions.rotation).toBe("asleep");
    expect(types(events)).not.toContain("ATTACK_EFFECT_PREVENTED");
  });
});

describe("§9 — a lock silences ONE source, not the scan", () => {
  /** Klefki Active on P1 (its "Mischievous Lock" is Active-gated and reaches across
      the table), with the holder and two teammates on P2's Bench. */
  function locked(): GameState {
    // ⚠️ VIA `holderBenched`'s PARAMETER, NOT BY SWAPPING THE ACTIVE AFTERWARDS:
    // `setActiveFromDeck` fields a fresh body, so a post-hoc swap would strand the
    // Energy on the body it replaced and the lock board would be undrivable
    // (D253's `ATTACK_COST_UNMET`, met again here and fixed at the source).
    return holderBenched("sv01-096");
  }

  it("a locked holder shields nothing, and unlocking it restores the shield", () => {
    const state = locked();
    const titan = onBench(state, "fix-titan");
    if (titan === undefined) throw new Error("board");
    expect(benchShieldedFromDamage(state, titan, "all")).toBe(false);

    const unlocked = setActiveFromDeck(state, "p1", "fix-shellcracker");
    const stillTitan = onBench(unlocked, "fix-titan");
    if (stillTitan === undefined) throw new Error("board");
    expect(benchShieldedFromDamage(unlocked, stillTitan, "all")).toBe(true);
  });

  // ⚠️ KLEFKI CARRIES ONE ATTACK AND NO SNIPE, so the lock cannot be driven at a
  // BENCH arm from the seat doing the locking. Its own hit lands on the Active
  // instead, which is enough: it proves the lock board is a real board an attack can
  // be declared on, and the shield's absence is asserted at the unit level above.
  it("…and the lock board is drivable: Klefki's own hit lands on the Active", () => {
    const state = locked();
    deepFreeze(state);
    const { state: hit } = mustApply(state, joust);
    expect(hit.players.p2.active?.damage).toBe(10);
  });

  // 🛑 THE PER-SOURCE §9 GATE. Thundurus in the Active Spot is a SECOND source with
  // a DIFFERENT field, and Klefki names Basic Pokémon — `fix-flowercurtain` is a
  // Basic and so is Thundurus, so this board asserts the SHAPE of the read (a lock
  // reaches every source it names) rather than a divergence in what is silenced.
  it("the gate is per SOURCE: it is read once per holder, not once per scan", () => {
    let state = locked();
    state = setActiveFromDeck(state, "p2", "sv03-070");
    const titan = onBench(state, "fix-titan");
    if (titan === undefined) throw new Error("board");
    expect(benchShieldedFromDamage(state, titan, "all")).toBe(false);

    const unlocked = setActiveFromDeck(state, "p1", "fix-shellcracker");
    const stillTitan = onBench(unlocked, "fix-titan");
    if (stillTitan === undefined) throw new Error("board");
    expect(benchShieldedFromDamage(unlocked, stillTitan, "all")).toBe(true);
  });
});

describe("the fixture pool and the deck", () => {
  it("the holder prints the sentence verbatim, parenthetical included, with NO attacks", () => {
    const holder = FIXTURE_POOL["fix-flowercurtain"];
    expect(holder?.abilities?.[0]?.effect).toBe(SENTENCE);
    // `fix-spherical`/`fix-safeguardex`'s trick, third slice running: nothing here
    // reads the holder's attacks, so printing Shaymin's real one would put a new
    // sentence in front of `clauseApostrophe.test.ts`'s sweep for no coverage.
    expect(holder?.attacks ?? []).toHaveLength(0);
  });

  it("the deck is exactly 60", () => {
    expect(FLOWER_CURTAIN_DECK).toHaveLength(60);
  });

  // ⚠️ THE ATTACKER IS REUSED VERBATIM FOR THE FOURTH SLICE RUNNING (D252 → D253 →
  // D254 → here), and this pins the two indices this suite reads by NAME rather than
  // by position, so an append to `fix-shellcracker` cannot silently re-point them.
  it("the attacker's snipe indices are the ones this suite names", () => {
    const attacks = FIXTURE_POOL["fix-shellcracker"]?.attacks ?? [];
    expect(attacks[PEBBLE_TOSS]?.name).toBe("Pebble Toss");
    expect(attacks[FEINT_ATTACK]?.name).toBe("Feint Attack");
  });
});
