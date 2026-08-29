import { describe, expect, it } from "vitest";
import { applyDamageModifier } from "./cards";
import type { DamageModifier } from "./cards";
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
  OPPONENT_COUNTER_DECK,
  attachFromDeck,
  clearBench,
  driveSetup,
  expectErr,
  must,
  mustApply,
  setActiveFromDeck,
  setDamage,
} from "./testFixtures";

// 0.112.0 → 0.113.0 — the OPPONENT-SIDE damage-counter count (P3-M5 long tail,
// D168), the FIFTH `DamageCountSource` and the first one that mirrors a member the
// union already had:
//
//   "This attack does 10 more damage for each damage counter on your opponent's
//    Active Pokémon."      (Dedenne sv01-095 "Second Bite" idx 0, {P}{C}, "30+")
//                     (Espeon sv03-086 "Psychic Assault" idx 0, {P}, "30+")
//   "This attack does 30 more damage for each damage counter on your opponent's
//    Active Pokémon."  (Bloodmoon Ursaluna sv06.5-025 "Mad Bite" idx 0,
//                       {F}{F}{C}, "100+")
//
// ⚠️ TWO POPULATIONS, SWEPT SEPARATELY (D156's rule), AND THE COUNTS ARE
// MEASUREMENTS. The local D1 (2026-08-03, 978 rows / 6 sets — sv01 258, sv02 279,
// sv03 230, sv06.5 99, sve 24, swsh10.5 88) returns FOUR rows for
// `LIKE '%damage counter on your opponent%'` across all three text columns. THREE
// are `attacks_json` and are this family, all three carrying "more"; the fourth is
// Trevenant sv03-012's Ability "Forest Miasma" ("During Pokémon Checkup, if this
// Pokémon is in the Active Spot, put 1 damage counter on your opponent's Active
// Pokémon."), a PLACEMENT rather than a scaling clause, refused three times over.
//
// 🛑 🆕 **D423 — AND "TWO POPULATIONS" WAS THE RIGHT HEADING FOR THE WRONG PAIR.**
// The two swept here are the LOCAL SIX-SET CATALOG and `FIXTURE_POOL`. The
// population the ENGINE runs on is neither: it is `legal_standard = 1` (2,021 of
// 3,786 rows / 20 sets), and against it the same literal returns **NINETEEN** rows,
// not four — five distinct attack sentences on this count source. Every figure in
// the block above is EXACT on the population it names and is a **FLOOR** against
// the engine's. That is not a footnote here: a rung further down this file pinned
// the multiply spelling as *"an ABSENCE … anywhere in the pool"* on exactly this
// scope, and it was **wrong when it was written** — three Standard-legal printings
// (Glalie `sv06-052`, Flapple `sv08-139`/`sv08-210`, both in sets the local catalog
// has never held) were sitting in the legal column the whole time. D423 read them
// with one regex and one `if`. **A SCOPED COUNT IS HONEST; A SCOPED COUNT WRITTEN
// UP AS A UNIVERSAL IS A REFUSAL WITH NO EXPIRY DATE** — conventions.md's D413 rule,
// paid here.
// `FIXTURE_POOL` is a different population that also fields synthetic `fix-*`
// bodies the catalog will never hold; swept for the same string before this slice
// it returned ZERO rows — no card, no sentence, and no body whose damage had ever
// been read from the DEFENDING side. All three fixtures are authored fresh.
//
// ⚠️ 3 PRINTINGS BUT ONLY 2 DISTINCT SENTENCES, AND THE DUPLICATE IS THE POINT.
// Dedenne and Espeon print the 10-per sentence byte for byte on two different
// cards, at two different costs, on two different stages. A reader keyed on
// anything but the TEXT — an id, a stage, a cost — would satisfy a one-card suite
// and fail here; and one `(\d+)` capture has to span 10 and 30 or a hardcoded
// per-unit satisfies two printings and fails the third (D121's second-printing
// warrant, met by the pool rather than by a synthetic body).
//
// ⚠️ THE INHERITED PRICING — "one regex + one evaluator arm" — IS WRONG ON THE
// COUNT AND RIGHT ON THE SHAPE. It is FOUR edits: the regex, a reader arm in
// `deriveAttackDamageBonus`, a new `DamageCountSource` member, and the evaluator
// arm. What it is right about is that nothing else moves. `scaledAttackDamage`
// ALREADY takes `(attacker, bonus, state, defenderSeat, attackerSeat)` for the
// Prize and retreat-cost members, so reading `state.players[defenderSeat].active
// .damage` needed NO new argument and NO signature change — the arm is
// byte-identical in shape to the `opponentActiveRetreatCost` one beside it,
// null-Active guard included. And `scaledAttackDamage` is the repo's ONLY
// exhaustive switch over the union (nothing in log.ts, redact.ts, phaseView.ts or
// apps/web dispatches on it), so a fifth member costs exactly one arm.
//
// ⚠️ AND IT IS A `count` MEMBER WHERE D163's ONE-WORD-DIFFERENT SENTENCE WAS A
// WHOLE NEW READER. This family splits by FOLD (D163: `+` keeps the printed base,
// `×` drops it, `−` keeps it and subtracts). This sentence carries "more", so its
// fold is the one `deriveAttackDamageBonus` already performs — what varies is
// WHICH RESOURCE is tallied, which is exactly what `DamageCountSource` is for. The
// inverse answer to the inverse question, on sentences that differ by one word
// each time.

/** The two printed sentences, byte-for-byte off the local D1 rows (2026-08-03,
    978 rows / 6 sets). The possessive is ASCII U+0027 and the é in `Pokémon` is
    U+00E9 — hex-verified on the rows, not eyeballed. */
const SECOND_BITE =
  "This attack does 10 more damage for each damage counter on your opponent's Active Pokémon.";
const MAD_BITE =
  "This attack does 30 more damage for each damage counter on your opponent's Active Pokémon.";
/** The SELF-side twin, printed on seven catalog rows and read since M2 — the
    sentence whose only difference from `SECOND_BITE` is the body it counts, and
    which must keep landing on the OTHER count member. */
const RAGING_HORNS = "This attack does 10 more damage for each damage counter on this Pokémon.";
/** The self-side SUBTRACTIVE twin (D163, Skeledirge ex / Cetitan) — the same
    resource at the other sign, owned by a different reader entirely. */
const BURNING_VOICE = "This attack does 10 less damage for each damage counter on this Pokémon.";
/** The self-side MULTIPLY twin (Drifloon sv01-089, Onix swsh10.5-036) — printed,
    unread, and refused here by the same literal tail. */
const BALLOON_BLAST = "This attack does 30 damage for each damage counter on this Pokémon.";
/** 🛑 **D423 — THIS CONSTANT'S DOC WAS FALSE FROM THE DAY IT WAS WRITTEN, AND ITS
    OLD NAME (`UNPRINTED_MULTIPLY`) IS WHY NOBODY LOOKED.** It used to read *"Printed
    NOWHERE in the pool (the D1 sweep returns three attack rows and all three carry
    'more'), so it is an absence rather than an unread printing."* The sweep behind
    that sentence was D168's, and D168's decision row names its own scope: *"measured
    against the local D1 (2026-08-03, **978 cards / 6 sets**)"*. The multiply twin IS
    printed — *"This attack does **20** damage for each damage counter on your
    opponent's Active Pokémon."*, **3 Standard-legal printings** on Glalie `sv06-052`
    and Flapple `sv08-139`/`sv08-210` — and `sv06` and `sv08` have never been among
    those six sets. The assertion kept passing because the string it tested carries
    `per = 30`, an amount nothing prints, so a TRUE assertion stood in for a FALSE
    claim for the whole of its life.

    **(a) WRONG WHEN WRITTEN, NOT (b) OVERTAKEN BY A RE-INGEST** — settled rather
    than assumed. D168's four-row figure is EXACT against those six sets. The legal
    attack column has not churned since: D219 re-derived every population denominator
    to D187's digit (640 sentences / 1,732 units / 60,467 chars), `censusAtHead.test.ts`
    has quoted that triple since D233, and `censusAttackCorpus.ts` committed it at
    D274 (`a7e9a57`) with the `20` row already present. And D183 records that
    `api.tcgdex.net` is refused by this runner's network policy, so no agent here
    could have re-ingested anything. This is D413's *two populations, two answers*
    biting a PINNED ABSENCE instead of a refusal.

    The string is KEPT and RENAMED to what it actually is: the amount nothing prints
    on a sentence shape that IS printed. It is now used to say something true and
    falsifiable — the arm reads it, because a text parser serves the reprint the day
    one is ingested (D187) — instead of to deny that the shape exists. */
const UNPRINTED_AMOUNT_ON_A_PRINTED_SHAPE =
  "This attack does 30 damage for each damage counter on your opponent's Active Pokémon.";
/** The amount that IS printed on that shape — 3 legal printings, read since D423 by
    `deriveAttackDamageMultiplier` and driven in `opponentCounterMultiply.test.ts`. */
const DAMAGE_BEAT =
  "This attack does 20 damage for each damage counter on your opponent's Active Pokémon.";

/** One seed for the whole suite. Nothing in this family flips a coin, every Active
    is placed by surgery, and the single flip in the deck (Espeon's index-1 "Psy
    Bolt") deals its 60 on either face — so a seed table would describe a shuffle
    rather than a rule (D143's move, D147/D163's inheritance). */
const SEED = 5;

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

/** Every attacker this suite declares, with the printed INDEX and the energy its
    cost needs — read off the local D1 per printing (D144's rule). */
const ATTACKERS = {
  dedenne: {
    card: "sv01-095",
    index: 0,
    energy: [
      { id: "fix-psychic-energy", count: 1 },
      { id: "fix-energy", count: 1 },
    ],
  }, // "Second Bite" ({P}{C}, "30+", 10 more per counter on the DEFENDER)
  espeon: { card: "sv03-086", index: 0, energy: [{ id: "fix-psychic-energy", count: 1 }] }, // "Psychic Assault" ({P}, "30+"): the SAME sentence, second card
  "espeon-bolt": {
    card: "sv03-086",
    index: 1,
    energy: [
      { id: "fix-psychic-energy", count: 1 },
      { id: "fix-energy", count: 1 },
    ],
  }, // "Psy Bolt" ({P}{C}, 60): the sibling attack that must NOT inherit the clause
  ursaluna: {
    card: "sv06.5-025",
    index: 0,
    energy: [
      { id: "fix-fighting-energy", count: 2 },
      { id: "fix-energy", count: 1 },
    ],
  }, // "Mad Bite" ({F}{F}{C}, "100+", 30 more per counter)
} as const;

type Attacker = keyof typeof ATTACKERS;

/** `by`'s opponent opens and passes, so the attacking seat carries no §4
    first-turn restriction. Both bodies are placed by surgery and BOTH benches are
    cleared: the number this family reads is taken off the DEFENDING Active at
    declaration, and a stray displaced body is a silent extra Ability source. */
function board(attacker: Attacker, defender: string, by: Seat = "p1"): GameState {
  const opener = by === "p1" ? "p2" : "p1";
  let state = must(
    applyAction(
      driveSetup(SEED, { p1: OPPONENT_COUNTER_DECK, p2: OPPONENT_COUNTER_DECK }, { first: opener }),
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

/** …with `counters × 10` damage already on the DEFENDING Active, which is the
    board this whole family is only observable on. */
function damaged(attacker: Attacker, defender: string, counters: number, by: Seat = "p1") {
  const opener = by === "p1" ? "p2" : "p1";
  return setDamage(board(attacker, defender, by), opener, counters * 10);
}

function swing(state: GameState, attacker: Attacker, seat: Seat = "p1") {
  return mustApply(state, { type: "attack", seat, index: ATTACKERS[attacker].index });
}

/** TEST SURGERY: empty `seat`'s Active Spot, parking its cards in the discard so
    every uid stays in exactly one zone. The one edge the new evaluator arm has to
    answer for directly — the live attack gate guarantees a Defending Pokémon, so
    no board reachable through `attack` can present a null Active here
    (conditionalDamage.test.ts's helper, reused). */
function clearActive(state: GameState, seat: Seat): GameState {
  const side = state.players[seat];
  const active = side.active;
  if (active === null) return state;
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: {
        ...side,
        active: null,
        discard: [...side.discard, ...active.stack, ...active.energy, ...active.tools],
      },
    },
  };
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
// The data: three catalog rows, re-queried rather than recognised.
// ─────────────────────────────────────────────────────────────────────────────

describe("the printed data — three fresh fixtures, whole", () => {
  it("carries Dedenne sv01-095's WHOLE printed card", () => {
    expect(FIXTURE_POOL["sv01-095"]).toMatchObject({
      name: "Dedenne",
      category: "Pokemon",
      stage: "Basic",
      hp: 70,
      types: ["Psychic"],
      retreat: 1,
      weaknesses: [{ type: "Metal", value: "×2" }],
    });
    // The WHOLE list, so the fixture cannot be wrong by OMISSION (D156's failure
    // mode) and so no later slice indexes into a short one. The printed damage
    // marker is a trailing "+" — the sign this family's reader consumes.
    expect(FIXTURE_POOL["sv01-095"]?.attacks).toEqual([
      {
        cost: ["Psychic", "Colorless"],
        name: "Second Bite",
        effect: SECOND_BITE,
        damage: "30+",
      },
    ]);
    expect(FIXTURE_POOL["sv01-095"]?.abilities ?? null).toBeNull();
    expect(FIXTURE_POOL["sv01-095"]?.resistances ?? null).toBeNull();
  });

  it("…Espeon sv03-086's, INCLUDING the sibling attack and the Resistance", () => {
    expect(FIXTURE_POOL["sv03-086"]).toMatchObject({
      name: "Espeon",
      stage: "Stage1",
      evolveFrom: "Eevee",
      hp: 110,
      types: ["Psychic"],
      retreat: 1,
      weaknesses: [{ type: "Darkness", value: "×2" }],
      resistances: [{ type: "Fighting", value: "-30" }],
    });
    expect(FIXTURE_POOL["sv03-086"]?.attacks).toEqual([
      { cost: ["Psychic"], name: "Psychic Assault", effect: SECOND_BITE, damage: "30+" },
      {
        cost: ["Psychic", "Colorless"],
        name: "Psy Bolt",
        effect: "Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed.",
        damage: 60,
      },
    ]);
    expect(FIXTURE_POOL["sv03-086"]?.abilities ?? null).toBeNull();
  });

  it("…and Bloodmoon Ursaluna sv06.5-025's, Ability and all", () => {
    expect(FIXTURE_POOL["sv06.5-025"]).toMatchObject({
      name: "Bloodmoon Ursaluna",
      stage: "Basic",
      hp: 150,
      types: ["Fighting"],
      retreat: 4,
      weaknesses: [{ type: "Grass", value: "×2" }],
    });
    expect(FIXTURE_POOL["sv06.5-025"]?.attacks).toEqual([
      {
        cost: ["Fighting", "Fighting", "Colorless"],
        name: "Mad Bite",
        effect: MAD_BITE,
        damage: "100+",
      },
    ]);
    // Carried rather than dropped: an omitted Ability owes an `INCOMPLETE`
    // declaration in catalogManifest.test.ts, and this one is simply unsimulated —
    // an on-play-to-Bench attach with no registry row, never on a path here because
    // every board below places the body by surgery.
    expect(FIXTURE_POOL["sv06.5-025"]?.abilities).toEqual([
      {
        type: "Ability",
        name: "Battle-Hardened",
        effect:
          "When you play this Pokémon from your hand onto your Bench during your turn, you may attach up to 2 Basic {F} Energy cards from your hand to this Pokémon.",
      },
    ]);
  });

  it("⚠️ TWO OF THE THREE PRINT THE SAME SENTENCE, BYTE FOR BYTE", () => {
    // The whole warrant for fielding both. Dedenne is a 70 HP Basic costing
    // {P}{C}; Espeon is a 110 HP Stage 1 costing {P} with a Resistance and a second
    // attack. Nothing about the two CARDS is the same, and the one thing that is,
    // is the only thing the engine reads.
    const dedenne = FIXTURE_POOL["sv01-095"]?.attacks?.[0]?.effect;
    const espeon = FIXTURE_POOL["sv03-086"]?.attacks?.[0]?.effect;
    expect(dedenne).toBe(espeon);
    expect(dedenne).toBe(SECOND_BITE);
    // …and the third differs in exactly one number.
    expect(MAD_BITE).toBe(SECOND_BITE.replace(" 10 ", " 30 "));
  });

  it("AUTHORS no ATTACK — all three printings are read off the TEXT", () => {
    // The deriver is the whole mechanism for this DAMAGE clause: no `attack` map
    // entry and no passive. A registry-authored attack would win over the reader
    // (D8), so this is the claim that says the text path is the one driven below.
    //
    // ⚠️ **D250 — THIS ASSERTION READ `programFor(id)` FLAT AND EXPIRED, WHICH IS
    // IT WORKING.** `programFor` answers for a whole CARD, and D250 gave
    // `sv06.5-025` a registry row for its ABILITY ("Battle-Hardened", the
    // `onPlayToBench` attach). Nothing about the damage clause changed — but a
    // whole-card absence was never the claim this test wanted to make, and the
    // moment any OTHER column of the same card got built it said something false.
    // **Re-homed to the field it is actually about (`.attack`), not deleted** —
    // the standing rule, now paid by ten slices running. The Ability's presence is
    // asserted POSITIVELY beside it, so this test can never go quiet: an author
    // who deletes the registry row to make the line above pass has to break this
    // one too.
    // 🆕 **AN ABSENCE ASSERTED ON A WHOLE OBJECT EXPIRES WHEN ANY FIELD OF IT IS
    // FILLED; AN ABSENCE ASSERTED ON A FIELD EXPIRES ONLY WHEN THAT FIELD IS.**
    for (const id of ["sv01-095", "sv03-086", "sv06.5-025"] as const) {
      expect(programFor(id)?.attack, `${id} grew a registry attack`).toBeUndefined();
      expect(programFor(id)?.passive, `${id} grew a registry passive`).toBeUndefined();
    }
    expect(programFor("sv01-095")).toBeUndefined();
    expect(programFor("sv03-086")).toBeUndefined();
    // …and the one card that DOES carry a row carries exactly the D250 trigger.
    expect(programFor("sv06.5-025")?.triggered?.[0]?.name).toBe("Battle-Hardened");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The reader.
// ─────────────────────────────────────────────────────────────────────────────

describe("deriveAttackDamageBonus — one regex, two amounts, a fifth count member", () => {
  it("reads BOTH printed sentences as damageCountersOnOpponentActive", () => {
    expect(deriveAttackDamageBonus(SECOND_BITE)).toEqual({
      per: 10,
      count: { kind: "damageCountersOnOpponentActive" },
    });
    expect(deriveAttackDamageBonus(MAD_BITE)).toEqual({
      per: 30,
      count: { kind: "damageCountersOnOpponentActive" },
    });
    // Not hard-coded to either printed amount — the per-counter number is captured.
    expect(deriveAttackDamageBonus(SECOND_BITE.replace(" 10 ", " 70 "))).toEqual({
      per: 70,
      count: { kind: "damageCountersOnOpponentActive" },
    });
  });

  it("⚠️ IS DISJOINT FROM THE SELF-COUNTER PATTERNS IN BOTH DIRECTIONS", () => {
    // The claim the regex's doc block makes, asserted rather than argued.
    // SELF_COUNTER_SCALE and SELF_COUNTER_PENALTY are the only other patterns in
    // the file carrying the words "damage counter"; all three are `^…$`-anchored
    // and the two self ones end in the LITERAL `on this Pokémon.`, so neither side
    // needs a negative lookahead to refuse the other. A first-match-wins hazard
    // here would be silent in exactly one direction, which is why BOTH are driven.
    expect(deriveAttackDamageBonus(RAGING_HORNS)).toEqual({
      per: 10,
      count: { kind: "damageCountersOnSelf" },
    });
    expect(deriveAttackDamagePenalty(SECOND_BITE)).toBeNull();
    expect(deriveAttackDamagePenalty(MAD_BITE)).toBeNull();
    expect(deriveAttackDamageBonus(BURNING_VOICE)).toBeNull();
    expect(deriveAttackDamageBonus(BALLOON_BLAST)).toBeNull();
    expect(deriveAttackDamageMultiplier(SECOND_BITE)).toBeNull();
    expect(deriveAttackDamageMultiplier(MAD_BITE)).toBeNull();
    // …and the self-side reader still answers its own sentence with its own member,
    // which is the half a shared-tail regex would have broken invisibly.
    expect(deriveAttackDamagePenalty(BURNING_VOICE)).toEqual({
      per: 10,
      count: { kind: "damageCountersOnSelf" },
    });
  });

  it("⚠️ AT MOST ONE of the three readers answers ANY attack in the pool", () => {
    // attack.ts reads the three scaling families in sequence and guards each on its
    // predecessors having declined. That guard stays free only while the regexes
    // are disjoint, and this slice added a fourth "damage counter" sentence to the
    // file — so the sweep that proved it for D163 is re-run over the pool as it now
    // stands, with three new fixtures in it.
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
    for (const text of [SECOND_BITE, MAD_BITE]) expect(deriveAttackEffect(text)).toBeNull();
  });

  it("refuses a printed 0, and every near-miss the anchors exist for", () => {
    // The zero guard every arm in this family carries: a 0 adds nothing, so it must
    // stay LOUD rather than claim a simulated sentence that does nothing.
    expect(deriveAttackDamageBonus(SECOND_BITE.replace(" 10 ", " 0 "))).toBeNull();
    for (const near of [
      // a lowercased first word
      SECOND_BITE.replace("This", "this"),
      // no trailing period
      SECOND_BITE.slice(0, -1),
      // leading text
      `Flip a coin. ${SECOND_BITE}`,
      // trailing text
      `${SECOND_BITE} Discard an Energy from this Pokémon.`,
      // a real Pokémon with a lookalike é would fall off the path silently
      SECOND_BITE.replace("Pokémon", "Pokemon"),
      // the "less" spelling of THIS count source — unprinted, and refused here
      // because a sign is a FOLD and this reader owns only one.
      // ⚠️ 🆕 D423 — **RE-MEASURED RATHER THAN INHERITED, BECAUSE IT SAT BESIDE A
      // CLAIM THAT TURNED OUT FALSE.** The multiply absence pinned below this list
      // was a six-set artefact; this one is not. `less damage for each damage counter
      // on your opponent` returns **ZERO rows** across `attacks_json`,
      // `abilities_json` and the flat `effect` column of the remote D1 (3,786 rows /
      // 20 sets, 2026-08-24). It HOLDS on the population the engine runs on.
      SECOND_BITE.replace(" more ", " less "),
      // the BENCH-wide neighbour — ✅ READ SINCE D170, and this string differs from
      // the real printing (Tyranitar swsh10.5-043) on BOTH axes: it carries "more"
      // where the printing has no adjective, and it names the OPPONENT's Bench where
      // the printing says "all of YOUR Benched Pokémon". Unchanged and still null.
      "This attack does 10 more damage for each damage counter on your opponent's Benched Pokémon.",
      // ⚠️ 🆕 D423 — RE-MEASURED WITH THE OTHERS: the opponent's Bench counted as
      // COUNTERS is printed on ZERO rows in all three columns of the remote D1
      // (2026-08-24), at either fold. That absence HOLDS too; only the multiply one
      // did not.
      //
      // Trevenant sv03-012's Ability, the one other catalog row in any text column
      // carrying this possessive beside a damage counter — a PLACEMENT.
      // ⚠️ 🆕 D423 — "the one other" IS SIX-SET-SCOPED, like everything else in this
      // block. Against the remote D1 the SINGULAR literal `damage counter on your
      // opponent` still returns Trevenant as the only non-attack row, but the PLURAL
      // spelling returns three more Abilities (`svp-129`, `svp-149`, `sv09-021`) and
      // roughly twenty more attacks — and Trevenant itself is now
      // `legal_standard = 0`. The three-way refusal below is unaffected; the word
      // "one" is what needed the scope.
      "During Pokémon Checkup, if this Pokémon is in the Active Spot, put 1 damage counter on your opponent's Active Pokémon.",
    ]) {
      expect(deriveAttackDamageBonus(near)).toBeNull();
    }
  });

  it("🛑 the MULTIPLY twin of THIS family IS PRINTED and IS READ — D423 retired the absence", () => {
    // 🛑 WHAT THIS RUNG USED TO SAY, and why the replacement is not merely an
    // inversion of it. The old title read *"the MULTIPLY twin of THIS family is an
    // ABSENCE, not an unread printing"* and its comment claimed *"There is no
    // no-adjective printing of this count source anywhere in the pool"*, on D168's
    // SIX-SET sweep. Three Standard-legal printings say otherwise (see
    // `UNPRINTED_AMOUNT_ON_A_PRINTED_SHAPE` above for the evidence that settles
    // WHICH failure it was). The rung is re-pointed rather than deleted, and D418's
    // second half is what decides its content: **after re-pointing, ask what the OLD
    // claim could catch that the new one cannot.**
    //
    // The old claim's real discriminating power was on the ADDITIVE anchor — it
    // asserted that a sentence WITHOUT "more" is refused by `deriveAttackDamageBonus`,
    // which is what stops `OPPONENT_COUNTER_SCALE` quietly losing its adjective slot
    // and swallowing the `×` printings into the wrong fold. That half is KEPT, on the
    // amount that is actually printed. What is added is the positive it could never
    // make. Both lines can go RED: drop ` more ` from `OPPONENT_COUNTER_SCALE` and the
    // second reddens; delete `OPPONENT_COUNTER_MULTIPLY`'s arm and the first does.
    expect(deriveAttackDamageMultiplier(DAMAGE_BEAT)).toEqual({
      per: 20,
      count: { kind: "damageCountersOnOpponentActive" },
    });
    expect(deriveAttackDamageBonus(DAMAGE_BEAT)).toBeNull();
    expect(deriveAttackDamagePenalty(DAMAGE_BEAT)).toBeNull();
    expect(deriveAttackEffect(DAMAGE_BEAT)).toBeNull();
    // …and the ADDITIVE sentences this suite is about still land on the ADDITIVE
    // reader, which is the control that stops the two `toBeNull`s above passing
    // because `deriveAttackDamageBonus` stopped working altogether (D412's rule).
    expect(deriveAttackDamageBonus(SECOND_BITE)?.per).toBe(10);
    expect(deriveAttackDamageMultiplier(SECOND_BITE)).toBeNull();
  });

  it("…and an amount NOTHING prints is still claimed by the arm — a parser is not a list", () => {
    // The constant this file used to call `UNPRINTED_MULTIPLY`, saying something
    // true. `per = 30` on this shape is printed on no card in the 3,786-row remote
    // D1 (2026-08-24, all three text columns), and the arm reads it anyway, because
    // a deriver arm is a TEXT PARSER and serves every reprint of its sentence the day
    // one is ingested — D187's rule, which is exactly what makes an arm worth more
    // than a registry row. Stated here so a successor does not read the arm's reach
    // as a census.
    expect(deriveAttackDamageMultiplier(UNPRINTED_AMOUNT_ON_A_PRINTED_SHAPE)).toEqual({
      per: 30,
      count: { kind: "damageCountersOnOpponentActive" },
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The census, SWEPT out of the pool rather than listed.
// ─────────────────────────────────────────────────────────────────────────────

describe("the census — discovered from the population, not enumerated", () => {
  it("is exactly THREE fixture attacks, and they are the family", () => {
    // D145's move (D147/D159/D161/D163's inheritance): discover the producers by
    // deriving every attack in the pool, so a fourth printing added without a case
    // fails HERE.
    //
    // ⚠️ WHAT THIS SWEEP DOES NOT TRAVERSE, said rather than left: it enumerates
    // `FIXTURE_POOL`, so a CATALOG row with no fixture is invisible to it, and it
    // reads ATTACK text only, so an Ability printing of the same sentence would not
    // appear — which is exactly what Trevenant sv03-012's "Forest Miasma" is. The
    // catalog side is crossed only by `catalogManifest.test.ts`.
    const found: string[] = [];
    for (const [id, card] of Object.entries(FIXTURE_POOL)) {
      for (const [index, attack] of (card.attacks ?? []).entries()) {
        const bonus = deriveAttackDamageBonus(attack.effect ?? "");
        if (bonus?.count.kind === "damageCountersOnOpponentActive") {
          found.push(`${id}[${index}] ${attack.name}`);
        }
      }
    }
    expect(found.sort()).toEqual([
      "sv01-095[0] Second Bite",
      "sv03-086[0] Psychic Assault",
      "sv06.5-025[0] Mad Bite",
    ]);
  });

  it("…and the SELF-side twin's producers are asserted beside them, unmoved", () => {
    // The two members tally the SAME resource off two different bodies, so the
    // sharpest thing that can go wrong is one list absorbing the other. A reader
    // that started answering both would collapse these two sweeps into one, and no
    // assertion on a single sentence can see that.
    const found: string[] = [];
    for (const [id, card] of Object.entries(FIXTURE_POOL)) {
      for (const [index, attack] of (card.attacks ?? []).entries()) {
        const bonus = deriveAttackDamageBonus(attack.effect ?? "");
        if (bonus?.count.kind === "damageCountersOnSelf") found.push(`${id}[${index}]`);
      }
    }
    expect(found.sort()).toEqual([
      "fix-attacker[3]",
      "fix-attacker[4]",
      "sv01-032[0]", // Arcanine ex "Raging Claws" — carried since D173
      "sv02-028[0]",
      "sv03-161[0]",
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The fold — ADDITIVE, so the printed base is KEPT.
// ─────────────────────────────────────────────────────────────────────────────

describe("the fold — the printed base is KEPT and `per × counters` is added to it", () => {
  it("⚠️ ADDS NOTHING against a PRISTINE Active, and the printed base lands whole", () => {
    // The zero-counter board, driven on all three printings. This is the case the
    // MULTIPLY fold would get wrong in the loudest possible way — it drops the base,
    // so a pristine defender would take 0 from every one of these — and it is the
    // one a `+`/`×` mix-up cannot survive. `scaled` is absent, not 0: the field's
    // presence guard is `scaledTotal > 0`.
    for (const [attacker, base] of [
      ["dedenne", 30],
      ["espeon", 30],
      ["ursaluna", 100],
    ] as const) {
      const { state, events } = swing(board(attacker, "fix-titan"), attacker);
      const row = find(events, "DAMAGE_DEALT");
      expect(row, attacker).toMatchObject({ base, dealt: base });
      expect(row?.scaled, attacker).toBeUndefined();
      expect(state.players.p2.active?.damage, attacker).toBe(base);
    }
  });

  it("adds 10 PER COUNTER for Dedenne…", () => {
    const { events } = swing(damaged("dedenne", "fix-titan", 3), "dedenne");
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ base: 30, scaled: 30, dealt: 60 });
  });

  it("…the SAME 10 for Espeon, off the SAME sentence on a different card…", () => {
    // The second printing of one sentence: same amount, same member, same fold, on
    // a body that shares nothing else with Dedenne.
    const { events } = swing(damaged("espeon", "fix-titan", 3), "espeon");
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ base: 30, scaled: 30, dealt: 60 });
  });

  it("…and 30 PER COUNTER for Bloodmoon Ursaluna, off ONE regex", () => {
    // TWO amounts on one capture: a hardcoded per-unit satisfies two printings and
    // fails this one, which is D121's second-printing warrant met by the pool.
    const { events } = swing(damaged("ursaluna", "fix-titan", 3), "ursaluna");
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ base: 100, scaled: 90, dealt: 190 });
  });

  it("scales LINEARLY, and the oracle is re-derived from the row's own fields", () => {
    // D147's move: re-derive the number the engine reported from the fields the row
    // carries, rather than from the constants the test was written with — so a fold
    // that changed BOTH the number and the reported base would still be caught.
    for (const counters of [0, 1, 2, 5, 6]) {
      const row = find(
        swing(damaged("ursaluna", "fix-titan", counters), "ursaluna").events,
        "DAMAGE_DEALT",
      );
      if (row === undefined) throw new Error("no damage row");
      expect(row.scaled ?? 0, `${counters} counters`).toBe(30 * counters);
      expect(row.dealt, `${counters} counters`).toBe(row.base + (row.scaled ?? 0));
    }
  });

  it("⚠️ COUNTS THE DEFENDER'S COUNTERS, NEVER THE ATTACKER'S", () => {
    // The mirror-member trap, and the one mistake that passes every zero-counter
    // case above: `damageCountersOnSelf` and `damageCountersOnOpponentActive` read
    // the identical field off two different bodies. So the attacker is damaged and
    // the defender is not — an arm wired to `attacker.damage` scores 90 here.
    let state = board("ursaluna", "fix-titan");
    state = setDamage(state, "p1", 90);
    const { events } = swing(state, "ursaluna");
    expect(find(events, "DAMAGE_DEALT")?.scaled).toBeUndefined();
    expect(find(events, "DAMAGE_DEALT")?.dealt).toBe(100);
  });

  it("…and BOTH bodies damaged still scores only the DEFENDER's", () => {
    // The separating board: 9 counters on the attacker, 3 on the defender. Self
    // would be 270, the sum would be 360, the right answer is 90.
    let state = damaged("ursaluna", "fix-titan", 3);
    state = setDamage(state, "p1", 90);
    expect(find(swing(state, "ursaluna").events, "DAMAGE_DEALT")).toMatchObject({
      base: 100,
      scaled: 90,
      dealt: 190,
    });
  });

  it("⚠️ READS THE COUNT AT DECLARATION — this attack cannot bootstrap its own bonus", () => {
    // The site every member of the family counts at. On a pristine defender the
    // attack deals its printed 30 and LEAVES the body at 30 damage — if the count
    // were read after the hit landed, the same swing would have scored 30 + 30.
    // Same board, two readings, 30 HP apart.
    const { state, events } = swing(board("dedenne", "fix-titan"), "dedenne");
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ base: 30, dealt: 30 });
    expect(state.players.p2.active?.damage).toBe(30);
    // …and the very next declaration against that same total does score it.
    expect(
      find(swing(damaged("dedenne", "fix-titan", 3), "dedenne").events, "DAMAGE_DEALT")?.dealt,
    ).toBe(60);
  });

  it("leaves index 1 ALONE — a sibling attack does not inherit the clause", () => {
    // Espeon's "Psy Bolt" is a plain 60 with a coin-flip status rider. A fold keyed
    // on the CARD rather than on the declared attack's text would add 30 to it.
    const { events } = swing(damaged("espeon-bolt", "fix-titan", 3), "espeon-bolt");
    const row = find(events, "DAMAGE_DEALT");
    expect(row).toMatchObject({ base: 60, dealt: 60 });
    expect(row?.scaled).toBeUndefined();
    // …and its own printed text is still simulated, so nothing went loud either.
    expect(find(events, "ATTACK_EFFECT_SKIPPED")).toBeUndefined();
  });

  it("runs identically from the OTHER seat", () => {
    // Nothing in the arm is p1-shaped: `defenderSeat` is the attacker's opposite,
    // and a hard-coded seat would look right on exactly one of these two.
    const { events } = swing(damaged("ursaluna", "fix-titan", 3, "p2"), "ursaluna", "p2");
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ base: 100, scaled: 90, dealt: 190 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The null Active — the arm's guard, and why it is unreachable.
// ─────────────────────────────────────────────────────────────────────────────

describe("the null-Active branch — total rather than covering a case", () => {
  it("⚠️ CANNOT BE REACHED THROUGH `attack`: the gate refuses first, with NO_TARGET", () => {
    // The arm reads `state.players[defenderSeat].active` and answers 0 when it is
    // null, exactly as the `opponentActiveRetreatCost` arm beside it does. That
    // branch keeps the switch total; it does not cover a board. §8's defender gate
    // runs BEFORE the §8.5 pipeline, so an empty Active Spot is an error and never
    // a 0-damage swing — pinned here because the difference is invisible in the
    // arm itself and a later reader would otherwise have to guess which it is.
    const empty = clearActive(damaged("ursaluna", "fix-titan", 3), "p2");
    expect(empty.players.p2.active).toBeNull();
    expectErr(empty, { type: "attack", seat: "p1", index: 0 }, "NO_TARGET");
  });

  it("…and the same board with the Active restored scores normally", () => {
    // The control, so the case above is refused for the reason claimed and not
    // because the board was broken by the surgery.
    expect(
      find(swing(damaged("ursaluna", "fix-titan", 3), "ursaluna").events, "DAMAGE_DEALT"),
    ).toMatchObject({ base: 100, scaled: 90, dealt: 190 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The ORDER, mutated rather than assumed.
// ─────────────────────────────────────────────────────────────────────────────

describe("the ORDER — BEFORE Weakness, and the KO moves with the number", () => {
  it("adds before the ×2, and the right order KOs a body the reversed one does not", () => {
    // Bloodmoon Ursaluna (FIGHTING) into Tyranitar ex (340 HP, ×2 Fighting) at 2
    // counters:
    //   correct   (100 + 60) × 2 = 320 — onto 20 already there, exactly 340: a KO
    //   reversed   100 × 2  + 60 = 260 — onto 20, 280: alive with 60 HP left
    // Two observables move together, and the second is not a number a reader can
    // talk themselves into.
    const { state, events } = swing(damaged("ursaluna", "sv03-066", 2), "ursaluna");
    const row = find(events, "DAMAGE_DEALT");
    expect(row).toMatchObject({ base: 100, scaled: 60, dealt: 320 });
    expect(row?.weakness).toEqual({ op: "multiply", amount: 2 });
    expect(find(events, "KNOCKED_OUT")).toBeDefined();
    expect(state.players.p2.active).toBeNull();
  });

  it("…and the oracle is derived from the ROW's OWN fields, in both placements", () => {
    // One counter fewer, so the body survives and the two placements are two live
    // numbers rather than a KO and a number.
    const row = find(swing(damaged("ursaluna", "sv03-066", 1), "ursaluna").events, "DAMAGE_DEALT");
    if (row === undefined) throw new Error("no damage row");
    const weakness: DamageModifier | null = row.weakness;
    const before = applyDamageModifier(row.base + (row.scaled ?? 0), weakness);
    const after = applyDamageModifier(row.base, weakness) + (row.scaled ?? 0);
    expect(before).toBe(row.dealt);
    expect(after).not.toBe(row.dealt);
    expect([before, after]).toEqual([260, 230]);
  });

  it("⚠️ a RESISTANCE cannot witness the order, and the board says so instead", () => {
    // Espeon's −30 Fighting Resistance is a SUBTRACTION, and subtraction commutes
    // with the fold's addition: `(100 + 30) − 30` and `(100 − 30) + 30` are both
    // 100. So this board is not an order witness and is not written as one. What it
    // does show is the scaled total carrying a defender PAST a subtractive W/R term
    // it had survived a moment earlier: 70 at zero counters, 100 at one, and 110 HP
    // between them.
    const clean = find(swing(board("ursaluna", "sv03-086"), "ursaluna").events, "DAMAGE_DEALT");
    expect(clean).toMatchObject({ base: 100, dealt: 70 });
    expect(clean?.scaled).toBeUndefined();
    expect(clean?.resistance).toEqual({ op: "subtract", amount: 30 });

    const { state, events } = swing(damaged("ursaluna", "sv03-086", 1), "ursaluna");
    expect(find(events, "DAMAGE_DEALT")).toMatchObject({ base: 100, scaled: 30, dealt: 100 });
    expect(find(events, "KNOCKED_OUT")).toBeDefined();
    expect(state.players.p2.active).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// VOICE.
// ─────────────────────────────────────────────────────────────────────────────

describe("VOICE — the existing `scaled` crumb, rendered under BOTH seats and READ", () => {
  it("reads `· scaled +90` under the ATTACKER's name", () => {
    // NO NEW ARM: `scaled` is the ADDING half of the pre-W/R step and log.ts has
    // rendered it since 0.35.0 — this member reaches the reader through the field
    // the family already reports, which is the whole reason a new count source
    // costs no event work. `DAMAGE_DEALT.seat` owns the DAMAGED Pokémon (D136's
    // finding 1) and log.ts renders the line under `otherSeat(seat)`.
    const { state, events } = swing(damaged("ursaluna", "fix-titan", 3), "ursaluna");
    const row = rendered(state, events).find((r) => r.text.startsWith("dealt "));
    expect(row?.who).toBe("p1");
    expect(row?.text).toBe("dealt 190 damage to fix-titan · scaled +90");
  });

  it("renders the SAME sequence when the attacking seat is p2", () => {
    const { state, events } = swing(damaged("ursaluna", "fix-titan", 3, "p2"), "ursaluna", "p2");
    const row = rendered(state, events).find((r) => r.text.startsWith("dealt "));
    expect(row?.who).toBe("p2");
    expect(row?.text).toBe("dealt 190 damage to fix-titan · scaled +90");
  });

  it("says nothing at all when the defender is pristine", () => {
    // Loudness is owed to UNREAD text (D140); a fold that added nothing must not
    // print a crumb saying it did. The `scaledTotal > 0` presence guard, read from
    // the other end.
    const { state, events } = swing(board("ursaluna", "fix-titan"), "ursaluna");
    const row = rendered(state, events).find((r) => r.text.startsWith("dealt "));
    expect(row?.text).toBe("dealt 100 damage to fix-titan");
  });

  it("⚠️ AND THE PRINTED TEXT STOPS BEING FLAGGED — all three printings, both terms", () => {
    // Before this slice all three emitted ATTACK_EFFECT_SKIPPED carrying the whole
    // sentence AND the "+" damage marker. `scaling !== null` already covers both
    // terms of that row's guard, so this slice changed no line in attack.ts's flag
    // logic — which is a claim worth driving rather than asserting, because a fifth
    // count member that did NOT reach `scaling` would leave three printings loudly
    // flagged for text the engine now resolves.
    for (const attacker of ["dedenne", "espeon", "ursaluna"] as const) {
      const { events } = swing(damaged(attacker, "fix-titan", 3), attacker);
      expect(find(events, "ATTACK_EFFECT_SKIPPED"), attacker).toBeUndefined();
    }
    // …and on the pristine board too, where the clause resolves to nothing: the
    // text is still SIMULATED, which is the distinction D140 draws.
    for (const attacker of ["dedenne", "espeon", "ursaluna"] as const) {
      expect(
        find(swing(board(attacker, "fix-titan"), attacker).events, "ATTACK_EFFECT_SKIPPED"),
        attacker,
      ).toBeUndefined();
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
    // FIELD, no state field. `DamageCountSource` is a parse-time type that lives in
    // effects.ts and never reaches `GameState`, which is why a new member of it —
    // unlike D165's changed `InPlayPokemon` field — buys no bump at all. Pinned as
    // an ABSENCE (D161's move), the only way a no-bump claim is checkable.
    // (`MATCH_RECORD_VERSION` itself lives in `apps/api/src/lobby/match.ts` and is
    // pinned by `match.test.ts`; the engine cannot import it, so the assertion this
    // side can make is the one that would FORCE the bump.)
    const active = board("ursaluna", "fix-titan").players.p1.active;
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

  it("GATES NO ACTION — the attack is still offered against a pristine Active", () => {
    // Checked rather than assumed (D157's rule): the clause says nothing about
    // legality or cost, so `redactedAttacksOf` must keep offering it on the board
    // where it adds literally nothing. Both payability projections read the same
    // `attacks` array, and `GameHud.tsx` takes no diff because no new field reaches
    // it.
    const state = board("espeon", "fix-titan");
    const view = redactGame(state, "p1").phase;
    if (view.kind !== "turn:action") throw new Error(`expected turn:action, got ${view.kind}`);
    expect(view.attacks).toHaveLength(2);
    expect(view.attacks[0]).toMatchObject({ index: 0, name: "Psychic Assault", playable: true });
    expect(applyAction(state, { type: "attack", seat: "p1", index: 0 }).ok).toBe(true);
  });
});
