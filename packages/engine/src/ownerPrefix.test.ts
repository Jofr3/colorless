import type { Card } from "@luminous/schema";
import { describe, expect, it } from "vitest";
import { matchesFilter } from "./cards";
import { resolvedByAnyReader } from "./censusAttackCorpus";
import type { CardFilter } from "./effects";
import { applyAction, createGame, programFor } from "./index";
import type { GameState, Seat } from "./index";
import {
  FIXTURE_POOL,
  attachFromDeck,
  battler,
  benchFromDeck,
  clearBench,
  deckOf,
  firstBasicInHand,
  handFromDeck,
  handToDeck,
  handUid,
  must,
  mustApply,
  setActiveFromDeck,
  specialEnergy,
  trainerCard,
} from "./testFixtures";

// D200 — THE OWNER-PREFIX SUBGROUP FILTER (`CardFilter.ownerPokemon`), the
// dimension two independent censuses named the largest gap in the project — and
// the measured finding that the filter ALONE finishes SIX printings.
//
// ── THE CENSUS, RE-DERIVED ───────────────────────────────────────────────────
// Remote D1 `luminous` (735f0fb5-cdc3-494d-8b97-74a8ade0124a; 3,786 rows /
// 20 sets, 2,021 `legal_standard = 1`), swept 2026-08-04 over ALL THREE text
// columns — `effect`, `attacks_json` and `abilities_json` (the two JSON columns
// via `json_each` + `json_extract(value,'$.effect')`) — for a possessive owner
// prefix. `CENSUS` below is that result.
//
// ⚠️ THREE THINGS THE PRIOR CENSUSES GOT WRONG, EACH FOUND BY WIDENING A VERB.
//
//   (1) **THE MATCH MUST BE CASE-SENSITIVE.** SQLite's `LIKE` is ASCII
//       case-insensitive, so `LIKE '%N''s %'` matches "Pokémon's" and reports
//       `N's` at 95 text units. `GLOB` (case-sensitive) with a leading
//       non-letter guard reports SIX. Any owner whose name is a suffix of an
//       ordinary English word is exposed to this; `N` is the extreme case and
//       the only one-letter owner in the catalog.
//   (2) **`Team Rocket's` 31 / `Ethan's` 11 / … WAS NEVER AN ATTACK-ONLY COUNT.**
//       D187's table totals 67 across all three columns, not 67 attack units:
//       `Team Rocket's` is 9 attack + 10 ability + 12 effect. Attacks alone are
//       25 legal units in total, across every owner.
//   (3) **THE PRIOR LIST WAS SHORT BY FIVE OWNERS AND THIRTEEN UNITS.** D187
//       named eight prefixes; the sweep finds THIRTEEN with legal text, adding
//       `Hop's` 5, `Arven's` 3, `Marnie's` 2, `Janine's` 1, `Xerosic's` 1. The
//       legal total is **80 text units**, not 67. (`Erika's` 2 and `Giovanni's`
//       2 exist in the catalog at ZERO legal printings and are excluded.)
//
// AND THE SWEEP'S OWN NEGATIVE RESULT: **no printing names an owner subgroup
// WITHOUT the possessive.** The non-possessive family is a different, already
// known shape — *"a Supporter card that has \"Team Rocket\" in its name"*
// (2 legal printings) — which is a quoted-substring predicate over a CARD NAME,
// not a subgroup, and is not this filter (it also matches Trainers, which this
// filter is built to exclude). Every text unit below carries U+0027; the catalog
// holds ZERO U+2019 in any of the three columns, so no apostrophe fold is owed.
//
// ── WHAT THE PREDICATE READS ─────────────────────────────────────────────────
// THE CARD NAME, because the catalog carries nothing else. The ingested row has
// `name`, `category`, `stage`, `evolveFrom`, `trainerType`, `energyType` — no
// owner, subgroup or family column — so membership is the printed prefix, read
// exactly as `hasRuleBox` reads "Radiant " and `pokemonSuffixOf` reads " ex".
// Every Pokémon named in the 46 distinct legal sentences has a name beginning
// `<owner>'s `; the rule holds without exception on the Pokémon side.
//
// ⚠️ AND ONE CARD BREAKS THE NAME-ONLY RULE: **`Team Rocket's Energy`
// (sv10-182)**, a Special Energy whose name carries the prefix — and the card
// that prints *"This card can only be attached to a Team Rocket's Pokémon."*, so
// a name-only predicate makes it a legal target for itself. It is not a corner:
// across the eleven owners that have Pokémon, 32 of 214 prefixed printings are a
// Trainer or that Energy. `category === "Pokemon"` is therefore a CONJUNCT of the
// predicate, not a tidy-up.
//
// ── THE ONE-MEMBER-VS-SEVERAL VERDICT ────────────────────────────────────────
// `owner` is a PARAMETER (the set is open — zero owners through sv08, eleven with
// Pokémon by sv10 — and every read site's code is identical across them).
// `stage` is a RIDER rather than three members, and the standing rule is what
// decides it rather than being waived: "when one-member-with-a-flag and
// two-members cost the READ SITE the same, the members win." They do NOT cost the
// same here. Both read sites (`matchesFilter`, interpreter.ts `retrieveNoun`)
// must branch on `owner` regardless, and `retrieveNoun` owes ONE noun phrase —
// "a Basic Hop's Pokémon" — which is not the concatenation of "a Basic Pokémon"
// and "a Hop's Pokémon". Three members cost those two switches six arms with the
// owner logic copied three times; the rider costs two.
//
// ── COMPOSITION ──────────────────────────────────────────────────────────────
// NEEDED — four of the six landed printings print a second axis ("Basic X's
// Pokémon") — and the vocabulary has NO conjunction to compose with. There is no
// `allOf`; `pokemonOrBasicEnergy` is a bespoke DISJUNCTION member and
// `basicPokemon.noRuleBox` / `basicEnergy.energyType` are bespoke RIDERS. So the
// filter carries the second axis itself, which is the house pattern.
//
// ── WHICH READ SITES LEARNED IT ──────────────────────────────────────────────
// TWO, and both were forced by an exhaustive switch: `matchesFilter` (cards.ts —
// the deck/hand/discard scanner behind `searchDeck`, `lookAtTopN`,
// `discardPileRetrieval`, and via `matchesAttached` the in-play Energy scanner)
// and `retrieveNoun` (interpreter.ts — the prompt captions).
//
// ⚠️ THE IN-PLAY TARGET PATHS DID **NOT** LEARN IT, AND COULD NOT. `CardFilter`
// is the CARD vocabulary; in-play Pokémon targets are picked by op-specific
// `targetType` (an energy-type string), `basicOnly` and `zone` riders, and NO op
// takes a `CardFilter` for a target. So "1 of your Benched Iono's Pokémon" is out
// of this member's reach by construction — it is a second piece, flagged in
// `DROPPED` below rather than half-built. That makes the printed split honest
// rather than arbitrary: the sentences that SEARCH A DECK are finished, the
// sentences that POINT AT THE BOARD are not.
//
// ── THE YIELD, WHICH IS THE FINDING ──────────────────────────────────────────
// 80 legal text units name the dimension. **SIX legal printings are finished by
// the filter.** Everything else needs a second missing piece, enumerated in
// `DROPPED` with the exact piece and asserted unbuilt. This is D186's shape
// repeating (a gate priced at 78 whose true yield was 12), and it is a real
// result: the dimension is wide, and it is wide across mechanisms this engine
// does not have yet, not across one it now does.

/** The full sweep, legal scope, per owner per column. `total` is the owner's
    legal text units; the three columns are `effect` (Trainers, Stadiums, Tools,
    Special Energy), `attack` and `ability`. Owners with catalog text but ZERO
    legal printings (`Erika's` 2, `Giovanni's` 2) are excluded — this is the
    LEGAL pool. */
const CENSUS = [
  { owner: "Team Rocket", effect: 12, attack: 9, ability: 10, total: 31 },
  { owner: "Ethan", effect: 3, attack: 3, ability: 5, total: 11 },
  { owner: "Iono", effect: 0, attack: 1, ability: 5, total: 6 },
  { owner: "N", effect: 2, attack: 4, ability: 0, total: 6 },
  { owner: "Cynthia", effect: 1, attack: 1, ability: 3, total: 5 },
  { owner: "Hop", effect: 3, attack: 0, ability: 2, total: 5 },
  { owner: "Misty", effect: 0, attack: 4, ability: 0, total: 4 },
  { owner: "Arven", effect: 1, attack: 0, ability: 2, total: 3 },
  { owner: "Steven", effect: 1, attack: 1, ability: 1, total: 3 },
  { owner: "Lillie", effect: 1, attack: 1, ability: 0, total: 2 },
  { owner: "Marnie", effect: 1, attack: 0, ability: 1, total: 2 },
  { owner: "Janine", effect: 0, attack: 0, ability: 1, total: 1 },
  { owner: "Xerosic", effect: 0, attack: 1, ability: 0, total: 1 },
] as const;

/** The five programs this slice lands, with the COMPLETE catalog id set for each
    printed sentence (measured — no printing of any of these five sentences is
    outside Standard, so `ids.length === legal` for every row). */
const LANDED = [
  {
    program: "Champion's Call (Cynthia's Gabite)",
    fixture: "fix-championscall",
    ids: ["sv10-103"],
    legal: 1,
    ops: "searchDeck{ownerPokemon Cynthia, hand, 1} + shuffleDeck — Mesagoza's line with the owner noun",
  },
  {
    program: "Swim Together (Misty's Lapras)",
    fixture: "fix-swimtogether",
    ids: ["sv10-050", "sv10-194"],
    legal: 2,
    ops: "the same two ops at max 3, on the ATTACK path (the deriver has no deck-search anchor at all)",
  },
  {
    program: "Hop's Bag",
    fixture: "fix-hopsbag",
    ids: ["sv09-147"],
    legal: 1,
    ops: "searchDeck{ownerPokemon Hop + stage basic, bench, 2} + shuffleDeck — the first writer of `stage`",
  },
  {
    program: "Summoning Sign (Steven's Baltoy)",
    fixture: "fix-summoningsign",
    ids: ["sv10-083"],
    legal: 1,
    ops: "Hop's Bag's program on an attack, one owner over — a separate const, not a shared object",
  },
  {
    program: "Inviting Flowers (Lillie's Comfey)",
    fixture: "fix-invitingflowers",
    ids: ["sv09-068"],
    legal: 1,
    ops: "the printed 'any number' at max BENCH_MAX, which the bench clamp makes exact rather than approximate",
  },
] as const;

/** ⚠️ THE WORK ORDER — every owner-prefix sentence this filter does NOT finish,
    with THE EXACT SECOND PIECE it needs. Ranked by legal printings. Every id is
    asserted below to still have no program, so a later slice cannot half-build
    one and leave this table lying. */
const DROPPED = [
  // ✅ D204 BUILT THIS ROW — the Iono's Bellibolt ex attach (svp-194,
  // sv09-053/-172/-183/-188, 5 legal). This row's own `needs` named the piece
  // exactly right ("an IN-PLAY TARGET filter"), and D204 landed it as one rider
  // on `AttachTargetRiders` — the interface that already spells the eligibility
  // rule once for all three attach ops — rather than as a `CardFilter` on the op.
  // Removed rather than annotated: the UNBUILT assertion below is what keeps this
  // work order from rotting, and it would fail on a built row.
  // ✅ D205 BUILT THIS ROW — Ethan's Ho-Oh ex "Golden Flame"
  // (sv10-039/-209/-230/-239, 4 legal). ⚠️ AND ITS `needs` WAS FALSE AS WRITTEN,
  // which is worth recording because D204 corrected this row's IDS and left the
  // sentence beside them standing. It said the rider "plus nothing else —
  // `attachEnergyFrom` already has `benchOnly` for the printed zone word **and a
  // count of 2**". There was no count field of any kind: the engine's only
  // multi-attach was N separate ops, each parking on its own free choice of
  // target, which for this print would have let a player split the two Energy
  // across two bodies. D204 measured that and flagged the row; D205 built
  // `attachEnergyFrom.count`. Removed rather than annotated in place — the
  // UNBUILT assertion below is what keeps this work order from rotting, and it
  // fails on a built row.
  // ✅ D206 BUILT THIS ROW — Team Rocket's Giovanni sv10-174/-225/-238, 3 legal.
  // ⚠️ AND ITS `needs` WAS RIGHT IN BOTH HALVES, which is worth recording after
  // Ethan's row above: it named "an in-play target filter on `switchActive` …
  // applied to BOTH ends of the switch, plus a `recordAs`/gate seam so the second
  // sentence's 'If you do' can read whether the first happened", and that is
  // exactly what shipped — one `ownerPokemon` read at both printed nouns, plus
  // `recordAs` feeding §9.2's existing `recordGate`. The clause "`gust` exists
  // for the second clause" held too: `TEAM_ROCKETS_GIOVANNI`'s consequent is
  // `BOSSS_ORDERS`' whole program byte-for-byte. Removed rather than annotated in
  // place — the UNBUILT assertion below is what keeps this work order from
  // rotting, and it fails on a built row.
  // ✅ D439 BUILT THIS ROW — Team Rocket's Spidops sv10-020/sv10-187, 2 legal,
  // *"This attack does 30 damage for each of your Team Rocket's Pokémon in play."*
  // ⚠️ **AND ITS `needs` WAS RIGHT IN EVERY CLAUSE, WHICH IS WORTH RECORDING
  // BECAUSE THE CELL HAD ALREADY BEEN CORRECTED ONCE.** It named "a
  // `DamageCountSource` that counts OWN BODIES IN PLAY MATCHING A PREDICATE",
  // and it named the two narrowings D282 left behind — the owner PREDICATE and
  // the ZONE, *"`in play`, which is Active + Bench and NOT the Bench this member
  // walks"*. That is `yourPokemonInPlay` and `countPokemonInPlay` word for word.
  // The predicate was already spellable (`CardFilter.ownerPokemon`, D200's own
  // arm) and the price was ONE union member, ONE evaluator arm, TWO anchors and a
  // noun vocabulary — shared with four other printed nouns.
  //
  // 🛑 **IT IS A DERIVER ARM AND NOT A REGISTRY ROW, WHICH IS WHY THIS ROW ROTTED
  // SILENTLY AND WHY THE GUARD BELOW IS NOW WIDER.** `programFor(id)?.attack`
  // reads the REGISTRY only, while an attack program resolves
  // `registry ?? deriveAttackEffect` — the vacuity `conventions.md` records
  // against D204 verbatim. So the moment D439 claimed this sentence through the
  // TEXT path, the row was a stale work order and **nothing reddened**. It was
  // found by grepping the suites for the sentence before building it, not by a
  // failing test. The guard now asks the DERIVER as well, for `attack` rows.
  //
  // ⚠️ **AND IT LEAVES `LANDED` ALONE, DELIBERATELY.** That table counts D200's
  // REGISTRY printings and this is not one; the two printings simply leave DROPPED
  // without arriving in LANDED, so the census's 80 units now split three ways
  // (registry-built, deriver-built, unbuilt) rather than two. Said out loud rather
  // than folded into a number, because "the gap between the census and the yield"
  // is what the rung below it asserts.
  {
    sentence: "Discard a Team Rocket's Energy from this Pokémon. If you do, discard your opponent's Active Pokémon and all attached cards.",
    // ⚠️ CORRECTED BY D204 (shipped as Team Rocket's Nidoking ex / Team Rocket's
    // Giovanni / Cynthia's Garchomp ex).
    ids: ["sv10-031", "sv10-208", "sv10-229"],
    legal: 3,
    surface: "attack",
    needs:
      "TWO pieces, and the first is an owner-prefixed ENERGY predicate this member deliberately does not answer (`ownerPokemon` requires `category === 'Pokemon'` precisely so `Team Rocket's Energy` cannot match a Pokémon slot). The second is far larger: an effect that DISCARDS an in-play Pokémon and its attachments without a Knock Out — no op removes a body from the board outside the §8.1 KO sweep, and no Prize is taken.",
  },
  // ✅ D224 BUILT THIS ROW — Team Rocket's Proton sv10-177/-227, 2 legal, and it
  // is this table's ONLY row to have been dropped for a piece that a LATER,
  // UNRELATED SLICE then bought: D223 built `trainerFirstTurnExempt` for Carmine,
  // whose printed first sentence is byte-identical, and D224 spent it here for
  // ZERO new engine code. **An engine piece transfers across cards; a registry
  // row does not** — this row is the worked example of both halves.
  // ⚠️ AND ITS `needs` WAS RIGHT IN BOTH HALVES, which is worth recording after
  // the Ethan's row above: "the search half is now fully expressible
  // (`searchDeck{ownerPokemon 'Team Rocket' + stage basic, hand, 3}`)" is
  // byte-for-byte what shipped, and "a `CardProgram` field read at that gate" is
  // the flag — though D223 had to discover that "that gate" is THREE gates.
  // ⚠️ WHAT NEITHER THIS ROW NOR D223's PRICED: the printed "reveal them". The
  // engine does not model it (the opponent gets a count-only DECK_SEARCHED row),
  // it is shared by all 16 to-hand search rows, and it is measured and pinned in
  // `proton.test.ts` rather than left as prose. Removed rather than annotated —
  // the UNBUILT assertion below is what keeps this work order from rotting, and
  // it fails on a built row.
  {
    sentence: "Flip a coin. If heads, search your deck for an Evolution Team Rocket's Pokémon, reveal it, and put it into your hand. If tails, search your deck for a Basic Team Rocket's Pokémon, reveal it, and put it into your hand. Then, shuffle your deck.",
    ids: ["sv10-175"],
    legal: 1,
    surface: "trainer",
    needs:
      "`coinFlipGate`'s `otherwise` BRANCH. Both consequents are now spellable — this is the only printing in the catalog that would write `stage: 'evolution'` — and the op has `then` and `onTails` (which flips WHICH face runs the one branch) but no second branch. D142's Squawkabilly refusal, verbatim, on a card whose two branches differ by one field.",
  },
  {
    sentence: "N's Pokémon in play (both yours and your opponent's) have no Retreat Cost.",
    // ⚠️ CORRECTED BY D204 (shipped as `sv10-165`, which is Ethan's Adventure).
    ids: ["sv09-152"],
    legal: 1,
    surface: "stadium",
    needs:
      "a subgroup scope on the retreat aura. `noRetreatCostAura` (Clefable ex, Archaludon) narrows by `requiresEnergyType` and applies to its OWN side; this Stadium names a name-prefixed subgroup on BOTH sides. Same shape as the Steven's / Hop's Stadiums beside it (`take 30 less damage` / `do 30 more damage`, 1 legal printing each), which want the same scope on the damage seams.",
  },
  // ✅ D204 BUILT THIS ROW — Spikemuth Gym sv10-169, the row this list called
  // FREE and told the next slice to take first. It was: Champion's Call's two ops
  // verbatim on `StadiumAbility.program`, using only the CARD filter D200 shipped
  // and none of D204's target rider. The prediction held exactly.
  {
    sentence: "Heal 30 damage from your Active Pokémon. If that Pokémon is an Arven's Pokémon, heal 100 damage from it instead.",
    // ⚠️ CORRECTED BY D204 (shipped as `sv09-166`, which is Lycanroc).
    ids: ["sv10-161"],
    legal: 1,
    surface: "trainer",
    needs:
      "a `BoardCondition` reading the ACTIVE's subgroup, plus an either/or heal. `conditionGate` gates a program on the board, but no `BoardCondition` member asks anything about a card IDENTITY, and the printed 'instead' is a REPLACEMENT rather than a second heal — two 30/70 heals would be observably different under a heal cap.",
  },
] as const;

// ── The demonstrator pool. Synthetic `fix-*` bodies, declared HERE and not in
//    `testFixtures.ts` — D190/D199's idiom and their reason: a fixture id naming
//    a real printing must appear in `catalogManifest.ts`, which is generated off
//    the LOCAL sqlite (`SQLITE_CANTOPEN` in this clone, and measuring a
//    978-row / 6-set catalog that holds no sv09 or sv10 row at all). `createGame`
//    takes `cardPool` as a PARAMETER, so this pool stays local and `FIXTURE_POOL`
//    is untouched.
//
//    ⚠️ THE `name` IS THE POINT. Every other fixture in this repo takes
//    `name: id`; these cannot, because the NAME is what the predicate reads. The
//    names are real printed names off the D1 sweep, and the ids stay `fix-*` so
//    the manifest's generator and checker both skip them (D190's rule).
//
//    ⚠️ AND `FIXTURE_POOL` WAS SWEPT AS ITS OWN POPULATION BEFORE ANY OF THIS WAS
//    WRITTEN: it holds **no owner-prefixed name at all** — no card in it can
//    satisfy `ownerPokemon` for any owner — so nothing there could be reused and
//    nothing there changes behaviour under the new member. ──

/** A Pokémon in an owner's subgroup. `name` carries the printed possessive
    prefix; `id` stays synthetic. */
function subgroupBasic(id: string, name: string): Card {
  return battler(id, { name, hp: 70 });
}

function subgroupEvolution(id: string, name: string, from: string): Card {
  return battler(id, { name, hp: 120, stage: "Stage1", evolveFrom: from });
}

const LOCAL_CARDS: Record<string, Card> = {
  // ── The five program carriers.
  "fix-championscall": battler("fix-championscall", {
    name: "Cynthia's Gabite",
    hp: 100,
    stage: "Stage1",
    evolveFrom: "Cynthia's Gible",
    abilities: [
      {
        type: "Ability",
        name: "Champion's Call",
        effect:
          "Once during your turn, you may search your deck for a Cynthia's Pokémon, reveal it, and put it into your hand. Then, shuffle your deck.",
      },
    ],
  }),
  "fix-swimtogether": battler("fix-swimtogether", {
    name: "Misty's Lapras",
    hp: 110,
    attacks: [
      {
        name: "Swim Together",
        cost: ["Water"],
        effect:
          "Search your deck for up to 3 Misty's Pokémon, reveal them, and put them into your hand. Then, shuffle your deck.",
      },
      { name: "Surf", cost: ["Water", "Colorless"], damage: 60 },
    ],
  }),
  "fix-hopsbag": trainerCard(
    "fix-hopsbag",
    "Item",
    "Search your deck for up to 2 Basic Hop's Pokémon and put them onto your Bench. Then, shuffle your deck.",
  ),
  "fix-summoningsign": battler("fix-summoningsign", {
    name: "Steven's Baltoy",
    hp: 60,
    attacks: [
      {
        name: "Summoning Sign",
        cost: ["Colorless"],
        effect:
          "Search your deck for up to 2 Basic Steven's Pokémon and put them onto your Bench. Then, shuffle your deck.",
      },
      { name: "Psychic Sphere", cost: ["Psychic"], damage: 20 },
    ],
  }),
  "fix-invitingflowers": battler("fix-invitingflowers", {
    name: "Lillie's Comfey",
    hp: 70,
    attacks: [
      {
        name: "Inviting Flowers",
        cost: ["Colorless"],
        effect:
          "You may search your deck for any number of Basic Lillie's Pokémon and put them onto your Bench. Then, shuffle your deck.",
      },
      { name: "Fade Out", cost: ["Psychic"], effect: "Put this Pokémon and all attached cards into your hand.", damage: 30 },
    ],
  }),
  // ── The search targets, two stages per owner where the stage rider is read.
  "fix-cynthia-basic": subgroupBasic("fix-cynthia-basic", "Cynthia's Gible"),
  "fix-cynthia-evo": subgroupEvolution("fix-cynthia-evo", "Cynthia's Garchomp", "Cynthia's Gabite"),
  "fix-misty-basic": subgroupBasic("fix-misty-basic", "Misty's Psyduck"),
  "fix-misty-evo": subgroupEvolution("fix-misty-evo", "Misty's Starmie", "Misty's Staryu"),
  "fix-hop-basic": subgroupBasic("fix-hop-basic", "Hop's Wooloo"),
  "fix-hop-evo": subgroupEvolution("fix-hop-evo", "Hop's Dubwool", "Hop's Wooloo"),
  "fix-steven-basic": subgroupBasic("fix-steven-basic", "Steven's Beldum"),
  "fix-steven-evo": subgroupEvolution("fix-steven-evo", "Steven's Metang", "Steven's Beldum"),
  "fix-lillie-basic": subgroupBasic("fix-lillie-basic", "Lillie's Cutiefly"),
  "fix-lillie-evo": subgroupEvolution("fix-lillie-evo", "Lillie's Ribombee", "Lillie's Cutiefly"),
  // ── The NEGATIVES, each a real printed card that a name-only predicate takes.
  /** sv10-182 — the one card that breaks the name rule (see the header). */
  "fix-tr-energy": specialEnergy(
    "fix-tr-energy",
    "Team Rocket's Energy",
    "This card can only be attached to a Team Rocket's Pokémon. If this card is attached to anything other than a Team Rocket's Pokémon, discard this card.\n\nAs long as this card is attached to a Pokémon, it provides 2 in any combination of {P} Energy and {D} Energy.",
  ),
  /** A prefixed TRAINER sitting in the same deck as the Pokémon it shares an
      owner with — the in-deck negative for every `owner: "Cynthia"` search. */
  "fix-cynthia-trainer": trainerCard("fix-cynthia-trainer", "Tool", "The Cynthia's Pokémon this card is attached to gets +70 HP."),
  /** `Farfetch'd` — the catalog's apostrophe-bearing name that is NOT a
      possessive prefix, and the reason the trailing `'s ` is matched whole. */
  "fix-farfetchd": battler("fix-farfetchd", { name: "Farfetch'd" }),
} as const;

const POOL: Record<string, Card> = { ...FIXTURE_POOL, ...LOCAL_CARDS };

/** One deck carries every carrier and every target: the searches are for
    DISJOINT owners, so a single 60 is enough and each search's candidate set is
    the other owners' bodies proving the prefix bites. */
const DECK = deckOf({
  "fix-championscall": 2,
  "fix-swimtogether": 2,
  "fix-summoningsign": 2,
  "fix-invitingflowers": 2,
  "fix-hopsbag": 2,
  "fix-cynthia-basic": 2,
  "fix-cynthia-evo": 2,
  "fix-misty-basic": 2,
  "fix-misty-evo": 2,
  "fix-hop-basic": 2,
  "fix-hop-evo": 2,
  "fix-steven-basic": 2,
  "fix-steven-evo": 2,
  "fix-lillie-basic": 3,
  "fix-lillie-evo": 2,
  "fix-cynthia-trainer": 2,
  "fix-tr-energy": 2,
  "fix-farfetchd": 2,
  "fix-water-energy": 4,
  "fix-energy": 6,
  "fix-basic-1": 4,
  "fix-bigbody": 9,
});

/** `driveSetup` against the LOCAL pool (D190/D199's helper verbatim — the shared
    one closes over `FIXTURE_POOL`). */
function localSetup(seed: number, first: Seat): GameState {
  const created = createGame({ seed, decks: { p1: DECK, p2: DECK }, cardPool: POOL });
  if (!created.ok) throw new Error(`createGame failed: ${created.error.code}`);
  let state = created.state;
  if (state.phase.kind !== "setup:chooseFirst") throw new Error("expected setup:chooseFirst");
  state = must(applyAction(state, { type: "chooseFirstPlayer", seat: state.phase.coinWinner, first }));
  while (state.phase.kind === "setup:drawExtra") {
    const phase = state.phase;
    const seat = (["p1", "p2"] as const).find((s) => !phase.decided[s]);
    if (seat === undefined) throw new Error("setup:drawExtra with every seat decided");
    state = must(applyAction(state, { type: "setupDrawExtra", seat, count: phase.owed[seat] }));
  }
  for (const seat of ["p1", "p2"] as const) {
    state = must(applyAction(state, { type: "setupPlaceActive", seat, uid: firstBasicInHand(state, seat) }));
  }
  for (const seat of ["p1", "p2"] as const) {
    state = must(applyAction(state, { type: "setupReady", seat }));
  }
  return state;
}

/** P1 to move on turn 3 — past §4's going-first restrictions, none of which this
    slice's rows have anything to do with. */
function board(seed: number): GameState {
  let state = localSetup(seed, "p1");
  while (state.turn < 3) {
    if (state.phase.kind !== "turn:action") throw new Error(`stuck in ${state.phase.kind}`);
    state = must(applyAction(state, { type: "endTurn", seat: state.turn % 2 === 1 ? "p1" : "p2" }));
  }
  return state;
}

/** P1's board with `bodyId` Active and an EMPTY bench — the bench-bound searches
    need every one of the five slots free for the clamp to be the printed cap. */
function withActive(seed: number, bodyId: string): GameState {
  return clearBench(setActiveFromDeck(handToDeck(board(seed), "p1", bodyId), "p1", bodyId), "p1");
}

function cardsPrompt(state: GameState) {
  if (state.phase.kind !== "effect:choose") throw new Error(`expected effect:choose, got ${state.phase.kind}`);
  if (state.phase.prompt.kind !== "chooseCards") {
    throw new Error(`expected chooseCards, got ${state.phase.prompt.kind}`);
  }
  return state.phase.prompt;
}

/** The card ids a chooseCards prompt is offering, sorted — what the FILTER
    actually admitted, named rather than counted. */
function offered(state: GameState): string[] {
  return cardsPrompt(state)
    .candidates.map((uid) => state.cardIdByUid[uid] as string)
    .sort();
}

const resolve = (state: GameState, uids: string[]) =>
  mustApply(state, { type: "resolveEffect", seat: "p1", choice: { kind: "cards", uids } });

// ─────────────────────────────────────────────────────────────────────────────

describe("D200 — the census, as data", () => {
  it("totals 80 legal text units across 13 owners and 3 columns", () => {
    for (const row of CENSUS) {
      expect(row.effect + row.attack + row.ability, `${row.owner}: columns disagree with total`).toBe(row.total);
    }
    expect(CENSUS.reduce((n, r) => n + r.total, 0)).toBe(80);
    expect(CENSUS.reduce((n, r) => n + r.attack, 0)).toBe(25);
    expect(CENSUS).toHaveLength(13);
  });

  it("the landed yield is SIX printings — 7.5 % of the dimension it is named after", () => {
    const landed = LANDED.reduce((n, r) => n + r.legal, 0);
    expect(landed).toBe(6);
    // The gap between the census and the yield is the whole finding, so it is
    // asserted rather than described: everything else is in DROPPED with a piece.
    //
    // ⚠️ 23 AT D200, **17 AFTER D204**, **13 AFTER D205**, **10 AFTER D206**,
    // **8 AFTER D224** — the Iono's attach (5) and Spikemuth Gym (1) left at
    // D204, Ethan's Ho-Oh ex (4) at D205, Team Rocket's Giovanni (3) at D206,
    // Team Rocket's Proton (2) at D224. The remainder is NOT the
    // whole backlog: D204's own census found FIVE MORE SENTENCES / TEN LEGAL
    // PRINTINGS this table never had (N's PP Up 1 and Marnie's Grimmsnarl ex 1,
    // built by D204; Team Rocket's Wobbuffet 2, built by D205; Team Rocket's
    // Orbeetle 2 and N's Zoroark ex 4, still flagged in `inPlayTarget.test.ts`).
    // This table is D200's scope; that one is the current work order.
    expect(DROPPED.reduce((n, r) => n + r.legal, 0)).toBe(6); // 🆕🆕 D439 −2 printings — Team Rocket's Spidops sv10-020/-187 left through the DERIVER rather than through the registry, so `LANDED` stands still at 6 and the difference is now deriver-built. See the ✅ D439 block above `DROPPED`.
  });
});

describe("D200 — the registry map", () => {
  it("registers all 6 Standard-legal printings, one shared object per program", () => {
    for (const { program, ids, fixture, legal } of LANDED) {
      expect(ids, `${program}: id list disagrees with its measured legal count`).toHaveLength(legal);
      const first = programFor(ids[0] as string);
      expect(first, `${program}: ${ids[0]} has no program`).toBeDefined();
      for (const id of ids) expect(programFor(id), `${id} left ${program}`).toBe(first);
      expect(programFor(fixture), `${fixture} does not carry ${program}`).toBe(first);
    }
    expect(LANDED.reduce((n, r) => n + r.ids.length, 0)).toBe(6);
  });

  it("Hop's Bag and Summoning Sign are SEPARATE objects, not one shared near-twin", () => {
    // Byte-identical apart from the owner. Sharing would let an edit to either
    // card silently move the other — D199's rule for its own near-twins.
    expect(programFor("sv09-147")).not.toBe(programFor("sv10-083"));
  });

  it("an index-keyed attack program adopts ONLY its index", () => {
    // "Surf" / "Psychic Sphere" must stay on the plain damage path.
    for (const id of ["sv10-050", "sv10-083"]) {
      expect(programFor(id)?.attack?.[0], `${id} idx 0`).toBeDefined();
      expect(programFor(id)?.attack?.[1], `${id} idx 1 was adopted`).toBeUndefined();
    }
    // 🆕 **D313 — LILLIE'S COMFEY `sv09-068` LEFT THIS LIST BY BEING BUILT, NOT BY
    // BEING WRONG.** Index 1 is "Fade Out" — *"Put this Pokémon and all attached
    // cards into your hand."* — which D313 authored as `returnSelf { dest: "hand" }`
    // while settling that op's destination over all four printed spellings at once.
    // 🛑 **THE GUARD IS RE-POINTED RATHER THAN DELETED, AND ADOPTION IS STILL WHAT
    // IT ASKS**: the two indices must carry DIFFERENT programs, because the defect
    // this rung exists for is index 1 inheriting index 0's, and a card where both
    // are authored is exactly where that would now hide.
    const comfey = programFor("sv09-068")?.attack;
    expect(comfey?.[0], "sv09-068 idx 0").toBeDefined();
    expect(comfey?.[1], "sv09-068 idx 1").toEqual([{ op: "returnSelf", dest: "hand" }]);
    expect(comfey?.[0]).not.toEqual(comfey?.[1]);
    expect(comfey?.[2], "sv09-068 idx 2 — the card prints two attacks").toBeUndefined();
  });

  // 🛑 D263 SHARPENED THIS GUARD FROM THE CARD TO THE **SURFACE**, AND IT WAS A
  //    REAL DEFECT RATHER THAN A TIDY-UP. The assertion used to read
  //    `expect(programFor(id)).toBeUndefined()` — a claim about the whole CARD —
  //    for a work order that is about ONE PRINTED SENTENCE. Team Rocket's Spidops
  //    `sv10-020`/`sv10-187` carries **two** printed surfaces: the ATTACK this row
  //    is about ("This attack does 30 damage for each of your Team Rocket's
  //    Pokémon in play.", still unbuilt, still blocked on a `DamageCountSource`)
  //    and an ABILITY that is a different sentence entirely ("Charging Up",
  //    BUILT at D263). Authoring the Ability made this guard fail on a row whose
  //    claim is still perfectly true.
  //    ⚠️ **THE FIX IS TO NAME THE SURFACE, NOT TO REMOVE THE ROW** — removing it
  //    would have thrown away a live work order to silence a guard that was
  //    asking the wrong question. Every row now declares which `CardProgram` key
  //    its sentence would land on, and the guard checks THAT key. The table is
  //    strictly stronger afterwards: it can now tell "this sentence was built"
  //    from "some other sentence on the same cardboard was".
  //    🆕 **GROUP BY SENTENCE, NOT PRINTING — AND ASSERT BY SENTENCE TOO.** The
  //    census discipline has said the first half for twenty slices; this is the
  //    first time a GUARD has been caught violating the second.
  //    🛑🛑 **D439 WIDENED THIS GUARD FROM THE REGISTRY TO THE READER, AND IT WAS
  //    THE SAME DEFECT ONE LAYER DOWN.** D263's fix asked the right KEY of the
  //    right CARD — and still asked only `programFor`, which is the REGISTRY.
  //    An attack program resolves `registry ?? deriveAttackEffect`, so a sentence
  //    claimed by a DERIVER ARM leaves this guard perfectly green. That is the
  //    vacuity `conventions.md` records against D204 in those exact words, and it
  //    happened: D439 built *"This attack does 30 damage for each of your Team
  //    Rocket's Pokémon in play."* through two new anchors, and this table went on
  //    advertising it as unbuilt work with NOTHING RED. It was caught by grepping
  //    the suites for the sentence, which is luck rather than a process.
  //    ⚠️ **THE FIX ASKS BOTH CHANNELS, AND ONLY FOR THE SURFACE THAT HAS TWO.**
  //    `resolvedByAnyReader` is the attack column's text path; the `trainer` and
  //    `stadium` rows have no deriver behind them at all, so asking it of them
  //    would be a rung that could never fire. Measured before it was written: of
  //    the five DROPPED rows, two are `attack`, and the OTHER one
  //    (*"Discard a Team Rocket's Energy from this Pokémon. …"*) is still refused
  //    by every reader — so the widening removes a live blind spot and moves no
  //    other row, which is what makes it a fix rather than a re-scoping.
  it("every DROPPED printing is still UNBUILT on its own SURFACE — the work order cannot rot", () => {
    for (const { sentence, ids, legal, surface } of DROPPED) {
      expect(ids, `${sentence.slice(0, 40)}…: id list disagrees with its legal count`).toHaveLength(legal);
      for (const id of ids) {
        expect(
          programFor(id)?.[surface],
          `${id}'s ${surface} was quietly authored; update DROPPED`,
        ).toBeUndefined();
      }
      // 🛑 THE SECOND CHANNEL. An `attack` row can also be built by TEXT, and that
      // is the road this table was blind to for as long as it existed.
      if (surface === "attack") {
        expect(
          resolvedByAnyReader(sentence),
          `${sentence.slice(0, 40)}… is now claimed by a READER; update DROPPED`,
        ).toBe(false);
      }
    }
  });
});

describe("D200 — what the predicate reads", () => {
  const cynthia: CardFilter = { kind: "ownerPokemon", owner: "Cynthia" };
  const card = (id: string) => POOL[id] as Card;

  it("matches on the card NAME's possessive prefix", () => {
    expect(matchesFilter(card("fix-cynthia-basic"), cynthia)).toBe(true);
    expect(matchesFilter(card("fix-cynthia-evo"), cynthia)).toBe(true);
    expect(matchesFilter(card("fix-championscall"), cynthia)).toBe(true);
  });

  it("does not match another owner, nor an unprefixed Pokémon", () => {
    expect(matchesFilter(card("fix-misty-basic"), cynthia)).toBe(false);
    expect(matchesFilter(card("fix-basic-1"), cynthia)).toBe(false);
  });

  it("⚠️ REFUSES `Team Rocket's Energy` — the one card that breaks the name rule", () => {
    // sv10-182 carries the prefix and is a Special Energy. The `category`
    // conjunct is what stops the card that PRINTS "only be attached to a Team
    // Rocket's Pokémon" from being one.
    const teamRocket: CardFilter = { kind: "ownerPokemon", owner: "Team Rocket" };
    expect(card("fix-tr-energy").name.startsWith("Team Rocket's ")).toBe(true);
    expect(matchesFilter(card("fix-tr-energy"), teamRocket)).toBe(false);
  });

  it("refuses a prefixed TRAINER for the same reason", () => {
    expect(card("fix-cynthia-trainer").name).toBe("fix-cynthia-trainer");
    // …and the printed Trainers that DO carry the prefix (Cynthia's Power
    // Weight, Hop's Bag, Lillie's Pearl) are refused by the same conjunct — here
    // driven on a body whose own name carries it.
    const named: Card = { ...card("fix-cynthia-trainer"), name: "Cynthia's Power Weight" };
    expect(named.name.startsWith("Cynthia's ")).toBe(true);
    expect(matchesFilter(named, cynthia)).toBe(false);
  });

  it("the match is EXACT-CASE and the trailing space is load-bearing", () => {
    const gible = card("fix-cynthia-basic");
    expect(matchesFilter({ ...gible, name: "cynthia's Gible" }, cynthia)).toBe(false);
    // No trailing space in the print → not a member. "Cynthia'sGible" is not a
    // real name, and this is what keeps it from becoming one by accident.
    expect(matchesFilter({ ...gible, name: "Cynthia'sGible" }, cynthia)).toBe(false);
    // A LONGER owner is not a member of a shorter one's subgroup.
    expect(matchesFilter({ ...gible, name: "Cynthia Jr.'s Gible" }, cynthia)).toBe(false);
  });

  it("`Farfetch'd` cannot collide with any owner prefix", () => {
    // The only two apostrophe-bearing non-possessive names in the catalog are
    // `Farfetch'd` and `Billy & O'Nare`; both carry `'d` / `'N`, never `'s `.
    for (const owner of ["Farfetch", "Billy & O", "N", "Misty"]) {
      expect(matchesFilter(card("fix-farfetchd"), { kind: "ownerPokemon", owner })).toBe(false);
    }
  });

  it("an owner nobody prints matches the EMPTY SET — a loud no-op, never a wrong card", () => {
    // The safety argument for the bare `string`: no misspelling can match a
    // Pokémon it does not name, so a typo whiffs where `providesEnergy`'s
    // forbidden Colorless would have taken the wrong print.
    for (const id of Object.keys(LOCAL_CARDS)) {
      expect(matchesFilter(card(id), { kind: "ownerPokemon", owner: "Cynthai" })).toBe(false);
    }
  });

  it("`stage` narrows to the printed word, and the two arms partition the subgroup", () => {
    const basic: CardFilter = { kind: "ownerPokemon", owner: "Cynthia", stage: "basic" };
    const evo: CardFilter = { kind: "ownerPokemon", owner: "Cynthia", stage: "evolution" };
    expect(matchesFilter(card("fix-cynthia-basic"), basic)).toBe(true);
    expect(matchesFilter(card("fix-cynthia-basic"), evo)).toBe(false);
    expect(matchesFilter(card("fix-cynthia-evo"), basic)).toBe(false);
    expect(matchesFilter(card("fix-cynthia-evo"), evo)).toBe(true);
    // …and the unmarked printing takes both (§ the "a Cynthia's Pokémon" arm).
    for (const id of ["fix-cynthia-basic", "fix-cynthia-evo"]) {
      expect(matchesFilter(card(id), cynthia)).toBe(true);
    }
  });

  it("the stage arms agree with the sibling members on every card in the pool", () => {
    // "Evolution X's Pokémon" and "an Evolution Pokémon" must not disagree —
    // both read `evolveFromOf(card) !== null`, and this is where that is checked
    // rather than asserted in a comment.
    for (const [id, c] of Object.entries(POOL)) {
      if (c.category !== "Pokemon" || !c.name.includes("'s ")) continue;
      const owner = c.name.slice(0, c.name.indexOf("'s "));
      expect(
        matchesFilter(c, { kind: "ownerPokemon", owner, stage: "basic" }),
        `${id} (${c.name}) basic arm`,
      ).toBe(matchesFilter(c, { kind: "basicPokemon" }));
      expect(
        matchesFilter(c, { kind: "ownerPokemon", owner, stage: "evolution" }),
        `${id} (${c.name}) evolution arm`,
      ).toBe(matchesFilter(c, { kind: "evolutionPokemon" }));
    }
  });

  it("exactly D242's TWO prefixed POKÉMON match, and no other fixture matches any owner", () => {
    // ⚠️ **THIS CONTROL EXPIRED AT D242 AND IS RE-HOMED RATHER THAN DELETED**
    // (progress.md's standing rule). It read "no card in `FIXTURE_POOL` matches ANY
    // owner", which was true for 42 slices and is the reason every demonstrator in
    // this file is a local body. D242 fielded four prefixed NAMES, and the value of
    // the control is now in which of them the PREDICATE admits:
    //   • `fix-powersaver` / `fix-tr-body` — Pokémon, prefix at position 0: MATCH.
    //   • `fix-tr-energy` — prefixed and NOT a Pokémon (`Team Rocket's Energy`
    //     sv10-182's shape): REFUSED by the `category` conjunct.
    //   • `fix-not-tr-body` — a Pokémon whose name CONTAINS the prefix without
    //     starting with it: REFUSED by `startsWith`.
    // So the two near misses this file's arm exists for are asserted HERE, on the
    // predicate itself, as well as through the count in `abilityAttackGate.test.ts`.
    //
    // ⚠️ **AND IT EXPIRED A SECOND TIME AT D243**, which is what an enumeration is
    // FOR. The seat-wide pre-W/R aura fielded three more prefixed Pokémon, and they
    // are here for a reason this file cares about: `seatDamageBonusBeforeWR.
    // beneficiary` is `matchesFilter`'s `ownerPokemon` arm, so D243 is the arm's
    // FIFTH consumer and the first to read it against an ATTACKING body rather than
    // a search or attach target. Two owners on one board is new too — a `Cynthia's`
    // and a `Hop's` row in the same pool, where D242's four were one owner.
    const owners = CENSUS.map((r) => r.owner);
    const matched: string[] = [];
    for (const [id, c] of Object.entries(FIXTURE_POOL)) {
      for (const owner of owners) {
        if (matchesFilter(c, { kind: "ownerPokemon", owner })) matched.push(`${id}/${owner}`);
      }
    }
    expect(matched.sort()).toEqual(
      [
        "fix-powersaver/Team Rocket",
        "fix-tr-body/Team Rocket",
        "fix-cynthia-aura/Cynthia",
        "fix-cynthia-body/Cynthia",
        "fix-hop-aura/Hop",
        // ⚠️ **A THIRD EXPIRY, AT D260**, and this one is the arm's SIXTH consumer:
        // `PassiveEffects.preventAttackEffectsForGroup` (Team Rocket's Articuno
        // `sv10-051` "Repelling Veil") carries a `CardFilter` and
        // `groupShieldedFromAttackEffects` answers it with THIS predicate. Both new
        // bodies are prefixed on purpose — the holder because the printed card is a
        // member of its own group, and `fix-tr-stage1` because the row's `stage`
        // conjunct had no negative in the pool until it arrived. ⚠️ Note the sweep
        // here passes NO `stage`, so the Stage 1 body matches the bare owner filter
        // and is refused only by the row's own `stage: "basic"`.
        "fix-repellingveil/Team Rocket",
        "fix-tr-stage1/Team Rocket",
        // ⚠️ **A FOURTH EXPIRY, AT D298** — and this one is NOT a consumer of
        // `matchesFilter` at all, which is the finding. Lillie's Pearl `sv09-151`
        // prints *"the **Lillie's** Pokémon this card is attached to"* — the same
        // printed vocabulary read at the §8.1 KO sweep (flow.ts) against ONE
        // HOLDER rather than against a zone, so it answers the prefix with
        // `startsWith` directly instead of through a `CardFilter`. That both
        // readings agree on these two bodies is exactly what this sweep is for,
        // and `Lillie` being in `CENSUS`'s own owner list is the catalog
        // confirming the prefix is real.
        "fix-lillie-body/Lillie",
        "fix-legacy-ex/Lillie",
        // ⚠️ **A FIFTH EXPIRY, AT D337**, and this one is the arm's SEVENTH consumer
        // AND the first to read it INSIDE a union: Ethan's Adventure
        // `sv10-165`/`-221`/`-236` is `anyOf[ownerPokemon{Ethan}, basicEnergy{Fire}]`
        // under a flat cap, so `matchesFilter` recurses into this arm from the
        // combinator rather than reaching it directly. All three bodies match the
        // BARE owner filter this sweep passes — which is the point of the middle
        // one: `fix-ethans-typhlosion` is a STAGE 2, and the printed noun carries no
        // stage, so a build that added `stage: "basic"` would keep this line green
        // and refuse the card the print admits. `Ethan` is already in `CENSUS`'s own
        // owner list (11 printings: 3 effect + 3 attack + 5 ability), which is the
        // catalog confirming the prefix is real — and the `effect` 3 are exactly
        // this slice's three printings.
        //
        // ⚠️ AND `fix-ethans-pichu` IS {L}, NOT {R}. It matches here for the same
        // reason it is admitted on the board: this predicate reads the OWNER and
        // nothing else. The printed `{R}` belongs to the union's OTHER member.
        "fix-ethans-cyndaquil/Ethan",
        "fix-ethans-typhlosion/Ethan",
        "fix-ethans-pichu/Ethan",
        // ⚠️ **AND AN EXPIRY AT D392, WHICH THIS PREDICATE DID NOT ASK FOR AND WHICH IT
        // ANSWERS CORRECTLY ANYWAY.** The SUBSTRING name read is demonstrated on Team
        // Rocket's Nidoqueen `sv10-116` and its Standard satisfier Team Rocket's
        // Nidoking ex, so two more `Team Rocket's ` bodies exist in the pool — and
        // `ownerPokemon` matches the possessive WHOLE, which is why both land here and
        // why the plain `fix-nidoking` (named "Nidoking", no prefix) does not.
        "fix-loveimpact/Team Rocket",
        "fix-trnidoking/Team Rocket",
        // 🆕🆕 D393 — AND A SECOND OWNER JOINS THE POOL FOR THE FIRST TIME IN THIS
        // RUN. The EVOLVE PAIR's Misty's Starmie `sv10-047` and its printed
        // pre-evolution Misty's Staryu both carry `Misty's `, so `ownerPokemon`
        // matches a possessive this predicate has never been shown before — which is
        // what makes these two rows evidence that the arm reads the PREFIX and not a
        // fixed list of owners. Neither was added for this test; both are the printed
        // bytes the D393 clause key compares against.
        "fix-abruptflash/Misty",
        "fix-mistystaryu/Misty",
        // 🆕🆕 **AN EXPIRY AT D439, AND IT IS THE ARM'S EIGHTH CONSUMER** —
        // `DamageCountSource.yourPokemonInPlay`, the first to read `ownerPokemon`
        // as a COUNT over a whole side rather than as an eligibility test on one
        // card. `fix-inplaybodies` ("Team Rocket's Fixmon") is the holder of the
        // five printed nouns this slice claims, and it is prefixed ON PURPOSE: the
        // owner sentence's own board needs the Active Spot to be inside the counted
        // set, so that a walk which skipped the Active answers 0 where the truth is
        // 1. ⚠️ It is a STAGE 1 and the sweep passes no `stage`, so it matches the
        // bare filter exactly as `fix-tr-stage1` does — the two together are why the
        // count in `bodiesInPlayScaling.test.ts` reads 1 on the attacker's side and
        // 2 on the defender's, which is the seat rung.
        "fix-inplaybodies/Team Rocket",
      ].sort(),
    );
  });
});

describe("D200 — Champion's Call (Cynthia's Gabite sv10-103)", () => {
  it("searches the deck for a Cynthia's Pokémon of ANY stage, and captions it as printed", () => {
    const state = withActive(1, "fix-championscall");
    const { state: parked } = mustApply(state, {
      type: "useAbility",
      seat: "p1",
      target: { spot: "active" },
      abilityName: "Champion's Call",
    });
    const prompt = cardsPrompt(parked);
    // The printed noun phrase, whole — `retrieveNoun`'s new arm through
    // `searchNote`. A member without it would have read "a Pokémon".
    expect(prompt.note).toBe("Search your deck for a Cynthia's Pokémon into your hand.");
    expect(prompt.max).toBe(1);
    expect(prompt.min).toBe(0); // "up to" — declining is legal
    expect(prompt.dest).toBe("hand");
    // BOTH stages, the Gabite copies still in the deck, and NOTHING else: not
    // the Cynthia's TOOL, not another owner's Pokémon.
    expect(new Set(offered(parked))).toEqual(
      new Set(["fix-cynthia-basic", "fix-cynthia-evo", "fix-championscall"]),
    );
  });

  it("resolving puts the chosen card in hand and shuffles", () => {
    const state = withActive(2, "fix-championscall");
    const { state: parked } = mustApply(state, {
      type: "useAbility",
      seat: "p1",
      target: { spot: "active" },
      abilityName: "Champion's Call",
    });
    // Any offer will do — the candidate SET is pinned in the case above; this
    // one is about what resolving does with a pick.
    const pick = cardsPrompt(parked).candidates[0] as string;
    const before = parked.players.p1.hand.length;
    const { state: done, events } = resolve(parked, [pick]);
    expect(done.players.p1.hand).toContain(pick);
    expect(done.players.p1.hand.length).toBe(before + 1);
    expect(done.players.p1.deck).not.toContain(pick);
    expect(events.map((e) => e.type)).toEqual(["DECK_SEARCHED", "SHUFFLE"]);
  });
});

describe("D200 — Swim Together (Misty's Lapras sv10-050/-194)", () => {
  it("the ATTACK path runs the same two ops at the printed max 3", () => {
    let state = withActive(3, "fix-swimtogether");
    state = attachFromDeck(state, "p1", "fix-water-energy", 1);
    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    const prompt = cardsPrompt(parked);
    expect(prompt.note).toBe("Search your deck for up to 3 Misty's Pokémon into your hand.");
    expect(prompt.max).toBe(3);
    expect(new Set(offered(parked))).toEqual(
      new Set(["fix-misty-basic", "fix-misty-evo", "fix-swimtogether"]),
    );
  });

  it("takes up to three, and the attacker's own copies are legal picks", () => {
    let state = withActive(4, "fix-swimtogether");
    state = attachFromDeck(state, "p1", "fix-water-energy", 1);
    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    const picks = cardsPrompt(parked).candidates.slice(0, 3);
    const before = parked.players.p1.hand.length;
    const { state: done } = resolve(parked, picks);
    expect(done.players.p1.hand.length).toBe(before + 3);
    for (const uid of picks) expect(done.players.p1.hand).toContain(uid);
  });
});

describe("D200 — the `stage` rider on the board", () => {
  it("Hop's Bag (sv09-147) offers BASIC Hop's Pokémon only, onto the Bench", () => {
    let state = clearBench(board(5), "p1");
    state = handFromDeck(handToDeck(state, "p1", "fix-hopsbag"), "p1", "fix-hopsbag", 1);
    const { state: parked } = mustApply(state, {
      type: "playTrainer",
      seat: "p1",
      uid: handUid(state, "p1", "fix-hopsbag"),
    });
    const prompt = cardsPrompt(parked);
    expect(prompt.note).toBe("Search your deck for up to 2 Basic Hop's Pokémon onto your Bench.");
    expect(prompt.dest).toBe("bench");
    expect(prompt.max).toBe(2);
    // `fix-hop-evo` is a Hop's Pokémon and is REFUSED by the stage rider;
    // `fix-hopsbag` itself is a Hop's-named TRAINER and is refused by category.
    expect(new Set(offered(parked))).toEqual(new Set(["fix-hop-basic"]));
  });

  it("Summoning Sign (sv10-083) is the same program one owner over", () => {
    let state = withActive(6, "fix-summoningsign");
    state = attachFromDeck(state, "p1", "fix-energy", 1);
    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(cardsPrompt(parked).note).toBe(
      "Search your deck for up to 2 Basic Steven's Pokémon onto your Bench.",
    );
    // The attacker's own copies are in it: Steven's Baltoy IS a Basic Steven's
    // Pokémon, and the printed sentence has no "other" in it.
    expect(new Set(offered(parked))).toEqual(new Set(["fix-steven-basic", "fix-summoningsign"]));
    const picks = cardsPrompt(parked).candidates.slice(0, 2);
    const { state: done } = resolve(parked, picks);
    expect(done.players.p1.bench).toHaveLength(picks.length);
  });
});

describe("D200 — Inviting Flowers (Lillie's Comfey sv09-068): the printed 'any number'", () => {
  it("offers the whole Bench when the Bench is empty — BENCH_MAX is a cap, not a guess", () => {
    let state = withActive(7, "fix-invitingflowers");
    state = attachFromDeck(state, "p1", "fix-energy", 1);
    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    const prompt = cardsPrompt(parked);
    expect(prompt.max).toBe(5);
    expect(prompt.note).toBe("Search your deck for up to 5 Basic Lillie's Pokémon onto your Bench.");
    expect(new Set(offered(parked))).toEqual(new Set(["fix-lillie-basic", "fix-invitingflowers"]));
    // D186's finding, driven rather than quoted: the printed "You may" needs no
    // `optional` wrapper because THIS prompt already legalises taking none.
    expect(prompt.min).toBe(0);
  });

  it("clamps to the REMAINING bench space, so the cap is never the number 5", () => {
    let state = withActive(8, "fix-invitingflowers");
    state = attachFromDeck(state, "p1", "fix-energy", 1);
    // Three bodies benched → two slots left.
    for (const _ of [0, 1, 2]) state = benchFromDeck(state, "p1", "fix-bigbody");
    const { state: parked } = mustApply(state, { type: "attack", seat: "p1", index: 0 });
    expect(cardsPrompt(parked).max).toBe(2);
    expect(cardsPrompt(parked).note).toBe(
      "Search your deck for up to 2 Basic Lillie's Pokémon onto your Bench.",
    );
  });
});
