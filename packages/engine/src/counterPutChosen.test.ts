import { describe, expect, it } from "vitest";
import { attackReaderSurface, legalAttackCorpus, resolvedByAnyReader } from "./censusAttackCorpus";
import { applyAction, deriveAttackEffect, engineVersion } from "./index";
import type { EffectOp, GameEvent, GameState, PokemonRef } from "./index";
import {
  COUNTER_PUT_CHOSEN_DECK,
  attachFromDeck,
  attachToolFromDeck,
  benchFromDeck,
  clearBench,
  driveSetup,
  mustApply,
  setActiveFromDeck,
  setBenchDamage,
  setDamage,
} from "./testFixtures";

// 0.350.0 → 0.351.0 — 🆕🆕🆕 **D449: THE PUT-COUNTER VERB WITH A CHOSEN TARGET.**
//
// TWO sentences, TWO legal printings, ZERO new mechanisms:
//   · `censusAttackCorpus.ts` line **413** — *"Put 2 damage counters on 1 of your
//     opponent's Pokémon."*, **1 legal printing**, arm 23b;
//   · line **83** — *"Choose 2 of your opponent's Pokémon and put 3 damage counters on
//     each of them."*, **1 legal printing**, arm 23c.
// Both derive to `damageChosen { target: "opponentAny", source: "attack" }` with `deals`
// ABSENT — the literal arm 25's FIRST OP has emitted since D143. **ZERO new ops, ZERO
// new op FIELDS, ZERO new readers, prompt kinds, choice kinds, events, error codes,
// `CardFilter`/`DamageCountSource` members, `GameState` fields, registry rows,
// `packages/schema` bytes or `redact.ts` bytes.** Two anchors, two arms, one fixture.
//
// 🛑🛑 **THE WORK ORDER'S CENTRAL PREMISE DID NOT SURVIVE ITS FIRST GREP, AND NEITHER
// DID THE SHIPPED DOC BLOCK THAT PUT IT THERE.** The brief said *"no anchor claims the
// put-counter chosen-target verb at all"*. THREE already did — `COUNTER_PUT_ON_DEFENDER`
// (the opponent's Active), `COUNTER_PUT_ON_OPPONENT_BENCH` (*"1 of"* their Bench) and
// `COUNTER_SPREAD_ON_OPPONENT` (the distribution) — and a FOURTH,
// `COUNTER_PUT_ANY_THEN_SELF_LOCK`, claims this slice's exact sentence with a second
// sentence riding it. The verb was readable at four addresses; what was missing was the
// BARE any-zone spelling, and the reason it was missing is written into
// `effects.ts` at the compound's anchor: D143 measured *"it is NOT printed as a
// standalone sentence ANYWHERE in the pool"* against the **local D1
// (978 cards / 6 sets, 2026-08-02)** and concluded *"which is why there is no bare
// any-zone anchor"*.
// The engine's population is `legal_standard = 1`, where the sentence has carried 1
// printing since the column was committed. **Two populations, two answers, biting a
// REFUSAL instead of a census (D413) — and the refusal then stood as the reason not to
// build, for a hundred and six decisions.**
//
// ⚠️ **THE COST THAT WAS NOT IN THE PRICE: A NEW ANCHOR IS A NEAR-TWIN, AND FOUR
// SHIPPED RUNGS ASSERTED THIS SENTENCE DERIVES TO `null`** (`attackLock.test.ts`,
// `counterPut.test.ts`, `counterBenchPut.test.ts`, `scaledAnySnipe.test.ts`). Every one
// was RE-POINTED rather than deleted, and each kept the discrimination its old claim
// provided by asserting the derived op is the OTHER anchor's rather than nothing at all
// (D418's second half).
//
// 🛑 **`MATCH_RECORD_VERSION` STAYS 29 AND THE SITUATION IS NEITHER OF THE USUAL TWO.**
// The op PARKS, so its literal really does ride `GameState.phase.cont.pendingOp` — but
// this slice adds NO KEY to lose and NO union member to widen. It adds a PRODUCER of a
// literal the type already admitted, which is the free case, and §3 drives that over
// the serialized bytes in three directions rather than asserting it.

function find<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e) => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

/** The two printed sentences, transcribed byte for byte off the committed column. */
const BARE = "Put 2 damage counters on 1 of your opponent's Pokémon.";
const CHOSEN = "Choose 2 of your opponent's Pokémon and put 3 damage counters on each of them.";
/** The ONE-AXIS CONTROL and the sharpest near miss at once: `BARE` with a second
    printed sentence riding it — the shipped compound (`COUNTER_PUT_ANY_THEN_SELF_LOCK`,
    arm 25, Ninetales sv03-029/-199 "Nine-Tailed Dance"). `BARE`'s whole string is this
    one's PREFIX. ⚠️ It carries **0 legal printings today** (both ids are
    `legal_standard = 0`, which is why it is absent from `legalAttackCorpus()`); it is
    still a real printed sentence and a live anchor, and `attackLock.test.ts` drives it. */
const COMPOUND =
  "Put 9 damage counters on 1 of your opponent's Pokémon. During your next turn, this Pokémon can't attack.";
/** The BENCH sibling (arm 23, D140) — `BARE` with the zone word added. Also 0 legal
    printings today (Ting-Lu ex rotated), and also a live anchor. */
const BENCH_SIBLING = "Put 2 damage counters on 1 of your opponent's Benched Pokémon.";
/** The ACTIVE sibling (arm 22, D139) — the same verb at a spot rather than a pick. */
const ACTIVE_SIBLING = "Put 2 damage counters on your opponent's Active Pokémon.";
/** The `deals: true` twin at the SAME amount and the SAME candidate set: the shipped
    any-target snipe. It is the attribution control §4 rests on. */
const DEALS_CONTROL =
  "This attack does 20 damage to 1 of your opponent's Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)";

/** `fix-counterput`'s attack indices, named so a board reads as a sentence. */
const IDX = { bare: 0, chosen: 1, control: 2 } as const;

/** Both Actives pinned to `fix-lightning-weak` (×2 Lightning, 130 HP), P1's turn open. */
function board(seed: number): GameState {
  const state = driveSetup(
    seed,
    { p1: COUNTER_PUT_CHOSEN_DECK, p2: COUNTER_PUT_CHOSEN_DECK },
    { first: "p2", active: { p1: "fix-lightning-weak", p2: "fix-lightning-weak" } },
  );
  return mustApply(state, { type: "endTurn", seat: "p2" }).state;
}

/** P1 fields `fix-counterput` with one {L} attached (the {C} cost, and the type that
    arms Bellibolt's clause); P2 keeps its pinned Active unless `defender` replaces it,
    and its Bench holds exactly `bench`. Both benches are cleared after the Active
    surgeries, because `setActiveFromDeck` DISPLACES rather than removes. */
function fielded(
  seed: number,
  opts: { defender?: string; bench?: readonly string[] } = {},
): GameState {
  let state = setActiveFromDeck(board(seed), "p1", "fix-counterput");
  state = clearBench(state, "p1");
  state = attachFromDeck(state, "p1", "fix-lightning-energy", 1);
  if (opts.defender !== undefined) {
    state = setActiveFromDeck(state, "p2", opts.defender);
  }
  state = clearBench(state, "p2");
  for (const body of opts.bench ?? []) state = benchFromDeck(state, "p2", body);
  return state;
}

// ─────────────────────────────────────────────────────────────────────────────
// §1 — the population: what is claimed, and every refusal by name.
// ─────────────────────────────────────────────────────────────────────────────

describe("§1 — the two printed sentences, and what the placement family still refuses", () => {
  it("both are in the legal attack column at the printing counts this slice claims", () => {
    // ⚠️ A brief's printing count is a FLOOR until it is read off the corpus (D445).
    const rows = new Map(legalAttackCorpus().map(([n, s]) => [s, n]));
    expect(rows.get(BARE)).toBe(1);
    expect(rows.get(CHOSEN)).toBe(1);
    // …and the two SHIPPED anchors this slice sits between carry ZERO legal printings
    // today, which is stated rather than glossed: both their carriers have rotated out.
    // A rotated anchor is not a dead one — it is a reader whose catalog moved — and it
    // is exactly why the residue arithmetic below moves by 2 and not by 4.
    expect(rows.has(COMPOUND)).toBe(false);
    expect(rows.has(BENCH_SIBLING)).toBe(false);
  });

  it("both resolve through the reader SURFACE, and the surface did not grow", () => {
    // Asked of the SURFACE rather than of one reader (D447's own correction): both arms
    // sit inside `deriveAttackEffect`, so there is no fourteenth reader.
    for (const s of [BARE, CHOSEN]) expect(resolvedByAnyReader(s), s).toBe(true);
    expect(attackReaderSurface()).toHaveLength(13);
  });

  it("🛑 the PLACEMENT family, and the TWO rows it still refuses, each for its own reason", () => {
    // THE PATTERN, PUBLISHED SO ITS EDGES ARE VISIBLE (D424/D425): every corpus sentence
    // whose ACTION is putting damage counters — `/put \d* ?damage counters/i`, case
    // INSENSITIVE and with the count OPTIONAL, which is the loosest plausible shape.
    // ⚠️ **WHAT IT CANNOT SEE, STATED AS A QUERY THAT WAS RUN RATHER THAN A LIST THAT
    // WAS THOUGHT OF.** The /i is what catches `CHOSEN`, whose verb is lowercase and
    // mid-sentence; the optional count is what catches the *"until its remaining HP"*
    // rows, which print no number at all. A case-SENSITIVE `Put \d+` reports 16 and
    // silently drops three of the ten refusals below.
    const family = legalAttackCorpus().filter(([, t]) => /put \d* ?damage counters/i.test(t));
    expect(family).toHaveLength(19);
    expect(family.reduce((sum, [n]) => sum + n, 0)).toBe(38);
    const unbuilt = family.filter(([, t]) => !resolvedByAnyReader(t)).map(([, t]) => t);
    // 🆕🆕🆕 **D450 — TEN BECAME SEVEN, AND THE THREE THAT LEFT ARE (b), (c) AND (d)
    // BELOW.** All three were refused HERE on the OP rather than on the vocabulary, and
    // D450 spent every reason this section gave: the SEAT became `counterEachAll.side`,
    // the *"reads the BODY where the filter reads the CARD"* window became D437's
    // `damagedOnly` rider (a board fact never needed to travel through `CardFilter` at
    // all), and the provenance became `counterEachAll.source` beside a per-body
    // `effectRefused` call. **Their bullets are kept and annotated rather than deleted**,
    // because a refusal that was SPENT is the most useful kind to be able to read back.
    // 🆕🆕🆕 **D451 — SEVEN BECAME FOUR AND TWELVE BECAME SEVEN, AND THE THREE THAT LEFT
    // ARE ALL OF BULLET (e).** That bullet refused them on the AMOUNT'S SOURCE and said
    // *"nothing in the engine subtracts to a target"*, which was true of the engine and
    // not a reason: `effectiveMaxHp − damage` is the phrase's ONE shipped definition and
    // the subtraction is three characters longer. The bullet is kept and annotated.
    // ⚠️ **THE PRINTINGS FALL BY 5 WHERE THE SENTENCES FALL BY 3**, which is the first
    // time these two numbers have disagreed in this section — the HP rows carry 2, 1 and
    // 2 printings where D449's and D450's carried one each.
    // 🆕🆕 **D456 — FOUR BECAME TWO AND SEVEN BECAME FOUR, AND THE TWO THAT LEFT ARE
    // BOTH OF BULLET (f).** That bullet refused them as *"`installRecoil`'s family (a
    // durated stamp read at the §9 recoil), not a placement"* — which was exact, and is
    // exactly why they landed: they went to `installRecoil`, not to this op. The bullet is
    // kept and annotated rather than deleted.
    // ⚠️ **THE PRINTINGS FALL BY 3 WHERE THE SENTENCES FALL BY 2** for the second slice
    // running, and for the same reason: corpus line 179 carries 1 printing and line 180
    // carries 2.
    expect(unbuilt).toHaveLength(2);
    expect(
      family.filter(([, t]) => !resolvedByAnyReader(t)).reduce((sum, [n]) => sum + n, 0),
    ).toBe(4);

    // (a) THE SCALED TWIN — corpus line 412, **3 printings**, the largest unbuilt row in
    //     this family and this slice's own nearest neighbour: `BARE` with a count clause
    //     and a tail. 🛑 **ITS FIRST REFUSAL WAS SPENT BY THIS SLICE AND THE OTHER TWO
    //     WERE RE-MEASURED RATHER THAN INHERITED.** D448 refused it three ways, the
    //     first being *"no anchor claims the verb"*; that is now false. What remains:
    //     the count is `{kind: "cardsInDiscardPile", …}`, a PAYLOAD no boolean rider
    //     carries — and the tail *"Then, shuffle those Energy cards into your deck."*
    //     has no reader and the sentence has no splitter, measured directly below.
    //     Refused on the PAYLOAD and on the TAIL, and no longer on the verb.
    const SCALED_TWIN =
      "Put 2 damage counters on 1 of your opponent's Pokémon for each Basic {G} Energy card in your discard pile. Then, shuffle those Energy cards into your deck.";
    expect(unbuilt).toContain(SCALED_TWIN);
    // the head alone and the tail alone are BOTH unread — so even a collapsed rider
    // leaves the sentence unclaimed, because a whole-sentence anchor must read both.
    expect(
      deriveAttackEffect(
        "Put 2 damage counters on 1 of your opponent's Pokémon for each Basic {G} Energy card in your discard pile.",
      ),
    ).toBeNull();
    expect(deriveAttackEffect("Then, shuffle those Energy cards into your deck.")).toBeNull();
    expect(deriveAttackEffect("Shuffle those Energy cards into your deck.")).toBeNull();

    // (b) THE ONE-SEAT FOLD — line 415, 1 printing. *"…on EACH of your opponent's
    //     Pokémon."* has no pick at all, so the op is `counterEachAll` and not this
    //     one — and `counterEachAll` walks BOTH SEATS with no seat field to narrow it.
    //     Refused on the SIDE, which is a field the op does not have.
    // 🆕🆕🆕 SPENT AT D450 — the seat became `counterEachAll.side: "both" | "opponent"`,
    // a two-member enum whose values are the printed subjects, and this sentence is arm
    // 23e. The claim below is the INEQUALITY it was really making (D449's own rule
    // applied to this file's own rung): the fold is not this slice's PICK.
    expect(unbuilt).not.toContain("Put 2 damage counters on each of your opponent's Pokémon.");
    expect(
      deriveAttackEffect("Put 2 damage counters on each of your opponent's Pokémon."),
    ).not.toEqual(deriveAttackEffect(BARE));
    // (c) THE SAME FOLD BEHIND A PER-TARGET FILTER — line 414, 1 printing. Everything in
    //     (b) plus a window that reads the BODY (*"that has any damage counters on it"*)
    //     where `counterEachAll.filter` is a `CardFilter` and reads the CARD. TWO
    //     missing things, which is a different refusal from (b)'s one.
    // 🆕🆕🆕 SPENT AT D450, AND THE SECOND HALF OF THIS BULLET WAS THE WRONG BOUNDARY.
    // *"`counterEachAll.filter` is a `CardFilter` and reads the CARD"* is TRUE and is
    // not a reason to refuse the sentence: `damageChosen.damagedOnly` (D437) has read
    // these exact eight printed words off an `InPlayPokemon` since it shipped, so the
    // board fact never had to travel through the filter union. Arm 23f reuses the rider
    // verbatim. **TWO missing things really were two; one of them was in the wrong
    // place.**
    expect(unbuilt).not.toContain(
      "Put 2 damage counters on each of your opponent's Pokémon that has any damage counters on it.",
    );
    // (d) THE BOTH-SEATS ABILITY FOLD — line 418, 1 printing. 🛑 **THIS ONE IS EXPRESSIBLE
    //     TODAY AND IS STILL REFUSED, WHICH IS WHY IT NEEDS THE LONGEST REASON.**
    //     `counterEachAll { amount: 60, filter: { kind: "abilityPokemon" } }` is the
    //     sentence exactly: that op already walks BOTH seats and `abilityPokemon` already
    //     means *"has a printed Ability"*. What it would cost is three seams, none of
    //     them a reader: (i) `counterEachAll` HARDCODES `source: "ability"` in its
    //     `COUNTERS_PLACED` push, so its first ATTACK producer re-runs D136's finding 1
    //     — the defect this repo has caught three times (D138, D139, D140) and paid for
    //     each time; (ii) it makes NO `effectRefused` call, correct while every producer
    //     is a triggered Ability and a live question the moment an attack reaches it;
    //     (iii) it reaches the ATTACKER'S OWN BOARD, so a placement can Knock Out your
    //     own body and owe the opponent a Prize (D425's own-side seam). Refused on the
    //     OP'S PROVENANCE, not on the vocabulary.
    // 🆕🆕🆕 SPENT AT D450, ALL THREE SEAMS AT ONCE — and the count of them was RIGHT.
    // (i) `source` rides the op; (ii) `effectRefused` is called PER BODY, after the
    // narrowing; (iii) `side` picks the seat list. A fourth difference the bullet did
    // not name was found by reading the CONSUMER rather than the op: `log.ts`'s
    // `"attack"` arm justified its system voice with *"`seat` is the attacker's
    // OPPONENT"*, which `side: "both"` makes untrue. The row is still right; the reason
    // is wider. See `counterFold.test.ts`.
    expect(unbuilt).not.toContain(
      "Put 6 damage counters on each Pokémon that has an Ability (both yours and your opponent's).",
    );
    // (e) THE HP-TARGET ROWS — lines 425, 426 and 427, **5 printings**.
    //     🆕🆕🆕 **SPENT AT D451, AND THIS BULLET WAS RIGHT ABOUT `remainingHpWithin` AND
    //     WRONG ABOUT THE ENGINE.** It said the amount is computed from the TARGET's
    //     current HP (true), that `remainingHpWithin` is a PREDICATE answering a
    //     different question (true — it returns a boolean and D451 does not call it),
    //     and therefore that *"nothing in the engine subtracts to a target"* (a
    //     non-sequitur). *Remaining HP* has had exactly ONE definition in this engine
    //     since D349 — `effectiveMaxHp − damage` — written at three shipped sites, and
    //     the whole slice is subtracting the printed destination from it PER BODY inside
    //     a walk. **One mechanism really did serve all three rows**, which is the half
    //     the bullet got right: `counterUntilRemainingHp`, two anchors, arms 23g/23h.
    //     🛑 **AND A `toBeNull`-SHAPED CLAIM WOULD HAVE GONE GREEN ON A BROKEN BUILD**,
    //     so the rung is an INEQUALITY of derived programs: the three sentences are OUT
    //     of `unbuilt`, they derive to the new op, and they are told apart by the two
    //     fields that carry the print.
    for (const s of [
      "Put damage counters on each of your opponent's Benched Pokémon until its remaining HP is 100.",
      "Put damage counters on your opponent's Active Pokémon until its remaining HP is 10.",
      "Put damage counters on your opponent's Active Pokémon until its remaining HP is 50.",
    ]) {
      expect(unbuilt, s).not.toContain(s);
      expect(deriveAttackEffect(s)?.[0]?.op, s).toBe("counterUntilRemainingHp");
    }
    expect(deriveAttackEffect(BARE)).not.toEqual(
      deriveAttackEffect("Put damage counters on your opponent's Active Pokémon until its remaining HP is 10."),
    );
    // (f) THE CONFUSION SUBSTITUTION — 1 printing. *"Your opponent's Active Pokémon is
    //     now Confused. Put 8 damage counters instead of 3 on that Pokémon for this
    //     Special Condition."* is not a placement at all: it RAISES the Checkup's own
    //     per-condition amount, which is `SpecialConditions`' raised-tick field
    //     (types.ts) reached by a status op, not by any op in this family. Refused on
    //     the VERB, which reads as this family's only because of one shared word.
    expect(unbuilt).toContain(
      "Your opponent's Active Pokémon is now Confused. Put 8 damage counters instead of 3 on that Pokémon for this Special Condition.",
    );
    // 🛑 **AND HERE IS WHAT THE PUBLISHED PATTERN CANNOT SEE, MEASURED RATHER THAN
    // IMAGINED (D425).** `/put \d* ?damage counters/i` requires the count to sit
    // immediately before the noun, so it misses the BOUNDED spelling — corpus line 433,
    // *"Put UP TO 9 damage counters on this Pokémon. This attack does 20 damage for each
    // damage counter you placed in this way."*, 1 printing, unbuilt. `/put up to \d+
    // damage counters/i` returns exactly that ONE row over all 640, which is the query
    // that establishes the edge. It is refused twice over and neither reason is any of
    // the ten above: the pick is a NUMBER (every prompt this engine has picks cards or
    // bodies) and the second sentence counts what the first placed (D448's cross-clause
    // referent, one family over).
    const bounded = legalAttackCorpus().filter(([, t]) => /put up to \d+ damage counters/i.test(t));
    expect(bounded).toHaveLength(1);
    expect(bounded[0]?.[0]).toBe(1);
    expect(resolvedByAnyReader(bounded[0]?.[1] as string)).toBe(false);
    // (g) THE TWO REACTIVE INSTALLERS — lines 179 and 180, 3 printings between them.
    //     🆕🆕 **CLAIMED AT D456, AND THIS BULLET NAMED THE EXACT PRICE OF BOTH.** It read:
    //     *"Both are `installRecoil`'s family (a durated stamp read at the §9 recoil), not
    //     a placement now, and each is refused for its own reason: 179 is the SHIPPED
    //     sentence at line 178 with 'even if IT is Knocked Out' re-spelled 'even if THIS
    //     POKÉMON is' — a near miss on a parenthetical — and 180 reads its amount off the
    //     damage just taken."* Every clause of that survived: 179 cost ONE alternation in
    //     D152's anchor, and 180 cost one anchor plus a widened `amount` on the same op.
    //     🛑 **AND IT IS WORTH SAYING WHAT THAT MAKES THIS BULLET.** A refusal that names
    //     the family, the read site, the exact varying token AND the exact channel is not a
    //     refusal, it is a work order — and it sat here for five slices while the residue
    //     was ranked by printing count (D413's finding, at a bullet instead of a doc block).
    //     The bullet is kept and annotated rather than deleted (D418).
    for (const [text, program] of [
      [
        "During your opponent's next turn, if this Pokémon is damaged by an attack (even if this Pokémon is Knocked Out), put 6 damage counters on the Attacking Pokémon.",
        [{ op: "installRecoil", amount: 60 }],
      ],
      [
        "During your opponent's next turn, if this Pokémon is damaged by an attack (even if this Pokémon is Knocked Out), put damage counters on the Attacking Pokémon equal to the damage done to this Pokémon.",
        [{ op: "installRecoil", amount: "damageTaken" }],
      ],
    ] as const) {
      expect(unbuilt, text).not.toContain(text);
      // …and they are NOT this file's op, which is the claim the bullet was ever making
      // and the one the `toContain` could not survive the sentences being claimed.
      expect(deriveAttackEffect(text), text).toEqual(program);
      expect(deriveAttackEffect(text), text).not.toEqual(deriveAttackEffect(BARE));
    }
    // 2 + 3 + 1 + 1 + 1 + 5 + 1 + 1 = 15, which is the printing total asserted above.
    // ⚠️ The bullets are SEVEN and the rows are TEN because (e) is three rows on one
    // mechanism and (g) is two — stated so a successor does not read a miscount into the
    // difference.
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — the readers, and the four anchors that share this noun phrase.
// ─────────────────────────────────────────────────────────────────────────────

describe("§2 — two arms, and the prefix that is the whole safety property", () => {
  it("reads the BARE sentence as a count-1 opponentAny PLACEMENT", () => {
    expect(deriveAttackEffect(BARE)).toEqual([
      { op: "damageChosen", target: "opponentAny", amount: 20, count: 1, source: "attack" },
    ]);
  });

  it("reads the CHOOSE-FIRST sentence as the same op at the printed arity", () => {
    // GROUP 1 IS THE ARITY, GROUP 2 IS THE AMOUNT. The printed pair is 2 and 3, so a
    // build that transposed them would say `amount: 20, count: 3` — visible here and
    // invisible on any card printing one number twice.
    expect(deriveAttackEffect(CHOSEN)).toEqual([
      { op: "damageChosen", target: "opponentAny", amount: 30, count: 2, source: "attack" },
    ]);
  });

  it("🛑 the COMPOUND still derives TWO ops — the new anchor is not a prefix of it", () => {
    // The family's whole safety property is that an unrecognised remainder stays LOUD.
    // `BARE` is a strict prefix of `COMPOUND`, so a `^…` without `…$` on arm 23b would
    // claim Ninetales and ship an attack that places nine counters and silently drops
    // its printed drawback. Asserted from BOTH sides.
    expect(COMPOUND.startsWith(BARE.replace("2 damage", "9 damage"))).toBe(true);
    expect(deriveAttackEffect(COMPOUND)).toEqual([
      { op: "damageChosen", target: "opponentAny", amount: 90, count: 1, source: "attack" },
      { op: "preventAttack" },
    ]);
    // …and the new arm's own reading of the compound's FIRST SENTENCE is the compound's
    // first op, byte for byte. That equality is what says arm 23b added a reader and not
    // a second reading (D131: one reading, one implementation).
    expect(deriveAttackEffect("Put 9 damage counters on 1 of your opponent's Pokémon.")).toEqual([
      (deriveAttackEffect(COMPOUND) as EffectOp[])[0],
    ]);
  });

  it("🛑 the four anchors on this noun phrase stay DISJOINT, each keeping its own op", () => {
    // One noun phrase, four readings, and the difference between each pair is a single
    // printed token. A looser pattern anywhere here collapses two of them silently.
    expect(deriveAttackEffect(ACTIVE_SIBLING)).toEqual([
      { op: "damageActive", amount: 20, source: "attack" },
    ]);
    expect(deriveAttackEffect(BENCH_SIBLING)).toEqual([
      { op: "damageChosen", target: "opponentBench", amount: 20, count: 1, source: "attack" },
    ]);
    expect(deriveAttackEffect(BARE)).toEqual([
      { op: "damageChosen", target: "opponentAny", amount: 20, count: 1, source: "attack" },
    ]);
    // the DISTRIBUTION (arm 23a) — N ops of 1 counter each, and it is the one that
    // shares this anchor's zone word while meaning something else entirely
    expect(
      deriveAttackEffect("Put 2 damage counters on your opponent's Pokémon in any way you like."),
    ).toHaveLength(2);
    // and the pairwise INEQUALITIES, which is what a shared-prefix family owes: none of
    // the four derives to any other's program.
    const programs = [ACTIVE_SIBLING, BENCH_SIBLING, BARE, CHOSEN].map((s) =>
      JSON.stringify(deriveAttackEffect(s)),
    );
    expect(new Set(programs).size).toBe(4);
  });

  it("refuses the near misses, each the resolving sentence with ONE token changed", () => {
    const NBSP = " ";
    for (const [why, text] of [
      // A printed 0 AMOUNT would park a real pick that places nothing.
      ["a printed 0 amount", "Put 0 damage counters on 1 of your opponent's Pokémon."],
      // A printed 0 ARITY would park a prompt asking for nothing.
      ["a printed 0 arity", "Choose 0 of your opponent's Pokémon and put 3 damage counters on each of them."],
      ["a printed 0 amount, choose-first", "Choose 2 of your opponent's Pokémon and put 0 damage counters on each of them."],
      // THE SEAT, dropped — the catastrophic miss: `target` has no own-side member for
      // the ANY zone, so a reader that lost "opponent's" could not even be expressed.
      ["the seat dropped", "Put 2 damage counters on 1 of your Pokémon."],
      ["the seat dropped, choose-first", "Choose 2 of your Pokémon and put 3 damage counters on each of them."],
      // ⚠️ THE ZONE WORD IS NOT LISTED HERE, AND THE ABSENCE IS THE POINT: adding
      // "Benched" gives arm 23's REAL sentence, which derives to arm 23's op. Its
      // disjointness is asserted as an INEQUALITY in the case above, never as a null —
      // a `toBeNull` there would have gone red the day D140 shipped. The choose-first
      // spelling of the same rewrite has no anchor at all, so IT is a null.
      ["the zone word, choose-first", "Choose 2 of your opponent's Benched Pokémon and put 3 damage counters on each of them."],
      // "up to", a BOUNDED count — the op's `count` is EXACT by its own doc block.
      ["an up-to arity", "Put up to 2 damage counters on 1 of your opponent's Pokémon."],
      // LOWERCASE, which is the whole of what keeps the SIX "Cursed Blast" ABILITY
      // printings of this identical action off this path — there is no /i anywhere.
      ["a lowercase verb", "put 2 damage counters on 1 of your opponent's Pokémon."],
      ["a lowercase verb, choose-first", "choose 2 of your opponent's Pokémon and put 3 damage counters on each of them."],
      // NO TRAILING PERIOD and a "!" — the `$` from both sides.
      ["no trailing period", "Put 2 damage counters on 1 of your opponent's Pokémon"],
      ["an exclamation", "Put 2 damage counters on 1 of your opponent's Pokémon!"],
      // A LEADING RIDER pins `^` — this is how a gated printing arrives.
      ["a leading flip", "Flip a coin. If heads, put 2 damage counters on 1 of your opponent's Pokémon."],
      // A TRAILING sentence the engine has never seen — the `$`'s reason for existing.
      ["an unknown remainder", "Put 2 damage counters on 1 of your opponent's Pokémon. Draw a card."],
      // NON-INTEGER and SIGNED counts — `\d+` takes neither, and a -2 would HEAL.
      ["a fractional amount", "Put 2.5 damage counters on 1 of your opponent's Pokémon."],
      ["a signed amount", "Put -2 damage counters on 1 of your opponent's Pokémon."],
      // The SINGULAR noun, deliberately not a branch (D139's call, inherited).
      ["the singular noun", "Put 2 damage counter on 1 of your opponent's Pokémon."],
      // A NON-BREAKING SPACE, spelled as an escape: byte-different and invisible in a diff.
      ["a non-breaking space", `Put${NBSP}2 damage counters on 1 of your opponent's Pokémon.`],
      // An INTERIOR double space is not trimmable.
      ["an interior double space", "Put  2 damage counters on 1 of your opponent's Pokémon."],
      // The lookalike `Pokemon`.
      ["a lookalike Pokemon", "Put 2 damage counters on 1 of your opponent's Pokemon."],
      // The choose-first spelling with its JOIN re-worded — "and put" is the hinge.
      ["a reworded join", "Choose 2 of your opponent's Pokémon, then put 3 damage counters on each of them."],
      // …and its TAIL re-worded: "on each of them" is what makes the arity a fan-out.
      ["a reworded tail", "Choose 2 of your opponent's Pokémon and put 3 damage counters on them."],
      // THE REAL CATALOG NEIGHBOURS on the choose-first opening (corpus lines 81/82/84),
      // every one a different mechanism and every one still unread by these arms.
      ["a pick with replacement", "Choose 1 of your opponent's Pokémon 6 times. (You can choose the same Pokémon more than once.) For each time you chose a Pokémon, do 20 damage to it. This damage isn't affected by Weakness or Resistance."],
      ["a bench shuffle", "Choose 2 of your opponent's Benched Pokémon. Shuffle those Pokémon and all attached cards into your opponent's deck. If 1 of your Pokémon used Angelite during your last turn, this attack can't be used."],
      ["empty", ""],
    ] as const) {
      expect(deriveAttackEffect(text), why).toBeNull();
    }
    // Outer whitespace SURVIVES by design (the deriver trims), so this states which
    // drift is tolerated and which is not.
    expect(deriveAttackEffect(`\t  ${BARE}\n`)).toEqual(deriveAttackEffect(BARE));
    expect(deriveAttackEffect(`\t  ${CHOSEN}\n`)).toEqual(deriveAttackEffect(CHOSEN));
  });

  it("derives the CURLY apostrophe identically on both new arms", () => {
    // EQUALITY with the straight form, never merely non-null: a non-null check passes on
    // a reader that folded the sentence into some other row.
    for (const s of [BARE, CHOSEN]) {
      const curly = s.replaceAll("'", "’");
      expect(curly).not.toBe(s);
      expect(deriveAttackEffect(curly), s).toEqual(deriveAttackEffect(s));
    }
  });

  it("accepts the unprinted counts, which is a claim about the GAME and not the INGEST", () => {
    // D131/D135/D139's standing call: an unambiguous sentence the op expresses exactly
    // is derived even where no card prints those numbers. `1 damage counters` is
    // ungrammatical and unambiguous; a three-body pick is a shape the op already holds.
    expect(deriveAttackEffect("Put 1 damage counters on 1 of your opponent's Pokémon.")).toEqual([
      { op: "damageChosen", target: "opponentAny", amount: 10, count: 1, source: "attack" },
    ]);
    expect(
      deriveAttackEffect("Choose 3 of your opponent's Pokémon and put 1 damage counters on each of them."),
    ).toEqual([
      { op: "damageChosen", target: "opponentAny", amount: 10, count: 3, source: "attack" },
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — the persisted op, and the version prediction DRIVEN over the bytes.
// ─────────────────────────────────────────────────────────────────────────────

describe("§3 — a new PRODUCER of a shipped literal, and the record version does not move", () => {
  it("🛑 the version PREDICTION, driven over the SERIALIZED BYTES in THREE directions", () => {
    // 🛑 **WHICH SITUATION THIS IS, ASKED RATHER THAN INHERITED.** It is NOT "the type is
    // unpersisted": `damageChosen` PARKS — §4 below parks it twice — so the literal rides
    // `GameState.phase.cont.pendingOp` into a stored match record. It is not D125's
    // widening either, because no union member and no key were added. It is the case
    // below both: a new PRODUCER of a literal the v29 schema already admitted.
    //
    // **DIRECTION 1 — FORWARD. The bytes this slice writes carry no key v29 lacked.**
    // The key SET is exactly the op's four required keys, and the shipped compound (arm
    // 25, since D143) writes that identical set. So the new arm's record is
    // indistinguishable from a record a v29 deploy could already have written.
    const fresh = deriveAttackEffect(BARE)?.[0] as EffectOp;
    expect(JSON.stringify(fresh)).toBe(
      '{"op":"damageChosen","target":"opponentAny","amount":20,"count":1,"source":"attack"}',
    );
    expect(Object.keys(fresh).sort()).toEqual(["amount", "count", "op", "source", "target"]);
    const shipped = (deriveAttackEffect(COMPOUND) as EffectOp[])[0] as EffectOp;
    expect(Object.keys(shipped).sort()).toEqual(Object.keys(fresh).sort());
    expect(JSON.parse(JSON.stringify(fresh))).toEqual(fresh);

    // **DIRECTION 2 — BACKWARD. Every byte string a v29 deploy could have written still
    // resumes to exactly what its writer meant.** Three of them, spanning the two other
    // `target` members and both riders, revived and re-serialised unchanged.
    for (const bytes of [
      '{"op":"damageChosen","target":"opponentAny","amount":90,"count":1,"source":"attack"}',
      '{"op":"damageChosen","target":"opponentBench","amount":20,"count":1,"source":"attack"}',
      '{"op":"damageChosen","target":"opponentAny","amount":20,"count":1,"source":"attack","deals":true}',
    ]) {
      const revived = JSON.parse(bytes) as EffectOp;
      expect(JSON.stringify(revived)).toBe(bytes); // no key gained, none lost, order kept
    }
    // …and the first of those three IS the compound's stored op, so the backward claim is
    // about a record this engine really writes rather than a string typed here.
    expect(
      JSON.parse('{"op":"damageChosen","target":"opponentAny","amount":90,"count":1,"source":"attack"}'),
    ).toEqual(shipped);

    // **DIRECTION 3 — THE LOSS DIRECTION, and it is VACUOUS BY CONSTRUCTION, which is
    // the finding rather than a shortcut.** D421's criterion asks what a DROPPED key
    // degrades into; this slice adds no key, so the question is instead whether any key
    // the record already has could go missing and land on a plausible neighbour. Every
    // one of the four is REQUIRED, so a loss is a type error rather than a soft landing
    // — and the two that would matter most are checked here as VALUES: dropping
    // `target` cannot leave `opponentBench`, and dropping `count` cannot leave 1,
    // because neither has a default anywhere in the engine.
    for (const key of ["op", "target", "amount", "count", "source"] as const) {
      const dropped = JSON.parse(
        JSON.stringify(fresh, (k, v) => (k === key ? undefined : v)),
      ) as Record<string, unknown>;
      expect(Object.keys(dropped)).not.toContain(key);
      expect(dropped).not.toEqual(fresh);
    }
    // ⚠️ AND THE ARITY IS THE ONE VALUE THAT COULD DEGRADE SILENTLY IF IT WERE OPTIONAL,
    // so the choose-first arm's `count: 2` is pinned as bytes too: a record that lost it
    // would place on ONE body where the card prints two, which is a plausible-looking
    // wrong answer and exactly the shape D425 made a field REQUIRED to avoid.
    expect(JSON.stringify(deriveAttackEffect(CHOSEN)?.[0])).toBe(
      '{"op":"damageChosen","target":"opponentAny","amount":30,"count":2,"source":"attack"}',
    );
  });

  it("the engine version moved", () => {
    expect(engineVersion).toBe("0.379.0");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — the board: a placed counter is NOT damage, and the park is the op's own.
// ─────────────────────────────────────────────────────────────────────────────

describe("§4 — the placement is FLAT, and the control on the same body is not", () => {
  it("🛑 20 on a ×2 Lightning ACTIVE — and the CONTROL reads 40 on that same body", () => {
    // THE ATTRIBUTION CONTROL, and without it the first assertion is vacuous (D214): a
    // board whose Weakness was dead would read 20 for the wrong reason. Same attacker,
    // same defender, same printed 20, same candidate set — only `deals` differs.
    const put = mustApply(fielded(1), { type: "attack", seat: "p1", index: IDX.bare });
    expect(find(put.events, "COUNTERS_PLACED")).toMatchObject({
      seat: "p2",
      amount: 20,
      source: "attack",
    });
    expect(find(put.events, "DAMAGE_DEALT")).toBeUndefined();
    expect(put.state.players.p2.active?.damage).toBe(20);

    // …and the control is the control BY ITS PRINTED TEXT rather than by its index: the
    // fixture's index 2 prints `DEALS_CONTROL`, which derives to this slice's op with
    // `deals: true` bolted on and nothing else changed. Without this the pair below is
    // two attacks that happen to differ, rather than one axis.
    expect(deriveAttackEffect(DEALS_CONTROL)).toEqual([
      { op: "damageChosen", target: "opponentAny", amount: 20, count: 1, source: "attack", deals: true },
    ]);
    const control = mustApply(fielded(1), { type: "attack", seat: "p1", index: IDX.control });
    expect(find(control.events, "DAMAGE_DEALT")).toMatchObject({
      base: 20,
      weakness: { op: "multiply", amount: 2 },
      dealt: 40,
    });
    expect(find(control.events, "COUNTERS_PLACED")).toBeUndefined();
    expect(control.state.players.p2.active?.damage).toBe(40);
  });

  it("🛑 the EVENT is the reading: COUNTERS_PLACED carries `source`, DAMAGE_DEALT does not", () => {
    // D140's field, and the reason this arm is not a one-liner: `placeSnipe` hardcoded
    // `"ability"` until 0.89.0, which was true of its three Ability producers and false
    // of every attack. A derived arm that forgot `source: "attack"` would print the
    // literal word Ability in the log for a card that has none.
    const { events } = mustApply(fielded(2), { type: "attack", seat: "p1", index: IDX.bare });
    const row = find(events, "COUNTERS_PLACED");
    expect(row?.source).toBe("attack");
    expect(row?.source).not.toBe("ability");
  });

  it("a LONE Active FORCES the pick; a Bench makes it a real park", () => {
    // `damageChosen` HAND-ROLLS `parkOrForce`'s doctrine rather than calling it, and the
    // shape is the same: 0 candidates silent, `count` or fewer forced, more than `count`
    // parked. `opponentAny` is never empty during an attack, so the silent arm is the
    // wire belt here and the FORCE is the one a bare Active reaches.
    const forced = mustApply(fielded(3), { type: "attack", seat: "p1", index: IDX.bare });
    expect(forced.state.phase.kind).not.toBe("effect:choose");
    expect(forced.state.players.p2.active?.damage).toBe(20);

    const { state: parked } = mustApply(fielded(3, { bench: ["fix-lightning-weak"] }), {
      type: "attack",
      seat: "p1",
      index: IDX.bare,
    });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");
    // the ACTIVE LEADS the candidate list (`oppAnyRefs`' order), so a forced board reads
    // naturally and the two spots are told apart here rather than assumed
    expect(prompt.candidates).toHaveLength(2);
    expect(prompt.candidates[0]).toMatchObject({ seat: "p2", spot: { spot: "active" } });
    expect(prompt.candidates[1]).toMatchObject({ seat: "p2", spot: { spot: "bench", index: 0 } });
    expect(prompt).toMatchObject({ min: 1, max: 1, declinable: false });
    // THE CAPTION QUOTES THE CARD, in counters and not HP — `snipeNote` divides by ten
    // on the placement path, and the zone word is dropped because `opponentAny` offers
    // the Active too.
    expect(prompt.note).toBe("Choose 1 of your opponent's Pokémon (2 damage counters each).");

    // BOTH picks on the SAME parked board, and both are FLAT: the Active takes 20 and
    // not 40, the Bench takes 20 with no W/R by construction (§8.5).
    const active = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [prompt.candidates[0] as PokemonRef] },
    });
    expect(active.state.players.p2.active?.damage).toBe(20);
    expect(active.state.players.p2.bench[0]?.damage).toBe(0);
    const bench = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [prompt.candidates[1] as PokemonRef] },
    });
    expect(bench.state.players.p2.bench[0]?.damage).toBe(20);
    expect(bench.state.players.p2.active?.damage).toBe(0);
  });

  it("🛑 the CHOOSE-FIRST arity is TWO bodies at 3 counters each — a real 2-of-3 pick", () => {
    // The first `opponentAny` PLACEMENT at an arity above one, and the board that makes
    // the two captures distinguishable: 2 bodies × 30 HP, never 3 × 20.
    const { state: parked } = mustApply(
      fielded(4, { bench: ["fix-lightning-weak", "fix-lightning-weak"] }),
      { type: "attack", seat: "p1", index: IDX.chosen },
    );
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");
    expect(prompt.candidates).toHaveLength(3);
    expect(prompt).toMatchObject({ min: 2, max: 2, declinable: false });
    expect(prompt.note).toBe("Choose 2 of your opponent's Pokémon (3 damage counters each).");
    // the pick spans the ACTIVE and a BENCH body in ONE answer — `placeSnipe`'s two arms
    // firing off one ref list, which no shipped producer of this op had ever reached
    const done = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: {
        kind: "pokemonMulti",
        refs: [prompt.candidates[0] as PokemonRef, prompt.candidates[2] as PokemonRef],
      },
    });
    expect(done.state.players.p2.active?.damage).toBe(30); // FLAT on the ×2 body
    expect(done.state.players.p2.bench[1]?.damage).toBe(30);
    expect(done.state.players.p2.bench[0]?.damage).toBe(0);
    expect(done.events.filter((e) => e.type === "COUNTERS_PLACED")).toHaveLength(2);
  });

  it("§8.6 — a board with FEWER bodies than the printed arity takes them all, unprompted", () => {
    // "Do as much as you can": two candidates for a count-2 pick is not a decision, so
    // the op auto-takes rather than parking. ⚠️ This is the arm a suite whose boards all
    // field one candidate would exercise EXCLUSIVELY (D416), which is why the park above
    // is driven on a three-body board and this one on a two-body board.
    const { state, events } = mustApply(fielded(5, { bench: ["fix-lightning-weak"] }), {
      type: "attack",
      seat: "p1",
      index: IDX.chosen,
    });
    expect(state.phase.kind).not.toBe("effect:choose");
    expect(events.filter((e) => e.type === "COUNTERS_PLACED")).toHaveLength(2);
    expect(state.players.p2.active?.damage).toBe(30);
    expect(state.players.p2.bench[0]?.damage).toBe(30);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — §11: which of the two printed shields refuses a PLACED counter.
// ─────────────────────────────────────────────────────────────────────────────

describe("§5 — the prevention gate, on the axis the two printed spellings actually divide", () => {
  it("🛑 the EFFECTS shield REFUSES the placement — and the DAMAGE shield does not", () => {
    // THE WHOLE OF §11 FOR THIS OP, on one axis with a case on each side. A placed
    // counter is NOT damage (D138/D139/D142, and the catalog prints the rule on Bronzong
    // sv03-145: "Damage is not an effect."), so it falls to the EFFECTS half of the
    // family and to nothing else. Neither assertion means anything without the other:
    // "the shield refused it" passes on a build that refuses everything, and "the shield
    // let it through" passes on a build that gates nothing.
    //
    // `fix-unaware` — "Prevent all effects of attacks used by your opponent's Pokémon
    // done to this Pokémon. (Damage is not an effect.)"
    const shielded = mustApply(fielded(6, { defender: "fix-unaware" }), {
      type: "attack",
      seat: "p1",
      index: IDX.bare,
    });
    expect(find(shielded.events, "ATTACK_EFFECT_PREVENTED")).toMatchObject({ seat: "p2" });
    expect(find(shielded.events, "COUNTERS_PLACED")).toBeUndefined();
    expect(shielded.state.players.p2.active?.damage).toBe(0);
    // …and the SAME shield does NOT stop the `deals` control, because that one IS damage
    // and this sentence's own parenthetical says damage is not an effect.
    const shieldedControl = mustApply(fielded(6, { defender: "fix-unaware" }), {
      type: "attack",
      seat: "p1",
      index: IDX.control,
    });
    expect(find(shieldedControl.events, "DAMAGE_DEALT")).toMatchObject({ dealt: 20 });
    expect(shieldedControl.state.players.p2.active?.damage).toBe(20);

    // `sv03-078` Bellibolt — "Prevent all DAMAGE done to this Pokémon by attacks from
    // your opponent's {L} Pokémon." The attacker is {L}, so the clause is ARMED: it
    // prevents the control outright and must not touch the placement.
    const damageShield = mustApply(fielded(7, { defender: "sv03-078" }), {
      type: "attack",
      seat: "p1",
      index: IDX.bare,
    });
    expect(find(damageShield.events, "COUNTERS_PLACED")).toMatchObject({ amount: 20 });
    expect(find(damageShield.events, "ATTACK_EFFECT_PREVENTED")).toBeUndefined();
    expect(damageShield.state.players.p2.active?.damage).toBe(20);
    const damageShieldControl = mustApply(fielded(7, { defender: "sv03-078" }), {
      type: "attack",
      seat: "p1",
      index: IDX.control,
    });
    expect(find(damageShieldControl.events, "DAMAGE_DEALT")).toMatchObject({
      prevented: true,
      dealt: 0,
    });
    expect(damageShieldControl.state.players.p2.active?.damage).toBe(0);
  });

  it("the refusal is at the ACTIVE arm, which is `damageActive` REUSED rather than re-implemented", () => {
    // D143's call: `placeSnipe` routes an Active PLACEMENT through `damageActive` — the
    // function that is already "flat counters onto the opponent's Active, §11-gated,
    // `source` off the op" — so the gate this suite drives is the same one the bare
    // spot-named sentence has consulted since D142. Asserted by EQUALITY of behaviour:
    // arm 22's sentence on the same shielded board refuses identically.
    const viaSpot = mustApply(fielded(8, { defender: "fix-unaware" }), {
      type: "attack",
      seat: "p1",
      index: IDX.bare,
    });
    expect(viaSpot.events.map((e) => e.type)).toContain("ATTACK_EFFECT_PREVENTED");
    // …and the BENCH arm is NOT gated, which is stated because it is a real asymmetry a
    // successor will meet: `placeSnipe`'s `!deals` bench branch consults no shield at
    // all, and `snipeTargets` deliberately excludes `unshieldedRefs` (its own doc block).
    // That is the SHIPPED behaviour of every put-counter snipe since Hawlucha, inherited
    // here rather than changed by a slice whose subject is the reader.
    const { state: parked } = mustApply(
      fielded(8, { defender: "fix-unaware", bench: ["fix-unaware"] }),
      { type: "attack", seat: "p1", index: IDX.bare },
    );
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");
    // the shielded BENCH body is still OFFERED — the funnel answers "which bodies does
    // the card name", not "which may be touched right now"
    expect(prompt.candidates).toHaveLength(2);
    const onBench = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: { kind: "pokemonMulti", refs: [prompt.candidates[1] as PokemonRef] },
    });
    expect(onBench.state.players.p2.bench[0]?.damage).toBe(20);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 — the Knock Out: the Prize is paid, and the cause is DAMAGE.
// ─────────────────────────────────────────────────────────────────────────────

describe("§6 — a lethal placement Knocks Out, pays a Prize, and counts as damage", () => {
  it("🛑 the placement KOs the Active and the attacker is owed a Prize", () => {
    // The op never KOs; the attack epilogue's two-seat sweep does (flow.ts finishAttack),
    // and this slice inherits that path from arm 25 rather than reaching a new one. Driven
    // rather than inherited, because "a placement that kills without paying a Prize" is
    // the class this project has spent several slices on.
    const state = setDamage(fielded(9), "p2", 120); // 130 HP at 120 → 20 is exactly lethal
    const { state: after, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: IDX.bare,
    });
    expect(types(events)).toEqual(["ATTACK_DECLARED", "COUNTERS_PLACED", "KNOCKED_OUT", "PRIZES_OWED"]);
    expect(find(events, "KNOCKED_OUT")).toMatchObject({ seat: "p2" });
    expect(find(events, "PRIZES_OWED")).toMatchObject({ seat: "p1", count: 1 });
    // …and the flow really stops on the Prize rather than ending the turn through it
    expect(after.phase.kind).toBe("ko:takePrizes");
  });

  it("🛑 the KO is BY DAMAGE, and Vengeful Punch is where D414's marker is observable", () => {
    // `koByEffect:<turn>` (types.ts) is stamped by ops that make a body lethal WITHOUT
    // damaging it, and `koRecoilOf` (flow.ts) reads it to decide whether the printed
    // "Knocked Out BY DAMAGE from an attack" recoil is owed. A placed counter DOES place
    // damage, so no marker is stamped and the recoil IS owed — which is D434's own stated
    // rule ("D434's counters payload withheld the marker because it DOES place damage")
    // reaching a second producer.
    //
    // ⚠️ **THE ABSENCE IS DRIVEN THROUGH ITS READER RATHER THAN READ OFF THE BODY**, and
    // that is not a convenience: the KO'd body is gone from the board by the time the
    // events are inspected, so `markers` cannot be asserted at all. The recoil firing IS
    // the observation, and it goes RED in exactly one direction — a build that stamped
    // the marker here would leave the attacker undamaged.
    let state = fielded(10);
    state = attachToolFromDeck(state, "p2", "active", "sv03-197");
    state = setDamage(state, "p2", 120);
    const { state: after, events } = mustApply(state, {
      type: "attack",
      seat: "p1",
      index: IDX.bare,
    });
    expect(find(events, "KNOCKED_OUT")).toMatchObject({ seat: "p2" });
    // 4 damage counters = 40 HP, back onto the ATTACKER
    expect(after.players.p1.active?.damage).toBe(40);
    expect(events.filter((e) => e.type === "COUNTERS_PLACED")).toHaveLength(2);
  });

  it("a BENCH body finished off by the choose-first pick KOs and prizes too", () => {
    // The same claim through the OTHER arm and the OTHER zone, because a mid-turn bench
    // KO is a different seam from the Active one (no promotion is queued).
    let state = fielded(11, { bench: ["fix-lightning-weak", "fix-lightning-weak"] });
    state = setBenchDamage(state, "p2", 0, 100); // 130 HP at 100 → 30 is exactly lethal
    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: IDX.chosen });
    if (parked.phase.kind !== "effect:choose") throw new Error("expected effect:choose");
    const prompt = parked.phase.prompt;
    if (prompt.kind !== "choosePokemonMulti") throw new Error("expected choosePokemonMulti");
    const { state: after, events } = mustApply(parked, {
      type: "resolveEffect",
      seat: "p1",
      choice: {
        kind: "pokemonMulti",
        refs: [prompt.candidates[1] as PokemonRef, prompt.candidates[2] as PokemonRef],
      },
    });
    expect(find(events, "KNOCKED_OUT")).toMatchObject({ seat: "p2" });
    expect(find(events, "PRIZES_OWED")).toMatchObject({ seat: "p1", count: 1 });
    // the SURVIVING pick keeps its 30, so the KO did not swallow the other placement
    expect(after.players.p2.bench.map((b) => b.damage)).toEqual([30]);
  });
});

/** Event type names in order — a local spelling of `testFixtures`' `types`, kept here
    so this file's one ordering claim reads beside the assertion that uses it. */
function types(events: GameEvent[]): string[] {
  return events.map((e) => e.type);
}

// A reference to `applyAction` so the import earns its place: every board above goes
// through `mustApply`, which wraps it — this is the one direct call, and it pins that a
// second attack in the same turn is refused, i.e. that the boards above really did end
// their turn on the attack rather than leaving one open (§8's one-attack rule).
describe("§7 — the attack really is the turn's last action", () => {
  it("refuses a second attack after the placement resolves", () => {
    const { state } = mustApply(fielded(12), { type: "attack", seat: "p1", index: IDX.bare });
    const again = applyAction(state, { type: "attack", seat: "p1", index: IDX.bare });
    expect(again.ok).toBe(false);
  });
});
