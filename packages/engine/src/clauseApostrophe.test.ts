import { describe, expect, it } from "vitest";
import {
  deriveAttackCoinFlip,
  deriveAttackDamageBonus,
  deriveAttackDamageMultiplier,
  deriveAttackDamageSuppression,
  deriveAttackEffect,
  deriveAttackRequirement,
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
    the widest of any single reader here. `deriveAttackDamagePenalty` is
    deliberately still ABSENT: it is a caller too, but its one anchored sentence
    ("This attack does N less damage for each damage counter on this Pokémon.")
    carries no apostrophe at all, so adding it would widen the list without
    widening the sweep — and a reader that resolves nothing this census admits is
    a row that can never fail. */
const READERS = {
  damageBonus: deriveAttackDamageBonus,
  damageMultiplier: deriveAttackDamageMultiplier,
  requirement: deriveAttackRequirement,
  effect: deriveAttackEffect,
  coinFlip: deriveAttackCoinFlip,
  damageSuppression: deriveAttackDamageSuppression,
} as const;

describe("the U+2019 fold — every apostrophe-bearing sentence the fixtures print", () => {
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
      if (Object.values(READERS).every((read) => read(sentence) === null)) continue;
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
    expect(derivable).toHaveLength(102);
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
      expect(Object.values(READERS).some((read) => read(rewritten) !== null)).toBe(true);
    }
  });
});

/** The five `CONDITIONAL_DAMAGE_CLAUSES` rows whose key holds an apostrophe,
    written as the whole printed sentence D115's skeleton reads. Listed as well as
    swept: the sweep proves the fixtures survive a re-ingest, this proves the
    specific rows the fold was built for do — and it keeps saying so if a fixture
    is ever renumbered out of the pool. Amounts are the printed ones. */
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
] as const;

/** Both `ATTACK_REQUIREMENT_CLAUSES` rows — the whole table, and both keys carry
    an apostrophe (a CONTRACTION in one, a POSSESSIVE in the other, so the fold is
    exercised on both grammatical uses the pool prints). */
const APOSTROPHE_REQUIREMENT_SENTENCES = [
  // Palafin sv03-062/-200 "Justice Kick" — "didn't", the contraction. Note "the
  // Bench", NOT "your Bench": the trap D125's doc block flags, untouched by this.
  "If this Pokémon didn't move from the Bench to the Active Spot this turn, this attack does nothing.",
  // Lycanroc sv03-117 "Finishing Fang" — the possessive, and the pool's longest
  // clause key.
  "If your opponent's Active Pokémon has no damage counters on it before this attack does damage, this attack does nothing.",
] as const;

describe("the literal clause tables — the rows the fold was built for", () => {
  it("folds all FIVE apostrophe rows of CONDITIONAL_DAMAGE_CLAUSES", () => {
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

  it("folds BOTH rows of ATTACK_REQUIREMENT_CLAUSES — contraction and possessive", () => {
    for (const sentence of APOSTROPHE_REQUIREMENT_SENTENCES) {
      const straight = deriveAttackRequirement(sentence);
      expect(straight).not.toBeNull();
      expect(deriveAttackRequirement(curly(sentence))).toEqual(straight);
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
