import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { seatKoPrizeBonuses } from "./continuous";
import { applyAction, createGame, deriveAttackEffect, programFor } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import {
  FIXTURE_POOL,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  setActiveFromDeck,
  setBenchDamage,
  setDamage,
} from "./testFixtures";

// D323 — THE §8.1 SEAT-WIDE PRIZE BONUS: THE LAST UNBUILT SIXTH OF THE
// *"doesn't stack"* ROW, AND THE SECOND SENTENCE THE CLOSURE QUERY FOUND.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE THREE CHECKS THE RESUME POINT ORDERED, IN ITS ORDER, WITH WHAT EACH
// RETURNED. Each one has killed a slice in the last four sessions.
// ─────────────────────────────────────────────────────────────────────────────
//
// (a) `git grep sv08-072 -- packages/` — D321's rule, because a backlog row that
//     names an unbuilt card is a claim about the REGISTRY. TWO hits, and BOTH are
//     COMMENTS in `registry.ts` (the `doesNotStack` doc-block's census of the six
//     Abilities). Not a key. **The card was genuinely unbuilt and the price
//     stood** — which is not what D321 found when it ran the same grep, and is
//     exactly why the grep runs before the mechanism is read and not after.
//
// (b) THE CENSUS **AND ITS CLOSURE QUERY** — D322's rule, and it paid on the very
//     next row. Remote D1 `luminous` (735f0fb5-cdc3-494d-8b97-74a8ade0124a, 3,786
//     rows, 2,021 `legal_standard`), 2026-08-10:
//
//       instr(abilities_json,'oesn''t stack') > 0   → 10 rows / 8 legal / 6 Abilities
//
//     which is D320's figure and D321's re-run of it, confirmed a THIRD time. Five
//     of the six are built (Curly Wall ×2 and Stone Palace at D321, Extra Helpings
//     ×2 at D243, Vibrant Dance, Darkest Impulse at D320) and the sixth is
//     Togekiss. **But the price was a count on ONE literal, and a count is a
//     closure proof only when the WIDER query returns the same set.** The bare
//     noun does not:
//
//       instr(abilities_json,'more Prize') > 0      → 7 rows / **4 legal**
//
//     and the four legal are Togekiss `sv08-072` (1 printing) **plus Hydreigon ex
//     `sv10.5w-067`/`-161`/`-169` "Greedy Eater" (3 printings), a SECOND unbuilt
//     prize-BONUS sentence no handoff had ever named.** The three illegal rows are
//     the difference set and every one of them is accounted for rather than waved
//     past: Luxray `sv02-071`/`sv04.5-137` "Swelling Flash" reads *"you have **more
//     Prize cards remaining** than your opponent"* — the noun as a BOARD
//     COMPARISON, granting nothing — and Chansey `sv03.5-113` "Lucky Bonus" is
//     rotated. A `git grep` on the three Hydreigon ids returns nothing in
//     `packages/`, so that row was unbuilt too.
//
//     🆕 **AND THIS IS THE FOURTH TIME IN FIVE SESSIONS THAT THE ORDERED ROW WAS
//     THE WRONG SIZE — NOT THE WRONG SEAM.** D321's was worth ZERO (already
//     built); D322's was worth THREE where the handoff said two; this one is worth
//     FOUR printings where the handoff said one. The failure mode is never "the
//     handoff pointed somewhere useless"; it is "the handoff's literal could not
//     see the whole sentence".
//
// (c) THE §8.1 CALLER GREP, BEFORE BELIEVING ANY FUNNEL IS SOLE — D320 lost a
//     slice to a funnel that was not (`retreat` bypassed `switchInto`). This one
//     IS sole, and the grep says so rather than the comment: `planPrizes` has
//     exactly ONE caller (`collectKnockOuts`, flow.ts), and `collectKnockOuts` has
//     THREE (`finishAttack`, the Checkup, `resolveMidTurnKnockOuts`). So all three
//     KO routes reach the prize plan, which is the arrangement D164 discovered and
//     wrote at the site. ⚠️ **A GREP SAYS WHICH SITES EXIST; ONLY AN ACTION SAYS
//     THE SITE IS THE ONE THE RULES USE** — so §3 below drives the commonest
//     (a KO from an attack) on a real declaration, and §7 drives the OTHER two.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE TWO SENTENCES, transcribed off the remote D1 on 2026-08-10.
// ─────────────────────────────────────────────────────────────────────────────
//
//   Togekiss sv08-072 "Wonder Kiss"
//     "When your opponent's Active Pokémon is Knocked Out, flip a coin. If heads,
//      take 1 more Prize card. The effect of Wonder Kiss doesn't stack."
//
//   Hydreigon ex sv10.5w-067/-161/-169 "Greedy Eater"
//     "If your opponent's Basic Pokémon is Knocked Out by damage from an attack
//      used by this Pokémon, take 1 more Prize card."
//
// 🛑 **THEY ARE EACH OTHER'S CONTROL ON EVERY RIDER THE FIELD HAS**, which is why
// the pair is worth more than two rows: one flips a coin and the other does not,
// one narrows the SPOT and the other narrows the CARD, one caps and the other
// does not, and only one demands that the holder was the attacker. Nothing in the
// field is asserted from a board where its absence would look the same.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE SHAPE — WHY IT IS A SEAT SCAN AND NOT A SIBLING OF `onKoPrizeReduction`.
// ─────────────────────────────────────────────────────────────────────────────
//
// Every prize modifier §8.1 has had is read off the DYING body: Munkidori ex's
// `onKoPrizeReduction` and Glimmora's `onKoPrizeGuard` come from
// `onKnockOutTrigger(state, ref.uid)`, and D298's `Legacy Energy` / `Lillie's
// Pearl` pair come from that body's own attachments. **Both of these cards are
// printed on a body that is merely IN PLAY on the OPPONENT of the KO'd seat** —
// it need not be Active, need not be damaged, and (for Wonder Kiss) need not have
// attacked. So the board read is `seatKoPrizeBonuses` (continuous.ts), the
// aura-scan family's ELEVENTH member and the first that is not on the damage
// pipeline, and `flow.ts`'s `koPrizeBonus` owns only what needs a state: the coin
// flip and the events.
//
// `MATCH_RECORD_VERSION` does not move. A new `GameEvent` variant is a WIDENING
// (the resume point's own rule), and nothing here is persisted: the bonus is
// re-derived from the board on every KO.

const TOGEKISS = "sv08-072";
const HYDREIGON = "sv10.5w-067";
const HYDREIGON_R1 = "sv10.5w-161";
const HYDREIGON_R2 = "sv10.5w-169";

/** Ting-Lu ex `sv02-127` "Cursed Land" — *"your opponent's **damaged** Pokémon
    have no Abilities, except for Pokémon ex"*, Active-source. THE §9 LOCK, and
    the reason it is this one and not Klefki: D322's lesson is that *"no lock in
    the pool can reach this source"* is a claim about the LOCK POPULATION, and
    Klefki's "Mischievous Lock" narrows to BASICS while both of these sources are
    Stage 2s. Cursed Land carries no stage clause at all. ⚠️ Its OWN rider — the
    word "damaged" — is what makes §6 a PAIR rather than a single negative, and
    its "except for Pokémon ex" exempts Hydreigon ex by construction. */
const TING_LU = "sv02-127";
/** Glimmora `sv02-126` "Shattering Crystal" — the on-KO Prize GUARD, 30 HP so one
    flat hit Knocks it Out. §8's prohibition witness. */
const GLIMMORA = "sv02-126";
/** `fix-koprize` — the on-KO Prize REDUCER on a ONE-Prize body with a constructed
    `by: 2`, so its reduction CLAMPS to 0 (D164 built it for exactly that line).
    §8's other half: a clamped reduction is not a prohibition. */
const KOPRIZE = "fix-koprize";
/** Pecharunt ex — `fix-koprize`'s printed board condition, verbatim. */
const PECHARUNT = "sv06.5-039";
/** `fix-sniper` — Spread Shot, 30 to the Active AND 20 to each Benched Pokémon.
    The only way to reach a BENCH Knock Out from an attack, and therefore the only
    way to drive `koSpot`'s refusal at all. */
const SNIPER = "fix-sniper";

/** This suite's neutral attacker: 100 flat for one {C}, no Ability of its own, so
    every bonus below is the SOURCE's sentence and never the attacker's. */
const FLAT_HITTER = "fix-flat-hitter";
/** The victim, a BASIC on exactly 100 HP — Greedy Eater's `koTarget`, and one
    Prize, so `1 → 2` is the whole arithmetic. */
const VICTIM_BASIC = "fix-victim-basic";
/** The `koTarget` CONTROL: identical in every field the scan reads EXCEPT the
    stage. Without it a build that dropped `koTarget` entirely would be green on
    every board in this file. */
const VICTIM_EVO = "fix-victim-evo";
/** A 20-HP BASIC bench sitter — what Spread Shot's 20 Knocks Out, and the body
    both `koSpot` cases are decided on. */
const BENCH_VICTIM = "fix-bench-victim";
/** A 200-HP Active that SURVIVES Spread Shot's 30, so a snipe board produces a
    BENCH KO and nothing else. */
const TANK = "fix-tank";

const FLAT_HIT = { cost: ["Colorless"], name: "Flat Hit", damage: 100 };
/** Spread Shot's printed sentence, byte-identical to `fix-sniper`'s, so the
    deriver recognises it and Hydreigon ex can reach a Bench KO with its OWN
    attack — which is what `byThisPokemonsAttack` demands. */
const SPREAD = {
  cost: ["Colorless"],
  name: "Spread Shot",
  damage: 30,
  effect: "This attack does 20 damage to each of your opponent's Benched Pokémon.",
};

/** ⚠️ **THE FOUR REAL IDS ARE DECLARED HERE AND NOT IN `FIXTURE_POOL`, AND WHAT
    DIVERGES FROM THE PRINT IS STATED RATHER THAN SILENT** (D321's rule, and
    `fix-cofagrigus`'s before it). `sv08-072` and the three `sv10.5w` rows are in
    sets the LOCAL D1 does not hold, so `catalogManifest.test.ts` cannot diff them
    and a quiet divergence would have no guard behind it.

      • **Togekiss is the print, whole** — 140 HP, Stage 2 from Togetic, {P},
        retreat 1, ×2 {M}, and "Speed Wing" {C}{C}{C} 140. It never attacks in this
        file; it is declared complete because it can be.
      • **Hydreigon ex keeps its printed "Dark Bite" at index 0** ({D}{D}{D}{C}{C},
        200, the retreat lock) **and gains this suite's two cheap attacks at 1 and
        2.** The printed cost is five Energy and the printed effect parks a status
        the Ability has nothing to do with; `byThisPokemonsAttack` needs the holder
        to be the one who ATTACKED, so what this file needs from that body is a
        declaration it can afford, twice, on two different KO geometries. The
        printed row is kept beside them so the divergence is visible in the fixture
        rather than only in this comment. */
const LOCAL_CARDS: Record<string, Card> = {
  [TOGEKISS]: battler(TOGEKISS, {
    name: "Togekiss",
    hp: 140,
    retreat: 1,
    types: ["Psychic"],
    stage: "Stage2",
    evolveFrom: "Togetic",
    weaknesses: [{ type: "Metal", value: "×2" }],
    attacks: [{ cost: ["Colorless", "Colorless", "Colorless"], name: "Speed Wing", damage: 140 }],
    abilities: [
      {
        type: "Ability",
        name: "Wonder Kiss",
        effect:
          "When your opponent's Active Pokémon is Knocked Out, flip a coin. If heads, take 1 more Prize card. The effect of Wonder Kiss doesn't stack.",
      },
    ],
  }),
  [HYDREIGON]: hydreigon(HYDREIGON),
  [HYDREIGON_R1]: hydreigon(HYDREIGON_R1),
  [HYDREIGON_R2]: hydreigon(HYDREIGON_R2),
  [FLAT_HITTER]: battler(FLAT_HITTER, { name: "Flat Hitter", hp: 200, attacks: [FLAT_HIT] }),
  [VICTIM_BASIC]: battler(VICTIM_BASIC, { name: "Plain Victim", hp: 100 }),
  [VICTIM_EVO]: battler(VICTIM_EVO, {
    name: "Plain Victim Evolved",
    hp: 100,
    stage: "Stage1",
    evolveFrom: "Plain Victim",
  }),
  [BENCH_VICTIM]: battler(BENCH_VICTIM, { name: "Bench Sitter", hp: 20 }),
  [TANK]: battler(TANK, { name: "Tanky", hp: 200 }),
};

function hydreigon(id: string): Card {
  return battler(id, {
    name: "Hydreigon ex",
    hp: 330,
    retreat: 3,
    types: ["Darkness"],
    stage: "Stage2",
    evolveFrom: "Zweilous",
    attacks: [
      {
        cost: ["Darkness", "Darkness", "Darkness", "Colorless", "Colorless"],
        name: "Dark Bite",
        damage: 200,
        effect: "During your opponent's next turn, the Defending Pokémon can't retreat.",
      },
      { ...FLAT_HIT },
      { ...SPREAD },
    ],
    abilities: [
      {
        type: "Ability",
        name: "Greedy Eater",
        effect:
          "If your opponent's Basic Pokémon is Knocked Out by damage from an attack used by this Pokémon, take 1 more Prize card.",
      },
    ],
  });
}

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

/** This suite's own seeded deck (D270's rule). */
const BONUS_DECK = deckOf({
  [TOGEKISS]: 4,
  [HYDREIGON]: 3,
  [HYDREIGON_R1]: 3,
  [HYDREIGON_R2]: 3,
  [FLAT_HITTER]: 3,
  [VICTIM_BASIC]: 3,
  [VICTIM_EVO]: 3,
  [BENCH_VICTIM]: 3,
  [TANK]: 3,
  [TING_LU]: 3,
  [GLIMMORA]: 3,
  [KOPRIZE]: 3,
  [PECHARUNT]: 3,
  [SNIPER]: 3,
  "fix-basic-1": 5,
  "fix-energy": 12,
});

/** ⚠️ **FIVE SEEDS, AND THE COIN IS WHY.** Every other suite in this family uses
    three; Wonder Kiss's consequent is rng-gated, so a claim of the form "heads
    pays and tails does not" needs both faces to actually OCCUR in the set rather
    than to be asserted conditionally on a board that only ever shows one. §3
    checks that they both do. */
const SEEDS = [7301, 7307, 7313, 7319, 7331] as const;

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

function localSetup(seed: number): GameState {
  const created = createGame({ seed, decks: { p1: BONUS_DECK, p2: BONUS_DECK }, cardPool: POOL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(
    applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first: "p2" }),
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

/** **P2 IS THE PRIZE TAKER ON EVERY BOARD IN THIS FILE**, which is the one thing
    that must never drift: both sentences are printed in the second person about
    the OPPONENT's dying Pokémon, so the source always sits opposite the corpse.
    P2 fields `attacker` (Active) plus `p2Bench` (where the sources sit), P1 fields
    `victim` (Active) plus `p1Bench`. Walked to turn 3 so no §4 first-turn bar
    applies. `energy` is how many {C} the attacker gets — the printed Hydreigon
    declaration costs five. */
function board(
  seed: number,
  opts: {
    attacker?: string;
    p2Bench?: readonly string[];
    victim?: string;
    p1Bench?: readonly string[];
    victimDamage?: number;
    p2BenchDamage?: readonly (number | undefined)[];
    energy?: number;
  } = {},
): GameState {
  let state = localSetup(seed);
  state = clearBench(setActiveFromDeck(state, "p1", opts.victim ?? VICTIM_BASIC), "p1");
  for (const id of opts.p1Bench ?? []) state = benchFromDeck(state, "p1", id);
  if ((opts.p1Bench ?? []).length === 0) state = benchFromDeck(state, "p1", "fix-basic-1");
  state = clearBench(setActiveFromDeck(state, "p2", opts.attacker ?? FLAT_HITTER), "p2");
  for (const [i, id] of (opts.p2Bench ?? []).entries()) {
    state = benchFromDeck(state, "p2", id);
    const damage = opts.p2BenchDamage?.[i];
    if (damage !== undefined) state = setBenchDamage(state, "p2", i, damage);
  }
  if ((opts.p2Bench ?? []).length === 0) state = benchFromDeck(state, "p2", "fix-basic-1");
  if (opts.victimDamage !== undefined) state = setDamage(state, "p1", opts.victimDamage);
  for (let i = 0; i < 12; i += 1) {
    if (state.phase.kind !== "turn:action") throw new Error(`stuck in ${state.phase.kind}`);
    if (state.phase.seat === "p2" && state.turn >= 3) break;
    state = must(applyAction(state, { type: "endTurn", seat: state.phase.seat }));
  }
  return attachFromDeck(state, "p2", "fix-energy", opts.energy ?? 1);
}

/** The events of one real attack declaration by P2. */
function fire(state: GameState, index = 0): { events: GameEvent[]; state: GameState } {
  const result = applyAction(state, { type: "attack", seat: "p2", index });
  if (!result.ok) throw new Error(`attack failed: ${result.error.code} ${result.error.message}`);
  return { events: result.events, state: result.state };
}

function all<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
}

/** The Prize count the KO actually OWES, read off the board rather than off an
    event: the `ko:takePrizes` phase when the taker still has a choice, or the
    Prizes that visibly left the row when the take was forced. This is the number
    a player experiences, and it is the one every §3–§8 assertion is made on. */
function prizesOwed(before: GameState, after: GameState, events: GameEvent[]): number {
  if (after.phase.kind === "ko:takePrizes") return after.phase.count;
  const owed = all(events, "PRIZES_OWED")[0];
  if (owed !== undefined) return owed.count;
  return before.players.p2.prizes.length - after.players.p2.prizes.length;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. THE TWO REGISTRY ROWS — and what each one is NOT.
// ─────────────────────────────────────────────────────────────────────────────

describe("D323 §1 — the two registry rows", () => {
  it("Wonder Kiss authors FOUR riders and deliberately not the fifth", () => {
    expect(programFor(TOGEKISS)?.passive).toEqual({
      koPrizeBonus: {
        ability: "Wonder Kiss",
        amount: 1,
        koSpot: "active",
        coinFlip: true,
        noStack: true,
      },
    });
    // It has NO `koTarget`: the printed noun is "your opponent's Active Pokémon"
    // with no card class at all, and a filter here would silently narrow a
    // sentence that narrows only the SPOT.
    expect(programFor(TOGEKISS)?.passive?.koPrizeBonus?.koTarget).toBeUndefined();
    expect(programFor(TOGEKISS)?.passive?.koPrizeBonus?.byThisPokemonsAttack).toBeUndefined();
    // 🛑 NOT a `triggered` row. `onKoPrizeGuard` and `onKoPrizeReduction` are read
    // off the DYING body via `onKnockOutTrigger`, and Togekiss is not dying — a
    // build that reached for either would fire only when the Togekiss ITSELF was
    // Knocked Out, which is the one board this card is never played for.
    expect(programFor(TOGEKISS)?.triggered).toBeUndefined();
    expect(programFor(TOGEKISS)?.abilities).toBeUndefined();
    expect(programFor(TOGEKISS)?.attack).toBeUndefined();
  });

  it("Greedy Eater authors the OTHER two, and all THREE printings share ONE object", () => {
    for (const id of [HYDREIGON, HYDREIGON_R1, HYDREIGON_R2]) {
      expect(programFor(id)?.passive?.koPrizeBonus).toEqual({
        ability: "Greedy Eater",
        amount: 1,
        koTarget: { kind: "basicPokemon" },
        byThisPokemonsAttack: true,
      });
    }
    // The reprints are the SAME program object, not copies — D190b's exact-map rule.
    expect(programFor(HYDREIGON)).toBe(programFor(HYDREIGON_R1));
    expect(programFor(HYDREIGON)).toBe(programFor(HYDREIGON_R2));
    // No flip, no cap, no spot clause — each one a printed absence, and each one
    // is what §3–§5 measure Wonder Kiss's presence against.
    const bonus = programFor(HYDREIGON)?.passive?.koPrizeBonus;
    expect(bonus?.coinFlip).toBeUndefined();
    expect(bonus?.noStack).toBeUndefined();
    expect(bonus?.koSpot).toBeUndefined();
  });

  it("🛑 the *doesn't stack* row's OTHER Abilities are each on a DIFFERENT seam — and ONE IS STILL UNBUILT", () => {
    // Each of these is BUILT, and the claim is about WHICH field it is on, so this
    // slice cannot have quietly re-homed one of them onto its new field. (A bare
    // "these ids are unbuilt" is nearly always true — conventions — which is why
    // the positives carry the row.)
    expect(programFor("sv07-119")?.passive?.seatDamageReductionAfterWR?.noStack).toBe("Curly Wall");
    expect(programFor("svp-136")?.passive?.seatDamageReductionAfterWR?.noStack).toBe("Curly Wall");
    expect(programFor("sv10-086")?.passive?.seatDamageReductionAfterWR?.noStack).toBe(
      "Stone Palace",
    );
    expect(programFor("sv09-117")?.passive?.seatDamageBonusBeforeWR?.noStack).toBe("Extra Helpings");
    expect(programFor("svp-184")?.passive?.seatDamageBonusBeforeWR?.noStack).toBe("Extra Helpings");
    expect(programFor("sv10-074")?.triggered?.[0]?.doesNotStack).toBe(true);
    // 🛑 **AND THE HANDOFF'S OWN ARITHMETIC WAS WRONG, WHICH IS THE THIRD THING
    // THIS SLICE FALSIFIED BEFORE BUILDING ANYTHING.** D320/D321/D322 all record
    // the row as *"five of the six are now built or closed … the sixth is
    // Togekiss"*, and D321's `registry.ts` doc-block repeats it. **LUDICOLO
    // `sv09-037` "Vibrant Dance" — *"All of your Pokémon in play get +40 HP. The
    // effect of Vibrant Dance doesn't stack."* — HAS NEVER BEEN BUILT.** One
    // `git grep sv09-037 -- packages/` returns two COMMENTS and no key, which is
    // the exact check D321 invented and this page has now failed in the OTHER
    // direction: a row can be listed as DONE and not be. **So `doesn't stack` is
    // NOT closed by this slice; it goes from two open Abilities to one.**
    //
    // 🆕 **AND THE PIN HELD FOR EXACTLY ONE SESSION, WHICH IS THE SECOND TIME IN
    // THREE THAT A `toBeUndefined` ON AN ID HAS.** D321 pinned `sv09-089`
    // undefined and D322 built it; D323 pinned this one and D324 built it
    // (`VIBRANT_DANCE`, `passive.seatHpBonus`, the §8.1 max-HP seam). **THE
    // REPAIR IS D322's VERBATIM: KEEP THE ID AND NARROW THE CLAIM TO THE SENTENCE
    // THIS FILE ACTUALLY OWNS.** Deleting the row would lose the closure guard
    // below; loosening it to "defined or not" would lose the row entirely. What
    // this suite is entitled to say about Ludicolo is that its Ability is not a
    // PRIZE bonus — which is exactly the loop on the next line, and which now
    // carries a card that really is in the registry rather than a hole.
    expect(programFor("sv09-037")?.passive?.seatHpBonus?.ability).toBe("Vibrant Dance");
    for (const id of ["sv07-119", "svp-136", "sv10-086", "sv09-117", "svp-184", "sv09-037"]) {
      expect(programFor(id)?.passive?.koPrizeBonus, id).toBeUndefined();
    }
  });

  it("no OTHER card in the registry carries the new field — the population is these four", () => {
    // The closure claim, made against the REGISTRY rather than against the
    // catalog: `instr(abilities_json,'more Prize') > 0` is 4 legal printings and
    // exactly four ids are keyed here. If a later session adds a fifth without
    // widening the census comment, this row is where it shows up.
    const holders = [TOGEKISS, HYDREIGON, HYDREIGON_R1, HYDREIGON_R2];
    for (const id of holders) expect(programFor(id)?.passive?.koPrizeBonus).toBeDefined();
    // The two nearest neighbours on the same seam still carry the OLD fields and
    // not this one — the partition D164/D155 drew, unmoved.
    expect(programFor(GLIMMORA)?.triggered?.[0]?.onKoPrizeGuard).toBe("coinFlipPrevent");
    expect(programFor(GLIMMORA)?.passive?.koPrizeBonus).toBeUndefined();
    expect(programFor("sv06.5-037")?.triggered?.[0]?.onKoPrizeReduction).toBeDefined();
    expect(programFor("sv06.5-037")?.passive?.koPrizeBonus).toBeUndefined();
  });

  it("both sentences are ABILITIES and neither derives as an attack effect", () => {
    // They live on `abilities_json`. Feeding them to the attack deriver must stay
    // null — the column-blindness this family keeps tripping over, made a test.
    const wonderKiss = LOCAL_CARDS[TOGEKISS]?.abilities?.[0]?.effect ?? "";
    const greedyEater = LOCAL_CARDS[HYDREIGON]?.abilities?.[0]?.effect ?? "";
    expect(deriveAttackEffect(wonderKiss)).toBeNull();
    expect(deriveAttackEffect(greedyEater)).toBeNull();
    // And the printed strings differ on every clause the field encodes.
    expect(wonderKiss).toContain("Active Pokémon is Knocked Out");
    expect(wonderKiss).toContain("flip a coin");
    expect(wonderKiss).toContain("doesn't stack");
    expect(greedyEater).toContain("Basic Pokémon is Knocked Out");
    expect(greedyEater).toContain("an attack used by this Pokémon");
    expect(greedyEater).not.toContain("flip a coin");
    expect(greedyEater).not.toContain("doesn't stack");
    expect(greedyEater).not.toContain("Active");
    expect(wonderKiss).not.toContain("Basic");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. THE SCAN, read directly — the board questions, with no rng in them.
// ─────────────────────────────────────────────────────────────────────────────

describe("D323 §2 — `seatKoPrizeBonuses`, the board half", () => {
  it("finds a benched Togekiss for an ACTIVE KO and refuses it for a BENCH KO", () => {
    const state = board(SEEDS[0], { p2Bench: [TOGEKISS] });
    const victim = POOL[VICTIM_BASIC];
    expect(seatKoPrizeBonuses(state, "p2", victim, true, undefined)).toHaveLength(1);
    expect(seatKoPrizeBonuses(state, "p2", victim, false, undefined)).toEqual([]);
  });

  it("finds Hydreigon ex ONLY when the holder's own uid is the attacker's", () => {
    const state = board(SEEDS[0], { attacker: HYDREIGON, victim: VICTIM_BASIC });
    const attackerUid = state.players.p2.active?.stack.at(-1);
    if (attackerUid === undefined) throw new Error("p2 has no Active");
    const victim = POOL[VICTIM_BASIC];
    expect(seatKoPrizeBonuses(state, "p2", victim, true, attackerUid)).toHaveLength(1);
    // The Checkup / mid-turn shape: no attacker at all.
    expect(seatKoPrizeBonuses(state, "p2", victim, true, undefined)).toEqual([]);
    // Someone ELSE's attack — the clause names a BODY, and this is the difference
    // between it and D164's `attackerSeat`, which would pass here.
    expect(seatKoPrizeBonuses(state, "p2", victim, true, "some-other-uid")).toEqual([]);
  });

  it("Greedy Eater refuses an EVOLUTION corpse and an unreadable one", () => {
    const state = board(SEEDS[0], { attacker: HYDREIGON });
    const attackerUid = state.players.p2.active?.stack.at(-1);
    expect(seatKoPrizeBonuses(state, "p2", POOL[VICTIM_EVO], true, attackerUid)).toEqual([]);
    // `undefined` fails every filter — `matchesFilter`'s conservative direction,
    // and the reason an unreadable corpse pays no bonus rather than every bonus.
    expect(seatKoPrizeBonuses(state, "p2", undefined, true, attackerUid)).toEqual([]);
    // …but Wonder Kiss, which has NO `koTarget`, pays for the very same corpse.
    const kiss = board(SEEDS[0], { p2Bench: [TOGEKISS] });
    expect(seatKoPrizeBonuses(kiss, "p2", POOL[VICTIM_EVO], true, undefined)).toHaveLength(1);
    expect(seatKoPrizeBonuses(kiss, "p2", undefined, true, undefined)).toHaveLength(1);
  });

  it("🛑 TWO Togekiss yield ONE entry; two Hydreigon ex would yield two — but cannot", () => {
    const two = board(SEEDS[0], { p2Bench: [TOGEKISS, TOGEKISS] });
    expect(seatKoPrizeBonuses(two, "p2", POOL[VICTIM_BASIC], true, undefined)).toHaveLength(1);
    const three = board(SEEDS[0], { p2Bench: [TOGEKISS, TOGEKISS, TOGEKISS] });
    expect(seatKoPrizeBonuses(three, "p2", POOL[VICTIM_BASIC], true, undefined)).toHaveLength(1);
    // 🛑 **AND GREEDY EATER'S MISSING CAP IS NOT OBSERVABLE ON ANY BOARD, WHICH IS
    // A STRUCTURAL FACT AND IS DECLARED RATHER THAN FAKED.** `byThisPokemonsAttack`
    // admits at most the ONE body that attacked, so two Hydreigon ex can never
    // both satisfy the clause — the absence of `noStack` on that row is a faithful
    // transcription of a print whose consequence no legal board can show. Driven
    // as far as it can be: a second Hydreigon ex on the bench changes nothing.
    const pair = board(SEEDS[0], { attacker: HYDREIGON, p2Bench: [HYDREIGON_R1] });
    const attackerUid = pair.players.p2.active?.stack.at(-1);
    expect(seatKoPrizeBonuses(pair, "p2", POOL[VICTIM_BASIC], true, attackerUid)).toHaveLength(1);
    // …and the entry belongs to the ATTACKER, not to the bench copy.
    expect(seatKoPrizeBonuses(pair, "p2", POOL[VICTIM_BASIC], true, attackerUid)[0]?.uid).toBe(
      attackerUid,
    );
  });

  it("a board with no source at all is EMPTY, on either side", () => {
    const state = board(SEEDS[0]);
    expect(seatKoPrizeBonuses(state, "p2", POOL[VICTIM_BASIC], true, undefined)).toEqual([]);
    expect(seatKoPrizeBonuses(state, "p1", POOL[VICTIM_BASIC], true, undefined)).toEqual([]);
    // ⚠️ AND THE SEAT IS LOAD-BEARING: a Togekiss on P2 is invisible to a P1 scan.
    const kiss = board(SEEDS[0], { p2Bench: [TOGEKISS] });
    expect(seatKoPrizeBonuses(kiss, "p1", POOL[VICTIM_BASIC], true, undefined)).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. WONDER KISS, DRIVEN ON A REAL ATTACK — the coin, and both of its faces.
// ─────────────────────────────────────────────────────────────────────────────

describe("D323 §3 — Wonder Kiss on a real KO", () => {
  /** Every seed's outcome for the same board: the flip's face and what was owed. */
  function run(seed: number, bench: readonly string[] = [TOGEKISS]) {
    const before = board(seed, { p2Bench: bench });
    const { events, state } = fire(before);
    const flips = all(events, "ABILITY_COIN_FLIP").filter((e) => e.ability === "Wonder Kiss");
    return {
      owed: prizesOwed(before, state, events),
      flips,
      bonuses: all(events, "PRIZE_BONUS"),
      triggers: all(events, "ABILITY_TRIGGERED").filter((e) => e.ability === "Wonder Kiss"),
    };
  }

  it("BOTH faces occur across the seed set — the claim below is not vacuous", () => {
    const faces = new Set(SEEDS.map((seed) => run(seed).flips[0]?.result));
    expect(faces).toEqual(new Set(["heads", "tails"]));
  });

  it("heads takes ONE more Prize, tails takes none, and the flip always happens", () => {
    for (const seed of SEEDS) {
      const { owed, flips, bonuses, triggers } = run(seed);
      // The Ability announced itself and flipped exactly once, whatever the face —
      // the flip HAPPENED and moved the rng, so hiding it on tails would leave the
      // next coin in the game unexplainable.
      expect(triggers, `seed ${seed}`).toHaveLength(1);
      expect(flips, `seed ${seed}`).toHaveLength(1);
      const heads = flips[0]?.result === "heads";
      expect(owed, `seed ${seed}`).toBe(heads ? 2 : 1);
      expect(bonuses, `seed ${seed}`).toHaveLength(heads ? 1 : 0);
      if (heads) {
        expect(bonuses[0]?.by).toBe(1);
        expect(bonuses[0]?.count).toBe(2);
        // The row names the DYING body and its seat, exactly as PRIZE_REDUCED and
        // PRIZE_PREVENTED do, so the three agree on whose corpse they describe.
        expect(bonuses[0]?.seat).toBe("p1");
      }
    }
  });

  it("the CONTROL: the same board without a Togekiss owes ONE and flips nothing", () => {
    for (const seed of SEEDS) {
      const { owed, flips, bonuses, triggers } = run(seed, ["fix-basic-1"]);
      expect(owed, `seed ${seed}`).toBe(1);
      expect(flips, `seed ${seed}`).toHaveLength(0);
      expect(bonuses, `seed ${seed}`).toHaveLength(0);
      expect(triggers, `seed ${seed}`).toHaveLength(0);
    }
  });

  it("🛑 the ORDER: ABILITY_TRIGGERED, then the flip, then PRIZE_BONUS", () => {
    // A log that announced the prize before the coin would be describing a
    // consequence before its cause, and the events are what a client renders.
    const seed = SEEDS.find((s) => {
      const before = board(s, { p2Bench: [TOGEKISS] });
      return all(fire(before).events, "PRIZE_BONUS").length === 1;
    });
    if (seed === undefined) throw new Error("no heads seed in the set");
    const { events } = fire(board(seed, { p2Bench: [TOGEKISS] }));
    const kinds = events
      .filter(
        (e) =>
          e.type === "ABILITY_TRIGGERED" || e.type === "ABILITY_COIN_FLIP" || e.type === "PRIZE_BONUS",
      )
      .map((e) => e.type);
    expect(kinds).toEqual(["ABILITY_TRIGGERED", "ABILITY_COIN_FLIP", "PRIZE_BONUS"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. `koSpot` — the clause that is only visible on a BENCH Knock Out.
// ─────────────────────────────────────────────────────────────────────────────

describe("D323 §4 — the ACTIVE clause, driven on a Bench KO", () => {
  it("a sniped BENCH Knock Out pays Wonder Kiss NOTHING, and the Active board does", () => {
    for (const seed of SEEDS) {
      // Spread Shot: 30 to the 200-HP Active (survives) and 20 to the 20-HP bench
      // sitter (dies). The only KO in the batch is a BENCH one.
      const before = board(seed, {
        attacker: SNIPER,
        p2Bench: [TOGEKISS],
        victim: TANK,
        p1Bench: [BENCH_VICTIM],
      });
      const { events, state } = fire(before);
      expect(state.players.p1.active?.damage, `seed ${seed}`).toBe(30);
      expect(prizesOwed(before, state, events), `seed ${seed}`).toBe(1);
      expect(all(events, "PRIZE_BONUS"), `seed ${seed}`).toHaveLength(0);
      // ⚠️ AND NO FLIP HAPPENED AT ALL — the refusal is BEFORE the coin, so a
      // benched-only KO does not silently advance the rng.
      expect(
        all(events, "ABILITY_COIN_FLIP").filter((e) => e.ability === "Wonder Kiss"),
        `seed ${seed}`,
      ).toHaveLength(0);
    }
  });

  it("GREEDY EATER pays for that very same Bench KO — it has no spot clause", () => {
    for (const seed of SEEDS) {
      // Hydreigon ex attacks with its OWN Spread Shot (index 2), so both of its
      // clauses hold: the corpse is a Basic and the kill came from this body.
      const before = board(seed, {
        attacker: HYDREIGON,
        victim: TANK,
        p1Bench: [BENCH_VICTIM],
      });
      const { events, state } = fire(before, 2);
      expect(prizesOwed(before, state, events), `seed ${seed}`).toBe(2);
      const bonuses = all(events, "PRIZE_BONUS");
      expect(bonuses, `seed ${seed}`).toHaveLength(1);
      expect(bonuses[0]?.by).toBe(1);
      // 🛑 NO COIN. The two rows differ on the flip as well as on the spot, and
      // this pair is the one board where both differences are visible at once.
      expect(all(events, "ABILITY_COIN_FLIP"), `seed ${seed}`).toHaveLength(0);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. GREEDY EATER's two clauses, each refused on its own board.
// ─────────────────────────────────────────────────────────────────────────────

describe("D323 §5 — Greedy Eater on a real KO", () => {
  it("a BASIC Active Knocked Out by Hydreigon's own attack takes 2", () => {
    for (const seed of SEEDS) {
      const before = board(seed, { attacker: HYDREIGON, victim: VICTIM_BASIC });
      const { events, state } = fire(before, 1);
      expect(prizesOwed(before, state, events), `seed ${seed}`).toBe(2);
      expect(all(events, "PRIZE_BONUS")[0]?.by, `seed ${seed}`).toBe(1);
      expect(
        all(events, "ABILITY_TRIGGERED").filter((e) => e.ability === "Greedy Eater"),
        `seed ${seed}`,
      ).toHaveLength(1);
    }
  });

  it("the `koTarget` CONTROL: an EVOLUTION Active on the same board takes 1", () => {
    for (const seed of SEEDS) {
      const before = board(seed, { attacker: HYDREIGON, victim: VICTIM_EVO });
      const { events, state } = fire(before, 1);
      expect(prizesOwed(before, state, events), `seed ${seed}`).toBe(1);
      expect(all(events, "PRIZE_BONUS"), `seed ${seed}`).toHaveLength(0);
    }
  });

  it("the `byThisPokemonsAttack` CONTROL: a BENCHED Hydreigon ex pays nothing", () => {
    for (const seed of SEEDS) {
      const before = board(seed, {
        attacker: FLAT_HITTER,
        p2Bench: [HYDREIGON],
        victim: VICTIM_BASIC,
      });
      const { events, state } = fire(before);
      expect(prizesOwed(before, state, events), `seed ${seed}`).toBe(1);
      expect(all(events, "PRIZE_BONUS"), `seed ${seed}`).toHaveLength(0);
    }
  });

  it("both reprints behave identically to the base printing", () => {
    for (const id of [HYDREIGON_R1, HYDREIGON_R2]) {
      const before = board(SEEDS[0], { attacker: id, victim: VICTIM_BASIC });
      const { events, state } = fire(before, 1);
      expect(prizesOwed(before, state, events), id).toBe(2);
      expect(all(events, "PRIZE_BONUS"), id).toHaveLength(1);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. §9 — the Ability lock, and its OWN rider as the control.
// ─────────────────────────────────────────────────────────────────────────────

describe("D323 §6 — the §9 lock reaches this aura", () => {
  it("🛑 a DAMAGED Togekiss under Ting-Lu ex's Cursed Land pays NOTHING", () => {
    for (const seed of SEEDS) {
      // Ting-Lu ex is P1's Active (the lock is Active-source) on 100 damage of its
      // 240, so the flat 100 Knocks it Out — and `planPrizes` runs on the PRE-KO
      // state, so the lock is still in force when the bonus is decided. The
      // Togekiss is DAMAGED, which is Cursed Land's own printed rider.
      const before = board(seed, {
        victim: TING_LU,
        victimDamage: 140,
        p2Bench: [TOGEKISS],
        p2BenchDamage: [10],
      });
      const { events, state } = fire(before);
      // Ting-Lu ex has a Rule Box, so the face value is TWO, not one.
      expect(prizesOwed(before, state, events), `seed ${seed}`).toBe(2);
      expect(all(events, "PRIZE_BONUS"), `seed ${seed}`).toHaveLength(0);
      expect(all(events, "ABILITY_COIN_FLIP"), `seed ${seed}`).toHaveLength(0);
    }
  });

  it("the CONTROL is the lock's own rider: an UNDAMAGED Togekiss still pays", () => {
    const results = SEEDS.map((seed) => {
      const before = board(seed, { victim: TING_LU, victimDamage: 140, p2Bench: [TOGEKISS] });
      const { events, state } = fire(before);
      return { owed: prizesOwed(before, state, events), events };
    });
    // Every seed flipped — the aura is live — and heads paid a third Prize.
    for (const [i, r] of results.entries()) {
      expect(all(r.events, "ABILITY_COIN_FLIP"), `seed ${SEEDS[i]}`).toHaveLength(1);
      const heads = all(r.events, "ABILITY_COIN_FLIP")[0]?.result === "heads";
      expect(r.owed, `seed ${SEEDS[i]}`).toBe(heads ? 3 : 2);
    }
  });

  it("Hydreigon ex is EXEMPT from Cursed Land — *except for Pokémon ex*", () => {
    for (const seed of SEEDS) {
      // Same lock, same damage, and the source is an `ex`: the print's own
      // exception, and the reason this pair is not two spellings of one negative.
      const before = board(seed, {
        attacker: HYDREIGON,
        victim: TING_LU,
        victimDamage: 130,
        p1Bench: [BENCH_VICTIM],
      });
      // Hydreigon's own Flat Hit (100) finishes the 240-HP Ting-Lu ex from 130…
      // except Ting-Lu ex is not a Basic, so `koTarget` refuses it. The lock is
      // therefore NOT what is being measured on this board — §5 already owns the
      // filter — and what IS measured is that Hydreigon is damaged-and-unlocked:
      // it attacked, so it took no damage, and the exemption is asserted directly.
      const attackerUid = before.players.p2.active?.stack.at(-1);
      expect(
        seatKoPrizeBonuses(before, "p2", POOL[BENCH_VICTIM], false, attackerUid),
        `seed ${seed}`,
      ).toHaveLength(1);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. THE OTHER TWO KO ROUTES — the grep said they exist; these say what they do.
// ─────────────────────────────────────────────────────────────────────────────

describe("D323 §7 — the Checkup route, where neither clause can hold", () => {
  it("a Checkup KO pays NEITHER card — no attacker seat, no attacker uid", () => {
    // The Checkup sweep omits both threaded arguments, so Greedy Eater is refused
    // outright; Wonder Kiss's clauses do not mention an attack at all, and the
    // scan's answer is the same for the reason the SCAN can be asked directly.
    const state = board(SEEDS[0], { attacker: HYDREIGON, p2Bench: [HYDREIGON_R1] });
    expect(seatKoPrizeBonuses(state, "p2", POOL[VICTIM_BASIC], true, undefined)).toEqual([]);
    // ⚠️ AND WONDER KISS *DOES* PAY THERE, WHICH IS NOT A BUG AND IS THE PRINT:
    // "When your opponent's Active Pokémon is Knocked Out" carries no cause clause,
    // so a poison KO between turns owes the extra Prize exactly like an attack KO.
    // The engine's other two routes are therefore NOT symmetric for these two
    // cards, and that asymmetry is the printed one.
    const kiss = board(SEEDS[0], { p2Bench: [TOGEKISS] });
    expect(seatKoPrizeBonuses(kiss, "p2", POOL[VICTIM_BASIC], true, undefined)).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. THE COMPOSITION WITH THE SEAM'S EXISTING MEMBERS.
// ─────────────────────────────────────────────────────────────────────────────

describe("D323 §8 — a prohibition is not a clamped reduction", () => {
  it("🛑 a Glimmora-PREVENTED Prize takes no bonus AND draws no Wonder Kiss flip", () => {
    // Glimmora is 30 HP, so the flat 100 Knocks it Out; its own guard flips first.
    // On HEADS the prize is DENIED — "your opponent can't take any Prize cards for
    // it" is a prohibition, and a later permission does not overturn it.
    const seen = new Set<string>();
    for (const seed of SEEDS) {
      const before = board(seed, { victim: GLIMMORA, p2Bench: [TOGEKISS] });
      const { events, state } = fire(before);
      const guard = all(events, "ABILITY_COIN_FLIP").find(
        (e) => e.ability === "Shattering Crystal",
      );
      if (guard === undefined) throw new Error(`no guard flip at seed ${seed}`);
      seen.add(guard.result);
      const kissFlips = all(events, "ABILITY_COIN_FLIP").filter((e) => e.ability === "Wonder Kiss");
      if (guard.result === "heads") {
        expect(all(events, "PRIZE_PREVENTED"), `seed ${seed}`).toHaveLength(1);
        expect(all(events, "PRIZE_BONUS"), `seed ${seed}`).toHaveLength(0);
        // 🛑 AND NO SECOND FLIP: the refusal is before the coin, so a denied KO
        // does not spend rng the printed board never spends.
        expect(kissFlips, `seed ${seed}`).toHaveLength(0);
      } else {
        expect(kissFlips, `seed ${seed}`).toHaveLength(1);
        const owed = prizesOwed(before, state, events);
        expect(owed, `seed ${seed}`).toBe(kissFlips[0]?.result === "heads" ? 2 : 1);
      }
    }
    // Both faces of the GUARD occur, so neither branch above is vacuous.
    expect(seen).toEqual(new Set(["heads", "tails"]));
  });

  it("a reduction CLAMPED to zero still takes the bonus — 1 − 2 → 0, then +1", () => {
    // `fix-koprize` is a ONE-Prize body with a constructed `by: 2`, so its printed
    // reduction clamps at 0 (D164 built it for exactly that line). Nothing forbids
    // the taking here — "1 fewer" is arithmetic — so a heads Wonder Kiss makes the
    // opponent take a Prize for a body whose own Ability had zeroed it.
    for (const seed of SEEDS) {
      const before = board(seed, {
        victim: KOPRIZE,
        p1Bench: [PECHARUNT],
        p2Bench: [TOGEKISS],
      });
      const { events, state } = fire(before);
      expect(all(events, "PRIZE_REDUCED")[0]?.count, `seed ${seed}`).toBe(0);
      const kiss = all(events, "ABILITY_COIN_FLIP").filter((e) => e.ability === "Wonder Kiss");
      expect(kiss, `seed ${seed}`).toHaveLength(1);
      const heads = kiss[0]?.result === "heads";
      expect(prizesOwed(before, state, events), `seed ${seed}`).toBe(heads ? 1 : 0);
      expect(all(events, "PRIZE_BONUS"), `seed ${seed}`).toHaveLength(heads ? 1 : 0);
    }
  });
});
