import { describe, expect, it } from "vitest";
import { legalAttackCorpus } from "./censusAttackCorpus";
import * as effects from "./effects";
import {
  deriveAttackBonusConsequent,
  deriveAttackCoinFlip,
  deriveAttackDamageBonus,
  deriveAttackDamageMultiplier,
  deriveAttackDamagePenalty,
  deriveAttackDamageSuppression,
  deriveAttackEffect,
  deriveAttackOptionalBoost,
  deriveAttackRequirement,
  splitAttackGateClause,
} from "./effects";
import { applyAction } from "./index";
import type { GameState } from "./index";
import { programFor, registryCardIds } from "./registry";
import {
  RARE_CANDY_DECK,
  TRIGGER_DECK,
  benchFromDeck,
  driveSetup,
  handFromDeck,
  handUid,
  must,
  mustApply,
  setDamage,
} from "./testFixtures";

// ── D306 — "SEARCH YOUR DECK FOR A CARD THAT EVOLVES FROM THIS POKÉMON AND PUT
//    IT ONTO THIS POKÉMON TO EVOLVE IT." — THE FAMILY MEASURED, THE REFUSAL
//    DRIVEN, AND THE NUMBER D305 FLAGGED AS ITS OWN MOST-LIKELY-WRONG CLAIM. ──
//
// 🛑 WHAT THIS FILE IS. It is NOT a build. Exeggcute `sv08-001`/`-192`'s BODY is
// refused, as it has been since D277, and this file is the first artefact that
// (a) states the refusal's population from the catalog rather than from the card
// in front of it, (b) DRIVES the blocker instead of narrating it, and (c) answers
// the question D305 wrote down and could not answer: **what would `BUILT.attack`
// move by if the family shipped?**
//
// ⚠️ PROVENANCE OF THE POPULATION. Remote Cloudflare D1 `luminous`
// (`database_id 735f0fb5-cdc3-494d-8b97-74a8ade0124a`) over MCP on **2026-08-09**:
//
//   SELECT id, name, legal_standard, stage, evolve_from, hp, attacks_json
//     FROM cards WHERE instr(attacks_json,'put it onto this Pok') > 0
//    ORDER BY legal_standard DESC, id;
//
// **SIX `legal_standard = 1` printings on FOUR cards**, read END TO END (every
// attack of every row, not just the one the family is named for):
//
//   • Eevee `sv06-135` and `sv06-188` (Basic, 50 HP, {C}) — TWO attacks:
//     idx 0 "Ascension" {C} (no `damage`) carrying the family sentence, and
//     **idx 1 "Quick Attack" {C}{C}{C}, `damage: "20+"`, "Flip a coin. If heads,
//     this attack does 20 more damage."** ⚠️ THE SECOND ATTACK IS THE REASON
//     THIS COMMENT QUOTES WHOLE ROWS: a slice that read only the matching arm
//     would have carried "one attack" into a per-index argument, which is
//     exactly the error D277 corrected on this same card family.
//   • Exeggcute `sv08-001` and `sv08-192` (Basic, 30 HP, {C}) — ONE attack,
//     idx 0 "Precocious Evolution", no `damage`, whose text is the family
//     sentence WITH a leading licence: *"If you go first, you can use this
//     attack during your first turn."*
//   • Dwebble `sv10-011` (Basic, 70 HP, {C}) — ONE attack, idx 0 "Ascension",
//     no `damage`, the bare family sentence.
//   • Team Rocket's Pupitar `sv10-095` (**Stage1**, `evolve_from` "Team Rocket's
//     Larvitar", 100 HP, {C}) — ONE attack, idx 0 "Explosive Ascension",
//     **`damage: 30`**, the bare family sentence. The name and the damage differ;
//     the EFFECT STRING does not.
//
// Plus FOUR `legal_standard = 0` rows this file deliberately does not count:
// Glimmet `sv02-124`/`sv04.5-179` ("Ascension", {F}) and Finizen `sv03-060`/
// `sv04.5-123` ("Valiant Evolution" — a COMPOUND, "Switch this Pokémon with 1 of
// your Benched Pokémon. If you do, search your deck …").
//
// 🛑 SO THE FAMILY IS **2 OF 6**, AND THE OTHER FOUR PRINTINGS ARE NOT IN THE
// REGISTRY AT ALL (§4 drives that). D295's failure — build 2, report a closed
// family — is the one this file is shaped to prevent.
//
// 🆕 🛑 **D307 BUILT IT, AND THIS FILE'S CENSUS IS WHY IT COULD BE PRICED.**
// §2's rungs below are REWRITTEN rather than deleted: they measured a refusal,
// they now measure the move that refusal was worth, by the same method and from
// outside the census file. Three things about the build are worth reading here,
// because each contradicts something a handoff wrote down:
//
//   * **THE MOVE IS SIX AND IT LANDS IN TWO SUMMANDS** - raw 1136 -> 1140 (the
//     bare sentence) and split 11 -> 13 (Exeggcute's licensed one). Predicted by
//     §2 before a line of op code existed, and re-derived live below.
//   * **NO REGISTRY ROW WAS AUTHORED FOR ANY OF THE FOUR CARDS, SO §4 IS STILL
//     GREEN AND STILL CORRECT.** The handoff predicted §4 would redden BY NAME.
//     It cannot: the raw summand is keyed on the READER over the whole legal
//     corpus with `programFor` nowhere in the addition (§2 says so and
//     `censusAtHead.test.ts`'s D274 block is where it is written), so a row buys
//     no printing. The tripwire that fired is §2's refusal rung, not §4's.
//   * **THE BLOCKER WAS REAL AND WAS PAID BY REMOVING IT, NOT BY CHANNELLING
//     IT.** §3 below still drives both phase-setting tails, because both are
//     still there on the HAND route. The deck route reaches neither: the printed
//     on-evolve trigger says *"from your hand"* on every legal card that prints
//     one, and §8.1 `finishAttack` sweeps the evolve-induced KO. See
//     `evolveFromDeck.test.ts`, which drives both of those claims on a board.

/** The seven exported readers, run as one. The same set `censusAtHead.test.ts`
    uses; duplicated rather than exported across files because the point here is
    to run the readers a SECOND time, from outside, over two named sentences. */
const READERS: readonly ((text: string) => unknown)[] = [
  deriveAttackEffect,
  deriveAttackDamageBonus,
  deriveAttackDamagePenalty,
  deriveAttackDamageMultiplier,
  deriveAttackCoinFlip,
  deriveAttackRequirement,
  deriveAttackDamageSuppression,
  // 🆕 D316 — the EIGHTH, and the tripwire below is what said so: the reader
  // landed, `EXPORTED_ATTACK_READERS.length` went red naming the count, and this
  // list was re-pointed rather than the count relaxed.
  deriveAttackOptionalBoost,
  // 🆕 D317 — THE TRIPWIRE FIRED A SECOND TIME AND WAS RE-POINTED RATHER THAN
  // RELAXED. `deriveAttackBonusConsequent` (*"…this attack does {N} more damage,
  // and {consequent}"*) landed and `EXPORTED_ATTACK_READERS.length` went red
  // naming the count, exactly as the block above predicts it would. ⚠️ **AND THE
  // RUNG BELOW IS UNAFFECTED IN POLARITY**: the ninth reader refuses this family's
  // two sentences (its anchors demand a trailing ", and …" that neither carries),
  // so what moved is the SURFACE and not the answer — which is the difference
  // between a tripwire doing its job and a test being edited to stay green.
  deriveAttackBonusConsequent,
];

function resolvedByAnyReader(text: string): boolean {
  return READERS.some((read) => read(text) !== null);
}

/** The attack-reader surface taken from the MODULE rather than from the list
    above. ⚠️ WITHOUT THIS THE COPY IS A HOLE, NOT A DUPLICATE: §2's refusal rung
    would keep passing after a slice added an EIGHTH reader to `effects.ts` that
    resolves this family — the census would move by 4 and this file would still
    read "refused". It keys on the `deriveAttack` prefix, which is the naming
    convention all seven follow; a reader added under a different name is still
    invisible here, and that limit is why this is a tripwire and not a proof. */
const EXPORTED_ATTACK_READERS = Object.entries(effects)
  .filter(([name, value]) => name.startsWith("deriveAttack") && typeof value === "function")
  .map(([name]) => name)
  .sort();

/** `BUILT.attack`'s raw summand, by D274's own method: the readers run live over
    the whole legal corpus, with no registry term in the addition. */
function rawUnitsAtHead(): number {
  return legalAttackCorpus()
    .filter(([, text]) => resolvedByAnyReader(text))
    .reduce((sum, [units]) => sum + units, 0);
}

/** `BUILT.attack`'s split summand: in the corpus, REFUSED whole, RESOLVED once
    the gate clause is taken off. Disjoint from the raw term by construction. */
function splitUnitsAtHead(): number {
  return legalAttackCorpus()
    .filter(([, text]) => {
      const split = splitAttackGateClause(text);
      return split !== null && !resolvedByAnyReader(text) && resolvedByAnyReader(split.body);
    })
    .reduce((sum, [units]) => sum + units, 0);
}

/** The ONE summand of `BUILT.attack` this file cannot re-derive — the
    registry-authored attacks. Deriving it needs each id's PRINTED text joined
    against LEGALITY, which lives in `censusAtHead.test.ts`'s `REGISTRY_ATTACKS`
    and not here: **nineteen** registry ids carry an `attack` program and only
    twelve of them are `legal_standard = 1` (D314's converse guard). So it is
    carried as a named term rather than buried inside a total literal — and this
    family moves the other two summands, never this one.

    🆕 🛑 **D315 — IT WAS `4`, IT SHOULD HAVE BEEN `13`, AND IT HAD BEEN WRONG
    SINCE D312 WITH NOTHING ABLE TO SEE IT.** D312 (+1), D313 (+7) and D314 (+1)
    each moved the registry summand and none of them touched this file, because
    none of them touched this FAMILY — and the rung below only ever compared this
    file's own three terms against each other, so a stale summand and a stale
    total agreed perfectly. ⚠️ **THE IRONY IS THE POINT: this constant's own doc
    block is an argument against burying a hand-carried census figure inside a
    total literal, and the failure it did not anticipate is the hand-carried
    figure drifting on its own while the total was re-derived around it.** A
    number that only appears on ONE side of an equation is not checked by that
    equation, however carefully the other side is measured. It is still hand-
    carried — legality genuinely is not readable from here — so the repair is the
    POINTER above (`REGISTRY_ATTACKS` is the authority and it has a converse guard
    off `registryCardIds()`), not a second copy of the rule. */
// 🆕 D338 — 13 → **15**, Heatmor `sv10.5w-019`/`-104` "Licking Catch". 🛑 **THIS IS
// THE ONLY ONE OF THE THREE SUMMANDS BELOW THAT AN AUTHORED ROW CAN MOVE**, and
// saying so is the point of keeping them apart: `rawHead` is READER-keyed over the
// whole legal corpus and `splitHead` is READER-keyed on the split string, so a
// registry row buys either of them exactly nothing (D307/D315). D326 moved `rawHead`
// and authored no row; D338 authors two rows and moves only this line.
const REGISTRY_ATTACK_UNITS = 15;

/** A sentence the readers DO resolve — D214's attribution control, without which
    "both family sentences are refused" passes just as happily on a broken
    import. */
const DERIVABLE_CONTROL = "Draw a card.";

/** The BARE family sentence — Eevee ×2, Dwebble, Team Rocket's Pupitar. */
const BARE =
  "Search your deck for a card that evolves from this Pokémon and put it onto this Pokémon to evolve it. Then, shuffle your deck.";

/** The GATED family sentence — Exeggcute ×2. Byte-identical to `BARE` after the
    licence clause, which is the whole reason the two live in different summands
    of `BUILT.attack`. */
const GATED = `If you go first, you can use this attack during your first turn. ${BARE}`;

/** The four cards, by the ids D1 returned at `legal_standard = 1`. */
const FAMILY_IDS = [
  "sv06-135",
  "sv06-188",
  "sv08-001",
  "sv08-192",
  "sv10-011",
  "sv10-095",
] as const;

/** The two ids that carry the licence and therefore a registry row. */
const GATED_IDS = ["sv08-001", "sv08-192"] as const;

function unitsOf(sentence: string): number | undefined {
  return legalAttackCorpus().find(([, text]) => text === sentence)?.[0];
}

describe("D306 §1 — the family in the committed corpus: two sentences, 4 + 2 printings", () => {
  it("both sentences are IN the corpus, and their units are the D1 sweep's 4 and 2", () => {
    // 🛑 THE POPULATION IS MEASURED FROM THE CORPUS, NOT QUOTED FROM THE HANDOFF.
    // D305 re-swept this against D1 and got 6-on-4; this rung re-derives the same
    // 6 from the transcription the engine actually reads, so the two independent
    // routes to the number have to agree or this goes red.
    expect(unitsOf(BARE)).toBe(4);
    expect(unitsOf(GATED)).toBe(2);
    expect((unitsOf(BARE) ?? 0) + (unitsOf(GATED) ?? 0)).toBe(6);
  });

  it("they are TWO records, not one — the licence is what separates them", () => {
    // The gated string CONTAINS the bare one, and the corpus is keyed by whole
    // sentence, so a transcription that dropped the licence would silently merge
    // six printings into one record and this family would read as 6-on-1.
    const records = legalAttackCorpus().filter(([, text]) => text.includes("put it onto this Pok"));
    expect(records.map(([units]) => units).sort()).toEqual([2, 4]);
    expect(records.length).toBe(2);
    // 🛑 CONTAINMENT READ OFF THE CORPUS, NOT OFF THIS FILE'S OWN TEMPLATE.
    // `GATED` is built by interpolating `BARE`, so `GATED.endsWith(BARE)` is true
    // by construction and proves nothing about the transcription. Asserting it
    // between the two RECORDS is the real statement: one body, one licence, two
    // rows — and it reddens if either constant drifts off the committed corpus.
    const gatedRecord = records.find(([units]) => units === 2)?.[1];
    const bareRecord = records.find(([units]) => units === 4)?.[1];
    expect(bareRecord).toBe(BARE);
    expect(gatedRecord).toBe(GATED);
    expect(gatedRecord?.endsWith(bareRecord ?? "")).toBe(true);
    expect(gatedRecord).not.toBe(bareRecord);
  });

  it("the licence is the SPLIT anchor's clause, and the remainder is the bare sentence", () => {
    // This is the mechanical statement of "the two sentences are the same body":
    // the existing gate-splitter, applied to the gated record, returns exactly
    // the bare record's text. Nothing new is being taught to any reader here.
    const split = splitAttackGateClause(GATED);
    expect(split).not.toBeNull();
    expect(split?.body).toBe(BARE);
    // …and the bare sentence carries no gate of its own.
    expect(splitAttackGateClause(BARE)).toBeNull();
  });
});

describe("D306 §2 — what BUILT.attack would move by, keyed on the READER", () => {
  it("the attribution control resolves, so a `false` below is a refusal and not a broken import", () => {
    expect(resolvedByAnyReader(DERIVABLE_CONTROL)).toBe(true);
  });

  it("the seven readers ARE the module's whole attack-reader surface — the copy is complete", () => {
    // 🛑 THE COPY'S OWN GUARD. `READERS` is duplicated from `censusAtHead.test.ts`
    // on purpose (the point is to run the readers a SECOND time, from outside),
    // and a duplicate that silently falls behind the module is worse than no copy
    // at all: the refusal rung below would stay green while an eighth reader
    // resolved this family and moved `BUILT.attack` by 4.
    expect(READERS.map((read) => read.name).sort()).toEqual(EXPORTED_ATTACK_READERS);
    expect(EXPORTED_ATTACK_READERS.length).toBe(9);
  });

  it("🆕 D307 — BOTH sentences now RESOLVE, and they resolve DIFFERENTLY", () => {
    // 🛑 THE TRIPWIRE THIS SLICE WAS EXPECTED TO TRIP, RE-POINTED RATHER THAN
    // DELETED. D306 wrote it as "both are refused"; the value of the rung was
    // never the polarity but the fact that it names the two sentences and asks
    // the readers about each separately. So it now pins the SHAPE of the build:
    //
    //   • the BARE sentence resolves WHOLE (the raw summand),
    //   • the GATED sentence is still refused whole (a gate clause is a
    //     PRECONDITION and no reader may swallow it — D282's standing rule, and
    //     the thing that keeps the two summands disjoint),
    //   • …and resolves once the licence is split off (the split summand).
    //
    // Widen the anchor to admit the gated string and the middle line reddens BY
    // NAME, which is exactly the double-count `censusAtHead.test.ts`'s D274 block
    // cannot detect on its own.
    expect(resolvedByAnyReader(BARE)).toBe(true);
    expect(resolvedByAnyReader(GATED)).toBe(false);
    expect(resolvedByAnyReader(splitAttackGateClause(GATED)?.body ?? GATED)).toBe(true);
    // …and it is the EFFECT reader that owns it, not one of the six numeric ones
    // (D269's rule: say WHICH reader, never just "some reader").
    expect(deriveAttackEffect(BARE)).toEqual([{ op: "evolveFromDeck" }, { op: "shuffleDeck" }]);
    expect(deriveAttackDamageBonus(BARE)).toBeNull();
    expect(deriveAttackDamageMultiplier(BARE)).toBeNull();
    expect(deriveAttackCoinFlip(BARE)).toBeNull();
    expect(deriveAttackRequirement(BARE)).toBeNull();
  });

  it("🛑 THE ANSWER D305 COULD NOT GIVE: the move is SIX, not two", () => {
    // D305 flagged *"building Exeggcute's body moves `BUILT.attack` by exactly 2
    // (1151 → 1153)"* as its own most-likely-wrong claim, and named the artefact
    // that settles it: `censusAtHead.test.ts`'s D274 block. Read there, the raw
    // summand is
    //
    //   legalAttackCorpus().filter(([, t]) => resolvedByAnyReader(t))
    //                      .reduce((sum, [units]) => sum + units, 0)
    //
    // — **keyed on the READER over the whole legal corpus, with no registry term
    // in it**. `programFor` appears nowhere in that addition. So an anchor that
    // resolves `BARE` collects ALL FOUR of its printings at once, whether or not
    // Eevee, Dwebble and Pupitar ever get a registry row; and the licence half
    // collects its 2 through the SPLIT summand. **4 + 2 = 6.**
    //
    // ⚠️ AND THE TWO HALVES LAND IN DIFFERENT SUMMANDS, which is why the total
    // cannot be read off one number: raw 1136 → 1140, split 11 → 13, registry +4
    // unchanged ⇒ **1151 → 1157**. A slice that shipped only the split would move
    // 2 and leave four printings derivable-but-uncounted, and a slice that shipped
    // only the raw anchor would move 4 and leave Exeggcute's own card behind.
    const rawDelta = unitsOf(BARE) ?? 0;
    const splitDelta = unitsOf(GATED) ?? 0;
    expect(rawDelta).toBe(4);
    expect(splitDelta).toBe(2);
    expect(rawDelta + splitDelta).toBe(6);

    // 🛑 AND THE HEAD FIGURE IS MEASURED HERE, NOT COPIED FROM THE HANDOFF. An
    // earlier draft of this rung read `expect(1151 + rawDelta + splitDelta)
    // .toBe(1157)` — with 1151 a literal on BOTH sides of the arithmetic, that
    // cannot go red, and D274's own guard exists because a hand-carried census
    // constant is exactly the thing that drifts. So the two summands this family
    // moves are RE-DERIVED (D274's method, run from outside), the one it does not
    // is named, and 1151 appears only as the thing being CHECKED. Widen any
    // reader for any unrelated reason and `rawUnitsAtHead()` moves and this
    // reddens BY NAME, instead of the projection below quietly going stale.
    // 🆕 D307 — THE PROJECTION IS NOW THE MEASUREMENT, AND THE ARITHMETIC IS
    // KEPT IN THE SAME SHAPE SO THE TWO CAN BE COMPARED. D306 read 1136 / 11 /
    // 1151 here and projected 1157; the same three expressions now read 1140 / 13
    // / 1157 at HEAD, and the two deltas above are still the ones that account for
    // the difference. **The prediction and the outcome are checked by the SAME
    // code**, which is the only way a projection ever settles.
    // 🆕 D308 — 1140 -> **1144** and 1157 -> **1161**, and the SPLIT half stands
    // still at 13: the iterated sentence (`evolveEachBenched.test.ts`) carries no
    // gate clause, so all four of its printings arrive through the raw summand.
    // The deltas below still account for THIS family's 6 out of the head, which is
    // the point of keeping the two arithmetics in the same rung — a later slice
    // moving the head for an unrelated reason cannot make these two look right.
    // 🆕 D309 — 1144 -> **1146** and 1161 -> **1163**, the SPLIT half standing
    // still at 13 for the THIRD consecutive slice: the body-choice sentence
    // (`evolveBodyChoice.test.ts`) carries no gate clause either, so both of its
    // printings arrive through the raw summand. The split term has been CLOSED
    // since D307 and three sibling arms in a row have left it closed, which is the
    // strongest form the "every gate sentence in the corpus resolves once split"
    // claim can take: it survives arms that read the same family.
    // 🆕 🛑 D315 — 1146 -> **1147** and 1163 -> **1173**, and the two numbers move
    // by DIFFERENT amounts, which is this rung doing the job it was written for.
    // The raw half rises by ONE for a reason inside this family: the MULTI-BODY
    // sentence (`evolveEachChosen.test.ts`) carries no gate clause either, so its
    // single printing arrives through the raw summand and the SPLIT half stands
    // still at 13 for the FOURTH consecutive slice — three sibling arms and now a
    // fourth have all left the split term CLOSED. The head rises by TEN because
    // `REGISTRY_ATTACK_UNITS` was corrected 4 -> 13 in the same commit: D312 (+1),
    // D313 (+7) and D314 (+1) each moved the registry summand without touching
    // this family, so the term had been NINE behind and this rung could not see
    // it. ⚠️ **A SUMMAND THAT APPEARS ON ONLY ONE SIDE OF AN EQUATION IS NOT
    // CHECKED BY THAT EQUATION** — see the constant's own doc block, which now
    // records the whole episode.
    // 🆕 ⚠️ AND THIS FILE IS THE EIGHTH RE-POINT SITE D315 PREDICTED SEVEN OF. It
    // names no card id and no sentence from the family it guards — it reads the
    // whole corpus through `rawUnitsAtHead()` — so a `git grep` for the card, the
    // id or the printed bytes cannot find it. **A CONSTANT THAT IS A SUM OVER
    // EVERYTHING HAS NO IDENTIFIER TO GREP FOR, WHICH IS THE SAME BLIND SPOT A
    // VERSION LITERAL HAS** (D313/D314's lesson, at a second shape): the only
    // thing that finds it is running the suite.
    const rawHead = rawUnitsAtHead();
    const splitHead = splitUnitsAtHead();
    // 🆕 D316 — 1147 -> **1152** and 1173 -> **1178**, and this time the two move
    // by the SAME 5: the optional damage-boost reader's five printings are all raw
    // and no summand but the raw one is touched, so the head follows it exactly.
    // The contrast with D315's line directly above is the whole value of keeping
    // both arithmetics in one rung — that slice's head moved by TEN on a raw step
    // of ONE, because a hand-carried summand was corrected in the same commit.
    // 🆕 D317 — 1152 -> **1158** and 1178 -> **1184**, and the two move by the
    // SAME 6 for D316's reason at D316's site: the bonus-plus-consequent reader's
    // six printings are all RAW, and neither the registry summand nor the split
    // term is touched. **The split term stands still for the FIFTH consecutive
    // slice.**
    // 🆕 D326 — 1158 -> **1164** and 1184 -> **1190**, and the two move by the
    // SAME 6 for D316's and D317's reason at a third site: the last-turn-KO
    // REVENGE clause's six printings are all RAW (two rows in
    // `CONDITIONAL_DAMAGE_CLAUSES`, four distinct printed amounts), and neither
    // the registry summand nor the split term is touched. **The split term stands
    // still for the SIXTH consecutive slice.** ⚠️ **AND THIS RUNG IS WHY THE
    // SLICE FOUND OUT AT ALL**: D326 added no card, id or sentence this file
    // names, so nothing it could have grepped for would have reached here — the
    // full `check` is the only thing that finds a sum over everything, exactly as
    // the paragraph twenty lines up promises.
    expect(rawHead).toBe(1164);
    expect(splitHead).toBe(13);
    const head = rawHead + splitHead + REGISTRY_ATTACK_UNITS;
    // 🆕 D338 — 1190 → **1192**, and ⚠️ **THE TWO ASSERTIONS ABOVE STAND STILL WHILE
    // THIS ONE MOVES, WHICH IS THE WHOLE DESIGN OF THIS RUNG.** `rawHead` 1,164 and
    // `splitHead` 13 are re-derived LIVE here; only `REGISTRY_ATTACK_UNITS` is
    // hand-carried, and a slice that authored a row and mistook it for a reader
    // change would go red on `rawHead` rather than quietly agreeing with itself.
    expect(head).toBe(1192);
    // The family is INSIDE the head now, so the pre-build figure is what the
    // deltas come back OFF it — the inverse of D306's line, and it goes red the
    // same way if any reader moves for any other reason.
    // 🆕 D308 — 1151 -> **1155**, and this is the rung behaving as designed rather
    // than drifting: subtracting THIS family's 6 from the head no longer lands on
    // the pre-D307 figure, because another slice moved the head by 4 for a reason
    // of its own. That is exactly the "any reader moves for any other reason" case
    // the line above promises to catch, and it caught it.
    // 🆕 D309 — 1155 -> **1157**, moving for D308's reason at D308's site: another
    // slice moved the head by 2, this family's 6 came off it unchanged, and the
    // landing point drifts by exactly that unrelated 2. The rung is a DIFFERENCE
    // and the difference is what stays honest.
    // 🆕 D315 — 1157 -> **1167**: the head moved by 10, this family's 6 came off it
    // unchanged, and the landing point drifts by exactly that 10 (1 of it this
    // slice's own raw printing, 9 of it three registry slices' units). The rung is
    // a DIFFERENCE and the difference is what stays honest.
    // 🆕 D316 — 1167 -> **1172**: the head moved by 5 for a reason entirely
    // outside this family, this family's 6 came off it unchanged, and the landing
    // point drifts by exactly that 5. The rung is a DIFFERENCE and the difference
    // is what stays honest.
    // 🆕 D317 — 1172 -> **1178**: the head moved by 6 for a reason entirely
    // outside this family, this family's 6 came off it unchanged, and the landing
    // point drifts by exactly that 6. The rung is a DIFFERENCE and the difference
    // is what stays honest — third consecutive slice it has drifted for someone
    // else's reason and stayed correct.
    // 🆕 D326 — 1178 -> **1184**: the head moved by 6 for a reason entirely
    // outside this family, this family's 6 came off it unchanged, and the landing
    // point drifts by exactly that 6. Fourth consecutive slice it has drifted for
    // someone else's reason and stayed correct.
    // 🆕 D338 — 1184 -> **1186**: the head moved by 2 for a reason entirely outside
    // this family, this family's 6 came off it unchanged, and the landing point
    // drifts by exactly that 2. Fifth consecutive slice it has drifted for someone
    // else's reason and stayed correct — and 🛑 **THE FIRST TIME THE REASON IS A
    // REGISTRY ROW RATHER THAN A READER.** D315-D326's four drifts all came off
    // reader movement; this one comes off `REGISTRY_ATTACK_UNITS` alone, and the
    // rung cannot tell the difference BECAUSE IT IS A DIFFERENCE — which is
    // precisely the property that makes it survive both kinds of move.
    expect(head - rawDelta - splitDelta).toBe(1186); // 1151 before D308's +4, +2 at D309, +10 by D315, +5 at D316, +6 at D317, +6 at D326, +2 at D338
  });

  it("🆕 D307 — the gated record was the last unresolved gate sentence; the term CLOSES", () => {
    // D282's split term reads exactly this set. 13 printings on 5 sentences, 11 of
    // them resolving after the split — and the 2 that do not are these. So the
    // split half of the move is 11 → 13 and the term would then be CLOSED.
    const gated = legalAttackCorpus().filter(([, text]) => splitAttackGateClause(text) !== null);
    expect(gated.length).toBe(5);
    expect(gated.reduce((sum, [units]) => sum + units, 0)).toBe(13);
    const unresolved = gated.filter(
      ([, text]) => !resolvedByAnyReader(splitAttackGateClause(text)?.body ?? text),
    );
    // 🆕 D307 — the set is now EMPTY and the split term is 13 of 13, i.e. **5 of
    // 5 sentences**. D306 measured this set as exactly `[GATED]`; the delta
    // between the two readings is this slice, stated as a set difference rather
    // than as a number.
    expect(unresolved.map(([, text]) => text)).toEqual([]);
    expect(unresolved.reduce((sum, [units]) => sum + units, 0)).toBe(0);
    expect(gated.reduce((sum, [units]) => sum + units, 0)).toBe(13);
  });
});

describe("D306 §3 — the blocker, DRIVEN: placeEvolution's two tails are phases", () => {
  // 🛑 THE REFUSAL IS TYPED **COMPOSITION**, AND THIS IS THE READ THAT SETTLES IT.
  //
  //   • `stepOp` (interpreter.ts) returns
  //         `{ done: GameState; schedule?: EffectOp[] } | { park: EffectPrompt }`
  //     and `runProgram` returns `{ kind: "done" | "parked" }`. An op hands back a
  //     BARE GameState or a prompt. It has no channel for a `PendingStage`, and no
  //     channel for a phase it did not itself park into.
  //   • `placeEvolution` (turn.ts) — the shared placement `evolve` and Rare Candy
  //     both run, and the ONLY function in the engine that puts an evolution card
  //     on a stack — ends in one of two calls, BOTH returning `ApplyResult`:
  //         `resolveMidTurnKnockOuts(next, seat, [seat], events)`  (flow.ts)
  //         `runBoardTrigger(next, seat, target, "onEvolve", events)` (triggers.ts)
  //     The first seeds `state.pending` with KO stages plus a `resumeTurn` and
  //     `advance`s; the second folds through `settleProgram` and can PARK.
  //
  // Neither tail is hypothetical, and neither is narrated below — both are driven
  // on a real board through a real action. That is the whole of the refusal: an
  // `EffectOp` that evolved would have to return a phase, and ops do not return
  // phases.
  //
  // ⚠️ AND THE HALF THAT WOULD BE CHEAP IF IT WERE THE ONLY ONE. In an ATTACK
  // context the KO tail's *"resume the actor's turn"* is nearly free — the attack
  // ends the turn anyway (§5.3) and `finishAttack` already sweeps the ATTACKER's
  // own board. It is the TRIGGER tail that has no answer: an on-evolve program
  // parking inside an attack-effect program is a park inside a park, and
  // `EffectContinuation` holds exactly one `pendingOp`.
  //
  // 🆕 🛑 **D307 — EVERY WORD ABOVE IS STILL TRUE OF THE HAND ROUTE, AND THE BUILD
  // NEVER TOOK IT.** These two rungs still pass unchanged, because `evolve` and
  // Rare Candy still call `placeEvolution` and it still ends in a phase. What the
  // slice found is that the DECK route reaches neither tail — the printed
  // on-evolve Ability says *"when you play this Pokémon **from your hand** to
  // evolve"* on all 8 registry rows and on 29 of the 31 legal printings of the
  // phrase, and the two exceptions are not triggers at all — so the price was a
  // SOURCE-ZONE distinction and not a channel. **A refusal whose blocker is real
  // can still be paid by discovering the blocker is not on the path**, which is
  // the third distinct way this page has re-typed one. Driven on a board in
  // `evolveFromDeck.test.ts` §4 (the trigger that must NOT fire) and §5 (the KO
  // the attack epilogue sweeps).

  it("TAIL A — the on-evolve trigger PARKS: placeEvolution returns effect:choose", () => {
    // Arboliva `sv01-023` "Enriching Oil" (onEvolve, optional, healChosen "all").
    // Two heal candidates ⇒ a real prompt, i.e. a phase an op cannot produce.
    let state = triggerBoard(3);
    state = setDamage(state, "p1", 40);
    state = benchFromDeck(state, "p1", "fix-basic-1");
    state = handFromDeck(state, "p1", "sv01-023", 1);
    const uid = handUid(state, "p1", "sv01-023");
    const { state: parked } = mustApply(state, {
      type: "evolve",
      seat: "p1",
      uid,
      target: { spot: "active" },
    });
    // The phase is the trigger's, not the caller's — `evolve` returned what
    // `placeEvolution` handed it, unchanged.
    expect(parked.phase.kind).toBe("effect:choose");
  });

  it("TAIL B — the evolve-below-HP KO seeds PENDING STAGES: ko:takePrizes", () => {
    // fix-basic-1 (60 HP) + Bravery Charm `sv02-173` (+50 → 110) damaged to 100
    // survives as a Basic; Rare Candy to fix-stage2-frail (80 HP, the Basic-only
    // +50 falling off) is lethal the instant the placement lands. The same
    // `placeEvolution` line, the other tail.
    const state = charmedLethalBoard();
    const { state: next } = mustApply(state.board, state.action);
    expect(next.phase).toMatchObject({ kind: "ko:takePrizes", seat: "p2", count: 1 });
    // …and the resume stage really is queued behind it, which is the shape no
    // `EffectOp` result can carry.
    expect(next.pending.length).toBeGreaterThan(0);
  });

  it("🆕 D307 — `searchDeck.dest` is STILL bench|hand: the evolve dest is its own op", () => {
    // 🛑 THE OTHER HALF OF THE REFUSAL, and the reason widening `searchDeck` is
    // not the cheap route it looks like. Every authored `searchDeck` in the
    // registry names a ZONE; "put it onto this Pokémon to evolve it" names an
    // in-play BODY — and the SAME body that is doing the searching, so the op
    // would need a self-reference the union has no spelling for.
    //
    // 🆕 D307 SHIPPED THE FAMILY AND THIS RUNG IS UNCHANGED, WHICH IS THE POINT:
    // the build is a SEPARATE op (`evolveFromDeck`, no fields, no `CardFilter`),
    // so `searchDeck`'s destination union really is still the two zones. If a
    // later slice folds the two ops together this reddens by name and the
    // argument above has to be made again rather than quietly abandoned.
    const dests = new Set<string>();
    let seen = 0;
    for (const id of registryCardIds()) {
      walk(programFor(id), (node) => {
        if (node.op !== "searchDeck") return;
        seen++;
        if (typeof node.dest === "string") dests.add(node.dest);
      });
    }
    // The control: a zero-op walk would make the assertion below vacuously
    // green on an empty set.
    expect(seen).toBeGreaterThan(0);
    expect([...dests].sort()).toEqual(["bench", "hand"]);
  });
});

describe("D306 §4 — the gate half stands; the body half is absent on all four cards", () => {
  it("the two GATED ids carry the licence and NOTHING else", () => {
    for (const id of GATED_IDS) {
      const program = programFor(id);
      expect(program, id).toBeDefined();
      expect(program?.attackGate?.[0]).toEqual({ kind: "firstTurnExempt" });
      // 🛑 NO BODY. `attack` is what a registry-authored attack program would
      // land in, and it is absent — which is what makes these two printings part
      // of the SPLIT term's unresolved 2 rather than part of the `+4`.
      expect(program?.attack, id).toBeUndefined();
    }
    // Both printings share ONE program object (the reprint rule).
    expect(programFor("sv08-001")).toBe(programFor("sv08-192"));
  });

  it("the four NON-gated printings are not in the registry at all — the family is 2 of 6", () => {
    // D295's failure in one rung: this is the assertion that stops a future slice
    // building Exeggcute and reporting a closed family. When these gain rows, this
    // reddens and the census above must be re-read.
    //
    // 🆕 🛑 **D307 BUILT ALL SIX PRINTINGS AND THIS RUNG DID NOT MOVE — WHICH IS
    // THE HANDOFF'S PREDICTION LOSING, NOT THIS FILE FALLING BEHIND.** The handoff
    // ordered four registry rows and predicted this rung would redden BY NAME. A
    // row would have bought ZERO printings: §2 above derives the raw summand as
    // `legalAttackCorpus().filter(resolvedByAnyReader)`, with `programFor` nowhere
    // in the addition, so the ARM collects Eevee, Dwebble and Pupitar and a row
    // would only pin three cards to a hand-authored program a deriver already
    // serves (conventions.md: *an arm transfers across sets; a registry row does
    // not* — and the same arm covers Glimmet and Finizen the day they rotate in).
    // So the rung stands as written and still says something true: these four ids
    // are not in the registry, and they do not need to be.
    for (const id of FAMILY_IDS) {
      const inRegistry = programFor(id) !== undefined;
      expect(inRegistry, id).toBe((GATED_IDS as readonly string[]).includes(id));
    }
  });
});

// ── fixtures ────────────────────────────────────────────────────────────────

/** p1 going first on TRIGGER_DECK, passed to `turn` (evolve-legal at 3). */
function triggerBoard(turn: number): GameState {
  let state = driveSetup(
    3,
    { p1: TRIGGER_DECK, p2: TRIGGER_DECK },
    { first: "p1", active: { p1: "fix-basic-1", p2: "fix-basic-1" } },
  );
  while (state.turn < turn) {
    if (state.phase.kind !== "turn:action") {
      throw new Error(`unexpected ${state.phase.kind} while passing to turn ${turn}`);
    }
    state = must(applyAction(state, { type: "endTurn", seat: state.phase.seat }));
  }
  return state;
}

/** Walk every nested object of a registry program, calling `visit` on each one
    that carries an `op` discriminant — gate branches (`then` / `otherwise`)
    included, which a shallow scan of the top-level arrays would miss. */
function walk(node: unknown, visit: (op: Record<string, unknown>) => void): void {
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
    return;
  }
  if (node === null || typeof node !== "object") return;
  const record = node as Record<string, unknown>;
  if (typeof record.op === "string") visit(record);
  for (const value of Object.values(record)) walk(value, visit);
}

/** The charmed-Basic board whose Rare Candy skip is instantly lethal, plus the
    action that lands it. Built here rather than imported so this file drives the
    tail itself. */
function charmedLethalBoard(): {
  board: GameState;
  action: Parameters<typeof applyAction>[1];
} {
  let state = driveSetup(
    4,
    { p1: RARE_CANDY_DECK, p2: RARE_CANDY_DECK },
    {
      first: "p1",
      active: { p1: "fix-basic-1", p2: "fix-basic-1" },
      bench: { p1: ["fix-basic-1"] },
    },
  );
  while (state.turn < 3) {
    if (state.phase.kind !== "turn:action") {
      throw new Error(`unexpected ${state.phase.kind} while passing to turn 3`);
    }
    state = must(applyAction(state, { type: "endTurn", seat: state.phase.seat }));
  }
  state = handFromDeck(state, "p1", "sv02-173", 1);
  const charmUid = handUid(state, "p1", "sv02-173");
  state = mustApply(state, {
    type: "attachTool",
    seat: "p1",
    uid: charmUid,
    target: { spot: "active" },
  }).state;
  state = setDamage(state, "p1", 100);
  state = handFromDeck(state, "p1", "sv01-191", 1);
  const rareUid = handUid(state, "p1", "sv01-191");
  state = handFromDeck(state, "p1", "fix-stage2-frail", 1);
  const frailUid = handUid(state, "p1", "fix-stage2-frail");
  return {
    board: state,
    action: {
      type: "rareCandy",
      seat: "p1",
      uid: rareUid,
      target: { spot: "active" },
      evolutionUid: frailUid,
    },
  };
}
