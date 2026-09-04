import { describe, expect, it } from "vitest";
import {
  attackReaderSurface,
  legalAttackCorpus,
  resolvedByAnyReader,
} from "./censusAttackCorpus";
import {
  deriveAttackBonusConsequent,
  deriveAttackDiscardScaledBoost,
  deriveAttackOptionalCostBoost,
  deriveAttackPreDamage,
} from "./effects";
import {
  deriveAttackCancelRequirement,
  deriveAttackCoinFlip,
  deriveAttackDamageBonus,
  deriveAttackDamageMultiplier,
  deriveAttackDamagePenalty,
  deriveAttackDamageSuppression,
  deriveAttackEffect,
  deriveAttackOptionalBoost,
  deriveAttackRequirement,
  splitAttackTrailingClause,
} from "./index";
import { FIXTURE_POOL } from "./testFixtures";

// D137 — THE APOSTROPHE FOLD, the literal-clause-table half of D136's hardening.
//
// D136 (the first `/code-review` this branch had since D96) found three regexes
// spelling `opponent's` straight-only while every sibling reading the SAME noun
// phrase carried `['’]` — a class `effects.ts` documents as existing "so a
// re-ingest changing only punctuation cannot silently un-derive" the sentence. It
// fixed the three and wrote the rest down rather than expanding into it: the
// LITERAL clause tables have the identical exposure, and A MAP KEY CANNOT CARRY A
// CHARACTER CLASS. One exact string of bytes, or nothing.
//
// So the hardening moved from the KEY to the LOOKUP. `literalClauseRow` (private
// to effects.ts) tries the clause as printed FIRST, and only on a miss retries it
// with U+2019 folded to U+0027. Every exact lookup on printed text in the engine
// goes through it — four tables, five call sites:
//
//   CONDITIONAL_DAMAGE_CLAUSES   19 rows, 5 with an apostrophe  (D115+)
//   ATTACK_REQUIREMENT_CLAUSES    2 rows, 2 with an apostrophe  (D125)
//   CLAUSE_ENERGY_TOKENS         19 rows, 0 — closed vocabulary (D118), 2 sites
//   CLAUSE_POKEMON_TYPES         11 rows, 0 — closed vocabulary (D120)
//
// THE SHAPE OF EVERY ASSERTION HERE IS THE ONE D136 ESTABLISHED: equality with
// the straight form, never merely "the curly one is non-null". The apostrophe
// carries NO meaning, so the two spellings must produce the SAME value — a test
// that only checked for non-null would pass on a reader that folded the clause
// into some other row entirely.
//
// AND THE FOLD IS APOSTROPHE-ONLY, WHICH IS HALF OF WHAT THIS SUITE PINS. No
// lowercasing, no trimming, no Unicode normalisation of the é in `Pokémon`: the
// tables commit to a real U+00E9 and to a matcher with no /i, and those
// commitments are load-bearing. The negative block below is what stops a later
// session "improving" the fold into a general normaliser, which would owe a
// row-by-row argument that no two distinct printed clauses collide under it.
//
// Reader-level on purpose. The fold is a property of five pure functions, and
// every row it protects is already driven end-to-end by the slice suite that
// bought it (conditionalDamage, attackRequirement, typeNameClause, promotedClause
// and their neighbours). Re-driving a match here would re-assert those slices,
// not this one.

/** U+2019, spelled as an escape rather than pasted: this file is ABOUT the
    difference between two characters that render nearly identically, so every
    occurrence of the curly one is written where a reader can see which it is. */
const RSQUO = "’";
/** U+0027, the form the catalog actually prints. */
const APOS = "'";

/** The straight → curly rewrite a punctuation-normalising re-ingest would do. */
function curly(text: string): string {
  return text.replaceAll(APOS, RSQUO);
}

/** ⚠️⚠️ D227 — THE ONE PART OF A DERIVED PROGRAM THAT IS *SUPPOSED* TO CHANGE WITH
    THE SPELLING, AND THE INVARIANT ABOVE HAD NO WORDS FOR IT UNTIL A SENTENCE
    EXISTED THAT COULD SHOW IT.
 *
 *  "Derives IDENTICALLY" is a claim about the OP STRUCTURE — which op, which
 *  numbers, which branch — and it was byte-equality for eleven slices because no
 *  op the readers emit ECHOED its input. `optional.note` does: its own doc says
 *  the note is "the WHOLE printed sentence", REQUIRED rather than derived from
 *  `then`, and the dialog shows it to a player as the card's own words. So a
 *  curly re-ingest must produce a curly note — a program that normalised it back
 *  would be showing the player a sentence their card does not print, which is the
 *  opposite of what this file protects.
 *
 *  D202's two `optional` producers could not surface this: "You may draw 5 cards."
 *  and "You may draw cards until you have 6 cards in your hand." carry no
 *  apostrophe, so they never entered this census. D227's "You may switch out your
 *  opponent's Active Pokémon to the Bench. (…)" is the first that does.
 *
 *  So the comparison folds NOTES and nothing else: every other string in a derived
 *  program is a LITERAL the reader chose (an op name, a status), and one of those
 *  changing with the input spelling would still be the defect this suite exists
 *  for. Keyed on the property name rather than on the op, because `note` means the
 *  same thing wherever it appears and a per-op list is the enumeration this repo
 *  keeps watching rot. */
function foldNotes<T>(derived: T): T {
  if (Array.isArray(derived)) return derived.map((entry) => foldNotes(entry)) as T;
  if (derived === null || typeof derived !== "object") return derived;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(derived as Record<string, unknown>)) {
    out[key] = key === "note" && typeof value === "string" ? curly(value) : foldNotes(value);
  }
  return out as T;
}

/** The printed-text readers, by name — the set of `attack.ts`'s callers that can
    resolve an apostrophe-bearing sentence (see effects.ts's disjointness note).
    Named so a failure says WHICH reader lost the sentence.

    ⚠️ SIX SINCE D192, and the sixth is the first one added since D137 wrote this
    table. `deriveAttackDamageSuppression` reads "This attack's damage isn't
    affected by …", whose four printed sentences carry THREE exposed apostrophes
    each ("attack's", "isn't", and on two of them "opponent's"), so its exposure is
    the widest of any single reader here.

    🛑 **THE SENTENCES THAT USED TO END THIS PARAGRAPH ARGUED FOR ONE READER'S
    ABSENCE, AND BOTH OF THEIR PREMISES ARE NOW FALSE — TWO SLICES APART.** They read:
    *"`deriveAttackDamagePenalty` is deliberately still ABSENT: it is a caller too,
    but its one anchored sentence (…for each damage counter on this Pokémon.) carries
    no apostrophe at all, so adding it would widen the list without widening the
    sweep."* D419 falsified the first half by DERIVING this table from the module —
    the reader IS in the object below and has been since — while leaving the prose
    standing; 🆕🆕 **D438 falsifies the second half outright.** That reader now also
    claims *"This attack does {30|50} less damage for each {C} in your opponent's
    Active Pokémon's Retreat Cost."* (corpus rows 573/603), which carries **TWO
    exposed apostrophe slots**, the possessive twice over — and that is exactly why
    `RETREAT_COST_PENALTY` spells the `['’]` class on BOTH slots, as its two shipped
    siblings already do. It is D430's rot: a justification true when written and
    falsified by a channel added later, with every line of code still valid. */
const READERS = {
  damageBonus: deriveAttackDamageBonus,
  damageMultiplier: deriveAttackDamageMultiplier,
  requirement: deriveAttackRequirement,
  effect: deriveAttackEffect,
  coinFlip: deriveAttackCoinFlip,
  damageSuppression: deriveAttackDamageSuppression,
  // 🆕🆕 D419 — THE OTHER SIX, AND ONE OF THEM WAS NOT A FORMALITY. See the
  // correction under the block above: `optionalCostBoost` (D381) is the reader
  // whose absence held this census at 139 when the true figure was 140.
  // ⚠️ SPLICED BEFORE THE LAST ENTRY RATHER THAN APPENDED, and `damageSuppression`
  // is left holding the position adjacent to the closing brace it has held since
  // D192: mutant `find` strings quote an array's or object's LAST entries plus its
  // terminator, and appending moves that anchor without a character of it changing
  // (the adjacency class D418 paid for once on `stadiumPresence.test.ts`). This
  // file carries TWO mutant rows already (D366 C6, D367 C9).
  bonusConsequent: deriveAttackBonusConsequent,
  cancelRequirement: deriveAttackCancelRequirement,
  damagePenalty: deriveAttackDamagePenalty,
  discardScaledBoost: deriveAttackDiscardScaledBoost,
  optionalBoost: deriveAttackOptionalBoost,
  // 🆕🆕 D428 — THE THIRTEENTH, the PRE-DAMAGE Tool discard. ⚠️ SPLICED BEFORE THE
  // LAST ENTRY RATHER THAN APPENDED, D419's rule: mutant `find` strings quote an
  // array's LAST entries plus its closing bracket, and appending moves that anchor
  // without a character of it changing.
  preDamage: deriveAttackPreDamage,
  optionalCostBoost: deriveAttackOptionalCostBoost,
} as const;

describe("the U+2019 fold — every apostrophe-bearing sentence the fixtures print", () => {
  it("🆕🆕 D419 — the hand-kept READERS table IS the module's reader surface", () => {
    // 🛑 THE GUARD THIS TABLE NEVER HAD, AND IT IS THE ONE FILE IN D419's SWEEP WHERE
    // THE STALENESS HAD ALREADY COST A FIGURE. The doc block above argues carefully
    // for ONE reader's absence and is silent about five others, which is the D418
    // shape exactly: a locally-correct refusal that nothing re-examined when the
    // module grew. The count below is diffed against `effects.ts`'s exports, so the
    // next reader to land reddens HERE, by name, before the census can drift again.
    expect(
      Object.values(READERS)
        .map((read) => read.name)
        .sort(),
    ).toEqual(attackReaderSurface());
    // ⚠️ THE COUNT IS PINNED SEPARATELY FROM THE DIFF ABOVE, and the separation is
    // load-bearing: a diff alone stays GREEN when a slice deletes a reader from the
    // module and from this table in the SAME commit, and the census would move with
    // nothing naming the cause.
    expect(attackReaderSurface()).toHaveLength(13);
  });

  /** Every distinct printed attack effect in FIXTURE_POOL that carries an
      apostrophe AND that at least one reader resolves. DISCOVERED, not listed:
      the sentences this suite must cover are exactly the ones the engine derives
      today, so a row (or a regex, or a template) added by a later slice is swept
      the day its fixture lands rather than the day somebody remembers to add it
      here. */
  const derivable: { sentence: string; ids: string[] }[] = [];
  for (const [id, card] of Object.entries(FIXTURE_POOL)) {
    for (const attack of card.attacks ?? []) {
      const sentence = attack.effect ?? "";
      if (!sentence.includes(APOS)) continue;
      // 🆕🆕 D409 — **OR THE COMPOSITION PATH CLAIMS IT**, and this widening is the
      // D408 defect class caught one instrument over rather than cited. This sweep
      // is READER-keyed, and D409 builds five printed compounds that NO reader
      // claims — three of them apostrophe-bearing. Left as it was, the suite whose
      // whole job is *"every derivable apostrophe sentence survives a U+2019
      // re-ingest"* would have stood still while three new derivable
      // apostrophe sentences landed beside it, and nothing would have said so.
      // 🆕🆕 D419 — **THE MEMBERSHIP TEST NOW RUNS OFF THE MODULE, AND THAT IS NOT A
      // TIDY-UP: IT MOVED THE CENSUS.** This filter decides what the whole suite
      // sweeps, and it was folded over the hand-kept table above — six readers of a
      // twelve-reader engine — so a sentence claimed only by one of the other six was
      // silently OUTSIDE the fold. Exactly one was (see the census figure below).
      if (!resolvedByAnyReader(sentence) && splitAttackTrailingClause(sentence) === null) {
        continue;
      }
      const existing = derivable.find((entry) => entry.sentence === sentence);
      if (existing === undefined) derivable.push({ sentence, ids: [id] });
      else existing.ids.push(id);
    }
  }

  it("finds the census it is supposed to sweep", () => {
    // 41 distinct sentences at D145 — UNCHANGED from D144, and that is a result
    // rather than an omission. D145 added THREE fixtures (Pikachu ex sv02-063,
    // Beartic sv03-054, Oinkologne sv03-183) and its two mapped sentences carry
    // NO APOSTROPHE AT ALL — the first pair in the tails family with no D136/D137
    // exposure to class. The one apostrophe-bearing sentence those fixtures print
    // is Oinkologne's index-0 "Confounding Cologne" ("Your opponent's Active
    // Pokémon is now Confused."), which `fix-statuser` has printed since M2 — so
    // it adds an ID to an existing row and not a row, which is exactly what a
    // `sentence` census is supposed to do.
    // 42 distinct sentences at D146 (41 at D144/D145, 40 at D143, 38 at D142, 36
    // at D140/D141, 35 at D139, 33 at D138, 32 at D137). D146 added ONE — the
    // attacker-CLASS filter ("During your opponent's next turn, prevent all
    // damage done to this Pokémon by attacks from Basic Pokémon."), carried by
    // BOTH of its new fixtures (Staraptor sv01-150 and Noivern ex sv02-153) and
    // therefore ONE row, exactly as D144's pair was. Its exposed slot is the
    // POSSESSIVE "your opponent's" its unfiltered siblings already carry, on a
    // regex that is UNGATED where theirs are not — so the fold is proven across
    // the gate boundary as well as across the two spellings.
    // D147 added FOUR — the largest single jump this census has taken, and the
    // reason is that its family varies by a NUMBER: "During your opponent's next
    // turn, this Pokémon takes {20|30|50} less damage from attacks (after applying
    // Weakness and Resistance)." is THREE distinct sentences on a `sentence`
    // census even though it is ONE anchor with one capture, and Eiscue
    // sv02-048's COMPOUND ("Discard all Energy from this Pokémon. …100 less…")
    // is the fourth. All four expose the same possessive slot ("your opponent's"),
    // so the fold is now proven across an anchor whose amount varies — the first
    // time this sweep has covered a capture rather than a fixed string, which is
    // worth saying because the `['’]` class sits BEFORE the capture and a
    // template-per-amount build would have had to spell it three times.
    // D145 added NONE, a
    // result rather than an omission: neither of its mapped sentences carries an
    // apostrophe at all. D144 added ONE — the TAILS-gated self-lock
    // ("Flip a coin. If tails, during your next turn, this Pokémon can't attack."),
    // carried by BOTH of its new fixtures (Oinkologne sv01-157 and Paldean
    // Clodsire ex sv02-130) and therefore ONE row on a `sentence` census, exactly
    // as D140's Land Scoop was. Its exposed slot is the same CONTRACTION D143's
    // pair introduced, on a regex written a whole slice later — which is precisely
    // what a DISCOVERED census is for: nobody had this file open.
    // D143 added TWO — Alomomola sv01-048's "Aqua Slash"
    // ("During your next turn, this Pokémon can't attack.") and Ninetales
    // sv03-029's "Nine-Tailed Dance" (that sentence again, behind a counter PUT) —
    // and they are the first entries here whose apostrophes are CONTRACTIONS
    // rather than possessives on one of them and both kinds on the other, which
    // is precisely the asymmetry D137 found `ATTACK_REQUIREMENT_CLAUSES` exposed
    // on. Both regexes class every slot, and this sweep is what proves it.
    // D142 added TWO — Scyther sv03-004's "Agility" and Togedemaru
    // sv03-151's "Defense Curl", the gated PREVENT clause's two printed
    // spellings, both carrying "your opponent's" — and they were swept the moment
    // the fixtures landed, which is exactly what this census is for: neither
    // regex was written with this file open, and both are now proven to survive a
    // U+2019 re-ingest by the same assertion that covers the other 36. D141 added
    // none (it added no apostrophe-bearing fixture). D138
    // added one — Dedenne ex sv02-093's "Tail Swap" — D139 added TWO at once,
    // Mimikyu sv02-097's "Ghost Eye" and Polteageist sv03-098's "Pour Tea" (the
    // same shape at two different counts, so two distinct sentences), and D140
    // added ONE, Ting-Lu ex sv02-127's "Land Scoop" — four PRINTINGS of it in the
    // catalog but only one fixture and, being a `sentence` census, only one row.
    // Each landed here the day its FIXTURE did, which is the whole design.
    // THE NUMBER MOVES WITH THE FIXTURES, not with
    // this file: it is here so that a slice which adds an apostrophe-bearing
    // printing has to look at this suite once and confirm the new sentence folds,
    // rather than silently widening the pool it does not cover. If it drops, a
    // reader stopped deriving something and the failure belongs here as much as in
    // the slice suite that owns it.
    // D148 added TWO — the OPPONENT-side lock's two sentences, one per new
    // fixture (Eiscue ex sv03-042's "Scalding Block" and Houndoom ex sv03-134's
    // "Evil Claw"), which is D143's own pair repeated on the other seat. Both
    // expose BOTH slots at once — the possessive "your opponent's" AND the
    // contraction "can't" — and Houndoom's is the first entry in this census whose
    // derived program is a `conditionGate`, i.e. whose apostrophes sit in a
    // sentence read for a BOARD CONDITION as well as for an op. That is worth
    // saying because the fold is applied to the whole printed string before any
    // reader sees it, so a build that folded per-CLAUSE rather than per-SENTENCE
    // would pass every earlier row here and fail this one.
    // D149 added THREE — the largest jump since D147's four, and for the same
    // reason plus one more. The attacker-side debuff is TWO printed sentences
    // rather than one ("the Defending Pokémon's attacks do {N} less damage" and
    // "attacks used by the Defending Pokémon do {N} less damage"), and the first
    // of them varies by a NUMBER, so a `sentence` census sees the 20 and the 30 as
    // two rows even though they are one anchor with one capture: 20 (Pikachu
    // sv02-062 + Pidove swsh10.5-061, ONE row with two ids), 30 (Florges
    // sv01-093) and 100 (Houndoom sv06.5-008). Every one of the three exposes
    // BOTH slots at once — the possessive "your opponent's" AND, on the first
    // sentence, a SECOND possessive on "the Defending Pokémon's", which is the
    // first entry in this census whose sentence carries the same slot TWICE.
    // A build that folded only the first apostrophe would pass every earlier row
    // here and fail these.
    //
    // ⚠️ AND ONE OF THE THREE IS NOT A NEW FIXTURE. Florges sv01-093 has been in
    // `FIXTURE_POOL` since D104 as the Blooming Garden aura source, with its ONLY
    // printed attack missing from the fixture entirely — so its row appears here
    // the day the fixture was COMPLETED rather than the day a card was added,
    // which is a failure mode this census had not yet seen (D147's was the
    // opposite: the sentence was present and unread).
    //
    // ⚠️ AND D152 ADDS THE 52nd, WHICH CARRIES THE SLOT TWICE FOR A SECOND REASON.
    // Lycanroc ex sv02-117's "Scary Fangs" opens with the same "your opponent's"
    // duration prefix as the three above and closes on "the Attacking Pokémon" —
    // no second possessive, so it is the FIRST entry whose apostrophe is load
    // bearing only at the very front of the anchor. A build that folded the
    // apostrophe anywhere but position 19 still passes it, which is why the count
    // is a floor and the per-sentence rewrite below is the real assertion.
    //
    // ⚠️ AND D154 ADDS FIVE — THE LARGEST JUMP THIS CENSUS HAS SEEN, AND THE FIRST
    // WHOSE APOSTROPHE REACHES A DERIVED VALUE RATHER THAN A PATTERN OR A TABLE
    // KEY. The per-attack lock's five sentences all carry the contraction "can't"
    // (Skarmory sv03-142, Munkidori ex sv06.5-037, Greedent ex sv03-179, Lucario
    // sv01-114 and Radiant Blastoise swsh10.5-018), which by itself would be four
    // more rows of the shape D143 already established. What is new is **Greedent
    // ex's "Slip 'n' Roll"**: the anchor CAPTURES the attack's name, and that name
    // carries TWO MORE apostrophes — so the rewrite below changes the derived op's
    // own field, not merely the string it was read from. D137's contract is that
    // the two spellings produce the SAME VALUE, so `deriveAttackEffect` folds the
    // capture (`foldApostrophes`, effects.ts) and the install site folds the card's
    // own `name` to match. **This row is what makes that fold load-bearing:**
    // remove either half and this single sentence fails while the other 56 pass,
    // which is the exact shape of the half-fix D137 was written to prevent.
    //
    // ⚠️ AND D155 ADDS TWO, WHOSE EXPOSED SLOT IS A **POSSESSIVE ON "Pokémon"** —
    // the one noun this file has never had to class. Every possessive row above is
    // "your opponent's"; the per-attack BUFF prints "this Pokémon'S {AttackName}
    // attack does {N} more damage (before applying …)", so the apostrophe sits
    // between an é-bearing word and a CAPTURE. Two rows because two cards print it
    // (Seismitoad sv03-052's "Echoed Voice" and the constructed two-attack witness
    // `fix-echoer`), and neither attack NAME carries an apostrophe of its own — so
    // unlike D154's Greedent ex these rows pin the PATTERN's class and not the
    // capture's fold, which is pinned by a constructed sentence in the slice suite
    // instead. The distinction is worth the sentence: this census sweeps what the
    // FIXTURES print, and a fold that only a hypothetical printing would exercise
    // has to be pinned somewhere this sweep cannot reach. The THIRD row is
    // `fix-curly-booster`, the witness a surviving mutation bought (its sentence is
    // ALREADY curly, so it is the row this sweep rewrites in the other direction).
    //
    // ⚠️ AND D157 ADDS **ONE** ROW WHOSE THREE APOSTROPHE SLOTS ARE ALL EXPOSED AT
    // ONCE — the first in this census. The opponent-side per-attack lock prints
    // "Choose 1 of your **opponent's** Active **Pokémon's** attacks. During your
    // opponent's next turn, that Pokémon **can't** use that attack.", so one
    // sentence carries two POSSESSIVES (on the two nouns D143 and D155 each
    // exposed separately) and a CONTRACTION (D154's slot). One row and not two,
    // because both printings — Medicham sv01-111 and Oranguru sv02-094 — print the
    // string byte for byte, which this census collapses by SENTENCE.
    //
    // It also has NO CAPTURE, which makes it the census's cleanest row: every
    // apostrophe in it belongs to the PATTERN, so the rewrite below is a pure test
    // of the classes and nothing about a folded value can carry it.
    //
    // ⚠️ AND D162 ADDS **ONE**, WHICH IS THIS CENSUS DOING THE JOB IT WAS BUILT
    // FOR RATHER THAN A SLICE REMEMBERING TO EDIT IT. Radiant Charizard
    // swsh10.5-011's "Combustion Blast" prints D154's sentence with a SIXTH attack
    // name ("During your next turn, this Pokémon **can't** use Combustion Blast."),
    // so it is one row on a `sentence` census and it appeared here the moment the
    // fixture landed — nobody had this file open. Its exposed slot is D154's
    // CONTRACTION, on an anchor whose capture is a PROPER NOUN; the name itself
    // carries no apostrophe, so like Seismitoad's rows above this one pins the
    // PATTERN's class rather than the capture's fold (Greedent ex's "Slip 'n' Roll"
    // remains the only printing where a captured VALUE is folded, and
    // `fix-curly-barrer` its curly twin).
    //
    // ⚠️ IT IS ALSO THE FIRST ROW THIS CENSUS HAS GAINED FROM A **RESTORE** RATHER
    // THAN FROM A NEW MECHANISM. The card was always printed; the database had
    // lost its set to an uncheckpointed WAL, D160 re-ingested it, and the sentence
    // has been derivable by an unchanged anchor the whole time. A sweep that
    // discovers its own inputs is the only kind that can say that.
    //
    // ⚠️ AND D168 ADDS **TWO**, WHICH IS THE `sentence`-CENSUS RULE PAYING OUT IN
    // BOTH DIRECTIONS AT ONCE ON A THREE-CARD FAMILY. The opponent-side
    // damage-counter count prints "This attack does {10|30} more damage for each
    // damage counter on your **opponent's** Active Pokémon." — TWO rows, because
    // the amount varies (D147's shape: one anchor, one capture, two distinct
    // sentences) — and the 10-per row carries TWO ids, because Dedenne sv01-095 and
    // Espeon sv03-086 print it byte for byte (D144's shape, on the same day). Three
    // new fixtures, three new printings, two rows.
    //
    // Its exposed slot is the possessive "your opponent's" every row above already
    // carries, so nothing about the CLASS is new here. What is new is that the
    // possessive now sits in a sentence read for a `DamageCountSource` **member**
    // rather than for an op, a requirement or a fold direction — the fifth kind of
    // thing a folded apostrophe has had to survive being read as. Espeon's index-1
    // "Psy Bolt" adds no row at all: "Flip a coin. If heads, your opponent's Active
    // Pokémon is now Paralyzed." has been in this census since M3 under another
    // fixture, so it adds an ID to an existing row, which is exactly what a
    // `sentence` census is supposed to do.
    //
    // ⚠️ AND D170 ADDS **NONE**, WHICH IS A RESULT RATHER THAN AN OMISSION — the
    // shape D145 established. Its one printing (Tyranitar swsh10.5-043 "Raging
    // Crash", the bench-wide damage-counter count) carries NO apostrophe at all:
    // "on all of your Benched Pokémon" is possessive-free, so there is no slot to
    // class and nothing for the fold to survive. The fixture's OTHER attack does
    // carry one — index 1 "Earthquake" prints "(Don't apply Weakness and Resistance
    // for Benched Pokémon.)" — and it still adds no row, because the sweep admits
    // only sentences a reader RESOLVES and that self-spread is unsimulated. Both
    // halves are why this file takes no diff for a slice that added a fixture, a
    // regex, a union member and an evaluator arm.
    //
    // ⚠️ AND D173 ADDS **ONE**, FROM A SOURCE NO EARLIER ENTRY ON THIS LIST HAS:
    // not a new mechanism, not a new fixture, not a restore — a fixture that was
    // always in the pool being made to carry the attack it had DROPPED. Kilowattrel
    // sv01-079's index-0 "Skill Dive" ("This attack does 50 damage to 1 of your
    // opponent's Pokémon. (Don't apply Weakness and Resistance for Benched
    // Pokémon.)") is the `anyTargetSnipe` sentence, derivable by an anchor that has
    // not moved since M3, and it was invisible to this sweep for the whole life of
    // the fixture because the fixture carried only its SECOND attack. The other
    // three re-indexed siblings add nothing: Koraidon's "Claw Slash" has no effect
    // string at all, Slither Wing's "Iron Smasher" and Arcanine ex's "Raging Claws"
    // carry no apostrophe. ⚠️ **A CENSUS THAT SWEEPS FIXTURES CAN ONLY SEE WHAT THE
    // FIXTURES CARRY** — an omitted attack is a silent hole in every population
    // measured off the pool, and it does not announce itself as one.
    //
    // ⚠️ AND D181 ADDS **TWO**, FROM YET ANOTHER SOURCE: not a fixture and not a
    // restore, but a REGEX. `fix-trainerops`' "Taunt" and "Escort" print the gust
    // sentence bare and behind a coin ("Switch in 1 of your OPPONENT'S Benched
    // Pokémon to the Active Spot."), and both became derivable the moment the two
    // anchors landed — the apostrophe was always in the pool, on a Trainer, and
    // this sweep counts only what a reader RESOLVES. Its four sibling printings on
    // the same body add nothing: the two draws and the draw-until carry no
    // apostrophe, and the three self-switch sentences are DELIBERATELY UNREAD
    // (see derivedDrawAndGust.test.ts) — so a slice that fields eight attacks
    // moves this census by two, which is the sweep behaving exactly as advertised.
    //
    // ⚠️ AND D193 ADDS **SEVEN**, THE LARGEST SINGLE MOVE THIS CENSUS HAS TAKEN —
    // and every one of them from the SAME source, which is why it is one paragraph
    // rather than seven. Three new `DamageCountSource` members landed with two
    // synthetic fixtures, and each of their printed sentences carries the
    // possessive "your opponent's" that D143 classed:
    //
    //   `fix-benchcount` — THREE. The body counts, one row per printed sentence:
    //     "…20 more damage for each Benched Pokémon (both yours and your
    //      opponent's)."                        (bothSidesBenchCount, ADDITIVE)
    //     "…20 more damage for each of your opponent's Benched Pokémon."
    //     "…30 damage for each of your opponent's Benched Pokémon."
    //                                           (opponentBenchCount, BOTH folds)
    //   `fix-oppenergy` — FOUR. The opponent's attached Energy, two zones × the
    //   folds each zone is printed with:
    //     "…30 more damage for each Energy attached to your opponent's Active
    //      Pokémon."                                    (ADDITIVE, active zone)
    //     "…20 damage for each Energy attached to your opponent's Active Pokémon."
    //     "…60 damage for each Energy attached to all of your opponent's Pokémon."
    //     "…60 damage for each {R} Energy attached to all of your opponent's
    //      Pokémon."                                    (MULTIPLY, both zones)
    //
    // ⚠️ TWO OF THE SEVEN EXPOSE A SLOT SHAPE NO EARLIER ROW HAS, AND THEY ARE THE
    // REASON THIS IS NOT JUST "seven more possessives".
    //
    //   • "Herd Charge"'s apostrophe is followed by a **`)`**, inside a
    //     parenthesised clause the pattern carries as ESCAPED literals
    //     (`\(both yours and your opponent['’]s\)`). Every possessive row above it
    //     is followed by a space and a word; this is the first where the character
    //     after the class is part of the pattern's own punctuation, so a class
    //     applied one character wide would look identical until it did not.
    //   • The two board-zone rows are the SAME regex with its optional type capture
    //     absent and present (`(?:(.+) )?Energy attached to …`). The possessive sits
    //     AFTER that capture, so the fold has to survive a pattern whose capture
    //     length varies between the two rows this census counts separately — the
    //     capture-adjacency question D154 opened, asked from the other side.
    //
    // ⚠️ AND `fix-benchcount`'s FOURTH attack adds **NONE**, which is D170's result
    // repeating rather than an omission. "Herd Stomp" prints "(Don't apply Weakness
    // and Resistance for Benched Pokémon.)" — a real D154-class CONTRACTION — and it
    // still adds no row, because this sweep admits only sentences a reader RESOLVES
    // and that self-spread is deliberately unsimulated. A fixture that carries four
    // apostrophe-bearing attacks can move this census by three.
    //
    // ⚠️ AND D192 ADDS **FOUR**, FROM BOTH OF THIS SWEEP'S SOURCES AT ONCE — a
    // REGEX and a FIXTURE — which is the first time one slice has moved it by both.
    // Attributed row by row rather than bumped:
    //
    //   `fix-suppressor` — THREE. One row per printed sentence, all new to the pool:
    //     "This attack's damage isn't affected by Resistance."          (R)
    //     "This attack's damage isn't affected by Weakness or Resistance,
    //      or by any effects on your opponent's Active Pokémon."        (W+R+T)
    //     "This attack's damage isn't affected by Weakness or Resistance."  (W+R)
    //
    //   A REGEX ALONE — ONE, and it is the interesting one. "This attack's damage
    //   isn't affected by any effects on your opponent's Active Pokémon." has been
    //   in `FIXTURE_POOL` since D159 on Bellibolt sv03-078/-201 ("Thunderous Edge"),
    //   carried verbatim and DELIBERATELY unread — D159's own comment calls it "a
    //   live question this slice does not answer". D192 answers it, so the row
    //   appears with no fixture edit at all, and `fix-suppressor`'s copy of the
    //   same sentence adds an ID to it rather than a fourth row. That is D181's
    //   regex-only move and D145's id-only move arriving on ONE sentence.
    //
    // ⚠️ THE APOSTROPHE COUNT PER ROW IS THE HIGHEST THIS CENSUS HOLDS: three
    // exposed slots on two of the four ("attack's", "isn't", "opponent's") and two
    // on the others, all inside ONE anchor. `isn't` in particular is a CONTRACTION
    // rather than a possessive — D154's class, and the first time it appears twice
    // over in a single sweep row alongside a possessive.
    //
    // ⚠️ AND THE ABILITY THIS SLICE ALSO BUILT ADDS **NOTHING**, which is the sweep
    // behaving exactly as advertised: it enumerates `card.attacks` only, and
    // `fix-azureseas`' "Azure Seas" is an ABILITY carrying the same possessive.
    // `fix-azureseas`' one ATTACK prints no effect at all. A slice that fields a
    // fifth apostrophe-bearing printed sentence can move this census by four.
    //
    // ⚠️ D208 MOVED IT 78 → 82, AND THE MOVEMENT IS ATTRIBUTED RATHER THAN
    // ABSORBED — the whole point of pinning it. The delta is EXACTLY the four
    // apostrophe-bearing attack effects `fix-koblast` fields, one per §8.1
    // KO-survival write site plus the counter control:
    //   • "This attack does 120 damage to each of your opponent's Benched
    //      Pokémon."                                         (`spreadDamage`)
    //   • "This attack also does 120 damage to 1 of your opponent's Benched
    //      Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)"
    //                                            (`placeSnipe`'s `deals` arm)
    //   • "This attack does 120 damage to 1 of your opponent's Pokémon. (Don't
    //      apply Weakness and Resistance for Benched Pokémon.)" (`snipeActive`)
    //   • "Put 12 damage counters on 1 of your opponent's Benched Pokémon."
    //                              (the COUNTER control, which must NOT clamp)
    // All four are NEW STRINGS rather than new ids on existing rows, because the
    // amounts (120 / 12) are chosen against `fix-sturdy`'s 120 HP and no fixture
    // printed those numbers before.
    //
    // ⚠️ AND D208's ABILITY ADDS **NOTHING**, for the reason stated two paragraphs
    // up and now confirmed a second time: `fix-sturdy` and `fix-sturdytiny` carry
    // "If this Pokémon has full HP and would be Knocked Out by damage from an
    // attack, it is not Knocked Out, and its remaining HP becomes 10." — which is
    // an ABILITY, is enumerated by nothing here, AND CARRIES NO APOSTROPHE AT ALL.
    // Two independent reasons it cannot appear; the sweep is unmoved by either.
    // ⚠️ D216 MOVED IT 82 → 83, BY EXACTLY ONE, AND THE ROW IS NAMED. The delta
    // is `fix-cofagrigus`' idx 0 — "Move all damage counters from 1 of your
    // Benched Pokémon to **1 of your opponent's** Pokémon." — a NEW STRING rather
    // than a new id on an existing row, because no fixture printed this tail
    // before. Its idx 1 carries D138's sentence, which the pool ALREADY prints on
    // Dedenne ex sv02-093/-239, so that one adds an id to a standing row and not a
    // row; and its idx 2 ("Ping") prints no effect at all. One new fixture, three
    // attacks, ONE row — which is this sweep behaving exactly as its own doc says
    // (it enumerates `card.attacks` and admits only sentences a reader RESOLVES).
    // ⚠️ D227 MOVED IT 83 → 86, BY EXACTLY THREE, AND THE FOURTH ROW IT APPENDED
    // IS THE INTERESTING ONE BECAUSE IT IS **ABSENT**. `fix-trainerops` gained four
    // attacks, all carrying "opponent's": the bare opponent-chosen switch-out, its
    // "You may" sibling and Iron Bundle's compound are each a NEW STRING no fixture
    // printed before, so three rows. `Goad 'n' Grab` — the damage-rider printing
    // D227 fields deliberately UNREAD — carries an apostrophe too and is dropped by
    // the `every reader returns null` filter above, which is this census behaving
    // exactly as its own doc says: it admits sentences a reader RESOLVES, so a
    // pinned gap cannot inflate it. The day that rider is built, this number moves
    // to 87 on its own.
    // ⚠️ D228 MOVED IT 86 → 88, AND ONE OF THE TWO IS THE ROW D227's NOTE ABOVE
    // PREDICTED BY NAME. `Goad 'n' Grab` was in the pool the whole time and was
    // dropped by the `every reader returns null` filter; building its sentence
    // admitted it with no fixture change at all, exactly as the paragraph above
    // says it would. **A census whose own doc predicts its next value is the
    // cheapest possible check that the filter means what it claims.** The SECOND
    // row is the ungated sibling appended at `fix-trainerops` index 13 ("Switch in
    // 1 of your opponent's Benched Pokémon to the Active Spot. This attack does 30
    // damage to the new Active Pokémon."), a new string no fixture printed before.
    // Both carry "opponent's"; neither adds an id to a standing row.
    // ⚠️ D232 MOVED IT 88 → 90, BY EXACTLY TWO OUT OF FOUR NEW FIXTURE ATTACKS,
    // AND THE TWO THAT DID NOT MOVE IT ARE THE INTERESTING HALF. `fix-trainerops`
    // gained four (25-28): "Discard a random card from your opponent's hand." and
    // "Choose a random card from your opponent's hand. Your opponent reveals that
    // card and shuffles it into their deck." each carry the possessive and are new
    // strings, so two rows. "Your opponent reveals their hand." and N's Purrloin's
    // "Your opponent reveals their hand, and you choose a card you find there and
    // put it on the bottom of their deck." carry NO APOSTROPHE AT ALL — the
    // family's whole reveal half addresses the opponent in the SECOND person
    // ("their hand"), where its take half needs the possessive ("your opponent's
    // hand"). One family, two grammars, and this sweep sees exactly the one that
    // exposes a byte.
    // ⚠️ AND THE SWEEP IS A FLOOR ON THE FOLD, NOT ON THE FAMILY: D232's catalog
    // census found ZERO curly-apostrophe printings of either sentence in all 3,786
    // rows, so these two rows prove the fold works on them and say nothing about
    // whether any card needs it. That is the honest reading of every row here.
    // ⚠️ D239 MOVED IT 90 → 91, BY ONE OF THE THREE FIXTURE ATTACKS IT ADDED, AND
    // THE ARITHMETIC IS THE SAME LESSON AS D232's. `fix-crown` gained TWO derivable
    // attacks and both carry "your opponent's" — but its INDEX 1 is D146's
    // *"…from Basic Pokémon."*, a sentence the pool has printed since 0.95.0 and
    // which is therefore an existing ROW gaining an id, not a new row. Only the
    // `non-{C}` spelling is a new string. `fix-colorless-brawler`,
    // `fix-dual-colorless` and `fix-stage1-brawler` print no effect text at all.
    // **A fixture attack moves this count only when its SENTENCE is new**, which
    // is the same distinction the D232 paragraph above draws one axis over.
    // ⚠️ D240 MOVED IT 91 → 93, BY BOTH OF THE FIXTURE ATTACKS IT ADDED, AND THIS
    // IS THE CASE D239's ARITHMETIC PREDICTS RATHER THAN THE EXCEPTION TO IT.
    // `fix-carapace` and `fix-carapace-tough` print the SAME two sentences
    // ("…if that damage is 40 or less." / "…60 or less."), so four new fixture
    // attacks buy exactly TWO new rows — both sentences are new strings, and the
    // second body adds ids to rows the first one opened. `fix-heavy` prints no
    // effect text at all. **A fixture attack moves this count only when its
    // SENTENCE is new**, stated once and now measured twice in both directions.
    // ⚠️ D251 MOVES IT 93 → 94, BY EXACTLY ONE OF THE FOUR FIXTURE ATTACKS IT
    // ADDED — THE THIRD MEASUREMENT OF THE SAME ARITHMETIC AND THE FIRST WHERE THE
    // NEW BODY WAS WRITTEN WITH IT IN MIND. `fix-abilitybody` carries four attacks
    // and three of them print sentences the pool already has: its Spread Shot is
    // `fix-sniper`'s byte for byte and its Feint Attack is `fix-feint`'s, so both
    // are existing ROWS gaining an id. Only "Pebble Toss" — *"This attack does 40
    // damage to 1 of your opponent's Pokémon."* — is a new string (`fix-feint`'s
    // twin carries the `ignoreWR` tail, which makes it a different sentence).
    // `fix-cornerstone` and `fix-abilityv` print bare damage and no effect text.
    // **A fixture attack moves this count only when its SENTENCE is new.**
    // 🛑 D257 MOVES IT 94 → 97, THE BIGGEST SINGLE MOVE THIS COUNT HAS TAKEN, AND
    // THE REASON IS AN ARITHMETIC RANGE RATHER THAN A NEW MECHANISM. `fix-crusher`
    // carries eight attacks and FIVE of them print sentences the pool already has:
    // its Small Spread is `fix-sniper`'s byte for byte, its Yawn is
    // `fix-shellcracker`'s, and its three bare-damage attacks (Crush 200 / Nip 190 /
    // Tap 110) print no effect text at all. The THREE new strings are all the same
    // three sentences one magnitude up — *"…does 200 damage to each of your
    // opponent's Benched Pokémon."*, *"…does 200 damage to 1 of your opponent's
    // Pokémon."* and its `ignoreWR` twin. 🆕 **A NUMBER IS PART OF A SENTENCE, SO A
    // THRESHOLD ROW CANNOT REUSE A POOL BUILT AROUND SMALL ONES.** Every prevention
    // fixture before this one tops out at 50 and D257's gate does not open below
    // 200, so the reuse sweep — which is about the CLAUSE — had nothing to offer and
    // three rows had to be new. **The count moving is the correct answer here, not a
    // failure to reuse**, and the six-slice run of ZEROs on this guard ends for a
    // reason that is stated rather than absorbed.
    // 🆕🆕 D348 MOVES IT 97 → **99**, +2, AND BOTH ROWS ARE NEW SENTENCES RATHER
    // THAN A FAILURE TO REUSE — the guard's own standard, applied. The counter
    // SPREAD (arm 23a) needs a driver at BOTH ends of a split this pool had no body
    // for: `fix-spread-bench` prints *"Put 2 damage counters on your opponent's
    // Benched Pokémon in any way you like."* and `fix-spread-any` prints the
    // `opponentAny` zone with **no printed damage at all**. Neither string is in the
    // pool at any magnitude — the reuse sweep was run before the number was touched
    // and the nearest existing rows are arm 23's *"on 1 of your opponent's Benched
    // Pokémon."* (the determiner, a different sentence) and `fix-sniper`'s
    // *"…to each of your opponent's Benched Pokémon."* (a fold, no pick).
    // ⚠️ AND THIS RUNG IS WHY THE SLICE FOUND OUT AT ALL: adding a fixture is not a
    // figure a slice thinks to grep for, and nothing in this arm's vocabulary
    // reaches this file. The full `check` found it, as the header promises.
    // 🆕🆕 D361 MOVES IT 99 → **102**, +3, AND ALL THREE ARE NEW SENTENCES RATHER
    // THAN A FAILURE TO REUSE — the guard's own standard, applied BEFORE the number
    // was touched. `fix-crossseatdiscard` prints the cross-seat Energy discard's
    // three printed strings, and the reuse sweep found no fixture printing any of
    // them at any magnitude: the nearest existing rows are Pincurchin `sv02-072`'s
    // *"Discard an Energy from your opponent's Active Pokémon."* (a DIFFERENT noun
    // phrase — the whole point of the slice is that the phrase varies) and
    // Giacomo's registry sentence, which no fixture prints at all.
    // 🛑 **AND THIS RUNG IS THE SLICE'S ONE PREDICTION MISS, WHICH IS WORTH MORE
    // THAN THE THREE IT GOT RIGHT.** D361 predicted its red surface by running the
    // PLANNED REGEXES over every string literal in `packages/engine/src` and by
    // walking the census columns — a method that reaches every guard keyed on a
    // SENTENCE or on a COUNT, and reaches **nothing** keyed on the FIXTURE POOL.
    // The header's promise held exactly as written: the full `check` found it, and
    // no grep of this slice's own vocabulary ever would have.
    // 🆕 D362 — 102 -> **104**, and the +2 is a FIXTURE landing rather than a
    // reader widening on an existing body: `fix-exonly` prints TWO sentences and
    // both carry the possessive `opponent's` AND become reader-resolved in the
    // same commit — *"If your opponent's Active Pokémon is a Pokémon ex, this
    // attack does 90 more damage."* (the clause table's new row) and *"Discard an
    // Energy from your opponent's Active Pokémon ex."* (the new anchor).
    // ⚠️ **THIS FILE WAS D361's ONE MISS AND IT WAS PREDICTED AT D362**, by asking
    // what adding a FIXTURE moves rather than only what adding a SENTENCE moves —
    // this header's own promise, collected. The exposed slots are a POSSESSIVE on
    // a literal clause-table KEY (read through `literalClauseRow`, which folds
    // U+2019) and a POSSESSIVE inside an anchored regex (which spells `['’]`
    // itself), so the pair proves the fold across BOTH mechanisms at once — the
    // first time this sweep has covered a table row and a regex on one fixture.
    // 🆕🆕 D363 — 104 → **105**, ONE sentence, and it was PREDICTED HERE BY NAME
    // before the fixture landed rather than discovered by running the suite: the
    // question D362 left standing ("what does adding a FIXTURE move?") was asked
    // against this file first, and `fix-sawk`'s own block in `testFixtures.ts`
    // names this count and this line. Sawk's *"If your opponent's Active Pokémon
    // isn't a Pokémon ex, this attack does nothing. This attack's damage isn't
    // affected by Weakness or Resistance."* carries THREE apostrophes — a
    // POSSESSIVE inside a clause-table KEY and TWO CONTRACTIONS, one of them in
    // the key too. ⚠️ **AND IT IS THE FIRST SENTENCE THIS SWEEP HAS COVERED THAT
    // NO READER RESOLVES WHOLE WITHOUT A SPLIT**: what folds is the CLAUSE inside
    // a two-sentence string, so the fold is proven through the widened anchor's
    // capture group and not only through a whole-sentence one.
    //
    // ⚠️ **TWO, NOT ONE — AND THE SECOND IS WHY THIS COUNT IS ASSERTED RATHER
    // THAN REASONED.** `fix-sawk` carries THREE attacks and this sweep picks up
    // the two whose LEADING clause the requirement table carries: the printed
    // Sawk sentence and the constructed "Unread Rider" control beside it (same
    // mapped clause, a companion no reader resolves). Its third attack prints an
    // UNMAPPED clause and is correctly absent, which is the accounting guard
    // showing through a census that knows nothing about it. Predicted 105 from
    // "one fixture, one sentence"; measured 106.
    //
    // 🆕🆕 D365 — **106 → 109, MEASURED AND NOT GUESSED.** This slice adds three
    // attacker fixtures and all three print an apostrophe ("don't", "doesn't",
    // "don't"), so all three enter this census — 3 fixtures, 3 sentences, +3, a
    // 1:1:1 step where D363's was 1:2. ⚠️ **AND THE FIVE OTHER FIXTURES THIS SLICE
    // ADDS MOVE IT BY ZERO**: `fix-uxie`, `fix-azelf` and `fix-lakebystander` are
    // bench bodies with NO attacks at all, so they carry no sentence for any
    // reader to resolve. **A FIXTURE COUNT IS NOT A SENTENCE COUNT** — eight
    // fixtures, three census entries.
    // 🆕🆕 D369 — **109 → 110.** ONE attacker fixture (`fix-oppotool`), ONE printed
    // sentence, and it spells a possessive ("your opponent's"), so it enters this
    // census the day its fixture lands — which is the discovered-not-listed shape
    // this file was built for. The slice's OTHER new deck entries move it by zero:
    // `sv01-152`, `sv01-197`, `fix-tool`, `fix-benchfiller` and `fix-bigbody` were
    // all already in the pool.
    // 🆕🆕 D370 — **110 → 110, MOVED BY NOTHING.** `fix-benchtype` prints a real new
    // sentence and it spells NO apostrophe at all, so the fixture lands and this
    // census does not move. **A NEW ATTACKER FIXTURE IS NOT A NEW CENSUS ENTRY.**
    // 🆕🆕 D372 — **111 → 113, +2, AND IT IS THE MIRROR OF D371's ARITHMETIC.**
    // THREE new fixtures and exactly TWO census entries: `fix-sameenergy` and
    // `fix-sameenergy-120` print DIFFERENT sentences (the same clause at 100 and at
    // 120, both spelling the possessive "your opponent's"), so a sentence-keyed
    // census takes both. D371 had two fixtures under ONE sentence and moved this by
    // one; this slice has two fixtures under TWO sentences and moves it by two.
    // `fix-energyholder` carries no attack at all. **THREE FIXTURES, TWO ENTRIES.**
    // 🆕🆕 D371 — **110 → 111.** SIX new fixtures and exactly ONE census entry:
    // `fix-oppresist` and `fix-oppresist-f` print the SAME sentence (*"If your
    // opponent's Active Pokémon has {F} Resistance…"*, a possessive, so it enters),
    // and this census is SENTENCE-keyed with the ids collected under it — so a
    // second holder of one sentence is a second id, not a second entry. The four
    // defender bodies carry no attack at all. **SIX FIXTURES, ONE ENTRY, TWO IDS.**
    // 🆕🆕 D374 — **113 → 114.** THREE new fixtures and exactly ONE census entry:
    // `fix-trbonus` prints the NAMED-ENERGY sentence (a possessive, so it enters),
    // and the two prefixed Special ENERGY cards carry no attack at all — this census
    // walks `card.attacks`, so an Energy is invisible to it however its name is
    // spelled. **THREE FIXTURES, ONE ENTRY.**
    // 🆕🆕 D375 — **114 → 115.** TWO new fixtures and exactly ONE census entry:
    // `fix-typeshare` prints the TYPE-INTERSECTION sentence (a possessive, so it
    // enters), and `fix-bigfairy` carries no attack at all. **TWO FIXTURES, ONE
    // ENTRY.**
    // 🆕🆕 D377 — **115 → 118.** THREE new fixtures and THREE census entries, the
    // widest single step this line has taken since D367. `fix-roastheat` prints the
    // BURNED bonus sentence, `fix-mindcrush` prints the CONFUSED bonus sentence (its
    // index-0 setter, *"Your opponent's Active Pokémon is now Confused."*, is already
    // in the pool and so is not a new entry) and `fix-charbreath` prints the CANCEL
    // sentence (its index-0 *"…is now Burned."* is likewise already printed by
    // `sv01-029` and `sv01-041`). **THREE FIXTURES, THREE ENTRIES — and the reason it
    // is three and not five is that a census keyed on the SENTENCE cannot count a
    // sentence twice.**
    // 🆕🆕 D378 — **118 → 118, AND THE ZERO IS THE MEASUREMENT.** TWO new fixtures and
    // ZERO census entries: `fix-mountaindrop` prints *"If a Stadium is in play, …"*
    // and `fix-assaultland` prints *"If there is no Stadium in play, …"*, and NEITHER
    // carries an apostrophe, so neither can enter a sweep keyed on `'`. ⚠️ **AND A
    // THIRD THING MOVED IN BOTH DIRECTIONS AND CANCELLED**: `fix-sawk`'s index-2 rider
    // was re-pointed from the Stadium sentence to the exact hand-size one, and BOTH
    // spellings carry the rider's own *"attack's"*, so the entry neither entered nor
    // left. **A CENSUS KEYED ON A CHARACTER MOVES WHEN A FIXTURE'S TEXT CHANGES, NOT
    // ONLY WHEN A FIXTURE IS ADDED — and this slice checked that both ways.**
    // 🆕🆕 D379 — **118 → 119, AND THE ONE IS THE MEASUREMENT.** ONE new fixture and
    // ONE new census entry: `fix-triocheehoo` prints *"If you don't have exactly 3
    // cards in your hand, …"*, which carries "don't" and therefore DOES enter a sweep
    // keyed on `'` — the opposite of D378's pair, and the reason the two slices move
    // this figure differently is the character and not the fixture count. ⚠️ **AND
    // `fix-sawk`'s index-2 rider MOVED AGAIN AND CANCELLED AGAIN**: it was re-pointed
    // from the printed hand-size sentence to a CONSTRUCTED one ("exactly 4"), and both
    // spellings carry "don't" as well as the rider's own *"attack's"*, so the entry
    // neither entered nor left. Both directions measured, as at D378.
    // 🆕🆕 D384 — **119 → 120, AND THE CHARACTER DECIDED IT AGAIN.** ONE new fixture
    // and ONE new census entry: `fix-moreenergy` prints *"If this Pokémon has more
    // Energy attached than your opponent's Active Pokémon, …"*, which spells the
    // possessive and therefore DOES enter a sweep keyed on `'` — D379's case rather
    // than D378's, and the fifth slice running where the fixture COUNT says nothing
    // and the fixture TEXT says everything.
    // 🆕🆕 D387 — **120 → 121, AND THE CHARACTER DECIDED IT AGAIN.** ONE new attacker
    // fixture and ONE new census entry: `fix-spirited` prints *"If your opponent's
    // Active Pokémon is a Stage 1 Pokémon, …"*, which spells the possessive and
    // therefore DOES enter a sweep keyed on `'` — D384's case rather than D378's.
    // ⚠️ AND THE SLICE ADDED **THREE** POKÉMON FIXTURES, of which only this one prints
    // a sentence at all: the other two are DEFENDERS with no attack text, so the
    // fixture COUNT says nothing and the fixture TEXT says everything, for the sixth
    // slice running.
    // 🆕🆕 D388 — **121 → 122, AND THE CHARACTER DECIDED IT AGAIN.** ONE new attacker
    // fixture and ONE new census entry: `fix-aerochase` prints *"If the Retreat Cost of
    // your opponent's Active Pokémon is {C}{C} or more, …"*, which spells the possessive
    // and therefore DOES enter a sweep keyed on `'`. ⚠️ AND THE SLICE ADDED **THREE**
    // POKÉMON FIXTURES, of which only this one prints a sentence at all: the other two
    // are silent DEFENDERS, so the fixture COUNT says nothing and the fixture TEXT says
    // everything, for the seventh slice running.
    // 🆕🆕 D393 — 122 -> **123**: the EVOLVE PAIR added FOUR Pokémon fixtures and
    // exactly ONE of them prints an apostrophe-bearing sentence (`fix-abruptflash`,
    // Misty's Starmie). Its printed pre-evolution `fix-mistystaryu` carries the same
    // possessive in its NAME and no sentence at all, which is the eighth slice running
    // on which the fixture COUNT says nothing and the fixture TEXT says everything.
    // 🆕🆕 D399 — **124 → 125, AND THE CHARACTER DECIDED IT FOR THE NINTH SLICE
    // RUNNING.** ONE new Pokémon fixture and ONE new census entry: `fix-hazardousgreed`
    // (Wo-Chien `sv08-015`) prints *"…this attack also does 120 damage to 2 of **your
    // opponent's** Benched Pokémon. (**Don't** apply Weakness and Resistance…)"*, which
    // spells the possessive AND the contraction and therefore enters a sweep keyed on
    // `'`. ⚠️ **ITS INDEX-1 SENTENCE (*"Discard the top 3 cards of your deck."*) DOES
    // NOT**, so the fixture adds ONE entry rather than two — a census keyed on a
    // CHARACTER counts sentences, not cards, and this fixture prints both kinds.
    // 🛑🛑 D419 — **139 → 140, AND NOTHING SHIPPED: THIS FIGURE WAS FALSE AT THE HEAD.**
    // The membership filter above ran over this file's hand-kept SIX-reader table, and
    // Wellspring Mask Ogerpon ex's "Torrential Pump" (*"You may shuffle 3 Energy
    // attached to this Pokémon into your deck. If you do, this attack also does 120
    // damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and
    // Resistance for Benched Pokémon.)"*) is claimed by `deriveAttackOptionalCostBoost`
    // and by NO other reader — so from **D381 (2026-08-21)** this sentence was
    // derivable, apostrophe-bearing (**three** exposed slots: the possessive and the
    // contraction), printed by a fixture in `FIXTURE_POOL`, and NOT SWEPT. The suite
    // whose entire job is *"every derivable apostrophe sentence survives a U+2019
    // re-ingest"* had a hole in it for the whole of that time and said 139 the entire
    // way. ⚠️ AND THE SHAPE OF THE MISS IS D409's, ONE INSTRUMENT OVER: that slice
    // widened this same filter for the COMPOSITION path after finding three
    // apostrophe-bearing compounds outside it. The reader path had the identical
    // defect and was not looked at, because the list it folded over looked complete.
    expect(derivable).toHaveLength(191); // 🆕🆕 D464 +1 sentence / +2 printings (THE FLIP-GATED STATUS THAT ALSO STRIPS AN ENERGY — `censusAttackCorpus.ts` **file line 264**, *"Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed, and discard an Energy from that Pokémon."*, **1 sentence / 2 legal printings**, claimed WHOLE by `deriveAttackEffect` arm 2d through ONE new anchor (`FLIP_DEFENDER_STATUS_THEN_DISCARD`) whose program is arm 2's `applyStatus` followed by `FLIP_OPPONENT_ACTIVE_DISCARD`'s `discardEnergy` inside ONE `coinFlipGate`. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP DISAGREE, 1 vs 2** — one file line carrying two legal printings, so a pass that copied one number into the other kind of site would be wrong at EVERY site (D463's agreed at 2 and 2, which is the trap in the other direction). RAW summand ALONE: no registry row, no gate split and no trailing split is involved, and the reader surface stands still at 13. ZERO new `EffectOp` members, op FIELDS, op VALUES or FIXTURE ids — `fix-oxford` index 2 ALREADY printed this sentence, as D462's loud control. 🛑 **`OPAQUE` MOVES FOR THE SECOND SLICE RUNNING** (87/125 → 86/123), and this row sat in it: no deletion and no substitution `residue-census.ts` can make reaches a built string, because the edit that would — deleting the trailing consequent — must take the sentence-final period with it.) 🆕🆕 D463 +2 sentences / +2 printings (THE PER-HEADS ENERGY DISCARD — `censusAttackCorpus.ts` **file lines 200 and 234**, *"Flip {2 coins|a coin until you get tails}. For each heads, discard an Energy from your opponent's Active Pokémon."*, **2 sentences / 2 legal printings** — ONE printing per file line — claimed WHOLE by `deriveAttackCoinFlip` through TWO new anchors onto the SHIPPED `programPerHeads` member carrying the SHIPPED `discardEnergy {from:"opponentActive", filter:{kind:"anyEnergy"}}` op, the first `programPerHeads` consequent that PARKS. ⚠️ **THE SENTENCE STEP AND THE PRINTING STEP AGREE, 2 AND 2** — which is the OPPOSITE of D461 and D462, so a pass that assumed they disagree would be wrong at EVERY site rather than at half of them. RAW summand ALONE: no registry row, no gate split and no trailing split is involved, and the reader surface stands still at 13. ZERO new `EffectOp` members, op FIELDS, op VALUES, `AttackCoinFlip` members or FIXTURE ids. 🛑 **THE FIRST SLICE IN FOUR TO MOVE `OPAQUE`** (88/126 → 87/125): line 234 was classified `OPAQUE` by `residue-census.ts` and line 200 `SUBST-7`, and that class was a statement about the INSTRUMENT's reach rather than about the work.) 🆕🆕 D462 +1 DERIVABLE APOSTROPHE SENTENCE (THE THREE-STATUS OXFORD LIST — `censusAttackCorpus.ts` file line 679, whose *"Your opponent's"* possessive is exposed exactly as the pair anchor's is; the fixture landed and the DISCOVERED sweep found it, which is D137's design working rather than a chore). 🆕🆕 D460 +3 DERIVABLE APOSTROPHE SENTENCES (THE COIN-COUNT THRESHOLD — `censusAttackCorpus.ts` file lines 213, 214 and 228, each carrying ONE exposed possessive slot in *your opponent's Active Pokémon*, all three now claimed by `deriveAttackCoinFlip` and all three printed by `fix-threshflip` in `FIXTURE_POOL`. 🛑 THIS IS D425's RULE BITING AGAIN — a census delta that arrives through a FIXTURE and a reader at once, and which no reader-side forecast alone would have predicted.) 🆕🆕🆕🆕 D451 (THE PLACEMENT WHOSE AMOUNT IS NOT PRINTED — `censusAttackCorpus.ts` lines **425**, **426** and **427**, *“Put damage counters on {each of your opponent's Benched|your opponent's Active} Pokémon until its remaining HP is {100|10|50}.”*, **3 sentences / 5 legal printings** — and the whole of the column's `\bHP\b` rows, so the class is CLOSED at this head rather than sampled. Claimed WHOLE by `deriveAttackEffect` arms **23g** and **23h** through TWO new anchors over ONE new `EffectOp` `counterUntilRemainingHp{target, remainingHp, source}`. **THE AMOUNT IS NOT PRINTED**: it is `effectiveMaxHp − damage − remainingHp`, computed PER BODY inside the walk — the printed distributive *“its”* — so the op carries no `amount` and the number it does carry is HP rather than counters (no × 10). ZERO new readers — surface unmoved at **13** — ZERO new `CardFilter` members, prompt/choice kinds, events or registry rows, ZERO `packages/schema` and ZERO `redact.ts` bytes; `MATCH_RECORD_VERSION` **STAYS 29**, a new `EffectOp` inhabitant being a WIDENING (D383–D385) on an op that never parks. ⚠️ IT LEAVES THE UNBUILT SIDE THROUGH THE SWEEP AND NOT THROUGH A SUBTRAHEND: no registry row, no split, no compound — so the raw refusal and the residue move TOGETHER by the same 3.) ⚠️ ALL THREE CARRY THE POSSESSIVE `opponent's` (U+0027 on the corpus bytes) and all three are newly DERIVABLE, so this fixture-and-reader-keyed sweep steps by the same 3 the reader census does — D425's two routes crossed in one commit, again, and the +3 is not separable into two deltas. 🆕🆕🆕🆕 D450 +3 sentences (THE THREE COUNTER FOLDS — `censusAttackCorpus.ts` lines **418**, **415** and **414**, **3 sentences / 3 legal printings**, claimed WHOLE by `deriveAttackEffect` arms **23d**, **23e** and **23f** over the SHIPPED op `counterEachAll`, which gains its FIRST ATTACK producer since D340 plus TWO REQUIRED fields (`side: "both" | "opponent"`, `source: "ability" | "attack"`) and ONE optional rider (`damagedOnly`, D437's spelling reused verbatim). ZERO new readers — surface unmoved at 13 — ZERO new ops, ZERO new prompt/choice kinds, ZERO new events, ZERO registry rows, ZERO `packages/schema` and ZERO `redact.ts` bytes; `MATCH_RECORD_VERSION` STAYS 29 because no v29 record can hold a `counterEachAll` literal at all — the op never parks and its one v29 producer was a program of length 1.) 🆕🆕🆕 D449 +2 derivable apostrophe-bearing sentences, both printed by the ONE new fixture `fix-counterput` (its third attack prints a sentence `fix-scaledsnipe` already prints, so the sweep — keyed on the SENTENCE and not the card — sees TWO and not three) (THE PUT-COUNTER VERB WITH A CHOSEN TARGET — *"Put 2 damage counters on 1 of your opponent's Pokémon."* (corpus line 413) and *"Choose 2 of your opponent's Pokémon and put 3 damage counters on each of them."* (line 83), **2 sentences / 2 legal printings**, claimed WHOLE by `deriveAttackEffect` arms 23b and 23c through TWO new anchors over the SHIPPED op literal `damageChosen {target: "opponentAny", count, source: "attack"}` with `deals` ABSENT — the literal arm 25's first op has emitted since D143. **ZERO new ops, ZERO new op FIELDS, ZERO new readers** (the reader surface stands still at 13), ZERO registry rows, ZERO `packages/schema` and ZERO `redact.ts` bytes; `MATCH_RECORD_VERSION` **STAYS 29** because no key and no union member arrived — only a PRODUCER of a literal v29 already admitted, driven over the serialized bytes in THREE directions in `counterPutChosen.test.ts` §3. 🛑 **THE WORK ORDER SAID NO ANCHOR CLAIMED THIS VERB AND FOUR DID.** The bare any-zone spelling was missing because a D143 doc block measured *"not printed as a standalone sentence ANYWHERE in the pool"* on the LOCAL pool while the engine runs on `legal_standard = 1`, where it carries 1 printing — D413's two-populations failure biting a REFUSAL, corrected in place at `COUNTER_PUT_ANY_THEN_SELF_LOCK`.) 🆕🆕🆕 D448 +2 derivable sentences (A COUNT SOURCE ON THE SNIPE'S OWN AMOUNT — *"This attack does {20|30} damage to 1 of your opponent's Pokémon for each Energy attached to this Pokémon. (Don't apply …)"* (corpus lines 552 and 570), **2 sentences / 3 legal printings**, claimed WHOLE by `deriveAttackEffect`'s arm 6d through ONE widening of the SHIPPED anchor `CHOSEN_ANY_TARGET` — an optional count clause taking group 3, which SHIFTED `ignoreWR` to 4 and the number word to 5, D447's index trap — over ONE new OPTIONAL `damageChosen` field `perEnergyOnSelf`. **ZERO new anchors, ZERO new readers, ZERO new ops, ZERO new `DamageCountSource` members, ZERO new `CardFilter` members, prompt kinds, choice kinds, `route` values, events, error codes, `GameState` fields, registry rows, `packages/schema` bytes or `redact.ts` bytes.** `MATCH_RECORD_VERSION` **STAYS 29** — the op PARKS, so its literal really is persisted at `phase.cont.pendingOp`, but a NEW OPTIONAL KEY whose ABSENCE means what it always meant is D125's widening and not D359's rename; driven over the SERIALIZED BYTES in three directions in `scaledAnySnipe.test.ts` §3. 🛑 **THE WORK ORDER'S PREMISE FAILED AND IS CORRECTED IN PLACE (D442): the snipe's amount has scaled since Wo-Chien "Covetous Ivy".** `snipeAmount` (interpreter.ts) is a SECOND, PARALLEL fold — `scaledAttackDamage`'s §8.5 fold reaches the DEFENDING Active only, speaks `DamageCountSource`, lives in a module that imports the interpreter and needs a `cost` `EffectContext` does not carry — so this slice gives an EXISTING fold its second inhabitant rather than building one. A READER-keyed move, so the RAW summand alone steps: the reader SURFACE stands still at **13** (the arm sits inside `deriveAttackEffect`), and `REGISTRY_ATTACKS` (16 units / 10 sentences), `SPLIT_ATTACK_UNITS` (13) and `COMPOUND_ATTACK_UNITS` (21) were RE-MEASURED UNMOVED after the widening rather than assumed, D424's rule. ⚠️ AND NO COMPOUND COMPOSES, MEASURED ON BOTH SIDES: each sentence's only `. ` joiner precedes the W/R parenthetical, which `deriveAttackEffect` does not claim on its own, so `splitAttackTrailingClause` refused both at its TAIL test BEFORE the widening and refuses them at the SHADOW REFUSAL after it — D426's mechanism, two different refusals and one unmoved summand.) // 🆕🆕 D447 +3 sentences — all three carry an apostrophe (`Don't`, and two carry `opponent's`) (THE CHOSEN BENCH SNIPE, BOTH SEATS AND BOTH WORDINGS — corpus rows 514/525 (own side, at 10 and 40) and 587 (the BARE opponent-side wording), **3 sentences / 3 legal printings**, claimed by `deriveAttackEffect` arm 6c through TWO widenings of the shared `ALSO_BENCHED_SNIPE_BODY` over ONE new `damageChosen.target` member `yourBench`.) // 🆕🆕 D446 +2 sentences — the FILTERED IN-PLAY BODY COUNT's OPPONENT-side pair. `fix-inplaybodies` gains attacks 6/7/8 and exactly TWO of the three spell an apostrophe: *"…for each of your opponent**'s** Pokémon ex in play."* and *"…Pokémon ex and Pokémon V in play."* — U+0027 at index **52** on both, measured with `codePointAt` over `legalAttackCorpus()` and not by eye (D421/D440). The Round row carries none. ⚠️ **AND THIS SWEEP IS THE ONLY INSTRUMENT THAT CAN SEE THE `['’]` CLASS IN `IN_PLAY_FOE_BODY_MULTIPLY`**: the corpus byte is U+0027 everywhere, so no census and no board separates a build that spells the class from one that spells a bare `'` — this re-ingest does, by rewriting both fixture sentences at U+2019 and requiring reader-for-reader EQUALITY. // 🆕🆕 D445 +1 sentence — the OPPONENT'S-HAND family. `fix-trainerops` gains attacks 68/69/70 and exactly ONE of the three carries an apostrophe: *"This attack does 30 damage for each card in your opponent's hand."* (the possessive at index 45, U+0027, measured with `codePointAt` over `legalAttackCorpus()`). The other two — the reveal-and-scale and the reveal-and-discard — carry none at all, which is why the step is 1 where D443's was 2. ⚠️ D425's rule: this census moves when a FIXTURE is added, not only when a reader is, and this slice moves it by both routes at once. // 🆕🆕 D443 // 🆕🆕 D443 +2 sentences — the OPPONENT-BOARD Energy move. `fix-trainerops` gains attacks 66/67 and BOTH carry an apostrophe (the possessive `opponent's`, U+0027 in the corpus — measured with `codePointAt` at index 38 and index 41, never by eye), so this census steps by the SAME 2 the reader census does. ⚠️ **THAT IS THE FIRST TIME THE TWO HAVE AGREED IN THIS FAMILY**: every earlier `moveEnergy` sentence (D229's three, D441's, D442's three) carries NO apostrophe at all, so seven reader-census steps moved this figure by ZERO. Both anchors carry `['’]`, and this sweep is the only instrument that can see a build that forgot one. ⚠️ **AND THE STEP CROSSES BOTH OF D425's ROUTES IN ONE EDIT**: the fixture attacks arrive AND the sentences become claimed in the same commit, so the +2 is not separable into two deltas and is not claimed to be. // 🆕🆕 D440 +3 sentences — the FILTERED DISCARD-PILE COUNT's fixture `fix-discardpile` prints FOUR sentences and exactly THREE carry an apostrophe: the two `×` rows spell the possessive `opponent's` (U+0027 in the corpus, `codePointAt` at indexes 70 and 62 — measured, not remembered) and the additive `Ethan's Adventure card` row spells a PROPER-NAME possessive at index 46. The FOURTH (*"…for each Energy card in your discard pile."*) carries none at all, so this census steps by THREE where the reader census steps by FOUR — which is the distinction this file exists to keep. ⚠️ **AND THE STEP CROSSES BOTH OF D425's ROUTES IN ONE EDIT**: the fixture arrives AND the sentences become claimed in the same commit, so the +3 is not separable into two deltas and is not claimed to be (D429's case, repeating). 🛑 **THE SWEEP IS ALSO THE FALSIFIER FOR THIS SLICE'S ONE APOSTROPHE-BEARING MAP KEY**: `DISCARD_PILE_NOUNS` keys `Ethan's Adventure card` with U+0027, so a bare `Map.get` would lose the row under this file's U+2019 rewrite and the equality rung would go red — which is why the lookup goes through `literalClauseRow` (D137) and not through the map directly, unlike `IN_PLAY_BODY_NOUNS` one vocabulary up whose three keys carry no apostrophe. ⚠️ **THE SECOND D440 FIXTURE MOVES THIS FIGURE NOT AT ALL**: `fix-ethansadv` is a TRAINER, and this sweep reads `card.attacks[].effect` only — the eleventh slice running on which the fixture COUNT says nothing and the fixture TEXT says everything. 🆕🆕 D439 +1 sentence — *"This attack does 30 damage for each of your Team Rocket's Pokémon in play."*, ONE apostrophe-bearing slot (the owner possessive, U+0027 in the corpus), newly claimed by `deriveAttackDamageMultiplier` and printed by `fix-inplaybodies`. ⚠️ **THE OTHER FOUR SENTENCES THIS SLICE CLAIMS CARRY NO APOSTROPHE AT ALL**, so this census steps by ONE where the reader census steps by five — which is the distinction this file exists to keep. And it is D425's SECOND route (a fixture arriving) crossed with D428's THIRD (a previously-refused sentence becoming claimed): both happened in one edit, and the sentence is counted once. 🆕🆕 D438 +2 sentences (THE RETREAT-COST PENALTY — *"This attack does {30|50} less damage for each {C} in your opponent's Active Pokémon's Retreat Cost."*, corpus rows 573/603, **2 sentences / 3 legal printings** that differ at exactly ONE character position (the `3` vs the `5`, index 17 zero-based — DIFFED, not eyeballed), claimed WHOLE by `deriveAttackDamagePenalty` through ONE new anchor `RETREAT_COST_PENALTY` and ONE `if`. A READER-keyed move, so the RAW summand alone steps: the reader SURFACE stands still at **13** (the arm sits inside an existing reader, not a fourteenth), and the count source it names — `opponentActiveRetreatCost` — plus its `scaledAttackDamage` arm have both shipped since D110, so no union member and no evaluator arm arrived with it. `REGISTRY_ATTACKS` (12 units), `SPLIT_ATTACK_UNITS` (13) and `COMPOUND_ATTACK_UNITS` (21) were RE-MEASURED UNMOVED after the anchor landed rather than assumed, D424's rule. ⚠️ AND NO COMPOUND COMPOSES, MEASURED ON BOTH SIDES: each sentence holds **zero** `. ` joiners, so `splitAttackTrailingClause` and `splitAttackGateClause` both return null on it before AND after the widening — D426's mechanism at the degenerate end.) 🆕🆕 D437 +2 SENTENCES from ONE fixture — index 0 (the narrowed print) and index 1 (its un-narrowed control) are two DISTINCT apostrophe-bearing strings and BOTH are derivable, so this sweep steps by TWO where the reader-keyed corpus steps by ONE — THE **FIXTURE** ROUTE, NOT THE READER ROUTE (D425), and this slice moves BOTH in one commit. ONE Pokémon fixture, `fix-filteredsnipe`: the attacker printing corpus row 528 at index 0, the SAME sentence with the narrowing clause deleted at index 1 (the one-axis control) and a deliberately-unread sibling of the printed predicate at index 2. `fix-teaparty` — the benched-only §11 damage shield the D433 pair needs — was ALREADY in the pool since D253 and is reused rather than invented, so it moves nothing here. 🛑 THE FIXTURE PRINTS NO `resistances` ROW AT ALL and its {W} is a TYPE rather than a Resistance, so `Card.resistances` and the FIGHTING count below stand still: a fixture added for a candidate-set claim has no business moving a Resistance census (D427's rule about `fix-drainwall`). // 🆕🆕 D436 +2 SENTENCES from THREE fixtures (THE "EXTRA ENERGY" DECLARATION READ — `fix-powerpress`, `fix-highvoltage` and `fix-extraprobe` all print the clause, which spells a possessive (*"this attack's cost"*) and therefore enters a sweep keyed on `'`. ⚠️ **THREE FIXTURES, TWO ENTRIES**: this census counts SENTENCES, and `fix-extraprobe` prints the SAME +80 sentence `fix-powerpress` does, so it adds an id rather than a row — the tenth slice running on which the fixture COUNT says nothing and the fixture TEXT says everything.) // 🆕🆕 D432 +1 sentence (THE INSTALLED NO-WEAKNESS BAR — *"During your opponent's next turn, this Pokémon has no Weakness."*, corpus row 192, **1 sentence / 3 legal printings**, claimed WHOLE by `deriveAttackEffect` through ONE new anchor `SELF_NO_WEAKNESS` and ONE new field-free `EffectOp` `removeWeakness`. A READER-keyed move, so the RAW summand alone steps: the reader SURFACE stands still at 13 (the arm is inside `deriveAttackEffect`, not a fourteenth reader), and `SPLIT_ATTACK_UNITS`, `COMPOUND_ATTACK_UNITS` and `REGISTRY_ATTACK_UNITS` were RE-MEASURED UNMOVED after the anchor landed rather than assumed, D424's rule. ⚠️ AND NO COMPOUND COMPOSES: the sentence is ONE clause with no `. ` joiner in it at all, so `splitAttackTrailingClause` never sees a tail — D426's mechanism, at the degenerate end.) ⚠️ THIS SWEEP IS FIXTURE-KEYED AND READER-KEYED AT ONCE, and D432 moves it by BOTH AXES ON ONE SENTENCE: `fix-nowk` prints the D432 string AND `deriveAttackEffect` began claiming it in the same commit, so the +1 is not separable into two deltas and is not claimed to be (D429's case, repeating). ⚠️ AND THE SLICE ADDED **THREE** POKÉMON FIXTURES, of which only this one prints an apostrophe-bearing sentence at all: `fix-bolt` prints none, and `fix-nowk-stage1`'s single attack has no `effect` key — the fixture COUNT says nothing and the fixture TEXT says everything, for the tenth slice running. `fix-nowk`'s OTHER two sentences do not enter either, and for two different reasons: index 1 has no `effect` at all, and index 2's corpus row 629 carries apostrophes but is claimed by NO reader, so the membership filter excludes it — which is exactly the `ATTACK_EFFECT_SKIPPED` control it was written to be. 🆕🆕 D429 +3 sentences / +3 printings (THE REST OF THE PRE-DAMAGE FAMILY — corpus rows 71, 72 and 74, *"…discard all Pokémon Tools and Special Energy from your opponent's Active Pokémon."*, *"…discard all Pokémon Tools from this Pokémon. If you can't discard any, this attack does nothing."* and *"…If you discarded a Pokémon Tool in this way, your opponent's Active Pokémon is now Paralyzed."*, **1 legal printing each**, measured over the `legal_standard = 1` attack column this corpus IS (640 sentences / 1,732 printings). All three claimed WHOLE by the SAME reader `deriveAttackPreDamage`, which gained three ANCHORS and three union members and no new instrument — so the ATTACK READER SURFACE STANDS STILL AT 13 and the step arrives through the RAW summand ALONE. ⚠️ `SPLIT_ATTACK_UNITS` (14), `COMPOUND_ATTACK_UNITS` (19) and `REGISTRY_ATTACK_UNITS` (16) were RE-MEASURED after the anchors landed rather than assumed (D424): all three unmoved.) ⚠️ THE THIRD ROUTE AGAIN, PLUS THE SECOND: D428 recorded that this census moves when a reader is added, when a FIXTURE is added, and when a previously-refused sentence becomes claimed. D429 moves it by BOTH of the latter two at once — `fix-preseam` carries all three sentences as fixture text AND all three became derivable in the same commit — so the +3 is not separable into two deltas and is not claimed to be. 🆕🆕 D428 +1, AND IT ARRIVES WITH NO FIXTURE AT ALL — the sweep's OTHER axis, moving alone for the first time in this chain. *"Before doing damage, discard all Pokémon Tools from your opponent's Active Pokémon."* has been printed in `FIXTURE_POOL` since D100 on **Klefki `sv01-096`**, a REAL card transcribed verbatim off the live D1, whose own doc block said in as many words that all seven readers returned null on it. D428's `deriveAttackPreDamage` claims it, so a sentence that was already in the pool crossed the DERIVABLE half of the predicate and the census stepped. ⚠️ **D425's rule said this sweep moves on a fixture addition as well as on a reader one; D428 is the pure reader case, and a slice predicting the delta from ITS OWN new fixtures alone would have got 0.** The apostrophe slot is the possessive `opponent's`, **U+0027** on the bytes (`hexdump -C` on `censusAttackCorpus.ts` line 73 — the corpus file holds zero U+2019), and the anchor spells the class `['’]` like its neighbours, so the U+2019 rewrite this file runs over every derivable sentence resolves identically rather than losing the row.  🆕🆕 D427 +1, and it arrives by BOTH of this sweep's axes at once — the sentence enters `FIXTURE_POOL` (on `fix-suction`) AND becomes derivable (`deriveAttackEffect`'s D427 arm) in the same commit, where D425's four arrived by two routes separately. *"Heal from this Pokémon the same amount of damage you did to your opponent's Active Pokémon."* — its ONE apostrophe slot is the possessive `opponent's`, **U+0027** on the bytes (`hexdump -C` on `censusAttackCorpus.ts` line 286; the corpus file holds zero U+2019). The anchor spells the class `['’]` like 133 of its neighbours, so the U+2019 rewrite this file then runs over every derivable sentence resolves identically rather than losing the row. ⚠️ THE SAME COMMIT'S OTHER NEW POOL TEXT MOVES THIS FIGURE NOT AT ALL: `fix-suction`'s index 3 prints *"Each player draws 3 cards."*, which carries no apostrophe of either class and is claimed by no reader — it is the ATTACK_EFFECT_SKIPPED control, and a census keyed on a CHARACTER cannot see it.)  🆕🆕 D425 +4, AND THE FOUR ARRIVE BY *TWO DIFFERENT ROUTES*, WHICH IS THE PART WORTH WRITING DOWN. Three are sentences that BECAME derivable this slice — *"This attack also does {10|20|30} damage to each of your Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)"*, whose carriers `fix-benchcount`/`swsh10.5-043` (20), `sv01-117` (30) and the new `fix-tremor` (10) were ALREADY in `FIXTURE_POOL`, two of them since D170 and D129 as DECLARED-UNSIMULATED siblings. The FOURTH is *"…to each of your OPPONENT'S Benched Pokémon. (Don't apply…)"* at 10, which has been derivable since the `spreadDamage` op existed and had NO fixture printing it until `fix-tremor` did. ⚠️ **SO THIS SWEEP MOVES ON A FIXTURE ADDITION AS WELL AS ON A READER ADDITION**, and a slice that reasons about it from the reader side alone will predict the wrong delta — the population is `FIXTURE_POOL` ∩ derivable ∩ apostrophe-bearing, and either factor can move it. Note also that the own-side sentence has only ONE exposed apostrophe slot (the `Don't`): it carries no possessive at all, which is precisely the token D425 turned into a capture. The byte is U+0027, measured with `hexdump` on `censusAttackCorpus.ts` line 516, not remembered (D421). 🆕🆕 D424 +5 — FIVE distinct apostrophe-bearing sentences arrive with this slice's five fixtures, and the number is 5 rather than 6 because `fix-ninetales` and `fix-tr-houndoom` print the SAME sentence (this sweep groups by SENTENCE, not by card): (1) *"…is now Burned and Confused."*, (2) its flip twin at Confused+Poisoned, (3) its flip twin at Paralyzed+Poisoned, (4) the COMPOUND *"…is now Confused and Poisoned. Switch this Pokémon…"* — which enters through the `splitAttackTrailingClause` half of this filter, not the reader half, exactly the widening D409 made — and (5) ⚠️ **Glimmora's INDEX-1 "Venoshock"**, *"If your opponent's Active Pokémon is Poisoned, this attack does 100 more damage."*, which is NOT this slice's sentence at all: it is a shipped `deriveAttackDamageBonus` clause that rides in because D144 says transcribe the card's WHOLE printed attack list rather than the attacks a suite intends to drive. Measured (`deriveAttackDamageBonus` returns a `boardCondition`/`opponentActivePoisoned` fold on it), not assumed — and it is the term a count of "this slice's sentences" would have got wrong. 🆕🆕 D423 +1 — `fix-glalie` and `fix-flapple` each print the SAME apostrophe-bearing sentence (*"This attack does 20 damage for each damage counter on your opponent's Active Pokémon."*), so the census gains ONE DISTINCT sentence for TWO new fixtures. 🛑 AND THIS IS THE FIRST OF THE LAST THREE SLICES TO MOVE THIS NUMBER AT ALL: D421's and D422's sentences carry no apostrophe of either class, and both said so here. The possessive is ASCII U+0027 — byte-verified with `cat -A` on the corpus row, not assumed; a brief for this slice asserted U+2019 and was wrong, which is D421's own lesson arriving from the other direction. `OPPONENT_COUNTER_MULTIPLY` carries the `['’]` class anyway, per D137's fix, because a re-ingest that normalised punctuation would move every one of these together. // 🆕🆕 D421 +1 — `fix-gougingfire` prints ONE apostrophe-bearing sentence (*"This Pokémon can't use Blaze Blitz again until it leaves the Active Spot."*, the CONTRACTION alone: no possessive, because the sentence names *this Pokémon* rather than an opponent's). Its INDEX-0 attack prints no effect at all, so the fixture adds ONE entry rather than two — a census keyed on a CHARACTER counts sentences and not cards. It enters through the READER arm rather than D409's composition arm, the sentence being claimed WHOLE by `deriveAttackEffect`. // 🆕🆕 D412 +2 — `fix-compound` gains indices 9 and 10 (the `Heal 50` and `Heal 60` compounds the **SELF**-side retreat lock completes), and unlike D410's pair they carry the apostrophe exactly ONCE EACH and spell only the CONTRACTION (*can't*) — no POSSESSIVE at all, because the self-side clause names *this Pokémon* where the pronoun clause named *your opponent's*. **A CENSUS KEYED ON A CHARACTER DOES NOT CARE HOW MANY TIMES THE CHARACTER APPEARS**, so a sentence carrying it once counts the same as D410's carrying it three times, and the step is +2 for the same reason D410's was: two sentences, not two occurrences and not two fixtures. Both enter through the COMPOSITION arm of the predicate D409 widened — no reader claims either string whole — so that widening is load-bearing for a THIRD slice rather than for the one that made it. ⚠️ AND THE HEADS ARE WHAT MAKE THEM TWO ENTRIES RATHER THAN ONE: the printed TAIL is byte-identical across both, and only the healed amount (50 vs 60) differs, so a sweep keyed on the SENTENCE takes two where a sweep keyed on the CLAUSE would take one. 🆕🆕 D410 +2 — `fix-compound` gains indices 7 and 8 (the Burned and Confused compounds of the pronoun retreat lock) and BOTH carry the apostrophe TWICE OVER, spelling the POSSESSIVE (*opponent's*, twice per sentence) and the CONTRACTION (*can't*). Both enter through the COMPOSITION arm of the sweep's predicate that D409 had to widen to see — no reader claims either string whole — so the widening is load-bearing for a SECOND slice rather than for the one that made it 🆕🆕 D409 +3, AND THE SWEEP ITSELF HAD TO BE WIDENED TO SEE THEM — this census was READER-keyed and D409's five compounds are claimed by NO reader, so three apostrophe-bearing derivable sentences would have landed beside a suite whose whole job is to sweep them while it stood still. `fix-compound` prints SEVEN sentences and only THREE carry an apostrophe: the 2-Energy reduction, the discard-all Paralyze and the poison/no-retreat (all spelling the POSSESSIVE, the last also the CONTRACTION). The two Prize compounds and the refusal control print none at all, which is why the step is 3 rather than 5 or 7 — a census keyed on a CHARACTER counts sentences that carry it and not attacks. ⚠️ AND THE U+2019 RUNG ASSERTS A PROGRAM EQUALITY FOR THESE THREE, NOT A NON-NULL: every reader is null on a compound by construction, so the survival question is whether both HALVES still read after the fold. 🆕🆕 D408 +3, AND THE SWEEP MOVES AGAIN AFTER SIX SLICES STANDING STILL — `fix-lockplural` prints ONE apostrophe-bearing sentence (*"…this Pokémon can't use attacks."*, the CONTRACTION alone) and `fix-deflock` prints TWO (*"During your opponent's next turn, the Defending Pokémon can't attack."* and *"…can't use attacks."*, both spelling the POSSESSIVE and the CONTRACTION). Three sentences off TWO fixtures — a census keyed on a CHARACTER counts sentences and not cards, and `fix-deflock` is the fixture that makes that the difference between +2 and +3. 🆕🆕 D401 +2 — `fix-costsnipe` and `fix-allsnipe`, ONE apostrophe-bearing sentence each: both spell `opponent's` and `Don't`, and each fixture carries exactly ONE attack, so a census keyed on a CHARACTER steps by one per fixture // 🆕🆕 D400 +2 — `fix-twinsnipe` and `fix-twinfeint`, ONE apostrophe-bearing sentence each (the flat one spells `opponent's` and `Don't`; the W/R one spells `opponent's`, `attack's` and `isn't`) // 🆕🆕 D399 +1 — the TWIN CONSEQUENT's printed sentence, apostrophe-BEARING twice over // 🆕🆕 D397 +1 — the BENCHED-CUBONE FILTER's key, apostrophe-FREE
    // Every entry names at least one real card id — the sweep read fixtures, not
    // constructed text.
    for (const entry of derivable) expect(entry.ids.length).toBeGreaterThanOrEqual(1);
  });

  it("derives the U+2019 spelling IDENTICALLY on every reader", () => {
    for (const { sentence, ids } of derivable) {
      const rewritten = curly(sentence);
      // The rewrite actually fired — otherwise the loop below asserts nothing.
      expect(rewritten).not.toBe(sentence);
      expect(rewritten).toContain(RSQUO);
      for (const [name, read] of Object.entries(READERS)) {
        expect(read(rewritten), `${name} lost ${ids.join("/")}: ${sentence}`).toEqual(
          foldNotes(read(sentence)),
        );
      }
      // And at least one of them still says something — equality alone would be
      // satisfied by all five going null together, which is precisely the
      // regression this suite exists to catch.
      // 🆕🆕 D409 — …or the COMPOSITION PATH does, and for a compound that is the
      // whole claim: every reader is null on it by construction, so the survival
      // question is whether the two HALVES still read after the fold. Asserted as a
      // program equality rather than as a non-null, because a splitter that
      // survived the rewrite while one of its clauses quietly stopped resolving
      // would satisfy a non-null and be exactly the regression this file exists for.
      const split = splitAttackTrailingClause(sentence);
      if (split === null) {
        expect(Object.values(READERS).some((read) => read(rewritten) !== null)).toBe(true);
        continue;
      }
      const rewrittenSplit = splitAttackTrailingClause(rewritten);
      expect(rewrittenSplit, `composition lost ${ids.join("/")}: ${sentence}`).not.toBeNull();
      const composed = (parts: { head: string; tail: string }): unknown[] => [
        ...(deriveAttackEffect(parts.head) ?? []),
        ...(deriveAttackEffect(parts.tail) ?? []),
      ];
      expect(composed(rewrittenSplit as { head: string; tail: string })).toEqual(
        foldNotes(composed(split)),
      );
    }
  });
});

/** The `CONDITIONAL_DAMAGE_CLAUSES` rows whose key holds an apostrophe, written as
    the whole printed sentence D115's skeleton reads. Listed as well as swept: the
    sweep proves the fixtures survive a re-ingest, this proves the specific rows the
    fold was built for do — and it keeps saying so if a fixture is ever renumbered
    out of the pool. Amounts are the printed ones.

    🛑 ⚠️ 🆕🆕 **D367 — THIS HALF OF THE FILE HAD NO COMPLETENESS GUARD AT ALL, AND
    IT WAS SHORT BY THREE BEFORE THIS SLICE ADDED ANYTHING.** D365 found the
    REQUIREMENT list stale and re-derived its size from the live reader; D366 found
    that repair keyed on the wrong population and narrowed it with a filter. **Both
    slices worked on the requirement half and neither looked at this one.** Walked
    off the live bonus reader at D366's head, the legal corpus carries **EIGHT**
    distinct apostrophe-bearing clauses through `deriveAttackDamageBonus` and this
    array named **FIVE** — the three it never learned being the two Knocked-Out
    revenge rows (D326/D327) and the bare `is a Pokémon ex` row (D362), every one
    of them added by a slice that edited the table and not this list.

    **A GUARD THAT EXISTS ON ONE HALF OF A SYMMETRIC PAIR IS NOT A GUARD ON THE
    PAIR** — and the missing half is invisible precisely because the half that
    exists is green. The completeness guard below is now keyed on the LIVE BONUS
    READER, exactly as its requirement twin is, so the next slice that adds an
    apostrophe row to this table reddens HERE naming the sentence it added. */
const APOSTROPHE_BONUS_SENTENCES = [
  // Gyarados ex sv01-045/-225 "Tyrannical Tail" — the "already" row.
  "If your opponent's Active Pokémon already has any damage counters on it, this attack does 180 more damage.",
  // Seviper sv02-137 "Cross-Cut" — the Evolution row (D105's reading).
  "If your opponent's Active Pokémon is an Evolution Pokémon, this attack does 50 more damage.",
  // Seviper sv01-128 "Venoshock" — the CROSS-BOARD Poison row. Its own-board twin
  // ("If this Pokémon is Poisoned") is one possessive away and carries NO
  // apostrophe, which is exactly why the keys are whole clauses (D116).
  "If your opponent's Active Pokémon is Poisoned, this attack does 120 more damage.",
  // Sableye sv02-136 "Unseen Claw" — the pool's only "is affected by" clause.
  "If your opponent's Active Pokémon is affected by a Special Condition, this attack does 70 more damage.",
  // Ceruledge sv02-098 "Fighting Sword" — the ex-or-V row, NOT a `hasRuleBox` read.
  "If your opponent's Active Pokémon is a Pokémon ex or Pokémon V, this attack does 100 more damage.",
  // 🆕🆕 D367 — THE THREE THIS LIST WAS ALREADY MISSING, added by the slice that
  // built the guard rather than by the slices that built the rows.
  // D326 — the revenge clause, FIVE printings on one row.
  "If any of your Pokémon were Knocked Out by damage from an attack during your opponent's last turn, this attack does 60 more damage.",
  // D327 — the same clause with an OWNER prefix, Ethan's Pinsir sv10-001.
  "If any of your Ethan's Pokémon were Knocked Out by damage from an attack during your opponent's last turn, this attack does 100 more damage.",
  // D362 — the ex-or-V row above, one printed disjunct shorter. SIX amounts / TEN
  // printings off one row, and the sharpest near-miss in the table.
  "If your opponent's Active Pokémon is a Pokémon ex, this attack does 90 more damage.",
  // 🆕🆕 D367's OWN row — the only one of this slice's seven whose key spells an
  // apostrophe. Regirock ex sv10-101/-214 "Giant Rock".
  // 🆕🆕 D387 — `opponentActiveIsStage1`, the ONE row this slice adds, and it sorts
  // DIRECTLY ABOVE the row it is one printed digit from. It spells a possessive, so it
  // lands in THIS half of the partition and in the ROW partition of it: the type
  // template owns no "Stage" token (`CLAUSE_POKEMON_TYPES` refuses it), which is what
  // the literal row exists for.
  "If your opponent's Active Pokémon is a Stage 1 Pokémon, this attack does 90 more damage.",
  "If your opponent's Active Pokémon is a Stage 2 Pokémon, this attack does 140 more damage.",
  // 🆕🆕 D372's OWN row — the CROSS-BOARD EQUAL-ENERGY clause. Listed at its +100
  // spelling; the pool prints the SAME clause at +120 as well, and one row serves
  // both because the amount lives in the skeleton's capture. It is the first entry
  // in this list whose clause names BOTH Active bodies, and the possessive is on the
  // far one.
  "If this Pokémon and your opponent's Active Pokémon have the same amount of Energy attached, this attack does 100 more damage.",
  // 🆕🆕 D384's OWN row — the STRICT-INEQUALITY TWIN of the entry directly above, and
  // the two are a genuine PAIR in this list for the first time: same two Active bodies,
  // same possessive on the far one, different OPERATOR. ⚠️ **AND IT IS THE PLACE THIS
  // FILE'S POINT IS EASIEST TO SEE** — two keys one operator apart, both folded, both
  // resolving to DIFFERENT members, and a fold that mapped either onto the other would
  // pass every apostrophe assertion in this file while answering the wrong card.
  "If this Pokémon has more Energy attached than your opponent's Active Pokémon, this attack does 160 more damage.",
  // 🆕🆕 D369's OWN row — the CROSS-BOARD Pokémon Tool clause, whose SELF twin
  // ("If this Pokémon has a Pokémon Tool attached") sits in the apostrophe-FREE
  // half of this partition two rows apart in the same table. One possessive is the
  // whole difference between the two keys, and it is the whole difference between
  // the two BOARDS as well — which is why the keys are whole clauses (D116).
  "If your opponent's Active Pokémon has a Pokémon Tool attached, this attack does 80 more damage.",
  // 🆕🆕 D374's OWN row — the NAMED-ENERGY clause. ⚠️ **THE FIRST ENTRY IN THIS LIST
  // WHOSE APOSTROPHE IS INSIDE A PARAMETER AS WELL AS INSIDE THE KEY**: every other
  // one spells a possessive that lives only in the clause-table KEY, while this
  // member carries `name: "Team Rocket's Energy"` as printed text on the VALUE. So
  // `literalClauseRow`'s fold gets the sentence here and the ARM's own
  // `foldApostrophes` gets the card — D137's half-fix hazard, wearing a proper noun,
  // and driven on a curled board in `trEnergyBonus.test.ts` §6.
  "If this Pokémon has any Team Rocket's Energy attached, this attack does 60 more damage.",
  // 🆕🆕 D375's OWN row — the CROSS-BOARD TYPE INTERSECTION. ⚠️ **THE FIRST ENTRY IN
  // THIS LIST WHOSE CLAUSE NAMES BOTH WHOLE BOARDS**: D372's names both ACTIVE
  // bodies, and this one quantifies over Active + Bench on each side. The possessive
  // is on the far side and lives ONLY in the key — the member is NULLARY, so unlike
  // D374's there is no parameter for the fold's second half to reach, which is
  // exactly why this row costs less than that one did.
  "If any of your Pokémon in play are the same type as any of your opponent's Pokémon in play, this attack does 120 more damage.",
  // 🆕🆕 D377's OWN rows — the CROSS-BOARD STATUS PAIR, and the FIRST TIME THIS LIST
  // HAS GAINED TWO ENTRIES IN ONE SLICE. Both possessives live only in the KEY (both
  // members are NULLARY, so D374's parameter half does not recur), and the two keys
  // are ONE PRINTED WORD apart from each other and from the Poison row nine entries
  // up — which is the tightest cluster in this list and the reason the keys are whole
  // printed clauses (D116).
  //
  // ⚠️ AND THE SLICE'S THIRD SENTENCE IS NOT HERE, ON PURPOSE: *"…**isn't** Burned,
  // this attack does nothing."* is the same board fact under the CANCEL consequent, so
  // it belongs to `APOSTROPHE_REQUIREMENT_SENTENCES` below — where it is the first
  // entry whose member was bought by a BONUS row.
  "If your opponent's Active Pokémon is Burned, this attack does 40 more damage.",
  "If your opponent's Active Pokémon is Confused, this attack does 90 more damage.",
  // 🆕🆕 D388's OWN row — the RETREAT-COST THRESHOLD, and the FIRST entry in this list
  // whose grammatical SUBJECT is a card COLUMN rather than a Pokémon: every other key
  // here opens "your opponent's …" or "you …", this one opens "the Retreat Cost of …".
  // The possessive lives ONLY in the key — the member's parameter is a NUMBER (the
  // `{C}{C}` arity), so D374's parameter half does not recur here either.
  "If the Retreat Cost of your opponent's Active Pokémon is {C}{C} or more, this attack does 110 more damage.",
  // 🆕🆕 D393's OWN row — the EVOLVE PAIR's SECOND printing, Misty's Starmie
  // `sv10-047` "Abrupt Flash". 🛑 **THE FIRST ENTRY IN THIS LIST WHOSE POSSESSIVE IS
  // INSIDE THE MEMBER'S PARAMETER RATHER THAN ONLY IN THE KEY** since D374, which is
  // the half of D374's lesson that recurs here: `yourActiveEvolvedFromThisTurn`
  // carries `name: "Misty's Staryu"`, so the fold has a second place to reach and
  // getting one right without the other is exactly D137's half-fix.
  //
  // ⚠️ AND THE SLICE'S OTHER SENTENCE IS NOT HERE, ON PURPOSE: Gholdengo's names
  // `Gimmighoul`, which spells no apostrophe at all, so it lands in the FREE half.
  // One slice, one clause on each side of the partition — the first time that has
  // happened in this run, and part of what pricing the pair as a pair buys.
  "If this Pokémon evolved from Misty's Staryu during this turn, this attack does 80 more damage.",
] as const;

/** 🆕🆕 D367 — the live BONUS reader's CARRIED CLAUSES, walked off the printed
    corpus. The mirror of `carriedClauseSentences()` below, and the population the
    completeness guard this half never had is keyed on. Clauses rather than whole
    sentences, because one row serves every printed AMOUNT (the skeleton captures
    it) — so a sentence-keyed walk would count the same row up to six times. */
function carriedBonusClauses(): ReadonlySet<string> {
  const BONUS = /^If (.+), this attack does \d+ more damage\.$/;
  const carried = new Set<string>();
  for (const [, printed] of legalAttackCorpus()) {
    const clause = BONUS.exec(printed.trim())?.[1];
    if (clause === undefined) continue;
    if (deriveAttackDamageBonus(printed) === null) continue;
    carried.add(clause);
  }
  return carried;
}

/** The SIX APOSTROPHE rows of `ATTACK_REQUIREMENT_CLAUSES` — a CONTRACTION, a
    POSSESSIVE, and rows carrying BOTH in one key, so the fold is exercised on both
    grammatical uses the pool prints and on their co-occurrence.

    ⚠️ 🆕🆕 **D366 — "ALL SIX ROWS" AND "THE WHOLE TABLE" STOPPED BEING THE SAME
    SENTENCE.** The table is SEVEN rows now and the seventh (Victini's *"you have 4
    or fewer Benched Pokémon"*) spells no apostrophe at all, so this list is the
    fold's population and NOT the table's. It must not gain that row — see the
    completeness guard below, which is where the distinction is enforced rather
    than described.

    🛑 🆕🆕 **D365 — THIS ARRAY WAS STALE AT HEAD AND ITS OWN DOC AND TEST NAME
    BOTH SAID SO WITHOUT NOTICING.** D363 added the Sawk row and edited the prose
    right here to claim *"🆕 D363's row carries BOTH in one key"* — while the array
    below still held TWO entries and the test was still named *"folds ALL THREE
    rows"*. Nothing went red, because a hand-written list of a table's rows agrees
    with itself no matter how far behind the table it falls. **A PROSE COUNT
    EDITED IN THE SAME COMMIT AS THE ROW IT DESCRIBES IS NOT THEREBY A LIST THAT
    CONTAINS IT.** The repair is the COMPLETENESS GUARD below the array, which
    re-derives the table's reachable size from the live reader instead of from this
    comment; the list stays hand-written on purpose (it names the CARDS), but it
    can no longer be short without going red. */
const APOSTROPHE_REQUIREMENT_SENTENCES = [
  // Palafin sv03-062/-200 "Justice Kick" — "didn't", the contraction. Note "the
  // Bench", NOT "your Bench": the trap D125's doc block flags, untouched by this.
  "If this Pokémon didn't move from the Bench to the Active Spot this turn, this attack does nothing.",
  // Basculin sv10.5w-024/-108 "Bared Fangs" — the possessive, and the pool's
  // longest clause key. (D364: `sv03-117` Lycanroc, which this comment named
  // through D363, is `legal_standard = 0`; the SENTENCE is unchanged.)
  "If your opponent's Active Pokémon has no damage counters on it before this attack does damage, this attack does nothing.",
  // 🆕 D363 — Sawk sv10.5w-049/-130 "Rising Chop", the row this list was CLAIMED
  // to hold and did not: BOTH uses in one key, "opponent's" and "isn't". Printed
  // WITHOUT its trailing companion sentence here — the fold is a property of the
  // clause lookup, and the companion is `splitAttackRequirementClause`'s subject.
  "If your opponent's Active Pokémon isn't a Pokémon ex, this attack does nothing.",
  // 🆕🆕 D365 — Iron Boulder sv07-071/sv08.5-046 "Adjusted Horn": "don't", and the
  // key whose positive twin is its own substring.
  "If you don't have the same number of cards in your hand as your opponent, this attack does nothing.",
  // 🆕🆕 D365 — Hop's Cramorant sv09-138 "Fickle Spitting": "doesn't", the THIRD
  // distinct contraction spelling in the table and the family's one parameterised
  // row.
  "If your opponent doesn't have exactly 3 or 4 Prize cards remaining, this attack does nothing.",
  // 🆕🆕 D365 — Mesprit sv08-079/sv08-204 "Guardian Burst": "don't" again, on the
  // row that derives an `allOf`. The fold has to survive a RECURSIVE value, which
  // it does for free — `literalClauseRow` returns the stored value untouched.
  "If you don't have Uxie and Azelf on your Bench, this attack does nothing.",
  // 🆕🆕 D377 — Centiskorch sv05-037 "Charring Breath": BOTH uses in one key again
  // ("opponent's" and "isn't"), like Sawk's two entries up, and the FIRST row in this
  // table whose member was bought by a BONUS row in the same commit
  // (`opponentActiveBurned`, for Slugma sv05-028 "Roasting Heat").
  "If your opponent's Active Pokémon isn't Burned, this attack does nothing.",
  // 🆕🆕 D379 — Alolan Dugtrio sv08-123/sv08-208 "Trio-Cheehoo": "don't" again, and
  // the FIRST row in this table whose member has NO bonus twin at all — both of its
  // legal printings arrive through the cancel consequent. It is also the row that
  // SATURATES the table: with it, every does-nothing opener the legal attack column
  // prints is carried, so this list can no longer grow from the current pool.
  "If you don't have exactly 3 cards in your hand, this attack does nothing.",
] as const;

/** 🆕🆕 D366 — the live reader's CARRIED CLAUSE SENTENCES, walked off the printed
    corpus. Shared by the two completeness guards below so they cannot disagree
    about the population they are each naming half of. Sawk's printed string
    carries a trailing companion, so the head is taken rather than the whole unit. */
function carriedClauseSentences(): ReadonlySet<string> {
  const HEAD = /^(If .+?, this attack does nothing\.)/;
  const carried = new Set<string>();
  for (const [, printed] of legalAttackCorpus()) {
    if (deriveAttackRequirement(printed) === null) continue;
    carried.add(HEAD.exec(printed.trim())?.[1] ?? printed.trim());
  }
  return carried;
}

describe("the literal clause tables — the rows the fold was built for", () => {
  it("folds all NINE apostrophe rows of CONDITIONAL_DAMAGE_CLAUSES", () => {
    for (const sentence of APOSTROPHE_BONUS_SENTENCES) {
      const straight = deriveAttackDamageBonus(sentence);
      // The straight form is the baseline and must still resolve — the fold is a
      // FALLBACK behind an exact hit, so this is the assertion that proves the
      // exact hit is still the one being taken.
      expect(straight).not.toBeNull();
      expect(straight?.count.kind).toBe("boardCondition");
      expect(deriveAttackDamageBonus(curly(sentence))).toEqual(straight);
    }
  });

  it("🛑🆕🆕 D367 — the BONUS list is COMPLETE, re-derived from the live bonus reader", () => {
    // 🛑 **THE GUARD THIS HALF NEVER HAD, AND IT WAS SHORT BY THREE BEFORE THIS
    // SLICE TOUCHED ANYTHING.** Its requirement twin below has existed since D365
    // and was re-pointed at the right population by D366; this table went through
    // D326, D327 and D362 with no guard at all, and each of those slices added an
    // apostrophe row without adding it here. **A COMPLETENESS GUARD ON ONE HALF OF
    // A SYMMETRIC PAIR IS NOT A GUARD ON THE PAIR.**
    //
    // 🛑 ⚠️ **AND WRITING IT REPRODUCED D366's OWN MISTAKE ONE TABLE OVER, WHICH IS
    // WHY THE PARTITION IS EXPLICIT.** "Carried clauses that spell an apostrophe"
    // is NOT "apostrophe ROWS of `CONDITIONAL_DAMAGE_CLAUSES`": D367's own token-map
    // widening made `{P}` and `{D}` resolve, and those two clauses are owned by the
    // parameterised TYPE TEMPLATE, which carries `['’]` in its own regex source
    // (D136) and needs no literal row and no fold. They must NOT be in the list —
    // adding them would assert that a Map key exists where a pattern does. So the
    // walk's apostrophe half is partitioned into ROWS and TEMPLATE, both named.
    //
    // ⚠️ Clause-keyed and not sentence-keyed, because the amount lives in the
    // skeleton and one row serves up to six printed amounts.
    const carried = carriedBonusClauses();
    const withApostrophe = [...carried].filter((clause) => clause.includes(APOS));
    expect(carried.size).toBe(55); // 🆕🆕 D436 — 54 -> **55**, and the new key is APOSTROPHE-BEARING (*"…in addition to this attack's cost"*), so the bearing half takes the whole step 22 -> 23 while the apostrophe-free half stands still at 32. ⚠️ **AND IT IS A THIRD KIND OF OWNER**: neither a literal `CONDITIONAL_DAMAGE_CLAUSES` row nor a clause TEMPLATE, but a WHOLE-SENTENCE anchor (`EXTRA_ENERGY_BONUS`) that never consults the clause table at all — `carriedBonusClauses()` probes the READER, so a sentence claimed by any arm of it lands here whatever route it took. The partition below gains a third bucket rather than the row half gaining an entry. // 🆕🆕 D398 — 53 -> 54, and the key is apostrophe-FREE, so the bearing half stands still at 22 for a SECOND consecutive slice // 🆕🆕 D397 — 52 -> 53, and the key is apostrophe-FREE, so the bearing half stands still at 22 // 🆕🆕 D394 — 50 -> 52, and BOTH keys are apostrophe-FREE, so the bearing half stands still at 22 // 🆕🆕 D393 — 48 -> 50, and the step is SPLIT ONE EACH ACROSS THE PARTITION for the first time in this run: the EVOLVE PAIR's two keys name `Gimmighoul` (apostrophe-FREE, 27 -> 28) and `Misty's Staryu` (apostrophe-BEARING, 21 -> 22, ending FOUR consecutive slices of that half standing still) // 🆕🆕 D392 — 47 -> 48, and THIS half moves again by ONE (26 -> 27) while the apostrophe-bearing half stands still at 21 for a FOURTH consecutive slice // 🆕🆕 D391 — 46 -> 47, and THIS half moves again by ONE (25 -> 26) while the apostrophe-bearing half stands still at 21 for a THIRD consecutive slice. 🛑 AND THE CLAUSE THAT LANDED IS A *LITERAL ROW* rather than a template — "this Pokémon has 2 or more {G} Energy attached" spells no possessive and no contraction, so there is nothing to class; the CHARACTER decides, not the partition // 🆕🆕 D390 — 45 -> 46, and THIS half is the one that moves, by ONE (24 -> 25), while the apostrophe half stands still at 21 for a SECOND consecutive slice. ⚠️ AND IT IS A TEMPLATE CLAUSE ON THE FREE SIDE, not a row — only D370's bench-type key has ever landed there before, so `rowClauses`, `TEMPLATE_OWNED` and `APOSTROPHE_BONUS_SENTENCES` all stand still as well // 🆕🆕 D389 — 44 -> 45, **ONE row and it is apostrophe-FREE this time** (the OPPONENT-SEAT BENCH COUNT key is "your opponent has …" and never "your opponent's …", which is exactly what separates a ZONE count from the Active-Pokémon rows), so the FREE half takes the whole step (23 -> 24) and the bearing half stands still at 21 // 🆕🆕 D388 — 43 -> 44, **ONE row and it is apostrophe-BEARING again** (the RETREAT-COST clause names the far Active with a possessive), so THIS half takes the whole step for the SECOND slice running // 🆕🆕 D387 — 42 -> 43, **ONE row and it is apostrophe-BEARING** (the STAGE 1 clause names the far Active with a possessive), so THIS half takes the whole step (19 -> 20) and the apostrophe-free half stands still at 23 — the mirror of D386, one slice on. // 🆕🆕 D386 — 41 -> 42, **ONE row and it is apostrophe-FREE** (the HEALED-THIS-TURN clause names no possessive and no contraction), so the apostrophe half stands still at 19 and the free half takes the whole step (22 -> 23) — the mirror of D384, one slice on. // 🆕🆕 D384 — 40 -> 41, **ONE row and it is apostrophe-BEARING** (the STRICT-INEQUALITY TWIN, whose key names the far Active with a possessive), so THIS half takes the whole step (18 -> 19) and the apostrophe-free half stands still at 22 // 🆕🆕 D378 — 39 -> 40, **ONE row and it is apostrophe-FREE** ("a Stadium is in play"), so THIS half stands still at 18 and the free half takes the whole step (21 -> 22) — the mirror image of D377, one slice later // 🆕🆕 D377 — 37 -> 39, **TWO rows and both apostrophe-BEARING**, so THIS half moves by two (16 -> 18) while the apostrophe-free half stands still at 21. The first two-row step this line has taken since D367, and the two keys are one printed word apart. // 🆕🆕 D376 — 36 -> 37, ONE row and an apostrophe-FREE one, so THIS half stands still at 16 while the apostrophe-free half moves (20 -> 21): the filtered DISCARD-PILE THRESHOLD names no possessive and no contraction, so it is the OTHER half of the partition that gains it. // 🆕🆕 D375 — 35 -> 36, ONE row and an apostrophe-BEARING one again, so THIS half moves (15 -> 16) while the apostrophe-free half stands still at 20 — the SECOND slice running to land in the ROW partition of the apostrophe half // 🆕🆕 D374 — 34 -> 35, ONE row and an apostrophe-BEARING one, so THIS half moves (14 -> 15) while the apostrophe-free half stands still at 20 // 🆕🆕 D373 — 33 -> 34, ONE row and an apostrophe-FREE one, so THIS half stands still at 14 while the apostrophe-free half moves (19 -> 20) // 🆕🆕 D372 — 32 -> 33, and the new clause is a literal ROW that DOES spell a possessive, so it lands in the apostrophe half (13 -> 14) and in the ROW partition of it — the combination D371's did not have. ⚠️ ONE row and not two: this census is CLAUSE-keyed, and D372's two printed sentences share one clause // 🆕🆕 D371 — 31 -> 32, and the new clause is a TEMPLATE clause that DOES spell a possessive, so it lands in the apostrophe half (12 -> 13) and in the TEMPLATE partition of it, not among the rows // 🆕🆕 D370 — 30 -> 31, and the new clause is neither a row NOR apostrophe-bearing: it is a TEMPLATE clause with no apostrophe, so it lands in the OTHER half of the partition and the fold's population stands still at 12 // 🆕🆕 D369 — 29 -> 30, ONE row, and this time an apostrophe-BEARING one // 🆕🆕 D368 — 28 -> 29, ONE apostrophe-FREE row
    expect(withApostrophe).toHaveLength(23); // 🆕🆕 D436 — 22 -> **23**, the WHOLE-SENTENCE ANCHOR's clause, which is neither a row nor a template // 🆕🆕 D393 — 21 -> 22, the EVOLVE PAIR's possessive-named key // 🆕🆕 D388 — 20 -> 21, the RETREAT-COST clause, a ROW rather than TEMPLATE-owned: `rowClauses` moves 17 -> 18 with it while `TEMPLATE_OWNED` stands still // 🆕🆕 D387 — 19 -> 20, the STAGE 1 clause, a ROW rather than TEMPLATE-owned: `rowClauses` moves 16 -> 17 with it while `TEMPLATE_OWNED` stands still at 3. The member is NULLARY, so the possessive is in the KEY only // 🆕🆕 D384 — 18 -> 19, the STRICT-INEQUALITY TWIN, a ROW rather than TEMPLATE-owned: `rowClauses` moves 15 -> 16 with it while `TEMPLATE_OWNED` stands still at 3. The member is NULLARY, so the possessive is in the KEY only // 🆕🆕 D377 — 16 -> 18, the CROSS-BOARD STATUS PAIR, and BOTH are ROWS rather than TEMPLATE-owned: `rowClauses` moves 13 -> 15 with them while `TEMPLATE_OWNED` stands still at 3. Both members are NULLARY, so the possessive is in the KEY only // 🆕🆕 D375 — 15 -> 16, the CROSS-BOARD TYPE INTERSECTION, a ROW rather than TEMPLATE-owned: `rowClauses` moves 12 -> 13 with it while `TEMPLATE_OWNED` stands still at 3. ⚠️ AND ITS APOSTROPHE IS IN THE KEY ONLY — the member is NULLARY, so D374's parameter half does not recur // 🆕🆕 D374 — 14 -> 15, the NAMED-ENERGY clause, and it is a ROW rather than TEMPLATE-owned: `rowClauses` moves 11 -> 12 with it while `TEMPLATE_OWNED` stands still at 3. ⚠️ AND IT IS THE FIRST WHOSE APOSTROPHE ALSO RIDES THE MEMBER'S OWN PARAMETER // 🆕🆕 D372 — 13 -> 14, the CROSS-BOARD EQUAL-ENERGY clause, and it is a ROW rather than TEMPLATE-owned: `rowClauses` moves 10 -> 11 with it while `TEMPLATE_OWNED` stands still at 3 // 🆕🆕 D371 — 12 -> 13, the OPPONENT-RESISTANCE clause, and it is TEMPLATE-owned rather than a row: the third entry in `TEMPLATE_OWNED` below, so `rowClauses` stands still at 10 while this half moves // 🆕🆕 D369 — 11 -> 12, the cross-board Tool clause. D368's row stood still here; this one does not, and the difference is one possessive
    // The TWO the parameterised template owns — named, so the day the template
    // stops owning one it lands in the row half and this guard says which.
    const TEMPLATE_OWNED = [
      // 🆕🆕 D371 — the THIRD entry, and the first from a template OTHER than
      // `OPPONENT_ACTIVE_TYPE_CLAUSE`: `OPPONENT_ACTIVE_RESISTANCE_CLAUSE` carries
      // its own `['’]` in its own source (D136) and needs no row and no fold, so it
      // belongs on this side of the partition exactly as the two below do.
      "your opponent's Active Pokémon has {F} Resistance",
      "your opponent's Active Pokémon is a {D} Pokémon",
      "your opponent's Active Pokémon is a {P} Pokémon",
    ];
    // 🆕🆕 **D436 — A THIRD BUCKET, BECAUSE A THIRD KIND OF OWNER NOW EXISTS.** This
    // clause is claimed by `EXTRA_ENERGY_BONUS`, a WHOLE-SENTENCE anchor inside
    // `deriveAttackDamageBonus` that carries its own `['’]` (D136) and never reaches
    // `CONDITIONAL_DAMAGE_CLAUSES` or any clause template. Putting it in `rowClauses`
    // would assert that a Map key exists where a pattern does — D367's own mistake,
    // one owner-kind later — so it is NAMED here instead and the partition widens.
    // ⚠️ D421's rule: WIDEN the claim, never exclude your own case from it.
    const ANCHOR_OWNED = [
      "this Pokémon has at least 2 extra Energy attached (in addition to this attack's cost)",
    ];
    const rowClauses = withApostrophe.filter(
      (clause) => !TEMPLATE_OWNED.includes(clause) && !ANCHOR_OWNED.includes(clause),
    );
    expect(rowClauses).toHaveLength(19); // 🆕🆕 D393 — 18 -> 19, a ROW and not a template // 🆕🆕 D388 — 17 -> 18 // 🆕🆕 D387 — 16 -> 17 // 🆕🆕 D384 — 15 -> 16 // 🆕🆕 D377 — 13 -> 15 // 🆕🆕 D375 — 12 -> 13 // 🆕🆕 D374 — 11 -> 12 // 🆕🆕 D372 — 10 -> 11 // 🆕🆕 D369 — 9 -> 10
    expect(APOSTROPHE_BONUS_SENTENCES).toHaveLength(19); // 🆕🆕 D393 — 18 -> 19 // 🆕🆕 D388 — 17 -> 18 // 🆕🆕 D387 — 16 -> 17 // 🆕🆕 D384 — 15 -> 16 // 🆕🆕 D377 — 13 -> 15 // 🆕🆕 D375 — 12 -> 13 // 🆕🆕 D374 — 11 -> 12 // 🆕🆕 D372 — 10 -> 11 // 🆕🆕 D369 — 9 -> 10
    // 19 + 3 + 1 = 23 — parts that do not add to the population are not a partition.
    expect(rowClauses.length + TEMPLATE_OWNED.length + ANCHOR_OWNED.length).toBe(
      withApostrophe.length,
    );
    // …and the third bucket really is carried, so an empty `ANCHOR_OWNED` could not
    // satisfy the arithmetic by accident.
    for (const clause of ANCHOR_OWNED) expect(withApostrophe, clause).toContain(clause);
    const listedClauses = APOSTROPHE_BONUS_SENTENCES.map(
      (sentence) => /^If (.+), this attack does \d+ more damage\.$/.exec(sentence)?.[1] ?? sentence,
    );
    expect([...rowClauses].sort()).toEqual([...listedClauses].sort());
    // And every listed sentence really resolves — a list that had drifted onto a
    // clause the table dropped would otherwise pass the set check vacuously.
    for (const sentence of APOSTROPHE_BONUS_SENTENCES) {
      expect(deriveAttackDamageBonus(sentence), sentence).not.toBeNull();
    }
    // The template half really is a TEMPLATE and not a row, driven rather than
    // claimed: the SAME board fact resolves from the OTHER printed notation, which
    // no literal row spells anywhere in the table.
    for (const clause of TEMPLATE_OWNED) {
      expect(deriveAttackDamageBonus(`If ${clause}, this attack does 30 more damage.`)).not.toBeNull();
    }
    // 🛑🆕🆕 **AND THE ANCHOR HALF REALLY IS ANCHOR-OWNED — DRIVEN, AS ITS TWO
    // NEIGHBOURS ARE.** D436 added this bucket and no driver for it, so membership was
    // asserted by a hand-kept array alone: a build that ALSO added a
    // `CONDITIONAL_DAMAGE_CLAUSES` row for the clause left every figure above
    // unmoved, because `carriedBonusClauses()` probes the READER and
    // `EXTRA_ENERGY_BONUS` is executed before `CONDITIONAL_DAMAGE_BONUS` — the row
    // would be dead on that path. The corpus row
    // `D368-declaration-clause-gets-a-board-row` survived on exactly that. The
    // question is asked HERE at a call site the anchor does not pre-empt: the
    // consequent join, whose reader is exported and whose skeleton this anchor cannot
    // match. An UNMAPPED clause returns null; a row would make it resolve.
    for (const clause of ANCHOR_OWNED) {
      expect(
        deriveAttackBonusConsequent(
          `If ${clause}, this attack does 80 more damage, and discard all Energy from this Pokémon.`,
        ),
        clause,
      ).toBeNull();
      // The control on the same axis (D424): a row-owned clause in the identical
      // carrier DOES resolve, so the refusal above is not a reader that says no to
      // everything.
      expect(
        deriveAttackBonusConsequent(
          "If this Pokémon has no damage counters on it, this attack does 80 more damage, and discard all Energy from this Pokémon.",
        ),
      ).not.toBeNull();
    }
    expect(
      deriveAttackDamageBonus(
        "If your opponent's Active Pokémon is a Psychic Pokémon, this attack does 30 more damage.",
      ),
    ).toEqual(
      deriveAttackDamageBonus(
        "If your opponent's Active Pokémon is a {P} Pokémon, this attack does 30 more damage.",
      ),
    );
  });

  it("🆕🆕 D367 — and the APOSTROPHE-FREE bonus clauses are accounted for too", () => {
    // The other half of the filter above, for the reason D366 gave when it
    // narrowed the requirement guard: once a completeness guard is scoped to the
    // fold's population, every clause the filter DROPS has to land somewhere or the
    // narrowing is just a way of not looking.
    const carried = carriedBonusClauses();
    const without = [...carried].filter((clause) => !clause.includes(APOS)).sort();
    expect(without).toHaveLength(32); // 🆕🆕 D398 +1 — the DECK-SIZE READ's key, apostrophe-free (the expletive head "there are" spells no possessive at all) and a LITERAL ROW // 🆕🆕 D397 +1 — the BENCHED-CUBONE FILTER's key, apostrophe-free // 🆕🆕 D394 +2 — the USED-ATTACK PAIR's two keys, both apostrophe-free // 🆕🆕 D393 +1 — the EVOLVE PAIR's Gimmighoul key, apostrophe-free // 🆕🆕 D392 +1 — the SUBSTRING NAME READ clause, apostrophe-free (ASCII quotation marks, no apostrophe anywhere) and a LITERAL ROW // 🆕🆕 D391 +1 — the TYPED PER-BODY ENERGY THRESHOLD clause, apostrophe-free ("this Pokémon has", no possessive) and a LITERAL ROW rather than template-owned // 🆕🆕 D390 +1 — the OPPONENT-SEAT TYPE READ clause, apostrophe-free ("your opponent has", no possessive) and TEMPLATE-owned rather than a row, so `rowClauses`, `TEMPLATE_OWNED` and `APOSTROPHE_BONUS_SENTENCES` all stand still while this half takes the whole step // 🆕🆕 D389 +1 — the OPPONENT-SEAT BENCH COUNT row, apostrophe-free ("your opponent has", no possessive) and a ROW rather than a template, so `rowClauses` moves with it while `TEMPLATE_OWNED` stands still // 🆕🆕 D386 +1 — the HEALED-THIS-TURN row, apostrophe-free and a ROW rather than a template, so the fold's own population (19) stands still // 🆕🆕 D378 +1 — the STADIUM-PRESENCE row, apostrophe-free and a ROW rather than a template, so the fold's own population (18) stands still // 🆕🆕 D376 +1 — the FILTERED DISCARD-PILE THRESHOLD, apostrophe-free and a ROW rather than a template, so the fold's own population (16) stands still // 🆕🆕 D373 +1 — the UNIVERSAL-OVER-THE-BENCH clause, apostrophe-free and a ROW rather than a template // 🆕🆕 D370 +1 — the bench-scoped TYPE clause, apostrophe-free and TEMPLATE-owned rather than a row // 🆕🆕 D368 +1 — the undamaged complement, an apostrophe-FREE key
    // Pinned BY NAME, so a row added on an apostrophe-free key reddens here.
    expect(without).toEqual(
      [
        // 🆕🆕 D373 — `yourBenchAllDamaged`, the ONE row this slice adds. It carries no
        // apostrophe, so it lands in THIS half of the partition, and it sorts directly
        // above the EXISTENTIAL key it is one method call away from — which is the
        // clearest place in the repo to see that the two are different strings.
        // 🆕🆕 D378 — `stadiumInPlay`, the ONE row this slice adds. It carries no
        // apostrophe and no é, so it lands in THIS half and the fold's own population
        // (18) stands still — the exact mirror of D377, whose two rows both carried a
        // possessive AND a contraction. ⚠️ **AND IT SORTS DIRECTLY ABOVE NOTHING IT IS
        // RELATED TO**: its near miss, *"you have a Stadium in play"*, is in the same
        // half but sixteen entries down, because the printed possessive that separates
        // the two members also separates them alphabetically.
        // 🆕🆕 D392 — the SUBSTRING NAME READ's key, and it is apostrophe-FREE for a
        // FOURTH consecutive slice on this side of the partition. ⚠️ IT CARRIES ASCII
        // QUOTATION MARKS (U+0022) AND NO APOSTROPHE AT ALL, which is worth naming: the
        // fold this file guards is about U+2019 vs U+0027 and reaches neither character,
        // so a key that LOOKS punctuated still has nothing to class. THE CHARACTER
        // DECIDES, NOT THE APPEARANCE.
        'a Pokémon that has "Nidoking" in its name is on your Bench',
        "a Stadium is in play",
        "all of your Benched Pokémon have at least 1 damage counter on them",
        // 🆕🆕 D397 — the BENCHED-CUBONE FILTER's key, and it is apostrophe-FREE
        // for a FIFTH consecutive slice on this side of the partition. ⚠️ IT SORTS
        // DIRECTLY BELOW THE UNIVERSAL KEY ABOVE IT and one entry from the EXISTENTIAL
        // key further down — the three readings of one array, and the only place in the
        // repo where all three printed heads can be read against each other.
        "any of your Benched Cubone have any damage counters on them",
        "Beldum and Metang are on your Bench",
        "Durant is on your Bench",
        "Illumise is on your Bench",
        "Mightyena is on your Bench",
        // 🆕🆕 D391 — `yourActiveEnergyAtLeast`'s NARROWED spelling, the ONE row this
        // slice adds. It carries no apostrophe and no é in the clause's own key, so it
        // lands in THIS half and the fold's own population stands still. ⚠️ **AND IT
        // SORTS DIRECTLY ABOVE THE TWO TEMPLATE ENTRIES IT IS ONE TOKEN FROM**: the
        // `{F}` and `{L}` keys below are `SELF_ENERGY_ATTACHED_CLAUSE`'s captures and
        // share this clause's HEAD and TAIL exactly — which is the clearest place in
        // the repo to see why this shape had to be a ROW and not a sixth pattern.
        // 🆕🆕 D393 — `yourActiveEvolvedFromThisTurn`'s Gimmighoul key, ONE of the TWO
        // rows this slice adds and the only one that lands on this side. ⚠️ **ITS TWIN
        // IS IN THE OTHER HALF** — the same member at `name: "Misty's Staryu"` — so one
        // slice put one clause on each side of this partition for the first time in
        // this run, and the two are separated by nothing but a card's printed owner.
        // 🆕🆕 D398 — `yourDeckAtMost`, the ONE row this slice adds, and it is
        // apostrophe-free for a SIXTH consecutive slice on this side of the partition.
        // ⚠️ **ITS HEAD IS AN EXPLETIVE AND IT IS THE ONLY KEY IN EITHER HALF THAT NAMES
        // NO SEAT** — every other clause here opens with "you", "your", "this Pokémon" or
        // a card name, and this one opens with *"there are"*. The possessive that resolves
        // it to a seat is on the ZONE (*"your deck"*), which is exactly why there is no
        // apostrophe to class: the printed subject owns nothing.
        "there are 3 or fewer cards in your deck",
        "this Pokémon evolved from Gimmighoul during this turn",
        "this Pokémon has 2 or more {G} Energy attached",
        "this Pokémon has a Pokémon Tool attached",
        "this Pokémon has any Special Energy attached",
        "this Pokémon has any {F} Energy attached",
        "this Pokémon has any {L} Energy attached",
        // 🆕🆕 D368 — `yourActiveUndamaged`, the ONE row this slice adds. It carries
        // no apostrophe, so it lands in THIS half of the partition and the fold's
        // own population (11) stands still — which is the measurement that says this
        // slice's row and this file's mechanism are about different things.
        "this Pokémon has no damage counters on it",
        "this Pokémon is Poisoned",
        "this Pokémon moved from your Bench to the Active Spot this turn",
        // 🆕🆕 D386 — `yourActiveHealedThisTurn`, the ONE row this slice adds. It
        // carries no apostrophe, so it lands in THIS half and the fold's own
        // population (19) stands still. ⚠️ **AND IT SORTS DIRECTLY BELOW ITS OWN
        // SIBLING**: the two are the per-turn cluster's only per-BODY stamps, they
        // read two different fields on one `InPlayPokemon`, and here they are
        // adjacent — which is the clearest place in the repo to see that a second
        // stamp on one body is a second FACT and not a second reading of one.
        // 🆕🆕 D394 — TWO new keys, both apostrophe-free, so the BEARING half stands
        // still at 22 while this half takes both.
        "this Pokémon used Form Ranks during your last turn",
        "this Pokémon used Pervasive Gas during your last turn",
        "this Pokémon was healed during this turn",
        // 🆕🆕 D370 — `yourBenchHasType`, the ONE clause this slice adds, and it is
        // the SECOND kind of thing in this half: a TEMPLATE clause, not a row. The
        // two `{F}`/`{L}` entries above are D118's template too, so this half has
        // always mixed the two — the apostrophe half partitions them explicitly and
        // this one does not, which is a gap named here rather than closed, since
        // closing it is a re-scoping of a guard that is not this slice's subject.
        "you have any {M} Pokémon on your Bench",
        // 🆕🆕 D376 — `yourBasicEnergyInDiscardAtLeast`, the ONE row this slice adds,
        // and it sorts directly BELOW the row it is one zone away from. ⚠️ **THAT
        // ADJACENCY IS WORTH SEEING HERE**: the two keys read as the same question and
        // resolve to two different members, because an Energy IN PLAY is counted by
        // what it PROVIDES and an Energy in a PILE by what is PRINTED on it.
        "you have 10 or more Basic {R} Energy cards in your discard pile",
        "you have at least 3 {D} Energy in play",
        "you have more Prize cards remaining than your opponent",
        "you have the same number of cards in your hand as your opponent",
        "your Benched Pokémon have any damage counters on them",
        "your opponent has 3 or fewer cards in their hand",
        // 🆕🆕 D389 — `opponentBenchAtLeast`, the ONE row this slice adds. It carries no
        // apostrophe, so it lands in THIS half of the partition and the apostrophe half
        // stands still at 21. ⚠️ **AND IT SORTS DIRECTLY BELOW THE ROW IT IS ONE ZONE
        // AWAY FROM**: both are "your opponent has N …" counts, and the printed word
        // after the number — "cards in their hand" against "Benched Pokémon" — is the
        // whole difference between two members, which is the clearest place in the repo
        // to see why these keys are whole printed clauses and never substrings.
        "your opponent has 3 or more Benched Pokémon",
        "your opponent has 4 or fewer Prize cards remaining",
        "your opponent has 5 or fewer cards in their hand",
        // 🆕 D390 — the OPPONENT-SEAT TYPE READ key. It is TEMPLATE-owned
        // (`OPPONENT_IN_PLAY_TYPE_CLAUSE`) and still lands on THIS side of the
        // partition, which only D370's bench-type key has done before: the two
        // apostrophe-bearing templates spell a POSSESSIVE and carry D136's class,
        // and this clause spells "your opponent HAS" and has nothing to class.
        "your opponent has any {W} Pokémon in play",
      ].sort(),
    );
    // THE TWO HALVES PARTITION THE CARRIED SET — parts that do not add up are not
    // a partition, however carefully each half is measured.
    expect(without.length + 23).toBe(carried.size); // 🆕🆕 D436 — the APOSTROPHE half moves 22 -> 23 (the whole-sentence anchor's clause), so this offset gains one // 🆕🆕 D393 — the OTHER half moves too, 21 -> 22, so this offset gains one for the first time in five slices // 🆕🆕 D392 — THIS half moves again (26 -> 27) and the apostrophe-bearing half stands still at 21 for a FOURTH consecutive slice // 🆕🆕 D390 — THIS half moves again (24 -> 25) and the apostrophe half STANDS STILL at 21 for a second consecutive slice // 🆕🆕 D389 — THIS half moves (23 -> 24) and the apostrophe half STANDS STILL at 21, the mirror of D387's and D388's step // 🆕🆕 D388 — the APOSTROPHE half moves again (20 -> 21) and the apostrophe-free half STANDS STILL at 23, the exact repeat of D387's step // 🆕🆕 D387 — the APOSTROPHE half is the one that moves this time (19 -> 20) and the apostrophe-free half STANDS STILL at 23 // 🆕🆕 D386 — the APOSTROPHE-FREE half is the one that moves this time (22 -> 23) and the apostrophe half STANDS STILL at 19 // 🆕🆕 D384 — the apostrophe half moves 18 -> 19 // 🆕🆕 D378 — the apostrophe half STANDS STILL at 18 // 🆕🆕 D377 — 16 -> 18
    expect(carried.size).toBe(55); // 🆕🆕 D436 — 54 -> **55**, and THIS half stands still at 32 while the apostrophe half takes the whole step // 🆕🆕 D398 — 53 -> 54, and THIS half takes the whole step (31 -> 32) while the apostrophe half stands still at 22 // 🆕🆕 D397 — 52 -> 53, and the key is apostrophe-FREE, so the bearing half stands still at 22 // 🆕🆕 D394 — 50 -> 52, and BOTH keys are apostrophe-FREE, so the bearing half stands still at 22 // 🆕🆕 D393 — 48 -> 50, and the step is SPLIT ONE EACH ACROSS THE PARTITION for the first time in this run: the EVOLVE PAIR's two keys name `Gimmighoul` (apostrophe-FREE, 27 -> 28) and `Misty's Staryu` (apostrophe-BEARING, 21 -> 22, ending FOUR consecutive slices of that half standing still) // 🆕🆕 D392 — 47 -> 48, and THIS half moves again by ONE (26 -> 27) while the apostrophe-bearing half stands still at 21 for a FOURTH consecutive slice // 🆕🆕 D391 — 46 -> 47, and THIS half moves again by ONE (25 -> 26) while the apostrophe-bearing half stands still at 21 for a THIRD consecutive slice. 🛑 AND THE CLAUSE THAT LANDED IS A *LITERAL ROW* rather than a template — "this Pokémon has 2 or more {G} Energy attached" spells no possessive and no contraction, so there is nothing to class; the CHARACTER decides, not the partition // 🆕🆕 D390 — 45 -> 46, and THIS half is the one that moves, by ONE (24 -> 25), while the apostrophe half stands still at 21 for a SECOND consecutive slice. ⚠️ AND IT IS A TEMPLATE CLAUSE ON THE FREE SIDE, not a row — only D370's bench-type key has ever landed there before, so `rowClauses`, `TEMPLATE_OWNED` and `APOSTROPHE_BONUS_SENTENCES` all stand still as well // 🆕🆕 D389 — 44 -> 45, and THIS half is the one that moves, by ONE (23 -> 24), while the apostrophe half stands still at 21. // 🆕🆕 D388 — 43 -> 44, and the APOSTROPHE half is the one that moves, by ONE (20 -> 21), while THIS one stands still at 23. // 🆕🆕 D387 — 42 -> 43, and the APOSTROPHE half is the one that moves, by ONE (19 -> 20), while THIS one stands still at 23. // 🆕🆕 D386 — 41 -> 42, **ONE row and it is apostrophe-FREE** (the HEALED-THIS-TURN clause names no possessive and no contraction), so the apostrophe half stands still at 19 and the free half takes the whole step (22 -> 23) — the mirror of D384, one slice on. // 🆕🆕 D384 — 40 -> 41, and the APOSTROPHE half is the one that moves, by ONE (18 -> 19), while THIS one stands still at 22. // 🆕🆕 D378 — 39 -> 40, and THIS half is the one that moves, by ONE (21 -> 22), while the apostrophe half stands still at 18. // 🆕🆕 D377 — 37 -> 39, and the APOSTROPHE half is the one that moves, by TWO (16 -> 18), while THIS one stands still at 21. // 🆕🆕 D376 — 36 -> 37, and THIS half is the one that moves (20 -> 21) while the apostrophe half stands still at 16. // 🆕🆕 D375 — 35 -> 36, and the APOSTROPHE half is the one that moves (15 -> 16) while THIS one stands still at 20 for the second slice running — another literal ROW on a possessive key // 🆕🆕 D374 — 34 -> 35, and the APOSTROPHE half is the one that moves (14 -> 15) while THIS one stands still at 20 — a literal ROW on a possessive key, the partition D372's row landed in // 🆕🆕 D373 — 33 -> 34, and THIS half moves (19 -> 20) while the apostrophe half stands still at 14 — a literal ROW on an apostrophe-free key, the same partition D368's row landed in // 🆕🆕 D372 — 32 -> 33, and the apostrophe half moves again (13 -> 14) while THIS one stands still at 19 for the second slice running — but through the OTHER partition of that half: D371's clause was TEMPLATE-owned and D372's is a ROW // 🆕🆕 D371 — 31 -> 32, and the halves swap AGAIN: the apostrophe half moves (12 -> 13) while THIS one stands still at 19, because the new clause is a template clause that spells a possessive // 🆕🆕 D370 — 30 -> 31, and the halves swap back: THIS one moves (18 -> 19) while the apostrophe half stands still at 12 // 🆕🆕 D369 — 29 -> 30, and this time the APOSTROPHE half is the one that moves (11 -> 12) while this one stands still at 18 // 🆕🆕 D368 — 28 -> 29, and the apostrophe half STANDS STILL at 11
    // ⚠️ SIX of these seventeen are D367's own, and NONE of the six needed the
    // fold — which is the measurement that says this slice's rows and this slice's
    // guard are about different things. Named rather than pattern-matched: a
    // `includes("or fewer")` filter answers SEVEN here, because Absol ex's D115 row
    // spells those words too. **The near-miss is inside the filter, which is the
    // shape this file exists to catch.**
    const D367_APOSTROPHE_FREE = [
      "Beldum and Metang are on your Bench",
      "Durant is on your Bench",
      "Illumise is on your Bench",
      "Mightyena is on your Bench",
      "your opponent has 4 or fewer Prize cards remaining",
      "your opponent has 5 or fewer cards in their hand",
    ];
    expect(D367_APOSTROPHE_FREE).toHaveLength(6);
    for (const clause of D367_APOSTROPHE_FREE) expect(without, clause).toContain(clause);
    expect(without.filter((c) => c.includes("or fewer"))).toHaveLength(4); // 🆕🆕 D398 — 3 -> 4: the DECK-SIZE READ's key is the FOURTH apostrophe-free "or fewer" clause, and the first whose zone is a DECK
  });

  it("folds ALL SIX rows of ATTACK_REQUIREMENT_CLAUSES — contraction, possessive, and both at once", () => {
    for (const sentence of APOSTROPHE_REQUIREMENT_SENTENCES) {
      const straight = deriveAttackRequirement(sentence);
      expect(straight, sentence).not.toBeNull();
      expect(deriveAttackRequirement(curly(sentence)), sentence).toEqual(straight);
    }
  });

  it("🛑 D365 — the list is COMPLETE, re-derived from the live reader and not from the comment", () => {
    // 🛑 THE REPAIR FOR THE DEFECT THE ARRAY'S DOC BLOCK DESCRIBES. The table is
    // module-private, so its SIZE is recovered the only way a test can recover it:
    // by walking the printed corpus and counting the sentences the live reader
    // carries. Every one of them must appear in the list above, BY SENTENCE — so a
    // new APOSTROPHE row added by a later slice reddens HERE, naming the sentence
    // it added, rather than silently leaving this suite measuring an old table.
    //
    // 🛑 ⚠️ 🆕🆕 **D366 — THE GUARD WAS RIGHT AND ITS POPULATION WAS WRONG, AND
    // THIS IS THE SLICE THAT COULD PROVE IT.** As D365 wrote it, `carried` was
    // EVERY sentence the live reader carries, and the file's premise is that every
    // row of `ATTACK_REQUIREMENT_CLAUSES` spells an apostrophe — true of all six
    // rows that existed, so the two populations were the same set and the
    // conflation was invisible. D366's Victini row is the table's FIRST
    // apostrophe-free key, so the walk found SIX where the list holds six
    // apostrophe rows of which five are reachable, and the case went red. **It
    // could NOT be repaired by adding the sentence to the list above** — that
    // would assert a false thing about a sentence with no `'` in it, and the two
    // cases above would then fold a string the fold cannot change. The fix is the
    // FILTER: this guard is about the rows THE FOLD IS ABOUT, and the rows it is
    // not about get their own guard below. **A COMPLETENESS GUARD IS ONLY AS GOOD
    // AS THE POPULATION IT RE-DERIVES, AND A POPULATION THAT HAPPENS TO COINCIDE
    // WITH THE ONE YOU WANT IS NOT THE ONE YOU WROTE.**
    //
    // ⚠️ Sawk's printed string carries a trailing companion, so the comparison is
    // on the CLAUSE SENTENCE rather than on the printed unit: the reader tolerates
    // the companion and the list deliberately does not spell it (the fold is a
    // property of the lookup, not of the split).
    const carried = carriedClauseSentences();
    const withApostrophe = [...carried].filter((s) => s.includes(APOS));
    // Six clause sentences are reachable from the legal corpus and FIVE of them
    // carry an apostrophe. Of the six APOSTROPHE rows, Palafin's is unreachable
    // (D364: all five of its printings are `legal_standard = 0`), so the walk
    // finds five and the list holds six. That asymmetry is the reason the
    // assertion is a SUBSET check plus an explicit dead-row count, not equality.
    // 🆕🆕 D377 — 6 -> 7 carried and 5 -> 6 with an apostrophe: the new key spells BOTH
    // a possessive and a contraction, so it lands squarely in the fold's population and
    // Victini's apostrophe-free row still makes the list one longer than the walk.
    // 🆕🆕 D378 — 7 -> 8 carried and the apostrophe half STANDS STILL at 6: the new key
    // (*"If there is no Stadium in play"*) carries neither an apostrophe nor a é, so it
    // is the SECOND row this filter drops and the case below now names two. **THE
    // FILTER D365 PAID FOR IS EARNING ITS KEEP A SECOND TIME.**
    // 🆕🆕 D379 — 8 -> 9 carried and the apostrophe half 6 -> 7: the new key
    // (*"If you don't have exactly 3 cards in your hand"*) carries a contraction and no
    // é, so it lands squarely in the fold's population and the apostrophe-FREE half
    // stands still at TWO. ⚠️ AND THE TABLE IS NOW SATURATED against the legal attack
    // column, so this figure cannot move again without a set rotation.
    expect(carried.size).toBe(9);
    expect(withApostrophe).toHaveLength(7);
    for (const sentence of withApostrophe) {
      expect(APOSTROPHE_REQUIREMENT_SENTENCES).toContain(sentence);
    }
    const dead = APOSTROPHE_REQUIREMENT_SENTENCES.filter((s) => !carried.has(s));
    expect(dead).toEqual([
      "If this Pokémon didn't move from the Bench to the Active Spot this turn, this attack does nothing.",
    ]);
    expect(APOSTROPHE_REQUIREMENT_SENTENCES).toHaveLength(8); // 🆕🆕 D379 — 7 -> 8 // 🆕🆕 D377 — 6 -> 7
    // And every listed sentence really resolves — a list that had drifted onto a
    // clause the table dropped would otherwise pass the subset check vacuously.
    for (const sentence of APOSTROPHE_REQUIREMENT_SENTENCES) {
      expect(deriveAttackRequirement(sentence), sentence).not.toBeNull();
    }
  });

  it("🆕🆕 D366 — and the APOSTROPHE-FREE rows are accounted for too, off the same live reader", () => {
    // 🛑 THE OTHER HALF OF THE FILTER ABOVE, AND THE REASON IT IS NOT A HOLE. Once
    // the completeness guard is narrowed to the fold's population, every row the
    // filter DROPS has to land somewhere or the narrowing is just a way of not
    // looking. This case is that somewhere: it re-derives the apostrophe-free
    // carried sentences from the live reader and pins the whole set BY NAME, so a
    // second apostrophe-free row added later reddens here exactly as an apostrophe
    // one reddens above. Neither list can go stale in silence again.
    const carried = carriedClauseSentences();
    const withoutApostrophe = [...carried].filter((s) => !s.includes(APOS)).sort();
    // 🆕🆕 D378 — the "second apostrophe-free row added later" this case was written to
    // catch has ARRIVED, and it reddened here exactly as promised.
    expect(withoutApostrophe).toEqual([
      "If there is no Stadium in play, this attack does nothing.",
      "If you have 4 or fewer Benched Pokémon, this attack does nothing.",
    ]);
    // The two halves PARTITION the carried set — parts that do not add up are not
    // a partition, however carefully each half is named.
    expect([...carried].filter((s) => s.includes(APOS)).length + withoutApostrophe.length).toBe(
      carried.size,
    );
    // …and the fold really is a NO-OP on this key, which is the property that made
    // it wrong to list it above: rewriting an apostrophe it does not contain
    // changes nothing, so the "folds identically" claim would have been vacuous.
    for (const sentence of withoutApostrophe) {
      expect(curly(sentence), sentence).toBe(sentence);
      expect(deriveAttackRequirement(sentence), sentence).not.toBeNull();
    }
  });

  it("keeps the two consequents' vocabularies DISJOINT under the fold", () => {
    // D125's rule, re-asserted in the curly spelling: sharing the lookup HELPER is
    // not sharing the TABLE. A clause meaning "does 120 more damage if X" must
    // stay unreachable from a sentence meaning "does nothing if X", and a fold
    // that had been written as one normalised table instead of one function taking
    // a table would have quietly merged them.
    for (const sentence of APOSTROPHE_BONUS_SENTENCES) {
      expect(deriveAttackRequirement(curly(sentence))).toBeNull();
    }
    for (const sentence of APOSTROPHE_REQUIREMENT_SENTENCES) {
      expect(deriveAttackDamageBonus(curly(sentence))).toBeNull();
    }
  });

  it("leaves the apostrophe-FREE rows exactly where they were", () => {
    // Fourteen of the nineteen conditional rows spell no apostrophe at all, so the
    // fold must be a no-op for them — `literalClauseRow` never allocates a second
    // string for text with no U+2019 in it. Three representatives, one per shape
    // the table holds (bare tag, parameterised member, card NAME).
    const untouched = [
      "If you have a Stadium in play, this attack does 80 more damage.",
      "If you have at least 3 {D} Energy in play, this attack does 50 more damage.",
      "If Falinks is on your Bench, this attack does 90 more damage.",
    ];
    for (const sentence of untouched) {
      expect(sentence).not.toContain(APOS);
      expect(deriveAttackDamageBonus(sentence)).not.toBeNull();
      expect(deriveAttackDamageBonus(curly(sentence))).toEqual(deriveAttackDamageBonus(sentence));
    }
  });
});

describe("the fold is APOSTROPHE-ONLY — the scope guard", () => {
  it("does NOT fold the é in Pokémon", () => {
    // The tables' doc blocks commit to a real U+00E9, verified against the D1
    // rows, and an ASCII "Pokemon" is a DIFFERENT STRING that must stay LOUD. This
    // is the assertion that stops the fold growing into a general normaliser: an
    // NFKD-and-strip pass would make this pass and would then owe a row-by-row
    // argument that no two printed clauses collide, which nobody has made.
    const asciiE =
      "If your opponent's Active Pokemon is Poisoned, this attack does 120 more damage.";
    expect(deriveAttackDamageBonus(asciiE)).toBeNull();
    expect(deriveAttackDamageBonus(curly(asciiE))).toBeNull();
  });

  it("does NOT lowercase — the matcher still has no /i", () => {
    // `Poisoned`, `Active`, `Benched`, `Evolution` and `Special Condition` are
    // capitalised as printed and told from ordinary words by nothing else.
    const lowered =
      "If your opponent's Active Pokémon is poisoned, this attack does 120 more damage.";
    expect(deriveAttackDamageBonus(lowered)).toBeNull();
    expect(deriveAttackDamageBonus(curly(lowered))).toBeNull();
  });

  it("does NOT trim inside the clause", () => {
    // The readers trim the SENTENCE (`text.trim()`); nothing trims or collapses
    // whitespace within it, and the fold added no such pass. A doubled space is a
    // different clause and stays loud in both spellings.
    const doubled =
      "If your opponent's Active  Pokémon is Poisoned, this attack does 120 more damage.";
    expect(deriveAttackDamageBonus(doubled)).toBeNull();
    expect(deriveAttackDamageBonus(curly(doubled))).toBeNull();
  });

  it("does not invent a row for an UNMAPPED clause in either spelling", () => {
    // The whole point of a literal table is that an unrecognised clause returns
    // null and keeps its loud ATTACK_EFFECT_SKIPPED row — never a silent 0. The
    // fold widens WHICH BYTES reach a row; it must not widen WHICH ROWS exist.
    // Okidogi ex's real own-board clause under the wrong possessive, and a clause
    // the pool prints under a consequent this skeleton never reaches.
    const unmapped = [
      "If your opponent's Pokémon is Poisoned, this attack does 120 more damage.",
      "If your opponent's Active Pokémon is a Basic Pokémon, this attack does 60 more damage.",
    ];
    for (const sentence of unmapped) {
      expect(deriveAttackDamageBonus(sentence)).toBeNull();
      expect(deriveAttackDamageBonus(curly(sentence))).toBeNull();
      expect(deriveAttackRequirement(curly(sentence))).toBeNull();
    }
  });
});

describe("the TEMPLATE pass is untouched — the fold applies to the literal pass", () => {
  it("still reads D120's type template through its own `['’]` class", () => {
    // `OPPONENT_ACTIVE_TYPE_CLAUSE` carries the class in its own source (D136), so
    // the curly sentence never reaches the fold at all: the literal table misses
    // it in BOTH spellings and the pattern claims it. Asserted here so the two
    // mechanisms stay legible as two — if a later session deleted the class on the
    // grounds that "the fold handles it", the literal pass would still miss and
    // this would go red.
    const wonderFlash =
      "If your opponent's Active Pokémon is a Dragon Pokémon, this attack does 90 more damage.";
    const bonus = deriveAttackDamageBonus(wonderFlash);
    expect(bonus?.count).toEqual({
      kind: "boardCondition",
      cond: { kind: "opponentActiveHasType", type: "Dragon" },
    });
    expect(deriveAttackDamageBonus(curly(wonderFlash))).toEqual(bonus);
  });

  it("still reads D118's energy template, whose token can hold no apostrophe", () => {
    // The clause carries no possessive, so this is not a fold case — it is the
    // proof that routing the TOKEN maps through `literalClauseRow` changed nothing
    // for the closed vocabularies. Both notations, since the pool prints both.
    const braced = "If this Pokémon has any {R} Energy attached, this attack does 90 more damage.";
    const spelled =
      "If this Pokémon has any Fire Energy attached, this attack does 90 more damage.";
    for (const sentence of [braced, spelled]) {
      expect(deriveAttackDamageBonus(sentence)?.count).toEqual({
        kind: "boardCondition",
        cond: { kind: "yourActiveHasEnergyAttached", energy: "Fire" },
      });
    }
    // An unresolvable token still falls through to null — the fold did not turn a
    // miss into a member.
    expect(
      deriveAttackDamageBonus(
        "If this Pokémon has any {C} Energy attached, this attack does 90 more damage.",
      ),
    ).toBeNull();
  });

  it("reads the retreat-cost pair in BOTH spellings — D137's census finding", () => {
    // These two regexes were the last straight-only patterns in effects.ts. D136
    // named three and fixed three; it did not look for a sentence carrying TWO
    // possessives, and this pair carries the only ones in the pool. Both slots now
    // hold `['’]`, so the additive and multiply twins fold together — half a fix
    // reads exactly like the whole one until a re-ingest lands.
    const additive =
      "This attack does 30 more damage for each {C} in your opponent's Active Pokémon's Retreat Cost.";
    const multiply =
      "This attack does 50 damage for each {C} in your opponent's Active Pokémon's Retreat Cost.";
    expect(curly(additive).split(RSQUO)).toHaveLength(3); // both possessives rewritten
    expect(deriveAttackDamageBonus(curly(additive))).toEqual(deriveAttackDamageBonus(additive));
    expect(deriveAttackDamageBonus(additive)?.count).toEqual({
      kind: "opponentActiveRetreatCost",
    });
    expect(deriveAttackDamageMultiplier(curly(multiply))).toEqual(
      deriveAttackDamageMultiplier(multiply),
    );
    expect(deriveAttackDamageMultiplier(multiply)?.count).toEqual({
      kind: "opponentActiveRetreatCost",
    });
  });
});
