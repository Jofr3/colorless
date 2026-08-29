import { describe, expect, it } from "vitest";
import {
  deriveAttackDamageBonus,
  deriveAttackDamageMultiplier,
  deriveAttackDamagePenalty,
  deriveAttackEffect,
} from "./effects";
import { applyAction, programFor, redactGame } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import { type LogContext, logFromEvents } from "./log";
import {
  FIXTURE_POOL,
  SELF_COUNTER_MULTIPLY_DECK,
  attachFromDeck,
  clearBench,
  deepFreeze,
  driveSetup,
  must,
  mustApply,
  setActiveFromDeck,
  setDamage,
} from "./testFixtures";

// 0.111.0 → 0.112.0 — the MULTIPLY TWIN (P3-M5 long tail, D167): the THIRD and
// LAST adjective on a count source the engine has read since M2.
//
//   "This attack does 30 damage for each damage counter on this Pokémon."
//              (Drifloon sv01-089 "Balloon Blast", idx 1, "30×")
//   "This attack does 50 damage for each damage counter on this Pokémon."
//             (Onix swsh10.5-036 "Raging Swing", idx 1, "50×")
//
// ⚠️ THE FAMILY SPLITS BY FOLD, NOT BY COUNT SOURCE, AND THIS PRINTING IS THE
// PROOF. `deriveAttackDamageBonus` (`more` → add to the printed base),
// `deriveAttackDamageMultiplier` (no adjective → `per × count` IS the damage, the
// printed "N×" base dropped) and `deriveAttackDamagePenalty` (`less` → keep the
// base and subtract, D163) are three readers over ONE `{per, count}` interface and
// ONE count evaluator. Until now each fold happened to own a different set of count
// sources; `damageCountersOnSelf` is now read by ALL THREE, told apart by a single
// word. That is what an interface shared by FOLD buys: the price of this slice was
// one regex and one `if`, and `scaledAttackDamage`, `attack.ts`'s pipeline, the
// base-drop rule, both simulated-flags, the event and the log crumb took ZERO diff.
//
// ⚠️ THE CENSUS IS A MEASUREMENT, AND IT IS EXACTLY TWO. The local D1 (2026-08-03,
// 978 rows / 6 sets — sv01 258, sv02 279, sv03 230, sv06.5 99, sve 24, swsh10.5 88)
// returns nineteen rows for `LIKE '%for each damage counter%'` across all three text
// columns; subtract the `more` and `less` twins and TWO remain, both on
// `attacks_json`, both `attacks_json` index 1: Drifloon and Onix. 2 printings, 2
// distinct sentences, one `(\d+)` capture.
//
// ⚠️ AND `FIXTURE_POOL` HAD NOTHING TO REUSE, WHICH IS THE PART THE PLAN GOT WRONG.
// Five bodies in the pool already print "for each damage counter on this Pokémon"
// (sv02-028, sv03-161 and fix-attacker's Rage/Fury with `more`; sv01-060 and
// sv02-037 with `less`) and NOT ONE of them prints the bare form — neither sv01-089
// nor swsh10.5-036 was fielded anywhere in the package. Both fixtures are authored
// FRESH, transcribed off the catalog rather than bent out of a neighbour, because a
// bent string would make "one regex spans two REAL printed amounts" a claim about a
// string this file wrote.
//
// ⚠️ TWO PRE-EXISTING BEHAVIOURS OF THE `×` FOLD THIS SUITE INHERITS RATHER THAN
// INTRODUCES, both driven below so a later reader does not mistake them for bugs:
// at ZERO counters `scaledBase` and `scaledTotal` are both 0, so attack.ts's
// `if (scaledBase + scaledTotal > 0)` guard skips the whole damage pipeline and NO
// `DAMAGE_DEALT` IS EMITTED AT ALL (rules-correct — the attack does 0 damage); and
// the log crumb renders the entire damage as ` · scaled +N` off a `base 0`, which is
// how every existing member of this fold already reads.

/** The two printed sentences, byte-for-byte off the local D1 rows (2026-08-03,
    978 rows / 6 sets). */
const BALLOON_BLAST = "This attack does 30 damage for each damage counter on this Pokémon.";
const RAGING_SWING = "This attack does 50 damage for each damage counter on this Pokémon.";
/** The two ADJECTIVED twins on the same count source — the sentences this slice's
    regex must refuse and whose readers must refuse this slice's. Both are printed
    on real catalog rows and both are read (M2 and D163). */
const RAGING_HORNS = "This attack does 10 more damage for each damage counter on this Pokémon.";
const SWEEPING_TACKLE = "This attack does 20 less damage for each damage counter on this Pokémon.";

/** One seed for the whole suite: nothing in this family flips a coin and every
    Active is placed by surgery, so a seed table would describe a shuffle rather
    than a rule (D143's move, D147/D163's inheritance). */
const SEED = 7;

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

/** Every attacker this suite declares, with the printed INDEX and the energy its
    cost needs — read off the local D1 per printing (D144's rule). */
const ATTACKERS = {
  drifloon: { card: "sv01-089", index: 1, energy: [{ id: "fix-psychic-energy", count: 2 }] }, // "Balloon Blast" ({P}{P}, "30×")
  "drifloon-gust": { card: "sv01-089", index: 0, energy: [{ id: "fix-energy", count: 2 }] }, // "Gust" ({C}{C}, 10, NO effect key)
  onix: {
    card: "swsh10.5-036",
    index: 1,
    energy: [
      { id: "fix-fighting-energy", count: 2 },
      { id: "fix-energy", count: 2 },
    ],
  }, // "Raging Swing" ({F}{F}{C}{C}, "50×")
  "onix-tomb": { card: "swsh10.5-036", index: 0, energy: [{ id: "fix-energy", count: 3 }] }, // "Rock Tomb" ({C}{C}{C}, 50, a live preventRetreat)
  cetitan: {
    card: "sv01-060",
    index: 1,
    energy: [
      { id: "fix-water-energy", count: 1 },
      { id: "fix-energy", count: 2 },
    ],
  }, // "Sweeping Tackle" ({W}{C}{C}, "200-", 20 LESS per counter)
  rage: { card: "fix-attacker", index: 3, energy: [{ id: "fix-energy", count: 1 }] }, // "Rage" ({C}, "10+", 10 MORE per counter)
} as const;

type Attacker = keyof typeof ATTACKERS;

/** `by`'s opponent opens and passes, so the attacking seat carries no §4
    first-turn restriction. Both bodies are placed by surgery and BOTH benches are
    cleared: every number in this family is read off the CURRENT board at
    declaration, and a stray displaced body is a silent extra Ability source. */
function board(attacker: Attacker, defender: string, by: Seat = "p1"): GameState {
  const opener = by === "p1" ? "p2" : "p1";
  let state = must(
    applyAction(
      driveSetup(
        SEED,
        { p1: SELF_COUNTER_MULTIPLY_DECK, p2: SELF_COUNTER_MULTIPLY_DECK },
        { first: opener },
      ),
      { type: "endTurn", seat: opener },
    ),
  );
  state = setActiveFromDeck(state, by, ATTACKERS[attacker].card);
  state = clearBench(state, by);
  for (const { id, count } of ATTACKERS[attacker].energy) {
    state = attachFromDeck(state, by, id, count);
  }
  state = setActiveFromDeck(state, opener, defender);
  return clearBench(state, opener);
}

function swing(state: GameState, attacker: Attacker, seat: Seat = "p1") {
  return mustApply(state, { type: "attack", seat, index: ATTACKERS[attacker].index });
}

/** The rendered log, flattened to `{ who, text }` — the shape the neighbouring
    suites read a sequence in. */
function rendered(state: GameState, events: GameEvent[]): { who: string; text: string }[] {
  const ctx: LogContext = { names: { p1: "Ember", p2: "Wren" }, state, elapsed: "+00:11" };
  return logFromEvents(events, ctx).flatMap((entry) =>
    entry.kind === "turn"
      ? []
      : [{ who: entry.who, text: entry.segments.map((s) => s.text).join("") }],
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// The data: two fixtures that did not exist, transcribed rather than bent.
// ─────────────────────────────────────────────────────────────────────────────

describe("the printed data — re-queried, not recognised", () => {
  it("carries Drifloon sv01-089's WHOLE printed attack list verbatim", () => {
    expect(FIXTURE_POOL["sv01-089"]).toMatchObject({
      name: "Drifloon",
      category: "Pokemon",
      stage: "Basic",
      hp: 70,
      types: ["Psychic"],
      retreat: 1,
      weaknesses: [{ type: "Darkness", value: "×2" }],
      // Carried because it is PRINTED, and it is why every board below measures
      // against a defender that has none.
      resistances: [{ type: "Fighting", value: "-30" }],
    });
    // The WHOLE list, so the fixture cannot be wrong by OMISSION (D156's failure
    // mode) and so no later slice indexes into a short one. The printed damage
    // marker is a trailing "×" — the sign this fold's base-drop rule reads.
    expect(FIXTURE_POOL["sv01-089"]?.attacks).toEqual([
      { cost: ["Colorless", "Colorless"], name: "Gust", damage: 10 },
      {
        cost: ["Psychic", "Psychic"],
        name: "Balloon Blast",
        effect: BALLOON_BLAST,
        damage: "30×",
      },
    ]);
    expect(FIXTURE_POOL["sv01-089"]?.abilities ?? null).toBeNull();
  });

  it("…and Onix swsh10.5-036's, whose index 0 is a DIFFERENT live mechanism", () => {
    expect(FIXTURE_POOL["swsh10.5-036"]).toMatchObject({
      name: "Onix",
      category: "Pokemon",
      stage: "Basic",
      hp: 120,
      types: ["Fighting"],
      retreat: 4,
      weaknesses: [{ type: "Grass", value: "×2" }],
    });
    expect(FIXTURE_POOL["swsh10.5-036"]?.resistances ?? null).toBeNull();
    expect(FIXTURE_POOL["swsh10.5-036"]?.attacks).toEqual([
      {
        cost: ["Colorless", "Colorless", "Colorless"],
        name: "Rock Tomb",
        effect: "During your opponent's next turn, the Defending Pokémon can't retreat.",
        damage: 50,
      },
      {
        cost: ["Fighting", "Fighting", "Colorless", "Colorless"],
        name: "Raging Swing",
        effect: RAGING_SWING,
        damage: "50×",
      },
    ]);
  });

  it("⚠️ NEITHER BODY EXISTED BEFORE THIS SLICE, and no neighbour could stand in", () => {
    // The finding the plan got wrong, asserted rather than narrated. Every body in
    // the pool printing this count source carries an ADJECTIVE, so there was no
    // bare-form fixture to reuse and no `damage for each damage counter` sentence
    // any reader could have read. The sweep is over the pool rather than a list,
    // so a sixth adjectived printing added later joins the left-hand set on its own.
    //
    // ⚠️ AND ONE DID — `sv01-032[0]`, Arcanine ex's "Raging Claws", added by D173
    // and NOT by a new card. The printing was in the pool the whole time; the
    // FIXTURE dropped it, carrying only index-1 "Bright Flame", so this sweep read
    // a body that prints this family's sentence and saw nothing. That is the exact
    // failure mode a discovered-from-the-population census is built to avoid, and
    // it survived one anyway: the sweep's inputs were short, not its predicate.
    const bare: string[] = [];
    const adjectived: string[] = [];
    for (const [id, card] of Object.entries(FIXTURE_POOL)) {
      for (const [index, attack] of (card.attacks ?? []).entries()) {
        const text = attack.effect ?? "";
        if (!text.includes("damage counter on this Pokémon")) continue;
        (text.includes(" more damage") || text.includes(" less damage") ? adjectived : bare).push(
          `${id}[${index}]`,
        );
      }
    }
    expect(bare.sort()).toEqual(["sv01-089[1]", "swsh10.5-036[1]"]);
    expect(adjectived.sort()).toEqual([
      "fix-attacker[3]",
      "fix-attacker[4]",
      "sv01-032[0]", // Arcanine ex "Raging Claws" — carried since D173
      "sv01-060[1]",
      "sv02-037[1]",
      "sv02-028[0]",
      "sv03-161[0]",
    ].sort());
  });

  it("AUTHORS nothing — both printings are read off the TEXT", () => {
    // The deriver is the whole mechanism: no registry row, no `attack` map entry,
    // no passive. A registry-authored program would win over the reader (D8), so
    // this is the claim that says the text path is the one being driven below.
    for (const id of ["sv01-089", "swsh10.5-036"] as const) {
      expect(programFor(id)).toBeUndefined();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The reader.
// ─────────────────────────────────────────────────────────────────────────────

describe("deriveAttackDamageMultiplier — one regex, two amounts, an OLD count source", () => {
  it("reads BOTH printed sentences as `damageCountersOnSelf`", () => {
    // per 30 ≠ 50 on one capture: a hardcoded per-unit satisfies one printing and
    // fails the other, which is D121's second-printing warrant met by the pool.
    // The `count` member is the EXISTING one — no new `DamageCountSource`.
    expect(deriveAttackDamageMultiplier(BALLOON_BLAST)).toEqual({
      per: 30,
      count: { kind: "damageCountersOnSelf" },
    });
    expect(deriveAttackDamageMultiplier(RAGING_SWING)).toEqual({
      per: 50,
      count: { kind: "damageCountersOnSelf" },
    });
  });

  it("KEEPS its two older count sources — a third arm, not a replacement", () => {
    // The arm was placed FIRST in the reader to mirror `deriveAttackDamageBonus`;
    // a `return` reordered past the Prize/Retreat arms would strand them silently,
    // because those sentences are exercised by a different suite entirely.
    expect(
      deriveAttackDamageMultiplier(
        "This attack does 60 damage for each Prize card your opponent has taken.",
      ),
    ).toEqual({ per: 60, count: { kind: "opponentPrizesTaken" } });
    expect(
      deriveAttackDamageMultiplier(
        "This attack does 50 damage for each {C} in your opponent's Active Pokémon's Retreat Cost.",
      ),
    ).toEqual({ per: 50, count: { kind: "opponentActiveRetreatCost" } });
  });

  it("is DISJOINT from its two adjectived siblings in BOTH directions", () => {
    // The missing word is the whole discriminator, and each reader must refuse the
    // others' sentences or two folds would fire on one printing.
    expect(deriveAttackDamageMultiplier(RAGING_HORNS)).toBeNull();
    expect(deriveAttackDamageMultiplier(SWEEPING_TACKLE)).toBeNull();
    expect(deriveAttackDamageBonus(BALLOON_BLAST)).toBeNull();
    expect(deriveAttackDamageBonus(RAGING_SWING)).toBeNull();
    expect(deriveAttackDamagePenalty(BALLOON_BLAST)).toBeNull();
    expect(deriveAttackDamagePenalty(RAGING_SWING)).toBeNull();
    // …and both twins still read, unchanged, on the same count source.
    expect(deriveAttackDamageBonus(RAGING_HORNS)).toEqual({
      per: 10,
      count: { kind: "damageCountersOnSelf" },
    });
    expect(deriveAttackDamagePenalty(SWEEPING_TACKLE)).toEqual({
      per: 20,
      count: { kind: "damageCountersOnSelf" },
    });
  });

  it("⚠️ AT MOST ONE of the three readers answers ANY attack in the pool", () => {
    // The sweep `selfScalingPenalty.test.ts` runs, re-run from the third fold's
    // side and over a pool that now CONTAINS the bare sentence — which is the whole
    // reason it is repeated here rather than trusted. attack.ts guards each reader
    // on its predecessors having declined; that guard is free precisely because
    // this holds, and D157's rule says an invisible guard is paid for with an
    // assertion rather than a comment.
    for (const [id, card] of Object.entries(FIXTURE_POOL)) {
      for (const attack of card.attacks ?? []) {
        const text = attack.effect ?? "";
        const answers = [
          deriveAttackDamageBonus(text),
          deriveAttackDamageMultiplier(text),
          deriveAttackDamagePenalty(text),
        ].filter((x) => x !== null).length;
        expect(answers, `${id} ${attack.name}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it("STAYS LOUD as an op — the sentence derives no post-damage program", () => {
    // A pre-damage fold derived into a tail op would run AFTER the §8.5 pipeline
    // and could not touch a number already computed (D125's classification rule).
    for (const text of [BALLOON_BLAST, RAGING_SWING]) {
      expect(deriveAttackEffect(text)).toBeNull();
    }
  });

  it("refuses a printed 0, and every near-miss the anchors exist for", () => {
    // The zero guard every arm in this family carries: 30 × 0 units and 0 × N units
    // are different facts, and a printed 0 must stay LOUD rather than claim a
    // simulated sentence that can never do anything.
    expect(
      deriveAttackDamageMultiplier(
        "This attack does 0 damage for each damage counter on this Pokémon.",
      ),
    ).toBeNull();
    for (const near of [
      // a lowercased first word
      "this attack does 30 damage for each damage counter on this Pokémon.",
      // no trailing period
      "This attack does 30 damage for each damage counter on this Pokémon",
      // leading text
      "Flip a coin. This attack does 30 damage for each damage counter on this Pokémon.",
      // trailing text
      "This attack does 30 damage for each damage counter on this Pokémon. Discard an Energy from this Pokémon.",
      // the BENCH-wide count — ✅ READ SINCE D170 (Tyranitar swsh10.5-043 "Raging
      // Crash"), but this string is NOT that sentence: the printing says "on ALL OF
      // your Benched Pokémon" and `BENCH_COUNTER_MULTIPLY`'s literal tail requires
      // the "all of". So the assertion is unchanged and now SHARPER — it is the
      // near-miss of a sentence that exists rather than of one that does not, and
      // it must stay null for BOTH readers rather than merely for this one.
      "This attack does 30 damage for each damage counter on your Benched Pokémon.",
      // a real Pokémon with a lookalike é would fall off the path silently
      "This attack does 30 damage for each damage counter on this Pokemon.",
    ]) {
      expect(deriveAttackDamageMultiplier(near)).toBeNull();
    }
  });

  it("🛑 the DEFENDER-side twin is READ — and it must land on the OTHER count member", () => {
    // 🆕 **D423 — RE-POINTED, BECAUSE THIS LINE'S SUBJECT MOVED SIDES.** This string
    // sat in the near-miss list above under the caption *"a real unread neighbour"*,
    // asserted null. It is read since D423 by `OPPONENT_COUNTER_MULTIPLY` (3
    // Standard-legal printings — Glalie `sv06-052`, Flapple `sv08-139`/`sv08-210`),
    // so a `toBeNull` there would now be false.
    //
    // ⚠️ **AND THE RE-POINTING KEEPS THE DISCRIMINATION THE OLD LINE CARRIED**, which
    // is D418's second half rather than an afterthought. What that line ever proved is
    // that `SELF_COUNTER_MULTIPLY` does not answer a sentence naming the OTHER body —
    // and asserting `count.kind` rather than merely "not null" is what preserves it:
    // a self-side tail widened off the literal `on this Pokémon.` would answer FIRST
    // (it is arm one, this printing's arm is four) and hand `damageCountersOnSelf` to
    // a printing whose counters are on the defender. Wrong body, right shape, no
    // count moves — invisible to every census and wrong on every board.
    expect(
      deriveAttackDamageMultiplier(
        "This attack does 30 damage for each damage counter on your opponent's Active Pokémon.",
      ),
    ).toEqual({ per: 30, count: { kind: "damageCountersOnOpponentActive" } });
    // …and the self-side sentence still lands on the self-side member, which is the
    // control that stops the line above passing because arm one stopped matching.
    expect(deriveAttackDamageMultiplier(BALLOON_BLAST)).toEqual({
      per: 30,
      count: { kind: "damageCountersOnSelf" },
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The census, SWEPT out of the pool rather than listed.
// ─────────────────────────────────────────────────────────────────────────────

describe("the census — discovered from the population, not enumerated", () => {
  it("is exactly TWO fixture attacks on this count source, and they are the two printings", () => {
    // D145's move (D147/D159/D161/D163's inheritance): discover the producers by
    // deriving every attack in the pool, so a third printing added without a case
    // fails HERE.
    //
    // ⚠️ WHAT THIS SWEEP DOES NOT TRAVERSE, said rather than left: it enumerates
    // `FIXTURE_POOL`, so a CATALOG row with no fixture is invisible to it (there is
    // none for this family — the census is 2/2), and it reads ATTACK text only, so
    // an Ability or Trainer printing of the same sentence would not appear. The
    // catalog side is crossed only by `catalogManifest.test.ts`.
    const found: string[] = [];
    for (const [id, card] of Object.entries(FIXTURE_POOL)) {
      for (const [index, attack] of (card.attacks ?? []).entries()) {
        const multiply = deriveAttackDamageMultiplier(attack.effect ?? "");
        if (multiply?.count.kind === "damageCountersOnSelf") {
          found.push(`${id}[${index}] ${attack.name}`);
        }
      }
    }
    expect(found.sort()).toEqual(["sv01-089[1] Balloon Blast", "swsh10.5-036[1] Raging Swing"]);
  });

  it("…and the OTHER TWO ADJECTIVES' producers are asserted beside them", () => {
    // The claim this slice makes is about a count source read by THREE folds, so
    // all three lists are swept together: a reader that started answering a
    // neighbour's sentence would move a name between them, and no assertion on the
    // two new printings alone can see that.
    const by = (read: (text: string) => { count: { kind: string } } | null): string[] => {
      const found: string[] = [];
      for (const [id, card] of Object.entries(FIXTURE_POOL)) {
        for (const [index, attack] of (card.attacks ?? []).entries()) {
          if (read(attack.effect ?? "")?.count.kind === "damageCountersOnSelf") {
            found.push(`${id}[${index}]`);
          }
        }
      }
      return found.sort();
    };
    expect(by(deriveAttackDamageBonus)).toEqual([
      "fix-attacker[3]",
      "fix-attacker[4]",
      "sv01-032[0]", // Arcanine ex "Raging Claws" — carried since D173
      "sv02-028[0]",
      "sv03-161[0]",
    ]);
    expect(by(deriveAttackDamagePenalty)).toEqual(["sv01-060[1]", "sv02-037[1]"]);
    expect(by(deriveAttackDamageMultiplier)).toEqual(["sv01-089[1]", "swsh10.5-036[1]"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The fold: `per × count` IS the damage and the printed base is DROPPED.
// ─────────────────────────────────────────────────────────────────────────────

describe("the fold — per × counters as the WHOLE damage, printed base dropped", () => {
  it("does 30 PER COUNTER for Drifloon, and the printed 30 does NOT also land", () => {
    // 3 counters × 30 = 90, reported as base 0 / scaled 90. Were the printed "30×"
    // base kept (folded like the additive family) it would be 120 — one board tells
    // the two folds apart.
    let state = board("drifloon", "fix-titan");
    state = setDamage(state, "p1", 30); // 3 damage counters
    const { state: after, events } = swing(state, "drifloon");
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ base: 0, scaled: 90, dealt: 90 });
    expect(after.players.p2.active?.damage).toBe(90);
  });

  it("…and 50 PER COUNTER for Onix, off ONE regex", () => {
    // TWO amounts on one capture: a hardcoded per-unit satisfies one printing and
    // fails the other. 6 counters × 50 = 300, which fix-titan's 340 HP survives so
    // the arithmetic stands alone with no KO in the way.
    let state = board("onix", "fix-titan");
    state = setDamage(state, "p1", 60); // 6 damage counters
    const { events } = swing(state, "onix");
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ base: 0, scaled: 300, dealt: 300 });
  });

  it("scales LINEARLY off the counter ladder — 1, 3 and 6 counters, one body", () => {
    // Three points on one line pin `Math.floor(damage / 10) * per`: a fold that
    // counted HP rather than COUNTERS, or that clamped, or that read a constant,
    // agrees with at most one of them.
    for (const [damage, dealt] of [
      [10, 30],
      [30, 90],
      [60, 180],
    ] as const) {
      let state = board("drifloon", "fix-titan");
      state = setDamage(state, "p1", damage);
      expect(find(swing(state, "drifloon").events, "DAMAGE_DEALT")?.dealt).toBe(dealt);
    }
  });

  it("⚠️ AT ZERO COUNTERS THERE IS NO `DAMAGE_DEALT` AT ALL — and that is CORRECT", () => {
    // The base-drop tell, and the inherited second-order behaviour this suite is
    // written knowing: `scaledBase` is 0 for a multiply and `scaledTotal` is 0 at
    // count 0, so attack.ts's `scaledBase + scaledTotal > 0` guard skips the whole
    // §8.5 pipeline. The attack really does 0 damage. Were the printed base kept it
    // would deal 30, so the ABSENT row is what pins the drop — and the attack is
    // still USED (the turn ends), which is the half an early return would break.
    const { state: after, events } = swing(board("drifloon", "fix-titan"), "drifloon");
    expect(find(events, "DAMAGE_DEALT")).toBeUndefined();
    expect(find(events, "KNOCKED_OUT")).toBeUndefined();
    expect(after.players.p2.active?.damage).toBe(0);
    // …and the sentence is STILL not flagged: read text that resolves to nothing is
    // simulated text (D140's rule — loudness is owed to UNREAD text).
    expect(find(events, "ATTACK_EFFECT_SKIPPED")).toBeUndefined();
    // The attack was USED: the turn passed to the opponent.
    expect(after.phase).toMatchObject({ kind: "turn:action", seat: "p2" });
  });

  it("counts the ATTACKER's counters, never the defender's", () => {
    // The count source is `damageCountersOnSelf` and "self" is the attacking body.
    // A reader that took the target's damage would deal 450 here AND would pass
    // every zero-counter case above.
    let state = board("drifloon", "fix-titan");
    state = setDamage(state, "p2", 150);
    const { events } = swing(state, "drifloon");
    expect(find(events, "DAMAGE_DEALT")).toBeUndefined();
    expect(swing(state, "drifloon").state.players.p2.active?.damage).toBe(150);
  });

  it("reads the counters at DECLARATION, so this attack cannot bootstrap its own", () => {
    // The same site every other member of the family counts at. Drifloon takes no
    // recoil, so the honest statement is about the DEFENDER's counters not feeding
    // back: a mid-pipeline re-read would see the 90 it just dealt.
    let state = board("drifloon", "fix-titan");
    state = setDamage(state, "p1", 30);
    const { state: after, events } = swing(state, "drifloon");
    expect(find(events, "DAMAGE_DEALT")?.scaled).toBe(90);
    expect(after.players.p1.active?.damage).toBe(30);
  });

  it("leaves index 0 ALONE — a sibling attack does not inherit the clause", () => {
    // "Gust" carries no `effect` key at all. A fold keyed on the CARD rather than
    // on the declared attack's text would turn this printed 10 into 90.
    let state = board("drifloon-gust", "fix-titan");
    state = setDamage(state, "p1", 30);
    const { events } = swing(state, "drifloon-gust");
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ base: 10, dealt: 10 });
    expect(find(events, "DAMAGE_DEALT")?.scaled).toBeUndefined();
    expect(find(events, "ATTACK_EFFECT_SKIPPED")).toBeUndefined();
  });

  it("…and Onix's index 0 keeps its OWN, DIFFERENT mechanism intact", () => {
    // The sharper form of the same negative: "Rock Tomb" is a live `preventRetreat`
    // op (M3), so this board asserts that index 1's fold neither leaks INTO a
    // simulated sibling nor displaces it. Base 50 lands whole and the block is
    // installed on the defender.
    let state = board("onix-tomb", "fix-titan");
    state = setDamage(state, "p1", 60);
    const { state: after, events } = swing(state, "onix-tomb");
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ base: 50, dealt: 50 });
    expect(find(events, "DAMAGE_DEALT")?.scaled).toBeUndefined();
    expect(after.players.p2.active?.retreatBlocked).toBe(true);
    expect(find(events, "ATTACK_EFFECT_SKIPPED")).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The ORDER, and the three adjectives on ONE board.
// ─────────────────────────────────────────────────────────────────────────────

describe("the ORDER — the whole damage is folded BEFORE Weakness", () => {
  it("doubles the SCALED number, not a printed base that is not there", () => {
    // Drifloon (PSYCHIC) into fix-psychic-weak (200 HP, ×2 Psychic) at 3 counters:
    // (0 + 90) × 2 = 180, which 200 HP survives so no KO hides the arithmetic. A
    // fold that kept the printed base would report 240; one that doubled before
    // scaling has nothing to double.
    let state = board("drifloon", "fix-psychic-weak");
    state = setDamage(state, "p1", 30);
    const { state: after, events } = swing(state, "drifloon");
    const row = find(events, "DAMAGE_DEALT");
    expect(row).toMatchObject({ base: 0, scaled: 90, dealt: 180 });
    expect(row?.weakness).toEqual({ op: "multiply", amount: 2 });
    expect(after.players.p2.active?.damage).toBe(180);
    expect(find(events, "KNOCKED_OUT")).toBeUndefined();
  });

  it("…and the oracle is derived from the ROW's OWN fields", () => {
    // D147's move (D149/D161/D163's inheritance): re-derive the number the engine
    // reported from the fields that row carries, rather than from the constants the
    // test was written with — so a fold that changed BOTH the number and the
    // reported base would still be caught.
    let state = board("drifloon", "fix-psychic-weak");
    state = setDamage(state, "p1", 30);
    const row = find(swing(state, "drifloon").events, "DAMAGE_DEALT");
    if (row === undefined) throw new Error("no damage row");
    const raw = row.base + (row.scaled ?? 0) + (row.bonus ?? 0);
    expect(row.weakness).not.toBeNull();
    expect(raw * 2).toBe(row.dealt);
    // The base is REPORTED as 0 rather than merely unused — the drop is visible in
    // the record, which is what a replaying client reads.
    expect(row.base).toBe(0);
  });

  it("⚠️ ALL THREE ADJECTIVES, ONE COUNT SOURCE, ONE COUNTER TOTAL, ONE BOARD", () => {
    // The claim of the whole slice, driven rather than argued. Three bodies at
    // THREE damage counters each, against the same clean 340 HP defender:
    //   "more" (Rage, "10+")       →  10 + 30 = 40, reported through `scaled`
    //   none   (Balloon Blast 30×) →       90,      reported through `scaled`, base 0
    //   "less" (Sweeping Tackle)   → 200 − 60 = 140, reported through `debuff`
    // One word apart in the print, three different rows out of the engine. If any
    // reader started answering a neighbour's sentence, at least one of these moves.
    const at3 = (attacker: Attacker) => {
      let state = board(attacker, "fix-titan");
      state = setDamage(state, "p1", 30);
      return find(swing(state, attacker).events, "DAMAGE_DEALT");
    };
    expect(at3("rage")).toMatchObject({ base: 10, scaled: 30, dealt: 40 });
    expect(at3("drifloon")).toMatchObject({ base: 0, scaled: 90, dealt: 90 });
    expect(at3("cetitan")).toMatchObject({ base: 200, debuff: 60, dealt: 140 });
    // …and each row carries ONLY its own direction's field, which is what makes the
    // three folds distinguishable to a reader of the RECORD and not just to this test.
    expect(at3("rage")?.debuff).toBeUndefined();
    expect(at3("drifloon")?.debuff).toBeUndefined();
    expect(at3("cetitan")?.scaled).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// VOICE.
// ─────────────────────────────────────────────────────────────────────────────

describe("VOICE — the crumb, rendered under BOTH seats and READ", () => {
  it("renders the WHOLE damage as ` · scaled +90` off a base of 0", () => {
    // The inherited crumb, driven so it is not mistaken for a defect later: this
    // fold has no base, so the number after "scaled +" IS the damage rather than an
    // increment on something. Every existing `×` member already reads this way
    // (Pecharunt ex, Annihilape, Stoutland), which is exactly why NO NEW ARM was
    // added to log.ts.
    let state = board("drifloon", "fix-psychic-weak");
    state = setDamage(state, "p1", 30);
    const { state: after, events } = swing(state, "drifloon");
    const row = rendered(after, events).find((r) => r.text.startsWith("dealt "));
    expect(row?.who).toBe("p1");
    expect(row?.text).toBe("dealt 180 damage to fix-psychic-weak · scaled +90 · weakness ×2");
  });

  it("renders the SAME sequence when the attacking seat is p2", () => {
    // `DAMAGE_DEALT.seat` owns the DAMAGED Pokémon and log.ts renders the line under
    // `otherSeat(seat)` — a hardcoded seat would look right on exactly one of these.
    let state = board("drifloon", "fix-psychic-weak", "p2");
    state = setDamage(state, "p2", 30);
    const { state: after, events } = swing(state, "drifloon", "p2");
    const row = rendered(after, events).find((r) => r.text.startsWith("dealt "));
    expect(row?.who).toBe("p2");
    expect(row?.text).toBe("dealt 180 damage to fix-psychic-weak · scaled +90 · weakness ×2");
  });

  it("says nothing at all at zero counters — there is no row to speak", () => {
    // Loudness is owed to UNREAD text (D140). A clause that resolved to 0 must not
    // print a damage line, and must not print a "not simulated" one either.
    const { state: after, events } = swing(board("drifloon", "fix-titan"), "drifloon");
    expect(rendered(after, events).some((r) => r.text.startsWith("dealt "))).toBe(false);
    expect(rendered(after, events).some((r) => r.text.includes("not simulated"))).toBe(false);
  });

  it("⚠️ AND THE PRINTED TEXT STOPS BEING FLAGGED — both halves of it", () => {
    // Before this slice both printings emitted ATTACK_EFFECT_SKIPPED carrying the
    // whole sentence AND the "×" damage marker. `effectSimulated` and
    // `modifierSimulated` are both written `scaling !== null || …` — where `scaling`
    // is `damageBonus ?? damageMultiplier` — so both terms already subsumed this
    // reader and NEITHER needed a diff. Asserted rather than assumed, on both
    // printings and at a counter total where the fold does something.
    for (const attacker of ["drifloon", "onix"] as const) {
      let state = board(attacker, "fix-titan");
      state = setDamage(state, "p1", 30);
      expect(find(swing(state, attacker).events, "ATTACK_EFFECT_SKIPPED")).toBeUndefined();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The structural answers.
// ─────────────────────────────────────────────────────────────────────────────

describe("the structural answers", () => {
  it("PERSIST: NOTHING was written to `InPlayPokemon`, so MATCH_RECORD_VERSION stays 11", () => {
    // Neither park nor persist. The clause is CATALOG text read at declaration by a
    // pure function of the current state; no stamp, no op, no event type, no event
    // field, no enum value, no union member — and, unlike D163, not even a new
    // reader. Pinned as an ABSENCE (D161's move), which is the only way a no-bump
    // claim is checkable. (`MATCH_RECORD_VERSION` itself lives in `apps/api/src/
    // lobby/match.ts`; the engine cannot import it, so the assertion this side can
    // make is the one that would FORCE the bump.)
    //
    // ⚠️ D412 — the literal ("is pinned at 11 by `match.test.ts`") is DELETED rather
    // than stepped, for the reason spelled out in `selfScalingPenalty.test.ts`'s
    // twin of this comment: a figure about another file, carried in prose, with
    // nothing comparing them. This slice's own finding — that at D163 nothing was
    // written to `InPlayPokemon` — is untouched and still asserted below.
    const active = board("drifloon", "fix-titan").players.p1.active;
    if (active === null) throw new Error("no Active");
    expect(Object.keys(active).sort()).toEqual(
      [
        "attackBlock",
        "attackDamageDebuff",
        "attackLockedTurn",
        "boostedAttack",
        "conditions",
        "damage",
        "damageReduction",
        "energy",
        // 🆕🆕 D386 — `healedTurn` JOINS THE LIST (a second per-turn stamp on this
        // structure, and `MATCH_RECORD_VERSION` 22 → 23 with it). THIS slice still wrote
        // nothing: the pin is on the HEAD's key set, so it moves whenever anybody adds a
        // key, and what it asserts is that none of them was added HERE.
        "evolvedTurn",
        "healedTurn",
        "installedRecoil",
        "lockedAttacks",
        "markers",
        // 🆕🆕 D432 — the attack-installed §8.5 NO-WEAKNESS bar's stamp (MATCH_RECORD_VERSION 26 -> 27).
        "noWeaknessTurn",
        "promotedTurn",
        "retreatBlocked",
        // 🆕🆕 D412 — the SELF-installed §11 retreat lock's stamp (MATCH_RECORD_VERSION 25 → 26).
        "retreatLockedTurn",
        "scheduledEffect",
        "stack",
        "tools",
        "turnPlayed",
        // 🆕🆕 D394 — `usedAttack` JOINS THE LIST (a FOURTH per-turn stamp on this
        // structure, and `MATCH_RECORD_VERSION` 24 → 25 with it). THIS slice still
        // wrote nothing; the pin is on the HEAD's key set.
        "usedAttack",
      ].sort(),
    );
  });

  it("GATES NO ACTION — the attack is still offered when it would deal 0", () => {
    // Checked rather than assumed (D157's rule): the clause says nothing about
    // legality or cost, so `redactedAttacksOf` must keep offering it on the board
    // where it does literally nothing — refusing there would be the engine
    // inventing a rule the card does not print. Both payability projections read
    // the same `attacks` array, and `GameHud.tsx` takes no diff because no new
    // field reaches it.
    const state = board("drifloon", "fix-titan"); // 0 counters → 0 damage
    const view = redactGame(state, "p1").phase;
    if (view.kind !== "turn:action") throw new Error(`expected turn:action, got ${view.kind}`);
    expect(view.attacks).toHaveLength(2);
    expect(view.attacks[1]).toMatchObject({ index: 1, name: "Balloon Blast", playable: true });
    expect(applyAction(state, { type: "attack", seat: "p1", index: 1 }).ok).toBe(true);
  });

  it("never mutates the state it was given (purity)", () => {
    let state = board("onix", "fix-titan");
    state = setDamage(state, "p1", 60);
    deepFreeze(state);
    expect(() => applyAction(state, { type: "attack", seat: "p1", index: 1 })).not.toThrow();
  });
});
