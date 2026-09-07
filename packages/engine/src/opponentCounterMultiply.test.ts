import { describe, expect, it } from "vitest";
import {
  deriveAttackDamageBonus,
  deriveAttackDamageMultiplier,
  deriveAttackDamagePenalty,
  deriveAttackEffect,
} from "./effects";
import { applyAction, engineVersion, programFor, redactGame } from "./index";
import type { GameEvent, GameState, Seat } from "./index";
import { type LogContext, logFromEvents } from "./log";
import {
  FIXTURE_POOL,
  OPPONENT_COUNTER_MULTIPLY_DECK,
  attachFromDeck,
  clearBench,
  deepFreeze,
  driveSetup,
  must,
  mustApply,
  setActiveFromDeck,
  setDamage,
} from "./testFixtures";

// 0.324.0 → 0.325.0 — D423, the OPPONENT-SIDE damage-counter count on the `×`
// FOLD: the multiply twin of D168, and the whole of it is that "more" was the only
// word in the way.
//
//   "This attack does 20 damage for each damage counter on your opponent's Active
//    Pokémon."   (Glalie sv06-052 "Damage Beat" idx 0, {W}, "20×")
//                (Flapple sv08-139 / sv08-210 "Acidic Spit" idx 0, {C}, "20×")
//
// 🛑 THIS SLICE IS A CORRECTION TO A PINNED ABSENCE, AND THE VERDICT IS (a): THE
// CLAIM WAS WRONG WHEN IT WAS WRITTEN, NOT OVERTAKEN BY A RE-INGEST.
// `opponentCounterScaling.test.ts` carried a rung titled *"the MULTIPLY twin of
// THIS family is an ABSENCE, not an unread printing"*, whose comment read *"There
// is no no-adjective printing of this count source anywhere in the pool"*. The
// assertion it made was on a `per = 30` string that really is unprinted, so it
// passed for six months while its stated claim was false about `per = 20`.
//
// ⚠️ WHAT SETTLES WHICH FAILURE IT IS, MEASURED THREE WAYS:
//   1. D168's decision row names its own scope — *"measured against the local D1
//      (2026-08-03, 978 cards / 6 sets)"* — and `catalogManifest.ts` names the six:
//      sv01, sv02, sv03, sv06.5, sve, swsh10.5. Both cards above are `sv06` and
//      `sv08`, sets the local catalog has NEVER held. The sweep was EXACT on the
//      population it named: that literal returns precisely four rows over those six
//      sets (Dedenne, Espeon, Bloodmoon Ursaluna and Trevenant's Ability), which is
//      the number D168 wrote down. What was false is the word "pool".
//   2. THE CATALOG DID NOT CHURN. D219 (2026-08-04) re-derived every population
//      denominator EXACTLY to D187's — 640 distinct sentences / 1,732 units /
//      60,467 characters — `censusAtHead.test.ts` has quoted that same triple since
//      D233, and `censusAttackCorpus.ts` committed it at D274 with the `20` row
//      already in it (`git show a7e9a57`). A re-ingest that ADDED these printings
//      would have moved at least one of those three numbers.
//   3. NO AGENT IN THIS CHECKOUT COULD HAVE RE-INGESTED ANYTHING. D183 records that
//      `api.tcgdex.net` and `api.cloudflare.com` are both refused by the runner's
//      network policy (403 to CONNECT).
// So this is D413's failure mode — *two populations, two answers* — biting a PINNED
// ABSENCE rather than a refusal, and it cost the same thing D413 cost: one regex
// and one `if`, for 3 legal printings.
//
// ⚠️ THE CENSUS AT HEAD, RE-MEASURED RATHER THAN INHERITED. Remote D1 `luminous`
// (`735f0fb5-cdc3-494d-8b97-74a8ade0124a`, 2026-08-24, 3,786 rows / 2,021
// `legal_standard = 1`), `json_each` over `attacks_json` and `abilities_json` plus
// the flat `effect` column, GLOB `*damage counter on your opponent*`, GROUPED BY
// SENTENCE before anything was priced. FIVE distinct attack sentences on this count
// source, and every one of them is now read:
//     "…10 more…"  8 printings, 2 LEGAL (Girafarig sv05-066, Zapdos svp-157)
//     "…20…"       3 printings, 3 LEGAL — THIS SLICE
//     "…30 more…"  3 printings, 2 LEGAL
//     "…40 more…"  3 printings, 2 LEGAL
//     "…50 more…"  1 printing,  1 LEGAL
// The "less" spelling of this count source returns **ZERO rows in all three
// columns** — an absence, re-measured on the same run rather than assumed from the
// rung it sits beside, and pinned below.
//
// ⚠️ 3 PRINTINGS / 2 CARDS / 1 SENTENCE, AND THE THIRD PRINTING IS A RARITY.
// `sv08-139` and `sv08-210` are the SAME Flapple at Uncommon and at Illustration
// Rare — identical HP, type, stage, retreat, attacks, costs, damage markers and
// effect text, differing only in `rarity`, `illustrator` and `variants_json`. So
// this is D421's finding (five printings that were one card in five rarities) at a
// smaller multiplier, and it is why the pool fields two bodies rather than three.
// Glalie is the second CARD, which is the discriminator that matters: a reader
// keyed on an id, a type, a stage or a cost would satisfy a one-card suite.
//
// ⚠️ THE PRICE, AND IT IS D167's PRICE ON THE OTHER BODY. One regex
// (`OPPONENT_COUNTER_MULTIPLY`) and one `if` in `deriveAttackDamageMultiplier`.
// NO new `DamageCountSource` — `damageCountersOnOpponentActive` has been in the
// union since D168 — NO new `scaledAttackDamage` arm, NO new fold, NO branch in
// attack.ts, NO op, field, event, prompt or log arm. What moves is that the member
// becomes reachable from TWO readers instead of one.
//
// ⚠️ TWO PRE-EXISTING BEHAVIOURS OF THE `×` FOLD THIS SUITE INHERITS RATHER THAN
// INTRODUCES, both driven below so a later reader does not mistake them for bugs:
// at ZERO counters `scaledBase` and `scaledTotal` are both 0, so attack.ts's
// `if (scaledBase + scaledTotal > 0)` guard skips the whole §8.5 pipeline and NO
// `DAMAGE_DEALT` IS EMITTED AT ALL (rules-correct — the attack does 0 damage); and
// log.ts renders the entire damage as ` · scaled +N` off a `base 0`, which is how
// every existing member of this fold already reads.

/** The printed sentence, byte-for-byte off the corpus row (`cat -A`-verified: the
    possessive is ASCII U+0027 and the é in `Pokémon` is U+00E9 / `C3A9`, NOT the
    U+2019 a brief for this slice guessed at). One string on both cards. */
const DAMAGE_BEAT =
  "This attack does 20 damage for each damage counter on your opponent's Active Pokémon.";
/** D168's ADDITIVE twin on the IDENTICAL count source — the sentence this slice's
    anchor must refuse, and whose reader must refuse this slice's. Printed, read
    since 0.113.0. */
const SECOND_BITE =
  "This attack does 10 more damage for each damage counter on your opponent's Active Pokémon.";
/** The SELF-side multiply twin (Drifloon sv01-089, Onix swsh10.5-036, read since
    D167) — the same fold on the other body, told apart by the literal tail. */
const BALLOON_BLAST = "This attack does 20 damage for each damage counter on this Pokémon.";
/** The "less" spelling of THIS count source. **RE-MEASURED, NOT INHERITED**: zero
    rows across `attacks_json`, `abilities_json` and `effect` on the remote D1
    (2026-08-24, 3,786 rows). An absence — and, unlike the one this slice deletes,
    one that was checked against the population the engine actually runs on. */
const UNPRINTED_PENALTY =
  "This attack does 20 less damage for each damage counter on your opponent's Active Pokémon.";

/** One seed for the whole suite. Nothing in this family flips a coin, every Active
    is placed by surgery and every damage total is placed by `setDamage`, so a seed
    table would describe a shuffle rather than a rule (D143's move, D147/D163/D167/
    D168's inheritance). */
const SEED = 11;

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

/** Every attacker this suite declares, with the printed INDEX and the energy its
    cost needs — read off the D1 row per printing (D144's rule). */
const ATTACKERS = {
  glalie: { card: "fix-glalie", index: 0, energy: [{ id: "fix-water-energy", count: 1 }] }, // "Damage Beat" ({W}, "20×")
  "glalie-headbutt": {
    card: "fix-glalie",
    index: 1,
    energy: [
      { id: "fix-water-energy", count: 1 },
      { id: "fix-energy", count: 2 },
    ],
  }, // "Crazy Headbutt" ({W}{C}{C}, 140, a live discardEnergy)
  flapple: { card: "fix-flapple", index: 0, energy: [{ id: "fix-energy", count: 1 }] }, // "Acidic Spit" ({C}, "20×")
  "flapple-dive": {
    card: "fix-flapple",
    index: 1,
    energy: [
      { id: "fix-grass-energy", count: 1 },
      { id: "fix-fire-energy", count: 1 },
    ],
  }, // "Speed Dive" ({G}{R}, 70, NO effect key)
  dedenne: {
    card: "sv01-095",
    index: 0,
    energy: [
      { id: "fix-psychic-energy", count: 1 },
      { id: "fix-energy", count: 1 },
    ],
  }, // "Second Bite" ({P}{C}, "30+", D168's ADDITIVE twin)
} as const;

type Attacker = keyof typeof ATTACKERS;

/** `by`'s opponent opens and passes, so the attacking seat carries no §4 first-turn
    restriction. Both bodies are placed by surgery and BOTH benches are cleared:
    every number here is read off the CURRENT board at declaration, and a stray
    displaced body is a silent extra Ability source. `counters` is placed on the
    DEFENDER, because that is the body this count source reads. */
function board(attacker: Attacker, defender: string, counters = 0, by: Seat = "p1"): GameState {
  const opener = by === "p1" ? "p2" : "p1";
  let state = must(
    applyAction(
      driveSetup(
        SEED,
        { p1: OPPONENT_COUNTER_MULTIPLY_DECK, p2: OPPONENT_COUNTER_MULTIPLY_DECK },
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
  state = clearBench(state, opener);
  return counters === 0 ? state : setDamage(state, opener, counters * 10);
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
// §1 — the data: two bodies transcribed off the D1 rows, not bent out of a
//      neighbour.
// ─────────────────────────────────────────────────────────────────────────────

describe("§1 — the printed data, transcribed rather than recognised", () => {
  it("carries Glalie sv06-052's WHOLE printed attack list verbatim", () => {
    expect(FIXTURE_POOL["fix-glalie"]).toMatchObject({
      category: "Pokemon",
      stage: "Stage1",
      evolveFrom: "Snorunt",
      hp: 120,
      types: ["Water"],
      retreat: 2,
      weaknesses: [{ type: "Metal", value: "×2" }],
    });
    expect(FIXTURE_POOL["fix-glalie"]?.resistances ?? null).toBeNull();
    expect(FIXTURE_POOL["fix-glalie"]?.abilities ?? null).toBeNull();
    // The WHOLE list, so the fixture cannot be wrong by OMISSION (D156's failure
    // mode) and so no later slice indexes into a short one. The printed damage
    // marker is a trailing "×" — the sign this fold's base-drop rule reads.
    expect(FIXTURE_POOL["fix-glalie"]?.attacks).toEqual([
      { cost: ["Water"], name: "Damage Beat", effect: DAMAGE_BEAT, damage: "20×" },
      {
        cost: ["Water", "Colorless", "Colorless"],
        name: "Crazy Headbutt",
        effect: "Discard an Energy from this Pokémon.",
        damage: 140,
      },
    ]);
  });

  it("…and Flapple sv08-139's, whose index 1 carries NO effect key at all", () => {
    expect(FIXTURE_POOL["fix-flapple"]).toMatchObject({
      category: "Pokemon",
      stage: "Stage1",
      evolveFrom: "Applin",
      hp: 80,
      types: ["Dragon"],
      retreat: 1,
    });
    // BOTH null on the row, and both asserted: a Weakness invented here would make
    // §5's order board ambiguous about which body carries the doubling.
    expect(FIXTURE_POOL["fix-flapple"]?.weaknesses ?? null).toBeNull();
    expect(FIXTURE_POOL["fix-flapple"]?.resistances ?? null).toBeNull();
    expect(FIXTURE_POOL["fix-flapple"]?.attacks).toEqual([
      { cost: ["Colorless"], name: "Acidic Spit", effect: DAMAGE_BEAT, damage: "20×" },
      { cost: ["Grass", "Fire"], name: "Speed Dive", damage: 70 },
    ]);
  });

  it("⚠️ ONE SENTENCE ON TWO CARDS — asserted as an IDENTITY, not as two literals", () => {
    // The 3 printings are 1 distinct sentence, so the two fixtures must agree BYTE
    // FOR BYTE or the "second card" claim is about a string this file wrote twice.
    // Compared to each other rather than to the constant, which is the comparison a
    // typo in one of them survives.
    const glalie = FIXTURE_POOL["fix-glalie"]?.attacks?.[0]?.effect;
    const flapple = FIXTURE_POOL["fix-flapple"]?.attacks?.[0]?.effect;
    expect(glalie).toBe(flapple);
    expect(glalie).toBe(DAMAGE_BEAT);
    // …and the bytes the family's anchors turn on, hex-verified rather than
    // eyeballed: an ASCII possessive and a real é.
    expect(DAMAGE_BEAT).toContain("opponent's");
    expect(DAMAGE_BEAT).not.toContain("’");
    expect(DAMAGE_BEAT).toContain("Pokémon");
  });

  it("AUTHORS nothing — both printings are read off the TEXT", () => {
    // The deriver is the whole mechanism: no registry row, no `attack` map entry,
    // no passive. A registry-authored program would win over the reader (D8), so
    // this is the claim that says the text path is the one being driven below.
    for (const id of ["fix-glalie", "fix-flapple"] as const) {
      expect(programFor(id)).toBeUndefined();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — the reader.
// ─────────────────────────────────────────────────────────────────────────────

describe("§2 — deriveAttackDamageMultiplier gains ONE arm on an OLD count source", () => {
  it("reads the printed sentence as `damageCountersOnOpponentActive`", () => {
    expect(deriveAttackDamageMultiplier(DAMAGE_BEAT)).toEqual({
      per: 20,
      count: { kind: "damageCountersOnOpponentActive" },
    });
  });

  it("⚠️ the `(\\d+)` CAPTURE IS SPANNED BY ONE PRINTED AMOUNT TODAY, and that is SAID", () => {
    // D170's move on the bench-wide count, inherited rather than hidden: this fold
    // prints only `20` for this source, so the capture is here because every sibling
    // pattern has one and because D121's second-printing warrant is met by the
    // ADDITIVE twin's FOUR amounts, not because two rows exercise it. Asserting an
    // unprinted amount is therefore a claim about the REGEX, and it is labelled as
    // one — the arm transfers to a reprint the day one is ingested (D187's rule).
    expect(deriveAttackDamageMultiplier(DAMAGE_BEAT.replace(" 20 ", " 70 "))).toEqual({
      per: 70,
      count: { kind: "damageCountersOnOpponentActive" },
    });
  });

  it("KEEPS every older count source — a new arm, not a reordering", () => {
    // The arm was inserted FOURTH to mirror `deriveAttackDamageBonus`'s order. A
    // `return` placed past the three arms above it would strand them silently,
    // because those sentences are exercised by different suites entirely.
    expect(
      deriveAttackDamageMultiplier("This attack does 20 damage for each damage counter on this Pokémon."),
    ).toEqual({ per: 20, count: { kind: "damageCountersOnSelf" } });
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
    // …and the arms placed AFTER the new one, which is the half a bad insertion
    // point breaks rather than the half above it.
    expect(
      deriveAttackDamageMultiplier(
        "This attack does 10 damage for each damage counter on all of your Benched Pokémon.",
      ),
    ).toEqual({ per: 10, count: { kind: "damageCountersOnYourBench" } });
    expect(
      deriveAttackDamageMultiplier(
        "This attack does 30 damage for each of your opponent's Benched Pokémon.",
      ),
    ).toEqual({ per: 30, count: { kind: "opponentBenchCount" } });
  });

  it("🛑 REFUSES THE ADDITIVE SIBLING, and the additive reader refuses this one", () => {
    // The whole discriminator is one word, and it must cut BOTH ways: an anchor
    // that dropped the ` more ` requirement would make `deriveAttackDamageBonus`
    // and this reader answer the same string, and attack.ts's `damageBonus !== null
    // || …` ladder would then silently pick the additive fold for a `20×` printing.
    // All four printed "more" amounts are swept, not just the one this file names.
    // The 10-per member is spelled out as a CONSTANT rather than only generated, so
    // the template below is checked against a string transcribed off a real row
    // instead of standing in for one (D183's paraphrase rule).
    expect(`This attack does 10 more damage for each damage counter on your opponent's Active Pokémon.`).toBe(
      SECOND_BITE,
    );
    for (const per of [10, 30, 40, 50]) {
      const more = `This attack does ${per} more damage for each damage counter on your opponent's Active Pokémon.`;
      expect(deriveAttackDamageMultiplier(more), more).toBeNull();
      expect(deriveAttackDamageBonus(more), more).toEqual({
        per,
        count: { kind: "damageCountersOnOpponentActive" },
      });
    }
    expect(deriveAttackDamageBonus(DAMAGE_BEAT)).toBeNull();
    expect(deriveAttackDamagePenalty(DAMAGE_BEAT)).toBeNull();
  });

  it("is DISJOINT from the SELF-side twin on the same fold, in both directions", () => {
    // `damageCountersOnSelf` and `damageCountersOnOpponentActive` tally the same
    // resource off two bodies at the same amount here, so the literal tail is the
    // only thing between them and a reader that widened it would answer both
    // sentences with the wrong body — invisible in every count and wrong on every
    // board.
    expect(deriveAttackDamageMultiplier(BALLOON_BLAST)).toEqual({
      per: 20,
      count: { kind: "damageCountersOnSelf" },
    });
    expect(deriveAttackDamageMultiplier(DAMAGE_BEAT)?.count.kind).toBe(
      "damageCountersOnOpponentActive",
    );
  });

  it("⚠️ AT MOST ONE of the three readers answers ANY attack in the pool", () => {
    // The sweep `opponentCounterScaling.test.ts` and `selfCounterMultiply.test.ts`
    // both run, re-run over a pool that now contains the BARE opponent-side sentence
    // — which is the whole reason it is repeated here rather than trusted. attack.ts
    // guards each reader on its predecessors having declined; that guard is free
    // precisely because this holds (D157: an invisible guard is paid for with an
    // assertion, not a comment).
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
    expect(deriveAttackEffect(DAMAGE_BEAT)).toBeNull();
  });

  it("refuses a printed 0, and every near-miss the anchor exists for", () => {
    // The zero guard every arm in both families carries: 20 × 0 units and 0 × N
    // units are different facts, and a printed 0 must stay LOUD rather than claim a
    // simulated sentence that can never do anything.
    expect(deriveAttackDamageMultiplier(DAMAGE_BEAT.replace(" 20 ", " 0 "))).toBeNull();
    for (const near of [
      // a lowercased first word
      DAMAGE_BEAT.replace("This", "this"),
      // no trailing period
      DAMAGE_BEAT.slice(0, -1),
      // leading text
      `Flip a coin. ${DAMAGE_BEAT}`,
      // trailing text
      `${DAMAGE_BEAT} Discard an Energy from this Pokémon.`,
      // a real Pokémon with a lookalike é would fall off the path silently
      DAMAGE_BEAT.replace("Pokémon", "Pokemon"),
      // the "less" spelling of THIS count source — ZERO rows in all three columns
      // of the remote D1 (2026-08-24), so it is an absence, and it is refused
      // because a SIGN is a FOLD and this reader owns only one
      UNPRINTED_PENALTY,
      // the BENCH-wide neighbour — the opponent's Bench counted as COUNTERS is
      // printed NOWHERE (same run, same three columns), and the sentence
      // `BENCH_COUNTER_MULTIPLY` really does read names YOUR Bench with an "all of"
      "This attack does 20 damage for each damage counter on your opponent's Benched Pokémon.",
      // the possessive dropped: "your opponent" is not a body
      DAMAGE_BEAT.replace("opponent's Active", "opponent Active"),
    ]) {
      expect(deriveAttackDamageMultiplier(near), near).toBeNull();
    }
  });

  it("🛑 THE 'less' SPELLING IS AN ABSENCE ON ALL THREE READERS — re-measured, not inherited", () => {
    // The rung this slice keeps from D168's set, with its premise CHECKED against
    // today's population rather than trusted because it sat beside a claim that
    // turned out false. Zero rows for `less damage for each damage counter on your
    // opponent` across `attacks_json`, `abilities_json` and `effect` on the remote
    // D1 (3,786 rows, 2026-08-24). It can still go RED: widening
    // `SELF_COUNTER_PENALTY`'s tail off the literal `on this Pokémon.` reddens the
    // third line, and either scaling anchor losing its adjective slot reddens one of
    // the first two.
    expect(deriveAttackDamageMultiplier(UNPRINTED_PENALTY)).toBeNull();
    expect(deriveAttackDamageBonus(UNPRINTED_PENALTY)).toBeNull();
    expect(deriveAttackDamagePenalty(UNPRINTED_PENALTY)).toBeNull();
    // …and the SELF-side "less" sentence, which IS printed, still reads — the
    // control that stops the three lines above passing because the penalty reader
    // stopped working altogether (D412's rule: the half that was already correct is
    // the control).
    expect(
      deriveAttackDamagePenalty("This attack does 20 less damage for each damage counter on this Pokémon."),
    ).toEqual({ per: 20, count: { kind: "damageCountersOnSelf" } });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — the census, SWEPT out of the pool rather than listed.
// ─────────────────────────────────────────────────────────────────────────────

describe("§3 — the census, discovered from the population", () => {
  it("is exactly TWO fixture attacks on this count source at this fold", () => {
    // D145's move (D147/D159/D161/D163/D167's inheritance): discover the producers
    // by deriving every attack in the pool, so a third printing added without a case
    // fails HERE rather than silently joining.
    //
    // ⚠️ WHAT THIS SWEEP DOES NOT TRAVERSE, said rather than left: it enumerates
    // `FIXTURE_POOL`, so a CATALOG row with no fixture is invisible to it — and
    // there IS one, `sv08-210`, which is `fix-flapple`'s own Illustration Rare and
    // carries byte-identical text. It reads ATTACK text only, so an Ability printing
    // would not appear. The catalog side is crossed only by `catalogManifest.test.ts`.
    const found: string[] = [];
    for (const [id, card] of Object.entries(FIXTURE_POOL)) {
      for (const [index, attack] of (card.attacks ?? []).entries()) {
        const multiply = deriveAttackDamageMultiplier(attack.effect ?? "");
        if (multiply?.count.kind === "damageCountersOnOpponentActive") {
          found.push(`${id}[${index}] ${attack.name}`);
        }
      }
    }
    expect(found.sort()).toEqual(["fix-flapple[0] Acidic Spit", "fix-glalie[0] Damage Beat"]);
  });

  it("…and D168's ADDITIVE producers are asserted beside them, UNMOVED", () => {
    // The count source is now read by TWO folds, so both lists are swept together: a
    // reader that started answering its neighbour's sentence would move a name
    // between them, and no assertion on the new printings alone can see that. The
    // additive list is D168's, digit for digit, which is the claim that this slice
    // took nothing away from it.
    const by = (read: (text: string) => { count: { kind: string } } | null): string[] => {
      const found: string[] = [];
      for (const [id, card] of Object.entries(FIXTURE_POOL)) {
        for (const [index, attack] of (card.attacks ?? []).entries()) {
          if (read(attack.effect ?? "")?.count.kind === "damageCountersOnOpponentActive") {
            found.push(`${id}[${index}]`);
          }
        }
      }
      return found.sort();
    };
    expect(by(deriveAttackDamageBonus)).toEqual(["sv01-095[0]", "sv03-086[0]", "sv06.5-025[0]"]);
    expect(by(deriveAttackDamageMultiplier)).toEqual(["fix-flapple[0]", "fix-glalie[0]"]);
    // The third fold has NO producer on this count source and that is the absence
    // §2 measured — pinned here as an empty list so it is swept, not recalled.
    expect(by(deriveAttackDamagePenalty)).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — the fold: `per × counters` IS the damage and the printed base is DROPPED.
// ─────────────────────────────────────────────────────────────────────────────

describe("§4 — per × the DEFENDER's counters as the WHOLE damage", () => {
  it("does 20 PER COUNTER for Glalie, and the printed 20 does NOT also land", () => {
    // 3 counters × 20 = 60, reported as base 0 / scaled 60. Were the printed "20×"
    // base kept (folded like the additive twin) it would be 80 — one board tells the
    // two folds apart, on a count source both of them read.
    const { state: after, events } = swing(board("glalie", "fix-titan", 3), "glalie");
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ base: 0, scaled: 60, dealt: 60 });
    expect(after.players.p2.active?.damage).toBe(90); // the 30 it already had, plus 60
  });

  it("…and the SAME sentence on the SECOND card, at a different cost and type", () => {
    // Flapple pays {C} where Glalie pays {W}, is Dragon where Glalie is Water, and
    // has 80 HP where Glalie has 120 — so a reader keyed on anything but the TEXT
    // passes one of these two and fails the other.
    const { events } = swing(board("flapple", "fix-titan", 3), "flapple");
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ base: 0, scaled: 60, dealt: 60 });
  });

  it("scales LINEARLY off the counter ladder — 1, 3 and 10 counters, one body", () => {
    // Three points on one line pin `Math.floor(defender.damage / 10) * per`: a fold
    // that counted HP rather than COUNTERS, or that clamped, or that read a
    // constant, agrees with at most one of them. 10 counters is 200 damage on top of
    // the 100 already there, which fix-titan's 340 HP survives — so the arithmetic
    // stands alone with no Knock Out in the way.
    for (const [counters, dealt] of [
      [1, 20],
      [3, 60],
      [10, 200],
    ] as const) {
      expect(find(swing(board("glalie", "fix-titan", counters), "glalie").events, "DAMAGE_DEALT")?.dealt).toBe(
        dealt,
      );
    }
  });

  it("🛑 AT ZERO COUNTERS THERE IS NO `DAMAGE_DEALT` AT ALL — and that is CORRECT", () => {
    // The base-drop tell, and the inherited second-order behaviour this suite is
    // written knowing: `scaledBase` is 0 for a multiply and `scaledTotal` is 0 at
    // count 0, so attack.ts's `scaledBase + scaledTotal > 0` guard skips the whole
    // §8.5 pipeline. The attack really does 0 damage against a PRISTINE Active. Were
    // the printed base kept it would deal 20 — so the ABSENT row is what pins the
    // drop, and the attack is still USED, which is the half an early return breaks.
    const { state: after, events } = swing(board("glalie", "fix-titan"), "glalie");
    expect(find(events, "DAMAGE_DEALT")).toBeUndefined();
    expect(find(events, "KNOCKED_OUT")).toBeUndefined();
    expect(after.players.p2.active?.damage).toBe(0);
    // …and the sentence is STILL not flagged: read text that resolves to nothing is
    // simulated text (D140's rule — loudness is owed to UNREAD text).
    expect(find(events, "ATTACK_EFFECT_SKIPPED")).toBeUndefined();
    // The attack was USED: the turn passed to the opponent.
    expect(after.phase).toMatchObject({ kind: "turn:action", seat: "p2" });
  });

  it("counts the DEFENDER's counters, never the attacker's", () => {
    // The mirror defect, and the sharpest one available here: the same resource is
    // readable off two bodies, so a reader that took `attacker.damage` would deal
    // 300 on this board AND would pass every zero-counter case above, because on
    // those boards both bodies are pristine.
    let state = board("glalie", "fix-titan");
    state = setDamage(state, "p1", 100); // 10 counters on the ATTACKER, 0 on the defender
    const { state: after, events } = swing(state, "glalie");
    expect(find(events, "DAMAGE_DEALT")).toBeUndefined();
    expect(after.players.p2.active?.damage).toBe(0);
    expect(after.players.p1.active?.damage).toBe(100);
  });

  it("reads the counters at DECLARATION, so this attack cannot bootstrap its own", () => {
    // The site every member of the family counts at, and the one that MATTERS most
    // on this member: the counters are on the body this attack is about to damage,
    // so a mid-pipeline re-read would see the 60 it just dealt and score 180.
    const { state: after, events } = swing(board("glalie", "fix-titan", 3), "glalie");
    expect(find(events, "DAMAGE_DEALT")?.scaled).toBe(60);
    expect(after.players.p2.active?.damage).toBe(90);
  });

  it("leaves index 1 ALONE when it carries NO effect — Flapple's Speed Dive", () => {
    // "Speed Dive" has no `effect` key at all. A fold keyed on the CARD rather than
    // on the declared attack's text would turn this printed 70 into 20 × 3.
    const { events } = swing(board("flapple-dive", "fix-titan", 3), "flapple-dive");
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ base: 70, dealt: 70 });
    expect(find(events, "DAMAGE_DEALT")?.scaled).toBeUndefined();
    expect(find(events, "ATTACK_EFFECT_SKIPPED")).toBeUndefined();
  });

  it("…and Glalie's index 1 keeps its OWN, DIFFERENT live mechanism intact", () => {
    // The sharper form of the same negative: "Crazy Headbutt" is a live
    // `discardEnergy` program, so this board asserts that index 0's fold neither
    // leaks INTO a simulated sibling nor displaces it. Base 140 lands whole and
    // UNSCALED — a fold keyed on the card would report 60 here — and the sibling's
    // OWN program then PARKS for the player to pick which of the three attached
    // Energy to discard, which is the strongest available form of "the other
    // mechanism still ran".
    const before = board("glalie-headbutt", "fix-titan", 3);
    expect(before.players.p1.active?.energy).toHaveLength(3);
    const { state: after, events } = swing(before, "glalie-headbutt");
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ base: 140, dealt: 140 });
    expect(find(events, "DAMAGE_DEALT")?.scaled).toBeUndefined();
    expect(after.phase.kind).toBe("effect:choose");
    // The Energy is UNTOUCHED because the op is WAITING, not because it vanished —
    // the distinction a bare `toHaveLength(3)` would blur, and the reason the phase
    // is asserted beside it (D416: a park that nothing counts candidates for reads
    // as covered).
    expect(after.players.p1.active?.energy).toHaveLength(3);
    expect(find(events, "ATTACK_EFFECT_SKIPPED")).toBeUndefined();
  });

  it("🛑 BOTH FOLDS ON ONE COUNT SOURCE, ONE COUNTER TOTAL, ONE BOARD", () => {
    // The claim of the whole slice, driven rather than argued. Two bodies against
    // the same clean 340 HP defender at FIVE counters:
    //   "20 damage for each…"      (Glalie)  → 0 + 100 = 100, base DROPPED
    //   "30+, 10 more for each…"   (Dedenne) → 30 + 50  =  80, base KEPT
    // One word apart in the print, two different rows out of the engine — and the
    // totals are deliberately unequal, which they are not at three counters.
    const at5 = (attacker: Attacker) =>
      find(swing(board(attacker, "fix-titan", 5), attacker).events, "DAMAGE_DEALT");
    expect(at5("glalie")).toMatchObject({ base: 0, scaled: 100, dealt: 100 });
    expect(at5("dedenne")).toMatchObject({ base: 30, scaled: 50, dealt: 80 });
    // …and neither row carries the SUBTRACTING field, which is what makes the folds
    // distinguishable to a reader of the RECORD and not just to this test.
    expect(at5("glalie")?.debuff).toBeUndefined();
    expect(at5("dedenne")?.debuff).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — the ORDER: the whole damage is folded BEFORE Weakness.
// ─────────────────────────────────────────────────────────────────────────────

describe("§5 — the fold lands BEFORE Weakness, and there is no base underneath it", () => {
  it("doubles the SCALED number, not a printed base that is not there", () => {
    // Glalie (WATER) into fix-water-weak (200 HP, ×2 Water) at 3 counters:
    // (0 + 60) × 2 = 120, which 200 HP survives with the 30 already on it (150), so
    // no Knock Out hides the arithmetic. A fold that kept the printed base would
    // report 160; one that doubled before scaling has nothing to double.
    const { state: after, events } = swing(board("glalie", "fix-water-weak", 3), "glalie");
    const row = find(events, "DAMAGE_DEALT");
    expect(row).toMatchObject({ base: 0, scaled: 60, dealt: 120 });
    expect(row?.weakness).toEqual({ op: "multiply", amount: 2 });
    expect(after.players.p2.active?.damage).toBe(150);
    expect(find(events, "KNOCKED_OUT")).toBeUndefined();
  });

  it("…and the oracle is derived from the ROW's OWN fields", () => {
    // D147's move (D149/D161/D163/D167's inheritance): re-derive the number the
    // engine reported from the fields that row carries, rather than from the
    // constants this test was written with — so a fold that changed BOTH the number
    // and the reported base would still be caught.
    const row = find(swing(board("glalie", "fix-water-weak", 3), "glalie").events, "DAMAGE_DEALT");
    if (row === undefined) throw new Error("no damage row");
    const raw = row.base + (row.scaled ?? 0) + (row.bonus ?? 0);
    expect(row.weakness).not.toBeNull();
    expect(raw * 2).toBe(row.dealt);
    // The base is REPORTED as 0 rather than merely unused — the drop is visible in
    // the record, which is what a replaying client reads.
    expect(row.base).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — VOICE.
// ─────────────────────────────────────────────────────────────────────────────

describe("§6 — the crumb, rendered under BOTH seats and READ", () => {
  it("renders the WHOLE damage as ` · scaled +60` off a base of 0", () => {
    // The inherited crumb, driven so it is not mistaken for a defect later: this
    // fold has no base, so the number after "scaled +" IS the damage rather than an
    // increment on something. Every existing `×` member already reads this way,
    // which is exactly why NO NEW ARM was added to log.ts — and why the log was
    // GREPPED for a `×`-fold claim a dropped base could falsify, and holds none.
    const { state: after, events } = swing(board("glalie", "fix-water-weak", 3), "glalie");
    const row = rendered(after, events).find((r) => r.text.startsWith("dealt "));
    expect(row?.who).toBe("p1");
    expect(row?.text).toBe("dealt 120 damage to fix-water-weak · scaled +60 · weakness ×2");
  });

  it("renders the SAME sequence when the attacking seat is p2", () => {
    // `DAMAGE_DEALT.seat` owns the DAMAGED Pokémon and log.ts renders the line under
    // `otherSeat(seat)` — a hardcoded seat would look right on exactly one of these.
    const { state: after, events } = swing(
      board("glalie", "fix-water-weak", 3, "p2"),
      "glalie",
      "p2",
    );
    const row = rendered(after, events).find((r) => r.text.startsWith("dealt "));
    expect(row?.who).toBe("p2");
    expect(row?.text).toBe("dealt 120 damage to fix-water-weak · scaled +60 · weakness ×2");
  });

  it("says nothing at all against a PRISTINE Active — there is no row to speak", () => {
    // Loudness is owed to UNREAD text (D140). A clause that resolved to 0 must not
    // print a damage line, and must not print a "not simulated" one either.
    const { state: after, events } = swing(board("glalie", "fix-titan"), "glalie");
    expect(rendered(after, events).some((r) => r.text.startsWith("dealt "))).toBe(false);
    expect(rendered(after, events).some((r) => r.text.includes("not simulated"))).toBe(false);
  });

  it("⚠️ AND THE PRINTED TEXT STOPS BEING FLAGGED — on both cards", () => {
    // Before this slice both printings emitted ATTACK_EFFECT_SKIPPED carrying the
    // whole sentence AND the "×" damage marker. `effectSimulated` and
    // `modifierSimulated` are both written `scaling !== null || …` — where `scaling`
    // is `damageBonus ?? damageMultiplier` — so both terms already subsumed this
    // reader and NEITHER needed a diff. Asserted rather than assumed, on both cards
    // and at a counter total where the fold does something.
    for (const attacker of ["glalie", "flapple"] as const) {
      expect(
        find(swing(board(attacker, "fix-titan", 3), attacker).events, "ATTACK_EFFECT_SKIPPED"),
      ).toBeUndefined();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §7 — the structural answers, and the persisted question.
// ─────────────────────────────────────────────────────────────────────────────

describe("§7 — the structural answers", () => {
  it("🛑 `MATCH_RECORD_VERSION` STAYS 26, and it is DRIVEN rather than reasoned", () => {
    // ⚠️ `MATCH_RECORD_VERSION` IS NOT EXPORTED FROM THIS PACKAGE (it lives in
    // `apps/api/src/lobby/match.ts`), so the claim is DRIVEN, the way D421 and D422
    // drove theirs. The bump trigger at this address is a persisted structure
    // gaining or renaming a required field; this slice writes NOTHING — the clause
    // is CATALOG text read at declaration by a pure function of the current state.
    //
    // THE DRIVE: build the board, ROUND-TRIP IT THROUGH JSON (which is what
    // persistence actually does to it), and replay the attack. If this slice had
    // added anything to the persisted shape, the replayed board would either differ
    // from the live one or produce a different row.
    const live = board("glalie", "fix-titan", 3);
    const persisted = JSON.parse(JSON.stringify(live)) as GameState;
    const liveRow = find(swing(live, "glalie").events, "DAMAGE_DEALT");
    const replayedRow = find(swing(persisted, "glalie").events, "DAMAGE_DEALT");
    expect(replayedRow).toEqual(liveRow);
    expect(replayedRow).toMatchObject({ base: 0, scaled: 60, dealt: 60 });
    // …and the in-play Pokémon's KEY SET is unmoved, asserted as a LITERAL rather
    // than as a diff between two boards of ONE build — a diff is blind to a key that
    // grew on both (D279). Every entry here was added by some earlier slice; what
    // this pin says is that none of them was added HERE.
    const active = live.players.p1.active;
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
        "evolvedTurn",
        "healedTurn",
        "installedRecoil",
        "lockedAttacks",
        "markers",
        // 🆕🆕 D432 — the attack-installed §8.5 NO-WEAKNESS bar's stamp (MATCH_RECORD_VERSION 26 -> 27).
        "noWeaknessTurn",
        "promotedTurn",
        "retreatBlocked",
        "retreatLockedTurn",
        "scheduledEffect",
        "stack",
        "tools",
        "turnPlayed",
        "usedAttack",
      ].sort(),
    );
  });

  it("…and the EVENT this fold emits is key-for-key a SHIPPED sentence's event", () => {
    // The other half of the no-bump question, and the one the key set above cannot
    // answer: `DAMAGE_DEALT` is what a replaying client reads, so a new field on it
    // would be a wire change even though `InPlayPokemon` never moved. Compared
    // against D168's ADDITIVE twin on the SAME defender — a sentence that shipped at
    // 0.113.0 — rather than against a literal list, so the control is a real row.
    const mine = find(swing(board("glalie", "fix-titan", 3), "glalie").events, "DAMAGE_DEALT");
    const shipped = find(swing(board("dedenne", "fix-titan", 3), "dedenne").events, "DAMAGE_DEALT");
    if (mine === undefined || shipped === undefined) throw new Error("no damage row");
    expect(Object.keys(mine).sort()).toEqual(Object.keys(shipped).sort());
  });

  it("GATES NO ACTION — the attack is still offered when it would deal 0", () => {
    // Checked rather than assumed (D157's rule): the clause says nothing about
    // legality or cost, so `redactedAttacksOf` must keep offering it on the board
    // where it does literally nothing — refusing there would be the engine inventing
    // a rule the card does not print. Both payability projections read the same
    // `attacks` array, and `GameHud.tsx` takes no diff because no new field reaches it.
    const state = board("glalie", "fix-titan"); // pristine defender → 0 damage
    const view = redactGame(state, "p1").phase;
    if (view.kind !== "turn:action") throw new Error(`expected turn:action, got ${view.kind}`);
    expect(view.attacks).toHaveLength(2);
    expect(view.attacks[0]).toMatchObject({ index: 0, name: "Damage Beat", playable: true });
    expect(applyAction(state, { type: "attack", seat: "p1", index: 0 }).ok).toBe(true);
  });

  it("never mutates the state it was given (purity)", () => {
    const state = board("glalie", "fix-titan", 3);
    deepFreeze(state);
    expect(() => applyAction(state, { type: "attack", seat: "p1", index: 0 })).not.toThrow();
  });

  it("the engine version moved with the behaviour", () => {
    expect(engineVersion).toBe("0.379.0");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §8 — the cast, and the deck is 60.
// ─────────────────────────────────────────────────────────────────────────────

describe("§8 — the cast", () => {
  it("the deck is 60 cards and the pool holds every id in it", () => {
    expect(OPPONENT_COUNTER_MULTIPLY_DECK).toHaveLength(60);
    for (const id of new Set(OPPONENT_COUNTER_MULTIPLY_DECK)) {
      expect(FIXTURE_POOL[id], id).toBeDefined();
    }
  });

  it("⚠️ NEITHER BODY EXISTED BEFORE THIS SLICE, and no neighbour could stand in", () => {
    // Swept rather than listed: every body in the pool printing this count source
    // carried an ADJECTIVE before this slice, so there was no bare-form fixture to
    // reuse and nothing to bend. A sixth adjectived printing added later joins the
    // right-hand set on its own.
    const bare: string[] = [];
    const adjectived: string[] = [];
    for (const [id, card] of Object.entries(FIXTURE_POOL)) {
      for (const [index, attack] of (card.attacks ?? []).entries()) {
        const text = attack.effect ?? "";
        if (!text.includes("damage counter on your opponent's Active Pokémon")) continue;
        (text.includes(" more damage") || text.includes(" less damage") ? adjectived : bare).push(
          `${id}[${index}]`,
        );
      }
    }
    expect(bare.sort()).toEqual(["fix-flapple[0]", "fix-glalie[0]"]);
    expect(adjectived.sort()).toEqual(["sv01-095[0]", "sv03-086[0]", "sv06.5-025[0]"]);
  });
});
